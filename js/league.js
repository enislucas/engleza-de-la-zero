// league.js — Liga săptămânală. Concurenți: rivali simulați (curbe deterministe pe săptămână),
// calibrați ca un cursant activ (2-3 lecții/zi) să termine în top 3, dar nu automat pe locul 1.
// Fără rușine la retrogradare: promovarea se sărbătorește, coborârea se anunță discret.

import { state, save, todayStr, weekStartDate } from './state.js';
import { hashStr, seededRand, addGems } from './gamify.js';

export const TIERS = [
  { id: 0, name: 'Liga Bronz', ico: '🥉' },
  { id: 1, name: 'Liga Argint', ico: '🥈' },
  { id: 2, name: 'Liga Aur', ico: '🥇' },
  { id: 3, name: 'Liga Safir', ico: '💠' },
  { id: 4, name: 'Liga Rubin', ico: '♦️' },
  { id: 5, name: 'Liga Diamant', ico: '💎' },
];

const BOT_NAMES = [
  ['Andrei', '🧔'], ['Elena', '👩'], ['Vasile', '👨‍🦳'], ['Ioana', '👩‍🦰'], ['Mihai', '👨'],
  ['Rodica', '👵'], ['Cristian', '🧑'], ['Doina', '👩‍🦳'], ['Marius', '👨‍🦱'], ['Simona', '👱‍♀️'],
  ['Petre', '👴'], ['Larisa', '🙍‍♀️'], ['Nicu', '🙎‍♂️'], ['Camelia', '💁‍♀️'], ['Sorin', '🤵'],
];

// Luni ca început de săptămână (calcul pe ora locală, nu UTC).
export function weekId(d = new Date()) {
  return todayStr(weekStartDate(d));
}

function weekProgress(d = new Date()) {
  const start = weekStartDate(d);
  const frac = (d - start) / (7 * 86400000);
  return Math.min(1, Math.max(0.02, frac));
}

// Rivalii săptămânii: 9 nume alese determinist; fiecare cu XP-țintă și un profil orar.
function weekBots(p) {
  const wid = weekId();
  const rand = seededRand(hashStr(p.id + '|' + wid + '|liga' + (p.game.league.tier || 0)));
  const names = BOT_NAMES.slice();
  const bots = [];
  const tier = p.game.league.tier || 0;
  for (let i = 0; i < 9; i++) {
    const ni = Math.floor(rand() * names.length);
    const [name, ava] = names.splice(ni, 1)[0];
    // XP final pe săptămână: ligile mari au rivali mai harnici.
    // Bronz: 40–260 XP; fiecare treaptă adaugă ~20%.
    const base = 40 + rand() * 220;
    const mult = 1 + tier * 0.22;
    const target = Math.round(base * mult);
    // profil orar: unii încep tare, alții recuperează în weekend
    const shape = 0.6 + rand() * 0.9; // exponent al curbei
    bots.push({ name, ava, target, shape, jitter: hashStr(name + wid) });
  }
  return bots;
}

function botXpNow(bot, frac) {
  // curbă monotonă: target * frac^shape, cu trepte mici ca să pară "pe zile"
  const raw = bot.target * Math.pow(frac, bot.shape);
  const step = Math.max(1, Math.round(raw / 7));
  return Math.max(0, Math.floor(raw / step) * step);
}

// Sincronizează săptămâna: dacă a început una nouă, închide-o pe cea veche (promovare/retrogradare).
export function syncLeague(p = state.profile) {
  const lg = p.game.league;
  const wid = weekId();
  const ev = { closed: false, promoted: false, demoted: false, rank: 0, gems: 0, tier: lg.tier || 0 };
  if (!lg.weekId) { lg.weekId = wid; save(); return ev; }
  if (lg.weekId === wid) return ev;

  // Închide săptămâna trecută cu clasamentul final de atunci.
  const oldWid = lg.weekId;
  const rand = seededRand(hashStr(p.id + '|' + oldWid + '|liga' + (lg.tier || 0)));
  // reconstruim rivalii săptămânii trecute (aceeași sămânță => aceleași ținte)
  const names = BOT_NAMES.slice();
  const finals = [];
  for (let i = 0; i < 9; i++) {
    const ni = Math.floor(rand() * names.length);
    const [name] = names.splice(ni, 1)[0];
    const base = 40 + rand() * 220;
    const mult = 1 + (lg.tier || 0) * 0.22;
    finals.push(Math.round(base * mult));
    rand(); // shape (consumat pentru aliniere)
  }
  const myXp = lg.xpWeek || 0;
  const rank = 1 + finals.filter(x => x > myXp).length;
  ev.closed = true; ev.rank = rank;
  if (myXp > 0) {
    if (rank <= 3 && (lg.tier || 0) < TIERS.length - 1) {
      lg.tier = (lg.tier || 0) + 1; ev.promoted = true;
      ev.gems = rank === 1 ? 100 : rank === 2 ? 70 : 50;
      addGems(ev.gems, p);
    } else if (rank >= 9 && (lg.tier || 0) > 0) {
      lg.tier = lg.tier - 1; ev.demoted = true;
    } else if (rank <= 5) {
      ev.gems = 25; addGems(25, p);
    }
    lg.history = lg.history || [];
    lg.history.push({ week: oldWid, rank, xp: myXp, tier: ev.tier });
    if (lg.history.length > 26) lg.history.shift();
  }
  lg.weekId = wid;
  lg.xpWeek = 0;
  ev.newTier = lg.tier;
  save(true);
  return ev;
}

// Clasamentul curent (live).
export function standings(p = state.profile) {
  syncLeague(p);
  const frac = weekProgress();
  const bots = weekBots(p).map(b => ({
    name: b.name, ava: b.ava, xp: botXpNow(b, frac), me: false,
  }));
  bots.push({ name: p.name, ava: p.avatar, xp: p.game.league.xpWeek || 0, me: true });
  bots.sort((a, b) => b.xp - a.xp || (a.me ? -1 : 1));
  return bots;
}

export function daysLeftInWeek() {
  const start = weekStartDate();
  const end = new Date(start); end.setDate(end.getDate() + 7);
  return Math.max(0, Math.ceil((end - new Date()) / 86400000));
}
