// Convite por link/QR (?sala=ABCD) — precisa de página própria (o parâmetro é lido ao carregar).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

let JSDOM = null;
try { ({ JSDOM } = await import('jsdom')); } catch { /* sem jsdom */ }
const skip = JSDOM ? false : 'jsdom não instalado (rode: npm install)';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let window;

if (JSDOM) {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM(html, { url: 'http://localhost:8080/?sala=qwer', pretendToBeVisual: true });
  window = dom.window;
  window.matchMedia = () => ({ matches: false });
  for (const k of ['document', 'window', 'localStorage', 'sessionStorage', 'FormData', 'HTMLElement', 'requestAnimationFrame', 'location', 'history']) {
    Object.defineProperty(globalThis, k, { value: k === 'window' ? window : window[k], configurable: true, writable: true });
  }
  globalThis.matchMedia = window.matchMedia;
  await import(pathToFileURL(new URL('../src/ui/app.js', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')).href);
}

test('convite por link: cartão com o código, parâmetro some da URL, exige nome', { skip }, async () => {
  const $ = (s) => document.querySelector(s);
  assert.ok($('#acceptInvite'));
  assert.ok($('.panel.gold').textContent.includes('QWER'), 'código em maiúsculas');
  assert.equal(window.location.search, '');
  $('#name').value = '';
  $('#acceptInvite').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.match($('#err').textContent, /nome/i);
  $('#dropInvite').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(20);
  assert.equal($('#acceptInvite'), null);
});

after(() => { window?.close(); setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });
