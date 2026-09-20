// Ajudante para dirigir um navegador REAL (Edge/Chrome já instalados) com puppeteer-core.
// Usado por tools/shot.mjs (screenshots) e pelos testes de ponta a ponta (test/e2e.test.js).
import { existsSync } from 'node:fs';

const CANDIDATES = [
  process.env.BROWSER_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

export const browserPath = () => CANDIDATES.find((p) => existsSync(p)) ?? null;

/** Abre o navegador (ou devolve null se não há puppeteer-core/navegador). */
export async function launchBrowser(extra = {}) {
  const exe = browserPath();
  if (!exe) return null;
  let puppeteer;
  try { puppeteer = (await import('puppeteer-core')).default; } catch { return null; }
  return puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'], ...extra });
}

export const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
export const DESKTOP = { width: 1280, height: 800, deviceScaleFactor: 1 };

/** Página com captura de erros de console/rede para os relatórios. */
export async function newPage(browser, viewport = PHONE) {
  const page = await browser.newPage();
  page.problems = [];
  page.on('console', (m) => { if (m.type() === 'error') page.problems.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => page.problems.push(`exceção: ${e.message}`));
  page.on('requestfailed', (r) => { if (!/favicon/.test(r.url())) page.problems.push(`falha de rede: ${r.url()} ${r.failure()?.errorText ?? ''}`); });
  await page.setViewport(viewport);
  return page;
}
