// Modo rede: criar sala / entrar em sala. Dois transportes com a MESMA interface:
//  - 'lan'    servidor local (iniciar.bat): WebSocket, funciona sem internet
//  - 'online' sem servidor (GitHub Pages): ponte MQTT pública criptografada (precisa de internet)
import { GameClient } from '../net/client.js';
import { OnlineSession } from '../net/online.js';
import { CONTENT } from '../data/content.js';
import { BRAND } from '../brand.js';
import { mountRoomConfig, loadSavedConfig } from './room-config.js';
import { createGameView, esc, copyText } from './game-views.js';
import { icon } from './icons.js';
import { avatar } from './fx.js';
import { qrSvg } from './qr.js';
import { sfx } from './sound.js';

const SESSION_KEY = 'palimpsesto.session';

export const session = {
  load() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; } },
  save(s) { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch { /* ok */ } },
  clear() { try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ok */ } },
};

function playerId() {
  // sessionStorage: cada aba é um jogador (dá pra testar com 2 abas). Sobrevive a F5.
  try {
    let id = sessionStorage.getItem('palimpsesto.pid');
    if (!id) { id = `p${Math.random().toString(36).slice(2, 10)}`; sessionStorage.setItem('palimpsesto.pid', id); }
    return id;
  } catch {
    return `p${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** Segredo do jogador nesta aba: o id é público nas visões, o token não (impede tomarem seu lugar). */
function playerToken() {
  try {
    let t = sessionStorage.getItem('palimpsesto.token');
    if (!t) { t = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''); sessionStorage.setItem('palimpsesto.token', t); }
    return t;
  } catch {
    return '';
  }
}

const defaultServer = () => (location.protocol === 'http:' || location.protocol === 'https:' ? location.host : 'localhost:8080');
const isLocalhost = () => ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

/** Brokers MQTT próprios (avançado/testes): localStorage 'palimpsesto.brokers' = ["wss://…"]. Sem isso, usa os públicos. */
function customBrokers() {
  try {
    const list = JSON.parse(localStorage.getItem('palimpsesto.brokers') || 'null');
    return Array.isArray(list) && list.length ? { brokers: list.map(String) } : {};
  } catch {
    return {};
  }
}

/** Existe o servidor local (serve.mjs) servindo esta página? Se não (ex.: GitHub Pages), o modo é 'online'. */
let infoPromise = null;
function serverInfo() {
  infoPromise ??= (async () => {
    if (location.protocol === 'https:') return null; // o servidor local é sempre http: em https (ex.: GitHub Pages) só existe o modo online
    try {
      const r = await fetch('api/info', { cache: 'no-store' }); // relativo: funciona também em /palimpsesto/
      if (!r.ok) return null;
      const j = await r.json();
      return typeof j.port === 'number' ? j : null;
    } catch {
      return null;
    }
  })();
  return infoPromise;
}
export const detectTransport = async () => ((await serverInfo()) ? 'lan' : 'online');

/** Endereço que os amigos devem abrir (o IP da rede, não "localhost"). */
async function joinBase() {
  if (!isLocalhost()) return location.origin;
  return (await serverInfo())?.urls?.[0] ?? location.origin;
}

/**
 * @param {object} o
 * @param {'create'|'join'} o.mode
 * @param {string} [o.code]   código já conhecido (link/QR ou retomada)
 * @param {boolean} [o.auto]  conectar direto, sem tela de formulário
 * @param {string} [o.server] host:porta do servidor (modo lan)
 * @param {'auto'|'lan'|'online'} [o.transport] como conectar; 'auto' detecta se há servidor local
 */
export function startNet(app, { playerName, color, mode, code = '', auto = false, server, transport: wanted = 'auto', onExit }) {
  const id = playerId();
  let client = null;
  let view = null;
  let ticker = null;
  let roomUi = null; // { hostId } do lobby montado
  let lastView = null;
  let gameCtx = null;
  let knownPlayers = null;
  let serverAddr = server || defaultServer();
  let useOnline = false; // definido em connect()

  const setBanner = (text) => {
    const el = document.getElementById('banner');
    if (el) el.textContent = text;
  };

  function teardown() {
    view?.destroy();
    view = null;
    client?.leave();
    client = null;
    clearInterval(ticker);
  }

  function exit(message = '') {
    session.clear();
    teardown();
    onExit();
    if (message) setBanner(message);
  }

  // ------------------------------------------------------------ conexão

  function connectScreen(prefillError = '') {
    app.innerHTML = `<div class="screen">
      <p><button id="back" class="ghost">${icon('back', 16)} Menu</button></p>
      <h1>${mode === 'create' ? 'Criar sala' : 'Entrar em sala'}</h1>
      ${location.protocol === 'file:' ? '<p class="err">Abra pelo servidor (iniciar.bat) para jogar em rede.</p>' : ''}
      <form id="f" class="panel">
        ${mode === 'join' ? `<label>Código da sala <input name="code" maxlength="6" size="6" class="room-code" value="${esc(code)}" style="text-transform:uppercase;width:7.4em;font-size:1.8rem;padding:6px 8px" autofocus autocomplete="off" autocapitalize="characters" spellcheck="false"></label>` : ''}
        <p class="dim" id="howconn">Detectando a melhor forma de conectar…</p>
        <details><summary>Opções de conexão</summary>
          <label>Modo <select name="transport">
            <option value="auto" ${wanted === 'auto' ? 'selected' : ''}>Automático</option>
            <option value="lan" ${wanted === 'lan' ? 'selected' : ''}>Rede local (servidor do iniciar.bat)</option>
            <option value="online" ${wanted === 'online' ? 'selected' : ''}>Online (sem servidor — precisa de internet)</option>
          </select></label>
          <div id="serverBox"><label>Servidor local (host:porta) <input name="server" value="${esc(serverAddr)}" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
          <p class="dim">Só mude se o servidor estiver em outro computador.</p></div>
        </details>
        <p><button class="primary">${icon(mode === 'create' ? 'plus' : 'door', 16)} ${mode === 'create' ? 'Criar sala' : 'Entrar'}</button></p>
        <p id="err" class="err">${esc(prefillError)}</p>
      </form></div>`;
    document.getElementById('back').onclick = () => exit();
    detectTransport().then((tr) => {
      const how = document.getElementById('howconn');
      if (!how) return;
      how.textContent = tr === 'lan'
        ? 'Servidor local encontrado: jogo em rede local (funciona sem internet).'
        : 'Jogo online: os jogadores se conectam pela internet, sem precisar de servidor.';
      if (tr === 'online') document.getElementById('serverBox').hidden = true;
    });
    document.getElementById('f').onsubmit = (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      serverAddr = String(f.get('server'));
      connect(String(f.get('code') || ''), String(f.get('transport') || wanted));
    };
  }

  async function connect(joinCode, choice = wanted) {
    app.innerHTML = '<div class="screen connecting"><div class="spinner" role="status" aria-label="Conectando"></div><p class="dim">Conectando…</p></div>';
    const tr = choice === 'auto' ? await detectTransport() : choice;
    useOnline = tr === 'online';
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const common = {
      id, name: playerName, color, token: playerToken(), content: CONTENT,
      onStatus: (s, info) => {
        if (s === 'connecting') setBanner('Conectando…');
        else if (s === 'reconnecting') setBanner('Conexão perdida — tentando reconectar…');
        else if (s === 'host' && info?.migrated) { setBanner('O host caiu: você assumiu como host e o jogo continua.'); sfx.gong(); }
        else setBanner('');
        if ((s === 'connected' || s === 'host') && info?.room) session.save({ room: info.room, server: serverAddr, name: playerName, transport: tr });
      },
      onError: (msg, fatal) => {
        if (fatal && !lastView) {
          // não conseguiu entrar (sala inexistente, partida em andamento…)
          session.clear();
          teardown();
          if (auto) { onExit(); setBanner(msg); } else { connectScreen(msg); }
          sfx.error();
        } else { setBanner(msg); sfx.error(); }
      },
      onKicked: () => exit('Você foi removido da sala pelo host.'),
      onView,
    };
    client = useOnline ? new OnlineSession({ ...common, ...customBrokers() }) : new GameClient({ ...common, url: `${proto}://${serverAddr}/ws` });
    if (mode === 'create') client.create();
    else client.join(joinCode);
    ticker = setInterval(() => view?.tick(), 200);
    app.innerHTML = '<div class="screen connecting"><div class="spinner" role="status" aria-label="Conectando"></div><p class="dim">Conectando…</p></div>';
  }

  // ------------------------------------------------------------ visões

  function onView(v) {
    lastView = v;
    if (v.phase === 'lobby') {
      view?.destroy();
      view = null;
      renderRoom(v);
    } else {
      roomUi = null;
      knownPlayers = null;
      if (!view) {
        gameCtx = {
          me: id,
          now: client.serverNow, // tempo do relay: todos veem o mesmo relógio
          actions: {
            draft: throttledDraft(),
            guess: (vg) => client.act({ a: 'guess', vanguard: vg }),
            done: () => client.act({ a: 'done' }),
            report: (author) => client.act({ a: 'report', author }),
          },
          onAgain: null,
          onExit: () => exit(),
        };
        view = createGameView(app, gameCtx);
      }
      // "jogar de novo" só para o host (os outros veem "aguardando o host")
      gameCtx.onAgain = v.hostId === id ? () => client.act({ a: 'rematch' }) : null;
      view.render(v);
    }
  }

  function throttledDraft() {
    let timer = null;
    let pending = null;
    let last = 0;
    const flush = () => {
      timer = null;
      if (pending == null) return;
      client.act({ a: 'draft', text: pending });
      pending = null;
      last = Date.now();
    };
    return (text) => {
      pending = text;
      const wait = Math.max(0, 200 - (Date.now() - last)); // no máx. 5 envios/s, sempre com o texto mais novo
      if (wait === 0) flush();
      else if (!timer) timer = setTimeout(flush, wait);
    };
  }

  // ------------------------------------------------------------ sala de espera

  async function fillInvite() {
    const box = document.getElementById('invite');
    if (!box || !client?.room) return;
    // online: o convite abre ESTA mesma página (ex.: GitHub Pages); LAN: o IP do computador que hospeda
    const link = useOnline ? `${location.origin}${location.pathname}?sala=${client.room}` : `${await joinBase()}/?sala=${client.room}`;
    if (!document.getElementById('invite')) return; // saiu da tela enquanto buscava
    box.innerHTML = `<div class="qr">${qrSvg(link)}</div>
      <div class="linkbox" id="linktxt">${esc(link)}</div>
      <div class="toolbar" style="justify-content:center;margin-top:10px">
        <button id="copylink">${icon('link', 16)} Copiar link</button>
        ${navigator.share ? `<button id="sharelink">${icon('send', 16)} Compartilhar</button>` : ''}</div>`;
    const copy = document.getElementById('copylink');
    copy.onclick = async () => {
      const old = copy.innerHTML;
      copy.textContent = (await copyText(link)) ? 'Copiado!' : 'Copie manualmente';
      setTimeout(() => { copy.innerHTML = old; }, 1600);
    };
    const share = document.getElementById('sharelink');
    if (share) share.onclick = () => navigator.share({ title: BRAND.name, text: `Entre na minha sala do ${BRAND.name}: ${client.room}`, url: link }).catch(() => {});
  }

  function renderRoom(v) {
    const amHost = v.hostId === id;
    if (!roomUi || roomUi.hostId !== v.hostId) {
      app.innerHTML = `<div class="screen">
        <div class="topbar"><button id="leave" class="ghost">${icon('back', 16)} Sair da sala</button></div>
        <div class="panel gold" style="text-align:center">
          <div class="dim" style="font:600 .7rem var(--f-title);letter-spacing:4px;text-transform:uppercase">Código da sala</div>
          <div class="room-code">${esc(client.room ?? '')}</div>
          <p class="dim">${useOnline ? 'Amigos escaneiam o QR code ou abrem o link (todos precisam de internet):' : 'Amigos na mesma rede escaneiam o QR code ou abrem o link:'}</p>
          <div id="invite"><p class="dim">Gerando convite…</p></div>
        </div>
        <div class="panel"><h3>${icon('users', 18)} Jogadores</h3><div class="plist" id="plist"></div></div>
        ${amHost
          ? `<form id="cfg" class="panel"><h3>Configuração da sala</h3><div id="room"></div>
              <p style="margin-top:14px"><button id="start" class="primary big" style="width:auto">${icon('play', 18)} Começar partida</button></p><p id="err" class="err"></p></form>`
          : '<div class="panel" id="cfgview"></div>'}</div>`;
      document.getElementById('leave').onclick = () => exit();
      roomUi = { hostId: v.hostId };
      fillInvite();
      document.getElementById('plist').onclick = (e) => {
        const b = e.target.closest('[data-kick]');
        if (b) client.act({ a: 'kick', id: b.dataset.kick });
      };
      if (amHost) {
        const room = mountRoomConfig(document.getElementById('room'), loadSavedConfig());
        document.getElementById('cfg').onsubmit = (ev) => {
          ev.preventDefault();
          const err = document.getElementById('err');
          const invalid = room.validate(lastView?.players?.filter((p) => p.connected).length ?? 2);
          if (invalid) { err.textContent = invalid; sfx.error(); return; }
          err.textContent = '';
          room.save();
          client.act({ a: 'config', config: room.read() });
          client.act({ a: 'start' });
        };
      }
    }
    if (knownPlayers !== null) {
      if (v.players.length > knownPlayers) sfx.join();
      else if (v.players.length < knownPlayers) sfx.leave();
    }
    knownPlayers = v.players.length;
    document.getElementById('plist').innerHTML = v.players.map((p, i) =>
      `<div class="pl ${p.connected ? '' : 'off'}" style="animation-delay:${i * 0.05}s">${avatar(p.name, 38, p.color)}
        <span class="name">${esc(p.name)}${p.id === id ? ' <span class="dim">(você)</span>' : ''}${p.connected ? '' : ' <span class="dim">(desconectado)</span>'}</span>
        ${p.id === v.hostId ? `<span class="tag host">${icon('crown', 12)} host</span>` : ''}
        ${amHost && p.id !== id ? `<button class="kick ghost" data-kick="${esc(p.id)}" aria-label="Remover ${esc(p.name)}">${icon('x', 14)} remover</button>` : ''}</div>`).join('') +
      `<p class="dim" style="margin:6px 0 0">${v.players.length} jogador(es) — mínimo 2 para começar.</p>`;
    const cv = document.getElementById('cfgview');
    if (cv) {
      const c = v.config;
      cv.innerHTML = `<h3>Configuração da sala</h3><p class="dim">O host escolhe as regras. Aguardando ele iniciar a partida…</p>
        <p>${esc((c.vanguards ?? []).length || 'Todas as')} vanguardas · ${esc(Number(c.roundsPerPlayer))} rodada(s) · mín. ${esc(Number(c.minChars))} caracteres · ${esc(Number(c.guessesPerPlayer))} palpite(s) por texto</p>`;
    }
  }

  if (auto) connect(code);
  else connectScreen();
}
