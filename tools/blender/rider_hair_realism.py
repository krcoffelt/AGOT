"""Break the uniform swept groom into independent fine strands and loose locks."""
import bpy
import math
import random
import sys
import json
import numpy as np
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree

OUT=Path('/Users/kylecoffelt/Desktop/GameOfThrones/assets-src/riders')
DRAFT='--draft' in sys.argv
QUALITY='--quality-test' in sys.argv
R=random.Random(121126)
DENSITY=float(sys.argv[sys.argv.index('--density')+1]) if '--density' in sys.argv else .95
bpy.ops.wm.open_mainfile(filepath=str(OUT/'daemon_rider_detail.blend'),load_ui=False)
sc=bpy.context.scene
root=bpy.data.objects['DAEMON | standing study']
head=bpy.data.objects['Daemon | anatomical head and neck - sculpt surface']
hair=bpy.data.collections['V2 | Fitted swept-back silver grooming']
tree=BVHTree.FromObject(head,bpy.context.evaluated_depsgraph_get())
center=Vector((0,-.025,1.885))
def smooth(t):
    t=max(0,min(1,t));return t*t*(3-2*t)
def noise_curve(values,t):
    s=t*(len(values)-1);i=min(len(values)-2,int(s));u=s-i
    a,b,c,d=[values[max(0,min(len(values)-1,j))] for j in [i-1,i,i+1,i+2]]
    return .5*(2*b+(-a+c)*u+(2*a-5*b+4*c-d)*u*u+(-a+3*b-3*c+d)*u*u*u)

# There is no opaque scalp shell in this groom. The scalp can be seen between
# irregular roots and partings; the coverage comes entirely from hair curves.
underlay=bpy.data.objects.get('Hair | anatomical root surface and irregular hairline')
if underlay:
    underlay.hide_render=True
    underlay.hide_set(True)
    underlay['purpose']='Construction reference only; hidden in the strand-hair review.'

def material(name,color,reflection=.50):
    m=bpy.data.materials.new(name);m.use_nodes=True;m.diffuse_color=(*color,1)
    n,l=m.node_tree.nodes,m.node_tree.links;n.clear()
    out=n.new('ShaderNodeOutputMaterial');bs=n.new('ShaderNodeBsdfHairPrincipled')
    bs.model='HUANG';bs.parametrization='COLOR'
    bs.inputs['Aspect Ratio'].default_value=.83
    bs.inputs['Reflection'].default_value=reflection
    info=n.new('ShaderNodeHairInfo')
    tint=n.new('ShaderNodeValToRGB')
    tint.color_ramp.elements[0].color=(*[c*.60 for c in color],1)
    tint.color_ramp.elements[1].color=(*[min(1,c*1.15) for c in color],1)
    l.new(info.outputs['Random'],tint.inputs[0])
    roots=n.new('ShaderNodeValToRGB')
    roots.color_ramp.elements[0].color=(.85,.85,.85,1)
    roots.color_ramp.elements[1].color=(1,1,1,1);roots.color_ramp.elements[1].position=.08
    l.new(info.outputs['Intercept'],roots.inputs[0])
    mix=n.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1
    l.new(tint.outputs[0],mix.inputs[1]);l.new(roots.outputs[0],mix.inputs[2]);l.new(mix.outputs[0],bs.inputs['Color'])
    rough=n.new('ShaderNodeMapRange');rough.inputs['To Min'].default_value=.27;rough.inputs['To Max'].default_value=.43
    l.new(info.outputs['Random'],rough.inputs[0]);l.new(rough.outputs[0],bs.inputs['Roughness'])
    l.new(bs.outputs[0],out.inputs['Surface'])
    for i,node in enumerate(n):node.location=(i*240,0)
    return m
materials=[material('V6 | fine cool platinum',(.55,.54,.49)),material('V6 | pale ivory glints',(.75,.72,.65),.48),material('V6 | soft ash lowlights',(.23,.225,.20),.20)]

paths=[[],[],[]]
radii=[[],[],[]]
seeds=[]
baby_paths=[]
original_count=0
for ob in list(hair.objects):
    if ob.type!='CURVES' or not ob.name.startswith('Hair |'):continue
    cu=ob.data
    if not cu.curves:continue
    original_count+=len(cu.curves)
    points=np.empty(len(cu.points)*3,dtype=np.float32);cu.attributes['position'].data.foreach_get('vector',points)
    points=points.reshape((-1,3))
    mat_index=2 if 'shadow' in ob.name else 1 if 'ivory' in ob.name else 0
    for curve in cu.curves:
        length=curve.points_length;offset=curve.first_point_index
        old=points[offset:offset+length]
        if length<20:
            baby_paths.append([Vector(p) for p in old])
            continue
        p0=old[0]
        azimuth=math.atan2(p0[0],-(p0[1]+.025))
        front_locks=p0[2]>1.88 and p0[1]<.035
        phase=azimuth*39+.65*math.sin(azimuth*5.3)
        lock_white=smooth((math.cos(phase)+.75)/.50) if front_locks else 1
        spatial=.78+.42*(.5+.5*math.sin(p0[0]*287+p0[2]*179))
        keep=DENSITY*spatial*(1.10 if mat_index==2 else 1)
        if front_locks:keep*=.45+.55*lock_white
        elif p0[2]<1.91 and p0[1]>.02:keep*=.66
        if R.random()>keep:continue
        scalp_path=p0[2]>1.925 or p0[1]<-.03
        if scalp_path:
            branch=R.random()
            start=R.uniform(.04,.22) if branch<.32 else R.uniform(.22,.38) if branch<.40 else R.uniform(0,.020)
        else:start=R.uniform(0,.015)
        end=R.uniform(.84,1.0) if not scalp_path else R.uniform(.89,1.0)
        samples=np.linspace(start*(length-1),end*(length-1),64)
        lo=np.floor(samples).astype(int);hi=np.minimum(lo+1,length-1);frac=(samples-lo)[:,None]
        base=old[lo]*(1-frac)+old[hi]*frac
        nearest,normal,_,distance=tree.find_nearest(Vector(base[0]))
        if nearest is not None:
            delta=nearest+normal*.00025-Vector(base[0])
            for k in range(10):base[k]+=np.asarray(delta)*(1-smooth(k/9))
        sideways=[0]+[R.uniform(-1,1) for _ in range(5)]
        outward=[0]+[R.uniform(.10,1) for _ in range(5)]
        lateral_amp=R.uniform(.00045,.0012) if scalp_path else R.uniform(.0008,.0022)
        radial_amp=R.uniform(.0002,.0012)
        if R.random()<.055:radial_amp*=1.7
        phase=R.uniform(0,2*math.pi)
        waviness=R.uniform(.00010,.00028)
        lock_height=.0008+.0030*(.5+.5*math.sin(azimuth*11.7+.55*math.sin(azimuth*4.0)))
        lock_sweep=.0025*math.sin(azimuth*15.0+.6)
        path=[]
        for k,co in enumerate(base):
            t=k/63;p=Vector(co)
            tangent=(Vector(base[min(63,k+1)])-Vector(base[max(0,k-1)])).normalized()
            normal=(p-center).normalized() if p.z>1.86 else Vector((0,1,0))
            across=tangent.cross(normal).normalized()
            fade=smooth(t/.13)
            side=lateral_amp*noise_curve(sideways,t)+waviness*math.sin(6*math.pi*t+phase)
            lift=radial_amp*noise_curve(outward,t)+waviness*.50*math.sin(9*math.pi*t+phase)
            if front_locks:
                lock_envelope=smooth(t/.12)*(1-smooth((t-.45)/.35))
                lift+=lock_white*lock_height*lock_envelope
                side+=lock_white*lock_sweep*lock_envelope
            p+=across*(side*fade)+normal*(max(0,lift)*fade)
            path.append(p)
        bucket=mat_index
        if front_locks:
            choice=R.random()
            bucket=2 if choice>lock_white else 1 if R.random()<.28 else 0
        elif mat_index!=2:
            choice=R.random();bucket=2 if choice<.12 else 1 if choice<.33 else 0
        paths[bucket].append(path)
        radii[bucket].append(R.uniform(.000026,.000034))
        if R.random()<.025:seeds.append(path)
    bpy.data.objects.remove(ob,do_unlink=True)

def native(name,curves,root_radii,mat):
    data=bpy.data.hair_curves.new(name);data.add_curves([len(p) for p in curves])
    data.surface=head;data.surface_uv_map='UVMap';data.use_sculpt_collision=True
    coords=np.asarray(curves,dtype=np.float32)
    assert np.isfinite(coords).all()
    data.attributes['position'].data.foreach_set('vector',coords.ravel())
    rad=data.attributes.get('radius') or data.attributes.new('radius','FLOAT','POINT')
    t=np.linspace(0,1,coords.shape[1])
    root_profile=np.minimum(1,(.35+t*20) if max(root_radii)<.000016 else (.75+t*20))
    shape=(.025+.975*(1-t)**.72)*root_profile
    values=np.asarray(root_radii)[:,None]*shape[None,:]
    rad.data.foreach_set('value',np.asarray(values,dtype=np.float32).ravel())
    ob=bpy.data.objects.new(name,data);hair.objects.link(ob);ob.parent=root;data.materials.append(mat)
    return ob

for label,curves,rr,mat in zip(['separate platinum fibres','ivory strand glints','ash root and parting fibres'],paths,radii,materials):
    native('Hair | V6 '+label,curves,rr,mat)

# A few longer, very fine strays break the perfect silhouette. They are
# separate curves, not ridges on the main locks.
loose=[];loose_radii=[]
for path in seeds[:380]:
    stop=R.randint(18,49);coords=[]
    for k in range(32):
        s=k/31*(stop-1);i=int(s);f=s-i
        p=path[i].lerp(path[min(i+1,63)],f)
        n=(p-center).normalized() if p.z>1.86 else Vector((0,1,0))
        p+=n*R.uniform(.0015,.0038)*math.sin(math.pi*k/31)
        coords.append(p)
    loose.append(coords);loose_radii.append(R.uniform(.000009,.000014))
native('Hair | V6 fine silhouette flyaways',loose,loose_radii,materials[0])
if baby_paths:native('Hair | V6 soft hairline baby hairs',baby_paths,[R.uniform(.000010,.000014) for _ in baby_paths],materials[0])

# Match the camera-only background to the distant studio floor emission so a
# horizon line cannot cross the close hair views. Lighting is unchanged.
for node in sc.world.node_tree.nodes:
    if node.bl_idname=='ShaderNodeBackground' and sum(node.inputs['Color'].default_value[:3])>.35:
        node.inputs['Color'].default_value=(.065,.070,.070,1)

sc.render.engine='CYCLES'
sc.cycles_curves.shape='THICK'
sc.cycles_curves.subdivisions=3
sc.cycles.samples=512 if QUALITY else 128 if DRAFT else 768
sc.cycles.adaptive_threshold=.015 if DRAFT else .004
sc.cycles.use_denoising='--raw' not in sys.argv
sc.cycles.preview_samples=32
if hasattr(sc.cycles,'pixel_filter_type'):sc.cycles.pixel_filter_type='BLACKMAN_HARRIS'
if hasattr(sc.cycles,'filter_width'):sc.cycles.filter_width=1.0
try:
    prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='METAL';prefs.get_devices()
    for d in prefs.devices:d.use=d.type=='METAL'
    if any(d.type=='METAL' for d in prefs.devices):sc.cycles.device='GPU'
except Exception:pass
studio=bpy.data.collections['07 | Studio - cameras and lights']
specs=[
    ('Front',(.10,-3.8,1.92),(0,-.015,1.845),.43,(1600,1800),'portrait'),
    ('Side',(3.8,-.08,1.93),(0,0,1.845),.43,(1600,1800),'side'),
    ('Three quarter',(2.0,-3.8,1.98),(0,0,1.845),.44,(1600,1800),'angle'),
    ('Full figure',(.70,-8,2.16),(-.01,0,1),2.22,(1100,1500),'full'),
]
cameras=[]
for name,location,target,scale,size,suffix in specs:
    data=bpy.data.cameras.new('STRAND REVIEW | '+name);data.type='ORTHO';data.ortho_scale=scale
    camera=bpy.data.objects.new(data.name,data);studio.objects.link(camera);camera.location=location
    camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();cameras.append(camera)
count=sum(len(p) for p in paths)+len(loose)+len(baby_paths)
print('Strand rebuild:',original_count,'old hairs;',count,'independent hairs. No visible scalp shell. Circular 3D curves; denoising:',sc.cycles.use_denoising,flush=True)
for camera,spec in zip(cameras,specs):
    if QUALITY and spec[5]!='portrait':continue
    if DRAFT and spec[5] in {'angle','full'}:continue
    sc.camera=camera;sc.render.resolution_x,sc.render.resolution_y=spec[4];sc.render.resolution_percentage=55 if DRAFT else 100
    if QUALITY:sc.render.resolution_x,sc.render.resolution_y=(1400,1600);sc.render.resolution_percentage=100
    sc.render.filepath=str(OUT/('daemon_strand_hair_'+('draft_' if DRAFT else '')+spec[5]+'.png'))
    print('Rendering independent strands:',spec[0],flush=True);bpy.ops.render.render(write_still=True)
sc.camera=cameras[2];sc.render.resolution_x,sc.render.resolution_y=specs[2][4];sc.render.resolution_percentage=100
sc.render.filepath=str(OUT/'daemon_strand_hair_angle.png')
if not DRAFT:
    for ob in bpy.context.selected_objects:ob.select_set(False)
    active=bpy.data.objects.get('Hair | V6 separate platinum fibres')
    if active:active.select_set(True);bpy.context.view_layer.objects.active=active
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type=='VIEW_3D':
                area.spaces.active.region_3d.view_location=(0,0,1.855)
                area.spaces.active.region_3d.view_distance=.72
    bpy.data.texts['START HERE | Rider study'].write('\nSTRAND-HAIR REVIEW\nThe visible scalp shell is hidden. Hair coverage comes from independent\ncircular 3D hair curves, with redistributed roots, variable fine radii,\nasymmetric strand noise, loose ends and fine flyaways. High-sample Cycles\nreview cameras show the strand surfaces. Body, facial anatomy, clothes,\narmour and pose retain the prior detail pass.\n')
    root['hair_revision']='Independent fine circular strands, dispersed roots, broken lock surfaces, loose ends and flyaways; no visible opaque scalp shell.'
    assert not [i for i in bpy.data.images if i.source=='FILE' and not i.packed_file]
    (OUT/'daemon_strand_hair_manifest.json').write_text(json.dumps({'original_hairs':original_count,'new_hairs':count,'curve_shape':sc.cycles_curves.shape,'denoising':sc.cycles.use_denoising,'opaque_scalp_shell_rendered':not underlay.hide_render if underlay else False,'nominal_main_shaft_radius_range_m':[min(min(p) for p in radii),max(max(p) for p in radii)],'packed_images':sum(bool(i.packed_file) for i in bpy.data.images),'review_images':['daemon_strand_hair_'+s[5]+'.png' for s in specs]},indent=2)+'\n')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/('daemon_rider_strand_hair_draft.blend' if DRAFT else 'daemon_rider_strand_hair.blend')),compress=True)
print('Saved strand-hair review.',flush=True)
