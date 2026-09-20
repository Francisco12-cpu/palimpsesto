import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { GameHost } from '../src/net/host.js';
import { Relay } from '../src/net/relay.js';
import { viewFor } from '../src/engine/view.js';
import * as E from '../src/engine/engine.js';
import { CONTENT } from '../src/data/content.js';
import { runes } from '../src/brand.js';

function makeHost() {
  const sent = [];
  const host = new GameHost({ content: CONTENT, hostId: 'h', now: () => 1000, send: (to, msg) => sent.push({ to, msg }) });
  host.peerJoin('h', 'Host', 12);
  host.peerJoin('p1', 'Um', 200);
  host.peerJoin('p2', 'Dois', 300);
  return { host, sent };
}

test('cor do jogador chega ao lobby e ao estado do jogo', () => {
  const { host } = makeHost();
  assert.deepEqual(host.viewOf('h').players.map((p) => p.color), [12, 200, 300]);
  host.handle('h', { a: 'config', config: { roundsPerPlayer: 1 } });
  host.handle('h', { a: 'start' });
  assert.deepEqual(host.viewOf('p1').players.map((p) => p.color), [12, 200, 300]);
});

test('host expulsa jogador no lobby; expulso não volta; não-host não pode expulsar', () => {
  const { host, sent } = makeHost();
  host.handle('p1', { a: 'kick', id: 'p2' }); // sem poder
  assert.equal(host.lobby.players.length, 3);
  host.handle('h', { a: 'kick', id: 'h' }); // não se expulsa
  assert.equal(host.lobby.players.length, 3);

  host.handle('h', { a: 'kick', id: 'p2' });
  assert.deepEqual(host.lobby.players.map((p) => p.id), ['h', 'p1']);
  assert.ok(sent.some((m) => m.to === 'p2' && m.msg.t === 'kicked'));

  host.peerJoin('p2', 'Dois', 300); // tenta voltar
  assert.equal(host.lobby.players.length, 2);
  assert.ok(sent.some((m) => m.to === 'p2' && m.msg.t === 'error' && m.msg.fatal));
  // banidos sobrevivem à migração de host (snapshot)
  assert.deepEqual(host.snapshot().lobby.banned, ['p2']);
});

test('não dá pra expulsar durante a partida', () => {
  const { host } = makeHost();
  host.handle('h', { a: 'start' });
  host.handle('h', { a: 'kick', id: 'p1' });
  assert.ok(host.game.players.find((p) => p.id === 'p1').connected);
});

test('relay repassa a cor no peer-join e na lista de peers', () => {
  const relay = new Relay({ setTimer: () => 0, clearTimer: () => {}, promoteGraceMs: 0 });
  const mk = () => { const c = { inbox: [], send(o) { this.inbox.push(o); }, close() {} }; return { c, h: relay.connect(c) }; };
  const h = mk(); const p = mk();
  h.h.message({ t: 'create', id: 'h', name: 'H', color: 42 });
  const code = h.c.inbox.find((m) => m.t === 'joined').room;
  p.h.message({ t: 'join', room: code, id: 'p', name: 'P', color: 500 }); // 500 → 140 (normalizado)
  assert.equal(h.c.inbox.find((m) => m.t === 'peer-join').color, 140);
  assert.deepEqual(p.c.inbox.find((m) => m.t === 'joined').peers.map((x) => x.color), [42, 140]);
});

test('histórico completo só chega aos clientes no fim (antologia)', () => {
  let s = E.startGame(E.createGame({ players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], config: { roundsPerPlayer: 1 }, content: CONTENT, seed: 3 }), 0).state;
  assert.equal(viewFor(s, 'a').history, undefined);
  while (s.phase !== 'finished') s = E.tick(s, s.phaseEndsAt);
  const v = viewFor(s, 'a');
  assert.equal(v.history.length, 1);
  assert.equal(v.history[0].texts.length, 2);
  assert.ok(v.history[0].texts[0].vanguard);
});

test('runas: transliteração do nome e da frase do logotipo', () => {
  assert.equal(runes('Francisco Audir'), 'ᚠᚱᚨᚾᚲᛁᛊᚲᛟ ᚨᚢᛞᛁᚱ');
  assert.equal(runes('Raspe · Reescreva'), 'ᚱᚨᛊᛈᛖ ᛫ ᚱᛖᛖᛊᚲᚱᛖᚢᚨ');
});

test('conteúdo: 19 vanguardas, 120 temas únicos, 16 modificadores', () => {
  assert.equal(CONTENT.vanguards.length, 19);
  assert.equal(new Set(CONTENT.themes.map((t) => t.text)).size, 120);
  assert.equal(CONTENT.modifiers.length, 16);
  assert.ok(CONTENT.themes.every((t) => t.keywords.length === 3));
});

// ---- servidor real: arquivos públicos x privados, /api/info, porta ocupada
test('servidor: só serve arquivos públicos e expõe /api/info', async () => {
  const port = 18000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ['serve.mjs', `--port=${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('servidor não subiu')), 8000);
      child.stdout.on('data', (d) => { if (String(d).includes('no ar')) { clearTimeout(t); resolve(); } });
      child.on('exit', () => reject(new Error('servidor caiu')));
    });
    const get = (p) => fetch(`http://127.0.0.1:${port}${p}`);
    assert.equal((await get('/')).status, 200);
    assert.equal((await get('/src/engine/engine.js')).status, 200);
    assert.equal((await get('/fonts/cinzel-latin-700-normal.woff2')).status, 200);
    assert.equal((await get('/icon-192.png')).status, 200);
    for (const p of ['/serve.mjs', '/package.json', '/test/engine.test.js', '/jogo-vanguardas-spec.md', '/..%2fpackage.json', '/src/../serve.mjs']) {
      assert.equal((await get(p)).status, 404, p);
    }
    const info = await (await get('/api/info')).json();
    assert.equal(info.port, port);
    assert.ok(Array.isArray(info.urls));
    assert.equal((await get('/fonts/cinzel-latin-700-normal.woff2')).headers.get('content-type'), 'font/woff2');
  } finally {
    child.kill();
  }
});

test('config da sala é normalizada pelo host: valores hostis não chegam aos clientes', () => {
  const { host } = makeHost();
  host.handle('h', { a: 'config', config: { roundsPerPlayer: '<img src=x onerror=alert(1)>', minChars: { evil: 1 }, guessesPerPlayer: 99, extra: '<script>' } });
  const c = host.viewOf('p1').config;
  assert.equal(typeof c.roundsPerPlayer, 'number');
  assert.equal(typeof c.minChars, 'number');
  assert.ok(c.guessesPerPlayer <= 5);
  assert.equal(c.extra, undefined);
  assert.ok(!JSON.stringify(c).includes('<'));
});

// ---- proteções do relay
function relayKit(opts = {}) {
  const timers = [];
  let clock = 0;
  const relay = new Relay({ now: () => clock, setTimer: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; }, clearTimer: (t) => { if (t) t.dead = true; }, ...opts });
  const mk = () => { const c = { inbox: [], closed: false, send(o) { this.inbox.push(o); }, close() { this.closed = true; } }; return { c, h: relay.connect(c), last: (t) => [...c.inbox].reverse().find((m) => m.t === t) }; };
  return { relay, mk, timers, tick: (ms) => { clock += ms; }, fire: () => timers.filter((t) => !t.dead).forEach((t) => { t.dead = true; t.fn(); }) };
}

test('token: quem conhece só o id não consegue tomar o lugar de outro jogador', () => {
  const { mk } = relayKit({ promoteGraceMs: 0 });
  const h = mk(); const victim = mk(); const thief = mk(); const back = mk();
  h.h.message({ t: 'create', id: 'h', name: 'H', token: 'tk-h' });
  const code = h.last('joined').room;
  victim.h.message({ t: 'join', room: code, id: 'v', name: 'V', token: 'segredo' });
  thief.h.message({ t: 'join', room: code, id: 'v', name: 'Ladrão', token: 'palpite' });
  assert.equal(thief.last('error').fatal, true);
  assert.equal(victim.c.closed, false); // a vítima não foi derrubada
  thief.h.message({ t: 'act', msg: { a: 'done' } }); // e o ladrão não fala em nome dela
  assert.equal(h.c.inbox.filter((m) => m.t === 'from').length, 0);
  // o dono legítimo reconecta normalmente (F5)
  back.h.message({ t: 'join', room: code, id: 'v', name: 'V', token: 'segredo' });
  assert.equal(back.last('joined').isHost, false);
  assert.equal(victim.c.closed, true);
});

test('limites: sala cheia, servidor cheio de salas e taxa de mensagens', () => {
  const { mk, tick } = relayKit({ promoteGraceMs: 0, maxPeers: 2, maxRooms: 1, maxMsgPerSec: 5 });
  const h = mk(); const a = mk(); const b = mk(); const other = mk();
  h.h.message({ t: 'create', id: 'h', name: 'H' });
  const code = h.last('joined').room;
  a.h.message({ t: 'join', room: code, id: 'a', name: 'A' });
  b.h.message({ t: 'join', room: code, id: 'b', name: 'B' });
  assert.match(b.last('error').message, /cheia/);
  other.h.message({ t: 'create', id: 'o', name: 'O' });
  assert.match(other.last('error').message, /cheio/);
  // taxa: só as 5 primeiras mensagens da janela chegam ao host
  for (let i = 0; i < 20; i++) a.h.message({ t: 'act', msg: { i } });
  assert.equal(h.c.inbox.filter((m) => m.t === 'from').length < 6, true);
  tick(1100); // nova janela
  a.h.message({ t: 'act', msg: { i: 'depois' } });
  assert.ok(h.c.inbox.some((m) => m.t === 'from' && m.msg.i === 'depois'));
});

test('tolerância: host que volta dentro do prazo mantém o cargo; se não voltar, o próximo assume', () => {
  const { mk, fire } = relayKit({ promoteGraceMs: 4000 });
  const h = mk(); const p = mk(); const h2 = mk();
  h.h.message({ t: 'create', id: 'h', name: 'H', token: 't1' });
  const code = h.last('joined').room;
  p.h.message({ t: 'join', room: code, id: 'p', name: 'P' });

  h.h.close(); // blip
  assert.equal(p.last('promote'), undefined); // ainda em tolerância
  h2.h.message({ t: 'join', room: code, id: 'h', name: 'H', token: 't1' }); // voltou a tempo
  assert.equal(h2.last('joined').isHost, true);
  fire(); // o timer velho estava cancelado: nada acontece
  assert.equal(p.last('promote'), undefined);

  h2.h.close(); // agora cai de vez
  fire(); // passa a tolerância
  assert.equal(p.last('promote')?.oldHostId, 'h');
});

test('servidor: ETag (304) e gzip nos arquivos de texto', async () => {
  const port = 19900 + Math.floor(Math.random() * 90);
  const child = spawn(process.execPath, ['serve.mjs', `--port=${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('servidor não subiu')), 8000);
      child.stdout.on('data', (d) => { if (String(d).includes('no ar')) { clearTimeout(t); resolve(); } });
    });
    const url = `http://127.0.0.1:${port}/src/engine/engine.js`;
    const first = await fetch(url, { headers: { 'accept-encoding': 'gzip' } });
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('content-encoding'), 'gzip');
    const etag = first.headers.get('etag');
    assert.ok(etag);
    assert.ok(Number(first.headers.get('content-length')) < 8000, 'comprimido');
    const second = await fetch(url, { headers: { 'if-none-match': etag } });
    assert.equal(second.status, 304);
    const png = await fetch(`http://127.0.0.1:${port}/icon-192.png`, { headers: { 'accept-encoding': 'gzip' } });
    assert.equal(png.headers.get('content-encoding'), null); // binário não é recomprimido
  } finally {
    child.kill();
  }
});

test('persistência: salas exportadas/importadas; host volta e mantém o cargo; outro não o substitui', () => {
  const { mk: mk1 } = relayKit({ promoteGraceMs: 0 });
  const k1 = relayKit({ promoteGraceMs: 4000 });
  const h = k1.mk(); const p = k1.mk();
  h.h.message({ t: 'create', id: 'h', name: 'H', token: 'th' });
  const code = h.last('joined').room;
  p.h.message({ t: 'join', room: code, id: 'p', name: 'P', token: 'tp' });
  h.h.message({ t: 'sync', snapshot: { turno: 9 } });
  const saved = JSON.parse(JSON.stringify(k1.relay.exportState())); // como no disco
  assert.ok(!JSON.stringify(saved).includes('ctx'));
  void mk1;

  // "reinício": relay novo com o estado do disco
  const k2 = relayKit({ promoteGraceMs: 4000 });
  assert.equal(k2.relay.importState(saved), 1);
  assert.equal(k2.relay.importState(saved), 0); // idempotente
  const p2 = k2.mk();
  p2.h.message({ t: 'join', room: code, id: 'p', name: 'P', token: 'tp' }); // o não-host volta primeiro
  assert.equal(p2.last('joined').isHost, false, 'não rouba o cargo enquanto o host pode voltar');
  const h2 = k2.mk();
  h2.h.message({ t: 'join', room: code, id: 'h', name: 'H', token: 'th' });
  assert.equal(h2.last('joined').isHost, true);
  assert.deepEqual(h2.last('joined').snapshot, { turno: 9 });
  // token continua valendo depois do reinício
  const thief = k2.mk();
  thief.h.message({ t: 'join', room: code, id: 'h', name: 'X', token: 'errado' });
  assert.equal(thief.last('error').fatal, true);
  assert.equal(k2.relay.importState({ v: 2 }), 0);
});

test('persistência: se o host não voltar no prazo, o próximo jogador assume', () => {
  const k1 = relayKit({ promoteGraceMs: 4000 });
  const h = k1.mk(); const p = k1.mk();
  h.h.message({ t: 'create', id: 'h', name: 'H', token: 'th' });
  const code = h.last('joined').room;
  p.h.message({ t: 'join', room: code, id: 'p', name: 'P', token: 'tp' });
  h.h.message({ t: 'sync', snapshot: { turno: 3 } });
  const saved = JSON.parse(JSON.stringify(k1.relay.exportState()));

  const k2 = relayKit({ promoteGraceMs: 4000 });
  k2.relay.importState(saved, 20_000);
  const p2 = k2.mk();
  p2.h.message({ t: 'join', room: code, id: 'p', name: 'P', token: 'tp' });
  k2.tick(21_000); k2.fire(); // passou o prazo e o host não apareceu
  assert.equal(p2.last('promote')?.oldHostId, 'h');
  assert.deepEqual(p2.last('promote').snapshot, { turno: 3 });
});
