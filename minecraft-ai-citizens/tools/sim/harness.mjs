/** Stages the behaviour pack next to the mock engine and loads it. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "..", "..");
const BP = path.join(ROOT, "packs", "AI_Citizens_BP");

export async function bootSim() {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "ai-citizens-"));
  fs.cpSync(path.join(BP, "scripts"), path.join(stage, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(stage, "package.json"), JSON.stringify({ type: "module" }));

  for (const [name, src] of [
    ["@minecraft/server", path.join(here, "mock-server.js")],
    ["@minecraft/server-ui", path.join(here, "mock-ui.js")],
  ]) {
    const dir = path.join(stage, "node_modules", name);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(src, path.join(dir, "index.js"));
    fs.writeFileSync(path.join(dir, "package.json"),
      JSON.stringify({ name, version: "1.0.0", type: "module", main: "index.js" }));
  }

  const mock = await import(path.join(stage, "node_modules", "@minecraft", "server", "index.js"));
  const ui = await import(path.join(stage, "node_modules", "@minecraft", "server-ui", "index.js"));
  const load = (rel) => import(path.join(stage, "scripts", rel));

  return {
    mock,
    ui,
    stage,
    load,
    /**
     * Loads the pack the way the game does: the script module is imported,
     * which is when it subscribes to startup, then startup fires, then ticks
     * begin.
     */
    async start() {
      await load("main.js");
      mock.fireStartup();
      mock.advance(60);
    },
    /** Reproduce a stable runtime, where chatSend does not exist. */
    stableRuntime() { mock.setChatApiAvailable(false); },
    debug: () => (globalThis.aiCitizensDebug ? globalThis.aiCitizensDebug() : null),
    cleanup() { fs.rmSync(stage, { recursive: true, force: true }); },
  };
}
