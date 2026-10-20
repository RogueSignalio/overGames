"""Generates placeholder Light Up themes into ../assets/<theme>/.
Run:  python3 make_themes.py     (needs Pillow)
Replace any generated PNG with your own art; the filenames are what the game loads.
Overlay images (clue_*, lamp*, mark) should be transparent, they are drawn on top of the cells.
"""
import os
from PIL import Image, ImageDraw, ImageFont

S, SS = 128, 4          # output size (pixels), supersample factor
N = S * SS
C = N // 2
px = lambda v: int(v * SS * S / 64)   # drawing coordinates are in a 64-unit space

THEMES = {
    'default': dict(white=(226,230,238,255), lit=(255,236,150,255), black=(24,26,32,255),
                    edge=(0,0,0,0), text=(240,240,240,255), ok=(110,220,150,255), err=(240,90,90,255),
                    lamp=(255,196,40,255), lamp_edge=(160,105,0,255), lamp_err=(235,70,70,255),
                    mark=(120,130,150,255), bg_a=(84,94,118,255), bg_b=(94,105,130,255)),
    'light':   dict(white=(250,247,238,255), lit=(255,214,120,255), black=(78,66,58,255),
                    edge=(0,0,0,0), text=(255,248,235,255), ok=(150,230,160,255), err=(255,110,100,255),
                    lamp=(240,150,20,255), lamp_edge=(130,70,0,255), lamp_err=(220,50,50,255),
                    mark=(170,158,135,255), bg_a=(236,228,212,255), bg_b=(226,216,196,255)),
}

def load_font(size):
    for name in ('DejaVuSans-Bold.ttf', 'Arial Bold.ttf', 'arialbd.ttf', 'Helvetica.ttc', 'LiberationSans-Bold.ttf'):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default(size=size)   # Pillow >= 10.1

FONT = load_font(px(40))

def finish(img, path):
    img.resize((S, S), Image.LANCZOS).save(path)

def cell(color):
    img = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    ImageDraw.Draw(img).rounded_rectangle((px(1), px(1), N - px(1), N - px(1)), radius=px(3), fill=color)
    return img

def digit(n, color):
    img = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    b = d.textbbox((0, 0), str(n), font=FONT)
    d.text((C - (b[0] + b[2]) / 2, C - (b[1] + b[3]) / 2), str(n), font=FONT, fill=color)
    return img

def lamp(fill, edge):
    img = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = px(16)
    d.ellipse((C - r, C - r, C + r, C + r), fill=fill, outline=edge, width=px(3))
    h = px(5)
    d.ellipse((C - px(8), C - px(9), C - px(8) + 2 * h, C - px(9) + 2 * h), fill=(255, 255, 255, 170))
    return img

for name, t in THEMES.items():
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', name)
    os.makedirs(out, exist_ok=True)

    finish(cell(t['white']), f'{out}/white.png')
    finish(cell(t['lit']), f'{out}/lit.png')
    finish(cell(t['black']), f'{out}/black.png')

    for n in range(5):
        finish(digit(n, t['text']), f'{out}/clue_{n}.png')
        finish(digit(n, t['ok']), f'{out}/clue_{n}_ok.png')
        finish(digit(n, t['err']), f'{out}/clue_{n}_err.png')

    finish(lamp(t['lamp'], t['lamp_edge']), f'{out}/lamp.png')
    finish(lamp(t['lamp_err'], t['lamp_edge']), f'{out}/lamp_err.png')

    img = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    r = px(5)
    ImageDraw.Draw(img).ellipse((C - r, C - r, C + r, C + r), fill=t['mark'])
    finish(img, f'{out}/mark.png')

    bg = Image.new('RGBA', (256, 256), t['bg_a'])
    d = ImageDraw.Draw(bg)
    for i in range(0, 256, 32):
        d.line([(i, 0), (i, 256)], fill=t['bg_b'], width=2)
        d.line([(0, i), (256, i)], fill=t['bg_b'], width=2)
    bg.save(f'{out}/background.png')

print('done')
