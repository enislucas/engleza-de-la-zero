// engine.js — generatorul de exerciții + repetare distanțată (SM-2 simplificat) + verificarea răspunsurilor.
// Lecțiile NU sunt scrise de mână: se construiesc din vocabularul și propozițiile unității,
// adaptate la cât de bine știe cursantul fiecare cuvânt.

import { state, todayStr } from './state.js';

// ---------- normalizare & comparare ----------
export function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[.,!?;:"“”()\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein(a, b) {
  a = norm(a); b = norm(b);
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = new Array(n + 1), cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

// verificare pentru răspuns scris: iertăm greșeli mici de tastare,
// dar cuvintele scurte de gramatică (am/is/he/she) trebuie să fie EXACTE —
// altfel toleranța ar accepta exact greșelile pe care lecția vrea să le corecteze.
export function checkTyped(input, target) {
  const a = norm(input), b = norm(target);
  if (!a) return { ok: false, exact: false };
  if (a === b) return { ok: true, exact: true };
  const aw = a.split(' '), bw = b.split(' ');
  if (aw.length === bw.length) {
    let minor = 0;
    for (let i = 0; i < bw.length; i++) {
      const u = aw[i], t = bw[i];
      if (u === t) continue;
      if (t.length <= 3) return { ok: false, exact: false }; // cuvânt scurt greșit = greșeală reală
      const d = levenshtein(u, t);
      if (d > 1) return { ok: false, exact: false };
      minor += d;
    }
    if (minor <= Math.max(1, Math.floor(b.length / 8))) return { ok: true, exact: false };
    return { ok: false, exact: false };
  }
  const dist = levenshtein(a, b);
  const tol = Math.max(1, Math.floor(b.length / 8));
  if (dist <= tol) return { ok: true, exact: false };
  return { ok: false, exact: false };
}

// verificare pentru vorbire: suprapunere de cuvinte sau similaritate globală
export function checkSpoken(transcripts, target) {
  const tWords = norm(target).split(' ').filter(Boolean);
  let best = 0;
  for (const tr of (transcripts || [])) {
    const heard = new Set(norm(tr).split(' ').filter(Boolean));
    const hit = tWords.filter(w => heard.has(w)).length;
    const overlap = tWords.length ? hit / tWords.length : 0;
    const sim = 1 - levenshtein(tr, target) / Math.max(norm(target).length, 1);
    best = Math.max(best, overlap, sim);
  }
  return { ok: best >= 0.55, score: best };
}

// ---------- SRS (SM-2 simplificat) ----------
// s: 0..5. Interval în zile per nivel.
const INTERVALS = [0, 1, 2, 4, 8, 16];

export function wordState(wid, p = state.profile) {
  return p.game.words[wid] || null;
}

export function recordAnswer(wid, correct, p = state.profile) {
  if (!wid) return;
  const w = p.game.words[wid] || (p.game.words[wid] = { s: 0, due: todayStr(), seen: 0, right: 0, wrong: 0 });
  w.seen++;
  if (correct) { w.right++; w.s = Math.min(5, w.s + 1); }
  else { w.wrong++; w.s = Math.max(0, w.s - 1); }
  const d = new Date();
  d.setDate(d.getDate() + INTERVALS[w.s]);
  w.due = todayStr(d);
}

export function dueWords(unitDatas, p = state.profile, max = 12) {
  const today = todayStr();
  const due = [];
  const known = p.game.words;
  for (const unit of unitDatas) {
    for (const v of unit.vocab) {
      const w = known[v.id];
      if (w && w.seen > 0 && w.due <= today) due.push({ v, unit, prio: w.s * 10 - w.wrong });
    }
  }
  due.sort((a, b) => a.prio - b.prio); // cele mai slabe primele
  return due.slice(0, max);
}

export function countDue(unitDatas, p = state.profile) {
  return dueWords(unitDatas, p, 999).length;
}

// ---------- generare exerciții ----------
function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function pickN(arr, n) { return shuffled(arr).slice(0, n); }

function distractorsFor(word, pool, n = 3) {
  const sameCat = pool.filter(w => w.id !== word.id && w.cat === word.cat && norm(w.ro) !== norm(word.ro) && norm(w.en) !== norm(word.en));
  const others = pool.filter(w => w.id !== word.id && norm(w.ro) !== norm(word.ro) && norm(w.en) !== norm(word.en));
  const chosen = [];
  const seenRo = new Set([norm(word.ro)]), seenEn = new Set([norm(word.en)]);
  for (const src of [pickN(sameCat, n * 2), pickN(others, n * 3)]) {
    for (const c of src) {
      if (chosen.length >= n) break;
      if (seenRo.has(norm(c.ro)) || seenEn.has(norm(c.en))) continue;
      seenRo.add(norm(c.ro)); seenEn.add(norm(c.en));
      chosen.push(c);
    }
  }
  return chosen.slice(0, n);
}

// cuvinte-momeală pentru banca de cuvinte
const FILLER_EN = ['the', 'a', 'is', 'are', 'not', 'and', 'to', 'in', 'at', 'he', 'she', 'we', 'you', 'my', 'very', 'have', 'do', 'good', 'now', 'here'];

function bankFor(sentence, pool) {
  const words = sentence.en.replace(/[.,!?]/g, '').split(/\s+/).filter(Boolean);
  const extraPool = FILLER_EN.filter(f => !words.some(w => norm(w) === f));
  const nExtra = Math.min(4, Math.max(2, Math.floor(words.length / 2)));
  const extras = pickN(extraPool, nExtra);
  return { words, chips: shuffled(words.concat(extras)) };
}

// Construiește o lecție. spec: {vocab:[ids], sentences:[ids], grammar:id|null}
// opts: {canListen, canSpeak, review, test, unit, globalVocab}
export function buildLesson(unit, spec, opts = {}) {
  const p = state.profile;
  const vmap = Object.fromEntries(unit.vocab.map(v => [v.id, v]));
  const smap = Object.fromEntries((unit.sentences || []).map(s => [s.id, s]));
  const words = [...new Set(spec.vocab || [])].map(id => vmap[id]).filter(Boolean);
  const sents = [...new Set(spec.sentences || [])].map(id => smap[id]).filter(Boolean);
  const pool = unit.vocab.concat(opts.globalVocab || []);
  const exs = [];

  const isNew = (w) => { const st = wordState(w.id, p); return !st || st.seen === 0; };
  const newWords = opts.test ? [] : words.filter(isNew);
  const oldWords = words.filter(w => !newWords.includes(w));

  // 1) cuvinte noi: cartonaș + alegere ușoară imediat după
  for (const w of newWords.slice(0, 5)) {
    exs.push({ type: 'wordcard', word: w });
    exs.push({ type: 'mcq_en_ro', word: w, opts4: shuffled([w, ...distractorsFor(w, pool)]) });
  }

  // 2) potrivire perechi (dacă avem măcar 4 cuvinte)
  if (words.length >= 4) {
    exs.push({ type: 'match', pairs: pickN(words, Math.min(5, words.length)) });
  }

  // 3) exerciții pe cuvinte deja văzute (mai grele)
  for (const w of pickN(oldWords, opts.test ? words.length : 3)) {
    const kinds = ['mcq_ro_en'];
    if (opts.canListen) kinds.push('listen_mcq');
    const k = kinds[Math.floor(Math.random() * kinds.length)];
    if (k === 'listen_mcq') exs.push({ type: 'listen_mcq', word: w, opts4: shuffled([w, ...distractorsFor(w, pool)]) });
    else exs.push({ type: 'mcq_ro_en', word: w, opts4: shuffled([w, ...distractorsFor(w, pool)]) });
  }

  // 4) propoziții: banca de cuvinte, scris, ascultare, vorbire
  const sentEx = [];
  for (const s of pickN(sents, opts.test ? 6 : 4)) {
    const bank = bankFor(s, pool);
    const kinds = ['wordbank'];
    const strength = avgStrength(s, p, unit);
    if (strength >= 2) kinds.push('type_en');
    if (opts.canListen) kinds.push('listen_type_or_mcq');
    const k = kinds[Math.floor(Math.random() * kinds.length)];
    if (k === 'wordbank') sentEx.push({ type: 'wordbank', sentence: s, bank });
    else if (k === 'type_en') sentEx.push({ type: 'type_en', sentence: s });
    else sentEx.push(strength >= 3
      ? { type: 'listen_type', sentence: s }
      : { type: 'listen_bank', sentence: s, bank });
  }
  // o singură vorbire pe lecție, spre final
  if (opts.canSpeak && sents.length) {
    const s = sents[Math.floor(Math.random() * sents.length)];
    sentEx.push({ type: 'speak', sentence: s });
  }
  exs.push(...sentEx);

  // 5) capcană (dacă unitatea are) — o întrebare "care e corect?"
  if (unit.traps && unit.traps.length && Math.random() < (opts.test ? 1 : 0.6)) {
    const t = unit.traps[Math.floor(Math.random() * unit.traps.length)];
    exs.push({ type: 'trap', trap: t });
  }

  // 6) gramatică: alege forma corectă (din exemplele regulii)
  if (spec.grammar && unit.grammar) {
    const g = unit.grammar.find(x => x.id === spec.grammar);
    if (g && g.examples && g.examples.length) {
      const ex = g.examples[Math.floor(Math.random() * g.examples.length)];
      const blank = makeBlank(ex, unit);
      if (blank) exs.push(blank);
    }
  }

  const cap = opts.test ? 14 : 12;
  const head = exs.filter(e => e.type === 'wordcard' || newWords.some(w => e.word === w));
  const tail = shuffled(exs.filter(e => !head.includes(e)));
  return head.concat(tail).slice(0, cap);
}

function avgStrength(sentence, p, unit) {
  const ids = sentence.words || [];
  if (!ids.length) return 1;
  let sum = 0, n = 0;
  for (const id of ids) { const w = wordState(id, p); if (w) { sum += w.s; n++; } }
  return n ? sum / n : 0;
}

// transformă un exemplu de gramatică în "alege cuvântul lipsă"
function makeBlank(ex, unit) {
  if (ex.en.includes('→')) return null; // exemplele-transformare rămân doar în Ghid
  const words = ex.en.replace(/[.,!?]/g, '').split(/\s+/);
  if (words.length < 3) return null;
  // alegem un cuvânt funcțional interesant (am/is/are/do/does/did/will/have/has...)
  const FUNC = ['am', 'is', 'are', 'was', 'were', 'do', 'does', 'did', 'will', 'would', 'have', 'has', 'had', 'can', 'must', 'should', 'been', 'not'];
  const idx = words.findIndex(w => FUNC.includes(norm(w)));
  if (idx < 0) return null;
  const answer = words[idx];
  const others = FUNC.filter(f => f !== norm(answer));
  const optsList = shuffled([answer, ...pickN(others, 3)]);
  return {
    type: 'fill_blank',
    sentence: ex,
    blanked: words.map((w, i) => i === idx ? '____' : w).join(' '),
    answer, options: optsList,
  };
}

// Lecție de exersare din cuvintele slabe/scadente (nu costă vieți, dă viață înapoi)
export function buildReview(unitDatas, opts = {}) {
  const due = dueWords(unitDatas, state.profile, 8);
  let words = due.map(d => ({ w: d.v, unit: d.unit }));
  if (words.length < 5) {
    // completăm cu cuvinte văzute recent (cele mai slabe)
    const seen = [];
    for (const unit of unitDatas) {
      for (const v of unit.vocab) {
        const st = wordState(v.id);
        if (st && st.seen > 0 && !words.some(x => x.w.id === v.id)) seen.push({ w: v, unit, s: st.s });
      }
    }
    seen.sort((a, b) => a.s - b.s);
    words = words.concat(seen.slice(0, 5 - words.length + 3));
  }
  if (!words.length) return [];
  const exs = [];
  const allVocab = unitDatas.flatMap(u => u.vocab);
  for (const { w, unit } of words.slice(0, 7)) {
    const kind = Math.random();
    if (kind < 0.35) exs.push({ type: 'mcq_en_ro', word: w, opts4: shuffled([w, ...distractorsFor(w, allVocab)]) });
    else if (kind < 0.7) exs.push({ type: 'mcq_ro_en', word: w, opts4: shuffled([w, ...distractorsFor(w, allVocab)]) });
    else if (opts.canListen) exs.push({ type: 'listen_mcq', word: w, opts4: shuffled([w, ...distractorsFor(w, allVocab)]) });
    else exs.push({ type: 'mcq_en_ro', word: w, opts4: shuffled([w, ...distractorsFor(w, allVocab)]) });
    // și o propoziție care folosește cuvântul, dacă există
    const sent = (unit.sentences || []).find(s => (s.words || []).includes(w.id));
    if (sent && exs.length < 12 && Math.random() < 0.5) {
      exs.push({ type: 'wordbank', sentence: sent, bank: bankFor(sent, allVocab) });
    }
  }
  return shuffled(exs).slice(0, 10);
}
