# The knight rider for the web game: takes the seated knight the Unreal prototype's Tools/blender/rider_knight.py wrote
# (unreal/Dragonrider/Tools/gen/rider_knight.glb: ~350k triangles, origin at the seat, facing glTF +Z, metres) and slims
# him for the browser: decimated to about TRIS triangles, the scan's textures shrunk to TEX pixels and packed in.
#
#   Blender -b --factory-startup --python tools/blender/rider_knight_web.py -- "$PWD" [--tris 60000] [--tex 1024]
#
# Writes public/models/rider_knight.glb. Vertex colour R (kept) is how freely the cloak trails, 0 on the body.
import bpy, sys, os

argv = sys.argv[sys.argv.index('--') + 1:]
ROOT = argv[0]
def opt(name, default):
    return argv[argv.index(name) + 1] if name in argv else default
TRIS, TEX = int(opt('--tris', 60000)), int(opt('--tex', 1024))
GEN = os.path.join(ROOT, 'unreal/Dragonrider/Tools/gen')
OUT = os.path.join(ROOT, 'public/models/rider_knight.glb')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(GEN, 'rider_knight.glb'))
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']

def image(name, colour):
    im = bpy.data.images.load(os.path.join(GEN, name))
    im.colorspace_settings.name = 'sRGB' if colour else 'Non-Color'
    if max(im.size) > TEX: im.scale(TEX, TEX)
    im.file_format = 'JPEG'
    return im

col, rm, nrm = image('rider_knight_basecolor.jpg', True), image('rider_knight_rm.jpg', False), image('rider_knight_normal.png', False)
for ob in meshes:
    for slot in ob.material_slots:
        m = slot.material
        if not m or 'saddle' in m.name.lower(): continue
        m.use_nodes = True; nt = m.node_tree; bsdf = nt.nodes['Principled BSDF']
        tc = nt.nodes.new('ShaderNodeTexImage'); tc.image = col; nt.links.new(tc.outputs['Color'], bsdf.inputs['Base Color'])
        tr = nt.nodes.new('ShaderNodeTexImage'); tr.image = rm
        sep = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(tr.outputs['Color'], sep.inputs['Color'])
        nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness']); nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
        tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = nrm
        nm = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(tn.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])

total = sum(len(o.data.polygons) for o in meshes)
for ob in meshes:
    n = len(ob.data.polygons)
    if n < 4000: continue                     # the saddle is already light
    d = ob.modifiers.new('slim', 'DECIMATE'); d.ratio = min(1.0, TRIS / total)
    bpy.context.view_layer.objects.active = ob; bpy.ops.object.modifier_apply(modifier='slim')
print('TRIS', total, '->', sum(len(o.data.polygons) for o in meshes))

bpy.ops.object.select_all(action='DESELECT')
for o in meshes: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True, export_yup=True, export_animations=False,
                          export_skins=False, export_materials='EXPORT', export_image_format='JPEG', export_jpeg_quality=86, export_vertex_color='ACTIVE')
print('WROTE', OUT, os.path.getsize(OUT) // 1024, 'KB')
