# King's Landing / southern city building kit. Sixteen detailed stone buildings (limestone walls, terracotta hip and gable
# roofs, dormers, shuttered windows, arched doors, shop arcades with awnings, a bell tower, a small sept, hovels, warehouses)
# are baked onto low-poly proxies sharing one 4096x4096 atlas.
#   Blender -b --factory-startup --python tools/blender/kl_kit.py -- <project dir>
# Emission atlas: R = window glow, B = roof mask (lets the game tint walls and roofs separately per building).
import bpy, bmesh, sys, os, math, json, random
from mathutils import Matrix, Euler, Vector
import numpy as np

proj = sys.argv[sys.argv.index('--') + 1]
TEX = os.path.join(proj, 'public', 'textures'); OUT = os.path.join(proj, 'public', 'models'); os.makedirs(OUT, exist_ok=True)
AW, AH, COLS, ROWS = 4096, 4096, 4, 4
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'; scene.cycles.samples = 12; scene.cycles.device = 'CPU'
try: scene.cycles.use_denoising = False
except Exception: pass

def principled(nt):
    for n in nt.nodes:
        if n.type == 'BSDF_PRINCIPLED': return n
def tex_mat(name, tex_id, scale, tint=(1, 1, 1), bump=0.35, emit=None, uv=False):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; N = nt.nodes; L = nt.links
    b = principled(nt)
    if tex_id:
        tc = N.new('ShaderNodeTexCoord'); mp = N.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (scale, scale, scale)
        img = N.new('ShaderNodeTexImage'); img.image = bpy.data.images.load(os.path.join(TEX, tex_id, 'diff.jpg'), check_existing=True)
        if not uv: img.projection = 'BOX'; img.projection_blend = 0.2
        L.new(tc.outputs['UV' if uv else 'Object'], mp.inputs['Vector']); L.new(mp.outputs['Vector'], img.inputs['Vector'])
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

ROOF = (0, 0, 1)   # roof mask goes into the blue channel of the emission bake
MATS = {
    'lime': tex_mat('lime', 'white_sandstone_bricks_03', 0.55, (1.0, 0.98, 0.93), 0.6),
    'lime2': tex_mat('lime2', 'white_sandstone_bricks_03', 0.4, (0.93, 0.88, 0.8), 0.6),
    'cream': tex_mat('cream', 'white_plaster_rough_01', 0.45, (0.93, 0.87, 0.74), 0.3),
    'ochre': tex_mat('ochre', 'white_plaster_rough_01', 0.45, (0.9, 0.77, 0.56), 0.3),
    'grey': tex_mat('grey', 'plastered_stone_wall', 0.4, (2.5, 2.4, 2.2), 0.5),
    'trim': tex_mat('trim', 'white_sandstone_bricks_03', 1.1, (1.08, 1.05, 1.0), 0.4),
    'plaster': tex_mat('plaster', None, 1, (0.8, 0.8, 0.8), 0),
    'terra': tex_mat('terra', 'clay_roof_tiles_03', 0.42, (1.0, 0.92, 0.84), 0.9, emit=ROOF, uv=True),
    'terra_old': tex_mat('terra_old', 'ceramic_roof_01', 0.4, (1.06, 0.92, 0.82), 0.9, emit=ROOF, uv=True),
    'terra_dark': tex_mat('terra_dark', 'roof_tiles_14', 0.45, (1.55, 1.2, 0.98), 0.9, emit=ROOF, uv=True),
    'wood': tex_mat('wood', 'dark_planks', 0.6, (0.62, 0.5, 0.4), 0.5),
    'shut_g': tex_mat('shut_g', 'wood_shutter', 1.2, (0.42, 0.62, 0.45), 0.6),
    'shut_b': tex_mat('shut_b', 'wood_shutter', 1.2, (0.6, 0.5, 0.42), 0.6),
    'shut_bl': tex_mat('shut_bl', 'wood_shutter', 1.2, (0.45, 0.62, 0.78), 0.6),
    'door': tex_mat('door', 'dark_planks', 0.9, (0.36, 0.26, 0.18), 0.6),
    'glass': tex_mat('glass', None, 1, (0.014, 0.016, 0.022), 0, emit=(1, 0, 0)),
    'glass_d': tex_mat('glass_d', None, 1, (0.014, 0.016, 0.022), 0),
    'dark': tex_mat('dark', None, 1, (0.02, 0.017, 0.014), 0),
    'awn_r': tex_mat('awn_r', None, 1, (0.5, 0.14, 0.1), 0),
    'awn_o': tex_mat('awn_o', None, 1, (0.72, 0.52, 0.22), 0),
    'awn_b': tex_mat('awn_b', None, 1, (0.2, 0.3, 0.42), 0),
    'lead': tex_mat('lead', 'plastered_stone_wall', 0.5, (1.5, 1.6, 1.6), 0.4, emit=ROOF),
}
MI = {k: i for i, k in enumerate(MATS)}
Z = Vector((0, 0, 1))

class B:
    def __init__(self): self.bm = bmesh.new(); self.uv = self.bm.loops.layers.uv.verify()
    def _set(self, faces, mat):
        for f in faces: f.material_index = MI[mat]
    def box(self, c, s, mat, rot=(0, 0, 0), sides=False):
        m = Matrix.Translation(c) @ Euler(rot).to_matrix().to_4x4() @ Matrix.Diagonal((s[0], s[1], s[2], 1))
        r = bmesh.ops.create_cube(self.bm, size=1.0, matrix=m)
        fs = list(set(f for v in r['verts'] for f in v.link_faces)); self._set(fs, mat)
        if sides:
            self.bm.normal_update(); bmesh.ops.delete(self.bm, geom=[f for f in fs if abs(f.normal.z) > 0.9], context='FACES_ONLY')
    def cyl(self, c, r, h, seg, mat, r2=None, sides=False, rotz=None):
        m = Matrix.Translation(c) @ Matrix.Rotation(math.pi / seg if rotz is None else rotz, 4, 'Z')
        res = bmesh.ops.create_cone(self.bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=h, matrix=m)
        fs = list(set(f for v in res['verts'] for f in v.link_faces)); self._set(fs, mat)
        if sides:
            self.bm.normal_update(); bmesh.ops.delete(self.bm, geom=[f for f in fs if abs(f.normal.z) > 0.9], context='FACES_ONLY')
    def poly(self, pts, mat, out=None, roof=False):
        vs = [self.bm.verts.new(p) for p in pts]; f = self.bm.faces.new(vs); f.material_index = MI[mat]; f.normal_update()
        if out is not None and f.normal.dot(Vector(out)) < 0: f.normal_flip(); f.normal_update()
        if roof:
            n = f.normal; s = (Z - n * n.z)
            s = s.normalized() if s.length > 1e-4 else Vector((0, 1, 0)); e = s.cross(n)
            for l in f.loops: l[self.uv].uv = (l.vert.co.dot(e), l.vert.co.dot(s))
        return f
    def dome(self, c, r, seg, rings, mat, squash=1.0, rot=None):
        rot = math.pi / seg if rot is None else rot
        for i in range(rings):
            p0, p1 = (i / rings) * math.pi / 2, ((i + 1) / rings) * math.pi / 2
            for j in range(seg):
                a0, a1 = rot + j * math.tau / seg, rot + (j + 1) * math.tau / seg
                def P(a, p): return (c[0] + math.cos(a) * math.cos(p) * r, c[1] + math.sin(a) * math.cos(p) * r, c[2] + math.sin(p) * r * squash)
                am = (a0 + a1) / 2; out = (math.cos(am), math.sin(am), 0.4)
                if i == rings - 1: self.poly([P(a0, p0), P(a1, p0), P(a0, p1)], mat, out, roof=True)
                else: self.poly([P(a0, p0), P(a1, p0), P(a1, p1), P(a0, p1)], mat, out, roof=True)
    def shift(self, dx, dy): bmesh.ops.translate(self.bm, verts=self.bm.verts, vec=(dx, dy, 0))
    def bounds(self):
        xs = [v.co.x for v in self.bm.verts]; ys = [v.co.y for v in self.bm.verts]; zs = [v.co.z for v in self.bm.verts]
        return min(xs), max(xs), min(ys), max(ys), max(zs)
    def obj(self, name, mats=None):
        me = bpy.data.meshes.new(name); self.bm.normal_update(); self.bm.to_mesh(me); self.bm.free()
        o = bpy.data.objects.new(name, me); scene.collection.objects.link(o)
        for m in (mats or MATS.values()): me.materials.append(m)
        return o

def frames(cx, cy, w, d):
    return [(Vector((cx - w / 2, cy - d / 2, 0)), Vector((1, 0, 0)), Vector((0, -1, 0)), w, 'f'), (Vector((cx + w / 2, cy + d / 2, 0)), Vector((-1, 0, 0)), Vector((0, 1, 0)), w, 'b'),
            (Vector((cx - w / 2, cy + d / 2, 0)), Vector((0, -1, 0)), Vector((-1, 0, 0)), d, 'l'), (Vector((cx + w / 2, cy - d / 2, 0)), Vector((0, 1, 0)), Vector((1, 0, 0)), d, 'r')]
def on_wall(b, fr, u, z, su, sz, th, mat, out=0.0, roll=0.0):
    o, du, n = fr[0], fr[1], fr[2]; c = o + du * u + n * out + Vector((0, 0, z))
    b.box(c, (su, th, sz), mat, (roll, 0, math.atan2(du.y, du.x)))
def arch(b, fr, u, zs, width, mat='trim', th=0.2, out=0.05, fill=None):
    r = width / 2; n = 7
    if fill: on_wall(b, fr, u, zs + r * 0.42, width * 0.86, r * 0.9, 0.06, fill, 0.02)
    for i in range(n):
        a = math.pi * (i + 0.5) / n; o, du, nn = fr[0], fr[1], fr[2]
        c = o + du * (u + math.cos(a) * r) + nn * out + Vector((0, 0, zs + math.sin(a) * r))
        m = Matrix.Translation(c) @ Matrix.Rotation(math.atan2(du.y, du.x), 4, 'Z') @ Matrix.Rotation(-(a - math.pi / 2), 4, 'Y') @ Matrix.Diagonal((math.pi * r / n * 1.12, th, 0.24, 1))
        res = bmesh.ops.create_cube(b.bm, size=1.0, matrix=m)
        for f in set(f for v in res['verts'] for f in v.link_faces): f.material_index = MI[mat]
def window(hi, fr, u, zc, ww, wh, spec, rnd, arched=False, shutters=True):
    g = 'glass' if rnd.random() < 0.55 else 'glass_d'
    on_wall(hi, fr, u, zc, ww, wh, 0.06, g, 0.02)
    on_wall(hi, fr, u, zc, 0.06, wh, 0.08, 'wood', 0.04); on_wall(hi, fr, u, zc + wh * 0.12, ww, 0.06, 0.08, 'wood', 0.04)
    for sd in (-1, 1): on_wall(hi, fr, u + sd * (ww / 2 + 0.07), zc, 0.15, wh + 0.1, 0.16, 'trim', 0.05)
    on_wall(hi, fr, u, zc - wh / 2 - 0.09, ww + 0.5, 0.16, 0.3, 'trim', 0.1)
    if arched: arch(hi, fr, u, zc + wh / 2, ww + 0.16, fill=g)
    else: on_wall(hi, fr, u, zc + wh / 2 + 0.1, ww + 0.4, 0.2, 0.18, 'trim', 0.06)
    if shutters and rnd.random() < spec.get('shutp', 0.75):
        sm = spec.get('shut', 'shut_g'); sw = ww / 2
        if rnd.random() < 0.8:
            for sd in (-1, 1): on_wall(hi, fr, u + sd * (ww / 2 + 0.16 + sw / 2), zc, sw, wh, 0.05, sm, 0.05)
        else: on_wall(hi, fr, u, zc, ww, wh, 0.05, sm, 0.07)          # closed
def door(hi, fr, u, w, h, arched=True, mat='door'):
    on_wall(hi, fr, u, h / 2, w, h, 0.08, mat, 0.03)
    for sd in (-1, 1): on_wall(hi, fr, u + sd * (w / 2 + 0.11), h / 2, 0.22, h, 0.2, 'trim', 0.06)
    if arched: arch(hi, fr, u, h, w + 0.22, fill=mat)
    else: on_wall(hi, fr, u, h + 0.14, w + 0.6, 0.28, 0.22, 'trim', 0.07)
    on_wall(hi, fr, u, 0.08, w + 0.7, 0.16, 0.5, 'trim', 0.2)        # step
def awning(hi, lo, fr, u, z, w, rnd):
    mat = rnd.choice(['awn_r', 'awn_o', 'awn_b', 'awn_o'])
    for b in (hi, lo): on_wall(b, fr, u, z - 0.28, w, 0.05, 1.5, mat if b is hi else 'plaster', 0.62, roll=math.radians(62))
    for sd in (-1, 1): on_wall(hi, fr, u + sd * (w / 2 - 0.05), z - 1.3, 0.07, 2.2, 0.07, 'wood', 1.25)

def roof(hi, lo, cx, cy, w, d, z, kind, pitch, ov, mat, wall):
    t = math.tan(pitch); ze = z - ov * t * 0.5
    x0, x1, y0, y1 = cx - w / 2 - ov, cx + w / 2 + ov, cy - d / 2 - ov, cy + d / 2 + ov
    def add(pts):
        hi.poly(pts, mat, Z, roof=True); lo.poly([(p[0], p[1], p[2] + 0.05) for p in pts], 'plaster', Z)
    def gab(pts, out):
        hi.poly(pts, wall, out); lo.poly([(p[0] + out[0] * 0.08, p[1] + out[1] * 0.08, p[2]) for p in pts], 'plaster', out)
    hi.box((cx, cy, z + 0.02), (w + ov * 1.2, d + ov * 1.2, 0.26), 'trim')            # cornice
    if kind == 'hip':
        if w >= d:
            zr = ze + (d / 2 + ov) * t; rl = (w - d) / 2; r0, r1 = (cx - rl, cy, zr), (cx + rl, cy, zr)
            add([(x0, y0, ze), (x1, y0, ze), r1, r0]); add([(x1, y1, ze), (x0, y1, ze), r0, r1]); add([(x0, y1, ze), (x0, y0, ze), r0]); add([(x1, y0, ze), (x1, y1, ze), r1])
            if rl > 0.3: hi.box((cx, cy, zr + 0.03), (rl * 2 + 0.3, 0.34, 0.16), mat)
        else:
            zr = ze + (w / 2 + ov) * t; rl = (d - w) / 2; r0, r1 = (cx, cy - rl, zr), (cx, cy + rl, zr)
            add([(x0, y0, ze), (x1, y0, ze), r0]); add([(x1, y1, ze), (x0, y1, ze), r1]); add([(x0, y1, ze), (x0, y0, ze), r0, r1]); add([(x1, y0, ze), (x1, y1, ze), r1, r0])
            hi.box((cx, cy, zr + 0.03), (0.34, rl * 2 + 0.3, 0.16), mat)
        return zr
    if kind == 'gx':       # ridge along X, gables on the +-X ends
        zr = ze + (d / 2 + ov) * t
        add([(x0, y0, ze), (x1, y0, ze), (x1, cy, zr), (x0, cy, zr)]); add([(x1, y1, ze), (x0, y1, ze), (x0, cy, zr), (x1, cy, zr)])
        for sx in (-1, 1):
            x = cx + sx * w / 2; gab([(x, cy - d / 2, z), (x, cy + d / 2, z), (x, cy, zr - ov * t - 0.02)], (sx, 0, 0))
        hi.box((cx, cy, zr + 0.03), (w + ov * 2 + 0.1, 0.34, 0.16), mat); return zr
    if kind == 'gy':       # ridge along Y, gable faces the street
        zr = ze + (w / 2 + ov) * t
        add([(x0, y1, ze), (x0, y0, ze), (cx, y0, zr), (cx, y1, zr)]); add([(x1, y0, ze), (x1, y1, ze), (cx, y1, zr), (cx, y0, zr)])
        for sy in (-1, 1):
            y = cy + sy * d / 2; gab([(cx - w / 2, y, z), (cx + w / 2, y, z), (cx, y, zr - ov * t - 0.02)], (0, sy, 0))
        hi.box((cx, cy, zr + 0.03), (0.34, d + ov * 2 + 0.1, 0.16), mat); return zr
    if kind == 'shed':     # lean-to: high at the back
        zr = ze + (d + 2 * ov) * t
        add([(x0, y0, ze), (x1, y0, ze), (x1, y1, zr), (x0, y1, zr)])
        for sx in (-1, 1):
            x = cx + sx * w / 2; gab([(x, cy - d / 2, z), (x, cy + d / 2, z), (x, cy + d / 2, zr - ov * t)], (sx, 0, 0))
        gab([(cx - w / 2, cy + d / 2, z), (cx + w / 2, cy + d / 2, z), (cx + w / 2, cy + d / 2, zr - ov * t), (cx - w / 2, cy + d / 2, zr - ov * t)], (0, 1, 0))
        return zr
    # flat roof with parapet
    for b in (hi, lo):
        for fr in frames(cx, cy, w, d): on_wall(b, fr, fr[3] / 2, z + 0.35, fr[3] + 0.3, 0.7, 0.3, wall if b is hi else 'plaster', -0.1)
        b.box((cx, cy, z + 0.02), (w - 0.2, d - 0.2, 0.1), wall if b is hi else 'plaster')
    return z + 0.7

def dormer(hi, lo, x, cy, d, z, ov, pitch, side, mat, wall, spec, rnd):
    t = math.tan(pitch); ze = z - ov * t * 0.5; inset = 0.9
    yb = cy + side * (d / 2 - inset); zr = ze + (ov + inset) * t; w_, h_ = 1.45, 1.3; L = h_ / t + 0.4
    for b in (hi, lo): b.box((x, yb - side * L / 2, zr + h_ / 2 - 0.1), (w_, L, h_ + 0.2), wall if b is hi else 'plaster')
    zt = zr + h_; zp = zt + 0.55; ya, yz = yb + side * 0.22, yb - side * (L + 0.5)
    for sx in (-1, 1):
        pts = [(x + sx * (w_ / 2 + 0.18), ya, zt - 0.08), (x + sx * (w_ / 2 + 0.18), yz, zt - 0.08), (x, yz, zp), (x, ya, zp)]
        hi.poly(pts, mat, (sx * 0.5, 0, 1), roof=True); lo.poly([(p[0], p[1], p[2] + 0.04) for p in pts], 'plaster', (sx * 0.5, 0, 1))
    hi.poly([(x - w_ / 2, yb, zt), (x + w_ / 2, yb, zt), (x, yb, zp - 0.05)], wall, (0, side, 0))
    fr = (Vector((x - w_ / 2, yb, 0)), Vector((1, 0, 0)), Vector((0, -1, 0)), w_) if side < 0 else (Vector((x + w_ / 2, yb, 0)), Vector((-1, 0, 0)), Vector((0, 1, 0)), w_)
    window(hi, fr, w_ / 2, zr + h_ * 0.52, 0.7, 0.85, spec, rnd, shutters=False)

def chimney(hi, lo, x, y, z0, z1):
    for b in (hi, lo): b.box((x, y, (z0 + z1) / 2), (0.85, 0.85, z1 - z0), 'lime2' if b is hi else 'plaster')
    hi.box((x, y, z1 + 0.06), (1.05, 1.05, 0.14), 'trim'); hi.box((x, y, z1 + 0.3), (0.5, 0.5, 0.36), 'terra_old')

def build(spec, rnd):
    hi, lo = B(), B(); sh = spec['sh']; pitch = math.radians(spec.get('pitch', 27)); ov = spec.get('over', 0.45); top = 0
    for part in spec['parts']:
        cx, cy = part['c']; w, d, st = part['w'], part['d'], part['st']; h = st * sh
        wall = part.get('wall', spec['wall']); wall0 = part.get('wall0', spec.get('wall0', wall)); rmat = part.get('roofm', spec['roof'])
        if wall0 != wall and st > 1: hi.box((cx, cy, sh / 2), (w, d, sh), wall0); hi.box((cx, cy, sh + (h - sh) / 2), (w, d, h - sh), wall)
        else: hi.box((cx, cy, h / 2), (w, d, h), wall)
        lo.box((cx, cy, h / 2), (w + 0.16, d + 0.16, h), 'plaster', sides=True)
        hi.box((cx, cy, 0.2), (w + 0.16, d + 0.16, 0.5), 'trim')
        for fr in frames(cx, cy, w, d):
            L = fr[3]; side = fr[4]; nb = max(1, int(L / spec.get('bay', 2.5))); bay = L / nb; front = side == 'f' and part.get('main', True)
            if spec.get('quoins'):
                for k in range(int(h / 0.8)):
                    for uu in (0.3, L - 0.3): on_wall(hi, fr, uu if k % 2 == 0 else (uu + (0.12 if uu < 1 else -0.12)), 0.4 + k * 0.8, 0.6 if k % 2 == 0 else 0.84, 0.42, 0.14, 'trim', 0.035)
            for s in range(st):
                zb = s * sh
                if s > 0 and spec.get('course', True): on_wall(hi, fr, L / 2, zb, L + 0.26, 0.17, 0.24, 'trim', 0.03)
                if part.get('belfry') and s == st - 1:
                    on_wall(hi, fr, L / 2, zb + sh * 0.42, L * 0.42, sh * 0.62, 0.1, 'dark', 0.02); arch(hi, fr, L / 2, zb + sh * 0.73, L * 0.42 + 0.2, fill='dark')
                    on_wall(hi, fr, L / 2, zb + 0.12, L * 0.6, 0.2, 0.3, 'trim', 0.08); continue
                for i in range(nb):
                    u = (i + 0.5) * bay; dbay = part.get('doorbay', nb // 2)
                    if s == 0 and front and part.get('door', True) and i == dbay:
                        if part.get('gate'): door(hi, fr, u, min(bay * 0.85, 2.9), 3.1, True)
                        else: door(hi, fr, u, 1.25, 2.35, spec.get('archdoor', True))
                    elif s == 0 and front and part.get('shop') and bay > 2.0:
                        ow = bay * 0.7; on_wall(hi, fr, u, 1.2, ow, 2.4, 0.08, 'dark', 0.02); arch(hi, fr, u, 2.4, ow + 0.2, fill='dark')
                        for sd in (-1, 1): on_wall(hi, fr, u + sd * (ow / 2 + 0.1), 1.2, 0.22, 2.4, 0.2, 'trim', 0.06)
                        on_wall(hi, fr, u, 0.45, ow, 0.9, 0.3, 'wood', 0.12)            # stall counter
                        if rnd.random() < 0.75: awning(hi, lo, fr, u, 3.55, ow + 0.5, rnd)
                    elif s == 0 and side == 'b' and part.get('gate') and i == nb // 2: door(hi, fr, u, min(bay * 0.85, 2.9), 3.1, True)
                    elif rnd.random() < spec.get('win', 0.82) and bay > 1.3:
                        if spec.get('tallwin') and s >= 1 - (1 if st == 1 else 0): window(hi, fr, u, zb + sh * 0.52, min(1.2, bay * 0.45), sh * 0.5, spec, rnd, arched=True, shutters=False)
                        elif spec.get('slit'): on_wall(hi, fr, u, zb + sh * 0.55, 0.28, 1.1, 0.06, 'glass_d', 0.02); on_wall(hi, fr, u, zb + sh * 0.55 - 0.65, 0.6, 0.14, 0.2, 'trim', 0.06)
                        elif s == 0: window(hi, fr, u, zb + sh * 0.56, min(0.85, bay * 0.36), 0.95, spec, rnd, shutters=rnd.random() < 0.4)
                        elif s == st - 1 and st >= 3 and spec.get('attic', True): window(hi, fr, u, zb + sh * 0.5, min(0.8, bay * 0.34), 0.85, spec, rnd)
                        else:
                            bal = front and spec.get('balcony') and s == 1 and i == dbay
                            window(hi, fr, u, zb + sh * (0.47 if bal else 0.52), min(1.0, bay * 0.4), 1.9 if bal else 1.3, spec, rnd, arched=spec.get('archwin', False) and s == 1)
                            if bal:
                                for b in (hi, lo): on_wall(b, fr, u, zb + 0.02, 2.4, 0.16, 0.95, 'trim' if b is hi else 'plaster', 0.5)
                                on_wall(hi, fr, u, zb + 0.95, 2.4, 0.08, 0.1, 'trim', 0.93)
                                for k in range(9): on_wall(hi, fr, u - 1.12 + k * 0.28, zb + 0.5, 0.07, 0.9, 0.07, 'trim', 0.93)
                                for sd in (-1, 1): on_wall(hi, fr, u + sd * 1.16, zb + 0.5, 0.07, 0.9, 0.9, 'trim', 0.5)
        rk = part.get('roof', 'hip')
        zt = roof(hi, lo, cx, cy, w, d, h, rk, math.radians(part['pitch']) if 'pitch' in part else pitch, ov, rmat, wall)
        for k in range(part.get('dorm', 0)):
            if rk in ('hip', 'gx') and w >= d:
                n = part['dorm']; span = (w - d * (0.9 if rk == 'hip' else 0.2)) ; x = cx + ((k // 2 + 0.5) / max(1, (n + 1) // 2) - 0.5) * span
                dormer(hi, lo, x, cy, d, h, ov, pitch, -1 if k % 2 == 0 else 1, rmat, wall, spec, rnd)
        for k in range(part.get('chim', 0)):
            sx = 1 if k % 2 == 0 else -1; x = cx + sx * (w / 2 - 0.9); y = cy + (d * 0.18 if k < 2 else -d * 0.2)
            chimney(hi, lo, x, y, h - 0.3, h + (zt - h) * 0.55 + 1.5)
        top = max(top, zt + (1.2 if part.get('chim') else 0))
    return hi, lo, top

def build_sept(spec, rnd):
    hi, lo = B(), B(); R, H = 5.6, 7.4; ap = R * math.cos(math.pi / 8)
    hi.cyl((0, 0, H / 2), R, H, 8, 'lime'); lo.cyl((0, 0, H / 2), R + 0.09, H, 8, 'plaster', sides=True)
    hi.cyl((0, 0, 0.25), R + 0.2, 0.6, 8, 'trim'); hi.cyl((0, 0, H + 0.1), R + 0.3, 0.3, 8, 'trim')
    for k in range(8):
        a = -math.pi / 2 + k * math.pi / 4; n = Vector((math.cos(a), math.sin(a), 0)); du = Vector((-n.y, n.x, 0)); L = 2 * R * math.sin(math.pi / 8)
        fr = (n * ap - du * L / 2, du, n, L)
        if k == 0: door(hi, fr, L / 2, 1.7, 2.9, True)
        else: window(hi, fr, L / 2, H * 0.55, 1.0, 2.6, spec, rnd, arched=True, shutters=False)
        for uu in (0.0, L): on_wall(hi, fr, uu, H / 2, 0.5, H, 0.3, 'trim', 0.05)
    # low conical roof up to the drum, then drum and dome
    for j in range(8):
        a0, a1 = math.pi / 8 + j * math.pi / 4, math.pi / 8 + (j + 1) * math.pi / 4; r1, z1 = R + 0.35, H + 0.2; r2, z2 = 3.5, H + 1.7
        pts = [(math.cos(a0) * r1, math.sin(a0) * r1, z1), (math.cos(a1) * r1, math.sin(a1) * r1, z1), (math.cos(a1) * r2, math.sin(a1) * r2, z2), (math.cos(a0) * r2, math.sin(a0) * r2, z2)]
        hi.poly(pts, 'terra_old', Z, roof=True); lo.poly([(p[0], p[1], p[2] + 0.05) for p in pts], 'plaster', Z)
    hi.cyl((0, 0, H + 2.7), 3.5, 2.4, 16, 'lime'); lo.cyl((0, 0, H + 2.7), 3.58, 2.4, 8, 'plaster', sides=True)
    for k in range(8):
        a = k * math.pi / 4; n = Vector((math.cos(a), math.sin(a), 0)); du = Vector((-n.y, n.x, 0)); fr = (n * 3.45 - du * 0.5, du, n, 1.0)
        on_wall(hi, fr, 0.5, H + 2.7, 0.5, 1.2, 0.08, 'glass', 0.03); arch(hi, fr, 0.5, H + 3.3, 0.66, fill='glass')
    hi.cyl((0, 0, H + 3.95), 3.75, 0.25, 16, 'trim')
    hi.dome((0, 0, H + 4.0), 3.6, 16, 6, 'lead', 0.92); lo.dome((0, 0, H + 4.04), 3.66, 8, 3, 'plaster', 0.92)
    zt = H + 4.0 + 3.6 * 0.92
    hi.cyl((0, 0, zt + 0.5), 0.55, 1.2, 8, 'trim'); lo.cyl((0, 0, zt + 0.5), 0.6, 1.2, 4, 'plaster', sides=True)
    hi.cyl((0, 0, zt + 1.6), 0.7, 1.1, 8, 'lead', r2=0.02); lo.cyl((0, 0, zt + 1.6), 0.74, 1.1, 4, 'plaster', r2=0.02, sides=True)
    return hi, lo, zt + 2.2

P = lambda c, w, d, st, **k: dict(c=c, w=w, d=d, st=st, **k)
SPECS = [
    dict(name='kl_house_a', cls='common', sh=3.0, wall='lime', roof='terra', shut='shut_g', parts=[P((0, 0), 6.6, 8.6, 3, roof='gy', chim=1)]),
    dict(name='kl_house_b', cls='common', sh=3.0, wall='cream', wall0='lime2', roof='terra_old', shut='shut_g', parts=[P((0, 0), 9.6, 8.0, 3, roof='hip', dorm=1, chim=1)]),
    dict(name='kl_house_c', cls='common', sh=2.9, wall='lime2', roof='terra', shut='shut_b', parts=[P((0, 0), 8.2, 7.2, 2, roof='hip', chim=1)]),
    dict(name='kl_tenement', cls='common', sh=3.0, wall='grey', wall0='lime', roof='terra_dark', shut='shut_bl', quoins=True, parts=[P((0, 0), 11.2, 9.6, 4, roof='hip', shop=True, dorm=2, chim=2)]),
    dict(name='kl_corner', cls='common', sh=3.1, wall='ochre', wall0='lime', roof='terra', shut='shut_g', quoins=True, parts=[P((0, 0), 9.0, 9.0, 3, roof='hip', shop=True, chim=1), P((3.3, -3.3), 3.2, 3.2, 4, roof='hip', pitch=48, door=False, main=False)]),
    dict(name='kl_manse', cls='rich', sh=3.4, wall='cream', wall0='lime', roof='terra_old', shut='shut_bl', quoins=True, balcony=True, archwin=True, parts=[P((0, 1.5), 15.0, 9.0, 3, roof='hip', dorm=2, chim=2), P((4.6, -4.4), 5.8, 4.4, 2, roof='gy', door=False, main=False)]),
    dict(name='kl_hall', cls='civic', sh=4.2, wall='lime', roof='terra_dark', tallwin=True, quoins=True, bay=3.1, parts=[P((0, 0), 19.0, 9.4, 2, roof='gx', gate=True, pitch=36)]),
    dict(name='kl_tower', cls='civic', sh=3.3, wall='lime', roof='terra', slit=True, win=0.45, bay=2.6, quoins=True, parts=[P((0, 0), 5.2, 5.2, 7, roof='hip', pitch=54, belfry=True)]),
    dict(name='kl_hovel', cls='poor', sh=2.5, wall='ochre', roof='terra_old', shutp=0.3, shut='shut_b', course=False, archdoor=False, win=0.6, parts=[P((-1.2, 0), 6.0, 5.6, 2, roof='gx', chim=1), P((3.1, -0.4), 2.6, 4.2, 1, roof='shed', pitch=22, door=False, main=False, wall='grey')]),
    dict(name='kl_hovel_b', cls='poor', sh=2.4, wall='grey', roof='terra_dark', shutp=0.3, shut='shut_b', course=False, archdoor=False, win=0.6, parts=[P((0, 0), 7.4, 5.4, 2, roof='hip', chim=1)]),
    dict(name='kl_warehouse', cls='harbor', sh=3.7, wall='grey', wall0='lime2', roof='terra_dark', win=0.45, shutp=0.2, bay=3.2, parts=[P((0, 0), 16.0, 10.0, 2, roof='gx', gate=True, pitch=30)]),
    dict(name='kl_shop', cls='common', sh=3.0, wall='cream', wall0='lime', roof='terra', shut='shut_g', parts=[P((0, 0), 8.4, 7.6, 2, roof='hip', shop=True, chim=1)]),
    dict(name='kl_sept', cls='civic', sept=True),
    dict(name='kl_lshape', cls='rich', sh=3.1, wall='lime', roof='terra', shut='shut_g', quoins=True, parts=[P((-2.6, 0), 7.2, 12.0, 3, roof='hip', chim=1), P((3.6, 3.0), 5.6, 6.0, 2, roof='hip', door=False, main=False, chim=1)]),
    dict(name='kl_narrow', cls='common', sh=2.9, wall='ochre', wall0='lime2', roof='terra', shut='shut_b', parts=[P((0, 0), 5.4, 9.0, 4, roof='gy', chim=1)]),
    dict(name='kl_inn', cls='common', sh=3.1, wall='cream', wall0='lime', roof='terra', shut='shut_g', quoins=True, parts=[P((0, 0), 14.0, 9.0, 3, roof='hip', gate=True, doorbay=1, dorm=2, chim=2), P((5.4, 5.6), 3.6, 3.6, 4, roof='hip', pitch=45, door=False, main=False)]),
]

def new_img(name, color, noncolor=False):
    im = bpy.data.images.new(name, AW, AH, alpha=False); im.generated_color = color
    if noncolor: im.colorspace_settings.name = 'Non-Color'
    return im
IMG = {'col': new_img('col', (0.5, 0.5, 0.5, 1)), 'ao': new_img('ao', (1, 1, 1, 1), True), 'nrm': new_img('nrm', (0.5, 0.5, 1, 1), True), 'emit': new_img('emit', (0, 0, 0, 1))}
scene.world = bpy.data.worlds.new('w'); scene.world.light_settings.distance = 2.5
bake_mat = bpy.data.materials.new('bake'); bake_mat.use_nodes = True
bake_node = bake_mat.node_tree.nodes.new('ShaderNodeTexImage'); bake_mat.node_tree.nodes.active = bake_node

meta = {}; los = []
for i, spec in enumerate(SPECS):
    rnd = random.Random(300 + i)
    hb, lb, top = build_sept(spec, rnd) if spec.get('sept') else build(spec, rnd)
    x0, x1, y0, y1, zmax = lb.bounds()
    # footprint from the wall boxes only (ignore roof overhang): shrink by a typical overhang
    for b in (hb, lb): b.shift(-(x0 + x1) / 2, -(y0 + y1) / 2)
    hi = hb.obj('hi_' + spec['name']); lo = lb.obj('lo_' + spec['name'], [bake_mat])
    bake_node.image = None
    bpy.ops.object.select_all(action='DESELECT'); lo.select_set(True); bpy.context.view_layer.objects.active = lo
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02, correct_aspect=False); bpy.ops.object.mode_set(mode='OBJECT')
    cx, cy = i % COLS, i // COLS; uvl = lo.data.uv_layers.active.data
    for l in uvl: l.uv = ((cx + 0.015 + l.uv[0] * 0.97) / COLS, (cy + 0.015 + l.uv[1] * 0.97) / ROWS)
    hi.select_set(True)
    for vis in ('visible_camera', 'visible_diffuse', 'visible_glossy', 'visible_transmission', 'visible_volume_scatter', 'visible_shadow'): setattr(lo, vis, False)   # the proxy must not shadow the detailed model
    for key, btype, kw in (('col', 'DIFFUSE', dict(pass_filter={'COLOR'})), ('ao', 'AO', {}), ('nrm', 'NORMAL', {}), ('emit', 'EMIT', {})):
        bake_node.image = IMG[key]
        bpy.ops.object.bake(type=btype, use_selected_to_active=True, cage_extrusion=0.25, max_ray_distance=0.8, margin=6, use_clear=False, **kw)
    hi.hide_render = True; hi.hide_set(True); lo.hide_render = True; los.append(lo)
    ovr = 0.9
    meta[spec['name']] = dict(w=round(x1 - x0 - ovr, 2), d=round(y1 - y0 - ovr, 2), h=round(zmax, 2), cls=spec['cls'])
    print('BAKED', spec['name'], len(lo.data.polygons), 'faces', meta[spec['name']], flush=True)

def px(im): a = np.empty(AW * AH * 4, dtype=np.float32); im.pixels.foreach_get(a); return a.reshape(AH, AW, 4)
col, ao = px(IMG['col']), px(IMG['ao'])
col[..., :3] *= (0.3 + 0.7 * ao[..., :1])
IMG['col'].pixels.foreach_set(col.ravel())
for key, fn in (('col', 'kl_albedo.jpg'), ('nrm', 'kl_normal.jpg'), ('emit', 'kl_emit.jpg')):
    im = IMG[key]; im.filepath_raw = os.path.join(OUT, fn); im.file_format = 'JPEG'; scene.render.image_settings.quality = 92; im.save()
bpy.ops.object.select_all(action='DESELECT')
for o in los: o.hide_render = False; o.select_set(True)
bpy.context.view_layer.objects.active = los[0]
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'kl.glb'), export_format='GLB', use_selection=True, export_materials='NONE', export_yup=True, export_apply=True)
json.dump(meta, open(os.path.join(OUT, 'kl.json'), 'w'))
print('DONE kl kit')
