/**
 * Real slash commands.
 *
 * `world.beforeEvents.chatSend` - the only way to read what a player types in
 * chat - is a pre-release API. A pack that declares the stable
 * `@minecraft/server` does not have it, and subscribing throws. So chat is an
 * *enhancement*, and this is the path that always works:
 *
 *     /ai:cmd spawn 6              anything the !ai commands accept
 *     /ai:tell @Ada go mine iron   anything you would have said in chat
 *     /ai:spawn 6 miner            the common case, with autocomplete
 *
 * Registration must happen during `system.beforeEvents.startup`, which fires
 * before the world exists - so the callbacks defer every world touch to
 * `system.run`.
 *
 * Enum values are written as string literals rather than imported from
 * `@minecraft/server`: a named import that an older runtime does not export is
 * a link error that kills the entire script module, and there is no catching it.
 */
import { system, world } from "@minecraft/server";
import { safe, reportError, tell } from "../core/log.js";
import { classify } from "./parser.js";

const PARAM_STRING = "String";
const PARAM_INT = "Integer";
const PERMISSION_ANY = 0;         // CommandPermissionLevel.Any
const STATUS_SUCCESS = 0;         // CustomCommandStatus.Success
const STATUS_FAILURE = 1;         // CustomCommandStatus.Failure

/** Words are separate parameters so a player can type a sentence unquoted. */
function wordParams(count, prefix = "word") {
  return Array.from({ length: count }, (_, i) => ({
    name: `${prefix}${i + 1}`,
    type: PARAM_STRING,
  }));
}

/**
 * Subscribe at module load - startup has already fired by the time anything
 * deferred runs.
 * @returns {{subscribed: boolean, registered: string[], error: string}}
 */
export function registerSlashCommands(app) {
  const status = { subscribed: false, registered: [], error: "" };

  const startup = safe("slash.signal", () => system.beforeEvents?.startup, null);
  if (!startup || typeof startup.subscribe !== "function") {
    status.error = "system.beforeEvents.startup is unavailable";
    return status;
  }

  try {
    startup.subscribe((event) => {
      const registry = event.customCommandRegistry;
      if (!registry || typeof registry.registerCommand !== "function") {
        status.error = "customCommandRegistry is unavailable";
        return;
      }

      register(registry, status, {
        name: "ai:cmd",
        description: "Run an AI Citizens command, e.g. /ai:cmd spawn 6",
        permissionLevel: PERMISSION_ANY,
        cheatsRequired: false,
        mandatoryParameters: [{ name: "command", type: PARAM_STRING }],
        optionalParameters: wordParams(7),
      }, (origin, args) => runCommandText(app, origin, args.filter(isWord).join(" ")));

      register(registry, status, {
        name: "ai:tell",
        description: "Say something to the citizens, e.g. /ai:tell @Ada go mine iron",
        permissionLevel: PERMISSION_ANY,
        cheatsRequired: false,
        mandatoryParameters: [{ name: "message", type: PARAM_STRING }],
        optionalParameters: wordParams(11),
      }, (origin, args) => speakText(app, origin, args.filter(isWord).join(" ")));

      register(registry, status, {
        name: "ai:spawn",
        description: "Spawn citizens where you stand",
        permissionLevel: PERMISSION_ANY,
        cheatsRequired: false,
        optionalParameters: [
          { name: "count", type: PARAM_INT },
          { name: "role", type: PARAM_STRING },
        ],
      }, (origin, args) => {
        const count = Number.isFinite(args[0]) ? args[0] : 1;
        const role = isWord(args[1]) ? args[1] : "";
        return runCommandText(app, origin, `spawn ${count} ${role}`.trim());
      });

      register(registry, status, {
        name: "ai:panel",
        description: "Open the AI Citizens control panel",
        permissionLevel: PERMISSION_ANY,
        cheatsRequired: false,
      }, (origin) => runCommandText(app, origin, "panel"));

      register(registry, status, {
        name: "ai:doctor",
        description: "Report what the add-on can and cannot do on this world",
        permissionLevel: PERMISSION_ANY,
        cheatsRequired: false,
      }, (origin) => runCommandText(app, origin, "doctor"));
    });
    status.subscribed = true;
  } catch (e) {
    status.error = String(e?.message || e).slice(0, 140);
    reportError("slash.subscribe", e);
  }
  return status;
}

function register(registry, status, definition, handler) {
  try {
    registry.registerCommand(definition, (origin, ...rest) => {
      // The signature has varied between releases: sometimes (origin, args),
      // sometimes (origin, ...args). Normalise both into one array.
      const args = rest.length === 1 && Array.isArray(rest[0]) ? rest[0] : rest;
      try {
        return handler(origin, args) || { status: STATUS_SUCCESS };
      } catch (e) {
        reportError(`slash:${definition.name}`, e);
        return { status: STATUS_FAILURE, message: String(e?.message || e).slice(0, 100) };
      }
    });
    status.registered.push("/" + definition.name);
  } catch (e) {
    status.error = `${definition.name}: ${String(e?.message || e).slice(0, 100)}`;
    reportError(`slash.register:${definition.name}`, e);
  }
}

function isWord(v) {
  return typeof v === "string" && v.length > 0;
}

function playerOf(origin) {
  const entity = origin?.sourceEntity;
  if (entity && entity.typeId === "minecraft:player") return entity;
  return null;
}

function runCommandText(app, origin, text) {
  const player = playerOf(origin);
  if (!player) return { status: STATUS_FAILURE, message: "run this as a player" };
  // Command callbacks run in a read-only context; defer anything that touches
  // the world by a tick.
  system.run(() => app.handleCommandText(player, text));
  return { status: STATUS_SUCCESS };
}

function speakText(app, origin, text) {
  const player = playerOf(origin);
  if (!player) return { status: STATUS_FAILURE, message: "run this as a player" };
  system.run(() => app.handleSpeech(player, text));
  return { status: STATUS_SUCCESS };
}

/**
 * `/scriptevent` works on every version with no beta modules at all, so it is
 * the last-resort control path:
 *
 *     /scriptevent ai:cmd spawn 6
 *     /scriptevent ai:tell @Ada follow me
 */
export function registerScriptEvents(app) {
  const signal = safe("scriptevent.signal", () => system.afterEvents?.scriptEventReceive, null);
  if (!signal || typeof signal.subscribe !== "function") return false;

  return safe("scriptevent.subscribe", () => {
    signal.subscribe((event) => {
      const id = String(event.id || "").toLowerCase();
      if (!id.startsWith("ai:")) return;
      const player = event.sourceEntity && event.sourceEntity.typeId === "minecraft:player"
        ? event.sourceEntity
        : world.getAllPlayers()[0];
      if (!player) return;
      const message = String(event.message || "");
      system.run(() => {
        if (id === "ai:tell") app.handleSpeech(player, message);
        else app.handleCommandText(player, message);
      });
    }, { namespaces: ["ai"] });
    return true;
  }, false);
}
