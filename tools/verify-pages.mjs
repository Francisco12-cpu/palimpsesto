// Verifica o site publicado (GitHub Pages) de ponta a ponta: dois navegadores reais abrem a URL, um cria
// a sala ONLINE (brokers MQTT públicos de verdade), o outro entra pelo código e os dois jogam até o pódio.
//   node tools/verify-pages.mjs [url] [pasta-de-screenshots]
import { launchBrowser, newPage, PHONE } from './browser.mjs';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'https://francisco12-cpu.github.io/palimpsesto/';
const shots = process.argv[3];
if (shots) mkdirSync(shots, { recursive: true });
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms, what) {
  const s = Date.now();
  while (!(await fn())) { if (Date.now() - s > ms) throw new Error(`timeout: ${what}`); await wait(150); }
}
const shot = (p, n) => (shots ? p.screenshot({ path: `${shots}/${n}.png`, fullPage: true }) : null);

function autoplay() {
  const $ = (s) => document.querySelector(s);
  const ev = (n) => new Event(n, { bubbles: true, cancelable: true });
  window.__seen = [];
  setInterval(() => {
    const l = $('.phase-title .v')?.textContent;
    if (l && !window.__seen.includes(l)) window.__seen.push(l);
    const ta = $('#draft');
    if (ta && !ta.readOnly) { ta.value = 'texto de teste '.repeat(30); ta.dispatchEvent(ev('input')); $('#done')?.click(); }
    const gin = $('#gin');
    if (gin) { gin.value = 'barr'; gin.dispatchEvent(ev('input')); $('#g')?.dispatchEvent(ev('submit')); }
    const rep = $('[data-rep]');
    if (rep && !rep.classList.contains('on')) rep.click();
    const done = $('#done');
    if (done && !done.disabled && !$('#draft') && !$('#gin')) done.click();
  }, 150);
}

const ba = await launchBrowser();
const bb = await launchBrowser();
let failed = null;
try {
  const a = await newPage(ba, PHONE);
  const b = await newPage(bb, PHONE);

  log('A abre', url);
  const resp = await a.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
  log('A: status', resp.status(), '| título:', await a.title());
  await a.type('#name', 'Ana');
  await shot(a, 'pages-01-menu');
  await a.click('[data-go=create]');
  await a.waitForSelector('#f');
  await until(() => a.$eval('#howconn', (e) => /online/i.test(e.textContent)), 15000, 'detectou modo online');
  log('A: modo detectado →', await a.$eval('#howconn', (e) => e.textContent));
  await a.click('#f .primary');
  await a.waitForSelector('.room-code', { timeout: 45000 });
  const code = await a.$eval('.room-code', (e) => e.textContent);
  log('A: sala criada pelo broker público, código', code);
  await a.waitForSelector('.qr svg');
  const link = await a.$eval('#linktxt', (e) => e.textContent);
  log('A: link do convite →', link);
  await shot(a, 'pages-02-sala');

  log('B abre o LINK DO CONVITE (como quem escaneou o QR)');
  await b.goto(link, { waitUntil: 'networkidle0', timeout: 60000 });
  await b.waitForSelector('#acceptInvite');
  await b.type('#name', 'Beto');
  await b.click('#acceptInvite');
  await until(() => a.evaluate(() => document.querySelectorAll('.pl').length === 2), 45000, 'Beto apareceu na sala da Ana');
  log('A vê 2 jogadores');
  await shot(b, 'pages-03-convidado');

  await a.$eval('#fast', (e) => e.click());
  await a.$eval('[name=rounds]', (e) => { e.value = '1'; });
  await a.click('#start');
  await Promise.all([a.waitForSelector('#draft', { timeout: 20000 }), b.waitForSelector('#draft', { timeout: 20000 })]);
  log('partida começou nos dois');
  await Promise.all([a.evaluate(autoplay), b.evaluate(autoplay)]);
  await until(async () => (await a.evaluate(() => !!document.querySelector('.podium'))) && (await b.evaluate(() => !!document.querySelector('.podium'))), 120000, 'pódio nos dois');
  const sa = await a.$$eval('.podium .step', (e) => e.map((x) => x.textContent).join(','));
  const sb = await b.$$eval('.podium .step', (e) => e.map((x) => x.textContent).join(','));
  log('pódio A:', sa, '| pódio B:', sb, sa === sb ? '(iguais)' : '(DIFERENTES!)');
  if (sa !== sb) throw new Error('placares diferentes');
  await shot(a, 'pages-04-fim');
  const problems = [...a.problems, ...b.problems];
  log(problems.length ? `PROBLEMAS: ${problems.join(' ;; ')}` : 'sem erros de console/rede nos dois navegadores');
  if (problems.length) throw new Error('problemas de console/rede');
  log('SUCESSO: partida online completa pelo GitHub Pages');
} catch (e) {
  failed = e;
  log('FALHOU:', e.message);
}
await ba.close(); await bb.close();
process.exit(failed ? 1 : 0);
