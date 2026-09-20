// Relay: o "servidor local leve" da spec. Ele NÃO conhece as regras do jogo — só:
//  - agrupa conexões em salas (código de 4 letras)
//  - encaminha ações dos clientes para o HOST da sala e mensagens do host para os clientes
//  - responde ping/pong com o relógio dele (referência de tempo comum p/ o timer sincronizado)
//  - guarda o último snapshot enviado pelo host e, se o host cair (e não voltar dentro de uma
//    tolerância), promove o próximo peer e entrega esse snapshot a ele (migração de host).
//
// Proteções: token secreto por jogador (o id é público nas visões, o token não — impede tomar o
// lugar de outro), limite de mensagens por segundo, de jogadores por sala e de salas.
//
// A autoridade do jogo (motor, pontuação, denúncias) é o peer-host — ver host.js.
// Este arquivo é independente de transporte: recebe "conexões" com { send(obj), close() }.

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sem I/O pra não confundir
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;

export class Relay {
  /**
   * @param {object} [o]
   * @param {number} [o.promoteGraceMs] espera antes de trocar o host que caiu (blips de Wi-Fi não trocam host); 0 = imediato
   * @param {number} [o.maxPeers]       jogadores por sala
   * @param {number} [o.maxRooms]       salas simultâneas
   * @param {number} [o.maxMsgPerSec]   mensagens por segundo por conexão (o excesso é descartado)
   * @param {boolean} [o.autoPromote]    promove outro jogador quando o host cai (desligado no modo online: lá quem decide é a eleição)
   * @param {boolean} [o.allowCustomRoom] aceita `create` com código próprio e restauração de snapshot (modo online)
   */
  constructor({
    now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout,
    promoteGraceMs = 4000, maxPeers = 16, maxRooms = 100, maxMsgPerSec = 80, allowCustomRoom = false, autoPromote = true,
  } = {}) {
    Object.assign(this, { now, setTimer, clearTimer, promoteGraceMs, maxPeers, maxRooms, maxMsgPerSec, allowCustomRoom, autoPromote });
    this.rooms = new Map();
  }

  /** Nova conexão. Devolve os handlers que o transporte deve chamar. */
  connect(conn) {
    const ctx = { conn, room: null, id: null, winStart: 0, winCount: 0 };
    return {
      message: (msg) => this.#onMessage(ctx, msg),
      close: () => this.#onClose(ctx),
    };
  }

  // ------------------------------------------------------------ persistência (o servidor pode reiniciar)

  /** Estado das salas em JSON puro (sem conexões): grave em disco e devolva em `importState`. */
  exportState() {
    return {
      v: 1,
      rooms: [...this.rooms.values()].map((r) => ({
        code: r.code, hostId: r.hostId, snapshot: r.snapshot,
        peers: [...r.peers.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, token: p.token, order: p.order })),
      })),
    };
  }

  /** Recria as salas com todos desconectados; quem voltar (mesmo id e token) retoma o lugar. Devolve quantas. */
  importState(data, graceMs = 20_000) {
    if (data?.v !== 1) return 0;
    let n = 0;
    for (const r of data.rooms ?? []) {
      if (!r?.code || this.rooms.has(r.code)) continue;
      const room = { code: r.code, hostId: r.hostId, peers: new Map(), snapshot: r.snapshot ?? null, cleanup: null, restoredUntil: this.now() + graceMs };
      for (const p of r.peers ?? []) room.peers.set(p.id, { ...p, ctx: null, connected: false });
      this.rooms.set(room.code, room);
      room.cleanup = this.#timer(() => { if (![...room.peers.values()].some((p) => p.connected)) this.rooms.delete(room.code); }, EMPTY_ROOM_TTL_MS);
      if (this.autoPromote) { // se o host não voltar no prazo, o próximo que aparecer assume
        this.#timer(() => {
          const h = room.peers.get(room.hostId);
          if (h && !h.connected && !h.graceTimer) this.#promote(room, room.hostId);
        }, graceMs);
      }
      n += 1;
    }
    return n;
  }

  // ------------------------------------------------------------ internos

  #code() {
    for (;;) {
      let c = '';
      for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      if (!this.rooms.has(c)) return c;
    }
  }

  #peerList(room) {
    return [...room.peers.values()].map((p) => ({ id: p.id, name: p.name, ...(p.color != null && { color: p.color }), connected: p.connected }));
  }

  #send(conn, obj) {
    try { conn.send(obj); } catch { /* conexão morta: o close cuida */ }
  }

  #timer(fn, ms) {
    const t = this.setTimer(fn, ms);
    t?.unref?.(); // timers do relay não seguram o processo aberto
    return t;
  }

  /** Limite de taxa: janela de 1 s por conexão. */
  #allowed(ctx) {
    const t = this.now();
    if (t - ctx.winStart >= 1000) { ctx.winStart = t; ctx.winCount = 0; }
    ctx.winCount += 1;
    return ctx.winCount <= this.maxMsgPerSec;
  }

  #onMessage(ctx, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (!this.#allowed(ctx)) return;
    switch (msg.t) {
      case 'ping':
        this.#send(ctx.conn, { t: 'pong', c: msg.c, s: this.now() });
        break;
      case 'create': return this.#create(ctx, msg);
      case 'join': return this.#join(ctx, msg);
      default: break;
    }
    const room = ctx.room && this.rooms.get(ctx.room);
    if (!room || room.peers.get(ctx.id)?.ctx !== ctx) return; // ainda não entrou / conexão substituída

    if (msg.t === 'act') {
      const host = room.peers.get(room.hostId);
      if (host?.connected) this.#send(host.ctx.conn, { t: 'from', from: ctx.id, msg: msg.msg });
    } else if (ctx.id === room.hostId) {
      // só o host pode mandar mensagens aos clientes e gravar snapshot
      if (msg.t === 'to') {
        const targets = msg.to === '*' ? [...room.peers.values()] : [room.peers.get(msg.to)];
        for (const p of targets) {
          if (p && p.connected && p.id !== ctx.id) this.#send(p.ctx.conn, { t: 'msg', msg: msg.msg });
        }
      } else if (msg.t === 'sync') {
        room.snapshot = msg.snapshot;
      }
    }
  }

  /** Registra a conexão como o peer `id`. Devolve null se o token não bate (alguém tentando tomar o lugar). */
  #addPeer(ctx, room, { id, name, color, token }) {
    const prev = room.peers.get(id);
    const tk = typeof token === 'string' ? token.slice(0, 64) : '';
    if (prev?.token && prev.token !== tk) return null;
    if (prev?.ctx && prev.ctx !== ctx) {
      prev.ctx.room = null; // conexão antiga deixa de valer (reconexão do mesmo jogador)
      try { prev.ctx.conn.close(); } catch { /* já caiu */ }
    }
    const peer = prev ?? { id, order: room.peers.size };
    Object.assign(peer, {
      name: String(name || 'Jogador').slice(0, 20),
      color: Number.isFinite(color) ? Math.abs(Math.round(color)) % 360 : undefined,
      token: prev?.token || tk,
      ctx, connected: true,
    });
    if (peer.graceTimer) { this.clearTimer(peer.graceTimer); peer.graceTimer = null; } // voltou a tempo
    room.peers.set(id, peer);
    ctx.room = room.code;
    ctx.id = id;
    if (room.cleanup) { this.clearTimer(room.cleanup); room.cleanup = null; }
    return peer;
  }

  #create(ctx, msg) {
    if (!msg.id) return this.#send(ctx.conn, { t: 'error', message: 'ID ausente.' });
    if (this.rooms.size >= this.maxRooms) return this.#send(ctx.conn, { t: 'error', fatal: true, message: 'Servidor cheio: muitas salas abertas.' });
    const custom = this.allowCustomRoom && /^[A-Z]{4,8}$/.test(msg.room ?? '') && !this.rooms.has(msg.room) ? msg.room : null;
    const restore = this.allowCustomRoom ? msg.restore : null;
    const room = { code: custom ?? this.#code(), hostId: msg.id, peers: new Map(), snapshot: restore?.snapshot ?? null, cleanup: null };
    this.rooms.set(room.code, room);
    this.#addPeer(ctx, room, msg);
    // restauração: quem assume uma sala recebe o snapshot e a lista de jogadores (todos desconectados até voltarem)
    const peers = restore?.peers ?? this.#peerList(room);
    this.#send(ctx.conn, { t: 'joined', room: room.code, hostId: msg.id, isHost: true, snapshot: restore?.snapshot ?? null, peers });
  }

  #join(ctx, msg) {
    const room = this.rooms.get(String(msg.room || '').toUpperCase());
    if (!room) return this.#send(ctx.conn, { t: 'error', fatal: true, message: 'Sala não encontrada.' });
    if (!msg.id) return this.#send(ctx.conn, { t: 'error', message: 'ID ausente.' });
    if (!room.peers.has(msg.id) && room.peers.size >= this.maxPeers) {
      return this.#send(ctx.conn, { t: 'error', fatal: true, message: 'Sala cheia.' });
    }
    if (!this.#addPeer(ctx, room, msg)) {
      return this.#send(ctx.conn, { t: 'error', fatal: true, message: 'Este jogador já está na sala em outro aparelho.' });
    }
    this.#ensureHost(room, msg.id);

    const isHost = room.hostId === msg.id;
    this.#send(ctx.conn, {
      t: 'joined', room: room.code, hostId: room.hostId, isHost,
      snapshot: isHost ? room.snapshot : null, peers: this.#peerList(room),
    });
    if (!isHost) {
      const host = room.peers.get(room.hostId);
      const me = room.peers.get(msg.id);
      if (host?.connected) this.#send(host.ctx.conn, { t: 'peer-join', id: msg.id, name: me.name, color: me.color });
    }
  }

  /** Se o host está fora e quem entrou está conectado, ele assume (sala nunca fica sem host). */
  #ensureHost(room, joinedId) {
    const host = room.peers.get(room.hostId);
    if (host?.connected) return;
    if (host?.graceTimer) return; // o host está na tolerância: ainda pode voltar
    if (room.restoredUntil > this.now()) return; // sala restaurada do disco: dá tempo do host voltar
    if (joinedId !== room.hostId) room.hostId = joinedId; // o próprio host voltando mantém o cargo
  }

  #onClose(ctx) {
    const room = ctx.room && this.rooms.get(ctx.room);
    if (!room) return;
    const peer = room.peers.get(ctx.id);
    if (!peer || peer.ctx !== ctx) return; // já foi substituída por reconexão
    peer.connected = false;

    if (ctx.id === room.hostId) {
      if (!this.autoPromote) {
        // sem promoção: o relay vive dentro do host; se o host some, o relay some junto
      } else if (this.promoteGraceMs > 0) {
        // tolerância: se o host voltar (blip de Wi-Fi), nada muda; senão promove o próximo
        peer.graceTimer = this.#timer(() => {
          peer.graceTimer = null;
          if (!peer.connected && room.hostId === peer.id) this.#promote(room, peer.id);
        }, this.promoteGraceMs);
      } else {
        this.#promote(room, ctx.id);
      }
    } else {
      const host = room.peers.get(room.hostId);
      if (host?.connected) this.#send(host.ctx.conn, { t: 'peer-leave', id: ctx.id });
    }

    if (![...room.peers.values()].some((p) => p.connected)) {
      room.cleanup = this.#timer(() => this.rooms.delete(room.code), EMPTY_ROOM_TTL_MS);
    }
  }

  /** Migração de host: o próximo peer conectado (ordem de entrada) assume com o último snapshot. */
  #promote(room, oldHostId) {
    const next = [...room.peers.values()]
      .filter((p) => p.connected && p.id !== oldHostId)
      .sort((a, b) => a.order - b.order)[0];
    if (!next) return; // ninguém pra assumir: o host antigo mantém o cargo se voltar
    room.hostId = next.id;
    this.#send(next.ctx.conn, {
      t: 'promote', oldHostId, snapshot: room.snapshot, peers: this.#peerList(room),
    });
  }
}
