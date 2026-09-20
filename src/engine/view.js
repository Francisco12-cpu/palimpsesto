// Visão filtrada do estado para um jogador específico (usada pelo host na rede).
// O estado completo tem segredos (vanguardas dos outros, rascunhos, palpites alheios);
// cada cliente só recebe o que já pode saber naquele momento.
//
// A regra, agora que é um texto por vez: a vanguarda de um texto só aparece a partir da
// fase `reveal` daquele texto (e continua visível depois). Acertos (`hits`) são públicos
// desde o palpite — é o que acende o avatar de quem já acertou.
import { PHASES } from './engine.js';

const stripVanguard = ({ vanguard, ...rest }) => rest;

export function viewFor(s, me) {
  const roundOver = s.phase === PHASES.SCORING || s.phase === PHASES.FINISHED;
  // textos já resolvidos nesta rodada: os anteriores ao atual, mais o atual a partir do reveal
  const resolved = new Set(roundOver ? s.order : s.order.slice(0, s.cursor));
  if (!roundOver && (s.phase === PHASES.REVEAL || s.phase === PHASES.REPORTING)) resolved.add(s.order[s.cursor]);

  const assignments = {};
  for (const [id, a] of Object.entries(s.assignments)) {
    assignments[id] = resolved.has(id) || id === me ? a : stripVanguard(a);
  }

  // Palpites: só os próprios, até o texto ser resolvido.
  const guesses = {};
  for (const [authorId, byPlayer] of Object.entries(s.guesses)) {
    if (resolved.has(authorId)) guesses[authorId] = byPlayer;
    else if (byPlayer[me]) guesses[authorId] = { [me]: byPlayer[me] };
  }

  // Textos: durante a rodada só os já mostrados; na escrita, nenhum.
  let texts = {};
  if (roundOver) texts = s.texts;
  else if (s.phase !== PHASES.WRITING) for (const id of s.order.slice(0, s.cursor + 1)) texts[id] = s.texts[id];

  return {
    version: s.version,
    you: me,
    config: s.config,
    players: s.players,
    scores: s.scores,
    phase: s.phase,
    round: s.round,
    totalRounds: s.totalRounds,
    phaseEndsAt: s.phaseEndsAt,
    assignments,
    drafts: s.phase === PHASES.WRITING && s.drafts[me] != null ? { [me]: s.drafts[me] } : {},
    texts,
    order: s.order,
    cursor: s.cursor,
    guesses,
    hits: s.hits, // público: quem já acertou cada texto, na ordem
    reports: s.reports,
    done: s.done,
    lastResult: s.lastResult,
    titles: s.titles,
    // no fim da partida tudo é público: alimenta a antologia de textos
    history: s.phase === PHASES.FINISHED ? s.history : undefined,
  };
}
