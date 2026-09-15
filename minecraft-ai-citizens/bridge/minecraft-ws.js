#!/usr/bin/env node
/**
 * The chat bridge.
 *
 * Minecraft Bedrock has a built-in command, `/connect`, that opens a WebSocket
 * from the game to a program on your machine. It is a vanilla feature - no beta
 * script modules, no dedicated server - and it can do the one thing the add-on
 * cannot do from the inside: read what you type in chat.
 *
 * So:
 *
 *   you type in chat  ->  Minecraft sends it here  ->  Claude reads it
 *         ^                                                  |
 *         |                                                  v
 *   citizens act  <-  /scriptevent back into the game  <-  an instruction
 *
 * With an API key, Claude decides what the citizen says back and what the
 * group should do. Without one it falls back to keyword matching, so chat
 * control works either way.
 *
 *   npm run ws
 *   then in Minecraft:  /connect localhost:19131
 *
 * Cheats must be on in the world (that is what `/connect` and `/scriptevent`
 * both need). Availability of `/connect` depends on platform - it is present on
 * Windows; on phones and consoles it may not be.
 */
import { WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";
import { CONFIG } from "./src/config.js";
import { interpretChat, interpretLocally } from "./src/chat.js";

const DEFAULT_PORT = 19131;

// Attention words, matching the add-on's own list.
const TRIGGERS = ["ai!", "!ai", "hey ai", "ai,", "ai:", "ai "];

const usage = {
  requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, failures: 0,
};

let clientLoader = null;
function getClient() {
  if (CONFIG.dryRun) return null;
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return null;
  if (!clientLoader) {
    clientLoader = import("@anthropic-ai/sdk").then((m) => new m.default({
      timeout: CONFIG.timeoutMs,
      maxRetries: 1,
    }));
  }
  return clientLoader;
}

const claudeAvailable = Boolean(
  !CONFIG.dryRun && (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
);

// --------------------------------------------------------------------------
// Bedrock's WebSocket protocol
// --------------------------------------------------------------------------
function subscribeFrame(eventName) {
  return JSON.stringify({
    header: {
      version: 1,
      requestId: randomUUID(),
      messageType: "commandRequest",
      messagePurpose: "subscribe",
    },
    body: { eventName },
  });
}

function commandFrame(commandLine) {
  return JSON.stringify({
    header: {
      version: 1,
      requestId: randomUUID(),
      messageType: "commandRequest",
      messagePurpose: "commandRequest",
    },
    body: { version: 1, commandLine, origin: { type: "player" } },
  });
}

/** Strips an attention word; null when the message was not addressed to us. */
export function stripTrigger(message) {
  const text = String(message || "").trim();
  const lower = text.toLowerCase();
  for (const t of TRIGGERS) {
    if (!lower.startsWith(t)) continue;
    // A bare "ai" needs a separator after it, or "aim for the hill" is caught.
    if (/[a-z]$/.test(t) && !/^[\s,:!?-]/.test(text.slice(t.length))) continue;
    return text.slice(t.length).replace(/^[\s,:!?-]+/, "").trim();
  }
  return null;
}

/** Minecraft's command parser needs quotes and backslashes tamed. */
export function sanitiseForCommand(text) {
  return String(text || "")
    .replace(/[\\"]/g, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 220);
}

// --------------------------------------------------------------------------
const history = new Map();      // player -> recent turns, for continuity

function rememberTurn(player, userText, replyJson) {
  const turns = history.get(player) || [];
  turns.push({ role: "user", content: userText },
              { role: "assistant", content: JSON.stringify(replyJson) });
  while (turns.length > CONFIG.historyTurns * 2) turns.shift();
  history.set(player, turns);
}

export async function handlePlayerMessage({ message, sender }, send, opts = {}) {
  const addressed = stripTrigger(message);
  if (addressed === null) return { handled: false };
  if (!addressed) {
    send(commandFrame('scriptevent ai:cmd help'));
    return { handled: true, kind: "help" };
  }

  let plan;
  const useClaude = opts.claude ?? claudeAvailable;
  if (useClaude) {
    try {
      plan = await interpretChat(addressed, sender, history.get(sender) || [],
        { getClient: opts.getClient || getClient, usage });
      rememberTurn(sender, `${sender} says: "${addressed}"`, plan);
    } catch (err) {
      usage.failures += 1;
      log(`Claude failed (${err.message}); falling back to keywords`);
      plan = interpretLocally(addressed);
    }
  } else {
    plan = interpretLocally(addressed);
  }

  // Whatever the player literally said always reaches the add-on, so its own
  // parser gets a go even when Claude declined to name an instruction.
  const spoken = plan.instruction || addressed;
  const target = plan.addressee ? `@${sanitiseForCommand(plan.addressee)} ` : "";
  send(commandFrame(`scriptevent ai:tell ${target}${sanitiseForCommand(spoken)}`));

  if (plan.say) {
    send(commandFrame(`scriptevent ai:voice ${sanitiseForCommand(plan.say)}`));
  }

  return { handled: true, plan, instruction: spoken };
}

// --------------------------------------------------------------------------
function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

export function start(options = {}) {
  // Read the environment here rather than at import, so a caller (and the
  // tests) can pick a port without having set it before the module loaded.
  const port = Number(options.port || process.env.WS_PORT) || DEFAULT_PORT;
  const host = options.host || process.env.WS_HOST || "0.0.0.0";
  const wss = new WebSocketServer({ host, port });

  wss.on("connection", (socket, req) => {
    const who = req.socket.remoteAddress;
    log(`Minecraft connected from ${who}`);
    socket.send(subscribeFrame("PlayerMessage"));
    socket.send(commandFrame('scriptevent ai:cmd status'));

    socket.on("message", async (raw) => {
      let frame;
      try {
        frame = JSON.parse(raw.toString());
      } catch {
        return;                       // not something we can use
      }
      const purpose = frame.header?.messagePurpose;
      if (purpose !== "event") return;
      if (frame.header?.eventName !== "PlayerMessage") return;

      const body = frame.body || {};
      // Only real chat: ignore /say, /tell and our own command output, or the
      // bridge would answer itself in a loop.
      if (body.type && body.type !== "chat") return;
      if (!body.message) return;

      try {
        const result = await handlePlayerMessage(
          { message: body.message, sender: body.sender || "a player" },
          (text) => socket.send(text),
        );
        if (result.handled) {
          log(`${body.sender}: "${body.message}" -> ${result.instruction || "(help)"}`);
          if (result.plan?.say) log(`   reply: "${result.plan.say}"`);
        }
      } catch (err) {
        log(`error handling message: ${err.message}`);
      }
    });

    socket.on("close", () => log("Minecraft disconnected"));
    socket.on("error", (e) => log(`socket error: ${e.message}`));
  });

  wss.on("error", (e) => {
    console.error(`\nCould not start on ${host}:${port} - ${e.message}\n`);
    if (!options.quiet) process.exit(1);
  });

  if (!options.quiet) {
    console.log("\nAI Citizens chat bridge");
    console.log(`  listening    ws://${host}:${port}`);
    console.log(`  brain        ${claudeAvailable ? CONFIG.model : "keyword matching (no ANTHROPIC_API_KEY set)"}`);
    console.log("\nIn Minecraft, with cheats on:");
    console.log(`  /connect localhost:${port}`);
    console.log("\nThen just type in chat:");
    console.log("  ai! go mine some wood\n");
  }
  return wss;
}

if (import.meta.url === `file://${process.argv[1]}`) start();
