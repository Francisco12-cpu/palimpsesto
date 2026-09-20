import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/engine/engine.js';
import { computeTitles } from '../src/engine/titles.js';
import { makeRng } from '../src/engine/rng.js';
import { CONTENT } from '../src/data/content.js';

const P = (...ids) => ids.map((id) => ({ id, name: id.toUpperCase() }));
const T0 = 1_000_000;
const ok = (r) => { assert.equal(r.error, null, r.error); return r.state; };

function game(ids = ['a', 'b', 'c'], config = {}, seed = 42) {
  const s = E.createGame({ players: P(...ids), config, content: CONTENT, seed });
  return ok(E.startGame(s, T0));
}

/** Todos escrevem e o tempo acaba: cai na 1ª revelação. */
function toReveal(s) {
  for (const p of s.players) s = ok(E.updateDraft(s, p.id, `texto de ${p.id}\nlinha 2`));
  return E.tick(s, s.phaseEndsAt);
}

function toGuessing(s) {
  s = toReveal(s);
  return E.tick(s, s.phaseEndsAt);
}

test('rng: mesmo seed, mesma sequência; shuffle preserva elementos', () => {
  const a = makeRng(7), b = makeRng(7);
  assert.deepEqual([a.next(), a.next()], [b.next(), b.next()]);
  assert.deepEqual([...makeRng(1).shuffle([1, 2, 3, 4])].sort(), [1, 2, 3, 4]);
});

test('createGame valida jogadores e config', () => {
  assert.throws(() => E.createGame({ players: P('a'), content: CONTENT }));
  assert.throws(() => E.createGame({ players: [...P('a'), ...P('a')], content: CONTENT }));
  assert.throws(() => E.createGame({ players: P('a', 'b'), config: { vanguards: ['Barroco'] }, content: CONTENT }));
});

test('não muta o estado original e o estado é serializável em JSON', () => {
  const s = game();
  const snap = JSON.stringify(s);
  E.updateDraft(s, 'a', 'x');
  E.tick(s, s.phaseEndsAt + 1);
  assert.equal(JSON.stringify(s), snap);
  assert.deepEqual(JSON.parse(snap), s);
});

test('sorteio: vanguardas distintas por jogador, temas distintos, campos da config', () => {
  const s = game(['a', 'b', 'c', 'd'], { keywordsPerTheme: 2, fixedTextType: 'carta', minChars: 600 });
  const as = Object.values(s.assignments);
  assert.equal(new Set(as.map((x) => x.vanguard)).size, 4);
  assert.equal(new Set(as.map((x) => x.theme)).size, 4);
  for (const x of as) {
    assert.equal(x.keywords.length, 2);
    assert.equal(x.textType, 'carta');
    assert.equal(x.minChars, 600);
    assert.ok(x.modifier);
  }
  const off = game(['a', 'b'], { modifiersEnabled: false, keywordsPerTheme: 0 });
  assert.equal(off.assignments.a.modifier, null);
  assert.deepEqual(off.assignments.a.keywords, []);
});

test('temas não se repetem na partida até o banco esgotar', () => {
  let s = game(['a', 'b'], { roundsPerPlayer: 5 });
  const seen = [];
  while (s.phase !== 'finished') {
    if (s.phase === 'writing') seen.push(...Object.values(s.assignments).map((x) => x.theme));
    s = E.tick(s, s.phaseEndsAt);
  }
  assert.equal(seen.length, 10);
  assert.equal(new Set(seen).size, seen.length);
});

test('texto é capturado como está quando o tempo acaba; sem rascunho = vazio', () => {
  let s = game();
  s = ok(E.updateDraft(s, 'a', 'meio de uma fra'));
  s = E.tick(s, s.phaseEndsAt);
  assert.equal(s.phase, 'revealing');
  assert.equal(s.texts.a, 'meio de uma fra');
  assert.equal(s.texts.b, '');
  assert.ok(E.updateDraft(s, 'a', 'x').error); // depois de capturado, não edita mais
});

test('tick não avança antes do fim e devolve a mesma referência', () => {
  const s = game();
  assert.equal(E.tick(s, s.phaseEndsAt - 1), s);
  assert.equal(E.timeLeftMs(s, s.phaseEndsAt - 500), 500);
  assert.equal(E.timeLeftMs(s, s.phaseEndsAt + 500), 0);
});

test('fluxo de fases: revelação/palpite por texto, depois denúncia, pontuação, próxima rodada', () => {
  let s = toReveal(game(['a', 'b', 'c'], { roundsPerPlayer: 2 }));
  const seq = [];
  while (s.phase !== 'writing') {
    seq.push(`${s.phase}${s.cursor}`);
    s = E.tick(s, s.phaseEndsAt);
  }
  assert.deepEqual(seq, [
    'revealing0', 'guessing0', 'revealing1', 'guessing1', 'revealing2', 'guessing2',
    'reporting2', 'scoring2',
  ]);
  assert.equal(s.round, 2);
  assert.deepEqual(s.guesses, {});
  assert.deepEqual(s.reports, {});
  while (s.phase !== 'finished') s = E.tick(s, s.phaseEndsAt);
  assert.equal(s.history.length, 2);
  assert.ok(Array.isArray(s.titles));
  assert.equal(s.phaseEndsAt, null);
});

test('palpite: valida autor, vanguarda, limite e repetição', () => {
  let s = toGuessing(game(['a', 'b', 'c'], { guessesPerPlayer: 2 }));
  const author = E.currentAuthorId(s);
  const [g1, g2] = s.players.map((p) => p.id).filter((id) => id !== author);
  assert.ok(E.submitGuess(s, author, 'Barroco', T0).error);
  assert.ok(E.submitGuess(s, g1, 'Inexistente', T0).error);
  s = ok(E.submitGuess(s, g1, 'Barroco', T0));
  assert.ok(E.submitGuess(s, g1, 'Barroco', T0).error); // repetido
  s = ok(E.submitGuess(s, g1, 'Dadaísmo', T0));
  assert.ok(E.submitGuess(s, g1, 'Cubismo literário', T0).error); // acabou o limite
  assert.equal(s.phase, 'guessing'); // g2 ainda não terminou
  s = ok(E.markDone(s, g2, T0)); // g2 abre mão -> todos prontos -> avança
  assert.equal(s.phase, 'revealing');
  assert.equal(s.cursor, 1);
});

test('fase termina cedo quando todos terminam; desconectado não segura', () => {
  let s = toGuessing(game(['a', 'b', 'c']));
  const author = E.currentAuthorId(s);
  const [g1, g2] = s.players.map((p) => p.id).filter((id) => id !== author);
  s = ok(E.submitGuess(s, g1, 'Barroco', T0));
  assert.equal(s.phase, 'guessing');
  s = ok(E.setConnected(s, g2, false, T0));
  assert.equal(s.phase, 'revealing'); // g2 caiu; o jogo segue sem esperar
});

test('denúncia: alterna, não denuncia o próprio texto, só na fase certa', () => {
  let s = toReveal(game(['a', 'b', 'c']));
  assert.ok(E.toggleReport(s, 'a', 'b').error);
  while (s.phase !== 'reporting') s = E.tick(s, s.phaseEndsAt);
  assert.ok(E.toggleReport(s, 'a', 'a').error);
  s = ok(E.toggleReport(s, 'a', 'b'));
  assert.deepEqual(s.reports.b, ['a']);
  s = ok(E.toggleReport(s, 'a', 'b'));
  assert.equal(s.reports.b, undefined);
});

/** Joga UMA rodada com palpites/denúncias controlados e devolve o estado em 'scoring'. */
function playRound(ids, config, guessFn, reports = []) {
  let s = toReveal(game(ids, config));
  while (s.phase !== 'reporting') {
    if (s.phase === 'guessing') {
      const author = E.currentAuthorId(s);
      for (const id of ids.filter((x) => x !== author)) {
        const v = guessFn(s, id, author);
        if (v) s = ok(E.submitGuess(s, id, v, s.phaseEndsAt - 1));
      }
      if (s.phase !== 'guessing') continue;
    }
    s = E.tick(s, s.phaseEndsAt);
  }
  for (const [by, on] of reports) s = ok(E.toggleReport(s, by, on));
  return E.tick(s, s.phaseEndsAt);
}

const right = (st, id, author) => st.assignments[author].vanguard;
const wrong = (st, id, author) => st.config.vanguards.find((v) => v !== st.assignments[author].vanguard);

test('pontuação: +1 pra quem acerta e +1 pro autor por acerto; erro não pontua', () => {
  const s = playRound(['a', 'b', 'c'], {}, (st, id, author) => (author === 'c' ? right(st, id, author) : wrong(st, id, author)));
  assert.equal(s.phase, 'scoring');
  assert.deepEqual(s.scores, { a: 1, b: 1, c: 2 });
  const rc = s.lastResult.texts.find((t) => t.authorId === 'c');
  assert.deepEqual([...rc.hits].sort(), ['a', 'b']);
  assert.equal(s.lastResult.deltas.c.net, 2);
});

test('acertar em qualquer dos vários palpites conta 1 vez por texto', () => {
  let s = toGuessing(game(['a', 'b', 'c'], { guessesPerPlayer: 3 }));
  const author = E.currentAuthorId(s);
  const g = s.players.map((p) => p.id).find((id) => id !== author);
  const real = s.assignments[author].vanguard;
  const others = s.config.vanguards.filter((v) => v !== real);
  s = ok(E.submitGuess(s, g, others[0], T0));
  s = ok(E.submitGuess(s, g, real, T0));
  s = ok(E.submitGuess(s, g, others[1], T0)); // chute extra depois do acerto
  const res = E.computeRoundResult({ ...s, order: [author] });
  assert.deepEqual(res.texts[0].hits, [g]);
  assert.equal(res.deltas[g].gained, 1);
  assert.equal(res.deltas[author].gained, 1);
});

test('denúncia com quórum: perde reportPenalty, piso em 0; sem quórum não perde', () => {
  let s = playRound(['a', 'b', 'c'], { reportQuorum: 2 }, wrong, [['b', 'a'], ['c', 'a']]);
  assert.equal(s.scores.a, 0);
  assert.equal(s.lastResult.texts.find((t) => t.authorId === 'a').denounced, true);
  assert.equal(s.lastResult.deltas.a.net, 0);

  s = playRound(['a', 'b', 'c'], { reportQuorum: 2 }, wrong, [['b', 'a']]);
  assert.equal(s.lastResult.texts.find((t) => t.authorId === 'a').denounced, false);
});

test('denunciado ainda pontua os acertos da rodada (ganha 2, perde 2)', () => {
  const s = playRound(
    ['a', 'b', 'c'], { reportQuorum: 2, reportPenalty: 2 },
    (st, id, author) => (author === 'a' ? right(st, id, author) : wrong(st, id, author)),
    [['b', 'a'], ['c', 'a']],
  );
  assert.equal(s.scores.a, 0); // +2 -2
  assert.equal(s.scores.b, 1);
  assert.equal(s.scores.c, 1);
});

test('quórum efetivo nunca passa de (jogadores - 1)', () => {
  const s = playRound(['a', 'b'], { reportQuorum: 5 }, right, [['b', 'a']]);
  assert.equal(s.lastResult.quorum, 1);
  assert.equal(s.lastResult.texts.find((t) => t.authorId === 'a').denounced, true);
  assert.equal(s.scores.a, 0); // +1 (b acertou) -2 => piso 0
  assert.equal(s.scores.b, 2); // +1 acertou a, +1 a acertou b
});

test('placar e resultado só mudam na pontuação (palpites ficam ocultos antes)', () => {
  let s = toGuessing(game());
  const g = s.players.map((p) => p.id).find((id) => id !== E.currentAuthorId(s));
  s = ok(E.submitGuess(s, g, 'Barroco', T0));
  assert.equal(s.lastResult, null);
  assert.equal(s.scores[g], 0);
});

test('ranking ordena por pontos', () => {
  const s = { players: P('a', 'b'), scores: { a: 1, b: 3 } };
  assert.deepEqual(E.ranking(s).map((r) => r.id), ['b', 'a']);
});

// ---------------------------------------------------------------- títulos

const fakeState = (players, history, config = { fanThreshold: 3 }) => ({ players: P(...players), history, config });
const txt = (authorId, vanguard, guesses, reporters = [], denounced = false) => ({
  authorId, vanguard, guesses,
  hits: Object.keys(guesses).filter((id) => guesses[id].includes(vanguard)),
  misses: [], reporters, denounced,
});
const byId = (titles, id) => titles.find((t) => t.id === id);

test('título Fã: mesma vanguarda X vezes', () => {
  const h = [1, 2, 3].map(() => ({ texts: [txt('b', 'Barroco', { a: ['Surrealismo'] })] }));
  const t = computeTitles(fakeState(['a', 'b'], h));
  assert.deepEqual(byId(t, 'fa:Surrealismo').playerIds, ['a']);
  assert.equal(byId(t, 'fa:Surrealismo').label, 'Fã do Surrealismo');
  assert.equal(computeTitles(fakeState(['a', 'b'], h.slice(0, 2))).some((x) => x.id.startsWith('fa:')), false);
});

test('título Sniper: ≤1 erro e ≥1 acerto; quem nunca chutou ou só errou não ganha', () => {
  const h = [{ texts: [txt('b', 'Barroco', { a: ['Barroco'] }), txt('a', 'Dadaísmo', { b: ['Barroco'] })] }];
  const t = computeTitles(fakeState(['a', 'b', 'c'], h));
  assert.deepEqual(byId(t, 'sniper').playerIds, ['a']); // b: 1 erro, 0 acertos; c: nunca chutou
});

test('título Mestre do Blefe: todos os outros chutaram e ninguém acertou (mín. 2 outros)', () => {
  const h = [{ texts: [txt('a', 'Barroco', { b: ['Dadaísmo'], c: ['Realismo'] })] }];
  assert.deepEqual(byId(computeTitles(fakeState(['a', 'b', 'c'], h)), 'blefe').playerIds, ['a']);
  const h2 = [{ texts: [txt('a', 'Barroco', { b: ['Dadaísmo'] })] }]; // c não chutou
  assert.equal(byId(computeTitles(fakeState(['a', 'b', 'c'], h2)), 'blefe'), undefined);
  assert.equal(byId(computeTitles(fakeState(['a', 'b'], h2)), 'blefe'), undefined); // só 1 outro jogador
});

test('título Zero Chute: rodada inteira sem chutar', () => {
  const h = [{ texts: [txt('a', 'Barroco', { b: ['Barroco'] }), txt('b', 'Dadaísmo', {})] }];
  assert.deepEqual(byId(computeTitles(fakeState(['a', 'b'], h)), 'zero').playerIds, ['a']);
});

test('títulos Fora da Realidade e Denunciado e Sobreviveu', () => {
  const h = [{ texts: [
    txt('a', 'Barroco', { b: ['Dadaísmo'] }, ['b', 'c', 'd'], true),
    txt('b', 'Dadaísmo', { a: ['Dadaísmo'] }, ['a'], false),
  ] }];
  const t = computeTitles(fakeState(['a', 'b', 'c', 'd'], h));
  assert.deepEqual(byId(t, 'fora').playerIds, ['a']);
  assert.deepEqual(byId(t, 'sobreviveu').playerIds, ['a']);
  const none = computeTitles(fakeState(['a', 'b'], [{ texts: [txt('a', 'Barroco', { b: ['Barroco'] })] }]));
  assert.equal(byId(none, 'fora'), undefined);
  assert.equal(byId(none, 'sobreviveu'), undefined);
});
