// Modo ONLINE (GitHub Pages, sem servidor nosso): a "ponte" entre os jogadores é um broker MQTT
// público (WebSocket seguro). Tudo que passa por ele é CRIPTOGRAFADO com uma chave derivada do
// código da sala (ver cipher.js) — o broker só vê bytes.
//
// Ideia central: reaproveitar o que já existe. Quem CRIA a sala roda, dentro do navegador dele,
// o mesmo `Relay` do modo LAN + o `GameHost`; os outros jogadores usam o mesmo `GameClient`, só
// que com um "socket" que fala MQTT em vez de WebSocket. Assim regras, segurança (token, limites)
// e protocolo são idênticos nos dois modos.
//
// Tópicos (sob palimpsesto/v1/<roomId>/):  info (retida) · s (jogador→servidor) · b (avisos a todos,
// inclui os "testamentos") · c/<connId> (servidor→jogador) · snap/<id> (retida: estado para o sucessor).
//
// Migração de host: o servidor manda batimentos (hb). Se sumirem (ou vier um "gone"), o próximo
// jogador da lista assume, restaurando o último snapshot que o host antigo lhe enviou, e os outros
// reentram sozinhos. O horário das fases é ajustado pela diferença entre os relógios.
import { GameClient } from './client.js';
import { Relay } from './relay.js';
import { MqttClient } from './mqtt.js';
import { Cipher } from './cipher.js';

// Brokers públicos gratuitos, sem conta. O primeiro que responder é usado; quem entra numa sala
// procura em todos (a sala está no broker onde o criador conseguiu conectar).
export const BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
];

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export function newRoomCode(n = 6) {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(n));
  return [...bytes].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

const TIMING = {
  hbMs: 4000, // batimento do servidor
  hbTimeoutMs: 13000, // sem batimento por isso → servidor perdido
  electionBaseMs: 7000, // espera antes de assumir (queda silenciosa)
  goneDelayMs: 1500, // espera antes de assumir (aviso explícito de saída)
  electionStepMs: 6000, // cada posição na fila espera mais
  idleMs: 16000, // servidor: jogador sem sinal por isso → desconectado
  snapMs: 1000, // servidor: envia o snapshot ao sucessor
  probeMs: 3500, // entrar: quanto esperar a sala aparecer em cada broker
  connectMs: 6000, // conectar a um broker
  joinWaitMs: 12000, // entrar: quanto esperar a 1ª resposta do host
  pingMs: 5000, // jogador: sinal de vida ao servidor
  reconnectMs: 2000, // espera entre tentativas de reentrar
};

const shiftTimes = (snap, delta) => {
  const s = JSON.parse(JSON.stringify(snap));
  if (s.game?.phaseEndsAt != null) s.game.phaseEndsAt += delta;
  return s;
};

export class OnlineSession {
  constructor({
    id, name, color, token, content,
    onView = () => {}, onStatus = () => {}, onError = () => {}, onKicked = () => {},
    brokers = BROKERS, timing = {}, WebSocketImpl = globalThis.WebSocket, clock = () => Date.now(),
  }) {
    Object.assign(this, { id, name, color, token, content, onView, onStatus, onError, onKicked, brokers, WS: WebSocketImpl, clock });
    this.t = { ...TIMING, ...timing };
    this.connId = `k${Math.random().toString(36).slice(2, 12)}`;
    this.mode = null; // 'server' | 'client'
    this.code = null;
    this.cipher = null;
    this.T = null;
    this.mqtt = null;
    this.brokerUrl = null;
    this.subs = new Set();
    this.client = null;
    this.relay = null;
    this.hub = new Map();
    this.socket = null;
    this.lastView = null;
    this.lastSnap = null;
    this.info = null;
    this.hostK = null;
    this.lastHostAt = 0;
    this.lost = false;
    this.takingOver = false;
    this.leaving = false;
    this.timers = [];
    this.tx = Promise.resolve();
    this.rx = Promise.resolve();
    this.hbN = 0;
  }

  /** Tempo compartilhado (o do host). Sempre atual, mesmo depois de migração. */
  serverNow = () => (this.client ? this.client.serverNow() : this.clock());
  get room() { return this.code; }
  get isHost() { return this.mode === 'server'; }

  // ------------------------------------------------------------------ API pública

  async create() {
    this.#status('connecting');
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        await this.#useCode(newRoomCode());
        await this.#connectAny();
        this.info = null;
        await this.#waitInfo(1200);
        if (!this.info) break; // código livre
        await this.#closeMqtt(); // colisão rara: outro criador usa este código
        if (attempt === 3) throw new Error('Não foi possível reservar um código de sala.');
      }
      await this.#startServer(null);
    } catch (e) {
      this.onError(e.message, true);
    }
  }

  async join(code) {
    this.#status('connecting');
    try {
      await this.#useCode(String(code).trim().toUpperCase());
      let reached = false;
      let found = false;
      for (const url of this.brokers) {
        try { await this.#openMqtt(url); } catch { continue; }
        reached = true;
        this.info = null;
        await this.#waitInfo(this.t.probeMs);
        if (this.info) { found = true; break; }
        await this.#closeMqtt();
      }
      if (!found) throw new Error(reached ? 'Sala não encontrada.' : 'Sem internet: nenhum servidor online respondeu.');
      this.hostK = this.info.k;
      this.#startClient();
    } catch (e) {
      this.onError(e.message, true);
    }
  }

  act(msg) { this.client?.act(msg); }

  leave() {
    if (this.leaving) return;
    // saída voluntária do host: manda um snapshot FINAL ao sucessor antes de parar os timers
    if (this.mode === 'server') {
      this.client?.host?.flushSync();
      this.#forwardSnapshot();
    }
    this.leaving = true;
    this.timers.forEach((x) => { clearInterval(x); clearTimeout(x); });
    this.timers = [];
    this.client?.leave();
    (async () => {
      try {
        if (this.mode === 'server') {
          await this.#pub(this.T.b, { t: 'gone', k: this.connId }); // avisa para o sucessor assumir já
          this.mqtt?.publish(this.T.info, new Uint8Array(0), { retain: true });
          if (this.lastSucc) this.mqtt?.publish(this.T.snap(this.lastSucc), new Uint8Array(0), { retain: true });
        }
        await this.tx;
      } catch { /* saindo mesmo */ }
      await this.#closeMqtt();
    })();
  }

  // ------------------------------------------------------------------ conexão com o broker

  async #useCode(code) {
    this.code = code;
    this.cipher = await Cipher.fromCode(code);
    const root = `palimpsesto/v1/${this.cipher.roomId}`;
    this.T = { info: `${root}/info`, s: `${root}/s`, b: `${root}/b`, c: (k) => `${root}/c/${k}`, snap: (id) => `${root}/snap/${id}` };
  }

  async #connectAny() {
    let last = null;
    for (const url of this.brokers) {
      try { await this.#openMqtt(url); return; } catch (e) { last = e; }
    }
    throw new Error(`Sem internet: nenhum servidor online respondeu.${last ? ` (${last.message})` : ''}`);
  }

  async #openMqtt(url) {
    const will = { topic: this.T.b, payload: await this.cipher.encrypt({ t: 'gone', k: this.connId }) };
    const m = new MqttClient({ url, clientId: this.connId, will, keepAlive: 20, WebSocketImpl: this.WS });
    m.onMessage = (topic, payload) => this.#rx(topic, payload);
    m.onClose = () => this.#onMqttClosed(m);
    await m.connect(this.t.connectMs);
    this.mqtt = m;
    this.brokerUrl = url;
    for (const topic of [this.T.info, this.T.b, this.T.c(this.connId), this.T.snap(this.id)]) this.subs.add(topic);
    if (this.mode === 'server') this.subs.add(this.T.s);
    for (const topic of this.subs) m.subscribe(topic);
  }

  async #closeMqtt() {
    const m = this.mqtt;
    this.mqtt = null;
    this.subs.clear();
    m?.close();
  }

  #waitInfo(ms) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const iv = setInterval(() => { if (this.info || Date.now() - t0 >= ms) { clearInterval(iv); resolve(); } }, 40);
    });
  }

  /** Broker caiu: tenta reconectar rápido; se não der, desiste com aviso. */
  async #onMqttClosed(m) {
    if (this.leaving || m !== this.mqtt) return;
    this.#status('reconnecting');
    this.socket?.forceClose();
    for (let i = 0; i < 5 && !this.leaving; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        await this.#openMqtt(this.brokerUrl);
        if (this.mode === 'server') { this.#publishInfo(); this.#pub(this.T.b, { t: 'srv-up', hostId: this.id, k: this.connId }); }
        this.#status('connected');
        return;
      } catch { /* tenta de novo */ }
    }
    if (!this.leaving) this.onError('A conexão com o servidor online foi perdida.', true);
  }

  // ------------------------------------------------------------------ envio e recepção (em ordem)

  #pub(topic, obj, retain = false) {
    this.tx = this.tx.then(async () => {
      if (!this.mqtt?.open) return;
      this.mqtt.publish(topic, await this.cipher.encrypt(obj), { retain });
    }).catch(() => {});
    return this.tx;
  }

  #rx(topic, payload) {
    const bytes = new Uint8Array(payload); // cópia: o buffer do socket é reaproveitado
    this.rx = this.rx.then(async () => {
      if (this.leaving) return;
      const obj = await this.cipher.decrypt(bytes);
      if (obj) this.#route(topic, obj);
    }).catch(() => {});
  }

  #route(topic, obj) {
    const T = this.T;
    if (topic === T.info) this.info = obj;
    else if (topic === T.b) this.#onBroadcast(obj);
    else if (topic === T.s) this.#onServerInbox(obj);
    else if (topic === T.c(this.connId)) { this.lastHostAt = this.clock(); this.socket?.deliver(obj); }
    else if (topic === T.snap(this.id)) this.lastSnap = obj;
  }

  #status(s, info) { this.onStatus(s, { ...info, ...(this.takingOver && s === 'host' && { migrated: true }) }); }

  // ------------------------------------------------------------------ modo SERVIDOR (host)

  async #startServer(restore) {
    this.mode = 'server';
    this.relay = new Relay({ now: this.clock, autoPromote: false, allowCustomRoom: true });
    this.subs.add(this.T.s);
    this.mqtt.subscribe(this.T.s);
    this.#publishInfo();
    this.#pub(this.T.b, { t: 'srv-up', hostId: this.id, k: this.connId });
    this.timers.push(setInterval(() => this.#pub(this.T.b, { t: 'hb', hostId: this.id, k: this.connId, n: this.hbN++ }), this.t.hbMs));
    this.timers.push(setInterval(() => this.#sweep(), Math.max(200, this.t.idleMs / 4)));
    this.timers.push(setInterval(() => this.#forwardSnapshot(), this.t.snapMs));

    const self = this;
    class LocalSocket { // o próprio host fala com o relay na memória
      constructor() {
        this.readyState = 0;
        const conn = { send: (o) => queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(o) })), close: () => {} };
        this.h = self.relay.connect(conn);
        queueMicrotask(() => { this.readyState = 1; this.onopen?.(); });
      }
      send(s) { this.h.message(JSON.parse(s)); }
      close() { this.readyState = 3; this.h.close(); queueMicrotask(() => this.onclose?.()); }
    }
    this.client = this.#makeClient(LocalSocket, 'local://', 10_000);
    this.client.create({ room: this.code, ...(restore && { restore }) });
  }

  #publishInfo() { this.#pub(this.T.info, { hostId: this.id, k: this.connId, at: this.clock() }, true); }

  #onServerInbox(env) {
    if (this.mode !== 'server' || !env?.k) return;
    if (env.bye) return this.#hubDrop(env.k);
    let e = this.hub.get(env.k);
    if (!e) {
      const conn = { send: (obj) => this.#pub(this.T.c(env.k), obj), close: () => this.hub.delete(env.k) };
      e = { conn, h: this.relay.connect(conn), last: 0 };
      this.hub.set(env.k, e);
    }
    e.last = this.clock();
    let msg;
    try { msg = JSON.parse(env.m); } catch { return; }
    e.h.message(msg);
  }

  #hubDrop(k) {
    const e = this.hub.get(k);
    if (!e) return;
    this.hub.delete(k);
    e.h.close();
  }

  /** Jogador sem sinal por muito tempo → desconectado (celular dormiu, aba fechou sem testamento). */
  #sweep() {
    const now = this.clock();
    for (const [k, e] of this.hub) if (now - e.last > this.t.idleMs) this.#hubDrop(k);
  }

  /** Envia o snapshot ao sucessor (1º jogador conectado depois do host), guardado como mensagem retida. */
  #forwardSnapshot() {
    const room = this.relay?.rooms.get(this.code);
    if (!room || !this.mqtt?.open) return;
    // mesmo critério da eleição: 1º da lista de jogadores (ordem da visão) que está conectado e não é o host
    const list = room.snapshot?.game?.players ?? room.snapshot?.lobby?.players ?? [];
    const succ = list.find((p) => p.connected && p.id !== room.hostId)?.id ?? null;
    if (succ !== this.lastSucc) {
      if (this.lastSucc) this.mqtt.publish(this.T.snap(this.lastSucc), new Uint8Array(0), { retain: true });
      this.lastSucc = succ;
      this.snapSent = null;
    }
    if (succ && room.snapshot && room.snapshot !== this.snapSent) {
      this.snapSent = room.snapshot;
      this.#pub(this.T.snap(succ), room.snapshot, true);
    }
  }

  // ------------------------------------------------------------------ modo CLIENTE

  #startClient() {
    this.mode = 'client';
    this.lastHostAt = this.clock();
    const self = this;
    class MqttSocket { // parece um WebSocket para o GameClient
      constructor() {
        this.readyState = 0;
        self.socket = this;
        const t0 = Date.now();
        const tryOpen = () => {
          if (self.socket !== this || this.readyState === 3) return;
          if (self.mqtt?.open) { this.readyState = 1; this.onopen?.(); }
          else if (Date.now() - t0 > 6000) this.forceClose();
          else setTimeout(tryOpen, 100);
        };
        queueMicrotask(tryOpen);
      }
      send(s) { if (this.readyState === 1) self.#pub(self.T.s, { k: self.connId, m: s }); }
      deliver(obj) { if (this.readyState === 1) this.onmessage?.({ data: JSON.stringify(obj) }); }
      close() {
        if (this.readyState === 3) return;
        this.readyState = 3;
        if (self.socket === this && !self.silentClose) self.#pub(self.T.s, { k: self.connId, bye: true });
        queueMicrotask(() => this.onclose?.());
      }
      forceClose() { // reconecta sem avisar saída (usado quando o servidor some/muda)
        if (this.readyState === 3) return;
        this.readyState = 3;
        queueMicrotask(() => this.onclose?.());
      }
    }
    this.client = this.#makeClient(MqttSocket, 'mqtt://', Math.min(this.t.pingMs, this.t.idleMs / 3));
    this.client.join(this.code);
    const joinedBy = Date.now() + this.t.joinWaitMs;
    this.timers.push(setInterval(() => {
      if (this.leaving || this.mode !== 'client') return;
      const now = this.clock();
      if (!this.lastView && Date.now() > joinedBy) { this.onError('O host desta sala não respondeu.', true); return; }
      if (!this.lost && this.lastView && now - this.lastHostAt > this.t.hbTimeoutMs) this.#hostLost('silence');
      else if (this.lost && now - this.lastForce > this.t.hbTimeoutMs) { this.lastForce = now; this.socket?.forceClose(); }
    }, 1000));
  }

  #onBroadcast(obj) {
    if (this.mode === 'server') {
      if (obj.t === 'gone' && obj.k && obj.k !== this.connId) this.#hubDrop(obj.k); // testamento de um jogador
      return;
    }
    if (this.mode !== 'client') return;
    if (obj.t === 'hb' || obj.t === 'srv-up') {
      this.lastHostAt = this.clock();
      const changed = this.hostK && obj.k !== this.hostK;
      this.hostK = obj.k;
      if (changed || this.lost) { // servidor novo (ou voltou): cancela eleição e reentra
        this.lost = false;
        clearTimeout(this.electTimer);
        this.electTimer = null;
        this.socket?.forceClose();
      }
    } else if (obj.t === 'gone' && obj.k === this.hostK) {
      this.#hostLost('gone');
    }
  }

  #hostLost(reason) {
    if (this.lost || this.leaving || this.mode !== 'client') return;
    this.lost = true;
    this.lastForce = this.clock();
    this.#status('reconnecting');
    this.socket?.forceClose();
    const players = this.lastView?.players ?? [];
    const hostId = this.lastView?.hostId;
    const order = players.filter((p) => p.connected && p.id !== hostId).map((p) => p.id);
    const rank = order.indexOf(this.id);
    if (rank < 0) return; // não sou candidato: só continuo tentando reentrar
    const delay = (reason === 'gone' ? this.t.goneDelayMs : this.t.electionBaseMs) + rank * this.t.electionStepMs;
    this.electTimer = setTimeout(() => this.#takeOver(), delay);
  }

  async #takeOver() {
    this.electTimer = null;
    if (!this.lost || this.leaving || this.mode !== 'client') return; // alguém já assumiu
    if (!this.lastSnap) { this.onError('Não foi possível assumir a sala: sem estado salvo.', true); return; }
    const offset = this.client?.offset ?? 0; // horário do host antigo − meu horário
    const snapshot = shiftTimes(this.lastSnap, -offset);
    const players = snapshot.game?.players ?? snapshot.lobby?.players ?? [];
    const peers = players.map((p) => ({ id: p.id, name: p.name, ...(p.color != null && { color: p.color }), connected: p.id === this.id }));
    this.timers.forEach((x) => { clearInterval(x); clearTimeout(x); });
    this.timers = [];
    this.silentClose = true;
    this.client?.leave();
    this.client = null;
    this.socket = null;
    this.silentClose = false;
    this.lost = false;
    this.takingOver = true;
    this.info = null;
    await this.#startServer({ snapshot, peers });
  }

  // ------------------------------------------------------------------ GameClient

  #makeClient(WebSocketImpl, url, pingMs) {
    return new GameClient({
      url, id: this.id, name: this.name, color: this.color, token: this.token, content: this.content,
      WebSocketImpl, clock: this.clock, pingMs, reconnectMs: this.t.reconnectMs,
      onView: (v) => { this.lastView = v; this.lastHostAt = this.clock(); this.onView(v); },
      onStatus: (s, info) => this.#status(s, info),
      onError: (msg, fatal) => this.onError(msg, fatal),
      onKicked: () => { this.leave(); this.onKicked(); },
    });
  }
}
