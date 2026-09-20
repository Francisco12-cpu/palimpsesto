// Áudio do Palimpsesto: efeitos + música ambiente, tudo sintetizado com Web Audio
// (nenhum arquivo de som: leve e offline). O navegador só libera áudio depois de um gesto
// do usuário; o contexto nasce no primeiro toque.
const KEY = 'palimpsesto.audio.v2';
const defaults = { muted: false, volume: 0.7, music: true, haptics: true };
let cfg = { ...defaults };
try { cfg = { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { /* ok */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ok */ } };

let ctx = null;
let master = null; // volume geral
let sfxBus = null;
let musicBus = null;

function ac() {
  if (cfg.muted) return null;
  if (!ctx) {
    const C = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
    master = ctx.createGain();
    master.gain.value = cfg.volume;
    const comp = ctx.createDynamicsCompressor(); // evita estalos quando várias notas somam
    master.connect(comp).connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.9;
    sfxBus.connect(master);
    musicBus = ctx.createGain();
    musicBus.gain.value = 0.32;
    musicBus.connect(master);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

/** Uma nota com envelope (ataque curto, queda exponencial). */
function tone({ f, at = 0, d = 0.25, type = 'sine', v = 0.25, to = null, bus = null, attack = 0.012 }) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + at;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + d);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g).connect(bus ?? sfxBus);
  o.start(t);
  o.stop(t + d + 0.05);
}

/** Ruído filtrado (folhear página, arranhar de pena, fôlego). */
function noise({ at = 0, d = 0.25, v = 0.15, freq = 1800, q = 1, bus = null }) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + at;
  const len = Math.max(1, Math.floor(c.sampleRate * d));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const filt = c.createBiquadFilter();
  filt.type = 'bandpass';
  filt.frequency.value = freq;
  filt.Q.value = q;
  const g = c.createGain();
  g.gain.value = v;
  src.connect(filt).connect(g).connect(bus ?? sfxBus);
  src.start(t);
}

const N = {
  C4: 261.63, E4: 329.63, G4: 392, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5, E6: 1318.5, G6: 1567.98,
};

let lastKey = 0;

export const sfx = {
  click: () => tone({ f: 620, d: 0.06, type: 'triangle', v: 0.12 }),
  pop: () => tone({ f: 440, to: 780, d: 0.11, type: 'sine', v: 0.2 }),
  join: () => { tone({ f: N.E5, d: 0.14, v: 0.16 }); tone({ f: N.A5, at: 0.09, d: 0.2, v: 0.16 }); },
  leave: () => { tone({ f: N.A5, d: 0.14, v: 0.12 }); tone({ f: N.E5, at: 0.09, d: 0.2, v: 0.12 }); },
  start: () => { [N.C5, N.E5, N.G5].forEach((f, i) => tone({ f, at: i * 0.08, d: 0.3, type: 'triangle', v: 0.2 })); },
  whoosh: () => { noise({ d: 0.45, v: 0.13, freq: 700, q: 0.7 }); tone({ f: 180, to: 520, d: 0.4, type: 'sine', v: 0.06 }); },
  page: () => noise({ d: 0.28, v: 0.14, freq: 2400 }),
  chime: () => { tone({ f: N.G5, d: 0.35, v: 0.16 }); tone({ f: N.C6, at: 0.1, d: 0.5, v: 0.14 }); },
  ready: () => tone({ f: N.E6, d: 0.09, type: 'sine', v: 0.07 }), // outro jogador ficou pronto
  tick: () => tone({ f: 900, d: 0.05, type: 'square', v: 0.07 }),
  urgent: () => tone({ f: 520, d: 0.09, type: 'square', v: 0.1 }),
  countdown: (final = false) => tone({ f: final ? 880 : 587, d: final ? 0.5 : 0.14, type: 'triangle', v: 0.2 }),
  gong: () => { tone({ f: 130, d: 1.1, type: 'sine', v: 0.3 }); tone({ f: 196, d: 0.9, type: 'sine', v: 0.14 }); noise({ d: 0.15, v: 0.06, freq: 900 }); },
  sparkle: () => { for (let i = 0; i < 5; i++) tone({ f: N.G5 * (1 + Math.random() * 0.9), at: i * 0.05, d: 0.25, type: 'sine', v: 0.07 }); },
  success: () => { [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => tone({ f, at: i * 0.09, d: 0.35, type: 'triangle', v: 0.2 })); sfx.sparkle(); },
  fail: () => { tone({ f: 220, to: 130, d: 0.4, type: 'sawtooth', v: 0.12 }); },
  error: () => { tone({ f: 160, d: 0.18, type: 'square', v: 0.1 }); },
  coin: () => tone({ f: N.E6, d: 0.06, type: 'square', v: 0.04 }),
  fanfare: () => {
    [[N.C5, 0], [N.E5, 0.14], [N.G5, 0.28], [N.C6, 0.42], [N.G5, 0.62], [N.C6, 0.76], [N.E6, 0.92]]
      .forEach(([f, at]) => tone({ f, at, d: 0.5, type: 'triangle', v: 0.22 }));
    tone({ f: N.C4, at: 0.42, d: 1.1, type: 'sine', v: 0.2 });
  },
  /** Arranhar de pena: chamado a cada tecla (limitado pra não virar ruído contínuo). */
  key: () => {
    const now = performance.now();
    if (now - lastKey < 55) return;
    lastKey = now;
    noise({ d: 0.05, v: 0.05, freq: 3200 + Math.random() * 1600, q: 2 });
  },
};

// ------------------------------------------------------------------ música ambiente
// Pad lento + sinos esparsos numa escala pentatônica menor, com eco. Gerada por código.
const SCALE = [220, 261.63, 293.66, 329.63, 392, 440, 523.25, 587.33]; // A menor pentatônica + extras
const CHORDS = [[110, 165, 220], [98, 147, 196], [87.31, 130.81, 174.61], [98, 147, 196]]; // Am · G · F · G (graves)
let musicTimer = null;
let bar = 0;
let delayNode = null;

function ensureDelay(c) {
  if (delayNode) return delayNode;
  const d = c.createDelay(1.5);
  d.delayTime.value = 0.42;
  const fb = c.createGain();
  fb.gain.value = 0.38;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1800;
  d.connect(lp).connect(fb).connect(d);
  lp.connect(musicBus);
  delayNode = d;
  return d;
}

function pad(f, at, dur) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + at;
  const g = c.createGain();
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 700;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.5, t + dur * 0.35);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(lp).connect(musicBus);
  for (const detune of [-6, 5]) {
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    o.detune.value = detune;
    o.connect(g);
    o.start(t);
    o.stop(t + dur + 0.1);
  }
}

function bell(f, at) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + at;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'sine';
  o.frequency.value = f * 2;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
  o.connect(g);
  g.connect(musicBus);
  g.connect(ensureDelay(c));
  o.start(t);
  o.stop(t + 2.3);
}

function playBar() {
  if (cfg.muted || !cfg.music || !ac()) return;
  const chord = CHORDS[bar % CHORDS.length];
  chord.forEach((f) => pad(f, 0, 5.2));
  const n = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) bell(SCALE[Math.floor(Math.random() * SCALE.length)], 0.6 + i * (1 + Math.random()) );
  bar += 1;
}

export const music = {
  start() {
    if (musicTimer || cfg.muted || !cfg.music || !ac()) return;
    playBar();
    musicTimer = setInterval(playBar, 4800);
  },
  stop() {
    clearInterval(musicTimer);
    musicTimer = null;
  },
};

// ------------------------------------------------------------------ configurações
export const audioSettings = () => ({ ...cfg });
export const isMuted = () => cfg.muted;

export function setAudio(patch) {
  cfg = { ...cfg, ...patch };
  save();
  if (master) master.gain.value = cfg.muted ? 0 : cfg.volume;
  if (cfg.muted || !cfg.music) music.stop();
  else if (ctx) music.start();
}

export function setMuted(m) {
  setAudio({ muted: !!m });
  if (!m) { ac(); sfx.pop(); if (cfg.music) music.start(); }
}

/** Vibração curta no celular (acerto, sua vez, fim do tempo). */
export function haptic(pattern = 25) {
  if (!cfg.haptics || cfg.muted) return;
  try { navigator.vibrate?.(pattern); } catch { /* sem suporte */ }
}

// desbloqueia o áudio no primeiro gesto e inicia a música
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', () => { if (ac() && cfg.music) music.start(); }, { once: true, capture: true });
}
