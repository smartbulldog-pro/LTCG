/* ============================================================
   LTCG — sw.js · офлайн-запас, СЕТЬ ВСЕГДА ВПЕРЕДИ
   Область действия — каталог, в котором лежит файл (phase1/).

   ЗАЧЕМ ОН ВООБЩЕ. Chrome на Android соглашается поставить сайт настоящим
   приложением — со своим значком и запуском без адресной строки — только
   если у него есть рабочий процесс с обработчиком fetch. Без него система
   предлагает «Добавить на главный экран», то есть обычный ярлык в браузере.

   ПОЧЕМУ ПОЛИТИКА ИМЕННО ТАКАЯ. Первая версия этого файла держала статику
   «сначала из кеша». Замерено на живом адресе 4 сентября: страница пришла
   с версией ПРОШЛОЙ публикации, а ресурсы, которых в кеше не было, получали
   Response.error() — браузер читает это как сетевой сбой, и gsap,
   hero-scroll.js, site.js, railnav.js падали с 404. От первого экрана
   оставался тёмный прямоугольник со знаком в углу.

   Отсюда правило: из кеша НИЧЕГО не отдаётся, пока есть сеть. Кеш —
   аварийный запас на случай, когда сети нет вовсе. Пока черновик правится
   по нескольку раз в день, любой другой порядок означает, что человек
   открывает ссылку и видит вчерашнее.

   И второе правило: если ответа нет ни в сети, ни в кеше, мы не подменяем
   его своей ошибкой, а даём запросу уйти в сеть обычным порядком — пусть
   браузер разбирается сам. Своя Response.error() ровно это и сломала.
   ============================================================ */
const V = 'ltcg-net-first-v2';

// Минимум, чтобы приложение открылось без сети: две страницы и то, чем они
// рисуются. Кладётся по одному — недоступный адрес не должен рушить установку.
const SHELL = [
  './home-ru.html',
  './noyabr.html',
  './assets/hero/m/ararat-720.avif',
  './assets/icons/icon-192.png',
  './manifest.webmanifest'
];

self.addEventListener('install', (e) => {
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
  if (new URL(req.url).origin !== location.origin) return;

  e.respondWith((async () => {
    try {
      const net = await fetch(req);
      // Кладём в запас только удачные ответы своего происхождения: opaque и
      // ошибки в кеше потом не отличить от настоящего содержимого.
      if (net && net.ok && net.type === 'basic') {
        const c = await caches.open(V);
        c.put(req, net.clone()).catch(() => {});
      }
      return net;
    } catch (err) {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const home = await caches.match('./home-ru.html', { ignoreSearch: true });
        if (home) return home;
      }
      throw err;                 // своей ошибки не выдумываем
    }
  })());
});
