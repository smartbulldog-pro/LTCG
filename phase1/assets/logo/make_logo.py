# -*- coding: utf-8 -*-
"""
Знак LTCG для шапки — из прозрачного мастера 2048×2048.
Источник: assets/logo/без_фона/2048x2048_Logo_LTCG.png (см. README.md рядом с ним).
  RGBA, альфа 0..255, ink-bbox по getbbox: x 32..2015 · y 258..1789, то есть 1984×1532
  при полях 32 px по бокам и 258 px сверху и снизу. Поля кропаются, свои задаются ниже.
  Уменьшенные копии (1024…128) — для типографии; пережимать их повторно нельзя.

Оригинал — вертикальный локап в три яруса:
    y  258..956   эмблема (горы + свош + стрела)
    y 1052..1575  буквы LTCG
    y 1684..1789  строка «Legal and Tax Consulting Group LLC»
Строка LLC при высоте знака 38 px даёт кегль ~2.6 px — нечитаемую грязь, поэтому в веб-локап
она не входит (обычная практика сокращённого локапа). Эмблема отдельно идёт в мобильную ветку.

ЧТО СОБИРАЕТСЯ  (@2x и @3x в avif/webp + @2x png-фолбэк, 20 файлов, 81.6 КБ на диске)
    ltcg-lockup       эмблема + буквы, ЧИСТОЕ золото оригинала   57×38 CSS px  (≥768)
    ltcg-mark         только эмблема,  ЧИСТОЕ золото оригинала   63×24 CSS px  (<768)
    ltcg-lockup-ink   то же, но плоская бронза #593E10 под бумагу HY/EN
    ltcg-mark-ink

ПОЧЕМУ ДВА ЦВЕТА
    Кожа RU — navy: золото на #0C1B3A даёт 10.2:1, читается.
    Кожи HY и EN — бумага: золото #F2C249 на #F7F3EA даёт 1.5:1 — знак пропадает.
    Бренд-токен --gold-dark #593E10 на бумаге даёт 8.9:1 (docs/style_system.md §4.4),
    он и берётся как «золото на бумаге». Снег в горах — не белый, а прозрачный:
    на бумаге он и должен быть цветом бумаги.

НИКАКИХ КРОМОК И ТЕНЕЙ НА ЗНАКЕ (правка владельца 04.09.2026: «тень убери, грубовато»).
    Первая сборка несла запечённую navy-подложку — на 1x она читалась грубой обводкой.
    Читаемость над светлым небом плиты A теперь держит СЦЕНА, а не знак: широкий мягкий
    скрим сверху хиро (.hs__stage::before в css/hero.css), который живёт только в хиро
    и гаснет вместе с --hs-scrim. Знак остаётся ровно тем, что нарисовал дизайнер.
    Поля PAD оставлены минимальными — только чтобы LANCZOS не резал крайний пиксель.

Запуск: python phase1/assets/logo/make_logo.py
"""
import os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.normpath(os.path.join(
    HERE, '..', '..', '..', 'assets', 'logo', 'без_фона', '2048x2048_Logo_LTCG.png'))

INK_PAPER = (89, 62, 16)      # #593E10 — --gold-dark, «золото на бумаге», 8.9:1
PAD = 1                       # прозрачное поле в 1 CSS px: запас под LANCZOS, не под кромку
M = 8                         # мастер строится в M× от CSS-размера

# имя, ink-кроп (l, t, r, b), высота знака без полей в CSS px
BUILDS = [
    ('ltcg-lockup', (32, 258, 2016, 1576), 36),   # эмблема + буквы, ink 1984×1318
    ('ltcg-mark',   (57, 258, 1969, 957),  22),   # только эмблема,  ink 1912×699
]

src = Image.open(SRC).convert('RGBA')
assert src.size == (2048, 2048), src.size


def resize_rgba(im, size):
    """Уменьшение в ПРЕДУМНОЖЕННОЙ альфе.
    Обычный Image.resize у Pillow жмёт четыре канала независимо, и в кромку знака
    затекает цвет прозрачных пикселей: у мастера это светло-песочный (234,211,158),
    у холста — чёрный. Первая сборка так и получила тёмную окантовку, которую владелец
    справедливо назвал грубой. Предумножение убирает затекание полностью: цвет берётся
    только там, где есть альфа."""
    a = np.asarray(im, dtype=np.float64)
    al = a[..., 3] / 255.0
    def rs(ch):
        return np.asarray(Image.fromarray(ch.astype(np.float32), 'F').resize(size, Image.LANCZOS),
                          dtype=np.float64)
    ar = np.clip(rs(al * 255.0), 0, 255)
    out = np.zeros(size[::-1] + (4,), dtype=np.float64)
    for i in range(3):
        pre = rs(a[..., i] * al)
        out[..., i] = np.where(ar > 0.5, np.clip(pre / np.maximum(ar / 255.0, 1e-6), 0, 255), 0)
    out[..., 3] = ar
    return Image.fromarray(np.round(out).astype(np.uint8), 'RGBA')


def master(box, ink_h_css):
    """Ink по кропу без искажения пропорций, по центру холста ЦЕЛОГО числа CSS-пикселей.
    Холст считается первым (css_w × css_h × M), ink вписывается внутрь — поэтому итоговый
    resize в emit() кратен M и не меняет пропорции знака ни на доли процента."""
    ink = src.crop(box)
    iw, ih = ink.size
    ink_h = ink_h_css * M
    ink_w = int(round(ink_h * iw / ih))
    css_h = ink_h_css + 2 * PAD
    css_w = -(-ink_w // M) + 2 * PAD          # ceil(ink_w / M) + поля
    canvas = Image.new('RGBA', (css_w * M, css_h * M), (0, 0, 0, 0))
    canvas.alpha_composite(resize_rgba(ink, (ink_w, ink_h)),
                           ((css_w * M - ink_w) // 2, (css_h * M - ink_h) // 2))
    return canvas, css_w, css_h


def to_paper(art):
    """Плоская бронза; белый снег уходит в прозрачность — на бумаге он цвет бумаги."""
    a = np.array(art).astype(np.float32)
    rgb, al = a[..., :3], a[..., 3]
    mx, mn = rgb.max(2), rgb.min(2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1), 0.0)
    snow = np.clip((0.14 - sat) / 0.14, 0, 1) * np.clip((mx - 170) / 60.0, 0, 1)
    out = np.zeros_like(a)
    out[..., 0], out[..., 1], out[..., 2] = INK_PAPER
    out[..., 3] = al * (1.0 - 0.92 * snow)
    return Image.fromarray(out.astype(np.uint8), 'RGBA')


def emit(name, im, css_w, css_h):
    """@2x и @3x в avif/webp + @2x png-фолбэк. src берёт @2x, srcset даёт 2x/3x."""
    for k in (2, 3):
        tw, th = css_w * k, css_h * k
        small = resize_rgba(im, (tw, th))
        # 4:4:4 обязателен: знак — графика с резкой золотой кромкой, на 4:2:0 хроме
        # кромка расползается и приходится задирать quality (q70/4:2:0 = 4.4 КБ при rmse 3.3,
        # q60/4:4:4 = 3.9 КБ при rmse 2.7 — меньше и точнее одновременно)
        out = [('%s@%dx.avif' % (name, k), dict(quality=60, speed=4, subsampling='4:4:4')),
               ('%s@%dx.webp' % (name, k), dict(quality=82, method=6))]
        if k == 2:
            out.append(('%s@2x.png' % name, dict(optimize=True)))
        for fn, kw in out:
            p = os.path.join(HERE, fn)
            small.save(p, **kw)
            print('%-24s %3d x %-3d %7.2f KB' % (fn, tw, th, os.path.getsize(p) / 1024))


if __name__ == '__main__':
    for name, box, ink_h in BUILDS:
        art, css_w, css_h = master(box, ink_h)
        print('--- %s: CSS %d x %d ---' % (name, css_w, css_h))
        emit(name, art, css_w, css_h)
        emit(name + '-ink', to_paper(art), css_w, css_h)
