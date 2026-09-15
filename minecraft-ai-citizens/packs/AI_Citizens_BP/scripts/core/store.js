/**
 * JSON persistence on top of dynamic properties.
 *
 * A single dynamic property can only hold a bounded string, so larger blobs are
 * split across `<key>#0`, `<key>#1`, ... with the chunk count in `<key>#n`.
 */
import { world } from "@minecraft/server";
import { reportError } from "./log.js";

const CHUNK = 20000;

export function saveJson(holder, key, value) {
  try {
    const text = JSON.stringify(value);
    const chunks = Math.ceil(text.length / CHUNK) || 1;
    const previous = holder.getDynamicProperty(`${key}#n`);
    holder.setDynamicProperty(`${key}#n`, chunks);
    for (let i = 0; i < chunks; i++) {
      holder.setDynamicProperty(`${key}#${i}`, text.slice(i * CHUNK, (i + 1) * CHUNK));
    }
    // clear any chunks left behind by a previously larger value
    if (typeof previous === "number") {
      for (let i = chunks; i < previous; i++) {
        holder.setDynamicProperty(`${key}#${i}`, undefined);
      }
    }
    return true;
  } catch (e) {
    reportError(`saveJson(${key})`, e);
    return false;
  }
}

export function loadJson(holder, key, fallback) {
  try {
    const chunks = holder.getDynamicProperty(`${key}#n`);
    if (typeof chunks !== "number" || chunks <= 0) return fallback;
    let text = "";
    for (let i = 0; i < chunks; i++) {
      const part = holder.getDynamicProperty(`${key}#${i}`);
      if (typeof part !== "string") return fallback;
      text += part;
    }
    return JSON.parse(text);
  } catch (e) {
    reportError(`loadJson(${key})`, e);
    return fallback;
  }
}

export function clearJson(holder, key) {
  try {
    const chunks = holder.getDynamicProperty(`${key}#n`);
    if (typeof chunks === "number") {
      for (let i = 0; i < chunks; i++) holder.setDynamicProperty(`${key}#${i}`, undefined);
    }
    holder.setDynamicProperty(`${key}#n`, undefined);
  } catch (e) {
    reportError(`clearJson(${key})`, e);
  }
}

export const worldStore = {
  save: (key, value) => saveJson(world, key, value),
  load: (key, fallback) => loadJson(world, key, fallback),
  clear: (key) => clearJson(world, key),
};
