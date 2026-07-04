// exercises.js — montează fiecare tip de exercițiu în ecranul lecției.
// Contract: mountExercise(el, ex, ctx) -> handle
//   handle.check() -> {ok, correctText, userText, wordIds, noHeart, skipped} sau null dacă nu e gata
//   handle.ready() -> bool (activează butonul VERIFICĂ)
//   Pentru exerciții care se termină singure (match, wordcard-continue) ctx.autoDone(result).
// Nimic de aici nu aruncă erori spre lecție — totul e prins.

import { checkTyped, checkSpoken, norm } from './engine.js';
import { speak, speakSlow, listenOnce, stopListening, sttAvailable } from './speech.js';
import { sfx } from './sound.js';

function h(tag, cls, html) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html != null) el.innerHTML = html;
  return el;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function audioBtn(text, { small = false, slow = false } = {}) {
  const b = h('button', 'audio-btn' + (small ? ' small' : ''), slow ? '🐢' : '🔊');
  b.type = 'button';
  b.setAttribute('aria-label', slow ? 'Ascultă rar' : 'Ascultă');
  b.addEventListener('click', () => { sfx.tap(); (slow ? speakSlow(text) : speak(text)); });
  return b;
}

// ---------- tipuri ----------

function mountWordcard(el, ex, ctx) {
  const w = ex.word;
  el.appendChild(h('div', 'ex-title', 'Cuvânt nou'));
  const card = h('div', 'card wordcard');
  card.appendChild(h('div', 'wc-en', esc(w.en)));
  if (w.pron) card.appendChild(h('div', 'wc-pron', '[' + esc(w.pron) + ']'));
  card.appendChild(h('div', 'wc-ro', esc(w.ro)));
  const audioWrap = h('div', 'wc-audio');
  audioWrap.appendChild(audioBtn(w.en));
  const slowB = audioBtn(w.en, { slow: true, small: true });
  slowB.style.marginLeft = '10px';
  audioWrap.appendChild(slowB);
  card.appendChild(audioWrap);
  el.appendChild(card);
  el.appendChild(h('div', 'ex-sub tc', 'Apasă 🔊, apoi spune cuvântul cu voce tare.'));
  setTimeout(() => speak(w.en), 350);
  return {
    ready: () => true,
    check: () => ({ ok: true, isIntro: true, noHeart: true, wordIds: [w.id], correctText: '', userText: '' }),
    checkLabel: 'CONTINUĂ',
  };
}

function mountMcq(el, ex, ctx, dir) {
  // dir: 'en_ro' (arată EN, alege RO) sau 'ro_en'
  const w = ex.word;
  const promptTxt = dir === 'en_ro' ? w.en : w.ro;
  const answerOf = (o) => dir === 'en_ro' ? o.ro : o.en;
  el.appendChild(h('div', 'ex-title', dir === 'en_ro'
    ? `Ce înseamnă „<span style="color:var(--primary-text)">${esc(w.en)}</span>”?`
    : `Cum se spune „<span style="color:var(--primary-text)">${esc(w.ro)}</span>” în engleză?`));
  if (dir === 'en_ro') {
    const row = h('div', 'audio-row');
    row.appendChild(audioBtn(w.en, { small: true }));
    if (w.pron) row.appendChild(h('span', 'ex-sub', '[' + esc(w.pron) + ']'));
    el.appendChild(row);
    setTimeout(() => speak(w.en), 300);
  }
  let sel = null;
  const optsEl = h('div', 'opts');
  ex.opts4.forEach((o, i) => {
    const b = h('button', 'opt', `<span class="opt-n">${i + 1}</span> <span>${esc(answerOf(o))}</span>`);
    b.type = 'button';
    b.addEventListener('click', () => {
      sfx.tap();
      optsEl.querySelectorAll('.opt').forEach(x => x.classList.remove('sel'));
      b.classList.add('sel');
      sel = { o, b };
      if (dir === 'ro_en') speak(o.en);
      ctx.refresh();
    });
    optsEl.appendChild(b);
  });
  el.appendChild(optsEl);
  return {
    ready: () => !!sel,
    check: () => {
      if (!sel) return null;
      const ok = sel.o.id === w.id;
      sel.b.classList.add(ok ? 'correct' : 'wrong');
      if (!ok && ctx.reveal) {
        // răspunsul corect se arată abia la a doua ratare (întâi îl cauți singur)
        [...optsEl.children].forEach((b, i) => { if (ex.opts4[i].id === w.id) b.classList.add('correct'); });
      }
      optsEl.querySelectorAll('.opt').forEach(x => x.disabled = true);
      return { ok, correctText: `${w.en} = ${w.ro}`, userText: answerOf(sel.o), wordIds: [w.id] };
    },
  };
}

function mountListenMcq(el, ex, ctx) {
  const w = ex.word;
  el.appendChild(h('div', 'ex-title', 'Ce ai auzit? Alege sensul.'));
  const row = h('div', 'audio-row');
  row.style.justifyContent = 'center';
  row.appendChild(audioBtn(w.en));
  row.appendChild(audioBtn(w.en, { slow: true, small: true }));
  el.appendChild(row);
  setTimeout(() => speak(w.en), 350);
  let sel = null;
  const optsEl = h('div', 'opts');
  ex.opts4.forEach((o, i) => {
    const b = h('button', 'opt', `<span class="opt-n">${i + 1}</span> <span>${esc(o.ro)}</span>`);
    b.type = 'button';
    b.addEventListener('click', () => {
      sfx.tap();
      optsEl.querySelectorAll('.opt').forEach(x => x.classList.remove('sel'));
      b.classList.add('sel'); sel = { o, b }; ctx.refresh();
    });
    optsEl.appendChild(b);
  });
  el.appendChild(optsEl);
  return {
    ready: () => !!sel,
    check: () => {
      if (!sel) return null;
      const ok = sel.o.id === w.id;
      sel.b.classList.add(ok ? 'correct' : 'wrong');
      if (!ok && ctx.reveal) [...optsEl.children].forEach((b, i) => { if (ex.opts4[i].id === w.id) b.classList.add('correct'); });
      optsEl.querySelectorAll('.opt').forEach(x => x.disabled = true);
      return { ok, correctText: `${w.en} = ${w.ro}`, userText: sel.o.ro, wordIds: [w.id], isListen: true };
    },
  };
}

function mountBank(el, ex, ctx, listenMode) {
  const s = ex.sentence;
  if (listenMode) {
    el.appendChild(h('div', 'ex-title', 'Ascultă și construiește propoziția'));
    const row = h('div', 'audio-row'); row.style.justifyContent = 'center';
    row.appendChild(audioBtn(s.en)); row.appendChild(audioBtn(s.en, { slow: true, small: true }));
    el.appendChild(row);
    setTimeout(() => speak(s.en), 350);
  } else {
    el.appendChild(h('div', 'ex-title', 'Tradu în engleză'));
    el.appendChild(h('div', 'card flat', `<b>${esc(s.ro)}</b>`));
  }
  const ans = h('div', 'bank-answer');
  const pool = h('div', 'bank-pool');
  const placed = [];
  const mkChip = (word) => {
    const c = h('button', 'chip', esc(word));
    c.type = 'button';
    c.addEventListener('click', () => {
      sfx.tap();
      if (c.parentElement === pool) {
        pool.removeChild(c); ans.appendChild(c); placed.push(c);
      } else {
        ans.removeChild(c); pool.appendChild(c);
        const i = placed.indexOf(c); if (i >= 0) placed.splice(i, 1);
      }
      ctx.refresh();
    });
    return c;
  };
  ex.bank.chips.forEach(wd => pool.appendChild(mkChip(wd)));
  el.appendChild(ans); el.appendChild(pool);
  return {
    ready: () => placed.length > 0,
    check: () => {
      if (!placed.length) return null;
      const user = placed.map(c => c.textContent).join(' ');
      const ok = norm(user) === norm(s.en);
      pool.querySelectorAll('.chip').forEach(c => c.disabled = true);
      ans.querySelectorAll('.chip').forEach(c => c.disabled = true);
      return { ok, correctText: s.en, userText: user, wordIds: s.words || [], isListen: !!listenMode };
    },
  };
}

function mountType(el, ex, ctx, listenMode) {
  const s = ex.sentence;
  if (listenMode) {
    el.appendChild(h('div', 'ex-title', 'Ascultă și scrie în engleză'));
    const row = h('div', 'audio-row'); row.style.justifyContent = 'center';
    row.appendChild(audioBtn(s.en)); row.appendChild(audioBtn(s.en, { slow: true, small: true }));
    el.appendChild(row);
    setTimeout(() => speak(s.en), 350);
  } else {
    el.appendChild(h('div', 'ex-title', 'Scrie în engleză'));
    el.appendChild(h('div', 'card flat', `<b>${esc(s.ro)}</b>`));
  }
  const ta = h('textarea', 'type-in');
  ta.placeholder = 'Scrie aici în engleză...';
  ta.autocapitalize = 'off'; ta.autocomplete = 'off'; ta.spellcheck = false;
  ta.addEventListener('input', () => ctx.refresh());
  // tastatura de pe telefon acoperă bara VERIFICĂ → aducem câmpul la mijlocul ecranului
  ta.addEventListener('focus', () => {
    setTimeout(() => { try { ta.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {} }, 350);
  });
  el.appendChild(ta);
  setTimeout(() => { try { ta.focus(); } catch (_) {} }, 400);
  return {
    ready: () => norm(ta.value).length > 0,
    check: () => {
      if (!norm(ta.value)) return null;
      const r = checkTyped(ta.value, s.en);
      ta.disabled = true;
      return {
        ok: r.ok,
        correctText: s.en,
        userText: ta.value,
        almost: r.ok && !r.exact,
        wordIds: s.words || [], isListen: !!listenMode,
      };
    },
  };
}

function mountSpeak(el, ex, ctx) {
  const s = ex.sentence;
  el.appendChild(h('div', 'ex-title', 'Spune cu voce tare în engleză'));
  el.appendChild(h('div', 'speak-target', esc(s.en)));
  el.appendChild(h('div', 'ex-sub tc', esc(s.ro)));
  const row = h('div', 'audio-row'); row.style.justifyContent = 'center';
  row.appendChild(audioBtn(s.en, { small: true })); row.appendChild(audioBtn(s.en, { slow: true, small: true }));
  el.appendChild(row);

  const canStt = sttAvailable();
  let result = null;
  let attempts = 0;
  const heard = h('div', 'speak-heard', '');

  if (canStt) {
    const mic = h('button', 'mic-btn', '🎤'); mic.type = 'button';
    mic.setAttribute('aria-label', 'Apasă și vorbește');
    const hint = h('div', 'ex-sub tc', 'Apasă microfonul și citește propoziția.');
    mic.addEventListener('click', async () => {
      if (mic.classList.contains('listening')) { stopListening(); return; }
      sfx.tap();
      mic.classList.add('listening');
      heard.textContent = 'Te ascult...';
      const r = await listenOnce('en-GB', 8000);
      mic.classList.remove('listening');
      if (r.ok && r.text) {
        heard.textContent = '„' + r.text + '”';
        const chk = checkSpoken(r.alts || [r.text], s.en);
        if (chk.ok) {
          result = { ok: true, correctText: s.en, userText: r.text, wordIds: s.words || [], noHeart: true, isSpeak: true };
          sfx.correct();
          ctx.autoDone(result);
        } else {
          attempts++;
          heard.textContent = '„' + r.text + '” — mai încearcă o dată, rar și clar.';
          // abia după 2 încercări ratate permitem "verifică" (fără pierdere de viață — e vorbire)
          if (attempts >= 2) {
            result = { ok: false, correctText: s.en, userText: r.text, wordIds: s.words || [], noHeart: true, isSpeak: true };
            ctx.allowSkipAsOk('Nu-i nimic — pronunția vine cu timpul.');
          }
          ctx.refresh();
        }
      } else {
        attempts++;
        heard.textContent = r.reason === 'unavailable' ? 'Microfonul nu e disponibil.' : 'Nu te-am auzit. Încearcă din nou, mai aproape de telefon.';
        if (attempts >= 2) ctx.allowSkipAsOk('Nu-i nimic — încearcă data viitoare.');
        ctx.refresh();
      }
    });
    el.appendChild(mic); el.appendChild(hint); el.appendChild(heard);
    return {
      ready: () => !!result,
      check: () => result,
      skippable: 'NU POT VORBI ACUM',
    };
  }

  // Fallback fără microfon (ex. iPhone instalat ca aplicație): exercițiu de repetiție ghidată.
  el.appendChild(h('div', 'card flat tc', 'Ascultă 🔊 și spune propoziția <b>de 3 ori</b>, cu voce tare.'));
  let saidIt = false;
  const btn = h('button', 'btn btn-big mt16', '✅ Am spus-o de 3 ori');
  btn.type = 'button';
  btn.addEventListener('click', () => { saidIt = true; btn.classList.add('hidden'); sfx.correct(); ctx.refresh(); });
  el.appendChild(btn);
  setTimeout(() => speak(s.en), 400);
  return {
    ready: () => saidIt,
    check: () => saidIt ? { ok: true, correctText: s.en, userText: '(exercițiu vorbit)', wordIds: s.words || [], noHeart: true, isSpeak: true } : null,
  };
}

function mountMatch(el, ex, ctx) {
  el.appendChild(h('div', 'ex-title', 'Potrivește perechile'));
  const grid = h('div', 'match-grid');
  const left = ex.pairs.map(p => ({ id: p.id, txt: p.en, side: 'en' }));
  const right = ex.pairs.map(p => ({ id: p.id, txt: p.ro, side: 'ro' }));
  // așezăm: coloana stângă EN amestecat, dreapta RO amestecat
  const rightShuffled = [...right].sort(() => Math.random() - 0.5);
  const cells = [];
  const L = [...left].sort(() => Math.random() - 0.5);
  for (let i = 0; i < ex.pairs.length; i++) {
    for (const item of [L[i], rightShuffled[i]]) {
      const b = h('button', 'opt', esc(item.txt));
      b.type = 'button'; b.dataset.id = item.id; b.dataset.side = item.side;
      grid.appendChild(b); cells.push(b);
    }
  }
  let selBtn = null, matched = 0, errors = 0;
  grid.addEventListener('click', (e) => {
    const b = e.target.closest('.opt');
    if (!b || b.classList.contains('matched')) return;
    sfx.tap();
    if (b.dataset.side === 'en') speak(b.textContent);
    if (!selBtn) { selBtn = b; b.classList.add('sel'); return; }
    if (selBtn === b) { b.classList.remove('sel'); selBtn = null; return; }
    if (selBtn.dataset.side === b.dataset.side) {
      selBtn.classList.remove('sel'); selBtn = b; b.classList.add('sel'); return;
    }
    // pereche încercată
    if (selBtn.dataset.id === b.dataset.id) {
      selBtn.classList.remove('sel');
      selBtn.classList.add('matched'); b.classList.add('matched');
      matched++; sfx.correct();
      selBtn = null;
      if (matched === ex.pairs.length) {
        ctx.autoDone({ ok: true, correctText: '', userText: '', wordIds: ex.pairs.map(p => p.id), noHeart: true, matchErrors: errors });
      }
    } else {
      errors++;
      const a = selBtn, c = b;
      a.classList.add('wrong'); c.classList.add('wrong'); sfx.wrong();
      setTimeout(() => {
        a.classList.remove('wrong');
        if (selBtn !== a) a.classList.remove('sel'); // nu strica selecția refăcută între timp
        c.classList.remove('wrong');
      }, 600);
      selBtn = null;
    }
  });
  el.appendChild(grid);
  el.appendChild(h('div', 'ex-sub tc mt8', 'Apasă un cuvânt și perechea lui.'));
  return { ready: () => false, check: () => null, noCheckButton: true };
}

function mountTrap(el, ex, ctx) {
  const t = ex.trap;
  el.appendChild(h('div', 'ex-title', '⚠️ Capcană! Care variantă e corectă?'));
  let sel = null;
  const optsEl = h('div', 'opts');
  const options = [
    { txt: t.right, ok: true },
    { txt: t.wrong, ok: false },
  ].sort(() => Math.random() - 0.5);
  options.forEach((o, i) => {
    const b = h('button', 'opt', `<span class="opt-n">${i + 1}</span> <span>${esc(o.txt)}</span>`);
    b.type = 'button';
    b.addEventListener('click', () => {
      sfx.tap();
      optsEl.querySelectorAll('.opt').forEach(x => x.classList.remove('sel'));
      b.classList.add('sel'); sel = { o, b }; ctx.refresh();
    });
    optsEl.appendChild(b);
  });
  el.appendChild(optsEl);
  return {
    ready: () => !!sel,
    check: () => {
      if (!sel) return null;
      const ok = sel.o.ok;
      sel.b.classList.add(ok ? 'correct' : 'wrong');
      if (!ok && ctx.reveal) [...optsEl.children].forEach((b, i) => { if (options[i].ok) b.classList.add('correct'); });
      optsEl.querySelectorAll('.opt').forEach(x => x.disabled = true);
      return { ok, correctText: t.right + (t.why ? ' — ' + t.why : ''), userText: sel.o.txt, wordIds: [] };
    },
  };
}

function mountFillBlank(el, ex, ctx) {
  el.appendChild(h('div', 'ex-title', 'Alege cuvântul lipsă'));
  el.appendChild(h('div', 'card flat', `<b style="font-size:1.15rem">${esc(ex.blanked)}</b><div class="ex-sub mt8">${esc(ex.sentence.ro || '')}</div>`));
  let sel = null;
  const optsEl = h('div', 'opts grid2');
  ex.options.forEach((o) => {
    const b = h('button', 'opt', `<span>${esc(o)}</span>`);
    b.type = 'button'; b.style.justifyContent = 'center';
    b.addEventListener('click', () => {
      sfx.tap();
      optsEl.querySelectorAll('.opt').forEach(x => x.classList.remove('sel'));
      b.classList.add('sel'); sel = { o, b }; ctx.refresh();
    });
    optsEl.appendChild(b);
  });
  el.appendChild(optsEl);
  return {
    ready: () => !!sel,
    check: () => {
      if (!sel) return null;
      const ok = norm(sel.o) === norm(ex.answer);
      sel.b.classList.add(ok ? 'correct' : 'wrong');
      if (!ok && ctx.reveal) [...optsEl.children].forEach((b) => { if (norm(b.textContent) === norm(ex.answer)) b.classList.add('correct'); });
      optsEl.querySelectorAll('.opt').forEach(x => x.disabled = true);
      return { ok, correctText: ex.sentence.en, userText: sel.o, wordIds: ex.sentence.words || [] };
    },
  };
}

// ---------- dispecer ----------
export function mountExercise(el, ex, ctx) {
  try {
    switch (ex.type) {
      case 'wordcard': return mountWordcard(el, ex, ctx);
      case 'mcq_en_ro': return mountMcq(el, ex, ctx, 'en_ro');
      case 'mcq_ro_en': return mountMcq(el, ex, ctx, 'ro_en');
      case 'listen_mcq': return mountListenMcq(el, ex, ctx);
      case 'wordbank': return mountBank(el, ex, ctx, false);
      case 'listen_bank': return mountBank(el, ex, ctx, true);
      case 'type_en': return mountType(el, ex, ctx, false);
      case 'listen_type': return mountType(el, ex, ctx, true);
      case 'speak': return mountSpeak(el, ex, ctx);
      case 'match': return mountMatch(el, ex, ctx);
      case 'trap': return mountTrap(el, ex, ctx);
      case 'fill_blank': return mountFillBlank(el, ex, ctx);
      default:
        el.appendChild(h('div', 'card', 'Exercițiu indisponibil — mergem mai departe.'));
        return { ready: () => true, check: () => ({ ok: true, noHeart: true, correctText: '', userText: '', wordIds: [] }) };
    }
  } catch (err) {
    // orice eroare de montare: exercițiul devine "sări peste" — lecția nu se blochează niciodată
    el.appendChild(h('div', 'card', 'A apărut o problemă la acest exercițiu — mergem mai departe.'));
    return { ready: () => true, check: () => ({ ok: true, noHeart: true, correctText: '', userText: '', wordIds: [] }) };
  }
}
