/* What the machine can do: touch, phone-class GPU, pointer lock. */

export const IS_TOUCH = (() => {
  const coarse = window.matchMedia?.('(pointer: coarse)')?.matches;
  return !!(coarse && (navigator.maxTouchPoints > 0 || 'ontouchstart' in window));
})();

export const IS_MOBILE = (() => {
  if (/Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(navigator.userAgent)) return true;
  if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return true;
  return IS_TOUCH && !window.matchMedia?.('(pointer: fine)')?.matches;
})();

export const IN_FRAME = (() => { try { return window.top !== window.self; } catch { return true; } })();

/** A sensible starting quality: phones get the light preset. */
export function defaultQuality() {
  if (IS_MOBILE) return 'low';
  const mem = navigator.deviceMemory || 8, cores = navigator.hardwareConcurrency || 8;
  return mem <= 4 || cores <= 4 ? 'medium' : 'high';
}
