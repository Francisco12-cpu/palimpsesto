// Testes de interface com DOM simulado (jsdom, dependência só de desenvolvimento).
// Sem jsdom instalado (npm install), estes testes são pulados. Não substituem testar em
// navegador/celular de verdade (layout, fontes, sons, toque), mas pegam erros de execução.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

let JSDOM = null;
try { ({ JSDOM } = await import('jsdom')); } catch { /* sem jsdom */ }
const skip = JSDOM ? false : 'jsdom não instalado (rode: npm install)';

let $; let $$; let ev; let click; let window;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, what = 'condição') => {
  const t0 = Date.now();
  while (!fn()) { if (Date.now() - t0 > ms) throw new Error(`timeout: ${what}`); await wait(50); }
};

if (JSDOM) {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM(html, { url: 'http://localhost:8080/', pretendToBeVisual: true });
  window = dom.window;
  window.matchMedia = () => ({ matches: false });
  for (const k of ['document', 'window', 'localStorage', 'sessionStorage', 'FormData', 'HTMLElement', 'requestAnimationFrame', 'location', 'history']) {
    Object.defineProperty(globalThis, k, { value: k === 'window' ? window : window[k], configurable: true, writable: true });
  }
  globalThis.matchMedia = window.matchMedia;
  $ = (s) => document.querySelector(s);
  $$ = (s) => [...document.querySelectorAll(s)];
  ev = (n) => new window.Event(n, { bubbles: true, cancelable: true });
  click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await import(pathToFileURL(new URL('../src/ui/app.js', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')).href);
}

test('menu: como jogar, sobre, cores e painel de áudio', { skip }, () => {
  assert.match($('.hero h1').textContent, /Palimpsesto/);
  assert.ok($('.runes').textContent.includes('ᚠ'));
  assert.ok($('[data-go=howto]').textContent.includes('comece aqui'));
  click($('[data-go=howto]'));
  assert.equal($$('.step-card').length, 7);
  click($('#ok'));
  assert.ok(!$('[data-go=howto]').textContent.includes('comece aqui'));

  click($('[data-go=about]'));
  assert.equal($$('.van-card').length, 19);
  click($('#back'));

  click($$('.swatch')[3]);
  assert.equal($$('.swatch')[3].getAttribute('aria-pressed'), 'true');

  click($('.settings-btn'));
  assert.ok(!$('.settings').hidden && $('#sVol') && $('#sMusic') && $('#sHap'));
  click($('.settings-btn'));

  click($('#credits'));
  assert.ok($('.panel.gold .runes'));
  click($('#back'));
});

test('sem nome não entra em nenhum modo', { skip }, () => {
  $('#name').value = '';
  click($('[data-go=solo]'));
  assert.match($('#err').textContent, /nome/i);
  assert.ok($('.hero h1'));
});

test('modo solo: partida completa pela interface até o pódio e a antologia', { skip, timeout: 90000 }, async () => {
  $('#name').value = 'Teste';
  click($('[data-go=solo]'));
  $('[name=bots]').value = '2';
  $('[name=rounds]').value = '1';
  for (const [k, v] of Object.entries({ writing: 3, revealing: 1, guessing: 2, reporting: 2, scoring: 1 })) $(`[name=t_${k}]`).value = v;
  $('#cfg').dispatchEvent(ev('submit'));
  const seen = new Set();
  const iv = setInterval(() => {
    const label = $('.phase-title .v')?.textContent;
    if (label) seen.add(label);
    const ta = $('#draft');
    if (ta && !ta.readOnly) { ta.value = 'texto de teste '.repeat(30); ta.dispatchEvent(ev('input')); click($('#done')); }
    const gin = $('#gin');
    if (gin) { gin.value = 'barr'; gin.dispatchEvent(ev('input')); assert.ok($('#sug').children.length > 0, 'autocomplete'); $('#g').dispatchEvent(ev('submit')); }
    const rep = $('[data-rep]');
    if (rep && !rep.classList.contains('on')) click(rep);
    const done = $('#done');
    if (done && !done.disabled && !$('#draft') && !$('#gin')) click(done);
  }, 100);
  try { await until(() => $('.podium'), 60000, 'pódio'); } finally { clearInterval(iv); }
  for (const p of ['Escrevendo', 'Revelação', 'Palpite', 'Denúncias', 'Pontuação']) assert.ok(seen.has(p), `fase ${p}`);
  assert.equal($$('.podium .col').length, 3);
  assert.ok($$('.anthology .item').length >= 3, 'antologia com os textos');
  assert.ok($('#acopy') && $('#adl'));
  click($('#exit'));
  assert.ok($('.hero h1'));
});

test('modo rede: criar sala mostra código, QR, link e config; sair limpa a sessão', { skip, timeout: 40000 }, async () => {
  const port = 19000 + Math.floor(Math.random() * 900);
  const child = spawn(process.execPath, ['serve.mjs', `--port=${port}`], { stdio: ['ignore', 'pipe', 'pipe'], cwd: new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1') });
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('servidor não subiu')), 8000);
      child.stdout.on('data', (d) => { if (String(d).includes('no ar')) { clearTimeout(t); resolve(); } });
    });
    $('#name').value = 'Ana';
    click($('[data-go=create]'));
    $('[name=transport]').value = 'lan'; // o DOM de teste não alcança api/info: força o modo servidor local
    $('[name=server]').value = `127.0.0.1:${port}`;
    $('#f').dispatchEvent(ev('submit'));
    await until(() => $('.room-code')?.textContent.length === 4, 8000, 'sala criada');
    await until(() => $('.qr svg'), 8000, 'QR');
    assert.match($('#linktxt').textContent, /\?sala=[A-Z]{4}$/);
    assert.ok($('#copylink'));
    assert.equal(JSON.parse(sessionStorage.getItem('palimpsesto.session')).room, $('.room-code').textContent);
    assert.ok($('#room fieldset'), 'config de host');
    assert.equal($$('.pl').length, 1);
    // 1 jogador só: começar dá aviso
    $('#cfg').dispatchEvent(ev('submit'));
    await until(() => /pelo menos 2/.test(document.getElementById('banner').textContent), 4000, 'aviso de 2 jogadores');
    click($('#leave'));
    assert.equal(sessionStorage.getItem('palimpsesto.session'), null);
    assert.ok($('.hero h1'));
  } finally {
    child.kill();
  }
});

after(() => { window?.close(); setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });
