# Game crags with baked detail: each crag from crag_kit.py is built at high detail by crag_detail.py (≈2 M triangles: the
# jointed blocks remeshed and displaced by a scanned rock height map), reduced to a game mesh, and the detail baked onto it.
#   Blender -b --factory-startup --python tools/blender/crag_bake.py -- <project dir> [--only 0,1] [--res 2048]
# Writes public/models/crags.glb (crag_i with UVs, normals, vertex colours: G = scrub mask), crags.json, and per crag
# public/models/crag_i_n.jpg (object-space normal map, Blender axes) and crag_i_ao.jpg (ambient occlusion).
import bpy, sys, os, math, json, time
import numpy as np
from mathutils import Vector, noise

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
argv = sys.argv[sys.argv.index('--') + 1:]
proj = argv[0]
only = [int(x) for x in argv[argv.index('--only') + 1].split(',')] if '--only' in argv else None
RES = int(argv[argv.index('--res') + 1]) if '--res' in argv else 2048
OUT = os.path.join(proj, 'public', 'models')
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
import crag_kit, crag_detail
crag_kit.scene = sc
crag_kit.SPALL = ((3, 6), (70, 110), (0.05, 0.7))
sc.render.engine = 'CYCLES'; sc.cycles.samples = 64
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences; prefs.compute_device_type = 'METAL'; prefs.get_devices()
    for d in prefs.devices: d.use = True
    sc.cycles.device = 'GPU'
except Exception as e: print('[crag_bake] cpu', e)
sc.world = bpy.data.worlds.new('w')

def sel(*obs, active=None):
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs: o.select_set(True)
    bpy.context.view_layer.objects.active = active or obs[-1]

def image(name, res, colour):
    im = bpy.data.images.new(name, res, res, alpha=False, float_buffer=False)
    im.colorspace_settings.name = 'sRGB' if colour else 'Non-Color'
    return im

def bake_target(low, im):
    m = bpy.data.materials.new(low.name + '_bake'); m.use_nodes = True
    n = m.node_tree.nodes.new('ShaderNodeTexImage'); n.image = im; m.node_tree.nodes.active = n
    low.data.materials.clear(); low.data.materials.append(m)
    return m

meta = {}; exported = []
for i, (seed, H) in enumerate(crag_kit.SPECS if hasattr(crag_kit, 'SPECS') else [(1, 46.0), (2, 38.0), (3, 52.0), (4, 30.0), (5, 42.0), (6, 26.0)]):
    if only is not None and i not in only: continue
    t0 = time.time()
    base = crag_kit.crag(f'crag_{i}_base', seed, H)
    hd = crag_detail.detail(base, voxel=0.12)
    # the game mesh: the detailed one reduced (keeps its broken silhouette), unwrapped
    # the game mesh from the clean block layout (a coarse remesh of the base), not from the flaked detail: big clean faces,
    # a sane unwrap, and every bit of the flaking goes into the normal map
    low = base.copy(); low.data = base.data.copy(); low.name = f'crag_{i}'; sc.collection.objects.link(low)
    for m in list(low.modifiers): low.modifiers.remove(m)
    rm = low.modifiers.new('rm', 'REMESH'); rm.mode = 'VOXEL'; rm.voxel_size = 0.45
    sm = low.modifiers.new('sm', 'SMOOTH'); sm.factor = 0.5; sm.iterations = 2
    sel(low); bpy.ops.object.modifier_apply(modifier='rm'); bpy.ops.object.modifier_apply(modifier='sm')
    tris = sum(len(p.vertices) - 2 for p in low.data.polygons)
    de = low.modifiers.new('dec', 'DECIMATE'); de.ratio = min(1.0, 7000 / tris); de.use_collapse_triangulate = True
    sel(low); bpy.ops.object.modifier_apply(modifier='dec')
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.003, area_weight=0.0)
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.shade_smooth()
    # bake the detail: normals from the detailed mesh onto the game mesh, then its occlusion
    nim = image(f'crag_{i}_n', RES, False); bake_target(low, nim)
    sel(hd, low, active=low)
    sc.render.bake.use_selected_to_active = True; sc.render.bake.cage_extrusion = 1.4; sc.render.bake.max_ray_distance = 2.8      # reach every bit of the displaced surface (misses come out as stray normals); sc.render.bake.margin = 8
    sc.render.bake.normal_space = 'OBJECT'      # object space: no tangent frame to disagree with three.js about
    bpy.ops.object.bake(type='NORMAL')
    nim.filepath_raw = os.path.join(OUT, f'crag_{i}_n.jpg'); nim.file_format = 'JPEG'; nim.save()
    aim = image(f'crag_{i}_ao', RES // 2, False); bake_target(low, aim)
    sc.cycles.samples = 48
    # occlusion of the game mesh's own shape (crevices, under overhangs); the fine relief is in the normal map. Baked without
    # the detailed mesh: it encloses the game mesh, so its rays come back black.
    hd.hide_render = True; sel(low, active=low); sc.render.bake.use_selected_to_active = False
    sc.world.light_settings.distance = 6.0
    bpy.ops.object.bake(type='AO')
    hd.hide_render = False
    aim.filepath_raw = os.path.join(OUT, f'crag_{i}_ao.jpg'); aim.file_format = 'JPEG'; aim.save()
    # vertex colours: G = scrub on ledges and up-facing slopes and along the foot (R, B left white)
    me = low.data; ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT'); me.color_attributes.active_color = ca
    a = np.ones((len(me.vertices), 4), dtype=np.float32); ca.data.foreach_set('color', a.ravel())
    # crevices dark: Blender's dirty vertex colours (cavity from the mesh's own concavity; no bake, nothing to come out black)
    sel(low); bpy.ops.object.mode_set(mode='VERTEX_PAINT')
    bpy.ops.paint.vertex_color_dirt(blur_strength=1.0, blur_iterations=2, clean_angle=math.pi, dirt_angle=0.0, dirt_only=True, normalize=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    d = np.empty(len(me.vertices) * 4, dtype=np.float32); ca.data.foreach_get('color', d); d = d.reshape(-1, 4)
    a[:, 0] = np.clip(0.25 + 0.75 * d[:, 0] ** 1.5, 0, 1)
    for v in me.vertices:
        nz = v.normal.z; z = v.co.z
        up = min(1.0, max(0.0, (nz - 0.35) / 0.3)); foot = max(0.0, 1.0 - z / 6.0) * 0.5
        patch = 0.5 + 0.5 * noise.noise(Vector((v.co.x * 0.1, v.co.y * 0.1, z * 0.1 + seed)))
        a[v.index, 1] = min(1.0, max(up, foot) * (0.5 + 0.8 * patch))
    ca.data.foreach_set('color', a.ravel())
    bb = [Vector(c) for c in low.bound_box]
    meta[low.name] = {'h': max(v.z for v in bb), 'tris': sum(len(p.vertices) - 2 for p in me.polygons), 'maps': [f'crag_{i}_n.jpg', f'crag_{i}_ao.jpg']}
    low.data.materials.clear()
    for o in (base, hd): bpy.data.objects.remove(o, do_unlink=True)
    exported.append(low)
    print(f'[crag_bake] crag_{i}: {meta[low.name]["tris"]} tris, {round(time.time() - t0)} s', flush=True)

sel(*exported)
kw = dict(filepath=os.path.join(OUT, 'crags.glb'), export_format='GLB', use_selection=True, export_apply=True, export_normals=True, export_texcoords=True, export_materials='NONE')
try: bpy.ops.export_scene.gltf(**kw, export_vertex_color='ACTIVE')
except TypeError: bpy.ops.export_scene.gltf(**kw, export_colors=True)
json.dump(meta, open(os.path.join(OUT, 'crags.json'), 'w'), indent=1)
print('[crag_bake] done', json.dumps({k: v['tris'] for k, v in meta.items()}))
