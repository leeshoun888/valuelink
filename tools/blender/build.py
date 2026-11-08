# Builds the studio IONIQ 5 for JEGAP from the loft exported by export-geometry.ts, bakes ambient
# occlusion and panel lines into textures, saves car.blend and exports web/public/3d/ioniq5.glb.
#
#   Blender -b --python tools/blender/build.py -- <ioniq5.json> <out_dir> [bake_samples]
#
# Frames: the web uses +X front, +Y up, +Z right. Blender is Z-up; glTF export converts Blender
# (x, y, z) → glTF (x, z, -y), so web (x, y, z) is placed at Blender (x, -z, y).
import bpy, bmesh, json, math, os, sys
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
BAKE_SAMPLES = int(argv[2]) if len(argv) > 2 else 256
PAINT = argv[3] if len(argv) > 3 else '#c3c6cb'   # silver; '#16171a' = deep black
os.makedirs(OUT, exist_ok=True)
D = json.load(open(SRC))
U, V = D['U'], D['V']
BELT, WX, WY, WR, AR, TZ = D['BELT_Y'], D['WHEEL_X'], D['WHEEL_Y'], D['WHEEL_R'], D['ARCH_R'], D['TRACK_Z']

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

def bl(x, y, z):
    return (x, -z, y)

def srgb_to_lin(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

def hexrgb(h):
    h = h.lstrip('#')
    return [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]

# ---- materials ------------------------------------------------------------------------------------------

def principled(name, color, metallic=0.0, rough=0.5, coat=0.0, coat_rough=0.05, emission=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*srgb_to_lin(hexrgb(color)), 1)
    b.inputs['Metallic'].default_value = metallic
    b.inputs['Roughness'].default_value = rough
    b.inputs['Coat Weight'].default_value = coat
    b.inputs['Coat Roughness'].default_value = coat_rough
    if emission:
        b.inputs['Emission Color'].default_value = (*srgb_to_lin(hexrgb(emission)), 1)
        b.inputs['Emission Strength'].default_value = strength
    return m

ZONES = [
    # name, colour, metallic, roughness, coat
    ('paint', PAINT, 0.75, 0.33, 1.0),
    ('glass', '#07080a', 0.0, 0.06, 0.3),
    ('roof', '#0a0c0e', 0.0, 0.06, 0.3),
    ('trim', '#17181b', 0.0, 0.62, 0.0),
    ('pillar', '#0d0e10', 0.2, 0.18, 1.0),
    ('apillar', '#030304', 0.0, 0.6, 0.0),
]
# One body material: colour, roughness / metalness and clear coat all come from textures, so zone borders
# are as smooth as the texture (per-face material slots left staircase edges in the coat).
body_mat = principled('body', '#ffffff', 0.0, 0.5, 1.0, 0.06)
mats = {'body': body_mat}

# ---- body ------------------------------------------------------------------------------------------------

P = np.array(D['body'], dtype=np.float64).reshape(U, V, 3)

me = bpy.data.meshes.new('body')
verts = []
for i in range(U):
    for j in range(V + 1):
        x, y, z = P[i, j % V]
        verts.append(bl(x, y, z))
faces = []
for i in range(U - 1):
    for j in range(V):
        a = i * (V + 1) + j
        b = (i + 1) * (V + 1) + j
        faces.append((a, b, b + 1, a + 1))
me.from_pydata(verts, [], faces)
me.update()
uv = me.uv_layers.new(name='UVMap')
for poly in me.polygons:
    for li in poly.loop_indices:
        vi = me.loops[li].vertex_index
        i, j = divmod(vi, V + 1)
        uv.data[li].uv = (i / (U - 1), j / V)

body = bpy.data.objects.new('body', me)
scene.collection.objects.link(body)
bm = bmesh.new()
bm.from_mesh(me)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.to_mesh(me)
bm.free()
for poly in me.polygons:
    poly.use_smooth = True

order = [z[0] for z in ZONES]
me.materials.append(body_mat)

# ---- side window panes (separate so the app can lower them) ---------------------------------------------

gu, gv = D['paneGrid']
glass_pane = principled('window', '#0e1318', 0.0, 0.04, 0.3)
glass_pane.node_tree.nodes['Principled BSDF'].inputs['Specular IOR Level'].default_value = 0.3
for name, pts in D['panes'].items():
    a = np.array(pts).reshape(gu, gv, 3)
    pm = bpy.data.meshes.new(name)
    vv = [bl(*a[i, j]) for i in range(gu) for j in range(gv)]
    ff = [(i * gv + j, (i + 1) * gv + j, (i + 1) * gv + j + 1, i * gv + j + 1) for i in range(gu - 1) for j in range(gv - 1)]
    pm.from_pydata(vv, [], ff)
    pm.update()
    for p_ in pm.polygons:
        p_.use_smooth = True
    pm.materials.append(glass_pane)
    o = bpy.data.objects.new(name, pm)
    scene.collection.objects.link(o)

# ---- lamps ---------------------------------------------------------------------------------------------------

def lamp_obj(name, arr, color):
    a = np.array(arr).reshape(-1, 3)
    lm = bpy.data.meshes.new(name)
    vv = [bl(*p) for p in a]
    ff = [(k, k + 1, k + 2) for k in range(0, len(vv), 3)]
    lm.from_pydata(vv, [], ff)
    lm.update()
    lm.materials.append(principled(name, '#202226', 0.0, 0.3, 0.0, emission=color, strength=0.0))
    o = bpy.data.objects.new(name, lm)
    scene.collection.objects.link(o)
    return o

lamp_obj('lamp_head', D['headLamp'], '#eaf2ff')
lamp_obj('lamp_tail', D['tailLamp'], '#ff1f3a')

# ---- mirrors ---------------------------------------------------------------------------------------------------

def side_z_at(x, y):
    i = int(round(math.acos(max(-1, min(1, -x / D['HALF_L']))) / math.pi * (U - 1)))
    ring = P[i]
    k = np.argmin(np.abs(ring[:, 1] - y) + (ring[:, 2] < 0) * 9)
    return abs(ring[k, 2])

mirror_mat = principled('mirror', '#141518', 0.3, 0.3, 1.0)
for side in (-1, 1):
    zc = side * (side_z_at(1.2, 1.2) + 0.11)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=1, location=bl(1.17, 1.25, zc))
    pod = bpy.context.object
    pod.scale = (0.085, 0.11, 0.06)      # blender axes: length, out (web z), height
    pod.rotation_euler = (0, 0, math.radians(-8 * side))
    pod.data.materials.append(mirror_mat)
    bpy.ops.object.shade_smooth()
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.018, depth=0.12, location=bl(1.2, 1.2, side * (side_z_at(1.2, 1.2) + 0.05)), rotation=(math.pi / 2, 0, 0))
    stalk = bpy.context.object
    stalk.data.materials.append(mirror_mat)
    bpy.ops.object.shade_smooth()
    bpy.ops.object.select_all(action='DESELECT')
    pod.select_set(True)
    stalk.select_set(True)
    bpy.context.view_layer.objects.active = pod
    bpy.ops.object.join()
    pod.name = 'mirror_l' if side < 0 else 'mirror_r'

# ---- wheels ---------------------------------------------------------------------------------------------------

tire_mat = principled('tire', '#141518', 0.0, 0.88)
rim_mat = principled('rim', '#c9ccd1', 1.0, 0.24)
rim_dark = principled('rim_dark', '#1b1d20', 0.6, 0.45)
disc_mat = principled('brake', '#6e7178', 1.0, 0.35)

PROFILE = [(0.262, -0.118), (0.3, -0.13), (0.352, -0.133), (0.374, -0.124), (0.384, -0.104), (WR, 0.0),
           (0.384, 0.104), (0.374, 0.124), (0.352, 0.133), (0.3, 0.13), (0.262, 0.118)]

def build_wheel(name, cx, side):
    parts = []
    # tyre: lathe of the 255/45R20 profile around the axle (web z axis)
    tm = bpy.data.meshes.new(name + '_tyre')
    N = 128
    vv = []
    for k in range(N):
        a = 2 * math.pi * k / N
        for r, w in PROFILE:
            vv.append(bl(cx + r * math.cos(a), WY + r * math.sin(a), side * TZ + w))
    m = len(PROFILE)
    ff = []
    for k in range(N):
        k2 = (k + 1) % N
        for j in range(m - 1):
            ff.append((k * m + j, k2 * m + j, k2 * m + j + 1, k * m + j + 1))
    tm.from_pydata(vv, [], ff)
    tm.update()
    for p_ in tm.polygons:
        p_.use_smooth = True
    tm.materials.append(tire_mat)
    t = bpy.data.objects.new(name + '_tyre', tm)
    scene.collection.objects.link(t)
    parts.append(t)
    face_z = side * (TZ + 0.112)
    # dark inner face, brake disc
    for r, depth, zoff, mat, nm in ((0.262, 0.02, 0.0, rim_dark, 'face'), (0.175, 0.03, -0.06, disc_mat, 'disc')):
        bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=r, depth=depth, location=bl(cx, WY, face_z + side * zoff), rotation=(math.pi / 2, 0, 0))
        o = bpy.context.object
        o.name = f'{name}_{nm}'
        o.data.materials.append(mat)
        bpy.ops.object.shade_smooth()
        parts.append(o)
    # outer lip
    bpy.ops.mesh.primitive_torus_add(major_radius=0.25, minor_radius=0.012, major_segments=96, minor_segments=12, location=bl(cx, WY, face_z + side * 0.012), rotation=(math.pi / 2, 0, 0))
    o = bpy.context.object
    o.name = f'{name}_lip'
    o.data.materials.append(rim_mat)
    bpy.ops.object.shade_smooth()
    parts.append(o)
    # 18 swept turbine blades
    for k in range(18):
        a = 2 * math.pi * k / 18
        bpy.ops.mesh.primitive_cube_add(size=1)
        o = bpy.context.object
        o.name = f'{name}_blade{k}'
        o.scale = (0.17, 0.03, 0.018)
        r0 = 0.152
        ang = a * side
        o.location = bl(cx + r0 * math.cos(ang), WY + r0 * math.sin(ang), face_z + side * 0.018)
        # in-plane rotation about the axle + a little sweep
        o.rotation_euler = (0, -(ang + 0.32 * side), 0)
        bv = o.modifiers.new('bevel', 'BEVEL')
        bv.width = 0.006
        bv.segments = 2
        o.data.materials.append(rim_mat)
        parts.append(o)
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.06, depth=0.04, location=bl(cx, WY, face_z + side * 0.025), rotation=(math.pi / 2, 0, 0))
    o = bpy.context.object
    o.name = f'{name}_hub'
    o.data.materials.append(rim_mat)
    bpy.ops.object.shade_smooth()
    parts.append(o)
    bpy.ops.object.select_all(action='DESELECT')
    for p_ in parts:
        p_.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.convert(target='MESH')
    bpy.ops.object.join()
    w = bpy.context.object
    w.name = name
    return w

wheels = []
for cx, tag in ((WX[0], 'f'), (WX[1], 'r')):
    for side, s in ((-1, 'l'), (1, 'r')):
        wheels.append(build_wheel(f'wheel_{tag}{s}', cx, side))

# ---- detail texture: panel gaps + crease, in the loft's UV space ----------------------------------------

TW, TH = 4096, 2048
detail = np.ones((TH, TW), dtype=np.float64)

def draw(segs, value, width_px):
    segs = np.array(segs).reshape(-1, 4)
    for u0, v0, u1, v1 in segs:
        x0, y0, x1, y1 = u0 * (TW - 1), v0 * (TH - 1), u1 * (TW - 1), v1 * (TH - 1)
        n = int(max(abs(x1 - x0), abs(y1 - y0)) * 2) + 2
        xs = np.linspace(x0, x1, n)
        ys = np.linspace(y0, y1, n)
        for dx in range(-width_px, width_px + 1):
            for dy in range(-1, 2):
                xi = np.clip(np.round(xs + dx).astype(int), 0, TW - 1)
                yi = np.clip(np.round(ys + dy).astype(int), 0, TH - 1)
                fall = math.exp(-(dx * dx) / (2 * max(1, width_px) ** 2) - (dy * dy) / 1.2)
                detail[yi, xi] = np.minimum(detail[yi, xi], 1 - (1 - value) * fall)

draw(D['gaps'], 0.04, 3)
draw(D['creases'], 0.72, 4)

# ---- bake ambient occlusion ------------------------------------------------------------------------------

scene.render.engine = 'CYCLES'
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    scene.cycles.device = 'GPU'
except Exception as e:
    print('GPU setup failed', e)
scene.cycles.samples = BAKE_SAMPLES

bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
ground = bpy.context.object
ground.name = 'bake_ground'

AW, AH = 2048, 1024
ao_img = bpy.data.images.new('ao', AW, AH, alpha=False, float_buffer=True)
for m in mats.values():
    nt = m.node_tree
    node = nt.nodes.new('ShaderNodeTexImage')
    node.image = ao_img
    nt.nodes.active = node
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
bpy.context.view_layer.objects.active = body
scene.render.bake.margin = 8
bpy.ops.object.bake(type='AO')
ao = np.array(ao_img.pixels[:]).reshape(AH, AW, 4)[:, :, 0]
print('AO baked', ao.min(), ao.mean())

# ---- per-texel zones (smooth boundaries): sample the loft surface at every texel ---------------------------

def texel_zones(w, h):
    vv = (np.arange(h) + 0.5) / h
    uu = (np.arange(w) + 0.5) / w
    fu = uu[None, :] * (U - 1)
    fv = vv[:, None] * V
    i0 = np.clip(np.floor(fu).astype(int), 0, U - 2)
    j0 = np.floor(fv).astype(int) % V
    j1 = (j0 + 1) % V
    tu = fu - i0
    tv = fv - np.floor(fv)
    i0b = np.broadcast_to(i0, (h, w))
    j0b = np.broadcast_to(j0, (h, w))
    j1b = np.broadcast_to(j1, (h, w))
    tub = np.broadcast_to(tu, (h, w))[..., None]
    tvb = np.broadcast_to(tv, (h, w))[..., None]
    def bil(G):
        a = G[i0b, j0b]; b = G[i0b + 1, j0b]; c = G[i0b, j1b]; d = G[i0b + 1, j1b]
        return (a * (1 - tub) + b * tub) * (1 - tvb) + (c * (1 - tub) + d * tub) * tvb
    du = np.gradient(P, axis=0)
    dv = (np.roll(P, -1, axis=1) - np.roll(P, 1, axis=1)) / 2
    N = np.cross(du, dv)
    N /= np.linalg.norm(N, axis=2, keepdims=True) + 1e-12
    # orient outward: normals point away from the section centre
    cen = P.mean(axis=1, keepdims=True)
    flip = np.sign(np.sum(N * (P - cen), axis=2, keepdims=True))
    N *= np.where(flip == 0, 1, flip)
    p = bil(P)
    n = bil(N)
    x, y, z = p[..., 0], p[..., 1], p[..., 2]
    top_i = P[:, :, 1].max(axis=1)                      # roof height per section
    top = top_i[i0b] * (1 - tub[..., 0]) + top_i[i0b + 1] * tub[..., 0]
    ny, nz = n[..., 1], n[..., 2]
    zone = np.full((h, w), order.index('glass'), dtype=np.int8)
    def put(mask, name):
        zone[mask & free] = order.index(name)
        free[mask] = False
    free = np.ones((h, w), dtype=bool)
    arch = np.zeros((h, w), dtype=bool)
    for cx in WX:
        r = np.hypot(x - cx, y - WY)
        arch |= (r > AR * 0.98) & (r < AR * 1.16) & (y > 0.3) & (np.abs(nz) > 0.45)
    front_intake = (x > 2.05) & (y < 0.62)
    rear_bumper = (x < -2.1) & (y < 0.6)
    put(arch | (y < 0.33) | front_intake | rear_bumper, 'trim')
    put((y < BELT + 0.025) | (x > 1.27) | (x < -2.36), 'paint')
    put((x > 0.12) & (x < 1.15) & (y > BELT + 0.05) & (np.abs(z) > 0.5) & (ny > 0.2), 'apillar')
    put((x > 0.33) & (x < 1.12), 'glass')
    put((x > 0.18) & (x <= 0.33) & (ny < 0.8), 'glass')   # A-pillar base, black on the car
    # A-pillars: the diagonal corner between windscreen and side glass, satin black (no coat: a glossy coat
    # turned the tight bend into a hot spot)
    put((x > 0.12) & (x < 1.15) & (y > BELT + 0.05) & (np.abs(nz) > 0.3) & (np.abs(nz) < 0.88) & (ny > 0.25), 'apillar')
    put((x > 0.15) & (x < 0.5) & (y > 1.25) & (ny < 0.85), 'glass')   # A-pillar top into the header
    put((x < -1.6) & (y > 1.58), 'paint')
    put(x < -1.6, 'glass')
    # side glass runs up to the daylight-opening top (roof − 7 cm) even where the tumblehome faces upward
    put((y < top - 0.07) & (x > -1.3) & (x < 0.33) & (np.abs(z) > 0.45), 'glass')
    put((ny > 0.8) & (x > -1.55) & (x < 0.3) & (np.abs(z) < 0.6), 'roof')
    put(ny > 0.8, 'paint')
    put((x >= -1.6) & (x < -1.3), 'paint')
    put((x > -0.21) & (x < -0.11), 'pillar')
    return zone

# ---- compose the body textures --------------------------------------------------------------------------

def up(a, w, h):
    yi = (np.arange(h) * a.shape[0] / h).astype(int)
    xi = (np.arange(w) * a.shape[1] / w).astype(int)
    return a[yi][:, xi]

# zone image: rows = v (around the section), cols = u (along the length)
zimg = texel_zones(TW, TH)
ao_up = up(ao, TW, TH)
cols = np.array([srgb_to_lin(hexrgb(z[1])) for z in ZONES])
rough = np.array([z[3] for z in ZONES])
metal = np.array([z[2] for z in ZONES])
shade = (detail * (0.35 + 0.65 * np.clip(ao_up, 0, 1)) ** 0.9)[..., None]
zc = cols[zimg]
for _ in range(2):
    zc = (zc + np.roll(zc, 1, 0) + np.roll(zc, -1, 0) + np.roll(zc, 1, 1) + np.roll(zc, -1, 1)) / 5
base_lin = zc * shade
base = np.clip(np.where(base_lin <= 0.0031308, base_lin * 12.92, 1.055 * base_lin ** (1 / 2.4) - 0.055), 0, 1)

def save_png(name, rgb):
    h, w = rgb.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=True)
    px = np.ones((h, w, 4))
    px[:, :, :3] = rgb
    img.pixels[:] = px.ravel()
    img.filepath_raw = os.path.join(OUT, name + '.png')
    img.file_format = 'PNG'
    img.save()
    return img

base_img = save_png('body_base', base)
# glTF metallicRoughness: G = roughness, B = metallic; gaps read slightly rougher
mr = np.zeros((TH, TW, 3))
mr[:, :, 1] = np.clip(rough[zimg] + (1 - detail) * 0.4, 0, 1)
mr[:, :, 2] = metal[zimg] * detail
mr_img = save_png('body_mr', mr)
mr_img.colorspace_settings.name = 'Non-Color'
coat = np.array([z[4] for z in ZONES])
cm = np.repeat(coat[zimg][..., None], 3, axis=2)
coat_img = save_png('body_coat', cm)
coat_img.colorspace_settings.name = 'Non-Color'

for m in mats.values():
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type == 'TEX_IMAGE':
            nt.nodes.remove(n)
    b = nt.nodes['Principled BSDF']
    tb = nt.nodes.new('ShaderNodeTexImage')
    tb.image = base_img
    nt.links.new(tb.outputs['Color'], b.inputs['Base Color'])
    tm_ = nt.nodes.new('ShaderNodeTexImage')
    tm_.image = mr_img
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(tm_.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], b.inputs['Roughness'])
    nt.links.new(sep.outputs['Blue'], b.inputs['Metallic'])
    tc = nt.nodes.new('ShaderNodeTexImage')
    tc.image = coat_img
    sc = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(tc.outputs['Color'], sc.inputs['Color'])
    nt.links.new(sc.outputs['Red'], b.inputs['Coat Weight'])

bpy.data.objects.remove(ground, do_unlink=True)

# ---- save + export ----------------------------------------------------------------------------------------

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'car.blend'))
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUT, 'ioniq5.glb'),
    export_format='GLB',
    use_selection=True,
    export_apply=True,
    export_image_format='JPEG',
    export_jpeg_quality=90,
)
print('EXPORTED', os.path.getsize(os.path.join(OUT, 'ioniq5.glb')))
