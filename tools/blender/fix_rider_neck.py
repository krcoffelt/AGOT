"""Replace the oversized collar with a reference-fitted neck and short cloth collar."""
import bpy
import bmesh
import math
import json
import sys
from pathlib import Path
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

OUT = Path('/Users/kylecoffelt/Desktop/GameOfThrones/assets-src/riders')
DRAFT = '--draft' in sys.argv
bpy.ops.wm.open_mainfile(filepath=str(OUT / 'daemon_rider_refined.blend'), load_ui=False)
scene = bpy.context.scene
root = bpy.data.objects['DAEMON | standing study']
head = bpy.data.objects['Daemon | anatomical head and neck - sculpt surface']
before = [v.co.copy() for v in head.data.vertices if v.co.z > 1.778 or (v.co.z > 1.741 and v.co.y < -.122)]
skin = head.data.materials[0]
library=OUT/'reference-assets/human-base-meshes-bundle-v1.4.1/human_base_meshes_bundle.blend'
with bpy.data.libraries.load(str(library),link=False) as (source,target):
    target.objects=['GEO-body_male_realistic']
body=target.objects[0]
head.users_collection[0].objects.link(body)
for m in body.modifiers:
    if m.type=='MULTIRES':
        m.levels=m.render_levels=min(3,m.total_levels)
bpy.context.view_layer.update()
dg=bpy.context.evaluated_depsgraph_get()
mesh=bpy.data.meshes.new_from_object(body.evaluated_get(dg),depsgraph=dg)
transform=Matrix.Translation((0,0,1.744)) @ Matrix.Scale(1.10,4) @ Matrix.Translation((2.2643022537,0,-1.447))
mesh.transform(transform @ body.matrix_world)
bpy.data.objects.remove(body,do_unlink=True)

# Keep the uninterrupted source throat, sternomastoid and nape down into the garment.
bm=bmesh.new()
bm.from_mesh(mesh)
bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.00001,
                      plane_co=(0,0,1.650),plane_no=(0,0,1),clear_inner=True)
border=[e for e in bm.edges if e.is_boundary and all(abs(v.co.z-1.650)<.0001 for v in e.verts)]
bmesh.ops.holes_fill(bm,edges=border,sides=0)
bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
remaining=sum(e.is_boundary for e in bm.edges if min(v.co.z for v in e.verts)<1.737)
assert remaining==0
bm.to_mesh(mesh)
bm.free()
mesh.materials.clear()
mesh.materials.append(skin)
head.data=mesh
def gaussian(x,c,w):
    return math.exp(-((x-c)/w)**2)
offset=.0303767
for v in mesh.vertices:
    x,y,z=v.co
    front=max(0,min(1,(-y-.008)/.05))
    v.co.x*=1+.035*gaussian(z,1.742+offset,.026)
    v.co.y-=front*(.0035*gaussian(abs(x),.033,.022)*gaussian(z,1.866+offset,.012)
                  +.0013*gaussian(abs(x),.050,.020)*gaussian(z,1.815+offset,.016))
    v.co.z-=front*.0018*gaussian(abs(x),.017,.011)*gaussian(z,1.865+offset,.009)
    v.co.z-=front*.0027*gaussian(abs(x),.034,.019)*gaussian(z,1.865+offset,.006)
    v.co.z+=front*.0010*gaussian(abs(x),.034,.017)*gaussian(z,1.842+offset,.004)
    v.co.y+=front*.0013*gaussian(x,0,.022)*gaussian(z,1.777+offset,.008)

# Refit the donor's high trapezius mass into a slender continuous neck. The
# transition begins gently beneath the jaw, rather than at a horizontal cut.
lower=[v for v in mesh.vertices if v.co.z<1.778]
zz=[1.648+i*.001 for i in range(132)]
sections=[]
for z in zz:
    points=[v.co for v in lower if abs(v.co.z-z)<.0025]
    sections.append((max(abs(p.x) for p in points),min(p.y for p in points),max(p.y for p in points)))
sections=[tuple(sum(s[k] for s in sections[max(0,i-2):min(len(sections),i+3)])/len(sections[max(0,i-2):min(len(sections),i+3)]) for k in range(3)) for i in range(len(sections))]
targets=[(1.648,.070,.063,.010),(1.680,.058,.056,.009),(1.700,.054,.054,.008),(1.720,.056,.056,.008),(1.740,.065,.062,.009),(1.760,.074,.068,.010),(1.778,.078,.073,.012)]
def lerp_profile(z, pairs):
    if z<=pairs[0][0]:return pairs[0][1]
    for (a,x),(b,y) in zip(pairs,pairs[1:]):
        if z<=b:return x+(y-x)*(z-a)/(b-a)
    return pairs[-1][1]
def smoothstep(t):
    t=max(0,min(1,t))
    return t*t*(3-2*t)
for v in lower:
    x,y,z=v.co
    extent=lerp_profile(z,[(a,s[0]) for a,s in zip(zz,sections)])
    ymin=lerp_profile(z,[(a,s[1]) for a,s in zip(zz,sections)])
    ymax=lerp_profile(z,[(a,s[2]) for a,s in zip(zz,sections)])
    center=(ymin+ymax)/2
    angle=math.atan2(x/extent,-(y-center)/((ymax-ymin)/2))
    xr=lerp_profile(z,[(r[0],r[1]) for r in targets])
    yr=lerp_profile(z,[(r[0],r[2]) for r in targets])
    yc=lerp_profile(z,[(r[0],r[3]) for r in targets])
    target=Vector((xr*math.sin(angle),yc-yr*math.cos(angle),z))
    blend=smoothstep((1.778-z)/.066)
    # Keep the entire chin and front facial silhouette anchored.
    blend*=1-smoothstep((-y-.105)/.017)
    v.co=v.co.lerp(target,blend)

# Relax the refitted throat's surface while anchoring the jaw and all facial
# features. The high-density donor topology needs this after the volume refit.
bm=bmesh.new()
bm.from_mesh(mesh)
relax=[v for v in bm.verts if v.co.z<1.778 and v.co.y>-.122]
weights={v:smoothstep((1.778-v.co.z)/.034)*(1-smoothstep((-v.co.y-.105)/.017)) for v in relax}
for _ in range(70):
    old={v:v.co.copy() for v in relax}
    bmesh.ops.smooth_vert(bm,verts=relax,factor=.65,use_axis_x=True,use_axis_y=True,use_axis_z=True)
    for v in relax:
        v.co=old[v].lerp(v.co,weights[v])
bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
bm.to_mesh(mesh)
bm.free()
for p in mesh.polygons:
    p.use_smooth=True
attr=mesh.color_attributes.get('Complexion') or mesh.color_attributes.new(name='Complexion',type='FLOAT_COLOR',domain='POINT')
for v,c in zip(mesh.vertices,attr.data):
    x,y,z=v.co
    front=max(0,min(1,(-y-.025)/.04))
    cheek=gaussian(abs(x),.048,.024)*gaussian(z,1.813+offset,.025)*front
    nose=gaussian(x,0,.016)*gaussian(z,1.809+offset,.017)*front
    lips=gaussian(x,0,.023)**2*gaussian(z,1.772+offset,.006)*max(0,min(1,(-y-.055)/.025))
    beard=gaussian(z,1.752+offset,.027)*front*.018
    col=Vector((.43,.28,.214))+Vector((.024,-.012,-.009))*(cheek+nose)-Vector((beard,beard,beard*.8))
    col=col.lerp(Vector((.29,.115,.09)),min(.75,lips))
    c.color=(*col,1)
mesh.update()
tree=KDTree(len(mesh.vertices))
for v in mesh.vertices:
    tree.insert(v.co,v.index)
tree.balance()
max_face_delta=max(tree.find(co)[2] for co in before)
assert max_face_delta<.000002, f'Facial geometry moved: {max_face_delta}'
created=[v for v in mesh.vertices if v.co.z<1.736]
loop=border
neck_tree=BVHTree.FromPolygons([v.co for v in mesh.vertices],[list(p.vertices) for p in mesh.polygons])
for z in [1.68,1.70,1.72,1.736]:
    pts=[v.co for v in mesh.vertices if abs(v.co.z-z)<.002]
    print('Natural neck section',z,'width',max(p.x for p in pts)-min(p.x for p in pts),'depth',max(p.y for p in pts)-min(p.y for p in pts),flush=True)
head['neck_revision'] = 'Continuous submental throat transition, narrower anatomical neck, collar lowered to match supplied reference.'

old = bpy.data.objects['High split collar']
collection = old.users_collection[0]
for ob in list(bpy.data.objects):
    if ob is old or ob.name.startswith('Collar oxblood piping'):
        bpy.data.objects.remove(ob, do_unlink=True)

def mesh_object(name, verts, faces, material):
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces)
    data.materials.append(material)
    data.update()
    ob = bpy.data.objects.new(name, data)
    collection.objects.link(ob)
    ob.parent = root
    for p in data.polygons:
        p.use_smooth = True
    return ob

cloth = bpy.data.materials['V3 | scanned burgundy jacquard - 4K']
dark = bpy.data.materials.get('Leather | charcoal')
def top_height(a):
    wrapped = min(a, 2*math.pi-a)
    return 1.702 + .006*(1-math.cos(a))/2 - .009*math.exp(-(wrapped/.23)**2)

n = 129
aa = [.024 + (2*math.pi-.048)*j/(n-1) for j in range(n)]
vs = []
levels = [0,.02]+[i/12 for i in range(1,12)]+[.98,1]
for t in levels:
    for a in aa:
        z = 1.652*(1-t)+top_height(a)*t
        # The lower edge flares into the chest; the upper edge hugs the neck.
        xr = .070*(1-t)+.0625*t
        yr = .064*(1-t)+.0615*t
        direction=Vector((math.sin(a),-math.cos(a),0))
        origin=Vector((0,.008,z))
        hit,normal,_,distance=neck_tree.ray_cast(origin,direction,.25)
        nominal=math.sqrt((xr*math.sin(a))**2+(yr*math.cos(a))**2)
        radius=max(nominal,distance+.0045 if hit is not None else 0)
        p=origin+direction*radius
        vs.append(tuple(p))
fs = []
for i in range(len(levels)-1):
    for j in range(n-1):
        fs.append((i*n+j, i*n+j+1, (i+1)*n+j+1, (i+1)*n+j))
collar = mesh_object('Collar | reference burgundy stand collar', vs, fs, cloth)
uv = collar.data.uv_layers.new(name='Garment UV')
for face in collar.data.polygons:
    for li in face.loop_indices:
        idx = collar.data.loops[li].vertex_index
        i, j = divmod(idx,n)
        uv.data[li].uv = (aa[j]*.064/.18, (vs[idx][2]-1.652)/.18)
sub = collar.modifiers.new('Tailored rounded collar surface', 'SUBSURF')
sub.levels = sub.render_levels = 2
solid = collar.modifiers.new('Folded fabric thickness', 'SOLIDIFY')
solid.thickness = .0022
solid.offset = -1
bevel = collar.modifiers.new('Soft folded edges', 'BEVEL')
bevel.width = .00065
bevel.segments = 2
collar['reference'] = 'Short oxblood stand collar, small front notch, narrow charcoal binding, exposed throat beneath jaw.'

def binding(name, points, radius):
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '3D'
    curve.bevel_depth = radius
    curve.bevel_resolution = 3
    spline = curve.splines.new('POLY')
    spline.points.add(len(points)-1)
    for p, co in zip(spline.points, points):
        p.co = (*co, 1)
    ob = bpy.data.objects.new(name, curve)
    collection.objects.link(ob)
    ob.parent = root
    curve.materials.append(dark)
    return ob

binding('Collar | fine charcoal top binding', [(vs[(len(levels)-1)*n+j][0],vs[(len(levels)-1)*n+j][1],vs[(len(levels)-1)*n+j][2]) for j in range(n)], .00115)
for j, a in enumerate([aa[0],aa[-1]]):
    binding('Collar | front opening edge '+str(j), [(vs[i*n+(0 if j==0 else n-1)][0], vs[i*n+(0 if j==0 else n-1)][1]-.0004, vs[i*n+(0 if j==0 else n-1)][2]) for i in range(len(levels))], .0009)

notes = bpy.data.texts.get('START HERE | Rider study')
notes.write('\nNECK / REFERENCE REVISION\nRebuilt continuous skin under the jaw and a narrower throat. Replaced the\noversized leather cone with a short burgundy fabric collar, front notch\nand thin charcoal binding, following the supplied rider reference.\nFront, side and full-figure cameras are included for proportion review.\n')
root['revision'] = 'Reference-matched lower burgundy collar and continuous anatomical neck; refined groom and packed scanned garments retained.'
scene.render.engine = 'CYCLES'
scene.cycles.samples = 24 if DRAFT else 64
scene.cycles.use_denoising = True
scene.cycles.adaptive_threshold = .025 if DRAFT else .015
try:
    prefs=bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type='METAL'
    prefs.get_devices()
    for d in prefs.devices:
        d.use=d.type=='METAL'
    if any(d.type=='METAL' for d in prefs.devices):
        scene.cycles.device='GPU'
except Exception:
    pass

studio=bpy.data.collections['07 | Studio - cameras and lights']
specs=[
    ('NECK REVIEW | Front', (0,-3.8,1.91), (0,-.012,1.805), .57, (1050,1200), 'portrait'),
    ('NECK REVIEW | Side', (3.8,-.18,1.89), (0,0,1.79), .57, (1050,1200), 'side'),
    ('NECK REVIEW | Full figure', (1.6,-8,2.25), (-.02,0,1), 2.30, (1150,1500), 'full'),
]
cameras=[]
for name, location, target, scale, size, suffix in specs:
    data=bpy.data.cameras.new(name)
    data.type='ORTHO'
    data.ortho_scale=scale
    camera=bpy.data.objects.new(name,data)
    studio.objects.link(camera)
    camera.location=location
    camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler()
    cameras.append(camera)

scene.camera=cameras[0]
scene.render.resolution_percentage=100
scene.render.resolution_x,scene.render.resolution_y=specs[0][4]
scene.render.filepath=str(OUT/'daemon_neck_fixed_portrait.png')
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            space=area.spaces.active
            space.region_3d.view_location=(0,0,1.70)
            space.region_3d.view_distance=1.05
unpacked=[i.filepath for i in bpy.data.images if i.source=='FILE' and not i.packed_file]
assert not unpacked, f'Unpacked image dependencies: {unpacked}'
if not DRAFT:
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'daemon_rider_neck_fixed.blend'), compress=True)
for camera,spec in zip(cameras,specs):
    if DRAFT and spec[5]=='full':
        continue
    scene.camera=camera
    scene.render.resolution_x,scene.render.resolution_y=spec[4]
    if DRAFT:
        scene.render.resolution_percentage=65
    scene.render.filepath=str(OUT/('daemon_neck_'+('draft_' if DRAFT else 'fixed_')+spec[5]+'.png'))
    print('Rendering',spec[0], 'boundary vertices', len(loop), 'new throat vertices',len(created),flush=True)
    bpy.ops.render.render(write_still=True)

if not DRAFT:
    scene.camera=cameras[0]
    scene.render.resolution_x,scene.render.resolution_y=specs[0][4]
    scene.render.filepath=str(OUT/'daemon_neck_fixed_portrait.png')
    manifest={
        'revision':'Reference-fitted anatomical neck and low burgundy stand collar',
        'lower_neck_boundary_edges':remaining,
        'new_neck_vertices':len(created),
        'original_jaw_and_face_max_delta_m':max_face_delta,
        'collar_height_m':[min(v[2] for v in vs),max(v[2] for v in vs)],
        'packed_images':len([i for i in bpy.data.images if i.packed_file]),
        'unpacked_file_images':[i.filepath for i in bpy.data.images if i.source=='FILE' and not i.packed_file],
        'native_grooms':{o.name:len(o.data.curves) for o in scene.objects if o.type=='CURVES'},
        'review_images':['daemon_neck_fixed_'+s[5]+'.png' for s in specs]
    }
    (OUT/'daemon_neck_fixed_manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'daemon_rider_neck_fixed.blend'),compress=True)
print('Completed reference neckline revision.',flush=True)
