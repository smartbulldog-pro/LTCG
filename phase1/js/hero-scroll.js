/* ============================================================
   LTCG — Hero scroll engine (полный проход, 03.09.2026 · правка 04.09 по разбору критиков)
   Слои на одном прогрессе скролла p ∈ [0, 1]:
     0. poster     — <picture> плиты A: LCP-элемент в разметке; движок берёт из него
                     первый битмап и, если нужен масштаб выше, догружает LOD (k_кропа ≤ scale)
     1. canvas     — фотоплиты (A, A-dusk, E) + уровни «матового стекла», считанные один раз
                     на offscreen-канвасе (без runtime-blur в кадре); камера = матрица plate→viewport;
                     поверх — грейд, виньетка, ключ — три заливки кешированными градиентами
     2. svg.light  — свет: луч по хребту, свош, свечение тремя штрихами, искра с хвостом (screen)
     3. svg.solid  — золото: эмблема, буквы, подпись; тень букв и травление на стекле — клоны, не фильтры
     4. grain      — зерно PNG-спрайтом, сдвиг по p
     5. DOM-экран  — монитор: гомография 4 углов × матрица камеры → matrix3d; на просыпании квад
                     экрана выпрямляется (перспектива 12° → ~2.5°); на финале панели «перелетают» в шапку,
                     а первая секция входит в кадр ещё до конца пина
   Плита: 2560×1440. Все координаты ниже — в пикселях плиты.
   Первая половина (p 0–0.56) утверждена по кадрам — хореография не менялась; изменена только отрисовка
   (луч как свет, позолота без белой обводки, без фильтров).
   Гейт мобильной ветки — тот же, что у VKV: (max-width: 767px), ((max-height: 767px) and (pointer: coarse)):
   на телефоне этот файл не грузится (boot.js → hero-static.js). Кожа: цвет финала — из --bg на <html>.
   ============================================================ */

(function () {
  'use strict';

  const html = document.documentElement;
  const SITE_ROOT = html.getAttribute('data-site-root') || '/';
  const PLATE_W = 2560;
  const PLATE_H = 1440;
  const SLICE_END = 0.44;          // конец утверждённого среза (Арарат → знак): 0.44 × 540 % ≈ прежние 235 % vh
  const GLASS_END = 0.60;          // конец непрерывного рампа «матовое стекло» (16 % пина)
  const WALK_END = 0.88;           // конец ролика (28 % пина)
  // Ворота стоят ЧУТЬ РАНЬШЕ конца пина: замок гасит инерцию, не дав документу выйти за пин,
  // поэтому возвращать позицию не нужно — прежний goTo(lockY) и давал телепорт назад на 942 px.
  // Остаток хореографии (GATE_P → 1) доигрывается в lock() ПО ВРЕМЕНИ, мёртвых процентов нет.
  const GATE_P = 0.985;
  const HERO_END = 1.0;
  const PIN_PCT = 540;             // длина пина: 540 % высоты вьюпорта на весь хиро
  const ASSETS = SITE_ROOT + 'assets/hero/';
  const MOBILE_GATE = '(max-width: 767px), ((max-height: 767px) and (pointer: coarse))';
  const MAX_ZOOM = 1.5;            // максимальный масштаб плиты A до стекла — правило LOD: k_кропа ≤ scale
  const LOD = [1280, 1920, 2560];
  const LOGO_FIT = 0.72;           // доля свободной области стекла под знак (ширина)
  // ЕДИНСТВЕННОЕ сглаживание всей цепи (VKV: обработчик скролла не рисует).
  // Если на странице поднят Lenis — фильтр уже стоит ТАМ, и движок берёт сырой прогресс:
  // иначе фильтров два (инерция Lenis + этот lerp) и хвост хореографии доигрывается за пином.
  const P_LERP = window.__lenis ? 1 : 0.18;
  const LERP_HZ = 1000 / 60;       // lerp нормируется по dt: на 144 Гц отклик тот же, что на 60

  const root = document.querySelector('[data-hero-scroll]');
  if (!root) return;

  const stage = root.querySelector('.hs__stage');
  const canvas = root.querySelector('.hs__canvas');
  const svgLight = root.querySelector('.hs__svg--light');
  const svgSolid = root.querySelector('.hs__svg--solid');
  const worldLight = svgLight.querySelector('.hs__world');
  const worldSolid = svgSolid.querySelector('.hs__world');
  const poster = root.querySelector('.hs__poster');
  const posterImg = poster ? poster.querySelector('img') : null;
  const grain = root.querySelector('.hs__grain');
  const hint = root.querySelector('.hs__hint');
  const skip = root.querySelector('.hs__skip');
  const screen = root.querySelector('.hs__screen');
  const screenGlow = root.querySelector('.hs__screen-glow');
  // страница внутри монитора: НАСТОЯЩАЯ верхушка сайта (partials/landing.html)
  const pg = screen ? screen.querySelector('.pg') : null;
  const pgLangLine = pg ? pg.querySelector('.lang-line') : null;
  const pgLangItems = pgLangLine ? Array.from(pgLangLine.querySelectorAll('.lang-line__item')) : [];
  // клик по языку берём по [data-lang]: этот атрибут есть и у старой строки .lang-line__item,
  // и у панелей триптиха .tri__part — обработчик один и от вёрстки экрана не зависит.
  const langChoices = pg ? Array.from(pg.querySelectorAll('[data-lang]')) : [];
  const pgHint = pg ? pg.querySelector('.lang-hint') : null;
  const head = document.getElementById('siteHead');

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isMobile = window.matchMedia(MOBILE_GATE).matches;
  const hasGsap = typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined';
  const debug = /[?&]debug=1/.test(location.search);
  let hud = null;
  if (debug) { hud = document.createElement('div'); hud.className = 'hs__hud'; hud.setAttribute('aria-hidden', 'true'); stage.appendChild(hud); }
  // цвет финала — кожа: navy у RU, бумага у HY/EN
  const SKIN_BG = (getComputedStyle(html).getPropertyValue('--bg') || '').trim() || '#0C1B3A';

  // ── Состояние, которое анимирует GSAP ───────────────────
  const S = {
    p: 0,
    zoom: 1, cx: PLATE_W / 2, cy: PLATE_H / 2,
    dusk: 0,          // кроссфейд A → A-dusk
    draw: 0,          // прорисовка луча по хребту 0..1
    glow: 0,          // сила свечения луча
    swoosh: 0,        // прорисовка своша 0..1
    head: 0,          // наконечник 0..1
    morph: 0,         // хребет → верхняя кромка эмблемы
    fill: 0,          // заливка золотом
    shapes: 0,        // подмена полигона точными формами логотипа
    snow: 0,
    letters: 0,
    tagline: 0,
    // вторая половина
    glass: 0,         // 0.44–0.60: ОДИН непрерывный рамп мути A-dusk → E (без ступеней)
    logoSit: 0,       // знак садится на перегородку (матрица логотип→плита → квад панели)
    dolly: 0,         // фолбэк без ролика: наезд на монитор интерполяцией окна камеры
    screenIn: 0,      // 0.86–0.90: страница проявляется НА экране монитора (не заставка — сама страница)
    full: 0,          // гомография → identity (страница на весь вьюпорт)
    navy: 0,          // canvas гаснет в цвет кожи
    markOut: 0,       // знак в углу гаснет при наезде на монитор
    choose: 0,        // 0.955–0.98: языковая строка укрупняется и садится на место (без карточек)
    logoFade: 0,      // знак-вектор растворяется в запечённом знаке плиты (baked_logo)
    walk: 0,          // 0.60–0.88: ролик Gemini «стекло → офис → монитор» (all-intra скраб), фолбэк — плиты
  };

  // ── Данные: плиты, хребет, логотип ──────────────────────
  const plates = { A: null, D: null, E: null };   // ImageBitmap | HTMLImageElement | canvas
  const blur = { A40: null, E40: null };   // 1280×720 — две текстуры на весь рамп мути (§3 архитектуры)
  let quads = null;       // E-quads: panel_quad, screen_quad, panel_free_region (basis 2560×1440)
  let ridgePts = null;    // 64 точки хребта (плита)
  let emblemPts = null;   // 64 точки верхней кромки эмблемы (плита)
  let anchors = null;     // из ridge.json
  let logo = null;        // logo.json
  const N = 64;

  const ASSET_V = '?v=20260904quad';   // версия ассетов: плиты подменяются под теми же именами, кэш надо сбрасывать
  const withV = (url) => url + (url.indexOf('?') < 0 ? ASSET_V : '');
  function loadBitmap(url) {
    return fetch(withV(url)).then(r => { if (!r.ok) throw new Error(url); return r.blob(); })
      .then(b => ('createImageBitmap' in window) ? createImageBitmap(b) : blobToImage(b));
  }
  function blobToImage(b) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img); img.onerror = rej;
      img.src = URL.createObjectURL(b);
    });
  }
  const supportsWebp = document.createElement('canvas').toDataURL('image/webp').indexOf('data:image/webp') === 0;
  let ext = supportsWebp ? '.webp' : '.jpg';   // уточняется по currentSrc постера: если браузер выбрал AVIF — берём AVIF-плиты

  // Постер: <picture> плиты A в разметке — LCP. Движок ждёт его декод и делает из него первый битмап.
  function posterReady() {
    if (!posterImg) return Promise.reject(new Error('no poster'));
    const loaded = (posterImg.complete && posterImg.naturalWidth)
      ? Promise.resolve()
      : new Promise((res, rej) => {
        posterImg.addEventListener('load', res, { once: true });
        posterImg.addEventListener('error', () => rej(new Error('poster')), { once: true });
      });
    // decode() в Chromium может не резолвиться для AVIF (замечено 03.09) — ждём его не дольше 400 мс,
    // createImageBitmap декодирует сам, вне главного потока
    const decoded = posterImg.decode
      ? Promise.race([posterImg.decode().catch(() => {}), new Promise(res => setTimeout(res, 400))])
      : Promise.resolve();
    return loaded
      .then(() => decoded)
      .then(() => {
        if (/\.avif(\?|$)/i.test(posterImg.currentSrc || '')) ext = '.avif';
        return ('createImageBitmap' in window) ? createImageBitmap(posterImg) : posterImg;
      });
  }

  // LOD: ширина плиты, при которой кроп не тянется выше 1:1 на максимальном зуме; из лестницы 1280/1920/2560
  function lodW(zoomMax) {
    const need = Math.min(2560, Math.ceil(Math.max(vw, 1) * dpr * (zoomMax || MAX_ZOOM)));
    return LOD.find(w => w >= need) || 2560;
  }
  function plateUrl(base, w) {
    if (base === 'A') return ASSETS + 'lcp/A-' + w + ext;
    return w === 2560 ? ASSETS + base + ext : ASSETS + base + '-' + w + ext;
  }
  function loadPlate(base, w) {
    return loadBitmap(plateUrl(base, w)).catch(() => loadBitmap(ASSETS + base + '.jpg'));
  }

  // Квады плиты E
  function loadQuads() {
    return fetch(withV(ASSETS + 'E-quads.json')).then(r => r.ok ? r.json() : Promise.reject(new Error('no E-quads')))
      .then(q => fetch(withV(ASSETS + 'flow/walk_screen_track.json')).then(r => r.ok ? r.json() : null)
        .catch(() => null)
        .then(tr => { if (tr) q.walk_track = tr; return { quads: q, base: 'E' }; }));
  }
  // Уровень «матового стекла»: считается один раз на offscreen-канвасе 1280×720 с зеркальным запасом
  // (края не темнеют), радиус — в пикселях 1280-basis; без поддержки ctx.filter — готовый JPEG из blur/
  function makeBlur(src, r) {
    const pad = r * 3;
    const big = document.createElement('canvas'); big.width = 1280 + 2 * pad; big.height = 720 + 2 * pad;
    const x = big.getContext('2d');
    if (!x || !('filter' in x)) return null;
    x.drawImage(src, pad, pad, 1280, 720);
    // зеркальные поля: слева/справа, сверху/снизу
    x.save(); x.translate(pad, 0); x.scale(-1, 1); x.drawImage(src, 0, pad, 1280, 720); x.restore();
    x.save(); x.translate(1280 + pad, 0); x.scale(-1, 1); x.drawImage(src, -1280, pad, 1280, 720); x.restore();
    x.save(); x.translate(0, pad); x.scale(1, -1); x.drawImage(src, pad, 0, 1280, 720); x.restore();
    x.save(); x.translate(0, 720 + pad); x.scale(1, -1); x.drawImage(src, pad, -720, 1280, 720); x.restore();
    const out = document.createElement('canvas'); out.width = 1280; out.height = 720;
    const o = out.getContext('2d');
    o.filter = 'blur(' + r + 'px)';
    o.drawImage(big, -pad, -pad);
    return out;
  }
  function loadBlur(base, r, sourceBitmap) {
    const c = sourceBitmap ? makeBlur(sourceBitmap, r) : null;
    if (c) return Promise.resolve(c);
    return loadBitmap(ASSETS + 'blur/' + base + '-b' + r + '.jpg').catch(() => null);
  }

  // ── Камера ──────────────────────────────────────────────
  let vw = 0, vh = 0, dpr = 1, ctx = null;
  const cam = { s: 1, tx: 0, ty: 0 };
  let gradeGrad = null, vigGrad = null, keyGrad = null;   // градиенты грейда — в координатах вьюпорта, кеш до resize
  let duskBand = null;                                     // полоса сумерек — в координатах ПЛИТЫ, кеш навсегда
  let embVig = null, embKey = null;                        // виньетка и ключ вокруг эмблемы — координаты плиты

  function resize() {
    vw = stage.clientWidth || window.innerWidth;
    vh = stage.clientHeight || window.innerHeight;
    // Плотность канваса ограничена РАЗРЕШЕНИЕМ ИСТОЧНИКА, а не произвольным числом.
    // На канвасе живут только плиты и кадр ролика; самая крупная плита — 2560 px (LOD).
    // Значит при вьюпорте 2560 CSS px плотность выше единицы не показывает ни одного нового
    // пикселя — она только интерполирует, зато умножает работу композитора.
    // Замер на 2.5K владельца: было 3840×2160 = 8.3 Мпикс на кадр, и по ним четыре
    // полноэкранные заливки с режимами наложения — 10–85 % кадров длиннее 20 мс, перемотка
    // дорожала с 2.4 до 20–30 мс. Стало 2560×1440 = 3.7 Мпикс, работы в 2.25 раза меньше.
    // На макбуке 1512 CSS px кап даёт 1.5 (2560/1512 = 1.69), то есть ретина не страдает —
    // ограничение включается только там, где источника всё равно нет. Армянская аудитория
    // сидит на маках, поэтому этот путь основной, а не крайний.
    dpr = Math.min(window.devicePixelRatio || 1, 1.5, PLATE_W / vw);
    canvas.width = Math.round(vw * dpr); canvas.height = Math.round(vh * dpr);
    if (!ctx) ctx = canvas.getContext('2d', { alpha: false });
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    svgLight.setAttribute('width', vw); svgLight.setAttribute('height', vh);
    svgSolid.setAttribute('width', vw); svgSolid.setAttribute('height', vh);
    buildGrades();
    render();
  }

  function buildGrades() {
    // грейд: тёплые света от ключа слева-сверху → холодные тени справа-снизу (soft-light, серый 128 — нейтраль)
    gradeGrad = ctx.createLinearGradient(0, 0, vw, vh);
    gradeGrad.addColorStop(0, 'rgb(255,198,116)');
    gradeGrad.addColorStop(0.5, 'rgb(128,128,128)');
    gradeGrad.addColorStop(1, 'rgb(22,44,104)');
    // виньетка: multiply, светлое ядро чуть выше центра (горизонт, стол), мягкие тёмные углы
    vigGrad = ctx.createRadialGradient(vw * 0.5, vh * 0.46, Math.min(vw, vh) * 0.32, vw * 0.5, vh * 0.5, Math.hypot(vw, vh) * 0.6);
    vigGrad.addColorStop(0, 'rgb(255,255,255)');
    vigGrad.addColorStop(0.7, 'rgb(150,148,158)');
    vigGrad.addColorStop(1, 'rgb(34,36,48)');
    // ключ: мягкое тёплое пятно слева (окна офиса) — screen, только в мире офиса
    keyGrad = ctx.createRadialGradient(vw * 0.1, vh * 0.42, 0, vw * 0.1, vh * 0.42, vw * 0.6);
    keyGrad.addColorStop(0, 'rgba(255,208,140,1)');
    keyGrad.addColorStop(1, 'rgba(255,208,140,0)');
    // полоса сумерек: координаты ПЛИТЫ. Градиент интерпретируется в user space в момент заливки,
    // поэтому один объект годится на любую камеру — заливаем его с матрицей плиты (ни одного
    // createLinearGradient в кадре, forensic п. «операции на кадр», строка 521)
    if (!duskBand) {
      duskBand = ctx.createLinearGradient(0, 320, 0, 780);
      duskBand.addColorStop(0, 'rgba(255,170,90,0)');
      duskBand.addColorStop(0.35, 'rgba(255,170,90,1)');
      duskBand.addColorStop(0.7, 'rgba(255,150,70,1)');
      duskBand.addColorStop(1, 'rgba(255,150,70,0)');
    }
    // виньетка вокруг эмблемы и ключ по форме знака — тоже координаты плиты, строятся один раз
    if (EMB.w > 0) {
      const cxv = EMB.left + EMB.w / 2, cyv = EMB.top + EMB.h * 1.1;
      embVig = ctx.createRadialGradient(cxv, cyv, EMB.w * 0.45, cxv, cyv, EMB.w * 1.6);
      embVig.addColorStop(0, 'rgba(8,14,30,0.35)');
      embVig.addColorStop(1, 'rgba(8,14,30,0.85)');
      embKey = ctx.createLinearGradient(EMB.left, EMB.top, EMB.left + EMB.w * 0.6, EMB.top + EMB.h);
      embKey.addColorStop(0, 'rgba(255,243,208,0.95)');
      embKey.addColorStop(0.55, 'rgba(128,128,128,0)');
      embKey.addColorStop(1, 'rgba(60,40,10,0.6)');
    }
  }

  function coverScale() { return Math.max(vw / PLATE_W, vh / PLATE_H); }

  const DOLLY_FROM = { zoom: 1.02, cx: 1300, cy: 735 };   // камера в конце паузы 0.72–0.74
  function computeCamera() {
    const s0 = coverScale();
    let zoom = S.zoom, scx = S.cx, scy = S.cy;
    if (S.dolly > 0.001 && quads) {
      // наезд по оптической оси: линейная интерполяция окна камеры (края окна — выпуклая комбинация,
      // поэтому экран, лежащий в стартовом и конечном окне, лежит в кадре на всём пути)
      const t = S.dolly, sc = quadCenter(quads.screen_quad);
      const hw0 = vw / (2 * s0 * DOLLY_FROM.zoom), hw1 = vw / (2 * s0 * monitorZoom());
      const hw = lerp(hw0, hw1, t);
      zoom = vw / (2 * s0 * hw);
      scx = lerp(DOLLY_FROM.cx, sc[0], t); scy = lerp(DOLLY_FROM.cy, sc[1], t);
    }
    const s = s0 * zoom;
    // Центр камеры зажимаем так, чтобы плита всегда покрывала вьюпорт
    const halfW = vw / (2 * s), halfH = vh / (2 * s);
    const cx = Math.min(Math.max(scx, halfW), PLATE_W - halfW);
    const cy = Math.min(Math.max(scy, halfH), PLATE_H - halfH);
    cam.s = s; cam.tx = vw / 2 - cx * s; cam.ty = vh / 2 - cy * s;
    cam.zoom = zoom;
  }
  const toView = (pt) => [pt[0] * cam.s + cam.tx, pt[1] * cam.s + cam.ty];

  // ── Ролик «стекло → офис → монитор» (all-intra mp4). По образцу VKV scroll-engine:
  //    скролл только двигает цель; rAF-цикл подводит время к цели lerp'ом и перематывает с флагом isSeeking;
  //    на экран идёт не <video>, а последний ДЕКОДИРОВАННЫЙ кадр из offscreen-канваса (rVFC / seeked) ──
  const WALK_W = 1280, WALK_H = 720;
  const walkVideo = root.querySelector('.hs__video');
  const walkFrame = document.createElement('canvas'); walkFrame.width = WALK_W; walkFrame.height = WALK_H;
  const walkCtx = walkFrame.getContext('2d', { alpha: false });
  let walkReady = false, walkHas = false, walkSeeking = false, walkSeekAt = 0;
  // ВРЕМЯ КАДРА, КОТОРЫЙ ЛЕЖИТ В walkFrame. Не цель и не currentTime: пока декодер догоняет
  // (воспроизведение до ×6) или пока идёт перемотка, оба отличаются от того, что реально нарисовано.
  // Маска экрана обязана сидеть на ТОМ ЖЕ кадре, что и картинка, иначе её сносит вбок: при движении
  // вниз квад берётся из более позднего кадра (монитор там левее и крупнее) — маска уезжает влево,
  // при движении вверх — вправо. Ровно это и видно глазом.
  let walkFrameT = -1;
  const WALK_FPS = 24;                 // ролик ровно 24 к/с (timescale 12288 / delta 512, 240 кадров)
  const WALK_TIMEOUT = 250;            // сторож: 250 мс = 3× худшей измеренной перемотки (83.9 мс) вместо прежних 900
  let walkWantFrame = -1, walkSeekFrame = -1, walkMiss = 0, walkSeekMs = 0, walkSeeks = 0;
  function walkActive() { return walkReady && walkHas && S.walk > 0.001; }
  function walkMatrix() {
    const s = Math.max(vw / WALK_W, vh / WALK_H);
    return { s, tx: (vw - WALK_W * s) / 2, ty: (vh - WALK_H * s) / 2 };
  }
  function walkGrab(mediaTime) {
    if (walkVideo.readyState < 2) return;
    // rVFC отдаёт mediaTime — presentation-время именно того кадра, который забран.
    // Без rVFC берём currentTime: после seeked он точен до середины кадра.
    const t = (typeof mediaTime === 'number' && isFinite(mediaTime)) ? mediaTime : walkVideo.currentTime;
    const i = Math.floor(t * WALK_FPS + 0.25);
    // один и тот же кадр приходит дважды (rVFC + seeked) — второй раз не перерисовываем:
    // drawImage 1280×720 стоит 0.2–0.3 мс медианы, лишний вызов на каждой перемотке не нужен
    if (walkHas && walkFrameT >= 0 && i === Math.floor(walkFrameT * WALK_FPS + 0.25)) { walkFrameT = t; return; }
    walkCtx.drawImage(walkVideo, 0, 0, WALK_W, WALK_H);
    walkFrameT = t;
    if (!walkHas) walkAt = arrived();
    walkHas = true;
  }
  function walkTarget() { return Math.min(Math.max(S.walk, 0), 1) * (walkVideo.duration - 1 / 24); }
  // ЕДИНСТВЕННЫЙ вход перемотки: вызывается из общего rAF-цикла ПОСЛЕ того, как сглаженный p
  // разложен по S. Своего сглаживания у ролика нет — время ролика идёт по тем же часам, что камера и SVG.
  // ЗАКОН VKV: ОДНА перемотка на кадр rAF, флаг isSeeking, БЕЗ воспроизведения.
  // Прежний комментарий («seek→seeked стоит 60–90 мс на кадр») мерил ДРУГОЙ файл — соседний
  // gemini_walkthrough_ok.mp4 с GOP 240 (шаг назад там 93.4 мс). На этом ассете (all-intra,
  // 240 ключевых из 240) замерено в Chrome 148 на десктопе тремя прогонами: медиана 2.4–3.3 мс,
  // p90 2.6–10.2, p99 4.4–24.7, единичный максимум 83.9 мс; 251–494 перемотки/с при потребности 60;
  // попадание точное (frameErrMax = 0 на 2400+ перемотках), децимации нет (194 уникальных из 194).
  // A/B на 60 Гц: перемотка — отставание 0 кадров (max 2.95); догон воспроизведением ×6 — 3.7 кадра
  // на 300 px/с и до 26.8 на 3000 px/с, скачок 24 кадра при физическом поле 7, снос маски 203 px.
  function walkSync() {
    if (!walkReady || !isFinite(walkVideo.duration)) return false;
    if (!walkVideo.paused) walkVideo.pause();                 // в подаче воспроизведения нет вовсе
    if (walkSeeking && performance.now() - walkSeekAt > WALK_TIMEOUT) walkSeeking = false;   // сторож
    const n = Math.max(1, Math.round(walkVideo.duration * WALK_FPS));   // 240 кадров
    walkWantFrame = Math.min(n - 1, Math.max(0, Math.round(Math.min(Math.max(S.walk, 0), 1) * (n - 1))));
    if (walkSeeking) return true;                             // ровно одна перемотка в полёте
    if (walkVideo.readyState < 1) return false;
    if (walkWantFrame === walkSeekFrame) return false;        // нужный кадр уже заказан/показан
    walkSeekFrame = walkWantFrame;
    walkSeeking = true; walkSeekAt = performance.now();
    walkVideo.currentTime = (walkWantFrame + 0.5) / WALK_FPS; // середина кадра: попадание без промаха
    return true;
  }
  // ── Поздний ассет вводится по ВРЕМЕНИ, а не подменой кадра ──────────────
  // Ветка рендера выбиралась по факту наличия битмапа: пока плита E не пришла, при glass≈1
  // рисовался Арарат, а с её приходом мир менялся за один кадр. Теперь у каждого позднего
  // ассета свой кроссфейд 320 мс, независимый от скролла.
  const FADE_MS = 320;
  let eAt = 0, walkAt = 0;
  const fadeK = (at) => at ? Math.min(1, (performance.now() - at) / FADE_MS) : 0;
  // в стоп-кадре и в статике кроссфейда нет: ассет считается пришедшим давно
  const arrived = () => performance.now() - (loopOn ? 0 : FADE_MS);
  function assetFading() { return (!!eAt && fadeK(eAt) < 1) || (!!walkAt && fadeK(walkAt) < 1); }
  function walkLoad() {
    if (!walkVideo || walkVideo.dataset.loaded) return;
    walkVideo.dataset.loaded = '1';
    // Обработчики НИЧЕГО не рисуют: забирают кадр и будят общий цикл (закон «скролл и события не рисуют»)
    walkVideo.addEventListener('loadedmetadata', () => { walkReady = true; kick(); });
    walkVideo.addEventListener('seeked', () => {
      walkSeeking = false;
      walkSeekMs = performance.now() - walkSeekAt; walkSeeks++;
      // источник обязан быть перематываемым: python http.server отвечает 200 на Range и отдаёт
      // seekable=[0,0] — ВСЕ перемотки клемпятся в кадр 0 (замер: frameErrMax = 239, скраб мёртв).
      // Три промаха подряд — ролик снимаем, иначе весь отрезок стоит на кадре 0.
      if (walkSeekFrame >= 0 && Math.abs(walkVideo.currentTime - (walkSeekFrame + 0.5) / WALK_FPS) > 1 / WALK_FPS) {
        if (++walkMiss >= 3) { walkReady = false; walkHas = false; walkFrameT = -1; }
      } else walkMiss = 0;
      walkGrab(); kick();
    });
    walkVideo.addEventListener('loadeddata', () => { walkGrab(); kick(); });
    walkVideo.addEventListener('error', () => { walkReady = false; walkHas = false; walkFrameT = -1; walkSeeking = false; walkSeekFrame = -1; });
    if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
      const onFrame = (now, md) => { frameCount++; walkGrab(md && md.mediaTime); kick(); walkVideo.requestVideoFrameCallback(onFrame); };
      walkVideo.requestVideoFrameCallback(onFrame);
    }
    walkVideo.preload = 'auto';
    // blob-URL: полностью перематываемый источник независимо от поддержки Range у сервера
    // (python http.server на dev отдаёт seekable=[0,0]); файл all-intra, 7 МБ, грузится сразу после LCP
    fetch(withV(walkVideo.dataset.src)).then(r => { if (!r.ok) throw new Error('walk'); return r.blob(); })
      .then(b => { walkVideo.src = URL.createObjectURL(b); walkVideo.load(); })
      .catch(() => { walkVideo.src = withV(walkVideo.dataset.src); walkVideo.load(); });
  }
  // квад экрана во вьюпорте: с ролика — последний кадр (база 1280×720), иначе — плита
  // Кадр, с которого экран монитора в ролике читается как ровная рамка (покадровый трек).
  // До него страница на мониторе не показывается: рамки ещё нет.
  let trackFirst = -1;
  // НОМЕР КАДРА, КОТОРЫЙ СЕЙЧАС НА ЭКРАНЕ. Трек посчитан покадрово, кадр i лежит на i/fps,
  // поэтому индекс — это просто presentation-время, умноженное на частоту кадров трека.
  function trackFps() { const tr = quads && quads.walk_track; return (tr && tr.fps) || 24; }
  function shownFrame() {
    const tr = quads && quads.walk_track;
    if (!tr || !tr.quads || !tr.quads.length) return -1;
    if (walkFrameT < 0) return -1;
    // перемотка садится в СЕРЕДИНУ кадра ((i+0.5)/fps), rVFC отдаёт его начало (i/fps) —
    // округление вниз со сдвигом 0.25 кадра даёт один и тот же индекс в обоих случаях.
    // Прежний Math.round на середине кадра дал бы i+1 и увёл маску на ход камеры за кадр (до 17.5 px).
    return Math.min(tr.quads.length - 1, Math.max(0, Math.floor(walkFrameT * trackFps() + 0.25)));
  }
  function trackQuadAt(t01) {
    const tr = quads.walk_track;
    if (!tr || !tr.quads || !tr.quads.length) return null;
    const n = tr.quads.length;
    // квад берётся ТОЧНО по номеру кадра: трек посчитан покадрово, подстановка соседа
    // сместила бы маску на ход камеры за кадр (до 14 px). Нет квада — нет экрана.
    const i = Math.min(n - 1, Math.max(0, Math.round(t01 * (n - 1))));
    return tr.quads[i] || null;
  }
  // доля ролика, с которой экран уже отслежен (страница может светиться на мониторе)
  function trackStart() {
    const tr = quads.walk_track;
    if (!tr || !tr.quads) return 1;
    if (trackFirst < 0) { trackFirst = (typeof tr.wake_from === 'number') ? tr.wake_from : ((typeof tr.first === 'number') ? tr.first : tr.quads.findIndex(q => q)); if (trackFirst < 0) trackFirst = tr.quads.length; }
    return trackFirst / Math.max(1, tr.quads.length - 1);
  }
  // null = на этом кадре ролика рамка экрана не отслежена, показывать страницу негде
  function screenQuadView() {
    if (walkActive()) {
      // квад берётся по ПОКАЗАННОМУ кадру, а не по цели скролла: картинка и маска обязаны
      // приходить из одного и того же кадра, иначе разница во времени читается как боковой снос
      const i = shownFrame();
      if (i < 0) return null;
      const q = quads.walk_track.quads[i];
      if (!q) return null;
      const M = walkMatrix();
      return q.map(p => [p[0] * M.s + M.tx, p[1] * M.s + M.ty]);
    }
    // ролик уже должен вести экран (S.walk > 0), но кадра нет — показывать страницу негде.
    // Прежний молчаливый фолбэк на квад ПЛИТЫ телепортировал маску на 71–497 px (замер: 468 px на p=0.75).
    if (S.walk > 0.001) return null;
    return quads.screen_quad.map(toView);
  }

  // помещается ли квад экрана в кадр целиком (с небольшим допуском на скруглённые углы)
  function quadInsideView(q) {
    const m = 2;
    for (let i = 0; i < q.length; i++) {
      if (q[i][0] < -m || q[i][0] > vw + m || q[i][1] < -m || q[i][1] > vh + m) return false;
    }
    return true;
  }

  // ── Слои SVG: недостающие узлы (свечение тремя штрихами, хвост искры, тень букв, травление) создаём здесь,
  //    чтобы разметка всех четырёх страниц оставалась одной ──
  const NS = 'http://www.w3.org/2000/svg';
  function ensure(parent, tag, id, cls, before) {
    let el = parent.querySelector('#' + id);
    if (el) return el;
    el = document.createElementNS(NS, tag);
    el.setAttribute('id', id);
    if (cls) el.setAttribute('class', cls);
    if (before) parent.insertBefore(el, before); else parent.appendChild(el);
    return el;
  }
  const edgePath = svgSolid.querySelector('#hsEdge');
  const edgeBody = svgSolid.querySelector('#hsEdgeBody');
  const edgeShadow = svgSolid.querySelector('#hsEdgeShadow');
  const glowPath = svgLight.querySelector('#hsGlow');
  const spark = svgLight.querySelector('#hsSpark');
  const glow2 = ensure(worldLight, 'path', 'hsGlow2', 'hs__glow-2', spark);
  const glow3 = ensure(worldLight, 'path', 'hsGlow3', 'hs__glow-3', spark);
  const sparkTail = ensure(worldLight, 'path', 'hsSparkTail', 'hs__spark-tail', spark);
  if (glowPath) glowPath.removeAttribute('filter');
  if (glowPath) glowPath.style.filter = 'none';
  if (spark) {
    spark.setAttribute('r', '120');
    const g = svgLight.querySelector('#hsSparkGrad');
    if (g) {
      g.innerHTML = '';
      [['0', '#FFFFFF', '1'], ['0.12', '#FFF3D0', '0.9'], ['0.3', '#FAE0A2', '0.45'], ['1', '#F2C249', '0']].forEach(([o, c, a]) => {
        const st = document.createElementNS(NS, 'stop');
        st.setAttribute('offset', o); st.setAttribute('stop-color', c); st.setAttribute('stop-opacity', a);
        g.appendChild(st);
      });
    }
  }
  const swooshMaskPaths = Array.from(root.querySelectorAll('.hs__swoosh-mask-path'));
  const swooshMaskPath = swooshMaskPaths[0];
  const swooshLight = svgLight.querySelector('#hsSwooshLight');
  const swooshGroup = svgSolid.querySelector('#hsSwoosh');
  const headGroup = svgSolid.querySelector('#hsHead');
  const fillPoly = svgSolid.querySelector('#hsFill');
  const shapesGroup = svgSolid.querySelector('#hsShapes');
  const snowGroup = svgSolid.querySelector('#hsSnow');
  const lettersGroup = svgSolid.querySelector('#hsLetters');
  const taglineGroup = svgSolid.querySelector('#hsTagline');
  // клоны: травление под всем знаком (светлый вверх-влево, тёмный вниз-вправо), тень под буквами
  const etchLight = ensure(worldSolid, 'g', 'hsEtchLight', 'hs__etch-light', fillPoly);
  const etchDark = ensure(worldSolid, 'g', 'hsEtchDark', 'hs__etch-dark', fillPoly);
  const lettersShadow = ensure(worldSolid, 'g', 'hsLettersShadow', 'hs__letters-shadow', lettersGroup);
  const logoGroups = [etchLight, etchDark, shapesGroup, snowGroup, swooshGroup, swooshLight, lettersShadow, lettersGroup, taglineGroup];
  let letterPaths = [];      // буквы L·T·C·G — стаггер появления

  let edgeLen = 0, lastMorph = -1, lastD = '', swooshLen = 0;
  let gildPath = null, gildGrad = null;
  let mainD = '', thirdD = '', lowerD = '', gildExact = null;   // точные формы знака для canvas (с прозрачным снегом)
  let firstFrame = false;
  function gildGradient() {
    if (!gildGrad) {
      gildGrad = ctx.createLinearGradient(EMB.left, EMB.top + EMB.h, EMB.left + EMB.w, EMB.top);
      gildGrad.addColorStop(0, '#C4922B');
      gildGrad.addColorStop(0.5, '#F2C249');
      gildGrad.addColorStop(0.8, '#FAE0A2');
      gildGrad.addColorStop(1, '#C4922B');
    }
    return gildGrad;
  }

  function morphD(m) {
    if (!ridgePts || !emblemPts) return '';
    let d = '';
    for (let i = 0; i < N; i++) {
      const x = ridgePts[i][0] + (emblemPts[i][0] - ridgePts[i][0]) * m;
      const y = ridgePts[i][1] + (emblemPts[i][1] - ridgePts[i][1]) * m;
      d += (i ? ' L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    return d;
  }

  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const smooth = (v, a, b) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;

  function drawPlate(img, alpha) {
    if (!img || alpha <= 0.001) return;
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.drawImage(img, 0, 0, PLATE_W, PLATE_H);
    ctx.globalAlpha = 1;
  }

  // ── «Матовое стекло»: ОДИН непрерывный рамп вместо пяти дискретных уровней ──
  // Муть создаётся масштабом: уже размытая текстура сжимается в промежуточный буфер шириной
  // W(r) = 1280 → 44 и растягивается обратно на кадр. r меняется непрерывно, поэтому ступеней нет
  // (прежние пять drawPlate давали два удара и заморозку между ними — forensic, «стекло под микроскопом»).
  const soft = document.createElement('canvas'); soft.width = 1280; soft.height = 720;
  const softCtx = soft.getContext('2d', { alpha: false });
  if (softCtx) { softCtx.imageSmoothingEnabled = true; softCtx.imageSmoothingQuality = 'high'; }
  // Два размытых мира смешиваются В МАЛОМ БУФЕРЕ и кладутся на кадр ОДНОЙ заливкой с alpha = hz.
  // Прежде их клали двумя заливками (hz·(1−wE) и hz·wE), и в пике оставалось (1−a1)(1−a2) = 25 %
  // РЕЗКОЙ подложки — ровно там, где меняется мир: сквозь «муть» читались и склоны, и мебель.
  function drawSoftPair(srcA, srcE, mix, r, alpha) {
    if (alpha <= 0.002 || !softCtx) return;
    const k = Math.min(1, Math.max(0, r));
    // экспоненциальная лестница по ширине: глаз читает муть логарифмически
    const w = Math.max(44, Math.round(1280 * Math.pow(0.034, k)));
    const h = Math.max(25, Math.round(w * 720 / 1280));
    const a = srcE ? Math.min(1, Math.max(0, mix)) : 0;
    const base = (a >= 0.999) ? srcE : srcA;
    if (!base) return;
    softCtx.globalAlpha = 1;
    softCtx.drawImage(base, 0, 0, w, h);
    if (a > 0.001 && a < 0.999 && srcE) {
      softCtx.globalAlpha = a; softCtx.drawImage(srcE, 0, 0, w, h); softCtx.globalAlpha = 1;
    }
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.drawImage(soft, 0, 0, w, h, 0, 0, PLATE_W, PLATE_H);
    ctx.globalAlpha = 1;
  }
  // колокол мути: 0 на входе, 1 в середине (там прячется смена мира), 0 на выходе — ровно кадр 0 ролика
  function haze(g) { return Math.pow(Math.sin(Math.PI * clamp01(g)), 0.62); }

  let renderCount = 0, frameCount = 0;
  function render() {
    if (!ctx || !plates.A || !vw || !vh) return;
    renderCount++;
    computeCamera();
    const { s, tx, ty } = cam;
    const on = S.draw > 0;
    const g = S.glass;
    const eIn = plates.E ? fadeK(eAt) : 0;   // плита офиса вводится по времени, если пришла поздно
    const wE = smooth(g, 0.34, 0.66) * eIn; // смена мира A → E: ровно под пиком мути, поэтому не видна
    const hz = g > 0.001 ? haze(g) : 0;     // непрерывная муть
    const fadeA = 1 - smooth(g, 0, 0.4);    // гаснет всё, что принадлежит миру Арарата

    // 1. canvas
    ctx.setTransform(s * dpr, 0, 0, s * dpr, tx * dpr, ty * dpr);
    ctx.globalAlpha = 1;
    const walkIn = walkHas ? fadeK(walkAt) : 0;
    const walkA = walkActive() ? smooth(S.walk, 0, 0.05) * walkIn : 0;
    const walkCovers = walkA >= 0.999;
    if (walkCovers) {
      // ролик закрывает кадр целиком — плиты не рисуем (одна операция на кадр)
    } else if (wE < 0.999 || !plates.E) {
      ctx.drawImage(plates.A, 0, 0, PLATE_W, PLATE_H);
      if (plates.D && S.dusk > 0.001) drawPlate(plates.D, S.dusk);
      // фото притемняется вокруг знака — золото выходит вперёд; виньетка начинается с позолоты (0.40),
      // чтобы жёлтое не спорило с персиковым небом
      const vigK = Math.max(smooth(S.fill, 0, 1) * 0.55, Math.min(1, S.shapes)) * 0.85 * fadeA;
      if (vigK > 0.001 && embVig) {
        ctx.save();
        ctx.globalAlpha = vigK;
        ctx.fillStyle = embVig;
        ctx.fillRect(0, 0, PLATE_W, PLATE_H);
        ctx.restore();
      }
      // позолота: цвет и контраст золота поверх реальной фактуры склонов (color + overlay, 0→0.9),
      // затем свет слева-сверху — тёплый блик по верхней части формы
      if (S.fill > 0.001 && gildPath && fadeA > 0.001) {
        const k = Math.min(1, S.fill) * 0.9 * (1 - 0.35 * S.shapes) * fadeA;
        const useExact = S.morph >= 0.999 && gildExact;
        const passes = useExact
          ? [[gildPath, 1 - S.shapes, 'nonzero'], [gildExact, S.shapes, 'evenodd']]
          : [[gildPath, 1, 'nonzero']];
        ctx.save();
        passes.forEach(([path, w, rule]) => {
          if (w <= 0.001) return;
          ctx.globalCompositeOperation = 'color';
          ctx.globalAlpha = k * w;
          ctx.fillStyle = gildGradient();
          ctx.fill(path, rule);
          ctx.globalCompositeOperation = 'overlay';
          ctx.globalAlpha = k * w * 0.8;
          ctx.fillStyle = '#F2C249';
          ctx.fill(path, rule);
          // ключ слева-сверху: мягкая светлая заливка по верхней трети формы
          if (embKey) {
            ctx.globalCompositeOperation = 'soft-light';
            ctx.globalAlpha = k * w * 0.9;
            ctx.fillStyle = embKey;
            ctx.fill(path, rule);
          }
        });
        ctx.restore();
      }
      // мир офиса поверх мира Арарата — под пиком мути
      if (wE > 0.001 && plates.E) drawPlate(plates.E, wE);
    } else {
      ctx.drawImage(plates.E, 0, 0, PLATE_W, PLATE_H);
    }
    // непрерывный рамп мути: одна текстура на мир, между ними тот же кроссфейд wE
    if (!walkCovers && hz > 0.002) {
      drawSoftPair(blur.A40 || plates.D || plates.A, blur.E40 || plates.E, wE, hz, hz);
    }

    // 1-тер. ролик Gemini: стекло → офис → монитор. Кадр 0 = плита стекла, поэтому вход бесшовный;
    // рисуем cover-fit во вьюпорт поверх плит, короткий кроссфейд на входе прячет разницу аспектов
    if (walkA > 0.001) {
      const a = walkA;
      const M = walkMatrix();
      ctx.setTransform(M.s * dpr, 0, 0, M.s * dpr, M.tx * dpr, M.ty * dpr);
      ctx.globalAlpha = a;
      ctx.drawImage(walkFrame, 0, 0, WALK_W, WALK_H);
      ctx.globalAlpha = 1;
    }

    // 1-бис. атмосфера в координатах вьюпорта: грейд, виньетка, ключ — три заливки кешированными градиентами
    const office = smooth(g, 0.5, 1);                 // 0 — Арарат, 1 — офис
    const live = 1 - Math.min(1, S.navy);             // всё гаснет вместе с офисом
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // грейд dusk — только полоса горизонта (y 400–660 плиты), не весь кадр; в офисе — весь кадр
    const gradeK = (0.16 + 0.16 * office) * live;
    if (gradeK > 0.001) {
      ctx.globalCompositeOperation = 'soft-light';
      ctx.globalAlpha = gradeK; ctx.fillStyle = gradeGrad; ctx.fillRect(0, 0, vw, vh);
    }
    if (S.dusk > 0.001 && fadeA > 0.001 && duskBand) {
      // тот же кешированный градиент, но заливка — с матрицей плиты: координаты градиента живут
      // в user space, поэтому полоса горизонта сама едет с камерой
      ctx.setTransform(s * dpr, 0, 0, s * dpr, tx * dpr, ty * dpr);
      ctx.globalCompositeOperation = 'soft-light';
      ctx.globalAlpha = 0.22 * S.dusk * fadeA * live; ctx.fillStyle = duskBand; ctx.fillRect(0, 0, PLATE_W, PLATE_H);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    const keyK = 0.12 * office * live * (1 - 0.6 * S.dolly);
    if (keyK > 0.001) {
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = keyK; ctx.fillStyle = keyGrad; ctx.fillRect(0, 0, vw, vh);
    }
    const vigK = (0.16 + 0.10 * S.dusk + 0.24 * office + 0.12 * S.dolly) * live;
    if (vigK > 0.001) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = vigK; ctx.fillStyle = vigGrad; ctx.fillRect(0, 0, vw, vh);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    // финал: офис гаснет в цвет кожи
    if (S.navy > 0.001) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = Math.min(1, S.navy);
      ctx.fillStyle = SKIN_BG;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
    }
    if (!firstFrame) { firstFrame = true; if (poster) poster.classList.add('is-hidden'); }

    // 2+3. svg — одна матрица на оба мира
    const m = 'matrix(' + s + ',0,0,' + s + ',' + tx + ',' + ty + ')';
    worldLight.setAttribute('transform', m);
    worldSolid.setAttribute('transform', m);
    svgLight.style.opacity = String(fadeA);
    const solidO = (1 - S.navy) * (1 - S.logoFade);
    svgSolid.style.opacity = String(solidO);
    svgSolid.style.visibility = solidO > 0.002 ? 'visible' : 'hidden';
    svgLight.style.visibility = (S.glass >= 0.999 || solidO <= 0.002) && S.p > SLICE_END ? 'hidden' : 'visible';

    // хребет → кромка
    if (edgePath && ridgePts) {
      const strokes = [edgePath, edgeBody, edgeShadow, glowPath, glow2, glow3, sparkTail].filter(Boolean);
      if (S.morph !== lastMorph) {
        lastD = morphD(S.morph);
        const closed = lastD + ' L' + emblemBase().join(' ') + ' Z';
        strokes.forEach(el => el.setAttribute('d', lastD));
        fillPoly.setAttribute('d', closed);
        gildPath = new Path2D(closed);
        edgeLen = edgePath.getTotalLength();
        lastMorph = S.morph;
      }
      // прорисовка луча
      const main = [edgePath, edgeBody, edgeShadow, glowPath, glow2, glow3].filter(Boolean);
      if (S.draw < 0.999) {
        const dash = edgeLen;
        main.forEach(el => { el.style.strokeDasharray = dash + ' ' + dash; el.style.strokeDashoffset = String(dash * (1 - S.draw)); });
      } else {
        main.forEach(el => { el.style.strokeDasharray = 'none'; });
      }
      edgePath.style.opacity = S.draw > 0 ? 0.95 * fadeA : 0;
      const gl = on ? S.glow * fadeA : 0;
      glowPath.style.opacity = 0.14 * gl;
      glow2.style.opacity = 0.22 * gl;
      glow3.style.opacity = 0.38 * gl;
      // тёмная нить под линией — только пока луч бежит по снегу (гаснет с позолотой)
      if (edgeShadow) edgeShadow.style.opacity = on ? (0.55 * (1 - S.fill) * fadeA) : 0;
      // искра на конце луча — спрайт + хвост по трассе
      if (spark) {
        if (S.draw > 0.002 && S.draw < 0.998) {
          const pt = edgePath.getPointAtLength(edgeLen * S.draw);
          spark.setAttribute('transform', 'translate(' + pt.x + ',' + pt.y + ')');
          spark.style.opacity = 0.95;
          const tail = Math.min(edgeLen * 0.12, 260);
          sparkTail.style.strokeDasharray = tail + ' ' + edgeLen;
          sparkTail.style.strokeDashoffset = String(-(edgeLen * S.draw - tail));
          sparkTail.style.opacity = 0.7;
        } else {
          spark.style.opacity = 0;
          sparkTail.style.opacity = 0;
        }
      }
    }

    // свош: маска-прорисовка (одна кривая в двух svg)
    if (swooshMaskPath && swooshLen) {
      const L = swooshLen;   // длина постоянна после placeLogo — getTotalLength() в кадре не вызывается
      swooshMaskPaths.forEach(p => { p.style.strokeDasharray = L + ' ' + L; p.style.strokeDashoffset = String(L * (1 - S.swoosh)); });
      swooshLight.style.opacity = S.swoosh > 0 ? Math.max(0, (1 - S.head * 0.6) * (1 - S.fill)) : 0;
      swooshGroup.style.opacity = S.swoosh > 0 ? Math.min(1, S.swoosh * 1.4) : 0;
      headGroup.style.opacity = S.head;
      headGroup.setAttribute('transform', headTransform(S.head));
    }

    // точные формы знака: под ними до стекла остаётся фактура склонов (0.86), на стекле — сплошной металл
    fillPoly.style.opacity = 0;
    shapesGroup.style.opacity = S.shapes * (0.86 + 0.14 * Math.min(1, S.logoSit));
    snowGroup.style.opacity = 0;
    edgeBody.style.opacity = on ? (0.95 - 0.6 * S.shapes) * fadeA : 0;
    // буквы: появление opacity + подъём со стаггером, без blur-фильтра
    lettersGroup.style.opacity = S.letters > 0 ? 1 : 0;
    letterPaths.forEach((p, i) => {
      const k = smooth(S.letters, i * 0.14, 0.58 + i * 0.14);
      p.style.opacity = k.toFixed(3);
      p.setAttribute('transform', 'translate(0,' + ((1 - k) * 12).toFixed(2) + ')');
    });
    taglineGroup.style.opacity = S.tagline;
    lettersShadow.style.opacity = (0.42 * Math.min(1, S.letters) * (1 - Math.min(1, S.logoSit))).toFixed(3);
    etchLight.style.opacity = (0.55 * Math.min(1, S.logoSit)).toFixed(3);
    etchDark.style.opacity = (0.28 * Math.min(1, S.logoSit)).toFixed(3);

    // знак садится на перегородку: единая матрица всей фирменной сборки → квад панели
    if (S.logoSit > 0.001 && panelM) {
      const t = S.logoSit;
      const M = logoM.map((v, i) => lerp(v, panelM[i], t));
      const attr = 'matrix(' + M.join(',') + ')';
      logoGroups.forEach(gr => gr.setAttribute('transform', attr));
      headGroup.setAttribute('transform', attr);
    } else if (logoSat) {
      logoGroups.forEach(gr => gr.setAttribute('transform', logoT));
    }
    logoSat = S.logoSit > 0.001;
    setClass(root, 'is-glass', S.logoSit > 0.5);

    // 4. зерно: спрайт сдвигается по p — живёт только пока кадр движется; плотность по миру
    if (grain) {
      const gx = Math.round(((S.p * 41.3) % 1) * 256), gy = Math.round(((S.p * 27.7 + 0.31) % 1) * 256);
      grain.style.transform = 'translate3d(' + gx + 'px,' + gy + 'px,0)';
      setVar(grain, 'opacity', ((0.10 + 0.06 * S.dusk + 0.05 * smooth(g, 0.1, 0.6) * (1 - office) + 0.03 * office) * (1 - 0.6 * S.navy)).toFixed(3));
    }
    // скрим первого кадра: гаснет с сумерками и уходит вместе со знаком в углу
    setProp(stage, '--hs-scrim', ((1 - 0.5 * S.dusk) * (1 - S.markOut)).toFixed(3));

    // 5. знак в углу — часть утверждённой половины: гаснет на подлёте к монитору.
    //    Стекло шапки и переключатель приходят после ворот классом is-past (CSS, не кадр).
    if (head) setProp(head, '--brand-o', (1 - S.markOut).toFixed(3));
    // «Пропустить»: уходит с началом наезда на монитор — дальше выход из хиро только вперёд
    if (skip) { const gone = S.walk > 0.5 || smooth(S.dolly, 0, 0.5) > 0.5 || S.screenIn > 0.2; if (setClass(skip, 'is-gone', gone)) skip.inert = gone; }

    // 6. DOM-экран монитора = живая верхушка страницы
    renderScreen();

    if (hint) setVar(hint, 'opacity', S.p > 0.03 ? '0' : '1');
    if (hud) hud.textContent = 'p=' + S.p.toFixed(3) + ' zoom=' + (cam.zoom || S.zoom).toFixed(2) + ' glass=' + S.glass.toFixed(2) + ' hz=' + hz.toFixed(2) + ' walk=' + S.walk.toFixed(2) + (walkReady ? '' : '!') + ' scr=' + S.screenIn.toFixed(2) + ' full=' + S.full.toFixed(2) + ' pgin=' + PG.in.toFixed(2) + (locked ? ' LOCK' : '');
  }
  let logoSat = false;

  // ── Запись в DOM только при реальном изменении: восемь var'ов и шесть classList в кадр
  //    (forensic) превращаются в ноль операций, пока значение не поменялось ──
  const lastProp = new WeakMap();
  function memo(el, key, v) {
    let m = lastProp.get(el);
    if (!m) { m = Object.create(null); lastProp.set(el, m); }
    if (m[key] === v) return false;
    m[key] = v; return true;
  }
  function setProp(el, name, v) { if (el && memo(el, name, v)) el.style.setProperty(name, v); }
  function setVar(el, name, v) { if (el && memo(el, name, v)) el.style[name] = v; }
  function setClass(el, name, on) { if (!el || !memo(el, '.' + name, on)) return false; el.classList.toggle(name, on); return true; }

  // ── Гомография: 4 угла → matrix3d ───────────────────────
  function adj(m) {
    return [
      m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4],
      m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5],
      m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3],
    ];
  }
  function multmm(a, b) {
    const c = new Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      let v = 0;
      for (let k = 0; k < 3; k++) v += a[3 * i + k] * b[3 * k + j];
      c[3 * i + j] = v;
    }
    return c;
  }
  function multmv(m, v) {
    return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
  }
  function basisToPoints(p1, p2, p3, p4) {
    const m = [p1[0], p2[0], p3[0], p1[1], p2[1], p3[1], 1, 1, 1];
    const v = multmv(adj(m), [p4[0], p4[1], 1]);
    return multmm(m, [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]]);
  }
  function homography(src, dst) {
    const H = multmm(basisToPoints(dst[0], dst[1], dst[2], dst[3]), adj(basisToPoints(src[0], src[1], src[2], src[3])));
    const w = H[8] || 1;
    return H.map(v => v / w);
  }
  function matrix3d(h) {
    return 'matrix3d(' + [h[0], h[3], 0, h[6], h[1], h[4], 0, h[7], 0, 0, 1, 0, h[2], h[5], 0, h[8]].map(v => v.toFixed(6)).join(',') + ')';
  }
  // квад экрана → фронтальный прямоугольник того же центра и средних сторон; t — доля выпрямления
  function rectifyQuad(Q, t) {
    if (t <= 0.001) return Q;
    const cx = (Q[0][0] + Q[1][0] + Q[2][0] + Q[3][0]) / 4, cy = (Q[0][1] + Q[1][1] + Q[2][1] + Q[3][1]) / 4;
    const w = (Math.hypot(Q[1][0] - Q[0][0], Q[1][1] - Q[0][1]) + Math.hypot(Q[2][0] - Q[3][0], Q[2][1] - Q[3][1])) / 2;
    const h = (Math.hypot(Q[3][0] - Q[0][0], Q[3][1] - Q[0][1]) + Math.hypot(Q[2][0] - Q[1][0], Q[2][1] - Q[1][1])) / 2;
    const R = [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]];
    return Q.map((q, i) => [lerp(q[0], R[i][0], t), lerp(q[1], R[i][1], t)]);
  }

  // Экран монитора = верхушка настоящей страницы. Никакого «чёрный → синий»: страница
  // проявляется на экране такой, какая она есть, и гомография разворачивает её на весь вьюпорт.
  const PG = { in: 0 };
  let pgWaveOn = false;
  function renderScreen() {
    if (!screen || !quads) return;
    // экран виден только там, где рамка монитора отслежена — иначе маска встала бы мимо.
    // Признак — НАЛИЧИЕ квада на этом кадре, а не порог прогресса
    const QV = screenQuadView();
    // Мало иметь квад — он должен ПОМЕЩАТЬСЯ в кадр. На пропорции 16:10 (макбуки, 1440×900,
    // 1280×800) на кадрах 46–52 монитор ещё частично за краем: замерено, квад вылезает на
    // 63–107 px, и страница торчит за границей кадра. Пока идёт наезд (S.full ≈ 0) ждём,
    // когда рамка войдёт целиком; на развороте проверка снимается — там квад сам едет к углам.
    const QV_IN = QV && (S.full > 0.02 || quadInsideView(QV));
    const vis = S.screenIn > 0.002 && !!QV_IN;
    setClass(screen, 'is-on', vis);
    if (screenGlow) setClass(screenGlow, 'is-on', vis);
    if (!vis) return;

    const f = S.full;
    // квад экрана: перспектива кадра выпрямляется вместе с проявлением, затем — к углам вьюпорта
    // перспектива берётся из кадра ролика как есть: маска ПОЯВЛЯЕТСЯ на месте, а не выпрямляется и не вылетает
    // Пока мы летим, экран живёт в перспективе кадра: выпрямление начинается только вместе
    // с разворотом (S.full), а не с проявлением — иначе маска отрывается от рамки монитора.
    const Q = rectifyQuad(QV, 0.85 * smooth(f, 0, 0.4));
    const T = [[0, 0], [vw, 0], [vw, vh], [0, vh]];
    const C = Q.map((q, i) => [lerp(q[0], T[i][0], f), lerp(q[1], T[i][1], f)]);
    const src = [[0, 0], [vw, 0], [vw, vh], [0, vh]];
    const tr = (f >= 0.999) ? 'none' : matrix3d(homography(src, C));
    setVar(screen, 'transform', tr);
    setVar(screen, 'opacity', S.screenIn.toFixed(3));
    // «даль» экрана: 1 — маленький в мониторе, 0 — развёрнут на вьюпорт.
    // По ней CSS убавляет зерно и пелену: на весь экран страница выходит чистой.
    setProp(screen, '--scr-far', (1 - Math.max(f, smooth(S.walk, 0.62, 1) * 0.55)).toFixed(3));
    const flat = f >= 0.999;
    setVar(screen, 'clipPath', flat ? 'none' : 'inset(0 round ' + (6 * (1 - f)).toFixed(2) + 'px)');
    setClass(screen, 'is-flat', flat);
    if (screenGlow) {
      setVar(screenGlow, 'transform', tr);
      setVar(screenGlow, 'opacity', S.screenIn.toFixed(3));
      setProp(screenGlow, '--wake', S.screenIn.toFixed(3));
      setProp(screenGlow, '--full', f.toFixed(3));
      const a = S.screenIn * 0.3 * (1 - f);
      setVar(screenGlow, 'boxShadow', '0 0 ' + Math.round(120 * S.screenIn) + 'px ' + Math.round(20 * S.screenIn) + 'px rgba(242,194,73,' + a.toFixed(3) + ')'
        + ', 0 60px 120px 20px rgba(12,27,58,' + (a * 1.4).toFixed(3) + ')');
    }
    // Вход содержимого — ОДИН раз и ПО ВРЕМЕНИ (0→1 за 0.7 с, стаггер и кривые в CSS).
    // Прежде весь шестиэлементный стаггер укладывался в 123 px прокрутки: один тик колеса
    // проигрывал волну за кадр — «не анимация, а статичное движение» (vkv_bar §5).
    // Скролл в этот момент занят посадкой гомографии, и волне незачем с ним конкурировать.
    if (pg) {
      if (!pgWaveOn) {
        pgWaveOn = true;
        if (hasGsap && !reduced && loopOn) gsap.to(PG, { in: 1, duration: 0.7, ease: 'expo.out', onUpdate: kick });
        else PG.in = 1;
      }
      setProp(pg, '--pg-in', PG.in.toFixed(3));
    }
    // языковой момент ведёт время (LANG.zoom из lock/unlock), а не скролл: трекинг больше не
    // анимируется — letter-spacing это layout, а движок пишет значение каждый кадр
    if (pgLangLine) setProp(pgLangLine, '--lang-zoom', LANG.zoom.toFixed(4));
    setClass(screen, 'is-live', f >= 0.999 || locked);
  }

  // ── Размещение эмблемы на плите ─────────────────────────
  // Блок гор: ширина 1050 плиты, Масис эмблемы = Масис фото, знак в настоящих пропорциях
  const EMB = { left: 0, top: 0, w: 0, h: 0, sx: 1, sy: 1 };
  let headTip = [0, 0], swooshScale = 1;

  function emblemBase() {
    return [EMB.left + EMB.w, EMB.top + EMB.h, EMB.left, EMB.top + EMB.h];
  }

  const LOGO_BLOCK_W = 1050;   // ширина блока гор эмблемы на плите (2560), пропорции знака не трогаем
  let logoT = '';               // единая матрица логотип → плита (вся фирменная сборка одним блоком)
  let logoM = null;             // та же матрица шестёркой [a,b,c,d,e,f]
  let panelM = null;            // матрица логотип → квад перегородки (аффинно: панель почти фронтальная)
  let lx0 = 0, ly0 = 0, ls = 1;

  function placeLogo() {
    const blk = logo.mountains_block;                 // [x0,y0,x1,y1] в единицах логотипа
    const bw = blk[2] - blk[0], bh = blk[3] - blk[1];
    const lMasis = logo.anchors.masis_apex;
    const pMasis = anchors.masis_apex;
    // Единый изотропный масштаб: знак в настоящих пропорциях. Общая точка с фото — вершина Масиса:
    // из неё эмблема «кристаллизуется» внутри горы, остальной знак ложится ниже, над городом.
    ls = LOGO_BLOCK_W / bw;
    EMB.sx = EMB.sy = ls;
    EMB.left = pMasis[0] - (lMasis[0] - blk[0]) * ls;
    EMB.top = pMasis[1];
    EMB.w = bw * ls; EMB.h = bh * ls;
    lx0 = EMB.left - blk[0] * ls; ly0 = EMB.top - blk[1] * ls;
    logoT = 'translate(' + lx0 + ',' + ly0 + ') scale(' + ls + ')';
    logoM = [ls, 0, 0, ls, lx0, ly0];
    logoGroups.forEach(g => g.setAttribute('transform', logoT));
    // те же формы для canvas: Path2D в координатах плиты
    if (mainD && typeof DOMMatrix !== 'undefined') {
      const M = new DOMMatrix([ls, 0, 0, ls, lx0, ly0]);
      gildExact = new Path2D();
      gildExact.addPath(new Path2D(mainD), M);
      if (thirdD) gildExact.addPath(new Path2D(thirdD), M);
      if (lowerD) gildExact.addPath(new Path2D(lowerD), M);
    }

    // верхняя кромка эмблемы → плита; хребет ресэмплируем по своему диапазону x, эмблему — по своему.
    // Точка i хребта переходит в точку i кромки: линия стягивается и заостряется в знак.
    const te = logo.top_edge.map(p => [lx0 + p[0] * ls, ly0 + p[1] * ls]);
    emblemPts = resampleByX(te, EMB.left, EMB.left + EMB.w);
    const rx0 = ridgePts[0][0], rx1 = ridgePts[ridgePts.length - 1][0];
    ridgePts = resampleByX(ridgePts, rx0, rx1);

    // свош и наконечник — тот же блок; маска прорисовки — квадратичная кривая по ходу своша
    const st = logo.anchors.swoosh_start, tip = logo.anchors.arrowhead_tip;
    const S0 = [lx0 + st[0] * ls, ly0 + st[1] * ls];
    headTip = [lx0 + tip[0] * ls, ly0 + tip[1] * ls];
    swooshScale = ls;
    const C = [S0[0] + (headTip[0] - S0[0]) * 0.72, S0[1] - (S0[1] - headTip[1]) * 0.08];
    const dMask = 'M' + S0[0] + ' ' + S0[1] + ' Q' + C[0] + ' ' + C[1] + ' ' + headTip[0] + ' ' + headTip[1];
    swooshMaskPaths.forEach(p => { p.setAttribute('d', dMask); p.style.strokeWidth = String(Math.round(150 * ls)); });
    swooshLen = swooshMaskPath ? swooshMaskPath.getTotalLength() : 0;   // длина маски — вне кадра
    gildGrad = null;
    lastMorph = -1;
    if (ctx) buildGrades();
  }

  // Знак на перегородке: вся сборка (горы, свош, буквы, подпись) — одним блоком, изотропно.
  // Область посадки — panel_free_region (стекло, не закрытое столом и монитором), иначе весь квад панели;
  // ширина ≤ LOGO_FIT области, высота ≤ 80 %, центр блока = центр области. Оси — по кромкам квада.
  // Знак на стекле существует только как вектор: плита E запечённого знака не несёт (clean_E.py).
  const LOGO_BOX = [67.78, 169.36, 956.22, 854.64];   // контентный bbox знака в единицах логотипа
  let logoPanelCenter = null;                          // центр знака на стекле (плита) — цель камеры
  function placeLogoOnPanel() {
    const q = quads.panel_quad;
    const TL = q[0], TR = q[1], BR = q[2], BL = q[3];
    const ex = [TR[0] - TL[0], TR[1] - TL[1]];
    const ey = [BL[0] - TL[0], BL[1] - TL[1]];
    const lenx = Math.hypot(ex[0], ex[1]), leny = Math.hypot(ey[0], ey[1]);
    const ux = [ex[0] / lenx, ex[1] / lenx], uy = [ey[0] / leny, ey[1] / leny];
    const fr = quads.panel_free_region;
    const areaW = fr ? (fr.x1 - fr.x0) : lenx;
    const areaH = fr ? (fr.y1 - fr.y0) : leny;
    const lw = LOGO_BOX[2] - LOGO_BOX[0], lh = LOGO_BOX[3] - LOGO_BOX[1];
    const k = (quads.baked_logo && fr) ? Math.min(areaW / lw, areaH / lh) : Math.min(LOGO_FIT * areaW / lw, 0.80 * areaH / lh);
    const C = fr ? [(fr.x0 + fr.x1) / 2, (fr.y0 + fr.y1) / 2]
      : [(TL[0] + TR[0] + BR[0] + BL[0]) / 4, (TL[1] + TR[1] + BR[1] + BL[1]) / 4];
    const c0 = [(LOGO_BOX[0] + LOGO_BOX[2]) / 2, (LOGO_BOX[1] + LOGO_BOX[3]) / 2];
    // P = C + k·((x − c0x)·ux + (y − c0y)·uy)
    const a = k * ux[0], b = k * ux[1], c = k * uy[0], d = k * uy[1];
    const e = C[0] - (a * c0[0] + c * c0[1]);
    const f = C[1] - (b * c0[0] + d * c0[1]);
    panelM = [a, b, c, d, e, f];
    logoPanelCenter = C;
  }
  function quadCenter(q) { return [(q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4]; }
  // зум, при котором экран монитора ≈ 85 % ширины вьюпорта
  function monitorZoom() {
    const q = quads.screen_quad;
    const w = Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]);
    return 0.85 * vw / (w * coverScale());
  }

  function headTransform(h) {
    // наконечник «твердеет»: масштаб 0.6→1 вокруг острия, при 1 сидит точно на дугах своша
    const sc = ls * (0.6 + 0.4 * h);
    const tip = logo.anchors.arrowhead_tip;
    return 'translate(' + (headTip[0] - tip[0] * sc) + ',' + (headTip[1] - tip[1] * sc) + ') scale(' + sc + ')';
  }

  function resampleByX(pts, x0, x1) {
    const sorted = pts.slice().sort((a, b) => a[0] - b[0]);
    const out = [];
    for (let i = 0; i < N; i++) {
      const x = x0 + (x1 - x0) * i / (N - 1);
      let j = 0;
      while (j < sorted.length - 2 && sorted[j + 1][0] < x) j++;
      const a = sorted[j], b = sorted[j + 1];
      const t = b[0] === a[0] ? 0 : Math.min(1, Math.max(0, (x - a[0]) / (b[0] - a[0])));
      out.push([x, a[1] + (b[1] - a[1]) * t]);
    }
    return out;
  }

  // ── Хореография: позиции в единицах p ───────────────────
  // Бюджет прокрутки по величине изменения (PIN_PCT 540 % vh):
  //   0–0.44   Арарат → знак   238 % vh — физически та же длина, что в утверждённой версии (0.56 × 420 %)
  //   0.44–0.60 стекло          86 % vh = 16 % пина (требование ≥ 12 %)
  //   0.60–0.88 ролик          151 % vh = 28 % пина (требование ≥ 25 %), 5.0 px скролла на кадр
  //   0.88–1.00 посадка         65 % vh = 12 % пина (требование ≥ 8 %)
  // Первая половина не переосмыслена: все её позиции — прежние, умноженные на 0.44/0.56.
  const K1 = SLICE_END / 0.56;
  const a1 = (t) => +(t * K1).toFixed(4);
  function buildTimeline() {
    const tl = gsap.timeline({ paused: true, defaults: { ease: 'none' } });
    // ── первая половина (утверждена) ──
    // камера трогается с первого пикселя: прежние 0.005–0.050 стояли мёртво (forensic, 151 px)
    tl.to(S, { zoom: 1.5, cx: 1180, cy: 500, duration: a1(0.16), ease: 'power2.inOut' }, 0);
    tl.to(S, { zoom: 1.46, cx: 1215, cy: 505, duration: a1(0.14) }, a1(0.16));
    tl.to(S, { dusk: 1, duration: a1(0.05), ease: 'sine.inOut' }, a1(0.16));
    // луч по хребту: разгон и торможение
    tl.to(S, { draw: 1, duration: a1(0.09), ease: 'power2.inOut' }, a1(0.21));
    tl.to(S, { glow: 1, duration: a1(0.04) }, a1(0.21));
    // свош
    tl.to(S, { swoosh: 1, duration: a1(0.07), ease: 'power2.inOut' }, a1(0.30));
    tl.to(S, { head: 1, duration: a1(0.025), ease: 'back.out(1.6)' }, a1(0.355));
    tl.to(S, { zoom: 1.15, cx: 1330, cy: 600, duration: a1(0.08), ease: 'power2.inOut' }, a1(0.30));
    // превращение
    tl.to(S, { morph: 1, duration: a1(0.08), ease: 'power3.inOut' }, a1(0.38));
    tl.to(S, { fill: 1, duration: a1(0.07), ease: 'power1.in' }, a1(0.39));
    tl.to(S, { zoom: 1.0, cx: 1280, cy: 720, duration: a1(0.09), ease: 'power2.inOut' }, a1(0.38));
    // подмена полигона точными формами — вдвое длиннее: прежние 0.035 давали скачок ×2.9 на 0.48
    tl.to(S, { shapes: 1, duration: a1(0.07), ease: 'sine.inOut' }, a1(0.44));
    tl.to(S, { glow: 0.3, duration: a1(0.05) }, a1(0.44));
    // буквы
    tl.to(S, { letters: 1, duration: a1(0.05), ease: 'power2.out' }, a1(0.47));
    tl.to(S, { tagline: 1, duration: a1(0.03) }, a1(0.505));
    tl.to(S, { zoom: 1.03, cy: 700, duration: a1(0.05) }, a1(0.51));

    // ── стекло: 0.44 → 0.60, один непрерывный рамп, камера всё это время едет к стеклу ──
    const pc = logoPanelCenter || quadCenter(quads.panel_quad);
    const fc = (quads.walk_video && quads.walk_video.first_frame_camera) || null;
    const GL = GLASS_END - SLICE_END;
    tl.to(S, { glass: 1, duration: GL, ease: 'none' }, SLICE_END);
    // финальная камера стекла = камера кадра 0 ролика: стык 0.60 остаётся точным (corr 0.9969)
    tl.to(S, { zoom: fc ? fc.zoom : 1.6, cx: fc ? fc.cx : pc[0], cy: fc ? fc.cy : pc[1], duration: GL, ease: 'sine.inOut' }, SLICE_END);
    tl.to(S, { logoSit: 1, duration: GL * 0.8, ease: 'power2.inOut' }, SLICE_END + GL * 0.08);
    tl.to(S, { glow: 0, duration: GL * 0.3 }, SLICE_END);
    if (quads.baked_logo) tl.to(S, { logoFade: 1, duration: GL * 0.22, ease: 'sine.inOut' }, SLICE_END + GL * 0.5);

    // ── ролик: 0.60 → 0.88 ──
    const WK = WALK_END - GLASS_END;
    tl.to(S, { walk: 1, duration: WK, ease: 'none' }, GLASS_END);
    // фолбэк без ролика: та же дорога плитами и камерой
    tl.to(S, { zoom: 1.0, cx: 1280, cy: 720, duration: WK * 0.36, ease: 'power2.inOut' }, GLASS_END);
    tl.to(S, { markOut: 1, duration: WK * 0.2, ease: 'sine.inOut' }, GLASS_END + WK * 0.34);
    tl.to(S, { zoom: DOLLY_FROM.zoom, cx: DOLLY_FROM.cx, cy: DOLLY_FROM.cy, duration: WK * 0.08, ease: 'sine.inOut' }, GLASS_END + WK * 0.42);
    tl.to(S, { dolly: 1, duration: WK * 0.44, ease: 'power2.inOut' }, GLASS_END + WK * 0.56);

    // ── посадка: 0.88 → 1.0. Страница проявляется НА экране ещё на подлёте (хвост ролика,
    //    где камера уже почти стоит), потом входит содержимое, потом экран разворачивается ──
    // страница загорается на мониторе с того кадра, где рамка уже читается (трек ~0.78 ролика),
    // и доходит до полной яркости к концу подлёта — мы летим В неё, а не встречаем чёрный экран
    const TS = trackStart();
    const scrFrom = (TS < 1) ? (GLASS_END + WK * TS) : (WALK_END - 0.05);
    // экран зажигается в начале подлёта и горит ВЕСЬ подлёт: страница живёт в мониторе мелко,
    // растёт вместе с ним и разворачивается на весь вьюпорт — чёрного экрана нет ни одного кадра
    tl.to(S, { screenIn: 1, duration: Math.min(0.05, Math.max(0.02, (WALK_END - scrFrom) * 0.28)), ease: 'power1.out' }, scrFrom);
    // разворот — самый длинный и деликатный ход: он же заполняет движением весь хвост до ворот
    tl.to(S, { full: 1, duration: HERO_END - WALK_END, ease: 'power2.inOut' }, WALK_END);
    tl.to(S, { navy: 1, duration: (HERO_END - WALK_END) * 0.5, ease: 'sine.in' }, WALK_END + 0.005);
    tl.to(S, { p: HERO_END, duration: HERO_END }, 0);   // маркер прогресса
    return tl;
  }

  // ── Вектор логотипа: клонируем группы из logo.svg в слои ──
  function injectLogo(svgText) {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const pick = (id) => doc.getElementById(id);
    // брендовый градиент из .ai (userSpaceOnUse в координатах логотипа) — переносим как есть
    const grad = pick('gold');
    if (grad) {
      const g = grad.cloneNode(true); g.setAttribute('id', 'hsGoldLogo');
      svgSolid.querySelector('defs').appendChild(g);
    }
    const brand = grad ? 'url(#hsGoldLogo)' : 'url(#hsGold)';
    const cloneInto = (id, target, fill) => {
      const src = pick(id);
      if (!src || !target) return null;
      const c = src.cloneNode(true);
      c.removeAttribute('id');
      const f = fill || brand;
      c.querySelectorAll('[fill]').forEach(el => el.setAttribute('fill', f));
      c.setAttribute('fill', f);
      target.appendChild(c);
      return c;
    };
    // Горы: снег в знаке — не белая заливка, а прозрачные вырезы. Возвращаем шапки в тело как дырки.
    const main = pick('mountain-main'), third = pick('mountain-third');
    const snowD = ['snow-sis', 'snow-masis'].map(id => (pick(id) || {}).getAttribute ? pick(id).getAttribute('d') : '').filter(Boolean).join(' ');
    const mkPath = (d, rule, fill) => {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d); p.setAttribute('fill', fill || brand);
      if (rule) p.setAttribute('fill-rule', rule);
      return p;
    };
    if (main) {
      mainD = main.getAttribute('d') + ' ' + snowD;
      shapesGroup.appendChild(mkPath(mainD, 'evenodd'));
    }
    if (third) {
      thirdD = third.getAttribute('d');
      shapesGroup.appendChild(mkPath(thirdD));
    }
    // Нижняя дуга своша в знаке сливается со склоном третьей горы — это часть эмблемы, а не стрелки.
    const lower = pick('swoosh-lower');
    if (lower) {
      lowerD = lower.getAttribute('d');
      shapesGroup.appendChild(mkPath(lowerD));
    }
    cloneInto('swoosh-upper', swooshGroup);
    cloneInto('swoosh-upper', swooshLight, '#FAE0A2');
    cloneInto('arrowhead', headGroup);
    const lettersClone = cloneInto('letters', lettersGroup);
    letterPaths = lettersClone ? Array.from(lettersClone.querySelectorAll('path')) : [];
    cloneInto('tagline', taglineGroup);

    // тень букв: клон букв и подписи со сдвигом (единицы логотипа), fill наследуется от группы
    const shadowIn = document.createElementNS(NS, 'g'); shadowIn.setAttribute('transform', 'translate(1.5,4.2)');
    lettersShadow.appendChild(shadowIn);
    cloneInto('letters', shadowIn, 'currentColor'); cloneInto('tagline', shadowIn, 'currentColor');
    shadowIn.querySelectorAll('[fill]').forEach(el => el.removeAttribute('fill'));
    // травление на стекле: два клона всего знака — светлый вверх-влево, тёмный вниз-вправо
    [[etchLight, 'translate(-1.1,-1.1)'], [etchDark, 'translate(1.5,1.8)']].forEach(([grp, tr]) => {
      const inner = document.createElementNS(NS, 'g'); inner.setAttribute('transform', tr);
      grp.appendChild(inner);
      if (mainD) inner.appendChild(mkPath(mainD, 'evenodd', 'inherit'));
      if (thirdD) inner.appendChild(mkPath(thirdD, null, 'inherit'));
      if (lowerD) inner.appendChild(mkPath(lowerD, null, 'inherit'));
      ['swoosh-upper', 'arrowhead', 'letters', 'tagline'].forEach(id => cloneInto(id, inner, 'inherit'));
      inner.querySelectorAll('[fill]').forEach(el => el.removeAttribute('fill'));
    });

    // символы для <use>: буквы (знак в углу, шапка) и полный знак (экран, секция после хиро) — currentColor
    const symLetters = document.getElementById('hsLogoLetters');
    const symMark = document.getElementById('hsLogoMark');
    if (symLetters && !symLetters.childNodes.length) cloneInto('letters', symLetters, 'currentColor');
    if (symMark && !symMark.childNodes.length) {
      if (mainD) symMark.appendChild(mkPath(mainD, 'evenodd', 'currentColor'));
      if (thirdD) symMark.appendChild(mkPath(thirdD, null, 'currentColor'));
      if (lowerD) symMark.appendChild(mkPath(lowerD, null, 'currentColor'));
      cloneInto('swoosh-upper', symMark, 'currentColor');
      cloneInto('arrowhead', symMark, 'currentColor');
      cloneInto('letters', symMark, 'currentColor');
    }
  }

  // ══ ЕДИНСТВЕННОЕ СГЛАЖИВАНИЕ ВСЕЙ ЦЕПИ ══════════════════════════════════
  // Закон VKV: обработчик скролла только обновляет цель и никогда не рисует.
  // ScrollTrigger отдаёт СЫРОЙ progress (scrub: true), один lerp живёт здесь,
  // и от pSmooth считается всё сразу: таймлайн (камера, SVG, зерно) и время ролика.
  // Прежде фильтров было два (scrub 0.35 → ещё lerp 0.16 на времени ролика) — картинка
  // и материал шли по разным часам, отсюда «часть хорошо, часть рывки».
  let trigger = null, timeline = null;
  let pRaw = 0, pSmooth = 0, loopId = null, loopOn = false, lastT = 0;
  function kick() {
    if (loopId !== null || !loopOn) return;
    loopId = requestAnimationFrame(tick);
  }
  function tick(now) {
    loopId = null;
    const t = now || performance.now();
    const dt = lastT ? Math.min(64, t - lastT) : LERP_HZ;
    lastT = t;
    const d = pRaw - pSmooth;
    if (P_LERP >= 1 || Math.abs(d) < 1e-4) pSmooth = pRaw;
    else pSmooth += d * (1 - Math.pow(1 - P_LERP, dt / LERP_HZ));
    if (timeline) timeline.progress(pSmooth);
    const busy = walkSync(dt);           // время ролика — от того же pSmooth, своего фильтра нет
    render();                            // ЕДИНСТВЕННЫЙ вызов render в проходе
    gateAhead();                         // замок по ЦЕЛИ Lenis, а не по достигнутой позиции
    const fading = assetFading();        // поздний ассет вводится по ВРЕМЕНИ, а не подменой кадра
    if (Math.abs(pRaw - pSmooth) > 1e-4 || busy || fading) kick();
  }
  // Замок ставится по ЦЕЛИ инерции, а не по уже достигнутой позиции: на резком флике (или на
  // подтормаживающем кадре) Lenis успевает увести документ за конец пина одним шагом, и посетитель
  // видит кусок следующей секции. Как только цель ушла за пин, а мы уже на посадке, — стоп.
  function gateY() { return trigger ? trigger.start + (trigger.end - trigger.start) * GATE_P : Infinity; }
  // Сторож на самом колесе: последний тик, который увёл бы документ ЗА ворота, не выполняется —
  // он их закрывает. Так замок не зависит ни от частоты кадров, ни от того, есть ли Lenis:
  // документ физически не может проехать мимо, и возвращать его назад (телепорт) не приходится.
  let wheelGuardOn = false;
  function onWheelGuard(e) {
    if (!armed || reduced || chosen || locked) return;
    if (e.deltaY <= 0) return;
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : (e.deltaMode === 2 ? e.deltaY * vh : e.deltaY);
    if (window.scrollY + dy >= gateY() - 1) { e.preventDefault(); gate(1); }
  }
  function gateAhead() {
    if (!armed || reduced || chosen || locked || !trigger) return;
    if (!wheelGuardOn && pRaw >= 0.86) {
      wheelGuardOn = true;
      window.addEventListener('wheel', onWheelGuard, { passive: false });
    }
    const L = window.__lenis;
    if (!L || typeof L.targetScroll !== 'number') return;
    const span = trigger.end - trigger.start;
    if (span <= 0) return;
    const tp = (L.targetScroll - trigger.start) / span;
    if (tp >= 0.999 && pRaw >= 0.90) gate(1);
  }
  // следующий экран после хиро: секция .after занимает всю высоту вьюпорта, и посадка обязана
  // попадать ровно в её верх — иначе «шаг» читается как обычная прокрутка длинной страницы.
  function nextScreen() { return document.querySelector('.after') || document.getElementById('after'); }
  function scrollToScreen() {
    const el = nextScreen();
    if (!el) { scrollToY(Math.round(window.scrollY + vh * 0.9), 1.1); return; }
    const y = Math.round(window.scrollY + el.getBoundingClientRect().top);
    scrollToY(Math.max(0, y), 1.1);
  }
  function scrollToY(y, dur) {
    if (window.__lenis) window.__lenis.scrollTo(y, { duration: dur });
    else window.scrollTo({ top: y, behavior: reduced ? 'auto' : 'smooth' });
  }

  // ══ ВОРОТА: хиро не продолжает скроллиться сам ═══════════════════════════
  // На GATE_P пин отпускается и документ стопорится: страница стоит, видна её верхушка,
  // ждёт решения. RU (или Esc) — снять блокировку и ехать дальше; HY/EN — обычный переход.
  // armed — ворота взведены. Ставятся один раз на GATE_P, снимаются при срабатывании и
  // взводятся заново, когда прогресс упал ниже REARM_P, то есть посетитель реально уехал
  // назад в хиро. chosen — язык выбран, дальше ворота не встают вовсе.
  const REARM_P = 0.80;
  let locked = false, chosen = false, armed = true;
  const GATE = { p: 0 };          // доводка хореографии на воротах — по времени, не по скроллу
  const LANG = { zoom: 1 };       // языковой момент — тоже по времени: на быстром флике колокол по
                                  // скроллу отыгрывался за один кадр и читался как глитч
  // Замок НАПРАВЛЕННЫЙ: держит только движение вперёд. Прокрутка вверх — законный выход,
  // посетитель возвращается в хиро. Прежний замок гасил колесо в обе стороны и на touchmove,
  // поэтому после появления первого экрана вернуться назад было физически нечем.
  let touchY = 0;
  const onTouchStart = (e) => { touchY = (e.touches && e.touches[0]) ? e.touches[0].clientY : 0; };
  const onWheelLocked = (e) => {
    if (e.deltaY < 0) { unlockBack(); return; }            // вверх — отпускаем
    e.preventDefault();
  };
  const onTouchLocked = (e) => {
    const y = (e.touches && e.touches[0]) ? e.touches[0].clientY : touchY;
    if (y - touchY > 8) { unlockBack(); return; }          // палец вниз = прокрутка вверх
    e.preventDefault();
  };
  const BACK_KEYS = { ArrowUp: 1, PageUp: 1, Home: 1 };
  const NAV_KEYS = { ' ': 1, PageDown: 1, ArrowDown: 1, End: 1, Spacebar: 1 };
  function onKey(e) {
    if (!locked) return;
    if (e.key === 'Escape') { unlock(true); return; }
    if (BACK_KEYS[e.key]) { e.preventDefault(); unlockBack(); return; }
    if (NAV_KEYS[e.key]) e.preventDefault();
  }
  function lock() {
    if (locked || chosen || reduced) return;
    locked = true;
    // документ НЕ двигаем ни на пиксель: ни scrollTo, ни возврата позиции по scroll.
    // Инерция гасится stop()-ом, за пин выйти она уже не успевает — ворота стоят раньше конца.
    if (window.__lenis) window.__lenis.stop();
    // overflow: clip на корне — единственный надёжный замок: он гасит и синтетическое колесо,
    // и перетаскивание полосы прокрутки, и не трогает позицию (в отличие от hidden и от scrollTo)
    html.classList.add('is-gate-locked');
    if (wheelGuardOn) { window.removeEventListener('wheel', onWheelGuard, { passive: false }); wheelGuardOn = false; }
    window.addEventListener('wheel', onWheelLocked, { passive: false });
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchLocked, { passive: false });
    window.addEventListener('keydown', onKey);
    root.classList.add('is-gate');
    if (pgHint) { pgHint.hidden = false; requestAnimationFrame(() => pgHint.classList.add('is-in')); }
    // доводка посадки: последние 1.5 % хореографии — по времени
    GATE.p = pRaw;
    if (hasGsap) gsap.to(GATE, { p: 1, duration: 0.5, ease: 'power2.out', onUpdate: () => { pRaw = GATE.p; kick(); } });
    else { pRaw = 1; kick(); }
    // языковой момент: три слова укрупняются и ОСТАЮТСЯ такими, пока ждут решения (не колокол)
    if (hasGsap && pgLangLine) {
      gsap.to(LANG, { zoom: 1.3, duration: 0.6, ease: 'back.out(1.8)', onUpdate: kick });
      gsap.fromTo(pgLangItems, { yPercent: 22, opacity: 0.4 },
        { yPercent: 0, opacity: 1, duration: 0.5, stagger: 0.06, ease: 'expo.out', clearProps: 'opacity,transform' });
    } else { LANG.zoom = 1.3; }
    if (pg) pg.classList.add('is-choosing');
    const active = langChoices.find(el => el.classList.contains('is-active')) || langChoices[0];
    if (active) { try { active.focus({ preventScroll: true }); } catch (err) { active.focus(); } }
  }
  function releaseLock() {
    if (!locked) return;
    locked = false;
    window.removeEventListener('wheel', onWheelLocked, { passive: false });
    window.removeEventListener('touchstart', onTouchStart, { passive: true });
    window.removeEventListener('touchmove', onTouchLocked, { passive: false });
    window.removeEventListener('keydown', onKey);
    html.classList.remove('is-gate-locked');
    if (window.__lenis) window.__lenis.start();
    root.classList.remove('is-gate');
    if (pgHint) { pgHint.classList.remove('is-in'); pgHint.hidden = true; }
    if (pg) pg.classList.remove('is-choosing');
    // языковая строка садится на своё место в шапке страницы — тем же временем, что и укрупнялась
    if (hasGsap) gsap.to(LANG, { zoom: 1, duration: 0.45, ease: 'power2.out', onUpdate: kick });
    else LANG.zoom = 1;
    kick();
  }
  // выбор сделан (язык или Esc): ворота больше не встают
  function unlock(fromUser) { if (!locked) return; chosen = !!fromUser; releaseLock(); }
  // возврат в хиро: замок снят, выбор НЕ сделан. Ворота встанут снова, но только после того,
  // как прогресс упадёт ниже REARM_P, — иначе они защёлкнулись бы на том же кадре. Небольшой
  // ход назад запускаем сами, чтобы движение началось от того же тика колеса, а не со второго.
  function unlockBack() {
    if (!locked) return;
    releaseLock();
    scrollToY(Math.max(0, Math.round(window.scrollY - vh * 0.55)), 0.9);
  }
  // Ворота ставятся по СЫРОМУ прогрессу и в том же кадре, что и скролл: прежняя проверка по
  // сглаженному pSmooth отставала на сотни пикселей, и замок защёлкивался, когда документ уже
  // ушёл за конец пина, — отсюда рывок назад.
  function gate(pr) {
    if (reduced) return;
    if (pr < REARM_P) armed = true;                        // уехали назад в хиро — взводим
    if (chosen || locked || !armed) return;
    if (pr >= GATE_P - 1e-4) { armed = false; lock(); }
  }
  // язык страницы: клик по нему — «продолжить», а не переход; HY/EN уходят по своим адресам
  const PAGE_LANG = (html.getAttribute('data-skin') || html.getAttribute('lang') || 'ru').slice(0, 2);
  langChoices.forEach(el => {
    el.addEventListener('click', (e) => {
      const lg = (el.getAttribute('data-lang') || '').slice(0, 2);
      if (lg !== PAGE_LANG) return;                            // другой язык — обычная ссылка
      e.preventDefault();
      // «выбрал язык — поехали дальше»: мягкий ход от ТЕКУЩЕЙ позиции, без прыжка к концу пина
      if (locked) unlock(true); else chosen = true;
      // «выбрал язык — открылся следующий экран»: садимся РОВНО на верх следующего экрана,
      // а не отъезжаем на условные 0.9 высоты. Экраны должны вставать в кадр целиком.
      scrollToScreen();
    });
  });

  if (skip) {
    skip.addEventListener('click', (e) => {
      const t = document.querySelector(skip.getAttribute('href'));
      if (!t || !window.__lenis) return;     // без Lenis — нативный якорь
      e.preventDefault();
      window.__lenis.scrollTo(t, { duration: 1.6 });
    });
  }
  if (screen) {
    // клавиатура: панель получила фокус, пока экран ещё в мониторе — доводим хиро до конца,
    // чтобы Enter открывал ссылку из осмысленного состояния, а не из середины наезда
    screen.addEventListener('focusin', () => {
      if (locked || !trigger || trigger.progress > GATE_P - 0.01) return;
      scrollToY(Math.round(trigger.start + (trigger.end - trigger.start) * GATE_P), 1.2);
    });
  }

  // ── Секция после хиро (срез): вход волной по словарю; разметка видима без JS ──
  function revealAfter() {
    const items = Array.from(document.querySelectorAll('.after [data-reveal]'));
    if (!items.length || reduced || !hasGsap) return;
    gsap.fromTo(items, { opacity: 0, y: 40, scale: 0.96 }, {
      opacity: 1, y: 0, scale: 1, duration: 0.7, stagger: 0.08, ease: 'expo.out', clearProps: 'all',
      scrollTrigger: { trigger: '.after', start: 'top 80%', once: true },
    });
  }

  const idle = window.requestIdleCallback ? (cb) => window.requestIdleCallback(cb, { timeout: 1500 }) : (cb) => setTimeout(cb, 300);

  // ── Инициализация ───────────────────────────────────────
  // Мобильная ветка: постер (LCP) + панели; ни canvas, ни пина. Нужен только вектор знака для <use>.
  if (isMobile) {
    root.classList.add('is-mobile', 'is-static', 'is-ready');
    if (head) head.classList.add('is-past');
    fetch(ASSETS + 'logo.svg').then(r => r.text()).then(injectLogo).catch(err => console.error('[hero-scroll]', err));
    revealAfter();
    return;
  }

  Promise.all([
    posterReady().catch(() => loadBitmap(ASSETS + 'lcp/A-1280.webp')),   // постер не пришёл — минимальная плита
    fetch(ASSETS + 'ridge.json').then(r => r.json()),
    fetch(ASSETS + 'logo.json').then(r => r.json()),
    fetch(ASSETS + 'logo.svg').then(r => r.text()),
    loadQuads(),
  ]).then(([A, ridge, lg, svgText, E]) => {
    plates.A = A; quads = E.quads;
    ridgePts = ridge.points; anchors = ridge.anchors; logo = lg;
    injectLogo(svgText);
    placeLogo();
    placeLogoOnPanel();
    resize();
    root.classList.add('is-ready');
    idle(walkLoad);   // ролик — сразу после LCP, параллельно плитам (7 МБ, blob)

    // остальные плиты — после LCP, в простое, по порядку прихода в кадр; движок их не ждёт:
    // первый кадр уже стоит из постера. LOD: k_кропа ≤ scale — постер переиспользуется, если он не меньше нужного
    const chain = new Promise(res => idle(res)).then(() => {
      const wA = lodW(MAX_ZOOM);
      const haveW = A.width || A.naturalWidth || 0;
      const needA = haveW < wA ? loadPlate('A', wA).then(b => { plates.A = b; render(); }).catch(() => {}) : Promise.resolve();
      return needA
        .then(() => loadPlate('A-dusk', wA).catch(() => null))
        .then(D => { plates.D = D; render(); return loadPlate(E.base, lodW(1.6)).catch(() => null); })
        .then(bmp => { plates.E = bmp; if (bmp) { eAt = arrived(); kick(); } render(); })
        .then(() => new Promise(res => idle(res)))
        .then(() => {
          const srcA = plates.D || plates.A;
          return Promise.all([
            loadBlur('A-dusk', 40, srcA).then(b => { blur.A40 = b; }),
            loadBlur(E.base, 40, plates.E).then(b => { blur.E40 = b; }),
          ]).then(render);
        })
        .catch(err => console.error('[hero-scroll] plates', err));
    });

    if (reduced || !hasGsap) {
      // Tier 3: статика — финал хиро (шапка с переключателем, цвет кожи), без пина
      Object.assign(S, { p: HERO_END, zoom: 1.0, cx: 1280, cy: 720, dusk: 1, draw: 1, glow: 0,
        swoosh: 1, head: 1, morph: 1, fill: 1, shapes: 1, snow: 1, letters: 1, tagline: 1,
        glass: 1, logoSit: 1, dolly: 1, screenIn: 1, full: 1, navy: 1, markOut: 1, choose: 0, logoFade: (quads.baked_logo ? 1 : 0), walk: 1 });
      root.classList.add('is-static');
      if (head) head.classList.add('is-past');
      render();
      return;
    }

    gsap.registerPlugin(ScrollTrigger);
    const tl = buildTimeline();
    // отладочный доступ только при ?debug=1: замер скачков и стоимости кадра без правки движка
    if (debug) window.__hero = {
      S, cam, render, video: walkVideo, get p() { return pSmooth; }, get locked() { return locked; },
      get counts() { return { renders: renderCount, videoFrames: frameCount }; },
      // состояние ворот — чтобы проверять замок без глаз и без рук
      get gateState() { return { locked, chosen, armed, pRaw: +pRaw.toFixed(4), langChoices: langChoices.length }; },
      // рассинхрон «кадр на экране против кадра-цели» — в кадрах ролика
      get frameSync() {
        const fps = trackFps(), n = (quads.walk_track && quads.walk_track.quads.length) || 1;
        const shown = shownFrame();
        const want = Math.min(n - 1, Math.max(0, Math.round(Math.min(Math.max(S.walk, 0), 1) * (n - 1))));
        return { shown, want, lag: shown - want, frameT: +walkFrameT.toFixed(4), curT: +walkVideo.currentTime.toFixed(4),
                 targetT: +walkTarget().toFixed(4), seeking: walkSeeking, seekFrame: walkSeekFrame, seekMs: +walkSeekMs.toFixed(2), seeks: walkSeeks, paused: walkVideo.paused, fps, walk: +S.walk.toFixed(4) };
      },
      get quadView() { return screenQuadView(); },
      gate, unlockBack, unlock,

      seek: (v) => new Promise(res => {
        pRaw = pSmooth = Math.min(1, Math.max(0, v));
        tl.progress(pSmooth); walkGrab(); walkSync();
        if (!walkSeeking) { render(); return res(); }
        const on = () => { walkVideo.removeEventListener('seeked', on); walkGrab(); render(); res(); };
        walkVideo.addEventListener('seeked', on);
      }),
    };

    // Стоп-кадр: ?p=0.42 — статичный рендер на заданном прогрессе (для отбора и скриншотов)
    const still = /[?&]p=([\d.]+)/.exec(location.search);
    if (still) {
      root.classList.add('is-static');
      timeline = tl;
      pRaw = pSmooth = Math.min(1, parseFloat(still[1]) / HERO_END);
      tl.progress(pSmooth);
      window.addEventListener('resize', resize, { passive: true });
      // стоп-кадр: время ролика выставляется сразу, без сглаживания; кадр приходит по seeked
      const still1 = () => { walkGrab(); walkSync(); render(); };
      walkVideo.addEventListener('seeked', still1);
      walkVideo.addEventListener('loadedmetadata', still1);
      chain.then(still1);
      still1();
      return;
    }

    timeline = tl;
    loopOn = true;
    trigger = ScrollTrigger.create({
      trigger: root,
      start: 'top top',
      end: '+=' + PIN_PCT + '%',
      pin: stage,
      pinSpacing: true,
      // scrub НЕ ставим: со scrub onUpdate вызывается скраб-твином, а его без animation нет —
      // проверено, onUpdate не срабатывал ни разу. Без scrub onUpdate отдаёт СЫРОЙ progress,
      // а сглаживание остаётся ровно одно — lerp в rAF-цикле движка.
      invalidateOnRefresh: true,
      onUpdate: (st) => { if (!locked) pRaw = st.progress; gate(st.progress); kick(); },   // обработчик только двигает цель
      onLeave: () => { gate(1); if (!locked) { pRaw = 1; kick(); } if (head) head.classList.add('is-past'); },
      onEnterBack: () => { if (head) head.classList.remove('is-past'); },
    });
    window.addEventListener('resize', resize, { passive: true });
    ScrollTrigger.addEventListener('refresh', resize);
    resize();
    requestAnimationFrame(resize);
    revealAfter();
  }).catch(err => {
    console.error('[hero-scroll]', err);
    root.classList.add('is-failed');
    revealAfter();
  });
})();
