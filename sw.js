// Работа без интернета (веб-версия): все файлы приложения кешируются при установке.
// FILES (файл -> отпечаток SHA-256) и CACHE подставляет publish.py при публикации.
// При обновлении неизменённые файлы (прежде всего текст Библии, 6 МБ) переносятся из старого кеша,
// по сети качаются только изменённые. В сборке Android (Capacitor) не используется.
const FILES = {
 "./": "26f0b811f971e84c",
 "index.html": "26f0b811f971e84c",
 "style.css": "67f2377cedf9eb31",
 "app.js": "a1e7a8b105d2062b",
 "bible.js": "b58fc01acb7aa58d",
 "version.js": "d46b9fc5d88de687",
 "manifest.webmanifest": "831dd37eea4fcc75",
 "icons/icon-180.png": "c5cbd87c5e2aaef9",
 "icons/icon-192.png": "097fc4ca1207929c",
 "icons/icon-512.png": "a94f641647c86180"
};
const CACHE = 'bible-57db83e43e';
const META = '__hashes';

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const old = [];
    for (const key of await caches.keys()) {
      if (key === CACHE) continue;
      const c = await caches.open(key);
      const meta = await c.match(META);
      if (meta) old.push({ c, hashes: await meta.json() });
    }
    await Promise.all(Object.entries(FILES).map(async ([file, hash]) => {
      let r = null;
      if (hash) {
        for (const o of old) {
          if (o.hashes[file] === hash && (r = await o.c.match(file))) break;
        }
      }
      if (!r) {
        r = await fetch(new Request(file, { cache: 'reload' }));
        if (!r.ok) throw new Error(file + ': ' + r.status);
      }
      await cache.put(file, r);
    }));
    await cache.put(META, new Response(JSON.stringify(FILES)));
    await self.skipWaiting();
  })());
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
