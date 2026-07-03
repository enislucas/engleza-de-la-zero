// sound.js — efecte sonore mici, sintetizate (fără fișiere audio). Respectă setarea "Sunete".
import { state } from './state.js';

let ctx = null;
function ac() {
  if (!ctx) {
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { return null; }
  }
  if (ctx && ctx.state === 'suspended') { try { ctx.resume(); } catch (_) {} }
  return ctx;
}

function tone(freq, t0, dur, type = 'sine', gain = 0.12) {
  const c = ac(); if (!c) return;
  try {
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, c.currentTime + t0);
    g.gain.linearRampToValueAtTime(gain, c.currentTime + t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + t0 + dur);
    o.connect(g); g.connect(c.destination);
    o.start(c.currentTime + t0); o.stop(c.currentTime + t0 + dur + 0.05);
  } catch (_) {}
}

function on() { return !state.profile || state.profile.soundOn !== false; }

export const sfx = {
  correct() { if (!on()) return; tone(660, 0, 0.12, 'sine'); tone(880, 0.09, 0.18, 'sine'); },
  wrong() { if (!on()) return; tone(220, 0, 0.25, 'triangle', 0.10); },
  tap() { if (!on()) return; tone(500, 0, 0.05, 'sine', 0.05); },
  win() { if (!on()) return; [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.22, 'sine')); },
  gem() { if (!on()) return; tone(1200, 0, 0.08, 'sine', 0.08); tone(1600, 0.07, 0.12, 'sine', 0.08); },
  streak() { if (!on()) return; [440, 554, 659, 880].forEach((f, i) => tone(f, i * 0.09, 0.18, 'square', 0.06)); },
};
