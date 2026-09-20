export const TEXT_TYPES = ['poema', 'carta', 'conto', 'diário', 'manifesto', 'discurso', 'bilhete'];

export const DEFAULT_CONFIG = {
  vanguards: null, // null = todas as do conteúdo
  keywordsPerTheme: 0,
  modifiersEnabled: true,
  minChars: 200,
  textTypes: [...TEXT_TYPES],
  fixedTextType: null, // se preenchido, todos escrevem esse tipo
  guessesPerPlayer: 1,
  reportQuorum: 2,
  reportPenalty: 2,
  roundsPerPlayer: 3, // cada rodada todos escrevem 1 vez
  fanThreshold: 3, // título "Fã do X": mesma vanguarda chutada N vezes
  keywordPenalty: 0, // pontos que o autor perde se não usar TODAS as palavras-chave (0 = só informativo)
  filterProfanity: false, // troca palavrões por asteriscos ao capturar o texto
  // Facilitador: só a UI usa (Fase 2/4), fica aqui pra viajar junto com a config da sala.
  helper: { autocomplete: true, showAllNames: false },
  timers: { writing: 120, revealing: 10, guessing: 20, reporting: 25, scoring: 12 }, // segundos
};

const clampInt = (v, lo, hi, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

export function normalizeConfig(partial = {}, content) {
  const d = DEFAULT_CONFIG;
  const p = partial || {};
  const all = content.vanguards;
  const chosen = (p.vanguards ?? all).filter((v) => all.includes(v));
  if (chosen.length < 2) throw new Error('São necessárias pelo menos 2 vanguardas na sala.');

  const textTypes = (p.textTypes ?? d.textTypes).filter((t) => TEXT_TYPES.includes(t));
  const fixed = p.fixedTextType && TEXT_TYPES.includes(p.fixedTextType) ? p.fixedTextType : null;
  if (!textTypes.length && !fixed) throw new Error('Selecione pelo menos 1 tipo de texto.');

  const t = { ...d.timers, ...(p.timers || {}) };
  const timers = {};
  for (const k of Object.keys(d.timers)) timers[k] = clampInt(t[k], 1, 3600, d.timers[k]);

  return {
    vanguards: [...chosen],
    keywordsPerTheme: clampInt(p.keywordsPerTheme ?? d.keywordsPerTheme, 0, 5, d.keywordsPerTheme),
    modifiersEnabled: p.modifiersEnabled ?? d.modifiersEnabled,
    minChars: clampInt(p.minChars ?? d.minChars, 0, 3000, d.minChars),
    textTypes,
    fixedTextType: fixed,
    guessesPerPlayer: clampInt(p.guessesPerPlayer ?? d.guessesPerPlayer, 1, 5, d.guessesPerPlayer),
    reportQuorum: clampInt(p.reportQuorum ?? d.reportQuorum, 1, 20, d.reportQuorum),
    reportPenalty: clampInt(p.reportPenalty ?? d.reportPenalty, 0, 20, d.reportPenalty),
    roundsPerPlayer: clampInt(p.roundsPerPlayer ?? d.roundsPerPlayer, 1, 20, d.roundsPerPlayer),
    fanThreshold: clampInt(p.fanThreshold ?? d.fanThreshold, 2, 20, d.fanThreshold),
    keywordPenalty: clampInt(p.keywordPenalty ?? d.keywordPenalty, 0, 10, d.keywordPenalty),
    filterProfanity: !!(p.filterProfanity ?? d.filterProfanity),
    helper: { ...d.helper, ...(p.helper || {}) },
    timers,
  };
}
