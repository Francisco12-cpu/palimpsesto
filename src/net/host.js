// GameHost: a AUTORIDADE do jogo (spec seção 6). Roda no navegador do peer-host.
// Recebe ações dos jogadores (via relay), aplica no motor puro, e manda a cada jogador a
// sua visão filtrada. Independe de transporte: recebe `send(toId, msg)` e `sync(snapshot)`.
//
// Regras de resiliência:
//  - nunca espera confirmação de cliente: quem cai só é marcado desconectado (setConnected);
//  - o estado completo vira snapshot (JSON) que o relay guarda; se este host cair, o próximo
//    peer recria um GameHost com `GameHost.fromSnapshot` e o jogo continua.
import * as E from '../engine/engine.js';
import { normalizeConfig, DEFAULT_CONFIG } from '../engine/config.js';
import { viewFor } from '../engine/view.js';

/** Tolerância no fim da escrita: o último trecho digitado (enviado no máx. 5×/s) chega antes da captura. */
export const WRITING_GRACE_MS = 400;

export class GameHost {
  /**
   * @param {object} o
   * @param {object} o.content   bancos de conteúdo (vanguardas/temas/modificadores)
   * @param {string} o.hostId    id do peer que exerce a autoridade (também define quem configura/inicia)
   * @param {() => number} o.now relógio COMPARTILHADO (tempo do relay), em ms
   * @param {(to: string, msg: object) => void} o.send
   * @param {(snapshot: object) => void} [o.sync]
   */
  constructor({ content, hostId, now, send, sync = () => {}, snapshot = null }) {
    this.content = content;
    this.now = now;
    this.send = send;
    this.sync = sync;
    this.dirty = false;
    this.lobby = snapshot?.lobby ?? { players: [], config: { ...DEFAULT_CONFIG, vanguards: null }, hostId, banned: [] };
    this.lobby.banned ??= [];
    this.lobby.watchers ??= []; // espectadores: quem chega com a partida em andamento
    this.game = snapshot?.game ?? null;
    // o snapshot não leva `content` (13 KB iguais em todo cliente): recoloca do conteúdo local
    if (this.game) this.game.content = { themes: structuredClone(content.themes), modifiers: [...content.modifiers], titles: structuredClone(content.titles ?? []) };
    this.setHost(hostId);
  }

  static fromSnapshot(snapshot, opts) {
    return new GameHost({ ...opts, snapshot });
  }

  setHost(hostId) {
    this.hostId = hostId;
    this.lobby.hostId = hostId;
  }

  // ------------------------------------------------------------ presença

  /** Alinha quem está conectado com a verdade do relay (usado ao assumir como host). */
  resync(peers) {
    for (const p of peers) {
      if (this.game) {
        if (this.game.players.some((x) => x.id === p.id)) this.#setConnected(p.id, p.connected);
        else if (!p.connected) this.lobby.watchers = this.lobby.watchers.filter((w) => w.id !== p.id);
      } else if (p.connected) {
        this.#lobbyJoin(p.id, p.name, p.color);
      } else {
        this.#lobbyLeave(p.id);
      }
    }
    this.#changed();
  }

  peerJoin(id, name, color) {
    if (this.lobby.banned.includes(id)) {
      this.send(id, { t: 'error', fatal: true, message: 'Você foi removido desta sala.' });
      return;
    }
    if (this.game) {
      if (!this.game.players.some((p) => p.id === id)) {
        // chegou com a partida em andamento: assiste (e entra na próxima)
        const w = this.lobby.watchers.find((x) => x.id === id);
        if (w) { w.connected = true; if (name) w.name = name; if (color != null) w.color = color; }
        else this.lobby.watchers.push({ id, name: name || 'Jogador', color, connected: true });
      } else {
        this.#setConnected(id, true);
      }
    } else {
      this.#lobbyJoin(id, name, color);
    }
    this.#changed();
  }

  peerLeave(id) {
    if (this.lobby.watchers.some((w) => w.id === id)) this.lobby.watchers = this.lobby.watchers.filter((w) => w.id !== id);
    else if (this.game) this.#setConnected(id, false);
    else this.#lobbyLeave(id);
    this.#changed();
  }

  #lobbyJoin(id, name, color) {
    const p = this.lobby.players.find((x) => x.id === id);
    if (p) { p.connected = true; if (name) p.name = name; if (color != null) p.color = color; }
    else this.lobby.players.push({ id, name: name || 'Jogador', color, connected: true });
  }

  #lobbyLeave(id) {
    this.lobby.players = this.lobby.players.filter((p) => p.id !== id);
  }

  #setConnected(id, connected) {
    const r = E.setConnected(this.game, id, connected, this.now());
    if (!r.error) this.game = r.state;
  }

  // ------------------------------------------------------------ ações

  /** msg = { a: 'config'|'start'|'rematch'|'draft'|'guess'|'done'|'report', ... } */
  handle(from, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (this.lobby.watchers.some((w) => w.id === from)) return; // espectador só assiste
    const now = this.now();
    const g = this.game;
    let r = null;

    switch (msg.a) {
      case 'config': return this.#setConfig(from, msg.config);
      case 'start': return this.#start(from);
      case 'rematch': return this.#rematch(from);
      case 'kick': return this.#kick(from, msg.id);
      case 'draft': r = g && E.updateDraft(g, from, msg.text); break;
      case 'guess': r = g && E.submitGuess(g, from, msg.vanguard, now); break;
      case 'done': r = g && E.markDone(g, from, now); break;
      case 'report': r = g && E.toggleReport(g, from, msg.author); break;
      default: return;
    }
    if (!r) return;
    if (r.error) {
      // rascunho é "melhor esforço": um envio atrasado (depois do Pronto/fim do tempo) não é erro pro jogador
      if (msg.a !== 'draft') this.send(from, { t: 'error', message: r.error });
      return;
    }
    this.game = r.state;
    // rascunho é privado: não há o que mostrar aos outros, só marca pra sincronizar depois
    if (msg.a === 'draft') this.dirty = true;
    else this.#changed();
  }

  #setConfig(from, config) {
    if (this.game || from !== this.hostId) return this.send(from, { t: 'error', message: 'Só o host configura a sala, antes de começar.' });
    let normalized;
    try {
      normalized = normalizeConfig(config, this.content); // valida e limpa (números limitados, listas filtradas)
    } catch (e) {
      return this.send(from, { t: 'error', message: e.message });
    }
    this.lobby.config = normalized; // nunca guardamos/repassamos o objeto bruto do cliente
    this.#changed();
  }

  #start(from) {
    if (this.game || from !== this.hostId) return this.send(from, { t: 'error', message: 'Só o host inicia a partida.' });
    const players = this.lobby.players.filter((p) => p.connected);
    if (players.length < 2) return this.send(from, { t: 'error', message: 'São necessários pelo menos 2 jogadores.' });
    try {
      const need = normalizeConfig(this.lobby.config, this.content).vanguards.length;
      if (need < players.length) return this.send(from, { t: 'error', message: `Selecione pelo menos ${players.length} vanguardas (uma por jogador).` });
      const created = E.createGame({ players, config: this.lobby.config, content: this.content, seed: (Math.random() * 2 ** 32) >>> 0 });
      const r = E.startGame(created, this.now());
      this.game = r.state;
    } catch (e) {
      return this.send(from, { t: 'error', message: e.message });
    }
    this.#changed();
  }

  /** Expulsa um jogador da sala de espera (só o host; ele não consegue voltar com o mesmo id). */
  #kick(from, targetId) {
    if (this.game || from !== this.hostId || targetId === this.hostId) return;
    if (!this.lobby.players.some((p) => p.id === targetId)) return;
    this.lobby.banned.push(targetId);
    this.#lobbyLeave(targetId);
    this.send(targetId, { t: 'kicked' });
    this.#changed();
  }

  #rematch(from) {
    if (!this.game || this.game.phase !== E.PHASES.FINISHED || from !== this.hostId) return;
    // quem só assistia entra na próxima partida
    const everyone = [...this.game.players, ...this.lobby.watchers].filter((p) => p.connected);
    this.lobby.players = everyone.map(({ id, name, color }) => ({ id, name, color, connected: true }));
    this.lobby.watchers = [];
    this.game = null;
    this.#changed();
  }

  /** Avança o relógio do jogo. Chamar a cada ~250 ms. */
  tick() {
    if (!this.game) return;
    const next = E.tick(this.game, this.now(), WRITING_GRACE_MS);
    if (next !== this.game) {
      this.game = next;
      this.#changed();
    }
  }

  // ------------------------------------------------------------ saída

  viewOf(id) {
    if (this.game) {
      const spectator = this.lobby.watchers.some((w) => w.id === id);
      return { ...viewFor(this.game, id), hostId: this.hostId, ...(spectator && { spectator: true }) };
    }
    return { phase: 'lobby', you: id, hostId: this.hostId, players: this.lobby.players, config: this.lobby.config };
  }

  broadcast() {
    const players = this.game ? this.game.players : this.lobby.players;
    for (const p of [...players, ...(this.game ? this.lobby.watchers : [])]) if (p.connected) this.send(p.id, { t: 'view', view: this.viewOf(p.id) });
  }

  snapshot() {
    const game = this.game && { ...this.game, content: undefined }; // sem o banco de temas (o receptor usa o dele)
    return JSON.parse(JSON.stringify({ lobby: this.lobby, game }));
  }

  /** Grava o snapshot no relay se houve mudança (chamar periodicamente). */
  flushSync() {
    if (!this.dirty) return;
    this.dirty = false;
    this.sync(this.snapshot());
  }

  #changed() {
    this.broadcast();
    this.dirty = true;
    this.flushSync(); // mudança visível: snapshot imediato
  }
}
