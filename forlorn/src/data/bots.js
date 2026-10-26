/*
 * The other players. Each bot is a person: a username, how good they are, how they play, how
 * they type, who they like. Some are the teammate you hope for, some are the one you dread.
 *
 *   makeBot(r)  -> a member: { name, persona, style, ... }
 *   say(bot, topic, vars)  -> a chat line in that bot's voice, or null
 */
import { R, weighted } from '../core/util.js';

const FIRST = ['shadow', 'dark', 'noob', 'pro', 'epic', 'xx', 'cool', 'bacon', 'guest', 'super', 'mega', 'lil', 'big', 'not', 'just', 'its', 'the', 'sir', 'captain', 'tiny', 'sweaty', 'lazy', 'crazy', 'silent', 'happy', 'sad', 'angry', 'night', 'ghost', 'pixel', 'frost', 'blox', 'robo', 'mr', 'miss', 'kawaii', 'toxic', 'ninja', 'pizza', 'taco', 'cookie', 'void', 'astral', 'red', 'blue'];
const SECOND = ['gamer', 'slayer', 'master', 'king', 'queen', 'boy', 'girl', 'wolf', 'fox', 'dragon', 'knight', 'ninja', 'sniper', 'builder', 'hunter', 'tryhard', 'player', 'dude', 'kid', 'cat', 'dog', 'bear', 'potato', 'noodle', 'legend', 'guest', 'hair', 'bloxer', 'runner', 'survivor', 'ghost', 'demon', 'angel', 'cheese', 'blade', 'storm', 'byte', 'zero', 'mango', 'panda'];
const WHOLE = ['xX_DarkBlade_Xx', 'noob_master_2011', 'baconhair4life', 'ilovepizza1234', 'GuestHunter_666', 'Builderman_Fan', 'not_a_bot_lol', 'kawaii_gamer_uwu', 'TheRealLastGuest', 'oof_sound_enjoyer', 'SweatyTryhard99', 'mom_get_off_wifi', 'Blox_Watch_Stan', 'robux_please', 'imsoscared', 'chill_guy_42', 'LMS_Merchant', 'gen_rusher', 'the_loop_god', 'HealsForDays', 'AFK_since_2019', 'jailbreak_vet', 'oblivious_fan01', 'cutie_patootie', 'DaddyDaisy', 'Elite_Guard_Main', 'pastaLaVista', 'quietkid', 'TrollFace_Supreme', 'xXCrimsonXx'];

function username(r = R) {
  if (r() < 0.32) { const w = r.pick(WHOLE); return r() < 0.4 ? w + r.int(1, 99) : w; }
  const cap = (s) => (r() < 0.55 ? s[0].toUpperCase() + s.slice(1) : s);
  let n = cap(r.pick(FIRST)) + (r() < 0.35 ? '_' : '') + cap(r.pick(SECOND));
  const tail = r();
  if (tail < 0.35) n += r.int(1, 9999);
  else if (tail < 0.45) n = 'xX' + n + 'Xx';
  else if (tail < 0.52) n += '_YT';
  else if (tail < 0.6) n += '_' + r.int(2007, 2016);
  return n.slice(0, 20);
}

/*
 * Playstyles. Weights for what they want to do with their round, and their nature:
 * skill   0..1  how well they loop, aim and react
 * team    0..1  how much they care about the others (heals, saves, body blocks)
 * nerve   0..1  how close they let the killer get before running
 * chat    0..1  how much they talk
 * toxic   0..1  trash talk, blame, rage quits
 */
export const STYLES = {
  hero:     { label: 'Hero',        skill: [0.6, 0.95], team: [0.85, 1], nerve: [0.7, 1], chat: [0.4, 0.8], toxic: [0, 0.15], wants: { gen: 3, help: 5, item: 1, hide: 0, follow: 1, troll: 0, idle: 0 } },
  medic:    { label: 'Medic',       skill: [0.4, 0.8], team: [0.85, 1], nerve: [0.4, 0.7], chat: [0.4, 0.8], toxic: [0, 0.1], wants: { gen: 2, help: 6, item: 2, hide: 0, follow: 2, troll: 0, idle: 0 } },
  rusher:   { label: 'Gen Rusher',  skill: [0.5, 0.9], team: [0.3, 0.6], nerve: [0.5, 0.9], chat: [0.2, 0.6], toxic: [0.1, 0.4], wants: { gen: 9, help: 1, item: 1, hide: 0, follow: 0, troll: 0, idle: 0 } },
  looper:   { label: 'Looper',      skill: [0.75, 1], team: [0.4, 0.8], nerve: [0.85, 1], chat: [0.3, 0.7], toxic: [0.2, 0.6], wants: { gen: 3, help: 3, item: 1, hide: 0, follow: 0, troll: 1, idle: 0 } },
  sweat:    { label: 'Sweat',       skill: [0.85, 1], team: [0.5, 0.8], nerve: [0.6, 0.9], chat: [0.5, 0.9], toxic: [0.4, 0.8], wants: { gen: 6, help: 3, item: 2, hide: 0, follow: 0, troll: 0, idle: 0 } },
  newbie:   { label: 'Newbie',      skill: [0.05, 0.35], team: [0.4, 0.8], nerve: [0.1, 0.5], chat: [0.5, 0.9], toxic: [0, 0.1], wants: { gen: 3, help: 1, item: 3, hide: 1, follow: 4, troll: 0, idle: 1 } },
  hider:    { label: 'Hider',       skill: [0.3, 0.6], team: [0.1, 0.4], nerve: [0, 0.3], chat: [0.1, 0.4], toxic: [0, 0.2], wants: { gen: 1, help: 0, item: 2, hide: 8, follow: 0, troll: 0, idle: 1 } },
  looter:   { label: 'Looter',      skill: [0.3, 0.7], team: [0.05, 0.3], nerve: [0.3, 0.6], chat: [0.2, 0.5], toxic: [0.2, 0.5], wants: { gen: 1, help: 0, item: 8, hide: 2, follow: 0, troll: 0, idle: 0 } },
  troll:    { label: 'Troll',       skill: [0.4, 0.8], team: [0, 0.2], nerve: [0.9, 1], chat: [0.7, 1], toxic: [0.6, 1], wants: { gen: 0, help: 0, item: 1, hide: 0, follow: 1, troll: 9, idle: 0 } },
  afk:      { label: 'AFK',         skill: [0.1, 0.4], team: [0, 0.2], nerve: [0, 0.2], chat: [0, 0.15], toxic: [0, 0.1], wants: { gen: 0, help: 0, item: 0, hide: 0, follow: 0, troll: 0, idle: 10 } },
  buddy:    { label: 'Buddy',       skill: [0.4, 0.75], team: [0.7, 1], nerve: [0.4, 0.8], chat: [0.5, 0.9], toxic: [0, 0.2], wants: { gen: 3, help: 3, item: 1, hide: 0, follow: 7, troll: 0, idle: 0 } },
  coward:   { label: 'Coward',      skill: [0.3, 0.6], team: [0, 0.25], nerve: [0, 0.2], chat: [0.3, 0.6], toxic: [0.1, 0.3], wants: { gen: 3, help: 0, item: 2, hide: 4, follow: 0, troll: 0, idle: 0 } }
};
const STYLE_W = [['hero', 9], ['medic', 7], ['rusher', 10], ['looper', 6], ['sweat', 6], ['newbie', 12], ['hider', 7], ['looter', 6], ['troll', 5], ['afk', 3], ['buddy', 9], ['coward', 6]];

/* Killer temperaments: how they hunt when it's their turn. */
export const KILLER_STYLES = {
  hunter:   { label: 'Hunter',   tunnel: 0.4, patrol: 0.5, camp: 0.1, mercy: 0, taunt: 0.2 },
  tunneler: { label: 'Tunneler', tunnel: 0.95, patrol: 0.2, camp: 0.3, mercy: 0, taunt: 0.4 },
  patroller:{ label: 'Gen Guard',tunnel: 0.2, patrol: 0.95, camp: 0.2, mercy: 0, taunt: 0.1 },
  showoff:  { label: 'Showoff',  tunnel: 0.5, patrol: 0.4, camp: 0, mercy: 0, taunt: 0.9 },
  friendly: { label: 'Friendly', tunnel: 0.2, patrol: 0.3, camp: 0, mercy: 0.6, taunt: 0.5 },
  sweat:    { label: 'Sweat',    tunnel: 0.6, patrol: 0.7, camp: 0.1, mercy: 0, taunt: 0.3 }
};

/* How they type. */
const TYPING = {
  normal: (s) => s,
  lower: (s) => s.toLowerCase().replace(/[.,!?']/g, (c) => (c === '!' || c === '?' ? c : '')),
  caps: (s) => s.toUpperCase().replace(/\.$/, '!!'),
  fast: (s) => s.toLowerCase().replace(/you/g, 'u').replace(/are/g, 'r').replace(/please/g, 'pls').replace(/what/g, 'wat').replace(/[.,']/g, ''),
  proper: (s) => (s[0].toUpperCase() + s.slice(1)).replace(/([^.!?])$/, '$1.'),
  emote: (s) => s + ' ' + R.pick([':)', ':D', 'xD', ':P', '<3', 'lol', ':(', 'o_o']),
  kid: (s) => s.toLowerCase().replace(/[.,']/g, '') + (R() < 0.4 ? ' ' + 'pls'.repeat(1) : '')
};
const TYPING_W = [['normal', 4], ['lower', 8], ['caps', 1], ['fast', 6], ['proper', 2], ['emote', 2], ['kid', 3]];

const pickIn = (r, [a, b]) => a + (b - a) * r();

export function makeBot(r = R) {
  const style = weighted(STYLE_W, r);
  const S = STYLES[style];
  const p = {
    style,
    skill: pickIn(r, S.skill), team: pickIn(r, S.team), nerve: pickIn(r, S.nerve), chat: pickIn(r, S.chat), toxic: pickIn(r, S.toxic),
    react: 0.12 + (1 - 0) * r() * 0.25,                        // seconds before they notice things
    typing: weighted(TYPING_W, r),
    killerStyle: weighted([['hunter', 6], ['tunneler', 3], ['patroller', 4], ['showoff', 2], ['friendly', 1], ['sweat', 3]], r),
    patience: 0.4 + r() * 0.6                                   // how long they put up with things before leaving
  };
  p.react = 0.35 - p.skill * 0.25 + r() * 0.12;
  return {
    name: username(r), bot: true, persona: p,
    money: Math.floor(200 + r() * 3000), malice: Math.floor(r() * 6), level: 1 + Math.floor(r() * 60 * (0.3 + p.skill)),
    mood: 0.5, roundsHere: 0
  };
}

/* ---------------- what they say ---------------- */
const LINES = {
  join: ['hi', 'hello', 'hey guys', 'yo', 'sup', 'hii', 'wsg', 'im back', 'hey', 'o/'],
  greetBack: ['hi', 'hey', 'hello {name}', 'yo {name}', 'hii', 'sup'],
  lobby: ['who wants to team', 'i hope im not killer', 'i want to be killer so bad', 'this game is fun', 'what killer is the best', 'guest 1337 is so op', 'anyone wanna trade', 'i have {money} money', 'gg last round', 'i need 1 more win for my skin', 'lets gooo', 'bacon general is so annoying', 'whos the killer next', 'i main {char}', 'the terrible is scary ngl', 'imagine dying first', 'pls dont tunnel me', 'blox watch scares me', 'is limbo a good map', 'i always get village', 'brb', 'does anyone know how to loop', 'this map vote is rigged', 'i bought a skin', 'my wifi is so bad'],
  lobbyToxic: ['ez', 'you guys are bad', 'imagine being bad', 'carry me again', 'noobs', 'l bozo', 'cry about it', 'dont be bad this time'],
  voteMap: ['vote {map}', '{map} pls', 'not {map} again', '{map} is the best map', 'everyone vote {map}'],
  killerPicked: ['oh no its {killer}', 'NOOO not {killer}', '{killer} is coming', 'good luck guys', 'run', 'its over', 'we got this', 'pls be nice {kname}', 'ez win', 'lets go team'],
  amKiller: ['lets gooo im killer', 'finally', 'youre all dead', 'run.', 'im coming', 'hide and seek time', 'hehe', 'good luck'],
  start: ['good luck', 'gl', 'lets do gens', 'im doing gens', 'split up', 'stay together', 'where do we go', 'run', 'dont die', 'ok'],
  genStart: ['doing gen {gen}', 'im on gen {gen}', 'on gen', 'fixing this one'],
  genDone: ['gen done', 'got one', 'gen {gen} done', 'one more down', 'ez gen', 'done!'],
  genAllDone: ['all gens done!!', 'gens done lets go', 'we did it'],
  seeKiller: ['killer at {place}', 'KILLER', 'killer here', 'he is at {place}', 'killer near gen {gen}', 'run its {killer}', 'killer!!', 'i see the killer'],
  chased: ['help', 'HELP', 'hes on me', 'killer chasing me', 'im being chased', 'run', 'aaaa', 'nooo', 'pls', 'im looping him', 'chasing me at {place}', 'someone stun him'],
  chasedCalm: ['im looping', 'ez loop', 'come on', 'too slow', 'cant catch me', 'hes on me but im fine'],
  hurt: ['im hurt', 'need heals', 'low hp', 'anyone have a medkit', 'ow', 'i need heal'],
  saved: ['thanks', 'ty', 'thank you {name}', 'ty {name}', 'tysm', 'thx', 'saved me'],
  helping: ['omw', 'coming', 'on my way {name}', 'ill help', 'hold on {name}', 'got you'],
  stunned: ['GOT HIM', 'stunned', 'get rekt', 'hit him', 'lets go', 'nice', 'ez stun'],
  died: ['oof', 'noooo', 'i died', 'rip', 'bruh', 'lag', 'that was lag', 'not fair', 'how', 'gg', 'that hitbox', 'whyyy', 'ok im dead', 'avenge me'],
  diedToxic: ['this game is so unfair', 'killer is hacking', 'you guys didnt help me', 'worst team ever', 'thanks for nothing', 'ur all bad', 'reported'],
  allyDied: ['rip {name}', 'noo {name}', 'f', 'rip', '{name} died', 'we lost {name}', 'oof'],
  allyDiedToxic: ['{name} is so bad', 'lol {name}', 'imagine dying', 'ok {name}'],
  lms: ['im last', 'its just me', 'lms!!', 'pray for me', 'i got this', 'its over', 'gg', 'clutch time', 'noooo im last'],
  lmsSpectator: ['you got this {name}', 'go {name}', 'clutch it', 'pls win', '{name} gonna win', 'run {name}', 'its over', 'gg'],
  escape: ['WE WON', 'gg', 'gg ez', 'lets gooo', 'we survived', 'ggs', 'yay', 'gg wp'],
  killerWin: ['gg', 'gg killer', 'ggs', 'that killer was good', 'unfair', 'gg ez', 'nice game'],
  killerWinMe: ['gg ez', 'too easy', 'gg', 'yall are bad', 'gg well played', 'get good', 'better luck next time'],
  killerLoseMe: ['gg', 'you guys are good', 'unfair', 'lag', 'next time', 'how did they survive'],
  taunt: ['come here', 'run', 'i see you', 'nowhere to hide', 'found you', 'hehe', 'too slow', 'where are you going'],
  trollTaunt: ['cant catch me', 'bad killer', 'missed', 'lol', 'ez', 'try again', 'hi killer', 'over here', 'come get me'],
  item: ['found a medkit', 'got a cola', 'i have a medkit if anyone needs', 'loot'],
  afk: ['', 'brb', 'afk', 'sorry was afk'],
  rage: ['im leaving', 'this game is trash', 'bye', 'im done', 'i quit', 'ugh'],
  thanksHeal: ['ty for the heal', 'thanks {name}', 'ty', 'tysm {name}'],
  echo: ['i revealed the killer!', 'look where he is', 'killer revealed', 'echo used'],
  bond: ['me and {name} are bonded', 'stick with me {name}', 'duo'],
  reply_hi: ['hi', 'hey', 'hello', 'yo', 'hii {name}'],
  reply_help: ['omw', 'where', 'coming', 'cant im being chased', 'no', 'hold on'],
  reply_where: ['killer at {place}', 'idk', 'i dont know', 'near {place}', 'no idea'],
  reply_gg: ['gg', 'ggs', 'gg wp'],
  reply_lol: ['lol', 'lmao', 'xD', 'haha'],
  reply_team: ['sure', 'ok', 'yes', 'no', 'maybe', 'i dont team'],
  reply_bot: ['im not a bot', 'ur the bot', 'no u', 'beep boop', 'lol no'],
  reply_noob: ['ur the noob', 'no u', 'ok', 'cry', 'says you'],
  reply_question: ['idk', 'yes', 'no', 'maybe', 'probably', 'i think so', 'ask {name}'],
  reply_killer: ['{killer}', 'its {killer}', 'idk', '{kname} is killer']
};

/** A line for a topic, in this bot's voice, or null if they would not bother. */
export function say(member, topic, vars = {}, force = false) {
  const p = member.persona;
  if (!force && R() > 0.2 + p.chat * 0.85) return null;
  let pool = LINES[topic];
  if (p.toxic > 0.55 && LINES[topic + 'Toxic'] && R() < p.toxic) pool = LINES[topic + 'Toxic'];
  if (topic === 'chased' && p.skill > 0.75 && R() < 0.5) pool = LINES.chasedCalm;
  if (!pool || !pool.length) return null;
  let s = R.pick(pool).replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : ''));
  if (!s.trim()) return null;
  s = (TYPING[p.typing] || TYPING.normal)(s);
  // typos for the fast typers
  if ((p.typing === 'fast' || p.typing === 'kid') && R() < 0.25 && s.length > 4) { const i = 1 + Math.floor(R() * (s.length - 2)); s = s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2); }
  // Roblox filters some of it
  if (p.toxic > 0.7 && R() < 0.25) s = s.replace(/\b(\w{4,})\b/, (w) => '#'.repeat(w.length));
  return s;
}

/** Bots answer what the player types, sometimes. */
export function replyTopic(text) {
  const t = text.toLowerCase();
  if (/\b(hi|hello|hey|yo|sup|hii+)\b/.test(t)) return 'reply_hi';
  if (/\b(help|save me|hes on me|chasing)\b/.test(t)) return 'reply_help';
  if (/\bwhere\b.*\bkiller\b|\bkiller\b.*\bwhere\b/.test(t)) return 'reply_where';
  if (/\bwho\b.*\bkiller\b/.test(t)) return 'reply_killer';
  if (/\bgg\b/.test(t)) return 'reply_gg';
  if (/\b(lol|lmao|haha|xd)\b/.test(t)) return 'reply_lol';
  if (/\bteam\b/.test(t)) return 'reply_team';
  if (/\bbot\b/.test(t)) return 'reply_bot';
  if (/\b(noob|bad|trash)\b/.test(t)) return 'reply_noob';
  if (/\?$/.test(t.trim())) return 'reply_question';
  return null;
}
