# Converts the user's rigged Drogon (assets-src/drogon_user/Drogon/Dragon.blend: 39k-triangle skinned mesh, 291-bone rig,
# 52 animation clips, two 2K diffuse maps) into a game-ready GLB with only the clips the game uses, plus normal maps
# derived from the painted textures.
#   Blender -b --disable-autoexec assets-src/drogon_user/Drogon/Dragon.blend --python tools/blender/drogon_user.py -- "$PWD"
import bpy, sys, os, math
import numpy as np
proj = sys.argv[sys.argv.index('--') + 1]; OUT = os.path.join(proj, 'public', 'models')
arm = bpy.data.objects['SKM_DaenerysDragon']; mesh = bpy.data.objects['SKM_DaenerysDragon.001']
KEEP = {'AA_DaenerysDragon_Battle_Stand': 'Stand', 'DaenerysDragon_Battle_Up': 'Up', 'DaenerysDragon_Battle_Down': 'Down', 'DaenerysDragon_Neutural_Roar': 'Roar', 'DaenerysDragon_Battle_Walk': 'Walk', 'DaenerysDragon_Spawn': 'Spawn'}
kept = []
for act in list(bpy.data.actions):
    short = act.name.split('|')[-1]
    if short in KEEP: act.name = KEEP[short]; kept.append(act)
    else: bpy.data.actions.remove(act)
ad = arm.animation_data or arm.animation_data_create()
def setact(act):
    ad.action = act
    if hasattr(ad, 'action_slot') and len(act.slots): ad.action_slot = act.slots[0]
# which head bones move in the roar (to find the jaw)
roar = next(a for a in kept if a.name == 'Roar'); setact(roar); sc = bpy.context.scene; best = {}
for fr in range(1, int(roar.frame_range[1]), 6):
    sc.frame_set(fr); bpy.context.view_layer.update()
    for pb in arm.pose.bones:
        p = pb.parent
        if p and (p.name == 'Bip002-Head' or (p.parent and p.parent.name == 'Bip002-Head')):
            best[pb.name] = max(best.get(pb.name, 0), math.degrees(pb.matrix_basis.to_quaternion().angle))
print('JAWPROBE', sorted(((round(v, 1), k) for k, v in best.items()), reverse=True)[:10], flush=True)
# normal maps from the painted diffuse: luminance as height
for im in bpy.data.images:
    if not im.name.startswith('T_DaenerysDragon'): continue
    w, h = im.size; a = np.empty(w * h * 4, dtype=np.float32); im.pixels.foreach_get(a); a = a.reshape(h, w, 4); lum = a[..., 0] * 0.3 + a[..., 1] * 0.59 + a[..., 2] * 0.11
    for _ in range(2): lum = (lum + np.roll(lum, 1, 0) + np.roll(lum, -1, 0) + np.roll(lum, 1, 1) + np.roll(lum, -1, 1)) / 5
    dx = (np.roll(lum, -1, 1) - np.roll(lum, 1, 1)) * 9.0; dy = (np.roll(lum, -1, 0) - np.roll(lum, 1, 0)) * 9.0; nz = np.ones_like(lum); ln = np.sqrt(dx * dx + dy * dy + 1)
    n = np.ones((h, w, 4), dtype=np.float32); n[..., 0] = -dx / ln * 0.5 + 0.5; n[..., 1] = -dy / ln * 0.5 + 0.5; n[..., 2] = nz / ln * 0.5 + 0.5
    o = bpy.data.images.new('n', w, h, alpha=False); o.colorspace_settings.name = 'Non-Color'; o.pixels.foreach_set(n.ravel())
    part = 'head' if 'Head' in im.name else 'body'; o.filepath_raw = os.path.join(OUT, f'drogon_rig_{part}_n.jpg'); o.file_format = 'JPEG'; o.save(); print('NORMAL', part, w, h, 'mean lum', round(float(lum.mean()), 3), flush=True)
# every kept clip on its own NLA track so the exporter writes each as a separate animation
ad.action = None
for act in kept:
    tr = ad.nla_tracks.new(); tr.name = act.name; st = tr.strips.new(act.name, int(act.frame_range[0]), act)
    try:
        if hasattr(st, 'action_slot') and len(act.slots): st.action_slot = act.slots[0]
    except Exception as e: print('slot', e)
bpy.ops.object.select_all(action='DESELECT'); arm.select_set(True); mesh.select_set(True); bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'drogon_rig.glb'), export_format='GLB', use_selection=True, export_materials='EXPORT', export_image_format='JPEG', export_jpeg_quality=88,
                          export_yup=True, export_skins=True, export_animations=True, export_animation_mode='NLA_TRACKS', export_force_sampling=True, export_optimize_animation_size=True)
print('EXPORTED drogon_rig', [a.name for a in kept])
