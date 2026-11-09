# Composes the captured 침수흔적도 tiles (web/public/pub/tiles) around the scenario's office into one texture for
# the Cycles flood render: the flood polygons recoloured to a single luminous blue on transparent, centred on the
# car, the same mapping the app uses (2,000 m across a 16 m plate).
#
#   python3 tools/blender/floodmap.py <out.png>
import math, os, sys
from PIL import Image

K = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TILES = os.path.join(K, 'web', 'public', 'pub', 'tiles')
OUT = sys.argv[1]
LAT0, LNG0 = 37.4959, 127.0276
SPAN = 2000
N = 4096
M_LNG = 111_320 * math.cos(math.radians(LAT0))

canvas = Image.new('RGBA', (N, N), (0, 0, 0, 0))
for tx in range(int((LNG0 - 0.012) // 0.01), int((LNG0 + 0.012) // 0.01) + 1):
    for ty in range(int((LAT0 - 0.012) // 0.01), int((LAT0 + 0.012) // 0.01) + 1):
        p = os.path.join(TILES, f'flood_{tx}_{ty}.png')
        if not os.path.exists(p):
            continue
        t = Image.open(p).convert('RGBA')
        a = t.split()[3].point(lambda v: 255 if v > 40 else 0)
        blue = Image.new('RGBA', t.size, (10, 132, 255, 255))
        blue.putalpha(a)
        x0 = N / 2 + ((tx * 0.01 - LNG0) * M_LNG / SPAN) * N
        y0 = N / 2 - (((ty + 1) * 0.01 - LAT0) * 110_540 / SPAN) * N
        x1 = N / 2 + (((tx + 1) * 0.01 - LNG0) * M_LNG / SPAN) * N
        y1 = N / 2 - ((ty * 0.01 - LAT0) * 110_540 / SPAN) * N
        blue = blue.resize((max(1, round(x1 - x0)), max(1, round(y1 - y0))), Image.LANCZOS)
        canvas.alpha_composite(blue, (round(x0), round(y0)))
# radial fade into the studio floor
fade = Image.radial_gradient('L').resize((N, N))
fade = fade.point(lambda v: max(0, 255 - int(max(0, v - 90) * 1.55)))
r, g, b, a = canvas.split()
a = Image.composite(a, Image.new('L', (N, N), 0), fade)
canvas = Image.merge('RGBA', (r, g, b, a))
canvas.save(OUT)
print('floodmap ->', OUT)
