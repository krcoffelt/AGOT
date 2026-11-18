"""Build the editable cliff and the flight asset from headland_scans.py output.
Blender -b --factory-startup -P tools/blender/blackwater_headland.py -- <working directory> <Poly Haven glTF directory>
"""
import json
import runpy
import subprocess
import sys
from pathlib import Path

import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT/'assets-src/cliffs/Blackwater Headland.blend'
EXPORT = ROOT/'public/models/blackwater_headland.glb'
coast = runpy.run_path(str(Path(__file__).with_name('blackwater_coast.py')))
collision_patch = coast['collision_patch']


def material(directory, name):
    mat=bpy.data.materials.new(name+' limestone')
    mat.use_nodes=True
    bsdf=mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Roughness'].default_value=.91
    link=mat.node_tree.links.new
    for normal in (False,True):
        path=directory/(name+('_n.jpg' if normal else '.jpg'))
        image=bpy.data.images.load(str(path),check_existing=False)
        tex=mat.node_tree.nodes.new('ShaderNodeTexImage')
        tex.image=image
        tex.extension='EXTEND'
        if normal:
            image.colorspace_settings.name='Non-Color'
            node=mat.node_tree.nodes.new('ShaderNodeNormalMap')
            link(tex.outputs['Color'],node.inputs['Color'])
            link(node.outputs['Normal'],bsdf.inputs['Normal'])
        else:
            link(tex.outputs['Color'],bsdf.inputs['Base Color'])
        image.pack()
    return mat


def mesh_lod(coords, step, name, mat, collection, close_shell=False):
    rows,cols=coords.shape[:2]
    keys=[(y,x) for y in range(0,rows,step) for x in range(0,cols,step)]
    # Keep every vertex on each shared side even for distant sectors. A neighbour
    # may switch detail independently while flying alongside these faces.
    keys.extend((y,x) for x in (0,cols-1) for y in range(rows) if y%step)
    index={point:i for i,point in enumerate(keys)}
    faces=[]
    for y in range(0,rows-1,step):
        for x in range(0,cols-1,step):
            a,b,c,d=(index[key] for key in [(y,x),(y+step,x),(y+step,x+step),(y,x+step)])
            if x==0 and step>1:
                faces.extend((index[j,x],index[j+1,x],c) for j in range(y,y+step))
            else:
                faces.append((a,b,c))
            if x+step==cols-1 and step>1:
                faces.extend((a,index[j+1,x+step],index[j,x+step]) for j in range(y,y+step))
            else:
                faces.append((a,c,d))
    if close_shell:
        # Close the submerged sole and the two tapered ends of the cove bodies.
        for x in range(0,cols-1,step):
            a,b,c,d=(index[key] for key in [(rows-1,x),(0,x),(0,x+step),(rows-1,x+step)])
            faces.extend(((a,b,c),(a,c,d)))
        for x in (0,cols-1):
            ring=[index[y,x] for y in range(rows)]
            if x==0: ring.reverse()
            faces.extend((ring[0],ring[i],ring[i+1]) for i in range(1,len(ring)-1))
    mesh=bpy.data.meshes.new(name)
    y,x=np.asarray(keys).T
    mesh.from_pydata(coords[y,x].tolist(),[],faces)
    mesh.materials.append(mat)
    mesh.polygons.foreach_set('use_smooth',np.ones(len(faces),bool))
    uv=np.stack((x/(cols-1),y/(rows-1)),axis=1).astype('f4')
    mesh.uv_layers.new(name='Scan atlas').data.foreach_set('uv',uv[np.asarray(faces)].ravel())
    mesh.update()
    obj=bpy.data.objects.new(name,mesh)
    collection.objects.link(obj)
    return obj


def add_exposures(work, scans, collections, centre):
    # Retain the original three-dimensional undercuts and registered maps on
    # selected projecting faces. The continuous bedrock closes their open backs.
    samples=np.concatenate([np.load(work/f'wall{k:02}.npy')[:,:-1] for k in range(12)],axis=1)
    radius=np.linalg.norm(samples[:,:,:2],axis=2)
    heights=samples[:,:,2]
    for _ in range(85):
        radius[1:-1,1:-1]=(.40*radius[1:-1,1:-1]+.15*(radius[:-2,1:-1]+radius[2:,1:-1]+
                                                          radius[1:-1,:-2]+radius[1:-1,2:]))
    models={key:coast['load_scan'](key,scans,12500) for key in ('coastal_cliff_02','rock_face_01')}
    # Bearing, centre height, width and height of each exposed stratum in metres.
    sites=[(-115,53,31,20),(-106,76,41,19),(-96,40,32,26),(-86,70,44,24),
           (-73,84,34,16),(-69,45,46,23),(-57,65,38,22),(-47,81,41,18),
           (-42,42,35,25),(-31,66,50,29),(-23,81,38,19),(-18,49,41,26),
           (-7,69,48,28),(2,39,31,19),(9,78,43,23),(22,56,42,21),
           (34,79,30,18),(39,36,29,23),(52,67,48,26),(67,81,33,16),
           (76,50,46,28),(88,71,40,23),(103,45,41,27),(111,77,34,21)]
    for i,(bearing,altitude,width,height) in enumerate(sites):
        key='rock_face_01' if i in (2,6,9,13,17,21) else 'coastal_cliff_02'
        mesh=models[key].copy()
        xyz=coast['coordinates'](mesh)
        x,depth,z=xyz.T
        u=(x-x.min())/np.ptp(x)
        v=(z-z.min())/np.ptp(z)
        rng=np.random.default_rng(299+i*19)
        tilt=rng.uniform(-.19,.19)
        rad=np.radians(bearing)-(u-.5)*width/155.
        h=altitude+(v-.5)*height+(u-.5)*width*tilt
        col=(np.degrees(rad)+128)/256*radius.shape[1]
        ix=np.floor(col).astype(int)
        top=heights[230,ix]
        row=np.clip((h+6)/(top+6)*230,0,229.99)
        iy=np.floor(row).astype(int)
        tx,ty=col-ix,row-iy
        r=((1-ty)*((1-tx)*radius[iy,ix]+tx*radius[iy,ix+1])+
            ty*((1-tx)*radius[iy+1,ix]+tx*radius[iy+1,ix+1]))
        bins=np.clip((u*63).astype(int),0,63)
        lo=np.full(64,np.inf); hi=np.full(64,-np.inf)
        np.minimum.at(lo,bins,v); np.maximum.at(hi,bins,v)
        within=(v-lo[bins])/np.maximum(.01,hi[bins]-lo[bins])
        smooth=coast['smooth']
        edge=smooth(0,.16,u)*smooth(0,.16,1-u)*smooth(0,.17,within)*smooth(0,.23,1-within)
        face=-(depth-np.median(depth))*min(2.8,height/np.ptp(z))
        r+=face+1.55-(1-edge)*(5.6+np.maximum(0,face))
        mesh.vertices.foreach_set('co',np.stack((r*np.cos(rad),-r*np.sin(rad),h),axis=1).astype('f4').ravel())
        mesh.update()
        name=f'Buttress_{i+1:02}'
        obj=bpy.data.objects.new(name,mesh)
        collections[0].objects.link(obj)
        obj['heightPatch']=collision_patch(obj)
        obj['centre']=centre
        obj['scan']=key
        for target,suffix,collection in zip((3500,760),('_mid','_lo'),collections[1:]):
            other=bpy.data.objects.new(name+suffix,mesh.copy())
            collection.objects.link(other)
            coast['reduce_to'](other,target)


def add_grotto(work,collections,centre):
    data=np.load(work/'tidal_grotto.npz')
    xyz,faces=data['position'],data['faces']
    mesh=bpy.data.meshes.new('Wave-cut limestone')
    mesh.from_pydata(xyz.tolist(),[],faces.tolist())
    mesh.polygons.foreach_set('use_smooth',np.ones(len(faces),bool))
    mesh.update()
    high=bpy.data.objects.new('Tidal_Grotto',mesh)
    collections[0].objects.link(high)
    coast['reduce_to'](high,46000)
    coast['select'](high)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=np.radians(63),island_margin=.003)
    bpy.ops.object.mode_set(mode='OBJECT')
    mat=bpy.data.materials.new('Sea cave limestone')
    high.data.materials.append(mat)
    mat.use_nodes=True
    nodes=mat.node_tree.nodes; link=mat.node_tree.links.new
    shader=nodes.get('Principled BSDF'); output=nodes.get('Material Output')
    shader.inputs['Roughness'].default_value=.84
    location=nodes.new('ShaderNodeNewGeometry')
    scale=nodes.new('ShaderNodeVectorMath');scale.operation='SCALE'
    scale.inputs['Scale'].default_value=1/5.4
    link(location.outputs['Position'],scale.inputs[0])
    def measured(file):
        tex=nodes.new('ShaderNodeTexImage')
        tex.image=bpy.data.images.load(str(ROOT/'public/textures/rock_boulder_dry'/file))
        tex.projection='BOX';tex.projection_blend=.74
        link(scale.outputs['Vector'],tex.inputs['Vector'])
        return tex
    color=measured('diff.jpg')
    relief=measured('disp.jpg')
    relief.image.colorspace_settings.name='Non-Color'
    bump=nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value=.60;bump.inputs['Distance'].default_value=.18
    link(relief.outputs['Color'],bump.inputs['Height'])
    link(bump.outputs['Normal'],shader.inputs['Normal'])
    emission=nodes.new('ShaderNodeEmission')
    theta=np.radians(-36.5)
    uv=nodes.new('ShaderNodeCombineXYZ')
    for axis,vector,offset in [('X',(-np.sin(theta)/63,-np.cos(theta)/63,-.12/63),29/63),
                               ('Y',(-.17*np.sin(theta)/42,-.17*np.cos(theta)/42,1/42),7/42)]:
        dot=nodes.new('ShaderNodeVectorMath');dot.operation='DOT_PRODUCT'
        link(location.outputs['Position'],dot.inputs[0]);dot.inputs[1].default_value=vector
        add=nodes.new('ShaderNodeMath');add.operation='ADD';add.inputs[1].default_value=offset
        link(dot.outputs['Value'],add.inputs[0]);link(add.outputs[0],uv.inputs[axis])
    photograph=nodes.new('ShaderNodeTexImage')
    photograph.image=bpy.data.images.load(str(work/'grotto_face.jpg'));photograph.extension='EXTEND'
    link(uv.outputs[0],photograph.inputs['Vector'])
    pigment=nodes.new('ShaderNodeVectorMath');pigment.operation='SCALE';pigment.inputs['Scale'].default_value=3.8
    link(photograph.outputs['Color'],pigment.inputs[0])
    mineral=nodes.new('ShaderNodeMixRGB');mineral.blend_type='MULTIPLY';mineral.inputs[0].default_value=.74
    link(color.outputs['Color'],mineral.inputs[1]);link(pigment.outputs['Vector'],mineral.inputs[2])
    link(mineral.outputs['Color'],emission.inputs['Color'])
    link(emission.outputs['Emission'],output.inputs['Surface'])
    # Bake the metre-scale box projections onto one seamless UV atlas. This keeps
    # roof, jamb and back wall identical in Blender, glTF viewers and the game.
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=1
    maps=[]
    for mode in ('EMIT','NORMAL'):
        if mode=='NORMAL':
            link(shader.outputs['BSDF'],output.inputs['Surface'])
        image=bpy.data.images.new('Cave stone '+mode,2048,2048,alpha=False)
        if mode=='NORMAL': image.colorspace_settings.name='Non-Color'
        target=nodes.new('ShaderNodeTexImage');target.image=image
        nodes.active=target
        bpy.ops.object.bake(type=mode,margin=12,use_clear=True)
        image.filepath_raw=str(work/('grotto_'+mode.lower()+'.jpg'));image.file_format='JPEG'
        image.save();image.pack();maps.append(image)
    nodes.clear()
    output=nodes.new('ShaderNodeOutputMaterial'); shader=nodes.new('ShaderNodeBsdfPrincipled')
    shader.inputs['Roughness'].default_value=.84
    link(shader.outputs['BSDF'],output.inputs['Surface'])
    for i,image in enumerate(maps):
        tex=nodes.new('ShaderNodeTexImage');tex.image=image
        if i:
            normal=nodes.new('ShaderNodeNormalMap')
            link(tex.outputs['Color'],normal.inputs['Color']);link(normal.outputs['Normal'],shader.inputs['Normal'])
        else: link(tex.outputs['Color'],shader.inputs['Base Color'])
    high['heightPatch']=collision_patch(high);high['centre']=centre
    for suffix,count,collection in zip(('_mid','_lo'),(11000,2300),collections[1:]):
        obj=bpy.data.objects.new(high.name+suffix,high.data.copy())
        collection.objects.link(obj);coast['reduce_to'](obj,count)


def bake_exposure(collections):
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    from mathutils.kdtree import KDTree
    # Measure skylight on the complete cape, including neighbouring buttresses.
    # Transfer the same samples to all distance meshes so the shading stays put.
    points=[]; triangles=[]
    for obj in collections[1].objects:
        mesh=obj.data; mesh.calc_loop_triangles()
        offset=len(points)
        points.extend(v.co.copy() for v in mesh.vertices)
        idx=np.empty(len(mesh.loop_triangles)*3,'i4')
        mesh.loop_triangles.foreach_get('vertices',idx)
        triangles.extend((idx.reshape(-1,3)+offset).tolist())
    bvh=BVHTree.FromPolygons(points,triangles,all_triangles=True)
    sky=[]
    for i in range(16):
        z=(i+.45)/16
        angle=i*2.399963
        r=np.sqrt(1-z*z)
        sky.append(Vector((np.cos(angle)*r,np.sin(angle)*r,z)))
    smooth=coast['smooth']
    for high in collections[0].objects:
        mid=collections[1].objects[high.name+'_mid']
        low=collections[2].objects[high.name+'_lo']
        vertices=mid.data.vertices
        shadow=np.empty(len(vertices),'f4')
        tree=KDTree(len(vertices))
        for i,v in enumerate(vertices):
            p=v.co; n=v.normal
            tree.insert(p,i)
            origin=p+n*.35
            total=.02; blocked=0.
            for direction in sky:
                weight=max(0.,n.dot(direction))+.065
                total+=weight
                distance=bvh.ray_cast(origin,direction,28.)[3]
                if distance is not None:
                    blocked+=weight*max(0.,1-distance/31.)
            shadow[i]=blocked/total
        tree.balance()
        for obj in (high,mid,low):
            mesh=obj.data
            xyz=coast['coordinates'](mesh); x,y,h=xyz.T
            normals=np.empty(len(mesh.vertices)*3,'f4')
            mesh.vertices.foreach_get('normal',normals)
            up=normals.reshape(-1,3)[:,2]
            if obj==mid:
                occlusion=shadow
            else:
                occlusion=np.fromiter((shadow[tree.find(v.co)[1]] for v in mesh.vertices),'f4',len(mesh.vertices))
            along=np.arctan2(-y,x)*155.
            patch=(.49+.22*np.sin(along*.079-h*.043)+.16*np.cos(along*.15+h*.086)
                   +.085*np.sin(along*.37-h*.31)+.13*occlusion)
            soil=smooth(.20,.72,up)*smooth(.27,.75,patch)*smooth(3,15,h)
            if high.name.startswith('Cove_'):
                soil*=.24
            shade=1.-.67*occlusion**.91
            rgba=np.ones((len(xyz),4),'f4')
            rgba[:,:3]=(1-soil[:,None]*np.array([.75,.66,.84]))*shade[:,None]
            if high.name.startswith('Cove_'):
                rgba[:,:3]*=np.array([.53,.55,.54])
            if high.name=='Tidal_Grotto':
                theta=np.radians(-36.5)
                offshore=x*np.cos(theta)-y*np.sin(theta)-207
                across=-x*np.sin(theta)-y*np.cos(theta)
                inside=(1-smooth(-1.,12.,offshore))*(1-smooth(6.,13.,np.abs(across)))*(1-smooth(9,15,h))
                rgba[:,:3]*=np.array([.56,.60,.57])*(1-.60*inside[:,None])
            attr=mesh.color_attributes.new(name='Weathering',type='BYTE_COLOR',domain='POINT')
            attr.data.foreach_set('color',rgba.ravel())
            mesh.color_attributes.active_color=attr
    # Blender's material preview and glTF read the same per-vertex weathering.
    for mat in {o.data.materials[0] for o in collections[0].objects}:
        tree=mat.node_tree
        shader=next(n for n in tree.nodes if n.type=='BSDF_PRINCIPLED')
        base=shader.inputs['Base Color']
        source=base.links[0].from_socket
        tint=tree.nodes.new('ShaderNodeVertexColor'); tint.layer_name='Weathering'
        mix=tree.nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1.
        tree.links.new(source,mix.inputs[1]);tree.links.new(tint.outputs['Color'],mix.inputs[2])
        tree.links.new(mix.outputs[0],base)


def finish_project():
    from mathutils import Vector
    sc=bpy.context.scene
    assert len(sc.objects)==120
    for im in bpy.data.images:
        if im.type=='IMAGE' and not im.packed_file:
            im.pack()
    for screen in bpy.data.screens:
        for ar in screen.areas:
            if ar.type!='VIEW_3D': continue
            s=ar.spaces.active; s.clip_end=3500
            s.region_3d.view_distance=370
            s.region_3d.view_location=(65,5,47)
            s.region_3d.view_rotation=Vector((-.94,-.26,-.31)).to_track_quat('-Z','Y')
            s.region_3d.view_perspective='PERSP'
            s.shading.color_type='TEXTURE'
            s.shading.light='STUDIO'
            s.shading.show_shadows=True
            s.shading.show_cavity=True
            s.shading.cavity_type='WORLD'
            s.overlay.show_floor=False; s.overlay.show_axis_x=False; s.overlay.show_axis_y=False
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath,compress=True)
    print('Packed',len(bpy.data.images),'images. Collections',[(c.name,len(c.objects),c.hide_viewport) for c in sc.collection.children])


def build(work, scans):
    types=('scenes','collections','objects','meshes','materials','images')
    original={kind:set(getattr(bpy.data,kind)) for kind in types}
    scene=bpy.data.scenes.new('Blackwater Headland')
    previous=bpy.context.window.scene
    bpy.context.window.scene=scene
    try:
        collections=[]
        for name in ('Cliff face','Flight distance','Horizon'):
            c=bpy.data.collections.new(name)
            scene.collection.children.link(c)
            collections.append(c)
        terrain=json.loads((ROOT/'public/impostors/kl_headland.json').read_text())
        for k in range(12):
            name=f'wall{k:02}'
            coords=np.load(work/(name+'.npy'))
            mat=material(work,name)
            for step,suffix,c in zip((1,2,4),('','_mid','_lo'),collections):
                obj=mesh_lod(coords,step,name+suffix,mat,c)
                if step==1:
                    obj['heightPatch']=collision_patch(obj)
                    obj['centre']=[float(terrain['cx']),float(terrain['cz'])]
        add_exposures(work,scans,collections,[float(terrain['cx']),float(terrain['cz'])])
        add_grotto(work,collections,[float(terrain['cx']),float(terrain['cz'])])
        for name in ('Cove_Wall','Cove_Split_Slab','Cove_Foreground_Skerry'):
            coords=np.load(work/(name+'.npy'))
            mat=material(work,name)
            for step,suffix,c in zip((1,2,4),('','_mid','_lo'),collections):
                obj=mesh_lod(coords,step,name+suffix,mat,c,close_shell=True)
                if step==1:
                    obj['heightPatch']=collision_patch(obj)
                    obj['centre']=[float(terrain['cx']),float(terrain['cz'])]
        bake_exposure(collections)
        bpy.ops.export_scene.gltf(export_vertex_color='ACTIVE',filepath=str(EXPORT),export_format='GLB',use_active_scene=True,
            export_extras=True,export_image_format='AUTO',export_meshopt_compression_enable=True,
            export_meshopt_extension='EXT_meshopt_compression')
        for c in collections[1:]:
            c.hide_viewport=True
            c.hide_render=True
        bpy.data.libraries.write(str(SOURCE),{scene},compress=True)
        # Isolate the authored scene and save it with a framing suitable for inspection.
        finish=f"import runpy;runpy.run_path({__file__!r})['finish_project']()"
        subprocess.run([bpy.app.binary_path,'-b',str(SOURCE),'--python-exit-code','1',
                        '--python-expr',finish],check=True)
        print('Built',EXPORT,EXPORT.stat().st_size,flush=True)
    finally:
        bpy.context.window.scene=previous
        authored=set().union(*(set(getattr(bpy.data,kind))-original[kind] for kind in types))
        bpy.data.batch_remove(authored)


if __name__=='__main__':
    build(*(Path(v) for v in sys.argv[sys.argv.index('--')+1:]))
