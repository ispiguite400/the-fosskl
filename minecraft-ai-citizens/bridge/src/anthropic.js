/**
 * The call to Claude.
 *
 * Three things matter here:
 *  - the system prompt is byte-stable and cached, so a town of forty citizens
 *    pays for that prefix once rather than forty times a tick;
 *  - structured outputs guarantee a valid decision object comes back;
 *  - nothing is allowed to hang. A game tick cannot wait, so every request has
 *    a timeout and every failure returns cleanly so the add-on falls back to
 *    its local brain.
 */
import { CONFIG } from "./config.js";
import { DECISION_SCHEMA } from "./schema.js";
import { SYSTEM_PROMPT, capabilitiesBlock, buildUserTurn, buildGroupTurn } from "./prompts.js";
import { historyFor, remember } from "./memory.js";

/**
 * The SDK is loaded on first use rather than at import time, so DRY_RUN works
 * on a checkout where `npm install` has not been run yet - which is exactly
 * when someone is trying to prove the plumbing before committing to anything.
 */
let clientPromise = null;

function getClient() {
  if (!clientPromise) {
    clientPromise = import("@anthropic-ai/sdk").then((mod) => new mod.default({
      timeout: CONFIG.timeoutMs,
      maxRetries: 1,        // a game tick cannot wait for three retries
    }));
  }
  return clientPromise;
}

export const usage = {
  requests: 0,
  failures: 0,
  refusals: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  byKind: {},
  lastError: "",
  startedAt: Date.now(),
};

let inFlight = 0;
let fallbacksSupported = true;
let structuredOutputSupported = true;

export function canAcceptRequest() {
  if (inFlight >= CONFIG.maxConcurrent) return { ok: false, reason: "busy" };
  if (CONFIG.dailyTokenBudget > 0) {
    const spent = usage.inputTokens + usage.outputTokens;
    if (spent >= CONFIG.dailyTokenBudget) return { ok: false, reason: "token budget reached" };
  }
  return { ok: true };
}

export async function decide(packet) {
  const kind = packet.request === "group" ? "group" : (packet.request || "tick");
  const effort = CONFIG.effort[kind] || CONFIG.effort.tick;
  const userTurn = kind === "group" ? buildGroupTurn(packet) : buildUserTurn(packet);

  // The capabilities block never changes, so it rides in the cached prefix
  // rather than in every user turn.
  const system = [
    { type: "text", text: SYSTEM_PROMPT },
    {
      type: "text",
      text: capabilitiesBlock(packet.capabilities || { actions: "", structures: "" }),
      cache_control: { type: "ephemeral" },
    },
  ];

  const history = packet.citizen ? historyFor(packet.citizen.id) : [];
  const messages = [...history, { role: "user", content: userTurn }];

  inFlight++;
  usage.requests++;
  usage.byKind[kind] = (usage.byKind[kind] || 0) + 1;

  if (CONFIG.dryRun) {
    inFlight--;
    return { ok: true, decision: cannedDecision(packet, kind), usage: null };
  }

  try {
    const response = await send({ system, messages, effort });

    if (response.stop_reason === "refusal") {
      usage.refusals++;
      return { ok: false, reason: "refusal", detail: response.stop_details?.category || "unknown" };
    }

    recordUsage(response.usage);

    const decision = extractDecision(response);
    if (!decision) return { ok: false, reason: "no decision in reply" };

    if (packet.citizen) {
      remember(packet.citizen.id, userTurn, JSON.stringify(decision));
    }
    return { ok: true, decision, usage: response.usage };
  } catch (err) {
    usage.failures++;
    usage.lastError = String(err?.message || err).slice(0, 200);
    return { ok: false, reason: usage.lastError };
  } finally {
    inFlight--;
  }
}

/**
 * One request, with two graceful step-downs.
 *
 * A bridge may be pointed at an older deployment, a proxy, or a cloud provider
 * that has not caught up with a parameter. Rather than failing every citizen
 * forever, an unrecognised parameter is dropped once and never sent again -
 * the world keeps running, slightly less precisely.
 */
async function send({ system, messages, effort }) {
  const client = await getClient();

  const base = () => {
    const body = {
      model: CONFIG.model,
      max_tokens: CONFIG.maxTokens,
      system,
      messages,
      output_config: { effort },
    };
    if (structuredOutputSupported) {
      body.output_config.format = { type: "json_schema", schema: DECISION_SCHEMA };
    }
    return body;
  };

  const attempt = async () => {
    // Server-side fallbacks keep the world running if a request is declined:
    // Claude routes to another model instead of the citizen going quiet.
    if (fallbacksSupported) {
      try {
        return await client.beta.messages.create({
          ...base(),
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        });
      } catch (err) {
        if (!isParameterProblem(err, /fallback|beta/i)) throw err;
        fallbacksSupported = false;
        console.warn("[bridge] server-side fallbacks unavailable here - continuing without them");
      }
    }
    return client.messages.create(base());
  };

  try {
    return await attempt();
  } catch (err) {
    if (structuredOutputSupported && isParameterProblem(err, /output_config|format|json_schema/i)) {
      structuredOutputSupported = false;
      console.warn("[bridge] structured outputs unavailable here - parsing JSON from the reply instead");
      return attempt();
    }
    throw err;
  }
}

function isParameterProblem(err, pattern) {
  if (err?.status !== 400) return false;
  const msg = String(err?.message || "");
  return pattern.test(msg) || /unsupported|unexpected|unrecognized|not permitted/i.test(msg);
}

function extractDecision(response) {
  // Structured outputs put the parsed object on the response where the SDK
  // supports it; otherwise the single text block is the JSON.
  if (response.parsed_output) return response.parsed_output;
  for (const block of response.content || []) {
    if (block.type !== "text") continue;
    try {
      return JSON.parse(block.text);
    } catch {
      const m = /\{[\s\S]*\}/.exec(block.text);
      if (m) { try { return JSON.parse(m[0]); } catch { /* give up */ } }
    }
  }
  return null;
}

/** A plausible answer for DRY_RUN, so the wiring can be tested for free. */
function cannedDecision(packet, kind) {
  const name = packet.citizen?.name || "someone";
  const who = packet.message?.from || packet.partner?.name || null;
  if (kind === "chat") {
    return {
      say: `Right you are, ${who}. I'll see to it.`,
      to: who,
      mood: "steady",
      goal: "doing as asked",
      remember: [`${who} asked for something on day ${packet.world?.day ?? "?"}`],
      actions: [{ do: "wait", seconds: 3, why: "dry run" }],
    };
  }
  if (kind === "converse") {
    return { say: `Long day, ${who}.`, to: who, mood: "steady", goal: "passing the time", remember: [], actions: [] };
  }
  return {
    say: null, to: null, mood: "steady",
    goal: `${name} carries on`, remember: [], actions: [],
  };
}

function recordUsage(u) {
  if (!u) return;
  usage.inputTokens += u.input_tokens || 0;
  usage.outputTokens += u.output_tokens || 0;
  usage.cacheReadTokens += u.cache_read_input_tokens || 0;
  usage.cacheWriteTokens += u.cache_creation_input_tokens || 0;
}

export function usageReport() {
  const minutes = (Date.now() - usage.startedAt) / 60000;
  const cached = usage.cacheReadTokens + usage.inputTokens;
  return {
    ...usage,
    model: CONFIG.model,
    inFlight,
    requestsPerMinute: minutes > 0 ? Number((usage.requests / minutes).toFixed(1)) : 0,
    cacheHitRate: cached > 0 ? Number((usage.cacheReadTokens / cached).toFixed(2)) : 0,
    fallbacksSupported,
    structuredOutputSupported,
  };
}
