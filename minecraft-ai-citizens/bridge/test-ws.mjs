#!/usr/bin/env node
/**
 * Verifies the chat bridge by pretending to be Minecraft.
 *
 * Bedrock's WebSocket protocol is not something this environment can exercise
 * against the real game, so this test client speaks the same frames the game
 * does: it connects, expects a PlayerMessage subscription, sends chat events,
 * and asserts the commands that come back are the ones that would reach the
 * add-on.
 *
 *   node test-ws.mjs
 */
import { WebSocket } from "ws";
import { start, stripTrigger, sanitiseForCommand, handlePlayerMessage } from "./minecraft-ws.js";

let passed = 0, failed = 0;
const check = (name, cond, detail) => {
  if (cond) { passed++; console.log(`  \x1b[32mpass\x1b[0m  ${name}`); }
  else { failed++; console.log(`  \x1b[31mFAIL\x1b[0m  ${name}${detail ? ` - ${detail}` : ""}`); }
};

console.log("\nAttention word");
check("ai! is recognised", stripTrigger("ai! go mine wood") === "go mine wood");
check("!ai still works", stripTrigger("!ai spawn 4") === "spawn 4");
check("hey ai works", stripTrigger("hey ai, follow me") === "follow me");
check("ordinary chat is ignored", stripTrigger("nice base you built") === null);
check("'aim for the hill' is not swallowed", stripTrigger("aim for the hill") === null,
  JSON.stringify(stripTrigger("aim for the hill")));

console.log("\nCommand safety");
check("quotes are stripped", !sanitiseForCommand('say "hello"').includes('"'));
check("backslashes are stripped", !sanitiseForCommand("a\\b").includes("\\"));
check("newlines collapse", !sanitiseForCommand("a\nb").includes("\n"));
check("length is capped", sanitiseForCommand("x".repeat(500)).length <= 220);

console.log("\nRouting without an API key (keyword fallback)");
{
  const sent = [];
  const send = (frame) => sent.push(JSON.parse(frame).body.commandLine);

  await handlePlayerMessage({ message: "ai! go mine some wood", sender: "Jordan" }, send, { claude: false });
  check(`"go mine some wood" becomes a chop order (${sent[0]})`,
    /scriptevent ai:tell .*chop wood/.test(sent[0]), sent[0]);

  sent.length = 0;
  await handlePlayerMessage({ message: "ai! we need iron", sender: "Jordan" }, send, { claude: false });
  check(`"we need iron" becomes a mine order (${sent[0]})`,
    /mine iron/.test(sent[0]), sent[0]);

  sent.length = 0;
  const ignored = await handlePlayerMessage({ message: "just building a wall", sender: "Jordan" }, send, { claude: false });
  check("unaddressed chat is left alone", ignored.handled === false && sent.length === 0);

  sent.length = 0;
  await handlePlayerMessage({ message: "ai! tell me about the weather", sender: "Jordan" }, send, { claude: false });
  check("an unmatched sentence is still passed to the add-on",
    /scriptevent ai:tell .*weather/.test(sent[0]), sent[0]);
}

console.log("\nRouting with a stubbed Claude");
{
  const sent = [];
  const send = (frame) => sent.push(JSON.parse(frame).body.commandLine);
  const stub = async () => ({
    messages: {
      create: async () => ({
        stop_reason: "end_turn",
        usage: {},
        content: [{
          type: "text",
          text: JSON.stringify({
            say: 'Aye - there\'s oak just past the ridge.',
            instruction: "chop wood",
            addressee: "Ada",
          }),
        }],
      }),
    },
  });

  const res = await handlePlayerMessage(
    { message: "ai! Ada, we could use some timber", sender: "Jordan" },
    send, { claude: true, getClient: stub });

  check("Claude's instruction is sent to the add-on",
    sent.some((c) => /scriptevent ai:tell @Ada chop wood/.test(c)), sent.join(" | "));
  check("Claude's reply is spoken by a citizen",
    sent.some((c) => /scriptevent ai:voice .*oak just past the ridge/.test(c)), sent.join(" | "));
  check("the apostrophe survived, the quotes did not",
    sent.every((c) => !c.includes('"')), sent.join(" | "));
  check("a plan came back", Boolean(res.plan));
}

console.log("\nLive socket");
{
  const wss = start({ port: 19191, host: "127.0.0.1", quiet: true });
  await new Promise((r) => setTimeout(r, 300));

  const frames = [];
  const ws = new WebSocket("ws://127.0.0.1:19191");
  // Attach before the socket opens: the bridge subscribes the instant it sees a
  // connection, exactly as it must for the real game, so a listener added after
  // "open" would miss that first frame.
  ws.on("message", (raw) => frames.push(JSON.parse(raw.toString())));
  await new Promise((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
    setTimeout(() => reject(new Error("timed out connecting")), 3000);
  });
  await new Promise((r) => setTimeout(r, 300));

  const sub = frames.find((f) => f.header.messagePurpose === "subscribe");
  check("the bridge subscribes to PlayerMessage",
    Boolean(sub) && sub.body.eventName === "PlayerMessage",
    JSON.stringify(frames.map((f) => f.header.messagePurpose)));

  frames.length = 0;
  ws.send(JSON.stringify({
    header: { messagePurpose: "event", eventName: "PlayerMessage", version: 1 },
    body: { message: "ai! go chop some wood", sender: "Jordan", type: "chat" },
  }));
  await new Promise((r) => setTimeout(r, 400));

  const cmd = frames.find((f) => f.header.messagePurpose === "commandRequest");
  check("a chat message produces a command back into the game",
    Boolean(cmd) && /scriptevent ai:tell/.test(cmd.body.commandLine),
    JSON.stringify(frames.map((f) => f.body?.commandLine)));

  frames.length = 0;
  ws.send(JSON.stringify({
    header: { messagePurpose: "event", eventName: "PlayerMessage", version: 1 },
    body: { message: "ai! hello", sender: "Bridge", type: "say" },
  }));
  await new Promise((r) => setTimeout(r, 250));
  check("non-chat message types are ignored (no feedback loop)", frames.length === 0,
    JSON.stringify(frames.map((f) => f.body?.commandLine)));

  ws.close();
  wss.close();
}

console.log(`\n${"=".repeat(46)}`);
if (failed) { console.log(`\x1b[31m${failed} failed\x1b[0m, ${passed} passed\n`); process.exit(1); }
console.log(`\x1b[32mAll ${passed} checks passed\x1b[0m\n`);
process.exit(0);
