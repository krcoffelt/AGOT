# Limestone crags: real 3D rock masses for the coast under the Red Keep, after the user's reference (separate crags and
# pinnacles standing out from the hillside at different depths, sharp planar facets, vertical fluting).
#   Blender -b --factory-startup --python tools/blender/crag_kit.py -- <project dir> [--preview <dir>]
# A crag is a cluster of jointed rock columns. Each column is the convex hull of a few points, so it has a handful of big
# flat faces; the columns are tallest at the back (against the hill, +Y) and step down toward the prow (-Y, the sea), with
# lower side columns and a loose pinnacle or two in front. They are fused by a voxel remesh, scored with vertical
# grooves (a vertically stretched noise displacement), and decimated to a game budget. Vertex colours: R ambient
# occlusion, G a scrub mask (up-facing ledges and the foot), B occlusion again. Base at z = 0, front toward Blender -Y
# (glTF +Z, the game's "front"). Writes public/models/crags.glb and crags.json.
import bpy, bmesh, sys, os, math, random, json
import numpy as np
from mathutils import Vector, Matrix, noise

# importable too (live previews in the user's Blender over the MCP add-on): the build runs only as a script
scene = bpy.context.scene
# spall cuts per block piece: (big count range, small count range, small depth range); the high-detail source uses many more
SPALL = ((3, 6), (8, 14), (0.12, 0.85))
CAVES = [0]

def _hull(bm, pts):
    bmesh.ops.convex_hull(bm, input=[bm.verts.new(p) for p in pts])

def block(bm, rnd, cx, cy, z0, z1, w, d, rot, chamfer=0.35, lean=0.0):
    """one jointed block: a rough prism whose top footprint is shifted, turned and resized against its foot, so no face is
    quite vertical or square; corners jittered, one or two knocked off, top tilted"""
    c, s = math.cos(rot), math.sin(rot); pts = []
    h = z1 - z0
    sx, sy = rnd.uniform(-lean, lean) * h, rnd.uniform(-lean, lean * 0.5) * h + 0.04 * h       # shear, mostly leaning back
    tw = rnd.uniform(0.82, 1.08); tr = rnd.uniform(-0.08, 0.08)
    tilt = (rnd.uniform(-0.1, 0.1), rnd.uniform(-0.12, 0.05))
    J = min(w, d) * 0.12
    for (u, v) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        for top in (False, True):
            ww, rr = (w * tw, rot + tr) if top else (w, rot)
            cc, ss = math.cos(rr), math.sin(rr)
            lx = u * ww / 2 + rnd.uniform(-J, J); ly = v * (d * (tw if top else 1.0)) / 2 + rnd.uniform(-J, J)
            ox, oy = (sx, sy) if top else (0.0, 0.0)
            z = (z1 + lx * tilt[0] + ly * tilt[1]) if top else z0
            if rnd.random() < chamfer:
                k = rnd.uniform(0.15, 0.4)
                for (ax, ay, dz) in ((lx * (1 - k), ly, 0.0), (lx, ly * (1 - k), 0.0), (lx * (1 - k * 0.5), ly * (1 - k * 0.5), -rnd.uniform(0.3, 1.5) if top else rnd.uniform(0.3, 1.5))):
                    pts.append((cx + ox + ax * cc - ay * ss, cy + oy + ax * ss + ay * cc, z + dz))
            else:
                pts.append((cx + ox + lx * cc - ly * ss, cy + oy + lx * ss + ly * cc, z))
    _hull(bm, pts)

def column(bm, rnd, cx, cy, w, d, h, rot, chips=True):
    """a jointed column: stacked blocks, each shifted, leaned and turned against the one below; thin slabs flaking off its face"""
    z = -10.0
    while z < h - 0.5:
        sh = min(h - z, rnd.uniform(6.0, 15.0)) if z > 0 else min(h - z, 10.0 + rnd.uniform(4.0, 12.0))
        bw = w * rnd.uniform(0.84, 1.06); bd = d * rnd.uniform(0.84, 1.06)
        ox, oy = rnd.uniform(-0.5, 0.5), rnd.uniform(-0.6, 0.4)
        r = rot + rnd.uniform(-0.06, 0.06)
        block(bm, rnd, cx + ox, cy + oy, z, z + sh + 0.2, bw, bd, r, chamfer=0.45, lean=0.06)
        if chips and z > -4 and rnd.random() < 0.0:      # (flakes now come from the fissure displacement)
            for i in range(rnd.randint(0, 2)):        # a slab flaking off the face: wide, thin, barely proud
                cw = rnd.uniform(2.0, bw * 0.75); ch = rnd.uniform(2.5, min(9.0, sh))
                fx = rnd.uniform(-bw / 2 + cw / 2, bw / 2 - cw / 2); zc = rnd.uniform(z, z + sh - ch)
                c, s_ = math.cos(r), math.sin(r); ly = -bd / 2 + rnd.uniform(0.0, 0.45)
                block(bm, rnd, cx + ox + fx * c - ly * s_, cy + oy + fx * s_ + ly * c, zc, zc + ch, cw, rnd.uniform(0.9, 1.6), r + rnd.uniform(-0.2, 0.2), chamfer=0.6, lean=0.08)
        z += sh

def crag(name, seed, H, W=42.0, depth_back=24.0):
    """a crag quarried out of a block of fractured rock: everything in front of the cliff profile is taken away, so the face
    that is left is made of real fracture planes, stepping in and out block by block"""
    rnd = random.Random(seed * 977 + 3)
    # the cliff profile: buttresses with gullies between, an uneven skyline, leaning back as it climbs
    bays = []
    x = -W / 2 - 6
    while x < W / 2 + 6:
        w = rnd.uniform(11.0, 20.0); bays.append((x, x + w, rnd.uniform(0.55, 1.02) * H, rnd.uniform(-2.0, 2.0))); x += w
    def bay(x):
        for b in bays:
            if b[0] <= x < b[1]: return b
        return bays[-1]
    def face_y(x, z):
        b = bay(x); f = (x - b[0]) / (b[1] - b[0])
        f = min(1.0, max(0.0, f)); tri = 1.0 - abs(f - 0.5) * 2.0          # 1 on the buttress crest, 0 in the gully
        y = -(14.0 * tri ** 0.8 - 5.0) + b[3] + z * 0.14 + 5.0 * (1.0 - tri) ** 2 * z / H
        return y + noise.noise(Vector((x * 0.05, z * 0.05, seed))) * 1.8
    def top_z(x):
        b = bay(x); f = min(1.0, max(0.0, (x - b[0]) / (b[1] - b[0])))
        return b[2] * (0.88 + 0.12 * (1.0 - abs(f - 0.5) * 2.0))
    def keep(i, p):
        z = p.z / KZ; fy = face_y(p.x, z)
        return p.y > fy and z < top_z(p.x) and abs(p.x) < W / 2 + 3 and (p.y < fy + 14 or z > top_z(p.x) - 14)
    # jointed rock, built as it breaks: vertical joints split it into columns 3–9 m wide; each column is cut by horizontal
    # breaks at its own heights into blocks 5–22 m tall; each block's front face sits on the cliff profile, its corners
    # jittered so the face leans and twists a little; now and then a thin slab stands off the face with a crack behind it
    bm = bmesh.new()
    def _cut(b, co, n, keep_inner=True):
        res = bmesh.ops.bisect_plane(b, geom=b.verts[:] + b.edges[:] + b.faces[:], plane_co=co, plane_no=n, clear_outer=keep_inner, clear_inner=not keep_inner)
        cut = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
        if cut: bmesh.ops.holes_fill(b, edges=cut, sides=0)
    def _centre(b): return sum((v.co for v in b.verts), Vector()) / max(1, len(b.verts))
    def _spall(b, n_cuts, d0, d1):
        """knock chips off a piece's exposed (front) edges and corners: each planar cut leaves a new flat facet"""
        if len(b.verts) < 4: return
        cen = _centre(b); ymin = min(v.co.y for v in b.verts)
        front = [v.co.copy() for v in b.verts if v.co.y < ymin + 1.2] or [v.co.copy() for v in b.verts]
        for k in range(n_cuts):
            if len(b.verts) < 4: return
            p = rnd.choice(front)
            if rnd.random() < 0.5: p = p.lerp(rnd.choice(front), rnd.random())
            out = (p - cen); out.y *= 0.7
            if out.length < 1e-3: continue
            n = (out.normalized() + Vector((rnd.uniform(-0.5, 0.5), rnd.uniform(-0.7, 0.1), rnd.uniform(-0.45, 0.45)))).normalized()
            _cut(b, p - n * rnd.uniform(d0, d1), n)
    def _split(b, w, h):
        """a secondary crack partway through a big block, at a slight angle, opened by a few centimetres"""
        pieces = [b]
        for k in range(rnd.randint(3, 6) if max(w, h) > 9 else rnd.randint(1, 3) if max(w, h) > 5 else (1 if rnd.random() < 0.5 else 0)):      # big blocks split into sheets
            src = max(pieces, key=lambda q: len(q.verts))
            c = _centre(src)
            if rnd.random() < 0.75: n = Vector((rnd.uniform(0.85, 1.0), rnd.uniform(-0.35, 0.35), rnd.uniform(-0.2, 0.2)))     # a vertical crack (most)
            else: n = Vector((rnd.uniform(-0.3, 0.3), rnd.uniform(-0.15, 0.15), 1.0))                                            # a horizontal break
            n.normalize(); co = c + Vector((rnd.uniform(-0.25, 0.25) * w, rnd.uniform(-1.0, 1.0), rnd.uniform(-0.3, 0.3) * h))
            a_, b_ = src.copy(), src.copy()
            _cut(a_, co, n, True); _cut(b_, co, n, False)
            gap = rnd.uniform(0.04, 0.16); step = rnd.uniform(-0.9, 0.9)      # the sheets step in and out of the face
            for v in a_.verts: v.co -= n * gap
            for v in b_.verts: v.co += n * gap; v.co.y += step
            pieces.remove(src); src.free()
            pieces += [q for q in (a_, b_) if len(q.verts) >= 4]
        return pieces
    def hexa(c, chips=True):       # c: 8 corners, bottom 4 then top 4, counter-clockwise from front-left
        b = bmesh.new()
        vs = [b.verts.new(p) for p in c]
        for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
            try: b.faces.new([vs[i] for i in f])
            except ValueError: pass
        bmesh.ops.recalc_face_normals(b, faces=b.faces[:])
        pieces = [b]
        if chips:
            _spall(b, rnd.randint(*SPALL[0]), 0.4, 2.2)                     # the big spalls
            w = abs(c[1][0] - c[0][0]); h = abs(c[4][2] - c[0][2])
            pieces = _split(b, w, h) if c[4][2] > -4 else [b]
            for q in pieces: _spall(q, rnd.randint(*SPALL[1]), *SPALL[2])    # and the small ones: facets, steps, tiny ledges
        for q in pieces:
            tmp = bpy.data.meshes.new('blk'); q.to_mesh(tmp); q.free(); bm.from_mesh(tmp); bpy.data.meshes.remove(tmp)
    back = depth_back + 6.0
    J = lambda a: rnd.uniform(-a, a)
    x = -W / 2 - 3.0
    while x < W / 2 + 3.0:
        cleft = rnd.random() < 0.22                                      # a narrow column set deep back: a vertical cleft
        w = rnd.uniform(1.8, 3.6) if cleft else rnd.uniform(5.0, 14.0); x0, x1 = x, x + w      # massive columns, as in the references
        top = top_z(x + w / 2) + rnd.uniform(-4.0, 3.0) - (rnd.uniform(3, 10) if cleft else 0)
        colback = rnd.uniform(6.0, 13.0) if cleft else rnd.uniform(-2.5, 2.5)
        z = -10.0
        # the joints are not level: each break tilts a little, and the tilt carries to the next block's foot
        tilt_prev = 0.0; cave_below = False
        while z < top - 1.0:
            h = min(top - z, rnd.uniform(9.0, 32.0)); z0, z1 = z, z + h
            tilt = rnd.uniform(-0.12, 0.12) * w
            g = rnd.uniform(0.08, 0.3)
            xa, xb, za, zb = x0 + g, x1 - g, z0 + g, z1 - g
            fyc = face_y((xa + xb) / 2, (za + zb) / 2) + rnd.uniform(-1.8, 1.8) + colback
            cave = z0 < 0 and not cleft and rnd.random() < 0.3
            if cave:                                                     # a sea cave: the base block set far back, its mouth 4–12 m above the water
                CAVES[0] += 1
                h = min(top - z0 - 6.0, rnd.uniform(14.0, 22.0)); z1 = z0 + h; zb = z1 - g
                fyc += rnd.uniform(8.0, 14.0)
            shape = rnd.random()
            # the face: leaning back (most), overhanging a little (some), or a wedge whose top slopes back (some)
            lean = rnd.uniform(0.04, 0.22) * h if shape < 0.6 else (-rnd.uniform(0.03, 0.1) * h if shape < 0.8 else rnd.uniform(0.3, 0.6) * h)
            if z1 >= top - 1.5 and not cleft and rnd.random() < 0.4:    # the top of the column juts out over the face
                lean = -rnd.uniform(0.15, 0.3) * h; fyc -= rnd.uniform(0.5, 2.0); shape = 0.7
            if z0 > -10 and cave_below:                                   # the block over a cave: its foot stands proud, a lintel
                lean = rnd.uniform(0.05, 0.15) * h; fyc -= rnd.uniform(0.5, 2.0)
            cave_below = cave
            twist = rnd.uniform(-0.9, 0.9)
            yf00, yf10 = fyc - twist - lean / 2, fyc + twist - lean / 2
            yf01, yf11 = fyc - twist + lean / 2, fyc + twist + lean / 2
            wedge = shape >= 0.8 and z1 >= top - 1.5                     # the top of a column sloping back: a ramp, not a flat cap
            zt0, zt1 = (zb + tilt_prev / 2, zb - tilt_prev / 2) if False else (zb + tilt / 2, zb - tilt / 2)
            zf0, zf1 = za + tilt_prev / 2, za - tilt_prev / 2
            hexa([(xa + J(0.3), yf00, zf0 + J(0.3)), (xb + J(0.3), yf10, zf1 + J(0.3)), (xb, back, za), (xa, back, za),
                  (xa + J(0.4), yf01, zt0 - (h * 0.25 if wedge else 0) + J(0.4)), (xb + J(0.4), yf11, zt1 - (h * 0.25 if wedge else 0) + J(0.4)),
                  (xb, back, zb + (h * 0.15 if wedge else 0)), (xa, back, zb + (h * 0.15 if wedge else 0))])
            tilt_prev = tilt
            if z1 > 0 and not cleft and rnd.random() < 0.24:             # a slab standing off the face, often leaning out or sideways
                t = rnd.uniform(0.9, 2.6); sw0, sw1 = xa + rnd.uniform(0, w * 0.25), xb - rnd.uniform(0, w * 0.25)
                s0, s1 = max(za, -2.0) + rnd.uniform(0, h * 0.2), zb + rnd.uniform(-h * 0.2, h * 0.15)
                gap = rnd.uniform(0.3, 0.9); lo = rnd.uniform(-0.5, 2.5); side = rnd.uniform(-1.8, 1.8)
                yb0 = min(yf00, yf10) - gap; yb1 = min(yf01, yf11) - gap - lo
                hexa([(sw0, yb0 - t, s0), (sw1, yb0 - t + J(0.4), s0), (sw1, yb0, s0), (sw0, yb0, s0),
                      (sw0 + side + J(0.3), yb1 - t + J(0.5), s1), (sw1 + side + J(0.3), yb1 - t + J(0.5), s1), (sw1 + side, yb1, s1), (sw0 + side, yb1, s1)])
            z = z1
        x = x1
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); scene.collection.objects.link(ob)
    # a talus of tumbled blocks along the foot
    tal = bmesh.new()
    for i in range(rnd.randint(18, 28)):
        bx = rnd.uniform(-W / 2, W / 2); by = face_y(bx, 0.0) - rnd.uniform(1.0, 8.0); sz = rnd.uniform(1.2, 4.0)
        pts = []
        for k in range(14):
            a_ = rnd.uniform(0, math.tau); e_ = rnd.uniform(-0.3, 1.2); r_ = sz * rnd.uniform(0.6, 1.0)
            pts.append((bx + math.cos(a_) * math.cos(e_) * r_ * 1.2, by + math.sin(a_) * math.cos(e_) * r_, -1.5 + (math.sin(e_) + 0.3) * r_ * 0.8))
        _hull(tal, pts)
    bm2 = bmesh.new(); bm2.from_mesh(ob.data)
    tmp = bpy.data.meshes.new('tal'); tal.to_mesh(tmp); tal.free(); bm2.from_mesh(tmp); bpy.data.meshes.remove(tmp)
    bm2.to_mesh(ob.data); bm2.free()
    return ob

KZ = 1.0             # (no squash: the seed lattice below already makes the blocks tall)

def _cells(src_bm, seeds, rnd, gap, out_bm, keep=None):
    """Voronoi-fracture src_bm by seeds (in squashed space); each cell is cut out by bisecting at the planes halfway to its
    neighbours and capping the cuts, then shrunk about its centre to open a crack, and added to out_bm"""
    from mathutils.kdtree import KDTree
    kd = KDTree(len(seeds))
    for i, p in enumerate(seeds): kd.insert(p, i)
    kd.balance()
    for i, p in enumerate(seeds):
        if keep is not None and not keep(i, p): continue
        cell = src_bm.copy()
        nbrs = kd.find_n(p, 22)
        for (q, j, dist) in nbrs:
            if j == i: continue
            n = (q - p).normalized(); mid = (p + q) * 0.5
            geom = cell.verts[:] + cell.edges[:] + cell.faces[:]
            res = bmesh.ops.bisect_plane(cell, geom=geom, plane_co=mid, plane_no=n, clear_outer=True)
            cut = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
            if cut: bmesh.ops.holes_fill(cell, edges=cut, sides=0)
            if not cell.verts: break
        if len(cell.verts) < 4: cell.free(); continue
        c = sum((v.co for v in cell.verts), Vector()) / len(cell.verts)
        ext = max((v.co - c).length for v in cell.verts)
        k = max(0.5, 1.0 - gap * rnd.uniform(0.3, 2.0) / max(ext, 0.5))
        for v in cell.verts: v.co = c + (v.co - c) * k
        tmp = bpy.data.meshes.new('tmp'); cell.to_mesh(tmp); cell.free()
        out_bm.from_mesh(tmp); bpy.data.meshes.remove(tmp)

def fracture(name, mass_bm, rnd, W, H, depth_back, keep, face_y):
    src = mass_bm.copy()
    for v in src.verts: v.co.z *= KZ
    # seeds on a jittered lattice: columns 4.5–8 m wide, rows 5 m deep, and bedding layers 6–15 m thick that run across the
    # whole crag (each layer's height wanders a little) — so the rock breaks into irregular bricks: vertical joints, with
    # horizontal breaks that line up between neighbouring blocks
    seeds = []
    zs = []; z = -10.0
    while z < H * 1.1 + 6: t = rnd.uniform(6.0, 15.0); zs.append(z + t / 2); z += t
    xs = []; x = -W / 2 - 8.0
    while x < W / 2 + 8: w = rnd.uniform(4.5, 8.0); xs.append((x + w / 2, w)); x += w
    for ci, (xc, w) in enumerate(xs):
        cz = rnd.uniform(-3.0, 3.0)                                     # each column's breaks sit a little higher or lower
        y = -18.0
        while y < depth_back + 6:
            sy = 5.0 if y < 14 else 9.0
            skip = False
            for li, zc in enumerate(zs):
                # merge with the block below now and then: tall slabs spanning two or three layers
                if li > 0 and not skip and rnd.random() < 0.5 and y < 14: skip = True; continue
                skip = False
                p = Vector((xc + rnd.uniform(-0.18, 0.18) * w, y + rnd.uniform(-0.2, 0.2) * sy, zc + cz + rnd.uniform(-1.0, 1.0)))
                seeds.append(Vector((p.x, p.y, p.z * KZ)))
                # a face block split into smaller pieces now and then
                if False:      # (splitting face blocks made rubble)
                    for k in range(rnd.randint(1, 3)):
                        seeds.append(Vector((p.x + rnd.uniform(-w, w) * 0.4, p.y + rnd.uniform(-2.5, 1.0), (p.z + rnd.uniform(-4.0, 4.0)) * KZ)))
            y += sy
    out = bmesh.new()
    _cells(src, seeds, rnd, 0.16, out, keep=keep)
    src.free()
    for v in out.verts: v.co.z /= KZ
    # split into separate blocks, then give each a nudge: some set back, some proud, a few gone (clefts and recesses)
    me = bpy.data.meshes.new(name); out.to_mesh(me); out.free()
    ob = bpy.data.objects.new(name, me); scene.collection.objects.link(ob)
    bm = bmesh.new(); bm.from_mesh(me)
    islands = []; seen = set()
    for v0 in bm.verts:
        if v0.index in seen: continue
        stack = [v0]; isl = []
        seen.add(v0.index)
        while stack:
            v = stack.pop(); isl.append(v)
            for e in v.link_edges:
                w = e.other_vert(v)
                if w.index not in seen: seen.add(w.index); stack.append(w)
        islands.append(isl)
    kill = []
    for isl in islands:
        c = sum((v.co for v in isl), Vector()) / len(isl)
        front = c.y < face_y(c.x, c.z) + 5.0 and c.z > 2.0
        r = rnd.random()
        if front and r < 0.04: kill += isl; continue                      # a block fallen out: a recess
        dy = rnd.uniform(-0.6, 0.9) if front else rnd.uniform(-0.2, 0.3)   # mostly set back a little, some proud
        rot = Matrix.Rotation(rnd.uniform(-0.03, 0.03), 4, 'Z') @ Matrix.Rotation(rnd.uniform(-0.025, 0.025), 4, 'X')
        for v in isl: v.co = c + (rot @ (v.co - c)) + Vector((rnd.uniform(-0.05, 0.05), dy, 0.0))
    if kill: bmesh.ops.delete(bm, geom=list(set(kill)), context='VERTS')
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if all(v.co.z < -6.0 for v in f.verts)], context='FACES')
    bm.to_mesh(me); bm.free()
    print('[crag_kit]', name, 'blocks', len(islands), 'removed', len(set(kill)) and 'some')
    return ob

def finish(ob, ratio):
    ctx = dict(object=ob, active_object=ob, selected_objects=[ob], selected_editable_objects=[ob])
    de = ob.modifiers.new('dec', 'DECIMATE'); de.ratio = ratio; de.use_collapse_triangulate = True
    with bpy.context.temp_override(**ctx):
        bpy.ops.object.modifier_apply(modifier='dec')
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(20))

SPECS = [(1, 46.0), (2, 38.0), (3, 52.0), (4, 30.0), (5, 42.0), (6, 26.0)]

def main():
    global scene
    argv = sys.argv[sys.argv.index('--') + 1:]
    proj = argv[0]
    preview = argv[argv.index('--preview') + 1] if '--preview' in argv else None
    OUT = os.path.join(proj, 'public', 'models'); os.makedirs(OUT, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    crags = []
    for i, (seed, H) in enumerate(SPECS):
        hi = crag(f'crag_{i}', seed, H)
        lo = hi.copy(); lo.data = hi.data.copy(); lo.name = f'crag_{i}_lo'; scene.collection.objects.link(lo)
        tris = sum(len(p.vertices) - 2 for p in hi.data.polygons)
        finish(hi, min(1.0, 16000 / max(1, tris))); finish(lo, min(1.0, 2200 / max(1, tris)))
        crags += [hi, lo]

    # ---- ambient occlusion into the vertex colours, then the scrub mask in G
    scene.render.engine = 'CYCLES'; scene.cycles.samples = 48; scene.cycles.device = 'CPU'
    scene.world = bpy.data.worlds.new('w')
    for k, ob in enumerate(crags):
        ob.location.x = k * 160.0
        ca = ob.data.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT'); ob.data.color_attributes.active_color = ca
    mat = bpy.data.materials.new('rock')
    for ob in crags: ob.data.materials.append(mat); ob.select_set(True)
    bpy.context.view_layer.objects.active = crags[0]
    scene.render.bake.target = 'VERTEX_COLORS'
    bpy.ops.object.bake(type='AO')
    meta = {}
    for ob in crags:
        ob.location.x = 0.0
        me = ob.data; ca = me.color_attributes['Col']; n = len(ca.data)
        a = np.empty(n * 4, dtype=np.float32); ca.data.foreach_get('color', a); a = a.reshape(n, 4)
        ao = 0.4 + 0.6 * np.clip(a[:, 0] * 1.15, 0, 1)
        seed = int(ob.name.split('_')[1]) + 1
        veg = np.empty(n, dtype=np.float32)
        for v in me.vertices:
            nz = v.normal.z; z = v.co.z
            up = min(1.0, max(0.0, (nz - 0.2) / 0.3))
            foot = max(0.0, 1.0 - z / 8.0) * 0.7
            patch = 0.5 + 0.5 * noise.noise(Vector((v.co.x * 0.11, v.co.y * 0.11, z * 0.11 + seed)))
            veg[v.index] = min(1.0, max(up, foot) * (0.6 + 0.7 * patch) * (1.0 - max(0.0, -nz)))
        a[:, 0] = ao; a[:, 1] = veg; a[:, 2] = ao; a[:, 3] = 1; ca.data.foreach_set('color', a.ravel())
        bb = [Vector(c) for c in ob.bound_box]
        meta[ob.name] = {'h': max(v.z for v in bb), 'minX': min(v.x for v in bb), 'maxX': max(v.x for v in bb), 'minY': min(v.y for v in bb), 'maxY': max(v.y for v in bb),
                         'tris': sum(len(p.vertices) - 2 for p in me.polygons)}

    if preview:
        # the crags lit low from the side, as in the reference; the light copies hidden
        os.makedirs(preview, exist_ok=True)
        nt_m = mat; nt_m.use_nodes = True; nt = nt_m.node_tree; bs = nt.nodes.get('Principled BSDF')
        vc = nt.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Col'
        sep = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(vc.outputs['Color'], sep.inputs[0])
        mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.inputs[6].default_value = (0.62, 0.6, 0.56, 1); mix.inputs[7].default_value = (0.06, 0.08, 0.03, 1)
        nt.links.new(sep.outputs[1], mix.inputs['Factor'])
        mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'
        mixao = nt.nodes.new('ShaderNodeMix'); mixao.data_type = 'RGBA'; mixao.blend_type = 'MULTIPLY'; mixao.inputs['Factor'].default_value = 1.0
        nt.links.new(mix.outputs[2], mixao.inputs[6]); nt.links.new(sep.outputs[0], mixao.inputs[7]); nt.links.new(mixao.outputs[2], bs.inputs['Base Color'])
        for k, ob in enumerate([o for o in crags if not o.name.endswith('_lo')]):
            ob.location = ((k % 3) * 52 - 52, (k // 3) * 70, 0)
        for o in crags:
            if o.name.endswith('_lo'): o.hide_render = True
        cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scene.collection.objects.link(cam); scene.camera = cam
        cam.location = (60, -120, 10); cam.rotation_euler = (math.radians(88), 0, math.radians(22)); cam.data.lens = 34
        sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); scene.collection.objects.link(sun); sun.data.energy = 4.5
        sun.rotation_euler = (math.radians(65), 0, math.radians(-70))
        scene.world.use_nodes = True; scene.world.node_tree.nodes['Background'].inputs[0].default_value = (0.5, 0.62, 0.8, 1)
        scene.cycles.samples = 24; scene.render.resolution_x, scene.render.resolution_y = 1400, 700
        scene.render.filepath = os.path.join(preview, 'crag_preview.png'); bpy.ops.render.render(write_still=True)
        for k, o in enumerate(crags): o.location = (0, 0, 0); o.hide_render = False

    for ob in crags: ob.data.materials.clear()
    bpy.ops.object.select_all(action='DESELECT')
    for ob in crags: ob.select_set(True)
    kw = dict(filepath=os.path.join(OUT, 'crags.glb'), export_format='GLB', use_selection=True, export_apply=True, export_normals=True, export_texcoords=False, export_materials='NONE')
    try: bpy.ops.export_scene.gltf(**kw, export_vertex_color='ACTIVE')
    except TypeError: bpy.ops.export_scene.gltf(**kw, export_colors=True)
    json.dump(meta, open(os.path.join(OUT, 'crags.json'), 'w'), indent=1)
    print('[crag_kit]', json.dumps({k: (round(v['h']), v['tris']) for k, v in meta.items()}))


if __name__ == '__main__':
    main()
