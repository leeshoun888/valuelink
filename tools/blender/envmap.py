# Studio environment maps for the in-app car (reflections and image-based light), rendered in Cycles as
# equirectangular HDRs: long overhead strip softboxes, two side strips, a key ring and dark flags, the same
# vocabulary as the hero renders, so the live car and the stills share one look.
#
#   Blender -b --python tools/blender/envmap.py -- <out_dir> [samples]
#   -> studio_light.hdr, studio_dark.hdr (1536x768)
import bpy, math, os, sys

argv = sys.argv[sys.argv.index('--') + 1:]
OUT = argv[0]
SAMPLES = int(argv[1]) if len(argv) > 1 else 64
os.makedirs(OUT, exist_ok=True)


def build(dark):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = 1536, 768
    sc.render.image_settings.file_format = 'HDR'
    sc.view_settings.view_transform = 'Standard'
    w = bpy.data.worlds.new('w')
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.004, 0.004, 0.005, 1) if dark else (0.42, 0.43, 0.45, 1)
    bg.inputs['Strength'].default_value = 1.0

    def emissive(name, loc, rot, sx, sy, strength, color=(1, 1, 1)):
        bpy.ops.mesh.primitive_plane_add(size=1, location=loc, rotation=rot)
        o = bpy.context.active_object
        o.name = name
        o.scale = (sx, sy, 1)
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        nt.nodes.clear()
        e = nt.nodes.new('ShaderNodeEmission')
        e.inputs['Color'].default_value = (*color, 1)
        e.inputs['Strength'].default_value = strength
        out = nt.nodes.new('ShaderNodeOutputMaterial')
        nt.links.new(e.outputs[0], out.inputs[0])
        o.data.materials.append(m)
        return o

    def flag(name, loc, rot, sx, sy):
        bpy.ops.mesh.primitive_plane_add(size=1, location=loc, rotation=rot)
        o = bpy.context.active_object
        o.scale = (sx, sy, 1)
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        b = m.node_tree.nodes['Principled BSDF']
        b.inputs['Base Color'].default_value = (0.002, 0.002, 0.002, 1)
        b.inputs['Roughness'].default_value = 1
        o.data.materials.append(m)

    k = 1.0 if dark else 0.8
    # overhead strips (long highlights along the bonnet and roof)
    for i, x in enumerate((-2.2, 0, 2.2)):
        emissive(f'top{i}', (x, 0, 6), (0, 0, 0), 0.7, 8, 16 * k)
    # side strips (the belt-line streaks)
    emissive('side_l', (0, -7, 1.8), (math.pi / 2, 0, 0), 12, 0.9, 9 * k)
    emissive('side_r', (0, 7, 1.8), (-math.pi / 2, 0, 0), 12, 0.7, 6 * k)
    # rim from behind, key ring front-right, warm floor bounce card
    emissive('rim', (-8, 0, 2.4), (0, math.pi / 2, 0), 0.6, 10, 7 * k)
    bpy.ops.mesh.primitive_torus_add(major_radius=1.4, minor_radius=0.12, location=(6, 5, 4), rotation=(0, math.radians(-50), math.radians(40)))
    ring = bpy.context.active_object
    m = bpy.data.materials.new('ring')
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    e = nt.nodes.new('ShaderNodeEmission')
    e.inputs['Strength'].default_value = 18 * k
    o = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(e.outputs[0], o.inputs[0])
    ring.data.materials.append(m)
    emissive('bounce', (0, 0, -0.6), (0, 0, 0), 14, 14, 0.05 if dark else 0.45, (1.0, 0.98, 0.95))
    # dark flags so reflections have structure
    if not dark:
        flag('flag_l', (3, -6.5, 2.5), (math.pi / 2, 0, 0.3), 3, 3.5)
        flag('flag_r', (-3, 6.5, 2.5), (-math.pi / 2, 0, 0.3), 3, 3.5)

    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.type = 'PANO'
    cam.data.panorama_type = 'EQUIRECTANGULAR'
    cam.location = (0, 0, 1.0)
    cam.rotation_euler = (math.pi / 2, 0, -math.pi / 2)
    sc.collection.objects.link(cam)
    sc.camera = cam
    sc.render.filepath = os.path.join(OUT, f"studio_{'dark' if dark else 'light'}.hdr")
    bpy.ops.render.render(write_still=True)
    print('env ->', sc.render.filepath)


build(False)
build(True)
