#!/usr/bin/env node
/**
 * AI Citizens bridge.
 *
 * A tiny HTTP server that sits between a Bedrock Dedicated Server and the
 * Claude API. The add-on POSTs what a citizen can see; this answers with what
 * they say and do.
 *
 * It is deliberately boring: no framework, no database, no state worth losing.
 * If it stops, citizens fall back to their local brain and the world keeps
 * running - so the failure mode is "less clever", never "frozen".
 *
 *   npm install
 *   ANTHROPIC_API_KEY=sk-ant-... npm start
 *
 * Then in game:  !ai bridge http://127.0.0.1:8787
 */
import http from "node:http";
import { CONFIG, assertConfigured } from "./src/config.js";
import { decide, canAcceptRequest, usageReport } from "./src/anthropic.js";
import { sweep, stats as memoryStats, forget } from "./src/memory.js";

assertConfigured();

const MAX_BODY = 512 * 1024;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, { ok: true, model: CONFIG.model, uptime: process.uptime() });
  }
  if (req.method === "GET" && url.pathname === "/stats") {
    return json(res, 200, { ...usageReport(), memory: memoryStats() });
  }
  if (req.method === "POST" && url.pathname === "/forget") {
    const body = await readBody(req, res);
    if (body === null) return;
    if (body.citizenId) forget(body.citizenId);
    return json(res, 200, { ok: true });
  }
  if (req.method !== "POST" || url.pathname !== "/think") {
    return json(res, 404, { error: "not found" });
  }

  // --- auth -------------------------------------------------------------
  if (CONFIG.token) {
    const given = req.headers["x-ai-citizens-token"];
    if (given !== CONFIG.token) return json(res, 401, { error: "bad token" });
  }

  // --- admission control ------------------------------------------------
  const admit = canAcceptRequest();
  if (!admit.ok) return json(res, 503, { error: admit.reason });

  const packet = await readBody(req, res);
  if (packet === null) return;
  if (!packet || typeof packet !== "object" || !packet.citizen) {
    return json(res, 400, { error: "expected a citizen context packet" });
  }

  const started = Date.now();
  const result = await decide(packet);
  const ms = Date.now() - started;

  if (!result.ok) {
    log(`${packet.citizen.name} — ${result.reason} (${ms}ms)`);
    return json(res, 503, { error: result.reason });
  }

  if (CONFIG.logDecisions) {
    const d = result.decision;
    log(`${packet.citizen.name} (${packet.request}, ${ms}ms): ` +
        `${d.say ? `"${d.say}"` : "(silent)"} ` +
        `[${(d.actions || []).map((a) => a.do).join(", ") || "carry on"}]`);
  }
  return json(res, 200, result.decision);
});

// --------------------------------------------------------------------------
function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(text),
  });
  res.end(text);
}

function readBody(req, res) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        json(res, 413, { error: "body too large" });
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        json(res, 400, { error: "invalid JSON" });
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

function log(msg) {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`[${t}] ${msg}`);
}

setInterval(sweep, 60_000).unref();

server.listen(CONFIG.port, CONFIG.host, () => {
  console.log(`\nAI Citizens bridge`);
  console.log(`  listening   http://${CONFIG.host}:${CONFIG.port}`);
  console.log(`  model       ${CONFIG.model}`);
  console.log(`  effort      tick=${CONFIG.effort.tick} chat=${CONFIG.effort.chat} converse=${CONFIG.effort.converse}`);
  console.log(`  auth        ${CONFIG.token ? "shared token required" : "open (loopback only by default)"}`);
  console.log(`\nIn game:  !ai bridge http://${CONFIG.host}:${CONFIG.port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log("\nshutting down");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
