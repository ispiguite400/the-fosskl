/**
 * The Claude brain.
 *
 * Requests are fired asynchronously and never block the tick. While one is in
 * flight the citizen keeps acting on the local brain, and the remote answer is
 * applied the moment it lands. That means a slow network makes citizens a
 * little less clever for a second - never frozen, never silent.
 *
 * Health is tracked per-bridge: repeated failures back the brain off and flip
 * `CONFIG.brain` behaviour to local until the bridge recovers.
 */
import { CONFIG } from "../core/config.js";
import { debug, warn, info } from "../core/log.js";
import { NET_AVAILABLE, postJson, transportName } from "./transport.js";
import { buildContext } from "./prompt.js";
import { sanitiseSpeech } from "./schema.js";

const MAX_BACKOFF_TICKS = 1200;

export const claudeBrain = {
  id: "claude",
  pending: new Map(),        // citizenId -> { since, kind }
  results: new Map(),        // citizenId -> raw decision from the bridge
  failures: 0,
  backoffUntil: 0,
  lastOkTick: 0,
  totalCalls: 0,
  totalErrors: 0,
  lastError: "",

  get available() {
    return NET_AVAILABLE && CONFIG.brain !== "local" && Boolean(CONFIG.bridgeUrl);
  },

  get healthy() {
    return this.available && this.failures < 5;
  },

  status() {
    return {
      transport: transportName(),
      available: this.available,
      healthy: this.healthy,
      pending: this.pending.size,
      calls: this.totalCalls,
      errors: this.totalErrors,
      lastError: this.lastError,
      backoffTicks: Math.max(0, this.backoffUntil - (this.lastTick || 0)),
    };
  },

  /** True when this citizen is due a remote think. */
  shouldRequest(citizen, ctx) {
    if (!this.healthy) return false;
    if (ctx.tick < this.backoffUntil) return false;
    if (this.pending.has(citizen.id)) return false;
    if (this.pending.size >= CONFIG.claudeMaxPendingRequests) return false;
    const gap = ctx.tick - citizen.lastRemoteTick;
    return gap >= CONFIG.claudeMinIntervalTicks;
  },

  /** Non-blocking: fires the call and returns immediately. */
  request(citizen, ctx, requestSpec = { kind: "tick" }) {
    if (!this.available) return false;
    if (this.pending.has(citizen.id) && requestSpec.kind === "tick") return false;

    const packet = buildContext(citizen, ctx, requestSpec);
    this.pending.set(citizen.id, { since: ctx.tick, kind: requestSpec.kind });
    citizen.lastRemoteTick = ctx.tick;
    citizen.pendingThought = true;
    this.totalCalls += 1;
    this.lastTick = ctx.tick;

    const headers = {};
    if (CONFIG.bridgeToken) headers["X-AI-Citizens-Token"] = CONFIG.bridgeToken;

    postJson(`${CONFIG.bridgeUrl.replace(/\/$/, "")}/think`, packet, headers)
      .then((reply) => {
        this.pending.delete(citizen.id);
        citizen.pendingThought = false;
        this.failures = 0;
        this.lastOkTick = ctx.tick;
        if (reply && typeof reply === "object") {
          if (reply.say) reply.say = sanitiseSpeech(reply.say);
          this.results.set(citizen.id, reply);
        }
      })
      .catch((err) => {
        this.pending.delete(citizen.id);
        citizen.pendingThought = false;
        this.failures += 1;
        this.totalErrors += 1;
        this.lastError = String(err && err.message ? err.message : err).slice(0, 120);
        const backoff = Math.min(MAX_BACKOFF_TICKS, 60 * Math.pow(2, Math.min(5, this.failures)));
        this.backoffUntil = (this.lastTick || 0) + backoff;
        if (this.failures === 1 || this.failures === 5) {
          warn(`Claude bridge unreachable (${this.lastError}); citizens fall back to the local brain`);
        }
      });
    return true;
  },

  /** Collects a finished reply, if one is waiting. */
  poll(citizen) {
    const reply = this.results.get(citizen.id);
    if (!reply) return null;
    this.results.delete(citizen.id);
    return reply;
  },

  /** Drops requests that never came back, so the slot is not lost forever. */
  sweep(tick) {
    this.lastTick = tick;
    for (const [id, entry] of this.pending) {
      if (tick - entry.since > CONFIG.claudeTimeoutTicks) {
        this.pending.delete(id);
        this.totalErrors += 1;
        this.lastError = "timed out";
      }
    }
  },

  /** A player spoke: jump the queue so the reply feels immediate. */
  requestChat(citizen, ctx, speaker, text, direct) {
    if (!this.available) return false;
    // A chat request always goes out, even if a routine think is in flight.
    this.pending.delete(citizen.id);
    return this.request(citizen, ctx, {
      kind: "chat", speaker, text, direct,
    });
  },

  requestConverse(citizen, ctx, partnerName, lastLine) {
    if (!this.available) return false;
    return this.request(citizen, ctx, {
      kind: "converse", partnerName, lastLine,
    });
  },

  reset() {
    this.pending.clear();
    this.results.clear();
    this.failures = 0;
    this.backoffUntil = 0;
  },
};

export function describeBrainStatus() {
  const s = claudeBrain.status();
  if (!NET_AVAILABLE) {
    return "§7local brain§r (this build has no network transport - see docs/CLAUDE_SETUP.md)";
  }
  if (CONFIG.brain === "local") return "§7local brain§r (forced by config)";
  if (!s.healthy) {
    return `§clocal brain§r (bridge failing: ${s.lastError || "unknown"}; ${s.errors} errors)`;
  }
  return `§aClaude§r via ${s.transport} — ${s.calls} calls, ${s.errors} errors, ${s.pending} in flight`;
}
