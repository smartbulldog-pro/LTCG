/* ============================================================
   LTCG — site.js · главная (кожа RU)
   Что здесь: шапка и док после хиро · меню · якоря через Lenis ·
   состояние «Где вы сейчас?» (hash = источник истины) · калькулятор
   из единого JSON #prices · форма с honeypot (без отсечки по времени) ·
   появление по скроллу словарём GSAP (docs/vkv_bar.md §1.8) · магнит CTA.
   Разметка читается без JS целиком; JS только прячет-и-показывает.
   ============================================================ */
(function () {
  'use strict';

  const SITE_ROOT = document.documentElement.getAttribute('data-site-root') || '/';
  const PHONE = '37494184014';
  // ?motion=0 — отладочный выключатель движения (скриншоты, проверки раскладки)
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches || /[?&]motion=0/.test(location.search);
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const hasGsap = typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  /* ── 0. Языковые ссылки уже расставлены boot.js из одного массива LANGS ──── */

  /* ── 1. Год в футере ─────────────────────────────────────────── */
  $$('[data-year]').forEach(el => { el.textContent = String(new Date().getFullYear()); });


  /* ── 1-бис. Переключатель темы: авто / светлая / тёмная ───────
     Значение живёт в data-theme на <html> (его же читает CSS) и в localStorage.
     «Авто» = атрибута нет, работает @media (prefers-color-scheme). До первой
     отрисовки атрибут ставит инлайновый скрипт в <head> — здесь только кнопки. */
  const themers = $$('[data-themer]');
  if (themers.length) {
    const root = document.documentElement;
    const current = () => root.getAttribute('data-theme') || 'auto';
    const paint = () => {
      const now = current();
      themers.forEach(box => $$('[data-theme-set]', box).forEach(b => {
        b.setAttribute('aria-pressed', String(b.dataset.themeSet === now));
      }));
    };
    const setTheme = (mode) => {
      if (mode === 'auto') root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', mode);
      try { mode === 'auto' ? localStorage.removeItem('ltcg-theme') : localStorage.setItem('ltcg-theme', mode); } catch (e) {}
      paint();
    };
    themers.forEach(box => box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-theme-set]');
      if (b) setTheme(b.dataset.themeSet);
    }));
    paint();
  }

  /* ── 2. Шапка и мобильный док появляются после хиро ──────────── */
  const hdr = $('#hdr');
  const dock = $('.dock');
  const hero = $('#hero');
  const headerH = () => (hdr ? hdr.offsetHeight : 72);
  if (hero && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      const past = entries.some(e => !e.isIntersecting && e.boundingClientRect.bottom < 0);
      const inHero = entries.some(e => e.isIntersecting);
      const show = past && !inHero;
      if (hdr && hdr.classList.contains('is-shown') !== show) {
        hdr.classList.add('is-animating');
        hdr.classList.toggle('is-shown', show);
        setTimeout(() => hdr.classList.remove('is-animating'), 520);
      }
      dock && dock.classList.toggle('is-shown', show);
      document.documentElement.classList.toggle('hdr-on', show);
    }, { threshold: 0 });
    io.observe(hero);
  } else {
    hdr && hdr.classList.add('is-shown');
    document.documentElement.classList.add('hdr-on');
  }

  /* ── 3. Меню ─────────────────────────────────────────────────── */
  const burger = $('.burger');
  const menu = $('#menu');
  const setMenu = (open) => {
    if (!burger || !menu) return;
    burger.setAttribute('aria-expanded', String(open));
    menu.hidden = !open;
    document.documentElement.classList.toggle('menu-open', open);
    if (open) {
      const first = menu.querySelector('a'); first && first.focus({ preventScroll: true });
      if (window.__lenis) window.__lenis.stop();
    } else if (window.__lenis) window.__lenis.start();
  };
  burger && burger.addEventListener('click', () => setMenu(burger.getAttribute('aria-expanded') !== 'true'));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && menu && !menu.hidden) { setMenu(false); burger.focus(); } });

  /* ── 4. Якоря: цель + параметры (#calc?preset=arrived) ───────── */
  const parseHash = (h) => {
    const s = (h || '').replace(/^#/, '');
    const [id, q] = s.split('?');
    const params = new URLSearchParams(q || '');
    return { id, params };
  };
  const scrollToId = (id) => {
    const el = id ? document.getElementById(id) : null;
    if (!el) return false;
    const offset = -(headerH() + 8);
    if (window.__lenis) window.__lenis.scrollTo(el, { offset, duration: 1.1 });
    else {
      const top = el.getBoundingClientRect().top + window.scrollY + offset;
      window.scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' });
    }
    return true;
  };

  /* ── 5. Состояние «Где вы сейчас?» ───────────────────────────── */
  const states = $$('.state[data-state]');
  const stateNames = {};
  states.forEach(s => { stateNames[s.dataset.state] = s.dataset.name; });
  const chosen = $('[data-chosen]');
  const chosenName = $('[data-chosen-name]');
  const formState = $('#f-state');
  let currentState = '';

  const setState = (key, opts) => {
    opts = opts || {};
    if (!stateNames[key]) return;
    currentState = key;
    document.documentElement.setAttribute('data-state', key);
    states.forEach(s => s.classList.toggle('is-on', s.dataset.state === key));
    if (chosen && chosenName) { chosenName.textContent = stateNames[key]; chosen.hidden = false; }
    if (formState && !opts.keepForm) formState.value = key;
    // CTA несут состояние: ссылки-якоря с параметром, WhatsApp — предзаполненным текстом
    $$('a[data-cta]').forEach(a => {
      const { id } = parseHash(a.getAttribute('href'));
      if (id) a.setAttribute('href', '#' + id + '?state=' + key);
    });
    updateWa();
    try { localStorage.setItem('ltcg.state', key); } catch (e) { /* приватный режим */ }
  };

  const applyHash = (hash, scroll) => {
    const { id, params } = parseHash(hash);
    const st = params.get('state');
    if (st) setState(st);
    else if (stateNames[id]) setState(id);
    const preset = params.get('preset');
    if (preset) applyPreset(preset);
    if (scroll) scrollToId(id);
  };

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (href === '#') return;
    const { id } = parseHash(href);
    if (!document.getElementById(id)) return;
    e.preventDefault();
    if (a.dataset.stateLink) setState(a.dataset.stateLink);
    if (a.dataset.presetLink) applyPreset(a.dataset.presetLink);
    applyHash(href, false);
    setMenu(false);
    history.replaceState(null, '', href);
    scrollToId(id);
  });

  // клик по плитке состояния (не по ссылке внутри) — выбор
  states.forEach(s => {
    s.addEventListener('click', (e) => {
      if (e.target.closest('a, button')) return;
      setState(s.dataset.state);
      history.replaceState(null, '', '#' + s.dataset.state);
    });
  });
  formState && formState.addEventListener('change', () => { if (formState.value) setState(formState.value, { keepForm: true }); });

  /* ── 6. Калькулятор — единый источник цен #prices ────────────── */
  let prices = null;
  try { prices = JSON.parse($('#prices').textContent); } catch (e) { prices = null; }
  const previewPrices = /[?&]prices=preview/.test(location.search);
  const showNumbers = !!prices && (prices.publish === true || previewPrices);
  const calcForm = $('[data-calc]');
  const boxes = calcForm ? $$('input[name="mod"]', calcForm) : [];
  const totalEl = $('[data-total]');
  const fmt = (n) => n.toLocaleString('ru-RU').replace(/ |\s/g, ' ');
  const curLabel = () => (prices ? (prices.currencyConfirmed ? prices.currency : prices.currency + '?') : '');

  const applyPreset = (key) => {
    if (!boxes.length) return;
    const map = { hero: 'ip,account,social', arrived: 'account,social,address', legalizing: 'ip,address', working: 'ip,accounting', settled: 'accounting' };
    const stateEl = states.find(s => s.dataset.state === key);
    const list = stateEl && stateEl.dataset.preset !== undefined ? stateEl.dataset.preset : map[key];
    if (list === undefined) return;
    const on = list.split(',').filter(Boolean);
    boxes.forEach(b => { b.checked = on.includes(b.value); });
    recalc();
  };

  const selected = () => boxes.filter(b => b.checked).map(b => b.value);

  const waText = () => {
    const parts = [];
    if (currentState) parts.push('Где я сейчас: ' + stateNames[currentState] + '.');
    const mods = selected();
    if (mods.length && prices) parts.push('Хочу расчёт: ' + mods.map(k => prices.modules[k].name.toLowerCase()).join(', ') + '.');
    else parts.push('Хочу расчёт стоимости.');
    return 'Здравствуйте! ' + parts.join(' ');
  };
  const updateWa = () => {
    // подстановка текста есть только у wa.me: t.me/<аккаунт> параметр text игнорирует.
    const t = encodeURIComponent(waText());
    $$('a[data-wa]').forEach(a => a.setAttribute('href', 'https://wa.me/' + PHONE + '?text=' + t));
    const hidden = $('[data-f-modules]');
    if (hidden) hidden.value = selected().join(',');
  };

  const recalc = () => {
    if (!prices || !totalEl) return;
    const mods = selected();
    boxes.forEach(b => b.closest('.mod') && b.closest('.mod').classList.toggle('is-on', b.checked));
    // список выбранного
    const list = $('[data-total-list]', totalEl);
    if (list) {
      list.innerHTML = mods.length
        ? mods.map(k => '<span class="chip">' + prices.modules[k].name + '</span>').join('')
        : '<span class="total__empty">Пока ничего не выбрано — отметьте модули.</span>';
    }
    // крупный объект итога — честная цифра: сколько модулей выбрано
    const cnt = $('[data-total-count]', totalEl);
    if (cnt) {
      const n = mods.length, w = n % 10 === 1 && n % 100 !== 11 ? 'модуль выбран' : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? 'модуля выбрано' : 'модулей выбрано';
      cnt.innerHTML = n + '<small>' + w + '</small>';
    }
    // суммы — только когда цены подтверждены (publish: true) или во внутреннем превью
    const rows = $('[data-total-rows]', totalEl);
    const note = $('[data-total-note]', totalEl);
    if (rows) rows.hidden = !showNumbers;
    if (note) note.hidden = showNumbers;
    if (showNumbers) {
      const sums = { once: 0, year: 0, month: 0 };
      mods.forEach(k => { const m = prices.modules[k]; if (typeof m.amount === 'number') sums[m.per] += m.amount; });
      ['once', 'year', 'month'].forEach(per => {
        const dd = $('[data-sum="' + per + '"]', totalEl);
        if (!dd) return;
        const has = mods.some(k => prices.modules[k].per === per);
        dd.innerHTML = has ? fmt(sums[per]) + '<span class="cur">' + curLabel() + '</span>' : '—';
      });
    }
    updateWa();
  };

  if (prices) {
    // цены на модулях и «от …» на карточках услуг — из одного JSON
    $$('[data-price]').forEach(el => {
      const m = prices.modules[el.dataset.price];
      if (!m) return;
      if (showNumbers && typeof m.amount === 'number') {
        const per = m.per === 'year' ? ' / год' : m.per === 'month' ? ' / мес' : '';
        el.innerHTML = (el.classList.contains('svc__price') ? '<span>от</span>' : '') + fmt(m.amount) + ' <span class="small">' + curLabel() + per + '</span>';
        el.hidden = false;
      }
    });
    if (previewPrices && totalEl) {
      const badge = document.createElement('span');
      badge.className = 'total__preview';
      badge.textContent = 'предварительно · валюта и состав не подтверждены';
      totalEl.insertBefore(badge, totalEl.children[1]);
    }
    boxes.forEach(b => b.addEventListener('change', recalc));
    recalc();
  }

  /* ── 7. Приёмник формы: мессенджер вместо бэкенда ─────────────
     Бэкенда у проекта нет и не будет — статические страницы на GitHub Pages.
     Форма собирает след выбора («Где я сейчас» + модули калькулятора + сообщение)
     в готовый текст и отдаёт его человеку: Telegram основным каналом, WhatsApp вторым.
     Telegram НЕ подставляет текст в чат обычного аккаунта (?text= есть только у ботов
     и у wa.me), поэтому текст показан в поле и копируется одной кнопкой.
     Honeypot — только на заполненное скрытое поле. Отсечки по времени НЕТ намеренно:
     живой человек заполняет четыре поля быстрее любого разумного порога, и отсечка
     молча съела бы валидную заявку (docs/adopt_from_vkvstudio.md). */
  const lead = $('[data-lead]');
  if (lead) {
    const msg = $('[data-form-msg]', lead);
    const done = $('[data-form-done]');
    const out = $('[data-form-out]');

    const leadText = () => {
      const name = $('#f-name', lead), contact = $('#f-contact', lead);
      const st = $('#f-state', lead), free = $('#f-msg', lead), src = $('#f-src', lead);
      const mods = (typeof selected === 'function' ? selected() : []);
      const parts = ['Здравствуйте! Меня зовут ' + name.value.trim() + '.'];
      if (st && st.value) parts.push('Где я сейчас: ' + (stateNames[st.value] || st.value) + '.');
      if (mods.length && prices) parts.push('Модули: ' + mods.map(k => prices.modules[k].name.toLowerCase()).join(', ') + '.');
      if (free && free.value.trim()) parts.push(free.value.trim());
      parts.push('Связь: ' + contact.value.trim() + '.');
      if (src && src.value.trim()) parts.push('Узнал(а) о вас: ' + src.value.trim() + '.');
      return parts.join(' ');
    };

    lead.addEventListener('submit', (e) => {
      e.preventDefault();
      const hp = lead.querySelector('input[name="website"]');
      if (hp && hp.value.trim() !== '') return;            // бот заполнил скрытое поле — молча
      const name = $('#f-name', lead), contact = $('#f-contact', lead), st = $('#f-state', lead);
      const consent = lead.querySelector('input[name="consent"]');
      const bad = [name, contact, st].find(f => !f.value.trim()) || (!consent.checked ? consent : null);
      if (bad) {
        msg.textContent = bad === consent ? 'Нужно согласие на обработку данных.' : 'Заполните имя, контакт и выберите момент.';
        (bad === consent ? consent : bad).focus();
        return;
      }
      msg.textContent = '';
      const text = leadText();
      if (out) out.value = text;
      const wa = $('[data-send-wa]');
      if (wa) wa.setAttribute('href', 'https://wa.me/' + PHONE + '?text=' + encodeURIComponent(text));
      lead.hidden = true;
      if (done) { done.hidden = false; done.focus(); }
    });

    const copyBtn = $('[data-copy]');
    if (copyBtn && out) {
      const note = $('[data-copy-msg]');
      copyBtn.addEventListener('click', () => {
        const say = (t) => { if (note) note.textContent = t; };
        const fallback = () => { out.focus(); out.select(); say('Текст выделен — скопируйте его (Ctrl+C).'); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(out.value).then(() => say('Скопировано. Откройте Telegram и вставьте.'), fallback);
        } else fallback();
      });
    }
  }

  /* ── 8. Появление по скроллу — словарь GSAP; без GSAP всё видно ── */
  if (hasGsap && !reduced) {
    gsap.registerPlugin(ScrollTrigger);
    $$('[data-reveal]').forEach(el => {
      gsap.fromTo(el, { autoAlpha: 0, y: 28 }, {
        autoAlpha: 1, y: 0, duration: 0.8, ease: 'expo.out', clearProps: 'transform',
        scrollTrigger: { trigger: el, start: 'top 85%', once: true, refreshPriority: -1 }
      });
    });
    $$('[data-stagger]').forEach(group => {
      const items = Array.from(group.children);
      if (!items.length) return;
      gsap.fromTo(items, { autoAlpha: 0, y: 40, scale: 0.96 }, {
        autoAlpha: 1, y: 0, scale: 1, duration: 0.7, stagger: 0.08, ease: 'expo.out', clearProps: 'transform',
        scrollTrigger: { trigger: group, start: 'top 82%', once: true, refreshPriority: -1 }
      });
    });
    // золотая линия у заголовка — пружина маркера
    $$('.kicker').forEach(k => {
      gsap.fromTo(k, { '--kw': 0 }, { '--kw': 1, duration: 0.6, ease: 'back.out(2.5)', scrollTrigger: { trigger: k, start: 'top 85%', once: true, refreshPriority: -1 } });
    });
    // подсветка текущего раздела в шапке
    const navLinks = $$('.hdr__nav a');
    navLinks.forEach(a => {
      const { id } = parseHash(a.getAttribute('href'));
      const sec = document.getElementById(id);
      if (!sec) return;
      ScrollTrigger.create({
        trigger: sec, start: 'top 45%', end: 'bottom 45%', refreshPriority: -1,
        onToggle: (self) => { if (self.isActive) { navLinks.forEach(l => l.removeAttribute('aria-current')); a.setAttribute('aria-current', 'true'); } }
      });
    });
  }

  /* ── 9. Магнит на главных CTA — только точный указатель ──────── */
  if (hasGsap && !reduced && finePointer) {
    $$('.btn--primary').forEach(btn => {
      const xTo = gsap.quickTo(btn, 'x', { duration: 0.4, ease: 'power2.out' });
      const yTo = gsap.quickTo(btn, 'y', { duration: 0.4, ease: 'power2.out' });
      btn.addEventListener('pointermove', (e) => {
        const r = btn.getBoundingClientRect();
        xTo((e.clientX - (r.left + r.width / 2)) * 0.18);
        yTo((e.clientY - (r.top + r.height / 2)) * 0.18);
      }, { passive: true });
      btn.addEventListener('pointerleave', () => { xTo(0); yTo(0); }, { passive: true });
    });
  }

  /* ── 10. Старт: hash как источник истины, localStorage — удобство ── */
  let saved = '';
  try { saved = localStorage.getItem('ltcg.state') || ''; } catch (e) { saved = ''; }
  if (location.hash) {
    applyHash(location.hash, false);
    const { id } = parseHash(location.hash);
    if (id && /[?]/.test(location.hash)) setTimeout(() => scrollToId(id), 60);
  } else if (saved && stateNames[saved]) {
    setState(saved, { keepForm: false });
  }
  window.addEventListener('hashchange', () => applyHash(location.hash, true));
  updateWa();

  /* ── 11. Отладка: ?at=<id> — мгновенный переход к секции (скриншоты headless) ── */
  const at = /[?&]at=([\w-]+)/.exec(location.search);
  if (at) {
    window.addEventListener('load', () => setTimeout(() => {
      const el = document.getElementById(at[1]);
      if (!el) return;
      document.documentElement.classList.add('hdr-on');
      hdr && hdr.classList.add('is-shown');
      dock && dock.classList.add('is-shown');
      window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - headerH() - 8);
    }, 400));
  }
})();
