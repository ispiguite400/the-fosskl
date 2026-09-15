/**
 * Cooperative work spreading.
 *
 * Bedrock runs scripts on the server tick, so a long loop stalls the world.
 * `RoundRobin` hands out a slice of a collection each tick and `Budget` lets a
 * caller stop once it has done enough for this tick.
 */
export class RoundRobin {
  constructor(sliceSize) {
    this.sliceSize = sliceSize;
    this.cursor = 0;
  }

  /** Returns the next `sliceSize` items, wrapping around the list. */
  next(items) {
    const n = items.length;
    if (n === 0) return [];
    const take = Math.min(this.sliceSize, n);
    const out = [];
    for (let i = 0; i < take; i++) {
      out.push(items[(this.cursor + i) % n]);
    }
    this.cursor = (this.cursor + take) % n;
    return out;
  }
}

export class Budget {
  constructor(limit) {
    this.limit = limit;
    this.used = 0;
  }
  spend(n = 1) {
    this.used += n;
    return this.used <= this.limit;
  }
  get exhausted() {
    return this.used >= this.limit;
  }
  reset() {
    this.used = 0;
  }
}

/** Fires at most once every `ticks`, tracked per key. */
export class Throttle {
  constructor(ticks) {
    this.ticks = ticks;
    this.last = new Map();
  }
  ready(key, tick) {
    const prev = this.last.get(key);
    if (prev !== undefined && tick - prev < this.ticks) return false;
    this.last.set(key, tick);
    return true;
  }
  forget(key) {
    this.last.delete(key);
  }
}
