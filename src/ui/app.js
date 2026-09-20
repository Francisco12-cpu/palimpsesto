// Menu principal, "Como jogar", créditos, configurações de áudio e roteamento entre modos.
import { BRAND, runes } from '../brand.js';
import { VANGUARD_INFO } from '../data/content.js';
import { startSolo } from './solo-mode.js';
import { startNet, session } from './net-mode.js';
import { esc } from './game-views.js';
import { icon, logo, seal } from './icons.js';
import { dust, watermark, installRipple } from './fx.js';
import { audioSettings, setAudio, setMuted, sfx, music, TRACKS } from './sound.js';

const app = document.getElementById('app');
const NAME_KEY = 'palimpsesto.name';
const COLOR_KEY = 'palimpsesto.color';
const SEEN_KEY = 'palimpsesto.seenHowto';
const COLORS = [12, 42, 95, 160, 200, 250, 290, 330];

const store = {
  get: (k, d = '') => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ok */ } },
};
const loadColor = () => {
  const c = Number(store.get(COLOR_KEY, ''));
  return COLORS.includes(c) ? c : COLORS[Math.floor(Math.random() * COLORS.length)];
};
let myColor = loadColor();
store.set(COLOR_KEY, myColor);

// convite por link/QR: ?sala=ABCD
let inviteCode = new URLSearchParams(location.search).get('sala')?.toUpperCase().slice(0, 6) || '';
if (inviteCode) history.replaceState(null, '', location.pathname);

const backBtn = `<p><button id="back" class="ghost">${icon('back', 16)} Menu</button></p>`;

function menu() {
  document.getElementById('banner').textContent = '';
  const saved = session.load();
  const firstTime = store.get(SEEN_KEY) !== '1';
  const name = store.get(NAME_KEY);
  app.innerHTML = `<div class="screen">
    <div class="hero">
      ${logo(150)}
      <h1>${BRAND.name}</h1>
      <div class="tagline">${BRAND.tagline}</div>
      <p class="slogan">${BRAND.slogan}</p>
      <div class="runes" aria-hidden="true">${runes(BRAND.author)}</div>
    </div>
    <div class="divisor">✦</div>
    ${inviteCode ? `<div class="panel gold" style="text-align:center"><h3>Convite recebido</h3>
      <p>Você foi chamado para a sala <b class="room-code" style="font-size:1.6rem;letter-spacing:8px">${esc(inviteCode)}</b></p>
      <button id="acceptInvite" class="primary">${icon('door', 16)} Entrar agora</button>
      <button id="dropInvite" class="ghost">Ignorar</button></div>` : ''}
    ${saved && !inviteCode ? `<div class="panel gold" style="text-align:center"><h3>Você estava numa sala</h3>
      <p>Sala <b>${esc(saved.room)}</b> — dá para voltar de onde parou.</p>
      <button id="resume" class="primary">${icon('door', 16)} Voltar para a sala</button>
      <button id="dropSession" class="ghost">Descartar</button></div>` : ''}
    <div class="panel">
      <label>Seu nome <input id="name" maxlength="20" value="${esc(name)}" placeholder="Como te chamam?" style="width:100%" autocomplete="nickname" autocapitalize="words"></label>
      <div class="lbl dim" style="margin-top:8px">Sua cor</div>
      <div class="swatches" id="swatches">${COLORS.map((h) => `<button class="swatch" data-h="${h}" style="--h:${h}" aria-label="Cor ${h}" aria-pressed="${h === myColor}"></button>`).join('')}</div>
      <p id="err" class="err"></p>
      <div class="menu-buttons">
        <button class="big primary" data-go="create">${icon('plus')} Criar sala</button>
        <button class="big" data-go="join">${icon('door')} Entrar em sala</button>
        <button class="big" data-go="solo">${icon('bot')} Modo solo (bots)</button>
        <button class="big ${firstTime ? 'primary' : ''}" data-go="howto">${icon('book')} Como jogar${firstTime ? ' — comece aqui' : ''}</button>
        <button class="big" data-go="about">${icon('scroll')} Sobre as vanguardas</button>
      </div>
    </div>
    <div class="foot"><a href="#" id="creditsName" class="credit-link">${BRAND.author}</a> · <a href="#" id="credits" class="credit-link">${BRAND.instagram}</a></div>
  </div>`;

  const nameValue = () => document.getElementById('name').value.trim();
  const needName = () => {
    const n = nameValue();
    if (!n) { document.getElementById('err').textContent = 'Digite seu nome primeiro.'; sfx.error(); document.getElementById('name').focus(); return null; }
    store.set(NAME_KEY, n);
    return n;
  };

  for (const el of [document.getElementById('credits'), document.getElementById('creditsName')]) {
    el.onclick = (e) => { e.preventDefault(); credits(); };
  }
  document.getElementById('swatches').onclick = (e) => {
    const b = e.target.closest('[data-h]');
    if (!b) return;
    myColor = Number(b.dataset.h);
    store.set(COLOR_KEY, myColor);
    app.querySelectorAll('.swatch').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  };
  document.getElementById('resume')?.addEventListener('click', () => {
    const n = nameValue() || saved.name;
    startNet(app, { playerName: n, color: myColor, mode: 'join', code: saved.room, auto: true, server: saved.server, transport: saved.transport ?? 'auto', onExit: menu });
  });
  document.getElementById('dropSession')?.addEventListener('click', () => { session.clear(); menu(); });
  document.getElementById('acceptInvite')?.addEventListener('click', () => {
    const n = needName();
    if (!n) return;
    const code = inviteCode;
    inviteCode = '';
    startNet(app, { playerName: n, color: myColor, mode: 'join', code, auto: true, onExit: menu });
  });
  document.getElementById('dropInvite')?.addEventListener('click', () => { inviteCode = ''; menu(); });

  app.querySelectorAll('[data-go]').forEach((b) => {
    b.onclick = () => {
      const go = b.dataset.go;
      if (go === 'about') return about();
      if (go === 'howto') return howto();
      const n = needName();
      if (!n) return;
      if (go === 'solo') startSolo(app, { playerName: n, color: myColor, onExit: menu });
      else startNet(app, { playerName: n, color: myColor, mode: go, onExit: menu });
    };
  });
}

function howto() {
  store.set(SEEN_KEY, '1');
  const steps = [
    ['pen', 'Receba sua vanguarda', 'Cada jogador recebe, em segredo, uma vanguarda literária, um tema e às vezes um modificador (a intenção do texto) e palavras-chave.'],
    ['scroll', 'Escreva no estilo', 'Todos escrevem ao mesmo tempo, com o mesmo relógio. Não diga o nome da vanguarda! Terminou antes? Aperte <b>Pronto</b>: se todos apertarem, o jogo segue na hora.'],
    ['eye', 'Leia os textos', 'Os textos aparecem um por vez. Descubra o estilo de cada um.'],
    ['target', 'Dê o seu palpite', 'Escolha qual vanguarda foi usada (o autocomplete ajuda a acertar o nome). O resultado só aparece no fim da rodada.'],
    ['flag', 'Denuncie o que fugiu do tema', 'Um texto sem relação com o tema pode ser denunciado. Se chegar ao quórum, o autor perde pontos.'],
    ['star', 'Pontue', '+1 para quem acerta a vanguarda e +1 para o autor por cada pessoa que acertou. Denúncia válida tira pontos do autor.'],
    ['trophy', 'Títulos e antologia', 'No fim há um pódio, títulos especiais (Sniper, Mestre do Blefe…) e a antologia de todos os textos, que dá para copiar ou baixar.'],
  ];
  app.innerHTML = `<div class="screen">${backBtn}
    <h1>Como jogar</h1>
    <p class="slogan">${BRAND.slogan}</p>
    <div class="steps">${steps.map(([ic, t, d], i) => `<div class="panel step-card"><span class="n">${i + 1}</span>
      <div><b>${icon(ic, 18)} ${t}</b><div>${d}</div></div></div>`).join('')}</div>
    <div class="callout"><b>Online (mais fácil):</b> abra o jogo pelo endereço na internet, crie a sala e mostre o QR code. Os amigos escaneiam e entram — não precisa instalar nada.</div>
    <div class="callout"><b>Em rede local (sem internet):</b> uma pessoa abre o <b>iniciar.bat</b> no computador, cria a sala e mostra o QR code. Os amigos, no mesmo Wi-Fi, escaneiam com o celular.</div>
    <div class="callout"><b>Dica:</b> na tela de escrita há um “Lembrete do estilo” com as características da sua vanguarda.</div>
    <p><button id="ok" class="primary">${icon('check', 16)} Entendi</button></p></div>`;
  document.getElementById('back').onclick = menu;
  document.getElementById('ok').onclick = menu;
}

function about() {
  const groups = ['Pré-modernos', 'Vanguardas europeias', 'Brasileiras'];
  app.innerHTML = `<div class="screen">${backBtn}
    <h1>Sobre as vanguardas</h1>
    <p class="dim">Um guia rápido do estilo de cada movimento — use para escrever e para adivinhar.</p>
    ${groups.map((g) => `<h2>${g}</h2>
      ${VANGUARD_INFO.filter((v) => v.group === g).map((v) => `<div class="panel van-card">${seal(v.name, 56)}
        <div><b>${esc(v.name)}</b><div>${esc(v.about)}</div></div></div>`).join('')}`).join('')}</div>`;
  document.getElementById('back').onclick = menu;
}

function credits() {
  app.innerHTML = `<div class="screen">${backBtn}
    <div class="hero">${logo(110)}<h1>Créditos</h1></div>
    <div class="divisor">✦</div>
    <div class="panel gold" style="text-align:center">
      <div class="runes" style="font-size:1.6rem;margin:0 0 6px">${runes(BRAND.author)}</div>
      <h2 style="margin:0">${BRAND.author}</h2>
      <p class="dim">Criação, design e direção do jogo</p>
      <p><a href="${BRAND.instagramUrl}" target="_blank" rel="noopener">${icon('link', 16)} ${BRAND.instagram}</a></p>
    </div>
    <div class="panel">
      <p><b>${BRAND.name}</b> — do grego <em>palímpsestos</em>, “raspado de novo”: o manuscrito cujo texto foi apagado
      e reescrito por cima, guardando ainda os rastros do que havia antes. É o que fazemos aqui:
      escrever sobre o estilo de outra época e deixar as marcas que os amigos vão tentar ler.</p>
      <p>O anel do logotipo diz, em runas: <span class="runes" style="letter-spacing:3px">${runes(BRAND.phrase)}</span><br><em>${BRAND.phrase}</em> — as runas são só uma transliteração dos sons do português.</p>
      <p class="dim">As explicações das vanguardas descrevem apenas o estilo; nenhum texto protegido é reproduzido.
      Fontes Cinzel, IM Fell English e Noto Sans Runic (licença OFL). QR code: qrcode-generator (MIT).</p>
    </div></div>`;
  document.getElementById('back').onclick = menu;
}

// ------------------------------------------------------------------ tamanho do texto
const FONTS = [
  { id: 'jogo', label: 'Do jogo (clássica)' },
  { id: 'legivel', label: 'Mais legível' },
  { id: 'dislexia', label: 'Para dislexia' },
];
const FONT_KEY = 'palimpsesto.font';
let fontId = FONTS.some((f) => f.id === store.get(FONT_KEY)) ? store.get(FONT_KEY) : 'jogo';
const applyFont = () => {
  if (fontId === 'jogo') document.documentElement.removeAttribute('data-font');
  else document.documentElement.setAttribute('data-font', fontId);
};
applyFont();

const SCALES = [0.9, 1, 1.15, 1.3];
const SCALE_KEY = 'palimpsesto.scale';
let scale = Number(store.get(SCALE_KEY, '1'));
if (!SCALES.includes(scale)) scale = 1;
const applyScale = () => document.documentElement.style.setProperty('--scale', String(scale));
applyScale();

// ------------------------------------------------------------------ áudio e leitura (botão + painel)
function settingsPanel() {
  const btn = document.createElement('button');
  btn.className = 'settings-btn';
  btn.setAttribute('aria-label', 'Som e vibração');
  btn.setAttribute('aria-expanded', 'false');
  const panel = document.createElement('div');
  panel.className = 'panel settings';
  panel.hidden = true;
  const paint = () => {
    const a = audioSettings();
    btn.innerHTML = icon(a.muted ? 'mute' : 'sound', 20);
    panel.innerHTML = `<h3>Som, vibração e leitura</h3>
      <label class="inline"><input type="checkbox" id="sMute" ${a.muted ? '' : 'checked'}> Som ligado</label>
      <label>Volume <input type="range" id="sVol" min="0" max="100" value="${Math.round(a.volume * 100)}"></label>
      <label class="inline"><input type="checkbox" id="sMusic" ${a.music ? 'checked' : ''}> Música ambiente</label>
      <label>Faixa <select id="sTrack" ${a.music ? '' : 'disabled'}>${TRACKS.map((tr) => `<option value="${tr.id}" ${a.track === tr.id ? 'selected' : ''}>${tr.label}</option>`).join('')}</select></label>
      <label>Fonte <select id="sFont">${FONTS.map((f) => `<option value="${f.id}" ${fontId === f.id ? 'selected' : ''}>${f.label}</option>`).join('')}</select></label>
      <label class="inline"><input type="checkbox" id="sHap" ${a.haptics ? 'checked' : ''}> Vibração (celular)</label>
      <div class="row" style="margin-top:6px"><span>Tamanho do texto</span>
        <button id="sMinus" aria-label="Diminuir o texto" ${scale === SCALES[0] ? 'disabled' : ''}>A−</button>
        <button id="sPlus" aria-label="Aumentar o texto" ${scale === SCALES[SCALES.length - 1] ? 'disabled' : ''}>A+</button></div>`;
    const step = (d) => { scale = SCALES[Math.min(SCALES.length - 1, Math.max(0, SCALES.indexOf(scale) + d))]; store.set(SCALE_KEY, String(scale)); applyScale(); paint(); };
    panel.querySelector('#sMinus').onclick = () => step(-1);
    panel.querySelector('#sPlus').onclick = () => step(1);
    panel.querySelector('#sMute').onchange = (e) => { setMuted(!e.target.checked); paint(); };
    panel.querySelector('#sVol').oninput = (e) => setAudio({ volume: Number(e.target.value) / 100 });
    panel.querySelector('#sVol').onchange = () => sfx.pop();
    panel.querySelector('#sMusic').onchange = (e) => { setAudio({ music: e.target.checked }); if (e.target.checked) music.start(); paint(); };
    panel.querySelector('#sTrack').onchange = (e) => { setAudio({ track: e.target.value }); music.restart(); };
    panel.querySelector('#sFont').onchange = (e) => { fontId = e.target.value; store.set(FONT_KEY, fontId); applyFont(); };
    panel.querySelector('#sHap').onchange = (e) => setAudio({ haptics: e.target.checked });
  };
  btn.onclick = (e) => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
    btn.setAttribute('aria-expanded', String(!panel.hidden));
    paint();
  };
  document.addEventListener('click', (e) => {
    if (!panel.hidden && !panel.contains(e.target) && e.target !== btn) { panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
  });
  document.body.append(btn, panel);
  paint();
}

// clique suave em todo botão (feedback sonoro)
document.addEventListener('click', (e) => {
  if (e.target.closest('button:not(.settings-btn):not(:disabled)')) sfx.click();
}, true);

dust(document.getElementById('poeira'));
watermark(document.body);
installRipple();
settingsPanel();
menu();

// PWA: abre offline depois da 1ª carga (só em https ou localhost)
if ('serviceWorker' in navigator && globalThis.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* sem service worker: segue normal */ });
}
