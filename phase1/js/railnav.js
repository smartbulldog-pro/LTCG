/* ══ Навигационная рейка справа ═══════════════════════════════════════════════
   Сайт идёт экранами, и человеку нужно видеть, где он и сколько ещё. Рейка строится
   ИЗ РАЗМЕТКИ: никаких списков разделов в HTML — иначе он разъедется со страницей.
   Канон: точки, а не кнопки; подпись только по наведению; золото — только на текущем.
   Ссылки настоящие (href="#id"), поэтому без JavaScript рейка остаётся рабочей навигацией,
   а робот проходит по ней как по обычным ссылкам. */
(function () {
  'use strict';
  var d = document;
  if (d.querySelector('.railnav')) return;

  var secs = Array.prototype.slice.call(d.querySelectorAll('section[id], [data-rail-item][id]'))
    .filter(function (el) {
      if (el.hasAttribute('data-rail-skip')) return false;
      // вложенные секции в рейку не идут: экран — это верхний уровень
      return !el.parentElement.closest('section[id]');
    });
  if (secs.length < 2) return;

  function labelOf(el) {
    // порядок важен: явная метка раздела сильнее первого попавшегося заголовка.
    // У хиро h1 — это название компании, и в рейке оно читалось как «LTCG — Legal and Tax…».
    // 1) явная короткая метка для рейки, 2) метка раздела, 3) заголовок, 4) id.
    // Заголовки на этом сайте — предложения, и обрезанное предложение в рейке читается неряшливо,
    // поэтому у каждого экрана должна быть своя короткая метка data-rail-label.
    var explicit = el.getAttribute('data-rail-label');
    if (explicit) return explicit.trim();
    var by = el.getAttribute('aria-labelledby');
    var named = by && d.getElementById(by);
    var t = named ? named.textContent
      : (el.getAttribute('aria-label') || (el.querySelector('h1, h2') || {}).textContent || el.id || '');
    t = t.replace(/\s+/g, ' ').trim();
    return t.length > 26 ? t.slice(0, 25).replace(/[\s,–—-]+$/, '') + '…' : t;
  }

  var nav = d.createElement('nav');
  nav.className = 'railnav';
  nav.setAttribute('aria-label', 'Разделы страницы');
  var ol = d.createElement('ol');
  ol.className = 'railnav__list';

  var links = secs.map(function (el, i) {
    var li = d.createElement('li');
    var a = d.createElement('a');
    a.className = 'railnav__item';
    a.href = '#' + el.id;
    a.innerHTML = '<span class="railnav__label">' +
      '<span class="railnav__no">' + String(i + 1).padStart(2, '0') + '</span>' +
      '<span class="railnav__text"></span></span><span class="railnav__dot" aria-hidden="true"></span>';
    a.querySelector('.railnav__text').textContent = labelOf(el);
    li.appendChild(a); ol.appendChild(li);
    return a;
  });

  nav.appendChild(ol);
  d.body.appendChild(nav);

  // текущий экран: тот, чья середина ближе всего к середине вьюпорта.
  // IntersectionObserver с порогами, а не обработчик скролла — обработчик не должен считать.
  var current = -1;
  function mark(i) {
    if (i === current || i < 0) return;
    current = i;
    links.forEach(function (a, k) {
      if (k === i) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    });
  }
  function pick() {
    var mid = innerHeight / 2, best = -1, dist = Infinity;
    secs.forEach(function (el, i) {
      var r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) return;
      var dd = Math.abs((r.top + r.bottom) / 2 - mid);
      if (dd < dist) { dist = dd; best = i; }
    });
    mark(best);
  }
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(pick, { threshold: [0, 0.25, 0.5, 0.75, 1] });
    secs.forEach(function (el) { io.observe(el); });
  }
  addEventListener('scroll', function () {
    if (nav.dataset.tick) return;
    nav.dataset.tick = '1';
    requestAnimationFrame(function () { nav.dataset.tick = ''; pick(); });
  }, { passive: true });
  addEventListener('resize', pick, { passive: true });
  pick();

  // переход: поверх настоящей ссылки. Без Lenis — обычный якорь, ничего не ломается.
  nav.addEventListener('click', function (e) {
    var a = e.target.closest('.railnav__item');
    if (!a) return;
    var el = d.getElementById(a.getAttribute('href').slice(1));
    if (!el || !window.__lenis) return;
    e.preventDefault();
    window.__lenis.scrollTo(el, { duration: 1.1 });
    history.replaceState(null, '', a.getAttribute('href'));
    el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
  });
})();
