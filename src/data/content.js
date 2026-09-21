// Carrega o conteúdo do jogo dos arquivos de dados (/data/*.json).
//
// Para acrescentar um tema, uma vanguarda ou um modificador, basta editar o JSON —
// nenhum código precisa ser tocado.
//
// Funciona nos dois mundos: no navegador busca os arquivos por HTTP; no Node (testes,
// ferramentas) lê do disco. O `await` no topo do módulo faz quem importa esperar,
// então todo o resto do código continua usando `CONTENT` como antes.

const DATA = new URL('../../data/', import.meta.url);

async function loadJson(name) {
  const url = new URL(name, DATA);
  if (url.protocol === 'file:') { // Node
    const { readFile } = await import('node:fs/promises');
    return JSON.parse(await readFile(url, 'utf8'));
  }
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`não consegui carregar ${name} (${res.status})`);
  return res.json();
}

const [vanguardas, temas, modificadores, tiposTexto, titulos] = await Promise.all(
  ['vanguardas.json', 'temas.json', 'modificadores.json', 'tiposTexto.json', 'titulos.json'].map(loadJson),
);

/** Uma vanguarda: { name, emoji, group, short, about, howTo, example } */
export const VANGUARD_INFO = vanguardas.vanguardas.map((v) => ({
  name: v.nome,
  emoji: v.emoji,
  group: v.grupo,
  short: v.resumo,
  about: v.sobre,
  howTo: v.comoEscrever,
  example: v.exemplo,
}));
export const VANGUARDS = VANGUARD_INFO.map((v) => v.name);
export const EMOJI = Object.fromEntries(VANGUARD_INFO.map((v) => [v.name, v.emoji]));
export const VANGUARD_GROUPS = vanguardas.grupos;
/** Tema e modificador usados nos exemplos comparativos das 21 vanguardas. */
export const EXAMPLE_PROMPT = { theme: vanguardas.exemploTema, modifier: vanguardas.exemploModificador };

/** Modo fácil: poucas vanguardas bem contrastantes. */
export const VANGUARD_PRESETS = {
  todas: { label: 'Todas', names: VANGUARDS },
  facil: {
    label: 'Modo fácil (7 bem diferentes)',
    names: ['Barroco', 'Romantismo', 'Realismo', 'Futurismo', 'Dadaísmo', 'Surrealismo', 'Concretismo'].filter((n) => VANGUARDS.includes(n)),
  },
  europeias: { label: 'Só europeias', names: VANGUARD_INFO.filter((v) => v.group === 'Vanguardas europeias').map((v) => v.name) },
  brasileiras: { label: 'Só brasileiras', names: VANGUARD_INFO.filter((v) => v.group === 'Brasileiras').map((v) => v.name) },
};

/** Tema: { text, tone, keywords[] } — `tone` mistura os tons no sorteio. */
export const THEMES = temas.temas.map((t) => ({ text: t.texto, tone: t.tom, keywords: t.palavrasChave }));
export const TONES = temas.tons;
export const MODIFIERS = modificadores.modificadores;
export const TEXT_TYPES = tiposTexto.tipos;

/** Conquistas: { id, emoji, name, description, highlight, times? } */
export const TITLE_INFO = titulos.titulos.map((t) => ({
  id: t.id,
  emoji: t.emoji,
  name: t.nome,
  description: t.descricao,
  highlight: t.destaque,
  ...(t.vezes != null && { times: t.vezes }),
}));
export const MAX_TITLES_PER_PLAYER = titulos.maximoPorJogador;

/** É isto que o motor recebe como `content`. */
export const CONTENT = { vanguards: VANGUARDS, themes: THEMES, modifiers: MODIFIERS, textTypes: TEXT_TYPES, titles: TITLE_INFO };
