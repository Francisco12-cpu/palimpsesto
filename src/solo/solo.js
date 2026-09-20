// Driver do modo solo: 1 humano + N bots usando EXATAMENTE o mesmo motor da partida real.
// Sem DOM. Relógio e agendamento são injetáveis — o teste roda partidas inteiras com tempo falso.
//
// Na Fase 3 o "host" faz o papel deste driver (tick + aplicar ações), mas com peers reais.

import * as E from '../engine/engine.js';
import { makeRng } from '../engine/rng.js';
import { BOT_NAMES, botText, botGuess } from './bots.js';

export const HUMAN_ID = 'humano';

export function createSolo({
  humanName = 'Você',
  humanColor,
  botCount = 3,
  config,
  content,
  seed = Date.now(),
  clock = () => Date.now(),
  onChange = () => {},
  reportChance = 0.15,
  botAccuracy = 0.3,
}) {
  const players = [{ id: HUMAN_ID, name: humanName, ...(humanColor != null && { color: humanColor }) }];
  for (let i = 0; i < botCount; i++) players.push({ id: `bot${i + 1}`, name: BOT_NAMES[i % BOT_NAMES.length], isBot: true });

  const rng = makeRng((seed ^ 0x9e3779b9) >>> 0); // RNG dos bots, separado do RNG do motor
  let state = E.createGame({ players, config, content, seed });
  let pending = []; // ações agendadas dos bots: { at, key, fn }
  let planKey = '';
  let timer = null;

  const keyOf = (s) => `${s.round}:${s.phase}:${s.cursor}`;

  function apply(result) {
    if (result.error) return result.error;
    if (result.state !== state) {
      state = result.state;
      onChange(state);
    }
    return null;
  }

  // ---- planejamento dos bots (roda quando a fase muda)
  function plan(now) {
    const key = keyOf(state);
    if (key === planKey) return;
    planKey = key;
    pending = [];
    const dur = state.phaseEndsAt == null ? 0 : state.phaseEndsAt - now;
    const bots = state.players.filter((p) => p.isBot);
    const at = (lo, hi) => now + dur * rng.between(lo, hi);
    const schedule = (when, fn) => pending.push({ at: when, key, fn });

    if (state.phase === E.PHASES.WRITING) {
      for (const b of bots) {
        schedule(at(0.2, 0.6), (s) => E.updateDraft(s, b.id, botText(s.assignments[b.id], rng)));
        schedule(at(0.65, 0.9), (s, t) => E.markDone(s, b.id, t)); // "Pronto": trava o texto
      }
    } else if (state.phase === E.PHASES.PREVIEW || state.phase === E.PHASES.REVEAL) {
      for (const b of bots) schedule(at(0.3, 0.8), (s, t) => E.markDone(s, b.id, t));
    } else if (state.phase === E.PHASES.GUESSING) {
      const authorId = E.currentAuthorId(state);
      for (const b of bots.filter((p) => p.id !== authorId)) {
        for (let i = 0; i < state.config.guessesPerPlayer; i++) {
          schedule(at(0.1 + 0.1 * i, 0.5 + 0.1 * i), (s, t) => {
            const already = s.guesses[authorId]?.[b.id] ?? [];
            return E.submitGuess(
              s, b.id,
              botGuess({ vanguards: s.config.vanguards, answer: s.assignments[authorId].vanguard, already, rng, accuracy: botAccuracy }),
              t,
            );
          });
        }
      }
    } else if (state.phase === E.PHASES.REPORTING) {
      const authorId = E.currentAuthorId(state); // denúncia é só do texto da vez
      for (const b of bots.filter((p) => p.id !== authorId)) {
        if (rng.next() < reportChance) schedule(at(0.05, 0.5), (s) => E.toggleReport(s, b.id, authorId));
        schedule(at(0.6, 0.9), (s, t) => E.markDone(s, b.id, t));
      }
    }
    pending.sort((a, b) => a.at - b.at);
  }

  /** Um passo do relógio: roda ações vencidas dos bots, avança fase, replaneja. */
  function step(now = clock()) {
    apply({ state: E.tick(state, now), error: null });
    plan(now);
    const key = keyOf(state);
    const due = pending.filter((a) => a.at <= now);
    pending = pending.filter((a) => a.at > now);
    for (const a of due) {
      if (a.key !== key) continue; // fase já mudou
      apply(a.fn(state, now));
      if (keyOf(state) !== key) break; // uma ação pode ter encerrado a fase (todos prontos)
    }
    plan(now);
  }

  return {
    get state() { return state; },
    start(now = clock()) {
      apply(E.startGame(state, now));
      plan(now);
    },
    step,
    run(intervalMs = 200) {
      timer = setInterval(() => step(), intervalMs);
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
    // ações do humano
    updateDraft: (text) => apply(E.updateDraft(state, HUMAN_ID, text)),
    guess: (v, now = clock()) => apply(E.submitGuess(state, HUMAN_ID, v, now)),
    done: (now = clock()) => apply(E.markDone(state, HUMAN_ID, now)),
    report: (authorId) => apply(E.toggleReport(state, HUMAN_ID, authorId)),
  };
}
