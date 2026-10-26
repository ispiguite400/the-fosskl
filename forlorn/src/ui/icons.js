/* Line-free, filled 24×24 icons for the UI chrome (abilities keep their own emoji). */
const P = {
  skull: 'M12 2C7 2 3.5 5.6 3.5 10.2c0 2.6 1.2 4.6 3 5.9V19a1 1 0 0 0 1 1H9v2h2v-2h2v2h2v-2h1.5a1 1 0 0 0 1-1v-2.9c1.8-1.3 3-3.3 3-5.9C20.5 5.6 17 2 12 2zM8.5 14a2.2 2.2 0 1 1 0-4.4 2.2 2.2 0 0 1 0 4.4zm7 0a2.2 2.2 0 1 1 0-4.4 2.2 2.2 0 0 1 0 4.4z',
  heart: 'M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.6 1.1 4.3 2.4.7-1.3 2.2-2.4 4.3-2.4 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z',
  bolt: 'M13.5 2 4 14h6.5L9.5 22 20 9.5h-6.6z',
  wrench: 'M21.7 6.3a5.6 5.6 0 0 1-7.6 6.4L6.4 20.4a2.1 2.1 0 0 1-3-3l7.7-7.7a5.6 5.6 0 0 1 6.4-7.6l-3.4 3.4.6 3 3 .6z',
  eye: 'M12 5C6.5 5 2.7 9.4 1.5 12c1.2 2.6 5 7 10.5 7s9.3-4.4 10.5-7C21.3 9.4 17.5 5 12 5zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm0-6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  door: 'M4 3h12v18H4zm2.2 2.2v13.6h7.6V5.2zM11.8 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM18 6h2.5v15H18z',
  person: 'M12 12a4.6 4.6 0 1 0 0-9.2 4.6 4.6 0 0 0 0 9.2zm0 2.1c-4.6 0-8.2 2.3-8.2 5.2V21h16.4v-1.7c0-2.9-3.6-5.2-8.2-5.2z',
  people: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM9 13c-3.9 0-7 1.9-7 4.5V20h14v-2.5C16 14.9 12.9 13 9 13zm8 0c-.6 0-1.1 0-1.6.1 1.6 1.1 2.6 2.6 2.6 4.4V20h5v-2.5c0-2.6-2.7-4.5-6-4.5z',
  knife: 'M2.6 21.4 11 13l2.3 2.3-8.4 8.4zM12.3 11.7 21.4 2.6c1.3 4.1-.1 8.6-3.9 11.6l-2.6 2z',
  coin: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15.9V19h-2v-1.1c-1.7-.3-3-1.4-3.1-3.1h2c.1.9.8 1.5 2.1 1.5 1.4 0 1.9-.7 1.9-1.2 0-.7-.4-1.2-2.2-1.6-2-.5-3.3-1.3-3.3-3 0-1.4 1.1-2.4 2.6-2.7V6.7h2v1.1c1.6.4 2.4 1.6 2.4 2.9h-2c0-.9-.5-1.5-1.8-1.5-1.1 0-1.8.5-1.8 1.2 0 .6.5 1 2.1 1.4 1.7.4 3.4 1.1 3.4 3.1 0 1.5-1.1 2.6-2.8 2.9z',
  gear: 'M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3h-4l-.4 2.9a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.5 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1c.5.4 1.1.7 1.7 1L11 21h4l.4-2.9c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.5zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z',
  bag: 'M7 7V6a5 5 0 0 1 10 0v1h3.2l-1.4 15H5.2L3.8 7zm2 0h6V6a3 3 0 0 0-6 0z',
  book: 'M3 4h6.5A3.5 3.5 0 0 1 13 7.5V21a2.8 2.8 0 0 0-2.8-2.5H3zm18 0h-6.5a3.4 3.4 0 0 0-.5 0V21a2.8 2.8 0 0 1 2.8-2.5H21z',
  star: 'M12 2.5l2.9 6.4 7 .7-5.3 4.7 1.5 6.9L12 17.6l-6.1 3.6 1.5-6.9L2.1 9.6l7-.7z',
  note: 'M20 3v12.5a3.5 3.5 0 1 1-2-3.2V7.1l-8 1.6v8.8a3.5 3.5 0 1 1-2-3.2V5z',
  check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z',
  lock: 'M17 9V7A5 5 0 0 0 7 7v2H5v13h14V9zM9 7a3 3 0 0 1 6 0v2H9z',
  back: 'M15.4 4.6 8 12l7.4 7.4-1.8 1.8L4.4 12l9.2-9.2z',
  play: 'M7 4v16l13-8z',
  stun: 'M12 2l1.8 4.2L18 4.6l-1.6 4.2L21 10.6l-4.2 1.8L18 17l-4.2-1.6L12 20l-1.8-4.6L6 17l1.6-4.6L3 10.6l4.6-1.8L6 4.6l4.2 1.6z',
  pulse: 'M2 13h4.2l2.3-6 4.2 12 2.6-7.5L16.6 13H22v-2h-4l-2.4-3.6-2.4 7-4.2-12L5 11H2z',
  menu: 'M3 5h18v2.4H3zm0 5.8h18v2.4H3zm0 5.8h18V19H3z',
  chat: 'M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
  flag: 'M5 2h2v20H5zm3 1h11l-2.5 4.5L19 12H8z',
  drop: 'M12 2s7 7.7 7 12.3A7 7 0 0 1 5 14.3C5 9.7 12 2 12 2z',
  map: 'M9 3 3 5.5V21l6-2.5 6 2.5 6-2.5V3l-6 2.5zm0 2.2 6 2.5v11.1l-6-2.5z'
};
/** An inline SVG icon that takes the text colour. */
export function icon(name, cls = '') {
  const d = P[name]; if (!d) return '';
  return '<svg class="ico ' + cls + '" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="' + d + '"/></svg>';
}

/* Ability and item icons: white line drawings on dark tiles, the way asym games draw them. */
const A = {
  shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.3 7.5 9.5 4.3-1.2 7.5-4.9 7.5-9.5V6z"/>',
  shieldbash: '<path d="M14 4 8 6.5v4.5c0 3.8 2.6 6.9 6 7.9 3.4-1 6-4.1 6-7.9V6.5z"/><path d="M2 9h3.5M2 13h3.5M3 17h2.5"/>',
  grenade: '<circle cx="11" cy="14.5" r="6"/><path d="M9 8.6V6h4v2.6M13 6.5c1.8-1.8 4.2-1.8 5.6 0"/><circle cx="19.5" cy="8" r="1.5"/>',
  crate: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>',
  medkit: '<rect x="3" y="6.5" width="18" height="13.5" rx="2"/><path d="M9 6.5V4h6v2.5M12 10v6.5M8.8 13.2h6.4"/>',
  megaphone: '<path d="M3 10v4h3l8 5V5L6 10z"/><path d="M17.5 9a4 4 0 0 1 0 6M20 6.5a8 8 0 0 1 0 11"/>',
  breakout: '<path d="M4 3v18M8 3v6.5M8 14.5V21M12 3v18"/><path d="M15 12h6.5M18.5 9l3 3-3 3"/>',
  cloud: '<path d="M7 18a4 4 0 0 1-.5-8 5.5 5.5 0 0 1 10.6-1.4A4.5 4.5 0 1 1 17.5 18z"/>',
  chevrons: '<path d="M5 10l7-5 7 5M5 15l7-5 7 5M5 20l7-5 7 5"/>',
  pistol: '<path d="M3 7h16v4h-7l-1.5 2.5H9L7.5 19h-4L5 11H3z"/><path d="M12 11v2.5"/>',
  shotgun: '<path d="M2 9h18l2 1.5V12H11l-2 2.5H7L5.5 19H2l1.5-6.5H2z"/>',
  eyeoff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A9.6 9.6 0 0 1 12 5c5 0 8.5 4 9.5 7a13 13 0 0 1-2.4 3.6M6.4 6.4C4.3 7.8 3 9.9 2.5 12c1 3 4.5 7 9.5 7a9.6 9.6 0 0 0 4.7-1.2"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  eye: '<path d="M2.5 12C3.5 9 7 5 12 5s8.5 4 9.5 7c-1 3-4.5 7-9.5 7s-8.5-4-9.5-7z"/><circle cx="12" cy="12" r="3"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  dash: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/><path d="M2 6h3M1 10h2"/>',
  flashlight: '<rect x="2.5" y="9" width="10" height="6" rx="1"/><path d="M12.5 9l5-3v12l-5-3"/><path d="M20 8.5l2.2-1.2M20 15.5l2.2 1.2M20.2 12h2.3"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 9.5v.01M18 14.5v.01"/>',
  medal: '<circle cx="12" cy="15" r="6"/><path d="M8.5 3 11 9.2M15.5 3 13 9.2"/><path d="M12 12.4l.9 1.8 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3z"/>',
  hand: '<path d="M7 11V5.5a1.5 1.5 0 0 1 3 0V10M10 9.5v-6a1.5 1.5 0 0 1 3 0V10M13 9.5V5a1.5 1.5 0 0 1 3 0v6M16 9a1.5 1.5 0 0 1 3 0v5a7 7 0 0 1-7 7h-1a7 7 0 0 1-5.5-2.7L3 14.5a1.6 1.6 0 0 1 2.5-2L7 14"/>',
  hexshield: '<path d="M12 2.5 20.5 7.5v9L12 21.5 3.5 16.5v-9z"/><path d="M12 7l4.5 2.5v5L12 17l-4.5-2.5v-5z"/>',
  mask: '<path d="M3 6c3 1 6 1 9 0s6-1 9 0v5c0 5-4 8-9 8s-9-3-9-8z"/><path d="M7 11c1-1 2.5-1 3.5 0M13.5 11c1-1 2.5-1 3.5 0M9 15.5c2 1 4 1 6 0"/>',
  trap: '<path d="M3 16h18M8 20h8"/><path d="M4 16l2-6 2 6 2-6 2 6 2-6 2 6 2-6 2 6"/>',
  flame: '<path d="M12 2.5c1 3.5 5.5 5.5 5.5 10.5a5.5 5.5 0 0 1-11 0c0-2.4 1.2-4 2.5-5 .3 1.7 1 2.6 2 3 0-3 0-5.5 1-8.5z"/>',
  lift: '<path d="M12 20V5.5M7 10.5l5-5 5 5"/><path d="M4 21h4M16 21h4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z"/>',
  radio: '<rect x="4" y="8" width="16" height="13" rx="2"/><path d="M8 8l9-5M8 13h8M8 17h3"/><circle cx="15.5" cy="16.5" r="1.5"/>',
  question: '<path d="M4 4h16v12H9l-5 4z"/><path d="M10 8.5a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.2M12 13.5v.01"/>',
  slashes: '<path d="M5 19 19 5M9.5 21 21 9.5M3 14.5 14.5 3"/>',
  swords: '<path d="M4 4l10 10M20 4 10 14"/><path d="M7 15l2 2M17 15l-2 2M6.5 19.5 4.5 21.5M17.5 19.5l2 2"/>',
  skull: '<path d="M12 3a7 7 0 0 0-7 7c0 2.4 1.2 4 3 5v3.5h8V15c1.8-1 3-2.6 3-5a7 7 0 0 0-7-7z"/><circle cx="9.5" cy="10.5" r="1.4"/><circle cx="14.5" cy="10.5" r="1.4"/><path d="M10.5 18.5V21M13.5 18.5V21"/>',
  spiral: '<path d="M12 12a1.5 1.5 0 0 1 1.5 1.5 3 3 0 0 1-3 3A4.5 4.5 0 0 1 6 12a6 6 0 0 1 6-6 7.5 7.5 0 0 1 7.5 7.5"/>',
  portal: '<ellipse cx="12" cy="12" rx="6" ry="9"/><ellipse cx="12" cy="12" rx="2.5" ry="5"/>',
  bottle: '<path d="M10 2h4v3l1.5 3v12a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2V8L10 5z"/><path d="M8.5 12.5h7"/>',
  knife: '<path d="M14 3.5c3.6 0 6.5 2.9 6.5 6.5L12 18.5 5.5 12z"/><path d="M8.5 15.5 3.5 20.5"/>',
  claw: '<path d="M6 21c2-6 2-12-1-17M11 21c1.5-6 1.5-12-1.5-17M16 21c1-6 1-11-2-16"/>',
  ghost: '<path d="M5 21V10a7 7 0 0 1 14 0v11l-2.3-2-2.4 2-2.3-2-2.3 2-2.4-2z"/><path d="M9.5 10v.01M14.5 10v.01"/>'
};
/** Which drawing each ability, item and attack uses. */
const AB = {
  block: 'shield', grenade: 'grenade', shieldbash: 'shieldbash', supply: 'crate', firstaid: 'medkit', rally: 'megaphone', breakout: 'breakout',
  smoke: 'cloud', warcry: 'chevrons', sidearm: 'pistol', hide: 'eyeoff', sixthsense: 'eye', burst: 'dash', flashlight: 'flashlight', makeitrain: 'cash',
  gold: 'medal', push: 'hand', shield: 'hexshield', disguise: 'mask', snare: 'trap', hellfire: 'flame', levitate: 'lift', vanish: 'moon', pistol: 'pistol',
  reinforce: 'radio', kgrenade: 'grenade', shotgun: 'shotgun', beartrap: 'trap', interrogate: 'question', dashslash: 'slashes', parry: 'swords',
  execute: 'skull', lightning: 'bolt', possess: 'spiral', limbo: 'portal', medkit: 'medkit', cola: 'bottle', m1: 'knife', echo: 'ghost'
};
/** An ability's icon as inline SVG (falls back to the given text, e.g. its emoji). */
export function abilityIcon(id, fallback = '') {
  const d = A[AB[id] || id];
  if (!d) return fallback;
  return '<svg class="aico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
}
