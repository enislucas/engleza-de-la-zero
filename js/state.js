// state.js — profiluri + persistență (localStorage principal, IndexedDB oglindă de siguranță,
// cod de rezervă export/import). Nimic din progres nu trebuie pierdut vreodată.

const LS_KEY = 'ezr_v1';
const DB_NAME = 'ezr_backup';
const DB_STORE = 'kv';

export const state = {
  data: null,      // obiectul rădăcină
  profile: null,   // profilul activ (referință în data.profiles)
};

export function todayStr(d = new Date()) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function newProfile(name, avatar) {
  return {
    id: 'p' + Math.random().toString(36).slice(2, 9),
    name: name || 'Cursant',
    avatar: avatar || '🙂',
    theme: 'vesel',
    fontScale: 1.15,          // implicit "Mare" — public 55+
    dailyGoalXp: 20,
    track: 'general',         // general | sanatate | munca
    soundOn: true,
    created: todayStr(),
    game: {
      xp: 0, gems: 120, hearts: 5, heartsAt: Date.now(),
      streak: { count: 0, lastDay: '', freezes: 1, travel: false, travelStart: '', repairUsed: '' },
      league: { tier: 0, weekId: '', xpWeek: 0, history: [] },
      quests: { day: '', list: [] },
      boost: { until: 0 },
      words: {},   // wordId -> {s: 0..5, due: 'YYYY-MM-DD', seen, wrong, right}
      units: {},   // unitId -> {done: n, test: bool}
      stats: { days: {}, lessons: 0, perfect: 0, wordsLearned: 0 },
    },
  };
}

// ---------- IndexedDB oglindă ----------
function idbOpen() {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { try { req.result.createObjectStore(DB_STORE); } catch (_) {} };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch (_) { resolve(null); }
  });
}

async function idbSet(val) {
  const db = await idbOpen();
  if (!db) return;
  try {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(val, LS_KEY);
  } catch (_) {}
}

async function idbGet() {
  const db = await idbOpen();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(LS_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch (_) { resolve(null); }
  });
}

// ---------- salvare ----------
let saveTimer = null;

export function save(immediate = false) {
  if (!state.data) return;
  const doSave = () => {
    saveTimer = null;
    // ștampila de timp: dacă una din cele două magazii refuză scrierea, la pornire
    // o alegem pe cea mai nouă. Progresul unei lecții nu are voie să se piardă tăcut.
    state.data.savedAt = Date.now();
    let json;
    try { json = JSON.stringify(state.data); } catch (_) { return; }
    let lsOk = true;
    try { localStorage.setItem(LS_KEY, json); } catch (_) { lsOk = false; }
    if (!lsOk) {
      state.storageOk = false;
      try { if (window.__logErr) window.__logErr('save: localStorage a refuzat scrierea'); } catch (_) {}
    }
    idbSet(json); // oglinda de siguranță (async, best effort)
  };
  if (immediate) { if (saveTimer) clearTimeout(saveTimer); doSave(); return; }
  if (saveTimer) return;
  saveTimer = setTimeout(doSave, 400);
}

function parseData(raw) {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    if (d && Array.isArray(d.profiles)) return d;
  } catch (_) {}
  return null;
}

export async function load() {
  let raw = null;
  try { raw = localStorage.getItem(LS_KEY); } catch (_) {}
  let d = parseData(raw);
  // oglinda IndexedDB: ne salvează dacă localStorage lipsește, e corupt SAU e mai vechi
  // (telefonul poate refuza tăcut scrierea în localStorage și progresul ar părea că dispare)
  const mirror = parseData(await idbGet());
  if (!d) d = mirror;
  else if (mirror && (mirror.savedAt || 0) > (d.savedAt || 0)) d = mirror;
  if (d) {
    state.data = d;
    state.profile = d.profiles.find(p => p.id === d.active) || d.profiles[0] || null;
  }
  if (!state.data) {
    state.data = { v: 1, profiles: [], active: '', installed: todayStr() };
  }
  // verificăm dacă stocarea chiar funcționează (Safari privat: setItem aruncă)
  state.storageOk = true;
  try {
    localStorage.setItem(LS_KEY + '_chk', '1');
    localStorage.removeItem(LS_KEY + '_chk');
  } catch (_) { state.storageOk = false; }
  // Cerem stocare persistentă (mai ales pentru iOS/Android eviction).
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  } catch (_) {}
  return state.data;
}

// adoptă date scrise de alt tab (evenimentul 'storage') — fără a suprascrie o lecție în curs
export function adoptExternal(raw) {
  const d = parseData(raw);
  if (!d) return false;
  state.data = d;
  state.profile = d.profiles.find(p => p.id === d.active) || d.profiles[0] || null;
  return true;
}

// săptămâna curentă (luni) — folosită și de ligă și de gamify, fără import circular
export function weekStartDate(d = new Date()) {
  const dt = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (dt.getDay() + 6) % 7; // 0 = luni
  dt.setDate(dt.getDate() - day);
  return dt;
}

export function addProfile(name, avatar) {
  const p = newProfile(name, avatar);
  state.data.profiles.push(p);
  state.data.active = p.id;
  state.profile = p;
  save(true);
  return p;
}

export function switchProfile(id) {
  const p = state.data.profiles.find(x => x.id === id);
  if (p) { state.data.active = id; state.profile = p; save(true); }
  return p;
}

// ---------- cod de rezervă ----------
export function exportCode() {
  try {
    const json = JSON.stringify(state.data);
    return btoa(unescape(encodeURIComponent(json)));
  } catch (_) { return ''; }
}

export function importCode(code) {
  try {
    const json = decodeURIComponent(escape(atob(code.trim())));
    const d = JSON.parse(json);
    if (!d || !Array.isArray(d.profiles) || !d.profiles.length) return false;
    // sanity: profilurile au structura minimă
    if (!d.profiles.every(p => p && p.id && p.game)) return false;
    state.data = d;
    state.profile = d.profiles.find(p => p.id === d.active) || d.profiles[0];
    save(true);
    return true;
  } catch (_) { return false; }
}

// aplică tema + mărimea textului profilului activ pe document
export function applyPrefs() {
  const p = state.profile;
  const root = document.documentElement;
  root.setAttribute('data-theme', (p && p.theme) || 'vesel');
  root.style.setProperty('--fs', String((p && p.fontScale) || 1));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const map = { vesel: '#58cc02', cald: '#d96f32', minimal: '#2563eb', noapte: '#131f24' };
    meta.setAttribute('content', map[(p && p.theme) || 'vesel'] || '#58cc02');
  }
}
