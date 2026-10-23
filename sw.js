// Cache indipendente dai dati delle partite: i dati rimangono in IndexedDB.
const CACHE = 'darts-static-v1.0.0';
const ASSETS = [
  './','./index.html','./css/style.css','./js/app.js','./js/db.js',
  './js/engine.js','./js/export.js','./manifest.webmanifest',
  './icons/icon-192.png','./icons/icon-512.png',
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('darts-static-') && k!==CACHE).map(k=>caches.delete(k)))),
    self.clients.claim(),
  ]));
});
self.addEventListener('fetch', event => {
  if (event.request.method!=='GET' || new URL(event.request.url).origin!==self.location.origin) return;
  event.respondWith((async()=> {
    const cache=await caches.open(CACHE);
    const cached=await cache.match(event.request,{ignoreSearch:true});
    if (cached) return cached;
    try {
      const response=await fetch(event.request);
      if (response.ok && new URL(event.request.url).pathname.startsWith(new URL(self.registration.scope).pathname)) {
        cache.put(event.request,response.clone());
      }
      return response;
    } catch {
      if (event.request.mode==='navigate') return (await cache.match('./index.html')) || Response.error();
      return Response.error();
    }
  })());
});
