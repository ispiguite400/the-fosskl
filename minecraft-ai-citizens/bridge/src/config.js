/** Environment configuration, read once at startup. */
import fs from "node:fs";
import path from "node:path";

// A .env next to the bridge is loaded if present, so nobody has to fight
// with shell exports just to try this out.
function loadDotEnv() {
  const file = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    const value = m[2].replace(/^["']|["']$/g, "");
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
loadDotEnv();

const num = (key, fallback) => {
  const v = Number(process.env[key]);
  return Number.isFinite(v) ? v : fallback;
};
const bool = (key, fallback) => {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  return /^(1|true|yes|on)$/i.test(v);
};

export const CONFIG = {
  port: num("PORT", 8787),
  host: process.env.HOST || "127.0.0.1",
  token: process.env.AI_CITIZENS_TOKEN || "",

  model: process.env.CLAUDE_MODEL || "claude-opus-5",
  effort: {
    tick: process.env.EFFORT_TICK || "low",
    chat: process.env.EFFORT_CHAT || "medium",
    converse: process.env.EFFORT_CONVERSE || "low",
    group: process.env.EFFORT_GROUP || "medium",
  },

  maxTokens: num("MAX_TOKENS", 8000),
  maxConcurrent: num("MAX_CONCURRENT", 6),
  timeoutMs: num("REQUEST_TIMEOUT_MS", 20000),
  dailyTokenBudget: num("DAILY_TOKEN_BUDGET", 0),
  logDecisions: bool("LOG_DECISIONS", false),
  dryRun: bool("DRY_RUN", false),

  historyTurns: num("HISTORY_TURNS", 6),
  historyTtlMs: num("HISTORY_TTL_MS", 15 * 60 * 1000),
};

export function assertConfigured() {
  if (CONFIG.dryRun) {
    console.warn("[bridge] DRY_RUN is on - canned replies, no API calls, no cost.");
    return;
  }
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  if (!hasKey) {
    console.error(
      "\nNo Anthropic credentials found.\n" +
      "  Set ANTHROPIC_API_KEY in bridge/.env, export it in your shell,\n" +
      "  or run `ant auth login` - the SDK picks up that profile automatically.\n",
    );
    process.exit(1);
  }
}
