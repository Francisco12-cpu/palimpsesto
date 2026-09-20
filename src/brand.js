// Identidade do jogo num lugar só (trocar o nome aqui muda o jogo inteiro).
export const BRAND = {
  // false = interface sem emojis (usa ícones SVG e iniciais). Troque para true para religar.
  emoji: false,
  name: 'Palimpsesto',
  // Palimpsesto: manuscrito cujo texto foi raspado e reescrito por cima, guardando os rastros
  // do que havia antes — como um texto escrito sobre o estilo de outra época.
  // Frase do anel rúnico do logotipo (transliteração fonética do português para runas).
  phrase: 'Raspe · Reescreva · Adivinhe',
  tagline: 'O jogo das vanguardas literárias',
  slogan: 'Escreva no estilo. Descubra a escola.',
  author: 'Francisco Audir',
  instagram: '@filho.af',
  instagramUrl: 'https://instagram.com/filho.af',
};

const RUNES = {
  A: 'ᚨ', B: 'ᛒ', C: 'ᚲ', D: 'ᛞ', E: 'ᛖ', F: 'ᚠ', G: 'ᚷ', H: 'ᚺ', I: 'ᛁ', J: 'ᛃ', K: 'ᚲ', L: 'ᛚ', M: 'ᛗ',
  N: 'ᚾ', O: 'ᛟ', P: 'ᛈ', Q: 'ᚲ', R: 'ᚱ', S: 'ᛊ', T: 'ᛏ', U: 'ᚢ', V: 'ᚢ', W: 'ᚹ', X: 'ᚲᛊ', Y: 'ᛃ', Z: 'ᛉ',
};

/** Transliteração para runas (Futhark Antigo) — "Francisco Audir" → ᚠᚱᚨᚾᚲᛁᛊᚲᛟ ᚨᚢᛞᛁᚱ */
export function runes(text) {
  return [...text.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()]
    .map((c) => RUNES[c] ?? (c === ' ' ? ' ' : c === '·' ? '᛫' : ''))
    .join('');
}
