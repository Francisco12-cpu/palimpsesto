import test from 'node:test';
import assert from 'node:assert/strict';
import { createSolo, HUMAN_ID } from '../src/solo/solo.js';
import { CONTENT } from '../src/data/content.js';

const FAST = { timers: { writing: 10, revealing: 2, guessing: 4, reporting: 5, scoring: 2 } };

/** Roda uma partida inteira com relógio falso. `human` pode agir a cada passo. */
function run(opts, human = () => {}) {
  let now = 5_000_000;
  const solo = createSolo({ content: CONTENT, clock: () => now, ...opts });
  solo.start(now);
  let steps = 0;
  while (solo.state.phase !== 'finished') {
    now += 100;
    solo.step(now);
    human(solo, now);
    assert.ok(++steps < 200_000, 'partida não terminou');
  }
  return solo.state;
}

test('partida solo completa com humano parado (só timers) termina e mantém invariantes', () => {
  const s = run({ botCount: 3, seed: 1, config: { ...FAST, roundsPerPlayer: 3 } });
  assert.equal(s.history.length, 3);
  for (const v of Object.values(s.scores)) assert.ok(v >= 0 && Number.isInteger(v));
  for (const r of s.history) assert.equal(r.texts.length, 4);
  assert.ok(s.titles.find((t) => t.id === 'zero')?.playerIds.includes(HUMAN_ID));
});

test('humano jogando: escreve, palpita e denuncia; várias seeds e tamanhos de sala', () => {
  for (const [seed, botCount, guesses] of [[2, 1, 1], [3, 2, 2], [4, 7, 1], [5, 4, 3]]) {
    const s = run({ botCount, seed, config: { ...FAST, roundsPerPlayer: 2, guessesPerPlayer: guesses, reportQuorum: 2 } }, (solo) => {
      const st = solo.state;
      if (st.phase === 'writing') solo.updateDraft('linha 1\nlinha 2\nlinha 3\nlinha 4');
      if (st.phase === 'guessing' && st.order[st.cursor] !== HUMAN_ID) {
        solo.guess(st.config.vanguards[(st.cursor + 3) % st.config.vanguards.length]);
      }
      if (st.phase === 'reporting') {
        solo.report(st.order.find((id) => id !== HUMAN_ID));
        solo.done();
      }
    });
    assert.equal(s.history.length, 2);
    assert.equal(s.players.length, botCount + 1);
    for (const v of Object.values(s.scores)) assert.ok(v >= 0);
  }
});

test('bots produzem texto com o mínimo de caracteres e participam de palpite/denúncia', () => {
  const s = run({ botCount: 3, seed: 7, reportChance: 1, config: { ...FAST, roundsPerPlayer: 2, minChars: 300 } });
  const first = s.history[0].texts.filter((t) => t.authorId !== HUMAN_ID);
  for (const t of first) assert.ok(t.text.trim().length >= 300);
  assert.ok(s.history.some((r) => r.texts.some((t) => Object.keys(t.guesses).length >= 2)));
  assert.ok(s.history.some((r) => r.texts.some((t) => t.reporters.length > 0)));
});

test('mesma seed = mesma partida (determinismo)', () => {
  const a = run({ botCount: 3, seed: 99, config: FAST });
  const b = run({ botCount: 3, seed: 99, config: FAST });
  assert.deepEqual(a.scores, b.scores);
  assert.deepEqual(a.titles, b.titles);
});
