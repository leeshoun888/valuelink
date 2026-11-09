# ValueLink mark: two thick pointy-top hexagonal rings linked like a chain.
#
# Construction (R = outer circumradius):
#   ring      = outer hexagon minus inner hexagon, wall thickness T (perpendicular)
#   gap       = the ring is opened by the strip between its own inner upper-right and inner lower-left edges
#               (two parallel 30-degree lines), on the side facing the other ring, widened by G each side
#   pair      = second ring is the first rotated 180 degrees about the mark centre, offset D to the right
#   corners   = outer convex corners rounded by RC, inner concave corners by RI
# Output: mark.svg (black), mark_white.svg, and a construction sheet.
#
#   python3 mark.py [R T D G RC RI]
import math, sys
from shapely.geometry import Polygon, box
from shapely import affinity

args = [float(a) for a in sys.argv[1:]]
R, T, D, G, RC, RI = (args + [100, 0.465, 1.03, 6.0, 0.07, 0.035][len(args):])[:6] if args else [100, 0.465, 1.03, 6.0, 0.07, 0.035]
T *= R; D *= R; RC *= R; RI *= R   # G is the bottom-cut turn in degrees
AP = R * math.sqrt(3) / 2          # outer apothem
api = AP - T                       # inner apothem
ri = api / (math.sqrt(3) / 2)      # inner circumradius

def hexagon(cx, cy, r):
    # pointy top: vertices at 90, 30, -30, -90, -150, 150 degrees (y down)
    return Polygon([(cx + r * math.cos(math.radians(a)), cy - r * math.sin(math.radians(a))) for a in (90, 30, -30, -90, -150, 150)])

def ring_piece(cx, cy):
    outer = hexagon(cx, cy, R)
    inner = hexagon(cx, cy, ri)
    # The ring opens on the side facing the other ring. Top cut: the inner upper-right edge, extended (the tail
    # keeps the full wall). Bottom cut: a ray from the inner bottom vertex, turned DELTA steeper than the edge, so
    # the gap widens toward the crossing and the other ring's tail passes with a clean knockout and no step.
    big = 10 * R
    p_top = (cx, cy - ri)
    p_bot = (cx, cy + ri)
    a1 = math.radians(30)
    a2 = math.radians(30 + G)
    cut = Polygon([p_top, (p_top[0] + math.cos(a1) * big, p_top[1] + math.sin(a1) * big),
                   (p_bot[0] + math.cos(a2) * big, p_bot[1] + math.sin(a2) * big), p_bot])
    piece = outer.difference(inner).difference(cut)
    # round outer corners (opening) and inner corners (closing)
    piece = piece.buffer(-RC, join_style='round').buffer(RC, join_style='round')
    piece = piece.buffer(RI, join_style='round').buffer(-RI, join_style='round')
    return piece

A = ring_piece(0, 0)
B = affinity.rotate(A, 180, origin=(D / 2, 0))
mark = A.union(B).simplify(0.2, preserve_topology=True)
minx, miny, maxx, maxy = mark.bounds
W, H = maxx - minx, maxy - miny

def path_d(geom):
    out = []
    geoms = getattr(geom, 'geoms', [geom])
    for g in geoms:
        for ringc in [g.exterior, *g.interiors]:
            pts = list(ringc.coords)
            out.append('M' + ' L'.join(f'{x - minx:.2f} {y - miny:.2f}' for x, y in pts) + ' Z')
    return ' '.join(out)

d = path_d(mark)
for name, col in (('mark.svg', '#000000'), ('mark_white.svg', '#ffffff')):
    with open(name, 'w') as f:
        f.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.2f} {H:.2f}"><path fill="{col}" fill-rule="evenodd" d="{d}"/></svg>\n')
with open('mark_path.txt', 'w') as f:
    f.write(f'{W:.2f} {H:.2f}\n{d}\n')
print(f'mark {W:.1f} x {H:.1f}  aspect {W / H:.3f}  pieces {len(getattr(mark, "geoms", [mark]))}')
