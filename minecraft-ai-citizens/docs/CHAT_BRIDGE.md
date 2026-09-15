# The chat bridge — actual Claude, on a normal Minecraft

This is the setup where the citizens are genuinely driven by Claude and you
control them by typing in chat. It needs a computer running a small program
alongside the game. It does **not** need a dedicated server.

## Why this exists

The add-on's scripts cannot read your chat and cannot reach the internet. Both
are Minecraft restrictions, not choices:

- reading chat needs a pre-release script API that is tied to specific game
  versions;
- making a network request needs `@minecraft/server-net`, which only exists on
  a Bedrock Dedicated Server.

But Minecraft itself has a command — `/connect` — that opens a WebSocket from
the game to a program on your machine. That program *can* read your chat and
*can* call Claude. So the loop goes outside and comes back:

```
you type in chat  ->  Minecraft  ->  bridge  ->  Claude
                                         |
   citizens act  <-  /scriptevent  <-----+
```

## What you need

- A computer that can run [Node.js](https://nodejs.org) 20+ (Windows, macOS or
  Linux) on the same machine or network as the game.
- Cheats enabled on the world — `/connect` and `/scriptevent` both require it.
- `/connect` available on your platform. It is present on Windows; on phones
  and consoles it may not be. If the command does not exist, this setup is not
  possible there and the add-on falls back to `/ai:tell`.
- An Anthropic API key, if you want Claude rather than keyword matching.

## Setup

```bash
cd bridge
npm install
ANTHROPIC_API_KEY=sk-ant-... npm run ws
```

It prints the address it is listening on. Then, in Minecraft:

```
/connect localhost:19131
```

Minecraft says "Connection established". Now just type:

```
ai! go mine some wood
ai! we need iron for the walls
ai! Ada, follow me
ai! what are you all working on?
```

No API key? `npm run ws` still works and falls back to keyword matching — chat
control works, it just is not clever about it.

## What Claude actually does here

For each thing you say, Claude returns two things:

- **what the citizen says back**, in their own voice, which appears as a caption
  above whoever is nearest;
- **an instruction**, in the vocabulary the add-on understands, which the
  citizens then carry out.

So the *understanding* and the *dialogue* are Claude. What a citizen does
minute to minute once told — pathing, mining, choosing where a house goes — is
the add-on's own logic. See the honesty section in the README.

## Checking it

```bash
cd bridge
node test-ws.mjs
```

That pretends to be Minecraft: it connects, checks the bridge subscribes to
chat, sends a chat message, and asserts the right command comes back. It covers
the protocol and the routing, but it cannot prove the real game behaves the same
— nothing here can.

Once connected, the bridge logs every message it handles:

```
[19:04:11] Minecraft connected from 127.0.0.1
[19:04:26] Jordan: "ai! go mine some wood" -> chop wood
   reply: "Right you are. There's oak past the ridge."
```

If you see the connection but no lines when you type, the message is not being
recognised as addressed to the citizens — start it with `ai!`.

## Options

| Environment variable | Default | |
|---|---|---|
| `WS_PORT` | `19131` | Port `/connect` should use |
| `WS_HOST` | `0.0.0.0` | Set to `127.0.0.1` to refuse other machines |
| `ANTHROPIC_API_KEY` | — | Without it, keyword matching |
| `CLAUDE_MODEL` | `claude-opus-5` | |
| `EFFORT_CHAT` | `medium` | How hard Claude thinks per message |

## Safety

The bridge only acts on messages that begin with the attention word, only
reacts to real chat (never to `/say` or its own output, which would loop), and
strips quotes, backslashes and newlines before anything reaches a command line.
Whatever Claude returns is then re-validated inside the add-on before it can
touch the world.
