"""Rebuild the swept groom and forged armour; tailor the textile to the reference."""
import bpy
import bmesh
import math
import random
import sys
import json
import numpy as np
from pathlib import Path
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

OUT=Path('/Users/kylecoffelt/Desktop/GameOfThrones/assets-src/riders')
DRAFT='--draft' in sys.argv
R=random.Random(1111226)
bpy.ops.wm.open_mainfile(filepath=str(OUT/'daemon_rider_reference.blend'),load_ui=False)
sc=bpy.context.scene
root=bpy.data.objects['DAEMON | standing study']
head=bpy.data.objects['Daemon | anatomical head and neck - sculpt surface']
hair=bpy.data.collections['V2 | Fitted swept-back silver grooming']
detail=bpy.data.collections.new('V5 | Reference forged armour and textile details')
sc.collection.children.link(detail)
PI=math.pi
def smooth(t):
    t=max(0,min(1,t));return t*t*(3-2*t)
def bezier(a,b,c,d,t):return a*(1-t)**3+b*(3*(1-t)**2*t)+c*(3*(1-t)*t*t)+d*t**3

def mesh_object(name,verts,faces,mat,thickness=0,sub=0):
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update()
    if mat:mesh.materials.append(mat)
    ob=bpy.data.objects.new(name,mesh);detail.objects.link(ob);ob.parent=root
    for p in mesh.polygons:p.use_smooth=True
    if sub:
        m=ob.modifiers.new('Sculpted plate curvature','SUBSURF');m.levels=m.render_levels=sub
    if thickness:
        m=ob.modifiers.new('Forged sheet thickness','SOLIDIFY');m.thickness=thickness;m.offset=-1
        m=ob.modifiers.new('Rounded forged edges','BEVEL');m.width=.0006;m.segments=3
    return ob
def curves(name,paths,radius,mat,cyclic=False):
    cu=bpy.data.curves.new(name,'CURVE');cu.dimensions='3D';cu.bevel_depth=radius;cu.bevel_resolution=3
    for path in paths:
        sp=cu.splines.new('POLY');sp.points.add(len(path)-1);sp.use_cyclic_u=cyclic
        for p,co in zip(sp.points,path):p.co=(*co,1)
    ob=bpy.data.objects.new(name,cu);detail.objects.link(ob);ob.parent=root;cu.materials.append(mat)
    return ob
def fibres(name,paths,radius,mat,collection):
    coords=np.asarray(paths,dtype=np.float32)
    count,length=coords.shape[:2]
    if name.startswith('Hair |') and length>20:
        starts=np.asarray([R.uniform(0,1.1) if R.random()>.20 else 0 for _ in paths])
        indices=starts[:,None]+(length-1-starts[:,None])*np.linspace(0,1,length)[None,:]
        lo=np.floor(indices).astype(np.int32);hi=np.minimum(lo+1,length-1);f=(indices-lo)[:,:,None]
        rows=np.arange(count)[:,None]
        coords=coords[rows,lo,:]*(1-f)+coords[rows,hi,:]*f
    cu=bpy.data.hair_curves.new(name);cu.add_curves([length]*count)
    cu.attributes['position'].data.foreach_set('vector',np.asarray(coords,dtype=np.float32).ravel())
    rad=cu.attributes.new('radius','FLOAT','POINT')
    profile=np.asarray([(.045+.955*(1-i/(length-1))**.65)*min(1,.25+.75*i/1.6) for i in range(length)])
    variation=np.asarray([R.uniform(.72,1.25) for _ in paths])
    rad.data.foreach_set('value',np.asarray(radius*variation[:,None]*profile[None,:],dtype=np.float32).ravel())
    ob=bpy.data.objects.new(name,cu);collection.objects.link(ob);ob.parent=root;cu.materials.append(mat)
    return ob

# Hair follows a backward vector field rather than constant-X circles around
# the temple. The controls lift front locks over the crown and side locks
# slightly upward before they pass behind the ear.
tree=BVHTree.FromObject(head,bpy.context.evaluated_depsgraph_get())
center=Vector((0,-.025,1.885))
def scalp(direction,lift=.001):
    d=Vector(direction).normalized()
    p,n,_,_=tree.ray_cast(center+d*.30,-d,.40)
    return p+n*lift if p is not None else center+d*.10
def hairline(a):
    a=abs(a)
    keys=[(0,1.12),(.30,1.015),(.60,1.065),(1.0,1.27),(1.6,1.59)]
    for (a0,b0),(a1,b1) in zip(keys,keys[1:]):
        if a<=a1:
            t=smooth((a-a0)/(a1-a0));return b0*(1-t)+b1*t
    return keys[-1][1]
for ob in list(hair.objects):
    if ob.type=='CURVES' and ob.name.startswith('Hair |'):bpy.data.objects.remove(ob,do_unlink=True)
materials=[bpy.data.materials['REFERENCE | cool platinum fine hair'],bpy.data.materials['REFERENCE | ivory highlight locks'],bpy.data.materials['REFERENCE | ash silver lowlights']]
for mat in materials:
    for node in mat.node_tree.nodes:
        if node.bl_idname=='ShaderNodeBsdfHairPrincipled':
            node.inputs['Roughness'].default_value=.31
            node.inputs['Reflection'].default_value=.68
        elif node.bl_idname=='ShaderNodeValToRGB' and len(node.inputs[0].links) and node.inputs[0].links[0].from_socket.name=='Intercept':
            node.color_ramp.elements[0].color=(.53,.53,.53,1)

def guide_from_dirs(d0,d1,d2,d3,end_z,phase):
    guide=[]
    height=R.uniform(.004,.009)
    for k in range(38):
        t=k/37;direction=bezier(d0,d1,d2,d3,t).normalized()
        lift=.001+height*math.sin(PI*t)**.7*math.exp(-((t-.28)/.42)**2)
        guide.append(scalp(direction,lift))
    start=guide[-1]
    tangent=(guide[-1]-guide[-3]).normalized()
    end=Vector((start.x*.94,max(.098,start.y*.94)+R.uniform(-.003,.003),end_z))
    c1=start+tangent*.025
    c2=end+Vector((.003*math.sin(phase),.005,.045))
    for k in range(1,19):
        t=k/18
        p=bezier(start,c1,c2,end,t)
        # Keep the free tail outside the back of the head.
        skin,n,_,_=tree.ray_cast(Vector((p.x,.36,p.z)),Vector((0,-1,0)),.6)
        if skin is not None and p.y<skin.y+.004:p.y=skin.y+.004
        guide.append(p)
    return guide
def lock_fibres(guide,count,spread):
    output=[]
    normals=[];bins=[]
    for k,p in enumerate(guide):
        t=(guide[min(k+1,len(guide)-1)]-guide[max(0,k-1)]).normalized()
        n=(p-center).normalized() if k<38 else Vector((0,1,0))
        b=t.cross(n).normalized()
        normals.append(n);bins.append(b)
    for f in range(count):
        width=R.uniform(-spread,spread);depth=R.uniform(-.00025,.0011)
        phase=R.uniform(0,2*PI);end_jitter=R.uniform(-.012,.012)
        path=[]
        for k,p in enumerate(guide):
            t=k/(len(guide)-1)
            gather=1-.40*math.sin(PI*t)
            path.append(p+bins[k]*(width*gather+.00017*math.sin(6*PI*t+phase))+normals[k]*(depth+.00012*math.sin(9*PI*t+phase))+Vector((0,0,end_jitter*max(0,(t-.72)/.28)**2)))
        output.append(path)
    return output

groups=[[],[],[]]
for j in range(240):
    a=-1.59+3.18*j/239+R.uniform(-.003,.003)
    theta=hairline(a)+R.uniform(-.007,.007)
    d0=Vector((math.sin(theta)*math.sin(a),-math.sin(theta)*math.cos(a),math.cos(theta)))
    front=max(0,math.cos(a))**2
    d1=(d0+Vector((0,.70,.24+.45*front))).normalized()
    d2=Vector((d0.x*.72,.55,.24+.65*front)).normalized()
    d3=Vector((d0.x*.82,.94,R.uniform(-.02,.16))).normalized()
    guide=guide_from_dirs(d0,d1,d2,d3,R.uniform(1.69,1.785),j*.7)
    bucket=2 if j%19 in {0,1} else 1 if j%8==0 else 0
    groups[bucket].extend(lock_fibres(guide,76,.00125))
for j in range(100):
    a=R.uniform(1.60,4.68);theta=R.uniform(.25,1.30)
    d0=Vector((math.sin(theta)*math.sin(a),-math.sin(theta)*math.cos(a),math.cos(theta)))
    d1=(d0+Vector((0,.3,-.18))).normalized()
    d3=Vector((d0.x*.88,.95,R.uniform(-.05,.12))).normalized()
    d2=(d3+Vector((0,0,.25))).normalized()
    guide=guide_from_dirs(d0,d1,d2,d3,R.uniform(1.67,1.79),j)
    groups[1 if j%7==0 else 0].extend(lock_fibres(guide,62,.00115))
# Loose lower layers grow across the whole rear scalp, including below the
# occiput. They cover the undercut-looking gap and fall independently of the
# upper swept locks rather than gathering into a single tied nape.
for j in range(175):
    a=R.uniform(1.63,4.65);theta=R.uniform(1.22,2.04)
    d=Vector((math.sin(theta)*math.sin(a),-math.sin(theta)*math.cos(a),math.cos(theta)))
    start=scalp(d,.0014)
    end_x=math.copysign(min(.077,abs(start.x)*.98),start.x)
    end=Vector((end_x,max(.085,start.y*.95)+.006,R.uniform(1.665,1.765)))
    c1=start+Vector((0,.006,-.026))
    c2=end+Vector((R.uniform(-.003,.003),.002,.042))
    guide=[bezier(start,c1,c2,end,t) for t in np.linspace(0,1,56)]
    bucket=1 if j%9==0 else 2 if j%31==0 else 0
    groups[bucket].extend(lock_fibres(guide,42,.00115))
for label,paths,mat in zip(['silver swept guides','ivory separated locks','shadowed root locks'],groups,materials):
    fibres('Hair | V5 '+label,paths,.000031,mat,hair)
wisps=[]
for j in range(380):
    a=R.uniform(-1.58,1.58);theta=hairline(a)+R.uniform(-.015,.018)
    d0=Vector((math.sin(theta)*math.sin(a),-math.sin(theta)*math.cos(a),math.cos(theta)))
    d1=(d0+Vector((0,.23,.12))).normalized()
    wisps.append([scalp(d0.lerp(d1,t).normalized(),.0009+.0018*math.sin(PI*t)) for t in np.linspace(0,1,9)])
fibres('Hair | V5 fine hairline wisps',wisps,.000018,materials[0],hair)
print('Rebuilt directional swept hair without temple loops.',flush=True)

# Neutral blackened steel and fine wear replace broad bright ornamental wires.
steel=bpy.data.materials.new('V5 | hammered blackened steel');steel.use_nodes=True;steel.diffuse_color=(.045,.052,.060,1)
n,l=steel.node_tree.nodes,steel.node_tree.links
bs=n.get('Principled BSDF');bs.inputs['Metallic'].default_value=1;bs.inputs['Roughness'].default_value=.46
noise=n.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=175;noise.inputs['Detail'].default_value=3
ramp=n.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].color=(.022,.023,.025,1);ramp.color_ramp.elements[1].color=(.087,.090,.094,1)
l.new(noise.outputs['Fac'],ramp.inputs[0]);l.new(ramp.outputs[0],bs.inputs['Base Color'])
rough=n.new('ShaderNodeMapRange');rough.inputs['To Min'].default_value=.34;rough.inputs['To Max'].default_value=.56
l.new(noise.outputs['Fac'],rough.inputs[0]);l.new(rough.outputs[0],bs.inputs['Roughness'])
bump=n.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.15;bump.inputs['Distance'].default_value=.00013
l.new(noise.outputs['Fac'],bump.inputs['Height']);l.new(bump.outputs[0],bs.inputs['Normal'])
edge=bpy.data.materials.new('V5 | dark worn steel edges');edge.use_nodes=True;edge.diffuse_color=(.16,.17,.18,1)
bs=edge.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(.16,.17,.18,1);bs.inputs['Metallic'].default_value=1;bs.inputs['Roughness'].default_value=.42
incised=bpy.data.materials.new('V5 | dark incised metal');incised.use_nodes=True
bs=incised.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(.009,.011,.014,1);bs.inputs['Metallic'].default_value=.8;bs.inputs['Roughness'].default_value=.58
for ob in list(sc.objects):
    for slot in ob.material_slots:
        if slot.material and slot.material.name=='Armour | blackened steel':slot.material=steel
    if ob.type=='CURVE':
        if ob.name.startswith('Gorget | articulated central bridge'):ob.data.bevel_depth=.0025
        elif ob.name.startswith('Gorget | rolled and inset'):ob.data.bevel_depth=.0009
        elif ob.name.startswith('Gorget | chased'):ob.data.bevel_depth=.00045
        elif ob.name.startswith('Vambrace | engraved'):ob.data.bevel_depth=.00048;ob.data.materials.clear();ob.data.materials.append(incised)
        elif ob.name.startswith('Vambrace | rolled cuff'):ob.data.bevel_depth=.0013
    if ob.name.startswith('Pewter rivet') and abs(ob.location.x)>.16 and 1.33<ob.location.z<1.73:
        bpy.data.objects.remove(ob,do_unlink=True)
        continue
    if ob.name.startswith(('Pauldron |','Lame |')):
        if ob.type=='MESH':points=[ob.matrix_world@v.co for v in ob.data.vertices]
        elif ob.type=='CURVE':points=[ob.matrix_world@p.co for s in ob.data.splines for p in s.bezier_points]
        else:points=[]
        if points and sum(p.x for p in points)/len(points)>0:bpy.data.objects.remove(ob,do_unlink=True)

# The new main plate has an angular deltoid outline, a fitted front and back,
# and an open underside. Its three narrow lames overlap below it.
def plate_z(z):return 1.54+(z-1.54)*.88-.009
outline=[(x,plate_z(z)) for x,z in [(.184,1.643),(.208,1.664),(.262,1.646),(.311,1.610),(.333,1.561),(.320,1.532),(.283,1.538),(.236,1.554),(.196,1.582)]]
def contour(t):
    q=t*len(outline);i=int(q)%len(outline);u=q-int(q)
    a,b,c,d=[Vector(outline[k%len(outline)]) for k in [i-1,i,i+1,i+2]]
    return .5*(2*b+(-a+c)*u+(2*a-5*b+4*c-d)*u*u+(-a+3*b-3*c+d)*u*u*u)
N=128;M=20;rim=[contour(j/N) for j in range(N)];center_xz=Vector((.258,plate_z(1.600)))
right_sleeve=next(o for o in sc.objects if o.name.startswith('Coat | fitted sleeve') and sum(v.co.x for v in o.data.vertices)>0)
sleeve_tree=BVHTree.FromObject(right_sleeve,bpy.context.evaluated_depsgraph_get())
def armour_y(x,z,back=False):
    profile=math.sqrt(max(.11,1-((x-.255)/.106)**2))
    longitudinal=math.sqrt(max(.15,1-((z-1.584)/.084)**2))
    y=(.072*profile*longitudinal+.008) if back else -(.075*profile*longitudinal+.009)
    hit,_,_,_=sleeve_tree.ray_cast(Vector((x,.35 if back else -.35,z)),Vector((0,-1 if back else 1,0)),.7)
    if hit is not None:y=max(y,hit.y+.010) if back else min(y,hit.y-.010)
    return y
def patch(back=False):
    verts=[(center_xz.x,armour_y(*center_xz,back),center_xz.y)]
    for i in range(1,M+1):
        t=i/M
        for p in rim:
            q=center_xz.lerp(p,t);verts.append((q.x,armour_y(*q,back),q.y))
    faces=[]
    for j in range(N):faces.append((0,1+j,1+(j+1)%N))
    for i in range(M-1):
        for j in range(N):
            a=1+i*N+j;b=1+i*N+(j+1)%N;faces.append((a,a+N,b+N,b))
    ob=mesh_object('Armour V5 | shaped shoulder '+('rear' if back else 'front'),verts,faces,steel,.0027,1)
    bm=bmesh.new();bm.from_mesh(ob.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    avg=sum(f.normal.y for f in bm.faces)
    if (avg<0 if back else avg>0):bmesh.ops.reverse_faces(bm,faces=list(bm.faces))
    bm.to_mesh(ob.data);bm.free()
    return ob
front=patch();rear=patch(True)
verts=[];faces=[]
for j,p in enumerate(rim):
    for k in range(9):
        t=k/8;y=armour_y(*p)*(1-t)+armour_y(*p,True)*t
        verts.append((p.x,y,p.y+.019*math.sin(PI*t)))
for j in range(N):
    if min(rim[j].y,rim[(j+1)%N].y)<plate_z(1.558):continue
    for k in range(8):
        a=j*9+k;b=((j+1)%N)*9+k;faces.append((a,b,b+1,a+1))
mesh_object('Armour V5 | shoulder crown bridge',verts,faces,steel,.0027,1)
for inset,mat,radius in [(0,edge,.00095),(.045,incised,.00045)]:
    points=[]
    for p in rim:
        q=p.lerp(center_xz,inset);points.append((q.x,armour_y(*q)-.0008,q.y))
    curves('Armour V5 | fine forged shoulder border',[points],radius,mat,True)

def stud(name,position,radius=.0019):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=8,radius=radius,location=position)
    ob=bpy.context.object;ob.name=name
    for c in list(ob.users_collection):c.objects.unlink(ob)
    detail.objects.link(ob);ob.parent=root;ob.scale.y=.50;ob.data.materials.append(edge)
    for p in ob.data.polygons:p.use_smooth=True
for index in [5,24,42,63,90,112]:
    q=rim[index].lerp(center_xz,.09);stud('Armour V5 | shoulder flush rivet',(q.x,armour_y(*q)-.0015,q.y))

# Fine scroll cutting and a raised shield-shaped inset follow the curved plate.
engraving=[]
for sign in [-1,1]:
    pts=[]
    for j in range(70):
        t=j/69;a=PI*(.18+2.20*t);r=.022*(1-.72*t)
        x=.258+sign*(.018+r*math.cos(a));z=plate_z(1.604+.026*math.sin(a)*(1-.6*t))
        pts.append((x,armour_y(x,z)-.0007,z))
    engraving.append(pts)
curves('Armour V5 | cut shoulder scrollwork',engraving,.00047,incised)
for scale,mat,radius in [(1,edge,.00065),(.84,incised,.00038)]:
    cartouche=[]
    for j in range(96):
        a=2*PI*j/96;x=.263+.015*scale*math.sin(a);z=plate_z(1.607+.019*scale*math.cos(a))
        cartouche.append((x,armour_y(x,z)-.0010,z))
    curves('Armour V5 | oval shoulder cartouche',[cartouche],radius,mat,True)
motifs=[]
for sign in [-1,1]:
    path=[]
    for j in range(40):
        t=j/39;x=.263+sign*(.0045*math.sin(PI*t)+.001*t);z=plate_z(1.594+.025*t)
        path.append((x,armour_y(x,z)-.0013,z))
    motifs.append(path)
curves('Armour V5 | crest cutting within cartouche',motifs,.00042,edge)
for i in range(3):
    n=96;levels=[0,.045,.25,.80,.96,1];verts=[];faces=[]
    ztop=1.548-.044*i
    for t in levels:
        z=ztop-.053*t
        arm_t=(1.556-z)/.278;cx=.228+.084*arm_t;cy=-.006-.022*arm_t
        for j in range(n):
            a=2*PI*j/n
            rx=.081-.004*i-.002*t;ry=.075-.003*i-.002*t
            scallop=t**3*(-.005*math.cos(a)**2+.002*math.cos(3*a))
            point_z=z+scallop
            local_t=(1.556-point_z)/.278
            origin=Vector((.228+.084*local_t,-.006-.022*local_t,point_z))
            radial=Vector((rx*math.sin(a),-ry*math.cos(a),0))
            direction=radial.normalized()
            hit,_,_,distance=sleeve_tree.ray_cast(origin+direction*.18,-direction,.18)
            outer_radius=.18-distance if hit is not None else 0
            radius=max(radial.length,outer_radius+.006)
            verts.append(tuple(origin+direction*radius))
    for row in range(len(levels)-1):
        for j in range(n):
            a=row*n+j;b=row*n+(j+1)%n;faces.append((a,b,b+n,a+n))
    faces=[tuple(reversed(f)) for f in faces]
    mesh_object('Armour V5 | overlapping shoulder lame '+str(i),verts,faces,steel,.0022,1)
    bottom=[verts[(len(levels)-1)*n+j] for j in range(n)]
    curves('Armour V5 | fine lame lower rim',[bottom],.00075,edge,True)
    for a in [-.65,.65]:
        z=ztop-.021;at=(1.556-z)/.278
        origin=Vector((.228+.084*at,-.006-.022*at,z))
        radial=Vector(((.081-.004*i)*math.sin(a),-(.075-.003*i)*math.cos(a),0));direction=radial.normalized()
        hit,_,_,distance=sleeve_tree.ray_cast(origin+direction*.18,-direction,.18)
        outer_radius=.18-distance if hit is not None else 0
        radius=max(radial.length,outer_radius+.006)
        stud('Armour V5 | lame pivot',origin+direction*radius+Vector((0,-.001,0)),.0017)
print('Replaced rounded shoulder armour with shaped sheet, narrow lames and fine cutting.',flush=True)

# The reference coat reads as an irregular, close-packed red weave. Keep the
# packed scan for fibre normals and roughness, replacing its floral dye motif.
coat=bpy.data.materials['V3 | scanned burgundy jacquard - 4K']
n,l=coat.node_tree.nodes,coat.node_tree.links
bs=next(x for x in n if x.bl_idname=='ShaderNodeBsdfPrincipled')
uv=n.new('ShaderNodeUVMap');uv.uv_map='Garment UV'
warp=n.new('ShaderNodeTexNoise');warp.inputs['Scale'].default_value=40;warp.inputs['Detail'].default_value=2;l.new(uv.outputs[0],warp.inputs['Vector'])
offset=n.new('ShaderNodeVectorMath');offset.operation='SUBTRACT';offset.inputs[1].default_value=(.5,.5,.5);l.new(warp.outputs['Color'],offset.inputs[0])
scale=n.new('ShaderNodeVectorMath');scale.operation='SCALE';scale.inputs['Scale'].default_value=.005;l.new(offset.outputs[0],scale.inputs[0])
add=n.new('ShaderNodeVectorMath');add.operation='ADD';l.new(uv.outputs[0],add.inputs[0]);l.new(scale.outputs[0],add.inputs[1])
xyz=n.new('ShaderNodeSeparateXYZ');l.new(add.outputs[0],xyz.inputs[0])
def math_node(op,*inputs):
    node=n.new('ShaderNodeMath');node.operation=op
    for i,v in enumerate(inputs):
        if isinstance(v,(float,int)):node.inputs[i].default_value=v
        else:l.new(v,node.inputs[i])
    return node.outputs[0]
u=math_node('MULTIPLY',xyz.outputs['X'],41)
v=math_node('MULTIPLY',xyz.outputs['Y'],43)
row=math_node('FLOOR',v);parity=math_node('PINGPONG',row,1)
u=math_node('ADD',u,math_node('MULTIPLY',parity,.5))
fu=math_node('FRACT',u);fv=math_node('FRACT',v)
au=math_node('ABSOLUTE',math_node('SUBTRACT',math_node('MULTIPLY',fu,2),1))
av=math_node('ABSOLUTE',math_node('SUBTRACT',math_node('MULTIPLY',fv,2),1))
pu=math_node('POWER',math_node('SUBTRACT',1,au),.30)
pv=math_node('POWER',math_node('SUBTRACT',1,av),.35)
puff=math_node('MULTIPLY',pu,pv)
noise=n.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=235;noise.inputs['Detail'].default_value=3;l.new(uv.outputs[0],noise.inputs['Vector'])
irregular=math_node('MULTIPLY',puff,math_node('ADD',.62,math_node('MULTIPLY',noise.outputs['Fac'],.60)))
red=n.new('ShaderNodeValToRGB')
red.color_ramp.elements[0].position=.12;red.color_ramp.elements[0].color=(.010,.0005,.0010,1)
red.color_ramp.elements[1].position=.95;red.color_ramp.elements[1].color=(.145,.009,.015,1)
e=red.color_ramp.elements.new(.55);e.color=(.070,.0028,.0060,1)
l.new(irregular,red.inputs[0]);l.new(red.outputs[0],bs.inputs['Base Color']);l.new(red.outputs[0],bs.inputs['Sheen Tint'])
bs.inputs['Sheen Weight'].default_value=.30
normal=next(node for node in n if node.bl_idname=='ShaderNodeNormalMap');normal.inputs['Strength'].default_value=.45
bump=n.new('ShaderNodeBump');bump.inputs['Distance'].default_value=.00038;bump.inputs['Strength'].default_value=.45
l.new(puff,bump.inputs['Height']);l.new(normal.outputs[0],bump.inputs['Normal']);l.new(bump.outputs[0],bs.inputs['Normal'])
rough=n.new('ShaderNodeMapRange');rough.inputs['To Min'].default_value=.43;rough.inputs['To Max'].default_value=.72
l.new(noise.outputs['Fac'],rough.inputs[0]);l.new(rough.outputs[0],bs.inputs['Roughness'])
coat['revision']='Reference red woven texture: staggered irregular yarn cells; original packed scan retained for fibre normal and roughness detail.'

# Less regular cloth folds on the front fall of the cloak.
panel=bpy.data.objects['Cape | reference drape from fur shoulder']
cols=25
for vertex in panel.data.vertices:
    row,j=divmod(vertex.index,cols);t=row/64;u=j/24
    envelope=math.sin(PI*u)*smooth(t/.16)
    vertex.co.y+=envelope*(.012+.009*t)*math.sin(6*PI*u+.42*math.sin(2*PI*t))
    vertex.co.z+=.008*t**4*math.sin(5*PI*u)*math.sin(PI*u)
panel.data.update()
print('Reference weave and less regular velvet folds applied.',flush=True)

# Seat the clasp on the coat. The earlier study left its back almost 4 cm
# above the garment, which made both the clasp and the bridge cast floating shadows.
torso=bpy.data.objects['Quilted riding coat | torso']
torso_tree=BVHTree.FromObject(torso,bpy.context.evaluated_depsgraph_get())
brooch=[o for o in sc.objects if o.name.startswith(('Gorget | central dragon seal','Gorget | seal recessed field','Seal |'))]
world_points=[o.matrix_world@v.co for o in brooch if o.type=='MESH' for v in o.data.vertices]
back=max(p.y for p in world_points)
hit,_,_,_=torso_tree.ray_cast(Vector((0,-.4,1.56)),Vector((0,1,0)),.8)
new_back=hit.y-.0015
fit=Matrix.Identity(4);fit[1][1]=.55;fit[1][3]=new_back-.55*back
for ob in brooch:ob.matrix_world=fit@ob.matrix_world
body_trees=[torso_tree]+[BVHTree.FromObject(o,bpy.context.evaluated_depsgraph_get()) for o in sc.objects if o.name.startswith('Armour | angular clavicle')]
bridge=bpy.data.objects.get('Gorget | articulated central bridge')
if bridge:
    for spline in bridge.data.splines:
        for p in spline.bezier_points:
            x,y,z=p.co
            hits=[t.ray_cast(Vector((x,-.4,z)),Vector((0,1,0)),.8)[0] for t in body_trees]
            hits=[h for h in hits if h is not None]
            if hits:
                surface=min(h.y for h in hits)-.0027
                center_weight=1-smooth((math.sqrt(x*x+(z-1.56)**2)-.020)/.035)
                p.co.y=surface*(1-center_weight)+min(surface,new_back-.010)*center_weight

# Fine sewn margins and two small metal retainers make the baldric read as leather.
thread=bpy.data.materials.new('V5 | dark waxed linen thread');thread.use_nodes=True
bs=thread.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(.022,.014,.010,1);bs.inputs['Roughness'].default_value=.78
for ob in sc.objects:
    if ob.type=='CURVE' and ob.name.startswith('Baldric |'):
        ob.data.bevel_depth=min(ob.data.bevel_depth,.0005);ob.data.materials.clear();ob.data.materials.append(thread)
baldric=bpy.data.objects['Baldric | diagonal leather strap']
points=np.asarray([(baldric.matrix_world@v.co)[:] for v in baldric.data.vertices])
centerline=Vector(points.mean(axis=0));_,_,axes=np.linalg.svd(points-points.mean(axis=0),full_matrices=False)
axis=Vector(axes[0]);axis=axis if axis.z>0 else -axis
across=axis.cross(Vector((0,-1,0))).normalized()
extent=[(Vector(p)-centerline).dot(axis) for p in points]
width=max(abs((Vector(p)-centerline).dot(across)) for p in points)
strap_tree=BVHTree.FromObject(baldric,bpy.context.evaluated_depsgraph_get())
def strap_point(s,w):
    p=centerline+axis*s+across*w
    hit,_,_,_=strap_tree.ray_cast(Vector((p.x,-.4,p.z)),Vector((0,1,0)),.8)
    if hit is not None:p.y=hit.y-.0006
    return p
stitches=[]
for sign in [-1,1]:
    for s in np.arange(min(extent)+.012,max(extent)-.010,.0042):
        stitches.append([strap_point(s,sign*width*.78),strap_point(s+.0020,sign*width*.78)])
curves('Baldric V5 | individually sewn leather margins',stitches,.00017,thread)
for fraction in [.35,.64]:
    s=min(extent)+(max(extent)-min(extent))*fraction
    path=[strap_point(s+ds,dw)+Vector((0,-.001,0)) for ds,dw in [(-.0065,-width*.98),(-.0065,width*.98),(.0065,width*.98),(.0065,-width*.98)]]
    curves('Baldric V5 | small forged strap keeper',[path],.00095,edge,True)

# The long loose belt end is a visible part of the reference costume.
buckle=bpy.data.objects['Belt | forged buckle']
bp=[Vector(p.co[:3]) for spline in buckle.data.splines for p in spline.points]
if not bp:bp=[p.co.copy() for spline in buckle.data.splines for p in spline.bezier_points]
belt_center=sum(bp,Vector())/len(bp)
def belt_tail_point(t,u):
    width=.032*(1-.14*t);twist=.16*math.sin(PI*t)
    x=belt_center.x-.011-.019*math.sin(.65*PI*t)+u*width*math.cos(twist)
    y=belt_center.y+.003-.014*math.sin(PI*t)+.013*t+u*width*math.sin(twist)
    z=belt_center.z-.006-.515*t+.014*(2*abs(u))**2*t**10
    return Vector((x,y,z))
us=[-.5,-.47,-.33,-.16,0,.16,.33,.47,.5];rows=81;verts=[];faces=[]
for i in range(rows):
    for u in us:verts.append(tuple(belt_tail_point(i/(rows-1),u)))
for i in range(rows-1):
    for j in range(len(us)-1):
        k=i*len(us)+j;faces.append((k,k+len(us),k+len(us)+1,k+1))
drop=mesh_object('Belt V5 | hanging stitched leather end',verts,faces,bpy.data.materials['V3 | scanned dyed worn hide - 4K'],.0024,1)
uv=drop.data.uv_layers.new(name='Garment UV')
for p in drop.data.polygons:
    for li in p.loop_indices:
        idx=drop.data.loops[li].vertex_index;i,j=divmod(idx,len(us))
        uv.data[li].uv=((us[j]+.5)*.032/.40,i/(rows-1)*.515/.40)
stitches=[]
for sign in [-1,1]:
    for t in np.arange(.022,.97,.012):
        stitches.append([belt_tail_point(t,sign*.40)+Vector((0,-.0013,0)),belt_tail_point(t+.0055,sign*.40)+Vector((0,-.0013,0))])
curves('Belt V5 | loose-end saddle stitching',stitches,.00017,thread)

# A light layer of long guard hairs gives the flattened mantle a shaggy edge.
foundation=bpy.data.objects['Fur | dense mantle foundation']
dg=bpy.context.evaluated_depsgraph_get();eval_ob=foundation.evaluated_get(dg)
furmesh=bpy.data.meshes.new_from_object(eval_ob,depsgraph=dg);furmesh.transform(foundation.matrix_world);furmesh.calc_loop_triangles()
triangles=list(furmesh.loop_triangles)
areas=np.asarray([t.area for t in triangles]);cdf=np.cumsum(areas);cdf/=cdf[-1]
furmat=bpy.data.materials.new('V5 | grizzled mantle guard hair');furmat.use_nodes=True
n,l=furmat.node_tree.nodes,furmat.node_tree.links;n.clear()
out=n.new('ShaderNodeOutputMaterial');bs=n.new('ShaderNodeBsdfHairPrincipled');bs.model='HUANG';bs.parametrization='COLOR'
bs.inputs['Roughness'].default_value=.53;bs.inputs['Reflection'].default_value=.5
info=n.new('ShaderNodeHairInfo');ramp=n.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].color=(.008,.006,.004,1);ramp.color_ramp.elements[1].color=(.16,.125,.09,1)
ramp.color_ramp.elements[1].position=.92;l.new(info.outputs['Intercept'],ramp.inputs[0]);l.new(ramp.outputs[0],bs.inputs['Color']);l.new(bs.outputs[0],out.inputs['Surface'])
paths=[]
for guide_index in range(260):
    triangle=triangles[int(np.searchsorted(cdf,R.random()))]
    a,b,c=[furmesh.vertices[i].co.copy() for i in triangle.vertices]
    u=math.sqrt(R.random());v=R.random();p=a*(1-u)+b*(u*(1-v))+c*(u*v)
    normal=triangle.normal.copy()
    if normal.y>.3 and normal.z<.1:continue
    gravity=Vector((-.35,-.12,-1));flow=gravity-normal*gravity.dot(normal)
    if flow.length<.01:flow=Vector((-.5,0,-.1))
    flow.normalize();length=R.uniform(.033,.070);bend=Vector((R.uniform(-.009,.009),R.uniform(-.006,.006),0))
    guide=[p+flow*(length*t)+normal*(.001+.005*math.sin(PI*t))+bend*math.sin(PI*t)+Vector((0,0,-.004*t*t)) for t in np.linspace(0,1,10)]
    for j in range(36):
        jitter=Vector((R.uniform(-.0017,.0017),R.uniform(-.0017,.0017),R.uniform(-.001,.001)))
        phase=R.uniform(0,2*PI)
        paths.append([q+jitter*(1-.50*t)+normal*.0003*math.sin(5*PI*t+phase) for q,t in zip(guide,np.linspace(0,1,10))])
fibres('Mantle | V5 separated grizzled guard-hair tufts',paths,.000055,furmat,detail)
bpy.data.meshes.remove(furmesh)

sc.render.engine='CYCLES';sc.cycles.samples=24 if DRAFT else 96;sc.cycles.use_denoising=True
try:
    prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='METAL';prefs.get_devices()
    for d in prefs.devices:d.use=d.type=='METAL'
    if any(d.type=='METAL' for d in prefs.devices):sc.cycles.device='GPU'
except Exception:pass
specs=[('REFERENCE | Reference full figure','full',(1100,1500)),('REFERENCE | Reference portrait','portrait',(1100,1250)),('REFERENCE | Reference side','side',(1100,1250)),('REFERENCE | Reference three quarter','angle',(1100,1250)),('REVIEW | Clothing material detail','clothing',(1400,1150))]
for name,suffix,size in specs:
    if DRAFT and suffix in {'angle','clothing'}:continue
    sc.camera=bpy.data.objects[name];sc.render.resolution_x,sc.render.resolution_y=size;sc.render.resolution_percentage=65 if DRAFT else 100
    sc.render.filepath=str(OUT/('daemon_detail_'+('draft_' if DRAFT else '')+suffix+'.png'))
    print('Rendering detail review',suffix,flush=True);bpy.ops.render.render(write_still=True)
sc.camera=bpy.data.objects[specs[0][0]];sc.render.resolution_x,sc.render.resolution_y=specs[0][2];sc.render.resolution_percentage=100
sc.render.filepath=str(OUT/'daemon_detail_full.png')
if not DRAFT:
    assert not [im for im in bpy.data.images if im.source=='FILE' and not im.packed_file]
    bpy.data.texts['START HERE | Rider study'].write('\nDETAILED REFERENCE PASS\nA new backward hair flow replaces circular temple paths, with loose\nlower layers across the rear scalp. The right shoulder has a fitted\nsteel shell, thin overlapping lames, oval cartouche, scroll cutting and\nflush pivots. The coat has irregular red yarn cells over the packed scan\nnormal detail. The mantle has long separated grizzled guard-hair tufts.\nThe clasp sits against the coat; the baldric has sewn margins and small\nkeepers, and a stitched leather belt end hangs from the waist buckle.\nFive detail-review views use Cycles. All source maps remain packed.\n')
    for mat in [steel,edge,incised,coat,furmat,thread]:
        tree=mat.node_tree;depths={}
        def depth(node,trail=None):
            if node in depths:return depths[node]
            trail=set() if trail is None else trail
            if node in trail:return 0
            incoming=[link.from_node for socket in node.inputs for link in socket.links]
            depths[node]=1+max((depth(q,trail|{node}) for q in incoming),default=-1)
            return depths[node]
        columns={}
        for node in tree.nodes:columns.setdefault(depth(node),[]).append(node)
        for col,nodes in columns.items():
            y=0
            for node in nodes:
                node.location=(col*290,y);node.width=235
                y-=720 if node.bl_idname=='ShaderNodeBsdfPrincipled' else 330
    root['revision']='Directional swept-back groom, fitted forged shoulder plates, irregular red weave, velvet folds and shaggy fur guard tufts.'
    (OUT/'daemon_detail_manifest.json').write_text(json.dumps({'hair_grooms':{o.name:len(o.data.curves) for o in hair.objects if o.type=='CURVES'},'packed_images':len([i for i in bpy.data.images if i.packed_file]),'review_images':['daemon_detail_'+s[1]+'.png' for s in specs]},indent=2)+'\n')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/('daemon_rider_detail_draft.blend' if DRAFT else 'daemon_rider_detail.blend')),compress=True)
print('Saved detailed rider review.',flush=True)
