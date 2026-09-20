import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/engine/engine.js';
import { keywordUsed, keywordStats, maskProfanity, fold } from '../src/engine/text.js';
import { GameHost, WRITING_GRACE_MS } from '../src/net/host.js';
import { CONTENT } from '../src/data/content.js';

const ok = (r) => { assert.equal(r.error, null, r.error); return r.state; };
const start = (config = {}, ids = ['a', 'b']) =>
  ok(E.startGame(E.createGame({ players: ids.map((id) => ({ id, name: id })), config, content: CONTENT, seed: 7 }), 0));

test('palavras-chave: sem acento/caixa, aceita flexões, não acha no meio da palavra', () => {
  assert.equal(fold('Ação'), 'acao');
  assert.ok(keywordUsed('As janelas estavam abertas', 'janela'));
  assert.ok(keywordUsed('A AÇÃO começou', 'acao'));
  assert.ok(!keywordUsed('paralelepípedo', 'lelep'));
  assert.deepEqual(keywordStats('vento e ladeira', ['vento', 'freio', 'ladeira']), { total: 3, used: 2, missing: ['freio'] });
});

test('resultado da rodada informa palavras-chave usadas; penalidade opcional tira pontos', () => {
  for (const [penalty, expected] of [[0, 0], [2, 2]]) {
    let s = start({ keywordsPerTheme: 3, keywordPenalty: penalty, roundsPerPlayer: 1 });
    s = ok(E.updateDraft(s, 'a', 'texto sem nada'));
    s = ok(E.markDone(s, 'a', 1)); s = ok(E.markDone(s, 'b', 1));
    while (s.phase !== 'scoring') s = E.tick(s, s.phaseEndsAt);
    const ra = s.lastResult.texts.find((t) => t.authorId === 'a');
    assert.equal(ra.keywords.total, 3);
    assert.equal(ra.keywords.used, 0);
    // pontos partem de 0 e há piso em 0: o que importa é o "lost" registrado
    assert.equal(s.lastResult.deltas.a.lost >= expected, true);
    if (expected) assert.ok(s.lastResult.deltas.a.lost >= 2);
  }
});

test('filtro de palavrões: mascara sem quebrar o resto do texto; só quando ligado', () => {
  assert.equal(maskProfanity('Que merda de dia, caralho!'), 'Que m**** de dia, c******!');
  assert.equal(maskProfanity('Só a PORRA do acento é ação'), 'Só a P**** do acento é ação');
  assert.equal(maskProfanity('computador e cachorro'), 'computador e cachorro'); // não pega no meio de palavra
  let s = start({ filterProfanity: true });
  s = ok(E.updateDraft(s, 'a', 'isso é uma merda'));
  s = E.tick(s, s.phaseEndsAt);
  assert.equal(s.texts.a, 'isso é uma m****');
  let off = start({});
  off = ok(E.updateDraft(off, 'a', 'isso é uma merda'));
  off = E.tick(off, off.phaseEndsAt);
  assert.equal(off.texts.a, 'isso é uma merda');
});

test('tolerância no fim da escrita: o motor espera só na fase de escrita', () => {
  const s = start();
  assert.equal(E.tick(s, s.phaseEndsAt + 100, 400), s); // ainda dentro da tolerância
  assert.equal(E.tick(s, s.phaseEndsAt + 401, 400).phase, 'revealing');
  let r = E.tick(s, s.phaseEndsAt); // sem tolerância: avança
  assert.equal(r.phase, 'revealing');
  assert.notEqual(E.tick(r, r.phaseEndsAt, 400), r); // fora da escrita a tolerância não vale
});

function makeHost(now = { t: 1000 }) {
  const sent = [];
  const host = new GameHost({ content: CONTENT, hostId: 'h', now: () => now.t, send: (to, msg) => sent.push({ to, msg }) });
  host.peerJoin('h', 'H', 1); host.peerJoin('p1', 'P1', 2);
  return { host, sent, now };
}

test('host: rascunho digitado dentro da tolerância entra no texto capturado', () => {
  const { host, now } = makeHost();
  host.handle('h', { a: 'config', config: { roundsPerPlayer: 1 } });
  host.handle('h', { a: 'start' });
  const end = host.game.phaseEndsAt;
  now.t = end + 100; host.tick();
  assert.equal(host.game.phase, 'writing');
  host.handle('h', { a: 'draft', text: 'último trecho' });
  now.t = end + WRITING_GRACE_MS + 1; host.tick();
  assert.equal(host.game.phase, 'revealing');
  assert.equal(host.game.texts.h, 'último trecho');
});

test('host: snapshot não leva o banco de temas e a restauração o recoloca', () => {
  const { host } = makeHost();
  host.handle('h', { a: 'start' });
  const snap = host.snapshot();
  assert.equal(snap.game.content, undefined);
  assert.ok(JSON.stringify(snap).length < 12_000, 'snapshot enxuto');
  const back = GameHost.fromSnapshot(snap, { content: CONTENT, hostId: 'p1', now: () => 1000, send: () => {} });
  assert.equal(back.game.content.themes.length, CONTENT.themes.length);
  back.game.phase = 'writing'; // continua jogável
  assert.equal(E.tick(back.game, back.game.phaseEndsAt + 1000, 0).phase, 'revealing');
});

test('host recusa iniciar com menos vanguardas do que jogadores', () => {
  const { host, sent } = makeHost();
  host.peerJoin('p2', 'P2', 3);
  host.handle('h', { a: 'config', config: { vanguards: ['Barroco', 'Romantismo'] } });
  host.handle('h', { a: 'start' });
  assert.equal(host.game, null);
  assert.ok(sent.some((m) => m.to === 'h' && /pelo menos 3 vanguardas/.test(m.msg.message)));
});

test('espectador: entra com a partida em andamento, vê sem segredos, não age, e joga na próxima', () => {
  const { host, sent } = makeHost();
  host.handle('h', { a: 'config', config: { roundsPerPlayer: 1 } });
  host.handle('h', { a: 'start' });
  host.peerJoin('w', 'Watcher', 9);
  const v = host.viewOf('w');
  assert.equal(v.spectator, true);
  assert.ok(Object.values(v.assignments).every((a) => !a.vanguard));
  assert.ok(sent.some((m) => m.to === 'w' && m.msg.t === 'view'), 'recebe as visões');
  const before = JSON.stringify(host.game);
  host.handle('w', { a: 'done' }); host.handle('w', { a: 'guess', vanguard: 'Barroco' });
  assert.equal(JSON.stringify(host.game), before);
  assert.ok(!sent.some((m) => m.to === 'w' && m.msg.t === 'error'));

  host.game = { ...host.game, phase: 'finished' };
  host.handle('h', { a: 'rematch' });
  assert.deepEqual(host.lobby.players.map((p) => p.id).sort(), ['h', 'p1', 'w']);
  assert.equal(host.lobby.watchers.length, 0);
});
