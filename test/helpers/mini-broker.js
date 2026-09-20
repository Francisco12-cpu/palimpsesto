// Broker MQTT 3.1.1 mínimo para testes (sem internet): CONNECT com testamento, SUBSCRIBE (tópicos exatos),
// PUBLISH com retain, PING e DISCONNECT. Roda sobre o WebSocket do próprio projeto.
import { createServer } from 'node:http';
import { attachWebSocket } from '../../src/net/ws-server.js';

const dec = new TextDecoder();

function lenBytes(n) {
  const out = [];
  do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 0x80; out.push(d); } while (n > 0);
  return out;
}
const pkt = (b0, body) => Buffer.from([b0, ...lenBytes(body.length), ...body]);
const readStr = (b, o) => { const l = (b[o] << 8) | b[o + 1]; return [b.subarray(o + 2, o + 2 + l), o + 2 + l]; };

export async function startMiniBroker() {
  const server = createServer();
  const clients = new Set();
  const retained = new Map(); // tópico → Buffer
  const stats = { published: 0 };

  function deliver(topic, payload, retain) {
    stats.published += 1;
    if (retain) { if (payload.length) retained.set(topic, payload); else retained.delete(topic); }
    const t = Buffer.from(topic);
    const msg = pkt(0x30, [t.length >> 8, t.length & 255, ...t, ...payload]);
    for (const c of clients) if (c.subs.has(topic)) c.conn.sendBinary(msg);
  }

  attachWebSocket(server, '/mqtt', (conn) => {
    const c = { conn, subs: new Set(), will: null, buf: Buffer.alloc(0), clean: false };
    clients.add(c);
    conn.onbinary = (chunk) => {
      c.buf = Buffer.concat([c.buf, chunk]);
      for (;;) {
        if (c.buf.length < 2) return;
        let i = 1; let mult = 1; let len = 0; let byte;
        do { if (i >= c.buf.length) return; byte = c.buf[i++]; len += (byte & 127) * mult; mult *= 128; } while (byte & 128);
        if (c.buf.length < i + len) return;
        const type = c.buf[0] >> 4; const flags = c.buf[0] & 15;
        const body = c.buf.subarray(i, i + len);
        c.buf = c.buf.subarray(i + len);
        if (type === 1) { // CONNECT
          let o; [, o] = readStr(body, 0); // "MQTT"
          o += 1; const cflags = body[o]; o += 1 + 2; // nível, flags, keepalive
          [, o] = readStr(body, o); // clientId
          if (cflags & 0x04) { let tb; let pb; [tb, o] = readStr(body, o); [pb, o] = readStr(body, o); c.will = { topic: dec.decode(tb), payload: Buffer.from(pb) }; }
          conn.sendBinary(pkt(0x20, [0, 0]));
        } else if (type === 8) { // SUBSCRIBE
          const id = [body[0], body[1]]; let o = 2; const codes = [];
          while (o < body.length) { let tb; [tb, o] = readStr(body, o); o += 1; const topic = dec.decode(tb); c.subs.add(topic); codes.push(0); if (retained.has(topic)) { const t = Buffer.from(topic); conn.sendBinary(pkt(0x31, [t.length >> 8, t.length & 255, ...t, ...retained.get(topic)])); } }
          conn.sendBinary(pkt(0x90, [...id, ...codes]));
        } else if (type === 3) { // PUBLISH
          const [tb, o] = readStr(body, 0);
          deliver(dec.decode(tb), body.subarray(o), !!(flags & 1));
        } else if (type === 12) conn.sendBinary(pkt(0xd0, [])); // PINGREQ
        else if (type === 14) { c.clean = true; conn.close(); } // DISCONNECT
      }
    };
    conn.onclose = () => {
      clients.delete(c);
      if (c.will && !c.clean) deliver(c.will.topic, c.will.payload, false); // testamento
    };
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `ws://127.0.0.1:${server.address().port}/mqtt`,
    retained, stats,
    close() { for (const c of [...clients]) c.conn.close(); server.closeAllConnections?.(); server.close(); },
  };
}
