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
  var motion = !reduce && !mobile;   /* пересчитывается ниже, после splash */
  /* Заставка первого экрана. Шире, чем гейт GSAP: её берут ВСЕ устройства
     с грубым указателем до 1366 px — телефон в любой ориентации и планшет
     в любой, включая iPad Pro в альбоме.
     Сперва планшет в альбоме оставался на десктопной сцене: форма экрана у
     него десктопная. Оказалось, что дело не в форме — сцена держит canvas
     2560x1440, ролик прохода по офису и скраб по закреплённому экрану, и на
     планшете это встаёт колом (владелец, 4 сентября: «на айпаде повис»).
     Палец такой сценой не управляет, а заставка на том же кадре — управляет.

     ПОЧЕМУ any-pointer, А НЕ pointer. Safari на iPad по умолчанию выдаёт
     себя за настольный браузер и на запрос pointer отвечает fine, а на
     hover — hover, хотя это планшет с пальцем. Гейт по `pointer: coarse`
     проходил мимо iPad целиком: он получал десктопную сцену и замирал
     (владелец: «не прошло на айпаде»). `any-pointer: coarse` спрашивает
     иначе — «есть ли ХОТЬ ОДИН грубый указатель», и тач-экран честно
     отвечает да. На настольной машине без сенсорного экрана — нет. */
  var splash = matchMedia('(max-width: 767px), (any-pointer: coarse) and (max-width: 1366px)').matches;
  /* GSAP нужен ровно там, где есть десктопная сцена хиро. На устройствах с
     заставкой её нет, а reveal-анимации в site.js без GSAP деградируют
     штатно — «без GSAP всё видно». Планшет получал GSAP и ScrollTrigger без
     движка сцены: триггеры считались поверх закреплённого экрана и замка
     прокрутки, и первый экран замирал (владелец: «на айпаде анимация
     проходит и дальше не переключается»). На телефоне этого не было именно
     потому, что там GSAP не грузится вовсе. */
  motion = motion && !splash;

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
    .then(function () { if (hasHero) return load(splash ? 'js/hero-static.js' : 'js/hero-scroll.js'); })
    .catch(function (err) { console.error('[boot] hero', err); })
    // Заставка телефона — отдельным модулем поверх статической ветки: знак для
    // <use> в шапке даёт hero-static.js, движение — hero-mobile.js. Грузится
    // только там, где в разметке есть её слой: страницы без него не платят.
    .then(function () { if (splash && d.querySelector('[data-hero-mobile]')) return load('js/hero-mobile.js'); })
    .catch(function (err) { console.error('[boot] hero-mobile', err); })
    // Меню узкого экрана: там нет ни боковой рейки, ни разделов в шапке —
    // без него навигация начиналась только с подвала.
    .then(function () { if (splash) return load('js/menu-mobile.js'); })
    .catch(function (err) { console.warn('[boot] menu-mobile', err); })
    .then(function () { if (hasSite) return load('js/site.js'); })
    .catch(function (err) { console.error('[boot] site', err); })
    // рейка разделов справа: строится из разметки, ссылки настоящие, без неё страница цела
    .then(function () { if (fine) return load('js/railnav.js'); })
    .catch(function (err) { console.warn('[boot] railnav', err); });

  /* Рабочий процесс — только ради установки на рабочий стол: Chrome на
     Android ставит сайт настоящим приложением лишь при его наличии, иначе
     предлагает ярлык в браузере. Политика внутри — сеть всегда впереди,
     кеш только когда сети нет (подробности и история в phase1/sw.js).
     Регистрация после load, чтобы не соперничать за сеть с тем, что человек
     видит прямо сейчас. */
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    addEventListener('load', function () {
      navigator.serviceWorker.register(SITE_ROOT + 'sw.js')
        .catch(function (err) { console.warn('[boot] sw', err); });
    });
  }

  /* Диагностика по адресу с ?diag=1 — плашка поверх экрана с тем, что видит
     конкретное устройство. На планшете и телефоне консоль недоступна без
     подключённого компьютера, а гадать о медиазапросах чужого Safari дорого:
     iPad, например, отвечает на pointer «fine», хотя это планшет с пальцем.
     Ничего не грузит и без параметра не выполняется. */
  if (/[?&]diag=1/.test(location.search)) {
    addEventListener('load', function () {
      var q = function (m) { return matchMedia(m).matches ? 'да' : 'нет'; };
      var rows = [
        ['экран', innerWidth + '×' + innerHeight + ' · DPR ' + (devicePixelRatio || 1)],
        ['точек касания', String(navigator.maxTouchPoints || 0)],
        ['pointer: coarse', q('(pointer: coarse)')],
        ['any-pointer: coarse', q('(any-pointer: coarse)')],
        ['hover: hover', q('(hover: hover)')],
        ['ГЕЙТ ЗАСТАВКИ', splash ? 'ДА' : 'НЕТ'],
        ['GSAP', typeof gsap === 'undefined' ? 'нет' : 'есть'],
        ['классы', h.className],
        ['--gate', h.style.getPropertyValue('--gate') || '(не задан)']
      ];
      var sc = d.querySelector('.hs__screen');
      if (sc) {
        var r = sc.getBoundingClientRect();
        rows.push(['ворота', 'верх ' + Math.round(r.top) + ', высота ' + Math.round(r.height)]);
      }
      rows.push(['скрипты', Array.prototype.map.call(d.querySelectorAll('script[src]'),
        function (x) { return x.src.split('/').pop().split('?')[0]; }).join(' ')]);
      var box = d.createElement('div');
      box.setAttribute('style', 'position:fixed;inset:auto 8px 8px 8px;z-index:99999;' +
        'background:#0b1a36;color:#FAE0A2;border:1px solid #F2C249;border-radius:12px;' +
        'padding:10px 12px;font:12px/1.45 ui-monospace,monospace;max-height:52vh;overflow:auto');
      box.innerHTML = rows.map(function (r) {
        return '<div><b style="color:#fff">' + r[0] + ':</b> ' + String(r[1]) + '</div>';
      }).join('') + '<div style="margin-top:8px;opacity:.7">снимок экрана этой плашки — всё, что нужно</div>';
      d.body.appendChild(box);
    });
  }
})();
