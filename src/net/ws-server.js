// WebSocket mínimo (RFC 6455) sobre node:http, sem dependências — só o que o jogo usa:
// mensagens de texto (JSON), ping/pong e close. Node-only.
import { createHash } from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 4 * 1024 * 1024;
const HEARTBEAT_MS = 15_000;
const DEAD_AFTER_MS = 45_000;

function frame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) header = Buffer.from([0x80 | opcode, len]);
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([header, payload]);
}

/**
 * Liga o upgrade WebSocket em `path`. Para cada conexão chama `onConnection(conn)`,
 * onde conn = { send(obj), close(), onmessage(obj), onclose() } (callbacks atribuídos pelo chamador).
 */
export function attachWebSocket(server, path, onConnection) {
  server.on('upgrade', (req, socket) => {
    const url = new URL(req.url, 'http://x');
    const key = req.headers['sec-websocket-key'];
    if (url.pathname !== path || !key || req.headers.upgrade?.toLowerCase() !== 'websocket') {
      socket.destroy();
      return;
    }
    const accept = createHash('sha1').update(key + GUID).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.setNoDelay(true);

    let buf = Buffer.alloc(0);
    let fragments = [];
    let closed = false;
    let lastSeen = Date.now();

    const conn = {
      onmessage: () => {},
      onclose: () => {},
      send(obj) {
        if (!closed) socket.write(frame(0x1, Buffer.from(JSON.stringify(obj))));
      },
      close() {
        if (closed) return;
        try { socket.write(frame(0x8, Buffer.alloc(0))); } catch { /* já caiu */ }
        finish();
      },
    };

    function finish() {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      socket.destroy();
      conn.onclose();
    }

    const heartbeat = setInterval(() => {
      if (Date.now() - lastSeen > DEAD_AFTER_MS) return finish(); // celular sumiu sem avisar
      try { socket.write(frame(0x9, Buffer.alloc(0))); } catch { finish(); }
    }, HEARTBEAT_MS);

    socket.on('data', (chunk) => {
      lastSeen = Date.now();
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        if (buf.length < 2) return;
        const fin = (buf[0] & 0x80) !== 0;
        const opcode = buf[0] & 0x0f;
        const masked = (buf[1] & 0x80) !== 0;
        let len = buf[1] & 0x7f;
        let off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (len > MAX_PAYLOAD) return finish();
        if (buf.length < off + (masked ? 4 : 0) + len) return;
        let payload;
        if (masked) {
          const mask = buf.subarray(off, off + 4);
          payload = Buffer.from(buf.subarray(off + 4, off + 4 + len));
          for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
          off += 4;
        } else {
          payload = Buffer.from(buf.subarray(off, off + len));
        }
        buf = buf.subarray(off + len);

        if (opcode === 0x8) return finish();
        if (opcode === 0x9) { socket.write(frame(0xa, payload)); continue; }
        if (opcode === 0xa) continue;
        if (opcode === 0x1 || opcode === 0x0) {
          fragments.push(payload);
          if (!fin) continue;
          const text = Buffer.concat(fragments).toString('utf8');
          fragments = [];
          try { conn.onmessage(JSON.parse(text)); } catch { /* JSON inválido: ignora */ }
        }
      }
    });
    socket.on('close', finish);
    socket.on('error', finish);

    onConnection(conn);
  });
}
