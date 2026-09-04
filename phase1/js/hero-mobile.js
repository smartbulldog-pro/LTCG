/* ============================================================
   LTCG — hero-mobile.js · заставка первого экрана на телефоне
   Гейт: boot.js грузит только при (max-width: 767px) и наличии [data-hero-mobile].

   ЧТО ДЕЛАЕТ. Арарат во весь экран → по гребню прочерчивается золотая линия →
   её 64 точки перетекают в верхнюю кромку фирменного знака → фотография уходит
   в navy, знак дорисовывается целиком → снизу выезжают ворота выбора языка,
   и на этом СТОП: страница не прокручивается, пока язык не выбран.

   ПОЧЕМУ БЕЗ БИБЛИОТЕК. boot.js на телефоне сознательно не грузит ни GSAP,
   ни ScrollTrigger, ни Lenis. Морф — это интерполяция 64 пар точек: свой
   кадровый цикл дешевле любой зависимости, весь модуль ~9 КБ против 60 КБ GSAP.

   ПОЧЕМУ БЕЗ ВИДЕО. Данные морфа — 2,9 КБ вектора (assets/hero/m/morph.json:
   гребень в координатах кадра плюс та же точка на кромке знака). Ролик той же
   длины весил бы мегабайты и не тянулся бы под высоту конкретного экрана.

   СИСТЕМА КООРДИНАТ. Всё считается в пикселях сцены, а не в координатах кадра:
   фотография вписана cover и на узком экране обрезана по бокам, поэтому точки
   гребня переводятся той же матрицей cover, что применяет браузер. Знак живёт
   в своей матрице — он не привязан к обрезке и всегда виден целиком.
   ============================================================ */
(function () {
  'use strict';

  var html  = document.documentElement;
  var scene = document.querySelector('[data-hero-mobile]');
  if (!scene) return;

  var SITE_ROOT = html.getAttribute('data-site-root') || '/';
  // Данные морфа и знак адресуем с версией страницы: без неё браузер отдаёт
  // прежний гребень из кеша, и линия ложится мимо горы после каждой правки.
  var VQ = html.getAttribute('data-v') ? '?v=' + html.getAttribute('data-v') : '';
  var NS = 'http://www.w3.org/2000/svg';
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Заставка — витрина, а не пропускной пункт: показываем её один раз за
     сессию вкладки. Вернулся человек с ноябрьской страницы на главную —
     ждать те же 4,7 секунды во второй раз он не должен. Хранилище может
     быть недоступно (приватный режим, запрет сторонних данных), поэтому
     каждое обращение обёрнуто: отказ хранилища не должен ломать экран. */
  var SEEN = 'ltcg-splash-seen';
  function seen(v) {
    try {
      if (v) { sessionStorage.setItem(SEEN, '1'); return true; }
      return sessionStorage.getItem(SEEN) === '1';
    } catch (e) { return false; }
  }

  var hs       = document.querySelector('.hs');
  var screenEl = document.querySelector('.hs__screen');
  var svg      = scene.querySelector('.hm__vec');
  var edge     = scene.querySelector('.hm__edge');
  var gLogo    = scene.querySelector('.hm__logo');
  var veil     = scene.querySelector('.hm__veil');
  var skip     = document.querySelector('.hs__skip');
  var head     = document.getElementById('siteHead');
  if (!svg || !edge || !gLogo) return;

  /* ── 1. Замок прокрутки ────────────────────────────────────────────────
     Ставится ПЕРВЫМ делом, до всякой загрузки: иначе между разбором разметки
     и приходом данных остаётся окно, в которое палец успевает улистать сцену.
     Снимается выбором языка или страховкой (п. 9) — но не пропуском заставки:
     пропуск ускоряет показ ворот, а выбор языка всё равно остаётся за человеком. */
  var locked = false;
  function lock()   { if (!locked) { locked = true;  html.classList.add('hm-lock'); } }
  function unlock() { if (locked)  { locked = false; html.classList.remove('hm-lock'); } }
  html.classList.add('hm-run');
  lock();
  // Ворота стоят на месте по умолчанию (css/hero-mobile.css) — прячем их
  // отсюда, раз уж скрипт жив и заставка сейчас пойдёт.
  html.style.setProperty('--gate', '0');

  /* ── 2. Кривые ─────────────────────────────────────────────────────────
     Вход — ease-out, перетекание — ease-in-out: правило скила ui-ux-pro-max,
     «easing». Линейных кривых в интерфейсе нет. */
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function outCubic(p) { return 1 - Math.pow(1 - p, 3); }
  function inOutCubic(p) { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }

  /* ── 3. Расписание, мс ─────────────────────────────────────────────────
     Заставка держит человека ровно до ворот и ни секундой дольше: 4,7 с
     от первого штриха до выбора языка. Дорожки перекрываются — так движение
     читается одним непрерывным жестом, а не чередой рывков. */
  var T = {
    draw:    [   0, 1500],   // линия прочерчивается по гребню
    veil:    [1100, 2900],   // фотография уходит в navy
    morph:   [1400, 2750],   // 64 точки перетекают в кромку знака
    xfade:   [2600, 3050],   // линия гаснет, знак проявляется формами
    swoosh:  [2900, 3450],   // свош и наконечник прочерчиваются слева направо
    letters: [3300, 3800],   // LTCG
    tag:     [3600, 4050],   // подпись под знаком
    lift:    [3900, 4700]    // знак уступает место, ворота выезжают снизу
  };
  var TOTAL = 4700;
  function seg(t, k, ease) {
    var a = T[k][0], b = T[k][1];
    return (ease || outCubic)(clamp01((t - a) / (b - a)));
  }

  /* ── 4. Геометрия ──────────────────────────────────────────────────────
     cover: браузер вписывает фотографию по большей стороне и обрезает лишнее.
     Повторяем ту же матрицу, иначе линия разъедется с гребнем на любом
     экране, кроме одного-единственного соотношения.
     Знак: сажаем по своей матрице — сперва туда же, где на фотографии стоит
     вершина Масиса (морф тогда не «прыгает» по экрану), потом поднимаем в
     середину полосы, свободной от ворот. Высоту ворот меряем, а не угадываем. */
  var M = null, vw = 0, vh = 0, cov = null, pl = null;

  function measure() {
    vw = scene.clientWidth || window.innerWidth;
    vh = scene.clientHeight || window.innerHeight;
    var s = Math.max(vw / M.frame[0], vh / M.frame[1]);
    cov = { s: s, ox: (vw - M.frame[0] * s) / 2, oy: (vh - M.frame[1] * s) / 2 };

    var LB = M.logoBox, bw = LB[2] - LB[0], bh = LB[3] - LB[1];
    // Предел ширины знака зависит от экрана: 300 px рассчитаны на телефон,
    // а на вертикальном планшете (768 и шире) знак в 300 px теряется посреди
    // пустого поля. Доля та же, потолок выше.
    var cap = vw < 520 ? 300 : 420;
    var lw = Math.min(vw * 0.64, cap), k = lw / bw, lh = bh * k;
    var gateH = screenEl ? screenEl.offsetHeight : vh * 0.46;
    pl = {
      k: k, lw: lw, lh: lh, LB: LB,
      cy0: cov.oy + M.anchors.ridge.masis_apex[1] * s + lh * 0.30,
      cy1: Math.max(lh / 2 + 18, (vh - gateH) / 2)
    };
  }
  function ridgeS(i) {
    return [cov.ox + M.ridge[i][0] * cov.s, cov.oy + M.ridge[i][1] * cov.s];
  }
  function logoOrigin(lift) {
    var cy = pl.cy0 + (pl.cy1 - pl.cy0) * lift;
    return [vw / 2 - pl.lw / 2 - pl.LB[0] * pl.k, cy - pl.lh / 2 - pl.LB[1] * pl.k];
  }
  function edgeS(i, lift) {
    var o = logoOrigin(lift);
    return [o[0] + M.edge[i][0] * pl.k, o[1] + M.edge[i][1] * pl.k];
  }
  function pathD(m, lift) {
    var d = '', i, a, b, x, y;
    for (i = 0; i < M.ridge.length; i++) {
      a = ridgeS(i); b = edgeS(i, lift);
      x = a[0] + (b[0] - a[0]) * m;
      y = a[1] + (b[1] - a[1]) * m;
      d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    return d;
  }

  /* ── 5. Знак из logo.svg ───────────────────────────────────────────────
     Тот же файл, что у десктопного движка и у шапки: одна геометрия на весь
     сайт, расхождению взяться неоткуда. Снег вычитается из массива горы
     правилом evenodd — так он остаётся дыркой в золоте, а не пятном поверх. */
  var gMt = null, gSw = null, gLt = null, gTg = null, wipeRect = null;

  function buildLogo(doc) {
    var pick = function (id) { return doc.getElementById(id); };
    var mk = function (d, rule) {
      var p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      if (rule) p.setAttribute('fill-rule', rule);
      return p;
    };
    // Заливку снимаем со всех клонов: цвет приходит из CSS одной переменной,
    // иначе исходные значения из файла перебили бы тему.
    var clone = function (id, target) {
      var s = pick(id); if (!s || !target) return;
      var c = s.cloneNode(true);
      c.removeAttribute('id');
      c.querySelectorAll('[fill]').forEach(function (el) { el.removeAttribute('fill'); });
      c.removeAttribute('fill');
      target.appendChild(c);
    };
    var g = function (cls) {
      var el = document.createElementNS(NS, 'g');
      el.setAttribute('class', cls);
      gLogo.appendChild(el);
      return el;
    };
    gMt = g('hm__mt'); gSw = g('hm__sw'); gLt = g('hm__lt'); gTg = g('hm__tg');

    var main  = pick('mountain-main');
    var third = pick('mountain-third');
    var lower = pick('swoosh-lower');
    var snow  = ['snow-sis', 'snow-masis'].map(function (id) {
      var e = pick(id); return e ? e.getAttribute('d') : '';
    }).join(' ');

    if (main)  gMt.appendChild(mk(main.getAttribute('d') + ' ' + snow, 'evenodd'));
    if (third) gMt.appendChild(mk(third.getAttribute('d')));
    if (lower) gSw.appendChild(mk(lower.getAttribute('d')));
    clone('swoosh-upper', gSw);
    clone('arrowhead', gSw);
    clone('letters', gLt);
    clone('tagline', gTg);

    // Маска прочерка своша: прямоугольник, растущий слева направо в единицах
    // знака. Дешевле обводки по траектории и не требует длины пути.
    var defs = document.createElementNS(NS, 'defs');
    var cp = document.createElementNS(NS, 'clipPath');
    cp.setAttribute('id', 'hmWipe');
    cp.setAttribute('clipPathUnits', 'userSpaceOnUse');
    wipeRect = document.createElementNS(NS, 'rect');
    wipeRect.setAttribute('x', '0');
    wipeRect.setAttribute('y', '0');
    wipeRect.setAttribute('height', '1024');
    wipeRect.setAttribute('width', '0');
    cp.appendChild(wipeRect);
    defs.appendChild(cp);
    svg.insertBefore(defs, svg.firstChild);
    gSw.setAttribute('clip-path', 'url(#hmWipe)');
  }

  /* ── 6. Кадр ───────────────────────────────────────────────────────────
     Одна функция на всё: и кадровый цикл, и пересчёт при повороте экрана.
     Дорогое (строка пути на 64 точки) считается только пока идёт морф —
     после кроссфейда линия погашена, и трогать её незачем. */
  var lastLift = -1, ended = false;

  function render(t) {
    var mDraw  = seg(t, 'draw');
    var mVeil  = seg(t, 'veil');
    var mMorph = seg(t, 'morph', inOutCubic);
    var mFade  = seg(t, 'xfade');
    var mSw    = seg(t, 'swoosh');
    var mLt    = seg(t, 'letters');
    var mTg    = seg(t, 'tag');
    var mLift  = seg(t, 'lift', inOutCubic);

    if (mFade < 1) {
      edge.setAttribute('d', pathD(mMorph, 0));
      if (mDraw < 1) {
        var len = edge.getTotalLength();
        edge.style.strokeDasharray = String(len);
        edge.style.strokeDashoffset = String(len * (1 - mDraw));
      } else if (edge.style.strokeDasharray) {
        edge.style.strokeDasharray = '';
        edge.style.strokeDashoffset = '';
      }
    }
    edge.style.opacity = String(1 - mFade);

    if (mLift !== lastLift) {
      var o = logoOrigin(mLift);
      gLogo.setAttribute('transform',
        'translate(' + o[0].toFixed(1) + ' ' + o[1].toFixed(1) + ') scale(' + pl.k.toFixed(4) + ')');
      lastLift = mLift;
    }
    gMt.style.opacity = String(mFade);
    gSw.style.opacity = mSw > 0 ? '1' : '0';
    if (wipeRect) wipeRect.setAttribute('width', String(Math.round(1024 * mSw)));
    gLt.style.opacity = String(mLt);
    gTg.style.opacity = String(mTg);

    if (veil) veil.style.opacity = String(mVeil);
    // Переменная выезда живёт на <html>: ворота лежат вне слоя заставки,
    // на самой секции её никто бы не увидел.
    html.style.setProperty('--gate', mLift.toFixed(3));
    if (skip) skip.style.opacity = String(clamp01(1 - mLift * 2));
  }

  /* ── 7. Ход ────────────────────────────────────────────────────────────
     Страховка таймером — не перестраховка: если вкладка ушла в фон или
     страница под автоматизацией, requestAnimationFrame не тикает вовсе,
     и без второго источника времени человек остался бы с замком навсегда. */
  var t0 = 0, raf = 0, guard = 0;

  function step(now) {
    var t = now - t0;
    if (t >= TOTAL) { render(TOTAL); finish(); return; }
    render(t);
    raf = requestAnimationFrame(step);
  }
  function finish() {
    if (ended) return;
    ended = true;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (guard) { clearTimeout(guard); guard = 0; }
    html.classList.remove('hm-run');
    html.classList.add('hm-gate');            // ворота открыты, замок ещё стоит
    // Подсказка «Выберите язык» лежит с атрибутом hidden: на десктопе её
    // открывает движок хиро в момент посадки экрана. Здесь движка нет, а
    // заголовок панели без неё пропадает — панель начиналась сразу с языков.
    seen(true);

    /* Замок держится до выбора языка — но только пока выбор ВИДЕН. Если ворота
       не поместились, не выехали или схлопнулись в ноль, человек получает
       страницу, которая не листается и ничего не предлагает: снаружи это
       выглядит как «повис». Тогда замок снимаем — пусть лучше первый экран
       будет обычным, чем запертым. Меряем в следующем кадре: на этом ворота
       ещё не разложены. */
    requestAnimationFrame(function () {
      if (!screenEl) { unlock(); return; }
      var r = screenEl.getBoundingClientRect();
      if (!r.height || r.top > window.innerHeight - 48) {
        unlock();
        html.classList.remove('hm-gate');
        html.classList.add('hm-done');
      }
    });
    // Тот же расчёт таймером: без кадров rAF не вызовется вовсе.
    setTimeout(function () {
      if (!locked || !screenEl) return;
      var r = screenEl.getBoundingClientRect();
      if (!r.height || r.top > window.innerHeight - 48) {
        unlock();
        html.classList.remove('hm-gate');
        html.classList.add('hm-done');
      }
    }, 900);

    var hint = document.getElementById('triHint');
    // is-in — не украшение: без него подсказка объявлена с opacity 0
    // (main-triptych.css, ветка no-preference) и висит невидимой строкой.
    if (hint) { hint.hidden = false; hint.classList.add('is-in'); }
  }
  function jumpToEnd() { if (!ended) { render(TOTAL); finish(); } }

  /* ── 8. Выход ──────────────────────────────────────────────────────────
     Слушатель на документе в фазе перехвата: он заведомо раньше обработчика
     на самой ссылке в js/home-ru.js, который сразу начинает прокрутку к
     первому блоку. Сними замок позже — прокрутка упрётся в overflow: hidden
     и молча не состоится. */
  function release() {
    jumpToEnd();
    unlock();
    html.classList.remove('hm-gate');
    html.classList.add('hm-done');
    if (head) {
      head.style.setProperty('--head-in', '0');
      head.style.setProperty('--brand-o', '1');
    }
  }
  function onPick(e) {
    var a = e.target && e.target.closest ? e.target.closest('.tri__part[data-lang]') : null;
    if (!a || a.classList.contains('is-soon')) return;
    release();
    /* Страховка: нажатие должно ЧТО-ТО менять на экране. Штатно прокруткой
       к первому блоку занимается js/home-ru.js, но если его нет, он не успел
       или переход по якорю не состоялся, человек остаётся на тех же воротах
       и делает вывод, что сайт не работает. Через 700 мс проверяем и доводим
       сами. */
    setTimeout(function () {
      if (window.scrollY > 24) return;
      var where = document.getElementById('where') ||
                  document.querySelector('.hs') && document.querySelector('.hs').nextElementSibling;
      if (!where) return;
      window.scrollTo(0, Math.round(where.getBoundingClientRect().top + window.scrollY));
    }, 700);
  }
  document.addEventListener('click', onPick, true);
  // На iOS тап по крупной области надёжнее ловится через touchend: click там
  // может не дойти, если палец чуть сместился по ходу нажатия.
  document.addEventListener('touchend', onPick, true);

  // Тап по сцене — пропуск заставки. Не единственный способ: ссылка
  // «Пропустить анимацию» стоит первой в табе и на телефоне видима —
  // правило скила «gesture-alternative», критичное действие без жеста.
  scene.addEventListener('click', jumpToEnd);
  scene.addEventListener('touchstart', jumpToEnd, { passive: true });
  if (skip) {
    skip.addEventListener('click', function (e) { e.preventDefault(); jumpToEnd(); });
  }

  /* ── 9. Запуск ─────────────────────────────────────────────────────────
     Данных нет — заставки нет: сразу открытые ворота и снятый замок.
     Сцена не должна уметь запереть человека ни при какой ошибке сети. */
  function repaint() {
    measure();
    lastLift = -1;
    render(ended ? TOTAL : (performance.now() - t0));
  }
  function start() {
    measure();
    var resizeT = 0;
    addEventListener('resize', function () {
      clearTimeout(resizeT);
      resizeT = setTimeout(repaint, 120);
    }, { passive: true });
    addEventListener('orientationchange', function () { setTimeout(repaint, 260); });

    scene.classList.add('is-ready');
    // Второй заход за сессию или запрет на движение — сразу конечный кадр.
    // Во втором случае замок тоже снимаем: держать человека на воротах,
    // которые он уже видел, незачем.
    if (reduce || seen()) {
      render(TOTAL); finish();
      if (seen()) { unlock(); html.classList.remove('hm-gate'); html.classList.add('hm-done'); }
      return;
    }
    t0 = performance.now();
    raf = requestAnimationFrame(step);
    guard = setTimeout(jumpToEnd, TOTAL + 1200);
  }

  Promise.all([
    fetch(SITE_ROOT + 'assets/hero/m/morph.json' + VQ).then(function (r) { return r.json(); }),
    fetch(SITE_ROOT + 'assets/hero/logo.svg' + VQ).then(function (r) { return r.text(); })
  ]).then(function (res) {
    M = res[0];
    buildLogo(new DOMParser().parseFromString(res[1], 'image/svg+xml'));
    start();
  }).catch(function (err) {
    console.error('[hero-mobile]', err);
    scene.classList.add('is-off');
    html.classList.remove('hm-run');
    html.classList.add('hm-gate');
    unlock();
  });
})();
