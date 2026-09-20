import test from 'node:test';
import assert from 'node:assert/strict';
import { Relay } from '../src/net/relay.js';

function setup() {
  const relay = new Relay({ now: () => 12345, setTimer: () => 0, clearTimer: () => {}, promoteGraceMs: 0 });
  const mk = () => {
    const conn = { inbox: [], closed: false, send(o) { this.inbox.push(o); }, close() { this.closed = true; } };
    const h = relay.connect(conn);
    return { conn, h, last: (t) => [...conn.inbox].reverse().find((m) => m.t === t) };
  };
  return { relay, mk };
}

test('ping responde com o relógio do relay', () => {
  const { mk } = setup();
  const a = mk();
  a.h.message({ t: 'ping', c: 7 });
  assert.deepEqual(a.conn.inbox[0], { t: 'pong', c: 7, s: 12345 });
});

test('criar sala, entrar, ação vai só pro host, host manda pra um ou pra todos', () => {
  const { mk } = setup();
  const h = mk(), p1 = mk(), p2 = mk();
  h.h.message({ t: 'create', id: 'h', name: 'Host' });
  const code = h.last('joined').room;
  assert.equal(code.length, 4);
  assert.equal(h.last('joined').isHost, true);

  p1.h.message({ t: 'join', room: code.toLowerCase(), id: 'p1', name: 'P1' });
  p2.h.message({ t: 'join', room: code, id: 'p2', name: 'P2' });
  assert.equal(p1.last('joined').isHost, false);
  assert.deepEqual(h.conn.inbox.filter((m) => m.t === 'peer-join').map((m) => m.id), ['p1', 'p2']);

  p1.h.message({ t: 'act', msg: { a: 'done' } });
  assert.deepEqual(h.last('from'), { t: 'from', from: 'p1', msg: { a: 'done' } });
  assert.equal(p2.last('from'), undefined);

  h.h.message({ t: 'to', to: 'p2', msg: { t: 'view', n: 1 } });
  assert.deepEqual(p2.last('msg').msg, { t: 'view', n: 1 });
  assert.equal(p1.last('msg'), undefined);
  h.h.message({ t: 'to', to: '*', msg: { t: 'x' } });
  assert.equal(p1.last('msg').msg.t, 'x');
});

test('cliente não consegue se passar por host (to/sync ignorados)', () => {
  const { mk } = setup();
  const h = mk(), p = mk(), q = mk();
  h.h.message({ t: 'create', id: 'h', name: 'H' });
  const code = h.last('joined').room;
  p.h.message({ t: 'join', room: code, id: 'p', name: 'P' });
  q.h.message({ t: 'join', room: code, id: 'q', name: 'Q' });
  p.h.message({ t: 'to', to: 'q', msg: { t: 'view', hack: true } });
  assert.equal(q.last('msg'), undefined);
});

test('sala inexistente devolve erro fatal', () => {
  const { mk } = setup();
  const a = mk();
  a.h.message({ t: 'join', room: 'ZZZZ', id: 'a', name: 'A' });
  assert.equal(a.last('error').fatal, true);
});

test('host cai: próximo peer (ordem de entrada) é promovido e recebe o snapshot', () => {
  const { mk } = setup();
  const h = mk(), p1 = mk(), p2 = mk();
  h.h.message({ t: 'create', id: 'h', name: 'H' });
  const code = h.last('joined').room;
  p1.h.message({ t: 'join', room: code, id: 'p1', name: 'P1' });
  p2.h.message({ t: 'join', room: code, id: 'p2', name: 'P2' });
  h.h.message({ t: 'sync', snapshot: { turno: 3 } });

  h.h.close();
  const pr = p1.last('promote');
  assert.deepEqual(pr.snapshot, { turno: 3 });
  assert.equal(pr.oldHostId, 'h');
  assert.equal(p2.last('promote'), undefined);
  assert.deepEqual(pr.peers.find((p) => p.id === 'h'), { id: 'h', name: 'H', connected: false });

  // ações agora vão pro novo host
  p2.h.message({ t: 'act', msg: { a: 'done' } });
  assert.equal(p1.last('from').from, 'p2');
});

test('quem saiu avisa o host; reconexão do mesmo id substitui a conexão antiga', () => {
  const { mk } = setup();
  const h = mk(), p = mk(), p2 = mk();
  h.h.message({ t: 'create', id: 'h', name: 'H' });
  const code = h.last('joined').room;
  p.h.message({ t: 'join', room: code, id: 'p', name: 'P' });
  p.h.close();
  assert.equal(h.last('peer-leave').id, 'p');
  p2.h.message({ t: 'join', room: code, id: 'p', name: 'P' }); // volta com outra conexão
  assert.equal(p2.last('joined').isHost, false);
  assert.equal(h.conn.inbox.filter((m) => m.t === 'peer-join').length, 2);
});

test('host sozinho volta e mantém o cargo com o snapshot', () => {
  const { mk } = setup();
  const h = mk(), h2 = mk();
  h.h.message({ t: 'create', id: 'h', name: 'H' });
  const code = h.last('joined').room;
  h.h.message({ t: 'sync', snapshot: { v: 1 } });
  h.h.close(); // ninguém pra promover
  h2.h.message({ t: 'join', room: code, id: 'h', name: 'H' });
  assert.equal(h2.last('joined').isHost, true);
  assert.deepEqual(h2.last('joined').snapshot, { v: 1 });
});
