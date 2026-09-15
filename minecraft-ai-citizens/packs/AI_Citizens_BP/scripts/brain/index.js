/**
 * Brain selection.
 *
 * The local brain runs every think-tick. If the Claude bridge is available a
 * remote think is requested in parallel; when its answer arrives it supersedes
 * the local plan. Citizens are therefore never idle waiting on a network call,
 * and the add-on is fully playable with no bridge at all.
 */
import { CONFIG } from "../core/config.js";
import { debug } from "../core/log.js";
import { localBrain } from "./local.js";
import { claudeBrain } from "./claude.js";
import { decodeDecision } from "./schema.js";

export { localBrain, claudeBrain };

/**
 * @returns {{say,to,mood,goal,tasks,remember,source}}
 */
export function think(citizen, ctx) {
  // 1. Did a remote answer land since last time?
  const remote = claudeBrain.poll(citizen);
  if (remote) {
    const decoded = decodeDecision(remote, citizen, ctx);
    decoded.source = "claude";
    // A remote reply with neither speech nor a plan is not worth acting on.
    if (decoded.say || decoded.tasks.length) return decoded;
  }

  // 2. Ask Claude for the *next* one, without waiting.
  if (claudeBrain.shouldRequest(citizen, ctx)) {
    claudeBrain.request(citizen, ctx, { kind: "tick" });
  }

  // 3. Act now on the local brain.
  const local = localBrain.think(citizen, ctx);
  local.source = "local";
  return local;
}

/** A player said something near this citizen. */
export function thinkAboutChat(citizen, ctx, speaker, text, direct) {
  if (claudeBrain.available && claudeBrain.healthy) {
    claudeBrain.requestChat(citizen, ctx, speaker, text, direct);
    return true;      // the reply will arrive through poll()
  }
  return false;
}

export function brainName() {
  if (!claudeBrain.available) return "local";
  return claudeBrain.healthy ? "claude" : "local (bridge down)";
}
