const CACHE_NAME = 'ultimate-hydro-v5-3';
const ASSETS = [
    './index.html',
    './styles.css',
    './app.js',
    './AppIcon.png',
    'https://cdn.jsdelivr.net/npm/chart.js'
];

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
    self.skipWaiting(); 
});

self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(names => Promise.all(names.map(n => { if(n !== CACHE_NAME) return caches.delete(n); }))));
    self.clients.claim(); 
});

self.addEventListener('fetch', event => {
    event.respondWith(caches.match(event.request).then(res => res || fetch(event.request)));
});
