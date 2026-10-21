// Network first, cache as a fallback. Supabase calls are never cached.
const CACHE = 'bio-debate-v3';
const SHELL = ['./', 'index.html', 'style.css', 'config.js', 'i18n.js', 'app.js', 'manifest.json', 'icon.svg'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => clients.claim())));
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || r.url.includes('supabase.co')) return;
  e.respondWith(fetch(r).then(x => { const copy = x.clone(); caches.open(CACHE).then(c => c.put(r, copy)); return x; })
    .catch(() => caches.match(r, { ignoreSearch: true })));
});
