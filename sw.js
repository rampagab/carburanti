// Service worker: l'app si apre anche offline (dalla schermata Home), ma quando c'è rete prende SEMPRE
// i file appena pubblicati. GitHub Pages fa tenere i file in cache per 10 minuti: qui li chiedo con
// cache "no-cache" (il browser ricontrolla col server ogni volta), così un rilascio arriva subito.
const CACHE = "pienofurbo-v4";
const SHELL = [
  "./", "index.html", "style.css", "app.js", "config.js", "demo.js", "manifest.webmanifest",
  "icons/logo-mark.svg", "icons/favicon.svg", "icons/favicon-32.png", "icons/icon.svg",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "no-cache" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Solo file di questo sito; le chiamate al Worker e ai servizi esterni passano dirette.
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  // I loghi cambiano di rado: per loro va bene la cache normale del browser.
  const fresh = url.pathname.includes("/data/logos/") ? req
    : req.mode === "navigate" ? new Request(req.url, { cache: "no-cache", credentials: "same-origin" })
    : new Request(req, { cache: "no-cache" });
  e.respondWith(
    fetch(fresh)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match("index.html")))
  );
});
