"""Render and package the refined rider, including a close view of the scanned clothing."""
import bpy
import json
import math
from pathlib import Path
from mathutils import Vector, Euler

OUT = Path('/Users/kylecoffelt/Desktop/GameOfThrones/assets-src/riders')
bpy.ops.wm.open_mainfile(filepath=str(OUT / 'daemon_rider_v2.blend'), load_ui=False)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.samples = 64
sc.cycles.use_denoising = True
sc.cycles.adaptive_threshold = .02
sc.cycles.transparent_max_bounces = 12
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type == 'METAL'
    if any(d.type == 'METAL' for d in prefs.devices):
        sc.cycles.device = 'GPU'
except Exception:
    pass

studio = bpy.data.collections.get('07 | Studio - cameras and lights')
specs = [
    ('Full figure', (1.6, -8, 2.25), (-.02, 0, 1.0), 2.30, (1150, 1500), 'full'),
    ('Hair and face', (.55, -3.8, 1.95), (0, -.015, 1.805), .60, (1100, 1250), 'portrait'),
    ('Clothing material detail', (.7, -3, 1.48), (.025, 0, 1.30), .85, (1400, 1150), 'clothing'),
    ('Velvet cloak from behind', (2.2, 4.3, 2.15), (0, .10, 1.0), 2.25, (1100, 1400), 'cape'),
]
cameras = []
for label, location, target, scale, size, suffix in specs:
    data = bpy.data.cameras.new('REVIEW | ' + label)
    camera = bpy.data.objects.new('REVIEW | ' + label, data)
    studio.objects.link(camera)
    camera.location = location
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    data.type = 'ORTHO'
    data.ortho_scale = scale
    cameras.append(camera)

notes = bpy.data.texts.get('START HERE | Rider study') or bpy.data.texts.new('START HERE | Rider study')
notes.clear()
notes.write('''REFINED DRAGON RIDER - MATERIAL AND GROOM REVIEW

This file contains the revised standing character, native strand hair and fur,
an anatomical male head, tailored coat panels, separate forged armour, and
four review cameras. Use Cycles for the hair shader and final material view.

HAIR
The scalp and shoulder-length layers contain tapered native hair curves,
with swept guides, clumping, individual root and tip variation and lowlights.
The scalp underlay fades at the hairline. The fur mantle also uses native
guard-hair curves and a separate dense short undercoat.

CLOTHING
The coat uses Poly Haven's scanned burgundy quatrefoil jacquard; the cloak
uses scanned velour velvet; the leathers use a dyed worn-hide scan. The 4K
colour, normal, roughness and height maps are packed in this file. Jacquard
and velvet also have the scanned anisotropy direction, strength and specular
maps. Garment UVs set the weave direction and scale. Tailor seams and thread
stitches are separate geometry. The leather's unrelated upholstery seam is
excluded from its sampled texture region.

SOURCE CREDIT
Anatomical head: extracted from the realistic male in Blender Studio and
community Human Base Meshes v1.4.1 (CC0), then fitted and edited.
https://www.blender.org/download/demo-files/
Jacquard and velvet: photography by colormass, processing by Rico Cilliers,
via Poly Haven (CC0). Leather: Rob Tuytel, Poly Haven (CC0).
https://polyhaven.com/a/quatrefoil_jacquard_fabric
https://polyhaven.com/a/velour_velvet
https://polyhaven.com/a/fabric_leather_01

The supplied character reference is packed in collection 00.
This is an editable review model. Actor likeness, animation rigging and game
retopology are not represented as complete.
''')

root = bpy.data.objects.get('DAEMON | standing study')
root['revision'] = 'Refined native groom, scanned 4K garments, revised anatomical head and boots.'
root['status'] = 'Editable standing review model; materials and hair require Cycles.'
sc.unit_settings.system = 'METRIC'
for material in bpy.data.materials:
    if material.name.startswith('V3 | scanned burgundy'):
        material.diffuse_color = (.080, .006, .013, 1)
    elif material.name.startswith(('V3 | scanned wine','V3 | scanned deep-wine')):
        material.diffuse_color = (.042, .002, .007, 1)
    elif material.name.startswith('V3 | scanned dyed'):
        material.diffuse_color = (.018, .013, .010, 1)
    if material.use_nodes:
        tree=material.node_tree;depths={}
        def depth(node,trail=None):
            if node in depths:return depths[node]
            trail=set() if trail is None else trail
            if node in trail:return 0
            incoming=[link.from_node for socket in node.inputs for link in socket.links]
            result=1+max((depth(n,trail|{node}) for n in incoming),default=-1)
            depths[node]=result;return result
        columns={}
        for node in tree.nodes:columns.setdefault(depth(node),[]).append(node)
        for col,nodes in columns.items():
            y=0
            for node in nodes:
                node.location=(col*300,y);node.width=240
                y-=750 if node.bl_idname=='ShaderNodeBsdfPrincipled' else 360 if node.bl_idname=='ShaderNodeTexImage' else 260
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type in {'CONSOLE', 'VIEW_3D'}:
            area.type = 'VIEW_3D'
            space = next((s for s in area.spaces if s.type == 'VIEW_3D'), None)
            if space is None:
                continue
            space.shading.type = 'SOLID'
            space.shading.color_type = 'MATERIAL'
            space.overlay.show_overlays = False
            space.region_3d.view_location = (0, 0, 1.0)
            space.region_3d.view_distance = 3.1
            space.region_3d.view_rotation = Euler((math.radians(84), 0, math.radians(-12)), 'XYZ').to_quaternion()

sc.camera = cameras[0]
sc.render.resolution_percentage = 100
sc.render.resolution_x, sc.render.resolution_y = specs[0][4]
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'daemon_rider_refined.blend'), compress=True)
for camera, spec in zip(cameras, specs):
    sc.camera = camera
    sc.render.resolution_x, sc.render.resolution_y = spec[4]
    sc.render.filepath = str(OUT / ('daemon_refined_' + spec[5] + '.png'))
    print('Rendering review:', spec[0], flush=True)
    bpy.ops.render.render(write_still=True)

manifest = {
    'renderer': sc.render.engine,
    'samples': sc.cycles.samples,
    'native_grooms': {o.name: {'curves': len(o.data.curves), 'points': len(o.data.points)} for o in sc.objects if o.type == 'CURVES'},
    'packed_images': [{'name': i.name, 'size': list(i.size), 'color_space': i.colorspace_settings.name} for i in bpy.data.images if i.packed_file],
    'unpacked_file_images': [i.filepath for i in bpy.data.images if i.source == 'FILE' and not i.packed_file],
    'review_images': ['daemon_refined_' + s[5] + '.png' for s in specs],
}
(OUT / 'daemon_refined_manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
sc.camera = cameras[0]
sc.render.resolution_x, sc.render.resolution_y = specs[0][4]
sc.render.filepath = str(OUT / 'daemon_refined_full.png')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'daemon_rider_refined.blend'), compress=True)
print('Packaged review source, four Cycles renders and groom/material manifest.', flush=True)
