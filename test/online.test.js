// Modo online (GitHub Pages) testado de ponta a ponta com um broker MQTT local (sem internet):
// partida completa, sigilo, mensagens criptografadas no broker e migração de host.
import test from 'node:test';
import assert from 'node:assert/strict';
import { OnlineSession } from '../src/net/online.js';
import { CONTENT } from '../src/data/content.js';
import { startMiniBroker } from './helpers/mini-broker.js';

const FAST = {
  hbMs: 150, hbTimeoutMs: 1200, electionBaseMs: 600, goneDelayMs: 200, electionStepMs: 500,
  idleMs: 1500, snapMs: 150, probeMs: 800, connectMs: 3000, joinWaitMs: 4000, pingMs: 300, reconnectMs: 200,
};
const CONFIG = {
  roundsPerPlayer: 2, minChars: 0, guessesPerPlayer: 1,
  timers: { writing: 30, preview: 30, guessing: 30, reveal: 30, reporting: 30, scoring: 1 },
};

const sessions = [];
function player(broker, id, auto = true) {
  const log = { views: [], errors: [], statuses: [], leaks: 0 };
  const acted = new Set();
  const s = new OnlineSession({
    id, name: id.toUpperCase(), color: 100, token: `tok-${id}`, content: CONTENT, brokers: [broker.url], timing: FAST,
    onStatus: (st, info) => log.statuses.push([st, info]),
    onError: (m, fatal) => log.errors.push([m, fatal]),
    onView: (v) => {
      log.views.push(v);
      // sigilo: a vanguarda de um texto só pode aparecer depois do reveal DELE
      if (!['scoring', 'finished', 'lobby'].includes(v.phase)) {
        const resolvidos = new Set(v.order.slice(0, v.cursor));
        if (v.phase === 'reveal' || v.phase === 'reporting') resolvidos.add(v.order[v.cursor]);
        for (const [aid, a] of Object.entries(v.assignments)) {
          if (aid !== id && a.vanguard && !resolvidos.has(aid)) log.leaks++;
        }
        for (const [aid, byP] of Object.entries(v.guesses ?? {})) {
          for (const pid of Object.keys(byP)) if (pid !== id && !resolvidos.has(aid)) log.leaks++;
        }
        for (const d of Object.keys(v.drafts)) if (d !== id) log.leaks++;
      }
      if (!auto || v.phase === 'lobby') return;
      const key = `${v.round}:${v.phase}:${v.cursor}`;
      if (acted.has(key) || v.done?.includes(id)) return;
      acted.add(key);
      if (v.phase === 'writing') { s.act({ a: 'draft', text: `texto de ${id}` }); s.act({ a: 'done' }); }
      else if (v.phase === 'preview' || v.phase === 'reveal') s.act({ a: 'done' });
      else if (v.phase === 'guessing') {
        if (v.order[v.cursor] === id) s.act({ a: 'done' });
        else s.act({ a: 'guess', vanguard: v.config.vanguards[(v.cursor + 2) % v.config.vanguards.length] });
      } else if (v.phase === 'reporting') s.act({ a: 'done' });
    },
  });
  sessions.push(s);
  return { s, log, last: () => log.views[log.views.length - 1] };
}

const until = async (fn, ms = 15000, what = 'condição') => {
  const t0 = Date.now();
  while (!fn()) { if (Date.now() - t0 > ms) throw new Error(`timeout esperando ${what}`); await new Promise((r) => setTimeout(r, 30)); }
};

/** Sucessor = 1º da lista de jogadores (a mesma que a eleição usa) que não é o host. */
function roles(ps) {
  const order = ps[0].last().players.map((p) => p.id);
  const succId = order.find((id) => id !== 'p0');
  return { succ: ps.find((p) => p.s.id === succId), other: ps.find((p) => p.s.id !== 'p0' && p.s.id !== succId) };
}

async function lobbyOf(broker, n, auto = true) {
  const host = player(broker, 'p0', auto);
  await host.s.create();
  await until(() => host.last()?.phase === 'lobby', 8000, 'sala criada');
  const ps = [host];
  for (let i = 1; i < n; i++) {
    const p = player(broker, `p${i}`, auto);
    p.s.join(host.s.room);
    ps.push(p);
  }
  await until(() => host.last()?.players?.length === n, 8000, 'todos no lobby');
  return ps;
}

test('online: sala de 6 letras, 3 jogadores, partida completa sem vazar segredos', async () => {
  const broker = await startMiniBroker();
  try {
    const ps = await lobbyOf(broker, 3);
    assert.match(ps[0].s.room, /^[A-Z]{6}$/);
    assert.equal(ps[0].s.isHost, true);
    assert.equal(ps[1].s.isHost, false);
    ps[0].s.act({ a: 'config', config: CONFIG });
    await until(() => ps[1].last()?.config?.roundsPerPlayer === 2, 5000, 'config chegou');
    ps[0].s.act({ a: 'start' });
    await until(() => ps.every((p) => p.last()?.phase === 'finished'), 25000, 'fim de jogo');
    for (const p of ps) {
      assert.equal(p.log.leaks, 0);
      assert.deepEqual(p.log.errors, []);
      assert.ok(p.last().history.length === 2);
    }
    assert.deepEqual(ps[1].last().scores, ps[0].last().scores);
    // o broker só guardou bytes cifrados: nenhum texto do jogo em claro
    for (const [topic, payload] of broker.retained) {
      assert.ok(!Buffer.from(payload).toString('latin1').includes('vanguard'), topic);
    }
  } finally {
    sessions.splice(0).forEach((s) => s.leave());
    await new Promise((r) => setTimeout(r, 300));
    broker.close();
  }
});

test('online: sala inexistente e broker inalcançável dão erro claro', async () => {
  const broker = await startMiniBroker();
  try {
    const ghost = player(broker, 'g');
    ghost.s.join('QQQQQQ');
    await until(() => ghost.log.errors.length, 6000, 'erro de sala');
    assert.match(ghost.log.errors[0][0], /não encontrada/i);
    assert.equal(ghost.log.errors[0][1], true);

    const lost = new OnlineSession({ id: 'x', name: 'X', token: 't', content: CONTENT, brokers: ['ws://127.0.0.1:1/mqtt'], timing: { ...FAST, connectMs: 800 }, onError: (m) => { lost.err = m; } });
    lost.join('ABCDEF');
    await until(() => lost.err, 6000, 'erro de rede');
    assert.match(lost.err, /sem internet/i);
  } finally {
    sessions.splice(0).forEach((s) => s.leave());
    await new Promise((r) => setTimeout(r, 300));
    broker.close();
  }
});

test('online: host sai no meio da partida e o próximo jogador assume com o estado salvo', async () => {
  const broker = await startMiniBroker();
  try {
    const ps = await lobbyOf(broker, 3);
    ps[0].s.act({ a: 'config', config: CONFIG });
    ps[0].s.act({ a: 'start' });
    await until(() => ps[1].last()?.phase === 'scoring' && ps[1].last().round === 1, 15000, 'fim da rodada 1');
    const scoresBefore = ps[1].last().scores;
    const { succ, other } = roles(ps);

    ps[0].s.leave(); // o host some (aviso de saída → sucessor assume rápido)
    await until(() => succ.s.isHost, 12000, 'sucessor assumiu como host');
    assert.equal(other.s.isHost, false);
    assert.ok(succ.log.statuses.some(([st, i]) => st === 'host' && i?.migrated), 'aviso de migração');

    await until(() => succ.last()?.phase === 'finished' && other.last()?.phase === 'finished', 25000, 'fim após migração');
    const v = other.last();
    assert.equal(v.hostId, succ.s.id);
    assert.equal(v.round, 2);
    assert.equal(v.players.find((p) => p.id === 'p0').connected, false);
    for (const [id, pts] of Object.entries(scoresBefore)) assert.ok(v.scores[id] >= pts, `pontos de ${id} preservados`);
    assert.equal(succ.log.leaks + other.log.leaks, 0);
  } finally {
    sessions.splice(0).forEach((s) => s.leave());
    await new Promise((r) => setTimeout(r, 300));
    broker.close();
  }
});

test('online: queda SILENCIOSA do host (sem aviso) também promove o sucessor', async () => {
  const broker = await startMiniBroker();
  try {
    const ps = await lobbyOf(broker, 3, false); // sem autojogo: fica na sala de espera
    const { succ, other } = roles(ps);
    await until(() => succ.s.lastSnap, 6000, 'sucessor recebeu o snapshot');
    ps[0].s.mqtt.ws.close(); // derruba o socket do host sem DISCONNECT: só o testamento avisa
    ps[0].s.leave(); // encerra os timers do host morto (o testamento já foi publicado pelo broker)
    await until(() => succ.s.isHost, 12000, 'sucessor assumiu');
    await until(() => other.last()?.hostId === succ.s.id, 12000, 'o outro jogador reentrou na sala do novo host');
    assert.equal(other.last().players.length >= 2, true);
  } finally {
    sessions.splice(0).forEach((s) => s.leave());
    await new Promise((r) => setTimeout(r, 300));
    broker.close();
  }
});
