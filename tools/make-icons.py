#!/usr/bin/env python3
"""يولّد كل أيقونات التطبيق (الموقع + أندرويد + المتجر) من صورة واحدة.
الاستخدام:  python3 tools/make-icons.py [logo.png]
بدون صورة يرسم أيقونة افتراضية (شوكة وسكين ذهبية). ضع شعارك الحقيقي (مربع، 1024px أفضل) لاستبدالها."""
import sys, os
from PIL import Image, ImageDraw
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BG, GOLD = (11, 11, 14), (232, 196, 104)

def default(size):
    im = Image.new('RGBA', (size, size), BG); d = ImageDraw.Draw(im); s = size / 512
    d.ellipse([96*s, 96*s, 416*s, 416*s], outline=GOLD, width=int(14*s))
    # شوكة
    for x in (176, 208, 240): d.rounded_rectangle([(x-5)*s, 150*s, (x+5)*s, 250*s], 5*s, fill=GOLD)
    d.rounded_rectangle([171*s, 230*s, 245*s, 270*s], 18*s, fill=GOLD); d.rounded_rectangle([199*s, 255*s, 217*s, 365*s], 9*s, fill=GOLD)
    # سكين
    d.rounded_rectangle([296*s, 150*s, 332*s, 290*s], 16*s, fill=GOLD); d.rectangle([296*s, 250*s, 306*s, 290*s], fill=GOLD)
    d.rounded_rectangle([300*s, 270*s, 322*s, 365*s], 9*s, fill=GOLD)
    return im

def fit_edge(src, size, pad):   # يصغّر الشعار ويمدّ أطراف الخلفية بدل لون ثابت (لتجنّب حدود ظاهرة)
    import numpy as np
    k = int(size * (1 - 2 * pad)); a = np.asarray(src.convert('RGB').resize((k, k), Image.LANCZOS)); e = size - k
    a = np.pad(a, ((e // 2, e - e // 2), (e // 2, e - e // 2), (0, 0)), mode='edge'); return Image.fromarray(a).convert('RGBA')

def fit(src, size, pad):
    im = Image.new('RGBA', (size, size), BG); k = int(size * (1 - 2 * pad))
    l = src.copy(); l.thumbnail((k, k), Image.LANCZOS); im.paste(l, ((size - l.width) // 2, (size - l.height) // 2), l if l.mode == 'RGBA' else None); return im

src = Image.open(sys.argv[1]).convert('RGBA') if len(sys.argv) > 1 else default(1024)
if len(sys.argv) > 1:   # نأخذ لون خلفية الشعار من أطرافه ليملأ الأيقونة بنفس اللون
    px = [src.getpixel(p)[:3] for p in ((2, 2), (src.width - 3, 2), (2, src.height - 3), (src.width - 3, src.height - 3))]
    BG = tuple(sorted(c[i] for c in px)[2] for i in range(3))
    open(f'{R}/store/logo-bg.txt', 'w').write('#%02X%02X%02X' % BG)
def out(path, im): os.makedirs(os.path.dirname(path), exist_ok=True); im.convert('RGB').save(path)
full = src.resize((1024, 1024), Image.LANCZOS) if len(sys.argv) > 1 else src
out(f'{R}/store/icon-512.png', full.resize((512, 512), Image.LANCZOS))
for n in (192, 512): out(f'{R}/public/icons/icon-{n}.png', full.resize((n, n), Image.LANCZOS))
out(f'{R}/public/icons/maskable-512.png', fit_edge(src, 512, 0.1) if len(sys.argv) > 1 else fit(src, 512, 0.2))
res = f'{R}/android/app/src/main/res'
for d, sz in {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}.items():
    ic = full.resize((sz, sz), Image.LANCZOS); out(f'{res}/mipmap-{d}/ic_launcher.png', ic)
    m = Image.new('RGBA', (sz, sz), (0, 0, 0, 0)); mk = Image.new('L', (sz, sz), 0); ImageDraw.Draw(mk).ellipse([0, 0, sz-1, sz-1], fill=255); m.paste(ic, (0, 0), mk); m.save(f'{res}/mipmap-{d}/ic_launcher_round.png')
for d, sz in {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}.items():
    fg = fit_edge(src, sz, 0.14) if len(sys.argv) > 1 else fit(src, sz, 0.19); os.makedirs(f'{res}/mipmap-{d}', exist_ok=True); fg.save(f'{res}/mipmap-{d}/ic_launcher_foreground.png')
