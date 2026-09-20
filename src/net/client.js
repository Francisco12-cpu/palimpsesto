// GameClient: conexão de um jogador ao relay. Funciona no navegador e no Node 22+ (WebSocket global).
//  - sincroniza o relógio com o relay (ping/pong) → `serverNow()` é o tempo comum de todos
//  - recebe visões do host e entrega via onView
//  - se o relay o promover a host (o host anterior caiu), cria um GameHost com o último
//    snapshot e passa a exercer a autoridade — o jogo continua para os demais.
import { GameHost } from './host.js';

const TICK_MS = 250;
const SYNC_FLUSH_MS = 500;
const RECONNECT_MS = 2000;
const RECONNECT_MAX_TRIES = 30;

export class GameClient {
  constructor({
    url, id, name, color, token, content,
    onView = () => {}, onStatus = () => {}, onError = () => {}, onKicked = () => {},
    WebSocketImpl = globalThis.WebSocket, clock = () => Date.now(), pingMs = 10_000, reconnectMs = RECONNECT_MS,
  }) {
    Object.assign(this, { url, id, name, color, token, content, onView, onStatus, onError, onKicked, WS: WebSocketImpl, clock, pingMs, reconnectMs });
    this.createExtra = {};
    this.ws = null;
    this.room = null;
    this.host = null;
    this.offset = 0;
    this.bestRtt = Infinity;
    this.wantCreate = false;
    this.leaving = false;
    this.tries = 0;
    this.timers = [];
  }

  /** Tempo do relay (referência comum). Use isto para todo timer de fase. */
  serverNow = () => this.clock() + this.offset;
  get isHost() { return !!this.host; }

  // ------------------------------------------------------------ API pública

  /** `extra` vai junto do pedido de criação (modo online: código escolhido e restauração). */
  create(extra = {}) { this.wantCreate = true; this.createExtra = extra; this.#open(); }
  join(room) { this.room = String(room).trim().toUpperCase(); this.#open(); }

  /** Ação do jogador ({ a: 'draft'|'guess'|'done'|'report'|'config'|'start'|'rematch', ... }). */
  act(msg) {
    if (this.host) this.host.handle(this.id, msg);
    else this.#wsSend({ t: 'act', msg });
  }

  leave() {
    this.leaving = true;
    this.#stopHost();
    this.timers.forEach(clearInterval);
    this.timers = [];
    try { this.ws?.close(); } catch { /* ok */ }
  }

  // ------------------------------------------------------------ conexão

  #wsSend(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  #open() {
    this.onStatus('connecting');
    const ws = new this.WS(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.tries = 0;
      this.#syncClock();
      if (this.wantCreate && !this.room) this.#wsSend({ t: 'create', id: this.id, name: this.name, color: this.color, token: this.token, ...this.createExtra });
      else this.#wsSend({ t: 'join', room: this.room, id: this.id, name: this.name, color: this.color, token: this.token });
    };
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      this.#onMessage(m);
    };
    ws.onclose = () => {
      if (ws !== this.ws) return; // conexão antiga (já substituída)
      this.#stopHost(); // sem conexão não há como exercer a autoridade
      this.timers.forEach(clearInterval);
      this.timers = [];
      if (this.leaving) return;
      this.onStatus('reconnecting');
      if (!this.room || ++this.tries > RECONNECT_MAX_TRIES) {
        this.onError('Conexão perdida.', true);
        return;
      }
      setTimeout(() => !this.leaving && this.#open(), this.reconnectMs);
    };
    ws.onerror = () => {}; // onclose cuida
  }

  // ------------------------------------------------------------ relógio

  #syncClock() {
    const ping = () => this.#wsSend({ t: 'ping', c: this.clock() });
    for (let i = 0; i < 5; i++) setTimeout(ping, i * 120); // rajada inicial: pega a menor latência
    this.timers.push(setInterval(ping, this.pingMs));
  }

  #onPong({ c, s }) {
    const recv = this.clock();
    const rtt = recv - c;
    if (rtt <= this.bestRtt * 1.5 + 5) { // aceita amostras boas (NTP simplificado)
      if (rtt < this.bestRtt) this.bestRtt = rtt;
      this.offset = s + rtt / 2 - recv;
    }
  }

  // ------------------------------------------------------------ mensagens

  #onMessage(m) {
    switch (m.t) {
      case 'pong': return this.#onPong(m);
      case 'joined':
        this.room = m.room;
        this.bestRtt = Infinity; // possível servidor novo (migração): refaz a medida do relógio
        this.onStatus('connected', { room: m.room });
        return m.isHost ? this.#becomeHost(m.snapshot, m.peers) : this.#stopHost();
      case 'promote': return this.#becomeHost(m.snapshot, m.peers, m.oldHostId);
      case 'msg':
        if (m.msg.t === 'view') this.onView(m.msg.view);
        else if (m.msg.t === 'error') this.onError(m.msg.message, !!m.msg.fatal);
        else if (m.msg.t === 'kicked') { this.leave(); this.onKicked(); }
        return undefined;
      case 'error':
        if (m.fatal) this.room = null; // sala inexistente: não adianta reconectar
        return this.onError(m.message, !!m.fatal);
      case 'from': return this.host?.handle(m.from, m.msg);
      case 'peer-join': return this.host?.peerJoin(m.id, m.name, m.color);
      case 'peer-leave': return this.host?.peerLeave(m.id);
      default: return undefined;
    }
  }

  // ------------------------------------------------------------ papel de host

  #becomeHost(snapshot, peers, oldHostId) {
    this.#stopHost();
    const host = new GameHost({
      content: this.content,
      hostId: this.id,
      now: this.serverNow,
      snapshot,
      send: (to, msg) => {
        if (to === this.id) {
          if (msg.t === 'view') this.onView(msg.view);
          else if (msg.t === 'error') this.onError(msg.message, !!msg.fatal);
        } else this.#wsSend({ t: 'to', to, msg });
      },
      sync: (snap) => this.#wsSend({ t: 'sync', snapshot: snap }),
    });
    this.host = host;
    host.setHost(this.id);
    if (!snapshot) host.peerJoin(this.id, this.name, this.color); // sala nova: eu sou o 1º jogador
    if (oldHostId) host.peerLeave(oldHostId);
    if (peers) host.resync(peers);
    this.hostTimers = [
      setInterval(() => host.tick(), TICK_MS),
      setInterval(() => host.flushSync(), SYNC_FLUSH_MS),
    ];
    this.onStatus('host', { room: this.room, migrated: !!oldHostId });
  }

  #stopHost() {
    this.hostTimers?.forEach(clearInterval);
    this.hostTimers = null;
    this.host = null;
  }
}
