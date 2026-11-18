"""Author a layered, clumped strand groom against the rider reference.

The root hairline, primary lock silhouettes and nape layers are independent
controls. No solid hair mesh is used in the render.
"""
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
BUILD_ONLY='--build-only' in sys.argv
R=random.Random(121127)
bpy.ops.wm.open_mainfile(filepath=str(OUT/'daemon_rider_strand_hair.blend'),load_ui=False)
sc=bpy.context.scene
root=bpy.data.objects['DAEMON | standing study']
head=bpy.data.objects['Daemon | anatomical head and neck - sculpt surface']
hair=bpy.data.collections['V2 | Fitted swept-back silver grooming']
tree=BVHTree.FromObject(head,bpy.context.evaluated_depsgraph_get())
center=Vector((0,-.025,1.885))
PI=math.pi

def smooth(t):
    t=max(0,min(1,t));return t*t*(3-2*t)
def bez(a,b,c,d,t):return a*(1-t)**3+3*b*t*(1-t)**2+3*c*t*t*(1-t)+d*t**3
def direction(a,theta):return Vector((math.sin(theta)*math.sin(a),-math.sin(theta)*math.cos(a),math.cos(theta)))
def scalp(d,lift=0):
    d=Vector(d).normalized()
    p,n,_,_=tree.ray_cast(center+d*.32,-d,.42)
    if p is None:return center+d*.10,d
    return p+n*lift,n
def hairline(a):
    # The photographed central point, shallow recessions, and low temples.
    a=abs(a)
    keys=[(0,1.175),(.12,1.13),(.42,1.06),(.72,1.095),(1.02,1.285),(1.28,1.51),(1.61,1.67)]
    for (a0,t0),(a1,t1) in zip(keys,keys[1:]):
        if a<=a1:return t0+(t1-t0)*smooth((a-a0)/(a1-a0))
    return keys[-1][1]

for ob in list(hair.objects):
    if ob.type=='CURVES' and ob.name.startswith('Hair |'):bpy.data.objects.remove(ob,do_unlink=True)
underlay=bpy.data.objects.get('Hair | anatomical root surface and irregular hairline')
if underlay:underlay.hide_render=True;underlay.hide_set(True)

def material(name,color,roughness):
    m=bpy.data.materials.new(name);m.use_nodes=True;m.diffuse_color=(*color,1)
    ns,ls=m.node_tree.nodes,m.node_tree.links;ns.clear()
    out=ns.new('ShaderNodeOutputMaterial');out.location=(680,100)
    bs=ns.new('ShaderNodeBsdfHairPrincipled');bs.model='HUANG';bs.parametrization='COLOR';bs.location=(400,100)
    bs.inputs['Color'].default_value=(*color,1)
    bs.inputs['Aspect Ratio'].default_value=.92
    bs.inputs['Roughness'].default_value=roughness
    bs.inputs['Reflection'].default_value=.65
    info=ns.new('ShaderNodeHairInfo');info.location=(-650,100)
    tint=ns.new('ShaderNodeValToRGB');tint.location=(-400,150)
    tint.color_ramp.elements[0].color=(*[c*.83 for c in color],1)
    tint.color_ramp.elements[1].color=(*[min(.98,c*1.10) for c in color],1)
    ls.new(info.outputs['Random'],tint.inputs[0]);ls.new(tint.outputs[0],bs.inputs['Color'])
    rough=ns.new('ShaderNodeMapRange');rough.location=(-150,-100)
    rough.inputs['To Min'].default_value=roughness-.035;rough.inputs['To Max'].default_value=roughness+.055
    ls.new(info.outputs['Random'],rough.inputs[0]);ls.new(rough.outputs[0],bs.inputs['Roughness'])
    ls.new(bs.outputs[0],out.inputs['Surface'])
    return m
materials=[material('V7 | natural pale platinum strands',(.71,.665,.55),.29),
           material('V7 | ivory highlight strands',(.88,.82,.68),.26),
           material('V7 | warm silver inner layers',(.43,.395,.32),.34)]
groups=[[],[],[]];radii=[[],[],[]]

def add(path,radius,bucket=None):
    if bucket is None:
        x=R.random();bucket=1 if x<.26 else 2 if x>.95 else 0
    groups[bucket].append(path);radii[bucket].append(radius)

def guide(a,theta,lift,tail_z,seed):
    d0=direction(a,theta)
    front=max(0,math.cos(a))
    # Root direction is back and up; the temple locks travel horizontally
    # behind the ear instead of wrapping down around the face.
    d1=(d0+Vector((.055*math.sin(a),.72,.22+.43*front))).normalized()
    d2=Vector((d0.x*.78,.61,.27+.63*front)).normalized()
    d3=Vector((d0.x*.64,.99,.03+.09*front)).normalized()
    points=[];normals=[]
    for t in np.linspace(0,1,48):
        d=bez(d0,d1,d2,d3,float(t)).normalized()
        h=.00025+lift*math.sin(PI*t)**.72*(.8+.2*math.cos(PI*t))
        p,n=scalp(d,h);points.append(p);normals.append(n)
    p=points[-1];tangent=(p-points[-3]).normalized()
    end=Vector((p.x*.83+.003*math.sin(seed),max(.093,p.y)+.004,tail_z))
    c1=p+tangent*.024;c2=end+Vector((.004*math.sin(seed),.009,.032))
    for t in np.linspace(0,1,25)[1:]:
        q=bez(p,c1,c2,end,float(t))
        skin,n,_,_=tree.ray_cast(Vector((q.x,.38,q.z)),Vector((0,-1,0)),.65)
        if skin is not None:q.y=max(q.y,skin.y+.0025)
        points.append(q);normals.append(Vector((0,1,0)))
    return points,normals

def bundle(a,theta,width,height,count,tail_z,seed,under=False):
    guide_points,normals=guide(a,theta,height,tail_z,seed)
    length=len(guide_points)
    bins=[]
    for k,p in enumerate(guide_points):
        tangent=guide_points[min(length-1,k+1)]-guide_points[max(0,k-1)]
        bins.append(tangent.normalized().cross(normals[k]).normalized())
    # Each primary lock contains several smaller coherent groups, each with
    # its own tip. This leaves real shadow channels through the silver fibres.
    for f in range(count):
        micro=R.randrange(5)
        u=(micro-2)*.39+R.uniform(-.21,.21)
        side=u*width*.5
        depth=R.uniform(-.0003,.0016)
        start=R.uniform(0,.013) if not under else (R.uniform(0,.035) if R.random()<.58 else R.uniform(.035,.48))
        end=R.uniform(.86,1.0)
        if under:end=R.uniform(.64,1)
        phase=R.uniform(0,2*PI)
        random_tilt=R.uniform(-.0015,.0015)
        path=[]
        for k,t in enumerate(np.linspace(0,1,64)):
            st=start+(end-start)*t;s=st*(length-1);i=min(length-2,int(s));v=s-i
            p=guide_points[i].lerp(guide_points[i+1],v)
            n=normals[i].lerp(normals[i+1],v).normalized()
            b=bins[i].lerp(bins[i+1],v).normalized()
            gather=1-(.18 if under else .36)*smooth(st/.24)+.10*smooth((st-.78)/.22)
            micro_gather=.00035*math.sin((micro-2)*1.1+seed)*math.sin(PI*st)
            lateral=side*gather+micro_gather+random_tilt*st*st
            # Fine waves are aligned with each lock; they do not fluff the cap.
            lateral+=.000075*math.sin(9*PI*st+phase)*smooth(st/.12)
            p+=b*lateral+n*(depth*smooth(st/.08)+.000055*math.sin(13*PI*st+phase))
            if k==0:
                nearest,normal,_,_=tree.find_nearest(p)
                if nearest is not None:p=nearest+normal*.00008
            path.append(p)
        add(path,R.uniform(.000030,.000041) if not under else R.uniform(.000030,.000039),2 if under and R.random()<.025 else None)

# A dense, close-fitting inner groom makes the pale roots continuous without
# drawing an opaque scalp shell. Its strands originate across the scalp.
for j in range(180):
    a=-1.61+3.22*(j+.5)/180
    bundle(a,hairline(a)+R.uniform(-.006,.006),.0034,.0018,260,R.uniform(1.765,1.82),j*.63,under=True)
print('Inner groom built',sum(map(len,groups)),flush=True)

# Seventeen broad locks correspond to the fan-shaped front of the photo.
# Adjacent locks vary in height, width, and sweep; their channels are geometric.
angles=[-1.56,-1.36,-1.16,-.97,-.79,-.59,-.39,-.18,.015,.19,.40,.61,.81,1.00,1.19,1.39,1.57]
for j,a in enumerate(angles):
    front=max(0,math.cos(a))
    width=.0185 if abs(a)<.8 else .0165
    height=(.0030+.0018*front)*R.uniform(.94,1.06)
    bundle(a,hairline(a)+R.uniform(-.006,.006),width,height,1650 if abs(a)<1 else 1250,R.uniform(1.772,1.821),j*.83)
print('Primary swept locks built',sum(map(len,groups)),flush=True)

# Rear layers have distinct S-curves and unequal lengths. They fall beside
# the neck in locks instead of sharing one planar curtain surface.
for j in range(84):
    a=R.uniform(1.59,4.69);theta=R.uniform(.32,1.88)
    p,n=scalp(direction(a,theta),.00025)
    sign=1 if p.x>=0 else -1
    # Shorter inner nape and longer perimeter locks visible beside the ears.
    side=abs(p.x)>.046
    end_z=R.uniform(1.706,1.757) if side else R.uniform(1.738,1.795)
    end_x=sign*(abs(p.x)*.94+R.uniform(.003,.012))
    end=Vector((end_x,max(.073,p.y*.75)+R.uniform(.004,.022),end_z))
    c1=p+Vector((sign*.003,.012,-.029))
    c2=end+Vector((-sign*.006,.013,.040))
    guide_points=[bez(p,c1,c2,end,float(t)) for t in np.linspace(0,1,64)]
    width=R.uniform(.003,.0055)
    for f in range(300):
        u=R.uniform(-1,1);v=R.uniform(-.001,.0018);phase=R.uniform(0,2*PI)
        tip=R.uniform(-.009,.009);path=[]
        for k,(p0,t) in enumerate(zip(guide_points,np.linspace(0,1,64))):
            gather=1-.64*smooth(t)
            q=p0+Vector((u*width*gather+.00012*math.sin(8*PI*t+phase),v+.0012*math.sin(2*PI*t+j),tip*t*t))
            skin,n,_,_=tree.ray_cast(Vector((q.x,.38,q.z)),Vector((0,-1,0)),.65)
            if skin is not None:q.y=max(q.y,skin.y+.0016+v)
            path.append(q)
        add(path,R.uniform(.000030,.000041))

# Temple feathering at the front of each ear, with small independent roots.
for side in [-1,1]:
    for j in range(550):
        a=side*R.uniform(1.24,1.62);th=hairline(a)+R.uniform(-.018,.015)
        d0=direction(a,th);d1=(d0+Vector((0,.35,.08))).normalized()
        path=[]
        for t in np.linspace(0,1,64):
            d=d0.lerp(d1,float(t)).normalized();p,n=scalp(d,.00008+.00065*math.sin(PI*t))
            path.append(p)
        add(path,R.uniform(.000017,.000028))

# Sparse fine stray fibres and irregular root transitions are intentionally
# much thinner than the groom, so the silhouette stays slicked back.
fly=[];flyr=[]
for j in range(230):
    a=R.uniform(-1.57,1.57);th=hairline(a)+R.uniform(-.014,.012)
    points,normals=guide(a,th,R.uniform(.006,.011),1.81,j)
    stop=R.randint(12,39)
    path=[]
    for k,t in enumerate(np.linspace(0,1,64)):
        s=t*stop;i=min(len(points)-2,int(s));f=s-i
        p=points[i].lerp(points[i+1],f)+normals[i]*(.0005*math.sin(PI*t))
        path.append(p)
    fly.append(path);flyr.append(R.uniform(.000010,.000016))

def native(name,paths,rr,mat):
    cu=bpy.data.hair_curves.new(name);cu.add_curves([64]*len(paths))
    cu.surface=head;cu.surface_uv_map='UVMap';cu.use_sculpt_collision=True
    positions=np.asarray(paths,dtype=np.float32)
    assert np.isfinite(positions).all()
    cu.attributes['position'].data.foreach_set('vector',positions.ravel())
    rad=cu.attributes.get('radius') or cu.attributes.new('radius','FLOAT','POINT')
    t=np.linspace(0,1,64)
    profile=(.025+.975*(1-t)**.57)*np.minimum(1,.62+t*24)
    rad.data.foreach_set('value',np.asarray(np.asarray(rr)[:,None]*profile,dtype=np.float32).ravel())
    ob=bpy.data.objects.new(name,cu);hair.objects.link(ob);ob.parent=root;cu.materials.append(mat)
    return ob
for label,p,rr,mat in zip(['layered platinum swept locks','fine ivory glints','silver inner strand layers'],groups,radii,materials):
    native('Hair | V7 '+label,p,rr,mat)
native('Hair | V7 sparse fine flyaway fibres',fly,flyr,materials[0])

sc.render.engine='CYCLES';sc.cycles_curves.shape='THICK';sc.cycles_curves.subdivisions=3
sc.cycles.samples=160 if DRAFT else 768;sc.cycles.adaptive_threshold=.008 if DRAFT else .004
sc.cycles.use_denoising=False
try:
    prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='METAL';prefs.get_devices()
    for d in prefs.devices:d.use=d.type=='METAL'
    if any(d.type=='METAL' for d in prefs.devices):sc.cycles.device='GPU'
except Exception:pass
print('Built',sum(map(len,groups))+len(fly),'strands',flush=True)
root['hair_revision']='V7: 17 asymmetrical swept locks, dense rooted inner strands, central hairline point, tight feathered temples, independent shorter nape locks.'
bpy.data.texts['START HERE | Rider study'].write('\nV7 SWEPT LOCK GROOM\nDense individual hair curves form seventeen primary swept locks over a\nclose-fitting strand underlayer. The front hairline has a shallow central\npoint and irregular fine roots. Separate unequal nape locks replace the\nflat rear hair surface. Native curves remain editable for grooming.\n')
for ob in bpy.context.selected_objects:ob.select_set(False)
active=bpy.data.objects.get('Hair | V7 layered platinum swept locks');active.select_set(True);bpy.context.view_layer.objects.active=active
sc.camera=bpy.data.objects['STRAND REVIEW | Three quarter']
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_location=(0,0,1.855)
            area.spaces.active.region_3d.view_distance=.72
path=OUT/('daemon_rider_swept_hair_draft.blend' if DRAFT else 'daemon_rider_swept_hair.blend')
bpy.ops.wm.save_as_mainfile(filepath=str(path),compress=True)
if not BUILD_ONLY:
    for suffix,camera in [('portrait','Front'),('angle','Three quarter'),('side','Side'),('full','Full figure')]:
        if DRAFT and suffix not in {'portrait','side'}:continue
        sc.camera=bpy.data.objects['STRAND REVIEW | '+camera]
        sc.render.resolution_x,sc.render.resolution_y=(1100,1500) if suffix=='full' else (1600,1800)
        sc.render.resolution_percentage=55 if DRAFT else 100
        sc.render.filepath=str(OUT/('daemon_swept_hair_'+('draft_' if DRAFT else '')+suffix+'.png'))
        print('Rendering',suffix,flush=True);bpy.ops.render.render(write_still=True)
(OUT/'daemon_swept_hair_manifest.json').write_text(json.dumps({'strand_count':sum(map(len,groups))+len(fly),'primary_front_locks':len(angles),'hair_mesh_rendered':False,'strand_radius_m':[.000010,.000041],'denoising':False,'body_changed':False},indent=2)+'\n')
print('Saved',path,flush=True)
