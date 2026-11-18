# Street-life prop kit: market stalls, carts, barrels, a well, banners, pavilions, boats, ships, a harbour crane, townsfolk
# and horses. Each slot in SLOTS is filled from a model dropped into assets-src/props when one matches by file name (a
# Sketchfab glTF download, left as the zip it came in), or from a plain stand-in built here when none does. Every prop is
# scaled to real size, cut down to a triangle budget and baked into one shared atlas, so the game draws the whole kit with
# one material and one texture.
#   Blender -b --factory-startup --python tools/blender/props_kit.py -- <project dir> [--list] [--src <dir>] [--out <dir>] [--slots <regex>]
# --list imports each download and prints its separate pieces with their sizes, without baking anything.
# --slots bakes only the slots whose name matches, for a quick look at a few of them (pair it with --out <scratch dir>).
# Townsfolk: a rigged character download (a Mixamo skeleton, as Adobe Fuse models have) is animated here: the loops in CLIPS
# (idle, walk, talk) are posed frame by frame and stored as shape keys, which the game plays back per instance in its shader.
# Writes public/models/props.glb, props.json, props_albedo.jpg and props_credits.txt (the attribution CC-BY models need).
import bpy, bmesh, sys, os, math, json, re, zipfile
from mathutils import Matrix, Euler, Vector, Quaternion
from mathutils.bvhtree import BVHTree
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
proj = argv[0]
def opt(flag, default): return argv[argv.index(flag) + 1] if flag in argv else default
SRC = opt('--src', os.path.join(proj, 'assets-src', 'props')); OUT = opt('--out', os.path.join(proj, 'public', 'models'))
TEX = os.path.join(proj, 'public', 'textures'); LIST = '--list' in argv; ONLY = opt('--slots', None)
os.makedirs(SRC, exist_ok=True); os.makedirs(OUT, exist_ok=True)
AW = AH = 4096

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'; scene.cycles.device = 'CPU'
try: scene.cycles.use_denoising = False
except Exception: pass
scene.world = bpy.data.worlds.new('w')

# ------------------------------------------------------------------------------------------------ stand-in materials
def principled(nt):
    for n in nt.nodes:
        if n.type == 'BSDF_PRINCIPLED': return n
def mat(name, tint, tex=None, scale=1.0):
    m = bpy.data.materials.new(name); m.use_nodes = True; m.use_fake_user = True; nt = m.node_tree; b = principled(nt)
    path = os.path.join(TEX, tex, 'diff.jpg') if tex else None
    if path and os.path.exists(path):
        tc = nt.nodes.new('ShaderNodeTexCoord'); mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (scale, scale, scale)
        img = nt.nodes.new('ShaderNodeTexImage'); img.image = bpy.data.images.load(path, check_existing=True); img.image.use_fake_user = True
        img.projection = 'BOX'; img.projection_blend = 0.2
        vm = nt.nodes.new('ShaderNodeVectorMath'); vm.operation = 'MULTIPLY'; vm.inputs[1].default_value = tint
        nt.links.new(tc.outputs['Object'], mp.inputs['Vector']); nt.links.new(mp.outputs['Vector'], img.inputs['Vector'])
        nt.links.new(img.outputs['Color'], vm.inputs[0]); nt.links.new(vm.outputs['Vector'], b.inputs['Base Color'])
    else: b.inputs['Base Color'].default_value = (*(tint if not tex else [c * 0.4 for c in tint]), 1)
    return m
MATS = {
    'wood': mat('wood', (0.62, 0.5, 0.4), 'dark_planks', 0.8), 'wood_l': mat('wood_l', (1.05, 0.86, 0.64), 'dark_planks', 0.8),
    'stone': mat('stone', (1.3, 1.25, 1.15), 'medieval_blocks_02', 0.5), 'thatch': mat('thatch', (1.0, 0.95, 0.85), 'thatch_roof_angled', 0.6),
    'canvas': mat('canvas', (0.8, 0.76, 0.66)), 'sail': mat('sail', (0.78, 0.74, 0.64)), 'sack': mat('sack', (0.55, 0.46, 0.32)),
    'awn_r': mat('awn_r', (0.55, 0.13, 0.1)), 'awn_b': mat('awn_b', (0.16, 0.27, 0.42)), 'awn_o': mat('awn_o', (0.74, 0.52, 0.2)),
    'g_green': mat('g_green', (0.25, 0.42, 0.14)), 'g_red': mat('g_red', (0.6, 0.12, 0.08)), 'g_ochre': mat('g_ochre', (0.78, 0.56, 0.16)), 'g_brown': mat('g_brown', (0.4, 0.27, 0.15)),
    'iron': mat('iron', (0.1, 0.1, 0.11)), 'dark': mat('dark', (0.02, 0.02, 0.025)), 'gold': mat('gold', (0.75, 0.58, 0.2)), 'rope': mat('rope', (0.45, 0.38, 0.26)),
    'flag': mat('flag', (0.6, 0.1, 0.08)), 'skin': mat('skin', (0.78, 0.6, 0.5)), 'hair': mat('hair', (0.2, 0.15, 0.1)),
    # neutral greys: the game tints these props per instance (cloth, clothes, horse coats)
    'cloth': mat('cloth', (0.86, 0.86, 0.86)), 'cloth_d': mat('cloth_d', (0.5, 0.5, 0.5)), 'hose': mat('hose', (0.36, 0.34, 0.32)),
}
DEFAULT = mat('default', (0.5, 0.5, 0.5))

class B:
    def __init__(self): self.bm = bmesh.new(); self.names = []
    def mi(self, m):
        if m not in self.names: self.names.append(m)
        return self.names.index(m)
    def _set(self, verts, m):
        i = self.mi(m)
        for f in set(f for v in verts for f in v.link_faces): f.material_index = i
    def box(self, c, s, m, rot=(0, 0, 0)):
        mx = Matrix.Translation(c) @ Euler(rot).to_matrix().to_4x4() @ Matrix.Diagonal((s[0], s[1], s[2], 1))
        self._set(bmesh.ops.create_cube(self.bm, size=1.0, matrix=mx)['verts'], m)
    def cyl(self, c, r, h, seg, m, r2=None, rot=(0, 0, 0)):
        mx = Matrix.Translation(c) @ Euler(rot).to_matrix().to_4x4()
        self._set(bmesh.ops.create_cone(self.bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r, radius2=r if r2 is None else max(r2, 0.01), depth=h, matrix=mx)['verts'], m)
    def poly(self, pts, m):
        f = self.bm.faces.new([self.bm.verts.new(p) for p in pts]); f.material_index = self.mi(m)
    def obj(self, name):
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        me = bpy.data.meshes.new(name); self.bm.to_mesh(me); self.bm.free()
        o = bpy.data.objects.new(name, me); scene.collection.objects.link(o)
        for m in self.names: me.materials.append(MATS[m])
        return o

# a planked hull: stations from the stern (-L/2) to the bow (+L/2), each a keel, a bilge and a gunwale point per side
def hull(b, L, W, H, m, deck, deck_z, n=12, sheer=0.25, stern=0.55):
    S = []
    for i in range(n + 1):
        u = 2 * i / n - 1
        hb = W / 2 * ((1 - (1 - stern) * abs(u) ** 3) if u < 0 else (max(0.0, 1 - u ** 2.2) ** 0.8 + 0.015))
        S.append(((u / 2) * L, hb, H * 0.55 * max(0.0, u) ** 3, H * (1 + sheer * u * u)))
    pt = lambda s, sd, k: (s[0], 0, s[2]) if k == 0 else (s[0], sd * s[1] * 0.8, s[2] + (s[3] - s[2]) * 0.35) if k == 1 else (s[0], sd * s[1], s[3])
    for a, c in zip(S, S[1:]):
        for sd in (-1, 1):
            for k in (0, 1): b.poly([pt(a, sd, k), pt(c, sd, k), pt(c, sd, k + 1), pt(a, sd, k + 1)], m)
        za, zc = a[2] + (a[3] - a[2]) * deck_z, c[2] + (c[3] - c[2]) * deck_z; f = 0.8 + 0.2 * (deck_z - 0.35) / 0.65
        b.poly([(a[0], -a[1] * f, za), (c[0], -c[1] * f, zc), (c[0], c[1] * f, zc), (a[0], a[1] * f, za)], deck)
    a = S[0]; b.poly([pt(a, -1, 2), pt(a, -1, 1), pt(a, 1, 0), pt(a, 1, 1), pt(a, 1, 2)], m)      # transom

def s_stall(awn):
    b = B()
    for sx in (-1, 1):
        for sy, h in ((-1, 2.15), (1, 2.75)): b.box((sx * 1.6, sy * 0.9, h / 2), (0.1, 0.1, h), 'wood')
        b.box((sx * 1.62, -0.55, 0.45), (0.05, 0.9, 0.8), 'wood')
    b.box((0, -0.55, 0.86), (3.3, 0.9, 0.08), 'wood_l'); b.box((0, -0.98, 0.45), (3.3, 0.05, 0.8), 'wood')   # counter, front boards
    b.box((0, 0.93, 1.45), (3.2, 0.03, 2.3), 'canvas')                                                       # back cloth
    for i in range(6):                                                                                      # striped awning, high at the back
        x0, x1 = -1.85 + i * 3.7 / 6, -1.85 + (i + 1) * 3.7 / 6; m = awn if i % 2 == 0 else 'canvas'
        b.poly([(x0, -1.5, 2.05), (x1, -1.5, 2.05), (x1, 1.1, 2.85), (x0, 1.1, 2.85)], m)
        b.poly([(x0, -1.5, 2.05), (x1, -1.5, 2.05), (x1, -1.5, 1.8), (x0, -1.5, 1.8)], m)
    for m, x in (('g_green', -1.1), ('g_red', -0.35), ('g_ochre', 0.4), ('g_brown', 1.1)):                  # crates of produce
        b.box((x, -0.55, 1.0), (0.6, 0.6, 0.2), 'wood'); b.box((x, -0.55, 1.12), (0.5, 0.5, 0.1), m)
    return b
def s_cart():
    b = B(); b.box((0, 0, 0.82), (2.3, 1.15, 0.1), 'wood_l')
    for sy in (-1, 1):
        b.box((0, sy * 0.57, 1.1), (2.3, 0.06, 0.5), 'wood')
        b.cyl((-0.15, sy * 0.72, 0.6), 0.6, 0.09, 12, 'wood', rot=(math.pi / 2, 0, 0)); b.cyl((-0.15, sy * 0.78, 0.6), 0.12, 0.1, 6, 'iron', rot=(math.pi / 2, 0, 0))
        b.box((2.0, sy * 0.42, 0.72), (1.9, 0.07, 0.07), 'wood', rot=(0, 0.12, 0))                          # shafts
    for sx in (-1, 1): b.box((sx * 1.14, 0, 1.1), (0.06, 1.15, 0.5), 'wood')
    b.box((0, 0, 1.25), (2.0, 0.95, 0.5), 'canvas'); b.box((-0.4, 0.1, 1.58), (1.0, 0.7, 0.22), 'sack')     # load under a cloth
    return b
def s_barrels():
    b = B()
    for x, y in ((0, 0), (0.78, 0.1), (0.35, 0.72)):
        b.cyl((x, y, 0.47), 0.34, 0.94, 10, 'wood_l')
        for z in (0.2, 0.74): b.cyl((x, y, z), 0.36, 0.06, 10, 'iron')
    b.box((-0.75, 0.15, 0.3), (0.65, 0.65, 0.6), 'wood'); b.box((-0.7, 0.2, 0.81), (0.5, 0.5, 0.42), 'wood_l', rot=(0, 0, 0.4))
    b.cyl((-0.35, -0.7, 0.28), 0.34, 0.56, 8, 'sack', r2=0.2); b.cyl((0.35, -0.65, 0.25), 0.32, 0.5, 8, 'sack', r2=0.18)
    return b
def s_well():
    b = B(); b.cyl((0, 0, 0.42), 1.0, 0.84, 12, 'stone'); b.cyl((0, 0, 0.85), 0.78, 0.02, 12, 'dark')
    for sx in (-1, 1): b.box((sx * 1.05, 0, 1.45), (0.14, 0.14, 2.9), 'wood')
    b.cyl((0, 0, 2.0), 0.08, 2.1, 6, 'wood', rot=(0, math.pi / 2, 0))
    for sy in (-1, 1): b.poly([(-1.35, sy * 0.95, 2.75), (1.35, sy * 0.95, 2.75), (1.35, 0, 3.35), (-1.35, 0, 3.35)], 'thatch')
    return b
def s_banner():
    b = B(); b.cyl((0, 0, 3.5), 0.07, 7.0, 6, 'hose'); b.cyl((0, 0, 7.1), 0.12, 0.24, 6, 'cloth_d', r2=0.01); b.box((0, 0, 6.6), (1.5, 0.06, 0.06), 'hose')
    b.poly([(-0.65, 0.05, 6.55), (0.65, 0.05, 6.55), (0.65, 0.05, 4.0), (0, 0.05, 3.4), (-0.65, 0.05, 4.0)], 'cloth')
    return b
def s_tent():
    b = B(); n = 12; R = 2.6; p = lambda a, r, z: (math.cos(a) * r, math.sin(a) * r, z)
    for i in range(n):
        a0, a1 = i * math.tau / n, (i + 1) * math.tau / n; m = 'cloth' if i % 2 == 0 else 'cloth_d'
        b.poly([p(a0, R, 0), p(a1, R, 0), p(a1, R, 2.0), p(a0, R, 2.0)], m); b.poly([p(a0, R * 1.08, 1.95), p(a1, R * 1.08, 1.95), (0, 0, 4.7)], m)
    b.cyl((0, 0, 5.1), 0.04, 1.0, 5, 'hose'); b.poly([(0, 0, 5.6), (0.9, 0, 5.45), (0, 0, 5.3)], 'cloth')
    return b
def s_boat():
    b = B(); hull(b, 5.4, 1.7, 0.75, 'wood', 'wood_l', 0.3, n=8)
    for x in (-1.4, 0, 1.2): b.box((x, 0, 0.55), (0.3, 1.3, 0.05), 'wood_l')
    return b
def s_galley():
    b = B(); L = 38; hull(b, L, 6.0, 3.4, 'wood', 'wood_l', 0.8, n=14, sheer=0.3)
    b.box((-15.5, 0, 4.4), (5.5, 4.6, 1.6), 'wood'); b.box((-15.5, 0, 5.3), (5.9, 5.0, 0.2), 'wood_l')      # stern castle
    b.box((L / 2 + 1.0, 0, 1.7), (3.5, 0.5, 0.5), 'iron')                                                   # ram
    for x, h in ((5.0, 17.0), (-7.0, 13.5)):
        b.cyl((x, 0, 2.6 + h / 2), 0.22, h, 6, 'wood')
        y0, y1 = Vector((x + h * 0.55, 0, 2.6 + h * 0.45)), Vector((x - h * 0.42, 0, 2.6 + h * 1.02)); d = y1 - y0   # lateen yard and sail
        b.box((y0 + y1) / 2, (d.length, 0.2, 0.2), 'wood', rot=(0, math.atan2(-d.z, d.x), 0))
        c = Vector((x - h * 0.3, 0.8, 4.4)); g = (y0 + y1 + c) / 3 + Vector((0, 1.6, 0))
        for p, q in ((y0, y1), (y1, c), (c, y0)): b.poly([p, q, g], 'sail')
    for i in range(12):
        for sd in (-1, 1): b.box((-11 + i * 2.0, sd * 4.5, 1.7), (0.12, 4.2, 0.08), 'wood_l', rot=(-sd * 0.35, 0, 0))   # oars
    return b
def s_ship():
    b = B(); L = 30; hull(b, L, 8.4, 5.6, 'wood', 'wood_l', 0.72, n=12, sheer=0.35, stern=0.7); z0 = 4.2
    b.box((-11.2, 0, 7.0), (6.5, 6.6, 2.6), 'wood'); b.box((-11.2, 0, 8.4), (7.0, 7.0, 0.25), 'wood_l')     # aftercastle
    b.box((11.0, 0, 6.8), (4.5, 5.0, 1.8), 'wood'); b.box((11.0, 0, 7.8), (5.0, 5.4, 0.25), 'wood_l')       # forecastle
    b.box((16.5, 0, 8.6), (7.5, 0.3, 0.3), 'wood', rot=(0, -0.4, 0))                                        # bowsprit
    for x, h, w, top in ((1.5, 25.0, 13.0, True), (-9.0, 17.0, 8.0, False), (9.5, 16.0, 8.0, False)):
        b.cyl((x, 0, z0 + h / 2), 0.3, h, 6, 'wood'); b.box((x + 0.35, 0, z0 + h * 0.88), (0.3, w, 0.3), 'wood')
        t, bt = z0 + h * 0.86, z0 + h * 0.3; g = (x + 2.0, 0, (t + bt) / 2)                                 # square sail, bellied forward
        P = [(x + 0.4, -w / 2, t), (x + 0.4, w / 2, t), (x + 0.4, w * 0.46, bt), (x + 0.4, -w * 0.46, bt)]
        for i in range(4): b.poly([P[i], P[(i + 1) % 4], g], 'sail')
        if top: b.cyl((x, 0, z0 + h * 0.93), 0.9, 0.7, 8, 'wood', r2=1.1)
        b.poly([(x, 0, z0 + h + 0.2), (x - 2.2, 0.3, z0 + h - 0.2), (x, 0, z0 + h - 0.6)], 'flag')
    return b
def s_crane():
    b = B(); b.box((0, 0, 0.5), (4.2, 4.2, 1.0), 'stone'); b.box((0, 0, 3.6), (3.0, 3.0, 5.2), 'wood')      # quay block, timber housing
    c = [(-1.8, -1.8, 6.2), (1.8, -1.8, 6.2), (1.8, 1.8, 6.2), (-1.8, 1.8, 6.2)]
    for i in range(4): b.poly([c[i], c[(i + 1) % 4], (0, 0, 8.0)], 'wood_l')
    b.cyl((0, 1.95, 3.4), 2.3, 0.9, 14, 'wood_l', rot=(math.pi / 2, 0, 0)); b.cyl((0, 2.45, 3.4), 0.3, 0.2, 6, 'iron', rot=(math.pi / 2, 0, 0))   # treadwheel
    b.box((3.4, 0, 8.6), (9.5, 0.4, 0.4), 'wood', rot=(0, -0.62, 0)); b.box((1.4, 0, 6.6), (0.25, 0.25, 3.2), 'wood', rot=(0, 0.5, 0))           # jib and brace
    b.box((7.25, 0, 8.45), (0.06, 0.06, 5.8), 'rope'); b.box((7.25, 0, 5.2), (0.7, 0.7, 0.7), 'wood_l')     # a crate on the hook
    return b
def s_person(kind):
    b = B()
    if kind == 0:
        for sy in (-1, 1): b.box((0, sy * 0.1, 0.42), (0.16, 0.15, 0.84), 'hose'); b.box((0, sy * 0.28, 1.1), (0.13, 0.11, 0.6), 'cloth')
        b.box((0, 0, 1.12), (0.26, 0.44, 0.62), 'cloth')
    else:
        b.cyl((0, 0, 0.55), 0.3, 1.1, 8, 'cloth', r2=0.17); b.box((0, 0, 1.25), (0.24, 0.4, 0.4), 'cloth_d')
        for sy in (-1, 1): b.box((0, sy * 0.25, 1.15), (0.12, 0.1, 0.55), 'cloth_d')
    b.box((0, 0, 1.58), (0.2, 0.2, 0.24), 'skin'); b.box((-0.02, 0, 1.68), (0.22, 0.22, 0.1), 'hair' if kind == 0 else 'cloth_d')
    return b
def s_horse():
    b = B(); b.box((0, 0, 1.15), (1.5, 0.5, 0.6), 'cloth')
    for sx in (-0.6, 0.6):
        for sy in (-0.16, 0.16): b.box((sx, sy, 0.45), (0.14, 0.13, 0.9), 'cloth_d')
    b.box((0.85, 0, 1.6), (0.75, 0.3, 0.38), 'cloth', rot=(0, -0.9, 0)); b.box((1.2, 0, 1.92), (0.55, 0.24, 0.26), 'cloth', rot=(0, 0.5, 0))   # neck, head
    b.box((-0.82, 0, 1.0), (0.1, 0.1, 0.7), 'cloth_d', rot=(0, -0.25, 0))
    return b

# ------------------------------------------------------------------------------------------------------------ slots
# use: where a slot's model may come from, first match wins. k: a keyword in the download's file name; pick: which separate
# piece of it (biggest first); only: a pattern its object names must match; fit / sink: its own size or waterline. With
# neither pick nor only the whole download is one prop. fit: ('len', m) scales the longest side on the ground to m metres,
# ('h', m) the height. long: turn the long side to local X (the game's fore-and-aft). sink: metres of hull below the
# waterline. tint: the stand-in is grey and coloured per instance by the game (a downloaded model keeps its own colours).
# small: four such slots share one atlas cell. anim: a rigged download gets the loops in CLIPS. standin=None: the slot is
# simply left out when nothing was downloaded for it.
U = lambda k, **kw: dict(k=k, **kw)
PERSON_TRIS = 520
SLOTS = [
    dict(name='stall_a', fit=('len', 3.8), tris=1800, use=[U('marketstalls', pick=0), U('marketasset', fit=('h', 3.4), only=r'^(?!Handcart|Bucket)'), U('stall')], standin=lambda: s_stall('awn_r')),
    dict(name='stall_b', fit=('len', 3.8), tris=1800, use=[U('marketstalls', pick=1), U('foodstall'), U('stall')], standin=lambda: s_stall('awn_b')),
    dict(name='stall_c', fit=('len', 3.8), tris=1800, use=[U('marketstalls', pick=2), U('stall')], standin=lambda: s_stall('awn_o')),
    dict(name='cart', fit=('len', 4.2), tris=900, long=True, use=[U('cartwithcrates'), U('cart'), U('wagon'), U('marketasset', only=r'^Handcart')], standin=s_cart),
    dict(name='barrels', fit=('len', 2.3), tris=500, use=[U('barrel'), U('crate'), U('marketasset', only=r'^(Barrel|Box|Bottle)')], standin=s_barrels),
    dict(name='well', fit=('h', 3.3), tris=600, use=[U('well')], standin=s_well),
    dict(name='banner', fit=('h', 7.2), tris=300, tint=True, use=[U('flag'), U('banner'), U('standard')], standin=s_banner),
    dict(name='tent', fit=('len', 5.6), tris=1500, tint=True, use=[U('fayre', fit=('len', 16)), U('camp', fit=('len', 20)), U('tent'), U('pavilion')], standin=s_tent),
    dict(name='boat', fit=('len', 5.4), tris=500, long=True, sink=0.25, use=[U('fishingboat'), U('rowboat'), U('dinghy'), U('boat')], standin=s_boat),
    dict(name='galley', fit=('len', 40), tris=3000, long=True, sink=1.0, use=[U('dromon'), U('galley'), U('longship')], standin=s_galley),
    dict(name='ship', fit=('len', 34), tris=3000, long=True, sink=1.6, use=[U('galleon', sink=3.2), U('caravel', sink=3.0), U('cog', sink=2.4), U('ship', sink=2.4)], standin=s_ship),
    dict(name='crane', fit=('h', 11.4), tris=1800, use=[U('treadwheel'), U('crane')], standin=s_crane),
    # townsfolk share atlas cells four to one (small). Rigged downloads are animated; anything else is used as it stands.
    dict(name='person_a', fit=('h', 1.8), tris=PERSON_TRIS, tint=True, small=True, anim=True, use=[U('civilian1'), U('crowd', pick=0), U('peasant'), U('villager')], standin=lambda: s_person(0)),
    dict(name='person_b', fit=('h', 1.75), tris=PERSON_TRIS, tint=True, small=True, anim=True, use=[U('civilian3'), U('civilian'), U('crowd', pick=1), U('monk')], standin=lambda: s_person(1)),
    dict(name='person_c', fit=('h', 1.66), tris=PERSON_TRIS, small=True, anim=True, use=[U('fusewoman'), U('peasantwoman'), U('maid')], standin=None),
    dict(name='person_d', fit=('h', 1.57), tris=PERSON_TRIS, small=True, anim=True, use=[U('poorwoman'), U('oldwoman'), U('crone')], standin=None),
    dict(name='horse', fit=('len', 2.4), tris=600, long=True, tint=True, use=[U('horse')], standin=s_horse),
]
# where each slot bakes to: (cell, column and row inside the cell, divisions of the cell)
RECT = {}; _cells = 0; _small = 0
for _s in SLOTS:
    if _s.get('small'):
        if _small % 4 == 0: _cell = _cells; _cells += 1
        RECT[_s['name']] = (_cell, _small % 2, (_small % 4) // 2, 2); _small += 1
    else: RECT[_s['name']] = (_cells, 0, 0, 1); _cells += 1
COLS = math.ceil(math.sqrt(_cells)); ROWS = math.ceil(_cells / COLS)

# -------------------------------------------------------------------------------------------------------- downloads
def norm(s): return re.sub(r'[^a-z0-9]', '', s.lower())
EXT = {'.gltf': 0, '.glb': 1, '.fbx': 2, '.obj': 3}
def sources():
    out = []
    for fn in sorted(os.listdir(SRC)):
        p = os.path.join(SRC, fn); stem, e = os.path.splitext(fn)
        if fn.startswith(('.', '_')): continue
        if os.path.isdir(p): out.append((norm(fn), p))
        elif e.lower() == '.zip' or e.lower() in EXT: out.append((norm(stem), p))
    return out
def unpack(p):
    if not p.lower().endswith('.zip'): return p
    dst = os.path.join(SRC, '_unpacked', os.path.splitext(os.path.basename(p))[0])
    if not os.path.isdir(dst) or os.path.getmtime(dst) < os.path.getmtime(p):
        with zipfile.ZipFile(p) as z:
            root = os.path.realpath(dst)
            for m in z.infolist():
                t = os.path.realpath(os.path.join(dst, m.filename))
                if t != root and not t.startswith(root + os.sep): raise SystemExit('refusing to unpack %s: it holds a path outside its own folder (%s)' % (p, m.filename))
            z.extractall(dst)
    return dst
def model_file(p):
    if os.path.isfile(p): return p
    best = None
    for d, _, fs in os.walk(p):
        for f in sorted(fs):
            e = os.path.splitext(f)[1].lower()
            if e in EXT and (best is None or EXT[e] < best[0]): best = (EXT[e], os.path.join(d, f))
    return best[1] if best else None
def credit(p):      # Sketchfab puts a license.txt (title, source, author, licence) in every download
    if not os.path.isdir(p): return None
    for d, _, fs in os.walk(p):
        for f in fs:
            if f.lower() == 'license.txt':
                t = open(os.path.join(d, f), encoding='utf-8', errors='replace').read()
                c = {k.split()[0]: v.strip() for k, v in re.findall(r'\*\s*(title|source|author|license type):[ \t]*(.+)', t)}
                return c or None
    return None

def bbox(objs):
    lo, hi = Vector((1e18,) * 3), Vector((-1e18,) * 3)
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            for i in range(3): lo[i] = min(lo[i], w[i]); hi[i] = max(hi[i], w[i])
    return lo, hi
def load(path):       # → (everything the file brought in, its real meshes: not the shapes an importer draws bones with)
    before = set(bpy.data.objects); e = os.path.splitext(path)[1].lower()
    if e in ('.gltf', '.glb'): bpy.ops.import_scene.gltf(filepath=path)
    elif e == '.fbx': bpy.ops.import_scene.fbx(filepath=path)
    else: bpy.ops.wm.obj_import(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    shapes = {pb.custom_shape for o in new if o.type == 'ARMATURE' for pb in o.pose.bones if pb.custom_shape}
    return new, [o for o in new if o.type == 'MESH' and len(o.data.polygons) and o not in shapes]
def import_model(path):
    new, meshes = load(path)
    if not meshes: raise RuntimeError('no meshes in ' + path)
    # freeze rigged or modified meshes as they stand, cut them loose from their parents, drop everything else
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes: o.hide_set(False); o.hide_render = False; o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.make_single_user(object=True, obdata=True); bpy.ops.object.convert(target='MESH'); bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    for o in new:
        if o not in meshes: bpy.data.objects.remove(o, do_unlink=True)
    bpy.context.view_layer.update()
    return meshes
# pieces that stand apart on the ground are separate props; pieces that touch or overlap belong together. A flat slab under
# everything (a display base) is dropped. Biggest footprint first.
def clusters(meshes):
    bb = [bbox([o]) for o in meshes]; lo, hi = bbox(meshes); sx, sy, sz = hi.x - lo.x, hi.y - lo.y, hi.z - lo.z
    keep = [i for i, (a, c) in enumerate(bb) if not (len(meshes) > 1 and (c.x - a.x) * (c.y - a.y) > 0.7 * sx * sy and (c.z - a.z) < 0.12 * sz)]
    pad = 0.01 * max(sx, sy); par = {i: i for i in keep}
    def find(i):
        while par[i] != i: par[i] = par[par[i]]; i = par[i]
        return i
    for n, i in enumerate(keep):
        for j in keep[n + 1:]:
            a, c = bb[i], bb[j]
            if a[0].x - pad <= c[1].x and c[0].x - pad <= a[1].x and a[0].y - pad <= c[1].y and c[0].y - pad <= a[1].y: par[find(i)] = find(j)
    groups = {}
    for i in keep: groups.setdefault(find(i), []).append(meshes[i])
    def key(g): a, c = bbox(g); return (-round((c.x - a.x) * (c.y - a.y), 3), round(a.x, 3), round(a.y, 3))
    return sorted(groups.values(), key=key)
def tri_count(me): return sum(len(p.vertices) - 2 for p in me.polygons)

def from_download(slot, path, pick, only=None):
    meshes = import_model(model_file(path))
    if only:
        drop = [o for o in meshes if not re.search(only, o.name)]; meshes = [o for o in meshes if o not in drop]
        for o in drop: bpy.data.objects.remove(o, do_unlink=True)
        if not meshes: raise RuntimeError('nothing in it is named like ' + only)
    cl = clusters(meshes)
    use = cl[pick % len(cl)] if pick is not None else [o for g in cl for o in g]
    for o in meshes:
        if o not in use: bpy.data.objects.remove(o, do_unlink=True)
    for o in use:       # one UV layer each, all with the same name, so joining does not scramble which UVs the textures read
        uv = o.data.uv_layers; act = next((l.name for l in uv if l.active_render), None)
        for nm in [l.name for l in uv if l.name != act]: uv.remove(uv[nm])
        if act: uv[0].name = 'UVMap'
    bpy.ops.object.select_all(action='DESELECT')
    for o in use: o.select_set(True)
    bpy.context.view_layer.objects.active = use[0]
    if len(use) > 1: bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return o

def fit_to_size(o, slot, fit):
    me = o.data
    def coords(): co = np.empty(len(me.vertices) * 3, dtype=np.float32); me.vertices.foreach_get('co', co); return co.reshape(-1, 3)
    if slot.get('long'):      # turn the model's own long axis (wherever it points) onto X: the tightest rectangle around it on the ground
        xy = coords()[:, :2].astype(np.float64); best = None
        for deg in range(180):
            t = math.radians(deg); u = xy[:, 0] * math.cos(t) + xy[:, 1] * math.sin(t); v = -xy[:, 0] * math.sin(t) + xy[:, 1] * math.cos(t)
            du, dv = u.max() - u.min(), v.max() - v.min()
            if best is None or du * dv < best[0] - 1e-9: best = (du * dv, t if du >= dv else t + math.pi / 2)
        me.transform(Matrix.Rotation(-best[1], 4, 'Z'))
    if slot.get('rot'): me.transform(Matrix.Rotation(math.radians(slot['rot']), 4, 'Z'))
    co = coords(); lo, hi = co.min(0), co.max(0); size = hi - lo
    M = Matrix.Translation((-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]))
    s = fit[1] / max(1e-6, max(size[0], size[1]) if fit[0] == 'len' else size[2])
    me.transform(Matrix.Translation((0, 0, -slot.get('sink', 0))) @ Matrix.Scale(s, 4) @ M, shape_keys=True); me.update()
    return float(s)
def decimate(o, budget):
    n = tri_count(o.data)
    if n > budget:
        m = o.modifiers.new('dec', 'DECIMATE'); m.ratio = budget / n; m.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = o
        if len(o.modifiers) > 1: bpy.ops.object.modifier_move_to_index(modifier='dec', index=0)      # ahead of a rig's armature
        bpy.ops.object.modifier_apply(modifier='dec')

# ------------------------------------------------------------------------------------------------- rigged townsfolk
# A character's own frame: s to its left, u up, f the way it faces. A pose is a list of (bone, (s, u, f)): aim that bone along
# that direction, parents before children, so it does not matter how the rig's bones are rolled or what scale the file is
# in; (bone, angle) instead turns the bone about the vertical. Each clip gives the pose at t = 0..1 through its loop.
def _hang(ang, side=0.0): return (side, -math.cos(ang), math.sin(ang))       # a limb hanging down, swung forward by ang
def idle_pose(t):
    a = math.tau * t; out = [('Spine', (0.03 * math.sin(a), 1, 0.02 + 0.012 * math.sin(2 * a)))]      # weight shifts from foot to foot
    for sd, L in ((1, 'Left'), (-1, 'Right')):
        out += [(L + 'Arm', (0.2 * sd + 0.02 * math.sin(a), -1, 0.04 + 0.03 * math.sin(a + sd))), (L + 'ForeArm', (0.12 * sd, -1, 0.22 + 0.05 * math.sin(a + 1 + sd)))]
    return out + [('Head', 0.26 * math.sin(a + 0.6))]
def talk_pose(t):
    a = math.tau * t
    return [('Spine', (0.02 * math.sin(a), 1, 0.03)), ('LeftArm', (0.22, -1, 0.02)), ('LeftForeArm', (0.1, -1, 0.3 + 0.1 * math.sin(2 * a))),
            ('RightArm', (-0.26, -1, 0.34 + 0.1 * math.sin(a))), ('RightForeArm', (0.12 + 0.22 * math.sin(a), 0.3 + 0.3 * math.sin(2 * a + 0.8), 1)),
            ('Head', (-0.08 + 0.05 * math.sin(a), 1, 0.1 + 0.07 * math.sin(2 * a))), ('Head', 0.12 * math.sin(a + 1.0))]
def walk_pose(t):
    out = [('Spine', (0, 1, 0.06))]
    for sd, L, ph in ((1, 'Left', 0.0), (-1, 'Right', 0.5)):
        a = math.tau * (t + ph); th = 0.42 * math.sin(a)                      # the thigh swings; furthest forward at heel strike
        sh = th - 0.12 - 1.0 * max(0.0, math.cos(a)) ** 1.5                   # the knee folds as the leg comes through
        out += [(L + 'UpLeg', _hang(th, 0.03 * sd)), (L + 'Leg', _hang(sh, 0.03 * sd)), (L + 'Foot', _hang(0.98 + 0.55 * sh))]
        arm = -0.36 * math.sin(a)                                             # each arm swings against its own leg
        out += [(L + 'Arm', _hang(arm, 0.17 * sd)), (L + 'ForeArm', _hang(arm + 0.18 + 0.3 * max(0.0, -math.sin(a)), 0.1 * sd))]
    return out
# name: (frames in the loop, its length in seconds — None for the walk, which the game times from the stride —, pose function)
CLIPS = {'idle': (10, 4.2, idle_pose), 'walk': (14, None, walk_pose), 'talk': (10, 3.4, talk_pose)}
def rig_bone(arm, name): return next((b for b in arm.pose.bones if re.search(r'(^|[:_ ])%s(_\d+)?$' % name, b.name)), None)
def aim(arm, pb, d):        # swing a bone about its head until it points along d (world space); a number turns it about the vertical
    bpy.context.view_layer.update()
    W = arm.matrix_world.to_3x3(); cur = (W @ (pb.tail - pb.head)).normalized()
    q = Quaternion((0, 0, 1), d) if isinstance(d, (int, float)) else cur.rotation_difference(d.normalized())
    R = (W.inverted() @ q.to_matrix() @ W).to_4x4(); h = pb.head.copy()
    pb.matrix = Matrix.Translation(h) @ R @ Matrix.Translation(-h) @ pb.matrix
    bpy.context.view_layer.update()
def principled_alpha(m):    # the texture whose alpha makes a material see-through (hair cards, lashes, cut-out cloth), if any
    p = principled(m.node_tree) if m and m.node_tree else None
    if not p or not p.inputs['Alpha'].is_linked: return None
    n = p.inputs['Alpha'].links[0].from_node
    return n.image if n.type == 'TEX_IMAGE' and n.image and n.image.size[0] else None
_ALPHA = {}
def alpha_map(img):         # → (alpha per texel, the average colour of the opaque texels)
    if img.name not in _ALPHA:
        w, h = img.size; a = np.empty(w * h * 4, dtype=np.float32); img.pixels.foreach_get(a); a = a.reshape(h, w, 4); n = float(a[..., 3].sum())
        _ALPHA[img.name] = (a[..., 3].copy(), tuple(float(c) for c in (a[..., :3] * a[..., 3:]).sum((0, 1)) / n) if n > 0 else (0.5, 0.5, 0.5))
    return _ALPHA[img.name]
def drop_clear_faces(o):    # the atlas has no alpha: faces that lie wholly in the transparent part of their texture go
    me = o.data; uv = me.uv_layers.active
    if not uv: return
    kill = []
    for k, m in enumerate(me.materials):
        img = principled_alpha(m)
        if not img: continue
        al, _ = alpha_map(img); h, w = al.shape; mine = [p for p in me.polygons if p.material_index == k]; gone = []
        for p in mine:
            pts = [uv.data[l].uv.copy() for l in p.loop_indices]; c = sum(pts, Vector((0, 0))) / len(pts)
            if max(al[int((q.y % 1) * h) % h, int((q.x % 1) * w) % w] for q in pts + [c] + [(q + c) / 2 for q in pts]) < 0.08: gone.append(p.index)
        if len(gone) < 0.7 * len(mine): kill += gone
    if kill:
        bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[bm.faces[i] for i in kill], context='FACES'); bm.to_mesh(me); bm.free()
def drop_covered(body, covers):     # skin under clothing would only poke through it once both are cut down to a few triangles
    if not covers: return
    trees = [BVHTree.FromPolygons([c.matrix_world @ v.co for v in c.data.vertices], [p.vertices[:] for p in c.data.polygons]) for c in covers]
    M = body.matrix_world; N = M.to_3x3(); me = body.data; lo, hi = bbox([body]); reach = 0.1 * (hi.z - lo.z); kill = []
    def hidden(pt, n): return any(t.ray_cast(pt, n, reach)[0] is not None for t in trees)
    for p in me.polygons:
        n = (N @ p.normal).normalized()
        if all(hidden(M @ q, n) for q in [p.center] + [me.vertices[v].co for v in p.vertices]): kill.append(p.index)
    if kill:
        bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[bm.faces[i] for i in kill], context='FACES'); bm.to_mesh(me); bm.free()
def solid(o):       # clothing that hides what is under it: not hair cards or anything else that is mostly see-through
    imgs = [principled_alpha(m) for m in o.data.materials]
    return all(i is None or float(alpha_map(i)[0].mean()) > 0.7 for i in imgs)
def bind(o, body, arm):     # clothes that were left unskinned follow the rig with the weights of the body beneath them
    for g in body.vertex_groups:
        if g.name not in o.vertex_groups: o.vertex_groups.new(name=g.name)
    dt = o.modifiers.new('dt', 'DATA_TRANSFER'); dt.object = body; dt.use_vert_data = True; dt.data_types_verts = {'VGROUP_WEIGHTS'}
    dt.vert_mapping = 'POLYINTERP_NEAREST'; dt.layers_vgroup_select_src = 'ALL'; dt.layers_vgroup_select_dst = 'NAME'
    bpy.context.view_layer.objects.active = o; bpy.ops.object.modifier_apply(modifier='dt')
    o.modifiers.new('arm', 'ARMATURE').object = arm
# Returns (mesh object with one shape key per frame, clips {name: [first key, frames, seconds]}, stride: the ground one walk
# loop covers, in the object's units) for a download with a skeleton, baked into the slot's atlas patch; None when it has none.
def rigged(slot, path, IMG):
    f = model_file(path); new, meshes = load(f)
    def clear():
        for o in new:
            try: bpy.data.objects.remove(o, do_unlink=True)
            except ReferenceError: pass
    try:
        arms = [o for o in new if o.type == 'ARMATURE']; skin = lambda o, a: any(m.type == 'ARMATURE' and m.object is a for m in o.modifiers)
        arm = max(arms, key=lambda a: sum(skin(o, a) for o in meshes)) if arms else None
        skinned = [o for o in meshes if arm and skin(o, arm)]
        need = [n for n in ('LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg') if not (arm and rig_bone(arm, n))]
        if not skinned or need: clear(); return None
        arm.animation_data_clear()
        bpy.ops.object.select_all(action='DESELECT')
        for o in meshes: o.hide_set(False); o.hide_render = False; o.select_set(True)
        body = max(skinned, key=lambda o: tri_count(o.data)); bpy.context.view_layer.objects.active = body
        bpy.ops.object.make_single_user(object=True, obdata=True)
        # The pose the file shows is the one its loose clothing was fitted to, and it need not be the skeleton's bind pose:
        # freeze the skinned meshes as shown and make that the rest pose, so everything starts from what the artist saw.
        for o in skinned:
            bpy.context.view_layer.objects.active = o
            if o.data.shape_keys: o.shape_key_clear()
            for nm in [m.name for m in o.modifiers if m.type == 'ARMATURE']: bpy.ops.object.modifier_apply(modifier=nm)
        arm.hide_set(False); bpy.context.view_layer.objects.active = arm
        bpy.ops.object.mode_set(mode='POSE'); bpy.ops.pose.armature_apply(selected=False); bpy.ops.object.mode_set(mode='OBJECT')
        for o in skinned: o.modifiers.new('arm', 'ARMATURE').object = arm
        for o in meshes:
            if o not in skinned: bind(o, body, arm)
            uv = o.data.uv_layers; act = next((l.name for l in uv if l.active_render), None)
            for nm in [l.name for l in uv if l.name != act]: uv.remove(uv[nm])
            if act: uv[0].name = 'UVMap'
            drop_clear_faces(o)
        drop_covered(body, [o for o in meshes if o is not body and solid(o)])
        bpy.ops.object.select_all(action='DESELECT')
        for o in meshes: o.select_set(True)
        bpy.context.view_layer.objects.active = body
        if len(meshes) > 1: bpy.ops.object.join()
        try: bpy.ops.mesh.customdata_custom_splitnormals_clear()
        except RuntimeError: pass
        bpy.ops.object.shade_smooth()
        decimate(body, slot['tris']); bake(body, slot['name'], IMG)
        bpy.context.view_layer.update(); W = arm.matrix_world
        S = (W @ rig_bone(arm, 'LeftArm').head - W @ rig_bone(arm, 'RightArm').head).normalized(); U_ = Vector((0, 0, 1)); F = S.cross(U_).normalized()
        T = Matrix.Rotation(math.atan2(F.x, -F.y), 4, 'Z') @ body.matrix_world       # to world space, facing -Y (the game's +Z)
        def frame(pose):        # → the mesh's vertices in that pose
            for pb in arm.pose.bones: pb.matrix_basis = Matrix.Identity(4)
            for name, d in pose:
                pb = rig_bone(arm, name)
                if pb: aim(arm, pb, d if isinstance(d, (int, float)) else S * d[0] + U_ * d[1] + F * d[2])
            dg = bpy.context.evaluated_depsgraph_get(); dg.update(); ev = body.evaluated_get(dg); m = ev.to_mesh()
            co = np.empty(len(m.vertices) * 3, dtype=np.float32); m.vertices.foreach_get('co', co); ev.to_mesh_clear()
            co = co.reshape(-1, 3).astype(np.float64); co = co @ np.array(T.to_3x3()).T + np.array(T.to_translation())
            foot = rig_bone(arm, 'LeftFoot'); fwd = float((W @ foot.head).dot(F)) if foot else 0.0
            return co, fwd
        rest, _ = frame(CLIPS['idle'][2](0)); floor = rest[:, 2].min()
        dg = bpy.context.evaluated_depsgraph_get(); dg.update()
        me = bpy.data.meshes.new_from_object(body.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
        me.vertices.foreach_set('co', rest.astype(np.float32).ravel()); me.update()
        while len(me.materials): me.materials.pop()
        o = bpy.data.objects.new('person', me); scene.collection.objects.link(o); o.hide_render = True
        o.shape_key_add(name='Basis'); clips = {}; n = 0; stride = 0.0
        for cname, (frames, secs, fn) in CLIPS.items():
            reach = []
            for i in range(frames):
                co, fwd = frame(fn(i / frames)); co[:, 2] += floor - co[:, 2].min(); reach.append(fwd)      # a foot always on the ground
                o.shape_key_add(name='%s_%02d' % (cname, i)).data.foreach_set('co', co.astype(np.float32).ravel())
            clips[cname] = [n, frames, secs or 0]; n += frames
            if cname == 'walk': stride = 2 * (max(reach) - min(reach))        # each foot is planted for one step a loop
        clear(); return o, clips, stride
    except Exception: clear(); raise

# ------------------------------------------------------------------------------------------------------------- bake
def new_img(name, color, noncolor=False):
    im = bpy.data.images.new(name, AW, AH, alpha=False); im.generated_color = color; im.use_fake_user = True
    if noncolor: im.colorspace_settings.name = 'Non-Color'
    return im
# Bake the colour alone, whatever the shader: route each material's base colour (texture, vertex colour or plain value)
# into an emission shader. Metal, gloss and unlit glTF materials all come out as their own colour this way.
def albedo_only(m):
    m.use_nodes = True; nt = m.node_tree
    tgt = nt.nodes.get('BAKE_TARGET') or nt.nodes.new('ShaderNodeTexImage'); tgt.name = 'BAKE_TARGET'
    for n in nt.nodes: n.select = False
    tgt.select = True; nt.nodes.active = tgt
    if m.get('albedo_only'): return tgt
    out = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL' and n.is_active_output), None) or nt.nodes.new('ShaderNodeOutputMaterial')
    p = principled(nt); em = nt.nodes.new('ShaderNodeEmission')
    old = next((n for n in nt.nodes if n.type == 'EMISSION' and n is not em), None)
    sock = p.inputs['Base Color'] if p else old.inputs['Color'] if old else None
    if sock is None: em.inputs['Color'].default_value = (0.5, 0.5, 0.5, 1)
    elif sock.is_linked:
        img = principled_alpha(m) if p else None
        if img:       # no alpha in the atlas: where the texture is see-through, bake the colour of its opaque part instead of whatever lies under it
            mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.inputs['A'].default_value = (*alpha_map(img)[1], 1)
            nt.links.new(p.inputs['Alpha'].links[0].from_socket, mix.inputs['Factor']); nt.links.new(sock.links[0].from_socket, mix.inputs['B']); nt.links.new(mix.outputs['Result'], em.inputs['Color'])
        else: nt.links.new(sock.links[0].from_socket, em.inputs['Color'])
    else: em.inputs['Color'].default_value = sock.default_value[:]
    nt.links.new(em.outputs['Emission'], out.inputs['Surface']); m['albedo_only'] = 1
    return tgt
def bake(o, name, IMG):
    me = o.data
    if not len(me.materials): me.materials.append(DEFAULT)
    for k in range(len(me.materials)):
        if me.materials[k] is None: me.materials[k] = DEFAULT
    # the textures keep reading the model's own UVs (render-active); the new layer is what gets baked to and exported
    src = next((l.name for l in me.uv_layers if l.active_render), None)
    me.uv_layers.new(name='atlas')
    if src: me.uv_layers[src].active_render = True
    me.uv_layers.active = me.uv_layers['atlas']
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.01, correct_aspect=False); bpy.ops.object.mode_set(mode='OBJECT')
    cell, qx, qy, div = RECT[name]; u0, v0, su, sv = (cell % COLS + qx / div) / COLS, (cell // COLS + qy / div) / ROWS, 1 / (COLS * div), 1 / (ROWS * div)
    for l in me.uv_layers['atlas'].data: l.uv = (u0 + (0.015 + l.uv[0] * 0.97) * su, v0 + (0.015 + l.uv[1] * 0.97) * sv)
    nodes = [albedo_only(m) for m in me.materials]
    lo, hi = bbox([o]); scene.world.light_settings.distance = max(0.4, 0.12 * max(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z))
    for key, btype, samples in (('col', 'EMIT', 1), ('ao', 'AO', 24)):
        for n in nodes: n.image = IMG[key]
        scene.cycles.samples = samples
        bpy.ops.object.bake(type=btype, margin=4, use_clear=False)
    for nm in [l.name for l in me.uv_layers if l.name != 'atlas']: me.uv_layers.remove(me.uv_layers[nm])
    while len(me.color_attributes): me.color_attributes.remove(me.color_attributes[0])
    me.materials.clear(); o.hide_render = True                  # so it does not shade the next prop's ambient occlusion
    bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)

# ------------------------------------------------------------------------------------------------------------- main
srcs = sources()
if LIST:
    if not srcs: print('LIST nothing in', SRC)
    for key, p in srcs:
        d = unpack(p); f = model_file(d); print('LIST %s  (matches as "%s")' % (os.path.basename(p), key), flush=True)
        if not f: print('LIST   no model file inside'); continue
        try: meshes = import_model(f)
        except Exception as e: print('LIST   could not import:', e); continue
        for n, g in enumerate(clusters(meshes)):
            a, c = bbox(g); print('LIST   piece %d: %d objects, %d triangles, %.2f x %.2f x %.2f' % (n, len(g), sum(tri_count(o.data) for o in g), c.x - a.x, c.y - a.y, c.z - a.z))
        for o in meshes: bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.orphans_purge(do_recursive=True)
        print('LIST   credit:', credit(d))
    sys.exit(0)

IMG = {'col': new_img('col', (0.5, 0.5, 0.5, 1)), 'ao': new_img('ao', (1, 1, 1, 1), True)}
meta = {}; objs = []; used = set(); credits = {}
for slot in SLOTS:
    if ONLY and not re.search(ONLY, slot['name']): continue
    made = None; info = dict(src='standin')       # made: [(pose or '', object)], already baked when it came off a rig
    for u in slot['use']:
        whole = u.get('pick') is None and not u.get('only')
        hit = next((p for key, p in srcs if u['k'] in key and (not whole or p not in used)), None)
        if not hit: continue
        try:
            d = unpack(hit); fit = u.get('fit') or slot['fit']; sized = dict(slot, sink=u.get('sink', slot.get('sink', 0)))
            rig = rigged(slot, d, IMG) if slot.get('anim') and whole else None
            if rig:
                o, clips, stride = rig; sc = fit_to_size(o, sized, fit); made = [('', o)]
                info = dict(src='model', file=os.path.basename(hit), rigged=True, clips=clips, stride=round(float(stride * sc), 3))
            else:
                o = from_download(slot, d, u.get('pick'), u.get('only')); fit_to_size(o, sized, fit); decimate(o, slot['tris'])
                made = [('', o)]; info = dict(src='model', file=os.path.basename(hit))
            if whole: used.add(hit)
            c = credit(d)
            if c: info['credit'] = c; credits[hit] = c
            else: credits[hit] = dict(title=os.path.basename(hit), author='unknown', license='check the source page')
        except Exception as e:
            print('WARN %s: could not use %s (%s) — falling back' % (slot['name'], os.path.basename(hit), e), flush=True); made = None; continue
        break
    if made is None:
        if not slot['standin']: continue
        o = slot['standin']().obj('p')
        if slot.get('sink'): o.data.transform(Matrix.Translation((0, 0, -slot['sink'])))
        made = [('', o)]
    for n, (pose, o) in enumerate(made):
        name = slot['name'] + ('_' + pose if n and pose else ''); o.name = o.data.name = 'p_' + name
        if not info.get('rigged'): bake(o, slot['name'], IMG)
        co = np.empty(len(o.data.vertices) * 3, dtype=np.float32); o.data.vertices.foreach_get('co', co); co = co.reshape(-1, 3); lo, hi = co.min(0), co.max(0)
        m = dict(info, w=round(float(hi[0] - lo[0]), 2), d=round(float(hi[1] - lo[1]), 2), h=round(float(hi[2]), 2), tris=tri_count(o.data), tint=bool(slot.get('tint')) and info['src'] == 'standin')
        if pose: m['pose'] = pose
        meta[name] = m; objs.append(o)
        print('BAKED %-14s %-8s %5d tris  %.1f x %.1f x %.1f m  %s' % (name, info['src'], m['tris'], m['w'], m['d'], m['h'], info.get('file', '')), flush=True)

def px(im): a = np.empty(AW * AH * 4, dtype=np.float32); im.pixels.foreach_get(a); return a.reshape(AH, AW, 4)
col, ao = px(IMG['col']), px(IMG['ao'])
col[..., :3] *= (0.62 + 0.38 * ao[..., :1]); IMG['col'].pixels.foreach_set(col.ravel())
IMG['col'].filepath_raw = os.path.join(OUT, 'props_albedo.jpg'); IMG['col'].file_format = 'JPEG'; scene.render.image_settings.quality = 90; IMG['col'].save()
bpy.ops.object.select_all(action='DESELECT')
for o in objs: o.hide_render = False; o.select_set(True)
bpy.context.view_layer.objects.active = objs[0]
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'props.glb'), export_format='GLB', use_selection=True, export_materials='NONE', export_yup=True, export_apply=False, export_morph=True, export_morph_normal=False)
json.dump(meta, open(os.path.join(OUT, 'props.json'), 'w'))
with open(os.path.join(OUT, 'props_credits.txt'), 'w') as f:
    f.write('Street props (props.glb). Models by other people, adapted (resized, simplified, re-textured into one atlas):\n\n')
    for c in credits.values(): f.write('"%s" by %s — %s\n  %s\n' % (c.get('title', '?'), c.get('author', '?'), c.get('license', '?'), c.get('source', '')))
    if not credits: f.write('(none yet)\n')
    built = [n for n, m in meta.items() if m['src'] == 'standin']
    if built: f.write('\nBuilt by tools/blender/props_kit.py, wood, stone and thatch from Poly Haven (CC0): ' + ', '.join(built) + '\n')
print('DONE props kit: %d from downloads, %d stand-ins' % (sum(m['src'] == 'model' for m in meta.values()), sum(m['src'] == 'standin' for m in meta.values())))
