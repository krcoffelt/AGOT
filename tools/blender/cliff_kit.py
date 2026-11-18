# Sea-cliff kit: sculpted limestone cliff faces for the coast (the Red Keep's headland first).
#   Blender -b --factory-startup --python tools/blender/cliff_kit.py -- <project dir> [--preview <dir>]
# Each piece is a cliff face W wide and H tall, its outer face toward Blender -Y (glTF +Z, the game's "front"), its foot at
# z = 0 and a solid back so it can be sunk into the hillside. The face is built from the way limestone actually weathers:
# bedding layers 2–6 m thick that step in and out, each undercut where the softer bed beneath has worn back, split into
# blocks by vertical joints with open cracks between, the whole face leaning back a little and rolling over at the brink.
# Each piece also comes as <name>_lo (~5% of the triangles) for distance. Ambient occlusion is baked into the vertex colours (R), so cracks and undercuts stay dark under any light; the game's
# triplanar rock material supplies the surface texture. Writes public/models/cliffs.glb and cliffs.json.
import bpy, bmesh, sys, os, math, random, json
from mathutils import Vector, noise

argv = sys.argv[sys.argv.index('--') + 1:]
proj = argv[0]
preview = argv[argv.index('--preview') + 1] if '--preview' in argv else None
OUT = os.path.join(proj, 'public', 'models'); os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

W, H = 52.0, 42.0          # a piece, metres
# the shape itself lives in cliff_sculpt.py (shared with live previews in Blender over the MCP add-on)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cliff_sculpt

def piece(name, seed, ratio=0.14):
    ob = cliff_sculpt.build(bpy, bmesh, name, seed, W, H, step=0.25, ratio=ratio)
    ob.select_set(False)
    return ob

pieces = [piece(f'cliff_{i}', i + 1) for i in range(4)] + [piece(f'cliff_{i}_lo', i + 1, 0.03) for i in range(4)]      # full detail, and a light copy for distance

# ---- bake ambient occlusion into the vertex colours (all pieces at once, spread apart so they do not shade each other)
scene.render.engine = 'CYCLES'; scene.cycles.samples = 64; scene.cycles.device = 'CPU'
for k, ob in enumerate(pieces):
    ob.location.x = k * 200.0 + (0 if not ob.name.endswith('_lo') else 0)
    ca = ob.data.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT'); ob.data.color_attributes.active_color = ca
mat = bpy.data.materials.new('rock'); mat.use_nodes = True
for ob in pieces: ob.data.materials.append(mat)
for ob in pieces: ob.select_set(True)
bpy.context.view_layer.objects.active = pieces[0]
scene.render.bake.target = 'VERTEX_COLORS'
scene.world = bpy.data.worlds.new('w'); scene.world.use_nodes = True
bpy.ops.object.bake(type='AO')
for ob in pieces: ob.location.x = 0.0
# keep the occlusion for real crevices and overhangs: lift its floor so open faces stay pale
import numpy as np
for ob in pieces:
    ca = ob.data.color_attributes['Col']; n = len(ca.data); a = np.empty(n * 4, dtype=np.float32); ca.data.foreach_get('color', a); a = a.reshape(n, 4)
    ao = np.clip(a[:, 0] * 1.15, 0, 1); ao = 0.42 + 0.58 * ao
    # R: ambient occlusion, G: the vegetation mask (scrub in gullies, on ledges and at the foot), B: occlusion again
    seed = int(ob.name.split('_')[1]) + 1
    veg = np.array(cliff_sculpt.vegetation(ob, seed), dtype=np.float32)
    a[:, 0] = ao; a[:, 1] = veg; a[:, 2] = ao; a[:, 3] = 1; ca.data.foreach_set('color', a.ravel())

meta = {}
for ob in pieces:
    bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    meta[ob.name] = {'w': W, 'h': H, 'tris': sum(len(p.vertices) - 2 for p in ob.data.polygons),
                     'minY': min(v.y for v in bb), 'maxY': max(v.y for v in bb)}

if preview:
    # a quick look: one piece lit low from the side
    os.makedirs(preview, exist_ok=True)
    for ob in pieces[1:]: ob.hide_render = True
    pm = pieces[0].data.materials[0]; nt = pm.node_tree; bsdf = nt.nodes.get('Principled BSDF')
    vc = nt.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Col'; nt.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scene.collection.objects.link(cam); scene.camera = cam
    cam.location = (55, -95, 30); cam.rotation_euler = (math.radians(80), 0, math.radians(30))
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); scene.collection.objects.link(sun); sun.data.energy = 4
    sun.rotation_euler = (math.radians(62), 0, math.radians(-55))
    scene.world.node_tree.nodes['Background'].inputs[0].default_value = (0.45, 0.55, 0.7, 1); scene.world.node_tree.nodes['Background'].inputs[1].default_value = 0.6
    scene.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'CYCLES'
    scene.render.resolution_x, scene.render.resolution_y = 1200, 700
    scene.render.filepath = os.path.join(preview, 'cliff_preview.png'); bpy.ops.render.render(write_still=True)
    for ob in pieces[1:]: ob.hide_render = False

for ob in pieces: ob.data.materials.clear()
bpy.ops.object.select_all(action='DESELECT')
for ob in pieces: ob.select_set(True)
kw = dict(filepath=os.path.join(OUT, 'cliffs.glb'), export_format='GLB', use_selection=True, export_apply=True, export_normals=True, export_texcoords=False, export_materials='NONE')
try: bpy.ops.export_scene.gltf(**kw, export_vertex_color='ACTIVE')
except TypeError: bpy.ops.export_scene.gltf(**kw, export_colors=True)
json.dump(meta, open(os.path.join(OUT, 'cliffs.json'), 'w'), indent=1)
print('[cliff_kit]', json.dumps(meta))
