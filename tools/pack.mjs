// Empacota o jogo numa pasta autossuficiente (dist/Palimpsesto) + zip.
// Inclui o Node.exe em runtime/ — quem hospeda NÃO precisa instalar nada: só abrir iniciar.bat.
//
//   npm run pack             (Windows: copia o node.exe atual para dentro do pacote)
//   npm run pack -- --no-node   (sem o Node; o PC precisa ter Node instalado)
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'dist', 'Palimpsesto');
const withNode = !process.argv.includes('--no-node');

const FILES = [
  'index.html', 'serve.mjs', 'sw.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png',
  'apple-touch-icon.png', 'og.png', '404.html', 'LICENSE', 'iniciar.bat', 'liberar-firewall.bat', 'package.json',
];
const DIRS = ['src', 'fonts', 'data'];

rmSync(join(root, 'dist'), { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of FILES) cpSync(join(root, f), join(out, f));
for (const d of DIRS) cpSync(join(root, d), join(out, d), { recursive: true });

if (withNode) {
  if (process.platform !== 'win32') console.warn('Aviso: o node embutido é o do sistema atual (', process.platform, ') — o pacote é para Windows.');
  mkdirSync(join(out, 'runtime'));
  cpSync(process.execPath, join(out, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node'));
}

writeFileSync(join(out, 'LEIA-ME.txt'), `PALIMPSESTO — o jogo das vanguardas literárias
${'='.repeat(48)}

COMO JOGAR COM OS AMIGOS (mesma rede Wi-Fi, sem internet)

1. Neste computador (o "host"): dê dois cliques em  iniciar.bat
   Uma janela preta abre e o navegador vai para o jogo. Deixe a janela aberta.

2. Se os amigos não conseguirem entrar: dê dois cliques em  liberar-firewall.bat
   (uma vez só; o Windows pede permissão de administrador).

3. No jogo: Criar sala. Mostre o QR code na tela — os amigos escaneiam com o celular
   (ou abrem o endereço mostrado na janela preta, ex.: http://192.168.0.10:8080).

4. Quando todos entrarem, o host escolhe as regras e clica em "Começar partida".

Para encerrar: feche a janela preta.

${withNode ? 'Este pacote já inclui o Node.js (pasta runtime): não precisa instalar nada.' : 'Este pacote NÃO inclui o Node.js: instale a versão LTS em https://nodejs.org antes.'}

Criação: Francisco Audir — @filho.af
`);

// zip (Windows: Compress-Archive)
let zipped = '';
if (process.platform === 'win32') {
  try {
    execFileSync('powershell', ['-NoProfile', '-Command',
      `Compress-Archive -Path '${out}\\*' -DestinationPath '${join(root, 'dist', 'Palimpsesto.zip')}' -Force`], { stdio: 'inherit' });
    zipped = ` e dist/Palimpsesto.zip (${(statSync(join(root, 'dist', 'Palimpsesto.zip')).size / 1048576).toFixed(1)} MB)`;
  } catch { zipped = ' (zip não gerado)'; }
}
console.log(`\nPronto: dist/Palimpsesto${zipped}\nCopie a pasta (ou o zip) para um pendrive e abra iniciar.bat no PC do host.`);
if (!existsSync(join(out, 'iniciar.bat'))) process.exit(1);
