# Fallen limestone blocks for the foot of the Red Keep's cliff (the talus apron): each a block broken off the jointed face —
# slabs, blocks, prisms and wedges; thin parallel bedding layers, two or three big planar fractures, a few long straight
# cracks, weathered edges with chips knocked out — then reduced to game meshes (LODs) that keep the hard edges.
#   Blender -b --factory-startup --python tools/blender/talus_kit.py -- <project dir> [--preview <png>]
# Writes public/models/talus.glb (talus_0 … talus_N-1, ~1 m across, resting on y = 0; vertex colour R = crevice shading,
# G = 0 (no scrub), B = R) and talus.json.
import bpy, bmesh, sys, os, json, math, random, time
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
argv = sys.argv[sys.argv.index('--') + 1:]
proj = argv[0]
preview = argv[argv.index('--preview') + 1] if '--preview' in argv else None
OUT = os.path.join(proj, 'public', 'models')
N = 8; LODS = (20000, 4000, 1500, 220)      # triangles: within ~60 m, ~160 m, ~350 m, beyond
# --small: the rubble between the blocks (fragments 0.3–1.5 m in the game: more broken, lighter meshes) → rubble.glb
SMALL = '--small' in argv; NAME = 'rubble' if SMALL else 'talus'; SEED = 500 if SMALL else 100
if SMALL: LODS = (3000, 800, 200, 60)
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
import crag_detail

def sel(*obs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs: o.select_set(True)
    bpy.context.view_layer.objects.active = obs[-1]

def apply_all(ob):
    sel(ob)
    for m in list(ob.modifiers): bpy.ops.object.modifier_apply(modifier=m.name)

def _hash(*a):
    return (math.sin(sum(x * k for x, k in zip(a, (12.9898, 78.233, 37.719, 4.581)))) * 43758.5453) % 1.0

def block(i):
    """one fallen block, shaped as limestone breaks: thin parallel bedding layers, a couple of big planar fractures, a few
    long straight cracks, weathered (slightly rounded) edges with chips knocked out of them"""
    import numpy as np
    rnd = random.Random(SEED + i)
    kind = ('slab', 'block', 'prism', 'wedge')[i % 4]
    sx, sy, sz = {'slab': (1.0, rnd.uniform(0.65, 0.9), rnd.uniform(0.28, 0.42)), 'block': (1.0, rnd.uniform(0.7, 0.95), rnd.uniform(0.6, 0.85)),
                  'prism': (1.0, rnd.uniform(0.38, 0.55), rnd.uniform(0.4, 0.6)), 'wedge': (1.0, rnd.uniform(0.6, 0.85), rnd.uniform(0.55, 0.75))}[kind]
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts: v.co = Vector((v.co.x * sx, v.co.y * sy, v.co.z * sz))
    # no block comes off square: sheared and tapered a little (sides lean, one end narrower)
    shx, shy, tp = rnd.uniform(-0.25, 0.25), rnd.uniform(-0.2, 0.2), rnd.uniform(0.0, 0.25)
    for v in bm.verts: v.co = Vector((v.co.x + shx * v.co.z, v.co.y + shy * v.co.z, v.co.z)) * 1.0; v.co.y *= 1.0 - tp * (v.co.x / sx + 0.5)
    cuts = [(Vector((rnd.uniform(-0.4, 0.4), rnd.uniform(-0.4, 0.4), 1.0)).normalized(), 0.0)] if kind == 'wedge' else []      # a wedge: the block split on a diagonal
    for k in range(rnd.randint(5, 7) if SMALL else rnd.randint(3, 4)):      # big fractures: whole corners and edges broken away at steep angles (not many small facets)
        n = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-0.4, 1.2))).normalized()
        ext = abs(n.x) * sx / 2 + abs(n.y) * sy / 2 + abs(n.z) * sz / 2
        cuts.append((n, ext * rnd.uniform(0.45, 0.75)))
    for n, d in cuts:
        res = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=n * d, plane_no=n, clear_outer=True)
        edges = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
        if edges: bmesh.ops.contextual_create(bm, geom=edges)
    me = bpy.data.meshes.new(f'{NAME}_{i}'); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(f'{NAME}_{i}', me); sc.collection.objects.link(ob)
    # an even dense surface, its edges weathered round (a few cm), then the detail as displacement along the normal
    rm = ob.modifiers.new('rm', 'REMESH'); rm.mode = 'VOXEL'; rm.voxel_size = 0.008
    sm = ob.modifiers.new('sm', 'SMOOTH'); sm.factor = 0.7; sm.iterations = 10
    apply_all(ob)
    me = ob.data; nv = len(me.vertices)
    co = np.empty(nv * 3, dtype=np.float64); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    nr = np.empty(nv * 3, dtype=np.float64); me.vertices.foreach_get('normal', nr); nr = nr.reshape(-1, 3)
    disp = np.zeros(nv)
    # bedding: thin parallel layers (tilted a little off the block's short axis), each standing a few mm–cm proud or back on
    # the faces that cut across them, a fine groove at each bedding plane
    bn = np.array([rnd.uniform(-0.2, 0.2), rnd.uniform(-0.2, 0.2), 1.0]); bn /= np.linalg.norm(bn)
    th = rnd.uniform(0.05, 0.11) * (0.6 if kind == 'slab' else 1.0)
    t = co @ bn; side = 1.0 - np.clip((np.abs(nr @ bn) - 0.55) / 0.3, 0, 1)
    from mathutils import noise as Nz
    wob = np.array([0.18 * math.sin(c[0] * 7.0 + c[1] * 3.0) + 0.35 * Nz.noise(Vector((c[0] * 1.3, c[1] * 1.3, c[2] * 4.0 + i))) for c in co])      # layers thicken and thin
    lay = np.floor(t / th + wob); fr = t / th + wob - lay
    disp += side * np.array([(_hash(l, i, 1) - 0.5) * 0.022 for l in lay])
    disp -= side * 0.005 * np.clip(1.0 - np.minimum(fr, 1.0 - fr) * th / 0.012, 0, 1) ** 1.5      # ≥ 3 voxels wide, so it survives decimation as a groove (not a dotted line)
    # a few long straight cracks (joint planes across the bedding), each running part-way through
    for k in range(rnd.randint(0, 2)):
        cn = np.array([rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-0.3, 0.3)]); cn -= bn * (cn @ bn); cn /= np.linalg.norm(cn)
        p0 = np.array([rnd.uniform(-0.25, 0.25) * sx, rnd.uniform(-0.25, 0.25) * sy, 0.0])
        reach = np.array([rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1)]); reach /= np.linalg.norm(reach)
        # the crack wanders a little and opens and closes along its length; V-shaped (wide at the mouth)
        wander = np.array([0.012 * Nz.noise(Vector((c[0] * 9.0, c[1] * 9.0, c[2] * 9.0 + 3.1 * k))) for c in co])
        wid = 0.014 + 0.012 * np.clip(np.array([0.5 + Nz.noise(Vector((c[0] * 4.0 + 7.0 * k, c[1] * 4.0, c[2] * 4.0))) for c in co]), 0, 1)
        dist = np.abs((co - p0) @ cn + wander); along = (co - p0) @ reach
        disp -= 0.018 * np.clip(1.0 - dist / wid, 0, 1) ** 1.2 * np.clip((along + rnd.uniform(0.0, 0.3)) / 0.15, 0, 1)
    # chips knocked out of the edges: shallow conchoidal scoops where the surface turns most sharply
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    edge = ((np.abs(co[:, 0]) > hx * 0.8).astype(int) + (np.abs(co[:, 1]) > hy * 0.8) + (np.abs(co[:, 2]) > hz * 0.75)) >= 2
    idx = np.nonzero(edge)[0]
    for k in range(rnd.randint(4, 9)):
        if not len(idx): break
        pc = co[idx[rnd.randrange(len(idx))]]; r = rnd.uniform(0.05, 0.14)
        ax = np.array([rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1)]); ax /= np.linalg.norm(ax)
        dv = co - pc; dl = dv @ ax; d2 = np.sum(dv ** 2, axis=1) - dl * dl + (dl * 0.5) ** 2      # stretched along the edge
        disp -= np.clip(1.0 - d2 / (r * r), 0, 1) ** 1.5 * r * 0.16      # a shallow conchoidal scoop, not a hole
    # break surfaces are never flat: broad undulation and a few low steps across them
    disp += np.array([0.016 * Nz.noise(Vector((c[0] * 3.2 + i, c[1] * 3.2, c[2] * 3.2))) + 0.007 * Nz.noise(Vector((c[0] * 8.0, c[1] * 8.0 + i, c[2] * 8.0))) for c in co])
    # grain and small solution pits (weathered limestone), faint
    disp += np.array([0.0009 * Nz.noise(Vector((c[0] * 60.0, c[1] * 60.0, c[2] * 60.0))) for c in co])      # (faint: it scales up with the block; the fine texture is the material's)
    pit = np.array([Nz.voronoi(Vector((c[0] * 22.0, c[1] * 22.0, c[2] * 22.0)), distance_metric='DISTANCE')[0][0] for c in co])
    disp -= 0.003 * np.clip(1.0 - pit / 0.35, 0, 1) ** 1.5 * (np.array([_hash(round(c[0] * 22), round(c[1] * 22), round(c[2] * 22)) for c in co]) < 0.3)
    co += nr * disp[:, None]
    me.vertices.foreach_set('co', co.ravel()); me.update()
    hi = len(ob.data.polygons)
    de = ob.modifiers.new('dec', 'DECIMATE'); de.ratio = min(1.0, LODS[0] / (2 * hi)); de.use_collapse_triangulate = True      # (remesh gives quads: 2 triangles each)
    apply_all(ob)
    # rest on the ground: base at y = 0 (Blender z), centred
    bb = [Vector(c) for c in ob.bound_box]; mn = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb))); mx = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
    s = 1.0 / max(mx.x - mn.x, mx.y - mn.y)
    ob.data.transform(Matrix.Translation(Vector((-(mn.x + mx.x) / 2, -(mn.y + mx.y) / 2, -mn.z)))); ob.data.transform(Matrix.Scale(s, 4))
    for p in ob.data.polygons: p.use_smooth = True
    ob.data.set_sharp_from_angle(angle=math.radians(34))
    # crevice shading
    me = ob.data; ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT'); me.color_attributes.active_color = ca
    sel(ob); bpy.ops.object.mode_set(mode='VERTEX_PAINT')
    bpy.ops.paint.vertex_color_dirt(blur_strength=1.0, blur_iterations=1, clean_angle=math.pi, dirt_angle=0.0, dirt_only=True, normalize=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    import numpy as np
    d = np.empty(len(me.vertices) * 4, dtype=np.float32); ca.data.foreach_get('color', d); d = d.reshape(-1, 4)
    ao = np.clip(0.35 + 0.65 * d[:, 0] ** 1.3, 0, 1)
    out = np.stack([ao, np.zeros_like(ao), ao, np.ones_like(ao)], 1); ca.data.foreach_set('color', out.ravel())
    lods = []
    for j, t in enumerate(LODS[1:], 1):
        lo = ob.copy(); lo.data = ob.data.copy(); lo.name = f'{ob.name}_l{j}'; sc.collection.objects.link(lo)
        dl = lo.modifiers.new('dec', 'DECIMATE'); dl.ratio = t / len(ob.data.polygons); dl.use_collapse_triangulate = True
        apply_all(lo); lo.data.set_sharp_from_angle(angle=math.radians(34)); lods.append(lo)
    print(f'[talus] {ob.name}: {2 * hi} -> ' + ' / '.join(str(len(o.data.polygons)) for o in [ob] + lods) + ' tris', flush=True)
    return ob, lods

t0 = time.time()
pairs = [block(i) for i in range(N)]; obs = [a for a, b in pairs]; los = [o for a, b in pairs for o in b]
if preview:
    for o in los: o.hide_render = True
    for k, o in enumerate(obs): o.location = ((k % 4) * 1.5 - 2.25, (k // 4) * 1.6, 0); o.rotation_euler = (0, 0, (k * 0.7) % 1.2 - 0.6)
    gp = bpy.data.objects.new('ground', bpy.data.meshes.new('ground')); sc.collection.objects.link(gp)
    gp.data.from_pydata([(-6, -4, 0), (6, -4, 0), (6, 6, 0), (-6, 6, 0)], [], [(0, 1, 2, 3)])
    m = crag_detail.limestone_material()
    for o in obs: o.data.materials.append(m)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.location = (0, -4.6, 2.2); cam.rotation_euler = (math.radians(68), 0, 0); cam.data.lens = 30
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun); sun.data.energy = 4.5; sun.data.angle = math.radians(1.0); sun.rotation_euler = (math.radians(68), 0, math.radians(-70))      # low, raking from the left
    sc.world = bpy.data.worlds.new('w'); sc.world.use_nodes = True; sc.world.node_tree.nodes['Background'].inputs[0].default_value = (0.5, 0.6, 0.75, 1)
    sc.render.engine = 'CYCLES'; sc.cycles.samples = 24; sc.render.resolution_x, sc.render.resolution_y = 1400, 800
    sc.render.filepath = preview; bpy.ops.render.render(write_still=True)
    for o in obs: o.location = (0, 0, 0); o.rotation_euler = (0, 0, 0); o.data.materials.clear()
    bpy.data.objects.remove(gp)
for o in los: o.location = (0, 0, 0)
sel(*(obs + los))
kw = dict(filepath=os.path.join(OUT, NAME + '.glb'), export_format='GLB', use_selection=True, export_apply=True, export_normals=True, export_texcoords=False, export_materials='NONE')
try: bpy.ops.export_scene.gltf(**kw, export_vertex_color='ACTIVE')
except TypeError: bpy.ops.export_scene.gltf(**kw, export_colors=True)
json.dump({o.name: {'tris': len(o.data.polygons), 'lods': [f'{o.name}_l{j}' for j in range(1, len(LODS))]} for o in obs}, open(os.path.join(OUT, NAME + '.json'), 'w'), indent=1)
print('[talus] done', round(time.time() - t0), 's')
