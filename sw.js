const CACHE = 'imkerei-v2';
const FILES = [
  './Eingabemaske.html',
  './index.html',
  './_App/manifest.json',
  './_App/icon-180.png',
  './_App/icon-192.png',
  './_App/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).catch(() => caches.match('./Eingabemaske.html'))));
});
