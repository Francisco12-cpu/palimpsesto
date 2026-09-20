import test from 'node:test';
import assert from 'node:assert/strict';
import { MqttClient } from '../src/net/mqtt.js';
import { Cipher } from '../src/net/cipher.js';
import { startMiniBroker } from './helpers/mini-broker.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const dec = new TextDecoder();

test('MQTT: publica/assina, retain entrega ao novo assinante, testamento na queda', async () => {
  const broker = await startMiniBroker();
  const got = [];
  try {
    const a = new MqttClient({ url: broker.url, clientId: 'a' });
    await a.connect();
    a.onMessage = (t, p) => got.push(['a', t, dec.decode(p)]);
    a.subscribe('x/y');
    await wait(50);

    const b = new MqttClient({ url: broker.url, clientId: 'b', will: { topic: 'x/y', payload: 'b-morreu' } });
    await b.connect();
    b.publish('x/y', 'oi');
    b.publish('x/ret', 'guardada', { retain: true });
    await wait(80);
    assert.deepEqual(got, [['a', 'x/y', 'oi']]);

    // quem assina depois recebe a retida
    const late = [];
    const c = new MqttClient({ url: broker.url, clientId: 'c' });
    await c.connect();
    c.onMessage = (t, p) => late.push([t, dec.decode(p)]);
    c.subscribe('x/ret');
    await wait(80);
    assert.deepEqual(late, [['x/ret', 'guardada']]);

    // retida vazia apaga
    b.publish('x/ret', '', { retain: true });
    await wait(50);
    assert.equal(broker.retained.has('x/ret'), false);

    // queda sem DISCONNECT → testamento; DISCONNECT limpo → nada
    b.ws.close();
    await wait(400);
    assert.ok(got.some((g) => g[2] === 'b-morreu'), 'testamento entregue');
    const before = got.length;
    c.close();
    await wait(100);
    assert.equal(got.length, before);
    a.close();
  } finally {
    broker.close();
  }
});

test('MQTT: pacote grande (snapshot de ~30 KB) chega inteiro', async () => {
  const broker = await startMiniBroker();
  try {
    const a = new MqttClient({ url: broker.url, clientId: 'a' });
    const b = new MqttClient({ url: broker.url, clientId: 'b' });
    await a.connect(); await b.connect();
    const big = 'x'.repeat(30_000);
    const p = new Promise((res) => { a.onMessage = (t, pl) => res(dec.decode(pl)); });
    a.subscribe('big');
    await wait(50);
    b.publish('big', big);
    assert.equal((await p).length, 30_000);
    a.close(); b.close();
  } finally {
    broker.close();
  }
});

test('Cipher: cifra/decifra, sala errada não lê, adulteração é recusada, roomId não revela o código', async () => {
  const a = await Cipher.fromCode('abcdef');
  const same = await Cipher.fromCode('ABCDEF');
  const other = await Cipher.fromCode('ZZZZZZ');
  const bytes = await a.encrypt({ t: 'view', n: 1, texto: 'segredo' });
  assert.deepEqual(await same.decrypt(bytes), { t: 'view', n: 1, texto: 'segredo' });
  assert.equal(await other.decrypt(bytes), null);
  const tampered = new Uint8Array(bytes); tampered[20] ^= 1;
  assert.equal(await a.decrypt(tampered), null);
  assert.equal(await a.decrypt(new Uint8Array(5)), null);
  assert.equal(a.roomId.length, 20);
  assert.ok(!a.roomId.includes('ABCDEF'.toLowerCase()));
  assert.notEqual(a.roomId, other.roomId);
  assert.ok(!Buffer.from(bytes).toString('latin1').includes('segredo'));
});
