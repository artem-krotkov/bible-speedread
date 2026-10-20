// Работа без интернета (веб-версия): все файлы приложения кешируются при установке.
// CACHE подставляет deploy_web.sh - хеш файлов, поэтому при каждом обновлении кеш новый, старый удаляется.
// В сборке Android (Capacitor) не используется.
const CACHE = 'bible-f3a4f2c831';
const FILES = [
  './', 'index.html', 'style.css', 'app.js', 'bible.js', 'version.js', 'manifest.webmanifest',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request)));
});
