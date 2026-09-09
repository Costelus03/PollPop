// A deliberately minimal service worker. Its only job is to exist and
// respond to fetch events, which is one of the technical requirements
// browsers check before offering "Install app" / "Add to Home Screen".
// It doesn't cache anything or work offline - just passes every
// request straight through to the network, unchanged.
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
