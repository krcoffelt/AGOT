"""Reference-led silhouette, grooming and material pass on the natural-neck rider."""
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
R=random.Random(91126)
bpy.ops.wm.open_mainfile(filepath=str(OUT/'daemon_rider_natural_neck.blend'),load_ui=False)
sc=bpy.context.scene
root=bpy.data.objects['DAEMON | standing study']
head=bpy.data.objects['Daemon | anatomical head and neck - sculpt surface']
hair=bpy.data.collections['V2 | Fitted swept-back silver grooming']
def g(x,c,w):return math.exp(-((x-c)/w)**2)

# A firmer brow and less rounded lower cheeks follow the supplied character.
for v in head.data.vertices:
    x,y,z=v.co
    front=max(0,min(1,(-y-.085)/.045))
    v.co.y-=.0016*g(abs(x),.025,.021)*g(z,1.887,.010)*front
    v.co.z-=.0013*g(abs(x),.021,.014)*g(z,1.887,.010)*front
    v.co.y+=.0014*g(abs(x),.055,.020)*g(z,1.819,.020)*front
    v.co.x*=1+.022*g(abs(x),.061,.017)*g(z,1.779,.018)*front
    v.co.z-=.0014*g(abs(x),.033,.014)*g(z,1.875,.0045)*front
head.data.update()
bpy.context.view_layer.update()
tree=BVHTree.FromObject(head,bpy.context.evaluated_depsgraph_get())
center=Vector((0,-.025,1.885))
def scalp(d,lift=.002):
    d=Vector(d).normalized()
    p,n,_,_=tree.ray_cast(center+d*.30,-d,.40)
    return p+n*lift if p is not None else center+d*.10
def hairline(a):
    a=abs((a+math.pi)%(2*math.pi)-math.pi)
    keys=[(0,1.15),(.30,1.00),(.60,1.04),(1,1.25),(1.57,1.58),(2,2.02),(math.pi,2.25)]
    for (a0,v0),(a1,v1) in zip(keys,keys[1:]):
        if a<=a1:
            t=(a-a0)/(a1-a0);t=t*t*(3-2*t)
            return v0*(1-t)+v1*t
    return keys[-1][1]

for ob in list(hair.objects):
    if ob.type=='CURVES':bpy.data.objects.remove(ob,do_unlink=True)
underlay=bpy.data.objects['Hair | anatomical root surface and irregular hairline']
underlay.data.materials[0].node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.16,.155,.145,1)

def fibre_material(name,color,rough=.30):
    mat=bpy.data.materials.new(name);mat.use_nodes=True;mat.diffuse_color=(*color,1)
    n,l=mat.node_tree.nodes,mat.node_tree.links;n.clear()
    out=n.new('ShaderNodeOutputMaterial');bs=n.new('ShaderNodeBsdfHairPrincipled')
    bs.model='HUANG';bs.parametrization='COLOR'
    bs.inputs['Roughness'].default_value=rough
    if bs.inputs.get('Radial Roughness'):bs.inputs['Radial Roughness'].default_value=.36
    if bs.inputs.get('Random Roughness'):bs.inputs['Random Roughness'].default_value=.20
    bs.inputs['Aspect Ratio'].default_value=.90
    bs.inputs['Reflection'].default_value=.60
    info=n.new('ShaderNodeHairInfo')
    tint=n.new('ShaderNodeValToRGB')
    tint.color_ramp.elements[0].color=(*[c*.64 for c in color],1)
    tint.color_ramp.elements[1].color=(*[min(1,c*1.17) for c in color],1)
    l.new(info.outputs['Random'],tint.inputs[0])
    rootshade=n.new('ShaderNodeValToRGB')
    rootshade.color_ramp.elements[0].color=(.35,.35,.35,1)
    rootshade.color_ramp.elements[1].color=(1,1,1,1)
    rootshade.color_ramp.elements[1].position=.22
    l.new(info.outputs['Intercept'],rootshade.inputs[0])
    mix=n.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1
    l.new(tint.outputs[0],mix.inputs[1]);l.new(rootshade.outputs[0],mix.inputs[2])
    l.new(mix.outputs[0],bs.inputs['Color']);l.new(bs.outputs[0],out.inputs['Surface'])
    return mat
silver=fibre_material('REFERENCE | cool platinum fine hair',(.60,.58,.53),.29)
ivory=fibre_material('REFERENCE | ivory highlight locks',(.78,.75,.69),.28)
shadow=fibre_material('REFERENCE | ash silver lowlights',(.28,.27,.24),.34)
def fibres(name,paths,radius,mat):
    coords=np.asarray(paths,dtype=np.float32)
    if name.startswith('Hair |') and coords.shape[1]>20:
        # Stagger the follicles over a few millimetres to break the blunt
        # comb-tooth edge that identical guide start positions would produce.
        count,length=coords.shape[:2]
        starts=np.asarray([0 if R.random()<.20 else R.uniform(.08,1.35) for _ in paths],dtype=np.float32)
        indices=starts[:,None]+(length-1-starts[:,None])*np.linspace(0,1,length)[None,:]
        low=np.floor(indices).astype(np.int32);high=np.minimum(low+1,length-1)
        fraction=(indices-low)[:,:,None]
        rows=np.arange(count)[:,None]
        coords=coords[rows,low,:]*(1-fraction)+coords[rows,high,:]*fraction
        blend=np.clip((np.arange(coords.shape[1])/(coords.shape[1]-1)-.42)/.22,0,1)[None,:,None]
        blend[:,0,:]=blend[:,-1,:]=0
        for _ in range(18):
            relaxed=coords.copy()
            relaxed[:,1:-1,:]=.22*coords[:,:-2,:]+.56*coords[:,1:-1,:]+.22*coords[:,2:,:]
            coords=coords*(1-blend)+relaxed*blend
    cu=bpy.data.hair_curves.new(name)
    cu.add_curves([len(p) for p in paths])
    cu.attributes['position'].data.foreach_set('vector',np.asarray(coords,dtype=np.float32).ravel())
    rad=cu.attributes.new('radius','FLOAT','POINT')
    values=[]
    for path in paths:
        scale=R.uniform(.74,1.26)
        values.extend(radius*scale*(.05+.95*(1-i/(len(path)-1))**.63)*(min(1,.25+.75*i/1.8) if name.startswith('Hair |') else 1) for i in range(len(path)))
    rad.data.foreach_set('value',values)
    ob=bpy.data.objects.new(name,cu);hair.objects.link(ob);ob.parent=root;cu.materials.append(mat)
    return ob

# Every swept lock continues down the back, removing the old horizontal root
# seam. Fine fibres have physical diameters around 50–70 microns.
groups=[[],[],[]]
for j in range(180):
    side=-.982+1.964*j/179
    lo,hi=-.12,1.30
    for _ in range(24):
        u=(lo+hi)/2
        theta=math.acos(math.sqrt(1-side*side)*math.sin(u))
        a=math.atan2(side,math.sqrt(1-side*side)*math.cos(u))
        if theta>hairline(a):lo=u
        else:hi=u
    start=(lo+hi)/2+R.uniform(-.012,.008)
    points=[]
    clump=math.sin(j*2.39)
    for k in range(42):
        t=k/41
        u=start+(2.62-start)*t
        s=side*(1-.18*math.sin(math.pi*t))+.008*math.sin(t*math.pi)*math.sin(j*.37)
        s=max(-.989,min(.989,s))
        d=(s,-math.sqrt(1-s*s)*math.cos(u),math.sqrt(1-s*s)*math.sin(u))
        rootfade=min(1,t/.08)
        rootfade=rootfade*rootfade*(3-2*rootfade)
        lift=.0012+rootfade*(.0055+.0035*(.5+.5*clump))*g(t,.16,.23)+.0015*math.sin(math.pi*t)**2
        points.append(scalp(d,lift))
    end_z=1.685+R.random()*.115+.025*(1-abs(side))
    begin=points[-1].copy()
    end_x=begin.x*.76+.003*math.sin(j*.9)
    for k in range(1,17):
        t=k/16
        x=begin.x*(1-t)+end_x*t+.0017*math.sin(t*2*math.pi+j)*math.sin(math.pi*t)
        z=begin.z*(1-t)+end_z*t
        p,n,_,_=tree.ray_cast(Vector((x,.38,z)),Vector((0,-1,0)),.6)
        back=(p.y+.006 if p is not None else .088)
        y=max(back,begin.y*(1-t)+(.098+.009*math.sin(j*.4))*t)
        points.append(Vector((x,y,z)))
    for f in range(72):
        dx=R.uniform(-.00095,.00095)
        depth=R.uniform(-.0002,.0014)
        phase=R.uniform(0,2*math.pi)
        end_var=R.uniform(-.013,.013)
        path=[]
        for k,p in enumerate(points):
            t=k/(len(points)-1)
            normal=(p-center).normalized() if k<42 else Vector((0,1,.04)).normalized()
            wave=.00020*math.sin(t*8*math.pi+phase)*math.sin(math.pi*t)
            q=p+normal*(depth*math.sin(math.pi*t)**.5+wave)
            q+=Vector((dx+.00016*math.sin(t*5*math.pi+phase),.00015*math.cos(t*4*math.pi+phase),end_var*max(0,(t-.65)/.35)**2))
            path.append(q)
        bucket=2 if (j%15 in {0,1} and f%3!=0) else 1 if j%7==0 else 0
        groups[bucket].append(path)
for name,paths,rad,mat in zip(
    ['Hair | reference continuous swept locks','Hair | reference ivory glints','Hair | reference shadow clumps'],
    groups,[.000030,.000027,.000029],[silver,ivory,shadow]):
    fibres(name,paths,rad,mat)

# Overlapping locks begin at varied heights behind the temples, keeping a
# shoulder-length silver silhouette without a horizontal curtain seam.
side_locks=[]
for sign in [-1,1]:
    for j in range(75):
        a=sign*R.uniform(1.72,2.48)
        theta=R.uniform(.62,1.55)
        theta_end=R.uniform(1.76,2.11)
        side_width=R.uniform(.073,.086)
        guide=[]
        for k in range(22):
            th=theta+(theta_end-theta)*k/21
            p=scalp((math.sin(th)*math.sin(a),-math.sin(th)*math.cos(a),math.cos(th)),.002+R.uniform(0,.0007))
            blend=max(0,min(1,(th-1.30)/.5));blend=blend*blend*(3-2*blend)
            p.x=sign*(abs(p.x)*(1-blend)+max(abs(p.x),side_width)*blend)
            p.y=p.y*(1-blend)+max(p.y,.067)*blend
            guide.append(p)
        begin=guide[-1].copy()
        end_x=sign*min(abs(begin.x),R.uniform(.064,.081))
        end_z=R.uniform(1.68,1.77)
        for k in range(1,15):
            t=k/14;x=begin.x*(1-t)+end_x*t
            z=begin.z*(1-t)+end_z*t
            p,n,_,_=tree.ray_cast(Vector((x,.38,z)),Vector((0,-1,0)),.6)
            y=max(p.y+.007 if p is not None else .083,begin.y*(1-t)+.10*t)
            guide.append(Vector((x,y,z)))
        for f in range(40):
            dx=R.uniform(-.0013,.0013);dy=R.uniform(-.001,.002)
            phase=R.uniform(0,2*math.pi);tip=R.uniform(-.01,.01)
            side_locks.append([p+Vector((dx+.0003*math.sin(k*.38+phase),dy,tip*(k/(len(guide)-1))**3)) for k,p in enumerate(guide)])
fibres('Hair | reference overlapping temple and nape locks',side_locks,.000033,ivory)

# Short irregular wisps soften the hairline without a comb-tooth fringe.
wisps=[]
for j in range(260):
    a=R.uniform(-1.5,1.5);th=hairline(a)+R.uniform(-.016,.015)
    p=scalp((math.sin(th)*math.sin(a),-math.sin(th)*math.cos(a),math.cos(th)),.0014)
    sweep=Vector((-.002*math.sin(a),.018,R.uniform(.001,.006)))
    wisps.append([p,p+sweep*.25+Vector((0,-.0008,.0008)),p+sweep*.65+Vector((0,0,.0014)),p+sweep])
fibres('Hair | reference fine irregular hairline wisps',wisps,.000020,silver)
browmat=fibre_material('REFERENCE | ash blond brows',(.032,.028,.021),.55)
brows=[]
for sign in [-1,1]:
    for j in range(420):
        t=R.random();x=sign*(.012+.044*t)
        z=1.8855+.006*t-.0015*t*t+.0008*math.sin(math.pi*t)+R.uniform(-.0015,.0015)
        p,n,_,_=tree.ray_cast(Vector((x,-.32,z)),Vector((0,1,0)),.4)
        if p is not None:
            p+=n*.0003
            brows.append([p,p+Vector((sign*.0009,-.0001,.0009)),p+Vector((sign*.0020,.0000,.0015))])
fibres('Brows | reference stern ash-blond brows',brows,.000060,browmat)

def warp_points(ob,fn):
    world=ob.matrix_world;inv=world.inverted()
    if ob.type=='MESH':
        for v in ob.data.vertices:v.co=inv@fn(world@v.co)
        ob.data.update()
    elif ob.type=='CURVES':
        attr=ob.data.attributes['position']
        arr=np.empty(len(attr.data)*3,dtype=np.float32);attr.data.foreach_get('vector',arr)
        arr=arr.reshape((-1,3))
        for i,p in enumerate(arr):arr[i]=inv@fn(world@Vector(p))
        attr.data.foreach_set('vector',arr.ravel())
    elif ob.type=='CURVE':
        for spline in ob.data.splines:
            if spline.type=='BEZIER':
                for p in spline.bezier_points:p.co=inv@fn(world@p.co)
            else:
                for p in spline.points:p.co=(*(inv@fn(world@Vector(p.co[:3]))),p.co[3])

# The mantle lies along the sloping shoulder rather than forming a round pad.
def fur_warp(p):
    x,y,z=p
    return Vector((-.197+(x+.204)*.91,.007+(y-.004)*.83,1.586+(z-1.593)*.60+.52*(x+.204)))
for ob in list(sc.objects):
    if ob.name.startswith(('Fur |','Mantle |')):warp_points(ob,fur_warp)
    if ob.name.startswith('Pauldron |'):
        if ob.type=='MESH':points=[ob.matrix_world@v.co for v in ob.data.vertices]
        elif ob.type=='CURVE':points=[ob.matrix_world@p.co for s in ob.data.splines for p in s.bezier_points]
        else:points=[]
        if points and sum(p.x for p in points)/len(points)<0:
            ob.hide_render=True
            ob.hide_set(True)
    if ob.type=='CURVE' and any(mat and mat.name.startswith(('Armour |','Hardware |')) for mat in ob.data.materials):
        points=[ob.matrix_world@p.co for s in ob.data.splines for p in s.bezier_points]
        if points and sum(p.x for p in points)/len(points)<-.18 and min(p.z for p in points)>1.33 and max(p.z for p in points)<1.70:
            ob.hide_render=True;ob.hide_set(True)
for mat in bpy.data.materials:
    if 'sable fibres' in mat.name:
        for node in mat.node_tree.nodes:
            if node.bl_idname=='ShaderNodeBsdfHairPrincipled':
                node.model='HUANG';node.inputs['Reflection'].default_value=.46
                node.inputs['Roughness'].default_value=.54
            elif node.bl_idname=='ShaderNodeValToRGB':
                for e in node.color_ramp.elements:
                    r,gc,b,a=e.color
                    if abs(r-gc)>.001:e.color=(r*.52,gc*.52,b*.52,a)

# Reduce the cape's exaggerated spread and give its velvet broader folds.
cape=bpy.data.objects['Crimson cloak | deep radial drapery']
for v in cape.data.vertices:
    t=max(0,min(1,(1.622-v.co.z)/1.566))
    v.co.x*=1-.26*t**1.20
cape.data.update()
normals=[v.normal.copy() for v in cape.data.vertices]
for v,n in zip(cape.data.vertices,normals):
    x,y,z=v.co;t=max(0,min(1,(1.622-z)/1.566))
    a=math.atan2(x,y*.8)
    fold=.009*(.25+.75*t)*math.sin(17*a+.6*math.sin(3*a)+t*.8)+.003*t*math.sin(31*a-t)
    v.co+=n*fold
cape.data.update()
for ob in sc.objects:
    if ob.name.startswith('Cape | rolled selvage'):
        pts=ob.data.splines[0].bezier_points;j=0 if pts[0].co.x<0 else 104
        for i,p in enumerate(pts):p.co=cape.data.vertices[i*105+j].co
    elif ob.name.startswith('Cape | weighted hem'):
        for j,p in enumerate(ob.data.splines[0].bezier_points):p.co=cape.data.vertices[64*105+j].co

# A front fall of velvet comes from beneath the fur, as in the reference.
# Its outside edge is sewn to the existing cloak rather than floating beside it.
left_j=0 if cape.data.vertices[0].co.x<0 else 104
verts=[];faces=[];cols=25
for i in range(65):
    t=i/64
    outside=cape.data.vertices[i*105+left_j].co.copy()
    inside=Vector((-.121-.112*t,-.108*(1-t)+.035*t-.023*math.sin(math.pi*t),outside.z-.025*(1-t)))
    for j in range(cols):
        u=j/(cols-1)
        p=outside.lerp(inside,u)
        p.y-=.022*math.sin(math.pi*u)*math.sin(math.pi*t*.8)
        p.y+=.010*(.3+.7*t)*math.sin(5*math.pi*u+.65*t)*math.sin(math.pi*u)
        verts.append(tuple(p))
for i in range(64):
    for j in range(cols-1):
        k=i*cols+j;faces.append((k,k+cols,k+cols+1,k+1))
data=bpy.data.meshes.new('Reference cloak front fall')
data.from_pydata(verts,[],faces);data.update()
data.materials.append(bpy.data.materials['V3 | scanned wine velour velvet - 4K'])
data.materials.append(bpy.data.materials['V3 | scanned deep-wine cloak lining - 4K'])
panel=bpy.data.objects.new('Cape | reference drape from fur shoulder',data)
cape.users_collection[0].objects.link(panel);panel.parent=root
for p in data.polygons:p.use_smooth=True
uv=data.uv_layers.new(name='Garment UV')
for face in data.polygons:
    for li in face.loop_indices:
        idx=data.loops[li].vertex_index;i,j=divmod(idx,cols)
        uv.data[li].uv=(j/(cols-1)*.26/.30,(1.64-verts[idx][2])/.30)
sub=panel.modifiers.new('Weighted velvet folds','SUBSURF');sub.levels=sub.render_levels=1
solid=panel.modifiers.new('Woven cloak thickness and lining','SOLIDIFY');solid.thickness=.0035;solid.material_offset=1
curve=bpy.data.curves.new('Reference front cloak selvage','CURVE');curve.dimensions='3D';curve.bevel_depth=.0017;curve.bevel_resolution=2
spline=curve.splines.new('POLY');spline.points.add(64)
for i,p in enumerate(spline.points):p.co=(*verts[i*cols+cols-1],1)
edge=bpy.data.objects.new('Cape | bound edge of reference front drape',curve);cape.users_collection[0].objects.link(edge);edge.parent=root
curve.materials.append(bpy.data.materials['V3 | scanned deep-wine cloak lining - 4K'])
def skirt_warp(p):
    x,y,z=p;t=max(0,min(1,(1.19-z)/.843))
    front=max(0,min(1,(-y-.02)/.08))
    z+=(.020 if x<0 else -.055)*t**3*front
    return Vector((x*(1-.15*t),y*(1-.04*t),z))
for ob in sc.objects:
    if ob.name.startswith(('Coat | asymmetric riding skirts','Coat | rolled split edges','Coat | narrow weighted hem')):
        warp_points(ob,skirt_warp)

# The reference's small dark angular buckle is quieter than a bright round ring.
buckle=bpy.data.objects.get('Belt | forged buckle')
if buckle:
    points=[p.co.copy() for s in buckle.data.splines for p in s.bezier_points]
    if points:
        c=sum(points,Vector())/len(points)
        data=bpy.data.curves.new('Angular forged riding buckle','CURVE');data.dimensions='3D';data.bevel_depth=.0018;data.bevel_resolution=3
        s=data.splines.new('POLY');s.points.add(3);s.use_cyclic_u=True
        for p,(x,z) in zip(s.points,[(-.019,-.012),(.016,-.017),(.019,.012),(-.016,.017)]):p.co=(c.x+x,c.y,c.z+z,1)
        data.materials.append(bpy.data.materials['Armour | blackened steel']);buckle.data=data

def brooch_warp(p):
    c=Vector((0,-.145,1.56));d=p-c
    return c+Vector((d.x*.70,d.y*.82,d.z*.70))
for ob in sc.objects:
    if ob.name.startswith(('Gorget | central dragon seal','Gorget | seal recessed field','Seal |')):
        warp_points(ob,brooch_warp)
bridge=bpy.data.objects.get('Gorget | articulated central bridge')
if bridge:
    def bridge_warp(p):
        d=math.sqrt(p.x*p.x+(p.z-1.56)**2)
        t=max(0,min(1,(d-.03)/.085));t=t*t*(3-2*t)
        return brooch_warp(p).lerp(p,t)
    warp_points(bridge,bridge_warp)

# A slightly narrower head follows the reference's leaner facial proportions.
def head_width(p):return Vector((p.x*.95,p.y,p.z))
for collection in [bpy.data.collections['V2 | Anatomical head and eyes'],hair]:
    for ob in collection.objects:warp_points(ob,head_width)
def nape_fit(p):
    if p.y>.035:
        t=max(0,min(1,(1.91-p.z)/.19));t=t*t*(3-2*t)
        return Vector((p.x*(1-.22*t),.06+(p.y-.06)*(1-.28*t),p.z))
    return p
for ob in hair.objects:
    if ob.type=='CURVES' and ob.name.startswith('Hair |'):warp_points(ob,nape_fit)
def collar_width(p):
    t=max(0,min(1,(p.z-1.652)/.05));t=t*t*(3-2*t)
    return Vector((p.x*(1-.04*t),p.y,p.z))
for ob in sc.objects:
    if ob.name.startswith('Collar |'):warp_points(ob,collar_width)

# Skin retains its vertex complexion and gains restrained roughness variation.
for mat in bpy.data.materials:
    if mat.name=='V3 | scanned wine velour velvet - 4K':
        for node in mat.node_tree.nodes:
            if node.bl_idname=='ShaderNodeHueSaturation':node.inputs['Value'].default_value=.24
skin=bpy.data.materials['V2 | skin - layered complexion']
n,l=skin.node_tree.nodes,skin.node_tree.links
bs=next(node for node in n if node.bl_idname=='ShaderNodeBsdfPrincipled')
bs.inputs['Roughness'].default_value=.48
bs.inputs['Specular IOR Level'].default_value=.28
bs.inputs['Subsurface Weight'].default_value=.065
old=bs.inputs['Base Color'].links[0].from_socket
tex=n.new('ShaderNodeTexNoise');tex.inputs['Scale'].default_value=115;tex.inputs['Detail'].default_value=3
ramp=n.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].color=(.76,.78,.80,1);ramp.color_ramp.elements[1].color=(.98,1.0,1.01,1)
l.new(tex.outputs['Fac'],ramp.inputs[0])
mix=n.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1
l.new(old,mix.inputs[1]);l.new(ramp.outputs[0],mix.inputs[2]);l.new(mix.outputs[0],bs.inputs['Base Color'])
rough=n.new('ShaderNodeMapRange');rough.inputs['To Min'].default_value=.39;rough.inputs['To Max'].default_value=.55
l.new(tex.outputs['Fac'],rough.inputs[0]);l.new(rough.outputs[0],bs.inputs['Roughness'])

# Neutral studio presentation follows the reference's grey backdrop.
world=sc.world;world.use_nodes=True;n,l=world.node_tree.nodes,world.node_tree.links;n.clear()
out=n.new('ShaderNodeOutputWorld');env=n.new('ShaderNodeBackground');env.inputs[0].default_value=(.035,.037,.041,1);env.inputs[1].default_value=.25
camera_bg=n.new('ShaderNodeBackground');camera_bg.inputs[0].default_value=(.15,.16,.16,1)
path=n.new('ShaderNodeLightPath');mix=n.new('ShaderNodeMixShader')
l.new(path.outputs['Is Camera Ray'],mix.inputs[0]);l.new(env.outputs[0],mix.inputs[1]);l.new(camera_bg.outputs[0],mix.inputs[2]);l.new(mix.outputs[0],out.inputs[0])
for ob in sc.objects:
    if ob.type=='LIGHT':
        name=ob.name.upper()
        if 'KEY' in name:
            ob.location=(-2.5,-3.5,5.0)
            ob.rotation_euler=(Vector((0,0,1.35))-ob.location).to_track_quat('-Z','Y').to_euler()
            ob.data.size=1.5
        elif 'FILL' in name:ob.data.energy=45
        elif 'RIM' in name:ob.data.energy=330
        elif 'FRONT' in name:ob.data.energy=12
    if 'plinth' in ob.name.lower():ob.hide_render=True
ground=bpy.data.objects.get('Studio ground')
if ground:
    ground.location.z=0
    for mat in ground.data.materials:
        bs=next((n for n in mat.node_tree.nodes if n.bl_idname=='ShaderNodeBsdfPrincipled'),None)
        if bs:
            bs.inputs['Base Color'].default_value=(.12,.13,.13,1)
            bs.inputs['Roughness'].default_value=.85
            bs.inputs['Emission Color'].default_value=(.065,.070,.070,1)
            bs.inputs['Emission Strength'].default_value=1

sc.render.engine='CYCLES';sc.cycles.samples=24 if DRAFT else 80;sc.cycles.use_denoising=True
try:
    prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='METAL';prefs.get_devices()
    for d in prefs.devices:d.use=d.type=='METAL'
    if any(d.type=='METAL' for d in prefs.devices):sc.cycles.device='GPU'
except Exception:pass
studio=bpy.data.collections['07 | Studio - cameras and lights']
specs=[
    ('Reference full figure',(.7,-8,2.16),(-.01,0,1.0),2.22,(1100,1500),'full'),
    ('Reference portrait',(.14,-3.8,1.90),(0,-.012,1.795),.57,(1050,1200),'portrait'),
    ('Reference three quarter',(2.4,-3.8,1.92),(0,0,1.79),.59,(1050,1200),'angle'),
    ('Reference side',(3.8,-.18,1.88),(0,0,1.78),.57,(1050,1200),'side'),
]
cameras=[]
for name,loc,target,scale,size,suffix in specs:
    data=bpy.data.cameras.new('REFERENCE | '+name);data.type='ORTHO';data.ortho_scale=scale
    cam=bpy.data.objects.new(data.name,data);studio.objects.link(cam);cam.location=loc
    cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler();cameras.append(cam)
for cam,spec in zip(cameras,specs):
    if DRAFT and spec[5]=='side':continue
    sc.camera=cam;sc.render.resolution_x,sc.render.resolution_y=spec[4];sc.render.resolution_percentage=60 if DRAFT else 100
    sc.render.filepath=str(OUT/('daemon_reference_'+('draft_' if DRAFT else '')+spec[5]+'.png'))
    print('Rendering',spec[0],flush=True);bpy.ops.render.render(write_still=True)

sc.camera=cameras[0];sc.render.resolution_x,sc.render.resolution_y=specs[0][4];sc.render.resolution_percentage=100
sc.render.filepath=str(OUT/'daemon_reference_full.png')
if not DRAFT:
    assert not [i for i in bpy.data.images if i.source=='FILE' and not i.packed_file]
    bpy.data.texts['START HERE | Rider study'].write('\nREFERENCE SILHOUETTE PASS\nRetains the corrected compact natural neck. New fine-fibre swept-back\nsilver hair overlaps behind the temples and narrows at the nape. The fur\nmantle is flattened and slopes over the left shoulder; the right shoulder\narmour remains exposed. A new velvet front fall hangs from under the fur.\nThe cape and asymmetric coat skirts have less flare, with smaller chest\nhardware and an angular dark buckle. The face is slightly leaner with a\nfirmer brow. All scanned garment images and the reference remain packed.\n')
    root['revision']='Reference pass: compact natural neck, continuous fine swept-back hair, sloping dark fur mantle, narrower cloak and riding coat.'
    (OUT/'daemon_reference_manifest.json').write_text(json.dumps({
        'hair_strands':{o.name:len(o.data.curves) for o in hair.objects if o.type=='CURVES'},
        'packed_images':len([i for i in bpy.data.images if i.packed_file]),
        'review_images':['daemon_reference_'+s[5]+'.png' for s in specs]
    },indent=2)+'\n')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/('daemon_rider_reference_draft.blend' if DRAFT else 'daemon_rider_reference.blend')),compress=True)
print('Saved reference silhouette and groom pass.',flush=True)
