# A dragon designed and built in Blender, on the game's skeleton (public/impostors/rig_<id>.json from game.exportDragonRigs()).
#   Blender -b --factory-startup --python tools/blender/dragon_model.py -- <project dir> <id> [--preview <dir>] [--fast]
# Body, neck, tail, limbs and skull are modelled as overlapping anatomical volumes and fused into one skin (the jaw is a
# second piece so the mouth opens); horns, dorsal spines, teeth and claws are crisp separate pieces; wing membranes are
# sheets. Hide relief and colours are sculpted / painted procedurally and baked to albedo, normal and AO-roughness maps.
# Output: public/models/dragonfull_<id>.glb (+ _a.jpg _n.jpg _orm.jpg, .json with eye positions).
# All modelling below is in GAME coordinates (x left, y up, z forward); P() converts to Blender (z up, facing -Y).
import bpy, bmesh, sys, os, math, json
from mathutils import Vector
import numpy as np

args = sys.argv[sys.argv.index('--') + 1:]
proj, did = args[0], args[1]; FAST = '--fast' in args; NOBAKE = '--nobake' in args; PREVIEW = args[args.index('--preview') + 1] if '--preview' in args else None
OUT = os.path.join(proj, 'public', 'models'); rig = json.load(open(os.path.join(proj, 'public', 'impostors', f'rig_{did}.json')))
TS = 1024 if FAST else 4096; VOXEL = 0.06 if FAST else 0.032; TARGET = 60000
V = Vector; P = lambda v: Vector((v[0], -v[2], v[1])); TAU = math.tau
D = rig['def']; bk, hd, SPK = D['bulk'], D['head'], D['spike']; headZ, tailTip, sadZ = rig['headZ'], rig['tailTip'], rig['sadZ']
H = rig['head']; Lh, hz0, lipY, jawY = H['Lh'], H['hz0'], H['lipY'], H['jawY']; hzt = lambda t: hz0 + t * Lh
NAMES = [b['name'] for b in rig['bones']]; BPOS = {b['name']: V(b['head']) for b in rig['bones']}
clamp01 = lambda x: max(0.0, min(1.0, x)); lerp = lambda a, b, t: a + (b - a) * t; sstep = lambda t: t * t * (3 - 2 * t)
def curve(keys, x):
    if x <= keys[0][0]: return keys[0][1]
    for i in range(len(keys) - 1):
        (x0, v0), (x1, v1) = keys[i], keys[i + 1]
        if x <= x1: return v0 + (v1 - v0) * sstep((x - x0) / (x1 - x0))
    return keys[-1][1]

# ---------------------------------------------------------------- per-dragon design
SPECS = {
    # Drogon: a deep, broad wedge of a skull bristling with swept-back spines; two long horns among them; a fringe of spikes
    # under the jaw; great forward nostrils; small deep-set eyes; a sail of quills down the neck; charcoal hide, red only as a stain.
    'drogon': dict(
        base=(0.02, 0.019, 0.02), scale_hi=(0.09, 0.084, 0.08), accent=(0.13, 0.03, 0.02), belly=(0.075, 0.058, 0.05), mouth=(0.46, 0.12, 0.1), gum=(0.3, 0.09, 0.08),
        horn=((0.045, 0.035, 0.03), (0.3, 0.25, 0.2)), spine=((0.075, 0.02, 0.016), (0.03, 0.016, 0.015)), claw=((0.02, 0.018, 0.018), (0.14, 0.125, 0.11)), tooth=((0.5, 0.42, 0.3), (0.86, 0.82, 0.7)),
        head_len=0.86,
        skullW=[[-0.05, 0.1], [0, 0.66], [0.1, 0.96], [0.22, 1.06], [0.4, 0.9], [0.55, 0.68], [0.72, 0.56], [0.86, 0.53], [0.95, 0.47], [1, 0.3]],
        skullT=[[-0.05, 0.05], [0, 0.58], [0.12, 0.86], [0.25, 0.92], [0.4, 0.72], [0.55, 0.54], [0.75, 0.47], [0.88, 0.53], [0.96, 0.45], [1, 0.26]],
        jawB=[[0, 0.05], [0.06, 0.36], [0.18, 0.54], [0.32, 0.47], [0.6, 0.34], [0.85, 0.27], [0.96, 0.15]],
        eye_t=0.43, eye_r=0.092, mem_dark=(0.028, 0.012, 0.01), mem_mid=(0.2, 0.055, 0.034), mane_col=((0.03, 0.026, 0.024), (0.15, 0.125, 0.105)),
        # the long horns: (t, side offset, height fraction, direction, length, radius, bend)
        horns=[(0.04, 0.4, 0.84, (0.2, 0.14, -1), 2.6, 0.15, 0.1), (0.07, 0.66, 0.5, (0.42, 0.02, -1), 2.0, 0.125, 0.07), (0.1, 0.84, 0.18, (0.6, -0.12, -1), 1.5, 0.1, 0.03), (0.02, 0.16, 0.98, (0.08, 0.3, -1), 1.7, 0.11, 0.14)],
        mane=(0.56, 0.9), spine_h=1.0, quill=1.35),
}
SP = SPECS.get(did, SPECS['drogon'])
Lh = Lh * SP.get('head_len', 1.0)          # hzt() reads this: the skull is modelled shorter and deeper than the rig's nominal head
skW = lambda t: curve(SP['skullW'], t) * hd; skT = lambda t: curve(SP['skullT'], t) * hd
jawB = lambda t: curve(SP['jawB'], t) * hd
import random; RND = random.Random(7)
ET = SP['eye_t']; EYES = [V((sx * skW(ET) * 0.9, lipY + skT(ET) * 0.5, hzt(ET))) for sx in (1, -1)]

def spineY(z):
    if z > 2.6: return 0.68 * clamp01((z - 2.6) / (headZ - 2.6)) ** 1.25
    if z < -3.2: return -0.3 * clamp01((-3.2 - z) / (-3.2 - tailTip))
    return 0.0
def body_r(z):       # (half width, top, bottom)
    if z < -3.2:
        r = curve([[0, 1.3], [0.08, 1.16], [0.25, 0.86], [0.5, 0.52], [0.78, 0.27], [0.95, 0.1], [1, 0.03]], (-3.2 - z) / (-3.2 - tailTip)) * bk; return r * 0.9, r * 1.04, r * 0.9
    if z <= 3.4:
        return (curve([[-3.2, 1.17], [-2.2, 1.5], [-1.0, 1.36], [0.2, 1.6], [1.5, 1.98], [2.5, 1.76], [3.4, 1.2]], z) * bk,
                curve([[-3.2, 1.27], [-2, 1.46], [-0.6, 1.44], [1.4, 1.68], [2.6, 1.58], [3.4, 1.16]], z) * bk,
                curve([[-3.2, 1.17], [-2.2, 1.3], [-1.0, 1.26], [0.2, 1.6], [1.2, 1.98], [2.1, 2.02], [2.9, 1.68], [3.4, 1.26]], z) * bk)
    r = curve([[0, 1.18], [0.15, 0.98], [0.4, 0.88], [0.7, 0.8], [1, 0.76]], (z - 3.4) / (headZ - 3.4)) * lerp(bk, 1, 0.5); return r * 0.94, r, r * 1.1
FWD = ['root', 'chest'] + [f'neck{i}' for i in range(rig['NECK_N'])] + ['head']; BACK = ['root', 'hip'] + [f'tail{i}' for i in range(rig['TAIL_N'])]
def chain_w(chain, z, d):
    zs = [BPOS[n].z for n in chain]; k = 0
    while k < len(chain) - 1 and (z - zs[k + 1]) * d >= 0: k += 1
    z0 = zs[k]; z1 = zs[k + 1] if k < len(chain) - 1 else z0 + d; t = clamp01((z - z0) / (z1 - z0)); b = chain[k]
    if t < 0.5: return {b: 1.0} if k == 0 else {b: 0.5 + t, chain[k - 1]: 0.5 - t}
    return {b: 1.0} if k == len(chain) - 1 else {b: 1.5 - t, chain[k + 1]: t - 0.5}
spine_w = lambda z: chain_w(FWD, z, 1) if z >= 0 else chain_w(BACK, z, -1)
def wmix(a, b, t):
    out = {}
    for d, f in ((a, 1 - t), (b, t)):
        for k, v in d.items(): out[k] = out.get(k, 0) + v * f
    return out

# ---------------------------------------------------------------- mesh accumulation
class Mesh:
    def __init__(self): self.v, self.f, self.w, self.c, self.uv = [], [], [], [], []
    def vert(self, p, w, c=None, uv=None): self.v.append(V(p)); self.w.append(w); self.c.append(c); self.uv.append(uv); return len(self.v) - 1
    def rings(self, rings, wts, cols=None, caps=(True, True)):
        idx = []
        for k, ring in enumerate(rings):
            idx.append([self.vert(p, wts[k] if isinstance(wts[k], dict) else wts[k][i], None if cols is None else cols[k]) for i, p in enumerate(ring)])
        n = len(rings[0])
        for k in range(len(rings) - 1):
            for i in range(n): self.f.append((idx[k][i], idx[k][(i + 1) % n], idx[k + 1][(i + 1) % n], idx[k + 1][i]))
        for end, flag in ((0, caps[0]), (-1, caps[1])):
            if not flag: continue
            c = sum(rings[end], V((0, 0, 0))) / n; w = wts[end] if isinstance(wts[end], dict) else wts[end][0]
            ci = self.vert(c, w, None if cols is None else cols[end])
            for i in range(n): self.f.append((idx[end][i], idx[end][(i + 1) % n], ci))
    def tube(self, nodes, sides=14, up=V((0, 1, 0)), cols=None):
        # nodes: (p, r_side, r_up or None, weights). Elliptical rings in the plane across the path.
        rings, wts = [], []
        for i, (p, r, ru, w) in enumerate(nodes):
            p = V(p); a = V(nodes[max(0, i - 1)][0]); b = V(nodes[min(len(nodes) - 1, i + 1)][0]); t = (b - a).normalized()
            s = t.cross(up); s = s.normalized() if s.length > 1e-4 else V((1, 0, 0)); u = s.cross(t).normalized()
            rings.append([p + s * (math.cos(TAU * j / sides) * r) + u * (math.sin(TAU * j / sides) * (ru if ru else r)) for j in range(sides)]); wts.append(w)
        self.rings(rings, wts, cols)
    def blob(self, c, radii, w, axes=None, nu=18, nv=10):
        c = V(c); ax = axes or (V((1, 0, 0)), V((0, 1, 0)), V((0, 0, 1))); rings = []
        for j in range(1, nv):
            ph = math.pi * j / nv
            rings.append([c + ax[0] * (math.sin(ph) * math.cos(TAU * i / nu) * radii[0]) + ax[1] * (math.cos(ph) * radii[1]) + ax[2] * (math.sin(ph) * math.sin(TAU * i / nu) * radii[2]) for i in range(nu)])
        self.rings(rings, [w] * len(rings))
    def along(self, a, b, radii, w, off=(0, 0, 0)):      # a muscle belly lying along a→b: radii = (half length factor, thickness, thickness)
        a, b = V(a), V(b); d = b - a; L = d.length; t = d / L; s = t.cross(V((0, 1, 0))); s = s.normalized() if s.length > 1e-3 else V((1, 0, 0)); u = s.cross(t)
        self.blob((a + b) / 2 + V(off), (radii[1], L * radii[0], radii[2]), w, (s, t, u))
    def horn(self, base, d, L, r, w, col, bend=0.0, side=V((1, 0, 0)), flat=1.0, sides=8, n=12, ringed=True):
        base = V(base); d = V(d).normalized(); upv = side.cross(d); upv = upv.normalized() if upv.length > 1e-3 else V((0, 1, 0)); sd = d.cross(upv).normalized(); rings, cols = [], []
        for k in range(n + 1):
            s = k / n; p = base + d * (L * s) + upv * (bend * L * s * s) - d * (bend * L * 0.3 * s * s)
            rr = max(0.004, r * (1 - s) ** 0.75 * (1 + (0.06 * math.sin(s * 34) if ringed and s < 0.75 else 0)))
            rings.append([p + sd * (math.cos(TAU * j / sides) * rr * flat) + upv * (math.sin(TAU * j / sides) * rr) for j in range(sides)])
            cc = [lerp(col[0][i], col[1][i], s ** 1.4) for i in range(3)]; cols.append(cc)
        self.rings(rings, [w] * (n + 1), cols, caps=(True, True))
    def obj(self, name, with_col=False, with_uv=False):
        bm = bmesh.new(); dl = bm.verts.layers.deform.verify(); vs = []
        for p, w in zip(self.v, self.w):
            v = bm.verts.new(P(p)); vs.append(v); tot = sum(w.values()) or 1
            for k, x in w.items():
                if x > 0: v[dl][NAMES.index(k)] = x / tot
        cl = bm.loops.layers.float_color.new('Col') if with_col else None; ul = bm.loops.layers.uv.new('UVMap') if with_uv else None
        for f in self.f:
            if len(set(f)) < 3: continue
            try: bf = bm.faces.new([vs[i] for i in f])
            except ValueError: continue
            for l, i in zip(bf.loops, f):
                if cl is not None: l[cl] = (*(self.c[i] or (1, 1, 1)), 1)
                if ul is not None: l[ul].uv = self.uv[i] or (0, 0)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
        if with_col: me.color_attributes.active_color = me.color_attributes['Col']; me.color_attributes.render_color_index = me.color_attributes.find('Col')
        o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o)
        for n in NAMES: o.vertex_groups.new(name=n)
        return o

body, jawm, hard, mem = Mesh(), Mesh(), Mesh(), Mesh(); MEMCELL = [0]
HEAD, JAW = {'head': 1.0}, {'jaw': 1.0}

# ---------------------------------------------------------------- trunk: tail → body → neck
zs = [lerp(tailTip, -3.2, (i / 44) ** 0.9) for i in range(45)] + [lerp(-3.2, 3.4, i / 30) for i in range(1, 31)] + [lerp(3.4, headZ + 0.3, i / 28) for i in range(1, 29)]
NS = 36; rings, wts = [], []
for z in zs:
    rx, rt, rb = body_r(z); sy = spineY(z); ring = []
    for i in range(NS):
        th = TAU * i / NS; s, c = math.sin(th), math.cos(th)
        ridge = 0.07 * bk * math.exp(-(min(th, TAU - th) / 0.2) ** 2) * (1 if z > tailTip * 0.9 else 0)
        ring.append(V((rx * math.copysign(abs(s) ** 0.86, s), sy + (rt if c >= 0 else rb) * math.copysign(abs(c) ** 0.9, c) + ridge, z)))
    rings.append(ring); wts.append(spine_w(z))
body.rings(rings, wts)

# ---------------------------------------------------------------- skull and jaw
def skull_pt(t, th):          # point on the upper skull at lateral angle th (0 = crown, ±pi/2 = lip line) and its outward normal
    W, T = skW(t), skT(t); s, c = math.sin(th), max(0.0, math.cos(th))
    return V((W * math.copysign(abs(s) ** 0.7, s), lipY + T * c ** 0.6, hzt(t))), V((s * T, c * W + 1e-4, 0)).normalized()
ts = [lerp(-0.045, 1.0, i / 40) for i in range(41)]; rings = []
for t in ts:
    W = skW(t); ring = []; arch = 0.12 * hd * sstep(clamp01((t - 0.1) / 0.18)) * (1 - sstep(clamp01((t - 0.9) / 0.1)))
    for k in range(21): ring.append(skull_pt(t, -math.pi / 2 + math.pi * k / 20)[0])
    for k in range(1, 10):
        x = W * (1 - 2 * k / 10); ring.append(V((x, lipY - 0.02 * hd + arch * (1 - (x / max(W, 1e-3)) ** 2), hzt(t))))
    rings.append(ring[::-1])
body.rings(rings, [HEAD] * len(rings))
for sx in (1, -1):
    eye = EYES[0 if sx > 0 else 1]
    body.blob(eye + V((-sx * 0.02, 0.27 * hd, -0.06)), (0.2 * hd, 0.1 * hd, 0.52 * hd), HEAD, (V((1, 0, 0)), V((0, 1, 0.22)).normalized(), V((sx * 0.3, -0.22, 1)).normalized()))    # heavy brow
    body.blob(eye + V((sx * 0.02, -0.22 * hd, 0.08)), (0.13 * hd, 0.08 * hd, 0.36 * hd), HEAD)                                                                                # cheekbone under the eye
    body.blob((sx * skW(0.14) * 0.84, lipY + 0.2 * hd, hzt(0.14)), (0.28 * hd, 0.4 * hd, 0.56 * hd), HEAD)                                                                    # jaw muscle
    np_ = skull_pt(0.95, sx * 0.75)[0]
    body.blob(np_ + V((sx * 0.07 * hd, 0.05 * hd, -0.08 * hd)), (0.08 * hd, 0.075 * hd, 0.2 * hd), HEAD, nu=12, nv=8); body.blob(np_ + V((-sx * 0.1 * hd, 0.06 * hd, -0.06 * hd)), (0.065 * hd, 0.06 * hd, 0.18 * hd), HEAD, nu=12, nv=8)                                                                  # nostril rim
    body.blob((sx * skW(0.62) * 0.84, lipY + 0.08 * hd, hzt(0.64)), (0.1 * hd, 0.11 * hd, 0.8 * hd), HEAD)                                                                    # upper lip
    for i in range(7):                                                                                                                                                         # knobbled ridges running to the nostrils
        t = 0.5 + i * 0.058; body.blob(skull_pt(t, sx * 0.42)[0] + V((0, 0.01, 0)), (0.075 * hd, 0.06 * hd, 0.1 * hd), HEAD, nu=10, nv=6)
for t in (0.03, 0.12, 0.22, 0.34, 0.5, 0.6, 0.7, 0.8): body.blob((0, lipY + skT(t) * 1.0, hzt(t)), (0.11 * hd, 0.08 * hd, 0.15 * hd), HEAD, nu=12, nv=8)                      # crest and nasal keel
rings = []
for i in range(33):
    t = lerp(0.05, 0.975, i / 32); W = skW(t) * (0.9 if t > 0.15 else 0.9 * (0.6 + 0.4 * t / 0.15)); B = jawB(t); z = hzt(t); ring = []
    for k in range(19):
        th = -math.pi / 2 + math.pi * k / 18; sn_, c = math.sin(th), max(0.0, math.cos(th)); ring.append(V((W * math.copysign(abs(sn_) ** 0.8, sn_), jawY - B * c ** 0.75, z)))
    for k in range(1, 10):
        x = W * (1 - 2 * k / 10); ring.append(V((x, jawY - 0.08 * hd * (1 - (x / max(W, 1e-3)) ** 2) * sstep(clamp01((t - 0.12) / 0.15)), z)))
    rings.append(ring)
jawm.rings(rings, [JAW] * len(rings))
jawm.blob((0, jawY - jawB(0.9) * 0.8, hzt(0.9)), (0.24 * hd, 0.13 * hd, 0.22 * hd), JAW)                                                                                        # chin
for sx in (1, -1): jawm.blob((sx * skW(0.2) * 0.8, jawY - jawB(0.2) * 0.55, hzt(0.2)), (0.16 * hd, 0.26 * hd, 0.5 * hd), JAW)                                                  # jaw angle
jawm.tube([((0, jawY - 0.03 * hd, hzt(0.2)), 0.22 * hd, 0.06 * hd, JAW), ((0, jawY, hzt(0.45)), 0.2 * hd, 0.06 * hd, JAW), ((0, jawY, hzt(0.68)), 0.14 * hd, 0.045 * hd, JAW), ((0, jawY - 0.01 * hd, hzt(0.84)), 0.04 * hd, 0.02 * hd, JAW)], 10)

# ---------------------------------------------------------------- limbs
keel = [(3.2, 0.1), (2.7, 0.3), (2.0, 0.4), (1.2, 0.38), (0.4, 0.26), (-0.2, 0.1)]
body.tube([((0, -body_r(z)[2] + r * bk * 0.62, z), r * bk, None, {'chest': 1} if z > 1.0 else {'chest': 0.5, 'root': 0.5}) for z, r in keel], 20)
thro = [(headZ - 0.3, 0.14), (headZ - 0.9, 0.34), (6.0, 0.4), (4.6, 0.5), (3.6, 0.5), (3.0, 0.2)]
body.tube([((0, spineY(z) - body_r(z)[2] + r * 0.6, z), r, None, spine_w(z)) for z, r in thro], 20)
for key, sx in (('L', 1), ('R', -1)):
    J = {k: (V(v) if not isinstance(v[0], list) else [V(q) for q in v]) for k, v in rig['joints'][key].items()}
    S, E, Wr, fm, ft, HJ, K, A, T = J['S'], J['E'], J['W'], J['fm'], J['ft'], J['HJ'], J['K'], J['A'], J['T']
    ch, hu, fo, ha, hp, thb, shb, ftb = 'chest', 'hum' + key, 'fore' + key, 'hand' + key, 'hip', 'thigh' + key, 'shin' + key, 'foot' + key
    # wing arm: heavy shoulder, tapering humerus and forearm, knuckled wrist
    body.tube([((sx * 0.45 * bk, 0.75, 2.2), 0.8, None, {ch: 1}), (S, 0.95, 0.84, {ch: 0.5, hu: 0.5}), (S.lerp(E, 0.4), 0.78, 0.64, {hu: 1}), (S.lerp(E, 0.8), 0.56, 0.5, {hu: 1}), (E, 0.5, None, {hu: 0.5, fo: 0.5}),
               (E.lerp(Wr, 0.35), 0.5, 0.42, {fo: 1}), (E.lerp(Wr, 0.8), 0.37, 0.33, {fo: 1}), (Wr, 0.36, None, {fo: 0.5, ha: 0.5}), (Wr + V((sx * 0.32, 0, 0.12)), 0.12, None, {ha: 1})], 16)
    body.blob(S + V((-sx * 0.3 * bk, 0.05, -0.12)), (0.98 * bk, 0.82 * bk, 1.3 * bk), {ch: 0.65, hu: 0.35})                    # deltoid
    body.blob((sx * 0.64 * bk, -0.74 * bk, 1.9), (0.86 * bk, 1.02 * bk, 1.7 * bk), {ch: 1})                                    # pectoral / keel
    body.blob((sx * 0.72 * bk, 1.22 * bk, 1.75), (0.5 * bk, 0.36 * bk, 1.15 * bk), {ch: 1})                                    # scapula
    body.along(S, E, (0.34, 0.5, 0.56), {hu: 1}, (0, 0.02, 0.26)); body.along(S, E, (0.3, 0.42, 0.46), {hu: 1}, (0, -0.05, -0.28))   # biceps, triceps
    body.along(E, Wr, (0.3, 0.36, 0.4), {fo: 1}, (-sx * 0.5, 0, 0.14))
    body.blob(E, (0.5, 0.45, 0.5), {hu: 0.5, fo: 0.5}); body.blob(Wr, (0.4, 0.35, 0.42), {fo: 0.5, ha: 0.5})
    th0 = Wr + V((sx * 0.1, 0.04, 0.2)); th1 = th0 + V((sx * 0.22, 0.06, 0.7))                                                 # thumb and its hooked claw
    body.tube([(th0, 0.2, None, {ha: 1}), (th0.lerp(th1, 0.6), 0.16, None, {ha: 1}), (th1, 0.12, None, {ha: 1})], 10)
    hard.horn(th1 - V((0, 0, 0.12)), (sx * 0.2, 0.45, 1), 1.4, 0.17, {ha: 1}, SP['claw'], bend=-0.5, side=V((1, 0, 0)), flat=0.7, n=14)
    for k in range(4):
        fa, fb = f'f{k}a{key}', f'f{k}b{key}'
        body.tube([(Wr, 0.2, None, {ha: 0.5, fa: 0.5}), (Wr.lerp(fm[k], 0.5), 0.165, None, {fa: 1}), (fm[k], 0.15, None, {fa: 0.5, fb: 0.5}), (fm[k].lerp(ft[k], 0.5), 0.105, None, {fb: 1}),
                   (fm[k].lerp(ft[k], 0.93), 0.055, None, {fb: 1}), (ft[k], 0.02, None, {fb: 1})], 10)
        body.blob(fm[k], (0.21, 0.19, 0.21), {fa: 0.5, fb: 0.5}, nu=12, nv=8)
        dt = (ft[k] - fm[k]).normalized(); hard.horn(ft[k] - dt * 0.12, dt + V((0, -0.2, 0)), 0.6, 0.06, {fb: 1}, SP['claw'], bend=-0.2, side=V((0, 1, 0)).cross(dt), n=8)
    # hind leg: massive thigh, drawn-up shin, bird-like foot
    # ---- hind leg, built like a great raptor's: broad flat thigh, drawn-up knee, calf tapering to a tendon, knobbed hock, long toes
    lk = bk * 1.2; up = V((0, 0, 1))
    body.tube([((sx * 0.35 * bk, -0.1, -1.7), 0.75 * lk, 1.0 * lk, {hp: 1}), (HJ, 0.84 * lk, 1.5 * lk, {hp: 0.5, thb: 0.5}), (HJ.lerp(K, 0.3), 0.8 * lk, 1.42 * lk, {thb: 1}), (HJ.lerp(K, 0.65), 0.66 * lk, 1.04 * lk, {thb: 1}),
               (HJ.lerp(K, 0.9), 0.52 * lk, 0.66 * lk, {thb: 1}), (K, 0.5 * lk, 0.58 * lk, {thb: 0.5, shb: 0.5}), (K.lerp(A, 0.2), 0.47 * lk, 0.7 * lk, {shb: 1}), (K.lerp(A, 0.45), 0.39 * lk, 0.58 * lk, {shb: 1}),
               (K.lerp(A, 0.75), 0.26 * lk, 0.31 * lk, {shb: 1}), (A, 0.29 * lk, 0.35 * lk, {shb: 0.5, ftb: 0.5}), (A.lerp(T, 0.5), 0.23 * lk, 0.25 * lk, {ftb: 1}), (T, 0.34 * lk, 0.26 * lk, {ftb: 1}), (T + V((0, -0.05, 0.3)), 0.16 * lk, None, {ftb: 1})], 18, up)
    body.blob(HJ + V((-sx * 0.05, 0.35, -0.25)), (0.86 * lk, 1.0 * lk, 1.32 * lk), {hp: 0.55, thb: 0.45})                                       # haunch
    body.along(HJ + V((sx * 0.1, 0, 0.4)), K + V((0, 0.28, 0.12)), (0.42, 0.5 * lk, 0.44 * lk), {thb: 1})                                        # quadriceps
    body.along(HJ + V((0, -0.1, -0.6)), K + V((0, 0.32, -0.36)), (0.4, 0.44 * lk, 0.46 * lk), {thb: 1})                                          # hamstring
    body.along(K + V((0, -0.12, -0.32)), K.lerp(A, 0.55) + V((0, 0, -0.16)), (0.46, 0.36 * lk, 0.44 * lk), {shb: 1})                             # calf
    body.blob(K + V((0, 0.02, 0.24)), (0.4 * lk, 0.36 * lk, 0.34 * lk), {thb: 0.5, shb: 0.5}, nu=12, nv=8)                                       # knee
    body.blob(A + V((0, 0.06, -0.16)), (0.3 * lk, 0.34 * lk, 0.4 * lk), {shb: 0.5, ftb: 0.5}, nu=12, nv=8)                                       # hock
    body.along(HJ + V((-sx * 0.25, 0.1, -0.4)), V((sx * 0.4 * bk, -0.3, -4.9)), (0.5, 0.52 * bk, 0.6 * bk), {hp: 0.6, 'tail0': 0.4})             # the muscle tying thigh to tail
    body.blob((sx * 0.72 * bk, 0.98 * bk, -1.9), (0.58 * bk, 0.42 * bk, 1.05 * bk), {hp: 1})                                                     # hip crest
    hard.horn(A + V((0, 0.05, -0.22)), (0, 0.3, -1), 0.85, 0.14 * bk, {ftb: 1}, SP['claw'], bend=0.15)                                           # hock spur
    for ang, ln in ((0.0, 1.3), (0.5, 1.14), (-0.5, 1.14), (math.pi, 0.8)):
        dx, dz = math.sin(ang) * sx, math.cos(ang); a = T + V((0, -0.03, 0)); pts = [a]
        for f, drop in ((0.4, -0.06), (0.75, -0.15), (1.0, -0.3)): pts.append(a + V((dx * ln * f, drop, dz * ln * f)))
        body.tube([(pts[0], 0.2 * bk, 0.17 * bk, {ftb: 1}), (pts[1], 0.17 * bk, 0.15 * bk, {ftb: 1}), (pts[2], 0.15 * bk, 0.13 * bk, {ftb: 1}), (pts[3], 0.11 * bk, 0.1 * bk, {ftb: 1})], 10)
        for q in pts[1:3]: body.blob(q + V((0, 0.02, 0)), (0.2 * bk, 0.17 * bk, 0.2 * bk), {ftb: 1}, nu=10, nv=6)                                # knuckles
        hard.horn(pts[3] - (pts[3] - pts[2]).normalized() * 0.12, (dx, -0.25, dz), 0.85, 0.135 * bk, {ftb: 1}, SP['claw'], bend=-0.45, side=V((0, 1, 0)).cross(V((dx, 0, dz))), flat=0.72, n=12)
    # ---- trunk definition on this side: ribs, the cords of the neck, the root of the neck over the shoulder
    for i in range(6):
        z = 2.5 - i * 0.56; rx, rt, rb = body_r(z); body.blob((sx * rx * 0.8, spineY(z) - 0.1, z), (0.3 * bk, (rt + rb) * 0.4, 0.26 * bk), spine_w(z), nu=16, nv=12)
    body.tube([((sx * 0.4, spineY(headZ - 0.2) + 0.2, headZ - 0.2), 0.12, None, spine_w(headZ - 0.2)), ((sx * 0.42, spineY(headZ - 0.6) + 0.2, headZ - 0.6), 0.3, None, spine_w(headZ - 0.6)), ((sx * 0.52, spineY(6.2) + 0.05, 6.2), 0.38, None, spine_w(6.2)), ((sx * 0.66, 0.2, 4.6), 0.46, None, spine_w(4.6)), ((sx * 0.9 * bk, 0.3, 3.0), 0.6, None, spine_w(3.0)), ((sx * 0.9 * bk, 0.3, 2.5), 0.2, None, spine_w(2.5))], 18)
    body.blob((sx * 0.6 * bk, 0.95 * bk, 2.9), (0.55 * bk, 0.45 * bk, 0.95 * bk), {ch: 1})
    # ---- membranes (sheets): three finger panels, the inner panel to the flank, the leading propatagium
    def spoke(k, r):
        wH = clamp01(1 - r / 0.14) * 0.5; wF = clamp01((r - 0.38) / 0.24)
        p = Wr.lerp(fm[k], r / 0.5) if r <= 0.5 else fm[k].lerp(ft[k], (r - 0.5) / 0.5); return p, {ha: wH, f'f{k}a{key}': max(0, 1 - wH - wF), f'f{k}b{key}': wF}
    def grid(nu, nv, fn, fold=None):
        # each sheet gets its own cell of a 4x3 atlas; the colour attribute carries (shade, across, along) for the bake material
        c = MEMCELL[0]; MEMCELL[0] += 1; cx, cy = c % 4, c // 4
        ix = [[None] * (nv + 1) for _ in range(nu + 1)]
        for i in range(nu + 1):
            for j in range(nv + 1):
                a_, r_ = i / nu, j / nv; p, w, uv, shade = fn(a_, r_)
                if fold: p = p + V((0, fold(a_, r_), 0))
                ix[i][j] = mem.vert(p, w, (shade, a_, r_), ((cx + 0.02 + 0.96 * a_) / 4, (cy + 0.02 + 0.96 * r_) / 3))
        for i in range(nu):
            for j in range(nv): mem.f.append((ix[i][j], ix[i + 1][j], ix[i + 1][j + 1], ix[i][j + 1]))
    for k in range(3):
        def fn(a, r, k=k):
            rr = r * (1 - 0.3 * math.sin(math.pi * a) ** 0.8 * r * r); pa, wa = spoke(k, rr); pb, wb = spoke(k + 1, rr); p = pa.lerp(pb, a); p.y += 0.1 * math.sin(math.pi * a) * r
            return p, wmix(wa, wb, a), ((k + a) * 0.8, rr * 2.4), 0.62 + 0.38 * math.sin(math.pi * a) ** 0.7
        grid(20, 36, fn, lambda a, r, k=k: (0.075 * math.sin(a * math.pi * 9 + k * 1.7) * math.sin(math.pi * a) ** 0.5 + 0.028 * math.sin(a * 37 + r * 5)) * r)
    cp = [S, E, Wr, fm[3], ft[3]]; cb = [hu, fo, f'f3a{key}', f'f3b{key}']; sl = [(cp[i + 1] - cp[i]).length for i in range(4)]; tot = sum(sl)
    def chain_at(u):
        d = u * tot; k = 0
        while k < 3 and d > sl[k]: d -= sl[k]; k += 1
        t = clamp01(d / sl[k]); p = cp[k].lerp(cp[k + 1], t)
        if t < 0.2 and k > 0: w = {cb[k]: 0.5 + t * 2.5, cb[k - 1]: 0.5 - t * 2.5}
        elif t > 0.8 and k < 3: w = {cb[k]: 0.5 + (1 - t) * 2.5, cb[k + 1]: 0.5 - (1 - t) * 2.5}
        else: w = {cb[k]: 1}
        return p, w
    FA, FB = V((sx * 1.2 * bk, 0.7, 1.75)), V((sx * 0.8 * bk, 0.1, -5.0))
    def fn_in(v, u):
        uu = u * (1 - 0.17 * math.sin(math.pi * v) * u); p0, w0 = chain_at(uu); fp = FA.lerp(FB, sstep(uu)); fp.x = sx * max(abs(fp.x), body_r(fp.z)[0] * 0.93)
        p = p0.lerp(fp, v); p.y += 0.12 * math.sin(math.pi * v) * uu; return p, wmix(w0, spine_w(fp.z), v), (2.4 + v * 1.6, uu * 2.4), 0.6 + 0.4 * math.sin(math.pi * v) ** 0.7
    grid(24, 40, fn_in, lambda v, u: (0.08 * math.sin(v * math.pi * 8) * math.sin(math.pi * v) ** 0.5 + 0.03 * math.sin(v * 31 + u * 4)) * u)
    A0 = V((sx * 0.8 * bk, 1.1, 3.4)); l1, l2 = sl[0], sl[1]
    def fn_pro(v, u):
        d = u * (l1 + l2)
        if d < l1: t = d / l1; p0, w0 = S.lerp(E, t), {hu: 1 - t * 0.5, fo: t * 0.5}
        else: t = (d - l1) / l2; p0, w0 = E.lerp(Wr, t), {fo: 1 - t * 0.5, ha: t * 0.5}
        lead = A0.lerp(Wr, u); lead.z += 0.45 * math.sin(math.pi * u); lead.y -= 0.1 * math.sin(math.pi * u)
        p = p0.lerp(lead, v * (1 - 0.12 * math.sin(math.pi * u))); w = {k2: x * (1 - v * 0.55) for k2, x in w0.items()}; w[ch] = w.get(ch, 0) + v * 0.55 * (1 - u); w[fo] = w.get(fo, 0) + v * 0.55 * u
        return p, w, (v * 0.8, u * 2), 0.66 + 0.2 * v
    grid(8, 16, fn_pro)

# ---------------------------------------------------------------- horns, mane of spines, jaw fringe, crest quills, teeth
rj = lambda a, b: a + (b - a) * RND.random()
for sx in (1, -1):
    for t, ox, hf, d, L, r, bend in SP['horns']:
        base = V((sx * ox * hd, lipY + skT(t) * hf, hzt(t))); dv = V((sx * d[0], d[1], d[2]))
        hard.horn(base - dv.normalized() * 0.14 * hd, dv, L * hd, r * hd, HEAD, SP['horn'], bend=bend, side=V((0, 1, 0)).cross(dv), sides=10, n=18)
        body.blob(base, (r * hd * 1.8, r * hd * 1.6, r * hd * 2.0), HEAD, nu=12, nv=8)
# the mane: rows of spine-scales sweeping back over brow, crown and cheeks, lengthening toward the nape
t0, Lmax = SP['mane']; row = 0; t = t0
while t > -0.03:
    f = ((t0 - t) / (t0 + 0.03)) ** 1.25; Lb = lerp(0.14, Lmax, f); step = 0.15 + 0.04 * f
    th = -1.4 + (0.5 * step if row % 2 else 0)
    while th < 1.4:
        p, nrm = skull_pt(t, th); near_eye = abs(t - ET) < 0.075 and abs(abs(th) - 1.05) < 0.4
        if not near_eye and not (abs(th) < 0.12 and row % 2 == 0):
            ln = Lb * rj(0.5, 1.45) * (1 - 0.3 * abs(th) / 1.4); dv = (nrm * rj(0.3, 0.6) + V((math.sin(th) * 0.3 + rj(-0.15, 0.15), rj(0.0, 0.25), -1))).normalized()
            hard.horn(p - dv * 0.05 * hd + nrm * 0.02, dv, ln * hd, (0.022 + 0.028 * ln) * hd, HEAD, SP['mane_col'], bend=rj(0.04, 0.3), side=V((0, 1, 0)).cross(dv) if abs(th) < 1.0 else V((0, 0, 1)), flat=0.62, sides=6, n=7, ringed=False)
        th += step * rj(0.85, 1.15)
    t -= 0.042 + 0.01 * f; row += 1
for sx in (1, -1):
    eye = EYES[0 if sx > 0 else 1]
    for i in range(6):                                                                                                         # a row of spikes crowning each brow
        hard.horn(eye + V((-sx * 0.04 * hd, 0.3 * hd, (0.2 - i * 0.13) * hd)), (sx * rj(0.3, 0.55), 0.75, -0.7), lerp(0.24, 0.55, i / 5) * rj(0.8, 1.2) * hd, 0.05 * hd, HEAD, SP['mane_col'], bend=0.15, side=V((1, 0, 0)), flat=0.7, sides=6, n=7, ringed=False)
    t = 0.5
    while t < 0.92:                                                                                                            # rough studs over the snout
        th = 0.18
        while th < 1.25:
            p, nrm = skull_pt(t + rj(-0.01, 0.01), sx * th)
            hard.horn(p - nrm * 0.02 * hd, nrm * 0.9 + V((0, 0, -0.55)), rj(0.06, 0.14) * hd, rj(0.032, 0.05) * hd, HEAD, SP['mane_col'], sides=5, n=3, ringed=False)
            th += rj(0.2, 0.34)
        t += rj(0.035, 0.055)
for sx in (1, -1):
    for i in range(9):                                                                                                         # cheek frill fanning from the jaw hinge
        a = lerp(-0.55, 0.75, i / 8); ln = lerp(1.15, 0.6, abs(i - 3) / 5) * rj(0.85, 1.15); w = HEAD if a > -0.1 else JAW
        hard.horn((sx * skW(0.1) * 0.93, lipY + a * 0.45 * hd, hzt(0.09 + 0.02 * (i % 2))), (sx * 0.72, a * 0.55, -1), ln * hd, 0.07 * hd, w, SP['horn'], bend=0.08, side=V((0, 0, 1)), flat=0.5, sides=6, n=8, ringed=False)
    for i in range(11):                                                                                                        # the beard: spikes fringing the lower jaw
        t = 0.16 + i * 0.072
        for k, fx in enumerate((0.86, 0.45)):
            ln = (0.44 - i * 0.016) * rj(0.75, 1.25) * (1.0 if k == 0 else 0.8)
            hard.horn((sx * skW(t) * 0.9 * fx, jawY - jawB(t) * (0.6 if k == 0 else 0.95), hzt(t + 0.02 * k)), (sx * (0.75 if k == 0 else 0.3), -0.7, -0.62), ln * hd, 0.045 * hd, JAW, SP['horn'], bend=0.12, side=V((0, 0, 1)), flat=0.6, n=7, sides=6, ringed=False)
    for i in range(6):                                                                                                         # studs along the upper lip and snout flank
        t = 0.34 + i * 0.1; hard.horn(skull_pt(t, sx * 1.12)[0], (sx * 1, 0.3, -0.7), rj(0.16, 0.26) * hd, 0.045 * hd, HEAD, SP['horn'], n=5, sides=6, ringed=False)
def spine_h(z):
    if z > 3.4: return lerp(0.85, SP['quill'], ((z - 3.4) / (headZ - 3.4)) ** 0.8)
    if z > -3.2: return curve([[-3.2, 0.62], [-2, 0.66], [1.5, 0.74], [3.4, 0.85]], z)
    return lerp(0.62, 0.14, clamp01((-3.2 - z) / (-3.2 - tailTip)) ** 0.8)
z = headZ + 0.05; n = 0; crest = []
while z > tailTip * 0.975:
    neckf = clamp01((z - 3.0) / 1.0); h = spine_h(z) * SPK * SP['spine_h'] * rj(0.82, 1.15)
    if abs(z - sadZ) < 0.85: z -= 0.4; continue
    rx, rt, _ = body_r(z); top = spineY(z) + rt; w = spine_w(z)
    if z > -3.2:
        # quills: tall, thin, close-set; three staggered files along the neck, one along the back
        ox = (0.0, 0.11, -0.11)[n % 3] * neckf * bk; base = V((ox, top - 0.1, z)); dv = V((ox * 1.2, 0.8, -0.62)).normalized()
        hard.horn(base, dv, h * 1.3, 0.05 + 0.055 * h, w, SP['spine'], bend=-0.1, side=V((1, 0, 0)), flat=0.3, sides=6, n=9, ringed=False)
        if n % 3 == 0 or neckf < 0.5: crest.append((V((0, top - 0.05, z)), V((0, top - 0.05, z)) + V((0, 0.8, -0.62)).normalized() * h * 0.8, w))
        z -= lerp(0.3, 0.17, neckf) + h * 0.12
    else:
        # the tail carries broad triangular plates
        hard.horn(V((0, top - 0.08, z)), (0, 0.75, -0.66), h * 1.25, 0.1 + 0.2 * h, w, SP['spine'], bend=-0.1, side=V((1, 0, 0)), flat=0.16, sides=8, n=7, ringed=False)
        z -= 0.34 + h * 0.62
    n += 1
# the web of skin between the crest quills (drawn with the wing-membrane material)
for (b0, t0_, w0), (b1, t1_, w1) in zip(crest[:-1], crest[1:]):
    if (b0 - b1).length > 1.2: continue
    ids = [mem.vert(b0, w0, (0.5, 0.0, 0.0), (0.51, 0.68)), mem.vert(b1, w1, (0.5, 1.0, 0.0), (0.74, 0.68)), mem.vert(t1_, w1, (0.85, 1.0, 1.0), (0.74, 0.99)), mem.vert(t0_, w0, (0.85, 0.0, 1.0), (0.51, 0.99))]; mem.f.append(tuple(ids))
z = hz0 - 0.05
while z > hz0 - 2.6:                                                                                                           # the jaw fringe carries on down the throat
    rx, _, rb = body_r(z); f = (hz0 - z) / 2.6
    for sx in (1, -1): hard.horn((sx * rx * 0.34, spineY(z) - rb * 0.9, z), (sx * 0.35, -0.8, -0.5), rj(0.2, 0.36) * (1 - 0.5 * f) * hd, 0.04 * hd, spine_w(z), SP['horn'], bend=0.1, side=V((0, 0, 1)), flat=0.6, sides=6, n=6, ringed=False)
    z -= rj(0.16, 0.24)
def tooth(base, d, L, r, w): hard.horn(base, d, L, r, w, SP['tooth'], bend=-0.2, side=V((1, 0, 0)), sides=6, n=6, ringed=False)
for sx in (1, -1):
    for i in range(21):
        t = 0.36 + i * 0.03; big = 1.0 + 0.8 * math.exp(-((t - 0.8) / 0.07) ** 2) + 0.45 * math.exp(-((t - 0.56) / 0.05) ** 2); ln = 0.17 * hd * big * rj(0.55, 1.3)
        tooth((sx * skW(t) * 0.9, lipY + 0.03 * hd, hzt(t)), (sx * rj(0.0, 0.3), -1, rj(-0.1, 0.3)), ln, 0.028 * hd * (0.75 + 0.3 * big), HEAD)
    for i in range(18):
        t = 0.38 + i * 0.033; big = 1.0 + 0.7 * math.exp(-((t - 0.74) / 0.07) ** 2); ln = 0.15 * hd * big * rj(0.55, 1.3)
        tooth((sx * skW(t) * 0.82, jawY - 0.03 * hd, hzt(t)), (sx * rj(0.0, 0.25), 1, rj(0.0, 0.3)), ln, 0.026 * hd * (0.75 + 0.3 * big), JAW)
for x in (-0.2, -0.07, 0.07, 0.2):
    tooth((x * hd, lipY + 0.03 * hd, hzt(0.985)), (x, -1, 0.3), rj(0.14, 0.22) * hd, 0.028 * hd, HEAD); tooth((x * hd * 0.8, jawY - 0.02 * hd, hzt(0.955)), (x, 1, 0.3), rj(0.11, 0.18) * hd, 0.025 * hd, JAW)

# ====================================================================== Blender side
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene; scene.render.engine = 'CYCLES'; scene.cycles.samples = 12; scene.cycles.device = 'CPU'
try: scene.cycles.use_denoising = False
except Exception: pass
scene.world = bpy.data.worlds.new('w'); scene.world.light_settings.distance = 1.4
def activate(o): bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
def apply_mod(o, m): activate(o); bpy.ops.object.modifier_apply(modifier=m.name)
def fuse(src_obj, voxel, smooth_it):
    activate(src_obj); bpy.ops.object.duplicate(); o = bpy.context.view_layer.objects.active
    rm = o.modifiers.new('rm', 'REMESH'); rm.mode = 'VOXEL'; rm.voxel_size = voxel; rm.adaptivity = 0.0; apply_mod(o, rm)
    sm = o.modifiers.new('sm', 'SMOOTH'); sm.factor = 0.5; sm.iterations = smooth_it; apply_mod(o, sm); o.vertex_groups.clear(); return o
src_body = body.obj('src_body'); src_jaw = jawm.obj('src_jaw')
hi_b = fuse(src_body, VOXEL, 4); hi_j = fuse(src_jaw, VOXEL * 0.7, 3)
activate(src_body); src_jaw.select_set(True); bpy.ops.object.join(); src = src_body
activate(hi_b); hi_j.select_set(True); bpy.ops.object.join(); hi = hi_b; hi.name = 'hi'
# sculpted recesses: eye sockets and nostrils pressed into the fused skull
me = hi.data; n = len(me.vertices); co = np.empty(n * 3, dtype=np.float32); me.vertices.foreach_get('co', co); co = co.reshape(n, 3)
nr = np.empty(n * 3, dtype=np.float32); me.vertices.foreach_get('normal', nr); nr = nr.reshape(n, 3)
def press(c, R, depth, dirn=None):
    d = np.linalg.norm(co - np.array(P(c)), axis=1); m = d < R; f = (1 - (d[m] / R) ** 2) ** 2
    if dirn is None: co[m] -= nr[m] * (depth * f)[:, None]
    else: co[m] += np.array(P(dirn))[None, :] * (depth * f)[:, None]
for e in EYES: press(e, 0.19 * hd, 0.09 * hd)
NOSTRILS = [skull_pt(0.95, sx * 0.75)[0] for sx in (1, -1)]
for c_, sx in zip(NOSTRILS, (1, -1)): press(c_, 0.17 * hd, 0.24 * hd, V((-sx * 0.25, -0.45, -0.85)).normalized())
# ---- scripted brush strokes: creases and folds pressed into the skin along paths laid on the surface
bpy.context.view_layer.update()
G_ = lambda v: V((v.x, v.z, -v.y))
def on_surface(pg):
    ok, loc, nrm_, _ = hi.closest_point_on_mesh(P(pg)); return G_(loc) if ok else V(pg)
def stroke(pts, R, depth):
    q = [np.array(P(on_surface(p_))) for p_ in pts]; lo_ = np.min(q, axis=0) - R; hi_ = np.max(q, axis=0) + R
    idx = np.nonzero(np.all((co >= lo_) & (co <= hi_), axis=1))[0]
    if not len(idx): return
    c = co[idx]; dmin = np.full(len(idx), 1e9, dtype=np.float32)
    for a_, b_ in zip(q[:-1], q[1:]):
        ab = b_ - a_; t = np.clip(((c - a_) @ ab) / (ab @ ab + 1e-9), 0, 1); dmin = np.minimum(dmin, np.linalg.norm(c - (a_ + t[:, None] * ab), axis=1))
    k = dmin < R; f = (1 - (dmin[k] / R) ** 2) ** 2; co[idx[k]] -= nr[idx[k]] * (depth * f)[:, None]
def loft_pt(z, th, sx):
    rx, rt, rb = body_r(z); s_, c_ = math.sin(th), math.cos(th); return V((sx * rx * abs(s_) ** 0.86, spineY(z) + (rt if c_ >= 0 else rb) * math.copysign(abs(c_) ** 0.9, c_), z))
for sx in (1, -1):
    for z, d_ in ((headZ - 0.4, 0.06), (headZ - 0.85, 0.055), (headZ - 1.35, 0.045), (3.55, 0.05), (3.1, 0.05), (-3.5, 0.05), (-4.0, 0.045), (-4.6, 0.04)):      # folds ringing the neck and the tail root
        stroke([loft_pt(z + 0.12 * math.sin(th * 3), th, sx) for th in np.linspace(0.7, 2.75, 14)], 0.1, d_)
    Jq = {k_: V(v) for k_, v in rig['joints']['L' if sx > 0 else 'R'].items() if not isinstance(v[0], list)}
    stroke([Jq['HJ'] + V((sx * 0.9, -0.2, 0.15)), Jq['HJ'].lerp(Jq['K'], 0.5) + V((sx * 0.8, 0.1, 0.1)), Jq['K'] + V((sx * 0.5, 0.35, 0.0))], 0.13, 0.06)            # between the thigh muscles
    stroke([Jq['HJ'] + V((sx * 0.3, 0.9, 1.1)), Jq['HJ'] + V((sx * 0.5, 1.25, 0.1)), Jq['HJ'] + V((sx * 0.3, 0.9, -1.2))], 0.16, 0.07)                               # where the haunch meets the flank
    stroke([Jq['S'] + V((-sx * 0.2, 0.75, 0.9)), Jq['S'] + V((-sx * 0.75, 0.5, -0.2)), Jq['S'] + V((-sx * 0.6, -0.3, -1.1))], 0.16, 0.07)                           # behind the shoulder
    for t_ in (0.25, 0.5, 0.75):                                                                                                                                   # wrinkles across knee and elbow
        stroke([Jq['K'] + V((sx * 0.5, 0.15 - t_ * 0.3, -0.3 + t_ * 0.6)), Jq['K'] + V((sx * 0.62, -t_ * 0.3, 0.05)), Jq['K'] + V((sx * 0.5, -0.15 - t_ * 0.3, 0.35))], 0.07, 0.035)
    stroke([V((sx * skW(t_) * 0.98, lipY + 0.09 * hd, hzt(t_))) for t_ in np.linspace(0.3, 0.96, 12)], 0.06 * hd, 0.035 * hd)                                      # the lip line
me.vertices.foreach_set('co', co.ravel()); me.update()
bpy.context.view_layer.update()

# ---- real scales: overlapping keeled shingles laid in staggered rows over neck, body, tail and limbs, each riding the sculpted surface
from mathutils.kdtree import KDTree
sv = src.data.vertices; kd = KDTree(len(sv))
for i_, v_ in enumerate(sv): kd.insert(v_.co, i_)
kd.balance(); gnames = [g.name for g in src.vertex_groups]
def weights_at(bl):
    _, i_, _ = kd.find(bl); return {gnames[g.group]: g.weight for g in sv[i_].groups if g.weight > 0.01} or {'root': 1.0}
NSC = [0]
def scale_at(p0, flow, L, wd, up=0.0):
    ok, loc, nrm_, _ = hi.closest_point_on_mesh(P(p0))
    if not ok: return
    pq = G_(loc); n_ = G_(nrm_).normalized()
    if (pq - V(p0)).length > 1.0: return
    f_ = V(flow) - n_ * n_.dot(V(flow))
    if f_.length < 0.25: return
    f_.normalize(); s_ = n_.cross(f_).normalized(); w = weights_at(loc); lift = L * rj(0.16, 0.32); keel = 0.025 + 0.05 * L
    t_ = rj(0.25, 0.9); cb = tuple(lerp(SP['base'][i], SP['scale_hi'][i], t_) for i in range(3))
    if up > 0.55 and RND.random() < 0.3: cb = tuple(lerp(cb[i], SP['accent'][i], 0.55) for i in range(3))
    ct = tuple(min(1.0, c_ * 1.7 + 0.01) for c_ in cb); cd = tuple(c_ * 0.45 for c_ in cb)
    pts = ((pq - s_ * wd / 2 - n_ * 0.03 - f_ * 0.05, cd), (pq + s_ * wd / 2 - n_ * 0.03 - f_ * 0.05, cd), (pq - s_ * wd * 0.56 + f_ * 0.45 * L + n_ * lift * 0.4, cb), (pq + s_ * wd * 0.56 + f_ * 0.45 * L + n_ * lift * 0.4, cb),
           (pq + f_ * L + n_ * lift, ct), (pq + f_ * 0.42 * L + n_ * (lift * 0.4 + keel), ct), (pq + f_ * 0.5 * L + n_ * (lift * 0.4 - 0.035), cd))
    i0, i1, i2, i3, i4, i5, i6 = [hard.vert(q_, w, c_) for q_, c_ in pts]
    hard.f += [(i0, i1, i5), (i1, i3, i5), (i3, i4, i5), (i4, i2, i5), (i2, i0, i5), (i1, i0, i6), (i3, i1, i6), (i4, i3, i6), (i2, i4, i6), (i0, i2, i6)]; NSC[0] += 1
z = headZ - 0.15; row = 0
while z > tailTip * 0.93:
    rx, rt, rb = body_r(z)
    if z > 3.4: L = lerp(0.46, 0.3, (z - 3.4) / (headZ - 3.4))
    elif z > -3.2: L = 0.44 if z > 0.8 else 0.38
    else: L = lerp(0.36, 0.09, clamp01((-3.2 - z) / (-3.2 - tailTip)) ** 0.8)
    dth = (L * 0.6) / max((rx + rt + rb) / 3, 0.08); th = 0.3 + (dth * 0.5 if row % 2 else 0)
    while th < 2.5:
        for sx in (1, -1):
            if abs(z - sadZ) < 0.95 and th < 1.1: continue                    # the rider's seat stays clear
            scale_at(loft_pt(z, th, sx), (0, 0, -1), L * rj(0.8, 1.25) * (1.0 if th < 1.7 else 0.8), L * 0.68, math.cos(th))
        th += dth * rj(0.9, 1.1)
    z -= L * 0.48; row += 1
for sx in (1, -1):
    Jq = {k_: V(v) for k_, v in rig['joints']['L' if sx > 0 else 'R'].items() if not isinstance(v[0], list)}
    for a_, b_, R0, R1, L in ((Jq['HJ'], Jq['K'], 1.05 * bk, 0.62 * bk, 0.3), (Jq['K'], Jq['A'], 0.56 * bk, 0.33 * bk, 0.22), (Jq['S'], Jq['E'], 0.85, 0.52, 0.28), (Jq['E'], Jq['W'], 0.5, 0.36, 0.22)):
        d_ = (b_ - a_); ln = d_.length; d_ = d_ / ln; u_ = d_.cross(V((0.3, 0.2, 0.93))).normalized(); v_ = d_.cross(u_); t_ = 0.05; row = 0
        while t_ < 0.97:
            R = lerp(R0, R1, t_); nph = max(5, int(TAU * R / (L * 0.62)))
            for k_ in range(nph):
                ph = (k_ + (0.5 if row % 2 else 0)) / nph * TAU
                scale_at(a_.lerp(b_, t_) + (u_ * math.cos(ph) + v_ * math.sin(ph)) * R, d_, L * rj(0.8, 1.2), L * 0.68)
            t_ += L * 0.5 / ln; row += 1
print('SCALES', NSC[0], flush=True)
for p in me.polygons: p.use_smooth = True

# ---------------------------------------------------------------- hide: relief, colour and roughness, all in object space
def hide_material():
    m = bpy.data.materials.new('hide'); m.use_nodes = True; nt = m.node_tree; N = nt.nodes; L = nt.links; bsdf = next(x for x in N if x.type == 'BSDF_PRINCIPLED')
    tc = N.new('ShaderNodeTexCoord'); geo = N.new('ShaderNodeNewGeometry'); sn = N.new('ShaderNodeSeparateXYZ'); L.new(geo.outputs['Normal'], sn.inputs[0]); sp = N.new('ShaderNodeSeparateXYZ'); L.new(tc.outputs['Object'], sp.inputs[0])
    def mth(op, a, b=None, clamp=False):
        x = N.new('ShaderNodeMath'); x.operation = op; x.use_clamp = clamp
        for i, v in enumerate((a, b)):
            if v is None: continue
            if isinstance(v, (int, float)): x.inputs[i].default_value = v
            else: L.new(v, x.inputs[i])
        return x.outputs[0]
    def ramp(v, a, b):
        x = N.new('ShaderNodeMapRange'); x.clamp = True; L.new(v, x.inputs['Value']); x.inputs['From Min'].default_value = a; x.inputs['From Max'].default_value = b; return x.outputs['Result']
    mix = lambda a, b, f: mth('ADD', mth('MULTIPLY', a, mth('SUBTRACT', 1.0, f)), mth('MULTIPLY', b, f))
    def cmix(a, b, f):
        x = N.new('ShaderNodeMix'); x.data_type = 'RGBA'; L.new(f, x.inputs['Factor'])
        for sock, v in ((x.inputs['A'], a), (x.inputs['B'], b)):
            if isinstance(v, tuple): sock.default_value = (*v, 1)
            else: L.new(v, sock)
        return x.outputs['Result']
    def vor(scale, feature='F1'):
        x = N.new('ShaderNodeTexVoronoi'); x.voronoi_dimensions = '3D'; x.feature = feature; x.inputs['Scale'].default_value = scale; L.new(tc.outputs['Object'], x.inputs['Vector']); return x
    def noise(scale, detail=4.0):
        x = N.new('ShaderNodeTexNoise'); x.inputs['Scale'].default_value = scale; x.inputs['Detail'].default_value = detail; L.new(tc.outputs['Object'], x.inputs['Vector']); return x.outputs['Fac']
    X, Y, Zc = sp.outputs['X'], sp.outputs['Y'], sp.outputs['Z']; nz = sn.outputs['Z']; ax = mth('ABSOLUTE', X)
    up = ramp(nz, 0.25, 0.85); on_head = ramp(Y, -(hz0 - 0.4), -(hz0 + 0.2))
    trunk = mth('MULTIPLY', ramp(ax, 1.25 * bk, 0.7 * bk), ramp(Y, -(hz0 + 0.1), -(hz0 - 0.5)))                            # trunk underside only, not the head
    belly = mth('MULTIPLY', ramp(nz, -0.4, -0.85), trunk)
    def plates(scale):
        # flat-topped plates with dark seams; each rides up toward its trailing (tailward) edge so the scales read as overlapping
        e = vor(scale, 'DISTANCE_TO_EDGE'); c = vor(scale, 'F1'); pl = mth('POWER', ramp(e.outputs['Distance'], 0.0, 0.2), 0.55)
        cp = N.new('ShaderNodeSeparateXYZ'); L.new(c.outputs['Position'], cp.inputs[0]); tilt = ramp(mth('MULTIPLY', mth('SUBTRACT', Y, cp.outputs['Y']), scale), -0.45, 0.45)
        cc = N.new('ShaderNodeSeparateColor'); L.new(c.outputs['Color'], cc.inputs[0]); rnd = cc.outputs[0]
        keel = mth('SUBTRACT', 1.0, mth('MULTIPLY', mth('ABSOLUTE', mth('MULTIPLY', mth('SUBTRACT', X, cp.outputs['X']), scale)), 2.6), clamp=True)
        return mth('MULTIPLY', pl, mth('ADD', mth('ADD', 0.3, mth('MULTIPLY', tilt, 0.3)), mth('ADD', mth('MULTIPLY', rnd, 0.3), mth('MULTIPLY', keel, 0.14)))), rnd
    (hf, rf), (hm, rm_), (hl, rl) = plates(19.0), plates(11.0), plates(4.6)
    h = mix(mix(hm, hl, mth('MULTIPLY', up, mth('SUBTRACT', 1.0, mth('MULTIPLY', on_head, 0.4)))), hf, mth('MULTIPLY', on_head, mth('SUBTRACT', 1.0, up)))
    wave = N.new('ShaderNodeTexWave'); wave.wave_type = 'BANDS'; wave.bands_direction = 'Y'; wave.wave_profile = 'SAW'; wave.inputs['Scale'].default_value = 1.2; wave.inputs['Distortion'].default_value = 0.6
    L.new(tc.outputs['Object'], wave.inputs['Vector']); scute = mth('POWER', wave.outputs['Fac'], 0.65)
    h = mix(h, scute, belly)
    # mouth lining: the palate and the floor of the jaw
    mouth = mth('MULTIPLY', mth('MULTIPLY', ramp(Y, -(hzt(0.13)), -(hzt(0.2))), ramp(ax, 0.8 * hd, 0.6 * hd)),
                mth('MULTIPLY', mth('MULTIPLY', ramp(Zc, jawY - 0.13 * hd, jawY - 0.07 * hd), ramp(Zc, lipY + 0.2 * hd, lipY + 0.13 * hd)), ramp(mth('ABSOLUTE', nz), 0.3, 0.6)))
    h = mix(h, mth('MULTIPLY', noise(9.0), 0.5), mouth)
    # leathery folds running round the neck, limbs and flanks, strongest where the plates are small
    wr = N.new('ShaderNodeTexWave'); wr.wave_type = 'BANDS'; wr.bands_direction = 'Y'; wr.inputs['Scale'].default_value = 5.0; wr.inputs['Distortion'].default_value = 4.0; wr.inputs['Detail'].default_value = 2.0
    L.new(tc.outputs['Object'], wr.inputs['Vector']); folds = mth('MULTIPLY', wr.outputs['Fac'], mth('SUBTRACT', 1.0, mth('MULTIPLY', up, 0.7)))
    hh = mth('ADD', mth('ADD', mth('ADD', mth('MULTIPLY', h, 1.0), mth('MULTIPLY', folds, 0.38)), mth('MULTIPLY', noise(1.3, 6.0), 0.7)), mth('MULTIPLY', noise(34.0, 3.0), 0.05))
    bump = N.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 1.0; bump.inputs['Distance'].default_value = 0.065; L.new(hh, bump.inputs['Height']); L.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    # colour: dark hide, scale crowns worn paler, the accent colour bleeding along the back and around the skull, a paler plated belly
    col = cmix(SP['base'], SP['scale_hi'], mth('MULTIPLY', mth('POWER', h, 1.6), mth('ADD', 0.5, mth('MULTIPLY', rm_, 0.5))))
    blotch = ramp(noise(0.75, 3.0), 0.56, 0.74); streak = ramp(noise(2.6, 2.0), 0.58, 0.76)
    acc = mth('MULTIPLY', mth('ADD', mth('MULTIPLY', up, blotch), mth('MULTIPLY', mth('MULTIPLY', on_head, streak), 0.25), clamp=True), mth('ADD', 0.35, mth('MULTIPLY', h, 0.65)))
    col = cmix(col, SP['accent'], mth('MULTIPLY', acc, 0.5))
    col = cmix(col, cmix(tuple(c * 0.35 for c in SP['belly']), SP['belly'], scute), mth('MULTIPLY', belly, 0.9))
    gum = mth('MULTIPLY', mth('MULTIPLY', ramp(Y, -(hzt(0.3)), -(hzt(0.38))), mth('MULTIPLY', ramp(Zc, jawY - 0.07 * hd, jawY - 0.03 * hd), ramp(Zc, lipY + 0.07 * hd, lipY + 0.03 * hd))), ramp(mth('ABSOLUTE', nz), 0.75, 0.4))
    col = cmix(col, tuple(c * 0.35 for c in SP['gum']), mth('MULTIPLY', gum, 0.12))
    col = cmix(col, SP['mouth'], mouth)
    def near(c, r):
        vm_ = N.new('ShaderNodeVectorMath'); vm_.operation = 'DISTANCE'; L.new(tc.outputs['Object'], vm_.inputs[0]); vm_.inputs[1].default_value = P(c); return ramp(vm_.outputs['Value'], r, r * 0.5)
    nost = mth('ADD', near(NOSTRILS[0], 0.15 * hd), near(NOSTRILS[1], 0.15 * hd), clamp=True)
    col = cmix(col, (0.003, 0.002, 0.002), nost)
    sock = mth('ADD', near(EYES[0], 0.2 * hd), near(EYES[1], 0.2 * hd), clamp=True)
    col = cmix(col, (0.006, 0.005, 0.005), mth('MULTIPLY', sock, 0.75))
    rough = mix(mix(0.9, 0.46, mth('POWER', h, 1.5)), 0.3, mouth)
    L.new(col, bsdf.inputs['Base Color']); L.new(rough, bsdf.inputs['Roughness'])
    gr = N.new('ShaderNodeCombineColor'); [L.new(rough, gr.inputs[i]) for i in range(3)]
    mode = N.new('ShaderNodeValue'); mode.name = 'mode'; mode.outputs[0].default_value = 0.0
    L.new(cmix(col, gr.outputs[0], mode.outputs[0]), bsdf.inputs['Emission Color']); bsdf.inputs['Emission Strength'].default_value = 0.0
    return m, bsdf, mode
hide, hide_bsdf, hide_mode = hide_material(); hi.data.materials.clear(); hi.data.materials.append(hide)
hard_o = hard.obj('hard', with_col=True); mem_o = mem.obj('membrane', with_col=True, with_uv=True)
def membrane_material():
    # wing skin: folds running out along the fingers, fine wrinkles, a net of veins; near-black at the bones, blood-brown where it thins
    m = bpy.data.materials.new('wingskin'); m.use_nodes = True; nt = m.node_tree; N = nt.nodes; L = nt.links; bsdf = next(x for x in N if x.type == 'BSDF_PRINCIPLED')
    vc = N.new('ShaderNodeVertexColor'); vc.layer_name = 'Col'; sc = N.new('ShaderNodeSeparateColor'); L.new(vc.outputs['Color'], sc.inputs[0]); a, r = sc.outputs[1], sc.outputs[2]
    def mth(op, x, y=None, clamp=False):
        n_ = N.new('ShaderNodeMath'); n_.operation = op; n_.use_clamp = clamp
        for i, v in enumerate((x, y)):
            if v is None: continue
            if isinstance(v, (int, float)): n_.inputs[i].default_value = v
            else: L.new(v, n_.inputs[i])
        return n_.outputs[0]
    def ramp(v, lo_, hi_):
        n_ = N.new('ShaderNodeMapRange'); n_.clamp = True; L.new(v, n_.inputs['Value']); n_.inputs['From Min'].default_value = lo_; n_.inputs['From Max'].default_value = hi_; return n_.outputs['Result']
    def cmix(c0, c1, f):
        n_ = N.new('ShaderNodeMix'); n_.data_type = 'RGBA'; L.new(f, n_.inputs['Factor'])
        for sock, v in ((n_.inputs['A'], c0), (n_.inputs['B'], c1)):
            if isinstance(v, tuple): sock.default_value = (*v, 1)
            else: L.new(v, sock)
        return n_.outputs['Result']
    vec = N.new('ShaderNodeCombineXYZ'); L.new(mth('MULTIPLY', a, 6.0), vec.inputs[0]); L.new(mth('MULTIPLY', r, 14.0), vec.inputs[1])
    def noise(scale, detail):
        n_ = N.new('ShaderNodeTexNoise'); n_.inputs['Scale'].default_value = scale; n_.inputs['Detail'].default_value = detail; L.new(vec.outputs[0], n_.inputs['Vector']); return n_.outputs['Fac']
    n1, fine = noise(0.9, 5.0), noise(7.0, 5.0)
    folds = mth('ADD', 0.5, mth('MULTIPLY', mth('SINE', mth('ADD', mth('MULTIPLY', a, 46.0), mth('MULTIPLY', n1, 8.0))), 0.5))
    vo = N.new('ShaderNodeTexVoronoi'); vo.voronoi_dimensions = '3D'; vo.feature = 'DISTANCE_TO_EDGE'; vo.inputs['Scale'].default_value = 2.6; L.new(vec.outputs[0], vo.inputs['Vector'])
    vein = mth('SUBTRACT', 1.0, ramp(vo.outputs['Distance'], 0.0, 0.022))
    sv2 = N.new('ShaderNodeCombineXYZ'); L.new(mth('MULTIPLY', a, 44.0), sv2.inputs[0]); L.new(mth('MULTIPLY', r, 2.6), sv2.inputs[1])
    stk = N.new('ShaderNodeTexNoise'); stk.inputs['Scale'].default_value = 1.0; stk.inputs['Detail'].default_value = 5.0; L.new(sv2.outputs[0], stk.inputs['Vector']); streak = stk.outputs['Fac']     # striations running out along the wing
    hh = mth('ADD', mth('ADD', mth('MULTIPLY', mth('MULTIPLY', folds, ramp(r, 0.0, 0.5)), 0.6), mth('MULTIPLY', streak, 0.7)), mth('ADD', mth('MULTIPLY', fine, 0.25), mth('MULTIPLY', vein, 0.1)))
    bump = N.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 1.0; bump.inputs['Distance'].default_value = 0.08; L.new(hh, bump.inputs['Height']); L.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    edge = mth('POWER', mth('MULTIPLY', mth('MULTIPLY', a, mth('SUBTRACT', 1.0, a)), 4.0, clamp=True), 0.6)
    col = cmix(SP['mem_dark'], SP['mem_mid'], mth('MULTIPLY', edge, mth('ADD', 0.3, mth('ADD', mth('MULTIPLY', fine, 0.3), mth('MULTIPLY', streak, 0.5)))))
    col = cmix(col, tuple(c * 0.5 for c in SP['mem_dark']), mth('MULTIPLY', vein, 0.28))
    col = cmix(col, SP['mem_dark'], mth('ADD', mth('MULTIPLY', ramp(r, 0.78, 1.0), 0.55), mth('MULTIPLY', mth('SUBTRACT', 1.0, folds), 0.3), clamp=True))
    L.new(col, bsdf.inputs['Base Color']); L.new(col, bsdf.inputs['Emission Color']); bsdf.inputs['Emission Strength'].default_value = 0.0; bsdf.inputs['Roughness'].default_value = 0.7
    node = N.new('ShaderNodeTexImage'); N.active = node; return m, bsdf, node
wing_mat, wing_bsdf, wing_node = membrane_material(); mem_o.data.materials.append(wing_mat)
for o in (hard_o, mem_o):
    for p in o.data.polygons: p.use_smooth = True

if PREVIEW:      # quick look at the sculpt before any baking
    hm = bpy.data.materials.new('hardp'); hm.use_nodes = True; b = next(x for x in hm.node_tree.nodes if x.type == 'BSDF_PRINCIPLED'); va = hm.node_tree.nodes.new('ShaderNodeVertexColor'); va.layer_name = 'Col'
    hm.node_tree.links.new(va.outputs['Color'], b.inputs['Base Color']); b.inputs['Roughness'].default_value = 0.35; hard_o.data.materials.append(hm)
    mm = bpy.data.materials.new('memp'); mm.use_nodes = True; b = next(x for x in mm.node_tree.nodes if x.type == 'BSDF_PRINCIPLED'); b.inputs['Base Color'].default_value = (0.09, 0.02, 0.018, 1); b.inputs['Roughness'].default_value = 0.6; mem_o.data.materials.append(mm)
    src.hide_render = True; scene.view_settings.view_transform = 'Standard'
    for e in EYES:
        bpy.ops.mesh.primitive_uv_sphere_add(radius=SP['eye_r'] * hd, location=P(e)); eo = bpy.context.view_layer.objects.active; em = bpy.data.materials.new('eye'); em.use_nodes = True; eb = next(x for x in em.node_tree.nodes if x.type == 'BSDF_PRINCIPLED'); eb.inputs['Base Color'].default_value = (0.9, 0.12, 0.02, 1); eb.inputs['Emission Color'].default_value = (1, 0.2, 0.03, 1); eb.inputs['Emission Strength'].default_value = 1.5; eo.data.materials.append(em)
    wn = scene.world; wn.use_nodes = True; wn.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.62, 0.72, 1); wn.node_tree.nodes['Background'].inputs[1].default_value = 0.6
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 3.0; sun.rotation_euler = (math.radians(50), 0, math.radians(35)); scene.collection.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scene.collection.objects.link(cam); scene.camera = cam; cam.data.lens = 60; cam.data.clip_end = 500
    scene.render.resolution_x, scene.render.resolution_y = 1100, 620; scene.cycles.samples = 24
    def shot(name, eye, target):
        e, t = P(eye), P(target); cam.location = e; cam.rotation_euler = (t - e).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = os.path.join(PREVIEW, f'{did}_{name}.png'); bpy.ops.render.render(write_still=True)
    cam.data.lens = 85
    shot('head', (10, 1.4, headZ + 2.2), (0, 0.6, headZ + 1.0)); cam.data.lens = 50; shot('body', (15, 2.5, 9.5), (0, 0.2, 3.2)); shot('wing', (9, 13, 6), (8, 1, -1))
    cam.data.lens = 35; shot('side', (22, 8, 13), (0, 0, -1.0))
    if FAST or '--previewonly' in args: print('PREVIEW ONLY'); sys.exit(0)

# ---------------------------------------------------------------- game skin: decimate, unwrap, bake, carry the weights across
ntri = sum(len(p.vertices) - 2 for p in hi.data.polygons)
activate(hi); bpy.ops.object.duplicate(); lo = bpy.context.view_layer.objects.active; lo.name = 'skin'
dm = lo.modifiers.new('dec', 'DECIMATE'); dm.ratio = min(1.0, TARGET / ntri); apply_mod(lo, dm)
activate(lo); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.uv.smart_project(angle_limit=math.radians(75), island_margin=0.002); bpy.ops.object.mode_set(mode='OBJECT')
bake_mat = bpy.data.materials.new('bake'); bake_mat.use_nodes = True; node = bake_mat.node_tree.nodes.new('ShaderNodeTexImage'); bake_mat.node_tree.nodes.active = node
lo.data.materials.clear(); lo.data.materials.append(bake_mat)
def img(name, color, nc):
    im = bpy.data.images.new(name, TS, TS, alpha=False); im.generated_color = color
    if nc: im.colorspace_settings.name = 'Non-Color'
    return im
IM = {'nrm': img('nrm', (0.5, 0.5, 1, 1), True), 'alb': img('alb', (0.05, 0.05, 0.05, 1), False), 'rgh': img('rgh', (0.7, 0.7, 0.7, 1), True), 'ao': img('ao', (1, 1, 1, 1), True)}
if not NOBAKE:        # the wing skin bakes onto its own sheets
    MS = 1024 if FAST else 2048; wing_bsdf.inputs['Emission Strength'].default_value = 1.0; activate(mem_o)
    for key, btype, nc, fn in (('ma', 'EMIT', False, f'dragonfull_{did}_mem_a.jpg'), ('mn', 'NORMAL', True, f'dragonfull_{did}_mem_n.jpg')):
        im = bpy.data.images.new(key, MS, MS, alpha=False); im.generated_color = (0.03, 0.012, 0.01, 1) if key == 'ma' else (0.5, 0.5, 1, 1)
        if nc: im.colorspace_settings.name = 'Non-Color'
        wing_node.image = im; bpy.ops.object.bake(type=btype, margin=8); im.filepath_raw = os.path.join(OUT, fn); im.file_format = 'JPEG'; im.save()
for o in (lo, src, hard_o, mem_o):
    for vis in ('visible_camera', 'visible_diffuse', 'visible_glossy', 'visible_transmission', 'visible_volume_scatter', 'visible_shadow'): setattr(o, vis, False)
hide_bsdf.inputs['Emission Strength'].default_value = 1.0
bpy.ops.object.select_all(action='DESELECT'); hi.select_set(True); lo.select_set(True); bpy.context.view_layer.objects.active = lo
for key, btype, mode in (() if NOBAKE else (('nrm', 'NORMAL', 0), ('alb', 'EMIT', 0), ('rgh', 'EMIT', 1), ('ao', 'AO', 0))):
    hide_mode.outputs[0].default_value = mode; node.image = IM[key]
    bpy.ops.object.bake(type=btype, use_selected_to_active=True, cage_extrusion=0.03, max_ray_distance=0.1, margin=8)
def px(im): a = np.empty(TS * TS * 4, dtype=np.float32); im.pixels.foreach_get(a); return a.reshape(TS, TS, 4)
alb, rgh, ao = px(IM['alb']), px(IM['rgh']), px(IM['ao'])
alb[..., :3] *= (0.55 + 0.45 * ao[..., :1]); IM['alb'].pixels.foreach_set(alb.ravel())
orm = np.ones((TS, TS, 4), dtype=np.float32); orm[..., 0] = ao[..., 0]; orm[..., 1] = rgh[..., 0]; orm[..., 2] = 0; IM['rgh'].pixels.foreach_set(orm.ravel())
scene.render.image_settings.quality = 92
for key, fn in (() if NOBAKE else (('nrm', f'dragonfull_{did}_n.jpg'), ('alb', f'dragonfull_{did}_a.jpg'), ('rgh', f'dragonfull_{did}_orm.jpg'))):
    im = IM[key]; im.filepath_raw = os.path.join(OUT, fn); im.file_format = 'JPEG'; im.save()
hi.hide_render = True; hi.hide_set(True)
for nme in NAMES: lo.vertex_groups.new(name=nme)
dt = lo.modifiers.new('dt', 'DATA_TRANSFER'); dt.object = src; dt.use_vert_data = True; dt.data_types_verts = {'VGROUP_WEIGHTS'}; dt.vert_mapping = 'POLYINTERP_NEAREST'
dt.layers_vgroup_select_src = 'ALL'; dt.layers_vgroup_select_dst = 'NAME'; apply_mod(lo, dt)
activate(lo); bpy.ops.object.vertex_group_clean(group_select_mode='ALL', limit=0.02); bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4); bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
arm = bpy.data.armatures.new('rig'); ao_ = bpy.data.objects.new('rig', arm); scene.collection.objects.link(ao_); activate(ao_); bpy.ops.object.mode_set(mode='EDIT')
for b in rig['bones']:
    eb = arm.edit_bones.new(b['name']); eb.head = P(b['head']); t = P(b['tail']) if b['tail'] else eb.head + Vector((0, -0.4, 0))
    if (t - eb.head).length < 0.06: t = eb.head + Vector((0, -0.3, 0.05))
    eb.tail = t
for b in rig['bones']:
    if b['parent']: arm.edit_bones[b['name']].parent = arm.edit_bones[b['parent']]
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.select_all(action='DESELECT')
for o in (lo, hard_o, mem_o):
    o.data.materials.clear(); o.parent = ao_; am = o.modifiers.new('arm', 'ARMATURE'); am.object = ao_; o.select_set(True)
    for vis in ('visible_camera', 'visible_diffuse', 'visible_glossy', 'visible_transmission', 'visible_volume_scatter', 'visible_shadow'): setattr(o, vis, True)
ao_.select_set(True); bpy.context.view_layer.objects.active = ao_
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, f'dragonfull_{did}.glb'), export_format='GLB', use_selection=True, export_materials='NONE', export_yup=True, export_skins=True, export_animations=False,
                          export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_active_vertex_color_when_no_material=True)
json.dump({'eyes': [list(e) for e in EYES], 'eyeR': SP['eye_r'] * hd, 'memTex': os.path.exists(os.path.join(OUT, f'dragonfull_{did}_mem_a.jpg'))}, open(os.path.join(OUT, f'dragonfull_{did}.json'), 'w'))
print('DRAGON MODEL', did, 'hi tris', ntri, 'skin', len(lo.data.polygons), 'hard', len(hard_o.data.polygons), 'membrane', len(mem_o.data.polygons), flush=True)
