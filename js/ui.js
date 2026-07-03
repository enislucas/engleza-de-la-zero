// ui.js — toate ecranele + logica lecției. Fiecare randare e prinsă în try/catch:
// aplicația nu are voie să moară niciodată cu ecran alb.

import { state, save, todayStr, addProfile, switchProfile, applyPrefs, exportCode, importCode } from './state.js';
import * as G from './gamify.js';
import { TIERS, standings, syncLeague, daysLeftInWeek } from './league.js';
import { loadCourse, loadUnit, loadStartedUnits, unitProgress } from './course.js';
import { buildLesson, buildReview, recordAnswer, countDue, norm } from './engine.js';
import { mountExercise } from './exercises.js';
import { mascotSvg, CHEERS, SOFT_WRONG, pick } from './mascot.js';
import { speak, ttsAvailable, sttAvailable, stopSpeaking } from './speech.js';
import { sfx } from './sound.js';

const $app = () => document.getElementById('app');

function h(tag, cls, html) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html != null) el.innerHTML = html;
  return el;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function toast(msg, ms = 2200) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = h('div', 'toast', esc(msg));
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

function modal(title, bodyEl, opts = {}) {
  const back = h('div', 'modal-back');
  const m = h('div', 'modal');
  const close = h('button', 'm-close', '✕');
  close.addEventListener('click', () => { back.remove(); if (opts.onClose) opts.onClose(); });
  m.appendChild(close);
  if (title) m.appendChild(h('h3', '', esc(title)));
  m.appendChild(bodyEl);
  back.appendChild(m);
  back.addEventListener('click', (e) => { if (e.target === back && !opts.sticky) { back.remove(); if (opts.onClose) opts.onClose(); } });
  document.body.appendChild(back);
  return back;
}

function confirmModal(title, text, yesLabel, cb, opts = {}) {
  const body = h('div');
  body.appendChild(h('p', 'sub', text));
  const yes = h('button', 'btn btn-big ' + (opts.danger ? 'btn-danger' : 'btn-primary'), esc(yesLabel));
  const no = h('button', 'btn btn-big mt8', esc(opts.noLabel || 'Anulează'));
  body.appendChild(yes); body.appendChild(no);
  const back = modal(title, body);
  yes.addEventListener('click', () => { back.remove(); cb(true); });
  no.addEventListener('click', () => { back.remove(); cb(false); });
}

// ---------- bara de statistici ----------
function fmtMs(ms) {
  const m = Math.ceil(ms / 60000);
  if (m >= 60) return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
  return m + ' min';
}

function statbar() {
  const p = state.profile, g = p.game;
  const bar = h('div', 'statbar');
  const s = g.streak;
  const streakBtn = h('button', 'stat streak' + (s.travel ? ' frozen' : ''), `<span class="ico">${s.travel ? '✈️' : '🔥'}</span> ${s.count}`);
  streakBtn.addEventListener('click', showStreakModal);
  const gemBtn = h('button', 'stat gems', `<span class="ico">💎</span> ${g.gems}`);
  gemBtn.addEventListener('click', showShop);
  const hearts = G.heartsNow(p);
  const heartBtn = h('button', 'stat hearts', `<span class="ico">${hearts > 0 ? '❤️' : '🤍'}</span> ${hearts}`);
  heartBtn.addEventListener('click', showHeartsModal);
  const prof = h('button', 'stat', `<span class="ico">${esc(p.avatar)}</span>`);
  prof.setAttribute('aria-label', 'Profil');
  prof.addEventListener('click', () => nav('profile'));
  bar.appendChild(streakBtn); bar.appendChild(gemBtn); bar.appendChild(heartBtn); bar.appendChild(prof);
  return bar;
}

function navbar(active) {
  const items = [
    ['home', '🏠', 'Învață'],
    ['practice', '💪', 'Exersează'],
    ['league', '🏆', 'Liga'],
    ['quests', '🎯', 'Misiuni'],
    ['profile', '👤', 'Profil'],
  ];
  const nb = h('div', 'navbar');
  const inner = h('div', 'inner');
  for (const [id, ico, label] of items) {
    const b = h('button', 'nav-btn' + (active === id ? ' active' : ''), `<span class="nv-ico">${ico}</span><span class="nv-l">${label}</span>`);
    b.addEventListener('click', () => nav(id));
    inner.appendChild(b);
  }
  nb.appendChild(inner);
  return nb;
}

// ---------- navigare ----------
let currentRoute = 'home';
export function nav(route, arg) {
  currentRoute = route;
  stopSpeaking();
  try {
    if (route === 'home') renderHome();
    else if (route === 'practice') renderPractice();
    else if (route === 'league') renderLeague();
    else if (route === 'quests') renderQuests();
    else if (route === 'profile') renderProfile();
    else renderHome();
    window.scrollTo(0, 0);
  } catch (err) {
    renderCrash(err);
  }
}

function renderCrash(err) {
  try { if (window.__logErr) window.__logErr('ui: ' + (err && err.message)); } catch (_) {}
  const a = $app();
  a.innerHTML = '';
  const c = h('div', 'screen tc');
  c.appendChild(h('div', '', mascotSvg('sad')));
  c.appendChild(h('div', 'h1 tc', 'Ceva nu a mers.'));
  c.appendChild(h('p', 'sub tc', 'Nu-i nimic — progresul tău este salvat. Apasă mai jos.'));
  const b = h('button', 'btn btn-primary btn-big', 'Repornește');
  b.addEventListener('click', () => { location.reload(); });
  c.appendChild(b);
  a.appendChild(c);
}

// ---------- onboarding ----------
const AVATARS = ['😊', '🙂', '😃', '🧑', '👩', '👨', '👩‍🦳', '👨‍🦳', '🦉', '🐱'];
const THEMES = [
  { id: 'vesel', name: 'Vesel', desc: 'Colorat și jucăuș', dots: ['#58cc02', '#1cb0f6', '#ffc800', '#ffffff'] },
  { id: 'cald', name: 'Cald', desc: 'Culori calde, liniștit', dots: ['#d96f32', '#2a9d8f', '#e9c46a', '#fdf6ec'] },
  { id: 'minimal', name: 'Minimalist', desc: 'Simplu și modern', dots: ['#2563eb', '#0891b2', '#f59e0b', '#ffffff'] },
  { id: 'noapte', name: 'Noapte', desc: 'Întunecat, odihnitor', dots: ['#79d21f', '#4cc2ff', '#ffd23e', '#131f24'] },
];

export function renderOnboarding() {
  const a = $app();
  a.innerHTML = '';
  const wrap = h('div', 'onb');
  const body = h('div', 'onb-body');
  wrap.appendChild(body);
  a.appendChild(wrap);

  let step = 0;
  const data = { name: '', avatar: '😊', theme: 'vesel', goal: 20, track: 'general', fontScale: 1.15 };

  const nextBtn = h('button', 'btn btn-primary btn-big', 'CONTINUĂ');
  wrap.appendChild(nextBtn);

  function renderStep() {
    body.innerHTML = '';
    nextBtn.disabled = false;
    if (step === 0) {
      body.appendChild(h('div', 'big-mascot', mascotSvg('cheer')));
      body.appendChild(h('h1', '', 'Bine ai venit!'));
      body.appendChild(h('p', 'sub', 'Aici înveți engleza pas cu pas, câteva minute pe zi. În română, fără grabă, fără rușine.'));
      nextBtn.textContent = 'SĂ ÎNCEPEM';
    } else if (step === 1) {
      body.appendChild(h('div', 'big-mascot', mascotSvg('happy')));
      body.appendChild(h('h1', '', 'Cum te cheamă?'));
      const inp = h('input', 'name-in');
      inp.placeholder = 'Numele tău (ex. Maria)';
      inp.maxLength = 20;
      inp.value = data.name;
      inp.addEventListener('input', () => { data.name = inp.value.trim(); nextBtn.disabled = !data.name; });
      body.appendChild(inp);
      body.appendChild(h('p', 'sub mt16 tc', 'Alege și o figură:'));
      const ap = h('div', 'ava-pick');
      AVATARS.forEach(av => {
        const b = h('button', av === data.avatar ? 'on' : '', av);
        b.addEventListener('click', () => { data.avatar = av; ap.querySelectorAll('button').forEach(x => x.classList.remove('on')); b.classList.add('on'); });
        ap.appendChild(b);
      });
      body.appendChild(ap);
      nextBtn.disabled = !data.name;
      nextBtn.textContent = 'CONTINUĂ';
      setTimeout(() => { try { inp.focus(); } catch (_) {} }, 300);
    } else if (step === 2) {
      body.appendChild(h('h1', '', 'Alege cum să arate aplicația'));
      body.appendChild(h('p', 'sub', 'Poți schimba oricând, din Profil.'));
      const tp = h('div', 'theme-pick');
      THEMES.forEach(t => {
        const c = h('button', 'theme-card' + (t.id === data.theme ? ' on' : ''),
          `<div class="tc-name">${t.name}</div><div class="tc-dots">${t.dots.map(d => `<span class="dot" style="background:${d}"></span>`).join('')}</div><div class="set-d">${t.desc}</div>`);
        c.addEventListener('click', () => {
          data.theme = t.id;
          document.documentElement.setAttribute('data-theme', t.id);
          tp.querySelectorAll('.theme-card').forEach(x => x.classList.remove('on'));
          c.classList.add('on');
        });
        tp.appendChild(c);
      });
      body.appendChild(tp);
      body.appendChild(h('p', 'sub mt16', 'Mărimea textului:'));
      const seg = h('div', 'seg');
      [['1', 'Normal'], ['1.15', 'Mare'], ['1.3', 'Foarte mare']].forEach(([v, l]) => {
        const b = h('button', Number(v) === data.fontScale ? 'on' : '', l);
        b.addEventListener('click', () => {
          data.fontScale = Number(v);
          document.documentElement.style.setProperty('--fs', v);
          seg.querySelectorAll('button').forEach(x => x.classList.remove('on'));
          b.classList.add('on');
        });
        seg.appendChild(b);
      });
      body.appendChild(seg);
    } else if (step === 3) {
      body.appendChild(h('div', 'big-mascot', mascotSvg('teach')));
      body.appendChild(h('h1', '', 'Ce te interesează mai mult?'));
      body.appendChild(h('p', 'sub', 'Pe lângă lecțiile de bază, primești cuvinte în plus din domeniul tău.'));
      const opts = h('div', 'opts');
      [['general', '🌍 Engleză generală', 'Pentru viața de zi cu zi'],
       ['sanatate', '💊 Sănătate și farmacie', 'Pentru lucrul în domeniul medical'],
       ['munca', '🛃 Muncă, acte și securitate', 'Pentru lucru și instituții']].forEach(([id, t, d]) => {
        const b = h('button', 'opt' + (data.track === id ? ' sel' : ''), `<span><b>${t}</b><br><small style="color:var(--text2)">${d}</small></span>`);
        b.addEventListener('click', () => { data.track = id; opts.querySelectorAll('.opt').forEach(x => x.classList.remove('sel')); b.classList.add('sel'); });
        opts.appendChild(b);
      });
      body.appendChild(opts);
    } else if (step === 4) {
      body.appendChild(h('h1', '', 'De ce înveți engleza?'));
      body.appendChild(h('p', 'sub', 'Ca să-ți arătăm progresul care contează pentru tine.'));
      const opts = h('div', 'opts');
      [['munca_af', '💼 Pentru muncă', 'Un loc de muncă în străinătate'],
       ['familie', '👨‍👩‍👧 Pentru familie', 'Să fim aproape de copii și nepoți'],
       ['calatorie', '✈️ Pentru călătorii', 'Să mă descurc oriunde'],
       ['minte', '🧠 Pentru mine', 'Minte ageră și o limbă nouă']].forEach(([id, t, d]) => {
        const b = h('button', 'opt' + (data.why === id ? ' sel' : ''), `<span><b>${t}</b><br><small style="color:var(--text2)">${d}</small></span>`);
        b.addEventListener('click', () => { data.why = id; opts.querySelectorAll('.opt').forEach(x => x.classList.remove('sel')); b.classList.add('sel'); });
        opts.appendChild(b);
      });
      body.appendChild(opts);
    } else if (step === 5) {
      body.appendChild(h('div', 'big-mascot', mascotSvg('cheer')));
      body.appendChild(h('h1', '', `Gata, ${esc(data.name)}!`));
      body.appendChild(h('p', 'sub', 'Ținta: o lecție pe zi. Atât. Seria 🔥 crește cu fiecare zi în care înveți — și devine greu de abandonat.'));
      nextBtn.textContent = 'ÎNCEPE PRIMA LECȚIE';
    }
  }

  nextBtn.addEventListener('click', () => {
    if (step < 5) { step++; renderStep(); return; }
    const p = addProfile(data.name, data.avatar);
    p.theme = data.theme; p.fontScale = data.fontScale; p.track = data.track; p.dailyGoalXp = data.goal;
    p.why = data.why || 'minte';
    save(true);
    applyPrefs();
    nav('home');
  });

  renderStep();
}

// ---------- acasă (traseul) ----------
async function renderHome() {
  const a = $app();
  a.innerHTML = '';
  a.appendChild(statbar());
  const sc = h('div', 'screen');
  a.appendChild(sc);
  a.appendChild(navbar('home'));

  let meta;
  try { meta = await loadCourse(); } catch (err) {
    sc.appendChild(h('div', 'card tc', '📶 Nu s-au putut încărca lecțiile.<br>Verifică internetul și încearcă din nou.'));
    const rb = h('button', 'btn btn-primary btn-big mt8', 'Reîncearcă');
    rb.addEventListener('click', () => nav('home'));
    sc.appendChild(rb);
    return;
  }

  const p = state.profile;

  // mesaj de întâmpinare cu mascota (doar la început sau streak-risc)
  const s = p.game.streak;
  const didToday = s.lastDay === todayStr();
  if (p.game.stats.lessons === 0) {
    const ml = h('div', 'mascot-line');
    ml.innerHTML = mascotSvg('cheer');
    ml.appendChild(h('div', 'bubble', 'Apasă pe prima lecție și hai să începem! 👇'));
    sc.appendChild(ml);
  } else if (!didToday && !s.travel && s.count > 0) {
    const ml = h('div', 'mascot-line');
    ml.innerHTML = mascotSvg('think');
    ml.appendChild(h('div', 'bubble', `Seria ta de ${s.count} zile 🔥 te așteaptă. O lecție scurtă și e salvată!`));
    sc.appendChild(ml);
  } else if (s.travel) {
    const ml = h('div', 'mascot-line');
    ml.innerHTML = mascotSvg('travel');
    ml.appendChild(h('div', 'bubble', 'Protocolul de călătorie e activ — seria e pe pauză. O lecție îl oprește automat.'));
    sc.appendChild(ml);
  }

  // invitație blândă la instalare (o dată pe sesiune, după prima lecție)
  if (!isStandalone() && p.game.stats.lessons > 0 && !window.__installNudged) {
    window.__installNudged = true;
    const ic = h('div', 'card row');
    ic.innerHTML = `<span style="font-size:1.7rem">📲</span><div class="grow"><b>Pune aplicația pe ecran</b><div class="set-d">O deschizi cu o apăsare, ca pe WhatsApp</div></div>`;
    const ib = h('button', 'btn q-claim', 'Arată-mi');
    ib.addEventListener('click', showInstallHelp);
    ic.appendChild(ib);
    sc.appendChild(ic);
  }

  const filtered = meta.units.filter(u => !u.track || u.track === p.track);
  // deblocarea se calculează pe lista vizibilă pentru traseul ales
  let filteredCur = filtered.length - 1;
  for (let i = 0; i < filtered.length; i++) {
    const pr = unitProgress(p, filtered[i]);
    if (pr.done < pr.total || !pr.test) { filteredCur = i; break; }
  }
  filtered.forEach((u, idx) => {
    const prog = unitProgress(p, u);
    const locked = idx > filteredCur;
    const head = h('div', 'unit-head' + (locked ? ' locked' : ''));
    head.innerHTML = `<span class="u-ico">${esc(u.ico || '📘')}</span>
      <div><div class="u-t">${esc(u.title)}</div><div class="u-s">${esc(u.sub || '')} · ${esc(u.cefr || '')}</div></div>`;
    const gbtn = h('button', 'btn-guide', '📖');
    gbtn.setAttribute('aria-label', 'Ghid de gramatică');
    gbtn.addEventListener('click', () => showGuide(u));
    head.appendChild(gbtn);
    sc.appendChild(head);

    const path = h('div', 'path');
    const zig = [0, 28, 44, 28, 0, -28, -44, -28];
    for (let i = 0; i < u.lessonCount; i++) {
      const node = h('div', 'path-node');
      node.style.transform = `translateX(${zig[i % zig.length]}px)`;
      const done = i < prog.done;
      const isCurrent = !locked && i === prog.done;
      const isLocked = locked || i > prog.done;
      const b = h('button', 'lesson-btn' + (done ? ' done' : isLocked ? ' locked' : ''));
      b.innerHTML = done ? '✅' : isLocked ? '🔒' : '⭐';
      if (isCurrent) {
        node.classList.add('current');
        const bub = h('div', 'start-bubble', prog.done === 0 && idx === 0 && p.game.stats.lessons === 0 ? 'ÎNCEPE AICI' : 'CONTINUĂ');
        node.appendChild(bub);
      }
      if (!isLocked || done) {
        b.addEventListener('click', () => startLesson(u, i, { redo: done }));
      }
      node.appendChild(b);
      node.appendChild(h('div', 'lesson-label', esc((u.lessonTitles && u.lessonTitles[i]) || `Lecția ${i + 1}`)));
      path.appendChild(node);
    }
    // proba unității
    const tnode = h('div', 'path-node');
    const testUnlocked = !locked && prog.done >= u.lessonCount;
    const tb = h('button', 'lesson-btn test' + (prog.test ? ' done' : !testUnlocked ? ' locked' : ''));
    tb.innerHTML = prog.test ? '👑' : testUnlocked ? '🏁' : '🔒';
    if (testUnlocked || prog.test) tb.addEventListener('click', () => startLesson(u, -1, { test: true, redo: prog.test }));
    tnode.appendChild(tb);
    tnode.appendChild(h('div', 'lesson-label', 'Proba unității'));
    path.appendChild(tnode);
    sc.appendChild(path);
  });
}

async function showGuide(unitMeta) {
  try {
    const unit = await loadUnit(unitMeta.id);
    const body = h('div');
    if (!unit.grammar.length) body.appendChild(h('p', 'sub', 'Această unitate nu are reguli noi — doar vocabular.'));
    for (const g of unit.grammar) {
      const c = h('div', 'card flat');
      c.appendChild(h('div', '', `<b>${esc(g.title)}</b>`));
      c.appendChild(h('p', 'sub mt8', esc(g.body)));
      for (const ex of (g.examples || []).slice(0, 4)) {
        const row = h('div', 'row mt8');
        const ab = h('button', 'audio-btn small', '🔊');
        ab.addEventListener('click', () => speak(ex.en));
        row.appendChild(ab);
        row.appendChild(h('div', 'grow', `<b>${esc(ex.en)}</b><br><small style="color:var(--text2)">${esc(ex.ro)}</small>`));
        c.appendChild(row);
      }
      body.appendChild(c);
    }
    modal('📖 ' + unitMeta.title, body);
  } catch (_) {
    toast('Ghidul nu s-a putut încărca.');
  }
}

// ---------- modaluri statbar ----------
function showStreakModal() {
  const p = state.profile, s = p.game.streak;
  const body = h('div');
  body.appendChild(h('div', 'tc', mascotSvg(s.travel ? 'travel' : s.count > 0 ? 'cheer' : 'think')));
  body.appendChild(h('p', 'tc', `<b style="font-size:1.6rem">🔥 ${s.count} ${s.count === 1 ? 'zi' : 'zile'}</b>`));
  body.appendChild(h('p', 'sub tc', s.travel
    ? 'Protocol de călătorie ACTIV — seria e în siguranță, pe pauză.'
    : s.count > 0 ? 'Învață în fiecare zi ca să nu pierzi seria.' : 'Termină o lecție azi ca să pornești seria!'));
  // calendar ultimele 14 zile
  const cal = h('div', 'cal');
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const ds = todayStr(d);
    const hit = (p.game.stats.days[ds] || 0) > 0;
    cal.appendChild(h('div', 'c-d' + (hit ? ' hit' : ''), String(d.getDate())));
  }
  body.appendChild(cal);
  body.appendChild(h('p', 'sub mt16', `❄️ Înghețătoare de serie: <b>${s.freezes}</b>/2 — se folosesc singure dacă lipsești o zi.`));
  if (G.canRepairStreak(p)) {
    const rb = h('button', 'btn btn-primary btn-big mt8', `Repară seria de ${p.game.streak.lostStreak} zile (💎 ${G.COSTS.repair})`);
    rb.addEventListener('click', () => {
      if (G.repairStreak(p)) { sfx.streak(); toast('Seria a fost reparată! 🔥'); back.remove(); nav(currentRoute); }
      else toast('Nu ai destule rubine.');
    });
    body.appendChild(rb);
  }
  const back = modal('Seria ta', body);
}

function showHeartsModal() {
  const p = state.profile;
  const hearts = G.heartsNow(p);
  const body = h('div');
  body.appendChild(h('p', 'tc', `<span style="font-size:2.2rem">${'❤️'.repeat(hearts)}${'🤍'.repeat(G.HEARTS_MAX - hearts)}</span>`));
  if (hearts < G.HEARTS_MAX) {
    body.appendChild(h('p', 'sub tc', `O viață revine în ${fmtMs(G.nextHeartInMs(p))}. Exersarea nu costă vieți — și îți dă una înapoi.`));
    const pb = h('button', 'btn btn-big mt8', '💪 Exersează și primești o viață');
    pb.addEventListener('click', () => { back.remove(); nav('practice'); });
    body.appendChild(pb);
    const b1 = h('button', 'btn btn-big mt8', `+1 viață — 💎 ${G.COSTS.heartOne}`);
    b1.addEventListener('click', () => {
      if (G.buyHearts('one')) { sfx.gem(); back.remove(); toast('+1 viață ❤️'); nav(currentRoute); }
      else toast('Nu ai destule rubine.');
    });
    body.appendChild(b1);
    const bf = h('button', 'btn btn-primary btn-big mt8', `Plin complet — 💎 ${G.COSTS.heartsFull}`);
    bf.addEventListener('click', () => {
      if (G.buyHearts('full')) { sfx.gem(); back.remove(); toast('Vieți pline! ❤️❤️❤️❤️❤️'); nav(currentRoute); }
      else toast('Nu ai destule rubine.');
    });
    body.appendChild(bf);
  } else {
    body.appendChild(h('p', 'sub tc', 'Ai toate viețile. Greșelile din lecții costă câte o viață — dar prima greșeală pe zi e gratuită.'));
  }
  const back = modal('Vieți', body);
}

function showShop() {
  const p = state.profile, g = p.game;
  const body = h('div');
  body.appendChild(h('p', 'sub', `Ai <b>💎 ${g.gems} rubine</b>. Le câștigi din lecții, misiuni și ligă.`));
  const items = [
    { ico: '❄️', t: 'Înghețător de serie', d: `Se folosește singur dacă lipsești o zi. Ai ${g.streak.freezes}/2.`, cost: G.COSTS.freeze, can: g.streak.freezes < 2, act: () => G.buyFreeze() },
    { ico: '⚡', t: 'XP dublu 15 minute', d: 'Tot XP-ul se dublează un sfert de oră.', cost: G.COSTS.boost, can: !G.xpBoostActive(p), act: () => G.buyBoost() },
    { ico: '❤️', t: 'O viață', d: 'Îți dă o viață înapoi.', cost: G.COSTS.heartOne, can: G.heartsNow(p) < G.HEARTS_MAX, act: () => G.buyHearts('one') },
    { ico: '💖', t: 'Vieți pline', d: 'Toate cele 5 vieți, imediat.', cost: G.COSTS.heartsFull, can: G.heartsNow(p) < G.HEARTS_MAX, act: () => G.buyHearts('full') },
  ];
  for (const it of items) {
    const c = h('div', 'card flat shop-item');
    c.innerHTML = `<span class="s-ico">${it.ico}</span><div class="grow"><b>${it.t}</b><div class="set-d">${it.d}</div></div>`;
    const b = h('button', 'btn q-claim', `💎 ${it.cost}`);
    b.disabled = !it.can || g.gems < it.cost;
    b.addEventListener('click', () => {
      if (it.act()) { sfx.gem(); back.remove(); toast('Cumpărat! ✅'); showShop(); }
      else toast('Nu se poate acum.');
    });
    c.appendChild(b);
    body.appendChild(c);
  }
  const back = modal('💎 Magazin', body);
}

// ---------- lecția ----------
let lessonState = null;

async function startLesson(unitMeta, lessonIdx, opts = {}) {
  const p = state.profile;
  try {
    const unit = await loadUnit(unitMeta.id);
    const isTest = !!opts.test;
    if (!opts.review && G.heartsNow(p) === 0) { showHeartsModal(); return; }

    let exercises;
    const specs = unit.lessons || [];
    if (isTest) {
      const allVocab = specs.flatMap(l => l.vocab || []);
      const allSents = specs.flatMap(l => l.sentences || []);
      exercises = buildLesson(unit, {
        vocab: allVocab.slice(0, 24), sentences: allSents,
        grammar: (unit.grammar[0] || {}).id,
      }, { test: true, canListen: ttsAvailable(), canSpeak: sttAvailable() || ttsAvailable(), unit });
    } else {
      const spec = specs[lessonIdx];
      if (!spec) { toast('Lecția nu există încă.'); return; }
      exercises = buildLesson(unit, spec, { canListen: ttsAvailable(), canSpeak: ttsAvailable(), unit });
    }
    if (!exercises.length) { toast('Lecția nu are conținut.'); return; }
    lessonState = {
      unitMeta, unit, lessonIdx, isTest, redo: !!opts.redo, review: false,
      exercises, i: 0, right: 0, wrong: 0, listenRight: 0, freeMistakeUsed: false,
      combo: 0, bestCombo: 0,
    };
    renderExercise();
  } catch (err) {
    toast('Lecția nu s-a putut încărca. Verifică internetul.');
  }
}

async function startReview() {
  const p = state.profile;
  try {
    const datas = await loadStartedUnits(p);
    if (!datas.length) { toast('Termină întâi prima lecție. 🙂'); return; }
    const exercises = buildReview(datas, { canListen: ttsAvailable() });
    if (!exercises.length) { toast('Nu ai încă ce exersa — mai fă o lecție!'); return; }
    lessonState = {
      unitMeta: null, unit: null, lessonIdx: -1, isTest: false, redo: false, review: true,
      exercises, i: 0, right: 0, wrong: 0, listenRight: 0, freeMistakeUsed: true,
      combo: 0, bestCombo: 0,
    };
    renderExercise();
  } catch (_) {
    toast('Exersarea nu s-a putut încărca.');
  }
}

function renderExercise() {
  const L = lessonState;
  const a = $app();
  a.innerHTML = '';
  const p = state.profile;

  const top = h('div', 'lesson-top');
  const quit = h('button', 'btn-quit', '✕');
  quit.setAttribute('aria-label', 'Închide lecția');
  quit.addEventListener('click', () => {
    confirmModal('Ieși din lecție?', 'Progresul acestei lecții se pierde (dar nimic altceva).', 'Ieși', (yes) => {
      if (yes) { lessonState = null; nav('home'); }
    }, { danger: true, noLabel: 'Rămân' });
  });
  const prog = h('div', 'prog');
  const fill = h('div', 'prog-fill');
  fill.style.width = Math.round((L.i / L.exercises.length) * 100) + '%';
  prog.appendChild(fill);
  top.appendChild(quit); top.appendChild(prog);
  if (!L.review) {
    top.appendChild(h('div', 'lesson-hearts', '❤️ ' + G.heartsNow(p)));
  } else {
    top.appendChild(h('div', 'lesson-hearts', '💪'));
  }
  a.appendChild(top);

  const wrap = h('div', 'ex-wrap');
  a.appendChild(wrap);

  const ex = L.exercises[L.i];
  let skipAsOkMsg = null;

  const checkBar = h('div', 'check-bar');
  const inner = h('div', 'inner');
  checkBar.appendChild(inner);
  const checkBtn = h('button', 'btn btn-primary btn-big', 'VERIFICĂ');
  checkBtn.disabled = true;

  const ctx = {
    refresh: () => { checkBtn.disabled = !handle.ready(); },
    autoDone: (result) => finishExercise(result),
    allowSkipAsOk: (msg) => {
      skipAsOkMsg = msg;
      skipBtn.classList.remove('hidden');
    },
  };

  const handle = mountExercise(wrap, ex, ctx);

  const skipBtn = h('button', 'btn hidden', 'SARI PESTE');
  skipBtn.addEventListener('click', () => {
    finishExercise({ ok: true, noHeart: true, skipped: true, correctText: '', userText: '', wordIds: [] });
    if (skipAsOkMsg) toast(skipAsOkMsg);
  });
  if (handle.skippable) {
    skipBtn.textContent = handle.skippable;
    skipBtn.classList.remove('hidden');
  }

  if (!handle.noCheckButton) {
    if (handle.checkLabel) checkBtn.textContent = handle.checkLabel;
    inner.appendChild(skipBtn);
    inner.appendChild(checkBtn);
    checkBtn.style.flex = '1';
    checkBtn.disabled = !handle.ready();
    checkBtn.addEventListener('click', () => {
      const res = handle.check();
      if (res) finishExercise(res);
    });
  } else {
    inner.appendChild(h('div', 'fb', '<div class="fb-s tc">Potrivește toate perechile ca să continui.</div>'));
  }
  a.appendChild(checkBar);

  function finishExercise(res) {
    // înregistrăm SRS
    try { for (const wid of (res.wordIds || [])) recordAnswer(wid, res.ok); } catch (_) {}
    if (res.isIntro || res.skipped) { advance(res); return; }
    if (res.ok) {
      L.right++;
      L.combo++; L.bestCombo = Math.max(L.bestCombo, L.combo);
      if (res.isListen) L.listenRight++;
      sfx.correct();
    } else {
      L.wrong++;
      L.combo = 0;
      sfx.wrong();
      if (!res.noHeart && !L.review) {
        if (!L.freeMistakeUsed) {
          L.freeMistakeUsed = true;
          toast('Prima greșeală e gratuită. 😉');
        } else {
          G.loseHeart(p);
        }
      }
    }
    showFeedback(res);
  }

  function showFeedback(res) {
    checkBar.classList.add(res.ok ? 'ok' : 'bad');
    inner.innerHTML = '';
    const fb = h('div', 'fb ' + (res.ok ? 'okc' : 'badc'));
    if (res.ok) {
      const t = res.almost ? 'Corect! (o literă mică diferență)' : pick(CHEERS);
      fb.appendChild(h('div', 'fb-t', '✅ ' + t));
      if (res.almost) fb.appendChild(h('div', 'fb-s', esc(res.correctText)));
      else if (res.correctText && res.userText && norm(res.userText) !== norm(res.correctText)) fb.appendChild(h('div', 'fb-s', esc(res.correctText)));
    } else {
      fb.appendChild(h('div', 'fb-t', pick(SOFT_WRONG)));
      fb.appendChild(h('div', 'fb-s', '<b>' + esc(res.correctText) + '</b>'));
    }
    inner.appendChild(fb);
    const cont = h('button', 'btn ' + (res.ok ? 'btn-primary' : 'btn-danger'), 'CONTINUĂ');
    cont.addEventListener('click', () => advance(res));
    inner.appendChild(cont);
    try { cont.focus(); } catch (_) {}
  }

  function advance(res) {
    // greșit → reintroducem exercițiul la coadă (a doua șansă, ca la Duolingo)
    if (res && !res.ok && !res.skipped && !L.isTest) {
      const cur = L.exercises[L.i];
      if (!cur._requeued) {
        cur._requeued = true;
        L.exercises.push(cur);
      }
    }
    L.i++;
    if (L.i >= L.exercises.length) { finishLesson(); return; }
    renderExercise();
  }
}

function finishLesson() {
  const L = lessonState;
  const p = state.profile;
  lessonState = null;

  const total = L.right + L.wrong;
  const acc = total ? Math.round((L.right / total) * 100) : 100;
  const perfect = L.wrong === 0;

  // XP
  let base = L.review ? 8 : L.isTest ? 20 : 10;
  if (perfect && !L.review) base += 5;
  if (L.bestCombo >= 5) base += 3;
  const gained = G.addXp(base, p);

  // rubine (cufăr) — mai des la probă/perfect
  let gems = 0;
  if (L.isTest && acc >= 80) gems = 25;
  else if (perfect) gems = 10;
  else if (Math.random() < 0.35) gems = 5;
  if (gems) G.addGems(gems, p);

  // progres unitate
  let testPassed = false, testFailed = false;
  if (!L.review && L.unitMeta) {
    const st = p.game.units[L.unitMeta.id] || (p.game.units[L.unitMeta.id] = { done: 0, test: false });
    if (L.isTest) {
      if (acc >= 80) { if (!st.test) { st.test = true; testPassed = true; } }
      else testFailed = true;
    } else if (!L.redo && L.lessonIdx === st.done) {
      st.done++;
    }
  }

  // statistici + serie + misiuni
  p.game.stats.lessons++;
  if (perfect && !L.review) p.game.stats.perfect++;
  const streakRes = G.hitStreakToday(p);
  const questsDone = G.questEvent({
    xp: gained, lessons: L.review ? 0 : 1, perfect: perfect && !L.review ? 1 : 0,
    listen: L.listenRight, review: L.review ? 1 : 0,
  }, p);
  if (L.review) G.addHearts(1, p);
  save(true);

  // ecran rezultate
  const a = $app();
  a.innerHTML = '';
  const sc = h('div', 'results');
  const mood = testFailed ? 'sad' : perfect ? 'cheer' : 'happy';
  sc.appendChild(h('div', 'big-mascot', mascotSvg(mood)));
  sc.appendChild(h('div', 'res-title', testFailed
    ? 'Aproape! Îți trebuie 80% la probă.'
    : L.isTest ? '👑 Probă trecută!' : perfect ? 'Lecție PERFECTĂ!' : 'Lecție terminată!'));
  const cards = h('div', 'res-cards');
  cards.appendChild(h('div', 'res-chip xp', `<div class="rc-l">XP</div><div class="rc-v">+${gained}</div>`));
  cards.appendChild(h('div', 'res-chip acc', `<div class="rc-l">Precizie</div><div class="rc-v">${acc}%</div>`));
  if (gems) cards.appendChild(h('div', 'res-chip gem', `<div class="rc-l">Rubine</div><div class="rc-v">+${gems}</div>`));
  if (L.review) cards.appendChild(h('div', 'res-chip', `<div class="rc-l">Viață</div><div class="rc-v">+1 ❤️</div>`));
  sc.appendChild(cards);

  if (streakRes.extended) {
    sc.appendChild(h('p', '', `🔥 Seria: <b>${p.game.streak.count} ${p.game.streak.count === 1 ? 'zi' : 'zile'}</b>`));
    sfx.streak();
  }
  if (streakRes.milestone) {
    sc.appendChild(h('p', '', `🎉 <b>${streakRes.milestone} zile la rând!</b> Ai primit un cadou de rubine!`));
  }
  // mesaj legat de motivul lor real (cercetare: motivația concretă ține adulții în joc)
  if ((testPassed || streakRes.milestone) && p.why) {
    const WHY_MSG = {
      munca_af: 'Încă un pas spre lucrul în engleză. 💼',
      familie: 'Încă un pas mai aproape de ai tăi. 👨‍👩‍👧',
      calatorie: 'Te descurci tot mai bine oriunde. ✈️',
      minte: 'Mintea ta lucrează excelent. 🧠',
    };
    if (WHY_MSG[p.why]) sc.appendChild(h('p', 'sub', WHY_MSG[p.why]));
  }
  for (const q of questsDone) {
    sc.appendChild(h('p', '', `🎯 Misiune gata: <b>${esc(q.text)}</b> — revendică din Misiuni!`));
  }
  if (G.xpBoostActive(p)) sc.appendChild(h('p', 'sub', '⚡ XP dublu activ!'));

  const cont = h('button', 'btn btn-primary btn-big mt24', 'CONTINUĂ');
  cont.addEventListener('click', () => nav(L.review ? 'practice' : 'home'));
  sc.appendChild(cont);
  a.appendChild(sc);
  if (!testFailed) sfx.win();
  window.scrollTo(0, 0);
}

// ---------- exersare ----------
async function renderPractice() {
  const a = $app();
  a.innerHTML = '';
  a.appendChild(statbar());
  const sc = h('div', 'screen');
  a.appendChild(sc);
  a.appendChild(navbar('practice'));

  sc.appendChild(h('div', 'h1', 'Exersează 💪'));
  sc.appendChild(h('p', 'sub', 'Exersarea nu costă vieți — ba chiar primești una înapoi. Cuvintele slabe revin până le stăpânești.'));

  const p = state.profile;
  let due = 0;
  try {
    const datas = await loadStartedUnits(p);
    due = countDue(datas, p);
  } catch (_) {}

  const c1 = h('div', 'card row');
  c1.innerHTML = `<span style="font-size:2rem">🧠</span><div class="grow"><b>Repetă cuvintele</b><div class="set-d">${due > 0 ? `<b>${due}</b> cuvinte de repetat azi` : 'Recapitulare din tot ce ai învățat'}</div></div>`;
  const b1 = h('button', 'btn btn-primary q-claim', 'START');
  b1.addEventListener('click', startReview);
  c1.appendChild(b1);
  sc.appendChild(c1);

  const words = Object.values(p.game.words);
  const learned = words.filter(w => w.s >= 3).length;
  const inProgress = words.filter(w => w.s > 0 && w.s < 3).length;
  const c2 = h('div', 'card');
  c2.innerHTML = `<b>Progresul tău</b>
    <div class="row mt8" style="justify-content:space-around;text-align:center">
      <div><div style="font-size:1.5rem;font-weight:800;color:var(--success-text)">${learned}</div><div class="set-d">cuvinte știute</div></div>
      <div><div style="font-size:1.5rem;font-weight:800;color:var(--gold-text)">${inProgress}</div><div class="set-d">în lucru</div></div>
      <div><div style="font-size:1.5rem;font-weight:800;color:var(--accent-text)">${p.game.stats.lessons}</div><div class="set-d">lecții făcute</div></div>
    </div>`;
  sc.appendChild(c2);
}

// ---------- liga ----------
function renderLeague() {
  const a = $app();
  a.innerHTML = '';
  a.appendChild(statbar());
  const sc = h('div', 'screen');
  a.appendChild(sc);
  a.appendChild(navbar('league'));

  const p = state.profile;
  const ev = syncLeague(p);
  if (ev.closed && ev.promoted) {
    const ml = h('div', 'mascot-line');
    ml.innerHTML = mascotSvg('cheer');
    ml.appendChild(h('div', 'bubble', `🎉 Locul ${ev.rank} săptămâna trecută — ai PROMOVAT în ${TIERS[ev.newTier].name}!${ev.gems ? ` +💎${ev.gems}` : ''}`));
    sc.appendChild(ml);
    sfx.win();
  } else if (ev.closed && ev.demoted) {
    sc.appendChild(h('p', 'sub tc', `Săptămâna trecută a fost mai liniștită — continui în ${TIERS[ev.newTier].name}. Săptămâna asta o luăm de la capăt! 💪`));
  }

  const tier = p.game.league.tier || 0;
  const head = h('div', 'league-head');
  const tiers = h('div', 'league-tiers');
  TIERS.forEach((t, i) => tiers.appendChild(h('span', 't' + (i === tier ? ' cur' : ''), t.ico)));
  head.appendChild(tiers);
  head.appendChild(h('div', 'h1 tc', TIERS[tier].name));
  head.appendChild(h('p', 'sub tc', `Primii 3 promovează · se încheie în ${daysLeftInWeek()} ${daysLeftInWeek() === 1 ? 'zi' : 'zile'}`));
  sc.appendChild(head);

  const list = standings(p);
  list.forEach((r, i) => {
    if (i === 3) sc.appendChild(h('div', 'lg-zone up', '▲ ZONA DE PROMOVARE ▲'));
    const row = h('div', 'lg-row' + (r.me ? ' me' : ''));
    row.innerHTML = `<div class="lg-rank">${i + 1}</div><div class="lg-ava">${esc(r.ava)}</div>
      <div class="lg-name">${esc(r.name)}${r.me ? ' (tu)' : ''}</div><div class="lg-xp">${r.xp} XP</div>`;
    sc.appendChild(row);
  });
  sc.appendChild(h('p', 'sub tc mt16', 'Câștigi XP din lecții — clasamentul se mișcă toată săptămâna.'));
}

// ---------- misiuni ----------
function renderQuests() {
  const a = $app();
  a.innerHTML = '';
  a.appendChild(statbar());
  const sc = h('div', 'screen');
  a.appendChild(sc);
  a.appendChild(navbar('quests'));

  sc.appendChild(h('div', 'h1', 'Misiunile de azi 🎯'));
  sc.appendChild(h('p', 'sub', 'Misiuni noi în fiecare zi. Termină-le și câștigă rubine.'));

  const p = state.profile;
  const quests = G.syncQuests(p);
  for (const q of quests) {
    const c = h('div', 'card quest');
    const pct = Math.round((q.progress / q.goal) * 100);
    c.innerHTML = `<span class="q-ico">${q.ico}</span>
      <div class="grow"><b>${esc(q.text)}</b>
        <div class="q-bar"><div class="q-fill" style="width:${pct}%"></div></div>
        <div class="set-d">${q.progress}/${q.goal}</div>
      </div>`;
    if (q.claimed) {
      c.appendChild(h('div', 'price', '✅'));
    } else if (q.progress >= q.goal) {
      const b = h('button', 'btn btn-primary q-claim', `💎 ${q.gems}`);
      b.addEventListener('click', () => {
        const got = G.claimQuest(q.id, p);
        if (got) { sfx.gem(); toast(`+${got} rubine! 💎`); renderQuests(); }
      });
      c.appendChild(b);
    } else {
      c.appendChild(h('div', 'price', `💎 ${q.gems}`));
    }
    sc.appendChild(c);
  }

  const shopCard = h('div', 'card row');
  shopCard.innerHTML = `<span style="font-size:2rem">🛒</span><div class="grow"><b>Magazin</b><div class="set-d">Înghețătoare de serie, vieți, XP dublu</div></div>`;
  const sb = h('button', 'btn q-claim', 'Deschide');
  sb.addEventListener('click', showShop);
  shopCard.appendChild(sb);
  sc.appendChild(shopCard);
}

// ---------- profil ----------
function renderProfile() {
  const a = $app();
  a.innerHTML = '';
  a.appendChild(statbar());
  const sc = h('div', 'screen');
  a.appendChild(sc);
  a.appendChild(navbar('profile'));

  const p = state.profile, g = p.game;

  sc.appendChild(h('div', 'h1', `${esc(p.avatar)} ${esc(p.name)}`));
  const words = Object.values(g.words);
  const learned = words.filter(w => w.s >= 3).length;
  const activeDays = Object.keys(g.stats.days).length;

  const stats = h('div', 'card');
  stats.innerHTML = `<b>Progresul tău — negru pe alb</b>
    <div class="row mt8" style="justify-content:space-around;text-align:center">
      <div><div style="font-size:1.4rem;font-weight:800;color:var(--gold-text)">${g.xp}</div><div class="set-d">XP total</div></div>
      <div><div style="font-size:1.4rem;font-weight:800;color:var(--success-text)">${learned}</div><div class="set-d">cuvinte știute</div></div>
      <div><div style="font-size:1.4rem;font-weight:800;color:var(--accent-text)">${activeDays}</div><div class="set-d">zile de studiu</div></div>
    </div>`;
  // grafic ultimele 7 zile
  const days = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push(todayStr(d)); }
  const maxXp = Math.max(10, ...days.map(d => g.stats.days[d] || 0));
  const chart = h('div', 'row mt16', '');
  chart.style.alignItems = 'flex-end'; chart.style.height = '70px'; chart.style.gap = '6px';
  const DOW = ['D', 'L', 'Ma', 'Mi', 'J', 'V', 'S'];
  days.forEach(d => {
    const v = g.stats.days[d] || 0;
    const col = h('div', 'grow tc');
    const barH = Math.round((v / maxXp) * 50);
    col.innerHTML = `<div style="height:${Math.max(4, barH)}px;background:${v > 0 ? 'var(--primary)' : 'var(--line)'};border-radius:6px"></div>
      <div class="set-d" style="margin-top:4px">${DOW[new Date(d).getDay()]}</div>`;
    chart.appendChild(col);
  });
  stats.appendChild(chart);
  sc.appendChild(stats);

  // ---- setări ----
  const set = h('div', 'card');
  set.appendChild(h('b', '', 'Setări'));

  // temă
  const rowT = h('div', 'set-row');
  rowT.appendChild(h('div', '', '<div class="set-l">Aspect</div><div class="set-d">Culorile aplicației</div>'));
  const segT = h('div', 'seg');
  THEMES.forEach(t => {
    const b = h('button', p.theme === t.id ? 'on' : '', t.name);
    b.addEventListener('click', () => { p.theme = t.id; save(true); applyPrefs(); renderProfile(); });
    segT.appendChild(b);
  });
  rowT.appendChild(segT);
  set.appendChild(rowT);

  // mărime text
  const rowF = h('div', 'set-row');
  rowF.appendChild(h('div', '', '<div class="set-l">Mărimea textului</div>'));
  const segF = h('div', 'seg');
  [['1', 'Normal'], ['1.15', 'Mare'], ['1.3', 'F. mare']].forEach(([v, l]) => {
    const b = h('button', Math.abs(p.fontScale - Number(v)) < 0.01 ? 'on' : '', l);
    b.addEventListener('click', () => { p.fontScale = Number(v); save(true); applyPrefs(); renderProfile(); });
    segF.appendChild(b);
  });
  rowF.appendChild(segF);
  set.appendChild(rowF);

  // sunete
  const rowS = h('div', 'set-row');
  rowS.appendChild(h('div', '', '<div class="set-l">Sunete</div><div class="set-d">Efecte la răspunsuri</div>'));
  const segS = h('div', 'seg');
  [['on', 'Pornit'], ['off', 'Oprit']].forEach(([v, l]) => {
    const b = h('button', (p.soundOn !== false) === (v === 'on') ? 'on' : '', l);
    b.addEventListener('click', () => { p.soundOn = v === 'on'; save(true); renderProfile(); });
    segS.appendChild(b);
  });
  rowS.appendChild(segS);
  set.appendChild(rowS);

  sc.appendChild(set);

  // ---- protocol de călătorie ----
  const trav = h('div', 'card');
  const s = g.streak;
  trav.innerHTML = `<b>✈️ Protocol de călătorie</b>
    <p class="sub mt8">Pleci câteva zile și nu vei putea învăța? Pornește protocolul <b>înainte să pleci</b> — seria 🔥 se pune pe pauză și nu pierzi nimic. E mai bine să-l pornești tu din timp decât să pierzi seria și să te repare altcineva după.</p>`;
  const tb = h('button', 'btn btn-big ' + (s.travel ? 'btn-danger' : 'btn-primary'), s.travel ? 'OPREȘTE protocolul (m-am întors)' : 'PORNEȘTE protocolul');
  tb.addEventListener('click', () => {
    if (s.travel) {
      G.setTravel(false, p);
      toast('Bine ai revenit! Seria continuă de unde a rămas. 🔥');
      renderProfile();
    } else {
      confirmModal('Pornești Protocolul de călătorie?', 'Seria ta se pune pe pauză cât ești plecat. Prima lecție pe care o faci îl oprește automat. Pornește-l DOAR dacă chiar nu vei putea învăța — o lecție are doar câteva minute.', 'Da, plec la drum', (yes) => {
        if (yes) { G.setTravel(true, p); toast('Protocol activ. Drum bun! ✈️'); renderProfile(); }
      });
    }
  });
  trav.appendChild(tb);
  if (s.travel && s.travelStart) trav.appendChild(h('p', 'sub mt8', `Activ din ${s.travelStart}.`));
  sc.appendChild(trav);

  // ---- salvare progres ----
  const bk = h('div', 'card');
  bk.innerHTML = `<b>🔐 Codul de salvare</b>
    <p class="sub mt8">Dacă schimbi telefonul sau se șterge aplicația, progresul se recuperează cu acest cod. Trimite-l din când în când cuiva de încredere (de ex. pe WhatsApp la băieți).</p>`;
  const bexp = h('button', 'btn btn-big', '📋 Copiază codul de salvare');
  bexp.addEventListener('click', async () => {
    const code = exportCode();
    if (!code) { toast('Nu s-a putut genera codul.'); return; }
    let copied = false;
    try { await navigator.clipboard.writeText(code); copied = true; } catch (_) {}
    if (!copied) {
      const ta = h('textarea', 'type-in', '');
      ta.value = code;
      const body = h('div');
      body.appendChild(h('p', 'sub', 'Apasă lung pe text → Selectează tot → Copiază.'));
      body.appendChild(ta);
      modal('Codul tău', body);
    } else {
      toast('Cod copiat! Lipește-l în WhatsApp. ✅');
    }
  });
  bk.appendChild(bexp);
  const bimp = h('button', 'btn btn-big mt8', '📥 Am un cod — recuperează progresul');
  bimp.addEventListener('click', () => {
    const body = h('div');
    body.appendChild(h('p', 'sub', 'Lipește codul aici:'));
    const ta = h('textarea', 'type-in', '');
    body.appendChild(ta);
    const go = h('button', 'btn btn-primary btn-big mt8', 'Recuperează');
    go.addEventListener('click', () => {
      if (importCode(ta.value)) { applyPrefs(); toast('Progres recuperat! ✅'); back.remove(); nav('home'); }
      else toast('Codul nu e valid. Verifică-l.');
    });
    body.appendChild(go);
    const back = modal('Recuperare progres', body, { sticky: true });
  });
  bk.appendChild(bimp);
  sc.appendChild(bk);

  // ---- profiluri ----
  const pr = h('div', 'card');
  pr.appendChild(h('b', '', '👥 Profiluri pe acest telefon'));
  for (const prof of state.data.profiles) {
    const r = h('div', 'set-row');
    r.appendChild(h('div', '', `<div class="set-l">${esc(prof.avatar)} ${esc(prof.name)}${prof.id === p.id ? ' (activ)' : ''}</div>`));
    if (prof.id !== p.id) {
      const b = h('button', 'btn q-claim', 'Schimbă');
      b.addEventListener('click', () => { switchProfile(prof.id); applyPrefs(); nav('home'); toast(`Salut, ${prof.name}! 👋`); });
      r.appendChild(b);
    }
    pr.appendChild(r);
  }
  const addB = h('button', 'btn btn-big mt8', '+ Adaugă profil (pentru soț/soție)');
  addB.addEventListener('click', () => {
    confirmModal('Profil nou?', 'Fiecare persoană are progresul, seria și liga ei.', 'Da, adaugă', (yes) => {
      if (yes) renderOnboarding();
    });
  });
  pr.appendChild(addB);
  sc.appendChild(pr);

  // instalare pe telefon
  if (!isStandalone()) {
    const inst = h('div', 'card row');
    inst.innerHTML = `<span style="font-size:2rem">📲</span><div class="grow"><b>Pune aplicația pe ecranul telefonului</b><div class="set-d">Se deschide cu o singură apăsare, ca orice aplicație</div></div>`;
    const ib = h('button', 'btn btn-primary q-claim', 'Arată-mi');
    ib.addEventListener('click', showInstallHelp);
    inst.appendChild(ib);
    sc.appendChild(inst);
  }

  // despre
  sc.appendChild(h('p', 'sub tc mt16', 'Engleza de la Zero · făcută cu drag pentru voi ❤️'));
}

// ---------- instalare pe telefon ----------
function isStandalone() {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true || window.__installed;
  } catch (_) { return false; }
}

function showInstallHelp() {
  const body = h('div');
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);

  if (window.__bip) {
    // Android Chrome: instalare cu un buton
    body.appendChild(h('p', 'sub', 'Telefonul tău poate instala aplicația automat:'));
    const b = h('button', 'btn btn-primary btn-big', '📲 Instalează acum');
    b.addEventListener('click', async () => {
      try {
        const ev = window.__bip;
        window.__bip = null;
        ev.prompt();
        const choice = await ev.userChoice;
        back.remove();
        if (choice && choice.outcome === 'accepted') toast('Gata! Caută iconița verde pe ecran. ✅', 3500);
      } catch (_) { back.remove(); }
    });
    body.appendChild(b);
  } else if (isIOS && !isSafari) {
    body.appendChild(h('div', 'card flat', '⚠️ Pe iPhone, instalarea merge doar din <b>Safari</b>.<br><br>1. Deschide <b>Safari</b><br>2. Intră pe aceeași adresă<br>3. Revino la acest pas'));
  } else if (isIOS) {
    body.appendChild(h('div', 'card flat', `<b>Pe iPhone / iPad:</b><br><br>
      1. Apasă butonul <b>Distribuie</b> <span style="font-size:1.2rem">⬆️</span> (pătratul cu săgeată, jos în mijloc)<br><br>
      2. Derulează în jos și apasă <b>„Adaugă la ecranul principal”</b> („Add to Home Screen”)<br><br>
      3. Apasă <b>„Adaugă”</b> sus în dreapta<br><br>
      Gata! Iconița verde 🟢 apare pe ecran.`));
  } else {
    body.appendChild(h('div', 'card flat', `<b>Pe telefon Android (Chrome):</b><br><br>
      1. Apasă meniul <b>⋮</b> (trei puncte, sus în dreapta)<br><br>
      2. Apasă <b>„Adaugă la ecranul de pornire”</b> sau <b>„Instalează aplicația”</b><br><br>
      3. Confirmă cu <b>„Adaugă”</b><br><br>
      Gata! Iconița verde 🟢 apare pe ecran.`));
  }
  body.appendChild(h('p', 'sub mt8', 'Sfat: pune-ți și o alarmă zilnică (ex. la cafea ☕) — 5 minute pe zi ajung.'));
  const back = modal('📲 Instalare pe telefon', body);
}

// pornirea aplicației după încărcare
export function startApp() {
  applyPrefs();
  const p = state.profile;
  if (!p) { renderOnboarding(); return; }
  // sincronizări zilnice
  const ev = G.syncStreak(p);
  G.syncQuests(p);
  syncLeague(p);
  if (ev.frozenUsed) toast('❄️ Un înghețător ți-a salvat seria!', 3500);
  if (ev.lost && G.canRepairStreak(p)) {
    setTimeout(() => {
      confirmModal('Seria s-a întrerupt 😔', `Seria ta de ${p.game.streak.lostStreak} zile s-a pierdut ieri. O poți repara cu 💎 ${G.COSTS.repair} rubine (ai ${p.game.gems}).`, `Repar-o (💎 ${G.COSTS.repair})`, (yes) => {
        if (yes) {
          if (G.repairStreak(p)) { sfx.streak(); toast('Seria a fost reparată! 🔥'); nav('home'); }
          else toast('Nu ai destule rubine. 😕');
        }
      }, { noLabel: 'Încep alta' });
    }, 800);
  }
  nav('home');
}
