// Ícones SVG inline (traço herdando currentColor) + o logotipo. Sem arquivos externos: funciona offline.
import { BRAND, runes } from '../brand.js';
import { EMOJI } from '../data/vanguards.js';

const P = {
  pen: '<path d="M20 4c-7 0-12 4-14 10l-1.5 5.5L10 18c6-2 10-7 10-14z"/><path d="M8.5 15.5 15 9"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h12l-2.5 4L17 12H5"/>',
  trophy: '<path d="M8 21h8M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3"/>',
  star: '<path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.5 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/>',
  scroll: '<path d="M8 4h11v13a3 3 0 0 1-3 3H6a3 3 0 0 0 3-3V4z"/><path d="M8 4a3 3 0 0 0-3 3v1h3M11 9h5M11 13h5"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.4"/><path d="M17 14c2.5 0 4.5 2 4.5 5"/>',
  crown: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m4 12.5 5 5L20 6.5"/>',
  back: '<path d="M15 5 8 12l7 7"/>',
  play: '<path d="M7 4.5v15l13-7.5z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  door: '<path d="M5 21V4h11v17M5 21h14M13 12h.01"/><path d="M16 8h4v13"/>',
  bot: '<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 8V4M9.5 13h.01M14.5 13h.01M9 16.5h6"/><circle cx="12" cy="3.5" r="1"/>',
  book: '<path d="M5 4h9a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4z"/><path d="M5 16a4 4 0 0 1 4-4h9"/>',
  flame: '<path d="M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 .5 2 1.5 2.5 2 2 0-3-1-5 1-8z"/>',
  sound: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  mute: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="m17 9 5 6M22 9l-5 6"/>',
  send: '<path d="M4 12 20 4l-4 16-4.5-6.5z"/><path d="m11.5 13.5 8-9"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7L11.5 6.8"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1.5-1.5"/>',
};

/** icon('pen', 20) → <svg> inline. */
export function icon(name, size = 20, cls = '') {
  return `<svg class="ico ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] ?? ''}</svg>`;
}

let logoCount = 0;

/**
 * Anel rúnico: cada runa é posicionada num ângulo exato (não depende da largura da fonte),
 * com a palavra do meio da frase centralizada no topo e o círculo fechando por igual.
 */
function ringGlyphs(r, fontSize) {
  const words = BRAND.phrase.split('·').map((w) => runes(w.trim()));
  const mid = Math.floor(words.length / 2);
  const sep = ' ᛫ ';
  const chars = [...(words.join(sep) + sep)]; // termina com separador, fechando o círculo
  const before = [...(words.slice(0, mid).join(sep) + (mid ? sep : ''))].length;
  const center = before + ([...words[mid]].length - 1) / 2; // índice do centro da palavra do meio
  const step = 360 / chars.length;
  return chars.map((ch, i) => (ch === ' ' ? '' :
    `<text x="100" y="${100 - r}" transform="rotate(${((i - center) * step).toFixed(2)} 100 100)" text-anchor="middle" dominant-baseline="central" font-size="${fontSize}">${ch}</text>`)).join('');
}

/** Logotipo: anel rúnico dourado com uma pena de escrever e a folha "raspada" atrás. */
export function logo(size = 120) {
  const id = `g${logoCount++}`;
  return `<svg class="logo" width="${size}" height="${size}" viewBox="0 0 200 200" role="img" aria-label="${BRAND.name}">
    <defs>
      <linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#f3d97a"/><stop offset=".55" stop-color="#d4af37"/><stop offset="1" stop-color="#8b6914"/>
      </linearGradient>
    </defs>
    <circle cx="100" cy="100" r="95" fill="none" stroke="url(#${id})" stroke-width="2"/>
    <circle cx="100" cy="100" r="64" fill="none" stroke="url(#${id})" stroke-width="1" opacity=".7"/>
    <g fill="url(#${id})" font-family="'Noto Sans Runic','Segoe UI Symbol',serif">${ringGlyphs(79.5, 15)}</g>
    <g opacity=".22" stroke="url(#${id})" stroke-width="1.2" fill="none">
      <path d="M62 70h60M62 84h72M62 98h48M62 112h66M62 126h40"/>
    </g>
    <g fill="none" stroke="url(#${id})" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M142 46c-30 2-52 22-60 52l-8 30 30-10c28-8 44-34 38-72z" fill="rgba(212,175,55,.12)"/>
      <path d="M78 122 128 66"/>
      <path d="M74 128 62 146" stroke-width="2.4"/>
    </g>
  </svg>`;
}

/** Selo circular de uma vanguarda: emoji (se BRAND.emoji) ou a inicial em letra clássica. */
export function seal(vanguard, size = 64) {
  const face = BRAND.emoji ? (EMOJI[vanguard] ?? '📜') : `<span class="seal-letter">${[...vanguard][0]}</span>`;
  return `<span class="seal" style="--s:${size}px">${face}</span>`;
}
