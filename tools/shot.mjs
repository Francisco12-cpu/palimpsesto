// Screenshot de uma página no navegador real.
//   node tools/shot.mjs <url> <saida.png> [celular|desktop]
import { launchBrowser, newPage, PHONE, DESKTOP } from './browser.mjs';

const [url, out, mode = 'celular'] = process.argv.slice(2);
const browser = await launchBrowser();
if (!browser) { console.error('Navegador ou puppeteer-core não encontrado (rode npm install).'); process.exit(1); }
const page = await newPage(browser, mode === 'desktop' ? DESKTOP : PHONE);
await page.goto(url, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: out, fullPage: true });
console.log('ok', out, page.problems.length ? '\n' + page.problems.join('\n') : '— sem erros de console/rede');
await browser.close();
