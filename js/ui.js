// ui.js — toate ecranele + logica lecției. Fiecare randare e prinsă în try/catch:
// aplicația nu are voie să moară niciodată cu ecran alb.

import { state, save, todayStr, addProfile, switchProfile, applyPrefs, exportCode, importCode } from './state.js';
import * as G from './gamify.js';
import { TIERS, standings, syncLeague, daysLeftInWeek } from './league.js';
import { loadCourse, loadUnit, loadStartedUnits, unitProgress } from './course.js';
import { buildLesson, buildReview, recordAnswer, countDue, norm } from './engine.js';
import { mountExercise, buildChipBank } from './exercises.js';
import { mascotSvg, CHEERS, SOFT_WRONG, RETRY_SOON, pick } from './mascot.js';
import { speak, ttsAvailable, sttAvailable, stopSpeaking, listEnVoices, refreshVoice } from './speech.js';
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

function statbar() {
  const p = state.profile, g = p.game;
  const bar = h('div', 'statbar');
  const s = g.streak;
  const streakBtn = h('button', 'stat streak' + (s.travel ? ' frozen' : ''), `<span class="ico">${s.travel ? '✈️' : '🔥'}</span> ${s.count}`);
  streakBtn.addEventListener('click', showStreakModal);
  const gemBtn = h('button', 'stat gems', `<span class="ico">💎</span> ${g.gems}`);
  gemBtn.addEventListener('click', showShop);
  const xpBtn = h('button', 'stat', `<span class="ico">⚡</span> ${g.xp}`);
  xpBtn.setAttribute('aria-label', 'XP total');
  xpBtn.addEventListener('click', () => nav('profile'));
  const prof = h('button', 'stat', `<span class="ico">${esc(p.avatar)}</span>`);
  prof.setAttribute('aria-label', 'Profil');
  prof.addEventListener('click', () => nav('profile'));
  bar.appendChild(streakBtn); bar.appendChild(gemBtn); bar.appendChild(xpBtn); bar.appendChild(prof);
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
let navSeq = 0; // jeton anti-randare-întârziată (ecran vechi peste ecran nou)
let inActivity = false; // dialog sau atelier de scriere în desfășurare

export function isLessonActive() { return !!lessonState || inActivity; }

export function nav(route, arg) {
  navSeq++;
  inActivity = false;
  currentRoute = route;
  stopSpeaking();
  // o actualizare a aplicației amânată în timpul lecției se aplică acum
  if (window.__pendingReload && !lessonState) { location.reload(); return; }
  try {
    let r;
    if (route === 'home') r = renderHome();
    else if (route === 'practice') r = renderPractice();
    else if (route === 'league') r = renderLeague();
    else if (route === 'quests') r = renderQuests();
    else if (route === 'profile') r = renderProfile();
    else r = renderHome();
    // ecranele async: orice eroare scăpată ajunge tot la ecranul prietenos
    if (r && typeof r.catch === 'function') r.catch(renderCrash);
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
      body.appendChild(h('h1', '', 'Pentru ce te pregătești?'));
      body.appendChild(h('p', 'sub', 'La exersare, primești mai des cuvintele care contează pentru tine.'));
      const opts = h('div', 'opts');
      [['general', '🌍 Engleză pentru orice', 'Un pic din toate, echilibrat'],
       ['viata', '🧳 Viața în altă țară', 'Acte, chirie, doctor, cumpărături, transport'],
       ['munca', '🔧 Muncă în străinătate', 'Depozit, hotel, curățenie, șantier, birou']].forEach(([id, t, d]) => {
        const b = h('button', 'opt' + (data.track === id ? ' sel' : ''), `<span><b>${t}</b><br><small style="color:var(--text2)">${d}</small></span>`);
        b.addEventListener('click', () => { data.track = id; opts.querySelectorAll('.opt').forEach(x => x.classList.remove('sel')); b.classList.add('sel'); });
        opts.appendChild(b);
      });
      body.appendChild(opts);
    } else if (step === 4) {
      body.appendChild(h('h1', '', 'De ce înveți engleza?'));
      body.appendChild(h('p', 'sub', 'Poți alege mai multe — îți arătăm progresul care contează pentru tine.'));
      data.why = Array.isArray(data.why) ? data.why : [];
      const opts = h('div', 'opts');
      [['munca_af', '💼 Pentru muncă', 'Un loc de muncă în străinătate'],
       ['familie', '👨‍👩‍👧 Pentru familie', 'Să fim aproape de copii și nepoți'],
       ['calatorie', '✈️ Pentru călătorii', 'Să mă descurc oriunde'],
       ['minte', '🧠 Pentru mine', 'Minte ageră și o limbă nouă']].forEach(([id, t, d]) => {
        const b = h('button', 'opt' + (data.why.includes(id) ? ' sel' : ''), `<span><b>${t}</b><br><small style="color:var(--text2)">${d}</small></span>`);
        b.addEventListener('click', () => {
          const i = data.why.indexOf(id);
          if (i >= 0) { data.why.splice(i, 1); b.classList.remove('sel'); }
          else { data.why.push(id); b.classList.add('sel'); }
        });
        opts.appendChild(b);
      });
      body.appendChild(opts);
    } else if (step === 5) {
      body.appendChild(h('div', 'big-mascot', mascotSvg('cheer')));
      body.appendChild(h('h1', '', `Gata, ${esc(data.name)}!`));
      body.appendChild(h('p', 'sub', 'Ținta: o lecție pe zi. Atât. Fiecare lecție îți aduce XP (puncte de progres), iar seria 🔥 crește cu fiecare zi în care înveți.'));
      nextBtn.textContent = 'ÎNCEPE PRIMA LECȚIE';
    }
  }

  nextBtn.addEventListener('click', () => {
    if (step < 5) { step++; renderStep(); return; }
    const p = addProfile(data.name, data.avatar);
    p.theme = data.theme; p.fontScale = data.fontScale; p.track = data.track; p.dailyGoalXp = data.goal;
    p.why = (Array.isArray(data.why) && data.why.length) ? data.why : ['minte'];
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
    // dialog (după jumătate din lecții) și scriere (după toate lecțiile)
    if (u.dlg > 0) {
      const dNode = h('div', 'path-node');
      const dDone = (p.game.units[u.id] && p.game.units[u.id].dlg) || 0;
      const dUnlocked = !locked && prog.done >= Math.ceil(u.lessonCount / 2);
      const db = h('button', 'lesson-btn' + (dDone >= u.dlg ? ' done' : !dUnlocked ? ' locked' : ''));
      db.innerHTML = dDone >= u.dlg ? '💬' : dUnlocked ? '💬' : '🔒';
      if (dUnlocked) db.addEventListener('click', () => startDialog(u));
      dNode.appendChild(db);
      dNode.appendChild(h('div', 'lesson-label', 'Conversație'));
      path.appendChild(dNode);
    }
    if (u.wr > 0) {
      const wNode = h('div', 'path-node');
      const wDone = (p.game.units[u.id] && p.game.units[u.id].wr) || 0;
      const wUnlocked = !locked && prog.done >= u.lessonCount;
      const wb = h('button', 'lesson-btn' + (wDone >= u.wr ? ' done' : !wUnlocked ? ' locked' : ''));
      wb.innerHTML = wDone >= u.wr ? '✍️' : wUnlocked ? '✍️' : '🔒';
      if (wUnlocked) wb.addEventListener('click', () => startWriting(u));
      wNode.appendChild(wb);
      wNode.appendChild(h('div', 'lesson-label', 'Scriere'));
      path.appendChild(wNode);
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

function showShop() {
  const p = state.profile, g = p.game;
  const body = h('div');
  body.appendChild(h('p', 'sub', `Ai <b>💎 ${g.gems} rubine</b>. Le câștigi din lecții, misiuni și ligă.`));
  const items = [
    { ico: '❄️', t: 'Înghețător de serie', d: `Se folosește singur dacă lipsești o zi. Ai ${g.streak.freezes}/2.`, cost: G.COSTS.freeze, can: g.streak.freezes < 2, act: () => G.buyFreeze() },
    { ico: '⚡', t: 'XP dublu 15 minute', d: 'Tot XP-ul se dublează un sfert de oră.', cost: G.COSTS.boost, can: !G.xpBoostActive(p), act: () => G.buyBoost() },
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
  const mySeq = navSeq;
  try {
    const unit = await loadUnit(unitMeta.id);
    if (mySeq !== navSeq) return; // utilizatorul a plecat de pe ecran între timp
    const isTest = !!opts.test;

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
      exercises, i: 0, right: 0, wrong: 0, listenRight: 0,
      combo: 0, bestCombo: 0,
    };
    renderExercise();
  } catch (err) {
    toast('Lecția nu s-a putut încărca. Verifică internetul.');
  }
}

async function startReview() {
  const p = state.profile;
  const mySeq = navSeq;
  try {
    const datas = await loadStartedUnits(p);
    if (mySeq !== navSeq) return;
    if (!datas.length) { toast('Termină întâi prima lecție. 🙂'); return; }
    const FOCUS = { viata: [8, 11, 12, 19], sanatate: [8, 11, 12, 19], munca: [7, 15, 17, 18] };
    const exercises = buildReview(datas, { canListen: ttsAvailable(), focusBooks: FOCUS[p.track] || [] });
    if (!exercises.length) { toast('Nu ai încă ce exersa — mai fă o lecție!'); return; }
    lessonState = {
      unitMeta: null, unit: null, lessonIdx: -1, isTest: false, redo: false, review: true,
      exercises, i: 0, right: 0, wrong: 0, listenRight: 0,
      combo: 0, bestCombo: 0,
    };
    renderExercise();
  } catch (_) {
    toast('Exersarea nu s-a putut încărca.');
  }
}

function renderExercise() {
  const L = lessonState;
  if (!L) return;
  L._settled = false; // permite o singură evaluare per exercițiu (anti dublu-tap)
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
  top.appendChild(h('div', 'lesson-hearts', L.review ? '💪' : '⭐'));
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
    // răspunsul corect se dezvăluie abia la a doua ratare a ACELUIAȘI exercițiu
    reveal: (ex._misses || 0) >= 1,
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
      if (L._settled) return;
      const res = handle.check();
      if (res) { checkBtn.disabled = true; finishExercise(res); }
    });
  } else {
    inner.appendChild(h('div', 'fb', '<div class="fb-s tc">Potrivește toate perechile ca să continui.</div>'));
  }
  a.appendChild(checkBar);

  function finishExercise(res) {
    if (L._settled) return; // deja evaluat (dublu-tap / autoDone dublu)
    L._settled = true;
    // înregistrăm SRS
    try { for (const wid of (res.wordIds || [])) recordAnswer(wid, res.ok); } catch (_) {}
    if (res.isIntro || res.skipped) { advance(res); return; }
    if (res.ok) {
      L.right++;
      L.combo++; L.bestCombo = Math.max(L.bestCombo, L.combo);
      if (res.isListen) L.listenRight++;
      sfx.correct(L.combo);
    } else {
      L.wrong++;
      L.combo = 0;
      ex._misses = (ex._misses || 0) + 1;
      sfx.wrong();
      // greșelile nu costă nimic: exercițiul revine până e stăpânit — asta e „taxa”
    }
    showFeedback(res);
  }

  function showFeedback(res) {
    checkBar.classList.add(res.ok ? 'ok' : 'bad');
    inner.innerHTML = '';
    const fb = h('div', 'fb ' + (res.ok ? 'okc' : 'badc'));
    if (res.ok) {
      const t = res.almost ? 'Corect! (o mică greșeală de scriere)' : pick(CHEERS);
      fb.appendChild(h('div', 'fb-t', '✅ ' + t));
      if (res.almost) fb.appendChild(h('div', 'fb-s', esc(res.correctText)));
      else if (res.correctText && res.userText && norm(res.userText) !== norm(res.correctText)) fb.appendChild(h('div', 'fb-s', esc(res.correctText)));
    } else if ((ex._misses || 0) >= 2) {
      // a doua ratare: acum arătăm forma corectă, ca să o aplice la următoarea revenire
      fb.appendChild(h('div', 'fb-t', pick(SOFT_WRONG)));
      fb.appendChild(h('div', 'fb-s', '<b>' + esc(res.correctText) + '</b>'));
    } else {
      // prima ratare: fără răspuns — îl cauți singur când exercițiul revine (așa se fixează)
      fb.appendChild(h('div', 'fb-t', pick(RETRY_SOON)));
      fb.appendChild(h('div', 'fb-s', L.isTest ? 'Se punctează la final.' : 'Exercițiul revine imediat.'));
    }
    inner.appendChild(fb);
    const cont = h('button', 'btn ' + (res.ok ? 'btn-primary' : 'btn-danger'), 'CONTINUĂ');
    cont.addEventListener('click', () => { if (cont.disabled) return; cont.disabled = true; advance(res); });
    inner.appendChild(cont);
    try { cont.focus(); } catch (_) {}
  }

  function advance(res) {
    // greșit → exercițiul revine la coadă până e stăpânit (max 3 încercări)
    if (res && !res.ok && !res.skipped && !L.isTest) {
      const cur = L.exercises[L.i];
      if ((cur._misses || 0) <= 2) L.exercises.push(cur);
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
  // închide săptămâna de ligă dacă tocmai a trecut granița de luni — altfel XP-ul
  // de acum s-ar vărsa în săptămâna veche
  try { syncLeague(p); } catch (_) {}

  const total = L.right + L.wrong;
  const acc = total ? Math.round((L.right / total) * 100) : 100;
  const perfect = L.wrong === 0;

  // XP
  let base = L.review ? 8 : L.isTest ? 20 : 10;
  if (perfect && !L.review) base += 5;
  if (L.bestCombo >= 5) base += 3;
  const gained = G.addXp(base, p);

  // rubine — recompense fixe și previzibile: știi mereu pentru ce muncești
  let gems = 0;
  if (L.isTest && acc >= 80) gems = 25;
  else if (perfect) gems = 10;
  else if (L.review) gems = 2;
  else gems = 3;
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
  sc.appendChild(cards);

  if (streakRes.extended) {
    sc.appendChild(h('p', '', `🔥 Seria: <b>${p.game.streak.count} ${p.game.streak.count === 1 ? 'zi' : 'zile'}</b>`));
    sfx.streak();
  }
  if (streakRes.milestone) {
    sc.appendChild(h('p', '', `🎉 <b>${streakRes.milestone} zile la rând!</b> Ai primit un cadou de rubine!`));
  }
  // mesaj legat de motivele lor reale (cercetare: motivația concretă ține adulții în joc)
  if ((testPassed || streakRes.milestone) && p.why) {
    const WHY_MSG = {
      munca_af: 'Încă un pas spre lucrul în engleză. 💼',
      familie: 'Încă un pas mai aproape de ai tăi. 👨‍👩‍👧',
      calatorie: 'Te descurci tot mai bine oriunde. ✈️',
      minte: 'Mintea ta lucrează excelent. 🧠',
    };
    const whys = Array.isArray(p.why) ? p.why : [p.why];
    const chosen = whys.filter(w => WHY_MSG[w]);
    if (chosen.length) {
      // rotim printre motivele alese, ca mesajul să nu se repete mecanic
      const msg = WHY_MSG[chosen[p.game.stats.lessons % chosen.length]];
      sc.appendChild(h('p', 'sub', msg));
    }
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
  sc.appendChild(h('p', 'sub', 'Cuvintele slabe revin aici până le stăpânești. Cinci minute de exersare țin vocabularul viu.'));

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

  // jocuri arcade — repetare deghizată în distracție
  const g1 = h('div', 'card row');
  g1.innerHTML = `<span style="font-size:2rem">⚡</span><div class="grow"><b>Blitz — 60 de secunde</b><div class="set-d">Câte cuvinte recunoști contra cronometru?${p.game.stats.blitzBest ? ` Record: <b>${p.game.stats.blitzBest}</b>` : ''}</div></div>`;
  const gb1 = h('button', 'btn btn-primary q-claim', 'JOACĂ');
  gb1.addEventListener('click', startBlitz);
  g1.appendChild(gb1);
  sc.appendChild(g1);

  const g2 = h('div', 'card row');
  g2.innerHTML = `<span style="font-size:2rem">🧩</span><div class="grow"><b>Perechi</b><div class="set-d">Găsește cuvântul și sensul lui — din memorie</div></div>`;
  const gb2 = h('button', 'btn btn-primary q-claim', 'JOACĂ');
  gb2.addEventListener('click', startMemory);
  g2.appendChild(gb2);
  sc.appendChild(g2);

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

// ---------- jocuri arcade ----------
// cuvintele deja învățate, în joc contra cronometru — repetare deghizată în distracție
function learnedPool(datas, minSeen = 1) {
  const p = state.profile;
  const pool = [];
  for (const u of datas) {
    for (const v of u.vocab) {
      const w = p.game.words[v.id];
      if (w && w.seen >= minSeen) pool.push(v);
    }
  }
  return pool;
}

function pickOthers(pool, word, n) {
  const out = [];
  const seen = new Set([norm(word.ro), norm(word.en)]);
  const shuffled = pool.slice().sort(() => Math.random() - 0.5);
  for (const c of shuffled) {
    if (out.length >= n) break;
    if (c.id === word.id || seen.has(norm(c.ro)) || seen.has(norm(c.en))) continue;
    seen.add(norm(c.ro)); seen.add(norm(c.en));
    out.push(c);
  }
  // completare relaxată: mai bine 4 variante cu sensuri apropiate decât doar 2 butoane
  if (out.length < n) {
    for (const c of shuffled) {
      if (out.length >= n) break;
      if (c.id === word.id || out.includes(c)) continue;
      if (norm(c.ro) === norm(word.ro) || norm(c.en) === norm(word.en)) continue;
      out.push(c);
    }
  }
  return out;
}

async function startBlitz() {
  const p = state.profile;
  const mySeq = ++navSeq; // omoară orice joc/timer rămas din spate (și dublu-tap pe JOACĂ)
  let pool;
  try {
    pool = learnedPool(await loadStartedUnits(p));
  } catch (_) { toast('Nu s-a putut încărca.'); return; }
  if (mySeq !== navSeq) return;
  if (pool.length < 8) { toast('Mai învață câteva cuvinte întâi — jocul folosește ce știi deja. 🙂'); return; }
  inActivity = true; // o actualizare a aplicației nu are voie să întrerupă jocul
  const scored = new Set(); // SRS-ul se atinge o singură dată per cuvânt per joc

  const a = $app();
  a.innerHTML = '';
  const wrap = h('div', 'screen');
  a.appendChild(wrap);
  const top = h('div', 'blitz-top');
  const quit = h('button', 'btn-quit', '✕');
  const timerEl = h('div', 'blitz-timer', '60');
  const scoreEl = h('div', 'blitz-score', '⚡ 0');
  top.appendChild(quit); top.appendChild(timerEl); top.appendChild(scoreEl);
  wrap.appendChild(top);
  const qArea = h('div', '');
  wrap.appendChild(qArea);

  let left = 60, score = 0, wrong = 0, over = false;
  const iv = setInterval(() => {
    if (navSeq !== mySeq) { clearInterval(iv); return; }
    left--;
    timerEl.textContent = String(left);
    if (left <= 10) timerEl.classList.add('low');
    if (left <= 0) { clearInterval(iv); endGame(); }
  }, 1000);
  quit.addEventListener('click', () => { over = true; clearInterval(iv); nav('practice'); });

  function nextQ() {
    if (over || navSeq !== mySeq) return;
    qArea.innerHTML = '';
    // preferăm cuvinte neîntrebate încă în acest joc
    const fresh = pool.filter(x => !scored.has(x.id));
    const src = fresh.length >= 4 ? fresh : pool;
    const w = src[Math.floor(Math.random() * src.length)];
    const dir = Math.random() < 0.5;
    qArea.appendChild(h('div', 'blitz-word', esc(dir ? w.en : w.ro)));
    const opts = h('div', 'opts');
    const options = [w, ...pickOthers(pool, w, 3)].sort(() => Math.random() - 0.5);
    let locked = false;
    options.forEach((o) => {
      const b = h('button', 'opt', `<span>${esc(dir ? o.ro : o.en)}</span>`);
      b.addEventListener('click', () => {
        if (locked || over) return;
        locked = true;
        const ok = o.id === w.id;
        b.classList.add(ok ? 'correct' : 'wrong');
        if (!scored.has(w.id)) {
          scored.add(w.id);
          try { recordAnswer(w.id, ok); } catch (_) {}
        }
        if (ok) { score++; scoreEl.textContent = '⚡ ' + score; sfx.correct(Math.min(score, 8)); }
        else { wrong++; sfx.wrong(); [...opts.children].forEach((x, xi) => { if (options[xi].id === w.id) x.classList.add('correct'); }); }
        setTimeout(nextQ, ok ? 250 : 700);
      });
      opts.appendChild(b);
    });
    qArea.appendChild(opts);
  }

  function endGame() {
    if (over || navSeq !== mySeq) return;
    over = true;
    const best = Math.max(score, p.game.stats.blitzBest || 0);
    const isRecord = score > 0 && score >= best && score > (p.game.stats.blitzBest || 0);
    p.game.stats.blitzBest = best;
    const gained = G.addXp(Math.min(score, 20), p);
    const gems = score >= 15 ? 6 : score >= 8 ? 4 : 2;
    G.addGems(gems, p);
    G.hitStreakToday(p);
    G.questEvent({ xp: gained, review: 1 }, p);
    save(true);
    a.innerHTML = '';
    const sc = h('div', 'results');
    sc.appendChild(h('div', 'big-mascot', mascotSvg(score >= 10 ? 'cheer' : 'happy')));
    sc.appendChild(h('div', 'res-title', isRecord ? '🏅 RECORD NOU!' : 'Timpul a expirat!'));
    const cards = h('div', 'res-cards');
    cards.appendChild(h('div', 'res-chip acc', `<div class="rc-l">Corecte</div><div class="rc-v">${score}</div>`));
    cards.appendChild(h('div', 'res-chip xp', `<div class="rc-l">XP</div><div class="rc-v">+${gained}</div>`));
    cards.appendChild(h('div', 'res-chip gem', `<div class="rc-l">Rubine</div><div class="rc-v">+${gems}</div>`));
    sc.appendChild(cards);
    sc.appendChild(h('p', 'sub', `Recordul tău: <b>${best}</b>. ${score >= best ? 'Îl poți depăși mâine!' : 'Mai încearcă o dată?'}`));
    const again = h('button', 'btn btn-primary btn-big mt16', '⚡ ÎNCĂ O DATĂ');
    again.addEventListener('click', () => startBlitz());
    const out = h('button', 'btn btn-big mt8', 'Înapoi');
    out.addEventListener('click', () => nav('practice'));
    sc.appendChild(again); sc.appendChild(out);
    a.appendChild(sc);
    sfx.win();
  }

  nextQ();
}

async function startMemory() {
  const p = state.profile;
  const mySeq = ++navSeq; // omoară orice joc rămas din spate + dublu-tap
  let pool;
  try {
    pool = learnedPool(await loadStartedUnits(p));
  } catch (_) { toast('Nu s-a putut încărca.'); return; }
  if (mySeq !== navSeq) return;
  if (pool.length < 6) { toast('Mai învață câteva cuvinte întâi. 🙂'); return; }
  inActivity = true;

  // 6 perechi: cele mai slabe cuvinte primele (repetare utilă, nu doar joc)
  const weak = pool.slice().sort((x, y) => {
    const wx = p.game.words[x.id], wy = p.game.words[y.id];
    return (wx ? wx.s : 9) - (wy ? wy.s : 9);
  }).slice(0, 12);
  const six = weak.sort(() => Math.random() - 0.5).slice(0, 6);
  const cards = six.flatMap(w => [{ wid: w.id, txt: w.en, k: 'en' }, { wid: w.id, txt: w.ro, k: 'ro' }])
    .sort(() => Math.random() - 0.5);

  const a = $app();
  a.innerHTML = '';
  const wrap = h('div', 'screen');
  a.appendChild(wrap);
  const top = h('div', 'blitz-top');
  const quit = h('button', 'btn-quit', '✕');
  const movesEl = h('div', 'blitz-score', '🧩 0 mutări');
  top.appendChild(quit); top.appendChild(h('div', 'h2', 'Perechi')); top.appendChild(movesEl);
  wrap.appendChild(top);
  wrap.appendChild(h('p', 'sub tc', 'Găsește perechea: cuvântul englez și sensul lui.'));
  quit.addEventListener('click', () => nav('practice'));

  const grid = h('div', 'mem-grid');
  wrap.appendChild(grid);
  let openCard = null, lock = false, moves = 0, matched = 0;

  cards.forEach((c) => {
    const b = h('button', 'mem-card hidden-face', '❓');
    b.addEventListener('click', () => {
      if (lock || b === openCard || b.classList.contains('matched') || navSeq !== mySeq) return;
      sfx.tap();
      b.classList.remove('hidden-face');
      b.textContent = c.txt;
      if (c.k === 'en') speak(c.txt);
      if (!openCard) { openCard = b; openCard._c = c; return; }
      moves++;
      movesEl.textContent = '🧩 ' + moves + ' mutări';
      const oc = openCard._c;
      const ob = openCard;
      openCard = null;
      if (oc.wid === c.wid && oc.k !== c.k) {
        b.classList.add('matched'); ob.classList.add('matched');
        matched++; sfx.correct(matched);
        try { recordAnswer(c.wid, true); } catch (_) {}
        if (matched === 6) setTimeout(endGame, 500);
      } else {
        lock = true;
        b.classList.add('wrongpair'); ob.classList.add('wrongpair');
        sfx.wrong();
        setTimeout(() => {
          [b, ob].forEach(x => { x.classList.remove('wrongpair'); x.classList.add('hidden-face'); x.textContent = '❓'; });
          lock = false;
        }, 750);
      }
    });
    grid.appendChild(b);
  });

  function endGame() {
    if (navSeq !== mySeq) return;
    const stars = moves <= 9 ? 3 : moves <= 14 ? 2 : 1;
    const gained = G.addXp(stars * 4, p);
    G.addGems(3, p);
    G.hitStreakToday(p);
    G.questEvent({ xp: gained, review: 1 }, p);
    save(true);
    a.innerHTML = '';
    const sc = h('div', 'results');
    sc.appendChild(h('div', 'big-mascot', mascotSvg('cheer')));
    sc.appendChild(h('div', 'res-title', '⭐'.repeat(stars) + ' Toate perechile!'));
    const cards2 = h('div', 'res-cards');
    cards2.appendChild(h('div', 'res-chip acc', `<div class="rc-l">Mutări</div><div class="rc-v">${moves}</div>`));
    cards2.appendChild(h('div', 'res-chip xp', `<div class="rc-l">XP</div><div class="rc-v">+${gained}</div>`));
    cards2.appendChild(h('div', 'res-chip gem', `<div class="rc-l">Rubine</div><div class="rc-v">+3</div>`));
    sc.appendChild(cards2);
    const again = h('button', 'btn btn-primary btn-big mt16', '🧩 ÎNCĂ O DATĂ');
    again.addEventListener('click', () => startMemory());
    const out = h('button', 'btn btn-big mt8', 'Înapoi');
    out.addEventListener('click', () => nav('practice'));
    sc.appendChild(again); sc.appendChild(out);
    a.appendChild(sc);
    sfx.win();
  }
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
  shopCard.innerHTML = `<span style="font-size:2rem">🛒</span><div class="grow"><b>Magazin</b><div class="set-d">Înghețătoare de serie, XP dublu</div></div>`;
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

  // vocea de engleză (dintre vocile instalate pe telefon, cele mai naturale primele)
  const enVoices = listEnVoices();
  if (enVoices.length <= 1) {
    // vocile se încarcă async — reîncercăm o singură dată dacă utilizatorul e tot aici
    setTimeout(() => {
      try {
        if (currentRoute === 'profile' && listEnVoices().length > 1) renderProfile();
      } catch (_) {}
    }, 1500);
  }
  if (enVoices.length > 1) {
    const rowV = h('div', 'set-row');
    rowV.appendChild(h('div', '', '<div class="set-l">Vocea de engleză</div><div class="set-d">Alege-o pe cea care sună cel mai natural</div>'));
    const wrapV = h('div', 'row');
    const sel = h('select', 'name-in');
    sel.style.marginTop = '0'; sel.style.maxWidth = '46vw'; sel.style.fontSize = '0.95rem'; sel.style.padding = '10px';
    const auto = h('option', '', 'Automat (recomandat)');
    auto.value = '';
    sel.appendChild(auto);
    enVoices.slice(0, 12).forEach(v => {
      const o = h('option', '', esc(v.name.replace(/Microsoft |Google |Online \(Natural\) - English \(United Kingdom\)/g, '').trim() || v.name));
      o.value = v.name;
      if (p.voiceName === v.name) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', () => {
      p.voiceName = sel.value || '';
      save(true);
      refreshVoice();
      speak('Hello! Nice to meet you.');
    });
    const test = h('button', 'audio-btn small', '🔊');
    test.addEventListener('click', () => speak('Hello! How are you today?'));
    wrapV.appendChild(sel); wrapV.appendChild(test);
    rowV.appendChild(wrapV);
    set.appendChild(rowV);
  }

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

// ---------- conversație (dialog ghidat) ----------
// Reguli din cercetare: ture stricte (aplicația vorbește, tu răspunzi), transcript
// permanent vizibil, alegerile greșite au CONSECINȚĂ vizibilă (partenerul nu înțelege),
// verificări de înțelegere țesute în firul poveștii, nu la final.
const NPC_CONFUSED = [
  { en: "Sorry, I don't understand.", ro: 'Scuze, nu înțeleg.' },
  { en: 'Pardon? Could you say that again?', ro: 'Poftim? Poți repeta?' },
  { en: "I'm not sure what you mean.", ro: 'Nu sunt sigur ce vrei să spui.' },
];

async function startDialog(unitMeta) {
  const p = state.profile;
  const mySeq = ++navSeq; // dublu-tap pe nod = o singură conversație
  try {
    const unit = await loadUnit(unitMeta.id);
    if (mySeq !== navSeq) return;
    const list = unit.dialogues || [];
    if (!list.length) { toast('Dialogul nu e disponibil încă.'); return; }
    const st = p.game.units[unitMeta.id] || (p.game.units[unitMeta.id] = { done: 0, test: false });
    const idx = (st.dlg || 0) % list.length;
    renderDialog(unitMeta, unit, list[idx]);
  } catch (_) { toast('Dialogul nu s-a putut încărca.'); }
}

function renderDialog(unitMeta, unit, dlg) {
  const p = state.profile;
  inActivity = true;
  const a = $app();
  a.innerHTML = '';

  const top = h('div', 'lesson-top');
  const quit = h('button', 'btn-quit', '✕');
  quit.addEventListener('click', () => {
    confirmModal('Ieși din conversație?', 'O poți relua oricând.', 'Ieși', (yes) => { if (yes) nav('home'); }, { noLabel: 'Rămân' });
  });
  const prog = h('div', 'prog');
  const fill = h('div', 'prog-fill');
  prog.appendChild(fill);
  top.appendChild(quit); top.appendChild(prog);
  top.appendChild(h('div', 'lesson-hearts', '💬'));
  a.appendChild(top);

  const wrap = h('div', 'ex-wrap');
  wrap.appendChild(h('div', 'ex-title tc', esc(dlg.title)));
  if (dlg.scene) wrap.appendChild(h('div', 'dlg-scene', esc(dlg.scene)));
  const chat = h('div', 'dlg-chat');
  wrap.appendChild(chat);
  const act = h('div', '');
  wrap.appendChild(act);
  a.appendChild(wrap);

  const lines = dlg.lines;
  const mySeq = navSeq; // orice timer rămas în urmă după ieșire devine inofensiv
  const accepted = new Set(); // starea "replică acceptată" e locală rulării, nu pe obiectele din cache
  let i = 0, misses = 0, wrongTotal = 0, meCount = 0;

  function addBubble(who, en, ro, speakIt) {
    const line = h('div', 'dlg-line ' + who);
    line.appendChild(h('div', 'dlg-ava', who === 'npc' ? '🧑‍💼' : esc(p.avatar)));
    const b = h('div', 'dlg-bubble');
    b.innerHTML = `<b>${esc(en)}</b><span class="dlg-ro">${esc(ro)}</span>`;
    if (who === 'npc') {
      const ab = h('button', 'audio-btn small', '🔊');
      ab.style.marginTop = '6px';
      ab.addEventListener('click', () => speak(en));
      b.appendChild(ab);
    }
    line.appendChild(b);
    chat.appendChild(line);
    if (speakIt) speak(en);
    wrap.scrollIntoView(false);
    window.scrollTo(0, document.body.scrollHeight);
  }

  function step() {
    if (navSeq !== mySeq) return; // utilizatorul a ieșit — nu mai atingem ecranul
    fill.style.width = Math.round((i / lines.length) * 100) + '%';
    act.innerHTML = '';
    if (i >= lines.length) { finishDialog(); return; }
    const ln = lines[i];
    if (ln.who === 'npc') {
      addBubble('npc', ln.en, ln.ro, true);
      i++;
      setTimeout(step, 400);
      return;
    }
    // rândul tău
    meCount++;
    misses = 0;
    const mode = (meCount % 2 === 1) ? 'choice' : 'bank';
    if (mode === 'choice') mountChoice(ln);
    else mountBankLine(ln);
  }

  function npcReact() {
    const r = NPC_CONFUSED[wrongTotal % NPC_CONFUSED.length];
    addBubble('npc', r.en, r.ro, true);
  }

  function acceptLine(ln) {
    if (accepted.has(i)) return; // anti dublu-tap: replica se acceptă o singură dată
    accepted.add(i);
    sfx.correct(1);
    addBubble('me', ln.en, ln.ro, false);
    speak(ln.en);
    i++;
    setTimeout(step, 500);
  }

  function mountChoice(ln) {
    act.innerHTML = '';
    act.appendChild(h('div', 'dlg-prompt', 'Ce răspunzi?'));
    const opts = h('div', 'opts');
    const options = [{ txt: ln.en, ok: true }, ...(ln.wrong || []).map(w => ({ txt: w, ok: false }))]
      .sort(() => Math.random() - 0.5);
    options.forEach((o) => {
      const b = h('button', 'opt', `<span>${esc(o.txt)}</span>`);
      b.addEventListener('click', () => {
        if (o.ok) { acceptLine(ln); return; }
        // consecință vizibilă: partenerul nu înțelege — încearcă din nou
        b.classList.add('wrong'); b.disabled = true;
        sfx.wrong(); wrongTotal++; misses++;
        npcReact();
        if (misses >= 2) {
          // după două rateuri, arătăm varianta corectă
          [...opts.children].forEach((x, xi) => { if (options[xi].ok) x.classList.add('correct'); });
        }
      });
      opts.appendChild(b);
    });
    act.appendChild(opts);
  }

  function mountBankLine(ln) {
    act.innerHTML = '';
    let hintShown = false;
    act.appendChild(h('div', 'dlg-prompt', 'Construiește răspunsul:'));
    act.appendChild(h('div', 'ex-sub', esc(ln.ro)));
    const words = ln.en.replace(/[.,!?]/g, '').split(/\s+/).filter(Boolean);
    const extras = ['the', 'a', 'is', 'not', 'do', 'very'].filter(f => !words.some(w => norm(w) === f)).slice(0, 3);
    const chips = words.concat(extras).sort(() => Math.random() - 0.5);
    const ans = h('div', 'bank-answer');
    const pool = h('div', 'bank-pool');
    act.appendChild(ans); act.appendChild(pool);
    const go = h('button', 'btn btn-primary btn-big mt16', 'SPUNE');
    go.disabled = true;
    const bank = buildChipBank(ans, pool, chips, () => { go.disabled = !bank.count(); });
    go.addEventListener('click', () => {
      const user = bank.words().join(' ');
      if (norm(user) === norm(ln.en)) { acceptLine(ln); return; }
      sfx.wrong(); wrongTotal++; misses++;
      npcReact();
      bank.reset(); // răspunsul se golește pentru o nouă încercare
      if (misses >= 2 && !hintShown) {
        hintShown = true;
        act.appendChild(h('div', 'ex-sub mt8', '💡 <b>' + esc(ln.en) + '</b>'));
      }
    });
    act.appendChild(go);
  }

  function finishDialog() {
    if (navSeq !== mySeq) return;
    const st = p.game.units[unitMeta.id] || (p.game.units[unitMeta.id] = { done: 0, test: false });
    st.dlg = (st.dlg || 0) + 1;
    const gained = G.addXp(15, p);
    G.addGems(3, p);
    p.game.stats.lessons++;
    const streakRes = G.hitStreakToday(p);
    G.questEvent({ xp: gained }, p);
    save(true);
    const sc = h('div', 'results');
    a.innerHTML = '';
    sc.appendChild(h('div', 'big-mascot', mascotSvg('cheer')));
    sc.appendChild(h('div', 'res-title', 'Conversație reușită! 💬'));
    const cards = h('div', 'res-cards');
    cards.appendChild(h('div', 'res-chip xp', `<div class="rc-l">XP</div><div class="rc-v">+${gained}</div>`));
    cards.appendChild(h('div', 'res-chip gem', `<div class="rc-l">Rubine</div><div class="rc-v">+3</div>`));
    if (wrongTotal === 0) cards.appendChild(h('div', 'res-chip acc', `<div class="rc-l">Fluent</div><div class="rc-v">100%</div>`));
    sc.appendChild(cards);
    if (streakRes.extended) sc.appendChild(h('p', '', `🔥 Seria: <b>${p.game.streak.count} zile</b>`));
    sc.appendChild(h('p', 'sub', 'Ai purtat o conversație adevărată în engleză. Exact așa se ajunge la fluență.'));
    const cont = h('button', 'btn btn-primary btn-big mt24', 'CONTINUĂ');
    cont.addEventListener('click', () => nav('home'));
    sc.appendChild(cont);
    a.appendChild(sc);
    sfx.win();
  }

  step();
}

// ---------- atelierul de scriere ----------
// Cercetare: scrisul e cel mai puternic consolidator de gramatică; feedback întâi
// indirect (listă de verificare), apoi explicit (model), plus timp de gândire.
async function startWriting(unitMeta) {
  const p = state.profile;
  const mySeq = ++navSeq;
  try {
    const unit = await loadUnit(unitMeta.id);
    if (mySeq !== navSeq) return;
    const list = unit.writing || [];
    if (!list.length) { toast('Tema de scriere nu e disponibilă încă.'); return; }
    const st = p.game.units[unitMeta.id] || (p.game.units[unitMeta.id] = { done: 0, test: false });
    const idx = (st.wr || 0) % list.length;
    renderWriting(unitMeta, unit, list[idx]);
  } catch (_) { toast('Tema nu s-a putut încărca.'); }
}

function splitSentences(text) {
  return String(text || '').split(/[.!?]+/).map(s => s.trim()).filter(s => s.length >= 2);
}

function renderWriting(unitMeta, unit, task) {
  const p = state.profile;
  inActivity = true;
  const a = $app();
  a.innerHTML = '';

  const top = h('div', 'lesson-top');
  const quit = h('button', 'btn-quit', '✕');
  quit.addEventListener('click', () => {
    confirmModal('Ieși din atelier?', 'Textul scris se pierde.', 'Ieși', (yes) => { if (yes) nav('home'); }, { danger: true, noLabel: 'Rămân' });
  });
  top.appendChild(quit);
  top.appendChild(h('div', 'grow tc', '<b>✍️ Atelier de scriere</b>'));
  top.appendChild(h('div', 'lesson-hearts', ''));
  a.appendChild(top);

  const wrap = h('div', 'ex-wrap');
  a.appendChild(wrap);

  const card = h('div', 'card');
  card.appendChild(h('div', 'wr-prompt', esc(task.prompt)));
  if (task.tips && task.tips.length) {
    card.appendChild(h('p', 'sub mt8', '💡 ' + task.tips.map(esc).join(' · ')));
  }
  if (task.required.length) {
    const req = h('div', 'wr-req');
    req.appendChild(h('span', 'sub', 'Folosește:'));
    task.required.forEach(r => req.appendChild(h('span', 'chip', esc(r))));
    card.appendChild(req);
  }
  wrap.appendChild(card);

  const ta = h('textarea', 'type-in');
  ta.style.minHeight = '160px';
  ta.placeholder = 'Scrie aici în engleză... nu te grăbi.';
  ta.autocapitalize = 'sentences'; ta.spellcheck = false;
  wrap.appendChild(ta);
  const count = h('div', 'wr-count', '0 propoziții');
  wrap.appendChild(count);
  ta.addEventListener('input', () => {
    const n = splitSentences(ta.value).length;
    count.textContent = `${n} ${n === 1 ? 'propoziție' : 'propoziții'} (țintă: ${task.minSent})`;
    checkB.disabled = norm(ta.value).length < 10;
  });
  if (task.starters && task.starters.length) {
    const st = h('div', 'wr-req');
    st.appendChild(h('span', 'sub', 'Începe cu:'));
    task.starters.forEach(s => {
      const c = h('button', 'chip', esc(s));
      c.addEventListener('click', () => { ta.value = (ta.value ? ta.value.trimEnd() + ' ' : '') + s + ' '; ta.focus(); ta.dispatchEvent(new Event('input')); });
      st.appendChild(c);
    });
    wrap.appendChild(st);
  }

  const result = h('div', '');
  wrap.appendChild(result);

  const checkB = h('button', 'btn btn-primary btn-big mt16', 'VERIFICĂ CE AI SCRIS');
  checkB.disabled = true;
  checkB.addEventListener('click', () => {
    const text = ta.value;
    const sents = splitSentences(text);
    const checks = [];
    checks.push({ ok: sents.length >= task.minSent, t: `Cel puțin ${task.minSent} propoziții`, d: `ai ${sents.length}` });
    for (const r of task.required) {
      checks.push({ ok: norm(text).includes(norm(r)), t: `Ai folosit „${r}”`, d: '' });
    }
    checks.push({ ok: /^[A-Z"]/.test(text.trim()), t: 'Prima literă e mare', d: '' });
    checks.push({ ok: /[.!?]\s*$/.test(text.trim()), t: 'Se termină cu punct', d: '' });
    // capcanele unității: dacă textul conține o formă-capcană cunoscută, semnalăm
    for (const tr of (unit.traps || []).slice(0, 30)) {
      if (tr.wrong && norm(text).includes(norm(tr.wrong))) {
        checks.push({ ok: false, t: `Atenție la capcană: „${tr.wrong}”`, d: tr.why || '' });
      }
    }
    result.innerHTML = '';
    const rc = h('div', 'card');
    rc.appendChild(h('b', '', 'Verificare:'));
    let allOk = true;
    for (const c of checks) {
      if (!c.ok) allOk = false;
      const row = h('div', 'wr-check' + (c.ok ? ' ok' : ' bad'));
      row.innerHTML = `<span class="wc-i">${c.ok ? '✅' : '◻️'}</span><span>${esc(c.t)}${c.d ? ` <small>(${esc(c.d)})</small>` : ''}</span>`;
      rc.appendChild(row);
    }
    result.appendChild(rc);

    const doneB = h('button', 'btn btn-primary btn-big mt8', allOk ? 'TRIMITE ✅' : 'TRIMITE AȘA CUM E');
    doneB.addEventListener('click', () => {
      // feedback explicit abia acum: modelul de răspuns, pentru comparație
      result.innerHTML = '';
      const model = h('div', 'wr-model');
      model.innerHTML = `<b>Un model de răspuns:</b><br>${esc(task.modelEn)}<br><small style="color:var(--text2)">${esc(task.modelRo)}</small>`;
      result.appendChild(model);
      result.appendChild(h('p', 'sub mt8', 'Compară cu ce ai scris tu. Ce ai spune altfel data viitoare?'));
      const fin = h('button', 'btn btn-primary btn-big mt8', 'AM COMPARAT — GATA');
      fin.addEventListener('click', () => {
        if (fin.disabled) return;
        fin.disabled = true;
        const st2 = p.game.units[unitMeta.id] || (p.game.units[unitMeta.id] = { done: 0, test: false });
        st2.wr = (st2.wr || 0) + 1;
        if (!p.game.writings) p.game.writings = {};
        p.game.writings[unitMeta.id + '_' + task.id] = { t: ta.value.slice(0, 1200), when: todayStr() };
        const gained = G.addXp(15, p);
        G.addGems(3, p);
        p.game.stats.lessons++;
        G.hitStreakToday(p);
        G.questEvent({ xp: gained }, p);
        save(true);
        toast(`+${gained} XP pentru scriere! ✍️`);
        nav('home');
      });
      result.appendChild(fin);
      doneB.remove(); checkB.remove();
      window.scrollTo(0, document.body.scrollHeight);
    });
    result.appendChild(doneB);
    window.scrollTo(0, document.body.scrollHeight);
  });
  wrap.appendChild(checkB);
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
  if (ev.lost) {
    // Cald, nu vinovat: întoarcerea e victoria. Reparația se oferă doar dacă chiar se poate.
    setTimeout(() => {
      if (G.canRepairStreak(p) && p.game.gems >= G.COSTS.repair) {
        confirmModal('Bine ai revenit! 👋', `Contează că ești aici. Dacă vrei, seria ta de ${p.game.streak.lostStreak} zile poate continua de unde a rămas — sau începem alta chiar azi, cu prima lecție.`, `Continuă seria (💎 ${G.COSTS.repair})`, (yes) => {
          if (yes && G.repairStreak(p)) { sfx.streak(); toast('Seria continuă! 🔥'); nav('home'); }
        }, { noLabel: 'Încep alta azi' });
      } else {
        toast('Bine ai revenit! O lecție azi și seria pornește din nou. 💪', 4000);
      }
    }, 800);
  }
  nav('home');
}
