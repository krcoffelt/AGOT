# Dragon skin. The game exports each dragon's fleshy part meshes (body loft, limbs, muscle masses) with their skin weights and
# bones (game.exportDragonRigs() → public/impostors/rig_<id>.json). This script fuses them into ONE organic skin (voxel
# union + smoothing), sculpts scale / plate / belly-scute relief procedurally, bakes it to a tangent normal map and a shaded
# detail map on a ~36k-triangle mesh, carries the game's own skin weights across, and exports a skinned GLB.
#   Blender -b --factory-startup --python tools/blender/dragon.py -- <project dir> [dragon ids...]
import bpy, bmesh, sys, os, math, json, glob
from mathutils import Vector
import numpy as np

args = sys.argv[sys.argv.index('--') + 1:]
proj = args[0]; RIGS = os.path.join(proj, 'public', 'impostors'); OUT = os.path.join(proj, 'public', 'models'); os.makedirs(OUT, exist_ok=True)
ids = args[1:] or [os.path.basename(f)[4:-5] for f in sorted(glob.glob(os.path.join(RIGS, 'rig_*.json')))]
TS = 2048; VOXEL = 0.045; TARGET_TRIS = 36000
P = lambda v: Vector((v[0], -v[2], v[1]))          # game (x left, y up, z forward) → Blender (z up, facing -Y)

def activate(o):
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
def apply_mod(o, m): activate(o); bpy.ops.object.modifier_apply(modifier=m.name)

def detail_material(bulk):
    m = bpy.data.materials.new('detail'); m.use_nodes = True; nt = m.node_tree; N = nt.nodes; L = nt.links
    bsdf = next(n for n in N if n.type == 'BSDF_PRINCIPLED')
    tc = N.new('ShaderNodeTexCoord'); geo = N.new('ShaderNodeNewGeometry')
    sn = N.new('ShaderNodeSeparateXYZ'); L.new(geo.outputs['Normal'], sn.inputs[0]); sp = N.new('ShaderNodeSeparateXYZ'); L.new(tc.outputs['Object'], sp.inputs[0])
    def math_(op, a, b=None, clamp=False):
        n = N.new('ShaderNodeMath'); n.operation = op; n.use_clamp = clamp
        for i, v in enumerate((a, b)):
            if v is None: continue
            if isinstance(v, (int, float)): n.inputs[i].default_value = v
            else: L.new(v, n.inputs[i])
        return n.outputs[0]
    def ramp(v, a, b):
        n = N.new('ShaderNodeMapRange'); n.clamp = True; L.new(v, n.inputs['Value']); n.inputs['From Min'].default_value = a; n.inputs['From Max'].default_value = b; return n.outputs['Result']
    def mix(a, b, f): return math_('ADD', math_('MULTIPLY', a, math_('SUBTRACT', 1.0, f)), math_('MULTIPLY', b, f))
    def voronoi(scale):
        n = N.new('ShaderNodeTexVoronoi'); n.voronoi_dimensions = '3D'; n.feature = 'F1'; n.inputs['Scale'].default_value = scale; L.new(tc.outputs['Object'], n.inputs['Vector']); return n
    up = ramp(sn.outputs['Z'], 0.2, 0.8)                                                   # the back carries large plates
    belly = math_('MULTIPLY', ramp(sn.outputs['Z'], -0.45, -0.85), ramp(math_('ABSOLUTE', sp.outputs['X']), 1.25 * bulk, 0.7 * bulk))
    vs, vl = voronoi(8.2), voronoi(3.4)
    hs = math_('POWER', math_('SUBTRACT', 1.0, math_('MULTIPLY', vs.outputs['Distance'], 1.75), clamp=True), 0.6)
    hl = math_('POWER', math_('SUBTRACT', 1.0, math_('MULTIPLY', vl.outputs['Distance'], 1.55), clamp=True), 0.5)
    h = mix(hs, hl, up)
    wave = N.new('ShaderNodeTexWave'); wave.wave_type = 'BANDS'; wave.bands_direction = 'Y'; wave.wave_profile = 'SAW'
    wave.inputs['Scale'].default_value = 1.15; wave.inputs['Distortion'].default_value = 0.5; wave.inputs['Detail'].default_value = 1.0; L.new(tc.outputs['Object'], wave.inputs['Vector'])
    h = mix(h, math_('POWER', wave.outputs['Fac'], 0.7), belly)
    noise = N.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 1.4; noise.inputs['Detail'].default_value = 6.0; L.new(tc.outputs['Object'], noise.inputs['Vector'])
    fine = N.new('ShaderNodeTexNoise'); fine.inputs['Scale'].default_value = 26.0; fine.inputs['Detail'].default_value = 3.0; L.new(tc.outputs['Object'], fine.inputs['Vector'])
    hh = math_('ADD', math_('ADD', math_('MULTIPLY', h, 0.8), math_('MULTIPLY', noise.outputs['Fac'], 0.5)), math_('MULTIPLY', fine.outputs['Fac'], 0.07))
    bump = N.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 1.0; bump.inputs['Distance'].default_value = 0.055; L.new(hh, bump.inputs['Height']); L.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    sc = N.new('ShaderNodeSeparateColor'); L.new(vs.outputs['Color'], sc.inputs[0])
    tone = math_('ADD', math_('ADD', 0.34, math_('MULTIPLY', h, 0.5)), math_('MULTIPLY', sc.outputs[0], 0.2), clamp=True)
    cmb = N.new('ShaderNodeCombineColor'); [L.new(tone, cmb.inputs[i]) for i in range(3)]
    L.new(cmb.outputs[0], bsdf.inputs['Emission Color']); bsdf.inputs['Emission Strength'].default_value = 1.0; bsdf.inputs['Base Color'].default_value = (0.5, 0.5, 0.5, 1)
    return m

def build(did):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene; scene.render.engine = 'CYCLES'; scene.cycles.samples = 10; scene.cycles.device = 'CPU'
    try: scene.cycles.use_denoising = False
    except Exception: pass
    scene.world = bpy.data.worlds.new('w'); scene.world.light_settings.distance = 1.6
    rig = json.load(open(os.path.join(RIGS, f'rig_{did}.json'))); names = [b['name'] for b in rig['bones']]
    # ---- source parts: welded, capped, with the game's own weights in vertex groups
    objs = []
    for k, part in enumerate(rig['parts']):
        bm = bmesh.new(); dl = bm.verts.layers.deform.verify(); pos, idx, si, sw = part['pos'], part['idx'], part['si'], part['sw']
        vs = []
        for i in range(len(pos) // 3):
            v = bm.verts.new(P(pos[i * 3:i * 3 + 3])); vs.append(v)
            for j in range(4):
                if sw[i * 4 + j] > 0: v[dl][si[i * 4 + j]] = sw[i * 4 + j]
        for t in range(len(idx) // 3):
            a, b, c = idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]
            if a == b or b == c or a == c: continue
            try: bm.faces.new((vs[a], vs[b], vs[c]))
            except ValueError: pass
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=2e-4)
        bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=0)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        me = bpy.data.meshes.new(f'part{k}'); bm.to_mesh(me); bm.free()
        o = bpy.data.objects.new(f'part{k}', me); scene.collection.objects.link(o)
        for n in names: o.vertex_groups.new(name=n)
        objs.append(o)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]; bpy.ops.object.join(); src = objs[0]; src.name = 'src'
    # ---- fused, smoothed skin
    activate(src); bpy.ops.object.duplicate(); hi = bpy.context.view_layer.objects.active; hi.name = 'hi'
    rm = hi.modifiers.new('rm', 'REMESH'); rm.mode = 'VOXEL'; rm.voxel_size = VOXEL; rm.adaptivity = 0.0; apply_mod(hi, rm)
    sm = hi.modifiers.new('sm', 'SMOOTH'); sm.factor = 0.5; sm.iterations = 5; apply_mod(hi, sm)
    hi.vertex_groups.clear()
    for p in hi.data.polygons: p.use_smooth = True
    hi.data.materials.clear(); hi.data.materials.append(detail_material(rig['bulk']))
    ntri = sum(len(p.vertices) - 2 for p in hi.data.polygons)
    # ---- game mesh: decimated copy, unwrapped
    activate(hi); bpy.ops.object.duplicate(); lo = bpy.context.view_layer.objects.active; lo.name = 'skin'
    dm = lo.modifiers.new('dec', 'DECIMATE'); dm.ratio = min(1.0, TARGET_TRIS / ntri); apply_mod(lo, dm)
    activate(lo); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(72), island_margin=0.003); bpy.ops.object.mode_set(mode='OBJECT')
    bake_mat = bpy.data.materials.new('bake'); bake_mat.use_nodes = True; node = bake_mat.node_tree.nodes.new('ShaderNodeTexImage'); bake_mat.node_tree.nodes.active = node
    lo.data.materials.clear(); lo.data.materials.append(bake_mat)
    def img(name, color, nc):
        im = bpy.data.images.new(name, TS, TS, alpha=False); im.generated_color = color
        if nc: im.colorspace_settings.name = 'Non-Color'
        return im
    IM = {'nrm': img('nrm', (0.5, 0.5, 1, 1), True), 'tone': img('tone', (0.5, 0.5, 0.5, 1), True), 'ao': img('ao', (1, 1, 1, 1), True)}
    for vis in ('visible_camera', 'visible_diffuse', 'visible_glossy', 'visible_transmission', 'visible_volume_scatter', 'visible_shadow'): setattr(lo, vis, False); setattr(src, vis, False)
    bpy.ops.object.select_all(action='DESELECT'); hi.select_set(True); lo.select_set(True); bpy.context.view_layer.objects.active = lo
    for key, btype in (('nrm', 'NORMAL'), ('tone', 'EMIT'), ('ao', 'AO')):
        node.image = IM[key]; bpy.ops.object.bake(type=btype, use_selected_to_active=True, cage_extrusion=0.035, max_ray_distance=0.12, margin=8)
    def px(im): a = np.empty(TS * TS * 4, dtype=np.float32); im.pixels.foreach_get(a); return a.reshape(TS, TS, 4)
    tone, ao = px(IM['tone']), px(IM['ao'])
    tone[..., :3] = np.clip(tone[..., :3] * (0.5 + 0.5 * ao[..., :1]) * 1.25, 0, 1); IM['tone'].pixels.foreach_set(tone.ravel())
    scene.render.image_settings.quality = 93
    for key, fn in (('nrm', f'dragon_{did}_n.jpg'), ('tone', f'dragon_{did}_a.jpg')):
        im = IM[key]; im.filepath_raw = os.path.join(OUT, fn); im.file_format = 'JPEG'; im.save()
    # ---- weights: carried across from the game's own skinning
    hi.hide_render = True; hi.hide_set(True)
    for n in names: lo.vertex_groups.new(name=n)
    dt = lo.modifiers.new('dt', 'DATA_TRANSFER'); dt.object = src; dt.use_vert_data = True; dt.data_types_verts = {'VGROUP_WEIGHTS'}; dt.vert_mapping = 'POLYINTERP_NEAREST'
    dt.layers_vgroup_select_src = 'ALL'; dt.layers_vgroup_select_dst = 'NAME'; apply_mod(lo, dt)
    activate(lo)
    bpy.ops.object.vertex_group_clean(group_select_mode='ALL', limit=0.02); bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4); bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
    # ---- armature (only so the exporter writes a skin with named joints)
    arm = bpy.data.armatures.new('rig'); ao_ = bpy.data.objects.new('rig', arm); scene.collection.objects.link(ao_); activate(ao_); bpy.ops.object.mode_set(mode='EDIT')
    for b in rig['bones']:
        eb = arm.edit_bones.new(b['name']); eb.head = P(b['head']); t = P(b['tail']) if b['tail'] else eb.head + Vector((0, -0.4, 0))
        if (t - eb.head).length < 0.06: t = eb.head + Vector((0, -0.3, 0.05))
        eb.tail = t
    for b in rig['bones']:
        if b['parent']: arm.edit_bones[b['name']].parent = arm.edit_bones[b['parent']]
    bpy.ops.object.mode_set(mode='OBJECT')
    lo.parent = ao_; am = lo.modifiers.new('arm', 'ARMATURE'); am.object = ao_
    lo.data.materials.clear()
    bpy.ops.object.select_all(action='DESELECT'); lo.select_set(True); ao_.select_set(True); bpy.context.view_layer.objects.active = ao_
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, f'dragon_{did}.glb'), export_format='GLB', use_selection=True, export_materials='NONE', export_yup=True, export_skins=True, export_animations=False)
    print('DRAGON', did, 'hi tris', ntri, 'skin tris', sum(len(p.vertices) - 2 for p in lo.data.polygons), flush=True)

for did in ids: build(did)
print('DONE dragons')
