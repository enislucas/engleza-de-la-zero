// mascot.js — Barza (mascota aplicației): SVG desenat în cod, fără fișiere externe.
// Stări: happy, cheer, sad, think, sleep, travel, teach.

const BODY = (extra, wingRot = 18) => `
<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Barza">
  <ellipse cx="100" cy="188" rx="46" ry="8" fill="rgba(0,0,0,.10)"/>
  <!-- picioare -->
  <path d="M88 150 L86 180 M112 150 L114 180" stroke="#e8722c" stroke-width="6" stroke-linecap="round" fill="none"/>
  <path d="M80 182 h14 M108 182 h14" stroke="#e8722c" stroke-width="5" stroke-linecap="round"/>
  <!-- corp -->
  <ellipse cx="100" cy="120" rx="44" ry="40" fill="#ffffff" stroke="#2d3436" stroke-width="4"/>
  <!-- aripa -->
  <g transform="rotate(${wingRot} 92 118)">
    <ellipse cx="86" cy="124" rx="26" ry="16" fill="#2d3436"/>
  </g>
  <!-- gat + cap -->
  <path d="M128 108 C 140 84, 138 62, 124 52" stroke="#ffffff" stroke-width="16" fill="none" stroke-linecap="round"/>
  <path d="M128 108 C 140 84, 138 62, 124 52" stroke="#2d3436" stroke-width="20" fill="none" stroke-linecap="round" opacity="0"/>
  <circle cx="118" cy="46" r="22" fill="#ffffff" stroke="#2d3436" stroke-width="4"/>
  <!-- cioc -->
  <path d="M136 44 L172 52 L136 56 Z" fill="#e8722c" stroke="#c85d1e" stroke-width="2" stroke-linejoin="round"/>
  ${extra}
</svg>`;

const EYE_OPEN = `<circle cx="116" cy="42" r="4.5" fill="#2d3436"/><circle cx="117.5" cy="40.5" r="1.6" fill="#fff"/>`;
const EYE_HAPPY = `<path d="M111 42 q5 -6 10 0" stroke="#2d3436" stroke-width="3.5" fill="none" stroke-linecap="round"/>`;
const EYE_CLOSED = `<path d="M111 44 q5 3 10 0" stroke="#2d3436" stroke-width="3.5" fill="none" stroke-linecap="round"/>`;
const BLUSH = `<ellipse cx="106" cy="52" rx="6" ry="3.5" fill="#ffb3ab" opacity=".7"/>`;

export const MASCOT = {
  happy: () => BODY(EYE_OPEN + BLUSH, 18),
  cheer: () => BODY(`
    ${EYE_HAPPY}${BLUSH}
    <g stroke="#ffc800" stroke-width="3" stroke-linecap="round">
      <path d="M40 30 l6 6 M60 16 l0 8 M78 26 l-5 6"/>
      <path d="M158 88 l6 -5 M170 104 l8 0"/>
    </g>
    <text x="34" y="70" font-size="22">🎉</text>`, -24),
  sad: () => BODY(`
    <circle cx="116" cy="44" r="4.5" fill="#2d3436"/>
    <path d="M108 34 q8 -4 14 2" stroke="#2d3436" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path d="M124 62 q2 6 -1 10" stroke="#74b9ff" stroke-width="4" fill="none" stroke-linecap="round"/>`, 30),
  think: () => BODY(`
    ${EYE_OPEN}
    <circle cx="150" cy="18" r="4" fill="#b2bec3"/>
    <circle cx="162" cy="8" r="6" fill="#b2bec3"/>
    <path d="M132 66 a10 10 0 0 1 0 0" />
    <path d="M104 30 q6 -8 14 -4" stroke="#2d3436" stroke-width="3" fill="none" stroke-linecap="round"/>`, 10),
  sleep: () => BODY(`
    ${EYE_CLOSED}
    <text x="140" y="20" font-size="20" fill="#636e72" font-family="sans-serif" font-weight="bold">z</text>
    <text x="152" y="12" font-size="14" fill="#95a5a6" font-family="sans-serif" font-weight="bold">z</text>`, 34),
  travel: () => BODY(`
    ${EYE_HAPPY}${BLUSH}
    <rect x="34" y="140" width="34" height="26" rx="5" fill="#c0632b"/>
    <rect x="45" y="132" width="12" height="10" rx="3" fill="none" stroke="#8a4620" stroke-width="4"/>
    <line x1="34" y1="152" x2="68" y2="152" stroke="#8a4620" stroke-width="3"/>
    <text x="140" y="26" font-size="20">✈️</text>`, 26),
  teach: () => BODY(`
    ${EYE_OPEN}
    <rect x="30" y="120" width="30" height="38" rx="4" fill="#1cb0f6" stroke="#1487bd" stroke-width="3"/>
    <line x1="36" y1="130" x2="54" y2="130" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
    <line x1="36" y1="138" x2="54" y2="138" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
    <line x1="36" y1="146" x2="48" y2="146" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`, 22),
};

export function mascotSvg(mood = 'happy') {
  const fn = MASCOT[mood] || MASCOT.happy;
  return fn();
}

// Replici scurte de încurajare (rotite aleator).
export const CHEERS = ['Bravo!', 'Excelent!', 'Corect!', 'Foarte bine!', 'Așa da!', 'Perfect!', 'Super!'];
export const SOFT_WRONG = [
  'Nu-i nimic. Uite răspunsul corect:',
  'Aproape! Răspunsul corect era:',
  'Se întâmplă oricui. Corect era:',
  'Data viitoare iese. Răspunsul corect:',
];
export function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
