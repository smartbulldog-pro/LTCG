/* ============================================================
   LTCG — sw.js · офлайн-оболочка для установленного приложения
   Область действия — каталог, в котором лежит файл (phase1/), поэтому на
   GitHub Pages он не претендует на весь домен.

   ПОЛИТИКА. Страницы всегда идут в сеть: черновик правится по нескольку раз
   в день, и человек должен видеть свежий, а не вчерашний. Кеш для них —
   только запасной выход, когда сети нет. Статика (css, js, шрифты, кадры)
   адресуется с ?v= и потому берётся из кеша сразу: её содержимое при том же
   адресе не меняется никогда.

   ЗАЧЕМ ВООБЩЕ. «Вынести на рабочий стол» без него открывает белый экран
   в метро и в самолёте. Экран с горой, знаком и телефоном офиса — лучше.
   ============================================================ */
const V = 'ltcg-v1';
const SHELL = [
  './home-ru.html',
  './noyabr.html',
  './css/site.css',
  './css/site-ru.css',
  './css/hero.css',
  './css/main-triptych.css',
  './css/home-ru.css',
  './css/hero-mobile.css',
  './css/menu-mobile.css',
  './js/boot.js',
  './js/hero-static.js',
  './js/hero-mobile.js',
  './js/menu-mobile.js',
  './js/site.js',
  './assets/hero/m/ararat-540.avif',
  './assets/hero/m/ararat-720.avif',
  './assets/hero/m/morph.json',
  './assets/hero/logo.svg',
  './assets/icons/icon-192.png',
  './manifest.webmanifest'
];

self.addEventListener('install', (e) => {
  // Каждый файл кладётся отдельно: один недоступный адрес не должен рушить
  // установку целиком — офлайн лучше частичный, чем никакой.
  e.waitUntil((async () => {
    const c = await caches.open(V);
    await Promise.all(SHELL.map((u) => c.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== V).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Страницы — сеть вперёд, кеш на случай её отсутствия.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const net = await fetch(req);
        const c = await caches.open(V);
        c.put(req, net.clone());
        return net;
      } catch (err) {
        const hit = await caches.match(req) || await caches.match('./home-ru.html');
        return hit || Response.error();
      }
    })());
    return;
  }

  // Остальное — кеш вперёд, сеть следом и дозапись.
  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    try {
      const net = await fetch(req);
      if (net.ok && net.type === 'basic') {
        const c = await caches.open(V);
        c.put(req, net.clone());
      }
      return net;
    } catch (err) {
      return hit || Response.error();
    }
  })());
});
