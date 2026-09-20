// Service worker: deixa o jogo abrir offline depois da 1ª carga (spec seção 6).
// Só é aceito em contexto seguro (https ou localhost); em http://IP-da-rede o navegador o ignora.
// Estratégia: rede primeiro (sempre a versão mais nova), cache como reserva.
const CACHE = 'palimpsesto-v2';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', 'index.html', 'icon.svg', 'manifest.webmanifest', 'src/ui/theme.css', 'src/ui/effects.css'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // fontes externas etc.: navegador cuida
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((r) => r || caches.match('index.html'))),
  );
});
