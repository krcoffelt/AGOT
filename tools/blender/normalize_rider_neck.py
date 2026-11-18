"""Sculpt a normal neck under the existing mandible; keep the face intact."""
import bpy
import bmesh
import math
import heapq
import json
import sys
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree

OUT=Path('/Users/kylecoffelt/Desktop/GameOfThrones/assets-src/riders')
DRAFT='--draft' in sys.argv
bpy.ops.wm.open_mainfile(filepath=str(OUT/'daemon_rider_neck_fixed.blend'),load_ui=False)
sc=bpy.context.scene
head=bpy.data.objects['Daemon | anatomical head and neck - sculpt surface']
mesh=head.data
def smooth(t):
    t=max(0,min(1,t))
    return t*t*(3-2*t)
def profile(z,items):
    if z<=items[0][0]:return items[0][1:]
    for a,b in zip(items,items[1:]):
        if z<=b[0]:
            t=(z-a[0])/(b[0]-a[0])
            return tuple(x*(1-t)+y*t for x,y in zip(a[1:],b[1:]))
    return items[-1][1:]

# Lower the head by 15 mm, shortening the exposed neck. The garment stays fixed.
shift=.015
for v in mesh.vertices:
    v.co.z-=shift*smooth((v.co.z-1.654)/.082)
collections=[c for c in bpy.data.collections if c.name in {
    'V2 | Anatomical head and eyes','V2 | Fitted swept-back silver grooming'}]
moved=set()
for collection in collections:
    for ob in collection.objects:
        if ob is not head and ob not in moved:
            ob.location.z-=shift
            moved.add(ob)

# The anatomical base has a real mandible face set. Anchor it instead of
# treating the entire wide jaw-to-collar wedge as facial tissue.
face_sets=mesh.attributes['.sculpt_face_set']
protected=set()
for p in mesh.polygons:
    if face_sets.data[p.index].value in {2,3,4,5,7,8,22}:
        protected.update(p.vertices)
for v in mesh.vertices:
    if v.co.z>=1.825 or (v.co.y<-.118 and v.co.z>1.722) or (v.co.z>1.790 and v.co.y<-.035):
        protected.add(v.index)
fixed={v.index:v.co.copy() for v in mesh.vertices if v.co.z>=1.835 or (v.co.y<=-.120 and v.co.z>1.755)}

bm=bmesh.new()
bm.from_mesh(mesh)
bm.verts.ensure_lookup_table()
eligible={v.index for v in bm.verts if v.index not in protected and v.co.z<1.825}
distance={}
queue=[]
for i in eligible:
    v=bm.verts[i]
    ds=[(v.co-e.other_vert(v).co).length for e in v.link_edges if e.other_vert(v).index in protected]
    if ds:
        distance[i]=min(ds)
        heapq.heappush(queue,(distance[i],i))
while queue:
    d,i=heapq.heappop(queue)
    if d!=distance[i]:continue
    v=bm.verts[i]
    for edge in v.link_edges:
        q=edge.other_vert(v)
        if q.index not in eligible:continue
        nd=d+(q.co-v.co).length
        if nd<distance.get(q.index,1e8):
            distance[q.index]=nd
            heapq.heappush(queue,(nd,q.index))

# A restrained neck cylinder sits behind the jaw. No broad lateral webbing.
neck_profile=[
    (1.648,.067,.061,.012),
    (1.677,.053,.052,.015),
    (1.700,.048,.049,.012),
    (1.730,.048,.051,.010),
    (1.760,.049,.055,.008),
    (1.790,.052,.060,.006),
    (1.825,.058,.067,.008),
]
weights={}
for i in eligible:
    v=bm.verts[i]
    x,y,z=v.co
    xr,yr,cy=profile(z,neck_profile)
    angle=math.atan2(x,-(y-cy))
    # Very shallow SCM forms run diagonally from behind the jaw to the sternum.
    t=max(0,min(1,(z-1.697)/.108))
    muscle=.0012*math.exp(-((abs(angle)-(.42+.95*t))/.18)**2)*math.sin(math.pi*t)
    apple=.0015*math.exp(-(angle/.18)**2-((z-1.730)/.009)**2)
    target=Vector(((xr+muscle)*math.sin(angle),cy-(yr+muscle+apple)*math.cos(angle),z))
    w=smooth((distance.get(i,1)-.0015)/.014)
    weights[i]=w
    v.co=v.co.lerp(target,w)

relax=[bm.verts[i] for i in eligible]
for _ in range(45):
    old={v.index:v.co.copy() for v in relax}
    bmesh.ops.smooth_vert(bm,verts=relax,factor=.6,use_axis_x=True,use_axis_y=True,use_axis_z=True)
    for v in relax:
        v.co=old[v.index].lerp(v.co,weights[v.index])
bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
bm.to_mesh(mesh)
bm.free()
mesh.update()
# Blend the broad planes beneath the ear into the throat. Restricting this
# relaxation to donor face-set borders would leave angular shelves there.
group=head.vertex_groups.new(name='Neck | soft anatomical transition')
buckets={}
for v in mesh.vertices:
    w=smooth((1.835-v.co.z)/.050)*smooth((v.co.y+.120)/.035)
    if w>0:
        buckets.setdefault(round(w,2),[]).append(v.index)
for w,indices in buckets.items():group.add(indices,w,'REPLACE')
bpy.context.view_layer.objects.active=head
head.select_set(True)
mod=head.modifiers.new('Smooth jaw-to-neck planes','SMOOTH')
mod.vertex_group=group.name
mod.factor=.9
mod.iterations=450
bpy.ops.object.modifier_apply(modifier=mod.name)
mesh=head.data
max_jaw_delta=max((mesh.vertices[i].co-p).length for i,p in fixed.items())
assert max_jaw_delta<.000001
for p in mesh.polygons:p.use_smooth=True
head['neck_revision']='Shortened neck, narrow cylinder set behind the preserved mandible, defined submental break and shallow SCM forms.'

# Refit the existing fabric collar to the new neck, preserving its cloth UVs.
neck_tree=BVHTree.FromPolygons([v.co for v in mesh.vertices],[tuple(p.vertices) for p in mesh.polygons])
collar=bpy.data.objects['Collar | reference burgundy stand collar']
n=129
row_count=len(collar.data.vertices)//n
for v in collar.data.vertices:
    row,j=divmod(v.index,n)
    a=.024+(2*math.pi-.048)*j/(n-1)
    wrapped=min(a,2*math.pi-a)
    top=1.702+.006*(1-math.cos(a))/2-.009*math.exp(-(wrapped/.23)**2)
    t=(v.co.z-1.652)/(top-1.652)
    z=v.co.z
    xr=.070*(1-t)+.054*t
    yr=.063*(1-t)+.054*t
    origin=Vector((0,.012,z))
    direction=Vector((math.sin(a),-math.cos(a),0))
    hit,normal,_,dist=neck_tree.ray_cast(origin,direction,.25)
    nominal=1/math.sqrt((math.sin(a)/xr)**2+(math.cos(a)/yr)**2)
    radius=max(nominal,dist+.004 if hit is not None else 0)
    v.co=origin+direction*radius
collar.data.update()
top=bpy.data.objects['Collar | fine charcoal top binding'].data.splines[0]
for j,p in enumerate(top.points):
    p.co=(*collar.data.vertices[(row_count-1)*n+j].co,1)
for j in range(2):
    spline=bpy.data.objects['Collar | front opening edge '+str(j)].data.splines[0]
    for i,p in enumerate(spline.points):
        co=collar.data.vertices[i*n+(0 if j==0 else n-1)].co.copy()
        co.y-=.0004
        p.co=(*co,1)

sc.render.engine='CYCLES'
sc.cycles.samples=24 if DRAFT else 64
sc.cycles.use_denoising=True
try:
    prefs=bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type='METAL'
    prefs.get_devices()
    for d in prefs.devices:d.use=d.type=='METAL'
    if any(d.type=='METAL' for d in prefs.devices):sc.cycles.device='GPU'
except Exception:pass
studio=bpy.data.collections['07 | Studio - cameras and lights']
specs=[
    ('Front',(0,-3.8,1.90),(0,-.012,1.795),.57,(1050,1200),'portrait'),
    ('Side',(3.8,-.18,1.88),(0,0,1.78),.57,(1050,1200),'side'),
    ('Three quarter',(2.6,-3.8,1.94),(0,0,1.79),.60,(1050,1200),'angle'),
    ('Full figure',(1.6,-8,2.25),(-.02,0,1),2.30,(1150,1500),'full'),
]
cameras=[]
for name,loc,target,scale,size,suffix in specs:
    data=bpy.data.cameras.new('NORMAL NECK | '+name)
    data.type='ORTHO';data.ortho_scale=scale
    cam=bpy.data.objects.new(data.name,data);studio.objects.link(cam)
    cam.location=loc
    cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler()
    cameras.append(cam)

assert not [i for i in bpy.data.images if i.source=='FILE' and not i.packed_file]
for cam,spec in zip(cameras,specs):
    if DRAFT and spec[5]=='full':continue
    sc.camera=cam
    sc.render.resolution_x,sc.render.resolution_y=spec[4]
    sc.render.resolution_percentage=65 if DRAFT else 100
    sc.render.filepath=str(OUT/('daemon_normal_neck_'+('draft_' if DRAFT else '')+spec[5]+'.png'))
    print('Rendering',spec[0],'neck sculpt verts',len(eligible),'jaw preservation delta',max_jaw_delta,flush=True)
    bpy.ops.render.render(write_still=True)

if not DRAFT:
    sc.camera=cameras[0]
    sc.render.resolution_x,sc.render.resolution_y=specs[0][4]
    sc.render.filepath=str(OUT/'daemon_normal_neck_portrait.png')
    notes=bpy.data.texts['START HERE | Rider study']
    notes.write('\nNORMAL NECK SCULPT\nRemoved the lateral jaw-to-collar web. The neck is narrower and set\nbehind the intact mandible, with a short vertical throat and restrained\nmuscle planes. Lowered the head and its groom 15 mm to shorten the neck.\nAnatomy form study: https://www.proko.com/course-lesson/how-to-draw-neck-muscles-form\n')
    bpy.data.objects['DAEMON | standing study']['revision']='Natural narrow neck sculpt under preserved jaw, shortened head-to-collar gap, refitted burgundy collar.'
    (OUT/'daemon_normal_neck_manifest.json').write_text(json.dumps({
        'modified_neck_vertices':len(eligible),
        'jaw_shape_delta_m':max_jaw_delta,
        'head_lowering_m':shift,
        'moved_head_parts':[o.name for o in moved],
        'packed_images':len([i for i in bpy.data.images if i.packed_file]),
        'review_images':['daemon_normal_neck_'+s[5]+'.png' for s in specs]
    },indent=2)+'\n')
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'daemon_rider_natural_neck.blend'),compress=True)
print('Neck sculpt completed.',flush=True)
