// Utilidades de texto do motor: comparação sem acento/caixa, palavras-chave e filtro de palavrões.
// Puro (sem DOM/rede/tempo).

/** minúsculas e sem acentos: "Ação" → "acao". */
export const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A palavra-chave aparece no texto? Começo de palavra, aceitando flexões (plural, verbo): "janela" acha "janelas". */
export function keywordUsed(text, keyword) {
  const k = fold(keyword).trim();
  if (!k) return true;
  return new RegExp(`(^|[^a-z0-9])${escapeRe(k)}`).test(fold(text));
}

/** Quantas das palavras-chave o texto usou. */
export function keywordStats(text, keywords = []) {
  const used = keywords.filter((k) => keywordUsed(text, k));
  return { total: keywords.length, used: used.length, missing: keywords.filter((k) => !used.includes(k)) };
}

// Lista curta e objetiva (palavrões comuns em português). O filtro é opcional (config `filterProfanity`).
const BAD = [
  'porra', 'caralho', 'merda', 'bosta', 'puta', 'puto', 'foda', 'foder', 'fodido', 'fodase', 'cacete', 'buceta', 'boceta',
  'arrombado', 'arrombada', 'cuzao', 'desgraca', 'fdp', 'pqp', 'vsf', 'vtnc', 'viado', 'otario', 'babaca',
];
const BAD_RE = new RegExp(`\\b(${BAD.join('|')})\\b`, 'gi');

/** Troca cada palavrão por primeira letra + asteriscos (compara sem acento, preserva o resto do texto). */
export function maskProfanity(text) {
  // mapeia o texto sem acentos posição a posição (NFD + remoção de marcas mantém o mesmo tamanho por caractere base)
  const chars = [...text];
  const plain = chars.map((c) => c.normalize('NFD').replace(/[̀-ͯ]/g, '')).join('');
  if (plain.length !== text.length) return text; // caracteres compostos raros: não arrisca desalinhar
  let out = '';
  let last = 0;
  for (const m of plain.matchAll(BAD_RE)) {
    out += text.slice(last, m.index) + text[m.index] + '*'.repeat(m[0].length - 1);
    last = m.index + m[0].length;
  }
  return out + text.slice(last);
}
