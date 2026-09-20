// Cliente MQTT 3.1.1 mínimo sobre WebSocket (só o necessário: CONNECT com "testamento",
// SUBSCRIBE, PUBLISH QoS 0 com retain, PING). Sem dependências: roda no navegador e no Node 22+.
// Usado pelo modo "online" (GitHub Pages): um broker público faz a ponte entre os jogadores.

const enc = new TextEncoder();
const dec = new TextDecoder();

const utf8 = (s) => enc.encode(s);
const str = (s) => { const b = typeof s === 'string' ? utf8(s) : s; return [b.length >> 8, b.length & 0xff, ...b]; };

function remainingLength(n) {
  const out = [];
  do {
    let d = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) d |= 0x80;
    out.push(d);
  } while (n > 0);
  return out;
}

function packet(byte0, body) {
  return Uint8Array.from([byte0, ...remainingLength(body.length), ...body]);
}

export class MqttClient {
  /**
   * @param {object} o
   * @param {string} o.url        wss://broker:porta/mqtt
   * @param {string} o.clientId
   * @param {{topic:string,payload:string|Uint8Array}} [o.will]  publicado pelo broker se a conexão cair sem DISCONNECT
   * @param {number} [o.keepAlive] segundos
   */
  constructor({ url, clientId, will = null, keepAlive = 20, WebSocketImpl = globalThis.WebSocket }) {
    Object.assign(this, { url, clientId, will, keepAlive, WS: WebSocketImpl });
    this.onMessage = () => {};
    this.onClose = () => {};
    this.ws = null;
    this.open = false;
    this.pingTimer = null;
    this.buf = new Uint8Array(0);
    this.nextId = 1;
  }

  /** Conecta e resolve quando o broker aceita (CONNACK). Rejeita em erro/timeout. */
  connect(timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (why) => { if (!settled) { settled = true; try { this.ws?.close(); } catch { /* ok */ } reject(new Error(why)); } };
      const timer = setTimeout(() => fail('timeout ao conectar'), timeoutMs);
      let ws;
      try { ws = new this.WS(this.url, 'mqtt'); } catch (e) { clearTimeout(timer); return reject(e); }
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      ws.onopen = () => {
        const flags = 0x02 | (this.will ? 0x04 : 0); // clean session (+ will QoS0, sem retain)
        const body = [...str('MQTT'), 4, flags, this.keepAlive >> 8, this.keepAlive & 0xff, ...str(this.clientId)];
        if (this.will) body.push(...str(this.will.topic), ...str(this.will.payload));
        ws.send(packet(0x10, body));
      };
      ws.onmessage = (ev) => {
        const chunk = new Uint8Array(ev.data);
        const merged = new Uint8Array(this.buf.length + chunk.length);
        merged.set(this.buf); merged.set(chunk, this.buf.length);
        this.buf = merged;
        this.#drain(() => {
          if (!settled) { settled = true; clearTimeout(timer); this.open = true; this.#startPing(); resolve(); }
        }, (code) => fail(`broker recusou (código ${code})`));
      };
      ws.onerror = () => fail('erro de conexão');
      ws.onclose = () => {
        clearTimeout(timer);
        clearInterval(this.pingTimer);
        const was = this.open;
        this.open = false;
        if (!settled) fail('fechou antes de conectar'); else if (was) this.onClose();
      };
    });
  }

  #drain(onConnack, onRefused) {
    for (;;) {
      if (this.buf.length < 2) return;
      let mult = 1; let len = 0; let i = 1; let byte;
      do {
        if (i >= this.buf.length) return; // cabeçalho incompleto
        byte = this.buf[i++];
        len += (byte & 127) * mult;
        mult *= 128;
      } while (byte & 128);
      if (this.buf.length < i + len) return; // corpo incompleto
      const type = this.buf[0] >> 4;
      const body = this.buf.subarray(i, i + len);
      this.buf = this.buf.subarray(i + len);
      if (type === 2) { if (body[1] === 0) onConnack(); else onRefused(body[1]); }
      else if (type === 3) { // PUBLISH
        const tlen = (body[0] << 8) | body[1];
        const topic = dec.decode(body.subarray(2, 2 + tlen));
        this.onMessage(topic, body.subarray(2 + tlen));
      }
      // SUBACK (9), PINGRESP (13): nada a fazer
    }
  }

  #startPing() {
    this.pingTimer = setInterval(() => this.#send(Uint8Array.from([0xc0, 0])), (this.keepAlive * 1000) / 2);
    this.pingTimer.unref?.();
  }

  #send(bytes) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(bytes);
  }

  subscribe(topic) {
    const id = this.nextId++ & 0xffff || 1;
    this.#send(packet(0x82, [id >> 8, id & 0xff, ...str(topic), 0]));
  }

  /** payload: string ou Uint8Array. `retain`: o broker guarda a última mensagem do tópico. */
  publish(topic, payload, { retain = false } = {}) {
    const p = typeof payload === 'string' ? utf8(payload) : payload;
    this.#send(packet(0x30 | (retain ? 1 : 0), [...str(topic), ...p]));
  }

  close() {
    this.onClose = () => {};
    clearInterval(this.pingTimer);
    this.#send(Uint8Array.from([0xe0, 0])); // DISCONNECT limpo (o testamento NÃO é enviado)
    try { this.ws?.close(); } catch { /* ok */ }
    this.open = false;
  }
}
