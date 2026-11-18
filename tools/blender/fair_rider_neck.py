"""Blend the under-ear neck planes on a sparse cage without losing face detail."""
import bpy
import numpy as np
import sys
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform

OUT=Path('/Users/kylecoffelt/Desktop/GameOfThrones/assets-src/riders')
FINAL='--final' in sys.argv
bpy.ops.wm.open_mainfile(filepath=str(OUT/'daemon_rider_reference.blend'),load_ui=False)
sc=bpy.context.scene
head=bpy.data.objects['Daemon | anatomical head and neck - sculpt surface']
def sstep(t):
    t=max(0,min(1,t))
    return t*t*(3-2*t)
# Remove the remaining mastoid-to-neck block with a broad spatial falloff,
# without using the donor's rectangular face-set boundary as a sculpt mask.
for v in head.data.vertices:
    x,y,z=v.co
    w=np.exp(-((z-1.805)/.033)**2)*sstep((y+.047)/.047)
    if w<.001:continue
    xr=.048+.018*sstep((z-1.790)/.075)
    yr=.058+.012*sstep((z-1.790)/.075)
    cy=.009
    radius=np.sqrt((x/xr)**2+((y-cy)/yr)**2)
    if radius>1:
        scale=1/radius
        target=Vector((x*scale,cy+(y-cy)*scale,z))
        v.co=v.co.lerp(target,float(w))
head.data.update()
cage=head.copy();cage.data=head.data.copy();cage.name='TEMP | neck fairing cage'
sc.collection.objects.link(cage)
bpy.context.view_layer.objects.active=cage
for ob in bpy.context.selected_objects:ob.select_set(False)
cage.select_set(True)
mod=cage.modifiers.new('Sparse neck control surface','DECIMATE');mod.ratio=.045;mod.use_collapse_triangulate=True
bpy.ops.object.modifier_apply(modifier=mod.name)
mesh=cage.data
original=np.asarray([v.co[:] for v in mesh.vertices],dtype=np.float64)
positions=original.copy()
edges=np.asarray([e.vertices[:] for e in mesh.edges],dtype=np.int32)
degree=np.bincount(edges.ravel(),minlength=len(positions)).astype(float)
def smooth(t):
    t=np.clip(t,0,1)
    return t*t*(3-2*t)
x,y,z=original.T
weights=smooth((1.852-z)/.060)*smooth((y+.122)/.050)
ear_protect=1-.85*smooth((np.abs(x)-.074)/.021)*smooth((z-1.795)/.030)
weights*=ear_protect
for _ in range(90):
    for factor in [.50,-.53]:
        total=np.zeros_like(positions)
        np.add.at(total,edges[:,0],positions[edges[:,1]])
        np.add.at(total,edges[:,1],positions[edges[:,0]])
        laplacian=total/np.maximum(1,degree)[:,None]-positions
        positions+=factor*weights[:,None]*laplacian
displacement=positions-original
triangles=[tuple(p.vertices) for p in mesh.polygons]
assert all(len(p)==3 for p in triangles)
tree=BVHTree.FromPolygons([Vector(p) for p in original],triangles,all_triangles=True)
changed=0;maximum=0
for v in head.data.vertices:
    if v.co.z>=1.852 or v.co.y<=-.122:continue
    point,normal,index,distance=tree.find_nearest(v.co)
    if point is None:continue
    a,b,c=triangles[index]
    delta=barycentric_transform(point,Vector(original[a]),Vector(original[b]),Vector(original[c]),Vector(displacement[a]),Vector(displacement[b]),Vector(displacement[c]))
    v.co+=delta
    maximum=max(maximum,delta.length)
    changed+=1
head.data.update()
bpy.data.objects.remove(cage,do_unlink=True)
bpy.data.meshes.remove(mesh)
print('Faired neck verts',changed,'maximum displacement',maximum,flush=True)
sc.render.engine='CYCLES';sc.cycles.samples=80 if FINAL else 24;sc.cycles.use_denoising=True
try:
    prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='METAL';prefs.get_devices()
    for d in prefs.devices:d.use=d.type=='METAL'
    if any(d.type=='METAL' for d in prefs.devices):sc.cycles.device='GPU'
except Exception:pass
specs=[
    ('REFERENCE | Reference side','side',(1050,1200)),
    ('REFERENCE | Reference three quarter','angle',(1050,1200)),
    ('REFERENCE | Reference portrait','portrait',(1050,1200)),
    ('REFERENCE | Reference full figure','full',(1100,1500)),
]
for name,suffix,size in specs:
    if not FINAL and suffix not in {'side','angle'}:continue
    sc.camera=bpy.data.objects[name]
    sc.render.resolution_x,sc.render.resolution_y=size
    sc.render.resolution_percentage=100 if FINAL else 65
    sc.render.filepath=str(OUT/('daemon_reference_'+suffix+'.png' if FINAL else 'daemon_faired_neck_'+suffix+'.png'))
    bpy.ops.render.render(write_still=True)
if FINAL:
    sc.camera=bpy.data.objects['REFERENCE | Reference full figure']
    sc.render.resolution_x,sc.render.resolution_y=(1100,1500)
    sc.render.filepath=str(OUT/'daemon_reference_full.png')
    head['neck_surface_revision']='Volume-preserving fairing below the ears and behind the jaw; original facial surface detail retained.'
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'daemon_rider_reference.blend'),compress=True)
print('Completed neck surface fairing.',flush=True)
