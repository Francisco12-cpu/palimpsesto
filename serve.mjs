// Servidor local do Palimpsesto: entrega os arquivos do jogo, roda o relay WebSocket (/ws)
// e informa os endereços da rede (/api/info) para o QR code da sala.
// Quem cria a sala roda isto (iniciar.bat / npm run serve); os amigos abrem
// http://<IP-desta-máquina>:<porta> no navegador, na mesma rede local — sem internet.
//
//   node serve.mjs [--open] [--port=8080]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { writeFileSync, readFileSync, renameSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { exec } from 'node:child_process';
import { attachWebSocket } from './src/net/ws-server.js';
import { Relay } from './src/net/relay.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
const wantOpen = args.includes('--open');
const basePort = Number((args.find((a) => a.startsWith('--port=')) ?? '').split('=')[1]) || Number(process.env.PORT) || 8080;

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// Só o que o navegador precisa (não expõe testes, ferramentas nem o servidor).
const PUBLIC_FILES = new Set(['index.html', 'sw.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png']);
const PUBLIC_DIRS = ['src' + sep, 'fonts' + sep];
const isPublic = (rel) => PUBLIC_FILES.has(rel) || PUBLIC_DIRS.some((d) => rel.startsWith(d));

function lanUrls(port) {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) out.push(`http://${i.address}:${port}`);
  }
  return out;
}

// Cache em memória: lê o disco só quando o arquivo muda; guarda a versão gzip dos textos.
const fileCache = new Map();
const COMPRESSIBLE = /\.(html|js|mjs|css|json|svg|webmanifest|txt)$/;
async function loadFile(rel) {
  const abs = join(root, rel);
  const st = await stat(abs);
  let c = fileCache.get(rel);
  if (!c || c.mtimeMs !== st.mtimeMs) {
    const raw = await readFile(abs);
    c = {
      mtimeMs: st.mtimeMs,
      etag: `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`,
      raw,
      gz: COMPRESSIBLE.test(rel) ? gzipSync(raw) : null,
    };
    fileCache.set(rel, c);
  }
  return c;
}

const relay = new Relay();
let port = basePort;

// As salas sobrevivem a um reinício do servidor: o estado vai para data/rooms.json a cada mudança.
const DATA_DIR = join(root, 'data');
const ROOMS_FILE = join(DATA_DIR, 'rooms.json');
let lastSaved = '';
function saveRooms() {
  try {
    const s = JSON.stringify(relay.exportState());
    if (s === lastSaved) return;
    lastSaved = s;
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(`${ROOMS_FILE}.tmp`, s);
    renameSync(`${ROOMS_FILE}.tmp`, ROOMS_FILE); // troca atômica: nunca fica arquivo pela metade
  } catch { /* sem disco: segue só em memória */ }
}
try {
  if (existsSync(ROOMS_FILE) && Date.now() - statSync(ROOMS_FILE).mtimeMs < 60 * 60 * 1000) {
    const n = relay.importState(JSON.parse(readFileSync(ROOMS_FILE, 'utf8')));
    if (n) console.log(`  Recuperei ${n} sala(s) da última execução — os jogadores reconectam sozinhos.`);
  }
} catch { /* arquivo ilegível: começa limpo */ }
setInterval(saveRooms, 3000).unref();
process.on('SIGINT', () => { saveRooms(); process.exit(0); });
process.on('exit', saveRooms);

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/info') {
      res.writeHead(200, { 'Content-Type': types['.json'], 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ port, urls: lanUrls(port) }));
      return;
    }
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith('/')) path += 'index.html';
    const rel = normalize(path).replace(/^[\\/]+/, '');
    if (rel.includes('..') || !isPublic(rel)) throw new Error('não público');
    const f = await loadFile(rel);
    const headers = {
      'Content-Type': types[extname(rel)] || 'application/octet-stream',
      // fontes nunca mudam: cache longo; o resto revalida com ETag (304 quando não mudou)
      'Cache-Control': rel.startsWith('fonts') ? 'public, max-age=31536000, immutable' : 'no-cache',
      ETag: f.etag,
      'X-Content-Type-Options': 'nosniff',
      Vary: 'Accept-Encoding',
    };
    if (req.headers['if-none-match'] === f.etag) {
      res.writeHead(304, headers);
      res.end();
      return;
    }
    const gz = f.gz && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');
    const body = gz ? f.gz : f.raw;
    res.writeHead(200, { ...headers, ...(gz && { 'Content-Encoding': 'gzip' }), 'Content-Length': body.length });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
  }
});

attachWebSocket(server, '/ws', (conn) => {
  const h = relay.connect(conn);
  conn.onmessage = h.message;
  conn.onclose = h.close;
});

function announce() {
  console.log(`\nPalimpsesto — servidor local no ar\n`);
  console.log(`  Neste computador:    http://localhost:${port}`);
  for (const u of lanUrls(port)) console.log(`  Amigos (mesma rede): ${u}`);
  console.log(`\nDeixe esta janela aberta durante o jogo. Feche-a para encerrar.`);
  console.log(`Se os amigos não conseguirem entrar, rode liberar-firewall.bat (uma vez).\n`);
  if (wantOpen) {
    const url = `http://localhost:${port}`;
    exec(process.platform === 'win32' ? `start "" ${url}` : process.platform === 'darwin' ? `open ${url}` : `xdg-open ${url}`);
  }
}

server.on('listening', announce); // registrado uma vez só (não a cada tentativa de porta)
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && port < basePort + 20) {
    console.log(`  Porta ${port} ocupada, tentando ${port + 1}…`);
    port += 1;
    server.listen(port);
  } else {
    console.error(`
Não foi possível iniciar o servidor: ${e.message}
`);
    process.exit(1);
  }
});

// não derruba o servidor por causa de um cliente ruim
process.on('uncaughtException', (e) => console.error('erro inesperado:', e.message));
server.listen(port);
