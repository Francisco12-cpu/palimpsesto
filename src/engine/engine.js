// Motor do jogo — funções puras, sem rede, sem DOM, sem timers.
//
// - O estado é 100% serializável em JSON (dá pra mandar por WebSocket / migrar de host).
// - Toda função recebe o estado e devolve um NOVO estado; nunca muta o original.
// - O tempo entra sempre como argumento `now` (ms). Fases têm `phaseEndsAt` absoluto,
//   então o cliente calcula o tempo restante por timestamp (spec seção 6).
// - Ações de jogador devolvem `{ state, error }` (error = null se ok), para que um host
//   nunca quebre com entrada inválida de um cliente.
// - Jogadores são uma lista genérica: { id, name, isBot?, connected? }.
//
// Fluxo: lobby → [writing → (preview → guessing → reveal → reporting)×N textos → scoring]×rodadas → finished
// Cada texto é tratado sozinho: lê, palpita, descobre a resposta e denuncia antes de passar ao próximo.

import { makeRng } from './rng.js';
import { normalizeConfig } from './config.js';
import { computeTitles } from './titles.js';
import { keywordStats, maskProfanity } from './text.js';

export const PHASES = {
  LOBBY: 'lobby',
  WRITING: 'writing',
  PREVIEW: 'preview', // leitura rápida do texto, antes de abrir os palpites
  GUESSING: 'guessing',
  REVEAL: 'reveal', // resposta daquele texto: vanguarda, quem acertou e quem errou
  REPORTING: 'reporting', // denúncia só daquele texto
  SCORING: 'scoring',
  FINISHED: 'finished',
};

const MAX_TEXT_LENGTH = 5000;
const clone = (x) => structuredClone(x);
const ok = (state) => ({ state, error: null });
const fail = (state, error) => ({ state, error });

// ---------------------------------------------------------------- criação

export function createGame({ players, config, content, seed = Date.now() }) {
  if (!Array.isArray(players) || players.length < 2) throw new Error('São necessários pelo menos 2 jogadores.');
  const ids = new Set(players.map((p) => p.id));
  if (ids.size !== players.length) throw new Error('IDs de jogadores duplicados.');

  const cfg = normalizeConfig(config, content);
  return {
    version: 1,
    config: cfg,
    content: { themes: clone(content.themes), modifiers: [...content.modifiers], titles: clone(content.titles ?? []) },
    rngState: seed >>> 0,
    players: players.map((p) => ({ id: p.id, name: p.name, ...(p.color != null && { color: p.color }), isBot: !!p.isBot, connected: p.connected !== false })),
    scores: Object.fromEntries(players.map((p) => [p.id, 0])),
    phase: PHASES.LOBBY,
    round: 0,
    totalRounds: cfg.roundsPerPlayer,
    phaseEndsAt: null,
    assignments: {}, // { playerId: { vanguard, theme, tone, keywords, modifier, textType, minChars } }
    drafts: {}, // { playerId: texto } — rascunho vivo enquanto escreve
    texts: {}, // { playerId: texto } — capturado quando o tempo acaba
    order: [], // ordem de revelação (ids dos autores)
    cursor: 0, // índice do texto atual em `order`
    guesses: {}, // { autorId: { palpiteiroId: [vanguardas] } } — os palpites de cada um são privados
    hits: {}, // { autorId: [ids na ORDEM em que acertaram] } — público: é o que acende o avatar
    reports: {}, // { autorId: [denunciantesIds] } — público durante 'reporting'
    done: [], // jogadores que já terminaram a fase atual (guessing/reporting)
    usedThemes: [],
    lastResult: null,
    history: [],
    titles: null,
  };
}

export function startGame(state, now) {
  if (state.phase !== PHASES.LOBBY) return fail(state, 'O jogo já começou.');
  const s = clone(state);
  s.round = 1;
  enterWriting(s, now);
  return ok(s);
}

// ---------------------------------------------------------------- sorteio da rodada

function assignRound(s, rng) {
  const { config, content } = s;
  const ids = s.players.map((p) => p.id);

  // Vanguardas: uma por jogador, distintas enquanto houver vanguardas suficientes.
  const pool = rng.shuffle(config.vanguards);
  const assignments = {};
  const roundThemes = [];

  ids.forEach((id, i) => {
    // Tema: evita repetir na partida; sorteia o tom primeiro pra misturar leve/pesado/etc.
    let avail = content.themes.filter((t) => !s.usedThemes.includes(t.text) && !roundThemes.includes(t.text));
    if (!avail.length) {
      s.usedThemes = [];
      avail = content.themes.filter((t) => !roundThemes.includes(t.text));
      if (!avail.length) avail = content.themes;
    }
    const tone = rng.pick([...new Set(avail.map((t) => t.tone))]);
    const theme = rng.pick(avail.filter((t) => t.tone === tone));
    roundThemes.push(theme.text);

    const keywords = rng.shuffle(theme.keywords || []).slice(0, config.keywordsPerTheme);
    const modifier = config.modifiersEnabled && content.modifiers.length ? rng.pick(content.modifiers) : null;
    const textType = config.fixedTextType || rng.pick(config.textTypes);

    assignments[id] = {
      vanguard: pool[i % pool.length],
      theme: theme.text,
      tone: theme.tone,
      keywords,
      modifier,
      textType,
      minChars: config.minChars,
    };
  });

  s.usedThemes.push(...roundThemes);
  s.assignments = assignments;
}

// ---------------------------------------------------------------- transições de fase
// Funções `enter*`/`advance` MUTAM o clone `s` (uso interno).

const durationMs = (s, phase) => s.config.timers[phase] * 1000;

function enterWriting(s, now) {
  const rng = makeRng(s.rngState);
  assignRound(s, rng);
  s.rngState = rng.state();
  s.phase = PHASES.WRITING;
  s.phaseEndsAt = now + durationMs(s, 'writing');
  s.drafts = {};
  s.texts = {};
  s.order = [];
  s.cursor = 0;
  s.guesses = {};
  s.hits = {};
  s.reports = {};
  s.done = [];
}

function enterPreview(s, now) {
  s.phase = PHASES.PREVIEW;
  s.phaseEndsAt = now + durationMs(s, 'preview');
  s.done = [];
}

function enterGuessing(s, now) {
  s.phase = PHASES.GUESSING;
  s.phaseEndsAt = now + durationMs(s, 'guessing');
  s.done = [s.order[s.cursor]]; // o autor não palpita no próprio texto
}

function enterReveal(s, now) {
  s.phase = PHASES.REVEAL;
  s.phaseEndsAt = now + durationMs(s, 'reveal');
  s.done = [];
}

function enterReporting(s, now) {
  s.phase = PHASES.REPORTING;
  s.phaseEndsAt = now + durationMs(s, 'reporting');
  s.done = [s.order[s.cursor]]; // ninguém denuncia o próprio texto
}

/** Quórum efetivo: nunca maior que o nº de possíveis denunciantes (todos menos o autor). */
export const effectiveQuorum = (s) => Math.min(s.config.reportQuorum, Math.max(1, s.players.length - 1));

function enterScoring(s, now) {
  const result = computeRoundResult(s);
  for (const [id, d] of Object.entries(result.deltas)) {
    const before = s.scores[id];
    const after = Math.max(0, before + d.gained - d.lost); // piso em 0
    d.net = after - before;
    s.scores[id] = after;
  }
  s.lastResult = result;
  s.history.push(result);
  s.phase = PHASES.SCORING;
  s.phaseEndsAt = now + durationMs(s, 'scoring');
  s.done = [];
}

function enterFinished(s) {
  s.phase = PHASES.FINISHED;
  s.phaseEndsAt = null;
  s.done = [];
  s.titles = computeTitles(s);
}

function advance(s, now) {
  switch (s.phase) {
    case PHASES.WRITING: {
      // Texto capturado exatamente como está neste instante.
      s.texts = Object.fromEntries(s.players.map((p) => {
        const raw = s.drafts[p.id] ?? '';
        return [p.id, s.config.filterProfanity ? maskProfanity(raw) : raw];
      }));
      const rng = makeRng(s.rngState);
      s.order = rng.shuffle(s.players.map((p) => p.id));
      s.rngState = rng.state();
      s.cursor = 0;
      enterPreview(s, now);
      break;
    }
    case PHASES.PREVIEW:
      enterGuessing(s, now);
      break;
    case PHASES.GUESSING:
      enterReveal(s, now);
      break;
    case PHASES.REVEAL:
      enterReporting(s, now);
      break;
    case PHASES.REPORTING:
      if (s.cursor + 1 < s.order.length) {
        s.cursor += 1;
        enterPreview(s, now);
      } else enterScoring(s, now);
      break;
    case PHASES.SCORING:
      if (s.round < s.totalRounds) {
        s.round += 1;
        enterWriting(s, now);
      } else enterFinished(s);
      break;
    default:
      break;
  }
}

/** Todos os jogadores conectados terminaram? (desconectados nunca seguram a fase) */
function allDone(s) {
  const connected = s.players.filter((p) => p.connected);
  return connected.length > 0 && connected.every((p) => s.done.includes(p.id));
}

// Botão "Pronto": em toda fase com tempo de jogador. Se todos os conectados estiverem
// prontos, a fase avança sem esperar o timer.
const canFinishEarly = (s) =>
  s.phase === PHASES.WRITING || s.phase === PHASES.PREVIEW || s.phase === PHASES.GUESSING ||
  s.phase === PHASES.REVEAL || s.phase === PHASES.REPORTING;

function settle(s, now) {
  if (canFinishEarly(s) && allDone(s)) advance(s, now);
}

/**
 * Avança o relógio. Chamar periodicamente (o host, ou o driver do modo solo).
 * Devolve a MESMA referência se nada mudou.
 */
/**
 * `graceMs`: tolerância só na ESCRITA (o host usa ~400 ms para o último trecho digitado chegar antes da captura).
 */
export function tick(state, now, graceMs = 0) {
  const grace = state.phase === PHASES.WRITING ? graceMs : 0;
  if (state.phaseEndsAt == null || now < state.phaseEndsAt + grace) return state;
  const s = clone(state);
  advance(s, now);
  return s;
}

export const timeLeftMs = (state, now) =>
  state.phaseEndsAt == null ? 0 : Math.max(0, state.phaseEndsAt - now);

// ---------------------------------------------------------------- ações dos jogadores

const hasPlayer = (s, id) => s.players.some((p) => p.id === id);

export function updateDraft(state, playerId, text) {
  if (state.phase !== PHASES.WRITING) return fail(state, 'Não é hora de escrever.');
  if (!hasPlayer(state, playerId)) return fail(state, 'Jogador desconhecido.');
  if (typeof text !== 'string') return fail(state, 'Texto inválido.');
  if (state.done.includes(playerId)) return fail(state, 'Você já marcou pronto; o texto está travado.');
  const s = clone(state);
  s.drafts[playerId] = text.slice(0, MAX_TEXT_LENGTH);
  return ok(s);
}

export function submitGuess(state, playerId, vanguard, now) {
  if (state.phase !== PHASES.GUESSING) return fail(state, 'Não é hora de palpitar.');
  if (!hasPlayer(state, playerId)) return fail(state, 'Jogador desconhecido.');
  const authorId = state.order[state.cursor];
  if (playerId === authorId) return fail(state, 'Você não palpita no próprio texto.');
  if (!state.config.vanguards.includes(vanguard)) return fail(state, 'Vanguarda inválida.');
  if ((state.hits[authorId] ?? []).includes(playerId)) return fail(state, 'Você já acertou este texto.');
  const mine = state.guesses[authorId]?.[playerId] ?? [];
  if (mine.length >= state.config.guessesPerPlayer) return fail(state, 'Sem palpites restantes.');
  if (mine.includes(vanguard)) return fail(state, 'Você já palpitou essa vanguarda.');

  const s = clone(state);
  s.guesses[authorId] ??= {};
  s.guesses[authorId][playerId] = [...mine, vanguard];
  const right = vanguard === s.assignments[authorId].vanguard;
  if (right) {
    // acerto é público (acende o avatar de quem acertou) e guarda a ORDEM, que vale pontos
    s.hits[authorId] ??= [];
    if (!s.hits[authorId].includes(playerId)) s.hits[authorId].push(playerId);
  }
  // acabou a vez de quem acertou ou gastou todos os palpites
  if ((right || mine.length + 1 >= s.config.guessesPerPlayer) && !s.done.includes(playerId)) s.done.push(playerId);
  settle(s, now);
  return ok(s);
}

/** Acertou a vanguarda do texto atual? (público; é o que o cliente usa para o "você errou"/avatar aceso) */
export const hasHit = (s, playerId, authorId = s.order[s.cursor]) => (s.hits[authorId] ?? []).includes(playerId);

/** Palpites que ainda restam a este jogador no texto atual. */
export function guessesLeft(s, playerId, authorId = s.order[s.cursor]) {
  if (authorId == null || playerId === authorId) return 0;
  if (hasHit(s, playerId, authorId)) return 0;
  return Math.max(0, s.config.guessesPerPlayer - (s.guesses[authorId]?.[playerId] ?? []).length);
}

/** "Pronto" — vale em qualquer fase de jogador. Na escrita trava o texto; no palpite abre mão dos restantes. */
export function markDone(state, playerId, now) {
  if (!canFinishEarly(state)) return fail(state, 'Nada a confirmar agora.');
  if (!hasPlayer(state, playerId)) return fail(state, 'Jogador desconhecido.');
  if (state.done.includes(playerId)) return ok(state);
  const s = clone(state);
  s.done.push(playerId);
  settle(s, now);
  return ok(s);
}

export function toggleReport(state, playerId, authorId) {
  if (state.phase !== PHASES.REPORTING) return fail(state, 'Não é hora de denunciar.');
  if (!hasPlayer(state, playerId) || !hasPlayer(state, authorId)) return fail(state, 'Jogador desconhecido.');
  if (playerId === authorId) return fail(state, 'Você não pode denunciar o próprio texto.');
  if (authorId !== state.order[state.cursor]) return fail(state, 'Só dá para denunciar o texto que está sendo mostrado.');
  const s = clone(state);
  const list = s.reports[authorId] ?? [];
  s.reports[authorId] = list.includes(playerId) ? list.filter((id) => id !== playerId) : [...list, playerId];
  if (!s.reports[authorId].length) delete s.reports[authorId];
  return ok(s);
}

export function setConnected(state, playerId, connected, now) {
  if (!hasPlayer(state, playerId)) return fail(state, 'Jogador desconhecido.');
  const s = clone(state);
  s.players.find((p) => p.id === playerId).connected = !!connected;
  settle(s, now); // quem caiu não pode segurar a fase
  return ok(s);
}

// ---------------------------------------------------------------- pontuação

/** Pontos de quem acertou em Nº lugar (a escala `hitPoints`; o último valor vale para os demais). */
export const pointsForRank = (config, rank) => config.hitPoints[Math.min(rank, config.hitPoints.length - 1)];

/**
 * Regras:
 *  quem acerta ganha conforme a ORDEM em que acertou aquele texto (padrão 3 / 2 / 1…)
 *  o autor ganha `authorPointPerHit` por cada pessoa que acertou a vanguarda dele
 *  denúncia com quórum e palavras-chave faltando descontam do autor (o piso em 0 é aplicado em enterScoring)
 */
export function computeRoundResult(s) {
  const quorum = effectiveQuorum(s);
  const deltas = Object.fromEntries(s.players.map((p) => [p.id, { gained: 0, lost: 0, net: 0 }]));
  const texts = s.order.map((authorId) => {
    const vanguard = s.assignments[authorId].vanguard;
    const guesses = s.guesses[authorId] ?? {};
    const hits = (s.hits[authorId] ?? []).filter((id) => deltas[id]); // já na ordem em que acertaram
    const misses = Object.keys(guesses).filter((id) => guesses[id].length && !hits.includes(id));
    const reporters = s.reports[authorId] ?? [];
    const denounced = reporters.length >= quorum;

    const points = {};
    hits.forEach((id, rank) => {
      points[id] = pointsForRank(s.config, rank);
      deltas[id].gained += points[id];
    });
    deltas[authorId].gained += hits.length * s.config.authorPointPerHit;
    if (denounced) deltas[authorId].lost += s.config.reportPenalty;
    const text = s.texts[authorId] ?? '';
    const kw = keywordStats(text, s.assignments[authorId].keywords);
    if (kw.missing.length && s.config.keywordPenalty > 0) deltas[authorId].lost += s.config.keywordPenalty;

    return {
      authorId,
      text,
      keywords: kw, // { total, used, missing[] }
      assignment: s.assignments[authorId],
      vanguard,
      guesses: clone(guesses),
      hits,
      points, // { playerId: pontos que aquele acerto valeu }
      misses,
      reporters: [...reporters],
      denounced,
    };
  });
  return { round: s.round, quorum, texts, deltas };
}

// ---------------------------------------------------------------- consultas

const TEXT_PHASES = [PHASES.PREVIEW, PHASES.GUESSING, PHASES.REVEAL, PHASES.REPORTING];
export const currentAuthorId = (s) => (TEXT_PHASES.includes(s.phase) ? s.order[s.cursor] : null);

export function currentText(s) {
  const authorId = currentAuthorId(s);
  if (authorId == null) return null;
  return { authorId, text: s.texts[authorId] ?? '', index: s.cursor, total: s.order.length };
}

export function ranking(s) {
  return s.players
    .map((p) => ({ id: p.id, name: p.name, score: s.scores[p.id] }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

/** Caracteres contados no texto sem espaços nas pontas (o que vale pro mínimo). */
export { keywordUsed, keywordStats } from './text.js';
export const countChars = (text) => text.trim().length;
