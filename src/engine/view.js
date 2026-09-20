// Visão filtrada do estado para um jogador específico (usada pelo host na rede).
// O estado completo tem segredos (vanguardas dos outros, rascunhos, palpites alheios);
// cada cliente só recebe o que já pode saber naquele momento.
import { PHASES } from './engine.js';

const stripVanguard = ({ vanguard, ...rest }) => rest;

export function viewFor(s, me) {
  const revealed = s.phase === PHASES.SCORING || s.phase === PHASES.FINISHED;

  const assignments = {};
  for (const [id, a] of Object.entries(s.assignments)) {
    assignments[id] = revealed || id === me ? a : stripVanguard(a);
  }

  // Palpites: só os próprios (o resultado geral chega em lastResult na pontuação).
  const guesses = {};
  for (const [authorId, byPlayer] of Object.entries(s.guesses)) {
    if (revealed) guesses[authorId] = byPlayer;
    else if (byPlayer[me]) guesses[authorId] = { [me]: byPlayer[me] };
  }

  // Textos: na revelação/palpite só os já revelados; na denúncia todos; na escrita nenhum.
  let texts = {};
  if (s.phase === PHASES.REVEALING || s.phase === PHASES.GUESSING) {
    for (const id of s.order.slice(0, s.cursor + 1)) texts[id] = s.texts[id];
  } else if (s.phase !== PHASES.WRITING) {
    texts = s.texts;
  }

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
    reports: s.reports,
    done: s.done,
    lastResult: s.lastResult,
    titles: s.titles,
    // no fim da partida tudo é público: alimenta a antologia de textos
    history: s.phase === PHASES.FINISHED ? s.history : undefined,
  };
}
