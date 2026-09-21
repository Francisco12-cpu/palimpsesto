// Fluxo "um texto por vez" (preview → palpite → resposta → denúncia), títulos e badges.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/engine/engine.js';
import { computeTitles, topTitlesFor } from '../src/engine/titles.js';
import { viewFor } from '../src/engine/view.js';
import { CONTENT, VANGUARD_INFO, TITLE_INFO, MAX_TITLES_PER_PLAYER } from '../src/data/content.js';

const ok = (r) => { assert.equal(r.error, null, r.error); return r.state; };
const P = (...ids) => ids.map((id) => ({ id, name: id.toUpperCase() }));
const game = (ids, config = {}, seed = 11) =>
  ok(E.startGame(E.createGame({ players: P(...ids), config, content: CONTENT, seed }), 0));

/** Escreve por todos e vai até a fase pedida do texto de índice `idx`. */
function reach(s, phase, idx = 0) {
  for (const p of s.players) s = ok(E.updateDraft(s, p.id, `texto de ${p.id}`));
  s = E.tick(s, s.phaseEndsAt);
  for (let i = 0; i < 40; i++) {
    if (s.phase === phase && s.cursor === idx) return s;
    s = E.tick(s, s.phaseEndsAt);
  }
  throw new Error(`não cheguei em ${phase}/${idx}`);
}

test('cada texto passa por leitura, palpite, resposta e denúncia antes do próximo', () => {
  let s = reach(game(['a', 'b', 'c']), 'preview', 0);
  const seq = [];
  while (s.phase !== 'scoring') { seq.push(`${s.phase}${s.cursor}`); s = E.tick(s, s.phaseEndsAt); }
  assert.deepEqual(seq.slice(0, 5), ['preview0', 'guessing0', 'reveal0', 'reporting0', 'preview1']);
  assert.equal(seq.length, 12, '3 textos × 4 fases');
});

test('a fase de palpite acaba quando todos acertam, sem esperar o relógio', () => {
  let s = reach(game(['a', 'b', 'c']), 'guessing', 0);
  const author = E.currentAuthorId(s);
  const certa = s.assignments[author].vanguard;
  const [g1, g2] = s.players.map((p) => p.id).filter((id) => id !== author);
  s = ok(E.submitGuess(s, g1, certa, 100));
  assert.equal(s.phase, 'guessing', 'ainda falta um');
  s = ok(E.submitGuess(s, g2, certa, 200));
  assert.equal(s.phase, 'reveal', 'todos acertaram: segue na hora');
  assert.deepEqual(s.hits[author], [g1, g2]);
});

test('a resposta de um texto só aparece no reveal DELE (os outros seguem secretos)', () => {
  let s = reach(game(['a', 'b', 'c']), 'guessing', 0);
  const autor0 = s.order[0];
  const espiao = s.players.map((p) => p.id).find((id) => id !== autor0);
  let v = viewFor(s, espiao);
  assert.equal(v.assignments[autor0].vanguard, undefined, 'durante o palpite, nada de resposta');

  s = E.tick(s, s.phaseEndsAt); // reveal do texto 0
  v = viewFor(s, espiao);
  assert.equal(v.assignments[autor0].vanguard, s.assignments[autor0].vanguard);
  for (const outro of s.order.slice(1)) {
    if (outro === espiao) continue;
    assert.equal(v.assignments[outro].vanguard, undefined, 'os próximos textos continuam secretos');
  }
  // e continua visível na denúncia daquele texto
  s = E.tick(s, s.phaseEndsAt);
  assert.equal(viewFor(s, espiao).assignments[autor0].vanguard, s.assignments[autor0].vanguard);
});

test('o palpite de um jogador não vaza para os outros antes da resposta', () => {
  let s = reach(game(['a', 'b', 'c']), 'guessing', 0);
  const author = E.currentAuthorId(s);
  const [g1, g2] = s.players.map((p) => p.id).filter((id) => id !== author);
  s = ok(E.submitGuess(s, g1, s.config.vanguards.find((v) => v !== s.assignments[author].vanguard), 100));
  const v = viewFor(s, g2);
  assert.equal(v.guesses[author], undefined, 'g2 não vê o palpite de g1');
  assert.deepEqual(viewFor(s, g1).guesses[author][g1].length, 1, 'mas vê o próprio');
});

test('denúncia vale só para o texto em exibição', () => {
  let s = reach(game(['a', 'b', 'c']), 'reporting', 0);
  const atual = E.currentAuthorId(s);
  const proximo = s.order[1];
  const quem = s.players.map((p) => p.id).find((id) => id !== atual && id !== proximo);
  assert.match(E.toggleReport(s, quem, proximo).error, /sendo mostrado/);
  s = ok(E.toggleReport(s, quem, atual));
  assert.deepEqual(s.reports[atual], [quem]);
});

test('conquistas novas: Inimigo da Sogra e Último Romântico', () => {
  const base = { players: P('a', 'b', 'c'), config: { fanThreshold: 3 }, content: { titles: TITLE_INFO } };
  const txt = (authorId, vanguard, guesses, hits = null) => ({
    authorId, vanguard, guesses, hits: hits ?? Object.keys(guesses).filter((id) => guesses[id].includes(vanguard)),
    misses: [], reporters: [], denounced: false,
  });
  const sogra = computeTitles({ ...base, history: [{ texts: [txt('b', 'Poesia Marginal', { a: ['Poesia Marginal'] })] }] });
  assert.deepEqual(sogra.find((t) => t.id === 'sogra').playerIds, ['a']);
  assert.match(sogra.find((t) => t.id === 'sogra').description, /Poesia Marginal/);

  // 'a' chuta Romantismo e erra 3 vezes
  const h = [1, 2, 3].map(() => ({ texts: [txt('b', 'Barroco', { a: ['Romantismo'] })] }));
  const rom = computeTitles({ ...base, history: h });
  assert.deepEqual(rom.find((t) => t.id === 'romantico').playerIds, ['a']);
  // 'b' escreve em Romantismo e é chutado errado 3 vezes
  const h2 = [{ texts: [txt('b', 'Romantismo', { a: ['Barroco'], c: ['Realismo'] })] }, { texts: [txt('b', 'Romantismo', { a: ['Dadaísmo'] })] }];
  assert.deepEqual(computeTitles({ ...base, history: h2 }).find((t) => t.id === 'romantico').playerIds, ['b']);
  // duas vezes não basta
  assert.equal(computeTitles({ ...base, history: h.slice(0, 2) }).find((t) => t.id === 'romantico'), undefined);
});

test('badges: no máximo 3 por jogador, os mais notáveis primeiro, e nenhum se não houver', () => {
  const titles = [
    { id: 'zero', label: 'Zero Chute', highlight: 20, playerIds: ['a'] },
    { id: 'blefe', label: 'Mestre do Blefe', highlight: 90, playerIds: ['a', 'b'] },
    { id: 'fora', label: 'Fora da Realidade', highlight: 40, playerIds: ['a'] },
    { id: 'sniper', label: 'Sniper', highlight: 85, playerIds: ['a'] },
  ];
  assert.deepEqual(topTitlesFor(titles, 'a', 3).map((t) => t.id), ['blefe', 'sniper', 'fora']);
  assert.deepEqual(topTitlesFor(titles, 'b', 3).map((t) => t.id), ['blefe']);
  assert.deepEqual(topTitlesFor(titles, 'c', 3), []);
  assert.equal(MAX_TITLES_PER_PLAYER, 3);
});

test('conteúdo: cada vanguarda tem explicação em parágrafo, "como escrever" e exemplo único', () => {
  assert.equal(VANGUARD_INFO.length, 21);
  const exemplos = new Set();
  for (const v of VANGUARD_INFO) {
    assert.ok(v.short.length > 30, `${v.name}: resumo curto demais`);
    assert.ok(v.about.length > 300, `${v.name}: explicação curta demais`);
    assert.ok(/\. /.test(v.about), `${v.name}: a explicação precisa ser texto corrido`);
    assert.ok(!/^[\wÀ-ÿ ]+(,\s*[\wÀ-ÿ ]+){3,}$/.test(v.about.trim()), `${v.name}: parece lista de palavras-chave`);
    assert.ok(v.howTo.length > 40, `${v.name}: falta orientação prática`);
    const linhas = v.example.split('\n').filter((l) => l.trim());
    assert.ok(linhas.length >= 2 && linhas.length <= 5, `${v.name}: exemplo com ${linhas.length} linhas`);
    exemplos.add(v.example);
  }
  assert.equal(exemplos.size, 21, 'nenhum exemplo repetido');
});

test('o placar guarda a ordem dos acertos rodada a rodada (histórico da antologia)', () => {
  let s = game(['a', 'b'], { roundsPerPlayer: 1 });
  while (s.phase !== 'finished') s = E.tick(s, s.phaseEndsAt);
  assert.equal(s.history.length, 1);
  for (const t of s.history[0].texts) {
    assert.ok(Array.isArray(t.hits));
    assert.ok(t.points && typeof t.points === 'object');
  }
});
