# Close-up King's Landing houses for the web game, from the Unreal prototype's detailed kit
# (unreal/Dragonrider/Tools/gen/kl_hd.glb, written by its Tools/blender/kl_kit_hd.py from this game's own kl_kit.py builder).
# Keeps variant 0 of each of the sixteen buildings and folds every material into one mesh per building: the second UV map's
# u holds the material slot (see SLOTS; the game's shader picks the texture layer from it), so a house is one draw call.
#
#   Blender -b --factory-startup --python tools/blender/kl_hd_web.py -- "$PWD"
#
# Writes public/models/kl_hd.glb (meshes hd_<type>; COLOR_0 rgb = tint, a = how clean; TEXCOORD_0 in texture repeats).
import bpy, sys, os

ROOT = sys.argv[sys.argv.index('--') + 1]
SRC = os.path.join(ROOT, 'unreal/Dragonrider/Tools/gen/kl_hd.glb')
OUT = os.path.join(ROOT, 'public/models/kl_hd.glb')
SLOTS = ['stone', 'plaster', 'rubble', 'roof_a', 'roof_b', 'roof_c', 'wood', 'shutter', 'glass', 'flat', 'cloth']

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
keep = []
for ob in list(bpy.context.scene.objects):
    if ob.type != 'MESH' or not ob.name.startswith('hd_') or not ob.name.endswith('_0'):
        bpy.data.objects.remove(ob); continue
    me = ob.data
    idx = []
    for slot in ob.material_slots:
        n = (slot.material.name if slot.material else 'flat').split('.')[0].lower()
        idx.append(SLOTS.index(n) if n in SLOTS else SLOTS.index('flat'))
    uv = me.uv_layers.new(name='slot')
    for poly in me.polygons:
        s = idx[poly.material_index] if idx else SLOTS.index('flat')
        for li in poly.loop_indices: uv.data[li].uv = (s + 0.5, 0.5)
    me.materials.clear()
    ob.name = ob.name[:-2]
    keep.append(ob)
    print('KEEP', ob.name, len(me.polygons), 'faces')
bpy.ops.object.select_all(action='DESELECT')
for o in keep: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True, export_yup=True, export_animations=False,
                          export_materials='NONE', export_vertex_color='ACTIVE', export_texcoords=True, export_normals=True)
print('WROTE', OUT, os.path.getsize(OUT) // 1024, 'KB')
