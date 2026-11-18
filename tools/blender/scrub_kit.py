# Maquis scrub for the cliff ledges and hillsides, from Poly Haven's 'shrub_04' (CC0, assets-src/models/shrub_04).
#   Blender -b --factory-startup --python tools/blender/scrub_kit.py -- <project dir> [--preview <dir>]
# 1. A leaf-card texture: several sprigs of the real shrub rendered flat (albedo only) on a transparent background, from the
#    side and from above, into one 1024² RGBA image (left half: side view, right half: top view).
# 2. Bush meshes: a dome of crossed cards carrying that texture, each card's normals bent outward from the dome's centre so the
#    bush shades as one soft mass. scrub_<v> (near, ~48 cards) and scrub_<v>_lo (far, ~12 cards); 1 m tall, foot at 0.
# Writes public/models/scrub.glb, scrub_card.png, scrub.json.
import bpy, bmesh, sys, os, json, random, math
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
proj = argv[0]
preview = argv[argv.index('--preview') + 1] if '--preview' in argv else None
OUT = os.path.join(proj, 'public', 'models')
SRC = os.path.join(proj, 'assets-src', 'models', 'shrub_04')
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene

# ---- 1. the leaf card
bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, 'shrub_04.gltf'))
src = [o for o in sc.objects if o.type == 'MESH'][0]
bpy.context.view_layer.objects.active = src; src.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bb = [Vector(c) for c in src.bound_box]; mn = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb))); mx = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
size = mx - mn; S = 1.0 / max(size.x, size.y, size.z)
src.location = -(mn + mx) / 2 * S; src.scale = (S, S, S)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
# a cluster: the sprig and four more copies turned and shifted, so the card reads as dense foliage
rnd = random.Random(5); sprigs = [src]
for k in range(5):
    c = src.copy(); c.data = src.data; sc.collection.objects.link(c)
    c.rotation_euler = (rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3), rnd.uniform(0, math.tau)); c.location = (rnd.uniform(-0.22, 0.22), rnd.uniform(-0.22, 0.22), rnd.uniform(-0.15, 0.1))
    s = rnd.uniform(0.75, 1.05); c.scale = (s, s, s); sprigs.append(c)
cam = bpy.data.objects.new('cardcam', bpy.data.cameras.new('cardcam')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = 1.25
sc.render.engine = 'BLENDER_WORKBENCH'; sh = sc.display.shading; sh.light = 'FLAT'; sh.color_type = 'TEXTURE'
sc.render.film_transparent = True; sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'
sc.render.resolution_x = sc.render.resolution_y = 512
tmp = bpy.app.tempdir
views = {'side': ((0, -3, 0), (math.radians(90), 0, 0)), 'top': ((0, 0, 3), (0, 0, 0))}
paths = {}
for k, (loc, rot) in views.items():
    cam.location = loc; cam.rotation_euler = rot
    sc.render.filepath = os.path.join(tmp, f'card_{k}.png'); bpy.ops.render.render(write_still=True); paths[k] = sc.render.filepath
# pack the two views side by side
side = bpy.data.images.load(paths['side']); top = bpy.data.images.load(paths['top'])
card = bpy.data.images.new('scrub_card', 1024, 512, alpha=True)
px = [0.0] * (1024 * 512 * 4); a = list(side.pixels); b = list(top.pixels)
for y in range(512):
    px[(y * 1024) * 4:(y * 1024 + 512) * 4] = a[y * 512 * 4:(y + 1) * 512 * 4]
    px[(y * 1024 + 512) * 4:(y * 1024 + 1024) * 4] = b[y * 512 * 4:(y + 1) * 512 * 4]
card.pixels = px; card.filepath_raw = os.path.join(OUT, 'scrub_card.png'); card.file_format = 'PNG'; card.save()
for o in sprigs: bpy.data.objects.remove(o, do_unlink=True)

# ---- 2. bush meshes: crossed cards over a dome
def bush(name, seed, n):
    rnd = random.Random(seed)
    bm = bmesh.new(); uv = bm.loops.layers.uv.new('UVMap')
    nrm = []
    R = 0.62; Hh = 1.0
    for i in range(n):
        # a point over the dome (denser low down and toward the outside), the card centred there
        u = rnd.random(); th = rnd.uniform(0, math.tau); el = math.asin(u ** 0.7)
        p = Vector((math.cos(th) * math.cos(el) * R * rnd.uniform(0.55, 1.0), math.sin(th) * math.cos(el) * R * rnd.uniform(0.55, 1.0), 0.12 + math.sin(el) * Hh * 0.72))
        top_view = el > 0.9 and rnd.random() < 0.6
        sz = rnd.uniform(0.42, 0.62)
        # card frame: facing out from the centre, leaning back, turned a little
        out = Vector((p.x, p.y, 0.0)).normalized() if p.xy.length > 1e-3 else Vector((1, 0, 0))
        if top_view:
            rx, ry = Vector((1, 0, 0)), Vector((0, 1, 0)); M = Matrix.Rotation(rnd.uniform(0, math.tau), 3, 'Z')
            ax, ay = M @ rx, M @ ry; u0 = 0.5
        else:
            ax = Vector((-out.y, out.x, 0.0)); ay = Vector((0, 0, 1.0))
            M = Matrix.Rotation(rnd.uniform(-0.5, 0.5), 3, ax) @ Matrix.Rotation(rnd.uniform(-0.6, 0.6), 3, Vector((0, 0, 1)))
            ax, ay = M @ ax, M @ ay; u0 = 0.0
        corners = [p + (-ax - ay) * sz / 2, p + (ax - ay) * sz / 2, p + (ax + ay) * sz / 2, p + (-ax + ay) * sz / 2]
        if not top_view:
            for c in corners: c.z = max(c.z, 0.0)
        vs = [bm.verts.new(c) for c in corners]
        f = bm.faces.new(vs)
        for l, (cu, cv) in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))): l[uv].uv = (u0 + cu * 0.5, cv)
        for v in vs:
            d = v.co - Vector((0, 0, 0.25)); nrm.append(d.normalized() if d.length > 1e-4 else Vector((0, 0, 1)))
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    # bent normals: out from the bush's centre (one soft mass), not the cards' own
    me.normals_split_custom_set_from_vertices(nrm)
    ob = bpy.data.objects.new(name, me); sc.collection.objects.link(ob)
    return ob

out = []
for v in range(3):
    out.append(bush(f'scrub_{v}', 11 + v, 56))
    out.append(bush(f'scrub_{v}_lo', 31 + v, 14))
meta = {o.name: {'tris': sum(len(p.vertices) - 2 for p in o.data.polygons)} for o in out}

if preview:
    os.makedirs(preview, exist_ok=True)
    m = bpy.data.materials.new('card'); m.use_nodes = True; nt = m.node_tree; bs = nt.nodes['Principled BSDF']
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = card; nt.links.new(t.outputs['Color'], bs.inputs['Base Color']); nt.links.new(t.outputs['Alpha'], bs.inputs['Alpha'])
    for k, o in enumerate(out): o.data.materials.append(m); o.location = ((k // 2) * 1.6 - 1.6, (k % 2) * 2.2, 0)
    cam.data.type = 'PERSP'; cam.location = (0, -5.5, 1.3); cam.rotation_euler = (math.radians(80), 0, 0); cam.data.lens = 35
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun); sun.data.energy = 4; sun.rotation_euler = (math.radians(50), 0, math.radians(-40))
    sc.world = bpy.data.worlds.new('w'); sc.world.use_nodes = True; sc.world.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.65, 0.8, 1)
    sc.render.film_transparent = False; sc.render.engine = 'CYCLES'; sc.cycles.samples = 32; sc.render.resolution_x, sc.render.resolution_y = 1200, 600
    sc.render.filepath = os.path.join(preview, 'scrub_preview.png'); bpy.ops.render.render(write_still=True)
    for o in out: o.location = (0, 0, 0); o.data.materials.clear()

bpy.ops.object.select_all(action='DESELECT')
for o in out: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'scrub.glb'), export_format='GLB', use_selection=True, export_apply=True, export_normals=True, export_texcoords=True, export_materials='NONE')
json.dump(meta, open(os.path.join(OUT, 'scrub.json'), 'w'), indent=1)
print('[scrub_kit]', meta)
