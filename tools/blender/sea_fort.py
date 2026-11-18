# A round sea fort for King's Landing's harbour corners, after Dubrovnik's Bokar and St John forts in the reference stills.
#   Blender -b --factory-startup --python tools/blender/sea_fort.py -- <project dir>
# Uses kl_landmarks.py's mesh builder (box-projected UVs at the game's masonry scale, the shared material names, ambient
# occlusion baked into the vertex colours). z = 0 is sea level; the battered base runs down below it. +X east; the watch
# turret stands on the -X (landward) side, which the game turns toward the city. Writes public/models/seafort.glb.
import os, sys
_src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'kl_landmarks.py')).read()
_cut = _src.index('# ====================================================================== the Red Keep')
exec(_src[:_cut])           # M, finish, sh, scene setup (Cycles for the AO bake) — everything before the first landmark

STONE = (0.86, 0.79, 0.66)          # pale Dubrovnik limestone
DARK = (0.035, 0.03, 0.028)

def sea_fort():
    m = M(seed=41); c = (0.0, 0.0)
    # a massive battered (sloped) base standing in the sea, gun ports low in its flank
    m.drum((0, 0, -9.0), 31.0, 23.0, 'ashlar', sh(STONE, 0.9), seg=44, r2=25.6)
    for i in range(10):
        a = (i + 0.3) / 10 * TAU; r = 29.0
        m.box((math.cos(a) * r, math.sin(a) * r, 5.0), (1.6, 1.5, 1.3), 'plain', DARK, a, rx=0.0)
    # the rounded string course where the batter meets the upright drum
    m.drum((0, 0, 13.6), 26.3, 0.9, 'ashlar', sh(STONE, 1.1), seg=44)
    # the upright drum, two storeys of arrow slits, a second course
    m.drum((0, 0, 14.5), 25.4, 15.5, 'ashlar', STONE, seg=44, r2=25.0)
    m.drum((0, 0, 22.0), 25.45, 0.5, 'ashlar', sh(STONE, 1.07), seg=44)
    for l, z in enumerate((18.0, 25.5)):
        for i in range(12):
            a = (i + 0.5 * l) / 12 * TAU
            m.slit(c, 25.2, a, z, h=2.4, w=0.55, glow=False)
    # machicolated, crenellated crown and the gun platform inside it
    top = m.crown(c, 25.0, 30.0, STONE, flare=1.07)
    m.drum((0, 0, 29.4), 24.2, 0.7, 'ashlar', sh(STONE, 0.95), seg=44)
    # the landward watch turret, rising from the platform
    t = (-12.5, 3.0)
    m.drum((t[0], t[1], 29.4), 6.6, 11.0, 'ashlar', STONE, seg=22, r2=6.3)
    for i in range(4): m.slit(t, 6.4, i / 4 * TAU + 0.4, 35.0, h=2.0, w=0.45, glow=False)
    m.crown(t, 6.3, 40.4, STONE, flare=1.15)
    # a stair turret and a low building on the platform give the top a working look
    m.box((6.0, -8.0, 30.1), (9.0, 6.0, 3.6), 'ashlar', sh(STONE, 0.93), 0.4)
    m.box((6.0, -8.0, 33.9), (9.6, 6.6, 0.4), 'plain', (0.42, 0.2, 0.13), 0.4)
    finish(m, 'seafort')

sea_fort()
