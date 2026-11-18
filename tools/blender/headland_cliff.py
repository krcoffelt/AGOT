# The Red Keep's headland as one continuous limestone cliff, built over the game's own terrain so it fits the coast exactly.
#   Blender -b --factory-startup --python tools/blender/headland_cliff.py -- <project dir> [--res 2048] [--segs 8]
# Input: public/impostors/kl_headland.json — the game's height grid round the headland (written by the page: see
# docs in rocks.js / game.exportHeadland), the plateau height and the curtain's line.
# The rock is the ground itself, reworked: on the seaward slopes between the curtain's foot and the waterline the ground is
# terraced into beds (a steep riser at the foot of each bed, a bench on top), the risers split along vertical joints into
# blocks that stand proud or back (and now and then a deep cleft), and everything fades back to the plain ground at the
# edges of the cliff zone (sunk a little below it, so the terrain covers the seam). Above the ground everywhere, so the
# game's terrain never shows through. A detailed version (0.5 m, faceted flaking) has its relief baked into object-space
# normal maps for the game mesh (2 m), which is cut into angular segments, each with its own map.
# Vertex colours: R crevice shading (dirty vertex colours), G scrub mask (benches and ledges), B = R.
# Writes public/models/headland.glb (hl_0 … hl_N-1, local to the headland centre), hl_<k>_n.jpg, headland.json.
import bpy, bmesh, sys, os, json, math, time
import numpy as np
from mathutils import Vector, noise

argv = sys.argv[sys.argv.index('--') + 1:]
proj = argv[0]
RES = int(argv[argv.index('--res') + 1]) if '--res' in argv else 2048
SEGS = int(argv[argv.index('--segs') + 1]) if '--segs' in argv else 8
GEO_TRIS = int(argv[argv.index('--tris') + 1]) if '--tris' in argv else 1_200_000      # the game mesh, all segments together
LO_RATIO = 0.08; MID_RATIO = 0.3; SHARP = 38.0      # far LOD (beyond ~1.3 km); edges sharper than this stay hard
VOXEL = float(argv[argv.index('--voxel') + 1]) if '--voxel' in argv else 0.3
OUT = os.path.join(proj, 'public', 'models')
D = json.load(open(os.path.join(proj, 'public', 'impostors', 'kl_headland.json')))
N, STEP, R0 = D['n'], D['step'], D['R']
HGT = np.array(D['h'], dtype=np.float32).reshape(N, N)          # [j][i] → game x = -R + i·step, game z = -R + j·step
PLAT = D['plateau']; CUR = D['curtain']

def height(gx, gz):
    """bilinear terrain height at game-local (x, z) (arrays)"""
    fi = (gx + R0) / STEP; fj = (gz + R0) / STEP
    i0 = np.clip(np.floor(fi).astype(int), 0, N - 2); j0 = np.clip(np.floor(fj).astype(int), 0, N - 2)
    tx = np.clip(fi - i0, 0, 1); tz = np.clip(fj - j0, 0, 1)
    a = HGT[j0, i0]; b = HGT[j0, i0 + 1]; c = HGT[j0 + 1, i0]; d = HGT[j0 + 1, i0 + 1]
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz

def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)

def curtain_r(a):
    return CUR['R'] / (np.abs(np.cos(a)) ** 2.4 + np.abs(np.sin(a)) ** 2.4) ** (1 / 2.4)      # (as landmarks.js)

def zone(gx, gz, h):
    """0..1: how much of the cliff treatment a point gets"""
    a = np.arctan2(gz, gx); d = np.hypot(gx, gz)
    wa = 1 - smooth(math.radians(104), math.radians(126), np.abs(a))                 # the seaward side, round to where the city begins
    cr = curtain_r(a)
    wr = smooth(cr + 6, cr + 14, d)                                                    # clear of the curtain's foot on the plateau…
    wr = np.maximum(wr, (1 - smooth(PLAT - 16, PLAT - 8, h)) * smooth(cr - 10, cr - 3, d))   # …but the cliff face below it is all rock
    wh = smooth(-10.0, -6.0, h) * (1 - smooth(PLAT - 3.0, PLAT + 0.5, h))            # from well below the waterline (the sea hides it) to the brink
    wo = 1 - smooth(345.0, 390.0, d)
    return wa * wr * wh * wo

def _h(a, b, s):
    return (math.sin(a * 12.9898 + b * 78.233 + s * 37.719) * 43758.5453) % 1.0

def spur(uk):
    """the headland's spurs: rock ribs running down and out to the sea every ~45–80 m along the coast, scrubby gullies
    between. Returns (ridge 0..1: 1 on a spur's crest, 0 in a gully; strength of this spur 0.4..1; height where the sheer
    band under the curtain ends and the spur begins to run out)"""
    sp = uk / 62.0 + 0.45 * noise.noise(Vector((uk / 95.0, 2.9, 0.0))); si = math.floor(sp); fs = sp - si
    c = 0.5 + (_h(si, 0.0, 21) - 0.5) * 0.35                                              # the crest is not centred
    r = 1.0 - min(1.0, abs(fs - c) / (c if fs < c else 1.0 - c))
    ridge = min(1.0, max(0.0, (r - 0.22) / 0.3)); ridge = ridge * ridge * (3 - 2 * ridge)          # flat-fronted spurs with steep flanks
    return ridge, 0.4 + 0.6 * _h(si, 0.0, 22), PLAT - 22.0 - 14.0 * _h(si, 0.0, 23)

def relief(gx, gz, h, w):
    """the reworked ground: returns (new height, outward horizontal push) for arrays of points"""
    a = np.arctan2(gz, gx); u = a * 200.0                                              # metres along the coast
    # beds ~10 m thick whose base wanders along the coast; a steep riser over the lower 30% of each, a bench on top
    z0 = np.array([-3.0 + 4.0 * noise.noise(Vector((float(x) * 0.015, 0.3, 0.7))) for x in u], dtype=np.float32)
    bed = 10.0
    t = (h - z0) / bed; fl = np.floor(t); fr = t - fl
    gg = smooth(0.0, 0.3, fr)
    zt = np.minimum(z0 + bed * (fl + gg), PLAT + 1.0)
    rr = np.where(fr < 0.3, 4 * (fr / 0.3) * (1 - fr / 0.3), 0.0)                     # how much this point is a riser face
    zn = h + w * (np.maximum(zt, h) - h) + 0.5 * w - 0.8 * (1 - w)                    # above the ground inside the zone, sunk at its edge
    # joints: tall blocks along the risers, each a plane of its own offset and tilt, open cracks between, some deep clefts
    push = np.zeros_like(h)
    for k in range(len(h)):
        if w[k] <= 0.001: continue
        uk, zk = float(u[k]), float(zn[k])
        # columns along the vertical joints, 7–20 m wide (boundaries wander a little as they climb)
        cu = uk / 13.0 + 0.45 * noise.noise(Vector((uk / 45.0, 0.7, 0.0))) + 0.06 * noise.noise(Vector((zk / 18.0, 3.3, 0.0)))
        ci = math.floor(cu); fu = cu - ci
        # each column broken into blocks 7–26 m tall by joints that are not level across columns
        bhgt = 7.0 + 19.0 * _h(ci, 0.0, 11)
        zb = (zk + 3.0 + _h(ci, 0.0, 12) * bhgt + (_h(ci, 0.0, 24) - 0.5) * 0.7 * (fu - 0.5) * 13.0) / bhgt; bi = math.floor(zb); fz = zb - bi      # breaks inclined up to ~±20°
        # the block's face: a plane of its own depth, lean (top out or in) and twist (one edge proud of the other)
        lz = (fz - 0.5) * bhgt; lu = (fu - 0.5) * 13.0
        f = (_h(ci, bi, 1) - 0.5) * 9.0 + (_h(ci, bi, 2) - 0.5) * 0.6 * lz + (_h(ci, bi, 3) - 0.5) * 0.6 * lu
        f += (_h(ci, 0.5, 4) - 0.5) * 6.0                                              # the whole column proud or set back
        # open joints: vertical between columns, horizontal between blocks (deeper toward the top of a block: its undercut)
        f -= 1.8 * max(0.0, 1.0 - min(fu, 1.0 - fu) / 0.04) ** 2
        f -= 2.0 * max(0.0, 1.0 - min(fz, 1.0 - fz) * bhgt / 1.1) ** 2
        # small facets and spalls on each block face
        p2 = Vector((uk / 2.8 + 5.1, zk / 4.5 + 9.3, 1.7))
        dist2, pts2 = noise.voronoi(p2, distance_metric='DISTANCE'); c2 = pts2[0]
        f2 = (_h(c2.x, c2.y, 5) - 0.5) * 1.6 + (_h(c2.x, c2.y, 6) - 0.5) * 0.25 * (zk - (c2.y - 9.3) * 4.5) - 0.7 * (1 - min(1.0, (dist2[1] - dist2[0]) / 0.08)) ** 2
        # buttresses and bays of uneven width along the coast (broad, so the blocks stay flat)
        bt = 5.5 * noise.noise(Vector((uk / 40.0, 4.2, zk / 110.0)))
        # clefts: some columns are narrow slots set deep into the cliff, most of its height
        cl = 0.0
        if _h(ci, 0.5, 8) < 0.16:
            cl = 4.5 * min(1.0, max(0.0, (zk + 2.0) / 6.0)) * min(1.0, max(0.0, (PLAT - 4.0 - zk) / 10.0))
        # sea caves: where the sea has cut under some columns at its level, the block above overhangs
        cv = 0.0
        if _h(ci, 0.5, 9) < 0.35:
            cv = 4.0 * max(0.0, 1.0 - abs(zk - 1.5) / 5.0) ** 0.7 * min(1.0, 4.0 * min(fu, 1.0 - fu))
        # below the sheer band under the curtain the cliff runs out toward the sea: steep slopes (~55–65°) on a spur's crest,
        # steeper and set back in the gullies between (scrub there); the joint blocks show most on the spurs
        ridge, hs, zb = spur(uk); dz = max(0.0, zb - zk)
        # spurs step down in sheer crags (one per joint block: a riser, then a ledge where the next block stands further out)
        dzq = max(0.0, zb - ((bi + 1) * bhgt - 3.0 - _h(ci, 0.0, 12) * bhgt))  # depth below the sheer band of this block's top
        run_spur = dzq * (0.17 + 0.23 * hs)
        run_gully = dz * 0.12 - 5.0 * min(1.0, dz / 10.0)
        run = ridge * run_spur + (1.0 - ridge) * run_gully
        rel = (0.55 + 0.45 * ridge) if dz > 0 else 1.0
        push[k] = w[k] * max(1.8, 7.0 + bt + rel * (f + f2) - cl * ridge - cv + run)      # always out from the ground (2.5 m), so steep ground never hides it
    return zn, push

def build(name, spacing, a_lo=-math.pi, a_hi=math.pi, margin=0.0):
    """the rock surface over a grid at `spacing` m, faces whose corners all lie in the zone (and in the angle range)"""
    n = int(2 * 390 / spacing) + 1
    xs = -390 + np.arange(n) * spacing
    GX, GZ = np.meshgrid(xs, xs)                                                       # [j][i]
    H = height(GX, GZ); W = zone(GX, GZ, H)
    A = np.arctan2(GZ, GX)
    keep = (W > 0.0) & (A >= a_lo - margin) & (A <= a_hi + margin)
    # grow by one cell so the sunk rim is included
    k2 = keep.copy(); k2[1:, :] |= keep[:-1, :]; k2[:-1, :] |= keep[1:, :]; k2[:, 1:] |= keep[:, :-1]; k2[:, :-1] |= keep[:, 1:]
    idx = -np.ones((n, n), dtype=np.int64); js, is_ = np.nonzero(k2); idx[js, is_] = np.arange(len(js))
    gx, gz, h, w = GX[js, is_], GZ[js, is_], H[js, is_], W[js, is_]
    zn, push = relief(gx, gz, h, w)
    a = np.arctan2(gz, gx); px = gx + np.cos(a) * push; pz = gz + np.sin(a) * push
    co = np.stack([px, -pz, zn], axis=1).astype(np.float32)                          # Blender: y = −game z
    faces = []
    for j in range(n - 1):
        row = idx[j]; nxt = idx[j + 1]
        for i in range(n - 1):
            q = (row[i], row[i + 1], nxt[i + 1], nxt[i])
            if min(q) >= 0: faces.append((q[0], q[3], q[2], q[1]))
    me = bpy.data.meshes.new(name); me.from_pydata(co.tolist(), [], faces); me.update()
    me.validate()
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    # drop the loose verts of the grown rim that ended up in no face
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if all(v.co.z < -7.0 for v in f.verts)], context='FACES')      # not far under the water
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS'); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    return ob

def _hv(a, b, s):
    """vectorised _h"""
    return np.mod(np.sin(a * 12.9898 + b * 78.233 + s * 37.719) * 43758.5453, 1.0)

def _vnoise(p):
    """vectorised 3D value noise in [-1, 1] for an (n, 3) array"""
    i = np.floor(p); f = p - i; u = f * f * (3 - 2 * f)
    def h(dx, dy, dz):
        return np.mod(np.sin((i[:, 0] + dx) * 127.1 + (i[:, 1] + dy) * 311.7 + (i[:, 2] + dz) * 74.7) * 43758.5453, 1.0)
    x0 = h(0, 0, 0) * (1 - u[:, 0]) + h(1, 0, 0) * u[:, 0]; x1 = h(0, 1, 0) * (1 - u[:, 0]) + h(1, 1, 0) * u[:, 0]
    x2 = h(0, 0, 1) * (1 - u[:, 0]) + h(1, 0, 1) * u[:, 0]; x3 = h(0, 1, 1) * (1 - u[:, 0]) + h(1, 1, 1) * u[:, 0]
    y0 = x0 * (1 - u[:, 1]) + x1 * u[:, 1]; y1 = x2 * (1 - u[:, 1]) + x3 * u[:, 1]
    return (y0 * (1 - u[:, 2]) + y1 * u[:, 2]) * 2 - 1

def sculpt(src, voxel):
    """the cliff's surface detail, from its own joint structure (the same columns and blocks relief() lays out): deep
    V-shaped joints between the columns, an undercut under every block break, each block's face split into a few vertical
    sheets that step in and out and lean, long thin cracks down the sheets, and broad undulation across every break face.
    Flat planes and crisp steps, as jointed limestone breaks; no scanned blotches, no faceted crackle."""
    ob = src.copy(); ob.data = src.data.copy(); ob.name = 'headland_hd'; bpy.context.scene.collection.objects.link(ob)
    for m_ in list(ob.modifiers): ob.modifiers.remove(m_)
    rm = ob.modifiers.new('rm', 'REMESH'); rm.mode = 'VOXEL'; rm.voxel_size = voxel
    sm = ob.modifiers.new('sm', 'SMOOTH'); sm.factor = 0.4; sm.iterations = 1      # only the voxel stairs
    with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob], selected_editable_objects=[ob]):
        bpy.ops.object.modifier_apply(modifier='rm'); bpy.ops.object.modifier_apply(modifier='sm')
    me = ob.data; nv = len(me.vertices); t0 = time.time(); print('[headland] remeshed', nv, flush=True)
    co = np.empty(nv * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    nr = np.empty(nv * 3); me.vertices.foreach_get('normal', nr); nr = nr.reshape(-1, 3)
    uk = np.arctan2(-co[:, 1], co[:, 0]) * 200.0; zk = co[:, 2]
    # the columns exactly as relief() has them (same warp), so every joint here lies on one there
    w1 = np.array([noise.noise(Vector((float(x) / 45.0, 0.7, 0.0))) for x in uk]); w2 = np.array([noise.noise(Vector((float(z) / 18.0, 3.3, 0.0))) for z in zk])
    cu = uk / 13.0 + 0.45 * w1 + 0.06 * w2; ci = np.floor(cu); fu = cu - ci
    bh = 7.0 + 19.0 * _hv(ci, 0.0, 11); zb = (zk + 3.0 + _hv(ci, 0.0, 12) * bh + (_hv(ci, 0.0, 24) - 0.5) * 0.7 * (fu - 0.5) * 13.0) / bh; bi = np.floor(zb); fz = zb - bi      # (as relief(): inclined breaks)
    side = np.clip((0.88 - np.abs(nr[:, 2])) / 0.4, 0, 1)      # 1 on the faces, 0 on ledges and tops
    d = np.zeros(nv); dall = np.zeros(nv)
    # 1. the joints between columns: deep, V-shaped, continuous top to bottom (they cut the ledges too)
    gj = np.minimum(fu, 1 - fu) * 13.0
    dall -= 2.2 * np.clip(1 - gj / 0.75, 0, 1) ** 1.3
    # 2. block breaks: the upper block overhangs — the top ~1 m of each block is cut back, sharply at the break; some
    #    breaks barely open
    dt = (1 - fz) * bh; db = fz * bh; hb = _hv(ci, bi, 13); op = np.where(hb < 0.45, 0.08, 0.3 + 0.7 * hb) * (0.6 + 0.8 * _hv(ci, bi, 25))      # many breaks barely open; the open ones vary
    d -= op * (1.5 * np.clip(1 - dt / 1.1, 0, 1) ** 0.6 + 0.35 * np.clip(1 - db / 0.3, 0, 1))
    # 3. sheets: each block face split into 2–5 vertical sheets, each its own plane (offset, lean, twist), sharp steps
    #    between them and a thin crack at each step
    ns = 2 + np.floor(_hv(ci, bi, 14) * 4); fs = fu * ns + 0.45 * np.sin(fu * 9.0 + _hv(ci, bi, 26) * 6.283); si = np.floor(fs); ff = fs - si; key = bi * 7.0 + si      # sheets of uneven width
    d += (_hv(ci, key, 15) - 0.5) * 1.3 + (_hv(ci, key, 16) - 0.5) * 0.14 * (fz - 0.5) * bh + (_hv(ci, key, 17) - 0.5) * 0.5 * (ff - 0.5)
    gs = np.minimum(ff, 1 - ff) * 13.0 / ns
    d -= 0.4 * np.clip(1 - gs / 0.22, 0, 1) * (gj > 0.9)
    # 4. long thin cracks down the sheets, each running a stretch of the cliff and wandering a little
    for k in range(3):
        on = _hv(ci, k, 19) < 0.6
        pk = 0.15 + 0.7 * _hv(ci, k, 20); z0 = -2.0 + _hv(ci, k, 21) * 60.0; ln = 8.0 + _hv(ci, k, 22) * 30.0
        dist = np.abs((fu - pk) * 13.0 + 0.25 * np.sin(zk * 0.35 + k * 2.1 + ci))
        inside = np.clip((zk - z0) / 2.0, 0, 1) * np.clip((z0 + ln - zk) / 2.0, 0, 1)
        d -= 0.55 * np.clip(1 - dist / 0.22, 0, 1) * inside * on
    # 4b. smaller fractures inside each sheet: it breaks into pieces 1.5–4 m tall along inclined cracks, each piece a little
    #     proud or back (the network of small breaks across every face in the photos)
    mh = 1.5 + 2.5 * _hv(ci, key, 30)
    mz = (zk + (_hv(ci, key, 31) - 0.5) * 1.4 * (ff - 0.5) * 13.0 / ns + _hv(ci, key, 32) * mh) / mh; mi = np.floor(mz); mf = mz - mi
    d += (_hv(key * 3.1 + ci, mi, 33) - 0.5) * 0.4 + (_hv(key * 3.1 + ci, mi, 34) - 0.5) * 0.12 * (mf - 0.5) * mh
    d -= 0.18 * np.clip(1 - np.minimum(mf, 1 - mf) * mh / 0.25, 0, 1) * (_hv(key * 3.1 + ci, mi, 35) < 0.7)
    # 5. no break face is flat: broad undulation and a little roughness
    d += 0.22 * _vnoise(co / 3.2) + 0.07 * _vnoise(co / 1.1 + 17.0)
    disp = d * side + dall
    co += nr * disp[:, None]
    me.vertices.foreach_set('co', co.ravel()); me.update()
    for p_ in me.polygons: p_.use_smooth = True
    print(f'[headland] sculpt {nv} verts, features {round(time.time() - t0)} s', flush=True)
    return ob


def solid_remesh(ob, voxel, thick=4.0):
    """give the rock sheet a thickness (inward, under the ground), rebuild it as an even 3D mesh, and drop the buried back"""
    ctx = dict(object=ob, active_object=ob, selected_objects=[ob], selected_editable_objects=[ob])
    so = ob.modifiers.new('solid', 'SOLIDIFY'); so.thickness = thick; so.offset = -1.0
    rm = ob.modifiers.new('rm', 'REMESH'); rm.mode = 'VOXEL'; rm.voxel_size = voxel
    with bpy.context.temp_override(**ctx):
        bpy.ops.object.modifier_apply(modifier='solid'); bpy.ops.object.modifier_apply(modifier='rm')
    drop_buried(ob)

def drop_buried(ob, margin=1.0):
    me = ob.data; bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
    cs = np.array([f.calc_center_median()[:] for f in bm.faces], dtype=np.float32)
    hz = height(cs[:, 0], -cs[:, 1])
    bmesh.ops.delete(bm, geom=[f for f, c, g in zip(bm.faces, cs, hz) if c[2] < g - margin], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True

def paint(low):
    """vertex colours: R crevice shading (dirty vertex colours), G scrub mask (ledges, benches and the gullies between spurs)"""
    me = low.data; ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT'); me.color_attributes.active_color = ca
    nv = len(me.vertices); arr = np.ones((nv, 4), dtype=np.float32); ca.data.foreach_set('color', arr.ravel())
    sel(low); bpy.ops.object.mode_set(mode='VERTEX_PAINT')
    bpy.ops.paint.vertex_color_dirt(blur_strength=1.0, blur_iterations=2, clean_angle=math.pi, dirt_angle=0.0, dirt_only=True, normalize=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    dd = np.empty(nv * 4, dtype=np.float32); ca.data.foreach_get('color', dd); dd = dd.reshape(-1, 4)
    ao = np.clip(0.3 + 0.7 * dd[:, 0] ** 1.4, 0, 1)
    nrm = np.empty(nv * 3, dtype=np.float32); me.vertices.foreach_get('normal', nrm); nrm = nrm.reshape(-1, 3)
    cov = np.empty(nv * 3, dtype=np.float32); me.vertices.foreach_get('co', cov); cov = cov.reshape(-1, 3)
    patch = np.array([0.5 + 0.5 * noise.noise(Vector((float(c[0]) * 0.07, float(c[1]) * 0.07, float(c[2]) * 0.05))) for c in cov])
    gul = np.empty(nv, dtype=np.float32)
    for vi, c in enumerate(cov):
        rg, hs_, zb_ = spur(math.atan2(-float(c[1]), float(c[0])) * 200.0)
        gul[vi] = (1.0 - rg) ** 1.3 * (1.0 if c[2] < zb_ - 3.0 else 0.0) * (1.0 if c[2] > 1.5 else 0.0)
    veg = np.clip(np.maximum(smooth(0.5, 0.8, nrm[:, 2]), gul * smooth(-0.1, 0.35, nrm[:, 2] + 0.25)) * (0.4 + 0.9 * patch) * (cov[:, 2] < PLAT - 2), 0, 1)
    arr[:, 0] = ao; arr[:, 1] = veg; arr[:, 2] = ao; ca.data.foreach_set('color', arr.ravel())


def sel(*obs, active=None):
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs: o.select_set(True)
    bpy.context.view_layer.objects.active = active or obs[-1]

if __name__ == '__main__':
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import crag_detail
    t0 = time.time()
    sheet = build('headland_sheet', 0.5)
    print('[headland] sheet', len(sheet.data.vertices), round(time.time() - t0), 's', flush=True)
    so = sheet.modifiers.new('solid', 'SOLIDIFY'); so.thickness = 4.0; so.offset = -1.0
    with bpy.context.temp_override(object=sheet, active_object=sheet, selected_objects=[sheet], selected_editable_objects=[sheet]):
        bpy.ops.object.modifier_apply(modifier='solid')
    hd = sculpt(sheet, VOXEL) if '--bake' not in argv else crag_detail.detail(sheet, voxel=VOXEL, strength=0.45, flakes=((6.0, 0.9, 1.6, 0.4), (1.8, 0.16, 1.8, 0.7)), along_axis=False)      # fracture planes ~3 m tilted up to ~25° (a stronger small layer reads as pits, not chips)                 # even remesh, scanned-rock height, hairline cracks, faceted flaking
    bpy.data.objects.remove(sheet); drop_buried(hd, 1.5)
    print('[headland] detail', len(hd.data.vertices), 'verts', round(time.time() - t0), 's', flush=True)
    # the detail mesh's own crevices and edges, for a sharp cavity map (the game mesh is too coarse to carry them):
    # emission R = occlusion within the detail mesh alone (0 deep in a crack … 1 on open faces; 0.35 m and 1 m reach: thin crack lines, not broad shading), G unused
    cm = bpy.data.materials.new('hd_cavity'); cm.use_nodes = True; nt = cm.node_tree
    for n_ in list(nt.nodes): nt.nodes.remove(n_)
    oo = nt.nodes.new('ShaderNodeOutputMaterial'); em = nt.nodes.new('ShaderNodeEmission')
    ao = nt.nodes.new('ShaderNodeAmbientOcclusion'); ao.only_local = True; ao.samples = 16; ao.inputs['Distance'].default_value = 0.35
    ao2 = nt.nodes.new('ShaderNodeAmbientOcclusion'); ao2.only_local = True; ao2.samples = 16; ao2.inputs['Distance'].default_value = 1.0
    mu = nt.nodes.new('ShaderNodeMath'); mu.operation = 'MULTIPLY'
    cc = nt.nodes.new('ShaderNodeCombineColor')
    nt.links.new(ao.outputs['AO'], mu.inputs[0]); nt.links.new(ao2.outputs['AO'], mu.inputs[1])
    nt.links.new(mu.outputs['Value'], cc.inputs[0])
    nt.links.new(cc.outputs['Color'], em.inputs['Color']); nt.links.new(em.outputs['Emission'], oo.inputs['Surface'])
    hd.data.materials.clear(); hd.data.materials.append(cm)
    if '--bake' not in argv:
        # ---- the sculpt itself as the game mesh: decimated (flat fracture planes and hard edges survive collapse decimation),
        # split into angular segments by face (the seams share their vertices exactly), sharp edges kept, plus a far LOD each
        # split into the segments first (by face angle round the headland, via material slots: Blender's own separate), then
        # reduce each: far less memory than reducing the whole sculpt at once
        tris = sum(len(p.vertices) - 2 for p in hd.data.polygons); ratio = min(1.0, GEO_TRIS / tris)
        nf = len(hd.data.polygons); cen = np.empty(nf * 3); hd.data.polygons.foreach_get('center', cen); cen = cen.reshape(-1, 3)
        fang = np.arctan2(-cen[:, 1], cen[:, 0])
        edges = np.linspace(-math.radians(130), math.radians(130), SEGS + 1); edges[0] = -math.pi - 0.01; edges[-1] = math.pi + 0.01
        hd.data.materials.clear()
        for k in range(SEGS): hd.data.materials.append(bpy.data.materials.new(f'seg{k}'))
        hd.data.polygons.foreach_set('material_index', np.clip(np.searchsorted(edges, fang, side='right') - 1, 0, SEGS - 1).astype(np.int32))
        sel(hd); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.separate(type='MATERIAL'); bpy.ops.object.mode_set(mode='OBJECT')
        pieces = {}
        for o in [o for o in sc.objects if o.type == 'MESH' and (o == hd or o.name.startswith(hd.name))]:
            if len(o.data.polygons) == 0: continue
            pieces[int(o.material_slots[o.data.polygons[0].material_index].material.name[3:])] = o      # (separate renumbers the slots: go by the material's name)
        print('[headland] split', {k: len(o.data.polygons) for k, o in sorted(pieces.items())}, round(time.time() - t0), 's', flush=True)
        meta = {}; outs = []
        for k in range(SEGS):
            t1 = time.time()
            if k not in pieces: continue
            seg = pieces[k]; seg.name = f'hl_{k}'; seg.data.name = f'hl_{k}'
            # border vertices stay put (weight 0), so neighbouring segments still meet exactly
            bm_ = bmesh.new(); bm_.from_mesh(seg.data); bnd = [v.index for v in bm_.verts if v.is_boundary]; bm_.free()
            vg = seg.vertex_groups.new(name='inner'); vg.add(list(range(len(seg.data.vertices))), 1.0, 'REPLACE'); vg.add(bnd, 0.0, 'REPLACE')
            de = seg.modifiers.new('dec', 'DECIMATE'); de.ratio = ratio; de.use_collapse_triangulate = True; de.vertex_group = 'inner'; de.vertex_group_factor = 1000.0
            sel(seg); bpy.ops.object.modifier_apply(modifier='dec'); seg.vertex_groups.clear()
            seg.data.materials.clear()
            for p_ in seg.data.polygons: p_.use_smooth = True
            seg.data.set_sharp_from_angle(angle=math.radians(SHARP))
            paint(seg)
            md = seg.copy(); md.data = seg.data.copy(); md.name = f'hl_{k}_mid'; sc.collection.objects.link(md)
            dm_ = md.modifiers.new('dec', 'DECIMATE'); dm_.ratio = MID_RATIO; dm_.use_collapse_triangulate = True
            sel(md); bpy.ops.object.modifier_apply(modifier='dec'); md.data.set_sharp_from_angle(angle=math.radians(SHARP))
            lo = seg.copy(); lo.data = seg.data.copy(); lo.name = f'hl_{k}_lo'; sc.collection.objects.link(lo)
            dl = lo.modifiers.new('dec', 'DECIMATE'); dl.ratio = LO_RATIO; dl.use_collapse_triangulate = True
            sel(lo); bpy.ops.object.modifier_apply(modifier='dec'); lo.data.set_sharp_from_angle(angle=math.radians(SHARP))
            meta[seg.name] = {'tris': len(seg.data.polygons), 'mid': md.name, 'lo': lo.name, 'lo_tris': len(lo.data.polygons)}
            outs += [seg, md, lo]
            print(f'[headland] {seg.name}: {len(seg.data.polygons)} tris (far {len(lo.data.polygons)}), {round(time.time() - t1)} s', flush=True)
        sel(*outs)
        kw = dict(filepath=os.path.join(OUT, 'headland.glb'), export_format='GLB', use_selection=True, export_apply=True, export_normals=True, export_texcoords=False, export_materials='NONE')
        try: bpy.ops.export_scene.gltf(**kw, export_vertex_color='ACTIVE')
        except TypeError: bpy.ops.export_scene.gltf(**kw, export_colors=True)
        meta['_centre'] = [D['cx'], D['cz']]; meta['_mode'] = 'geo'
        json.dump(meta, open(os.path.join(OUT, 'headland.json'), 'w'), indent=1)
        print('[headland] done', round(time.time() - t0), 's'); raise SystemExit
    sc.render.engine = 'CYCLES'; sc.cycles.samples = 8
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences; prefs.compute_device_type = 'METAL'; prefs.get_devices()
        for d in prefs.devices: d.use = True
        sc.cycles.device = 'GPU'
    except Exception as e: print('cpu', e)
    sc.world = bpy.data.worlds.new('w')
    meta = {}; lows = []
    edges = np.linspace(-math.radians(126), math.radians(126), SEGS + 1)
    for k in range(SEGS):
        t1 = time.time()
        low = build(f'hl_{k}', 1.0, edges[k], edges[k + 1], margin=math.radians(0.6))
        if len(low.data.polygons) == 0: bpy.data.objects.remove(low); continue
        solid_remesh(low, 0.7, 3.0)
        tris = sum(len(p.vertices) - 2 for p in low.data.polygons)
        if tris > 40000:
            de = low.modifiers.new('dec', 'DECIMATE'); de.ratio = 40000 / tris; de.use_collapse_triangulate = True
            sel(low); bpy.ops.object.modifier_apply(modifier='dec')
        sel(low); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(86), island_margin=0.002, area_weight=0.0)
        bpy.ops.object.mode_set(mode='OBJECT')
        im = bpy.data.images.new(f'hl_{k}_n', RES, RES, alpha=False); im.colorspace_settings.name = 'Non-Color'
        m = bpy.data.materials.new(f'hl_{k}_bake'); m.use_nodes = True
        nd = m.node_tree.nodes.new('ShaderNodeTexImage'); nd.image = im; m.node_tree.nodes.active = nd
        low.data.materials.append(m)
        sel(hd, low, active=low)
        b = sc.render.bake; b.use_selected_to_active = True; b.cage_extrusion = 4.0; b.max_ray_distance = 8.0; b.margin = 8; b.normal_space = 'OBJECT'
        bpy.ops.object.bake(type='NORMAL')
        im.filepath_raw = os.path.join(OUT, f'hl_{k}_n.jpg'); im.file_format = 'JPEG'; im.save()
        ci_ = bpy.data.images.new(f'hl_{k}_c', RES, RES, alpha=False); ci_.colorspace_settings.name = 'Non-Color'
        nd.image = ci_; m.node_tree.nodes.active = nd
        sel(hd, low, active=low); bpy.ops.object.bake(type='EMIT')
        ci_.filepath_raw = os.path.join(OUT, f'hl_{k}_c.jpg'); ci_.file_format = 'JPEG'; ci_.save()
        paint(low)
        me = low.data
        me.materials.clear()
        meta[low.name] = {'tris': sum(len(p.vertices) - 2 for p in me.polygons), 'map': f'hl_{k}_n.jpg', 'cav': f'hl_{k}_c.jpg'}
        lows.append(low)
        print(f'[headland] hl_{k}: {meta[low.name]["tris"]} tris, {round(time.time() - t1)} s', flush=True)
    sel(*lows)
    kw = dict(filepath=os.path.join(OUT, 'headland.glb'), export_format='GLB', use_selection=True, export_apply=True, export_normals=True, export_texcoords=True, export_materials='NONE')
    try: bpy.ops.export_scene.gltf(**kw, export_vertex_color='ACTIVE')
    except TypeError: bpy.ops.export_scene.gltf(**kw, export_colors=True)
    meta['_centre'] = [D['cx'], D['cz']]
    json.dump(meta, open(os.path.join(OUT, 'headland.json'), 'w'), indent=1)
    print('[headland] done', round(time.time() - t0), 's')
