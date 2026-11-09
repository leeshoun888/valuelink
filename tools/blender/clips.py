# Event clips for the app, the demo page and the video: short Cycles animations of the scenes that look the
# same every time (the data-driven ones, battery fill, warning part and passport blocks, stay real-time in the
# app). Transparent film over a shadow catcher, so one clip sits on the app's light or dark panel and on the
# black demo page. Theme decides only the colour of the overlays (white on dark, ink on light).
#
#   Blender -b car.blend --python tools/blender/clips.py -- <out_dir> <clip> <light|dark> <w> <h> <samples> [frames]
#
# clips: rain, lights, lock, frost, sun, flood, tradeup  ->  <out_dir>/<clip>_<theme>/####.png
# Web (x, y, z) -> Blender (x, -z, y): front of the car is +x, the camera side (web z > 0... front-left) is +y.
import bpy, bmesh, math, os, sys, random
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
OUT, CLIP, THEME = argv[0], argv[1], argv[2]
W, H, SAMPLES = int(argv[3]), int(argv[4]), int(argv[5])
FRAMES = int(argv[6]) if len(argv) > 6 else 72
dark = THEME == 'dark'
scene = bpy.context.scene
HALF_L, TRACK_Z, BELT = 2.42, 0.855, 1.15

# ---- render settings ----------------------------------------------------------------------------------------
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
scene.cycles.denoiser = 'OPENIMAGEDENOISE'
scene.cycles.seed = 7  # fixed noise pattern frame to frame: less shimmer after denoising
scene.render.resolution_x = W
scene.render.resolution_y = H
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.fps = 24
scene.frame_start = 0
scene.frame_end = FRAMES - 1
scene.render.use_motion_blur = CLIP == 'rain'
scene.render.motion_blur_shutter = 0.3
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast' if dark else 'AgX - Base Contrast'

def f(t):
    """Seconds -> frame."""
    return round(t * 24)

def key(obj, path, frames_values, index=-1, interp='BEZIER'):
    for fr, v in frames_values:
        if index >= 0:
            getattr(obj, path)[index] = v
            obj.keyframe_insert(data_path=path, index=index, frame=fr)
        else:
            setattr(obj, path, v)
            obj.keyframe_insert(data_path=path, frame=fr)
    ad = obj.animation_data
    if ad and ad.action:
        for fc in getattr(ad.action, 'fcurves', []):
            for kp in fc.keyframe_points:
                kp.interpolation = interp

def key_input(sock, frames_values):
    for fr, v in frames_values:
        sock.default_value = v
        sock.keyframe_insert('default_value', frame=fr)

def mat_emit(name, rgb, strength, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*rgb, 1)
    em.inputs['Strength'].default_value = strength
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    mx = nt.nodes.new('ShaderNodeMixShader')
    mx.inputs['Fac'].default_value = alpha
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(tr.outputs[0], mx.inputs[1])
    nt.links.new(em.outputs[0], mx.inputs[2])
    nt.links.new(mx.outputs[0], out.inputs[0])
    return m, mx, em

def mat_plain(name, rgb, rough=0.6, emit=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    if emit:
        b.inputs['Emission Color'].default_value = (*rgb, 1)
        b.inputs['Emission Strength'].default_value = emit
    return m

# overlay colour: white light on the dark panel, ink on the light panel
INK = (0.9, 0.92, 0.95) if dark else (0.03, 0.035, 0.04)

# ---- studio --------------------------------------------------------------------------------------------------
world = bpy.data.worlds.new('w')
scene.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.0, 0.0, 0.0, 1) if dark else (0.8, 0.8, 0.82, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.05 if dark else 0.35

def area(name, loc, size, energy, color=(1, 1, 1), size_y=None):
    bpy.ops.object.light_add(type='AREA', location=loc)
    l = bpy.context.object
    l.name = name
    l.data.shape = 'RECTANGLE'
    l.data.size = size
    l.data.size_y = size_y or size
    l.data.energy = energy
    l.data.color = color
    l.rotation_euler = (Vector((0, 0, 0.7)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    return l

if dark:
    # the dark rig was tuned for the black build; the silver car needs about half of it
    area('top', (0, 0, 7), 3, 600, size_y=1.2)
    area('rim_l', (-6, 4, 2.2), 5, 500, (0.85, 0.9, 1.0), size_y=0.6)
    area('rim_r', (6, -4, 2.2), 5, 380, size_y=0.6)
    area('kick', (5, 5, 0.6), 3, 160, size_y=0.4)
else:
    area('top', (0, 0, 7.5), 8, 2000, size_y=4)
    area('key', (6, 5, 3), 6, 1000, size_y=2)
    area('fill', (-6, 3, 2.5), 6, 500, size_y=2)
    area('back', (-2, -7, 3), 6, 450, size_y=2)
for l in bpy.data.objects:
    if l.type == 'LIGHT' and l.name != 'top':
        l.data.use_shadow = False

def softbox(name, loc, rot, sx, sy, strength):
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.scale = (sx, sy, 1)
    m, _, _ = mat_emit(name, (1, 1, 1), strength)
    o.data.materials.append(m)
    o.visible_camera = False
    o.visible_shadow = False
    return o

k = 0.45 if dark else 1.0
softbox('sb_top', (0, 0, 4.2), (0, 0, 0), 7.0, 0.5, 9 * k)
softbox('sb_top2', (0.6, 0, 4.0), (0, 0, 0), 7.0, 0.3, 14 * k)
softbox('sb_left', (0, 4.2, 1.6), (math.radians(90), 0, 0), 9.0, 0.45, 10 * k)
softbox('sb_right', (0, -4.2, 1.9), (math.radians(-90), 0, 0), 9.0, 0.35, 8 * k)
softbox('sb_front', (5.5, 0, 1.4), (0, math.radians(90), 0), 0.6, 5.0, 6 * k)

def flag(name, loc, rot, sx, sy):
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.scale = (sx, sy, 1)
    o.data.materials.append(mat_plain(name, (0, 0, 0), 1.0))
    for attr in ('visible_camera', 'visible_shadow', 'visible_diffuse', 'visible_transmission', 'visible_volume_scatter'):
        setattr(o, attr, False)
    return o

if not dark:
    flag('flag_l', (0, 6.5, 2.6), (math.radians(90), 0, 0), 14, 2.6)
    flag('flag_r', (0, -6.5, 2.6), (math.radians(-90), 0, 0), 14, 2.6)
    flag('flag_top', (0, 0, 6.2), (0, 0, 0), 4, 14)

# floor: catches the car's shadow only, the panel behind shows through
bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
floor = bpy.context.object
floor.name = 'floor'
floor.is_shadow_catcher = True
# what the paint reflects of the floor must be the panel's own tone, not Blender's default grey
floor.data.materials.append(mat_plain('floor', (0.003, 0.003, 0.0035) if dark else (0.82, 0.82, 0.84), 0.35 if dark else 0.9))

body = bpy.data.objects['body']
sub = body.modifiers.new('subd', 'SUBSURF')
sub.levels = 1
sub.render_levels = 2

lamps = {}
for o in bpy.data.objects:
    if o.name.startswith('lamp_'):
        b = o.data.materials[0].node_tree.nodes['Principled BSDF']
        b.inputs['Emission Strength'].default_value = 3.0 if o.name == 'lamp_head' else 2.0
        lamps[o.name] = b

# ---- camera: the app's three-quarter front view (fov 24, elevation 0.24, azimuth 38 deg) -----------------------
cam_data = bpy.data.cameras.new('cam')
cam = bpy.data.objects.new('cam', cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam_data.sensor_fit = 'VERTICAL'
cam_data.angle_y = math.radians(24)
target = Vector((0.05, 0, 0.72))

def place(az_deg=38, dist=12.0, el=0.24):
    a = math.radians(az_deg)
    cam.location = Vector((math.cos(a) * dist * math.cos(el), math.sin(a) * dist * math.cos(el), 0.7 + dist * math.sin(el)))
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()

place()

# ---- clips ---------------------------------------------------------------------------------------------------
END = FRAMES - 1

def radial_decal(name, loc, size, rgb, strength, alpha_at):
    """A floor decal with a soft radial falloff; alpha_at(fac_socket_node_tree) keys its overall alpha."""
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc)
    o = bpy.context.object
    o.name = name
    o.scale = (size[0], size[1], 1)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    tc = nt.nodes.new('ShaderNodeTexCoord')
    gr = nt.nodes.new('ShaderNodeTexGradient')
    gr.gradient_type = 'QUADRATIC_SPHERE'
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (2.0, 2.0, 2.0)
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
    nt.links.new(mp.outputs['Vector'], gr.inputs['Vector'])
    mul = nt.nodes.new('ShaderNodeMath')
    mul.operation = 'MULTIPLY'
    nt.links.new(gr.outputs['Fac'], mul.inputs[0])
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*rgb, 1)
    em.inputs['Strength'].default_value = strength
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    mx = nt.nodes.new('ShaderNodeMixShader')
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(mul.outputs[0], mx.inputs['Fac'])
    nt.links.new(tr.outputs[0], mx.inputs[1])
    nt.links.new(em.outputs[0], mx.inputs[2])
    nt.links.new(mx.outputs[0], out.inputs[0])
    o.data.materials.append(m)
    o.visible_shadow = False
    key_input(mul.inputs[1], alpha_at)
    return o, nt, mul

def panes(fr_vals):
    """Side windows rise out of the door: scale each pane up from the belt line."""
    for o in bpy.data.objects:
        if not o.name.startswith('window_'):
            continue
        cur = o.matrix_world.translation.copy()
        # origin to the belt line so the scale grows the glass upward from the door
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        scene.cursor.location = (cur.x, cur.y, BELT + 0.03)
        bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
        key(o, 'scale', fr_vals, index=2)

if CLIP == 'rain':
    # 30 minutes before the rain: drops start, and the open windows close
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.004, depth=0.36, location=(0, 0, -20), rotation=(0, math.pi / 2, 0))
    drop = bpy.context.object
    drop.name = 'drop'
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)   # long axis on X: particles align X to velocity
    dm, mx, _ = mat_emit('drop', INK if dark else (0.32, 0.38, 0.45), 1.0 if dark else 0.0, 0.38 if dark else 0.3)
    drop.data.materials.append(dm)
    drop.location = (0, 0, -500)   # the template sits far out of view (hiding it would hide its instances)
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0.3, 0, 4.6))
    em = bpy.context.object
    em.name = 'rain_emitter'
    em.scale = (10, 8, 1)
    ps = em.modifiers.new('rain', 'PARTICLE_SYSTEM').particle_system
    s = ps.settings
    s.count = 5200
    s.frame_start = -60
    s.frame_end = END
    s.lifetime = 12   # 4.6 m at 9 m/s: gone as it reaches the floor
    s.emit_from = 'FACE'
    s.normal_factor = -9.0
    s.effector_weights.gravity = 0.0
    s.render_type = 'OBJECT'
    em.show_instancer_for_render = False
    s.instance_object = drop
    s.particle_size = 1.0
    s.use_rotations = True
    s.rotation_mode = 'VEL'
    s.use_rotation_instance = True
    s.distribution = 'RAND'
    s.use_die_on_collision = False
    # the car keeps the rain off what is under it
    col = body.modifiers.new('col', 'COLLISION')
    body.collision.use_particle_kill = True
    floor_col = floor.modifiers.new('col', 'COLLISION')
    floor.collision.use_particle_kill = True
    panes([(0, 0.25), (f(0.8), 0.25), (f(2.4), 1.0)])
    ps.point_cache.frame_start = -60
    ps.point_cache.frame_end = END
    scene.frame_start = -60
    with bpy.context.temp_override(scene=scene, point_cache=ps.point_cache):
        bpy.ops.ptcache.bake_all(bake=True)   # simulate the pre-roll once; every frame then reads the cache
    scene.frame_start = 0
    scene.frame_set(36)
    dg = bpy.context.evaluated_depsgraph_get()
    alive = [p for p in em.evaluated_get(dg).particle_systems[0].particles if p.alive_state == 'ALIVE']
    print('RAIN alive at 36:', len(alive), alive[0].location if alive else None)

if CLIP == 'lights':
    # left on after parking: the low beams light the floor, then fade out
    o, nt, mul = radial_decal('beam_pool', (HALF_L + 1.05, 0, 0.006), (2.8, 2.3), (1.0, 0.98, 0.94) if dark else (0.55, 0.6, 0.66), 4.0 if dark else 0.0,
                              [(0, 0.85), (f(0.9), 0.85), (f(2.4), 0.0)])
    head = lamps.get('lamp_head')
    if head:
        key_input(head.inputs['Emission Strength'], [(0, 9.0), (f(0.9), 9.0), (f(2.4), 0.6)])

if CLIP == 'lock':
    # parked in a theft hotspot: a line draws once around the car, the lamps blink twice
    cu = bpy.data.curves.new('ring', 'CURVE')
    cu.dimensions = '3D'
    sp = cu.splines.new('POLY')
    w, h, r = HALF_L + 0.22, TRACK_Z + 0.3, 0.5
    pts = []
    for cx, cy, a0 in ((w - r, h - r, 0), (-w + r, h - r, 90), (-w + r, -h + r, 180), (w - r, -h + r, 270)):
        for i in range(17):
            a = math.radians(a0 + 90 * i / 16)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a), 0.012))
    pts.append(pts[0])
    sp.points.add(len(pts) - 1)
    for p, (x, y, z) in zip(sp.points, pts):
        p.co = (x, y, z, 1)
    cu.bevel_depth = 0.014
    cu.bevel_resolution = 2
    ring = bpy.data.objects.new('ring', cu)
    scene.collection.objects.link(ring)
    ring.data.materials.append(mat_emit('ring', INK, 2.5 if dark else 0.0)[0] if dark else mat_plain('ring', INK, 0.5))
    ring.visible_shadow = False
    cu.bevel_factor_start = 0.0
    cu.bevel_factor_end = 0.0
    cu.keyframe_insert('bevel_factor_end', frame=f(0.2))
    cu.bevel_factor_end = 1.0
    cu.keyframe_insert('bevel_factor_end', frame=f(1.6))
    for name in ('lamp_head', 'lamp_tail'):
        b = lamps.get(name)
        if b:
            base = 3.0 if name == 'lamp_head' else 2.0
            key_input(b.inputs['Emission Strength'], [(f(1.6), base), (f(1.7), 14), (f(1.9), base), (f(2.05), 14), (f(2.25), base)])

if CLIP == 'frost':
    # icy-road hotspot ahead: frost crystals spread across the road under the front wheels
    bpy.ops.mesh.primitive_plane_add(size=1, location=(HALF_L + 0.3, 0, 0.006))
    o = bpy.context.object
    o.name = 'frost'
    o.scale = (3.4, 3.4, 1)
    o.visible_shadow = False
    m = bpy.data.materials.new('frost')
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    tc = nt.nodes.new('ShaderNodeTexCoord')
    vo = nt.nodes.new('ShaderNodeTexVoronoi')
    vo.feature = 'DISTANCE_TO_EDGE'
    vo.inputs['Scale'].default_value = 38.0
    edge = nt.nodes.new('ShaderNodeMapRange')       # thin bright crystal edges
    edge.inputs['From Min'].default_value = 0.0
    edge.inputs['From Max'].default_value = 0.028
    edge.inputs['To Min'].default_value = 0.75
    edge.inputs['To Max'].default_value = 0.06
    nt.links.new(tc.outputs['Object'], vo.inputs['Vector'])
    nt.links.new(vo.outputs['Distance'], edge.inputs['Value'])
    gr = nt.nodes.new('ShaderNodeTexGradient')
    gr.gradient_type = 'SPHERICAL'
    mp = nt.nodes.new('ShaderNodeMapping')
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
    nt.links.new(mp.outputs['Vector'], gr.inputs['Vector'])
    grow = nt.nodes.new('ShaderNodeMapRange')       # the frosted disc grows from the centre
    grow.inputs['From Min'].default_value = 0.0
    grow.inputs['From Max'].default_value = 0.12
    nt.links.new(gr.outputs['Fac'], grow.inputs['Value'])
    mul = nt.nodes.new('ShaderNodeMath')
    mul.operation = 'MULTIPLY'
    nt.links.new(edge.outputs['Result'], mul.inputs[0])
    nt.links.new(grow.outputs['Result'], mul.inputs[1])
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (0.92, 0.96, 1.0, 1) if dark else (0.36, 0.45, 0.55, 1)
    em.inputs['Strength'].default_value = 1.6 if dark else 0.0
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    mx = nt.nodes.new('ShaderNodeMixShader')
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(mul.outputs[0], mx.inputs['Fac'])
    nt.links.new(tr.outputs[0], mx.inputs[1])
    nt.links.new(em.outputs[0], mx.inputs[2])
    nt.links.new(mx.outputs[0], out.inputs[0])
    o.data.materials.append(m)
    # the gradient's radius: scale the coordinates down over time (bigger disc)
    key_input(mp.inputs['Scale'], [(0, (9.0, 9.0, 9.0)), (f(0.3), (9.0, 9.0, 9.0)), (f(2.4), (2.2, 2.2, 2.2))])

if CLIP == 'sun':
    # hard midday sun: the light turns hard and warm, a crisp shadow forms, the roof blind closes
    bpy.ops.object.light_add(type='SUN', location=(0, 0, 10))
    sun = bpy.context.object
    sun.data.angle = math.radians(1.2)
    sun.data.color = (1.0, 0.95, 0.86)
    sun.rotation_euler = (math.radians(18), math.radians(-12), math.radians(30))
    sun.data.energy = 0.0
    sun.data.keyframe_insert('energy', frame=0)
    sun.data.energy = 4.0
    sun.data.keyframe_insert('energy', frame=f(1.2))
    # blind: a matte panel shrink-wrapped onto the glass roof, drawn front to back
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=60, y_subdivisions=20, size=1, location=(0.75, 0, 2.5))
    bl = bpy.context.object
    bl.name = 'blind'
    me = bl.data
    for v in me.vertices:   # unit grid -> x in [0, -2.0] (front edge at the origin), y in [-0.5, 0.5]
        v.co.x = -(v.co.x + 0.5) * 2.0
        v.co.y = v.co.y * 1.0
    sw = bl.modifiers.new('wrap', 'SHRINKWRAP')
    sw.target = body
    sw.wrap_method = 'PROJECT'
    sw.use_project_z = True
    sw.use_negative_direction = True
    sw.use_positive_direction = False
    sw.offset = 0.006
    bl.data.materials.append(mat_plain('blind', (0.2, 0.2, 0.21), 1.0))
    bl.visible_shadow = False
    key(bl, 'scale', [(f(1.0), 0.001), (f(2.6), 1.0)], index=0)

if CLIP == 'flood':
    # heavy-rain warning on a flood-trace spot: water rises to the hubs
    place(38, 12.0 * 1.25, 0.36)
    bpy.ops.mesh.primitive_circle_add(vertices=256, radius=7.5, fill_type='NGON', location=(0, 0, 0.0))
    wt = bpy.context.object
    wt.name = 'water'
    wm = bpy.data.materials.new('water')
    wm.use_nodes = True
    nt = wm.node_tree
    wb = nt.nodes['Principled BSDF']
    wb.inputs['Base Color'].default_value = (0.14, 0.40, 0.62, 1)
    wb.inputs['Transmission Weight'].default_value = 0.35
    wb.inputs['IOR'].default_value = 1.333
    wb.inputs['Roughness'].default_value = 0.12
    nz = nt.nodes.new('ShaderNodeTexNoise')
    nz.inputs['Scale'].default_value = 3.5
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.08
    nt.links.new(nz.outputs['Fac'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], wb.inputs['Normal'])
    # soft edge into the panel
    tc = nt.nodes.new('ShaderNodeTexCoord')
    gr = nt.nodes.new('ShaderNodeTexGradient')
    gr.gradient_type = 'QUADRATIC_SPHERE'
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (1 / 7.5, 1 / 7.5, 1 / 7.5)
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
    nt.links.new(mp.outputs['Vector'], gr.inputs['Vector'])
    pw = nt.nodes.new('ShaderNodeMath')
    pw.operation = 'POWER'
    pw.inputs[1].default_value = 0.6
    nt.links.new(gr.outputs['Fac'], pw.inputs[0])
    nt.links.new(pw.outputs[0], wb.inputs['Alpha'])
    # ripple drift
    key_input(mp.inputs['Location'], [(0, (0.0, 0.0, 0.0)), (END, (0.0, 0.0, 0.0))])
    nmp = nt.nodes.new('ShaderNodeMapping')
    nt.links.new(tc.outputs['Object'], nmp.inputs['Vector'])
    nt.links.new(nmp.outputs['Vector'], nz.inputs['Vector'])
    key_input(nmp.inputs['Location'], [(0, (0.0, 0.0, 0.0)), (END, (0.25, 0.1, 0.4))])
    wt.data.materials.append(wm)
    key(wt, 'location', [(0, 0.0), (f(0.4), 0.0), (f(2.4), 0.28)], index=2)

if CLIP == 'tradeup':
    # the best time to trade up: a band of light sweeps the car and leaves the next one, glossy black
    m = body.data.materials[0]
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    src = b.inputs['Base Color'].links[0].from_socket
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sx = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Object'], sx.inputs['Vector'])
    edge = nt.nodes.new('ShaderNodeMapRange')       # 0 ahead of the band (old car), 1 behind it (new car)
    edge.inputs['From Min'].default_value = 0.0
    edge.inputs['From Max'].default_value = 0.15
    sub_ = nt.nodes.new('ShaderNodeMath')
    sub_.operation = 'SUBTRACT'
    nt.links.new(sx.outputs['X'], sub_.inputs[0])
    nt.links.new(sub_.outputs[0], edge.inputs['Value'])
    mixc = nt.nodes.new('ShaderNodeMix')
    mixc.data_type = 'RGBA'
    nt.links.new(edge.outputs['Result'], mixc.inputs['Factor'])
    nt.links.new(src, mixc.inputs[6])
    blk = nt.nodes.new('ShaderNodeMix')             # the new car: the same texture, darkened to glossy black
    blk.data_type = 'RGBA'
    blk.blend_type = 'MULTIPLY'
    blk.inputs['Factor'].default_value = 1.0
    nt.links.new(src, blk.inputs[6])
    blk.inputs[7].default_value = (0.012, 0.013, 0.015, 1)
    nt.links.new(blk.outputs[2], mixc.inputs[7])
    nt.links.new(mixc.outputs[2], b.inputs['Base Color'])
    # sweep from the front (+x) to the rear: x - s > 0 means already swept
    key_input(sub_.inputs[1], [(0, 3.2), (f(0.5), 3.2), (f(2.4), -3.2)])
    # the band itself: a thin glowing plane that rides with the edge
    bpy.ops.mesh.primitive_plane_add(size=1, location=(3.2, 0, 1.0), rotation=(math.pi / 2, 0, math.pi / 2))
    band = bpy.context.object
    band.name = 'band'
    band.scale = (2.6, 2.2, 1)
    bm_, _, _ = mat_emit('band', (1, 1, 1), 2.4, 0.18)
    band.data.materials.append(bm_)
    band.visible_shadow = False
    band.visible_camera = False
    key(band, 'location', [(0, 3.2), (f(0.5), 3.2), (f(2.4), -3.2)], index=0)

if CLIP == 'hero':
    # opening and closing shot of the film: a slow orbit round the parked car, lamps on
    head = lamps.get('lamp_head')
    if head:
        head.inputs['Emission Strength'].default_value = 6.0
    for fr in range(0, END + 1, 4):
        tt = fr / END
        e = tt * tt * (3 - 2 * tt)
        place(18 + 34 * e, 10.5 - 0.8 * e, 0.17)
        cam.keyframe_insert('location', frame=fr)
        cam.keyframe_insert('rotation_euler', frame=fr)

# ---- render ---------------------------------------------------------------------------------------------------
dst = os.path.join(OUT, f'{CLIP}_{THEME}')
os.makedirs(dst, exist_ok=True)
scene.render.filepath = os.path.join(dst, '')
only = os.environ.get('ONLY_FRAME')
if only:
    for fr in range(-60, int(only) + 1):
        scene.frame_set(fr)
    scene.render.filepath = os.path.join(dst, f'test_{int(only):04d}.png')
    bpy.ops.render.render(write_still=True)
else:
    bpy.ops.render.render(animation=True)
print('CLIP_DONE', CLIP, THEME)
