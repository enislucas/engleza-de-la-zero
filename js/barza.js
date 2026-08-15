// barza.js — Barza de buzunar: profesorul, direct pe telefon, oriunde.
// Vorbește cu Gemini folosind cheia primită prin linkul de împerechere (doar pe acest
// telefon), își amintește omul din memoria distilată de laptop (prin cutia poștală),
// iar conversațiile pleacă înapoi prin sincronizare, ca profesorul de acasă și panoul
// lui Enis să le vadă. Ultimele 3 podcasturi stau pe raftul video, vizionabile oricând.

import { state, save, todayStr } from './state.js';
import { tutorCfg, openBox } from './sync.js';
import { loadCourse, currentUnitIndex } from './course.js';
import { speak, stopSpeaking, sttAvailable, listenOnce, stopListening } from './speech.js';

const GURL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse';

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

// ---------- istoricul de buzunar (călătorește cu progresul, prin sincronizare) ----------
function chatStore() {
  const p = state.profile;
  if (!p.tutorChat) p.tutorChat = { day: todayStr(), messages: [] };
  return p.tutorChat;
}
function pushMsg(role, content) {
  const c = chatStore();
  c.day = todayStr();
  c.messages.push({ role, content: String(content).slice(0, 2000) });
  while (c.messages.length > 40) c.messages.shift();
  save();
}

// ---------- promptul: același profesor, în buzunar ----------
async function systemPrompt() {
  const p = state.profile;
  let appLevel = 1;
  try {
    const meta = await loadCourse();
    appLevel = meta.units[currentUnitIndex(p, meta)].book;
  } catch (_) {}
  const mem = await fetchMemory();
  const bp = p.bookProgress || {};
  const bookLine = bp.book
    ? `They are reading the PRINTED book series (separate from the app, at their own pace): currently Book ${bp.book} of 24${bp.note ? ', ' + bp.note : ''}. Pitch what you reference to what they have actually read on paper.`
    : `They have not recorded printed-book progress yet.`;
  return `You are Profesorul Barza, a warm, patient English tutor for Romanian adults aged 55+, here in "pocket" form on the learner's phone. The learner is ${p.name || 'the learner'}. Their phone-app level is around unit ${appLevel} of 24 (use it to gauge difficulty). ${bookLine}

MARKUP PROTOCOL (mandatory): wrap EVERY Romanian span in ⟦ro⟧...⟦/ro⟧. English stays unmarked. If (and only if) you correct a mistake, put ONE ⟦corr⟧...⟦/corr⟧ block at the very end. No other markup, no markdown, no asterisks, no em dashes.

STYLE: turns are SHORT, 2 to 4 sentences, ending with a question that invites the learner to speak. React like a friendly person first, teach second. Correct at most ONE mistake per turn, by naturally recasting; let small errors go. Match difficulty to Book ${book}: use words the learner likely knows, one small step above. If the learner writes Romanian, answer mostly in simple English with a short ⟦ro⟧...⟦/ro⟧ helper. Keep topics to everyday life, family, work, travel and the cultures they are curious about, suitable for this couple.
${mem.text ? '\nWhat you remember about this learner from previous days (use it naturally, do not recite it):\n' + mem.text : ''}`;
}

// ---------- apelul Gemini, în flux ----------
async function streamGemini(sys, history, onDelta) {
  const cfg = tutorCfg();
  const contents = history.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const res = await fetch(GURL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.gkey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: sys }] },
      contents,
      generationConfig: { temperature: 0.8, maxOutputTokens: 500, thinkingConfig: { thinkingBudget: 0 } },
    }),
  });
  if (!res.ok) throw new Error('Gemini ' + res.status);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', full = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      try {
        const obj = JSON.parse(line.slice(5).trim());
        for (const cand of obj.candidates || []) {
          for (const part of (cand.content || {}).parts || []) {
            if (part.text) { full += part.text; onDelta(part.text); }
          }
        }
      } catch (_) {}
    }
  }
  return full;
}

// ---------- redare: markere -> bule frumoase + voce ----------
function renderRich(el, raw) {
  el.innerHTML = '';
  let corr = '';
  let text = String(raw).replace(/⟦corr⟧([\s\S]*?)(⟦\/corr⟧|$)/, (_, c) => { corr = c.trim(); return ''; });
  const parts = text.split(/(⟦ro⟧[\s\S]*?(?:⟦\/ro⟧|$))/);
  for (const seg of parts) {
    if (!seg) continue;
    const m = seg.match(/^⟦ro⟧([\s\S]*?)(?:⟦\/ro⟧)?$/);
    if (m) el.appendChild(h('span', 'b-ro', esc(m[1])));
    else el.appendChild(document.createTextNode(seg.replace(/⟦[^⟧]*⟧?/g, '')));
  }
  return corr;
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
    const r = await fetch(`${cfgAll.url}/media/${cfgAll.box}/list`);
    const items = (await r.json()).sort((a, b) => b.stamp - a.stamp).slice(0, 3);
    if (!items.length) {
      wrap.appendChild(h('div', 'sub tc', 'Podcasturile video apar aici după următorul episod făcut acasă. 🎬'));
      return wrap;
    }
    wrap.appendChild(h('div', 'b-shelf-t', '🎬 Ultimele podcasturi'));
    for (const it of items) {
      const btn = h('button', 'b-vid', `▶ ${esc(decodeURIComponent(it.title || it.name))}`);
      btn.addEventListener('click', () => openVideo(`${cfgAll.url}/media/${cfgAll.box}/${it.name}`));
      wrap.appendChild(btn);
    }
  } catch (_) {
    wrap.appendChild(h('div', 'sub tc', 'Raftul video nu răspunde acum — încearcă mai târziu.'));
  }
  return wrap;
}
function openVideo(src) {
  const ov = h('div', 'b-video-ov');
  const vid = document.createElement('video');
  vid.controls = true; vid.autoplay = true; vid.playsInline = true;
  vid.src = src;
  const x = h('button', 'b-video-x', '✕');
  x.addEventListener('click', () => { try { vid.pause(); } catch (_) {} ov.remove(); });
  ov.appendChild(vid); ov.appendChild(x);
  document.body.appendChild(ov);
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

  videoShelf(cfg).then(shelf => sc.insertBefore(shelf, sc.firstChild));

  // cartile tiparite: al treilea drum, actualizat de mana (aplicatia nu stie ce citesc pe hartie)
  const bp = state.profile.bookProgress || { book: 0, note: '', at: 0 };
  const bc = h('div', 'card b-book');
  const opts = ['<option value="0">— nicio carte încă —</option>'];
  for (let i = 1; i <= 24; i++) opts.push(`<option value="${i}"${bp.book === i ? ' selected' : ''}>Cartea ${i}</option>`);
  bc.innerHTML = `<div class="b-book-t">📕 Cartea tipărită la care ești</div>
    <div class="b-book-row">
      <select class="b-book-sel">${opts.join('')}</select>
      <input class="b-book-note" inputmode="text" placeholder="pagina sau lecția" value="${esc(bp.note || '')}">
      <button class="b-book-save">Salvează</button>
    </div>
    <div class="b-book-msg muted">${bp.book ? 'Acum: Cartea ' + bp.book + (bp.note ? ', ' + esc(bp.note) : '') : 'Spune-i profesorului ce carte citești pe hârtie.'}</div>`;
  sc.appendChild(bc);
  bc.querySelector('.b-book-save').addEventListener('click', () => {
    const book = parseInt(bc.querySelector('.b-book-sel').value, 10) || 0;
    const note = bc.querySelector('.b-book-note').value.trim().slice(0, 40);
    state.profile.bookProgress = { book, note, at: Date.now() };
    save(true);
    memCache.t = 0; // reincarcam contextul ca profesorul sa stie pe loc
    bc.querySelector('.b-book-msg').textContent = book ? `✓ Salvat: Cartea ${book}${note ? ', ' + note : ''}` : '✓ Salvat';
  });

  const chat = h('div', 'b-chat');
  sc.appendChild(chat);
  const store = chatStore();
  const addBubble = (role, content) => {
    const b = h('div', 'msg ' + (role === 'user' ? 'user' : 'tutor'));
    if (role === 'user') b.textContent = content;
    else {
      const corr = renderRich(b, content);
      if (corr) {
        const cn = h('div', 'corr');
        cn.appendChild(h('div', 'corr-t', 'Observație'));
        const body = h('div');
        renderRich(body, corr);
        cn.appendChild(body);
        chat.appendChild(b);
        chat.appendChild(cn);
        return b;
      }
    }
    chat.appendChild(b);
    return b;
  };
  if (!store.messages.length) {
    addBubble('assistant', `Hello, ${state.profile.name || ''}! I am here, in your pocket. ⟦ro⟧Sunt aici, în buzunarul tău. Vorbim puțin în engleză?⟦/ro⟧ How is your day going?`);
  } else {
    for (const m of store.messages) addBubble(m.role, m.content);
  }

  const row = h('div', 'b-composer');
  const mic = h('button', 'b-mic', '🎤');
  const inp = h('textarea', 'b-in');
  inp.placeholder = 'Scrie sau apasă 🎤...';
  inp.rows = 1;
  const send = h('button', 'b-send', '➤');
  row.appendChild(mic); row.appendChild(inp); row.appendChild(send);
  a.insertBefore(row, a.querySelector('.navbar'));

  let busy = false;
  async function doSend() {
    const text = inp.value.trim();
    if (!text || busy) return;
    busy = true; send.disabled = true;
    stopSpeaking();
    inp.value = '';
    addBubble('user', text);
    pushMsg('user', text);
    const bubble = addBubble('assistant', '...');
    bubble.textContent = '';
    chat.scrollTop = chat.scrollHeight;
    window.scrollTo(0, document.body.scrollHeight);
    let raw = '';
    try {
      const sys = await systemPrompt();
      const ctx = chatStore().messages.slice(-12);
      raw = await streamGemini(sys, ctx, (d) => {
        raw += '';
        bubble.textContent = (bubble.textContent + d).slice(0, 4000);
        window.scrollTo(0, document.body.scrollHeight);
      });
      const corr = renderRich(bubble, raw);
      if (corr) {
        const cn = h('div', 'corr');
        cn.appendChild(h('div', 'corr-t', 'Observație'));
        const body = h('div');
        renderRich(body, corr);
        cn.appendChild(body);
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
      if (r && r.ok && r.text) inp.value = (inp.value ? inp.value + ' ' : '') + r.text;
    } catch (_) {}
    listening = false; mic.classList.remove('rec');
    inp.focus();
  });

  window.scrollTo(0, document.body.scrollHeight);
}
