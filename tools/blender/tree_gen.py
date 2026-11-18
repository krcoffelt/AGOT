# Builds forest trees from scratch, with every leaf as real geometry. A broadleaf is a trunk, four levels of branches
# (limbs off the trunk, boughs off the limbs, sprays off the boughs, twigs off the sprays) and a leaf every few centimetres
# along each twig. A conifer is a straight trunk with whorls of branches, each a flat fan of side shoots and twigs set
# with needle tufts. The default meshes are for baking: the dev server's /bake.html turns them into the impostor atlases in
# public/impostors (src/tools/bake.js).
#   Blender -b --factory-startup --python tools/blender/tree_gen.py -- <project dir> <name> [--near] [--preview <dir>] [--nosave]
# --near exports the lightweight game tree, including its sprig mask and baked visibility, to public/models.
# <name> is a key of SPECS. Writes assets-src/models/<name>/<name>.glb; --preview also renders stills of it into <dir>.
import bpy, sys, os, math, time
import numpy as np

args = sys.argv[sys.argv.index('--') + 1:]
proj, name = args[0], args[1]
PREVIEW = args[args.index('--preview') + 1] if '--preview' in args else None
NOSAVE = '--nosave' in args
NEAR = '--near' in args  # game mesh in public/models, grown from exactly the same branches

# Lengths in metres. crown_lo: height (share of H) where the limbs begin. reach(u): how far limbs reach sideways, as a
# share of crown_r, for a limb leaving the trunk at share u of the way up the crown. rise(u): its angle from straight up
# as it leaves the trunk, degrees. lift: how strongly limbs bend up toward the light along their length.
def reach_a(u): return np.where(u < 0.3, 0.80 + 0.20 * u / 0.3, 1.0 - 0.62 * (np.maximum(u - 0.3, 0) / 0.7) ** 1.6)
def reach_c(u): return (1 - u) ** 0.85 * (0.8 + 0.2 * np.minimum(u / 0.12, 1)) + 0.05      # a cone, drawn in a little at its foot
def reach_b(u): return np.where(u < 0.35, 0.70 + 0.30 * u / 0.35, 1.0 - 0.62 * (np.maximum(u - 0.35, 0) / 0.65) ** 1.5)
SPECS = {
    # a forest broadleaf with a full, lumpy, rounded crown about two thirds as wide as the tree is tall. Leaf colour is
    # set so the forest keeps the olive green it had with the earlier trees (measured on screen, new against old).
    'broadleaf_a': dict(seed=7, H=16.0, trunk_r=0.33, crown_lo=0.20, crown_r=5.6, limbs=15, reach=reach_a,
                        rise=lambda u: 70.0 - 42.0 * u ** 0.8, lift=0.95, uneven=(0.62, 1.12),
                        bough_gap=0.5, spray_gap=0.22, twig_gap=0.125, leaf_gap=0.036, leaf_len=0.15, leaf_wide=0.78,
                        leaf_col=(0.098, 0.102, 0.022), bark_col=(0.095, 0.082, 0.068)),
    # a taller, narrower one of the same kind, its crown carried higher: the second broadleaf in the mix
    'broadleaf_b': dict(seed=23, H=18.5, trunk_r=0.33, crown_lo=0.30, crown_r=4.8, limbs=14, reach=reach_b,
                        rise=lambda u: 62.0 - 38.0 * u ** 0.9, lift=1.05, uneven=(0.6, 1.15),
                        bough_gap=0.5, spray_gap=0.22, twig_gap=0.125, leaf_gap=0.036, leaf_len=0.145, leaf_wide=0.74,
                        leaf_col=(0.088, 0.094, 0.024), bark_col=(0.105, 0.090, 0.072)),
    # a forest fir: a narrow cone on a straight trunk, branches in whorls that leave level or drooping and sweep up at
    # their tips. Each small blade on its twigs stands for a tuft of a few needles (single needles are far below what
    # the atlas can show). whorl_gap: metres between whorls at the foot of the crown (they close up toward the top).
    'conifer_a': dict(form='conifer', seed=11, H=19.0, trunk_r=0.27, trunk_wander=0.05, crown_lo=0.16, crown_r=4.1, reach=reach_c,
                      rise=lambda u: 108.0 - 46.0 * u, lift=0.62, whorl_gap=0.6,
                      bough_gap=0.16, twig_gap=0.085, leaf_gap=0.02, leaf_len=0.075, leaf_wide=0.4, yellow=0.0,
                      leaf_col=(0.112, 0.140, 0.039), bark_col=(0.100, 0.078, 0.058)),      # needle colour set like the broadleafs', on screen against the fir before it
}
S = SPECS[name]
rng = np.random.default_rng(S['seed'])
UP = np.array([0.0, 0.0, 1.0])      # Blender is Z-up; the exporter turns the tree Y-up

def unit(v): return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-9)

def grow(start, d0, length, n, bend, wander):
    """Polylines for M branches at once: from start (M,3) along d0 (M,3), each `length` (M) long in n points.
    bend (M,3) is added to the heading over the branch's length (toward the light, or drooping); wander is how much it
    meanders. Returns points (M,n,3)."""
    M = len(start); P = np.empty((M, n, 3)); P[:, 0] = start; d = unit(d0.copy())
    step = (length / (n - 1))[:, None]
    drift = rng.normal(0, 1, (M, 3))
    for i in range(1, n):
        drift = 0.6 * drift + 0.4 * rng.normal(0, 1, (M, 3))
        d = unit(d + bend / (n - 1) + drift * wander / (n - 1))
        P[:, i] = P[:, i - 1] + d * step
    return P

def along(P, idx, t):
    """Position and heading on polyline idx (M) at share t (M) of its length."""
    n = P.shape[1]; f = np.clip(t, 0, 1) * (n - 1); i = np.minimum(f.astype(int), n - 2); w = (f - i)[:, None]
    a, b = P[idx, i], P[idx, i + 1]
    return a * (1 - w) + b * w, unit(b - a)

def offshoots(P, lengths, t0, t1, gap, out_lo, out_hi, roll_lo, roll_hi):
    """Places children along parent polylines P (M,n,3) of the given lengths: one every `gap` metres between shares t0
    and t1, leaving at out_lo…out_hi degrees from the parent's heading, on alternate sides, rolled roll_lo…roll_hi degrees
    out of the level (positive is upward). Returns parent index, share t, start point, heading."""
    counts = np.maximum(1, np.floor((t1 - t0) * lengths / gap).astype(int))
    par = np.repeat(np.arange(len(P)), counts)
    k = np.concatenate([np.arange(c) for c in counts]); c = np.repeat(counts, counts)
    t = t0 + (t1 - t0) * (k + rng.uniform(0.15, 0.85, len(k))) / c
    pos, T = along(P, par, t)
    W = unit(np.cross(T, UP) + 1e-6); V = np.cross(W, T)
    side = np.where((k + par) % 2 == 0, 1.0, -1.0) * np.where(rng.random(len(k)) < 0.12, -1.0, 1.0)
    out = np.radians(rng.uniform(out_lo, out_hi, len(k))); roll = np.radians(rng.uniform(roll_lo, roll_hi, len(k)))
    d = T * np.cos(out)[:, None] + (W * (side * np.cos(roll))[:, None] + V * np.sin(roll)[:, None]) * np.sin(out)[:, None]
    return par, t, pos, unit(d)

def tubes(P, R, sides):
    """Triangle mesh of round tubes along polylines P (M,n,3) with radii R (M,n). Returns verts (V,3), tris (F,3)."""
    M, n, _ = P.shape
    T = np.empty_like(P); T[:, 1:-1] = P[:, 2:] - P[:, :-2]; T[:, 0] = P[:, 1] - P[:, 0]; T[:, -1] = P[:, -1] - P[:, -2]; T = unit(T)
    ref = np.cross(T[:, 0], T[:, -1]); flat = np.linalg.norm(ref, axis=1) < 0.05      # a straight branch: any side will do
    ref[flat] = np.cross(T[flat, 0], UP + 0.01); ref = unit(ref)[:, None, :]
    U = unit(ref - T * np.sum(ref * T, axis=2, keepdims=True)); Vv = np.cross(T, U)
    a = np.arange(sides) * 2 * np.pi / sides
    ring = U[:, :, None, :] * np.cos(a)[None, None, :, None] + Vv[:, :, None, :] * np.sin(a)[None, None, :, None]
    verts = (P[:, :, None, :] + ring * R[:, :, None, None]).reshape(-1, 3)
    b = (np.arange(M)[:, None, None] * n + np.arange(n - 1)[None, :, None]) * sides; j = np.arange(sides)[None, None, :]; j2 = (j + 1) % sides
    v00, v01, v10, v11 = b + j, b + j2, b + sides + j, b + sides + j2
    tris = np.concatenate([np.stack([v00, v10, v11], -1).reshape(-1, 3), np.stack([v00, v11, v01], -1).reshape(-1, 3)])
    return verts, tris

t_start = time.time()
H, hb = S['H'], S['H'] * S['crown_lo']

# ---- trunk: a gentle wandering line to the top, flared at the foot
nT = 26
trunk = grow(np.zeros((1, 3)), UP[None] + rng.normal(0, 0.03, (1, 3)) * (S.get('trunk_wander', 0.18) / 0.18), np.array([H - 0.7]), nT, UP[None] * 0.3, S.get('trunk_wander', 0.18))
ty = np.linspace(0, 1, nT)
trunk_R = (S['trunk_r'] * (1 - ty) ** 0.8 + 0.018) * (1 + 0.55 * np.exp(-ty * H / 0.5))
trunk_R = trunk_R[None]

if S.get('form', 'broadleaf') == 'broadleaf':
    # ---- limbs off the trunk: a few big ones, spread up the crown (more where it is widest), round the trunk by the golden
    # angle; they leave at a slant and arch up toward the light
    nL = S['limbs']
    cand = np.linspace(0.0, 0.94, 400); wgt = S['reach'](cand); cdf = np.cumsum(wgt); cdf /= cdf[-1]
    u = np.interp((np.arange(nL) + rng.uniform(0.2, 0.8, nL)) / nL, cdf, cand)
    tL = (hb + u * (H - hb)) / H
    pos, _ = along(trunk, np.zeros(nL, int), tL)
    az = np.arange(nL) * 2.39996 + rng.normal(0, 0.4, nL)
    rise = np.radians(S['rise'](u) + rng.normal(0, 7, nL))
    d0 = np.stack([np.cos(az) * np.sin(rise), np.sin(az) * np.sin(rise), np.cos(rise)], 1)
    bend = UP[None] * (S['lift'] * rng.uniform(0.7, 1.2, nL))[:, None]
    NL = 16
    shape = grow(pos, d0, np.ones(nL), NL, bend, 0.9)
    # each limb is as long as it takes for its tip to reach the crown's outline: a rounded shape, crown_r wide, from where
    # the limbs begin up to the tree's top (drawn in by the length of the boughs that will stand off the limb tips)
    zc = hb + 0.5 * (H - hb); Rc = S['crown_r'] - 0.35; Zu = (H - 0.7) - zc; Zl = zc - (hb - 0.3)
    tipv = shape[:, -1] - shape[:, 0]
    def outside(L):
        q = pos + tipv * L[:, None]; dz = q[:, 2] - zc
        return (q[:, 0] ** 2 + q[:, 1] ** 2) / Rc ** 2 + (dz / np.where(dz > 0, Zu, Zl)) ** 2 - 1.0
    lo, hi = np.full(nL, 0.2), np.full(nL, 16.0)
    for _ in range(40):
        mid = 0.5 * (lo + hi); o = outside(mid) > 0; hi = np.where(o, mid, hi); lo = np.where(o, lo, mid)
    Llen = np.clip(lo * rng.uniform(*S['uneven'], nL), 1.5, 10.0)      # some limbs stop short of the outline, so the crown is lumpy, not a ball
    limbs = pos[:, None, :] + (shape - pos[:, None, :]) * Llen[:, None, None]
    tr_at = np.interp(tL, ty, trunk_R[0])
    sL = np.linspace(0, 1, NL)
    limb_R = (np.minimum(tr_at * 0.7, 0.035 + 0.018 * Llen))[:, None] * (1 - sL[None]) ** 0.8 + 0.014

    # ---- boughs off the limbs (and a few off the upper trunk), heading out every way and curving up a little
    par, t, pos, d = offshoots(limbs, Llen, 0.16, 0.95, S['bough_gap'], 35, 68, -40, 60)
    Blen = np.clip(0.58 * (1 - t) * Llen[par] * rng.uniform(0.7, 1.25, len(t)) + 0.9, 0.8, 4.2)
    r_par = limb_R[par, np.minimum((t * (NL - 1)).astype(int), NL - 1)]
    pt, tt, post, dt = offshoots(trunk, np.array([H]), 0.55, 0.985, S['bough_gap'] * 0.8, 40, 70, -20, 50)
    Blen = np.concatenate([Blen, np.clip(rng.uniform(1.0, 2.4, len(tt)) * (1.25 - tt), 0.7, 3.0)])
    pos = np.concatenate([pos, post]); d = np.concatenate([d, dt]); r_par = np.concatenate([r_par, np.interp(tt, ty, trunk_R[0])])
    NB = 10
    boughs = grow(pos, d, Blen, NB, UP[None] * rng.uniform(0.15, 0.6, (len(pos), 1)), 0.8)
    sB = np.linspace(0, 1, NB)
    bough_R = (np.minimum(r_par * 0.6, 0.014 + 0.012 * Blen))[:, None] * (1 - sB[None]) ** 0.8 + 0.008

    # ---- sprays: the small branches that carry the twigs, off the boughs and the outer part of each limb. Each one ends
    # up a clump of foliage.
    p1, t1, pos1, d1 = offshoots(boughs, Blen, 0.12, 0.97, S['spray_gap'], 35, 72, -55, 65)
    p2, t2, pos2, d2 = offshoots(limbs, Llen, 0.5, 0.98, S['spray_gap'], 38, 75, -55, 65)
    Slen = np.concatenate([np.clip(0.5 * (1 - t1) * Blen[p1] * rng.uniform(0.7, 1.3, len(t1)) + 0.55, 0.45, 1.9),
                           np.clip(rng.uniform(0.6, 1.5, len(t2)) * (1.3 - t2), 0.45, 1.6)])
    spos = np.concatenate([pos1, pos2]); sdir = np.concatenate([d1, d2])
    NS = 6
    sprays = grow(spos, sdir, Slen, NS, UP[None] * rng.uniform(-0.15, 0.45, (len(spos), 1)), 0.7)
    spray_R = (0.006 + 0.004 * Slen)[:, None] * (1 - np.linspace(0, 1, NS)[None]) ** 0.7 + 0.004

    # ---- twigs: along the sprays, and one carrying on from the tip of every spray, bough and limb and the trunk
    p1, t1, pos1, d1 = offshoots(sprays, Slen, 0.32, 0.99, S['twig_gap'] * 0.68, 35, 78, -60, 70)      # on its outer two thirds: each spray ends in a tuft, with gaps between tufts
    ends = np.concatenate([sprays[:, -1], boughs[:, -1], limbs[:, -1], trunk[:, -1]])
    end_d = unit(np.concatenate([sprays[:, -1] - sprays[:, -2], boughs[:, -1] - boughs[:, -2], limbs[:, -1] - limbs[:, -2], trunk[:, -1] - trunk[:, -2]]))
    tpos = np.concatenate([pos1, ends]); td = np.concatenate([d1, end_d])
    tfrac = np.concatenate([t1, np.ones(len(ends))])
    Tlen = rng.uniform(0.3, 0.62, len(tpos)) * (1 - 0.3 * tfrac)
    twigs = grow(tpos, td, Tlen, 4, UP[None] * rng.uniform(-0.3, 0.3, (len(tpos), 1)), 0.5)
    twig_R = np.linspace(0.005, 0.002, 4)[None] * np.ones((len(tpos), 1))

    # ---- leaves: one every few centimetres along each twig, on alternate sides, blades turned up to the light
    lp, lt, lpos, ld = offshoots(twigs, Tlen, 0.10, 1.0, S['leaf_gap'], 35, 75, -40, 40)
    nLeaf = len(lp)
    nrm = unit(UP[None] * 0.85 + rng.normal(0, 0.42, (nLeaf, 3)))
    ld = unit(ld + UP[None] * rng.uniform(-0.35, 0.1, (nLeaf, 1)))                 # most hang a little
    nrm = unit(nrm - ld * np.sum(nrm * ld, axis=1, keepdims=True)); sd = np.cross(ld, nrm)
    ll = S['leaf_len'] * rng.uniform(0.72, 1.2, nLeaf); lw = ll * S['leaf_wide'] * 0.5
    base = lpos + ld * 0.012
    mid = base + ld * (ll * 0.46)[:, None] + nrm * (lw * 0.16)[:, None]            # the blade folds a little along its midrib
    leaf_v = np.stack([base, mid - sd * lw[:, None], base + ld * ll[:, None] - nrm * (ll * 0.06)[:, None], mid + sd * lw[:, None]], 1).reshape(-1, 3)
    i0 = np.arange(nLeaf) * 4
    leaf_f = np.concatenate([np.stack([i0, i0 + 1, i0 + 2], 1), np.stack([i0, i0 + 2, i0 + 3], 1)])
    VPL = 4; leaf_area = ll * lw * 1.1
    # (polylines, radii, sides round, how thin: thin wood is a little lighter and greener)
    wood_parts = [(trunk, trunk_R, 14, 0.0), (limbs, limb_R, 9, 0.2), (boughs, bough_R, 6, 0.45), (sprays, spray_R, 4, 0.75), (twigs[:, [0, 3]], twig_R[:, [0, 3]], 3, 1.0)]      # a twig is too thin to matter: one straight piece
else:
    # ---- a conifer's branches: whorls up the trunk, closing up toward the top, four to six branches to a whorl, and
    # shorter ones in between. Each reaches the cone's outline at its height.
    zs = [hb]
    while zs[-1] < H - 1.0: zs.append(zs[-1] + S['whorl_gap'] * (1.0 - 0.5 * (zs[-1] - hb) / (H - hb)))
    wz = np.array(zs); cnt = rng.integers(4, 7, len(wz)); nW = int(cnt.sum())
    z = np.repeat(wz, cnt) + rng.normal(0, 0.06, nW)
    az = np.concatenate([rng.uniform(0, 2 * np.pi) + (np.arange(c) + rng.uniform(-0.2, 0.2, c)) * 2 * np.pi / c for c in cnt])
    nX = int(nW * 0.6)
    z = np.concatenate([z, rng.uniform(hb, H - 1.4, nX)]); az = np.concatenate([az, rng.uniform(0, 2 * np.pi, nX)])
    short = np.concatenate([np.ones(nW), rng.uniform(0.35, 0.7, nX)])
    nL = len(z); u = np.clip((z - hb) / (H - hb), 0, 1); tL = np.clip(z / (H - 0.7), 0, 0.99)
    pos, _ = along(trunk, np.zeros(nL, int), tL)
    rise = np.radians(S['rise'](u) + rng.normal(0, 5, nL))
    d0 = np.stack([np.cos(az) * np.sin(rise), np.sin(az) * np.sin(rise), np.cos(rise)], 1)
    NL = 10
    shape = grow(pos, d0, np.ones(nL), NL, UP[None] * (S['lift'] * rng.uniform(0.7, 1.2, nL))[:, None], 0.25)
    run = np.linalg.norm((shape[:, -1] - shape[:, 0])[:, :2], axis=1)
    Llen = np.clip(S['crown_r'] * S['reach'](u) * short * rng.uniform(0.85, 1.1, nL) / np.maximum(run, 0.4), 0.25, 6.0)
    limbs = pos[:, None, :] + (shape - pos[:, None, :]) * Llen[:, None, None]
    sL = np.linspace(0, 1, NL)
    limb_R = (np.minimum(np.interp(tL, ty, trunk_R[0]) * 0.45, 0.008 + 0.011 * Llen))[:, None] * (1 - sL[None]) ** 0.8 + 0.006

    # ---- side shoots, flat to either side and a little down, longest near the trunk: every branch is a fan
    par, t, pos, d = offshoots(limbs, Llen, 0.10, 0.96, S['bough_gap'], 42, 68, -28, 10)
    Blen = np.clip(0.45 * (1 - t) * Llen[par] * rng.uniform(0.75, 1.2, len(t)) + 0.22, 0.18, 1.7)
    NB = 6
    boughs = grow(pos, d, Blen, NB, UP[None] * rng.uniform(-0.65, -0.05, (len(pos), 1)), 0.35)
    bough_R = (0.004 + 0.006 * Blen)[:, None] * (1 - np.linspace(0, 1, NB)[None]) ** 0.7 + 0.003
    sprays = np.zeros((0, 2, 3))

    # ---- twigs: along the side shoots and the branches themselves, up the leader, and carrying on from every tip
    p1, t1, pos1, d1 = offshoots(boughs, Blen, 0.06, 0.98, S['twig_gap'], 38, 62, -25, 25)
    p2, t2, pos2, d2 = offshoots(limbs, Llen, 0.25, 0.98, S['twig_gap'] * 1.2, 40, 65, -25, 30)
    p3, t3, pos3, d3 = offshoots(trunk, np.array([H - 0.7]), 0.93, 0.995, S['twig_gap'], 40, 70, -10, 40)
    ends = np.concatenate([boughs[:, -1], limbs[:, -1], trunk[:, -1]])
    end_d = unit(np.concatenate([boughs[:, -1] - boughs[:, -2], limbs[:, -1] - limbs[:, -2], trunk[:, -1] - trunk[:, -2]]))
    tpos = np.concatenate([pos1, pos2, pos3, ends]); td = np.concatenate([d1, d2, d3, end_d])
    tfrac = np.concatenate([t1, t2, t3, np.zeros(len(ends))])
    Tlen = rng.uniform(0.18, 0.42, len(tpos)) * (1 - 0.4 * tfrac)
    twigs = grow(tpos, td, Tlen, 4, UP[None] * rng.uniform(-0.2, 0.15, (len(tpos), 1)), 0.25)
    twig_R = np.linspace(0.004, 0.0018, 4)[None] * np.ones((len(tpos), 1))

    # ---- needle tufts: a small pointed blade every couple of centimetres along each twig, standing out all round it
    # like a bottle brush, the blades turned every way so the twig looks clothed from any side
    lp, lt, lpos, ld = offshoots(twigs, Tlen, 0.0, 1.0, S['leaf_gap'], 45, 72, -85, 85)
    nLeaf = len(lp)
    nrm = unit(rng.normal(0, 1, (nLeaf, 3)))
    nrm = unit(nrm - ld * np.sum(nrm * ld, axis=1, keepdims=True)); sd = np.cross(ld, nrm)
    ll = S['leaf_len'] * rng.uniform(0.8, 1.2, nLeaf); lw = ll * S['leaf_wide'] * 0.5
    leaf_v = np.stack([lpos - sd * lw[:, None], lpos + ld * ll[:, None], lpos + sd * lw[:, None]], 1).reshape(-1, 3)
    leaf_f = np.arange(nLeaf * 3).reshape(-1, 3)
    VPL = 3; leaf_area = ll * lw
    wood_parts = [(trunk, trunk_R, 14, 0.0), (limbs, limb_R, 6, 0.3), (boughs, bough_R, 4, 0.7), (twigs[:, [0, 3]], twig_R[:, [0, 3]], 3, 1.0)]

# leaf colour: each a little lighter or darker, a few yellowing, the outer and upper ones a touch lighter
lc = np.array(S['leaf_col'])[None] * rng.uniform(0.72, 1.3, (nLeaf, 1))
yel = rng.random(nLeaf) < S.get('yellow', 0.10); lc[yel] = lc[yel] * np.array([1.7, 1.25, 0.8])
outer = np.clip(np.linalg.norm(lpos[:, :2], axis=1) / S['crown_r'], 0, 1) * 0.5 + np.clip(lpos[:, 2] / H, 0, 1) * 0.5
lc = lc * (0.82 + 0.36 * outer)[:, None]
if NEAR:
    # Thin only AFTER the complete source tree has grown. Stratify by leaf order (siblings
    # are adjacent), keeping foliage on every limb. Preserve blade area about its centre.
    # Trace the same first surface as bakeOct, using the complete source mesh.
    # Build this before thinning, while all of the original leaves and wood exist.
    from mathutils.bvhtree import BVHTree
    from mathutils import Vector
    blocker_v, blocker_f = [leaf_v], [leaf_f]
    offset = len(leaf_v)
    for P, R, sides, _ in wood_parts:
        vertices, faces = tubes(P, R, sides)
        blocker_v.append(vertices)
        blocker_f.append(offset + faces)
        offset += len(vertices)
    tree_bvh = BVHTree.FromPolygons(np.concatenate(blocker_v).tolist(), np.concatenate(blocker_f).tolist(), all_triangles=True)
    del blocker_v, blocker_f
    full_centres = leaf_v.reshape(nLeaf, VPL, 3).mean(axis=1)
    full_base = leaf_v[:, 2].min()
    trunk_base = tubes(trunk, trunk_R, 14)[0][:, 2].min()
    source_base = min(full_base, trunk_base)
    source_height = leaf_v[:, 2].max() - source_base
    source_radius = np.linalg.norm(leaf_v[:, :2], axis=1).max() * 1.02
    count = 7600 if VPL == 4 else 14500
    pick = ((np.arange(count) + rng.random(count)) * nLeaf / count).astype(int)
    anchors = full_centres[pick]
    blades = leaf_v.reshape(nLeaf, VPL, 3)[pick]
    # Frame each spray on a folded pair of triangles. Its UV silhouette is a
    # short shoot of leaves (or needles); the enlargement compensates for its gaps.
    extent = np.sqrt(nLeaf / count) * (1.28 if VPL == 4 else 1.43)
    leaf_v = (anchors[:, None] + (blades - anchors[:, None]) * extent).reshape(-1, 3)
    i0 = np.arange(count) * VPL
    leaf_f = np.stack([i0, i0 + 1, i0 + 2], 1)
    if VPL == 4:
        leaf_f = np.concatenate([leaf_f, np.stack([i0, i0 + 2, i0 + 3], 1)])
    nLeaf = count
    lc = lc[pick]
    # Keep the curved trunk, limbs and boughs. Only the broadleafs need separate
    # spray stems. The larger blades stand in for the twig tips and needle tufts.
    def reduced_tube(P, R, rings, sides, thin):
        ix = np.linspace(0, P.shape[1] - 1, rings).round().astype(int)
        return P[:, ix], R[:, ix], sides, thin
    if VPL == 4:
        wood_parts = [wood_parts[0], reduced_tube(limbs, limb_R, 8, 6, 0.2),
                      reduced_tube(boughs, bough_R, 5, 4, 0.45), reduced_tube(sprays, spray_R, 2, 3, 0.75)]
    else:
        wood_parts = [wood_parts[0], reduced_tube(limbs, limb_R, 4, 4, 0.3),
                      reduced_tube(boughs[Blen > 0.9], bough_R[Blen > 0.9], 2, 3, 0.7)]

leaf_c = np.repeat(np.concatenate([lc, np.ones((nLeaf, 1))], 1), VPL, axis=0)

# ---- wood mesh
parts = [tubes(P, R, sides) for P, R, sides, _ in wood_parts]
wv, wf, off = [], [], 0
for v, f in parts: wv.append(v); wf.append(f + off); off += len(v)
wood_v, wood_f = np.concatenate(wv), np.concatenate(wf)
bark = np.array(S['bark_col'])
thin = np.concatenate([np.full(len(v), wp[3]) for (v, f), wp in zip(parts, wood_parts)])
wc = bark[None] * (1 + 0.35 * thin)[:, None] * rng.uniform(0.85, 1.15, (len(wood_v), 1)) + np.array([0.0, 0.012, 0.0])[None] * thin[:, None]
wood_c = np.concatenate([wc, np.ones((len(wc), 1))], 1)

print(f'[tree_gen] {name}: {nL} limbs, {len(boughs)} boughs, {len(sprays)} sprays, {len(twigs)} twigs, {nLeaf} leaves; {len(wood_f) + len(leaf_f)} triangles ({time.time() - t_start:.1f} s)')
# the crown's outline: how far the leaves reach (95th percentile) in ten bands of height
lr = np.linalg.norm(lpos[:, :2], axis=1); band = np.clip((lpos[:, 2] / H * 10).astype(int), 0, 9)
print('[tree_gen] crown radius by height band:', ' '.join(f'{np.percentile(lr[band == b], 95):.1f}' if (band == b).sum() > 50 else '-' for b in range(10)),
      f'| top {lpos[:, 2].max():.1f} m, lowest leaf {lpos[:, 2].min():.1f} m, leaf area / ground area {leaf_area.sum() / (np.pi * np.percentile(lr, 95) ** 2):.1f}')

# ---- into Blender
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

def make(obj_name, verts, tris, cols, smooth):
    me = bpy.data.meshes.new(obj_name); nv, nf = len(verts), len(tris)
    me.vertices.add(nv); me.vertices.foreach_set('co', verts.astype(np.float32).ravel())
    me.loops.add(nf * 3); me.loops.foreach_set('vertex_index', tris.astype(np.int32).ravel())
    me.polygons.add(nf); me.polygons.foreach_set('loop_start', np.arange(nf, dtype=np.int32) * 3); me.polygons.foreach_set('loop_total', np.full(nf, 3, dtype=np.int32))
    me.polygons.foreach_set('use_smooth', np.full(nf, smooth, dtype=bool))
    me.update(calc_edges=True); me.validate()
    ca = me.color_attributes.new('Color', 'FLOAT_COLOR', 'POINT'); ca.data.foreach_set('color', cols.astype(np.float32).ravel())
    me.color_attributes.active_color = ca; me.color_attributes.render_color_index = 0
    ob = bpy.data.objects.new(obj_name, me); scene.collection.objects.link(ob)
    return ob

def material(mat_name, two_sided):
    m = bpy.data.materials.new(mat_name); m.use_nodes = True; nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    ca = nt.nodes.new('ShaderNodeVertexColor'); ca.layer_name = 'Color'
    nt.links.new(ca.outputs['Color'], b.inputs['Base Color']); b.inputs['Roughness'].default_value = 0.6
    m.use_backface_culling = not two_sided
    return m

wood = make(name + '_wood', wood_v, wood_f, wood_c, True); wood.data.materials.append(material(name + '_bark', False))
leaves = make(name + '_leaves', leaf_v, leaf_f, leaf_c, True); leaves.data.materials.append(material(name + '_leaf', True))

def sprig_material(obj, conifer):
    """Paint a small, mipmapped local detail silhouette onto each retained blade."""
    side = 256
    v, u = (np.indices((side, side)) + 0.5) / side
    x = u - 0.5
    stem = (0.009 if conifer else 0.012) * (1 - 0.75*v)
    mask = abs(x) < stem
    tone = np.where(mask, 0.70, 0.96)
    # A pair of tapered needles or veined leaflets at each node. Keep the
    # silhouette within the actual triangle (fir) or folded diamond (broadleaf).
    pairs = 19 if conifer else 5
    for j in range(pairs):
        for direction in [-1, 1]:
            t = (j + (0.16 if direction < 0 else 0.62)) / pairs
            if conifer:
                y0 = 0.01 + 0.82*t
                rise = 0.11 + 0.12*(1-t)
                span = 0.49*(1-y0-rise) * (0.92 + 0.07*np.sin(9*j))
                width = 0.014*(1-0.4*t)
            else:
                y0 = 0.025 + 0.77*t
                rise = 0.18 * (1-0.35*t)
                tip_y = y0 + rise
                span = 0.46 * min(tip_y/0.46, (1-tip_y)/0.54)
                width = 0.055 + 0.014*np.sin(np.pi*t)
            dx = x*direction
            along = dx / max(span, 1e-5)
            f = np.clip(along, 0, 1)
            curve = y0 + rise * (0.72*f + 0.28*f*f)
            radius = width * np.maximum(0, np.sin(np.pi*f)) ** (0.68 if conifer else 0.82)
            midrib = v - curve
            inside = (along > 0) & (along < 1) & (abs(midrib) < radius)
            highlight = np.exp(-abs(midrib) / 0.0035)
            tone = np.where(inside, 0.90 + 0.07*(midrib > 0) + 0.065*highlight, tone)
            mask |= inside
    # Narrow terminal leaf and the tip of the shoot.
    terminal = np.clip((v - 0.76)/0.24, 0, 1)
    mask |= (v > 0.76) & (abs(x) < (0.027 if conifer else 0.052) * np.sin(np.pi*terminal))
    rgba = np.stack([tone, tone, tone, mask], -1).astype(np.float32)
    image = bpy.data.images.new(name + '_sprig', width=side, height=side, alpha=True)
    image.alpha_mode = 'STRAIGHT'
    image.pixels.foreach_set(rgba.ravel())
    image.pack()
    me = obj.data
    uv = me.uv_layers.new(name='Sprig')
    coords = [[0, 0], [0.5, 1], [1, 0]] if conifer else [[0.5, 0], [0, 0.46], [0.5, 1], [1, 0.46]]
    uv.data.foreach_set('uv', np.asarray(coords, dtype=np.float32)[leaf_f.ravel() % VPL].ravel())
    mat = obj.data.materials[0]
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = image; tex.interpolation = 'Linear'
    # The runtime reads the embedded opacity map and the original vertex colours.
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
    return tex

if NEAR:
    sprig = sprig_material(leaves, VPL == 3)
    # Fit the same 32 sky directions and exponential extinction as the atlas.
    points = np.concatenate([wood_v, anchors])
    reach = 3 * source_height
    visibility = []
    basis = []
    for i in range(32):
        y = (i + 0.5) / 32
        angle = i * 2.399963
        r = np.sqrt(1 - y*y)
        L = np.array([r*np.cos(angle), -r*np.sin(angle), y])  # Blender coordinates
        # Shoot back from the light, not out from inside the crown. A miss
        # sees open sky. The ray length is converted to depth through foliage.
        ray = Vector(-L)
        hits = (tree_bvh.ray_cast(Vector(origin), ray, reach)[3] for origin in points + reach * L)
        thickness = np.fromiter((0 if d is None else reach-d for d in hits), dtype=float, count=len(points))
        visibility.append(np.exp(-np.maximum(thickness - 0.03*source_radius, 0) / (0.22*source_radius)))
        basis.append([1, L[0], L[2], -L[1]])  # fit in glTF's Y-up frame
    h = np.clip((points[:, 2] - source_base) / (0.3 * source_height), 0, 1)
    vis = np.array(visibility) * (0.4 + 0.6*h*h*(3-2*h))
    fit = np.linalg.pinv(basis) @ vis
    sun = np.clip(fit[1:].T, -2, 2)
    sky = np.stack([np.clip(fit[0], -0.5, 1.5), vis.mean(axis=0), np.arange(len(points)) >= len(wood_v)], 1)
    for ob, sl, copies in [(wood, slice(0, len(wood_v)), 1), (leaves, slice(len(wood_v), None), VPL)]:
        for attr, values in [('_sun', sun), ('_sky', sky)]:
            a = ob.data.attributes.new(attr, 'FLOAT_VECTOR', 'POINT')
            a.data.foreach_set('vector', np.repeat(values[sl], copies, axis=0).astype(np.float32).ravel())
        # The atlas is centred on the full model's bounds, around the trunk's axis.
        ob.location.z -= source_base

if not NOSAVE:
    out = os.path.join(proj, 'public', 'models') if NEAR else os.path.join(proj, 'assets-src', 'models', name); os.makedirs(out, exist_ok=True)
    for o in scene.objects: o.select_set(True)
    kw = dict(filepath=os.path.join(out, name + ('_near.glb' if NEAR else '.glb')), export_format='GLB', use_selection=True, export_yup=True, export_apply=True, export_animations=False)
    if NEAR: kw['export_attributes'] = True
    try: bpy.ops.export_scene.gltf(**kw, export_vertex_color='ACTIVE')
    except TypeError: bpy.ops.export_scene.gltf(**kw, export_colors=True)
    print(f'[tree_gen] wrote {kw["filepath"]} ({os.path.getsize(kw["filepath"]) / 1e6:.1f} MB)')

# ---- preview stills: sun and sky roughly as in the game's afternoon
if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    scene.render.engine = 'CYCLES'; scene.cycles.samples = 48; scene.cycles.device = 'CPU'
    try: scene.cycles.use_denoising = True
    except Exception: pass
    scene.render.resolution_x, scene.render.resolution_y = 760, 900; scene.render.image_settings.file_format = 'JPEG'; scene.render.image_settings.quality = 88
    try: scene.view_settings.view_transform = 'Standard'
    except Exception: pass
    world = bpy.data.worlds.new('w'); world.use_nodes = True; scene.world = world
    bg = next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND'); bg.inputs['Color'].default_value = (0.42, 0.60, 0.95, 1); bg.inputs['Strength'].default_value = 0.55
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 5.0; sun.data.angle = math.radians(1.5); scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(52), 0, math.radians(35))
    # leaves let some light through
    nt = leaves.data.materials[0].node_tree; b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'); outn = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
    tl = nt.nodes.new('ShaderNodeBsdfTranslucent'); mx = nt.nodes.new('ShaderNodeMixShader'); mx.inputs[0].default_value = 0.3
    nt.links.new(next(n for n in nt.nodes if n.type == 'VERTEX_COLOR').outputs['Color'], tl.inputs['Color'])
    nt.links.new(b.outputs['BSDF'], mx.inputs[1]); nt.links.new(tl.outputs['BSDF'], mx.inputs[2]); nt.links.new(mx.outputs['Shader'], outn.inputs['Surface'])
    if NEAR:
        # Use the same vertex pigments and cutouts in the Cycles inspection.
        vc = next(n for n in nt.nodes if n.type == 'VERTEX_COLOR')
        pigment = nt.nodes.new('ShaderNodeMixRGB'); pigment.blend_type = 'MULTIPLY'
        pigment.inputs[0].default_value = 1
        nt.links.new(vc.outputs['Color'], pigment.inputs[1]); nt.links.new(sprig.outputs['Color'], pigment.inputs[2])
        nt.links.new(pigment.outputs[0], b.inputs['Base Color']); nt.links.new(pigment.outputs[0], tl.inputs['Color'])
        b.inputs['Alpha'].default_value = 1
        for link in list(b.inputs['Alpha'].links): nt.links.remove(link)
        cut = nt.nodes.new('ShaderNodeMixShader'); transparent = nt.nodes.new('ShaderNodeBsdfTransparent')
        nt.links.new(sprig.outputs['Alpha'], cut.inputs[0]); nt.links.new(transparent.outputs[0], cut.inputs[1])
        nt.links.new(mx.outputs[0], cut.inputs[2]); nt.links.new(cut.outputs[0], outn.inputs['Surface'])
        scene.cycles.transparent_max_bounces = 24
    gm = bpy.data.meshes.new('ground'); gm.from_pydata([(-80, -80, 0), (80, -80, 0), (80, 80, 0), (-80, 80, 0)], [], [(0, 1, 2, 3)]); g = bpy.data.objects.new('ground', gm); scene.collection.objects.link(g)
    gmat = bpy.data.materials.new('g'); gmat.use_nodes = True; next(n for n in gmat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED').inputs['Base Color'].default_value = (0.035, 0.05, 0.022, 1); gm.materials.append(gmat)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scene.collection.objects.link(cam); scene.camera = cam; cam.data.lens = 50
    from mathutils import Vector
    def shoot(tag, az, el, dist, target_h, lens=50):
        tgt = Vector((0, 0, target_h)); a, e = math.radians(az), math.radians(el)
        cam.location = tgt + Vector((math.cos(a) * math.cos(e), math.sin(a) * math.cos(e), math.sin(e))) * dist
        cam.rotation_euler = (tgt - cam.location).to_track_quat('-Z', 'Y').to_euler(); cam.data.lens = lens
        scene.render.filepath = os.path.join(PREVIEW, f'{name}_{tag}.jpg'); bpy.ops.render.render(write_still=True)
    shoot('side', 200, 6, H * 2.5, H * 0.52)
    shoot('above', 250, 38, H * 2.6, H * 0.55)
    shoot('top', 90, 86, H * 2.4, H * 0.6)
    shoot('close', 215, 12, H * 0.55, H * 0.62, 70)
    print(f'[tree_gen] previews in {PREVIEW} ({time.time() - t_start:.1f} s)')
