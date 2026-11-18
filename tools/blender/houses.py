# Builds the house kit: detailed "hi" houses (timber frames, windows, doors, chimneys, scanned materials) are baked
# onto ~60-triangle "lo" proxies that share one texture atlas. Run:
#   Blender -b --factory-startup --python tools/blender/houses.py -- <project dir>
import bpy, bmesh, sys, os, math, json, random
from mathutils import Matrix, Euler, Vector
import numpy as np

proj = sys.argv[sys.argv.index('--') + 1]
TEX = os.path.join(proj, 'public', 'textures'); OUT = os.path.join(proj, 'public', 'models'); os.makedirs(OUT, exist_ok=True)
AW, AH, COLS, ROWS = 4096, 2048, 4, 2
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'; scene.cycles.samples = 12; scene.cycles.device = 'CPU'
try: scene.cycles.use_denoising = False
except Exception: pass

def principled(nt):
    for n in nt.nodes:
        if n.type == 'BSDF_PRINCIPLED': return n
def tex_mat(name, tex_id, scale, tint=(1, 1, 1), bump=0.35, emit=None):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; N = nt.nodes; L = nt.links
    b = principled(nt)
    if tex_id:
        tc = N.new('ShaderNodeTexCoord'); mp = N.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (scale, scale, scale)
        img = N.new('ShaderNodeTexImage'); img.image = bpy.data.images.load(os.path.join(TEX, tex_id, 'diff.jpg')); img.projection = 'BOX'; img.projection_blend = 0.2
        L.new(tc.outputs['Object'], mp.inputs['Vector']); L.new(mp.outputs['Vector'], img.inputs['Vector'])
        vm = N.new('ShaderNodeVectorMath'); vm.operation = 'MULTIPLY'; vm.inputs[1].default_value = tint
        L.new(img.outputs['Color'], vm.inputs[0]); L.new(vm.outputs['Vector'], b.inputs['Base Color'])
        bp = N.new('ShaderNodeBump'); bp.inputs['Strength'].default_value = bump; bp.inputs['Distance'].default_value = 0.06
        L.new(img.outputs['Color'], bp.inputs['Height']); L.new(bp.outputs['Normal'], b.inputs['Normal'])
    else:
        b.inputs['Base Color'].default_value = (*tint, 1)
    b.inputs['Roughness'].default_value = 0.85
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1); b.inputs['Emission Strength'].default_value = 1.0
    return m

MATS = {
    'plaster': tex_mat('plaster', 'white_plaster_rough_01', 0.45, (0.95, 0.93, 0.88), 0.25),
    'wood': tex_mat('wood', 'dark_planks', 0.6, (0.62, 0.5, 0.4), 0.5),
    'thatch': tex_mat('thatch', 'thatch_roof_angled', 0.5, (1.9, 1.6, 1.05), 0.9, emit=(0, 0, 1)),
    'tile': tex_mat('tile', 'clay_roof_tiles_02', 0.45, (1.0, 0.82, 0.72), 0.8, emit=(0, 0, 1)),
    'stone': tex_mat('stone', 'medieval_blocks_02', 0.5, (0.92, 0.9, 0.86), 0.7),
    'log': tex_mat('log', 'beam_wall_01', 0.5, (0.8, 0.72, 0.6), 0.7),
    'glass': tex_mat('glass', None, 1, (0.012, 0.014, 0.02), 0, emit=(1, 0, 0)),
    'door': tex_mat('door', 'dark_planks', 0.9, (0.34, 0.25, 0.18), 0.6),
}
MI = {k: i for i, k in enumerate(MATS)}

class B:
    def __init__(self): self.bm = bmesh.new()
    def box(self, c, s, mat, rot=(0, 0, 0)):
        m = Matrix.Translation(c) @ Euler(rot).to_matrix().to_4x4() @ Matrix.Diagonal((s[0], s[1], s[2], 1))
        r = bmesh.ops.create_cube(self.bm, size=1.0, matrix=m)
        fs = set(f for v in r['verts'] for f in v.link_faces)
        for f in fs: f.material_index = MI[mat]
    def tri(self, pts, mat):
        vs = [self.bm.verts.new(p) for p in pts]; f = self.bm.faces.new(vs); f.material_index = MI[mat]
    def obj(self, name, mats=None):
        me = bpy.data.meshes.new(name); self.bm.normal_update(); self.bm.to_mesh(me); self.bm.free()
        o = bpy.data.objects.new(name, me); scene.collection.objects.link(o)
        for m in (mats or MATS.values()): me.materials.append(m)
        return o

def side_frames(w, d):
    # (origin of the wall's left end, direction along the wall, outward normal, length)
    return [(Vector((-w / 2, -d / 2, 0)), Vector((1, 0, 0)), Vector((0, -1, 0)), w), (Vector((w / 2, d / 2, 0)), Vector((-1, 0, 0)), Vector((0, 1, 0)), w),
            (Vector((-w / 2, d / 2, 0)), Vector((0, -1, 0)), Vector((-1, 0, 0)), d), (Vector((w / 2, -d / 2, 0)), Vector((0, 1, 0)), Vector((1, 0, 0)), d)]
def on_wall(b, fr, u, z, su, sz, th, mat, out=0.0, roll=0.0):
    o, du, n, _ = fr; c = o + du * u + n * out + Vector((0, 0, z))
    ang = math.atan2(du.y, du.x)
    b.box(c, (su, th, sz), mat, (0, roll, ang) if False else (0, 0, ang))
def brace(b, fr, u0, z0, u1, z1, th=0.14):
    o, du, n, _ = fr; ln = math.hypot(u1 - u0, z1 - z0); a = math.atan2(z1 - z0, u1 - u0)
    c = o + du * ((u0 + u1) / 2) + n * 0.03 + Vector((0, 0, (z0 + z1) / 2))
    rz = math.atan2(du.y, du.x)
    m = Matrix.Translation(c) @ Matrix.Rotation(rz, 4, 'Z') @ Matrix.Rotation(-a, 4, 'Y') @ Matrix.Diagonal((ln, 0.1, th, 1))
    r = bmesh.ops.create_cube(b.bm, size=1.0, matrix=m)
    for f in set(f for v in r['verts'] for f in v.link_faces): f.material_index = MI['wood']

def build(spec, rnd):
    w, d, st, sh = spec['w'], spec['d'], spec['storeys'], spec['sh']
    wall, roofm, pitch = spec['wall'], spec['roof'], math.radians(spec['pitch'])
    jet = spec.get('jetty', 0.0); flat = spec.get('flat', False); timber = spec.get('timber', True)
    h = st * sh; hi = B(); lo = B()
    base = 0.55
    # ---- walls
    if st == 2 and jet > 0:
        hi.box((0, 0, sh / 2), (w, d, sh), spec.get('wall0', 'stone')); hi.box((0, 0, sh + sh / 2), (w + jet * 2, d + jet * 2, sh), wall)
        lo.box((0, 0, sh / 2), (w + 0.1, d + 0.1, sh), 'plaster'); lo.box((0, 0, sh + sh / 2), (w + jet * 2 + 0.16, d + jet * 2 + 0.16, sh), 'plaster')
    else:
        hi.box((0, 0, h / 2), (w, d, h), wall); lo.box((0, 0, h / 2), (w + 0.16, d + 0.16, h), 'plaster')
    hi.box((0, 0, base / 2 - 0.05), (w + 0.12, d + 0.12, base), 'stone')
    # ---- timber frame, windows, doors on every wall
    for si, fr in enumerate(side_frames(w, d)):
        ln = fr[3]
        for s in range(st):
            z0 = s * sh; off = jet if (s == 1 and jet > 0) else 0.0
            frs = (fr[0] - fr[1] * off - fr[2] * 0 + fr[2] * off, fr[1], fr[2], ln + off * 2)
            L2 = frs[3]
            nb = max(1, round(L2 / 2.1)); bay = L2 / nb
            if timber or s == 1:
                for i in range(nb + 1): on_wall(hi, frs, i * bay, z0 + sh / 2, 0.2, sh, 0.12, 'wood', 0.03)
                for zz in (z0 + 0.1, z0 + sh - 0.1): on_wall(hi, frs, L2 / 2, zz, L2 + 0.2, 0.2, 0.14, 'wood', 0.035)
                on_wall(hi, frs, L2 / 2, z0 + sh * 0.5, L2, 0.12, 0.1, 'wood', 0.025)
            for i in range(nb):
                u = (i + 0.5) * bay; r = rnd.random()
                is_door = (s == 0 and si == 0 and i == nb // 2)
                if is_door:
                    on_wall(hi, frs, u, 1.05, 1.15, 2.1, 0.1, 'door', 0.04); on_wall(hi, frs, u, 2.2, 1.5, 0.18, 0.16, 'wood', 0.05)
                    for sd in (-0.68, 0.68): on_wall(hi, frs, u + sd, 1.05, 0.16, 2.1, 0.16, 'wood', 0.05)
                elif r < spec.get('win', 0.6) and bay > 1.2:
                    ww, wh = min(0.95, bay * 0.5), 1.05; zc = z0 + sh * 0.58
                    on_wall(hi, frs, u, zc, ww, wh, 0.08, 'glass', 0.03)
                    on_wall(hi, frs, u, zc, 0.07, wh, 0.1, 'wood', 0.05); on_wall(hi, frs, u, zc, ww, 0.07, 0.1, 'wood', 0.05)
                    for sd in (-1, 1): on_wall(hi, frs, u + sd * (ww / 2 + 0.06), zc, 0.12, wh + 0.2, 0.12, 'wood', 0.05)
                    on_wall(hi, frs, u, zc - wh / 2 - 0.08, ww + 0.36, 0.14, 0.2, 'wood', 0.07); on_wall(hi, frs, u, zc + wh / 2 + 0.07, ww + 0.3, 0.12, 0.14, 'wood', 0.05)
                    if spec.get('shutters', True) and rnd.random() < 0.7:
                        for sd in (-1, 1): on_wall(hi, frs, u + sd * (ww / 2 + 0.34), zc, 0.42, wh, 0.06, 'door', 0.05)
                elif (timber or s == 1) and rnd.random() < 0.55:
                    if rnd.random() < 0.5: brace(hi, frs, i * bay + 0.1, z0 + 0.15, (i + 1) * bay - 0.1, z0 + sh - 0.15)
                    else: brace(hi, frs, (i + 1) * bay - 0.1, z0 + 0.15, i * bay + 0.1, z0 + sh - 0.15)
    wt, dt = w + 2 * jet, d + 2 * jet
    # ---- roof
    if flat:
        for bb, k in ((hi, 0.0), (lo, 0.08)):
            for fr in side_frames(wt, dt): on_wall(bb, fr, fr[3] / 2, h + 0.3, fr[3] + 0.3 + k, 0.6, 0.28 + k, wall if bb is hi else 'plaster', -0.1)
            bb.box((0, 0, h - 0.02), (wt - 0.2, dt - 0.2, 0.1), wall if bb is hi else 'plaster')
        top = h + 0.6
    else:
        ov, th = spec.get('over', 0.5), (0.42 if roofm == 'thatch' else 0.16)
        rise = (dt / 2) * math.tan(pitch); R = h + rise; Ls = (dt / 2) / math.cos(pitch) + ov
        for sgn in (-1, 1):
            c = (0, sgn * (Ls / 2) * math.cos(pitch) * 1.0 - sgn * 0.0, R - (Ls / 2) * math.sin(pitch) + th * 0.45)
            for bb in (hi, lo): bb.box(c, (wt + ov * 1.4, Ls, th), roofm if bb is hi else 'plaster', (-sgn * pitch * -1 if False else sgn * -pitch * -1 * -1, 0, 0) if False else ((pitch if sgn < 0 else -pitch), 0, 0))
        hi.box((0, 0, R + th * 0.4), (wt + ov * 1.4 + 0.1, 0.5, 0.26), 'wood' if roofm == 'thatch' else roofm)
        for sx in (-1, 1):
            x = sx * wt / 2
            pts = [(x, -dt / 2, h), (x, dt / 2, h), (x, 0, R)]
            hi.tri(pts if sx > 0 else pts[::-1], wall); lo.tri([(p[0] + sx * 0.08, p[1] * 1.02, p[2]) for p in (pts if sx > 0 else pts[::-1])], 'plaster')
            if timber:
                fr = (Vector((x, -dt / 2 * sx, h)) , Vector((0, sx, 0)), Vector((sx, 0, 0)), dt)
                on_wall(hi, fr, dt / 2, h + rise * 0.45, 0.2, rise * 0.9, 0.12, 'wood', 0.03); on_wall(hi, fr, dt / 2, h + 0.1, dt, 0.2, 0.14, 'wood', 0.035)
                brace(hi, fr, 0.2, h + 0.1, dt / 2 - 0.1, h + rise * 0.86); brace(hi, fr, dt - 0.2, h + 0.1, dt / 2 + 0.1, h + rise * 0.86)
            if rnd.random() < 0.6: 
                fr = (Vector((x, -dt / 2 * sx, h)), Vector((0, sx, 0)), Vector((sx, 0, 0)), dt)
                on_wall(hi, fr, dt / 2, h + rise * 0.3, 0.6, 0.7, 0.08, 'glass', 0.03)
                for sd in (-1, 1): on_wall(hi, fr, dt / 2 + sd * 0.36, h + rise * 0.3, 0.1, 0.9, 0.12, 'wood', 0.05)
        top = R
        # chimney
        for k in range(spec.get('chimneys', 1)):
            cx = (wt * 0.3) * (1 if k == 0 else -1); cy = dt * 0.12 * (1 if k == 0 else -1)
            for bb in (hi, lo): bb.box((cx, cy, (h + R + 1.0) / 2), (0.8, 0.8, R + 1.0 - h + 0.2), 'stone' if bb is hi else 'plaster')
            hi.box((cx, cy, R + 1.05), (0.95, 0.95, 0.16), 'stone')
            top = R + 1.1
    return hi.obj('hi_' + spec['name']), lo.obj('lo_' + spec['name'], [bake_mat]), top

# ---------------------------------------------------------------- bake target
def new_img(name, color, noncolor=False):
    im = bpy.data.images.new(name, AW, AH, alpha=False); im.generated_color = color
    if noncolor: im.colorspace_settings.name = 'Non-Color'
    return im
IMG = {'col': new_img('col', (0.5, 0.5, 0.5, 1)), 'ao': new_img('ao', (1, 1, 1, 1), True), 'nrm': new_img('nrm', (0.5, 0.5, 1, 1), True), 'emit': new_img('emit', (0, 0, 0, 1))}
scene.world = bpy.data.worlds.new('w'); scene.world.light_settings.distance = 2.5
bake_mat = bpy.data.materials.new('bake'); bake_mat.use_nodes = True
bake_node = bake_mat.node_tree.nodes.new('ShaderNodeTexImage'); bake_mat.node_tree.nodes.active = bake_node

SPECS = [
    dict(name='cottage', w=7.0, d=5.6, storeys=1, sh=2.7, wall='plaster', roof='thatch', pitch=52, over=0.55),
    dict(name='longhouse', w=11.0, d=6.2, storeys=1, sh=2.8, wall='plaster', roof='thatch', pitch=50, over=0.6, chimneys=2),
    dict(name='townhouse', w=6.2, d=7.0, storeys=2, sh=2.7, wall='plaster', wall0='stone', roof='tile', pitch=46, jetty=0.32, over=0.35),
    dict(name='merchant', w=8.4, d=6.6, storeys=2, sh=2.8, wall='plaster', wall0='plaster', roof='tile', pitch=44, jetty=0.0, over=0.4, win=0.8),
    dict(name='stonehouse', w=8.0, d=6.0, storeys=1, sh=3.3, wall='stone', roof='tile', pitch=40, timber=False, over=0.35),
    dict(name='inn', w=14.0, d=8.0, storeys=2, sh=2.9, wall='plaster', wall0='stone', roof='tile', pitch=42, jetty=0.25, chimneys=2, win=0.85, over=0.45),
    dict(name='loghall', w=9.0, d=6.0, storeys=1, sh=3.0, wall='log', roof='thatch', pitch=48, timber=False, over=0.6, shutters=False),
    dict(name='mudbrick', w=7.5, d=6.5, storeys=1, sh=3.5, wall='plaster', roof='tile', pitch=0, flat=True, timber=False, win=0.45, shutters=False),
]
meta = {}; los = []
for i, spec in enumerate(SPECS):
    rnd = random.Random(100 + i)
    hi, lo, top = build(spec, rnd)
    # unwrap the proxy and move its islands into this house's atlas cell
    bake_node.image = None
    bpy.ops.object.select_all(action='DESELECT'); lo.select_set(True); bpy.context.view_layer.objects.active = lo
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02, correct_aspect=False); bpy.ops.object.mode_set(mode='OBJECT')
    cx, cy = i % COLS, i // COLS; uvl = lo.data.uv_layers.active.data
    for l in uvl: l.uv = ((cx + 0.015 + l.uv[0] * 0.97) / COLS, (cy + 0.015 + l.uv[1] * 0.97) / ROWS)
    hi.select_set(True)
    for vis in ('visible_camera', 'visible_diffuse', 'visible_glossy', 'visible_transmission', 'visible_volume_scatter', 'visible_shadow'): setattr(lo, vis, False)
    for key, btype, kw in (('col', 'DIFFUSE', dict(pass_filter={'COLOR'})), ('ao', 'AO', {}), ('nrm', 'NORMAL', {}), ('emit', 'EMIT', {})):
        bake_node.image = IMG[key]
        bpy.ops.object.bake(type=btype, use_selected_to_active=True, cage_extrusion=0.22, max_ray_distance=0.7, margin=6, use_clear=False, **kw)
    hi.hide_render = True; hi.hide_set(True); lo.hide_render = True; los.append(lo)
    meta[spec['name']] = dict(w=spec['w'] + 2 * spec.get('jetty', 0), d=spec['d'] + 2 * spec.get('jetty', 0), h=top, wall=spec['wall'], roof=spec['roof'], storeys=spec['storeys'])
    print('BAKED', spec['name'], len(lo.data.polygons), 'faces')

def px(im): a = np.empty(AW * AH * 4, dtype=np.float32); im.pixels.foreach_get(a); return a.reshape(AH, AW, 4)
col, ao = px(IMG['col']), px(IMG['ao'])
col[..., :3] *= (0.3 + 0.7 * ao[..., :1])
IMG['col'].pixels.foreach_set(col.ravel())
for key, fn in (('col', 'houses_albedo.jpg'), ('nrm', 'houses_normal.jpg'), ('emit', 'houses_emit.jpg')):
    im = IMG[key]; im.filepath_raw = os.path.join(OUT, fn); im.file_format = 'JPEG'; im.save()
bpy.ops.object.select_all(action='DESELECT')
for o in los: o.hide_render = False; o.select_set(True)
bpy.context.view_layer.objects.active = los[0]
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'houses.glb'), export_format='GLB', use_selection=True, export_materials='NONE', export_yup=True, export_apply=True)
json.dump(meta, open(os.path.join(OUT, 'houses.json'), 'w'))
print('DONE houses')
