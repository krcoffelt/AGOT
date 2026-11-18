# Dragonstone: the Targaryen island fortress, as real geometry.
#   Blender -b --factory-startup --python tools/blender/dragonstone.py -- <project dir>
# Writes public/models/dragonstone.glb. z = 0 is the levelled castle plateau (the game stands the model on the ground at
# the site centre), foundations run ~22 m below it. +X east, +Y north (the game's site-local z is -Y). The sea is to the
# west: the gate faces west and the walled causeway zig-zags down the slope to a jetty.
# Materials are named after the game's shared masonry / roof materials (ashlar, roof, plain, glow); stone colour and baked
# ambient occlusion travel in the vertex colours, UVs are box-projected at the game's texture scale.
# (Self-contained on purpose: the helper class is a reworked copy of the one in kl_landmarks.py.)
import bpy, bmesh, sys, os, math, random
from mathutils import Matrix, Vector
import numpy as np

proj = sys.argv[sys.argv.index('--') + 1]
OUT = os.path.join(proj, 'public', 'models'); os.makedirs(OUT, exist_ok=True)
UVS = 0.22; TAU = math.tau; Z = Vector((0, 0, 1)); PI = math.pi
MATN = ['ashlar', 'roof', 'plain', 'glow']
MASONRY = 'ashlar'      # which of the game's masonry materials the 'ashlar' faces use: 'ashlar' (coursed blocks) or 'stone' (rubble)
cos, sin, atan2, hypot = math.cos, math.sin, math.atan2, math.hypot
def sh(c, f): return (c[0] * f, c[1] * f, c[2] * f)

# ---- the ground the causeway has to follow: terrain heights (m above sea) sampled from the running game with
#   game.field.heightAt(site.x + x, site.z + z) for z = -300..300 (rows) and x = -700..-100 (columns), every 25 m.
# East of x = -100 the site is the flat 90 m plateau. Re-sample and paste here if the terrain under Dragonstone changes.
PLATEAU = 90.0; SEA = -PLATEAU
HG = [
[-14.3,-13.2,-12.1,-11,-9.9,-8.8,-6.7,-2.6,3.3,10.4,18.4,26.8,35.4,44,52.2,59.8,66.7,72.7,77.6,81.8,85,87.3,88.8,89.6,90],
[-13.8,-12.7,-11.5,-10.4,-9.4,-7.9,-4.8,0.5,7.3,15.2,23.8,32.8,41.8,50.6,58.8,66.3,72.8,78.2,82.6,85.9,88.2,89.5,89.9,90,90],
[-13.3,-12.2,-11,-9.9,-8.8,-6.6,-2.4,3.7,11.4,20,29.1,38.4,47.7,56.5,64.7,71.8,77.8,82.7,86.2,88.5,89.7,90,90,90,90],
[-12.8,-11.7,-10.5,-9.4,-8.1,-5.1,0.1,7.1,15.4,24.5,34.1,43.7,53.1,61.9,69.7,76.4,81.9,86,88.6,89.8,90,90,90,90,90],
[-12.3,-11.2,-10,-8.9,-7.2,-3.2,2.8,10.4,19.3,28.9,38.7,48.4,57.8,66.5,74.1,80.3,85,88.3,89.8,90,90,90,90,90,90],
[-11.9,-10.7,-9.6,-8.4,-6.1,-1.3,5.4,13.6,22.9,32.8,42.8,52.6,62,70.5,77.7,83.3,87.2,89.5,90,90,90,90,90,90,90],
[-11.4,-10.2,-9.1,-7.9,-4.9,0.6,7.8,16.6,26.2,36.2,46.6,56.5,65.7,73.9,80.6,85.5,88.7,89.9,90,90,90,90,90,90,90],
[-10.9,-9.8,-8.7,-7.4,-3.7,2.3,10,19.2,29.1,39.4,49.9,59.8,68.8,76.6,82.8,87.1,89.5,90,90,90,90,90,90,90,90],
[-10.6,-9.5,-8.4,-6.8,-2.6,3.8,11.9,21.3,31.4,42,52.6,62.4,71.2,78.6,84.4,88.2,89.8,90,90,90,90,90,90,90,90],
[-10.4,-9.3,-8.2,-6.4,-1.8,4.9,13.3,23,33.3,44.1,54.7,64.4,73,80.1,85.6,88.8,89.9,90,90,90,90,90,90,90,90],
[-10.3,-9.2,-8.1,-6.1,-1.2,5.8,14.4,24.2,34.6,45.5,56.3,65.9,74.2,81.2,86.3,89.2,90,90,90,90,90,90,90,90,90],
[-10.3,-9.2,-8.1,-5.9,-0.9,6.2,15,24.9,35.4,46.4,57.2,66.7,74.9,81.8,86.8,89.4,90,90,90,90,90,90,90,90,90],
[-10.3,-9.2,-8.1,-5.9,-0.8,6.4,15.1,25.1,35.6,46.6,57.4,67,75.2,82,86.9,89.5,90,90,90,90,90,90,90,90,90],
[-10.3,-9.2,-8.1,-5.9,-0.9,6.2,14.9,24.8,35.3,46.2,57.2,66.7,74.9,81.8,86.8,89.4,90,90,90,90,90,90,90,90,90],
[-10.3,-9.2,-8.1,-6.1,-1.2,5.8,14.4,24.2,34.6,45.5,56.2,66,74.2,81.2,86.3,89.2,90,90,90,90,90,90,90,90,90],
[-10.3,-9.2,-8.1,-6.3,-1.7,5,13.4,23.1,33.4,44.3,54.9,64.6,73,80.2,85.5,88.8,89.9,90,90,90,90,90,90,90,90],
[-10.3,-9.2,-8.1,-6.5,-2.3,4,12.1,21.5,31.7,42.4,53.2,62.8,71.3,78.7,84.4,88.2,89.8,90,90,90,90,90,90,90,90],
[-10.2,-9.1,-8.1,-6.8,-3.1,2.8,10.5,19.6,29.5,39.9,50.6,60.4,69.1,76.7,82.8,87.1,89.5,90,90,90,90,90,90,90,90],
[-10.2,-9.1,-8.1,-6.9,-3.9,1.5,8.7,17.4,26.9,37.1,47.6,57.4,66.4,74.3,80.8,85.6,88.7,90,90,90,90,90,90,90,90],
[-10.2,-9.1,-8,-6.9,-4.6,0.1,6.7,14.8,23.9,33.8,43.8,53.7,62.7,70.9,77.9,83.3,87.2,89.5,90,90,90,90,90,90,90],
[-10.2,-9.1,-8,-7,-5.2,-1.4,4.5,12.1,20.7,30.1,39.8,49.4,58.6,67.1,74.4,80.4,85,88.3,89.7,90,90,90,90,90,90],
[-10.2,-9.1,-8,-6.9,-5.6,-2.7,2.4,9.3,17.3,26.2,35.6,44.9,54,62.6,70.3,76.8,82,86.1,88.6,89.8,90,90,90,90,90],
[-10.2,-9.1,-8,-6.9,-5.8,-3.7,0.4,6.4,13.7,22.2,31.1,39.9,49.1,57.6,65.4,72.2,78.1,82.9,86.3,88.6,89.7,90,90,90,90],
[-10.2,-9.1,-8,-6.9,-5.8,-4.4,-1.3,3.7,10.3,18,26.3,35,43.6,52.1,60,67,73.3,78.6,82.8,85.9,88.2,89.5,89.9,90,90],
[-10.1,-9,-8,-6.9,-5.8,-4.7,-2.7,1.3,7.1,14,21.7,29.8,37.9,46.2,53.9,61.2,67.7,73.3,78.1,82.1,85.1,87.3,88.7,89.5,89.9],
]
def ground(x, y):
    # terrain height relative to the plateau, at model coordinates (x east, y north)
    if x >= -100: return 0.0
    gx = (max(-700.0, x) + 700) / 25; gz = (min(300.0, max(-300.0, -y)) + 300) / 25
    i = min(23, int(gx)); j = min(23, int(gz)); fx = gx - i; fz = gz - j
    return (HG[j][i] * (1 - fx) + HG[j][i + 1] * fx) * (1 - fz) + (HG[j + 1][i] * (1 - fx) + HG[j + 1][i + 1] * fx) * fz - PLATEAU

# outlines for the swept stone fins (u = away from the root, v = up), in units of the fin's scale
WING = [(0, 0), (0, 1.0), (0.35, 1.25), (1.0, 1.75), (0.72, 1.2), (0.95, 1.05), (0.6, 0.7), (0.7, 0.45), (0.3, 0.25)]
HORN = [(0, 0), (0.9, 0.15), (1.9, 0.9), (2.6, 2.4), (1.6, 1.45), (0.8, 0.95), (0, 0.9)]
TALON = [(0, 0), (1.0, 0), (2.2, 1.4), (2.7, 4.2), (1.5, 2.4), (0.5, 1.9), (0, 2.0)]
FLAME = [(0.2, 0), (1.3, 0), (1.5, 1.6), (0.6, 3.6), (-1.2, 5.6), (-0.2, 3.4), (0.2, 1.8)]
SPINE = [(-0.55, 0), (0.55, 0), (0.95, 1.45)]

class M:
    def __init__(self, seed=1):
        self.bm = bmesh.new(); self.uv = self.bm.loops.layers.uv.verify(); self.col = self.bm.faces.layers.float_vector.new('tint'); self.rnd = random.Random(seed)
    def _fin(self, faces, mat, tint, smooth=False):
        for f in faces:
            f.material_index = MATN.index(mat); f[self.col] = tint; f.smooth = smooth
    # box: top / ty taper the upper face along the box's own x / y
    def box(self, c, s, mat, tint, rz=0.0, top=1.0, rx=0.0, ry=0.0, ty=None):
        m = Matrix.Translation(c) @ Matrix.Rotation(rz, 4, 'Z') @ Matrix.Rotation(ry, 4, 'Y') @ Matrix.Rotation(rx, 4, 'X')
        ty = top if ty is None else ty
        r = bmesh.ops.create_cube(self.bm, size=1.0)
        for v in r['verts']:
            kx, ky = (top, ty) if v.co.z > 0 else (1.0, 1.0)
            v.co = m @ Vector((v.co.x * s[0] * kx, v.co.y * s[1] * ky, v.co.z * s[2]))
        self._fin(set(f for v in r['verts'] for f in v.link_faces), mat, tint)
    def poly(self, pts, mat, tint, out=None, smooth=False):
        f = self.bm.faces.new([self.bm.verts.new(p) for p in pts]); f.normal_update()
        if out is not None and f.normal.dot(Vector(out)) < 0: f.normal_flip(); f.normal_update()
        self._fin([f], mat, tint, smooth); return f
    # drum: vertices at rot + j * TAU / seg (by default a flat face looks along +X)
    def drum(self, c, r, h, mat, tint, seg=20, r2=None, smooth=True, rot=None, top=True, bot=False):
        r2 = r if r2 is None else r2; rot = PI / seg if rot is None else rot
        A = [rot + j * TAU / seg for j in range(seg)]
        lo = [(c[0] + cos(a) * r, c[1] + sin(a) * r, c[2]) for a in A]; hi = [(c[0] + cos(a) * r2, c[1] + sin(a) * r2, c[2] + h) for a in A]
        for j in range(seg):
            k = (j + 1) % seg; am = A[j] + PI / seg
            self.poly([lo[j], lo[k], hi[k], hi[j]], mat, tint, (cos(am), sin(am), 0), smooth)
        if top: self.poly(hi, mat, tint, Z)
        if bot: self.poly(lo, mat, tint, -Z)
    def cone(self, c, r, h, mat, tint, seg=16, rot=None):
        rot = PI / seg if rot is None else rot; tip = (c[0], c[1], c[2] + h)
        for j in range(seg):
            a0, a1 = rot + j * TAU / seg, rot + (j + 1) * TAU / seg; am = (a0 + a1) / 2
            self.poly([(c[0] + cos(a0) * r, c[1] + sin(a0) * r, c[2]), (c[0] + cos(a1) * r, c[1] + sin(a1) * r, c[2]), tip], mat, tint, (cos(am), sin(am), 0.3), smooth=seg > 8)
    def dome(self, c, r, mat, tint, seg=24, rings=8, squash=1.0):
        rot = PI / seg
        for i in range(rings):
            p0, p1 = (i / rings) * PI / 2, ((i + 1) / rings) * PI / 2
            for j in range(seg):
                a0, a1 = rot + j * TAU / seg, rot + (j + 1) * TAU / seg
                P = lambda a, p: (c[0] + cos(a) * cos(p) * r, c[1] + sin(a) * cos(p) * r, c[2] + sin(p) * r * squash)
                am = (a0 + a1) / 2; out = (cos(am), sin(am), 0.5)
                if i == rings - 1: self.poly([P(a0, p0), P(a1, p0), P(a0, p1)], mat, tint, out, True)
                else: self.poly([P(a0, p0), P(a1, p0), P(a1, p1), P(a0, p1)], mat, tint, out, True)
    # six-sided solid from four bottom and four top corners (same order)
    def hexa(self, a, b, mat, tint, skip=()):
        pts = [Vector(p) for p in a] + [Vector(p) for p in b]; cen = sum(pts, Vector()) / 8
        for k, q in (('bot', (0, 1, 2, 3)), ('top', (4, 5, 6, 7)), ('s0', (0, 1, 5, 4)), ('s1', (1, 2, 6, 5)), ('s2', (2, 3, 7, 6)), ('s3', (3, 0, 4, 7))):
            if k in skip: continue
            fc = sum((pts[i] for i in q), Vector()) / 4
            self.poly([pts[i] for i in q], mat, tint, fc - cen)
    # a flat stone blade: outline pts (in the u, v plane through o) extruded to thickness th
    def plate(self, o, u, v, pts, th, mat, tint, sc=1.0):
        o = Vector(o); u = Vector(u).normalized(); v = Vector(v).normalized(); n = u.cross(v).normalized(); k = len(pts)
        area = sum(pts[i][0] * pts[(i + 1) % k][1] - pts[(i + 1) % k][0] * pts[i][1] for i in range(k)); sg = 1 if area > 0 else -1
        F = [o + u * (p[0] * sc) + v * (p[1] * sc) + n * (th / 2) for p in pts]; B = [q - n * th for q in F]
        self.poly(F, mat, tint, n); self.poly(B, mat, tint, -n)
        for i in range(k):
            j = (i + 1) % k; ex, ey = pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]
            self.poly([F[i], F[j], B[j], B[i]], mat, sh(tint, 0.9), (u * ey - v * ex) * sg)
    # a splinter of black rock: irregular base, pinched and leaning top cut off on a slant
    def shard(self, c, r, h, tint, lean=(0.0, 0.0), seg=5, k=0.45, mat='plain'):
        rnd = self.rnd; a0 = rnd.random() * TAU; A = [a0 + (j + (rnd.random() - 0.5) * 0.5) * TAU / seg for j in range(seg)]
        lo = [(c[0] + cos(a) * r * (0.75 + 0.5 * rnd.random()), c[1] + sin(a) * r * (0.75 + 0.5 * rnd.random()), c[2]) for a in A]
        tx, ty = (rnd.random() - 0.5) * 2.4, (rnd.random() - 0.5) * 2.4
        hi = [(c[0] + lean[0] + cos(a) * r * k, c[1] + lean[1] + sin(a) * r * k, c[2] + h + (cos(a) * tx + sin(a) * ty) * r * k) for a in A]
        for j in range(seg):
            q = (j + 1) % seg; am = (A[j] + A[q] + (TAU if q == 0 else 0)) / 2
            self.poly([lo[j], lo[q], hi[q], hi[j]], mat, sh(tint, 0.72 + 0.56 * rnd.random()), (cos(am), sin(am), 0))
        self.poly(hi, mat, sh(tint, 1.3), Z)

    # ---- castle vocabulary
    def slit(self, c, r, a, z, h=2.4, w=0.55, glow=True):
        self.box((c[0] + cos(a) * (r + 0.02), c[1] + sin(a) * (r + 0.02), z), (0.3, w, h), 'glow' if glow else 'plain', (1, 1, 1) if glow else (0.02, 0.02, 0.02), a)
    def arch_win(self, p, ang, w, h, tint, proud=0.12, glow=True, n=8, trim=1.5):
        # tall round-headed window on a vertical wall. p = centre of sill, ang = wall outward direction
        du = Vector((-sin(ang), cos(ang), 0)); nn = Vector((cos(ang), sin(ang), 0)); p = Vector(p)
        def shape(ww, hh, off):
            pts = [p + du * (-ww / 2) + nn * off, p + du * (ww / 2) + nn * off, p + du * (ww / 2) + nn * off + Z * (hh - ww / 2)]
            for i in range(1, n): a = PI * i / n; pts.append(p + du * (cos(a) * ww / 2) + nn * off + Z * (hh - ww / 2 + sin(a) * ww / 2))
            pts.append(p + du * (-ww / 2) + nn * off + Z * (hh - ww / 2)); return pts
        self.poly(shape(w + 0.9, h + 0.5, proud), 'ashlar', sh(tint, trim), nn)
        self.poly(shape(w, h, proud + 0.06), 'glow' if glow else 'plain', (1, 1, 1) if glow else (0.012, 0.012, 0.014), nn)
        self.box(p + nn * (proud + 0.1) - Z * 0.2, (0.5, w + 1.3, 0.4), 'ashlar', sh(tint, trim), ang)
    def gable_roof(self, c, w, d, z, rise, rz, tint, wall_tint, ov=0.8):
        R = Matrix.Translation((c[0], c[1], 0)) @ Matrix.Rotation(rz, 4, 'Z'); P = lambda x, y, zz: tuple(R @ Vector((x, y, zz)))
        hw, hd = w / 2 + ov, d / 2 + ov; zr = z + rise
        self.poly([P(-hw, -hd, z - 0.3), P(hw, -hd, z - 0.3), P(hw, 0, zr), P(-hw, 0, zr)], 'roof', tint, Z); self.poly([P(hw, hd, z - 0.3), P(-hw, hd, z - 0.3), P(-hw, 0, zr), P(hw, 0, zr)], 'roof', tint, Z)
        for sx in (-1, 1): self.poly([P(sx * w / 2, -d / 2, z), P(sx * w / 2, d / 2, z), P(sx * w / 2, 0, zr - 0.4)], 'ashlar', wall_tint, tuple(R.to_3x3() @ Vector((sx, 0, 0))))
        self.box(P(0, 0, zr + 0.1), (w + ov * 2, 0.8, 0.6), 'roof', sh(tint, 0.8), rz)
    # serrated battlement: a low parapet carrying a row of fangs, along a → b with its foot at z
    def parapet(self, a, b, z, tint, th=0.8, h=1.1, tooth=2.3, sp=2.9):
        dx, dy = b[0] - a[0], b[1] - a[1]; L = hypot(dx, dy); ang = atan2(dy, dx); cx, cy = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        self.box((cx, cy, z + h / 2), (L, th, h), 'ashlar', tint, ang)
        n = max(1, int(L / sp))
        for i in range(n):
            t = (i + 0.5) / n - 0.5
            self.box((cx + dx * t, cy + dy * t, z + h + tooth / 2), (L / n * 0.68, th, tooth), 'ashlar', sh(tint, 1.15), ang, top=0.1, ty=0.5)
    # a dragon's head thrust out of the stone: neck, tapering skull; full = with open jaw and swept horns
    def gargoyle(self, p, ang, s, tint, full=False):
        f = Vector((cos(ang), sin(ang), 0)); l = Vector((-sin(ang), cos(ang), 0)); p = Vector(p)
        self.box(p + f * 0.7 * s + Z * 0.25 * s, (2.0 * s, 0.85 * s, 0.8 * s), 'ashlar', sh(tint, 0.88), ang, ry=-0.3)
        self.box(p + f * 2.3 * s + Z * 0.75 * s, (1.0 * s, 1.25 * s, 2.4 * s), 'ashlar', tint, ang, ry=PI / 2 + 0.22, top=0.38)
        if not full: return
        self.box(p + f * 2.2 * s - Z * 0.05 * s, (0.3 * s, 0.95 * s, 2.0 * s), 'ashlar', sh(tint, 0.85), ang, ry=PI / 2 + 0.5, top=0.3)
        for sd in (-1, 1):
            d = ang - sd * 0.25; hd = Vector((-cos(d) * 0.813, -sin(d) * 0.813, 0.582))
            base = p + f * 1.5 * s + l * sd * 0.45 * s + Z * 1.1 * s
            self.box(base + hd * 1.1 * s, (0.36 * s, 0.36 * s, 2.2 * s), 'ashlar', sh(tint, 1.2), d, ry=-0.95, top=0.12)
    # curtain wall: battered, buttressed, string course, overhanging walk, fangs outward, a gargoyle on every buttress
    def curtain(self, a, b, h, th, tint, cen=(0, 0), z0=-22.0, batter=1.5, trim=None):
        dx, dy = b[0] - a[0], b[1] - a[1]; L = hypot(dx, dy); ang = atan2(dy, dx); cx, cy = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        nx, ny = -dy / L, dx / L
        if (cx - cen[0]) * nx + (cy - cen[1]) * ny < 0: nx, ny = -nx, -ny                                            # outward
        trim = trim or sh(tint, 1.6)
        self.box((cx, cy, (h + z0) / 2), (L, th * batter, h - z0), 'ashlar', tint, ang, top=1.0, ty=1 / batter)
        zc = h * 0.5; tk = th * (batter - (batter - 1) * (zc - z0) / (h - z0))
        self.box((cx, cy, zc), (L, tk + 0.8, 0.8), 'ashlar', trim, ang)
        self.box((cx, cy, h + 0.1), (L, th + 2.2, 1.0), 'ashlar', trim, ang)
        zw = h + 0.6; o = th / 2 + 0.65
        self.parapet((a[0] + nx * o, a[1] + ny * o), (b[0] + nx * o, b[1] + ny * o), zw, tint)
        self.box((cx - nx * o, cy - ny * o, zw + 0.45), (L, 0.6, 0.9), 'ashlar', sh(tint, 0.95), ang)
        nb = max(1, int(L / 15)); oa = atan2(ny, nx)
        for i in range(nb):
            t = (i + 0.5) / nb - 0.5; px, py = cx + dx * t + nx * th * 0.72, cy + dy * t + ny * th * 0.72; zb = h * 0.84
            self.box((px, py, (zb + z0) / 2), (3.0, 3.4, zb - z0), 'ashlar', sh(tint, 0.9), ang, top=0.7, ty=0.45)
            self.gargoyle((px + nx * 0.2, py + ny * 0.2, zb + 0.1), oa, 1.35, trim)
    # a tower in the shape of a rearing dragon: battered shaft, fanged crown, a hooded head thrust out toward `face`,
    # half-spread stone wings and a row of spines down its back
    def dragon_tower(self, c, r, h, face, tint, trim, roof, seg=14, wings=True, zg=0.0, z0=-22.0, head=True, taper=0.88):
        x, y = c; rt = r * taper; rnd = self.rnd; f = (cos(face), sin(face)); bk = face + PI
        self.drum((x, y, z0), r * 1.22, zg + h * 0.18 - z0, 'ashlar', sh(tint, 0.88), seg, r2=r, top=False)
        self.drum((x, y, zg + h * 0.18), r, h * 0.82, 'ashlar', tint, seg, r2=rt)
        rad = lambda t: r * (1 - (1 - taper) * max(0.0, t - 0.18) / 0.82)                                              # shaft radius at height fraction t
        for t in (0.18, 0.5, 0.78): self.drum((x, y, zg + h * t - 0.4), rad(t) + 0.3, 0.8, 'ashlar', trim, seg, top=False)
        nl = max(1, int((h - 10) / 10)); nw = max(3, int(r / 2.2)); st = TAU / seg
        for lv in range(nl):
            for i in range(nw):
                if rnd.random() < 0.35: continue
                zz = zg + 8 + lv * 10 + rnd.random() * 2; a = round(((i / nw) * TAU + lv * 0.8) / st) * st
                if zz < zg + h - 5: self.slit(c, rad((zz - zg) / h) * cos(PI / seg), a, zz, glow=rnd.random() < 0.7)
        # crown: corbels, flared ring, fangs
        zt = zg + h; rf = rt * 1.22; n = max(10, int(rt * 2.2))
        for i in range(n):
            a = (i + 0.5) / n * TAU; rr = rt + (rf - rt) * 0.45
            self.box((x + cos(a) * rr, y + sin(a) * rr, zt - 1.2), ((rf - rt) * 1.4, 0.8, 2.4), 'ashlar', sh(tint, 0.8), a)
        self.drum((x, y, zt), rf, 1.6, 'ashlar', trim, max(16, n), bot=True)
        w = min(1.9, rf * TAU / n * 0.64)
        for i in range(n):
            a = (i + 0.5) / n * TAU
            self.box((x + cos(a) * (rf - 0.45), y + sin(a) * (rf - 0.45), zt + 1.6 + 1.2), (0.8, w, 2.4), 'ashlar', sh(tint, 1.15), a, top=0.6, ty=0.12)
        # hooded upper stage
        rn = rt * 0.74; hn = r * 1.0
        self.drum((x, y, zt), rn, hn, 'ashlar', sh(tint, 0.94), seg, top=False); self.drum((x, y, zt + hn), rt * 0.86, 0.8, 'ashlar', trim, seg, bot=True)
        self.cone((x, y, zt + hn + 0.8), rt * 0.92, r * 2.3, 'roof', roof, seg)
        for i in range(4): self.slit(c, rn * cos(PI / seg), round((face + PI / 4 + i * PI / 2) / st) * st, zt + hn * 0.5, 2.0, 0.6)
        if head:
            s = r * 0.5; self.gargoyle((x + f[0] * rn * 0.5, y + f[1] * rn * 0.5, zt + r * 0.2), face, s, sh(tint, 1.2), True)
        for sd in (-1, 1):                                                                                            # horns over the hood
            d = bk + sd * 0.4; la = face + sd * PI / 2
            self.plate((x + cos(la) * rt * 0.45, y + sin(la) * rt * 0.45, zt + hn + 0.4), (cos(d), sin(d), 0), Z, HORN, r * 0.1 + 0.3, 'ashlar', sh(tint, 1.25), r * 0.55)
        if wings:
            s = h * 0.3
            for sd in (-1, 1):
                ra = face + sd * 1.95; d = face + sd * 2.5; u = Vector((cos(d), sin(d), 0))
                o = Vector((x + cos(ra) * rad(0.5) * 0.8, y + sin(ra) * rad(0.5) * 0.8, zg + h * 0.44)); v = (Z + u * 0.14).normalized()
                self.plate(o, u, v, WING, 1.1 + r * 0.03, 'ashlar', sh(tint, 0.86), s)
                for (u0, v0), (u1, v1) in (((0, 0.95), (1.0, 1.75)), ((0, 0.6), (0.95, 1.05)), ((0, 0.2), (0.7, 0.45))):          # the wing's fingers, standing proud of the web
                    p0 = o + u * (u0 * s) + v * (v0 * s); p1 = o + u * (u1 * s) + v * (v1 * s); dd = p1 - p0
                    self.box((p0 + p1) / 2, (dd.length, 1.9 + r * 0.05, 0.9 + r * 0.04), 'ashlar', sh(tint, 1.12), atan2(dd.y, dd.x), ry=-atan2(dd.z, hypot(dd.x, dd.y)), top=1.0)
                self.box((x + cos(ra) * rad(0.5) * 0.95, y + sin(ra) * rad(0.5) * 0.95, zg + h * 0.44 + s * 0.5), (r * 0.5, r * 0.34, s * 1.15), 'ashlar', sh(tint, 1.05), ra, top=0.6)   # the wing's shoulder
        ns = 6                                                                                                        # dorsal spines
        for i in range(ns):
            t = 0.26 + 0.66 * i / (ns - 1); rr = rad(t) - 0.4
            self.plate((x + cos(bk) * rr, y + sin(bk) * rr, zg + h * t), (cos(bk), sin(bk), 0), Z, [(0, 0), (0, 1.0), (1.0, 1.55)], 0.7, 'ashlar', sh(tint, 1.1), r * (0.28 + 0.24 * i / (ns - 1)))
        return zt
    # walled stair / causeway along a 3D centre line: deck, parapets with fangs, a battered spine reaching `depth` below
    def strip(self, P, hw, depth, tint, flare=3.2, pw=0.9, ph=1.3, pier=4):
        n = len(P); P = [Vector(p) for p in P]; N = []; D = []
        for i in range(n):
            d0 = (P[i] - P[i - 1]).to_2d().normalized() if i > 0 else None; d1 = (P[i + 1] - P[i]).to_2d().normalized() if i < n - 1 else None
            if d0 is None: d0 = d1
            if d1 is None: d1 = d0
            t = d0 + d1
            if t.length < 1e-4: t = d1.copy()
            t.normalize(); k = min(2.0, 1.0 / max(0.5, t.dot(d1)))
            N.append(Vector((-t.y, t.x, 0)) * k); D.append(atan2(t.y, t.x))
        S = lambda i, off, dz: P[i] + N[i] * off + Z * dz
        hi = hw - pw; lite = sh(tint, 1.35)
        for i in range(n - 1):
            j = i + 1
            self.poly([S(i, -hi, 0), S(i, hi, 0), S(j, hi, 0), S(j, -hi, 0)], 'ashlar', sh(lite, 1.0 if i % 2 else 0.8), Z)
            for sd in (-1, 1):
                o = N[i] * sd
                self.poly([S(i, sd * hi, 0), S(j, sd * hi, 0), S(j, sd * hi, ph), S(i, sd * hi, ph)], 'ashlar', tint, -o)
                self.poly([S(i, sd * hi, ph), S(j, sd * hi, ph), S(j, sd * hw, ph), S(i, sd * hw, ph)], 'ashlar', lite, Z)
                self.poly([S(i, sd * hw, ph), S(j, sd * hw, ph), S(j, sd * (hw + flare), -depth), S(i, sd * (hw + flare), -depth)], 'ashlar', tint, o)
                for t in (0.25, 0.75):
                    q = S(i, sd * (hw - pw / 2), ph).lerp(S(j, sd * (hw - pw / 2), ph), t)
                    self.cone(q, 0.55, 1.5, 'ashlar', sh(tint, 1.2), 4, rot=D[i] + PI / 4)
                if pier and i % pier == 2:
                    q = S(i, sd * (hw + 1.3), 0); self.box((q.x, q.y, q.z - depth / 2 + 0.4), (2.8, 3.0, depth), 'ashlar', sh(tint, 0.9), D[i], top=0.6, ty=0.5)
                    self.cone((q.x, q.y, q.z + 0.4), 0.9, 2.6, 'ashlar', lite, 4, rot=D[i] + PI / 4)
        for i, sg in ((0, -1), (n - 1, 1)):                                                                           # end caps
            self.poly([S(i, -hw, ph), S(i, hw, ph), S(i, hw + flare, -depth), S(i, -hw - flare, -depth)], 'ashlar', tint, Vector((cos(D[i]), sin(D[i]), 0)) * sg)
        return N, D

    def to_object(self, name):
        bm = self.bm
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
        # break long edges so the per-vertex ambient occlusion has something to hold on to
        for _ in range(3):
            es = [e for e in bm.edges if e.calc_length() > 8.5]
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
        for mn in MATN: mn = MASONRY if mn == 'ashlar' else mn; me.materials.append(bpy.data.materials.get(mn) or bpy.data.materials.new(mn))
        return o, tints

def ground_occluder():
    # the terrain, as a stand-in mesh, so the baked occlusion darkens the feet of the walls (never exported)
    bm = bmesh.new(); xs = list(range(-740, 261, 20)); ys = list(range(-340, 341, 20))
    V = [[bm.verts.new((x, y, ground(x, y) - 0.05)) for x in xs] for y in ys]
    for j in range(len(ys) - 1):
        for i in range(len(xs) - 1): bm.faces.new((V[j][i], V[j][i + 1], V[j + 1][i + 1], V[j + 1][i]))
    me = bpy.data.meshes.new('ground'); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new('ground', me); bpy.context.scene.collection.objects.link(o); return o

def finish(m, name):
    o, tints = m.to_object(name); me = o.data
    ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER'); me.color_attributes.active_color = ca; me.color_attributes.render_color_index = 0
    gnd = ground_occluder()
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
    n = len(me.loops); a = np.empty(n * 4, dtype=np.float32); ca.data.foreach_get('color', a); a = a.reshape(n, 4)
    ao = 0.34 + 0.66 * np.clip(a[:, :1] * 1.15, 0, 1)
    tl = np.empty((n, 3), dtype=np.float32)
    for p in me.polygons:
        tl[p.loop_start:p.loop_start + p.loop_total] = tints[p.index]
    glow = np.array([MATN[p.material_index] == 'glow' for p in me.polygons for _ in range(p.loop_total)])
    a[:, :3] = tl * np.where(glow[:, None], 1.0, ao); a[:, 3] = 1
    ca.data.foreach_set('color', a.ravel())
    gnd.hide_render = True; gnd.hide_set(True)
    # NB: the materials must be exported by name ('PLACEHOLDER' writes none in Blender 5.x, and the game then falls back to
    # its rubble 'stone' material for every face, windows and roofs included)
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, name + '.glb'), export_format='GLB', use_selection=True, export_materials='EXPORT', export_yup=True, export_apply=True, export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_active_vertex_color_when_no_material=True)
    print('EXPORTED', name, len(me.polygons), 'faces,', sum(len(p.vertices) - 2 for p in me.polygons), 'triangles', flush=True)

def chaikin(P, it=2):
    P = [Vector(p) for p in P]
    for _ in range(it):
        Q = [P[0]]
        for i in range(len(P) - 1): Q.append(P[i].lerp(P[i + 1], 0.25)); Q.append(P[i].lerp(P[i + 1], 0.75))
        Q.append(P[-1]); P = Q
    return P
def resample(P, step):
    L = [0.0]
    for i in range(1, len(P)): L.append(L[-1] + (P[i] - P[i - 1]).length)
    n = max(2, int(math.ceil(L[-1] / step))); out = []; k = 0
    for i in range(n + 1):
        d = L[-1] * i / n
        while k < len(P) - 2 and L[k + 1] < d: k += 1
        t = (d - L[k]) / max(1e-6, L[k + 1] - L[k]); out.append(P[k].lerp(P[k + 1], min(1.0, t)))
    return out

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene; scene.render.engine = 'CYCLES'; scene.cycles.samples = 24; scene.cycles.device = 'CPU'
scene.world = bpy.data.worlds.new('w'); scene.world.light_settings.distance = 16.0

# ====================================================================== Dragonstone
def dragonstone():
    m = M(7); rnd = m.rnd
    bas = (0.068, 0.068, 0.078); warm = (0.081, 0.072, 0.065); cold = (0.057, 0.064, 0.080)      # fused black stone, never quite the same black twice
    TINTS = [bas, warm, cold, sh(bas, 1.2), sh(warm, 0.84), sh(cold, 1.16)]
    trim = sh(bas, 1.9); slate = (0.042, 0.049, 0.066); rock = (0.034, 0.032, 0.030)
    tn = lambda i: TINTS[i % len(TINTS)]

    def rocktint(): w = rnd.random(); return sh((rock[0] * (1 + 0.12 * w), rock[1], rock[2] * (1.1 - 0.12 * w)), 0.7 + 0.7 * rnd.random())
    def crags(x, y, n, R, hmax):
        # a knot of rock splinters, tallest at the middle
        for _ in range(n):
            a = rnd.random() * TAU; d = math.sqrt(rnd.random()) * R; px, py = x + cos(a) * d, y + sin(a) * d
            rr = 2.2 + rnd.random() * 3.2; hh = (0.3 + 0.7 * rnd.random()) * hmax * (1 - 0.65 * d / R)
            m.shard((px, py, ground(px, py) - 9), rr * 1.3, hh + 9, rocktint(), (cos(a) * hh * 0.15, sin(a) * hh * 0.15), 5 + int(rnd.random() * 2), 0.3 + 0.3 * rnd.random())
    def collar(a, b, th, skip=None):
        # the rock the wall grows out of: three ragged rows of splinters along its outer foot
        dx, dy = b[0] - a[0], b[1] - a[1]; L = hypot(dx, dy); cx, cy = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2; nx, ny = -dy / L, dx / L
        if cx * nx + cy * ny < 0: nx, ny = -nx, -ny
        for off, h0, h1, r0 in ((th * 0.75 + 1.5, 8, 15, 3.4), (th * 0.75 + 6.5, 4, 9, 3.0), (th * 0.75 + 12, 1.5, 5, 2.6)):
            k = max(1, int(L / 4.6))
            for i in range(k):
                t = (i + rnd.random()) / k; o = off + (rnd.random() - 0.5) * 3; px, py = a[0] + dx * t + nx * o, a[1] + dy * t + ny * o
                if (skip and skip(px, py)) or rnd.random() < 0.1: continue
                hh = h0 + (h1 - h0) * rnd.random() ** 1.6; big = rnd.random() < 0.3                                     # now and then a blunt boulder among the splinters
                m.shard((px, py, ground(px, py) - 6), r0 * (0.8 + 0.6 * rnd.random()) * (1.7 if big else 1.0), hh * (0.55 if big else 1.0) + 6, rocktint(), (nx * hh * 0.14, ny * hh * 0.14), 5 + int(rnd.random() * 2), (0.55 if big else 0.28) + 0.3 * rnd.random())

    # ---- outer curtain: eleven dragon towers joined by battered walls; the gate is in the west wall
    V = [(-126, -46), (-80, -92), (-8, -116), (62, -100), (112, -48), (126, 18), (94, 78), (34, 112), (-36, 116), (-94, 86), (-126, 46)]
    T = [(9.5, 48, 0), (10.5, 60, 1), (9.5, 46, 0), (10.5, 56, 0), (12.5, 76, 1), (9.5, 50, 0), (11, 64, 1), (9.5, 48, 0), (10.5, 58, 0), (13.5, 84, 1), (9.5, 50, 0)]
    WH, WT, GX = 27.0, 10.0, -128.0; nv = len(V); atgate = lambda px, py: px < -112 and abs(py) < 26
    for i in range(nv):
        a, b = V[i], V[(i + 1) % nv]
        if i == nv - 1: m.curtain(a, (GX, 11), WH, WT, tn(i)); m.curtain((GX, -11), b, WH, WT, tn(i))
        else: m.curtain(a, b, WH, WT, tn(i))
        collar(a, b, WT, atgate)
        r, h, w = T[i]; fa = atan2(a[1], a[0])
        m.dragon_tower(a, r, h, fa, tn(i + 3), trim, slate, wings=bool(w))
        for k in range(9):
            ka = fa + (k - 4) * 0.36 + (rnd.random() - 0.5) * 0.2; kr = r * 1.22 + 1.5 + rnd.random() * 5; hh = 7 + rnd.random() * (8 + r * 0.5)
            m.shard((a[0] + cos(ka) * kr, a[1] + sin(ka) * kr, -6), 3.0 + rnd.random() * 2.2, hh + 6, rocktint(), (cos(ka) * hh * 0.12, sin(ka) * hh * 0.12), 5 + int(rnd.random() * 2), 0.3 + 0.25 * rnd.random())

    # ---- the gatehouse: a block between two dragon towers, the gate under a dragon's chin
    gt = sh(bas, 1.1)
    m.box((GX - 1, 0, 5.5), (15, 20, 55), 'ashlar', gt); m.box((GX - 1, 0, 33.5), (16.6, 21.6, 1.0), 'ashlar', trim)
    m.parapet((GX - 9, -10.8), (GX - 9, 10.8), 34, gt); m.parapet((GX + 7, -10.8), (GX + 7, 10.8), 34, gt)
    m.arch_win((GX - 8.5, 0, 0.3), PI, 8.5, 13.5, gt, glow=False); m.arch_win((GX + 6.5, 0, 0.3), 0, 8.5, 12.5, gt, glow=False)
    m.gargoyle((GX - 8.3, 0, 19.5), PI, 3.6, trim, True)
    for sd in (-1, 1):
        m.dragon_tower((GX - 4, sd * 17.5), 8.5, 46, PI - sd * 0.45, tn(1 + sd), trim, slate, wings=False)
        m.arch_win((GX - 8.5, sd * 6.4, 23), PI, 1.2, 4.2, gt); m.slit((GX - 8.5, sd * 3.0), 0, PI, 29.5, 2.2, 0.5)

    # ---- the inner ward: a ten-sided terrace of fused stone nine metres above the yard, reached by a ramp from the west
    IC = (28.0, 22.0); ZI = 13.0; it = sh(warm, 0.95)
    m.drum((IC[0], IC[1], -22), 57, 22 + ZI, 'ashlar', it, 10, r2=53, smooth=False)
    m.drum((IC[0], IC[1], ZI - 0.2), 53.6, 0.9, 'ashlar', trim, 10, smooth=False, bot=True, top=False)
    m.drum((IC[0], IC[1], ZI), 50.5, 0.12, 'ashlar', sh(bas, 1.5), 10, smooth=False)                                       # paving
    iv = [(IC[0] + cos(PI / 10 + j * TAU / 10) * 52.6, IC[1] + sin(PI / 10 + j * TAU / 10) * 52.6) for j in range(10)]
    for j in range(10):
        a, b = iv[j], iv[(j + 1) % 10]
        if j != 4: m.parapet(a, b, ZI + 0.5, it, th=0.9, h=1.3)
        if j % 2 == 0 or j == 5: m.dragon_tower((IC[0] + (a[0] - IC[0]) * 0.99, IC[1] + (a[1] - IC[1]) * 0.99), 4.6, 20 + (j % 3) * 4, atan2(a[1] - IC[1], a[0] - IC[0]), tn(j), trim, slate, seg=10, wings=False, zg=ZI)
    x0, x1 = IC[0] - 92, IC[0] - 49.5
    m.hexa([(x0, IC[1] - 5.5, -3), (x1, IC[1] - 5.5, -3), (x1, IC[1] + 5.5, -3), (x0, IC[1] + 5.5, -3)], [(x0, IC[1] - 5.5, 0.2), (x1, IC[1] - 5.5, ZI + 0.1), (x1, IC[1] + 5.5, ZI + 0.1), (x0, IC[1] + 5.5, 0.2)], 'ashlar', sh(bas, 1.35))
    for sd in (-1, 1):
        m.hexa([(x0, IC[1] + sd * 5.5, -3), (x1, IC[1] + sd * 5.5, -3), (x1, IC[1] + sd * 6.6, -3), (x0, IC[1] + sd * 6.6, -3)], [(x0, IC[1] + sd * 5.5, 1.6), (x1, IC[1] + sd * 5.5, ZI + 1.5), (x1, IC[1] + sd * 6.6, ZI + 1.5), (x0, IC[1] + sd * 6.6, 1.6)], 'ashlar', it)
        m.drum((x0, IC[1] + sd * 7.2, -3), 2.3, 10, 'ashlar', sh(bas, 1.15), 8, r2=1.9); m.gargoyle((x0, IC[1] + sd * 7.2, 7), PI, 1.5, sh(bas, 1.3), True)

    # ---- the Stone Drum: the great round keep, crowned with talons, a spire rising from it
    sx, sy = IC; R = 33.0; H = 72.0; seg = 28; sd_t = sh(bas, 1.08); zg = ZI
    m.drum((sx, sy, zg - 6), R * 1.14, 16, 'ashlar', sh(sd_t, 0.86), seg, r2=R, top=False)
    m.drum((sx, sy, zg + 10), R, H - 10, 'ashlar', sd_t, seg, r2=R * 0.95)
    rad = lambda z: R * (1 - 0.05 * max(0.0, z - 10) / (H - 10))
    for z in (10, 31, 52): m.drum((sx, sy, zg + z - 0.5), rad(z) + 0.4, 1.0, 'ashlar', trim, seg, top=False)
    NP = 14
    for i in range(NP):
        a = (i + 0.5) / NP * TAU
        m.box((sx + cos(a) * R * 0.985, sy + sin(a) * R * 0.985, zg + H / 2 - 3), (3.2, 3.6, H + 6), 'ashlar', sh(sd_t, 1.22), a, top=0.62)          # pilasters
        b = i / NP * TAU
        for z, wh, ww in ((15, 9.0, 1.9), (36, 8.5, 1.8)):
            rr = rad(z + wh * 0.35) * cos(PI / seg); m.arch_win((sx + cos(b) * rr, sy + sin(b) * rr, zg + z), b, ww, wh, sd_t, glow=rnd.random() < 0.72)
        if i % 2: rr = rad(58) * cos(PI / seg); m.slit((sx, sy), rr, b, zg + 58, 3.4, 0.7)
    zt = zg + H; rt = R * 0.95; rf = rt + 3.2; n = 42
    for i in range(n):
        a = (i + 0.5) / n * TAU; m.box((sx + cos(a) * (rt + 1.3), sy + sin(a) * (rt + 1.3), zt - 1.5), (4.2, 1.1, 3.0), 'ashlar', sh(sd_t, 0.8), a)
    m.drum((sx, sy, zt), rf, 1.8, 'ashlar', trim, n, bot=True)
    for i in range(n):
        a = (i + 0.5) / n * TAU; m.box((sx + cos(a) * (rf - 0.5), sy + sin(a) * (rf - 0.5), zt + 1.8 + 1.4), (0.9, rf * TAU / n * 0.66, 2.8), 'ashlar', sh(sd_t, 1.2), a, top=0.6, ty=0.12)
    for i in range(NP):
        a = (i + 0.5) / NP * TAU; m.plate((sx + cos(a) * (rf - 1.0), sy + sin(a) * (rf - 1.0), zt + 1.0), (cos(a), sin(a), 0), Z, TALON, 1.5, 'ashlar', sh(sd_t, 1.3), 2.5)
    for i in range(4):
        a = PI / 4 + i * PI / 2; m.gargoyle((sx + cos(a) * (rf - 2.0), sy + sin(a) * (rf - 2.0), zt - 7.0), a, 5.0, trim, True)
    ut = sh(cold, 1.1); r1, r2, hu = 19.5, 17.5, 28.0; us = 20
    m.drum((sx, sy, zt), r1, hu, 'ashlar', ut, us, r2=r2)
    for z in (0.3, 18.5): m.drum((sx, sy, zt + z), r1 - (r1 - r2) * z / hu + 0.35, 0.9, 'ashlar', trim, us, top=False)
    for i in range(10):
        a = i / 10 * TAU; rr = (r1 - (r1 - r2) * 8 / hu) * cos(PI / us) - 0.2; m.arch_win((sx + cos(a) * rr, sy + sin(a) * rr, zt + 7), a, 1.7, 7.0, ut)
    zc = zt + hu
    m.drum((sx, sy, zc), r2 + 2.2, 1.5, 'ashlar', trim, 30, bot=True)
    for i in range(30):
        a = (i + 0.5) / 30 * TAU; m.box((sx + cos(a) * (r2 + 1.75), sy + sin(a) * (r2 + 1.75), zc + 1.5 + 1.2), (0.8, (r2 + 2.2) * TAU / 30 * 0.66, 2.4), 'ashlar', sh(ut, 1.2), a, top=0.6, ty=0.12)
    m.cone((sx, sy, zc + 1.5), r2 + 0.6, 34, 'roof', slate, us)
    for i in range(7):
        a = i / 7 * TAU + 0.2; m.plate((sx + cos(a) * (r2 - 1.0), sy + sin(a) * (r2 - 1.0), zc + 1.2), (cos(a), sin(a), 0), Z, FLAME, 1.2, 'ashlar', sh(sd_t, 1.25), 2.7)
    m.box((sx, sy, zc + 37), (0.5, 0.5, 6), 'plain', (0.10, 0.09, 0.08))
    ta = 2.25; tx, ty = sx + cos(ta) * (R + 1.5), sy + sin(ta) * (R + 1.5)                                                # stair turret
    m.drum((tx, ty, zg - 6), 5.2, H + 20, 'ashlar', sh(warm, 1.05), 12, r2=4.4); m.drum((tx, ty, zt + 14), 5.1, 0.9, 'ashlar', trim, 12, bot=True)
    m.cone((tx, ty, zt + 14.9), 5.0, 14, 'roof', slate, 12)
    for z in (20, 34, 48, 62, 78): m.slit((tx, ty), 4.7, ta, zg + z, 2.4, 0.6)

    # ---- the Great Hall: a dragon lying on its belly, the doors in its mouth, its spine the roof ridge, its tail curled round the yard
    hc = (-22.0, -56.0); hz = 0.3; HL, HW, HH = 62.0, 24.0, 21.0; ht = sh(bas, 1.0)
    Rm = Matrix.Translation((hc[0], hc[1], 0)) @ Matrix.Rotation(hz, 4, 'Z'); P = lambda x, y, z: Rm @ Vector((x, y, z))
    ax = Vector((cos(hz), sin(hz), 0)); rise = HW * 0.62
    m.box(P(0, 0, (HH - 22) / 2), (HL, HW, HH + 22), 'ashlar', ht, hz); m.box(P(0, 0, HH + 0.3), (HL + 1.0, HW + 1.2, 0.9), 'ashlar', trim, hz)
    m.gable_roof(hc, HL, HW, HH + 0.7, rise, hz, slate, ht)
    ns = 15
    for i in range(ns):
        s = (0.42 + 0.78 * sin(PI * (i + 0.5) / ns)) * 4.6; m.plate(P(((i + 0.5) / ns - 0.5) * HL, 0, HH + 0.7 + rise - 0.2), ax, Z, SPINE, 0.8, 'ashlar', sh(ht, 1.35), s)
    nb = 7
    for sd in (-1, 1):
        for i in range(nb + 1):
            xx = (i / nb - 0.5) * HL; m.box(P(xx, sd * (HW / 2 + 1.3), (HH - 22) / 2), (2.4, 3.4, HH + 22), 'ashlar', sh(ht, 1.18), hz, top=0.6)   # ribs
            m.cone(P(xx, sd * (HW / 2 + 1.3), HH), 1.0, 4.5, 'ashlar', sh(ht, 1.3), 4, rot=hz + PI / 4)
            if i < nb: m.arch_win(P(xx + HL / nb / 2, sd * HW / 2, HH * 0.2), hz + sd * PI / 2, 2.3, HH * 0.6, ht)
        for xx in (-HL * 0.3, HL * 0.3):                                                                                  # haunches and claws
            m.box(P(xx, sd * (HW / 2 + 4), (HH * 0.7 - 22) / 2), (10, 9, HH * 0.7 + 22), 'ashlar', sh(ht, 0.92), hz, top=0.62)
            for k in (-1, 0, 1): m.box(P(xx + k * 3.0, sd * (HW / 2 + 10.5), 0.9), (1.3, 1.8, 5.5), 'ashlar', trim, hz + sd * PI / 2 + k * 0.25, ry=PI / 2 - 0.12, top=0.25)
        # folded wings lying back along the roof
        m.plate(P(-HL * 0.3, sd * (HW / 2 + 1.5), HH * 0.55), ax, Z + Vector((-sin(hz), cos(hz), 0)) * (-sd * 0.25), [(0, 0), (-1, 9), (9, 15), (33, 12), (22, 8.5), (29, 4.5), (15, 3.5), (10, 0)], 1.0, 'ashlar', sh(cold, 0.95))
    # neck, skull, jaw
    m.box(P(-HL / 2 - 6, 0, (HH * 0.86 - 22) / 2), (13, HW * 0.62, HH * 0.86 + 22), 'ashlar', sh(ht, 1.06), hz, top=0.85)
    m.box(P(-HL / 2 - 19, 0, HH * 0.64), (10.5, HW * 0.64, 20), 'ashlar', sh(bas, 1.3), hz + PI, ry=PI / 2 + 0.1, top=0.42)
    m.box(P(-HL / 2 - 18, 0, 1.3), (2.6, HW * 0.5, 18), 'ashlar', sh(bas, 1.15), hz + PI, ry=PI / 2, top=0.45)
    m.box(P(-HL / 2 - 12.2, 0, 5.5), (1.2, HW * 0.44, 8.5), 'plain', (0.012, 0.012, 0.014), hz); m.box(P(-HL / 2 - 12.9, 0, 5.2), (0.3, HW * 0.26, 6.2), 'glow', (1, 1, 1), hz)
    for sd in (-1, 1):
        m.box(P(-HL / 2 - 17, sd * HW * 0.3, HH * 0.64 + 3.0), (2.6, 0.5, 1.1), 'glow', (1, 1, 1), hz - sd * 0.12)             # eyes
        d = hz + sd * 0.22; hd = Vector((cos(d) * 0.813, sin(d) * 0.813, 0.582)); base = P(-HL / 2 - 13, sd * HW * 0.2, HH * 0.64 + 4.6)
        m.box(base + hd * 8.5, (2.2, 2.2, 17), 'ashlar', sh(bas, 1.5), d + PI, ry=-0.95, top=0.12)                               # horns swept back over the neck
        for k in range(5):
            m.cone(P(-HL / 2 - 14.5 - k * 2.4, sd * (HW * 0.27 - k * 0.75), HH * 0.64 - 4.6 + k * 0.2), 0.55, -2.2, 'ashlar', sh(trim, 1.2), 4)   # fangs
            m.cone(P(-HL / 2 - 14 - k * 2.3, sd * (HW * 0.22 - k * 0.7), 2.5), 0.5, 1.7, 'ashlar', sh(trim, 1.2), 4)
    # tail
    px, py, pa = HL / 2 + 2.0, 0.0, 0.0
    for k in range(8):
        f = 1 - k / 8.6; ln = 8.0; pa2 = pa - 0.2 * (k / 7) * 2.4; px2, py2 = px + cos(pa2) * ln, py + sin(pa2) * ln
        m.box(P((px + px2) / 2, (py + py2) / 2, (HH * 0.6 * f - 22) / 2), (ln + 1.5, HW * 0.52 * f, HH * 0.6 * f + 22), 'ashlar', sh(ht, 0.95 + 0.1 * (k % 2)), hz + pa2, top=0.8)
        m.plate(P((px + px2) / 2, (py + py2) / 2, HH * 0.6 * f - 0.2), (cos(hz + pa2), sin(hz + pa2), 0), Z, SPINE, 0.7, 'ashlar', sh(ht, 1.35), 2.6 * f + 0.6)
        px, py, pa = px2, py2, pa2
    m.plate(P(px, py, 0.4), (cos(hz + pa), sin(hz + pa), 0), (-sin(hz + pa), cos(hz + pa), 0.25), [(-1, -0.6), (0, -3.4), (7, 0), (0, 3.4), (-1, 0.6)], 1.6, 'ashlar', sh(bas, 1.4))   # tail barb

    # ---- lesser buildings in the outer yard
    def hall(c, L, W, Hh, rz, tint):
        Rh = Matrix.Translation((c[0], c[1], 0)) @ Matrix.Rotation(rz, 4, 'Z'); Q = lambda x, y, z: Rh @ Vector((x, y, z))
        m.box(Q(0, 0, (Hh - 22) / 2), (L, W, Hh + 22), 'ashlar', tint, rz); m.box(Q(0, 0, Hh + 0.25), (L + 0.8, W + 0.9, 0.7), 'ashlar', trim, rz)
        m.gable_roof(c, L, W, Hh + 0.6, W * 0.58, rz, sh(slate, 0.9 + 0.3 * rnd.random()), tint)
        k = max(3, int(L / 6))
        for i in range(k): m.plate(Q(((i + 0.5) / k - 0.5) * L, 0, Hh + 0.6 + W * 0.58 - 0.15), (cos(rz), sin(rz), 0), Z, SPINE, 0.6, 'ashlar', sh(tint, 1.3), 1.5)
        nw = max(2, int(L / 8))
        for sd in (-1, 1):
            for i in range(nw): m.arch_win(Q(((i + 0.5) / nw - 0.5) * L, sd * W / 2, Hh * 0.22), rz + sd * PI / 2, 1.4, Hh * 0.55, tint, glow=rnd.random() < 0.7)
    hall((0, 93), 46, 12, 11, -0.03, sh(warm, 0.9)); hall((96, 40), 30, 11, 9.5, 2.06, sh(cold, 0.95)); hall((-86, 58), 26, 11, 10, 0.896, sh(bas, 0.9)); hall((28, -88), 28, 10, 8.5, 0.2, sh(warm, 1.0))
    hall((-50, 89), 30, 11, 9, 0.477, sh(cold, 1.0)); hall((103.4, -11.7), 30, 10, 10, 1.362, sh(warm, 0.92)); hall((-100, 26), 18, 9, 8, PI / 2, sh(bas, 1.05)); hall((-100, -24), 18, 9, 8, PI / 2, sh(warm, 1.0))
    sc = (80, -42); st = sh(cold, 1.05)                                                                                 # the sept
    m.drum((sc[0], sc[1], -22), 9.5, 36, 'ashlar', st, 7, smooth=False, rot=0.3); m.drum((sc[0], sc[1], 14), 10.2, 0.9, 'ashlar', trim, 7, smooth=False, rot=0.3, bot=True)
    m.dome((sc[0], sc[1], 14.9), 9.2, 'roof', slate, 14, 5, 1.05); m.cone((sc[0], sc[1], 24.2), 0.9, 7, 'ashlar', trim, 6)
    for i in range(7): a = 0.3 + (i + 0.5) / 7 * TAU; m.arch_win((sc[0] + cos(a) * 9.5 * cos(PI / 7), sc[1] + sin(a) * 9.5 * cos(PI / 7), 3.5), a, 1.5, 7.5, st)

    # ---- the causeway: out of the gate, along the brow, then down the western slope in long zig-zags to a jetty
    ctrl = [(GX - 8, 0), (-152, 0), (-182, -6), (-222, 12), (-262, 4), (-300, 26), (-342, 58), (-374, 80), (-414, 22), (-442, -46), (-456, -82), (-492, -22), (-516, 44), (-530, 76), (-562, 22), (-588, -18), (-606, -36), (-630, -52)]
    turns = (7, 10, 13); STEP = 6.0; cw = sh(bas, 1.12); HWY = 4.6; DEP = 26.0
    P2 = resample(chaikin(ctrl, 2), STEP); zs = [max(ground(p.x, p.y) + 0.5 + 1.6 * min(1.0, i * STEP / 50), SEA + 1.9) for i, p in enumerate(P2)]
    zs = [zs[i] if i in (0, len(zs) - 1) else (zs[i - 1] + 2 * zs[i] + zs[i + 1]) / 4 for i in range(len(zs))]
    P3 = [(p.x, p.y, zs[i]) for i, p in enumerate(P2)]
    N, D = m.strip(P3, HWY, DEP, cw)
    near = lambda q: min(range(len(P3)), key=lambda i: hypot(P3[i][0] - q[0], P3[i][1] - q[1]))
    for t in turns:                                                                                                    # a watch-turret on the outside of every bend
        cp = ctrl[t]; i = near(cp); q = P3[i]; a = atan2(cp[1] - q[1], cp[0] - q[0]); zq = q[2]; tt = tn(t)
        m.drum((cp[0], cp[1], zq - DEP), 7.4, DEP, 'ashlar', sh(tt, 0.9), 12, r2=6.0, top=False); m.drum((cp[0], cp[1], zq), 6.0, 10, 'ashlar', tt, 12, r2=5.5)
        m.drum((cp[0], cp[1], zq + 10), 6.5, 1.2, 'ashlar', trim, 12, bot=True)
        for k in range(12): b = (k + 0.5) / 12 * TAU; m.box((cp[0] + cos(b) * 6.1, cp[1] + sin(b) * 6.1, zq + 11.2 + 1.1), (0.7, 2.0, 2.2), 'ashlar', sh(tt, 1.2), b, top=0.6, ty=0.12)
        m.gargoyle((cp[0] + cos(a) * 5.0, cp[1] + sin(a) * 5.0, zq + 6.5), a, 1.9, trim, True)
        for k in (1, 2): m.slit(cp, 5.75 * cos(PI / 12), a + PI + (k - 1.5) * TAU / 12 * 2, zq + 5.5)
        crags(cp[0] + cos(a) * 9, cp[1] + sin(a) * 9, 8, 11, 13)
    for q, s in (((-176, -4), 2.3), ((-590, -20), 2.1)):                                                                 # dragon pylons at the head and foot of the stair
        i = near(q); p = Vector(P3[i]); nn = N[i].normalized()
        for sd in (-1, 1):
            c = p + nn * sd * (HWY + 2.4); m.drum((c.x, c.y, c.z - 18), 2.9, 18 + 4.6 * s, 'ashlar', sh(bas, 1.2), 8, r2=2.2); m.drum((c.x, c.y, c.z + 4.6 * s), 2.7, 0.7, 'ashlar', trim, 8, bot=True)
            m.gargoyle((c.x, c.y, c.z + 4.6 * s + 0.6), D[i], s, sh(bas, 1.35), True)
    for i in range(10, len(P3) - 6, 9):                                                                                 # rock breaking through along the flanks
        p = Vector(P3[i]); nn = N[i].normalized(); sd = 1 if (i // 9) % 2 else -1
        if p.x < -250: crags(p.x + nn.x * sd * 13, p.y + nn.y * sd * 13, 4, 6, 10)
    for sd in (-1, 1): crags(-292, 26 + sd * 44, 16, 20, 22)                                                            # the rock gates on the brow
    crags(-600, -8, 9, 12, 10); crags(-596, -58, 8, 10, 9)
    finish(m, 'dragonstone')

dragonstone()
print('DONE dragonstone')
