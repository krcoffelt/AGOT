# King's Landing landmarks as real geometry: the Red Keep, the Great Sept of Baelor, the Dragonpit.
#   Blender -b --factory-startup --python tools/blender/kl_landmarks.py -- <project dir>
# Each model sits on a levelled hilltop: z = 0 is the plateau, foundations run well below it. +X east, +Y north.
# Materials are named by the game's shared masonry / roof materials (ashlar, roof, plain, glow); stone colour and baked
# ambient occlusion travel in the vertex colours, UVs are box-projected at the game's texture scale.
import bpy, bmesh, sys, os, math, random
from mathutils import Matrix, Vector
import numpy as np

proj = sys.argv[sys.argv.index('--') + 1]
OUT = os.path.join(proj, 'public', 'models'); os.makedirs(OUT, exist_ok=True)
UVS = 0.22; TAU = math.tau; Z = Vector((0, 0, 1))
MATN = ['ashlar', 'roof', 'plain', 'glow', 'gold']

class M:
    def __init__(self, seed=1):
        self.bm = bmesh.new(); self.uv = self.bm.loops.layers.uv.verify(); self.col = self.bm.faces.layers.float_vector.new('tint'); self.rnd = random.Random(seed)
    def _fin(self, faces, mat, tint, smooth=False, roof=False):
        for f in faces:
            f.material_index = MATN.index(mat); f[self.col] = tint; f.smooth = smooth
    def box(self, c, s, mat, tint, rz=0.0, top=1.0, rx=0.0, ry=0.0):
        m = Matrix.Translation(c) @ Matrix.Rotation(rz, 4, 'Z') @ Matrix.Rotation(ry, 4, 'Y') @ Matrix.Rotation(rx, 4, 'X')
        r = bmesh.ops.create_cube(self.bm, size=1.0)
        for v in r['verts']:
            k = top if v.co.z > 0 else 1.0
            v.co = m @ Vector((v.co.x * s[0] * k, v.co.y * s[1] * k, v.co.z * s[2]))
        self._fin(set(f for v in r['verts'] for f in v.link_faces), mat, tint)
    def drum(self, c, r, h, mat, tint, seg=20, r2=None, smooth=True, rot=None):
        m = Matrix.Translation((c[0], c[1], c[2] + h / 2)) @ Matrix.Rotation(math.pi / seg if rot is None else rot, 4, 'Z')
        res = bmesh.ops.create_cone(self.bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=h, matrix=m)
        fs = set(f for v in res['verts'] for f in v.link_faces); self._fin(fs, mat, tint)
        for f in fs: f.normal_update(); f.smooth = smooth and abs(f.normal.z) < 0.9
    def poly(self, pts, mat, tint, out=None, smooth=False):
        f = self.bm.faces.new([self.bm.verts.new(p) for p in pts]); f.normal_update()
        if out is not None and f.normal.dot(Vector(out)) < 0: f.normal_flip(); f.normal_update()
        self._fin([f], mat, tint, smooth); return f
    def cone(self, c, r, h, mat, tint, seg=16, rot=None):
        rot = math.pi / seg if rot is None else rot; tip = (c[0], c[1], c[2] + h)
        for j in range(seg):
            a0, a1 = rot + j * TAU / seg, rot + (j + 1) * TAU / seg; am = (a0 + a1) / 2
            self.poly([(c[0] + math.cos(a0) * r, c[1] + math.sin(a0) * r, c[2]), (c[0] + math.cos(a1) * r, c[1] + math.sin(a1) * r, c[2]), tip], mat, tint, (math.cos(am), math.sin(am), 0.3), smooth=seg > 8)
    def dome(self, c, r, mat, tint, seg=24, rings=8, squash=1.0, a_max=math.pi / 2):
        rot = math.pi / seg
        for i in range(rings):
            p0, p1 = (i / rings) * a_max, ((i + 1) / rings) * a_max
            for j in range(seg):
                a0, a1 = rot + j * TAU / seg, rot + (j + 1) * TAU / seg
                P = lambda a, p: (c[0] + math.cos(a) * math.cos(p) * r, c[1] + math.sin(a) * math.cos(p) * r, c[2] + math.sin(p) * r * squash)
                am = (a0 + a1) / 2; out = (math.cos(am), math.sin(am), 0.5)
                if i == rings - 1 and a_max > 1.5: self.poly([P(a0, p0), P(a1, p0), P(a0, p1)], mat, tint, out, True)
                else: self.poly([P(a0, p0), P(a1, p0), P(a1, p1), P(a0, p1)], mat, tint, out, True)
    # ---- castle vocabulary
    def merlons(self, c, r, z, n, tint, w=1.5, h=1.5, th=0.8):
        for i in range(n):
            a = (i + 0.5) / n * TAU; self.box((c[0] + math.cos(a) * r, c[1] + math.sin(a) * r, z + h / 2), (th, w, h), 'ashlar', tint, a)
    def crown(self, c, r, z, tint, flare=1.16, seg=None):
        # machicolated, crenellated tower head: corbels, flared ring, parapet, merlons (seg: keep a polygonal tower's facets)
        rf = r * flare; n = max(10, int(r * 2.4))
        for i in range(n):
            a = (i + 0.5) / n * TAU; self.box((c[0] + math.cos(a) * (r + (rf - r) * 0.45), c[1] + math.sin(a) * (r + (rf - r) * 0.45), z - 1.1), ((rf - r) * 1.3, 0.7, 2.2), 'ashlar', sh(tint, 0.86), a, top=1.0)
        sg = seg or max(16, n)
        self.drum((c[0], c[1], z), rf, 1.5, 'ashlar', sh(tint, 1.04), seg=sg); self.drum((c[0], c[1], z + 1.5), rf, 0.25, 'ashlar', sh(tint, 0.9), seg=sg)
        self.merlons(c, rf - 0.45, z + 1.5, n, tint, w=min(1.7, rf * TAU / n * 0.55))
        return z + 1.5
    def slit(self, c, r, a, z, h=2.2, w=0.5, glow=True):
        self.box((c[0] + math.cos(a) * (r + 0.02), c[1] + math.sin(a) * (r + 0.02), z), (0.3, w, h), 'glow' if glow else 'plain', (1, 1, 1) if glow else (0.03, 0.03, 0.03), a)
    def tower(self, c, r, h, tint, top='crown', seg=20, taper=0.93, roof=(0.36, 0.16, 0.13), z0=-22.0, bands=True, cone_h=None, win=True):
        self.drum((c[0], c[1], z0), r * 1.12, h * 0.16 - z0, 'ashlar', sh(tint, 0.9), seg, r2=r)                     # battered base
        self.drum((c[0], c[1], h * 0.16), r, h * 0.84, 'ashlar', tint, seg, r2=r * taper)
        rt = r * taper
        if bands:
            for t in (0.16, 0.55, 0.8): self.drum((c[0], c[1], h * t - 0.3), r * (1 - (1 - taper) * max(0, t - 0.16) / 0.84) + 0.22, 0.6, 'ashlar', sh(tint, 1.08), seg)
        if win:
            nl = max(1, int(h / 11)); nw = max(3, int(r / 2.4))
            for l in range(nl):
                for i in range(nw):
                    if self.rnd.random() < 0.3: continue
                    zz = 7 + l * 11 + self.rnd.random() * 2; a = (i / nw) * TAU + l * 0.8
                    if zz < h - 5: self.slit(c, r * (1 - (1 - taper) * max(0, zz / h - 0.16) / 0.84), a, zz, glow=self.rnd.random() < 0.6)
        if top == 'crown': return self.crown(c, rt, h, tint, seg=seg if seg <= 8 else None)
        if top == 'cone':
            self.drum((c[0], c[1], h), rt * 1.1, 0.8, 'ashlar', sh(tint, 1.06), seg); ch = cone_h or r * 2.3
            self.cone((c[0], c[1], h + 0.8), rt * 1.16, ch, 'roof', roof, seg); self.box((c[0], c[1], h + 0.8 + ch + 1.2), (0.16, 0.16, 2.6), 'plain', (0.5, 0.4, 0.2)); return h + ch
        if top == 'both':   # crenellated gallery with a smaller capped turret rising from it
            zt = self.crown(c, rt, h, tint); self.drum((c[0], c[1], h), rt * 0.62, 9, 'ashlar', tint, seg); self.drum((c[0], c[1], h + 9), rt * 0.7, 0.7, 'ashlar', sh(tint, 1.06), seg)
            self.cone((c[0], c[1], h + 9.7), rt * 0.76, rt * 1.9, 'roof', roof, seg); return h + 9.7 + rt * 1.9
        return h
    def wall(self, a, b, h, th, tint, z0=-22.0, batter=1.5, merlon=True):
        dx, dy = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dy); ang = math.atan2(dy, dx); cx, cy = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        nx, ny = -dy / L, dx / L
        self.box((cx, cy, (h + z0) / 2), (L, th * batter, h - z0), 'ashlar', tint, ang, top=1 / batter)                # NB: taper narrows length slightly too; hidden by towers
        self.box((cx, cy, h + 0.2), (L, th + 1.2, 0.5), 'ashlar', sh(tint, 1.06), ang)                                # walk
        if merlon:
            n = max(2, int(L / 3.2))
            for sd in (-1, 1):
                for i in range(n):
                    t = (i + 0.5) / n - 0.5
                    if sd < 0 and i % 2: continue
                    self.box((cx + dx * t + nx * sd * (th / 2 + 0.35), cy + dy * t + ny * sd * (th / 2 + 0.35), h + 0.45 + 0.8), (L / n * 0.55, 0.6, 1.6 if sd > 0 else 0.9), 'ashlar', tint, ang)
        nb = int(L / 13)
        for i in range(nb):
            t = (i + 0.5) / nb - 0.5
            for sd in (-1, 1): self.box((cx + dx * t + nx * sd * th * 0.62, cy + dy * t + ny * sd * th * 0.62, (h * 0.8 + z0) / 2), (2.2, 2.0, h * 0.8 - z0), 'ashlar', sh(tint, 0.94), ang, top=0.62)
    def arch_win(self, p, ang, w, h, tint, proud=0.12, glow=True, n=8):
        # tall round-headed window on a vertical wall. p = centre of sill, ang = wall outward direction
        du = Vector((-math.sin(ang), math.cos(ang), 0)); nn = Vector((math.cos(ang), math.sin(ang), 0)); p = Vector(p)
        def shape(ww, hh, off):
            pts = [p + du * (-ww / 2) + nn * off, p + du * (ww / 2) + nn * off, p + du * (ww / 2) + nn * off + Z * (hh - ww / 2)]
            for i in range(1, n): a = math.pi * i / n; pts.append(p + du * (math.cos(a) * ww / 2) + nn * off + Z * (hh - ww / 2 + math.sin(a) * ww / 2))
            pts.append(p + du * (-ww / 2) + nn * off + Z * (hh - ww / 2)); return pts
        self.poly(shape(w + 0.9, h + 0.5, proud), 'ashlar', sh(tint, 1.12), nn)
        self.poly(shape(w, h, proud + 0.06), 'glow' if glow else 'plain', (1, 1, 1) if glow else (0.03, 0.03, 0.035), nn)
        self.box(p + nn * (proud + 0.1) - Z * 0.2, (0.5, w + 1.3, 0.4), 'ashlar', sh(tint, 1.1), ang)
    def gable_roof(self, c, w, d, z, rise, rz, tint, wall_tint, ov=0.8):
        R = Matrix.Translation((c[0], c[1], 0)) @ Matrix.Rotation(rz, 4, 'Z'); P = lambda x, y, zz: tuple(R @ Vector((x, y, zz)))
        hw, hd = w / 2 + ov, d / 2 + ov; zr = z + rise
        self.poly([P(-hw, -hd, z - 0.3), P(hw, -hd, z - 0.3), P(hw, 0, zr), P(-hw, 0, zr)], 'roof', tint, Z); self.poly([P(hw, hd, z - 0.3), P(-hw, hd, z - 0.3), P(-hw, 0, zr), P(hw, 0, zr)], 'roof', tint, Z)
        for sx in (-1, 1): self.poly([P(sx * w / 2, -d / 2, z), P(sx * w / 2, d / 2, z), P(sx * w / 2, 0, zr - 0.4)], 'ashlar', wall_tint, tuple(R.to_3x3() @ Vector((sx, 0, 0))))
        self.box(P(0, 0, zr + 0.1), (w + ov * 2, 0.7, 0.5), 'roof', sh(tint, 0.85), rz)
    def hall(self, c, w, d, h, rz, tint, roof, rise=None, buttress=True, win_h=None, storeys=1):
        self.box((c[0], c[1], (h - 22) / 2), (w, d, h + 22), 'ashlar', tint, rz)
        self.box((c[0], c[1], h + 0.3), (w + 0.8, d + 0.8, 0.7), 'ashlar', sh(tint, 1.08), rz)
        self.gable_roof(c, w, d, h + 0.6, rise or d * 0.42, rz, roof, tint)
        R = Matrix.Translation((c[0], c[1], 0)) @ Matrix.Rotation(rz, 4, 'Z'); n = max(2, int(w / 8.5))
        for sd in (-1, 1):
            for i in range(n):
                x = ((i + 0.5) / n - 0.5) * w; ang = rz + sd * math.pi / 2
                wh = win_h or h * 0.55
                for s in range(storeys):
                    self.arch_win(tuple(R @ Vector((x, sd * d / 2, h * 0.16 + s * (h * 0.8 / storeys)))), ang, min(3.0, w / n * 0.36), wh / storeys, tint)
                if buttress:
                    for xx in (x - w / n / 2,) + ((x + w / n / 2,) if i == n - 1 else ()):
                        p = R @ Vector((xx, sd * (d / 2 + 1.3), 0)); self.box((p.x, p.y, (h - 22) / 2), (1.8, 3.0, h + 22), 'ashlar', sh(tint, 1.05), rz, top=0.6)
                        self.cone((p.x, p.y, h), 1.0, 6.5, 'ashlar', sh(tint, 1.1), 4, rot=rz + math.pi / 4)
    def to_object(self, name):
        bm = self.bm
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
        # break long edges so the per-vertex ambient occlusion has something to hold on to
        for _ in range(3):
            es = [e for e in bm.edges if e.calc_length() > 7.5]
            if not es: break
            bmesh.ops.subdivide_edges(bm, edges=es, cuts=1, use_grid_fill=True)
        bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
        bm.normal_update()
        for f in bm.faces:        # box-projected UVs at the game's masonry scale; roofs run down the slope
            n = f.normal
            if MATN[f.material_index] == 'roof':
                s = Z - n * n.z; s = s.normalized() if s.length > 1e-4 else Vector((0, 1, 0)); e = s.cross(n)
                for l in f.loops: l[self.uv].uv = (l.vert.co.dot(e) * UVS * 1.6, l.vert.co.dot(s) * UVS * 1.6)
            else:
                ax = max(range(3), key=lambda i: abs(n[i]))
                for l in f.loops:
                    co = l.vert.co; l[self.uv].uv = ((co.y if ax == 0 else co.x) * UVS, (co.y if ax == 2 else co.z) * UVS)
        me = bpy.data.meshes.new(name); bm.to_mesh(me)
        tints = [tuple(f[self.col]) for f in bm.faces]; bm.free()
        o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o)
        for mn in MATN: me.materials.append(bpy.data.materials.get(mn) or bpy.data.materials.new(mn))
        return o, tints

def sh(c, f): return (c[0] * f, c[1] * f, c[2] * f)

def finish(m, name):
    o, tints = m.to_object(name); me = o.data
    ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER'); me.color_attributes.active_color = ca; me.color_attributes.render_color_index = 0
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
    n = len(me.loops); a = np.empty(n * 4, dtype=np.float32); ca.data.foreach_get('color', a); a = a.reshape(n, 4)
    ao = 0.38 + 0.62 * np.clip(a[:, :1] * 1.15, 0, 1)
    tl = np.empty((n, 3), dtype=np.float32)
    for p in me.polygons:
        tl[p.loop_start:p.loop_start + p.loop_total] = tints[p.index]
    glow = np.array([MATN[p.material_index] == 'glow' for p in me.polygons for _ in range(p.loop_total)])
    a[:, :3] = tl * np.where(glow[:, None], 1.0, ao); a[:, 3] = 1
    ca.data.foreach_set('color', a.ravel())
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, name + '.glb'), export_format='GLB', use_selection=True, export_materials='EXPORT', export_yup=True, export_apply=True, export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_active_vertex_color_when_no_material=True)
    print('EXPORTED', name, len(me.polygons), 'faces', flush=True)
    o.hide_render = True; o.hide_set(True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene; scene.render.engine = 'CYCLES'; scene.cycles.samples = 24; scene.cycles.device = 'CPU'
scene.world = bpy.data.worlds.new('w'); scene.world.light_settings.distance = 14.0

# ====================================================================== the Red Keep
# Modelled on the show's Red Keep (and the user's reference photos): salmon-red brick with pale stone trim, slate roofs
# on only a few towers. Maegor's Holdfast is the sheer, tallest mass, crowned by a cluster of square towers; the Great
# Hall is Gothic (steep slate roof, a pinnacle on every buttress, tall pointed windows, a many-sided apse); one slender
# octagonal tower carries an open gilded lantern; the curtain is studded with octagonal towers; the wards are gardens
# of lawns, hedged parterres and cypresses. +X east (the sea), -X west (the city and the gate).
RK_RED = (0.98, 0.45, 0.34); RK_TRIM = (0.86, 0.8, 0.7); RK_SLATE = (0.15, 0.17, 0.21); RK_GOLD = (0.78, 0.58, 0.2)
RK_LAWN = (0.12, 0.22, 0.06); RK_HEDGE = (0.05, 0.11, 0.035); RK_CYPRESS = (0.04, 0.085, 0.032); RK_PATH = (0.6, 0.55, 0.46)

def _frame(c, rz):
    R = Matrix.Translation((c[0], c[1], 0)) @ Matrix.Rotation(rz, 4, 'Z')
    return R, (lambda x, y, z: tuple(R @ Vector((x, y, z))))

def lancet(self, p, ang, w, h, tint, glow=True, n=6):
    # a tall pointed (equilateral) window in a pale stone frame, with a mullion and a transom
    du = Vector((-math.sin(ang), math.cos(ang), 0)); nn = Vector((math.cos(ang), math.sin(ang), 0)); p = Vector(p)
    def shape(ww, hh, off):
        zs = hh - ww * 0.866; q = p + nn * off
        pts = [q + du * (-ww / 2), q + du * (ww / 2), q + du * (ww / 2) + Z * zs]
        for i in range(1, n + 1): a = (math.pi / 3) * i / n; pts.append(q + du * (-ww / 2 + math.cos(a) * ww) + Z * (zs + math.sin(a) * ww))
        for i in range(1, n + 1): a = 2 * math.pi / 3 + (math.pi / 3) * i / n; pts.append(q + du * (ww / 2 + math.cos(a) * ww) + Z * (zs + math.sin(a) * ww))
        return pts
    self.poly(shape(w + 0.8, h + 0.6, 0.1), 'ashlar', RK_TRIM, nn)
    self.poly(shape(w, h, 0.18), 'glow' if glow else 'plain', (1, 1, 1) if glow else (0.03, 0.03, 0.035), nn)
    self.box(p + nn * 0.3 + Z * (h * 0.42), (0.16, 0.18, h * 0.84), 'ashlar', RK_TRIM, ang)
    self.box(p + nn * 0.3 + Z * (h * 0.55), (0.16, w, 0.18), 'ashlar', RK_TRIM, ang)
    self.box(p + nn * 0.25 - Z * 0.25, (0.6, w + 1.2, 0.45), 'ashlar', RK_TRIM, ang)
M.lancet = lancet

def pinnacle(self, c, z, s, h, tint):
    # a buttress pinnacle: square shaft, a ring of tiny spirelets, then a tall spire
    self.box((c[0], c[1], z + h * 0.25), (s, s, h * 0.5), 'ashlar', tint, math.pi / 4)
    self.box((c[0], c[1], z + h * 0.5 + 0.15), (s * 1.25, s * 1.25, 0.3), 'ashlar', RK_TRIM, math.pi / 4)
    for k in range(4):
        a = k * math.pi / 2; self.cone((c[0] + math.cos(a) * s * 0.55, c[1] + math.sin(a) * s * 0.55, z + h * 0.5 + 0.3), s * 0.2, h * 0.16, 'ashlar', RK_TRIM, 4)
    self.cone((c[0], c[1], z + h * 0.5 + 0.3), s * 0.55, h * 0.5, 'ashlar', sh(tint, 1.05), 4)
M.pinnacle = pinnacle

def sq_head(self, c, w, d, z, rz, tint):
    # machicolated, crenellated head for a square tower or block: corbels, a parapet carried out on them, merlons
    R, P = _frame(c, rz)
    for sd, L, ax in ((1, w, 'x'), (-1, w, 'x'), (1, d, 'y'), (-1, d, 'y')):
        n = max(2, int(L / 1.5))
        for i in range(n):
            t = ((i + 0.5) / n - 0.5) * L
            x, y = (t, sd * (d / 2 + 0.35)) if ax == 'x' else (sd * (w / 2 + 0.35), t)
            self.box(P(x, y, z - 0.9), (0.7 if ax == 'x' else 0.9, 0.9 if ax == 'x' else 0.7, 1.8), 'ashlar', sh(tint, 0.88), rz, top=1.4)
        x, y = (0, sd * (d / 2 + 0.8)) if ax == 'x' else (sd * (w / 2 + 0.8), 0)
        self.box(P(x, y, z + 0.9), (L + 2.4 if ax == 'x' else 0.8, 0.8 if ax == 'x' else L + 2.4, 1.8), 'ashlar', tint, rz)
        self.box(P(x, y, z + 0.02), (L + 2.5 if ax == 'x' else 1.0, 1.0 if ax == 'x' else L + 2.5, 0.3), 'ashlar', RK_TRIM, rz)
        m = max(2, int((L + 2.4) / 2.2))
        for i in range(m):
            if i % 2: continue
            t = ((i + 0.5) / m - 0.5) * (L + 2.4)
            x, y = (t, sd * (d / 2 + 0.8)) if ax == 'x' else (sd * (w / 2 + 0.8), t)
            self.box(P(x, y, z + 2.45), (1.1 if ax == 'x' else 0.8, 0.8 if ax == 'x' else 1.1, 1.3), 'ashlar', tint, rz)
    self.box(P(0, 0, z + 0.4), (w + 1.2, d + 1.2, 0.5), 'plain', (0.32, 0.29, 0.26), rz)          # the leads
M.sq_head = sq_head

def sq_tower(self, c, w, d, z0, h, rz, tint, roof=False, win=True):
    R, P = _frame(c, rz)
    self.box(P(0, 0, (h + z0) / 2), (w, d, h - z0), 'ashlar', tint, rz)
    for zb in range(int(max(z0, 0)) + 14, int(h) - 3, 14): self.box(P(0, 0, zb), (w + 0.5, d + 0.5, 0.45), 'ashlar', RK_TRIM, rz)
    if win:
        for ang, L, off in ((0, d, w / 2), (math.pi, d, w / 2), (math.pi / 2, w, d / 2), (-math.pi / 2, w, d / 2)):
            a = rz + ang; nn = Vector((math.cos(a), math.sin(a), 0)); du = Vector((-nn.y, nn.x, 0)); nw = max(1, int(L / 4.5))
            for zz in range(int(max(z0, 0)) + 6, int(h) - 6, 10):
                for i in range(nw):
                    if self.rnd.random() < 0.25: continue
                    p = Vector((c[0], c[1], zz)) + nn * (off + 0.02) + du * ((i + 0.5) / nw - 0.5) * L * 0.7
                    self.arch_win(tuple(p), a, 1.2, 3.0, tint, glow=self.rnd.random() < 0.5)
    if roof:
        hw, hd = w / 2 + 0.6, d / 2 + 0.6; ap = P(0, 0, h + max(w, d) * 0.9)
        q = [P(-hw, -hd, h), P(hw, -hd, h), P(hw, hd, h), P(-hw, hd, h)]
        self.box(P(0, 0, h - 0.4), (w + 0.9, d + 0.9, 0.8), 'ashlar', RK_TRIM, rz)
        for i in range(4): self.poly([q[i], q[(i + 1) % 4], ap], 'roof', RK_SLATE, (q[i][0] + q[(i + 1) % 4][0] - 2 * c[0], q[i][1] + q[(i + 1) % 4][1] - 2 * c[1], 0.6))
        self.box((ap[0], ap[1], ap[2] + 1.4), (0.14, 0.14, 2.8), 'plain', (0.2, 0.2, 0.22))
        return ap[2]
    self.sq_head(c, w, d, h, rz, tint)
    return h + 3.1
M.sq_tower = sq_tower

def oct_tower(self, c, r, h, tint, roof=False, z0=-22.0):
    if z0 > 0:          # rising from a roof: a plain shaft, banded, slate-capped
        self.drum((c[0], c[1], z0), r, h - z0, 'ashlar', tint, 8)
        for t in range(int(z0) + 10, int(h) - 2, 10): self.drum((c[0], c[1], t), r + 0.25, 0.45, 'ashlar', RK_TRIM, 8)
        self.drum((c[0], c[1], h), r * 1.1, 0.8, 'ashlar', RK_TRIM, 8); self.cone((c[0], c[1], h + 0.8), r * 1.16, r * 1.9, 'roof', RK_SLATE, 8)
        self.box((c[0], c[1], h + 0.8 + r * 1.9 + 1.3), (0.14, 0.14, 2.6), 'plain', (0.2, 0.2, 0.22)); return h + r * 1.9
    return self.tower(c, r, h, tint, 'cone' if roof else 'crown', seg=8, taper=0.97, roof=RK_SLATE, z0=z0, cone_h=r * 1.9)
M.oct_tower = oct_tower

def gothic_hall(self, c, w, d, h, rz, tint):
    # the throne room: buttressed nave under a steep slate roof, a pinnacle on every buttress, lancets between them,
    # a five-sided apse at the -x end, a rose window in the +x gable
    R, P = _frame(c, rz); rise = d * 0.68; bays = max(3, int(w / 8))
    self.box(P(0, 0, (h - 22) / 2), (w, d, h + 22), 'ashlar', tint, rz)
    self.box(P(0, 0, h + 0.3), (w + 1.0, d + 1.0, 0.6), 'ashlar', RK_TRIM, rz)
    self.gable_roof(c, w, d, h + 0.6, rise, rz, RK_SLATE, tint, ov=0.6)
    for sd in (-1, 1):
        ang = rz + sd * math.pi / 2
        for i in range(bays + 1):
            x = (i / bays - 0.5) * w
            self.box(P(x, sd * (d / 2 + 1.4), (h + 1.5 - 22) / 2), (2.2, 2.8, h + 1.5 + 22), 'ashlar', sh(tint, 1.04), rz, top=0.7)
            self.pinnacle(P(x, sd * (d / 2 + 1.4), 0), h + 1.5, 1.6, 22, tint)
            if i < bays:
                xm = x + w / bays / 2
                self.lancet(P(xm, sd * (d / 2), 6), ang, min(4.2, w / bays * 0.5), h * 0.62, tint, glow=self.rnd.random() < 0.8)
                self.box(P(xm, sd * (d / 2 + 0.45), h + 1.4), (w / bays * 0.8, 0.5, 1.6), 'ashlar', tint, rz)              # pierced parapet
    # the apse
    Ra = d / 2; ax = -w / 2; pts = [P(ax + math.cos(a) * Ra, math.sin(a) * Ra, 0) for a in [math.pi / 2 + k * math.pi / 4 for k in range(5)]]
    ctr = Vector(P(ax, 0, 0))
    for k in range(4):
        a0, a1 = Vector(pts[k]), Vector(pts[k + 1]); mid = (a0 + a1) / 2; L = (a1 - a0).length; ea = math.atan2(a1.y - a0.y, a1.x - a0.x)
        out = (mid - ctr); out.z = 0; out.normalize(); oa = math.atan2(out.y, out.x)
        self.box((mid.x, mid.y, (h - 22) / 2), (L + 0.6, 2.0, h + 22), 'ashlar', tint, ea)
        self.lancet(tuple(mid + out * 1.0 + Z * 6), oa, min(3.6, L * 0.45), h * 0.62, tint)
    for k in range(5):
        v = Vector(pts[k]); out = v - ctr; out.z = 0; out.normalize()
        if k in (0, 4): continue
        q = v + out * 1.6; self.box((q.x, q.y, (h + 1.5 - 22) / 2), (2.2, 2.6, h + 1.5 + 22), 'ashlar', sh(tint, 1.04), math.atan2(out.y, out.x), top=0.7)
        self.pinnacle((q.x, q.y), h + 1.5, 1.6, 22, tint)
    ap = Vector(P(ax, 0, h + 0.6 + rise))
    eave = [Vector(P(ax + math.cos(a) * (Ra + 0.6), math.sin(a) * (Ra + 0.6), h + 0.3)) for a in [math.pi / 2 + k * math.pi / 4 for k in range(5)]]
    for k in range(4): self.poly([tuple(eave[k]), tuple(eave[k + 1]), tuple(ap)], 'roof', RK_SLATE, tuple((eave[k] + eave[k + 1]) / 2 - ctr))
    # rose window in the east gable
    nn = Vector(R.to_3x3() @ Vector((1, 0, 0))); du = Vector(R.to_3x3() @ Vector((0, 1, 0))); pc = Vector(P(w / 2, 0, h + rise * 0.38)); rr = d * 0.17
    self.poly([tuple(pc + nn * 0.1 + du * math.cos(t / 20 * TAU) * (rr + 0.6) + Z * math.sin(t / 20 * TAU) * (rr + 0.6)) for t in range(20)], 'ashlar', RK_TRIM, tuple(nn))
    self.poly([tuple(pc + nn * 0.16 + du * math.cos(t / 20 * TAU) * rr + Z * math.sin(t / 20 * TAU) * rr) for t in range(20)], 'glow', (1, 1, 1), tuple(nn))
    for k in range(4): self.box(tuple(pc + nn * 0.22), (0.12, rr * 2, 0.16), 'ashlar', RK_TRIM, rz, rx=k * math.pi / 4)
    for sx in (-1, 1): self.pinnacle(P(w / 2 + 0.3, sx * (d / 2 + 0.3), 0), h + 0.6, 1.8, 20, tint)
M.gothic_hall = gothic_hall

def cypress(self, x, y, s=1.0, z=0.0):
    self.drum((x, y, z), 0.22 * s, 1.2 * s, 'plain', (0.12, 0.08, 0.05), 6)
    self.drum((x, y, z + 1.0 * s), 0.9 * s, 2.6 * s, 'plain', RK_CYPRESS, 8, r2=1.2 * s)
    self.cone((x, y, z + 3.6 * s), 1.2 * s, 7.5 * s, 'plain', sh(RK_CYPRESS, 1.1), 8)
M.cypress = cypress

def parterre(self, x0, y0, x1, y1, z=0.05):
    # a lawn edged with a clipped hedge, split by a cross of paths with a basin at the middle
    cx, cy, w, d = (x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0
    for qx in (-1, 1):
        for qy in (-1, 1):
            ax, ay = cx + qx * w / 4, cy + qy * d / 4; hw, hd = w / 4 - 1.2, d / 4 - 1.2
            self.poly([(ax - hw, ay - hd, z), (ax + hw, ay - hd, z), (ax + hw, ay + hd, z), (ax - hw, ay + hd, z)], 'plain', RK_LAWN, (0, 0, 1))
            for sx, sy, L, horiz in ((0, -1, 2 * hw, True), (0, 1, 2 * hw, True), (-1, 0, 2 * hd, False), (1, 0, 2 * hd, False)):
                self.box((ax + sx * hw, ay + sy * hd, 0.45), (L if horiz else 0.8, 0.8 if horiz else L, 0.9), 'plain', RK_HEDGE)
    self.drum((cx, cy, 0), 2.4, 0.8, 'ashlar', RK_TRIM, 16); self.drum((cx, cy, 0.8), 2.0, 0.05, 'plain', (0.1, 0.16, 0.2), 16); self.drum((cx, cy, 0.8), 0.35, 2.2, 'ashlar', RK_TRIM, 8)
M.parterre = parterre

def red_keep():
    m = M(11); red = RK_RED; lite = sh(red, 1.08); dark = sh(red, 0.9); rnd = m.rnd
    # ---- the curtain: a ring of octagonal towers on the hill's rim, the gate facing the city (west)
    N = 13; ring = []
    for i in range(N):
        a = math.pi + (i + 0.5) * TAU / N; rr = 82 * (1 + (rnd.random() - 0.5) * 0.08); ring.append((math.cos(a) * rr, math.sin(a) * rr))
    for i in range(N):
        a, b = ring[i], ring[(i + 1) % N]
        if i == N - 1:      # the gatehouse, between the last tower and the first: a pair of slate-roofed octagons
            mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2; dx, dy = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dy); ux, uy = dx / L, dy / L; ang = math.atan2(dy, dx)
            m.wall(a, (mx - ux * 9, my - uy * 9), 12, 4.5, red); m.wall((mx + ux * 9, my + uy * 9), b, 12, 4.5, red)
            m.box((mx, my, 0), (14, 11, 44), 'ashlar', lite, ang); m.box((mx, my, 4.4), (6.5, 11.4, 8.8), 'plain', (0.07, 0.05, 0.04), ang)
            m.sq_head((mx, my), 14, 11, 22, ang, lite)
            gn = Vector((-uy, ux, 0)); gn = gn if gn.x < 0 else -gn
            m.lancet((mx + gn.x * 5.6, my + gn.y * 5.6, 12), math.atan2(gn.y, gn.x), 2.4, 7, lite, glow=False)
            for sd in (-1, 1): m.oct_tower((mx + ux * sd * 10, my + uy * sd * 10), 5.6, 27, lite, roof=True)
        else: m.wall(a, b, 12, 4.5, red if i % 2 else dark)
        m.oct_tower(a, 5.0 + rnd.random() * 1.4, 17 + rnd.random() * 6, lite if i % 3 == 0 else red, roof=(i in (3, 8)))
    # ---- Maegor's Holdfast: sheer, the tallest mass, a cluster of square towers on its crown
    hc = (30, 16); hw, hd = 44, 36
    m.box((hc[0], hc[1], (72 - 22) / 2), (hw, hd, 72 + 22), 'ashlar', red, 0.0)
    for zb in (24, 48): m.box((hc[0], hc[1], zb), (hw + 0.6, hd + 0.6, 0.5), 'ashlar', RK_TRIM, 0.0)
    for ang, L, off in ((0, hd, hw / 2), (math.pi, hd, hw / 2), (math.pi / 2, hw, hd / 2), (-math.pi / 2, hw, hd / 2)):
        nn = Vector((math.cos(ang), math.sin(ang), 0)); du = Vector((-nn.y, nn.x, 0)); np_ = int(L / 7.5)
        for k in range(np_ + 1):          # pilasters, full height
            p = Vector((hc[0], hc[1], 0)) + nn * (off + 0.5) + du * ((k / np_) - 0.5) * L * 0.96
            m.box((p.x, p.y, 25), (1.2 if abs(nn.x) > 0.5 else 1.8, 1.8 if abs(nn.x) > 0.5 else 1.2, 94), 'ashlar', lite, 0.0, top=1.0)
        for zz in (8, 16, 28, 36, 44, 53, 61):
            for k in range(np_):
                if rnd.random() < 0.12: continue
                p = Vector((hc[0], hc[1], 0)) + nn * (off + 0.02) + du * (((k + 0.5) / np_) - 0.5) * L * 0.96
                for s2 in (-1, 1): m.arch_win(tuple(p + du * s2 * 1.0 + Z * zz), ang, 1.1, 3.2, red, glow=rnd.random() < 0.55)
        for k in (-1, 1):          # two turrets clasped to each face, rising past the parapet
            p = Vector((hc[0], hc[1], 0)) + nn * (off + 1.6) + du * k * L * 0.3
            m.sq_tower((p.x, p.y), 4.0 if abs(nn.x) > 0.5 else 3.2, 3.2 if abs(nn.x) > 0.5 else 4.0, -22, 82, 0.0, lite, win=False)
    m.sq_head(hc, hw, hd, 72, 0.0, red)
    m.box((hc[0], hc[1], 83), (24, 20, 22), 'ashlar', red, 0.0); m.sq_head(hc, 24, 20, 94, 0.0, red)
    m.sq_tower((hc[0] - 15, hc[1] - 12), 10, 10, 72, 116, 0.0, lite)
    m.sq_tower((hc[0] + 16, hc[1] + 12), 11, 10, 72, 124, 0.0, red)
    m.sq_tower((hc[0] + 16, hc[1] - 12), 8, 8, 72, 106, 0.0, lite, roof=True)
    m.oct_tower((hc[0] - 15, hc[1] + 12), 4.6, 112, lite, roof=True, z0=72)
    # ---- the Great Hall
    m.gothic_hall((-14, -33), 64, 26, 40, 0.0, red)
    # ---- the gilded tower: slender, octagonal, an open lantern with a gold cupola
    gt = (-42, 34); gr = 5.2; gh = 112
    m.tower(gt, gr, gh, lite, 'crown', seg=8, taper=0.94, bands=True)
    for t in (24, 44, 64, 84, 100): m.drum((gt[0], gt[1], t), gr * (1 - 0.06 * t / gh) + 0.3, 0.6, 'ashlar', RK_TRIM, 8)
    lz = gh + 1.6; lr = gr * 0.62
    for k in range(8):
        a = k / 8 * TAU + math.pi / 8; m.box((gt[0] + math.cos(a) * lr, gt[1] + math.sin(a) * lr, lz + 3.5), (0.7, 0.7, 7.0), 'ashlar', RK_TRIM, a)
    m.drum((gt[0], gt[1], lz), lr * 0.8, 7.0, 'glow', (1, 1, 1), 8)
    m.drum((gt[0], gt[1], lz + 7.0), lr + 0.5, 0.8, 'ashlar', RK_TRIM, 8)
    m.dome((gt[0], gt[1], lz + 7.8), lr + 0.3, 'gold', RK_GOLD, 16, 5, 1.25)
    m.cone((gt[0], gt[1], lz + 7.8 + (lr + 0.3) * 1.2), 0.5, 4.5, 'gold', RK_GOLD, 8)
    # ---- the Tower of the Hand, the White Sword Tower, and lesser halls
    m.oct_tower((-6, 50), 6.5, 76, lite, roof=True)
    m.oct_tower((54, -40), 6.0, 64, red, roof=True)
    m.oct_tower((-48, -6), 5.0, 44, red)
    m.hall((-30, 12), 22, 11, 14, 0.0, dark, RK_SLATE, buttress=False, win_h=6)
    m.hall((34, -24), 20, 10, 12, 0.0, red, RK_SLATE, buttress=False, win_h=5)
    m.hall((8, 64), 18, 9, 11, 0.4, dark, RK_SLATE, buttress=False, win_h=5)
    # ---- the yards and gardens
    m.drum((0, 0, -1.2), 80, 1.2, 'plain', RK_PATH, 26, smooth=False)
    m.parterre(-74, -14, -50, 8)
    m.parterre(18, -64, 46, -48)
    m.parterre(-30, 20, -14, 30)
    for i in range(9): m.cypress(-46 + i * 6.2, -50, 0.9 + rnd.random() * 0.25)          # along the hall's south walk
    for i in range(5): m.cypress(-76 + i * 6.5, 14, 0.85 + rnd.random() * 0.3)
    for i in range(4): m.cypress(-76 + i * 7, -20, 0.85 + rnd.random() * 0.3)
    for i in range(6): m.cypress(14 + i * 6.5, -44, 0.9 + rnd.random() * 0.2)
    for x, y in ((-20, 40), (-30, 42), (62, 2), (64, -12), (40, 52), (24, 58), (-56, 30), (-60, 22)): m.cypress(x, y, 0.9 + rnd.random() * 0.3)
    for x, y, s in ((0, -56, 1.0), (-58, 40, 0.8)):       # a spreading tree or two
        m.drum((x, y, 0), 0.5 * s, 4 * s, 'plain', (0.14, 0.1, 0.07), 8)
        for dx, dy, dz, rr in ((0, 0, 5, 3.6), (2.2, 1, 4.4, 2.6), (-2, -1.2, 4.6, 2.8)): m.dome((x + dx * s, y + dy * s, dz * s), rr * s, 'plain', sh(RK_HEDGE, 1.4), 10, 4, 0.8)
    finish(m, 'redkeep')

# ====================================================================== the Great Sept of Baelor
def great_sept():
    m = M(21); st = (0.9, 0.78, 0.58); lite = sh(st, 1.1); lead = (0.30, 0.29, 0.27); gold = (0.72, 0.56, 0.22)
    for i, (r, z, h) in enumerate(((90, -22, 22), (84, 0, 1.5), (78, 1.5, 1.5), (72, 3.0, 1.5))): m.drum((0, 0, z), r, h, 'ashlar', sh(st, 0.92 + i * 0.04), 42, smooth=False)
    y0 = 4.5
    # lower hall: fourteen-sided, pilastered, two tiers of windows
    m.drum((0, 0, y0), 46, 30, 'ashlar', st, 14, smooth=False, rot=0); m.drum((0, 0, y0 + 30), 47.6, 1.8, 'ashlar', lite, 14, smooth=False, rot=0)
    m.drum((0, 0, y0 + 31.8), 43, 5.5, 'ashlar', st, 14, smooth=False, rot=0); m.drum((0, 0, y0 + 37.3), 44, 1.0, 'ashlar', lite, 14, smooth=False, rot=0)
    ap = 46 * math.cos(math.pi / 14)
    for i in range(14):
        a = (i + 0.5) / 14 * TAU; c, s = math.cos(a), math.sin(a)
        if i % 2 == 1:
            for lvl, (z, h, w) in enumerate(((3, 12, 3.4), (18, 9, 3.0))):
                for k in (-1, 0, 1): m.arch_win((c * (ap + 0.02) - s * k * 5.4, s * (ap + 0.02) + c * k * 5.4, y0 + z), a, w, h, st)
        va = i / 14 * TAU; m.box((math.cos(va) * 46.2, math.sin(va) * 46.2, y0 + 15), (2.4, 3.4, 30), 'ashlar', lite, va)           # corner pilasters
    # low roof, drum, dome, lantern
    for j in range(14):
        a0, a1 = j / 14 * TAU, (j + 1) / 14 * TAU
        m.poly([(math.cos(a0) * 44.4, math.sin(a0) * 44.4, y0 + 38.2), (math.cos(a1) * 44.4, math.sin(a1) * 44.4, y0 + 38.2), (math.cos(a1) * 29, math.sin(a1) * 29, y0 + 45), (math.cos(a0) * 29, math.sin(a0) * 29, y0 + 45)], 'roof', lead, Z)
    zd = y0 + 44
    m.drum((0, 0, zd), 29, 19, 'ashlar', st, 28); m.drum((0, 0, zd + 19), 30.4, 1.8, 'ashlar', lite, 28); m.drum((0, 0, zd + 3), 29.6, 0.8, 'ashlar', lite, 28)
    for i in range(14):
        a = i / 14 * TAU; m.arch_win((math.cos(a) * 28.9, math.sin(a) * 28.9, zd + 5), a, 3.0, 11.5, st)
        b = a + TAU / 28; m.box((math.cos(b) * 29.5, math.sin(b) * 29.5, zd + 9.5), (1.6, 2.0, 19), 'ashlar', lite, b); m.cone((math.cos(b) * 30.2, math.sin(b) * 30.2, zd + 20.8), 0.9, 4.5, 'ashlar', lite, 4, rot=b)
    zt = zd + 20.8; Rd = 28.6; sq = 0.92
    m.dome((0, 0, zt), Rd, 'roof', lead, 28, 10, sq)
    for i in range(14):                                                                                                           # ribs
        a = i / 14 * TAU
        for k in range(9):
            p = (k + 0.5) / 9 * math.pi / 2 * 0.94; rr = Rd + 0.25
            m.box((math.cos(a) * math.cos(p) * rr, math.sin(a) * math.cos(p) * rr, zt + math.sin(p) * rr * sq), (0.7, 1.1, Rd * math.pi / 2 / 9 * 1.08), 'roof', sh(lead, 1.25), a, ry=-math.atan2(math.sin(p), sq * math.cos(p)))
    zl = zt + Rd * sq - 0.6
    m.drum((0, 0, zl), 4.6, 8, 'ashlar', lite, 14); m.drum((0, 0, zl + 8), 5.2, 0.8, 'ashlar', lite, 14)
    for i in range(7): a = i / 7 * TAU; m.arch_win((math.cos(a) * 4.58, math.sin(a) * 4.58, zl + 1.2), a, 1.3, 5.6, lite)
    m.dome((0, 0, zl + 8.8), 4.7, 'roof', gold, 14, 5, 1.1); m.cone((0, 0, zl + 13.6), 0.7, 11, 'plain', gold, 7)
    for i in range(7): a = i / 7 * TAU; m.box((math.cos(a) * 1.6, math.sin(a) * 1.6, zl + 22), (2.6, 0.25, 0.25), 'plain', gold, a)   # seven-pointed star
    # seven porches with pediments, and between them the seven towers
    for i in range(7):
        a = (i + 0.5) / 7 * TAU + TAU / 28; c, s = math.cos(a), math.sin(a)
        m.box((c * 50, s * 50, y0 + 12), (12, 24, 24), 'ashlar', st, a); m.box((c * 50, s * 50, y0 + 24.4), (12.8, 25, 0.9), 'ashlar', lite, a)
        m.gable_roof((c * 50, s * 50), 24, 12, y0 + 24.8, 5.5, a + math.pi / 2, lead, lite)
        m.arch_win((c * 56.02, s * 56.02, y0 + 0.4), a, 7.5, 17, st)
        for k in (-1, 1): m.drum((c * 56.6 - s * k * 9.5, s * 56.6 + c * k * 9.5, y0), 1.25, 22, 'ashlar', lite, 10); m.box((c * 56.6 - s * k * 9.5, s * 56.6 + c * k * 9.5, y0 + 22.6), (3.2, 3.2, 1.2), 'ashlar', lite, a)
        for st_i in range(6): m.box((c * (58.5 + st_i * 1.3), s * (58.5 + st_i * 1.3), y0 - 0.3 - st_i * 0.5), (1.4, 22, 0.6), 'ashlar', sh(st, 1.04), a)
        b = a + TAU / 14; tx, ty = math.cos(b) * 62, math.sin(b) * 62
        m.drum((tx, ty, 3.0), 7.4, 9, 'ashlar', st, 8, smooth=False)                                                             # tower plinth
        m.drum((tx, ty, 12), 6.3, 54, 'ashlar', st, 8, r2=5.6, smooth=False)
        for z in (12, 26, 40, 54): m.drum((tx, ty, z), 6.9 - (z - 12) * 0.013, 1.0, 'ashlar', lite, 8, smooth=False)
        for lvl in range(4):
            for q in range(4): aa = b + q * math.pi / 2 + math.pi / 8 * 0; m.arch_win((tx + math.cos(aa) * (6.25 - lvl * 0.16) * math.cos(math.pi / 8), ty + math.sin(aa) * (6.25 - lvl * 0.16) * math.cos(math.pi / 8), 15 + lvl * 13.4), aa, 1.2, 6, st, glow=lvl % 2 == 0)
        zb = 66
        m.drum((tx, ty, zb), 6.4, 1.2, 'ashlar', lite, 8, smooth=False)
        for q in range(8): aa = b + (q + 0.5) * math.pi / 4; m.drum((tx + math.cos(aa) * 4.9, ty + math.sin(aa) * 4.9, zb + 1.2), 0.62, 7.2, 'ashlar', lite, 8)
        m.drum((tx, ty, zb + 1.2), 3.2, 7.2, 'plain', (0.05, 0.05, 0.05), 8); m.drum((tx, ty, zb + 8.4), 6.2, 1.5, 'ashlar', lite, 8, smooth=False)
        m.dome((tx, ty, zb + 9.9), 5.4, 'roof', lead, 16, 6, 1.08); m.drum((tx, ty, zb + 15.4), 0.9, 1.6, 'plain', gold, 8); m.cone((tx, ty, zb + 17), 0.8, 8, 'plain', gold, 7)
    # the grand stair (toward +X), flanked by plinths
    for i in range(16): m.box((91 + i * 1.5, 0, -0.4 - i * 0.62), (1.7, 46 + i * 1.0, 1.0 + i * 1.3), 'ashlar', sh(st, 1.0 + (i % 2) * 0.05))
    for sd in (-1, 1): m.box((92, sd * 27, 3), (9, 6, 9), 'ashlar', lite); m.drum((92, sd * 27, 7.5), 1.6, 7, 'ashlar', lite, 10); m.dome((92, sd * 27, 14.5), 1.9, 'plain', gold, 10, 4)
    finish(m, 'sept')

# ====================================================================== the Dragonpit
def dragonpit():
    m = M(31); soot = (0.2, 0.18, 0.16); rnd = m.rnd; R = 86; NP = 30
    m.drum((0, 0, -22), R + 13, 22, 'ashlar', sh(soot, 1.25), 40, smooth=False); m.drum((0, 0, 0), R + 9, 1.4, 'ashlar', sh(soot, 1.4), 40, smooth=False)
    m.drum((0, 0, 0.2), R - 14, 1.3, 'plain', (0.23, 0.2, 0.17), 30, smooth=False)                                                  # arena floor
    hs = []
    for i in range(NP):
        ruin = 0.12 if i in (5, 6, 7) else 0.42 if i in (4, 8, 19, 20) else 1.0
        hs.append((30 + rnd.random() * 8) * ruin + (0 if ruin == 1 else rnd.random() * 5))
    for i in range(NP):
        a = i / NP * TAU; c, s = math.cos(a), math.sin(a); h = hs[i]; t = sh(soot, 0.85 + rnd.random() * 0.4)
        m.box((c * R, s * R, h / 2 - 1), (10, 5.4, h + 2), 'ashlar', t, a, top=0.86)                                               # pier
        m.box((c * (R + 5.6), s * (R + 5.6), h * 0.35), (3.4, 3.0, h * 0.7 + 2), 'ashlar', sh(t, 1.1), a, top=0.5)                 # outer buttress
        j = (i + 1) % NP; h2 = hs[j]; hm = min(h, h2)
        b = (i + 0.5) / NP * TAU; cb, sb = math.cos(b), math.sin(b); span = R * TAU / NP - 5.4
        for lvl, zs in enumerate((9.0, 21.5)):                                                                                    # two tiers of arches between piers
            if hm < zs + span * 0.5 + 2: continue
            for k in range(7):
                ph = math.pi * (k + 0.5) / 7; off = math.cos(ph) * span / 2; zz = zs + math.sin(ph) * span / 2
                m.box((cb * R - sb * off, sb * R + cb * off, zz), (8.4, span * math.pi / 2 / 7 * 1.15, 1.7), 'ashlar', sh(soot, 1.05), b, rx=(ph - math.pi / 2))
            m.box((cb * R, sb * R, zs + span / 2 + 2.6), (8.8, span + 0.4, 3.4), 'ashlar', sh(soot, 0.95 + rnd.random() * 0.2), b)
        if hm > 29: m.box((cb * R, sb * R, hm - 1.0), (9.6, span + 1, 2.0), 'ashlar', sh(soot, 1.15), b)                           # cornice
        # broken ribs of the fallen dome
        if h > 29 and i % 2 == 0:
            n = 3 + int(rnd.random() * 5)
            for k in range(n):
                ph = (k + 0.5) / 12 * math.pi / 2; rr = R - 2
                m.box((c * math.cos(ph) * rr, s * math.cos(ph) * rr, h + math.sin(ph) * rr * 0.55), (2.6 - k * 0.15, 2.2, rr * math.pi / 2 / 12 * 1.2), 'ashlar', sh(soot, 0.9), a, ry=-math.atan2(math.sin(ph), 0.55 * math.cos(ph)))
    for i in range(46):                                                                                                           # rubble and fallen blocks
        a = rnd.random() * TAU; r = rnd.random() * (R + 4); m.box((math.cos(a) * r, math.sin(a) * r, 1.2 + rnd.random()), (2 + rnd.random() * 6, 2 + rnd.random() * 4, 1.5 + rnd.random() * 3), 'ashlar', sh(soot, 0.7 + rnd.random() * 0.6), rnd.random() * TAU, rx=rnd.random() * 0.5)
    for i in range(40): a = i / 40 * TAU; m.box((math.cos(a) * (R - 11), math.sin(a) * (R - 11), 2.2), (3.0, R * TAU / 40, 2.4), 'ashlar', sh(soot, 1.1), a)   # arena wall / first tier of seats
    for i in range(40): a = i / 40 * TAU; m.box((math.cos(a) * (R - 7.4), math.sin(a) * (R - 7.4), 3.6), (3.6, R * TAU / 40, 2.0), 'ashlar', sh(soot, 1.2), a)
    finish(m, 'dragonpit')

which = sys.argv[sys.argv.index('--') + 2:] or ['redkeep', 'sept', 'dragonpit']
if 'redkeep' in which: red_keep()
if 'sept' in which: great_sept()
if 'dragonpit' in which: dragonpit()
print('DONE landmarks')
