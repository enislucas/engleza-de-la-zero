// speech.js — TTS + STT cu plase de siguranță pentru Android Chrome și iOS Safari.
// Reguli din cercetare:
//  - getVoices() e async și uneori nu declanșează voiceschanged → timeout dur 3s.
//  - speak() trebuie pornit dintr-un gest al utilizatorului (iOS).
//  - SpeechRecognition: doar Chrome/Android real; pe iOS standalone e stricat → fallback.
//  - continuous=false întotdeauna (bug onend pe Android).

import { state } from './state.js';

let voices = [];
let voicesReady = false;
let enVoice = null;

// Scor de naturalețe: vocile neurale ("Natural"/"Online"/"Neural"/"Premium"/"Enhanced")
// sună incomparabil mai bine decât cele robotice clasice — le preferăm agresiv.
function voiceScore(v) {
  const n = (v.name || '').toLowerCase();
  let s = 0;
  if (n.includes('natural')) s += 100;
  if (n.includes('neural')) s += 90;
  if (n.includes('online')) s += 60;
  if (n.includes('premium') || n.includes('enhanced')) s += 50;
  if (n.includes('google')) s += 45;
  if (/\bsonia|libby|ryan|mia|kate|serena|daniel\b/.test(n)) s += 15;
  if (/en[-_]GB/i.test(v.lang)) s += 30;
  else if (/^en/i.test(v.lang)) s += 5;
  if (!v.localService) s += 8; // vocile din rețea sunt de regulă mai naturale pe Android
  return s;
}

export function listEnVoices() {
  return voices.filter(v => /^en/i.test(v.lang)).sort((a, b) => voiceScore(b) - voiceScore(a));
}

function pickEnVoice() {
  if (!voices.length) return null;
  // 1) alegerea explicită a utilizatorului (Profil → Vocea)
  const wanted = state.profile && state.profile.voiceName;
  if (wanted) {
    const hit = voices.find(v => v.name === wanted);
    if (hit) return hit;
  }
  // 2) cea mai naturală voce disponibilă
  const en = listEnVoices();
  return en[0] || null;
}

// re-alege vocea (după schimbarea setării sau a profilului)
export function refreshVoice() {
  enVoice = pickEnVoice();
  return enVoice;
}

function loadVoices() {
  try {
    voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  } catch (_) { voices = []; }
  if (voices.length) {
    enVoice = pickEnVoice();
    voicesReady = true;
  }
}

export function initSpeech() {
  if (!('speechSynthesis' in window)) return;
  loadVoices();
  try {
    window.speechSynthesis.onvoiceschanged = () => loadVoices();
  } catch (_) {}
  // Plasă de siguranță: pe unele Chrome-uri voiceschanged nu vine niciodată.
  setTimeout(loadVoices, 800);
  setTimeout(loadVoices, 3000);
}

export function ttsAvailable() {
  return 'speechSynthesis' in window;
}

let lastUtterance = null; // ținem referința — GC pe Chrome poate tăia vocea la mijloc

export function speak(text, opts = {}) {
  return new Promise((resolve) => {
    if (!ttsAvailable() || !text) { resolve(false); return; }
    try {
      const synth = window.speechSynthesis;
      const u = new SpeechSynthesisUtterance(text);
      const rate = opts.rate || 0.92;
      u.lang = opts.lang || 'en-GB';
      u.rate = rate;
      u.pitch = 1;
      if (!opts.lang || /^en/.test(opts.lang)) {
        if (!voicesReady) loadVoices();
        if (enVoice) u.voice = enVoice;
      }
      lastUtterance = u;
      let done = false;
      const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
      u.onend = () => finish(true);
      u.onerror = () => finish(false);
      // Plasă: dacă onend nu vine (bug cunoscut), eliberăm după un timp proporțional cu viteza.
      setTimeout(() => finish(true), (1500 + text.length * 90) / rate);
      const go = () => {
        try {
          synth.speak(u);
          // Chrome desktop: pauză automată după ~15s — resume periodic inofensiv.
          if (typeof synth.resume === 'function') {
            setTimeout(() => { try { if (synth.paused) synth.resume(); } catch (_) {} }, 300);
          }
        } catch (_) { finish(false); }
      };
      // iOS: cancel() e async sub capotă — speak() imediat după poate fi înghițit.
      if (synth.speaking || synth.pending) {
        synth.cancel();
        setTimeout(go, 80);
      } else {
        go();
      }
    } catch (_) { resolve(false); }
  });
}

export function speakSlow(text) {
  return speak(text, { rate: 0.6 });
}

export function stopSpeaking() {
  try { if (ttsAvailable()) window.speechSynthesis.cancel(); } catch (_) {}
}

// ---------- STT ----------

function SR() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function sttAvailable() {
  if (!SR()) return false;
  // iOS instalat ca aplicație (standalone): SpeechRecognition e nefuncțional — dezactivăm.
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIOS && standalone) return false;
  // STT are nevoie de internet (recunoașterea rulează în cloud).
  if (navigator.onLine === false) return false;
  return true;
}

let activeRec = null;

// Ascultă o singură replică. Returnează { ok, text } — nu aruncă niciodată.
export function listenOnce(lang = 'en-GB', maxMs = 8000) {
  return new Promise((resolve) => {
    const Rec = SR();
    if (!Rec || !sttAvailable()) { resolve({ ok: false, text: '', reason: 'unavailable' }); return; }
    let settled = false;
    const finish = (r) => {
      if (!settled) {
        settled = true;
        try { rec.stop(); } catch (_) {}
        activeRec = null;
        resolve(r);
      }
    };
    let rec;
    try {
      rec = new Rec();
      activeRec = rec;
      rec.lang = lang;
      rec.continuous = false;        // bug Android: cu true, onend nu mai vine
      rec.interimResults = false;
      rec.maxAlternatives = 3;
      rec.onresult = (e) => {
        let best = '';
        try {
          const alts = e.results[0];
          best = alts[0] ? alts[0].transcript : '';
          // păstrăm alternativele pentru potrivire mai blândă
          const all = [];
          for (let i = 0; i < alts.length; i++) all.push(alts[i].transcript);
          finish({ ok: true, text: best, alts: all });
          return;
        } catch (_) {}
        finish({ ok: !!best, text: best, alts: [best] });
      };
      rec.onerror = (e) => finish({ ok: false, text: '', reason: (e && e.error) || 'error' });
      rec.onend = () => finish({ ok: false, text: '', reason: 'silence' });
      rec.start();
      setTimeout(() => finish({ ok: false, text: '', reason: 'timeout' }), maxMs);
    } catch (_) {
      finish({ ok: false, text: '', reason: 'exception' });
    }
  });
}

export function stopListening() {
  try { if (activeRec) activeRec.stop(); } catch (_) {}
  activeRec = null;
}
