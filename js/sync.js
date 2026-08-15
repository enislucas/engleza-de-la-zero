// sync.js — cutia poștală a familiei: progresul pleacă CRIPTAT spre o căsuță anonimă
// și se întoarce pe orice dispozitiv al familiei. Fără conturi, fără parole tastate:
// telefonul primește o singură dată un link de împerechere de la Enis și atât.
// Regula de siguranță: salvarea mai nouă câștigă întotdeauna (savedAt), exact ca
// oglinda locală IndexedDB. Fără internet sau fără cutie: aplicația merge identic.

import { state, save } from './state.js';

const CFG_KEY = 'ezr_sync';
let cfg = null;
try { cfg = JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); } catch (_) {}

export function syncActive() { return !!(cfg && cfg.url && cfg.box && cfg.key); }

// linkul de împerechere: #pair=base64url("https://cutie|box|cheie") — 3 părți pentru sync,
// 7 pentru sync + Barza de buzunar: url|box|cheie|cutiaTutorelui|cheiaTutorelui|cheiaGemini|cine,
// sau 8 dacă adaugă și cheia DeepSeek la final (routerul de model rulează și pe telefon).
function storeParts(parts) {
  cfg = { url: parts[0].replace(/\/+$/, ''), box: parts[1], key: parts[2] };
  if (parts.length >= 7) { cfg.tbox = parts[3]; cfg.tkey = parts[4]; cfg.gkey = parts[5]; cfg.who = parts[6]; }
  if (parts.length >= 8 && parts[7]) cfg.dkey = parts[7];
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
}
export function capturePairing() {
  const m = (location.hash || '').match(/#?pair=([A-Za-z0-9_-]+)/);
  if (!m) return false;
  try {
    const parts = atob(m[1].replace(/-/g, '+').replace(/_/g, '/')).split('|');
    const urlOk = /^https:\/\//.test(parts[0]) || /^http:\/\/(127\.0\.0\.1|localhost)/.test(parts[0]);
    if ([3, 7, 8].includes(parts.length) && urlOk && parts[1].length >= 16 && parts[2].length >= 32) {
      storeParts(parts);
      history.replaceState(null, '', location.pathname + location.search);
      return true;
    }
  } catch (_) {}
  return false;
}

// aplică o împerechere LIPITĂ manual (linkul întreg sau doar codul). Necesară pe iPhone:
// aplicația de pe ecranul principal e izolată de Safari, iar scanarea QR deschide Safari
// (context gol) — așa că împerecherea se face din interiorul aplicației instalate.
export function applyPairingString(s) {
  s = String(s || '').trim();
  let tok = null;
  const m = s.match(/pair=([A-Za-z0-9_-]+)/);
  if (m) tok = m[1];
  else if (/^[A-Za-z0-9_-]{40,}$/.test(s)) tok = s;
  if (!tok) return false;
  try {
    const parts = atob(tok.replace(/-/g, '+').replace(/_/g, '/')).split('|');
    const urlOk = /^https?:\/\//.test(parts[0]);
    if ([3, 7, 8].includes(parts.length) && urlOk && parts[1].length >= 16 && parts[2].length >= 32) {
      storeParts(parts);
      return true;
    }
  } catch (_) {}
  return false;
}

// configurația Barzei de buzunar (dacă linkul de împerechere a adus-o)
export function tutorCfg() {
  return (cfg && cfg.gkey) ? cfg : null;
}

// deschide și decriptează o cutie oarecare (folosit pentru pachetul tutorelui: memoria)
export async function openBox(box, keyB64) {
  if (!cfg || !cfg.url) return null;
  try {
    const r = await fetch(cfg.url + '/drop/' + box);
    if (!r.ok) return null;
    const [ivb, ctb] = (await r.text()).split('.');
    const raw = b64ToBuf(keyB64.replace(/-/g, '+').replace(/_/g, '/'));
    const k = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBuf(ivb) }, k, b64ToBuf(ctb));
    return JSON.parse(new TextDecoder().decode(pt));
  } catch (_) { return null; }
}

function bufToB64(buf) {
  const u = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToBuf(s) {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
async function aesKey() {
  const raw = b64ToBuf(cfg.key.replace(/-/g, '+').replace(/_/g, '/'));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function cloudPush() {
  if (!syncActive() || !state.data) return false;
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(),
      new TextEncoder().encode(JSON.stringify(state.data)));
    const r = await fetch(cfg.url + '/drop/' + cfg.box, {
      method: 'PUT',
      headers: { 'X-Stamp': String(state.data.savedAt || Date.now()) },
      body: bufToB64(iv) + '.' + bufToB64(ct),
    });
    return r.ok;
  } catch (_) { return false; }
}

// împingerile se strâng: max una la câteva secunde, fără să încurce lecția
let pushT = null;
export function scheduleCloudPush() {
  if (!syncActive() || pushT) return;
  pushT = setTimeout(() => { pushT = null; cloudPush(); }, 4000);
}

export async function cloudPull() {
  if (!syncActive()) return false;
  try {
    const r = await fetch(cfg.url + '/drop/' + cfg.box);
    if (!r.ok) return false;
    const stamp = Number(r.headers.get('X-Stamp') || 0);
    if (!stamp || stamp <= ((state.data && state.data.savedAt) || 0)) return false;
    const [ivb, ctb] = (await r.text()).split('.');
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBuf(ivb) },
      await aesKey(), b64ToBuf(ctb));
    const d = JSON.parse(new TextDecoder().decode(pt));
    if (d && Array.isArray(d.profiles)) {
      // garda identitatii: o stare STRAINA (alt profil) nu are voie sa inlocuiasca
      // munca reala de pe acest telefon. Adoptarea unui profil strain e permisa doar
      // cand telefonul e practic gol (restaurare pe telefon nou / dupa reinstalare).
      const localP = state.profile;
      const remoteP = d.profiles.find(p => p.id === d.active) || d.profiles[0];
      const foreign = localP && remoteP && localP.id !== remoteP.id;
      const localLessons = (localP && localP.game && localP.game.stats && localP.game.stats.lessons) || 0;
      if (foreign && localLessons >= 3) {
        try { if (window.__logErr) window.__logErr('sync: stare straina in cutie refuzata (protejam progresul local)'); } catch (_) {}
        return false;
      }
      state.data = d;
      state.profile = remoteP || null;
      save(true);
      return true;
    }
  } catch (_) {}
  return false;
}

// fiecare salvare locală programează o împingere; la ascundere împingem imediat
window.addEventListener('ezr-saved', scheduleCloudPush);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') cloudPush();
});
