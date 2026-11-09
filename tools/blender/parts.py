# Precision parts for the in-app X-ray scenes (ValueLink): the high-voltage pack structure, busbars and orange
# HV cables, front and rear e-motors, the 12 V battery and a tyre shell for the tyre-pressure scene.
# Exported to web/public/3d/parts.glb in the car's web frame (+X front, +Y up, +Z right; metres).
#
#   Blender -b --python tools/blender/parts.py -- <out.glb>
import bpy, bmesh, math, sys
import numpy as np

OUT = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)

WHEEL_X = [1.54, -1.595]
WHEEL_Y = 0.385
WHEEL_R = 0.385
TRACK_Z = 0.855

def bl(x, y, z):  # web -> Blender (glTF export maps back)
    return (x, -z, y)

def lin(h):
    h = h.lstrip('#')
    c = np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])
    return tuple(np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)) + (1,)

def mat(name, color, metal=0.0, rough=0.5, emit=None, strength=0.0, coat=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = lin(color)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    if coat:
        b.inputs['Coat Weight'].default_value = coat
    if emit:
        b.inputs['Emission Color'].default_value = lin(emit)
        b.inputs['Emission Strength'].default_value = strength
    return m

M = {
    'alu': mat('hv_alu', '#b8bcc2', 0.9, 0.32),
    'alu_dark': mat('hv_alu_dark', '#5b5f66', 0.85, 0.45),
    'plate': mat('hv_cooling', '#8f949b', 0.7, 0.25),
    'copper': mat('hv_copper', '#c8794a', 1.0, 0.28),
    'orange': mat('hv_orange', '#ff7a1a', 0.0, 0.42, coat=0.4),
    'motor': mat('motor_housing', '#9aa0a8', 0.85, 0.38),
    'motor_dark': mat('motor_dark', '#2a2d32', 0.6, 0.5),
    'lv_case': mat('lv_case', '#1c1d20', 0.0, 0.55, coat=0.3),
    'lv_red': mat('lv_red', '#d8312b', 0.0, 0.4),
    'lead': mat('lv_terminal', '#9a9ea4', 1.0, 0.3),
    'tyre': mat('tyre_shell', '#ff9f0a', 0.0, 0.6),
}

def finish(o, m, bevel=0.0, seg=3, name=None):
    if name:
        o.name = name
    o.data.materials.append(m)
    if bevel:
        mod = o.modifiers.new('bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = seg
        mod.limit_method = 'ANGLE'
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    try:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(35))
    except Exception:
        bpy.ops.object.shade_smooth()
    return o

def box(name, c, s, m, bevel=0.004):
    bpy.ops.mesh.primitive_cube_add(size=1, location=bl(*c))
    o = bpy.context.active_object
    o.scale = (s[0], s[2], s[1])  # web size (x, y, z) -> Blender (x, z->y, y->z)
    bpy.ops.object.transform_apply(scale=True)
    return finish(o, m, bevel, name=name)

def cyl(name, c, r, length, axis, m, verts=48, bevel=0.003):
    rot = {'x': (0, math.pi / 2, 0), 'y': (0, 0, 0), 'z': (math.pi / 2, 0, 0)}[axis]
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=length, location=bl(*c), rotation=rot)
    o = bpy.context.active_object
    return finish(o, m, bevel, name=name)

def tube(name, pts, r, m):
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = r
    cu.bevel_resolution = 6
    sp = cu.splines.new('BEZIER')
    sp.bezier_points.add(len(pts) - 1)
    for p, w in zip(sp.bezier_points, pts):
        p.co = bl(*w)
        p.handle_left_type = p.handle_right_type = 'AUTO'
    o = bpy.data.objects.new(name, cu)
    bpy.context.collection.objects.link(o)
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.convert(target='MESH')
    o = bpy.context.active_object
    return finish(o, m, name=name)

def join(name, objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    return o

# ---- high-voltage pack structure (the modules themselves stay instanced in the app so they can fill) ------
X0, X1 = -1.42, 1.36
ZW = 0.74
Y = 0.2
frame = []
frame.append(box('f_side_l', ((X0 + X1) / 2, Y, -ZW), (X1 - X0, 0.15, 0.05), M['alu']))
frame.append(box('f_side_r', ((X0 + X1) / 2, Y, ZW), (X1 - X0, 0.15, 0.05), M['alu']))
frame.append(box('f_front', (X1, Y, 0), (0.05, 0.15, 2 * ZW), M['alu']))
frame.append(box('f_rear', (X0, Y, 0), (0.05, 0.15, 2 * ZW), M['alu']))
for i in range(1, 6):
    x = X0 + (X1 - X0) * i / 6
    frame.append(box(f'f_cross{i}', (x, Y - 0.02, 0), (0.028, 0.11, 2 * ZW - 0.05), M['alu_dark']))
frame.append(box('f_rail', ((X0 + X1) / 2, Y - 0.02, 0), (X1 - X0 - 0.05, 0.11, 0.035), M['alu_dark']))
hv_frame = join('hv_frame', frame)
cool = box('hv_cooling', ((X0 + X1) / 2, Y - 0.085, 0), (X1 - X0, 0.012, 2 * ZW), M['plate'], 0.002)
bus = []
for z in (-0.36, 0.36):
    bus.append(box(f'bus{z}', ((X0 + X1) / 2, Y + 0.068, z), (X1 - X0 - 0.12, 0.008, 0.045), M['copper'], 0.001))
for i in range(16):
    x = X0 + 0.09 + i * (X1 - X0 - 0.18) / 15
    bus.append(box(f'link{i}', (x, Y + 0.07, 0), (0.03, 0.006, 0.66), M['copper'], 0.001))
join('hv_busbar', bus)
# junction box + orange HV harness to both motors
jb = box('hv_junction', (X1 + 0.12, Y + 0.05, 0.15), (0.2, 0.12, 0.26), M['alu_dark'], 0.01)
plugs = [cyl(f'hv_plug{i}', (X1 + 0.235, Y + 0.05, 0.08 + 0.13 * i), 0.028, 0.05, 'x', M['orange']) for i in range(2)]
cab = [
    tube('hv_cable_f1', [(X1 + 0.26, Y + 0.05, 0.08), (X1 + 0.45, Y + 0.14, 0.05), (WHEEL_X[0] + 0.05, WHEEL_Y - 0.02, 0.02)], 0.017, M['orange']),
    tube('hv_cable_f2', [(X1 + 0.26, Y + 0.05, 0.21), (X1 + 0.45, Y + 0.16, 0.16), (WHEEL_X[0] + 0.05, WHEEL_Y - 0.02, 0.12)], 0.017, M['orange']),
    tube('hv_cable_r1', [(X0 - 0.02, Y + 0.05, -0.1), (X0 - 0.2, Y + 0.1, -0.08), (WHEEL_X[1] + 0.1, WHEEL_Y - 0.02, -0.05)], 0.017, M['orange']),
    tube('hv_cable_r2', [(X0 - 0.02, Y + 0.05, 0.1), (X0 - 0.2, Y + 0.1, 0.08), (WHEEL_X[1] + 0.1, WHEEL_Y - 0.02, 0.05)], 0.017, M['orange']),
]
join('hv_harness', plugs + cab + [jb])

# ---- e-motors (front induction, rear PMSM) with half-shafts -------------------------------------------
def motor(name, x, rr):
    parts = [
        cyl(f'{name}_stator', (x, WHEEL_Y, 0), rr, 0.36, 'z', M['motor'], 64, 0.006),
        cyl(f'{name}_cap_l', (x, WHEEL_Y, -0.2), rr * 0.82, 0.05, 'z', M['motor_dark'], 64),
        cyl(f'{name}_cap_r', (x, WHEEL_Y, 0.2), rr * 0.82, 0.05, 'z', M['motor_dark'], 64),
        box(f'{name}_inverter', (x + (0.18 if x > 0 else -0.18), WHEEL_Y + 0.12, 0.05), (0.2, 0.12, 0.3), M['alu'], 0.01),
        cyl(f'{name}_gear', (x - (0.12 if x > 0 else -0.12), WHEEL_Y - 0.04, 0.0), rr * 0.75, 0.3, 'z', M['motor'], 48, 0.006),
        cyl(f'{name}_shaft_l', (x, WHEEL_Y, -0.52), 0.026, 0.62, 'z', M['motor_dark'], 24),
        cyl(f'{name}_shaft_r', (x, WHEEL_Y, 0.52), 0.026, 0.62, 'z', M['motor_dark'], 24),
    ]
    for i in range(10):  # cooling fins
        a = i / 10 * math.pi * 2
        parts.append(box(f'{name}_fin{i}', (x + math.cos(a) * rr * 0.98, WHEEL_Y + math.sin(a) * rr * 0.98, 0), (0.012, 0.012, 0.3), M['motor'], 0.002))
    return join(name, parts)

motor('motor_front', WHEEL_X[0], 0.13)
motor('motor_rear', WHEEL_X[1], 0.15)

# ---- 12 V battery (front, under the hood) -----------------------------------------------------------------
lv = [
    box('lv_body', (1.92, 0.62, -0.42), (0.24, 0.17, 0.18), M['lv_case'], 0.012),
    box('lv_lid', (1.92, 0.71, -0.42), (0.245, 0.02, 0.185), M['lv_case'], 0.006),
    cyl('lv_pos', (1.98, 0.735, -0.48), 0.014, 0.03, 'y', M['lead'], 24),
    cyl('lv_neg', (1.86, 0.735, -0.48), 0.014, 0.03, 'y', M['lead'], 24),
    cyl('lv_cap', (1.98, 0.75, -0.48), 0.02, 0.012, 'y', M['lv_red'], 24),
]
join('lv_battery', lv)

# ---- tyre shell (front-left): a slightly oversized tyre for the pressure scene -------------------------
bm = bmesh.new()
prof = []
W = 0.25
for i in range(25):  # sidewall bulge profile in (r, z)
    t = i / 24
    z = (t - 0.5) * W
    bulge = 1 - (2 * (t - 0.5)) ** 4
    prof.append((WHEEL_R * 0.66 + (WHEEL_R * 1.015 - WHEEL_R * 0.66) * (0.35 + 0.65 * bulge), z))
rings = []
SEG = 96
for k in range(SEG):
    a = k / SEG * math.pi * 2
    ring = []
    for r, z in prof:
        groove = 0.006 if (abs(z) < W * 0.42 and (int((z + W / 2) / (W / 5)) % 2 == 1)) and r > WHEEL_R * 0.98 else 0
        rr = r - groove
        ring.append(bm.verts.new(bl(math.cos(a) * rr, math.sin(a) * rr, z)))
    rings.append(ring)
for k in range(SEG):
    a, b = rings[k], rings[(k + 1) % SEG]
    for j in range(len(prof) - 1):
        bm.faces.new((a[j], a[j + 1], b[j + 1], b[j]))
me = bpy.data.meshes.new('tyre_shell')
bm.to_mesh(me)
tyre = bpy.data.objects.new('tyre_shell', me)
bpy.context.collection.objects.link(tyre)
finish(tyre, M['tyre'])

bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=True, export_yup=True)
print('parts ->', OUT)
