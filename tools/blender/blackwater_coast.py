"""Fit photographed coastal geology to the Red Keep headland, in metres.

Blender -b --factory-startup -P tools/blender/blackwater_coast.py -- <scan directory>
Each source directory contains its Poly Haven glTF, bin and textures. The finished
.blend packs the textures. The GLB includes near and distant meshes and collision.
"""
import base64
import math
import random
import sys
from pathlib import Path

import bpy
import bmesh
import numpy as np
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'assets-src/cliffs/Blackwater Ledges.blend'
EXPORT = ROOT / 'public/models/blackwater_ledges.glb'
# Scan sizes vary considerably. Spend geometry on silhouettes and undercuts;
# use the registered photographic colour and tangent normals for finer detail.
BUDGET = {
    'coastal_cliff_01': 35000, 'coastal_cliff_02': 42000, 'coastal_cliff_04': 38000,
    'coast_rocks_03': 17000, 'coast_rocks_05': 7200, 'coast_land_rocks_03': 10500,
    'boulder_01': 4800,
}
# Heading, angular span, cliff scans (lower and upper), lower crest, upper crest.
SITES = [
    ('Gull_Crag', -72, 28, '01', '04', 22, 50),
    ('Tide_Gate', -48, 28, '02', '01', 29, 65),
    ('Broken_Seam', -26, 24, '04', '02', 18, 51),
    ('Split_Nose', -4, 28, '02', '04', 33, 71),
    ('Shingle_Point', 19, 25, '01', '02', 20, 49),
    ('Cormorant_Shelf', 43, 30, '04', '01', 25, 62),
    ('East_Skerries', 70, 31, '02', '04', 21, 46),
]
# Radius of the existing cliff at 16m above sea level, sampled at five-degree intervals.
RADIUS = [187,189,190,183,177,185,195,198,200,193,167,171,187,194,188,185,187,188,179,
          188,187,175,181,171,166,151,161,159,163,156,165,173,171,191,182,172,189,195]


def smooth(a, b, v):
    t = np.clip((v-a)/(b-a),0,1)
    return t*t*(3-2*t)


def bedrock(angle, h):
    return np.interp(np.degrees(angle), np.arange(len(RADIUS))*5-90, RADIUS) - .27*(h-16)


def coordinates(mesh):
    values=np.empty(len(mesh.vertices)*3,np.float32)
    mesh.vertices.foreach_get('co',values)
    return values.reshape(-1,3)


def select(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active=obj


def reduce_to(obj, target):
    tris=sum(len(p.vertices)-2 for p in obj.data.polygons)
    if tris<=target: return
    select(obj)
    mod=obj.modifiers.new('Shoreline LOD','DECIMATE')
    mod.ratio=target/tris; mod.use_collapse_triangulate=True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.data.validate()


def load_scan(name, directory, target=None):
    before=set(bpy.context.scene.objects)
    files=sorted((directory/name).glob('*.gltf'))
    if not files: raise FileNotFoundError(f'Missing source glTF for {name} in {directory}')
    bpy.ops.import_scene.gltf(filepath=str(files[0]),merge_vertices=True)
    imported=set(bpy.context.scene.objects)-before
    obj=next(o for o in imported if o.type=='MESH')
    select(obj); bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    # Imported split normals describe the original scan. Recalculate them on the
    # deformed coast while retaining its UVs and scanned normal map.
    if obj.data.has_custom_normals: bpy.ops.mesh.customdata_custom_splitnormals_clear()
    if name == 'boulder_01':
        # The scan has coincident vertices across many UV islands. The UVs live
        # on face corners and survive welding the underlying geometric surface.
        bm=bmesh.new(); bm.from_mesh(obj.data)
        bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.0008)
        bm.to_mesh(obj.data); bm.free()
    for polygon in obj.data.polygons: polygon.use_smooth=True
    reduce_to(obj,BUDGET[name] if target is None else target)
    mesh=obj.data.copy()
    for o in imported: bpy.data.objects.remove(o,do_unlink=True)
    return mesh


def face_shape(original, heading, span, lower, upper, upper_tier):
    x, y, z=original.T
    u=(x-x.min())/max(.01,float(x.max()-x.min()))
    t=np.clip((z-z.min())/(z.max()-z.min()),0,1)
    angle=np.radians(heading + span*(.5-u))
    lip=np.sin(angle*11+.5)*.53 + np.sin(angle*6-.7)*.32
    floor=lower*.40-4 if upper_tier else -2.2
    crest=upper*.79 if upper_tier else lower
    shoulders=smooth(0,.34,u)*(1-smooth(.62,1,u))
    height=floor+t*(crest-floor)*(.59+.43*shoulders+.22*lip) + 2.4*np.sin(angle*16+.8)*t
    # The scan has an uneven top edge. Pull every part of that edge into the old
    # cliff, including low saddles far below the scan's highest point.
    bins=np.minimum(79,(u*80).astype(int))
    top=np.zeros(80); np.maximum.at(top,bins,t)
    local_t=t/np.maximum(.15,top[bins])
    # The open mesh is stitched into solid bedrock at its sides and crown.
    cover=smooth(0,.12,u)*(1-smooth(.88,1,u))
    setback=smooth(.70,.99,local_t)
    projection=(2 if upper_tier else 23) + 5*np.sin(angle*9-.8)+5*np.cos(angle*16)
    # Recess the middle of the tide gate beneath an overhanging lip.
    throat=np.exp(-((np.degrees(angle)+48)/3.5)**2) * (1-smooth(3,15,height))
    r=bedrock(angle,height) + (projection*(1-setback)+4)*cover - 9*(1-cover) - 10*setback
    r+=(-y)*min(2.0,max(1.1,(crest-floor)/17)) - 16*throat
    if upper_tier: r-=3+8*(1-shoulders)
    return np.stack((r*np.cos(angle),-r*np.sin(angle),height),axis=1)


def shore_shape(original, heading, radius, length, width, relief, rotation, elevation, tilt):
    # Orient the scan's long axis alongshore. Recede below tide level along the
    # trimmed scan boundary so a photographed sand patch cannot end in a straight lip.
    x,y,z=original.T
    p=(x-x.min())/(x.max()-x.min())-.5
    q=(y-y.min())/(y.max()-y.min())-.5
    h=(z-z.min())/max(.001,float(z.max()-z.min()))
    dx=p*length; dy=q*width
    c,s=math.cos(rotation),math.sin(rotation)
    along=dx*c-dy*s; offshore=dx*s+dy*c
    angle=math.radians(heading)
    altitude=elevation+h*relief + tilt*offshore
    edge=np.maximum(abs(p)*2,abs(q)*2)
    altitude-=smooth(.72,.99,edge)*max(2.5,relief*.72)
    return np.stack(((radius+offshore)*math.cos(angle)-along*math.sin(angle),
                    -(radius+offshore)*math.sin(angle)-along*math.cos(angle),altitude),axis=1)


def trim_profile(name, xyz):
    """Break up the exposed lip and submerge the sand at the edge of each reef."""
    if name.endswith(('_Reef','_Shingle')):
        xyz[:,2] = .67*xyz[:,2] - .48
    if name.endswith(('_Face','_Crown')):
        for site,heading,span,_,_,h1,h2 in SITES:
            if not name.startswith(site+'_'): continue
            u=.5-(np.degrees(np.arctan2(-xyz[:,1],xyz[:,0]))-heading)/span
            # One high shoulder, a drainage notch and a lower spur on the other side.
            rise=9.6*np.exp(-((u-.27)/.17)**2)-7.2*np.exp(-((u-.70)/.15)**2)+3*(u-.5)
            xyz[:,2]+=rise*smooth(1,h1*.87,xyz[:,2])*smooth(0,.1,u)*(1-smooth(.89,1,u))
            break
    return xyz


def collision_patch(obj):
    mesh=obj.data
    coords=coordinates(mesh)
    bvh=BVHTree.FromPolygons([v.co for v in mesh.vertices],[p.vertices[:] for p in mesh.polygons])
    xmin,zmin=np.floor([coords[:,0].min(),-coords[:,1].max()]).astype(int)
    xmax,zmax=np.ceil([coords[:,0].max(),-coords[:,1].min()]).astype(int)
    heights=bytearray()
    for z in range(zmin,zmax+1):
        for x in range(xmin,xmax+1):
            hit=bvh.ray_cast((x,-z,130),(0,0,-1))[0]
            heights.append(max(0,min(255,round(hit.z*2))) if hit else 0)
    return {'x':int(xmin),'z':int(zmin),'width':int(xmax-xmin+1),'height':int(zmax-zmin+1),
            'unit':.5,'data':base64.b64encode(heights).decode()}


def build(directory):
    scene=bpy.data.scenes.new('Blackwater Bay')
    bpy.context.window.scene=scene
    high=bpy.data.collections.new('Photographed coastal formations')
    low=bpy.data.collections.new('Distant silhouettes')
    scene.collection.children.link(high); scene.collection.children.link(low)
    masters={key:load_scan(key,directory) for key in BUDGET}
    outputs=[]

    def place(name, key, positions):
        mesh=masters[key].copy(); mesh.name=name
        mesh.vertices.foreach_set('co',np.asarray(trim_profile(name,positions),np.float32).ravel()); mesh.update()
        obj=bpy.data.objects.new(name,mesh);high.objects.link(obj)
        obj['heightPatch']=collision_patch(obj);obj['scan']=key
        far=obj.copy();far.data=mesh.copy();far.name=name+'_lo';low.objects.link(far)
        del far['heightPatch'];reduce_to(far,max(430,min(2900,int(BUDGET[key]*.07))))
        outputs.extend((obj,far))
        return obj

    for index,(site,heading,span,base,crown,h1,h2) in enumerate(SITES):
        rng=random.Random(319+index*107)
        for level,scan in enumerate((base,crown)):
            if level and index not in (0,3,5): continue
            key='coastal_cliff_'+scan
            xyz=face_shape(coordinates(masters[key]),heading+level*.9,span+level*1.5,h1,h2,bool(level))
            place(site+('_Crown' if level else '_Face'),key,xyz)
        # A skerry chain sweeps away from one side of each inlet, leaving open water between chains.
        for suffix,key,angle,out,L,W,H,rot,elev,dip in [
            ('Reef','coast_rocks_03',heading-4,29,40,26,9,rng.uniform(-.6,.6),-4.5,-.08),
            ('Shingle','coast_land_rocks_03',heading+5,24,25,15,6,rng.uniform(-1,1),-2.9,-.16),
            ('Underhang','coast_rocks_05',heading-8,29,13,11,6,rng.uniform(-.7,.7),-2.2,-.12),
        ]:
            radius=bedrock(math.radians(angle),1)+out
            xyz=shore_shape(coordinates(masters[key]),angle,radius,L,W,H,rot,elev,dip)
            place(site+'_'+suffix,key,xyz)
        # Photograph-derived detached boulders have complete undersides. Sink each
        # below the water plane and vary its roll, scale and bearing independently.
        for j in range(4 if index != 1 else 10):
            angle=heading+(-8 if j<2 else 6)+rng.uniform(-2.1,2.1)
            radius=bedrock(math.radians(angle),0)+rng.uniform(27,43)
            length=rng.uniform(3.2,6.8)*(1.55 if j==0 else 1)
            if index==1 and j>=4:
                angle,radius,length=[(-54.6,239,13),(-53.2,242,6),(-55.8,240,5),
                                     (-41.3,239,8),(-40.4,242,4),(-42.1,236,3)][j-4]
            stone=coordinates(masters['boulder_01']).copy()
            stone-=.5*(stone.max(axis=0)+stone.min(axis=0))
            stone*=length/max(np.ptp(stone[:,0]),np.ptp(stone[:,1]))
            tilt=rng.uniform(-.42,.44); yaw=rng.uniform(-math.pi,math.pi)
            c,t=math.cos(tilt),math.sin(tilt); x,y,z=stone.T
            y,z=y*c-z*t,y*t+z*c
            c,t=math.cos(yaw),math.sin(yaw)
            bx=radius*math.cos(math.radians(angle)); by=-radius*math.sin(math.radians(angle))
            xyz=np.stack((bx+x*c-y*t,by+x*t+y*c,z-z.min()-length*rng.uniform(.15,.27)),axis=1)
            place(site+'_Fall_'+str(j+1),'boulder_01',xyz)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in outputs: obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(EXPORT),export_format='GLB',use_selection=True,
        use_active_scene=True,export_extras=True,export_materials='EXPORT',export_image_format='AUTO',
        export_meshopt_compression_enable=True,export_meshopt_extension='EXT_meshopt_compression')
    low.hide_viewport=True;low.hide_render=True
    # All imported maps are embedded in the editable source.
    bpy.ops.file.pack_all()
    select(high.objects[0])
    for area in bpy.context.screen.areas:
        if area.type=='VIEW_3D':
            from mathutils import Vector
            view=area.spaces.active;view.clip_end=4000;view.region_3d.view_distance=325
            view.region_3d.view_location=(128,25,25)
            view.region_3d.view_rotation=Vector((-1,-.28,-.38)).to_track_quat('-Z','Y')
            view.shading.color_type='TEXTURE'
    versions=bpy.context.preferences.filepaths.save_version
    try:
        bpy.context.preferences.filepaths.save_version=0
        bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE),compress=True)
    finally: bpy.context.preferences.filepaths.save_version=versions
    print('Coast exported:',len(high.objects),'formations;',EXPORT.stat().st_size,'bytes')

if __name__=='__main__':
    build(Path(sys.argv[sys.argv.index('--')+1]))
