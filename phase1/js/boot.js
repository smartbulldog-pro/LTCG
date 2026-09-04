/* ============================================================
   LTCG — boot.js · один загрузчик на три версии (ЗАКОН ИМПОРТА, docs/vkv_bar.md §3.1)
   Что делает: no-js → js; языковые ссылки из одного массива (dev: home-*.html, прод: /, /hy/, /en/);
   гейты reduce / мобильный / точный указатель; GSAP + ScrollTrigger + Lenis — только когда есть движение;
   Lenis — только на (hover: hover) and (pointer: fine) и только через gsap.ticker; хиро — движок или
   статическая ветка; затем site.js. Всё видно без JS: разметка рендерится сразу.
   Подключать классическим <script defer src="js/boot.js"> — единственный тег скрипта на странице.
   ============================================================ */
(function () {
  'use strict';
  var d = document, h = d.documentElement;
  h.className = h.className.replace(/\bno-js\b/, 'js');

  var SITE_ROOT = h.getAttribute('data-site-root') || '/';
  var V = h.getAttribute('data-v') || '';
  var VER = V ? '?v=' + V : '';
  // превью на dev-сервере: страницы лежат рядом как home-*.html; в проде — каталоги /, /hy/, /en/
  var DEV = /\.html?$/i.test(location.pathname);
  var LANGS = { '': 'home-ru.html', 'hy/': 'home-hy.html', 'en/': 'home-en.html' };
  d.querySelectorAll('[data-path]').forEach(function (a) {
    var p = a.getAttribute('data-path') || '';
    a.setAttribute('href', DEV && LANGS[p] !== undefined ? SITE_ROOT + LANGS[p] : SITE_ROOT + p);
  });

  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var mobile = matchMedia('(max-width: 767px), ((max-height: 767px) and (pointer: coarse))').matches;
  var fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  var motion = !reduce && !mobile;
  var hasHero = !!d.querySelector('[data-hero-scroll]');
  var hasSite = h.hasAttribute('data-site');

  function load(src) {
    return new Promise(function (res, rej) {
      var el = d.createElement('script');
      el.src = SITE_ROOT + src + VER;
      el.onload = res; el.onerror = function () { rej(new Error(src)); };
      d.head.appendChild(el);
    });
  }
  function seq(list) { return list.reduce(function (p, s) { return p.then(function () { return load(s); }); }, Promise.resolve()); }

  var chain = Promise.resolve();
  if (motion) {
    chain = seq(['js/vendor/gsap.min.js', 'js/vendor/ScrollTrigger.min.js'].concat(fine ? ['js/vendor/lenis.min.js'] : []))
      .then(function () {
        if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') return;
        gsap.registerPlugin(ScrollTrigger);
        if (!fine || typeof Lenis === 'undefined') return;
        // Lenis через gsap.ticker — один драйвер на кадр; собственного rAF-цикла нет.
        // Демпфер ровно один на всю цепь: lerp (нормирован по dt внутри Lenis), НЕ duration.
        // duration 1.2 давал ~1.2 с инерции, а движок хиро вешал поверх ещё свой lerp — суммарная
        // постоянная времени 0.4 с, отсюда вязкость, перелёт ворот и рассинхрон камеры с роликом.
        var lenis = new Lenis({ lerp: 0.18, smoothWheel: true, syncTouch: false });
        lenis.on('scroll', ScrollTrigger.update);
        gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
        gsap.ticker.lagSmoothing(0);
        window.__lenis = lenis;
      })
      .catch(function (err) { console.warn('[boot] motion libs unavailable, static tier', err); });
  }
  chain
    .then(function () { if (hasHero) return load(mobile ? 'js/hero-static.js' : 'js/hero-scroll.js'); })
    .catch(function (err) { console.error('[boot] hero', err); })
    .then(function () { if (hasSite) return load('js/site.js'); })
    .catch(function (err) { console.error('[boot] site', err); })
    // рейка разделов справа: строится из разметки, ссылки настоящие, без неё страница цела
    .then(function () { if (fine) return load('js/railnav.js'); })
    .catch(function (err) { console.warn('[boot] railnav', err); });
})();
