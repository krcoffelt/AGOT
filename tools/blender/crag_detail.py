# High-detail limestone for the crags: the jointed block layout from crag_kit.py, remeshed finely, its edges weathered round,
# and carved with fracture and weathering detail at several scales (vertical cracks, flaking, grain) — the look of the user's
# reference photos. Used two ways: rendered in Blender for look development, and as the source the game's crag meshes
# have their normal and occlusion maps baked from.
#   detail(ob, voxel=0.14) → a new high-detail object (the source is left alone)
#   limestone_material() → a Cycles/EEVEE material for previews (box-projected rock scan, greyed, crevices darkened)
import bpy, math, os
from mathutils import Vector

PROJ = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))

def _tex(name, kind, **kw):
    t = bpy.data.textures.get(name) or bpy.data.textures.new(name, kind)
    for k, v in kw.items(): setattr(t, k, v)
    return t

def _ctl(name, scale):
    """an empty whose scale stretches a texture's coordinates (z large → features long and vertical)"""
    e = bpy.data.objects.get(name) or bpy.data.objects.new(name, None)
    if e.name not in bpy.context.scene.collection.objects: bpy.context.scene.collection.objects.link(e)
    e.scale = scale; e.hide_viewport = True; e.hide_render = True
    return e

# photogrammetry height scans (Poly Haven, CC0): cracked, chipped rock face for the broad relief; dry limestone boulder for the fine
HEIGHT = os.path.join(PROJ, 'public/textures/rock_face_03/disp.jpg')
HEIGHT_FINE = os.path.join(PROJ, 'public/textures/rock_boulder_dry/disp.jpg')

def detail(src, voxel=0.14, apply=True, height=None, tile=6.0, strength=1.1, flakes=((1.6, 0.32, 1.6),), along_axis=True):
    """remesh finely, wear the sharpest edges a little, then displace by a scanned rock height map projected separately on
    front, side and top faces (so it never stretches), at two scales; and a few inward hairline cracks"""
    ob = src.copy(); ob.data = src.data.copy(); ob.name = src.name + '_hd'
    bpy.context.scene.collection.objects.link(ob)
    for m in list(ob.modifiers): ob.modifiers.remove(m)
    ctx = dict(object=ob, active_object=ob, selected_objects=[ob], selected_editable_objects=[ob])
    rm = ob.modifiers.new('remesh', 'REMESH'); rm.mode = 'VOXEL'; rm.voxel_size = voxel
    sm = ob.modifiers.new('weather', 'SMOOTH'); sm.factor = 0.5; sm.iterations = 2
    with bpy.context.temp_override(**ctx):
        bpy.ops.object.modifier_apply(modifier='remesh'); bpy.ops.object.modifier_apply(modifier='weather')
    me = ob.data
    # which way each vertex faces: front/back (Y), sides (X), top (Z), blended
    groups = {k: ob.vertex_groups.new(name=k) for k in ('fy', 'fx', 'fz')}
    for v in me.vertices:
        n = v.normal; w = [abs(n.y) ** 3, abs(n.x) ** 3, abs(n.z) ** 3]; t = sum(w) or 1.0
        for k, wi in zip(('fy', 'fx', 'fz'), w): groups[k].add([v.index], wi / t, 'REPLACE')
    imgs = {}
    for k, path in (('a', height or HEIGHT), ('b', HEIGHT_FINE)):
        im = bpy.data.images.load(path, check_existing=True); im.colorspace_settings.name = 'Non-Color'; imgs[k] = im
    def tex(name, tag):
        t = bpy.data.textures.get(name + tag) or bpy.data.textures.new(name + tag, 'IMAGE'); t.image = imgs[tag]; t.extension = 'REPEAT'; return t
    rot = {'fy': (math.pi / 2, 0, 0), 'fx': (math.pi / 2, 0, math.pi / 2), 'fz': (0, 0, 0)}
    for scale, st, tag in ((tile, strength, 'a'), (tile * 0.4, strength * 0.4, 'b')):
        for k in ('fy', 'fx', 'fz'):
            e = _ctl(f'crag_hmap_{k}_{tag}', (scale, scale, scale)); e.rotation_euler = rot[k]
            if tag == 'b': e.location = (0.37 * scale, 0.11 * scale, 0.59 * scale)
            m = ob.modifiers.new(f'h_{k}_{tag}', 'DISPLACE'); m.texture = tex('crag_hmap_', tag); m.texture_coords = 'OBJECT'; m.texture_coords_object = e
            m.strength = st; m.mid_level = 0.55; m.vertex_group = k
    vert = _ctl('crag_detail_vert', (1.0, 1.0, 3.0))
    t1 = _tex('crag_cracks', 'VORONOI', noise_scale=2.6, distance_metric='DISTANCE', weight_1=-1.0, weight_2=1.0, weight_3=0.0, weight_4=0.0, noise_intensity=3.0)
    m = ob.modifiers.new('cracks', 'DISPLACE'); m.texture = t1; m.texture_coords = 'OBJECT'; m.texture_coords_object = vert; m.strength = 0.18; m.mid_level = 1.0
    if apply:
        with bpy.context.temp_override(**ctx):
            for m in list(ob.modifiers): bpy.ops.object.modifier_apply(modifier=m.name)
        flake(ob, flakes, along_axis)
    for p in ob.data.polygons: p.use_smooth = True
    return ob

def _h3(c, k):
    return (math.sin(c.x * 12.9898 + c.y * 78.233 + c.z * 37.719 + k * 19.19) * 43758.5453) % 1.0

def flake(ob, scales=((1.6, 0.32, 1.6),), along_axis=True):
    """conchoidal flaking: the surface broken into small flat facets. Each Voronoi cell (in 3D, so it works on every face)
    is a plane of its own height and tilt; the vertex moves along its normal onto its cell's plane, so facets meet in sharp
    steps — the angular, terraced chipping of weathered limestone."""
    from mathutils import noise as N
    me = ob.data; vs = me.vertices; n = len(vs)
    import numpy as np
    co = np.empty(n * 3, dtype=np.float32); vs.foreach_get('co', co); co = co.reshape(n, 3)
    nr = np.empty(n * 3, dtype=np.float32); vs.foreach_get('normal', nr); nr = nr.reshape(n, 3)
    disp = np.zeros(n, dtype=np.float32)
    for sc_ in scales:
        size, amp = sc_[0], sc_[1]; tilt = sc_[2] if len(sc_) > 2 else 1.6; zs = sc_[3] if len(sc_) > 3 else 0.8      # zs < 1: cells taller than wide (joint-bounded planes)
        inv = 1.0 / size
        for i in range(n):
            p = Vector((co[i, 0] * inv, co[i, 1] * inv, co[i, 2] * inv * zs))
            dist, pts = N.voronoi(p, distance_metric='DISTANCE')
            c = pts[0]; d = p - c
            # the cell's plane: an offset and a tilt (slope along a random direction)
            h = (_h3(c, 1) - 0.5) * 2.0
            t = Vector((_h3(c, 2 + size) - 0.5, _h3(c, 3 + size) - 0.5, _h3(c, 4 + size) - 0.5)) * tilt
            disp[i] += amp * (h + t.dot(d))
    # move along the face's main axis (front / side / top), not the vertex's own normal: across a face every vertex moves the
    # same way, so a cell's patch stays one clean plane instead of crumpling
    if along_axis:
        ax = np.zeros_like(nr); k = np.argmax(np.abs(nr), axis=1); ax[np.arange(n), k] = np.sign(nr[np.arange(n), k])
    else:
        ax = nr      # curved forms (the headland): along the surface's own normal, else the axis flips across it and leaves dents
    co += ax * disp[:, None]
    vs.foreach_set('co', co.ravel()); me.update()

def limestone_material(name='crag_limestone', tone=(0.62, 0.6, 0.56)):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True; nt = m.node_tree; nt.nodes.clear(); L = nt.links.new; N = nt.nodes.new
    out = N('ShaderNodeOutputMaterial'); bs = N('ShaderNodeBsdfPrincipled'); L(bs.outputs[0], out.inputs[0])
    tc = N('ShaderNodeTexCoord'); mp = N('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (0.25, 0.25, 0.25)
    L(tc.outputs['Object'], mp.inputs[0])
    img = N('ShaderNodeTexImage'); img.projection = 'BOX'; img.projection_blend = 0.25
    img.image = bpy.data.images.load(os.path.join(PROJ, 'public/textures/rock_boulder_dry/diff.jpg'), check_existing=True)
    L(mp.outputs[0], img.inputs[0])
    # the scan's light and dark, desaturated toward the limestone tone
    bw = N('ShaderNodeRGBToBW'); L(img.outputs['Color'], bw.inputs[0])
    ramp = N('ShaderNodeValToRGB'); ramp.color_ramp.elements[0].position = 0.05; ramp.color_ramp.elements[1].position = 0.45
    ramp.color_ramp.elements[0].color = (tone[0] * 0.45, tone[1] * 0.45, tone[2] * 0.45, 1); ramp.color_ramp.elements[1].color = (*tone, 1)
    L(bw.outputs[0], ramp.inputs[0])
    # broad patches of lighter and darker stone
    nz = N('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 0.08; L(tc.outputs['Object'], nz.inputs['Vector'])
    patch = N('ShaderNodeMix'); patch.data_type = 'RGBA'; patch.blend_type = 'MULTIPLY'
    L(nz.outputs['Fac'], patch.inputs['Factor']); L(ramp.outputs['Color'], patch.inputs[6]); patch.inputs[7].default_value = (0.75, 0.75, 0.76, 1)
    # crevices darker (ambient occlusion)
    ao = N('ShaderNodeAmbientOcclusion'); ao.inputs['Distance'].default_value = 1.5
    L(patch.outputs[2], ao.inputs['Color'])
    aomix = N('ShaderNodeMix'); aomix.data_type = 'RGBA'; aomix.blend_type = 'MULTIPLY'; aomix.inputs['Factor'].default_value = 0.85
    L(patch.outputs[2], aomix.inputs[6]); L(ao.outputs['AO'], aomix.inputs['Factor']); aomix.inputs[7].default_value = (0.25, 0.25, 0.27, 1)
    L(aomix.outputs[2], bs.inputs['Base Color'])
    # fine bump from the scan
    bump = N('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.5; bump.inputs['Distance'].default_value = 0.08
    L(bw.outputs[0], bump.inputs['Height']); L(bump.outputs['Normal'], bs.inputs['Normal'])
    bs.inputs['Roughness'].default_value = 0.88
    return m
