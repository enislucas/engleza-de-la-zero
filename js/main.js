// main.js — pornirea aplicației: stare, voci, service worker, plase de siguranță.

import { load, state, todayStr, save } from './state.js';
import { initSpeech } from './speech.js';
import { startApp, renderOnboarding, toast, nav } from './ui.js';
import { syncStreak, syncQuests } from './gamify.js';
import { syncLeague } from './league.js';
import { loadCourse } from './course.js';

// jurnal de erori (pentru depanare de la distanță — Profil > cod de salvare îl include)
window.__logErr = function (msg) {
  try {
    const k = 'ezr_errlog';
    const log = JSON.parse(localStorage.getItem(k) || '[]');
    log.push(new Date().toISOString() + ' ' + String(msg).slice(0, 300));
    while (log.length > 30) log.shift();
    localStorage.setItem(k, JSON.stringify(log));
  } catch (_) {}
};

let lastDay = todayStr();

async function boot() {
  initSpeech();
  await load();
  // preîncarcă lecțiile în fundal (nu blocăm pornirea)
  loadCourse().catch(() => {});
  window.__appStarted = true;
  startApp();
  const splash = document.getElementById('splash');
  if (splash) { splash.classList.add('hide'); setTimeout(() => splash.remove(), 500); }
  registerSW();
}

// La revenirea în aplicație (a doua zi): resincronizăm seria/misiunile.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !state.profile) return;
  const today = todayStr();
  if (today !== lastDay) {
    lastDay = today;
    try {
      syncStreak(state.profile);
      syncQuests(state.profile);
      syncLeague(state.profile);
      nav('home');
    } catch (_) {}
  }
});

// salvăm imediat când aplicația e trimisă în fundal
window.addEventListener('pagehide', () => { try { save(true); } catch (_) {} });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { try { save(true); } catch (_) {} }
});

// ---------- service worker + banner de actualizare ----------
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    if (!reg) return;
    // detectăm o versiune nouă
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          showUpdateBanner(reg);
        }
      });
    });
    // verificare periodică (o dată pe oră dacă aplicația stă deschisă)
    setInterval(() => { try { reg.update(); } catch (_) {} }, 60 * 60 * 1000);
  }).catch(() => {});

  let refreshed = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshed) return;
    refreshed = true;
    location.reload();
  });
}

function showUpdateBanner(reg) {
  if (document.querySelector('.update-banner')) return;
  const b = document.createElement('div');
  b.className = 'update-banner';
  b.innerHTML = '<span>Versiune nouă disponibilă!</span>';
  const btn = document.createElement('button');
  btn.textContent = 'Actualizează';
  btn.addEventListener('click', () => {
    try {
      if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    } catch (_) {}
    b.remove();
  });
  b.appendChild(btn);
  document.body.appendChild(b);
}

boot().catch((err) => {
  window.__logErr('boot: ' + (err && err.message));
  const be = document.getElementById('boot-error');
  if (be) be.style.display = 'flex';
});
