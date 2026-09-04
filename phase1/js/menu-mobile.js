/* ============================================================
   LTCG — menu-mobile.js · меню телефона и вертикального планшета
   Гейт: тот же, что у заставки (boot.js, переменная splash).

   ЗАЧЕМ. На узком экране навигации не было вовсе: боковая рейка разделов
   строится только при точном указателе, а в шапке стоят лишь знак, кнопка
   расчёта и переключатель темы. Единственным входом в разделы оставался
   подвал — то есть до навигации надо было пролистать всю страницу.

   ОТКУДА ПУНКТЫ. Из самой страницы, не из второго списка в разметке:
     · разделы — секции верхнего уровня с id (та же выборка, что у рейки,
       с тем же уважением к data-rail-skip и data-rail-label);
     · страницы сайта, языки и контакты — из подвала, он общий для всех
       страниц (partials/footer.html).
   Поэтому меню не может разъехаться с сайтом: разъезжаться не с чем.

   БЕЗ JS. Кнопка лежит с атрибутом hidden и открывается здесь же. Не
   загрузился скрипт — кнопки нет, а подвал на месте: навигация цела.
   ============================================================ */
(function () {
  'use strict';

  var d = document;
  var btn = d.querySelector('[data-burger]');
  var head = d.querySelector('.hdr');
  if (!btn || !head) return;

  /* Гейт проверяем ЗДЕСЬ, а не только в загрузчике. На ноябрьской странице
     нет boot.js, и модуль подключён обычным тегом — то есть выполнялся и на
     десктопе: снимал с кнопки hidden, она вставала четвёртым элементом в
     трёхколоночную сетку шапки и сбрасывала переключатель тем на вторую
     строку. Тот же список, что у стилей меню и заставки. */
  var GATE = '(max-width: 767px), (any-pointer: coarse) and (max-width: 1366px)';
  if (!matchMedia(GATE).matches) return;

  var NS_LIMIT = 26;   // длина метки раздела, дальше — многоточие

  /* ── 1. Что показывать ─────────────────────────────────────────────────── */
  function sections() {
    return Array.prototype.slice.call(d.querySelectorAll('section[id], [data-rail-item][id]'))
      .filter(function (el) {
        if (el.hasAttribute('data-rail-skip')) return false;
        if (el.hasAttribute('hidden')) return false;          // «припаркованные» экраны главной
        return !el.parentElement.closest('section[id]');
      });
  }
  function labelOf(el) {
    var explicit = el.getAttribute('data-rail-label');
    if (explicit) return explicit.trim();
    var by = el.getAttribute('aria-labelledby');
    var named = by && d.getElementById(by);
    var t = named ? named.textContent
      : (el.getAttribute('aria-label') || (el.querySelector('h1, h2') || {}).textContent || el.id || '');
    t = t.replace(/\s+/g, ' ').trim();
    return t.length > NS_LIMIT ? t.slice(0, NS_LIMIT - 1).replace(/[\s,–—-]+$/, '') + '…' : t;
  }

  /* ── 2. Панель ─────────────────────────────────────────────────────────── */
  var panel = d.createElement('nav');
  panel.className = 'mnav';
  panel.id = 'mnav';
  panel.setAttribute('aria-label', 'Меню сайта');
  panel.hidden = true;

  function group(title) {
    var s = d.createElement('div');
    s.className = 'mnav__group';
    if (title) {
      var h = d.createElement('p');
      h.className = 'mnav__h';
      h.textContent = title;
      s.appendChild(h);
    }
    panel.appendChild(s);
    return s;
  }
  function list(host, cls) {
    var ul = d.createElement('ul');
    ul.className = 'mnav__list' + (cls ? ' ' + cls : '');
    ul.setAttribute('role', 'list');
    host.appendChild(ul);
    return ul;
  }
  function item(ul, href, text, no) {
    var li = d.createElement('li');
    var a = d.createElement('a');
    a.className = 'mnav__item';
    a.href = href;
    if (no) {
      var n = d.createElement('span');
      n.className = 'mnav__no';
      n.textContent = no;
      a.appendChild(n);
    }
    var t = d.createElement('span');
    t.className = 'mnav__t';
    t.textContent = text;
    a.appendChild(t);
    li.appendChild(a);
    ul.appendChild(li);
    return a;
  }

  function build() {
    panel.textContent = '';

    // 2.1 разделы этой страницы
    var secs = sections();
    if (secs.length > 1) {
      var g1 = group('На этой странице');
      var ul1 = list(g1);
      secs.forEach(function (el, i) {
        item(ul1, '#' + el.id, labelOf(el), String(i + 1).padStart(2, '0'));
      });
    }

    // 2.2 страницы сайта — из подвала, он общий для всего сайта.
    //     Часть его ссылок ведёт якорем на секции, которые сейчас «припаркованы»
    //     (hidden data-parked) — перейти по ним некуда. Мёртвых пунктов в меню
    //     быть не должно: такие показываем как «готовится», без ссылки.
    var footNav = d.querySelector('.ftr__tile--nav .ftr__list');
    if (footNav) {
      var g2 = group('По моменту');
      var ul2 = list(g2);
      Array.prototype.forEach.call(footNav.querySelectorAll('a'), function (a) {
        var here = a.pathname === location.pathname;
        var hash = (a.hash || '').replace('#', '');
        var target = hash ? d.getElementById(hash) : null;
        var dead = here && hash && (!target || target.hasAttribute('hidden'));
        var text = a.textContent.trim();
        if (dead) {
          var li = d.createElement('li');
          var sp = d.createElement('span');
          sp.className = 'mnav__item is-soon';
          sp.setAttribute('aria-disabled', 'true');
          var t = d.createElement('span'); t.className = 'mnav__t'; t.textContent = text;
          sp.appendChild(t);
          li.appendChild(sp); ul2.appendChild(li);
          return;
        }
        // Ссылка на текущую страницу ведёт голым якорем: полный адрес
        // перезагрузил бы её целиком и заставка первого экрана пошла бы
        // по второму кругу — за переход внутри страницы это несоразмерная цена.
        var link = item(ul2, here && hash ? '#' + hash : a.getAttribute('href'), text);
        // «Вы здесь» — только если это и есть открытая страница, а не любой
        // якорь на неё: иначе метка стояла бы у всех пунктов сразу.
        if (here && !hash) link.classList.add('is-here');
      });
    }

    /* Связи и кнопки расчёта здесь нет умышленно: телефон, Telegram, WhatsApp
       и «Рассчитать» уже стоят в нижней панели быстрых действий (.dock), она
       видна на экране всегда. Второй раз те же четыре действия — шум. */

    // 2.3 языки — тем же списком, что в подвале
    var langs = d.querySelector('.ftr__langs');
    if (langs) {
      var g3 = group('Язык');
      var row = d.createElement('div');
      row.className = 'mnav__langs';
      Array.prototype.forEach.call(langs.children, function (el) {
        var c = el.cloneNode(true);
        c.classList.add('mnav__lang');
        row.appendChild(c);
      });
      g3.appendChild(row);
    }
  }

  /* ── 3. Открытие ───────────────────────────────────────────────────────
     Фокус уводится в панель и держится в ней, пока она открыта: правило
     скила ui-ux-pro-max, «escape-routes» и «keyboard-nav». Esc и нажатие
     мимо закрывают, фокус возвращается на кнопку — а не в начало страницы. */
  var open = false;
  var lastY = 0;

  function focusables() {
    return Array.prototype.slice.call(
      panel.querySelectorAll('a[href], button:not([disabled])')
    ).filter(function (el) { return el.offsetParent !== null; });
  }
  function setOpen(v) {
    if (v === open) return;
    open = v;
    btn.setAttribute('aria-expanded', v ? 'true' : 'false');
    d.documentElement.classList.toggle('mnav-on', v);
    if (v) {
      build();
      panel.hidden = false;
      lastY = window.scrollY;
      // Тело фиксируем, а не гасим overflow: Safari на iOS одного overflow
      // не слушается. Позицию возвращаем при закрытии — иначе страница
      // прыгнет в начало.
      d.body.style.top = (-lastY) + 'px';
      d.body.classList.add('mnav-lock');
      requestAnimationFrame(function () {
        panel.classList.add('is-in');
        var f = focusables();
        if (f.length) f[0].focus();
      });
    } else {
      panel.classList.remove('is-in');
      d.body.classList.remove('mnav-lock');
      d.body.style.top = '';
      window.scrollTo(0, lastY);
      var hide = function () { if (!open) panel.hidden = true; };
      setTimeout(hide, 280);
      btn.focus();
    }
  }

  btn.addEventListener('click', function () { setOpen(!open); });

  panel.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a') : null;
    if (a) setOpen(false);              // переход — панель больше не нужна
  });

  d.addEventListener('keydown', function (e) {
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return; }
    if (e.key !== 'Tab') return;
    var f = focusables();
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && d.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && d.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  // Экран стал широким — панель закрывается сама: на десктопе её место
  // занимают рейка и шапка, а забытый замок прокрутки был бы поломкой.
  matchMedia('(min-width: 1025px)').addEventListener('change', function (e) {
    if (e.matches) setOpen(false);
  });

  d.body.appendChild(panel);
  btn.hidden = false;
})();
