// Efeitos visuais leves (nada pesado): poeira dourada, confete, contagem de pontos.
const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Partículas de poeira flutuando ao fundo (mesma ideia do menu de exemplo). */
export function dust(container, count = 22) {
  if (reducedMotion()) return;
  for (let i = 0; i < count; i++) {
    const s = document.createElement('span');
    s.style.left = `${Math.random() * 100}%`;
    s.style.top = `${Math.random() * 100}%`;
    s.style.animationDelay = `${Math.random() * 10}s`;
    s.style.animationDuration = `${7 + Math.random() * 6}s`;
    container.appendChild(s);
  }
}

/** Chuva de faíscas douradas (fim de jogo / grande acerto). */
export function confetti(n = 48) {
  if (reducedMotion()) return;
  const layer = document.createElement('div');
  layer.className = 'confetti';
  const colors = ['#f3d97a', '#d4af37', '#e8d5b5', '#b3261e', '#8b6914'];
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    p.style.left = `${Math.random() * 100}%`;
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = `${Math.random() * 0.8}s`;
    p.style.animationDuration = `${1.8 + Math.random() * 1.6}s`;
    p.style.setProperty('--dx', `${(Math.random() - 0.5) * 160}px`);
    p.style.transform = `rotate(${Math.random() * 360}deg)`;
    layer.appendChild(p);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 4200);
}

/** Anima um número de `from` até `to`. */
export function countUp(el, from, to, ms = 900) {
  if (reducedMotion() || from === to) { el.textContent = to; return; }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    el.textContent = Math.round(from + (to - from) * (1 - (1 - k) ** 3));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Cor estável por nome (avatar). */
function hue(str) {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
export const avatar = (name, size = 34, color) =>
  `<span class="avatar" style="--h:${Number.isFinite(color) ? color : hue(name)};--s:${size}px">${[...name.trim()][0]?.toUpperCase() ?? '?'}</span>`;

// ------------------------------------------------------------------ efeitos extras

/** Título grande que aparece e some no centro da tela (início de fase). */
export function splash(title, sub = '') {
  if (reducedMotion()) return;
  document.querySelector('.splash')?.remove();
  const el = document.createElement('div');
  el.className = 'splash';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<div class="splash-in"><div class="splash-sub">${sub}</div><div class="splash-title">${title}</div><div class="splash-line"></div></div>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

/** Número grande 3-2-1 nos últimos segundos. */
export function bigCount(n) {
  if (reducedMotion()) return;
  document.querySelector('.bigcount')?.remove();
  const el = document.createElement('div');
  el.className = 'bigcount';
  el.setAttribute('aria-hidden', 'true');
  el.textContent = n;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 900);
}

/** Vinheta vermelha pulsando quando o tempo está acabando. */
export function urgency(on) {
  document.body.classList.toggle('urgent', !!on);
}

/** Balança um elemento (erro de digitação, ação inválida). */
export function shake(el) {
  if (!el || reducedMotion()) return;
  el.classList.remove('shake');
  void el.offsetWidth; // reinicia a animação
  el.classList.add('shake');
}

/** Ondulação dourada no ponto do toque em botões. */
export function installRipple() {
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest?.('button:not(:disabled)');
    if (!b || reducedMotion()) return;
    const r = b.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * 1.6;
    const s = document.createElement('span');
    s.className = 'ripple';
    s.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
    b.appendChild(s);
    setTimeout(() => s.remove(), 650);
  }, { passive: true });
}

/** Mantém a tela do celular acesa durante a partida. */
let wakeLock = null;
export async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { /* sem suporte ou negado: segue normal */ }
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && document.body.classList.contains('playing')) keepAwake(true);
  });
}

/** Anúncio para leitores de tela (região aria-live). */
export function announce(text) {
  const el = document.getElementById('live');
  if (el) el.textContent = text;
}

/** Marca-d'água: anéis decorativos girando devagar (sem texto, pra não depender de fonte). */
export function watermark(container) {
  if (!container) return;
  const ticks = Array.from({ length: 48 }, (_, i) => {
    const a = (i / 48) * Math.PI * 2;
    const r1 = 178; const r2 = i % 4 === 0 ? 166 : 172;
    return `<line x1="${200 + Math.cos(a) * r1}" y1="${200 + Math.sin(a) * r1}" x2="${200 + Math.cos(a) * r2}" y2="${200 + Math.sin(a) * r2}"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" fill="none" stroke="#d4af37" stroke-width="1.2">
    <circle cx="200" cy="200" r="196"/><circle cx="200" cy="200" r="150" stroke-dasharray="2 8"/><circle cx="200" cy="200" r="120"/>
    <circle cx="200" cy="200" r="80" stroke-dasharray="14 6"/>${ticks}</svg>`;
  const img = document.createElement('img');
  img.className = 'watermark';
  img.alt = '';
  img.setAttribute('aria-hidden', 'true');
  img.src = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  container.appendChild(img);
}
