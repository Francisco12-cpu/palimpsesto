// Testes de ponta a ponta num navegador REAL (Edge/Chrome via puppeteer-core), em tamanho de celular.
// Pulados se não houver navegador/puppeteer. Defina SHOTS=<pasta> para gravar screenshots das telas.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { launchBrowser, newPage, PHONE, DESKTOP } from '../../tools/browser.mjs';
import { startMiniBroker } from '../helpers/mini-broker.js';

const browser = await launchBrowser().catch(() => null);
const skip = browser ? false : 'navegador ou puppeteer-core não encontrado';
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = 'condição') => {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - t0 > ms) throw new Error(`timeout: ${what}`);
    await wait(100);
  }
};

let server; let port; let base;
async function startServer() {
  port = 19100 + Math.floor(Math.random() * 800);
  server = spawn(process.execPath, ['serve.mjs', `--port=${port}`], { stdio: ['ignore', 'pipe', 'pipe'], cwd: new URL('../..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1') });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('servidor não subiu')), 8000);
    server.stdout.on('data', (d) => { if (String(d).includes('no ar')) { clearTimeout(t); resolve(); } });
  });
  base = `http://127.0.0.1:${port}/`;
}

if (!skip) await startServer();

/** Joga sozinho dentro da página: escreve, marca Pronto, palpita e denuncia. */
function autoplay() {
  const $ = (s) => document.querySelector(s);
  const ev = (n) => new Event(n, { bubbles: true, cancelable: true });
  window.__seen = [];
  window.__iv = setInterval(() => {
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
  }, 120);
}

const hasPodium = (page) => page.evaluate(() => !!document.querySelector('.podium'));
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

async function fillMenu(page, name) {
  await page.goto(base, { waitUntil: 'networkidle0' });
  await page.type('#name', name);
}

test('e2e: menu no celular — sem erros de console/CSP, sem rolagem lateral, fontes locais carregadas', { skip, timeout: 60000 }, async () => {
  const page = await newPage(browser, PHONE);
  await page.goto(base, { waitUntil: 'networkidle0' });
  await shot(page, '01-menu-celular');
  assert.match(await page.$eval('.hero h1', (e) => e.textContent), /Palimpsesto/);
  assert.ok(await noOverflow(page), 'sem rolagem horizontal no celular');
  const fonts = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family); });
  assert.ok(fonts.some((f) => /Cinzel/.test(f)), 'Cinzel carregada localmente');
  assert.ok(fonts.some((f) => /IM Fell/.test(f)), 'IM Fell carregada localmente');
  // 8 cores numa linha só
  const rows = await page.$$eval('.swatch', (els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size);
  assert.equal(rows, 1, 'as 8 cores cabem numa linha');
  // telas simples
  for (const [go, sel] of [['howto', '.step-card'], ['about', '.van-card']]) {
    await page.click(`[data-go=${go}]`);
    await page.waitForSelector(sel);
    assert.ok(await noOverflow(page), `${go} sem rolagem lateral`);
    await shot(page, `02-${go}`);
    await page.click('#back, #ok');
    await page.waitForSelector('.hero h1');
  }
  assert.deepEqual(page.problems, []);
  await page.close();
});

test('e2e: desktop — menu bonito e sem erros', { skip, timeout: 40000 }, async () => {
  const page = await newPage(browser, DESKTOP);
  await page.goto(base, { waitUntil: 'networkidle0' });
  await shot(page, '03-menu-desktop');
  assert.deepEqual(page.problems, []);
  await page.close();
});

test('e2e: modo solo até o pódio e a antologia (navegador real)', { skip, timeout: 120000 }, async () => {
  const page = await newPage(browser, PHONE);
  await fillMenu(page, 'Ana');
  await page.click('[data-go=solo]');
  await page.waitForSelector('#cfg');
  await shot(page, '04-solo-config');
  await page.$eval('[name=bots]', (e) => { e.value = '3'; });
  await page.$eval('[name=rounds]', (e) => { e.value = '1'; });
  await page.$eval('#fast', (e) => e.click());
  await page.$eval('[name=t_writing]', (e) => { e.value = 8; });
  await page.$eval('[name=keywords]', (e) => { e.value = 2; });
  await page.click('#cfg .primary');
  await page.waitForSelector('#draft', { timeout: 10000 });
  await shot(page, '05-escrevendo');
  await page.type('#draft', 'Uma bicicleta desce a ladeira e o vento leva o meu nome embora.');
  await shot(page, '06-escrevendo-digitado');
  await page.evaluate(autoplay);
  await until(() => page.evaluate(() => window.__seen.includes('Palpite')), 40000, 'fase de palpite');
  await shot(page, '07-palpite');
  await until(() => page.evaluate(() => window.__seen.includes('Pontuação')), 60000, 'pontuação');
  await shot(page, '08-pontuacao');
  await until(() => hasPodium(page), 60000, 'pódio');
  await wait(1500);
  await shot(page, '09-fim-podio');
  assert.ok(await page.$('#acopy'), 'antologia');
  assert.ok(await noOverflow(page), 'fim sem rolagem lateral');
  assert.deepEqual(page.problems, []);
  await page.close();
});

async function createAndJoin(transport, brokerUrl) {
  // dois navegadores = dois aparelhos (numa mesma janela a aba em 2º plano não recebe cliques)
  const browserB = await launchBrowser();
  const a = await newPage(browser, PHONE);
  const b = await newPage(browserB, { ...PHONE, width: 412, height: 915 });
  b.browser2 = browserB;
  if (brokerUrl) for (const p of [a, b]) await p.evaluateOnNewDocument((u) => localStorage.setItem('palimpsesto.brokers', JSON.stringify([u])), brokerUrl);
  await fillMenu(a, 'Ana');
  await a.click('[data-go=create]');
  await a.waitForSelector('#f');
  if (transport) await a.select('[name=transport]', transport);
  await a.click('#f .primary');
  await a.waitForSelector('.room-code', { timeout: 30000 });
  const code = await a.$eval('.room-code', (e) => e.textContent);
  await a.waitForSelector('.qr svg', { timeout: 10000 });

  await fillMenu(b, 'Beto');
  await b.click('[data-go=join]');
  await b.waitForSelector('#f');
  if (transport) await b.select('[name=transport]', transport);
  await b.type('[name=code]', code);
  await b.click('#f .primary');
  await until(() => a.evaluate(() => document.querySelectorAll('.pl').length === 2), 30000, 'Beto na sala da Ana');
  return { a, b, code };
}

async function playTwo({ a, b }, tag) {
  await shot(a, `${tag}-lobby-host`);
  await shot(b, `${tag}-lobby-convidado`);
  await a.$eval('#fast', (e) => e.click());
  await a.$eval('[name=rounds]', (e) => { e.value = '1'; });
  await a.click('#start');
  await Promise.all([a.waitForSelector('#draft', { timeout: 15000 }), b.waitForSelector('#draft', { timeout: 15000 })]);
  await shot(b, `${tag}-escrevendo-convidado`);
  await Promise.all([a.evaluate(autoplay), b.evaluate(autoplay)]);
  await until(async () => (await hasPodium(a)) && (await hasPodium(b)), 90000, 'os dois chegaram ao pódio');
  const scoreA = await a.$$eval('.podium .step', (e) => e.map((x) => x.textContent).join(','));
  const scoreB = await b.$$eval('.podium .step', (e) => e.map((x) => x.textContent).join(','));
  assert.equal(scoreA, scoreB, 'os dois veem o mesmo placar');
  await shot(a, `${tag}-fim`);
}

test('e2e: duas páginas jogando em REDE LOCAL (servidor do iniciar.bat)', { skip, timeout: 180000 }, async () => {
  const pair = await createAndJoin('lan');
  try {
    await playTwo(pair, '10-lan');
    assert.deepEqual([...pair.a.problems, ...pair.b.problems], []);
  } finally { await pair.a.close(); await pair.b.browser2.close(); }
});

test('e2e: duas páginas jogando ONLINE (ponte MQTT criptografada, broker de teste)', { skip, timeout: 180000 }, async () => {
  const broker = await startMiniBroker();
  const pair = await createAndJoin('online', broker.url);
  try {
    assert.match(pair.code, /^[A-Z]{6}$/);
    await playTwo(pair, '11-online');
    assert.deepEqual([...pair.a.problems, ...pair.b.problems], []);
  } finally { await pair.a.close(); await pair.b.browser2.close(); broker.close(); }
});

after(async () => { await browser?.close().catch(() => {}); server?.kill(); setTimeout(() => process.exit(process.exitCode ?? 0), 100).unref(); });
