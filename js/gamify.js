// gamify.js — XP, vieți, rubine, serie (streak), Protocol de călătorie, misiuni zilnice.
// Filozofie (cercetare 55+): recompensăm mult, pedepsim puțin, nu blocăm niciodată complet.

import { state, save, todayStr } from './state.js';

export const HEARTS_MAX = 5;
export const HEART_REGEN_MS = 3 * 60 * 60 * 1000; // 1 viață la 3 ore
export const COSTS = {
  heartOne: 80,       // 1 viață
  heartsFull: 350,    // toate viețile
  freeze: 150,        // un înghețător de serie (max 2 echipate)
  repair: 300,        // repară seria pierdută (48h)
  boost: 120,         // 15 min XP dublu
};

// ---------- utilitare deterministe ----------
export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function seededRand(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function yesterdayStr() {
  const d = new Date(); d.setDate(d.getDate() - 1);
  return todayStr(d);
}

// ---------- vieți ----------
export function heartsNow(p = state.profile) {
  const g = p.game;
  if (g.hearts >= HEARTS_MAX) { g.heartsAt = Date.now(); return g.hearts; }
  const elapsed = Date.now() - (g.heartsAt || Date.now());
  const regen = Math.floor(elapsed / HEART_REGEN_MS);
  if (regen > 0) {
    g.hearts = Math.min(HEARTS_MAX, g.hearts + regen);
    g.heartsAt = g.hearts >= HEARTS_MAX ? Date.now() : (g.heartsAt + regen * HEART_REGEN_MS);
    save();
  }
  return g.hearts;
}

export function nextHeartInMs(p = state.profile) {
  const g = p.game;
  if (heartsNow(p) >= HEARTS_MAX) return 0;
  return Math.max(0, HEART_REGEN_MS - (Date.now() - g.heartsAt));
}

export function loseHeart(p = state.profile) {
  const g = p.game;
  heartsNow(p);
  if (g.hearts > 0) {
    if (g.hearts === HEARTS_MAX) g.heartsAt = Date.now(); // pornește cronometrul regen
    g.hearts--;
    save();
  }
  return g.hearts;
}

export function addHearts(n, p = state.profile) {
  const g = p.game;
  g.hearts = Math.min(HEARTS_MAX, heartsNow(p) + n);
  save();
}

export function buyHearts(kind) {
  const g = state.profile.game;
  const cost = kind === 'full' ? COSTS.heartsFull : COSTS.heartOne;
  if (g.gems < cost) return false;
  g.gems -= cost;
  if (kind === 'full') { g.hearts = HEARTS_MAX; g.heartsAt = Date.now(); }
  else addHearts(1);
  save(true);
  return true;
}

// ---------- XP ----------
export function xpBoostActive(p = state.profile) {
  return (p.game.boost && p.game.boost.until || 0) > Date.now();
}

export function addXp(amount, p = state.profile) {
  const g = p.game;
  let gained = amount;
  if (xpBoostActive(p)) gained *= 2;
  g.xp += gained;
  g.league.xpWeek = (g.league.xpWeek || 0) + gained;
  const day = todayStr();
  g.stats.days[day] = (g.stats.days[day] || 0) + gained;
  save();
  return gained;
}

export function buyBoost() {
  const g = state.profile.game;
  if (g.gems < COSTS.boost) return false;
  g.gems -= COSTS.boost;
  g.boost = { until: Date.now() + 15 * 60 * 1000 };
  save(true);
  return true;
}

export function addGems(n, p = state.profile) {
  p.game.gems += n;
  save();
}

// ---------- serie (streak) ----------
// Apelează la fiecare pornire/focus. Returnează evenimente pentru UI.
export function syncStreak(p = state.profile) {
  const g = p.game, s = g.streak;
  const today = todayStr(), yest = yesterdayStr();
  const ev = { frozenUsed: false, lost: false, lostCount: 0 };
  if (!s.lastDay || s.count === 0) return ev;
  if (s.lastDay === today || s.lastDay === yest) return ev;
  // A trecut cel puțin o zi fără activitate.
  if (s.travel) return ev; // Protocol de călătorie: seria e pe pauză, nimic nu se pierde.
  // Câte zile lipsă între lastDay și ieri? (dacă data pare să fi mers înapoi, nu atingem seria)
  const diffDays = Math.round((new Date(today) - new Date(s.lastDay)) / 86400000);
  if (diffDays <= 1) return ev;
  const missed = diffDays - 1;
  let remaining = missed;
  while (remaining > 0 && s.freezes > 0) { s.freezes--; remaining--; ev.frozenUsed = true; }
  if (remaining > 0) {
    ev.lost = true; ev.lostCount = s.count;
    s.lostStreak = s.count;
    s.lostAt = Date.now();
    s.count = 0;
    s.lastDay = '';
  } else {
    // acoperit integral de înghețătoare: seria continuă, dar ziua de azi încă nu e bifată
    s.lastDay = yest;
  }
  save(true);
  return ev;
}

// Marchează activitatea de azi (după o lecție terminată). Returnează {extended, milestone}.
export function hitStreakToday(p = state.profile) {
  const g = p.game, s = g.streak;
  const today = todayStr();
  const res = { extended: false, milestone: 0 };
  if (s.lastDay === today) return res;
  s.count += 1;
  s.lastDay = today;
  if (s.travel) { s.travel = false; s.travelStart = ''; } // o lecție reia automat seria
  res.extended = true;
  const MILE = { 3: 30, 7: 50, 14: 80, 30: 200, 50: 300, 100: 500, 200: 800, 365: 2000 };
  if (MILE[s.count]) {
    res.milestone = s.count;
    addGems(MILE[s.count], p);
    if (s.freezes < 2) s.freezes++; // la fiecare bornă primești și un înghețător gratuit
  }
  // ziua e bifată — stingem bulina de pe iconița aplicației
  try { if (navigator.clearAppBadge) navigator.clearAppBadge(); } catch (_) {}
  save(true);
  return res;
}

export function canRepairStreak(p = state.profile) {
  const s = p.game.streak;
  return !!(s.lostStreak && s.lostAt && (Date.now() - s.lostAt) < 48 * 3600 * 1000);
}

export function repairStreak(p = state.profile) {
  const g = p.game, s = g.streak;
  if (!canRepairStreak(p) || g.gems < COSTS.repair) return false;
  g.gems -= COSTS.repair;
  s.count = s.lostStreak;
  s.lastDay = yesterdayStr();
  s.lostStreak = 0; s.lostAt = 0;
  save(true);
  return true;
}

export function buyFreeze() {
  const g = state.profile.game;
  if (g.streak.freezes >= 2 || g.gems < COSTS.freeze) return false;
  g.gems -= COSTS.freeze;
  g.streak.freezes++;
  save(true);
  return true;
}

export function setTravel(on, p = state.profile) {
  const s = p.game.streak;
  s.travel = !!on;
  s.travelStart = on ? todayStr() : '';
  save(true);
}

// ---------- misiuni zilnice ----------
const QUEST_POOL = [
  { id: 'xp20', ico: '⚡', text: 'Câștigă 20 XP', goal: 20, kind: 'xp', gems: 20 },
  { id: 'xp30', ico: '⚡', text: 'Câștigă 30 XP', goal: 30, kind: 'xp', gems: 30 },
  { id: 'les2', ico: '📗', text: 'Termină 2 lecții', goal: 2, kind: 'lessons', gems: 25 },
  { id: 'perf1', ico: '🎯', text: 'O lecție fără nicio greșeală', goal: 1, kind: 'perfect', gems: 30 },
  { id: 'listen6', ico: '🔊', text: 'Răspunde corect la 6 exerciții de ascultare', goal: 6, kind: 'listen', gems: 25 },
  { id: 'rev1', ico: '💪', text: 'Fă o sesiune de exersare', goal: 1, kind: 'review', gems: 20 },
];

export function syncQuests(p = state.profile) {
  const g = p.game;
  const today = todayStr();
  if (g.quests.day === today && g.quests.list.length) return g.quests.list;
  const rand = seededRand(hashStr(p.id + today));
  const pool = QUEST_POOL.slice();
  const list = [];
  // prima misiune mereu ușoară (xp20 sau les... nu: xp20), a doua din rest
  list.push({ ...QUEST_POOL[0], progress: 0, claimed: false });
  const rest = pool.filter(q => q.id !== 'xp20');
  list.push({ ...rest[Math.floor(rand() * rest.length)], progress: 0, claimed: false });
  g.quests = { day: today, list };
  save();
  return list;
}

// e: {xp, lessons, perfect, listen, review}
export function questEvent(e, p = state.profile) {
  syncQuests(p);
  const done = [];
  for (const q of p.game.quests.list) {
    if (q.claimed || q.progress >= q.goal) continue;
    const inc = e[q.kind] || 0;
    if (inc > 0) {
      q.progress = Math.min(q.goal, q.progress + inc);
      if (q.progress >= q.goal) done.push(q);
    }
  }
  if (done.length) save();
  return done; // misiuni proaspăt completate (UI arată sărbătorirea; revendicarea dă rubinele)
}

export function claimQuest(qid, p = state.profile) {
  const q = p.game.quests.list.find(x => x.id === qid);
  if (!q || q.claimed || q.progress < q.goal) return 0;
  q.claimed = true;
  addGems(q.gems, p);
  save(true);
  return q.gems;
}
