"""
FORLORN: put a reference picture and a front render side by side, at the same scale.

  python3 forlorn/forge/sidebyside.py REF.jpg RENDER.png OUT.png REF_HEAD_BOTTOM_Y REF_FEET_Y

RENDER.png comes from look.mjs (its -render.png). The render is scaled so the distance from
the bottom of the head to the feet matches the reference, and feet are aligned.
"""
import sys
from PIL import Image
ref = Image.open(sys.argv[1]).convert('RGB'); ren = Image.open(sys.argv[2]).convert('RGBA')
REF_HEAD_BOTTOM, REF_FEET = int(sys.argv[4]), int(sys.argv[5])
px = ren.load(); W, H = ren.size
fg = lambda p: p[3] > 200 and not (p[0] > 240 and p[1] > 240 and p[2] > 240)
rows = [y for y in range(H) if any(fg(px[x, y]) for x in range(0, W, 2))]
top, feet = rows[0], rows[-1]
# the head's bottom: the first row below the head where the silhouette suddenly widens (the torso)
widths = []
for y in range(top, feet):
    xs = [x for x in range(W) if fg(px[x, y])]
    widths.append((y, (max(xs) - min(xs)) if xs else 0))
hb = None
base = None
for y, w in widths:
    if y < top + (feet - top) * 0.12: continue
    if base is None: base = w
    if w > base * 1.6: hb = y; break
k = (REF_FEET - REF_HEAD_BOTTOM) / (feet - hb)
bg = Image.new('RGBA', ren.size, (221, 221, 221, 255)); bg.alpha_composite(ren)
ren2 = bg.convert('RGB').resize((int(W * k), int(H * k)))
# align feet rows
dy = REF_FEET - int(feet * k)
out = Image.new('RGB', (ref.width * 2 + 10, ref.height), (40, 40, 44))
out.paste(ref, (0, 0))
cx = int(W * k / 2)
out.paste(ren2.crop((cx - ref.width // 2, -dy, cx - ref.width // 2 + ref.width, -dy + ref.height)), (ref.width + 10, 0))
out.save(sys.argv[3])
print('render head bottom', hb, 'feet', feet, 'scale', round(k, 3))
