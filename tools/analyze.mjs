// Analisador do projeto: inventário, dependências, pureza do motor, segurança (heurísticas),
// cobertura de testes, tamanhos de carga/estado e micro-benchmarks. Serve para saber "como o
// projeto está agora" e onde melhorar.
//
//   npm run analyze                    → relatório no terminal
//   npm run analyze -- --out=RELATORIO.md   → também grava em arquivo
//   npm run analyze -- --no-tests      → pula a rodada de testes com cobertura (mais rápido)
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, dirname, resolve, extname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const outFile = (args.find((a) => a.startsWith('--out=')) ?? '').slice(6);
const skipTests = args.includes('--no-tests');
const rel = (p) => relative(root, p).replaceAll('\\', '/');
const lines = [];
const out = (s = '') => lines.push(s);
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

// ---------------------------------------------------------------- inventário
const IGNORE = new Set(['node_modules', 'dist', '.git']);
function walk(dir) {
  const res = [];
  for (const name of readdirSync(dir)) {
    if (IGNORE.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) res.push(...walk(p));
    else res.push(p);
  }
  return res;
}
const all = walk(root).map((p) => ({ path: rel(p), abs: p, size: statSync(p).size, ext: extname(p) }));
const code = all.filter((f) => ['.js', '.mjs'].includes(f.ext));
const text = (f) => readFileSync(f.abs, 'utf8');
const loc = (f) => text(f).split('\n').filter((l) => l.trim() && !l.trim().startsWith('//')).length;

const area = (f) => {
  if (f.path.startsWith('src/vendor/')) return 'vendor';
  if (f.path.startsWith('src/engine/')) return 'motor';
  if (f.path.startsWith('src/net/')) return 'rede';
  if (f.path.startsWith('src/ui/')) return 'interface';
  if (f.path.startsWith('src/data/')) return 'conteúdo';
  if (f.path.startsWith('src/solo/')) return 'solo';
  if (f.path.startsWith('test/')) return 'testes';
  if (f.path.startsWith('tools/')) return 'ferramentas';
  return 'raiz';
};
out('# Relatório do analisador');
out(`_Gerado em ${new Date().toISOString().slice(0, 16).replace('T', ' ')}_`);
out();
out('## 1. Inventário');
const byArea = {};
for (const f of code) {
  const a = area(f);
  byArea[a] ??= { files: 0, loc: 0, bytes: 0 };
  byArea[a].files += 1; byArea[a].loc += loc(f); byArea[a].bytes += f.size;
}
out('| Área | Arquivos | Linhas de código | Tamanho |');
out('|---|---:|---:|---:|');
for (const [a, v] of Object.entries(byArea).sort((x, y) => y[1].loc - x[1].loc)) out(`| ${a} | ${v.files} | ${v.loc} | ${kb(v.bytes)} |`);
const own = code.filter((f) => area(f) !== 'vendor');
out(`\nTotal (sem vendor): **${own.length} arquivos, ${own.reduce((n, f) => n + loc(f), 0)} linhas de código**.`);
out('\nMaiores arquivos próprios:');
for (const f of own.sort((a, b) => loc(b) - loc(a)).slice(0, 6)) out(`- \`${f.path}\` — ${loc(f)} linhas`);

// ---------------------------------------------------------------- grafo de dependências
out('\n## 2. Dependências entre módulos');
const graph = new Map();
const importRe = /(?:import|export)\s[^'"]*?from\s+['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)|^import\s+['"](\.[^'"]+)['"]/gm;
for (const f of code) {
  const deps = [];
  for (const m of text(f).matchAll(importRe)) {
    const spec = m[1] ?? m[2] ?? m[3];
    const p = resolve(dirname(f.abs), spec);
    deps.push(rel(p));
  }
  graph.set(f.path, deps);
}
const cycles = [];
const visiting = new Set(); const done = new Set();
(function dfs(n, stack) {
  if (done.has(n)) return;
  if (visiting.has(n)) { cycles.push([...stack.slice(stack.indexOf(n)), n]); return; }
  visiting.add(n);
  for (const d of graph.get(n) ?? []) dfs(d, [...stack, n]);
  visiting.delete(n); done.add(n);
})('src/ui/app.js', []);
for (const n of graph.keys()) if (!done.has(n)) (function d(x, s) { if (done.has(x)) return; if (visiting.has(x)) { cycles.push([...s.slice(s.indexOf(x)), x]); return; } visiting.add(x); for (const y of graph.get(x) ?? []) d(y, [...s, x]); visiting.delete(x); done.add(x); })(n, []);
out(cycles.length ? `⚠ Ciclos de importação: ${cycles.map((c) => c.join(' → ')).join(' ; ')}` : '✓ Nenhum ciclo de importação.');
const imported = new Set([...graph.values()].flat());
const entries = new Set(['src/ui/app.js', 'serve.mjs', 'sw.js']);
const orphans = own.filter((f) => !imported.has(f.path) && !entries.has(f.path) && !f.path.startsWith('test/') && !f.path.startsWith('tools/')).map((f) => f.path);
out(orphans.length ? `⚠ Módulos que ninguém importa: ${orphans.join(', ')}` : '✓ Nenhum módulo órfão.');

// exports sem uso
const unused = [];
for (const f of own) {
  const src = text(f);
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:const|function|class)\s+([A-Za-z0-9_$]+)/g)) {
    const name = m[1];
    const used = own.some((g) => g.path !== f.path && new RegExp(`\\b${name}\\b`).test(text(g)));
    if (!used) unused.push(`${f.path}: ${name}`);
  }
}
out(unused.length ? `\nExports não usados por outros arquivos (candidatos a remoção ou a "API interna"):\n${unused.map((u) => `- ${u}`).join('\n')}` : '\n✓ Todo export é usado.');

// ---------------------------------------------------------------- pureza do motor
out('\n## 3. Pureza do motor (regra de arquitetura da spec)');
const engineFiles = own.filter((f) => f.path.startsWith('src/engine/'));
const impure = [];
for (const f of engineFiles) {
  text(f).split('\n').forEach((l, i) => {
    const code = l.replace(/\/\/.*$/, '').replace('seed = Date.now()', ''); // semente padrão do createGame: aceita e documentada
    if (/\b(document|window|localStorage|fetch|WebSocket|setTimeout|setInterval|Math\.random|Date\.now|performance\.now)\b/.test(code)) impure.push(`${f.path}:${i + 1}  ${l.trim().slice(0, 90)}`);
    if (/from\s+['"]\.\.\/(net|ui|solo)/.test(code)) impure.push(`${f.path}:${i + 1}  importa camada superior`);
  });
}
out(impure.length ? `Pontos a conferir:\n${impure.map((x) => `- ${x}`).join('\n')}` : '✓ Motor sem DOM, rede, timers ou aleatoriedade global.');

// ---------------------------------------------------------------- segurança (heurísticas)
out('\n## 4. Segurança e robustez (heurísticas)');
const SAFE = /^(esc\(|icon\(|seal\(|avatar\(|logo\(|nameOf\(|namesOf\(|av\(|header\(|readyBtn\(|paperHtml\(|textPaper\(|readyCount\(|anthologyHtml\(|assignmentCard\(|runes\(|qrSvg\(|BRAND\.|[a-z]\.(?:round|totalRounds|length|score)\b|[a-zA-Z]+\.length|i\b|n\b|q\b|left\b|p\.score|d\.net|d\.lost|CIRC\b|Math\.|Number\(|\d)/;
const risky = [];
for (const f of own.filter((x) => x.path.startsWith('src/ui/'))) {
  text(f).split('\n').forEach((l, i) => {
    if (!/`/.test(l) || !/\$\{/.test(l)) return;
    for (const m of l.matchAll(/\$\{([^}]+)\}/g)) {
      const e = m[1].trim();
      if (SAFE.test(e) || /^['"`]/.test(e) || /\?\s*['"`<]/.test(e) || /\bmap\(|\.join\(/.test(e)) continue;
      if (/innerHTML|\.html|`</.test(l) || /<[a-z]/.test(l)) risky.push(`${f.path}:${i + 1}  \${${e.slice(0, 60)}}`);
    }
  });
}
out(risky.length ? `Interpolações em HTML sem \`esc()\` evidente (${risky.length}) — revisar (podem ser valores internos seguros):\n${risky.slice(0, 25).map((x) => `- ${x}`).join('\n')}${risky.length > 25 ? `\n- … e mais ${risky.length - 25}` : ''}` : '✓ Toda interpolação em HTML passa por esc() ou é valor interno.');
const bad = [];
for (const f of own) {
  if (f.path.startsWith('tools/')) continue;
  text(f).split('\n').forEach((l, i) => { if (/\beval\(|new Function\(|document\.write\(/.test(l.replace(/\/\/.*$/, ''))) bad.push(`${f.path}:${i + 1}`); });
}
out(bad.length ? `⚠ eval/new Function/document.write em: ${bad.join(', ')}` : '✓ Sem eval, new Function ou document.write.');
const serve = readFileSync(join(root, 'serve.mjs'), 'utf8');
out(`- Servidor estático com lista de permissão de arquivos: ${/PUBLIC_FILES/.test(serve) ? '✓' : '⚠ não'}`);
out(`- Limite de tamanho de mensagem WebSocket: ${/MAX_PAYLOAD/.test(readFileSync(join(root, 'src/net/ws-server.js'), 'utf8')) ? '✓ (4 MB)' : '⚠ não'}`);
out(`- Heartbeat/derrubada de conexão morta: ${/DEAD_AFTER_MS/.test(readFileSync(join(root, 'src/net/ws-server.js'), 'utf8')) ? '✓' : '⚠ não'}`);
const relaySrc = readFileSync(join(root, 'src/net/relay.js'), 'utf8');
out(`- Limite de mensagens/s, de jogadores por sala e de salas no relay: ${/maxMsgPerSec/.test(relaySrc) && /maxPeers/.test(relaySrc) && /maxRooms/.test(relaySrc) ? '✓' : '⚠ não implementado'}`);
out(`- Token secreto por jogador (impede tomar o lugar de outro que só conhece o id): ${/prev\?\.token/.test(relaySrc) ? '✓' : '⚠ não implementado'}`);
out(`- Tolerância antes de trocar o host (blips de Wi-Fi): ${/promoteGraceMs/.test(relaySrc) ? '✓' : '⚠ não implementado'}`);
out(`- Config da sala normalizada no host antes de repassar: ${/normalized/.test(readFileSync(join(root, 'src/net/host.js'), 'utf8')) ? '✓' : '⚠ não'}`);
out('- Sem autenticação forte: o host é quem cria a sala e tudo é confiança na LAN; o host vê todos os segredos da partida (inerente ao modelo "peer-host")');

// ---------------------------------------------------------------- tamanhos e desempenho
out('\n## 5. Tamanho de carga e desempenho');
const served = all.filter((f) => /^(index\.html|sw\.js|manifest|icon|apple|src\/(ui|engine|net|data|solo|brand|vendor)|fonts\/)/.test(f.path) && f.ext !== '.txt');
const sum = (arr) => arr.reduce((n, f) => n + f.size, 0);
const bucket = (re) => served.filter((f) => re.test(f.path));
out(`- Scripts do navegador (src/**/*.js + vendor): ${kb(sum(bucket(/\.m?js$/)))}  (sem minificar/comprimir)`);
out(`- CSS: ${kb(sum(bucket(/\.css$/)))} · Fontes: ${kb(sum(bucket(/^fonts\//)))} · Ícones/PNG: ${kb(sum(bucket(/\.png$/)))}`);
out(`- **Total servido: ${kb(sum(served))}** (~${kb(sum(served) * 0.3)} com gzip, estimado)`);

const engine = await import(pathToFileURL(join(root, 'src/engine/engine.js')).href);
const { CONTENT } = await import(pathToFileURL(join(root, 'src/data/content.js')).href);
const { viewFor } = await import(pathToFileURL(join(root, 'src/engine/view.js')).href);
const { createSolo } = await import(pathToFileURL(join(root, 'src/solo/solo.js')).href);
const players = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: `Jogador ${i}` }));
let s = engine.startGame(engine.createGame({ players, config: { roundsPerPlayer: 3, minChars: 400 }, content: CONTENT, seed: 1 }), 0).state;
const long = 'Lorem ipsum dolor sit amet. '.repeat(20);
for (const p of players) s = engine.updateDraft(s, p.id, long).state;
const snapKB = JSON.stringify(s).length;
const viewKB = JSON.stringify(viewFor(s, 'p0')).length;
out(`- Estado completo (8 jogadores, textos de ~560 caracteres): **${kb(snapKB)}** — é o snapshot enviado ao relay a cada mudança relevante`);
out(`- Visão enviada a cada jogador: **${kb(viewKB)}**; \`content\` (${kb(JSON.stringify(s.content).length)}) fica no snapshot mas não vai aos clientes`);
let t0 = performance.now();
const N = 2000;
let tmp = s;
for (let i = 0; i < N; i++) tmp = engine.updateDraft(s, 'p0', long + i).state;
const perAction = (performance.now() - t0) / N;
out(`- Custo de uma ação do motor (clone + validação): **${perAction.toFixed(3)} ms** (≈ ${Math.round(1000 / perAction)} ações/s por núcleo)`);
t0 = performance.now();
let now = 0;
const solo = createSolo({ botCount: 7, content: CONTENT, seed: 9, clock: () => now, config: { roundsPerPlayer: 3, timers: { writing: 10, revealing: 2, guessing: 4, reporting: 5, scoring: 2 } } });
solo.start(now);
while (solo.state.phase !== 'finished') { now += 100; solo.step(now); }
out(`- Partida completa de 8 jogadores × 3 rodadas simulada em **${(performance.now() - t0).toFixed(0)} ms** de CPU (sem esperar relógio)`);

// ---------------------------------------------------------------- testes e cobertura
out('\n## 6. Testes e cobertura');
if (skipTests) out('_(pulado: --no-tests)_');
else {
  const r = spawnSync(process.execPath, ['--test', '--experimental-test-coverage', 'test/*.test.js'], { cwd: root, encoding: 'utf8', timeout: 240000 });
  const txt = `${r.stdout}\n${r.stderr}`;
  const num = (re) => Number((txt.match(re) ?? [])[1] ?? NaN);
  out(`- Testes: **${num(/(?:#|ℹ) pass (\d+)/)} passaram**, ${num(/(?:#|ℹ) fail (\d+)/)} falharam`);
  const rows = [...txt.matchAll(/^#\s+([^\s|][^|]*?)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|/gm)]
    .map((m) => ({ file: m[1].trim(), line: Number(m[2]), branch: Number(m[3]), func: Number(m[4]) }))
    .filter((x) => /^(src|serve)/.test(x.file) || x.file.includes('src/'));
  const all = rows.find((x) => /all files/i.test(x.file));
  const fileRows = [...txt.matchAll(/^(?:#|ℹ)\s+([^|\n]*?\.m?js)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|/gm)]
    .map((m) => ({ file: m[1].trim(), line: Number(m[2]), branch: Number(m[3]), func: Number(m[4]) }))
    .filter((x) => !/\.test\.js$/.test(x.file) && x.file !== 'qrcode.mjs'); // testes e biblioteca de terceiros não contam
  const total = txt.match(/all files\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)/i);
  if (total) out(`- Cobertura geral: **linhas ${total[1]}%**, ramos ${total[2]}%, funções ${total[3]}%`);
  out(`- Arquivos de código medidos: ${fileRows.length} — menos cobertos: ${[...fileRows].sort((a, b) => a.line - b.line).slice(0, 4).map((x) => `${x.file} ${x.line}%`).join(', ')}`);
  const low = fileRows.filter((x) => x.line < 70).sort((a, b) => a.line - b.line);
  out(low.length ? `- Arquivos com menos de 70% de linhas cobertas (candidatos a mais testes):\n${low.map((x) => `  - \`${x.file}\` — ${x.line}%`).join('\n')}` : '- ✓ Todos os arquivos ≥ 70% de linhas cobertas.');
  if (!total) out('  _(não consegui ler a tabela de cobertura desta versão do Node)_');
  void all;
}

// ---------------------------------------------------------------- notas de código
out('\n## 7. Marcadores e sujeira no código');
const marks = [];
for (const f of own.filter((x) => x.path !== 'tools/analyze.mjs')) text(f).split('\n').forEach((l, i) => { if (/\b(TODO|FIXME|HACK|XXX)\b/.test(l)) marks.push(`${f.path}:${i + 1}  ${l.trim().slice(0, 80)}`); });
out(marks.length ? marks.map((m) => `- ${m}`).join('\n') : '✓ Nenhum TODO/FIXME.');
const logs = [];
for (const f of own.filter((x) => x.path.startsWith('src/'))) text(f).split('\n').forEach((l, i) => { if (/console\.(log|debug)/.test(l)) logs.push(`${f.path}:${i + 1}`); });
out(logs.length ? `console.log em código do navegador/motor: ${logs.join(', ')}` : '✓ Sem console.log solto em src/.');

const report = lines.join('\n');
console.log(report);
if (outFile) { writeFileSync(join(root, outFile), report + '\n'); console.log(`\n(Relatório gravado em ${outFile})`); }
