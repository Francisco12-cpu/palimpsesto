import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/engine/engine.js';
import { CONTENT } from '../src/data/content.js';

const T0 = 1_000_000;
const ok = (r) => { assert.equal(r.error, null, r.error); return r.state; };
const start = (ids = ['a', 'b', 'c']) =>
  ok(E.startGame(E.createGame({ players: ids.map((id) => ({ id, name: id })), content: CONTENT, seed: 5 }), T0));

test('botão Pronto na escrita: só avança quando TODOS estão prontos, antes do timer', () => {
  let s = start();
  s = ok(E.updateDraft(s, 'a', 'texto do a'));
  s = ok(E.markDone(s, 'a', T0 + 10));
  s = ok(E.markDone(s, 'b', T0 + 10));
  assert.equal(s.phase, 'writing'); // c ainda escrevendo
  s = ok(E.updateDraft(s, 'c', 'texto do c'));
  s = ok(E.markDone(s, 'c', T0 + 20));
  assert.equal(s.phase, 'preview'); // avançou muito antes de phaseEndsAt do writing
  assert.equal(s.texts.a, 'texto do a');
  assert.equal(s.texts.c, 'texto do c');
  assert.equal(s.texts.b, '');
});

test('depois de Pronto o texto fica travado', () => {
  let s = start();
  s = ok(E.updateDraft(s, 'a', 'v1'));
  s = ok(E.markDone(s, 'a', T0));
  assert.ok(E.updateDraft(s, 'a', 'v2').error);
  assert.equal(s.drafts.a, 'v1');
  // os outros ainda editam
  ok(E.updateDraft(s, 'b', 'ok'));
});

test('botão Pronto na leitura (preview) pula a espera', () => {
  let s = start(['a', 'b']);
  s = E.tick(s, s.phaseEndsAt); // captura -> preview do texto 0
  assert.equal(s.phase, 'preview');
  s = ok(E.markDone(s, 'a', T0));
  assert.equal(s.phase, 'preview');
  s = ok(E.markDone(s, 'b', T0));
  assert.equal(s.phase, 'guessing');
  assert.equal(s.cursor, 0);
});

test('desconectado não segura o Pronto geral', () => {
  let s = start();
  s = ok(E.markDone(s, 'a', T0));
  s = ok(E.markDone(s, 'b', T0));
  s = ok(E.setConnected(s, 'c', false, T0));
  assert.equal(s.phase, 'preview');
});

test('Pronto em fases sem ação (pontuação/fim) é recusado', () => {
  let s = start(['a', 'b']);
  while (s.phase !== 'scoring') s = E.tick(s, s.phaseEndsAt);
  assert.ok(E.markDone(s, 'a', T0).error);
});
