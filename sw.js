const CACHE_NAME = 'clear-maker-2a-v1.4.63';
const APP_ASSETS = [
    './index.html',
    './student.css?v=1.4.63',
    './student.js?v=1.4.63',
];

self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache =>
            Promise.allSettled(
                APP_ASSETS.map(asset => cache.add(asset))
            )
        )
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(names => Promise.all(
                names
                    .filter(name => name !== CACHE_NAME)
                    .map(name => caches.delete(name))
            ))
            .then(() => self.clients.claim())
            .then(() => self.clients.matchAll({ type: 'window' }))
            .then(clients => Promise.all(
                clients.map(client => client.navigate(client.url))
            ))
    );
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;

    const requestUrl = new URL(event.request.url);
    if (requestUrl.origin !== self.location.origin) return;

    event.respondWith(
        fetch(event.request)
            .then(response => {
                if (response.ok) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
                }
                return response;
            })
            .catch(() => caches.match(event.request, { ignoreSearch: true }))
    );
});
