// course.js — încarcă structura cursului și unitățile (fișiere JSON statice, servite din cache offline).

export const course = {
  meta: null,      // { units: [{id, book, title, sub, ico, cefr, lessonCount, file, tracks?}] }
  units: {},       // id -> date complete
};

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
  return res.json();
}

export async function loadCourse() {
  if (course.meta) return course.meta;
  course.meta = await fetchJson('data/course.json');
  return course.meta;
}

export async function loadUnit(unitId) {
  if (course.units[unitId]) return course.units[unitId];
  const meta = await loadCourse();
  const u = meta.units.find(x => x.id === unitId);
  if (!u) throw new Error('unit? ' + unitId);
  const data = await fetchJson('data/' + u.file);
  // indexăm și validăm minim — o unitate coruptă nu are voie să dărâme aplicația
  data.id = unitId;
  data.vocab = Array.isArray(data.vocab) ? data.vocab : [];
  data.sentences = Array.isArray(data.sentences) ? data.sentences : [];
  data.grammar = Array.isArray(data.grammar) ? data.grammar : [];
  data.traps = Array.isArray(data.traps) ? data.traps : [];
  data.lessons = Array.isArray(data.lessons) ? data.lessons : [];
  course.units[unitId] = data;
  return data;
}

// unități deja începute/terminate — pentru exersare și recapitulare
export async function loadStartedUnits(profile) {
  const meta = await loadCourse();
  const started = meta.units.filter(u => {
    const st = profile.game.units[u.id];
    return st && st.done > 0;
  });
  const datas = [];
  for (const u of started) {
    try { datas.push(await loadUnit(u.id)); } catch (_) {}
  }
  return datas;
}

// progres: câte lecții din unitate sunt făcute
export function unitProgress(profile, unitMeta) {
  const st = profile.game.units[unitMeta.id];
  return { done: st ? st.done : 0, test: st ? !!st.test : false, total: unitMeta.lessonCount };
}

// prima unitate cu lecții nefăcute (unde e "săgeata")
export function currentUnitIndex(profile, meta) {
  for (let i = 0; i < meta.units.length; i++) {
    const p = unitProgress(profile, meta.units[i]);
    if (p.done < p.total || !p.test) return i;
  }
  return meta.units.length - 1;
}
