/* ══ Главная RU: точечные правки поведения ════════════════════════════════════
   Отдельный файл, чтобы не менять общий движок hero-scroll.js.
   Снимается удалением одной строки <script> в разметке. */
(function () {
  'use strict';

  var GATE_P = 0.985;

  /* Прокрутка ТОЛЬКО через Lenis. Он служит прокси прокрутки для ScrollTrigger:
     нативный window.scrollTo двигает документ, но внутреннее значение Lenis
     остаётся прежним — ScrollTrigger считает позицию своей и возвращает страницу
     назад, а закреплённая сцена хиро не отпускает пин и продолжает перекрывать
     всё собой. Замерено: после lenis.scrollTo(...,{immediate:true}) .hs__stage
     переходит из fixed в relative и первый блок наконец виден.
     resize() перед этим обязателен — размеры Lenis устаревают (см. п. 1). */
  function setY(y) {
    var l = window.__lenis;
    y = Math.max(0, Math.round(y));
    if (l && typeof l.scrollTo === 'function') {
      l.scrollTo(y, { immediate: true, force: true });
    } else {
      window.scrollTo(0, y);
    }
  }
  function goTo(y, seconds) {
    var l = window.__lenis;
    if (l && typeof l.resize === 'function') l.resize();
    if (!seconds) { setY(y); return; }
    // Свою анимацию ведём покадрово. Замерено: у Lenis в этой сборке
    // scrollTo с duration документ не двигает вовсе — едет только immediate.
    // Поэтому каждый кадр ставим позицию мгновенно, а плавность даёт кривая.
    var from = window.scrollY, to = Math.max(0, Math.round(y));
    var t0 = performance.now(), ms = seconds * 1000;
    var done = false;
    (function step(now) {
      var p = Math.min(1, (now - t0) / ms);
      var e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;  // easeInOutCubic
      setY(from + (to - from) * e);
      if (p < 1) requestAnimationFrame(step); else done = true;
    })(t0);
    // Страховка: если кадры не выдаются (вкладка в фоне, окно свёрнуто,
    // страница под автоматизацией), rAF не тикает и анимация не стартует —
    // позиция всё равно должна оказаться там, где нужно.
    setTimeout(function () { if (!done) setY(to); }, ms + 150);
  }

  var GATE_P = 0.985;   // доля пина, на которой встают ворота (hero-scroll.js:35)

  /* ── 1. Пересчёт размеров после загрузки ────────────────────────────────
     Замерено: Lenis держал предел прокрутки 2374 при реальной длине документа
     8134 — он измерил страницу до того, как пин хиро создал свой распорный
     блок. Всё, что дальше этой отметки, программной прокруткой не достигалось
     вовсе и молча игнорировалось. Один пересчёт после полной загрузки лечит. */
  function remeasure() {
    if (window.__lenis && typeof window.__lenis.resize === 'function') window.__lenis.resize();
    if (window.ScrollTrigger && typeof window.ScrollTrigger.refresh === 'function') window.ScrollTrigger.refresh();
  }
  if (document.readyState === 'complete') setTimeout(remeasure, 300);
  else window.addEventListener('load', function () { setTimeout(remeasure, 300); });

  /* ── 2. «Пропустить анимацию» → к воротам выбора языка ───────────────────
     Штатный обработчик делает lenis.scrollTo(элемент), но ворота лежат ВНУТРИ
     зафиксированной сцены: их прямоугольник всегда в кадре, и прокрутка стоит.
     Ехать надо к позиции ворот на таймлайне пина. Прокрутка нативная и МГНОВЕННАЯ:
     замерено, что в этой сборке lenis.scrollTo(число) документ не двигает вовсе,
     а window.scrollTo с behavior:'smooth' Lenis перехватывает и гасит. Работает
     только двухаргументная форма. Для кнопки «пропустить» мгновенный переход
     и по смыслу вернее плавного. */
  var skip = document.querySelector('.hs__skip');
  var hs = document.querySelector('.hs');

  if (skip && hs) {
    skip.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopImmediatePropagation();          // штатный слушатель висит на всплытии у того же узла
      remeasure();
      goTo(hs.offsetTop + Math.max(0, hs.offsetHeight - window.innerHeight) * GATE_P);
    }, true);
  }

  /* ── 3. Выбрал русский — открылся первый блок целиком, с шапкой ──────────
     Штатный обработчик в hero-scroll.js снимает замок ворот и зовёт
     scrollToScreen(), но тот считает «следующий экран» по своей математике
     пина и садится выше начала секции: сверху остаётся хвост ворот, а шапка
     ещё не показалась. Перебивать его нельзя — на нём висит снятие замка.
     Поэтому мы не мешаем ему отработать, а ведём прокрутку сами — одним
     плавным движением с того же кадра, без паузы и без рывка в конце. */
  function showChrome() {
    // Наблюдатель в site.js пересчитывает состояние ПОСЛЕ нас и снимает свой
    // класс обратно: на прокрутке через всю сцену он видит границу хиро ровно
    // на нуле и считает, что мы ещё в нём. Поэтому признак ставится на body —
    // правило в home-ru.css перебивает и от его класса не зависит.
    document.body.classList.add('is-landed');
    document.documentElement.classList.add('hdr-on');
  }

  /* признак снимается при возврате в хиро — там шапки быть не должно */
  (function watchBack() {
    var hs2 = document.querySelector('.hs');
    if (!hs2) return;
    window.addEventListener('scroll', function () {
      if (!document.body.classList.contains('is-landed')) return;
      var bottom = hs2.getBoundingClientRect().bottom;
      if (bottom > 80) document.body.classList.remove('is-landed');
    }, { passive: true });
  
  /* ── 4. Рейка гаснет над подвалом ───────────────────────────────────────
     В подвале секций нет, показывать ей нечего, и она наезжает на правую
     плитку. Наблюдатель ставит признак на body, CSS гасит с переходом. */
  (function railOverFooter() {
    var foot = document.querySelector('.ftr');
    if (!foot || !('IntersectionObserver' in window)) return;
    new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        document.body.classList.toggle('is-at-footer', e.isIntersecting);
      });
    }, { threshold: 0 }).observe(foot);
  })();
})();
  var ru = document.querySelector('.tri__part--ru');
  if (ru) {
    ru.addEventListener('click', function () {
      // Не ждём чужую анимацию и не прыгаем после неё: ведём прокрутку сами,
      // начиная со следующего кадра — штатный обработчик к этому моменту уже
      // снял замок ворот. Одно движение вместо «пауза, потом рывок».
      // Через таймер, а не rAF: если кадры не выдаются (фон, свёрнутое окно),
      // rAF не вызовется вовсе и посадка не начнётся. Таймер идёт всегда.
      setTimeout(function () {
        var where = document.getElementById('where');
        if (!where) return;
        goTo(where.getBoundingClientRect().top + window.scrollY + 2, 1.1);
        setTimeout(showChrome, 1200);
      }, 16);
    }, true);
  }

  /* ── 4. Рейка гаснет над подвалом ───────────────────────────────────────
     В подвале секций нет, показывать ей нечего, и она наезжает на правую
     плитку. Наблюдатель ставит признак на body, CSS гасит с переходом. */
  (function railOverFooter() {
    var foot = document.querySelector('.ftr');
    if (!foot || !('IntersectionObserver' in window)) return;
    new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        document.body.classList.toggle('is-at-footer', e.isIntersecting);
      });
    }, { threshold: 0 }).observe(foot);
  })();
})();
