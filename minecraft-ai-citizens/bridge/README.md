# AI Citizens bridge

Sits between a Bedrock Dedicated Server and the Claude API. The add-on POSTs
what a citizen can see; this answers with what they say and do.

Deliberately boring: no framework, no database, one dependency. If it stops,
citizens fall back to their local brain and the world keeps running — the
failure mode is "less clever", never "frozen".

## Run it

```bash
npm install
ANTHROPIC_API_KEY=sk-ant-... npm start
```

Then in game: `!ai bridge http://127.0.0.1:8787` and `!ai brain claude`.

No key? `ant auth login` works too — the SDK picks up that profile.

## Try it without spending anything

```bash
DRY_RUN=true npm start     # canned replies, no API calls
node test-bridge.mjs       # sends a real add-on packet and prints the reply
```

## Configuration

Copy `.env.example` to `.env`. The ones that matter:

| | Default | |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Required unless `DRY_RUN` |
| `PORT` / `HOST` | `8787` / `127.0.0.1` | Loopback by default |
| `AI_CITIZENS_TOKEN` | — | Shared secret, if you expose the bridge |
| `CLAUDE_MODEL` | `claude-opus-5` | The most capable model |
| `EFFORT_TICK` | `low` | Routine thinking — constant, so kept cheap |
| `EFFORT_CHAT` | `medium` | Answering a player — where quality shows |
| `MAX_CONCURRENT` | `6` | In-flight cap |
| `DAILY_TOKEN_BUDGET` | `0` | Hard stop; `0` is unlimited |
| `LOG_DECISIONS` | `false` | Print every reply — noisy, good for tuning |
| `DRY_RUN` | `false` | Canned replies, no API calls |

## Endpoints

| | |
|---|---|
| `POST /think` | Context packet in, decision out |
| `GET /health` | Liveness, model, uptime |
| `GET /stats` | Requests, failures, refusals, tokens, cache hit rate |
| `POST /forget` | `{"citizenId":"..."}` — drop one transcript |

## How it is put together

| | |
|---|---|
| `server.js` | HTTP, auth, admission control, logging |
| `src/config.js` | Environment, with a `.env` loader |
| `src/prompts.js` | The system prompt (byte-stable, cached) and the user turn |
| `src/schema.js` | The decision schema for structured outputs |
| `src/anthropic.js` | The call: caching, timeouts, graceful degradation |
| `src/memory.js` | A short rolling transcript per citizen, TTL-expired |

The system prompt never mentions the time or the citizen, so every citizen in a
town shares one cached prefix. `/stats` reports the hit rate — if it is near
zero, something volatile has crept in.

Structured outputs mean a malformed decision cannot come back. The add-on
re-validates everything anyway (`scripts/brain/schema.js`), so this is the first
of two gates, not the only one.

If a parameter is rejected — an older deployment, a proxy, a cloud provider that
has not caught up — the bridge drops it once, says so, and carries on.
