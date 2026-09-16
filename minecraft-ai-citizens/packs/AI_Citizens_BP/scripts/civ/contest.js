/**
 * Contests: citizens competing, against each other or against the clock.
 *
 * "First one to get 20 wood", "you two fight", "race to that hill". A contest
 * is a supervisor, not a task: it hands every entrant an ordinary task, then
 * watches the world each slow tick to see who is winning. That keeps the
 * competition honest - nobody wins by being told they won, they win by being
 * the first to actually have the wood, reach the spot or leave the other one
 * yielding.
 *
 * Every kind scores off something already true in the world:
 *
 *   gather/find  what is in their inventory
 *   race         distance to the finish
 *   dig          how deep they have got
 *   hunt         kills, counted as they land
 *   build        blocks placed out of the blueprint's total
 *   duel/melee   who is still standing
 *   tournament   a bracket of duels, one pair at a time
 */
import { CONFIG } from "../core/config.js";
import { safe, broadcast } from "../core/log.js";
import { dist, dist2d, prettyId, pick, titleCase } from "../core/util.js";
import { say, TONE, interrupt } from "../ui/caption.js";
import { remember } from "../agent/memory.js";
import { fightTask, sparTask } from "../actions/combat.js";
import { gatherTask } from "../actions/mine.js";
import { buildTask, cellsFromBlueprint, findBuildSite } from "../actions/build.js";
import { gotoTask, exploreTask, waitTask } from "../actions/registry.js";
import { snapToGround } from "../actions/navigation.js";
import { mineTask, excavateTask } from "../actions/mine.js";
import { shaftCells } from "./shapes.js";
import { blueprintById } from "./blueprints.js";

/** How long a contest may run before it is called off, in ticks. */
const DEFAULT_DEADLINE = 20 * 60 * 6;      // six minutes
const CHECK_EVERY = 20;                     // one scoring pass a second

export const CONTEST_KINDS = [
  "gather", "find", "race", "dig", "hunt", "build", "duel", "melee", "tournament",
];

export class Contests {
  constructor() {
    this.current = null;
    this.lastCheck = 0;
    this.history = [];
  }

  get active() { return this.current && this.current.status === "running" ? this.current : null; }

  /**
   * Begin a contest.
   * @param {object} app
   * @param {object} spec {kind, entrants, goal, resource, blueprintId, target, host, prize}
   * @returns {{ok:boolean, contest?:object, why?:string}}
   */
  start(app, spec) {
    if (this.active) return { ok: false, why: `${this.current.title} is already running.` };

    const entrants = (spec.entrants || []).filter((c) => c && c.valid);
    const needed = spec.kind === "duel" ? 2 : 2;
    if (entrants.length < needed) {
      return { ok: false, why: `Need at least ${needed} of them for that. Spawn a few more.` };
    }

    const contest = {
      id: `k${Date.now().toString(36)}`,
      kind: spec.kind,
      title: titleFor(spec),
      goal: spec.goal || null,
      resource: spec.resource || null,
      blocks: spec.blocks || null,
      blueprintId: spec.blueprintId || null,
      target: spec.target || null,
      depth: spec.depth ?? null,
      host: spec.host || null,
      prize: spec.prize || null,
      startedTick: app.tick,
      deadline: app.tick + (spec.deadlineTicks || DEFAULT_DEADLINE),
      status: "running",
      winner: null,
      bracket: null,
      round: 0,
      players: entrants.map((c) => ({
        id: c.id, name: c.short, score: 0, out: false, finished: false, baseline: 0,
      })),
    };

    // Some scores are relative to where they started - you have not gathered
    // twenty logs if you were already carrying twenty.
    for (const p of contest.players) {
      const c = app.registry.get(p.id);
      if (!c) continue;
      p.baseline = this.rawScore(contest, c);
    }

    this.current = contest;
    this.assignTasks(app, contest);
    this.announce(app, contest, `§e${contest.title}§r — ${contest.players.map((p) => p.name).join(" vs ")}`);
    for (const p of contest.players) {
      const c = app.registry.get(p.id);
      if (c) say(c, pick(OPENING_LINES), { tone: TONE.order });
    }
    return { ok: true, contest };
  }

  /** Give every entrant the task that lets them compete. */
  assignTasks(app, contest) {
    const entrants = contest.players
      .filter((p) => !p.out)
      .map((p) => app.registry.get(p.id))
      .filter(Boolean);

    switch (contest.kind) {
      case "gather":
      case "find": {
        const blocks = contest.blocks || [];
        for (const c of entrants) {
          this.give(app, c, gatherTask(
            (t) => blocks.includes(t), 40, contest.goal || 16,
            `racing for ${contest.resource || "it"}`));
        }
        break;
      }

      case "race": {
        // The finish has to be somewhere you can stand. A point picked by
        // looking at a hillside is usually a few blocks up in the air, and a
        // race nobody can finish is not a race.
        const finish = entrants.length
          ? (safe("contest.finish", () => snapToGround(
              entrants[0].dimension, contest.target, contest.target.y), null) || contest.target)
          : contest.target;
        contest.target = finish;
        for (const c of entrants) {
          this.give(app, c, gotoTask(finish, { sprint: true, arrive: 2, label: "racing" }));
        }
        break;
      }

      case "dig": {
        for (const c of entrants) {
          const depth = Math.max(1, Math.floor(c.location.y) - contest.depth);
          this.give(app, c, excavateTask(shaftCells(c.location, depth),
            { label: "digging for the win" }));
        }
        break;
      }

      case "hunt": {
        for (const c of entrants) {
          c.contestKills = 0;
          this.give(app, c, exploreTask(48, { legs: 4 }));
        }
        break;
      }

      case "build": {
        const bp = blueprintById(contest.blueprintId);
        if (!bp) break;
        for (const c of entrants) {
          const site = safe("contest.site", () => findBuildSite(
            c.dimension, c.location, bp.width, bp.depth, 40), null);
          if (!site) continue;
          this.give(app, c, buildTask(cellsFromBlueprint(bp, site, 0),
            { label: `building a ${bp.name} against the clock` }));
        }
        break;
      }

      case "duel":
      case "melee": {
        this.pairUp(app, contest, entrants);
        break;
      }

      case "tournament": {
        if (!contest.bracket) {
          contest.bracket = entrants.map((c) => c.id);
          contest.round = 1;
        }
        this.nextBout(app, contest);
        break;
      }
    }
  }

  /** In a melee everyone squares up to their nearest rival. */
  pairUp(app, contest, entrants) {
    for (const c of entrants) {
      const rival = entrants
        .filter((o) => o !== c)
        .sort((a, b) => c.distanceTo(a.location) - c.distanceTo(b.location))[0];
      if (!rival) continue;
      this.give(app, c, sparTask(rival.id, { label: `squaring up to ${rival.short}` }));
    }
  }

  /** A tournament fights one pair at a time so the rest can watch. */
  nextBout(app, contest) {
    const standing = contest.bracket
      .map((id) => app.registry.get(id))
      .filter((c) => c && c.valid && !contest.players.find((p) => p.id === c.id)?.out);

    if (standing.length < 2) return;
    const [a, b] = standing;
    contest.bout = [a.id, b.id];
    this.give(app, a, sparTask(b.id, { label: `round ${contest.round}: ${b.short}` }));
    this.give(app, b, sparTask(a.id, { label: `round ${contest.round}: ${a.short}` }));
    for (const c of standing.slice(2)) this.give(app, c, waitTask(30, "watching the bout"));
    this.announce(app, contest, `§7Round ${contest.round}:§r ${a.short} vs ${b.short}`);
  }

  give(app, citizen, task) {
    citizen.plan.length = 0;
    citizen.task = task;
    citizen.goal = task.label;
    citizen.inContest = this.current ? this.current.id : null;
    citizen.dirty = true;
  }

  // ----------------------------------------------------------------------
  // Scoring
  // ----------------------------------------------------------------------

  /** The number this contest is really about, before the baseline is taken off. */
  rawScore(contest, citizen) {
    switch (contest.kind) {
      case "gather":
      case "find": {
        let total = 0;
        for (const id of contest.blocks || []) total += citizen.countItem(id);
        return total;
      }
      case "race":
        return contest.target ? -Math.round(dist2d(citizen.location, contest.target)) : 0;
      case "dig":
        return -Math.round(citizen.location.y);
      case "hunt":
        return citizen.contestKills || 0;
      case "build":
        return citizen.task && citizen.task.kind === "build" ? (citizen.task.placed || 0) : 0;
      default:
        return 0;
    }
  }

  score(contest, citizen) {
    const raw = this.rawScore(contest, citizen);
    // Distances and depths are already relative; counts are not.
    if (contest.kind === "race" || contest.kind === "dig") return raw;
    const player = contest.players.find((p) => p.id === citizen.id);
    return raw - (player ? player.baseline : 0);
  }

  /** Has this entrant met the win condition outright? */
  hasWon(contest, citizen, score) {
    switch (contest.kind) {
      case "gather":
      case "find":
      case "hunt":
        return score >= (contest.goal || 1);
      case "race":
        // Measured flat: finishing on the step above the marker still counts.
        return contest.target && dist2d(citizen.location, contest.target) <= 4;
      case "dig":
        return citizen.location.y <= contest.depth;
      case "build":
        return Boolean(citizen.task && citizen.task.kind === "build"
          && citizen.task.index >= citizen.task.cells.length);
      default:
        return false;
    }
  }

  // ----------------------------------------------------------------------
  // The loop
  // ----------------------------------------------------------------------
  tick(app) {
    const contest = this.active;
    if (!contest) return;
    if (app.tick - this.lastCheck < CHECK_EVERY) return;
    this.lastCheck = app.tick;

    if (app.tick > contest.deadline) {
      this.finishOnPoints(app, contest, "Time.");
      return;
    }

    let live = 0;
    for (const player of contest.players) {
      const citizen = app.registry.get(player.id);
      if (!citizen || !citizen.valid) { player.out = true; continue; }

      // A fighter who has yielded is out of it.
      if (isFightKind(contest.kind)) {
        if (citizen.yielded) { player.out = true; citizen.yielded = false; }
        else live++;
        continue;
      }

      player.score = this.score(contest, citizen);
      live++;
      if (this.hasWon(contest, citizen, player.score)) {
        this.declare(app, contest, player);
        return;
      }
    }

    if (isFightKind(contest.kind)) {
      const standing = contest.players.filter((p) => !p.out);
      if (contest.kind === "tournament") {
        // A bout is settled: the loser leaves the bracket, the rest fight on.
        const bout = (contest.bout || []).map((id) => contest.players.find((p) => p.id === id));
        if (bout.length === 2 && bout.some((p) => p && p.out) && standing.length > 1) {
          contest.bracket = contest.bracket.filter(
            (id) => !contest.players.find((p) => p.id === id)?.out);
          contest.round += 1;
          this.nextBout(app, contest);
          return;
        }
      }
      if (standing.length <= 1) {
        if (standing.length === 1) this.declare(app, contest, standing[0]);
        else this.finishOnPoints(app, contest, "Everyone's had enough.");
        return;
      }
      // Nobody has yielded but the fight has drifted apart - square them up again.
      this.reengage(app, contest);
    }

    this.keepBusy(app, contest);
    if (!live) this.finishOnPoints(app, contest, "Nobody left in it.");
  }

  /** Fighters who lost their target go back at it. */
  reengage(app, contest) {
    const standing = contest.players
      .filter((p) => !p.out)
      .map((p) => app.registry.get(p.id))
      .filter((c) => c && c.valid);
    if (contest.kind === "tournament") {
      const inBout = (contest.bout || []);
      for (const c of standing) {
        if (!inBout.includes(c.id)) continue;
        if (c.task && c.task.kind === "fight") continue;
        const rival = standing.find((o) => o.id !== c.id && inBout.includes(o.id));
        if (rival) this.give(app, c, sparTask(rival.id, { label: `round ${contest.round}` }));
      }
      return;
    }
    for (const c of standing) {
      if (c.task && c.task.kind === "fight") continue;
      const rival = standing.filter((o) => o !== c)
        .sort((a, b) => c.distanceTo(a.location) - c.distanceTo(b.location))[0];
      if (rival) this.give(app, c, sparTask(rival.id, { label: `back at ${rival.short}` }));
    }
  }

  /**
   * Put idle entrants back to work.
   *
   * A task can finish or fail short of the goal - a vein runs out, a path
   * gives way, a racer's route expires a few blocks from the line. Ordinarily
   * the planner would pick them up, but entrants are deliberately hidden from
   * it, so the contest has to do it or they stand there until the deadline and
   * the whole thing ends in a draw nobody earned.
   */
  keepBusy(app, contest) {
    if (isFightKind(contest.kind)) return;
    for (const player of contest.players) {
      if (player.out) continue;
      const citizen = app.registry.get(player.id);
      if (!citizen || !citizen.valid || citizen.task) continue;

      switch (contest.kind) {
        case "gather":
        case "find":
          this.give(app, citizen, gatherTask(
            (t) => (contest.blocks || []).includes(t), 40, contest.goal || 16,
            `racing for ${contest.resource || "it"}`));
          break;
        case "race":
          this.give(app, citizen, gotoTask(contest.target,
            { sprint: true, arrive: 2, label: "racing" }));
          break;
        case "dig": {
          // Re-cut from where they are now, so each attempt sinks the shaft
          // further instead of restarting the same dig.
          const left = Math.floor(citizen.location.y) - contest.depth;
          if (left <= 0) break;
          this.give(app, citizen, excavateTask(shaftCells(citizen.location, left),
            { label: "digging for the win" }));
          break;
        }
        case "hunt":
          this.give(app, citizen, exploreTask(48, { legs: 4 }));
          break;
        case "build":
          break;      // a finished build is a win, not an idle citizen
        default:
          break;
      }
    }
  }

  declare(app, contest, player) {
    contest.status = "done";
    contest.winner = player.name;
    const citizen = app.registry.get(player.id);

    if (citizen) {
      citizen.wins = (citizen.wins || 0) + 1;
      interrupt(citizen, pick(WIN_LINES), { tone: TONE.friendly });
      remember(citizen.memory, `won ${contest.title}`, 4, app.tick);
    }
    for (const other of contest.players) {
      if (other.id === player.id) continue;
      const loser = app.registry.get(other.id);
      if (loser) {
        say(loser, pick(LOSE_LINES).replace("{winner}", player.name), { tone: TONE.normal });
        remember(loser.memory, `lost ${contest.title} to ${player.name}`, 2, app.tick);
      }
    }
    this.announce(app, contest,
      `§a${player.name} wins§r ${contest.title}${contest.prize ? ` — ${contest.prize}` : ""}`);
    this.cleanUp(app, contest);
  }

  finishOnPoints(app, contest, why) {
    contest.status = "done";
    const ranked = contest.players.filter((p) => !p.out).sort((a, b) => b.score - a.score);
    const top = ranked[0];
    if (top && ranked.length && (ranked.length === 1 || top.score > ranked[1].score)) {
      contest.winner = top.name;
      this.announce(app, contest, `§7${why}§r §a${top.name} wins on points§r (${top.score}).`);
      const c = app.registry.get(top.id);
      if (c) { c.wins = (c.wins || 0) + 1; interrupt(c, pick(WIN_LINES), { tone: TONE.friendly }); }
    } else {
      this.announce(app, contest, `§7${why} A draw.§r`);
    }
    this.cleanUp(app, contest);
  }

  /** Stop the contest and put everyone back on their feet. */
  cleanUp(app, contest) {
    for (const player of contest.players) {
      const citizen = app.registry.get(player.id);
      if (!citizen || !citizen.valid) continue;
      citizen.inContest = null;
      citizen.yielded = false;
      citizen.contestKills = 0;
      if (citizen.task && (citizen.task.kind === "fight" || citizen.task.contest)) citizen.task = null;
      // A sparring match should not leave anybody on their last legs.
      safe("contest.heal", () => {
        const health = citizen.entity.getComponent("minecraft:health");
        if (health) health.setCurrentValue(health.effectiveMax);
      });
      citizen.dirty = true;
    }
    this.history.unshift({
      title: contest.title, winner: contest.winner, at: contest.startedTick,
    });
    if (this.history.length > 8) this.history.pop();
  }

  abandon(app, why = "Called off.") {
    const contest = this.active;
    if (!contest) return false;
    contest.status = "abandoned";
    this.announce(app, contest, `§7${why}§r`);
    this.cleanUp(app, contest);
    return true;
  }

  /** The running scores, best first. */
  scoreboardLines() {
    const contest = this.current;
    if (!contest) return ["No contest running."];
    const lines = [`§e${contest.title}§r §7(${contest.status})§r`];
    const ranked = contest.players.slice().sort((a, b) => b.score - a.score);
    for (const p of ranked) {
      const mark = p.out ? "§8out§r" : `${p.score}`;
      lines.push(`  ${p.name.padEnd(14)} ${mark}`);
    }
    if (contest.winner) lines.push(`§aWinner: ${contest.winner}§r`);
    return lines;
  }

  announce(app, contest, text) {
    safe("contest.announce", () => broadcast(text));
  }
}

const isFightKind = (kind) => kind === "duel" || kind === "melee" || kind === "tournament";

function titleFor(spec) {
  switch (spec.kind) {
    case "gather": return `the race for ${spec.goal} ${spec.resource || "blocks"}`;
    case "find": return `the hunt for ${spec.resource || "treasure"}`;
    case "race": return "the race";
    case "dig": return `the dig to y=${spec.depth}`;
    case "hunt": return `the hunt for ${spec.goal} kills`;
    case "build": return "the build-off";
    case "duel": return "the duel";
    case "melee": return "the melee";
    case "tournament": return "the tournament";
    default: return "the contest";
  }
}

const OPENING_LINES = [
  "Right. Don't hold back.", "You're on.", "Best of luck. You'll need it.",
  "Let's see, then.", "Ready when you are.", "Try to keep up.",
];
const WIN_LINES = [
  "Ha! Told you.", "That's how it's done.", "Anyone else?",
  "Easy enough.", "Good contest. I still won.",
];
const LOSE_LINES = [
  "Fine. {winner} had it.", "Next time, {winner}.", "Beaten fair.",
  "I want another go.", "{winner}'s quicker than they look.",
];
