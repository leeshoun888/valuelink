# Apple-style studio renders of car.blend (Cycles): seamless cyclorama, large soft area lights, one object.
#
#   Blender -b car.blend --python tools/blender/render.py -- <out_dir> <shot> <width> <height> <samples>
#
# shots: hero_light, hero_dark, side_light, rear_dark, xray_dark, turntable (frames 0..71 → turn_###.png)
import bpy, math, os, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
OUT, SHOT = argv[0], argv[1]
W, H, SAMPLES = int(argv[2]), int(argv[3]), int(argv[4])
os.makedirs(OUT, exist_ok=True)
scene = bpy.context.scene
dark = SHOT.endswith('dark') or SHOT.endswith('xray')

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
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
scene.render.resolution_x = W
scene.render.resolution_y = H
scene.render.film_transparent = False
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast' if dark else 'AgX - Base Contrast'

def mat(name, rgb, rough=0.6, emit=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    if emit:
        b.inputs['Emission Color'].default_value = (*rgb, 1)
        b.inputs['Emission Strength'].default_value = emit
    return m

# cyclorama: floor curving up into a back wall
bpy.ops.mesh.primitive_plane_add(size=1)
cyc = bpy.context.object
cyc.name = 'cyc'
import bmesh
bm = bmesh.new()
R, L, Wd = 4.0, 30.0, 40.0
# (y, z) profile: floor in front, quarter-circle cove, back wall
prof = [(12.0, 0.0), (-8.0, 0.0)] + [(-8 - R * math.sin((math.pi / 2) * k / 20), R - R * math.cos((math.pi / 2) * k / 20)) for k in range(1, 21)] + [(-8 - R, 18.0)]
rows = []
for xx in (-Wd / 2, Wd / 2):
    rows.append([bm.verts.new((xx, y, z)) for y, z in prof])
for k in range(len(prof) - 1):
    bm.faces.new((rows[0][k], rows[1][k], rows[1][k + 1], rows[0][k + 1]))
bm.to_mesh(cyc.data)
bm.free()
for p in cyc.data.polygons:
    p.use_smooth = True
bg = (0.004, 0.004, 0.0045) if dark else (0.92, 0.92, 0.935)
cyc.data.materials.clear()
# dark: a black, softly reflective studio floor; light: a matte seamless sweep
cyc.data.materials.append(mat('cyc', bg, 0.32 if dark else 0.9))
cyc.rotation_euler = (0, 0, math.radians(-30))

world = bpy.data.worlds.new('w')
scene.world = world
world.use_nodes = True
wc = (0.0, 0.0, 0.0) if dark else (0.8, 0.8, 0.82)
world.node_tree.nodes['Background'].inputs['Color'].default_value = (*wc, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.0 if dark else 0.35

def area(name, loc, size, energy, color=(1, 1, 1), shape='RECTANGLE', size_y=None):
    bpy.ops.object.light_add(type='AREA', location=loc)
    l = bpy.context.object
    l.name = name
    l.data.shape = shape
    l.data.size = size
    if size_y:
        l.data.size_y = size_y
    l.data.energy = energy
    l.data.color = color
    d = Vector((0, 0, 0.7)) - Vector(loc)
    l.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return l

if dark:
    area('top', (0, 0, 7), 3, 1100, size_y=1.2)
    area('rim_l', (-6, 4, 2.2), 5, 900, (0.85, 0.9, 1.0), size_y=0.6)
    area('rim_r', (6, -4, 2.2), 5, 700, size_y=0.6)
    area('kick', (5, 5, 0.6), 3, 300, size_y=0.4)
else:
    area('top', (0, 0, 7.5), 8, 2400, size_y=4)
    area('key', (6, 5, 3), 6, 1500, size_y=2)
    area('fill', (-6, 3, 2.5), 6, 700, size_y=2)
    area('back', (-2, -7, 3), 6, 600, size_y=2)

# Strip softboxes: emissive panels the camera cannot see, so the clear coat carries long studio streaks.
def softbox(name, loc, rot, sx, sy, strength):
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.scale = (sx, sy, 1)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Strength'].default_value = strength
    outn = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(em.outputs['Emission'], outn.inputs['Surface'])
    o.data.materials.append(m)
    o.visible_camera = False
    o.visible_shadow = False
    return o

k = 0.7 if dark else 1.0
softbox('sb_top', (0, 0, 4.2), (0, 0, 0), 7.0, 0.5, 9 * k)
softbox('sb_top2', (0.6, 0, 4.0), (0, 0, 0), 7.0, 0.3, 14 * k)
softbox('sb_left', (0, 4.2, 1.6), (math.radians(90), 0, 0), 9.0, 0.45, 10 * k)
softbox('sb_right', (0, -4.2, 1.9), (math.radians(-90), 0, 0), 9.0, 0.35, 8 * k)
softbox('sb_front', (5.5, 0, 1.4), (0, math.radians(90), 0), 0.6, 5.0, 6 * k)

# Black flags: seen only in reflections (no shadows, no diffuse light), they give glass and paint the
# dark lines a real car photo has instead of mirroring a white room.
def flag(name, loc, rot, sx, sy):
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.scale = (sx, sy, 1)
    o.data.materials.append(mat(name, (0.0, 0.0, 0.0), 1.0))
    o.visible_camera = False
    o.visible_shadow = False
    o.visible_diffuse = False
    o.visible_transmission = False
    o.visible_volume_scatter = False
    return o

if not dark:
    flag('flag_l', (0, 6.5, 2.6), (math.radians(90), 0, 0), 14, 2.6)
    flag('flag_r', (0, -6.5, 2.6), (math.radians(-90), 0, 0), 14, 2.6)
    flag('flag_top', (0, 0, 6.2), (0, 0, 0), 4, 14)

# Renders only: one level of subdivision so reflections run smooth over the loft (the glb stays light).
body_obj = bpy.data.objects.get('body')
if body_obj:
    sub = body_obj.modifiers.new('subd', 'SUBSURF')
    sub.levels = 1
    sub.render_levels = 2

# headlamps on (pixel DRLs) for the beauty shots
for o in bpy.data.objects:
    if o.name.startswith('lamp_'):
        b = o.data.materials[0].node_tree.nodes['Principled BSDF']
        b.inputs['Emission Strength'].default_value = 6.0 if o.name == 'lamp_head' else 3.0

if SHOT == 'xray_dark':
    # body to clear glass, battery pack glowing under the floor
    body = bpy.data.objects['body']
    for m in body.data.materials:
        b = m.node_tree.nodes['Principled BSDF']
        b.inputs['Transmission Weight'].default_value = 1.0
        b.inputs['Roughness'].default_value = 0.08
        b.inputs['Alpha'].default_value = 0.25
    for k in range(32):
        r, i = divmod(k, 16)
        bpy.ops.mesh.primitive_cube_add(size=1, location=(-1.33 + i * 0.172, (r - 0.5) * 0.66, 0.2))
        c = bpy.context.object
        c.scale = (0.15, 0.62, 0.1)
        c.data.materials.append(mat(f'cell{k}', (0.92, 0.95, 1.0) if i < 13 else (0.08, 0.08, 0.09), 0.3, emit=1.2 if i < 13 else 0.0))

if SHOT == 'flood_dark':
    # ValueLink flood scene: the real 침수흔적도 (tools/blender/floodmap.py) glowing on the studio floor, water up
    # to the hubs, and the recommended public lot 502 m east (역삼1동문화센터) as a blue pin.
    FLOOR = 16.0
    # the real flood-trace map is optional here (the app shows it in the Value Map); water carries the scene
    bpy.ops.mesh.primitive_plane_add(size=FLOOR if os.environ.get('FLOODMAP_ON') else 0.001, location=(0, 0, 0.004))
    fl = bpy.context.object
    m = bpy.data.materials.new('floodmap')
    m.use_nodes = True
    m.blend_method = 'BLEND'
    nt = m.node_tree
    nt.nodes.clear()
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(os.environ.get('FLOODMAP', '/Volumes/Transcend/devtools/tmp/blender/floodmap.png'))
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Strength'].default_value = 2.2
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    mix = nt.nodes.new('ShaderNodeMixShader')
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(tex.outputs['Color'], em.inputs['Color'])
    nt.links.new(tex.outputs['Alpha'], mix.inputs['Fac'])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(em.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs[0])
    fl.data.materials.append(m)
    # water: clear, slightly blue, gently rippled
    bpy.ops.mesh.primitive_circle_add(vertices=256, radius=6.2, fill_type='NGON', location=(0, 0, 0.28))
    wt = bpy.context.object
    wm = bpy.data.materials.new('water')
    wm.use_nodes = True
    wb = wm.node_tree.nodes['Principled BSDF']
    wb.inputs['Base Color'].default_value = (0.14, 0.40, 0.62, 1)
    wb.inputs['Transmission Weight'].default_value = 0.88
    wb.inputs['IOR'].default_value = 1.333
    wb.inputs['Roughness'].default_value = 0.2
    nz = wm.node_tree.nodes.new('ShaderNodeTexNoise')
    nz.inputs['Scale'].default_value = 3.5
    bump = wm.node_tree.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.08
    wm.node_tree.links.new(nz.outputs['Fac'], bump.inputs['Height'])
    wm.node_tree.links.new(bump.outputs['Normal'], wb.inputs['Normal'])
    wt.data.materials.append(wm)
    # the higher camera would see the softboxes and flags: keep them in reflections only
    keep = ('floodmap', 'water', 'pin', 'lamp_')
    for o in bpy.data.objects:
        if o.type != 'MESH' or o.name.startswith(keep):
            continue
        for sl in o.material_slots:
            mt = sl.material
            if not mt or not mt.use_nodes or mt.name.startswith(keep):
                continue
            emits = [n for n in mt.node_tree.nodes if n.type == 'EMISSION' and n.inputs['Strength'].default_value > 0.5]
            pb = mt.node_tree.nodes.get('Principled BSDF')
            dark_flag = pb is not None and pb.inputs['Base Color'].default_value[0] < 0.01 and pb.inputs['Roughness'].default_value > 0.9
            if emits or dark_flag:
                o.visible_camera = False
                print('hidden from camera:', o.name)
    # target pin: 502 m east, 62 m south at 1 m = 16/2000 scene units
    k = FLOOR / 2000
    px, py = 492 * k, -62 * k
    bpy.ops.mesh.primitive_cylinder_add(radius=0.32, depth=0.01, location=(px, py, 0.01))
    pin = bpy.context.object
    pin.data.materials.append(mat('pin', (1, 1, 1), 0.3, emit=4.0))
    bpy.ops.mesh.primitive_cylinder_add(radius=0.018, depth=1.0, location=(px, py, 0.5))
    bpy.context.object.data.materials.append(mat('pin_stem', (1, 1, 1), 0.3, emit=4.0))

# ---- in-app scenes rendered for the landing page and the video -------------------------------------------
PARTS = os.environ.get('PARTS_GLB', os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'web', 'public', '3d', 'parts.glb'))

def glass_body(alpha=0.22):
    body = bpy.data.objects['body']
    for m in body.data.materials:
        b = m.node_tree.nodes['Principled BSDF']
        b.inputs['Transmission Weight'].default_value = 1.0
        b.inputs['Roughness'].default_value = 0.06
        b.inputs['Alpha'].default_value = alpha

def import_parts(keep):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=PARTS)
    for o in set(bpy.data.objects) - before:
        root = o
        while root.parent:
            root = root.parent
        if not any(root.name.startswith(k) or o.name.startswith(k) for k in keep):
            o.hide_render = True
    return [o for o in set(bpy.data.objects) - before if not o.hide_render]

def glow(objs, rgb, strength):
    for o in objs:
        if o.type != 'MESH':
            continue
        for sl in o.material_slots:
            b = sl.material.node_tree.nodes.get('Principled BSDF')
            if b:
                b.inputs['Emission Color'].default_value = (*rgb, 1)
                b.inputs['Emission Strength'].default_value = strength

if SHOT in ('warning_xray', 'charge_xray'):
    glass_body()
    parts = import_parts(['hv_', 'motor_', 'lv_battery', 'tyre_shell'])
    for k in range(32):
        r, i = divmod(k, 16)
        bpy.ops.mesh.primitive_cube_add(size=1, location=(-1.33 + i * 0.172, (r - 0.5) * 0.66, 0.2))
        c = bpy.context.object
        c.scale = (0.15, 0.62, 0.1)
        lit = SHOT == 'charge_xray' and i < 13
        c.data.materials.append(mat(f'cell{k}', (0.92, 0.95, 1.0) if lit else (0.16, 0.17, 0.19), 0.3, emit=1.4 if lit else 0.0))
    tyre = [o for o in parts if o.name.startswith('tyre_shell')]
    if SHOT == 'warning_xray':
        for o in tyre:  # front-left wheel (web z = -TRACK_Z -> Blender y = +TRACK_Z)
            o.location = (1.54, 0.855, 0.385)
        glow(tyre, (1.0, 0.55, 0.05), 9.0)
    else:
        for o in tyre:
            o.hide_render = True

if SHOT == 'tradeup_dark':
    # the next car: glossy black (render from the black build), crossed by one soft light band
    bpy.ops.mesh.primitive_plane_add(size=1, location=(-0.6, 0, 0.95), rotation=(math.pi / 2, 0, math.pi / 2))
    band = bpy.context.object
    band.scale = (0.22, 2.0, 1)
    bm = bpy.data.materials.new('band')
    bm.use_nodes = True
    nt = bm.node_tree
    nt.nodes.clear()
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Strength'].default_value = 3.0
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    gr = nt.nodes.new('ShaderNodeTexGradient')
    gr.gradient_type = 'QUADRATIC_SPHERE'
    mx = nt.nodes.new('ShaderNodeMixShader')
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(gr.outputs['Fac'], mx.inputs['Fac'])
    nt.links.new(tr.outputs[0], mx.inputs[1])
    nt.links.new(em.outputs[0], mx.inputs[2])
    nt.links.new(mx.outputs[0], out.inputs[0])
    band.data.materials.append(bm)
    band.visible_shadow = False

if SHOT.startswith('passport'):
    # 28 sealed days as glass blocks along the car: height = km, blue core = heavy-rain day, amber cap = lamp day
    gl = bpy.data.materials.new('glassblock')
    gl.use_nodes = True
    g = gl.node_tree.nodes['Principled BSDF']
    g.inputs['Base Color'].default_value = (0.96, 0.97, 1.0, 1)
    g.inputs['Transmission Weight'].default_value = 1.0
    g.inputs['Roughness'].default_value = 0.04
    g.inputs['IOR'].default_value = 1.45
    for i in range(28):
        km = 12 + round(48 * abs(math.sin(i * 1.7) * math.cos(i * 0.6))) + (60 if i % 7 == 5 else 0)
        h = 0.09 + 0.62 * km / 120
        x = -2.9 + i / 27 * 4.7
        y = -1.55  # web z = +1.55 (camera side) -> Blender y = -1.55
        bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, h / 2))
        c = bpy.context.object
        c.scale = (0.19, 0.19, h)
        bev = c.modifiers.new('b', 'BEVEL')
        bev.width = 0.008
        bev.segments = 3
        c.data.materials.append(gl)
        if i in (9, 10, 27):
            bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, h * 0.45))
            core = bpy.context.object
            core.scale = (0.07, 0.07, h * 0.8)
            core.data.materials.append(mat(f'core{i}', (0.56, 0.66, 0.75) if i != 27 else (1, 1, 1), 0.3, emit=3.0 if i != 27 else 6.0))
        if i == 21:
            bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, h + 0.012))
            cap = bpy.context.object
            cap.scale = (0.195, 0.195, 0.022)
            cap.data.materials.append(mat('cap', (1.0, 0.62, 0.04), 0.3, emit=5.0))

cam_data = bpy.data.cameras.new('cam')
cam = bpy.data.objects.new('cam', cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam_data.lens = 85
cam_data.dof.use_dof = True
cam_data.dof.aperture_fstop = 8
target = Vector((0.05, 0, 0.72))

def place(az_deg, dist=13.5, h=2.1):
    if SHOT == 'flood_dark':
        dist, h = 21.0, 8.2
    a = math.radians(az_deg)
    cam.location = Vector((math.cos(a) * dist, math.sin(a) * dist, h))
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam_data.dof.focus_distance = (target - cam.location).length
    # keep the cove wall opposite the camera (its wall sits on local −Y)
    cyc.rotation_euler = (0, 0, a - math.pi / 2)

shots = {
    'hero_light': 32, 'hero_dark': 32, 'flood_dark': 40, 'warning_xray': 24, 'charge_xray': 30, 'tradeup_dark': 28, 'passport_light': 60, 'passport_dark': 60, 'side_light': 90, 'rear_dark': 145, 'xray_dark': 30,
}
if SHOT.startswith('turntable'):
    for f in range(72):
        place(-f * 5 + 32)
        scene.render.filepath = os.path.join(OUT, f'turn_{f:03d}.png')
        bpy.ops.render.render(write_still=True)
else:
    place(-shots.get(SHOT, 32))
    scene.render.filepath = os.path.join(OUT, f'{SHOT}.png')
    bpy.ops.render.render(write_still=True)
print('RENDERED', SHOT)
