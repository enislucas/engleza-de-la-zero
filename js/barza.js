// barza.js — Barza de buzunar: profesorul, direct pe telefon, oriunde.
// Vorbește cu Gemini folosind cheia primită prin linkul de împerechere (doar pe acest
// telefon). Își amintește omul din memoria pe care o distilează SINGUR, pe telefon, la
// schimbarea zilei (fără laptop); memoria de la laptop rămâne doar rezervă. Conversațiile
// și memoria pleacă prin sincronizare, ca profesorul de acasă și panoul lui Enis să le
// vadă. Ultimele 3 podcasturi stau pe raftul video, vizionabile oricând.

import { state, save, todayStr } from './state.js';
import { tutorCfg, openBox, cloudPush, syncActive } from './sync.js';
import { loadCourse, loadUnit, currentUnitIndex } from './course.js';
import { dueWords } from './engine.js';
import { speak, stopSpeaking, sttAvailable, listenOnce, stopListening } from './speech.js';

// NEfluxat (generateContent, nu streamGenerateContent): un singur JSON, robust pe iPhone
const GURL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const h = (tag, cls, html) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html != null) el.innerHTML = html;
  return el;
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- memoria profesorului (din pachetul tutorelui, prin cutie) ----------
let memCache = { t: 0, text: '', pods: [] };
async function fetchMemory() {
  const cfg = tutorCfg();
  if (!cfg || !cfg.tbox) return memCache;
  if (Date.now() - memCache.t < 30 * 60 * 1000) return memCache;
  const bundle = await openBox(cfg.tbox, cfg.tkey);
  if (bundle) {
    memCache = { t: Date.now(), text: (bundle.memory && bundle.memory[cfg.who]) || '', pods: [] };
  }
  return memCache;
}

// ---------- ultimul podcast (ca Barza sa-l poata discuta cu ei) ----------
let podCache = { t: 0, text: '', title: '' };
async function fetchLatestPodcast() {
  const cfg = tutorCfg();
  if (!cfg || !cfg.box || !cfg.url) return podCache;
  if (Date.now() - podCache.t < 30 * 60 * 1000) return podCache;
  try {
    const items = await (await fetch(`${cfg.url}/media/${cfg.box}/list`, { cache: 'no-store' })).json();
    const txts = (items || []).filter(i => /\.txt$/i.test(i.name)).sort((a, b) => (b.stamp || 0) - (a.stamp || 0));
    if (txts.length) {
      let t = await (await fetch(`${cfg.url}/media/${cfg.box}/${txts[0].name}`)).text();
      if (t.includes('\n\n')) t = t.split('\n\n').slice(1).join('\n\n'); // scoate antetul
      podCache = { t: Date.now(), text: t.slice(0, 1600), title: decodeURIComponent(txts[0].title || 'episod') };
    }
  } catch (_) {}
  return podCache;
}

// ---------- sesiuni de conversatie (calatoresc cu progresul, prin sincronizare) ----------
// La fiecare deschidere a aplicatiei = conversatie NOUA (context scurt = ieftin). Ziua/sesiunea
// veche se arhiveaza pentru "istoric" si se distileaza in memorie. O pauza de 30 min sau o zi
// noua inseamna sesiune noua.
const SESSION_GAP_MS = 30 * 60 * 1000;

function archiveChat(tc) {
  const p = state.profile;
  if (!p.tutorArchive) p.tutorArchive = [];
  p.tutorArchive.push({ day: tc.day, at: tc.at || Date.now(), messages: (tc.messages || []).slice() });
  while (p.tutorArchive.length > 20) p.tutorArchive.shift();  // pastram ultimele 20 de conversatii
}

function chatStore() {
  const p = state.profile;
  const now = Date.now();
  if (!p.tutorChat) p.tutorChat = { day: todayStr(), at: now, messages: [] };
  const tc = p.tutorChat;
  const fresh = tc.day !== todayStr() || (now - (tc.at || 0)) > SESSION_GAP_MS;
  if (fresh && tc.messages && tc.messages.length) {
    archiveChat(tc);                                  // in istoric (fara cost)
    if (tc.messages.length >= 2) distillMemory(tc.messages);  // in memorie (Gemini, debounced)
    p.tutorChat = { day: todayStr(), at: now, messages: [] };
    save();
  } else if (tc.day !== todayStr()) {
    p.tutorChat = { day: todayStr(), at: now, messages: [] };
  }
  return p.tutorChat;
}

// ---------- memoria distilata PE TELEFON (fara laptop) ----------
// La schimbarea zilei, Gemini rescrie cateva randuri durabile despre om + greselile cu
// data, exact ca profesorul de acasa. Best-effort: daca esueaza, reincercam maine.
async function distillMemory(msgs) {
  try {
    const cfg = tutorCfg();
    if (!cfg || !cfg.gkey) return;                 // fara cheie (neimperecheat): sarim
    const p = state.profile;
    // cel mult o distilare la 2h: evita apeluri repetate daca deschid aplicatia des
    if (Date.now() - ((p.tutorMemory && p.tutorMemory.lastDistillAt) || 0) < 2 * 3600 * 1000) return;
    const old = (p.tutorMemory && p.tutorMemory.text) || '';
    const today = todayStr();
    const name = p.name || 'cursantul';
    const pron = cfg.who === 'dad' ? 'el (bărbat, folosește „el/lui”)'
      : cfg.who === 'mom' ? 'ea (femeie, folosește „ea/ei”)' : 'persoana';
    const transcript = msgs
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => (m.role === 'user' ? name : 'Barza') + ': ' + String(m.content).slice(0, 400))
      .join('\n').slice(0, 6000);
    const prompt = `Ești memoria unui profesor de engleză. Cursantul este ${name} (${pron}).
Actualizează notițele cu ce e NOU din conversația de azi. REGULI STRICTE:
- Scrie DOAR fapte pe care ${name} le-a spus EXPLICIT (azi sau în notițele vechi). NU inventa, NU ghici, NU presupune NIMIC despre familie, copii, oraș, muncă sau vârstă. Dacă azi nu s-a spus nimic personal nou, lasă secțiunea DESPRE exact cum era (sau goală).
- Folosește pronumele corect: ${pron}.
- Nu copia exemple; scrie doar realitatea din conversație.
Structură FIXĂ, în română, rânduri simple, fără markdown:
DESPRE: fapte personale spuse clar de ${name} (familie, muncă, oraș, preferințe).
GRESELI: fiecare greșeală de engleză care se repetă, pe un rând, cu data între paranteze. Data ${today} pentru cele noi; păstrează datele vechi reale.
S-A EXERSAT: pe scurt, poți lista pe rânduri temele exersate.
PROMISIUNI: ce a promis profesorul.
Poți ține un profil bogat (până la vreo 45 de rânduri): păstrează tot ce e util și real, nu tăia din faptele adevărate. Dacă notițele vechi conțin ceva ce pare inventat sau nesigur, elimină doar acele rânduri.

NOTIȚE VECHI:
${old.slice(0, 6000)}

CONVERSAȚIA DE AZI:
${transcript}

Răspunde DOAR cu notițele actualizate.`;
    const { text, usage } = await callGemini(prompt, [{ role: 'user', content: 'Rescrie notițele acum.' }],
      { temp: 0.3, maxTokens: 1500 });
    addCost(usage);
    if (text && text.trim()) {
      p.tutorMemory = { text: text.trim(), day: today, lastDistillAt: Date.now() };
      save();
      try { if (syncActive()) cloudPush(); } catch (_) {}   // impinge memoria in cutie, pt. panou
    }
  } catch (_) { /* best-effort */ }
}
let _pushTimer = 0;
function pushMsg(role, content) {
  const c = chatStore();
  c.messages.push({ role, content: String(content).slice(0, 2000) });
  c.at = Date.now();                        // marcam activitatea (pentru granita de sesiune)
  while (c.messages.length > 40) c.messages.shift();
  save();
  // impinge conversatia in cutia telefonului la scurt timp, ca panoul lui Enis sa o vada
  // fara sa astepte laptopul. Debounce 4s ca sa nu impingem la fiecare tastare.
  try {
    if (syncActive()) {
      clearTimeout(_pushTimer);
      _pushTimer = setTimeout(() => { try { cloudPush(); } catch (_) {} }, 4000);
    }
  } catch (_) {}
}

// ---------- plafon de cost pe zi, pe persoana (ca sa nu se abuzeze API-ul) ----------
const DAILY_CAP_USD = 1.5;
function costStore() {
  const p = state.profile;
  if (!p.tutorCost || p.tutorCost.day !== todayStr()) p.tutorCost = { day: todayStr(), usd: 0 };
  return p.tutorCost;
}
function addCost(usage, deepseek) {
  if (!usage) return;
  if (deepseek) {
    const inn = usage.prompt_tokens || 0, out = usage.completion_tokens || 0;
    costStore().usd += inn / 1e6 * 0.14 + out / 1e6 * 0.28;   // preturi DeepSeek
  } else {
    const inn = usage.promptTokenCount || 0;
    const out = (usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0);
    costStore().usd += inn / 1e6 * 0.30 + out / 1e6 * 2.50;   // preturi Gemini 2.5 Flash
  }
  save();
}

// ---------- promptul: același profesor, în buzunar ----------
// Harta scurtă a tuturor cărților (din meta, deja în memorie): ca profesorul din buzunar
// să poată trimite la ORICE carte anterioară, la fel ca cel de acasă. Se calculează o dată.
let BOOKMAP = null;
async function bookMap() {
  if (BOOKMAP != null) return BOOKMAP;
  try {
    const meta = await loadCourse();
    BOOKMAP = meta.units.map(u => `Cartea ${u.book}: ${u.title}`
      + ((u.lessonTitles && u.lessonTitles.length) ? ' — ' + u.lessonTitles.slice(0, 4).join('; ') : '')).join('\n');
  } catch (_) { BOOKMAP = ''; }
  return BOOKMAP;
}

async function systemPrompt() {
  const p = state.profile;
  let appLevel = 1, unit = null;
  try {
    const meta = await loadCourse();
    const idx = currentUnitIndex(p, meta);
    appLevel = meta.units[idx].book;
    unit = await loadUnit(meta.units[idx].id);
  } catch (_) {}
  // materialul unității curente, ca profesorul de acasă: vocabular, gramatică, capcane
  let unitBlock = '';
  if (unit) {
    const vocab = (unit.vocab || []).slice(0, 45).map(v => v.en).join(', ');
    const gram = (unit.grammar || []).slice(0, 5).map(g => `${g.title}: ${String(g.body || '').slice(0, 140)}`).join(' | ');
    const traps = (unit.traps || []).slice(0, 6).map(t => `NOT "${t.wrong}" BUT "${t.right}"`).join(' | ');
    unitBlock = `\n\nCURRENT UNIT MATERIAL (teach from this, it is what they are studying now):\nVocabulary: ${vocab}\nGrammar: ${gram}\nTypical Romanian-speaker traps: ${traps}`;
  }
  // cuvinte slabe de reactivat (din SRS-ul telefonului)
  let weak = '';
  try {
    const dw = unit ? dueWords([unit], p, 8) : [];
    if (dw.length) weak = '\nWORDS TO REVIVE (weave 2 or 3 in naturally and make them USE the word, do not announce it): '
      + dw.map(d => `${d.v.en} = ${d.v.ro}`).join('; ');
  } catch (_) {}
  const bmap = await bookMap();
  // memoria distilată pe telefon are prioritate; cea de la laptop e rezervă (continuitate)
  const localMem = (p.tutorMemory && p.tutorMemory.text) || '';
  const mem = localMem ? { text: localMem } : await fetchMemory();
  const pod = await fetchLatestPodcast();
  const bp = p.bookProgress || {};
  const bookLine = bp.book
    ? `They are reading the PRINTED book series (separate from the app, at their own pace): currently Book ${bp.book} of 24${bp.note ? ', ' + bp.note : ''}. Reference material they have likely read on paper.`
    : `They have not recorded printed-book progress yet.`;
  return `You are Profesorul Barza, a warm, patient English tutor for Romanian adults aged 55+, here in "pocket" form on the learner's phone. The learner is ${p.name || 'the learner'}. Their phone-app level is around unit ${appLevel} of 24 (use it to gauge difficulty). ${bookLine}

MARKUP PROTOCOL (mandatory): wrap EVERY Romanian span in ⟦ro⟧...⟦/ro⟧. English stays unmarked. If (and only if) you correct a mistake, put ONE ⟦corr⟧...⟦/corr⟧ block at the very end. No other markup, no markdown, no asterisks, no em or en dashes.

BE A GENUINELY SMART TEACHER: understand what they mean even when their English is broken or half in Romanian, infer their real intent and answer THAT directly. Reason carefully before answering any grammar or vocabulary question so you are always accurate, and never invent a rule. Give clear, correct, concretely useful answers, tie them to the learner's own life and to what they already know, and teach one small memorable thing each turn. Remember the flow of the conversation and build on it, do not repeat yourself.

RESPOND TO WHAT THEY SAID (most important rule):
- ALWAYS answer the actual content and feeling of their message. NEVER ignore it and jump to an unrelated question. Do not fire random topics like "what is your favourite colour" when they did not open that door.
- If they express a FEELING or difficulty (frustration, "mă enervează", "nu știu", "e greu", "mă simt prost"): first acknowledge it warmly, in simple English WITH a ⟦ro⟧Romanian⟧ line so they surely feel understood, reassure them, THEN continue gently on that same subject.
- If they say "nu înțeleg" / "I don't understand" / seem lost: STOP, gently say sorry, and re-say your PREVIOUS point in much simpler English PLUS a full ⟦ro⟧traducere completă⟦/ro⟧. Do NOT change the subject and do NOT ask a new question until they are back with you.
- Example of the RIGHT move: learner says ⟦ro⟧"Mă enervează, nu știu să scriu dar înțeleg."⟦/ro⟧ Good reply: "That is completely normal, and understanding is the hardest part, you already have it. ⟦ro⟧E absolut normal. Cel mai greu e să înțelegi, iar tu deja înțelegi. Scrisul vine cu puțin exercițiu.⟦/ro⟧ Let us write ONE tiny sentence together: try 'I am tired today.' Can you copy it?"

STYLE: turns are SHORT, 2 to 4 sentences, ending with a question that invites them to speak. Friendly person first, teacher second. Match difficulty to app-unit ${appLevel} of 24 and to the unit vocabulary below: use words they likely know, one small step above.

LANGUAGE (important): reply in ENGLISH. Do NOT sprinkle Romanian translations into your English by default, and do NOT gloss words inline. The learner can tap any single word to see its Romanian, or tap a button to see your whole message in Romanian, whenever they want. So keep your turns in clean, simple English at their level. Use a ⟦ro⟧Romanian⟧ line ONLY as a real rescue: when they say they do not understand, or they are clearly stuck or upset (see the rule above). Not otherwise.

EXPLAIN-IN-ROMANIAN (explicit request only): if the learner explicitly asks you to explain in Romanian (for example "explică în română", "explain in Romanian", "spune-mi în română", "zi-mi pe românește"), then give a clear, complete explanation of the concept IN Romanian, wrapped in ⟦ro⟧...⟦/ro⟧, and include 2 or 3 short EXAMPLES in English (left unmarked) to illustrate it. For instance, if they ask about is vs are: explain in Romanian when to use each, then show "I am, you are, he is, we are, they are" and "The dog is big. The dogs are big." Warm and simple. Only when they explicitly ask; otherwise stay English-forward.

CORRECTION: at most ONE correction per turn, by gently recasting the right form (do not name the error); let small slips pass. Never say wrong, mistake, greșit. Celebrate any attempt and every self-correction.${unitBlock}${weak}

WHERE EACH TOPIC IS TAUGHT (so you can send them back to re-read the RIGHT earlier book, e.g. "is vs are" lives in Book 1):
${bmap}
When they ask about a grammar point, answer it simply now AND name the exact earlier book to re-read, in Romanian, e.g. ⟦ro⟧Asta e explicat pe îndelete în Cartea 1, merită s-o recitești.⟦/ro⟧ If they ask for a small table (e.g. is/are), give a tiny clean one as short aligned lines, no markdown. Gently remind, once in a while, that the words stick when they also read the book and talk with you, not only from the app drills. Never nag.
${mem.text ? '\nWHAT YOU REMEMBER about this learner from before (use naturally, do not recite):\n' + mem.text : ''}${pod.text ? `\n\nLATEST PODCAST EPISODE (they can ask you about it — discuss it warmly, explain words or ideas from it, quiz them gently, connect it to their life). Title: "${pod.title}".\nTranscript:\n${pod.text}` : ''}`;
}

// ---------- apelul Gemini (NEfluxat: robust pe iPhone, unde fetch-ul in flux e capricios) ----------
async function callGemini(sys, history, opts = {}) {
  const cfg = tutorCfg();
  const contents = history.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const res = await fetch(GURL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.gkey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: sys }] },
      contents,
      generationConfig: { temperature: opts.temp ?? 0.8, maxOutputTokens: opts.maxTokens ?? 500, thinkingConfig: { thinkingBudget: opts.think ?? 0 } },
    }),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 200); } catch (_) {}
    throw new Error('Gemini ' + res.status + ' ' + detail);
  }
  const j = await res.json();
  const text = ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [])
    .map(p => p.text || '').join('');
  return { text, usage: j.usageMetadata || null };
}

// ---------- DeepSeek (ieftin, pentru mesaje simple) — API compatibil OpenAI, merge din browser ----------
const DS_URL = 'https://api.deepseek.com/chat/completions';
async function callDeepSeek(sys, history, opts = {}) {
  const cfg = tutorCfg();
  if (!cfg || !cfg.dkey) throw new Error('fara cheie DeepSeek');
  const messages = [{ role: 'system', content: sys }]
    .concat(history.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })));
  const res = await fetch(DS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.dkey },
    body: JSON.stringify({ model: 'deepseek-chat', messages, temperature: opts.temp ?? 0.8, max_tokens: opts.maxTokens ?? 500 }),
  });
  if (!res.ok) { let d = ''; try { d = (await res.text()).slice(0, 200); } catch (_) {} throw new Error('DeepSeek ' + res.status + ' ' + d); }
  const j = await res.json();
  return { text: (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '', usage: j.usage || null, deepseek: true };
}

// ---------- routerul de model, chiar pe telefon ----------
// Gemini (cea mai buna romana) cand conteaza: voce, mesaj lung, intrebari de
// gramatica/vocabular/traducere. DeepSeek (ieftin) la palavrageala simpla.
const GEMINI_TRIGGERS = /(de ce|pentru ce|cum se|cum spun|cum zic|ce inseamn|ce înseamn|ce vrea|diferen[țt]|traduc|corect|gre[șs]e|gramatic|explic|conjug|why|how do|how doe|what does|what is the difference|translat|grammar|mean|tense|plural|past tense)/i;
function routePrefer(voice, lastUser) {
  if (voice) return 'gemini';
  const t = (lastUser || '').trim();
  if (t.length > 220) return 'gemini';
  if (GEMINI_TRIGGERS.test(t)) return 'gemini';
  return 'deepseek';
}
// alege motorul; celalalt e plasa DOAR daca primul cade inainte sa dea text
async function callLLM(sys, history, prefer, opts = {}) {
  if (prefer === 'deepseek' && (tutorCfg() || {}).dkey) {
    try { return await callDeepSeek(sys, history, opts); }
    catch (_) { /* cade pe Gemini */ }
  }
  return await callGemini(sys, history, opts);  // { text, usage } (fara flag deepseek)
}

// ---------- traducere in romana la cerere (doar cand apasa; ieftin, cu cache) ----------
const TR_CACHE = new Map();
function plainText(raw) {
  return String(raw).replace(/⟦corr⟧[\s\S]*?(⟦\/corr⟧|$)/g, '').replace(/⟦[^⟧]*⟧/g, '').replace(/\s+/g, ' ').trim();
}
async function translateRo(text) {
  if (TR_CACHE.has(text)) return TR_CACHE.get(text);
  const sys = 'Ești traducător. Tradu mesajul următor în română naturală, simplă și caldă, pentru un adult de 55+. Răspunde DOAR cu traducerea, text simplu, fără explicații sau ghilimele.';
  const r = await callLLM(sys, [{ role: 'user', content: text }], 'deepseek', { temp: 0.2, maxTokens: 320 });
  addCost(r.usage, r.deepseek);
  const out = (r.text || '').trim();
  if (out) TR_CACHE.set(text, out);
  return out;
}

// ---------- traducere cuvant cu cuvant (dictionarul cursului = gratis; LLM doar la nevoie) ----------
const WORD_DICT = new Map();   // en (mic) -> ro, din vocabularul cartilor (fara cost)
const WORD_CACHE = new Map();  // traduceri LLM deja cerute
function seedDict(unit) {
  for (const v of (unit && unit.vocab) || []) {
    const en = String(v.en || '').toLowerCase().replace(/\([^)]*\)/g, '').trim();
    if (en && v.ro && !WORD_DICT.has(en)) WORD_DICT.set(en, v.ro);
  }
}
const normWord = (w) => String(w || '').toLowerCase().replace(/^[^a-z']+|[^a-z']+$/g, '');
async function wordRo(word) {
  const w = normWord(word);
  if (!w) return '';
  if (WORD_DICT.has(w)) return WORD_DICT.get(w);         // din carte, instant si gratis
  if (WORD_CACHE.has(w)) return WORD_CACHE.get(w);
  const sys = 'Ești dicționar englez-român. Dă traducerea în română a cuvântului englezesc primit (sensul cel mai comun, 1-3 cuvinte). Răspunde DOAR cu traducerea, fără explicații.';
  const r = await callLLM(sys, [{ role: 'user', content: word }], 'deepseek', { temp: 0, maxTokens: 24 });
  addCost(r.usage, r.deepseek);
  const out = (r.text || '').trim().replace(/^["'\s]+|["'.\s]+$/g, '');
  if (out) WORD_CACHE.set(w, out);
  return out;
}

// ---------- redare: markere -> bule frumoase + voce ----------
function appendWords(el, en) {
  // pastreaza spatiile si punctuatia, dar face fiecare cuvant englezesc tapabil (traducere)
  for (const tok of en.split(/(\s+)/)) {
    if (!tok) continue;
    if (/[a-zA-Z]/.test(tok) && !/^\s+$/.test(tok)) el.appendChild(h('span', 'b-w', esc(tok)));
    else el.appendChild(document.createTextNode(tok));
  }
}
function renderRich(el, raw, opts = {}) {
  el.innerHTML = '';
  let corr = '';
  let text = String(raw).replace(/⟦corr⟧([\s\S]*?)(⟦\/corr⟧|$)/, (_, c) => { corr = c.trim(); return ''; });
  const parts = text.split(/(⟦ro⟧[\s\S]*?(?:⟦\/ro⟧|$))/);
  for (const seg of parts) {
    if (!seg) continue;
    const m = seg.match(/^⟦ro⟧([\s\S]*?)(?:⟦\/ro⟧)?$/);
    if (m) { el.appendChild(h('span', 'b-ro', esc(m[1]))); continue; }
    const en = seg.replace(/⟦[^⟧]*⟧?/g, '');
    if (opts.words) appendWords(el, en);        // cuvinte tapabile (traducere cuvant cu cuvant)
    else el.appendChild(document.createTextNode(en));
  }
  return corr;
}

// mic popover cu traducerea unui cuvant, deasupra lui
let _tip = null, _tipSpan = null, _tipTimer = 0;
function hideTip() { if (_tip) _tip.style.display = 'none'; _tipSpan = null; }
function positionTip() {
  if (!_tip || !_tipSpan) return;
  const r = _tipSpan.getBoundingClientRect();
  _tip.style.left = Math.max(8, Math.min(r.left + r.width / 2, window.innerWidth - 8)) + 'px';
  _tip.style.top = (r.top - 8) + 'px';
}
function showWordTip(span, text) {
  if (!_tip) {
    _tip = h('div', 'b-wtip');
    document.body.appendChild(_tip);
    // ascunde DOAR daca atingi in afara unui cuvant (pastreaza .b-w SI .rw din cititor)
    document.addEventListener('click', (e) => { if (!e.target.closest || !e.target.closest('.b-w, .rw')) hideTip(); }, true);
    window.addEventListener('scroll', positionTip, true);   // urmareste cuvantul cand se deruleaza, nu-l ascunde
  }
  _tipSpan = span;
  _tip.textContent = text;
  _tip.style.display = 'block';
  positionTip();
  clearTimeout(_tipTimer);
  _tipTimer = setTimeout(hideTip, 3500);                    // se stinge singur dupa 3.5s
}
function segmentsOf(raw) {
  const out = [];
  const text = String(raw).replace(/⟦corr⟧[\s\S]*?(⟦\/corr⟧|$)/, '');
  for (const seg of text.split(/(⟦ro⟧[\s\S]*?(?:⟦\/ro⟧|$))/)) {
    if (!seg || !seg.trim()) continue;
    const m = seg.match(/^⟦ro⟧([\s\S]*?)(?:⟦\/ro⟧)?$/);
    if (m) out.push({ lang: 'ro', text: m[1].trim() });
    else { const t = seg.replace(/⟦[^⟧]*⟧?/g, '').trim(); if (t) out.push({ lang: 'en', text: t }); }
  }
  return out;
}
let speakSeq = 0;
function speakReply(raw) {
  const p = state.profile;
  if (!p || p.soundOn === false) return;
  stopSpeaking();
  const my = ++speakSeq;
  const segs = segmentsOf(raw);
  const done = new Set(); // onend SI cronometrul pot chema next: doar prima chemare trece
  function next(i) {
    if (my !== speakSeq || done.has(i) || i >= segs.length) return;
    done.add(i);
    const s = segs[i];
    if (s.lang === 'en') {
      speak(s.text, {});
      setTimeout(() => next(i + 1), Math.max(1800, s.text.length * 70));
    } else {
      try {
        const u = new SpeechSynthesisUtterance(s.text);
        u.lang = 'ro-RO';
        const v = speechSynthesis.getVoices().find(v2 => /^ro/i.test(v2.lang));
        if (v) u.voice = v;
        u.rate = 0.95;
        u.onend = () => next(i + 1);
        speechSynthesis.speak(u);
        setTimeout(() => next(i + 1), Math.max(2500, s.text.length * 90));
      } catch (_) { next(i + 1); }
    }
  }
  next(0);
}

// ---------- raftul video ----------
async function videoShelf(cfgAll) {
  const wrap = h('div', 'b-shelf');
  try {
    const r = await fetch(`${cfgAll.url}/media/${cfgAll.box}/list`, { cache: 'no-store' });
    const all = await r.json();
    // grupam pe EPISOD (ep1.mp4/.mp3/.txt = un singur episod), nu pe fisier
    const groups = {};
    for (const it of all) {
      const m = String(it.name).match(/^(.*)\.(mp4|mp3|txt|json)$/i);
      if (!m) continue;
      const base = m[1], ext = m[2].toLowerCase();
      const g = (groups[base] = groups[base] || { title: it.title, stamp: 0, files: {} });
      g.files[ext] = it.name;
      if ((it.stamp || 0) > g.stamp) g.stamp = it.stamp || 0;
      if (it.title) g.title = it.title;
    }
    const eps = Object.values(groups).sort((a, b) => b.stamp - a.stamp).slice(0, 3);
    if (!eps.length) {
      wrap.appendChild(h('div', 'sub tc', 'Podcasturile apar aici după următorul episod făcut acasă. 🎬'));
      return wrap;
    }
    wrap.appendChild(h('div', 'b-shelf-t', '🎬 Ultimele podcasturi'));
    for (const ep of eps) {
      const card = h('div', 'b-vid-card');
      card.appendChild(h('div', 'b-vid-title', esc(decodeURIComponent(ep.title || 'Episod'))));
      const row = h('div', 'b-vid-row');
      const src = (name) => `${cfgAll.url}/media/${cfgAll.box}/${name}?t=${ep.stamp || 0}`;  // busting cache
      if (ep.files.mp3) {   // experienta bogata: audio + text sincron + traducere pe cuvant
        const a = h('button', 'b-vid-btn', '🎧 Ascultă și citește');
        a.addEventListener('click', () => openReader(cfgAll, ep));
        row.appendChild(a);
      }
      if (ep.files.mp4) {
        const w = h('button', 'b-vid-btn ghost', '📺 Video');
        w.addEventListener('click', () => openVideo(cfgAll, ep));
        row.appendChild(w);
      }
      card.appendChild(row);
      wrap.appendChild(card);
    }
  } catch (_) {
    wrap.appendChild(h('div', 'sub tc', 'Raftul nu răspunde acum — încearcă mai târziu.'));
  }
  return wrap;
}
// ---------- istoricul conversatiilor (citire) ----------
function showHistory() {
  const arch = (state.profile.tutorArchive || []).slice().reverse(); // cea mai recenta prima
  const ov = h('div', 'b-hist-ov');
  const card = h('div', 'b-hist-card');
  const head = h('div', 'b-hist-head');
  head.appendChild(h('div', 'b-hist-t', '📜 Conversații vechi'));
  const x = h('button', 'b-hist-x', '✕');
  x.addEventListener('click', () => ov.remove());
  head.appendChild(x);
  card.appendChild(head);
  const body = h('div', 'b-hist-body');
  card.appendChild(body);

  const list = () => {
    body.innerHTML = '';
    if (!arch.length) { body.appendChild(h('div', 'sub tc', 'Nicio conversație veche încă.')); return; }
    for (const s of arch) {
      const d = new Date(s.at || 0);
      const when = d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' }) + ' ' +
        String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      const first = (s.messages.find(m => m.role === 'user') || {}).content || '(fără text)';
      const item = h('button', 'b-hist-item', `<b>${esc(when)}</b> · ${esc(String(first).slice(0, 60))}`);
      item.addEventListener('click', () => openSession(s, list));
      body.appendChild(item);
    }
  };
  const openSession = (s, back) => {
    body.innerHTML = '';
    const bk = h('button', 'b-hist-back', '‹ Înapoi la listă');
    bk.addEventListener('click', back);
    body.appendChild(bk);
    for (const m of s.messages) {
      const b = h('div', 'msg ' + (m.role === 'user' ? 'user' : 'tutor'));
      if (m.role === 'user') b.textContent = m.content; else renderRich(b, m.content);
      body.appendChild(b);
    }
  };
  list();
  ov.appendChild(card);
  document.body.appendChild(ov);
}

// grupeaza cuvintele in randuri de subtitrare (pe propozitie / max 12 cuvinte)
function buildSubs(words) {
  const lines = []; let cur = [];
  const flush = () => { if (cur.length) { lines.push({ t: cur[0].t, end: cur[cur.length - 1].t + (cur[cur.length - 1].d || 0.3), text: cur.map(x => x.w).join(' ') }); cur = []; } };
  for (const wd of words) { cur.push(wd); if (/[.!?]$/.test(wd.w) || cur.length >= 12) flush(); }
  flush();
  return lines;
}
const SUB_SIZES = ['sm', 'md', 'lg', 'xl'];
async function openVideo(cfgAll, ep) {
  const src = (name) => `${cfgAll.url}/media/${cfgAll.box}/${name}?t=${ep.stamp || 0}`;
  const ov = h('div', 'b-video-ov');
  const vid = document.createElement('video');
  vid.controls = true; vid.autoplay = true; vid.playsInline = true;
  vid.src = src(ep.files.mp4);
  const subEl = h('div', 'b-sub');                 // subtitrarea noastra (fiabila, cu marime reglabila)
  const x = h('button', 'b-video-x', '✕');
  x.addEventListener('click', () => { try { vid.pause(); } catch (_) {} ov.remove(); });
  const fs = h('button', 'b-video-fs', '⛶ Ecran mare');
  fs.addEventListener('click', () => {
    try {
      if (vid.webkitEnterFullscreen) vid.webkitEnterFullscreen();
      else if (vid.requestFullscreen) vid.requestFullscreen();
      else if (vid.webkitRequestFullscreen) vid.webkitRequestFullscreen();
    } catch (_) {}
  });
  // controale subtitrare: pornit/oprit + marime (se tin minte)
  const p = state.profile;
  let subOn = p.subOn !== false;                   // PORNIT implicit
  let sizeI = SUB_SIZES.indexOf(p.subSize || 'lg'); if (sizeI < 0) sizeI = 2;
  const bar = h('div', 'b-sub-bar');
  const toggle = h('button', 'b-sub-btn', '');
  const smaller = h('button', 'b-sub-btn', 'A−');
  const bigger = h('button', 'b-sub-btn', 'A+');
  const applySub = () => {
    subEl.className = 'b-sub ' + SUB_SIZES[sizeI] + (subOn ? '' : ' off');
    toggle.textContent = subOn ? '💬 Subtitrare pornită' : '💬 Subtitrare oprită';
    p.subOn = subOn; p.subSize = SUB_SIZES[sizeI]; try { save(); } catch (_) {}
  };
  toggle.addEventListener('click', () => { subOn = !subOn; applySub(); });
  smaller.addEventListener('click', () => { sizeI = Math.max(0, sizeI - 1); applySub(); });
  bigger.addEventListener('click', () => { sizeI = Math.min(SUB_SIZES.length - 1, sizeI + 1); applySub(); });
  bar.appendChild(toggle); bar.appendChild(smaller); bar.appendChild(bigger);
  ov.appendChild(vid); ov.appendChild(subEl); ov.appendChild(x); ov.appendChild(fs); ov.appendChild(bar);
  document.body.appendChild(ov);
  applySub();
  let subs = [];
  try { if (ep.files.json) subs = buildSubs(((await (await fetch(src(ep.files.json))).json()).words) || []); } catch (_) {}
  vid.addEventListener('timeupdate', () => {
    if (!subOn || !subs.length) { subEl.textContent = ''; return; }
    const ct = vid.currentTime;
    const line = subs.find(s => ct >= s.t && ct < s.end);
    subEl.textContent = line ? line.text : '';
  });
}

// ---------- cititorul: audio + text sincron (karaoke) + traducere pe cuvant ----------
async function openReader(cfgAll, ep) {
  const src = (name) => `${cfgAll.url}/media/${cfgAll.box}/${name}?t=${ep.stamp || 0}`;  // busting cache
  const ov = h('div', 'b-read-ov');
  const card = h('div', 'b-read-card');
  const head = h('div', 'b-read-head');
  head.appendChild(h('div', 'b-read-t', esc(decodeURIComponent(ep.title || 'Episod'))));
  const audio = document.createElement('audio');
  audio.src = src(ep.files.mp3); audio.preload = 'auto';
  const x = h('button', 'b-read-x', '✕');
  x.addEventListener('click', () => { try { audio.pause(); } catch (_) {} ov.remove(); });
  head.appendChild(x);
  card.appendChild(head);

  const textWrap = h('div', 'b-read-text');
  textWrap.textContent = 'Se încarcă…';
  card.appendChild(textWrap);

  const bar = h('div', 'b-read-bar');
  const playBtn = h('button', 'b-read-play', '▶');
  const seek = h('input', 'b-read-seek'); seek.type = 'range'; seek.min = 0; seek.value = 0; seek.step = 0.1;
  bar.appendChild(playBtn); bar.appendChild(seek);
  card.appendChild(bar);
  ov.appendChild(card);
  document.body.appendChild(ov);

  // cuvintele cu timp (karaoke). Fara ele: aratam textul, tot tapabil, dar fara evidentiere.
  let words = [];
  try { if (ep.files.json) words = ((await (await fetch(src(ep.files.json))).json()).words) || []; } catch (_) {}
  textWrap.innerHTML = '';
  const spans = [];
  if (words.length) {
    // grupam cuvintele pe TURE de vorbitor (spk) → bule stanga/dreapta, ca o discuție
    let curSpk = null, bubble = null;
    words.forEach((wd, i) => {
      const spk = wd.spk || 0;
      if (spk !== curSpk || !bubble) {
        curSpk = spk;
        bubble = h('div', 'rturn ' + (spk === 1 ? 'right' : 'left'));
        textWrap.appendChild(bubble);
      }
      const s = h('span', 'rw' + (wd.lang === 'ro' ? ' ro' : ''), esc(wd.w) + ' ');
      s.dataset.idx = i;
      bubble.appendChild(s); spans.push(s);
    });
  } else {
    const bubble = h('div', 'rturn left');
    textWrap.appendChild(bubble);
    try {
      let t = ep.files.txt ? await (await fetch(src(ep.files.txt))).text() : '';
      // scoatem antetul (titlu + „Cafeaua englezească · Profesorul Barza”) — titlul e deja sus
      if (t.includes('\n\n')) t = t.split('\n\n').slice(1).join('\n\n');
      appendWords(bubble, t.trim() || '(transcriere indisponibilă)');
    } catch (_) { bubble.textContent = '(transcriere indisponibilă)'; }
  }

  // tap pe cuvant -> traducere (engleza -> romana; romana e deja romana, o aratam ca atare)
  textWrap.addEventListener('click', async (e) => {
    const w = e.target.closest('.rw, .b-w');
    if (!w) return;
    const wd = (w.dataset.idx != null) ? words[w.dataset.idx] : null;
    if (wd && wd.lang === 'ro') { showWordTip(w, wd.w); return; }
    showWordTip(w, '…');
    try { showWordTip(w, (await wordRo(w.textContent)) || '(?)'); } catch (_) { showWordTip(w, '(?)'); }
  });

  // evidentierea cuvantului curent, sincron cu sunetul
  let cursor = 0, lastOn = null;
  audio.addEventListener('timeupdate', () => {
    if (words.length) {
      const ct = audio.currentTime;
      while (cursor < words.length - 1 && ct >= words[cursor + 1].t) cursor++;
      while (cursor > 0 && ct < words[cursor].t) cursor--;
      const cur = (ct >= words[cursor].t) ? spans[cursor] : null;
      if (cur !== lastOn) {
        if (lastOn) lastOn.classList.remove('on');
        if (cur) { cur.classList.add('on'); cur.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
        lastOn = cur;
      }
    }
    seek.value = audio.currentTime;
  });
  audio.addEventListener('loadedmetadata', () => { seek.max = audio.duration || 0; });
  audio.addEventListener('ended', () => { playBtn.textContent = '▶'; });
  playBtn.addEventListener('click', () => {
    if (audio.paused) { audio.play(); playBtn.textContent = '⏸'; }
    else { audio.pause(); playBtn.textContent = '▶'; }
  });
  seek.addEventListener('input', () => { audio.currentTime = Number(seek.value); });
}

// ---------- ecranul ----------
export function renderBarza(deps) {
  const { $app, statbar, navbar } = deps;
  const a = $app();
  a.innerHTML = '';
  a.appendChild(statbar());
  const sc = h('div', 'screen');
  a.appendChild(sc);
  a.appendChild(navbar('barza'));

  const cfg = tutorCfg();
  if (!cfg) {
    const c = h('div', 'card tc');
    c.innerHTML = '<div style="font-size:2.2rem">🦢</div><b>Profesorul Barza de buzunar</b><p class="sub">Ca să vorbești cu profesorul de pe telefon, cere-i lui Enis linkul de activare și deschide-l o singură dată.</p>';
    sc.appendChild(c);
    return;
  }

  // seed dictionar (curenta + 2 precedente) ca taparea pe cuvant sa fie gratis pentru
  // cuvintele din carti; restul se traduc cu un apel mic la nevoie
  (async () => {
    try {
      const meta = await loadCourse();
      const idx = currentUnitIndex(state.profile, meta);
      for (const j of [idx, idx - 1, idx - 2]) if (meta.units[j]) seedDict(await loadUnit(meta.units[j].id));
    } catch (_) {}
  })();

  // ---- comutatorul cu 3 file: Conversație / Istoric / Podcasturi ----
  let view = 'chat';
  const seg = h('div', 'b-seg');
  const TABS = [['chat', '💬 Vorbim'], ['hist', '📜 Istoric'], ['pods', '🎬 Podcast']];
  const tabBtns = {};
  TABS.forEach(([v, label]) => {
    const b = h('button', 'b-seg-btn', label);
    b.addEventListener('click', () => { view = v; show(); });
    seg.appendChild(b); tabBtns[v] = b;
  });
  sc.appendChild(seg);
  const content = h('div', 'b-content');
  sc.appendChild(content);

  // ---- compozitorul (o singura data; se ascunde in afara conversatiei) ----
  const row = h('div', 'b-composer');
  const mic = h('button', 'b-mic', '🎤');
  const inp = h('textarea', 'b-in');
  inp.placeholder = 'Scrie sau apasă 🎤...';
  inp.rows = 1;
  const send = h('button', 'b-send', '➤');
  row.appendChild(mic); row.appendChild(inp); row.appendChild(send);
  a.insertBefore(row, a.querySelector('.navbar'));

  let chat = null;         // reasignat la fiecare afisare a conversatiei
  let lastVoice = false;   // ultimul mesaj a venit prin microfon? (atunci: Gemini)
  const wordTap = async (e) => {
    const w = e.target.closest && e.target.closest('.b-w');
    if (!w) return;
    showWordTip(w, '…');
    try { showWordTip(w, (await wordRo(w.textContent)) || '(?)'); } catch (_) { showWordTip(w, '(?)'); }
  };

  // buton „🇷🇴 în română” sub bula profesorului: traduce la cerere, cache, se ascunde/arata
  const attachTranslate = (target, raw) => {
    const en = plainText(raw);
    if (!en) return;
    const btn = h('button', 'b-tr-btn', '🇷🇴 în română');
    const box = h('div', 'b-tr'); box.style.display = 'none';
    btn.addEventListener('click', async () => {
      if (box.textContent) {
        const s = box.style.display === 'none';
        box.style.display = s ? 'block' : 'none';
        btn.textContent = s ? '🇷🇴 ascunde' : '🇷🇴 în română';
        return;
      }
      btn.disabled = true; btn.textContent = '… traduc';
      try { box.textContent = (await translateRo(en)) || '(nu am putut traduce)'; }
      catch (_) { box.textContent = '(nu am putut traduce acum)'; }
      box.style.display = 'block'; btn.disabled = false; btn.textContent = '🇷🇴 ascunde';
    });
    target.appendChild(btn);
    target.appendChild(box);
  };
  const addBubble = (role, content2) => {
    const b = h('div', 'msg ' + (role === 'user' ? 'user' : 'tutor'));
    if (role === 'user') { b.textContent = content2; chat.appendChild(b); return b; }
    const corr = renderRich(b, content2, { words: true });
    chat.appendChild(b);
    attachTranslate(b, content2);
    if (corr) {
      const cn = h('div', 'corr');
      cn.appendChild(h('div', 'corr-t', 'Observație'));
      const body = h('div'); renderRich(body, corr); cn.appendChild(body);
      chat.appendChild(cn);
    }
    return b;
  };

  let busy = false;
  async function doSend() {
    const text = inp.value.trim();
    if (!text || busy) return;
    if (costStore().usd >= DAILY_CAP_USD) {   // plafon zilnic pe persoana
      addBubble('user', text); pushMsg('user', text);
      addBubble('assistant', 'Am vorbit frumos și mult azi! ⟦ro⟧Hai să ne odihnim și continuăm mâine, cu forțe noi.⟦/ro⟧ See you tomorrow!');
      inp.value = ''; window.scrollTo(0, document.body.scrollHeight); return;
    }
    busy = true; send.disabled = true;
    stopSpeaking();
    inp.value = '';
    addBubble('user', text); pushMsg('user', text);
    const bubble = h('div', 'msg tutor');
    bubble.textContent = 'Profesorul scrie…';
    chat.appendChild(bubble);
    window.scrollTo(0, document.body.scrollHeight);
    try {
      const sys = await systemPrompt();
      const ctx = chatStore().messages.slice(-16);   // ceva mai mult context = raspunsuri mai bune
      const prefer = routePrefer(lastVoice, text);   // voce/gramatica -> Gemini; restul -> DeepSeek
      lastVoice = false;
      // pe ruta Gemini (intrebari complexe) pornim „gandirea” = raspunsuri mai istete
      const r = await callLLM(sys, ctx, prefer, { maxTokens: 650, think: 1024 });
      addCost(r.usage, r.deepseek);
      const raw = r.text;
      if (!raw) throw new Error('raspuns gol');
      const corr = renderRich(bubble, raw, { words: true });
      attachTranslate(bubble, raw);
      if (corr) {
        const cn = h('div', 'corr');
        cn.appendChild(h('div', 'corr-t', 'Observație'));
        const body = h('div'); renderRich(body, corr); cn.appendChild(body);
        bubble.after(cn);
      }
      pushMsg('assistant', raw);
      speakReply(raw);
    } catch (e) {
      bubble.textContent = 'Nu am putut vorbi cu profesorul. Verifică internetul și încearcă din nou.';
      try { if (window.__logErr) window.__logErr('barza-buzunar: ' + (e && e.message)); } catch (_) {}
    }
    busy = false; send.disabled = false;
    window.scrollTo(0, document.body.scrollHeight);
  }
  send.addEventListener('click', doSend);
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); } });
  let listening = false;
  mic.addEventListener('click', async () => {
    if (listening) { stopListening(); listening = false; mic.classList.remove('rec'); return; }
    if (!sttAvailable()) { mic.disabled = true; return; }
    listening = true; mic.classList.add('rec');
    stopSpeaking();
    try {
      const r = await listenOnce('en-GB', 12000);
      if (r && r.ok && r.text) { inp.value = (inp.value ? inp.value + ' ' : '') + r.text; lastVoice = true; }
    } catch (_) {}
    listening = false; mic.classList.remove('rec');
    inp.focus();
  });

  // ---- afisarea fiecarei file ----
  // porneste o conversatie noua: arhiveaza si distileaza cea curenta, apoi curata
  function newChat() {
    const p = state.profile, tc = p.tutorChat;
    if (tc && tc.messages && tc.messages.length) {
      archiveChat(tc);
      if (tc.messages.length >= 2) distillMemory(tc.messages);
    }
    p.tutorChat = { day: todayStr(), at: Date.now(), messages: [] };
    save();
    renderChatView();
  }
  function renderChatView() {
    content.innerHTML = '';
    const store = chatStore();
    if (store.messages.length) {   // buton „conversație nouă” doar când e ceva de închis
      const nb = h('button', 'b-newchat', '✨ Începe o conversație nouă');
      nb.addEventListener('click', newChat);
      content.appendChild(nb);
    }
    chat = h('div', 'b-chat');
    chat.addEventListener('click', wordTap);
    content.appendChild(chat);
    if (!store.messages.length) {
      addBubble('assistant', `Hello, ${state.profile.name || ''}! I am here in your pocket, ready to talk. How is your day going?`);
    } else {
      for (const m of store.messages) addBubble(m.role, m.content);
    }
    window.scrollTo(0, document.body.scrollHeight);
  }
  function renderHistView() {
    content.innerHTML = '';
    const arch = (state.profile.tutorArchive || []).slice().reverse();
    if (!arch.length) {
      content.appendChild(h('div', 'card tc sub', 'Nicio conversație veche încă. Fiecare deschidere începe o conversație nouă, iar cele vechi apar aici.'));
      return;
    }
    for (const s of arch) {
      const d = new Date(s.at || 0);
      const when = d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' }) + ' ' +
        String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      const first = (s.messages.find(m => m.role === 'user') || {}).content || '(fără text)';
      const card = h('div', 'card');
      card.innerHTML = `<div class="b-hist-when">📅 ${esc(when)} · ${s.messages.length} mesaje</div>
        <div class="b-hist-prev">${esc(String(first).slice(0, 90))}</div>`;
      const rowb = h('div', 'row mt8');
      const openB = h('button', 'btn grow', '👁 Vezi');
      const contB = h('button', 'btn btn-primary grow', '↩ Continuă');
      openB.addEventListener('click', () => viewSession(s));
      contB.addEventListener('click', () => resumeSession(s));
      rowb.appendChild(openB); rowb.appendChild(contB);
      card.appendChild(rowb);
      content.appendChild(card);
    }
  }
  function viewSession(s) {
    content.innerHTML = '';
    const back = h('button', 'b-hist-back', '‹ Înapoi la listă');
    back.addEventListener('click', renderHistView);
    content.appendChild(back);
    const box = h('div', 'b-chat');
    box.addEventListener('click', wordTap);
    for (const m of s.messages) {
      const b = h('div', 'msg ' + (m.role === 'user' ? 'user' : 'tutor'));
      if (m.role === 'user') b.textContent = m.content; else renderRich(b, m.content, { words: true });
      box.appendChild(b);
    }
    content.appendChild(box);
    const cont = h('button', 'btn btn-primary btn-big mt8', '↩ Continuă această conversație');
    cont.addEventListener('click', () => resumeSession(s));
    content.appendChild(cont);
  }
  function resumeSession(s) {
    const p = state.profile;
    p.tutorChat = { day: todayStr(), at: Date.now(), messages: (s.messages || []).slice() };
    p.tutorArchive = (p.tutorArchive || []).filter(x => x !== s);  // nu o dublam
    save();
    view = 'chat'; show();
  }
  function renderPodsView() {
    content.innerHTML = '';
    videoShelf(cfg).then(shelf => content.appendChild(shelf));
  }
  function show() {
    Object.keys(tabBtns).forEach(v => tabBtns[v].classList.toggle('on', v === view));
    row.style.display = (view === 'chat') ? '' : 'none';   // compozitorul doar in conversatie
    if (view === 'chat') renderChatView();
    else if (view === 'hist') renderHistView();
    else renderPodsView();
  }
  show();
}
