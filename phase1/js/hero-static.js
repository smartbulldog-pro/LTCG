/* ============================================================
   LTCG — hero-static.js · мобильная ветка хиро (гейт boot.js: (max-width: 767px), coarse-pointer landscape)
   Постер — LCP, панели — обычный список в разметке; здесь только вектор знака для <use> (шапка, экран),
   ~2 КБ вместо движка и GSAP. Без canvas, без пина.
   ============================================================ */
(function () {
  'use strict';
  var html = document.documentElement;
  var root = document.querySelector('[data-hero-scroll]');
  if (!root) return;
  var SITE_ROOT = html.getAttribute('data-site-root') || '/';
  var NS = 'http://www.w3.org/2000/svg';
  root.classList.add('is-mobile', 'is-static', 'is-ready');
  var head = document.getElementById('siteHead');
  if (head) {
    head.style.setProperty('--head-in', '0'); head.style.setProperty('--brand-o', '1');
    var lang = head.querySelector('.site-head__lang'); if (lang) lang.inert = true;
  }
  fetch(SITE_ROOT + 'assets/hero/logo.svg').then(function (r) { return r.text(); }).then(function (txt) {
    var doc = new DOMParser().parseFromString(txt, 'image/svg+xml');
    var pick = function (id) { return doc.getElementById(id); };
    var mk = function (d, rule) { var p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); p.setAttribute('fill', 'currentColor'); if (rule) p.setAttribute('fill-rule', rule); return p; };
    var clone = function (id, target) { var s = pick(id); if (!s || !target) return; var c = s.cloneNode(true); c.removeAttribute('id'); c.querySelectorAll('[fill]').forEach(function (el) { el.setAttribute('fill', 'currentColor'); }); c.setAttribute('fill', 'currentColor'); target.appendChild(c); };
    var main = pick('mountain-main'), third = pick('mountain-third'), lower = pick('swoosh-lower');
    var snow = ['snow-sis', 'snow-masis'].map(function (id) { var e = pick(id); return e ? e.getAttribute('d') : ''; }).join(' ');
    var symLetters = document.getElementById('hsLogoLetters'), symMark = document.getElementById('hsLogoMark');
    if (symLetters && !symLetters.childNodes.length) clone('letters', symLetters);
    if (symMark && !symMark.childNodes.length) {
      if (main) symMark.appendChild(mk(main.getAttribute('d') + ' ' + snow, 'evenodd'));
      if (third) symMark.appendChild(mk(third.getAttribute('d')));
      if (lower) symMark.appendChild(mk(lower.getAttribute('d')));
      clone('swoosh-upper', symMark); clone('arrowhead', symMark); clone('letters', symMark);
    }
  }).catch(function (err) { console.error('[hero-static]', err); });
})();
