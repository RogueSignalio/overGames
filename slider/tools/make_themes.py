"""Generates placeholder Slider themes into ../assets/<theme>/.
Run:  python3 make_themes.py     (needs Pillow)
Replace any generated PNG with your own art; the filenames are what the game loads.
Notes for artists:
  - every image is square; the game scales it to the tile size
  - arrow.png points UP; the game rotates it for the other three directions
  - tile numbers are built from digit_0 ... digit_9 placed side by side, so draw each digit
    centred in its square, all on the same baseline
  - digit_* and arrow are transparent overlays
"""
import os
from PIL import Image, ImageDraw, ImageFont

S, SS = 128, 4          # output size (pixels), supersample factor
N = S * SS
C = N // 2
px = lambda v: int(v * SS * S / 64)   # drawing coordinates are in a 64-unit space

THEMES = {
    'default': dict(slot=(33,38,54,255), tile=(66,128,198,255), tile_edge=(40,86,148,255), tile_hi=(104,160,224,255),
                    tile_ok=(70,168,128,255), tile_ok_edge=(38,116,84,255), tile_ok_hi=(112,204,166,255),
                    text=(245,248,255,255), arrow=(150,164,196,255), arrow_edge=(96,108,140,255),
                    bg_a=(24,28,40,255), bg_b=(30,35,50,255)),
    'light':   dict(slot=(222,212,190,255), tile=(236,160,52,255), tile_edge=(176,108,20,255), tile_hi=(252,196,110,255),
                    tile_ok=(132,186,104,255), tile_ok_edge=(84,134,62,255), tile_ok_hi=(176,218,150,255),
                    text=(70,44,16,255), arrow=(150,116,70,255), arrow_edge=(104,76,40,255),
                    bg_a=(236,228,212,255), bg_b=(226,216,196,255)),
}

def load_font(size):
    for name in ('DejaVuSans-Bold.ttf', 'Arial Bold.ttf', 'arialbd.ttf', 'Helvetica.ttc', 'LiberationSans-Bold.ttf'):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default(size=size)   # Pillow >= 10.1

FONT = load_font(px(46))

def finish(img, path):
    img.resize((S, S), Image.LANCZOS).save(path)

def rrect(img, inset, radius, fill, dy=0):
    ImageDraw.Draw(img).rounded_rectangle((px(inset), px(inset) + px(dy), N - px(inset), N - px(inset) + px(dy)),
                                          radius=px(radius), fill=fill)

def tile(face, edge, hi):
    img = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    rrect(img, 3, 7, edge, dy=1.5)       # darker lower edge gives a little depth
    rrect(img, 3, 7, face, dy=-1)
    glow = Image.new('RGBA', (N, N), (0, 0, 0, 0))     # separate layer so it blends instead of replacing
    ImageDraw.Draw(glow).rounded_rectangle((px(7), px(6), N - px(7), px(12)), radius=px(3), fill=hi[:3] + (90,))
    img.alpha_composite(glow)
    return img

def digit(n, color):
    # same baseline for every digit, centred horizontally by its advance width
    img = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    ref = d.textbbox((0, 0), '0', font=FONT, anchor='ls')
    cap = -ref[1]
    d.text((C, C + cap / 2), str(n), font=FONT, fill=color, anchor='ms')
    return img

def arrow(fill, edge):
    # block arrow pointing up
    pts = [(32, 9), (53, 33), (40, 33), (40, 54), (24, 54), (24, 33), (11, 33)]
    img = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pts_px = [(px(x), px(y)) for x, y in pts]
    d.polygon(pts_px, fill=fill)
    d.line(pts_px + [pts_px[0]], fill=edge, width=px(2.2), joint='curve')
    return img

for name, t in THEMES.items():
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', name)
    os.makedirs(out, exist_ok=True)

    img = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    rrect(img, 3, 7, t['slot'])
    finish(img, f'{out}/slot.png')

    finish(tile(t['tile'], t['tile_edge'], t['tile_hi']), f'{out}/tile.png')
    finish(tile(t['tile_ok'], t['tile_ok_edge'], t['tile_ok_hi']), f'{out}/tile_ok.png')
    finish(arrow(t['arrow'], t['arrow_edge']), f'{out}/arrow.png')

    for n in range(10):
        finish(digit(n, t['text']), f'{out}/digit_{n}.png')

    bg = Image.new('RGBA', (256, 256), t['bg_a'])
    d = ImageDraw.Draw(bg)
    for i in range(0, 256, 32):
        d.line([(i, 0), (i, 256)], fill=t['bg_b'], width=2)
        d.line([(0, i), (256, i)], fill=t['bg_b'], width=2)
    bg.save(f'{out}/background.png')

print('done')
