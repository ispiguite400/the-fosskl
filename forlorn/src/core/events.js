/* A tiny event bus: the match, bots, chat, audio and UI talk through it. */

const handlers = new Map();

export const bus = {
  on(name, fn) { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name).add(fn); return () => handlers.get(name).delete(fn); },
  emit(name, data) { const set = handlers.get(name); if (set) for (const fn of [...set]) { try { fn(data); } catch (e) { console.error('[bus ' + name + ']', e); } } },
  clear(name) { handlers.delete(name); }
};
