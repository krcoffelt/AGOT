# The shape of a limestone sea cliff, shared by cliff_kit.py (headless export for the game) and live previews in Blender.
# After the user's reference: pale Adriatic limestone that breaks into separate prow-shaped buttresses and pinnacles, each
# topping out at its own height, with deep gullies between them that fill with scrub. Surfaces are sharp, angular facets
# (one tilted plane per joint block, taller than wide) scored by vertical fluting where rain has run down them.
#   depth(x, z, seed) → metres the face stands proud (+) at (x along the face, z up)
#   gully(x, z, seed) → 0 on a buttress crest … 1 in a gully floor (used for the vegetation mask)
#   build(name, seed, W, H, step) → mesh;  vegetation(ob, seed) → per-vertex scrub mask
import math
from mathutils import Vector, noise

SPUR = 19.0          # metres between buttresses (jittered per buttress)

def _h(a, b, s):
    return (math.sin(a * 12.9898 + b * 78.233 + s * 37.719) * 43758.5453) % 1.0

def _spur(x, z, seed):
    # position across the buttress pattern: the gullies wander a little as they climb
    u = x / SPUR + seed * 0.37 + noise.noise(Vector((z * 0.025, seed * 1.3, 2.0))) * 0.3
    i = math.floor(u); f = u - i
    c = 0.5 + (_h(i, 1.0, seed) - 0.5) * 0.35                    # each crest off-centre in its bay
    tri = 1.0 - min(1.0, abs(f - c) / max(c, 1.0 - c))           # 1 on the crest, 0 in the gully
    return i, tri

def gully(x, z, seed):
    return 1.0 - _spur(x, z, seed)[1]

def _facets(x, z, seed, sx, sz, off, tx_amp, tz_amp, crack, crack_w, lean_bias):
    ox, oz = seed * 7.31, seed * 3.17
    dist, pts = noise.voronoi(Vector((x / sx + ox, z / sz + oz, seed * 0.53)), distance_metric='DISTANCE')
    c = pts[0]
    lx, lz = x - (c.x - ox) * sx, z - (c.y - oz) * sz
    d = (_h(c.x, c.y, 1.0) - 0.5) * 2.0 * off
    d += (_h(c.x, c.y, 2.0) - 0.5) * 2.0 * tx_amp * lx
    d += (_h(c.x, c.y, 3.0) - lean_bias) * 2.0 * tz_amp * lz
    edge = dist[1] - dist[0]
    d -= crack * (1.0 - min(1.0, edge / crack_w)) ** 2
    return d

def depth(x, z, seed, W=52.0, H=42.0):
    i, tri = _spur(x, z, seed)
    # buttresses: a prow (sharp crest, steep flanks) standing out from the gullies
    d = 10.0 * tri ** 0.75 - 6.0
    d -= 4.0 * (1.0 - tri) ** 3                                   # the gully floor cuts back further
    # each buttress tops out at its own height and steps back above it, so the skyline is a row of crags
    top = H * (0.6 + 0.42 * _h(i, 2.0, seed)) * (0.85 + 0.15 * tri)
    d -= max(0.0, z - top) ** 1.6 * 0.5
    # angular joint blocks (tall), and the smaller facets they break into
    d += _facets(x, z, seed, 7.0, 16.0, 1.6, 0.55, 0.3, 0.9, 0.05, 0.6)
    d += _facets(x, z, seed + 11, 2.6, 5.5, 0.35, 0.3, 0.16, 0.25, 0.07, 0.55)
    # vertical fluting (karren): grooves a metre or two apart, running down the faces
    fl = math.sin(x * 2.3 + noise.noise(Vector((x * 0.25, z * 0.04, seed + 6.0))) * 4.0)
    d -= 0.45 * abs(fl) ** 0.6 * (0.5 + 0.5 * tri)
    d += noise.noise(Vector((x * 0.2, z * 0.12, seed + 4.0))) * 0.3
    # the whole face leans back as it climbs, more in the gullies (which become steep scrubby slopes)
    d -= z * (0.12 + 0.35 * (1.0 - tri) ** 2)
    d += noise.noise(Vector((x * 0.02, seed * 5.1, 0.5))) * 2.5
    d -= max(0.0, (z - (H - 3.0)) / 3.0) ** 2 * 6.0                # rolls over at the brink
    e = max(0.0, (abs(x) - (W / 2 - 9.0)) / 9.0)
    d -= e * e * 12.0                                             # ends turn back into the hill
    return max(d, -28.0)                                          # (what steps back further is buried in the hill anyway)

def build(bpy, bmesh, name, seed, W=52.0, H=42.0, step=0.25, ratio=0.18, collection=None):
    nx, nz = int(W / step), int((H + 7.0) / step)
    bm = bmesh.new(); grid = []
    for j in range(nz + 1):
        z = -5.0 + (H + 7.0) * j / nz; row = []
        for i in range(nx + 1):
            x = -W / 2 + W * i / nx
            row.append(bm.verts.new((x, -depth(x, z, seed, W, H), z)))
        grid.append(row)
    for j in range(nz):
        for i in range(nx):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); (collection or bpy.context.scene.collection).objects.link(ob)
    for p in me.polygons: p.use_smooth = True
    if ratio < 1.0:
        de = ob.modifiers.new('dec', 'DECIMATE'); de.ratio = ratio; de.use_collapse_triangulate = True
        with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob]):
            bpy.ops.object.modifier_apply(modifier='dec')
    with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob], selected_editable_objects=[ob]):
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(30))
    return ob

def vegetation(ob, seed):
    """0..1 per vertex: scrub on ledges and up-facing slopes, thick in the gullies and along the foot of the cliff."""
    out = []
    for v in ob.data.vertices:
        x, z = v.co.x, v.co.z; nz = v.normal.z
        g = gully(x, z, seed)
        up = min(1.0, max(0.0, (nz - 0.18) / 0.3))
        patch = 0.5 + 0.5 * noise.noise(Vector((x * 0.12, z * 0.12, seed + 9.0)))
        foot = max(0.0, 1.0 - z / 12.0) * 0.75
        veg = max(up, min(1.0, g ** 1.5 * 1.25) * (0.35 + 0.65 * min(1.0, max(0.0, nz + 0.6))), foot) * (0.6 + 0.7 * patch)
        veg *= 1.0 - max(0.0, -nz)                                # never on an overhang
        out.append(min(1.0, max(0.0, veg)))
    return out
