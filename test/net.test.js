// Integração: servidor HTTP + WebSocket reais (porta efêmera), clientes reais (WebSocket global do Node).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { attachWebSocket } from '../src/net/ws-server.js';
import { Relay } from '../src/net/relay.js';
import { GameClient } from '../src/net/client.js';
import { CONTENT } from '../src/data/content.js';

const CONFIG = {
  roundsPerPlayer: 2, minChars: 0, guessesPerPlayer: 1,
  timers: { writing: 30, revealing: 30, guessing: 30, reporting: 30, scoring: 1 },
};

const clients = [];

async function startServer() {
  const server = createServer();
  const relay = new Relay({ promoteGraceMs: 0 });
  attachWebSocket(server, '/ws', (conn) => {
    const h = relay.connect(conn);
    conn.onmessage = h.message;
    conn.onclose = h.close;
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `ws://127.0.0.1:${server.address().port}/ws`, close: () => { clients.splice(0).forEach((c) => c.leave()); server.closeAllConnections?.(); server.close(); } };
}

/** Cliente que joga sozinho (usa o botão Pronto sempre) e registra o que viu. */
function player(url, id, auto = true) {
  const log = { views: [], errors: [], leaks: 0, statuses: [] };
  const acted = new Set();
  const c = new GameClient({
    url, id, name: id.toUpperCase(), content: CONTENT,
    onStatus: (s, info) => log.statuses.push([s, info]),
    onError: (m) => log.errors.push(m),
    onView: (v) => {
      log.views.push(v);
      // sigilo: antes da pontuação ninguém vê a vanguarda alheia
      if (v.phase !== 'scoring' && v.phase !== 'finished' && v.phase !== 'lobby') {
        for (const [aid, a] of Object.entries(v.assignments)) if (aid !== id && a.vanguard) log.leaks++;
        for (const [, byP] of Object.entries(v.guesses)) for (const pid of Object.keys(byP)) if (pid !== id) log.leaks++;
        for (const d of Object.keys(v.drafts)) if (d !== id) log.leaks++;
      }
      if (!auto || v.phase === 'lobby') return;
      const key = `${v.round}:${v.phase}:${v.cursor}`;
      if (acted.has(key) || v.done?.includes(id)) return;
      acted.add(key);
      if (v.phase === 'writing') { c.act({ a: 'draft', text: `texto de ${id}` }); c.act({ a: 'done' }); }
      else if (v.phase === 'revealing') c.act({ a: 'done' });
      else if (v.phase === 'guessing') {
        if (v.order[v.cursor] === id) c.act({ a: 'done' });
        else c.act({ a: 'guess', vanguard: v.config.vanguards[(v.cursor + 2) % v.config.vanguards.length] });
      } else if (v.phase === 'reporting') c.act({ a: 'done' });
    },
  });
  clients.push(c);
  return { c, log, last: () => log.views[log.views.length - 1] };
}

const until = async (fn, ms = 15000, what = 'condição') => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error(`timeout esperando ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
};

async function lobbyOf(url, n, auto = true) {
  const ps = [player(url, 'p0', auto)];
  ps[0].c.create();
  await until(() => ps[0].c.room, 5000, 'sala criada');
  for (let i = 1; i < n; i++) {
    const p = player(url, `p${i}`, auto);
    p.c.join(ps[0].c.room);
    ps.push(p);
  }
  await until(() => ps[0].last()?.players?.length === n, 5000, 'todos no lobby');
  return ps;
}

test('partida completa em rede: 3 jogadores, Pronto acelera, sem vazar segredos', async () => {
  const srv = await startServer();
  try {
    const ps = await lobbyOf(srv.url, 3);
    assert.equal(ps[0].c.isHost, true);
    assert.equal(ps[1].c.isHost, false);
    assert.ok(Math.abs(ps[1].c.offset) < 100, 'relógio sincronizado com o relay');

    ps[0].c.act({ a: 'config', config: CONFIG });
    await until(() => ps[1].last()?.config?.roundsPerPlayer === 2, 3000, 'config chegou aos clientes');
    ps[0].c.act({ a: 'start' });

    const t0 = Date.now();
    await until(() => ps.every((p) => p.last()?.phase === 'finished'), 20000, 'fim de jogo');
    assert.ok(Date.now() - t0 < 10000, 'Pronto avançou as fases sem esperar os timers de 30s');

    for (const p of ps) {
      assert.equal(p.log.leaks, 0);
      assert.deepEqual(p.log.errors, []);
      assert.ok(Array.isArray(p.last().titles));
    }
    const scores = ps[0].last().scores;
    assert.deepEqual(ps[1].last().scores, scores);
    assert.equal(Object.keys(scores).length, 3);
    // o timer é por timestamp absoluto do relay: mesmo phaseEndsAt pra todos na mesma fase
    const w = ps.map((p) => p.log.views.find((v) => v.phase === 'writing' && v.round === 1).phaseEndsAt);
    assert.equal(new Set(w).size, 1);
  } finally {
    srv.close();
  }
});

test('migração de host: o host cai no meio da partida e o jogo continua com o próximo peer', async () => {
  const srv = await startServer();
  try {
    const ps = await lobbyOf(srv.url, 3);
    ps[0].c.act({ a: 'config', config: CONFIG });
    ps[0].c.act({ a: 'start' });
    await until(() => ps[1].last()?.phase === 'scoring' && ps[1].last().round === 1, 15000, 'fim da rodada 1');

    ps[0].c.leave(); // host some (fecha o socket)
    await until(() => ps[1].c.isHost, 5000, 'p1 assumiu como host');
    assert.equal(ps[2].c.isHost, false);
    assert.ok(ps[1].log.statuses.some(([s, i]) => s === 'host' && i.migrated));

    await until(() => ps[1].last()?.phase === 'finished' && ps[2].last()?.phase === 'finished', 20000, 'fim após migração');
    const v = ps[2].last();
    assert.equal(v.round, 2);
    assert.equal(v.hostId, 'p1');
    assert.equal(v.players.find((p) => p.id === 'p0').connected, false);
    assert.ok(v.scores.p0 >= 0); // pontos do ex-host preservados no snapshot
    assert.equal(ps[1].log.leaks + ps[2].log.leaks, 0);
  } finally {
    srv.close();
  }
});

test('quem chega com a partida em andamento vira espectador (sem segredos, sem ações); sala inexistente dá erro', async () => {
  const srv = await startServer();
  try {
    const ps = await lobbyOf(srv.url, 2, false);
    ps[0].c.act({ a: 'config', config: CONFIG });
    ps[0].c.act({ a: 'start' });
    await until(() => ps[1].last()?.phase === 'writing', 5000, 'jogo começou');

    const late = player(srv.url, 'tardio');
    late.c.join(ps[0].c.room);
    await until(() => late.last()?.spectator === true, 5000, 'retardatário virou espectador');
    assert.equal(late.last().players.length, 2);
    assert.ok(Object.values(late.last().assignments).every((a) => !a.vanguard), 'espectador não vê vanguardas');
    late.c.act({ a: 'done' }); // ações de espectador são ignoradas (sem erro)
    await new Promise((r) => setTimeout(r, 200));
    assert.deepEqual(late.log.errors, []);

    const ghost = player(srv.url, 'fantasma');
    ghost.c.join('ZZZZ');
    await until(() => ghost.log.errors.length > 0, 5000, 'erro sala inexistente');
    assert.match(ghost.log.errors[0], /não encontrada/);
    late.c.leave();
    ghost.c.leave();
  } finally {
    srv.close();
  }
});
