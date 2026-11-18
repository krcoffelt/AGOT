"""Second dragon-rider study, built and rendered with Blender's own Python API.

The anatomical head starts from Blender Studio's CC0 Human Base Meshes v1.4.1.
The costume, grooming, and character changes are specific to this project.
Run with Blender --background --python this_file -- [--portrait] [--draft].
"""
import bpy
import bmesh
import math
import os
import random
import sys
from math import sin, cos, pi, exp, sqrt
from mathutils import Vector, Matrix, Euler
from mathutils.bvhtree import BVHTree

PROJECT = '/Users/kylecoffelt/Desktop/GameOfThrones'
OUT = PROJECT + '/assets-src/riders'
LIB = OUT + '/reference-assets/human-base-meshes-bundle-v1.4.1/human_base_meshes_bundle.blend'
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
RNG = random.Random(408)
FACE_OFFSET = .0303767


def collection(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


def material(name, color, rough=.5, metal=0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    return m


def mesh(name, vs, fs, mat, sub=0, solid=0, coll=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(vs, [], fs)
    me.update()
    ob = bpy.data.objects.new(name, me)
    (coll or DETAIL).objects.link(ob)
    ob.parent = ROOT
    if mat:
        me.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = True
    if sub:
        q = ob.modifiers.new('Surface refinement', 'SUBSURF')
        q.levels = sub
        q.render_levels = sub
    if solid:
        q = ob.modifiers.new('Material thickness', 'SOLIDIFY')
        q.thickness = solid
    return ob


def curves(name, paths, radius, mat, coll=None, resolution=3, bevel=2):
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.resolution_u = resolution
    cu.bevel_depth = radius
    cu.bevel_resolution = bevel
    for points in paths:
        sp = cu.splines.new('BEZIER')
        sp.bezier_points.add(len(points) - 1)
        for i, (bp, p) in enumerate(zip(sp.bezier_points, points)):
            bp.co = p
            bp.handle_left_type = bp.handle_right_type = 'AUTO'
            bp.radius = .14 + .86 * sin(pi * (i + .3) / (len(points) - .4)) ** .4
    ob = bpy.data.objects.new(name, cu)
    (coll or DETAIL).objects.link(ob)
    ob.parent = ROOT
    cu.materials.append(mat)
    return ob


def fibres(name, paths, radius, mat, coll):
    """Native hair curves: real tapered fibre primitives, with no bevelled tube meshes."""
    if name.startswith('Hair'):
        smooth_paths = []
        for path in paths:
            if len(path) >= 8:
                smooth_paths.append(path); continue
            pts = []
            for i in range(len(path) - 1):
                a, b, c, d = (Vector(path[max(0, i-1)]), Vector(path[i]), Vector(path[i+1]), Vector(path[min(len(path)-1, i+2)]))
                for j in range(5):
                    t = j / 5
                    pts.append(.5 * (2*b + (-a+c)*t + (2*a-5*b+4*c-d)*t*t + (-a+3*b-3*c+d)*t*t*t))
            pts.append(path[-1]); smooth_paths.append(pts)
        paths = smooth_paths
    cu = bpy.data.hair_curves.new(name)
    cu.add_curves([len(p) for p in paths])
    cu.attributes['position'].data.foreach_set('vector', [v for path in paths for p in path for v in p])
    rad = cu.attributes.new('radius', 'FLOAT', 'POINT')
    values = []
    for path in paths:
        r = radius * RNG.uniform(.7, 1.3)
        for i in range(len(path)):
            values.append(r * (.08 + .92 * (1 - i / (len(path) - 1)) ** .65))
    rad.data.foreach_set('value', values)
    ob = bpy.data.objects.new(name, cu); coll.objects.link(ob); ob.parent = ROOT
    cu.materials.append(mat)
    return ob


def fibre_material(name, color, rough=.38):
    m = bpy.data.materials.new(name); m.diffuse_color = (*color, 1); m.use_nodes = True
    n, l = m.node_tree.nodes, m.node_tree.links; n.clear()
    out = n.new('ShaderNodeOutputMaterial'); p = n.new('ShaderNodeBsdfHairPrincipled')
    p.parametrization = 'COLOR'; p.inputs['Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = rough; p.inputs['Radial Roughness'].default_value = .45
    p.inputs['Random Roughness'].default_value = .30
    if any(word in name for word in ['platinum hair','ivory guard','silver lowlight']):
        p.model='HUANG';p.inputs['Aspect Ratio'].default_value=.85
        p.inputs['Reflection'].default_value=.75
    info = n.new('ShaderNodeHairInfo')
    root = n.new('ShaderNodeValToRGB'); root.color_ramp.elements[0].color = (.56, .56, .56, 1); root.color_ramp.elements[1].color = (1.07, 1.07, 1.07, 1)
    root.color_ramp.elements[1].position = .65; l.new(info.outputs['Intercept'], root.inputs[0])
    rand = n.new('ShaderNodeValToRGB'); rand.color_ramp.elements[0].color = (*[v*.83 for v in color], 1); rand.color_ramp.elements[1].color = (*[min(1,v*1.12) for v in color], 1)
    l.new(info.outputs['Random'], rand.inputs[0])
    multiply = n.new('ShaderNodeMixRGB'); multiply.blend_type = 'MULTIPLY'; multiply.inputs[0].default_value = 1
    l.new(root.outputs['Color'], multiply.inputs[1]); l.new(rand.outputs['Color'], multiply.inputs[2]); l.new(multiply.outputs[0], p.inputs['Color'])
    l.new(p.outputs[0], out.inputs['Surface'])
    return m


def gaussian(x, center, radius):
    return exp(-((x - center) / radius) ** 2)


def make_head():
    names = ['GEO-body_male_realistic' + suffix for suffix in ['', '.eye.R', '.eye.L']]
    with bpy.data.libraries.load(LIB, link=False) as (src, dst):
        dst.objects = list(names)
    obs = list(dst.objects)
    head = next(o for o in obs if o.name == names[0])
    for o in obs:
        HEAD.objects.link(o)
        o.hide_set(False)
        o.hide_render = False
        for q in o.modifiers:
            if q.type == 'MULTIRES':
                q.levels = min(3, q.total_levels)
                q.render_levels = min(3, q.total_levels)
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    # Measured source landmarks: chin underside ~1.447 m; crown 1.6844 m.
    # Put the complete chin at 1.744 m and the neck axis at Y=0.
    transform = Matrix.Translation(Vector((0, 0, 1.744))) @ Matrix.Scale(1.10, 4) @ Matrix.Translation(Vector((2.2643022537, 0, -1.447)))
    for o in obs:
        evaluated = o.evaluated_get(dg)
        me = bpy.data.meshes.new_from_object(evaluated, depsgraph=dg)
        me.transform(transform @ o.matrix_world)
        o.modifiers.clear()
        o.parent = ROOT
        o.matrix_world = Matrix.Identity(4)
        o.data = me
        o.data.materials.clear()
        for p in me.polygons:
            p.use_smooth = True
        if o is head:
            bm = bmesh.new()
            bm.from_mesh(me)
            bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces), dist=.00001,
                                  plane_co=(0, 0, 1.736), plane_no=(0, 0, 1), clear_inner=True)
            border = [e for e in bm.edges if e.is_boundary and all(abs(v.co.z - 1.736) < .0001 for v in e.verts)]
            if border:
                bmesh.ops.holes_fill(bm, edges=border, sides=0)
            bm.to_mesh(me)
            bm.free()
            boundary=[v.co for v in me.vertices if abs(v.co.z-1.736)<.0001]
            cy=(min(v.y for v in boundary)+max(v.y for v in boundary))/2
            rx=max(abs(v.x) for v in boundary)+.004;ry=(max(v.y for v in boundary)-min(v.y for v in boundary))/2+.004
            factor=max(sqrt((v.x/rx)**2+((v.y-cy)/ry)**2) for v in boundary)+.05
            o['collar_fit']=[rx*factor,ry*factor,cy]
            o.name = 'Daemon | anatomical head and neck - sculpt surface'
            o.data.materials.append(SKIN)
            # Restrained character edits: broader lower jaw, a firmer brow and cheek planes.
            for v in me.vertices:
                x, y, z = v.co
                front = max(0, min(1, (-y - .008) / .05))
                v.co.x *= 1 + .035 * gaussian(z, 1.742+FACE_OFFSET, .026)
                v.co.y -= front * (.0035 * gaussian(abs(x), .033, .022) * gaussian(z, 1.866+FACE_OFFSET, .012)
                                   + .0013 * gaussian(abs(x), .050, .020) * gaussian(z, 1.815+FACE_OFFSET, .016))
                v.co.z -= front * .0018 * gaussian(abs(x), .017, .011) * gaussian(z, 1.865+FACE_OFFSET, .009)
                v.co.z -= front * .0027 * gaussian(abs(x), .034, .019) * gaussian(z, 1.865+FACE_OFFSET, .006)
                v.co.z += front * .0010 * gaussian(abs(x), .034, .017) * gaussian(z, 1.842+FACE_OFFSET, .004)
                v.co.y += front * .0013 * gaussian(x, 0, .022) * gaussian(z, 1.777+FACE_OFFSET, .008)
            add_skin_colors(o)
            o['source'] = 'Blender Studio Human Base Meshes v1.4.1, CC0, realistic male anatomy; head extracted, transformed and edited.'
            o['purpose'] = 'Anatomical starting point for an original dragon-rider character, not a completed actor likeness.'
        elif '.sclera.' in o.name or '.eye.' in o.name:
            o.name = 'Anatomical eye | sclera ' + o.name[-1]
            o.data.materials.append(SCLERA)
            xs = [v.co.x for v in me.vertices]; zs = [v.co.z for v in me.vertices]
            cx, cz = (min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2
            uv = me.uv_layers.new(name='Eye projection')
            for p in me.polygons:
                for li in p.loop_indices:
                    v = me.vertices[me.loops[li].vertex_index].co
                    uv.data[li].uv = (.5 + (v.x - cx) / .026, .5 + (v.z - cz) / .026)
        else:
            o.name = 'Anatomical eye | iris ' + o.name[-1]
            o.data.materials.append(IRIS)
            o.hide_render = True  # The source iris sits behind an uncut cornea; use the projected eye shader.
            o.hide_set(True)
            # UV-like coordinates in the disk's local bounding rectangle for radial iris detail.
            uv = me.uv_layers.new(name='Iris radial')
            xs = [v.co.x for v in me.vertices]
            zs = [v.co.z for v in me.vertices]
            cx, cz = (min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2
            rx, rz = (max(xs) - min(xs)) / 2, (max(zs) - min(zs)) / 2
            for p in me.polygons:
                for li in p.loop_indices:
                    v = me.vertices[me.loops[li].vertex_index].co
                    uv.data[li].uv = (.5 + .5 * (v.x - cx) / rx, .5 + .5 * (v.z - cz) / rz)
    return head


def add_skin_colors(o):
    attr = o.data.color_attributes.new(name='Complexion', type='FLOAT_COLOR', domain='POINT')
    for v, c in zip(o.data.vertices, attr.data):
        x, y, z = v.co
        front = max(0, min(1, (-y - .025) / .04))
        cheek = gaussian(abs(x), .048, .024) * gaussian(z, 1.813+FACE_OFFSET, .025) * front
        nose = gaussian(x, 0, .016) * gaussian(z, 1.809+FACE_OFFSET, .017) * front
        lips = gaussian(x, 0, .023) ** 2 * gaussian(z, 1.772+FACE_OFFSET, .006) * max(0, min(1, (-y - .055) / .025))
        beard = gaussian(z, 1.752+FACE_OFFSET, .027) * front * .018
        color = Vector((.43, .28, .214)) + Vector((.024, -.012, -.009)) * (cheek + nose) - Vector((beard, beard, beard * .8))
        color = color.lerp(Vector((.29, .115, .09)), min(.75, lips))
        c.color = (*color, 1)


def skin_material():
    m = material('V2 | skin - layered complexion', (.43, .28, .214), .47)
    n, l = m.node_tree.nodes, m.node_tree.links
    p = n.get('Principled BSDF')
    p.inputs['Subsurface Weight'].default_value = .065
    p.inputs['Subsurface Radius'].default_value = (1.0, .42, .22)
    a = n.new('ShaderNodeVertexColor')
    a.layer_name = 'Complexion'
    l.new(a.outputs['Color'], p.inputs['Base Color'])
    t = n.new('ShaderNodeTexNoise')
    t.inputs['Scale'].default_value = 1250
    t.inputs['Detail'].default_value = 2
    b = n.new('ShaderNodeBump')
    b.inputs['Strength'].default_value = .15
    b.inputs['Distance'].default_value = .00013
    l.new(t.outputs['Fac'], b.inputs['Height'])
    l.new(b.outputs['Normal'], p.inputs['Normal'])
    return m


def iris_material():
    m = material('V2 | iris - grey violet with radial fibres', (.1, .12, .13), .24)
    n, l = m.node_tree.nodes, m.node_tree.links
    p = n.get('Principled BSDF')
    tc = n.new('ShaderNodeTexCoord')
    sub = n.new('ShaderNodeVectorMath'); sub.operation = 'SUBTRACT'; sub.inputs[1].default_value = (.5, .5, 0)
    l.new(tc.outputs['UV'], sub.inputs[0])
    length = n.new('ShaderNodeVectorMath'); length.operation = 'LENGTH'; l.new(sub.outputs[0], length.inputs[0])
    ramp = n.new('ShaderNodeValToRGB')
    r = ramp.color_ramp
    r.elements.remove(r.elements[1])
    for pos, col in [(0, (.002, .002, .002, 1)), (.19, (.002, .002, .002, 1)), (.23, (.075, .075, .067, 1)),
                     (.31, (.15, .17, .17, 1)), (.43, (.055, .062, .073, 1)), (.49, (.012, .016, .022, 1))]:
        e = r.elements[0] if pos == 0 else r.elements.new(pos); e.position = pos; e.color = col
    l.new(length.outputs['Value'], ramp.inputs[0]); l.new(ramp.outputs['Color'], p.inputs['Base Color'])
    return m


def eye_material():
    m = material('V2 | eyes - integrated iris pupil and corneal sheen', (.6, .6, .55), .14)
    n, l = m.node_tree.nodes, m.node_tree.links; p = n.get('Principled BSDF')
    p.inputs['Coat Weight'].default_value = .45; p.inputs['Coat Roughness'].default_value = .09
    tc = n.new('ShaderNodeUVMap'); tc.uv_map = 'Eye projection'; sub = n.new('ShaderNodeVectorMath'); sub.operation = 'SUBTRACT'; sub.inputs[1].default_value = (.5, .5, 0); l.new(tc.outputs['UV'], sub.inputs[0])
    length = n.new('ShaderNodeVectorMath'); length.operation = 'LENGTH'; l.new(sub.outputs[0], length.inputs[0])
    ramp = n.new('ShaderNodeValToRGB'); r = ramp.color_ramp; r.elements.remove(r.elements[1])
    for pos, col in [(0, (.001, .001, .001, 1)), (.075, (.001, .001, .001, 1)), (.095, (.068, .073, .068, 1)),
                     (.155, (.14, .16, .16, 1)), (.205, (.035, .048, .056, 1)), (.223, (.012, .02, .025, 1)),
                     (.235, (.59, .56, .49, 1)), (.50, (.59, .56, .49, 1))]:
        e = r.elements[0] if pos == 0 else r.elements.new(pos); e.position = pos; e.color = col
    l.new(length.outputs['Value'], ramp.inputs[0]); l.new(ramp.outputs['Color'], p.inputs['Base Color'])
    return m


def make_hair(head):
    """Fit every root and swept scalp lock to the anatomical skull, never an ellipsoid cap."""
    dg = bpy.context.evaluated_depsgraph_get()
    tree = BVHTree.FromObject(head, dg)
    center = Vector((0, -.025, 1.900))
    def scalp(d, offset=.002):
        d = Vector(d).normalized()
        p, normal, _, _ = tree.ray_cast(center + d * .27, -d, .30)
        if p is None:
            return center + d * .095
        return p + normal * offset
    def hairline(a):
        a = abs((a + pi) % (2 * pi) - pi)
        keys = [(0, 1.15), (.30, 1.00), (.60, 1.04), (1., 1.25), (1.57, 1.58), (2., 2.02), (pi, 2.25)]
        for (a0, v0), (a1, v1) in zip(keys, keys[1:]):
            if a <= a1:
                t = (a - a0) / (a1 - a0); t = t * t * (3 - 2 * t)
                return v0 * (1 - t) + v1 * t
        return keys[-1][1]
    vs, fs = [], []
    N, M = 160, 52
    # Close-fitting root surface, with a widow's peak and irregular temple recession.
    for i in range(M + 1):
        t = i / M
        for j in range(N):
            a = j * 2 * pi / N
            limit = hairline(a) + .008 * sin(17 * a)
            th = .012 + (limit - .012) * t
            vs.append(scalp((sin(th) * sin(a), -sin(th) * cos(a), cos(th)), .0013))
    for i in range(M):
        for j in range(N):
            k = i * N + j
            fs.append((k, i * N + (j + 1) % N, (i + 1) * N + (j + 1) % N, k + N))
    cap=mesh('Hair | anatomical root surface and irregular hairline', vs, fs, HAIRROOT, 1, coll=HAIR)
    density=cap.data.attributes.new('RootDensity','FLOAT','POINT')
    density.data.foreach_set('value',[max(0,min(1,(1-i/M)/.18)) for i in range(M+1) for j in range(N)])
    nodes,links=HAIRROOT.node_tree.nodes,HAIRROOT.node_tree.links
    output=nodes.get('Material Output'); base=nodes.get('Principled BSDF')
    attr=nodes.new('ShaderNodeAttribute');attr.attribute_name='RootDensity'
    transparent=nodes.new('ShaderNodeBsdfTransparent');mix=nodes.new('ShaderNodeMixShader')
    links.new(attr.outputs['Fac'],mix.inputs[0]);links.new(transparent.outputs[0],mix.inputs[1]);links.new(base.outputs[0],mix.inputs[2]);links.new(mix.outputs[0],output.inputs['Surface'])
    dark, pale, mid = [], [], []
    # Longitudinal combing: strands sweep over the crown toward the back rather than radiating from a point.
    for j in range(220):
        side = -.97 + 1.94 * j / 219
        lo, hi = -.1, 1.2
        for _ in range(22):
            u = (lo + hi) / 2
            theta = math.acos(sqrt(1 - side * side) * sin(u))
            a = math.atan2(side, sqrt(1 - side * side) * cos(u))
            if theta > hairline(a):
                lo = u
            else:
                hi = u
        start = (lo + hi) / 2 + RNG.uniform(-.008, .008)
        points = []
        bucket=math.floor((side+.97)/.085)
        clump_center=-.97+(bucket+.5)*.085
        for k in range(40):
            t = k / 39
            u = start + (3.40 - start) * t
            gathering=.60*min(1,t/.16)*(1-.35*t)
            grouped=clump_center+(side-clump_center)*.75
            s=(side*(1-gathering)+grouped*gathering)*(1-.07*sin(pi*t))
            s=max(-.985,min(.985,s))
            d = (s, -sqrt(1 - s * s) * cos(u), sqrt(1 - s * s) * sin(u))
            lift = .0035 * (.45 + .55 * sin(j*2.17)**2) * gaussian(t, .10+.025*sin(j), .14)
            clump=.0006*(.5+.5*cos(side*19*pi+.8*sin(side*7)+.4*sin(t*4)))**2*sin(pi*t)
            p = scalp(d, .0014 + .0022 * sin(pi * t) ** 2 + lift+clump)
            points.append(p)
        for f in range(28):
            shift = (f - 13.5) * .00013; phase = RNG.uniform(0, 2*pi)
            depth=RNG.uniform(-.0006,.0028)
            if RNG.random()<.025:depth=.0045
            path=[]
            for k,p in enumerate(points):
                t=k/39;normal=(p-center).normalized()
                volume=(depth+.00025*sin(t*7*pi+phase))*sqrt(max(0,sin(pi*t)))
                path.append(p+normal*volume+Vector((shift+.0002*sin(t*5*pi+phase)*sin(pi*t),.00025*cos(t*4*pi+phase)*sin(pi*t),RNG.uniform(.0001,.0004))))
            (dark if f == 0 and j % 2 == 0 else pale if (f + j) % 4 == 0 else mid).append(path)
    # Shoulder-length back layers, rooted above and behind the ear.
    for j in range(140):
        a = 1.28 + (2 * pi - 2.56) * j / 139
        root = scalp((sin(a), -cos(a), .35), .003)
        end_z = 1.70 + RNG.random() * .095 + .015 * cos(a * 4)
        end = Vector((root.x * 1.03 + .012 * sin(a), max(.06 + .047 * abs(cos(a)),root.y+.014), end_z))
        pts = [root, root + Vector((.004 * sin(a), .015, -.037)),
               root.lerp(end, .66) + Vector((.005 * sin(j), -.004, 0)), end]
        for f in range(100):
            offset = RNG.uniform(-.018, .018)
            mid.append([p + Vector(((f - 49.5) * .00020 + RNG.uniform(-.0006, .0006), RNG.uniform(-.0025, .0025), offset * k / 3)) for k, p in enumerate(pts)])
    fibres('Hair | fine silver strands', pale, .000075, HAIRLIGHT, HAIR)
    fibres('Hair | lowlights and root strands', dark, .000070, HAIRDARK, HAIR)
    fibres('Hair | swept platinum strands and back layers', mid, .000085, HAIRMID, HAIR)
    loose=[]
    for j in range(110):
        a=RNG.uniform(-1.5,1.5);th=hairline(a)+RNG.uniform(-.012,.012)
        direction=Vector((sin(th)*sin(a),-sin(th)*cos(a),cos(th)))
        p=scalp(direction,.0016);sweep=Vector((.003*sin(a),.018,-.002))
        loose.append([p,p+direction*.002+sweep*.35,p+direction*.001+sweep])
    fibres('Hair | fine flyaways at the temples and hairline',loose,.000035,HAIRMID,HAIR)
    # Fine eyebrow hairs are rooted to the actual brow surface.
    brow_mat = material('V2 | ash eyebrows', (.080, .063, .045), .62)
    paths = []
    for sign in [-1, 1]:
        for j in range(140):
            t = RNG.random(); x = sign * (.013 + .045 * t)
            z = 1.875+FACE_OFFSET + .0035 * sin(pi * t) - .006 * t - .0035 * gaussian(t, .05, .28) + RNG.uniform(-.0011, .0011)
            p, normal, _, _ = tree.ray_cast(Vector((x, -.3, z)), Vector((0, 1, 0)), .4)
            if p is None:
                continue
            p += normal * .00035
            paths.append([p, p + Vector((sign * .0012, -.00015, .0015)), p + Vector((sign * .0026, .00005, .0023))])
    fibres('Brows | individually rooted ash hairs', paths, .000055, brow_mat, HAIR)


def rebuild_costume():
    def remove(prefixes):
        for o in list(bpy.data.objects):
            if o.name.startswith(prefixes):
                bpy.data.objects.remove(o, do_unlink=True)
    coat = bpy.data.materials.get('Coat | oxblood woven wool')
    cape = bpy.data.materials.get('Cape | deep crimson velvet')
    leather = bpy.data.materials.get('Leather | charcoal')
    dark = bpy.data.materials.get('Coat | seam shadows')
    edge = bpy.data.materials.get('Armour | worn silver edges')
    steel = bpy.data.materials.get('Armour | blackened steel')
    trim = bpy.data.materials.get('Hardware | antique pewter')
    # A raised riding collar encloses the measured lower-head boundary. No part of
    # the anatomical chin is clipped or flattened to force it into a stock collar.
    collar=bpy.data.objects.get('High split collar')
    head=next(o for o in HEAD.objects if o.name.startswith('Daemon | anatomical'))
    rx,ry,cy=head['collar_fit'];n=64;vs=[];fs=[]
    profile=[(1.640,.066,.057,0),(1.646,.069,.060,0),(1.733,rx,ry,cy),(1.740,rx,ry,cy)]
    for z,xr,yr,yc in profile:
        for j in range(n):
            a=2*pi*j/n;vs.append((xr*sin(a),yc-yr*cos(a),z))
    for i in range(3):
        for j in range(n):fs.append((i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j))
    fs+=[tuple(range(n-1,-1,-1)),tuple(3*n+j for j in range(n))]
    data=bpy.data.meshes.new('Fitted high riding collar');data.from_pydata(vs,[],fs);data.materials.append(leather);collar.data=data
    for p in data.polygons:p.use_smooth=True
    for ob in bpy.data.objects:
        if ob.name.startswith('Collar oxblood piping'):
            for sp in ob.data.splines:
                for j,p in enumerate(sp.bezier_points):
                    a=2*pi*j/(len(sp.bezier_points)-1);p.co=(rx*sin(a),cy-ry*cos(a),1.739)
    # Dyed cloth varies at several scales. Its fine diagonal twill is separate from the garment folds.
    n, l = coat.node_tree.nodes, coat.node_tree.links
    n.clear()
    out = n.new('ShaderNodeOutputMaterial'); p = n.new('ShaderNodeBsdfPrincipled'); l.new(p.outputs[0], out.inputs['Surface'])
    p.inputs['Roughness'].default_value = .69
    p.inputs['Specular IOR Level'].default_value = .24
    p.inputs['Sheen Weight'].default_value = .28
    t = n.new('ShaderNodeTexNoise'); t.inputs['Scale'].default_value = 68; t.inputs['Detail'].default_value = 3
    ramp = n.new('ShaderNodeValToRGB'); ramp.color_ramp.elements[0].color = (.020, .0008, .0025, 1); ramp.color_ramp.elements[1].color = (.115, .008, .015, 1)
    l.new(t.outputs['Fac'], ramp.inputs[0]); l.new(ramp.outputs[0], p.inputs['Base Color'])
    tc = n.new('ShaderNodeTexCoord'); xyz = n.new('ShaderNodeSeparateXYZ'); l.new(tc.outputs['Object'], xyz.inputs[0])
    sums = []
    for op in ['ADD', 'SUBTRACT']:
        a = n.new('ShaderNodeMath'); a.operation = op; l.new(xyz.outputs['X'], a.inputs[0]); l.new(xyz.outputs['Z'], a.inputs[1])
        mul = n.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'; mul.inputs[1].default_value = 1050; l.new(a.outputs[0], mul.inputs[0])
        s = n.new('ShaderNodeMath'); s.operation = 'SINE'; l.new(mul.outputs[0], s.inputs[0]); sums.append(s)
    prod = n.new('ShaderNodeMath'); prod.operation = 'MULTIPLY'; l.new(sums[0].outputs[0], prod.inputs[0]); l.new(sums[1].outputs[0], prod.inputs[1])
    bump = n.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = .28; bump.inputs['Distance'].default_value = .00065
    l.new(prod.outputs[0], bump.inputs['Height']); l.new(bump.outputs[0], p.inputs['Normal'])
    coat.diffuse_color = (.085, .004, .011, 1)
    p = cape.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value = (.042, .0013, .0055, 1); p.inputs['Roughness'].default_value = .8; p.inputs['Sheen Weight'].default_value = .3
    cape.diffuse_color = (.042, .0013, .0055, 1)
    # Beaten, blackened steel: reflections break across the surface instead of looking like polished plastic.
    n, l = steel.node_tree.nodes, steel.node_tree.links; p = n.get('Principled BSDF')
    t = n.new('ShaderNodeTexNoise'); t.inputs['Scale'].default_value = 53; t.inputs['Detail'].default_value = 4
    ramp = n.new('ShaderNodeValToRGB'); ramp.color_ramp.elements[0].color = (.013, .014, .016, 1); ramp.color_ramp.elements[1].color = (.083, .077, .068, 1)
    l.new(t.outputs['Fac'], ramp.inputs[0]); l.new(ramp.outputs[0], p.inputs['Base Color'])
    rough = n.new('ShaderNodeMapRange'); rough.inputs['From Min'].default_value = 0; rough.inputs['From Max'].default_value = 1; rough.inputs['To Min'].default_value = .30; rough.inputs['To Max'].default_value = .51
    l.new(t.outputs['Fac'], rough.inputs[0]); l.new(rough.outputs[0], p.inputs['Roughness']); p.inputs['Metallic'].default_value = .86
    bump = n.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = .18; bump.inputs['Distance'].default_value = .00050
    l.new(t.outputs['Fac'], bump.inputs['Height']); l.new(bump.outputs[0], p.inputs['Normal'])
    steel.diffuse_color = (.045, .044, .042, 1)
    edge.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (.17, .155, .13, 1)
    remove(('Gorget | fluted blackened steel', 'Gorget | rolled lower edge'))
    # Separate convex clavicle plates retain the angular silhouette of forged metal.
    coat_body = bpy.data.objects.get('Quilted riding coat | torso')
    tree_coat = BVHTree.FromObject(coat_body, bpy.context.evaluated_depsgraph_get())
    plate_outline = [( .014, 1.664), (.058, 1.677), (.113, 1.653), (.171, 1.632), (.211, 1.603),
                     (.194, 1.578), (.149, 1.585), (.116, 1.570), (.071, 1.587), (.016, 1.606)]
    plates = []
    for sign in [-1, 1]:
        center = Vector((sign * .110, 0, 1.623)); vs, fs = [], []; n = len(plate_outline)
        for r in [1., .96, .90, .48, .02]:
            for x, z in plate_outline:
                x, z = sign * x, z
                x = center.x + (x - center.x) * r; z = center.z + (z - center.z) * r
                hit, normal, _, _ = tree_coat.ray_cast(Vector((x, -.4, z)), Vector((0, 1, 0)), .5)
                y = hit.y - .006 - .004 * (1 - r) if hit else -.055
                vs.append((x, y, z))
        for i in range(4):
            for j in range(n):
                fs.append((i * n + j, i * n + (j + 1) % n, (i + 1) * n + (j + 1) % n, (i + 1) * n + j))
        fs.append(tuple(4 * n + j for j in range(n)))
        pl = mesh('Armour | angular clavicle plate', vs, fs, steel, 1, .004); plates.append(pl)
        curves('Gorget | rolled and inset plate border', [[Vector(p) + Vector((0, -.0012, 0)) for p in vs[n:2*n] + [vs[n]]]], .0016, edge)
    # A small central bridge supports the three-headed seal.
    bridge = [(-.08, -.135, 1.589), (-.043, -.139, 1.577), (0, -.141, 1.564), (.043, -.139, 1.577), (.08, -.135, 1.589)]
    curves('Gorget | articulated central bridge', [bridge], .006, steel)
    tree_yoke = BVHTree.FromObject(plates[1], bpy.context.evaluated_depsgraph_get())
    scrolls = []
    for sign in [-1, 1]:
        for k in range(3):
            path = []
            for j in range(16):
                t = j / 15; x = sign * (.044 + .037 * k + .028 * sin(pi * t)); z = 1.589 + .012 * k + .028 * cos(pi * t)
                p0, normal, _, _ = tree_coat.ray_cast(Vector((x, -.4, z)), Vector((0, 1, 0)), .5)
                if p0 is not None:
                    path.append(p0 + normal * .012)
            if len(path) > 3:
                scrolls.append(path)
    curves('Gorget | chased wing scroll relief', scrolls, .00075, trim, resolution=3, bevel=2)
    for o in bpy.data.objects:
        if o.name.startswith(('Gorget | central dragon', 'Gorget | seal recessed', 'Seal |')):
            o.location.y -= .018
    # Replace the accordion-like skirt with a split, asymmetric riding coat and broader weighted folds.
    remove(('Split coat skirts', 'Coat front braided binding', 'Quilted coat sleeve', 'Sleeve compressed fold'))
    N, M = 144, 80
    vs, fs = [], []
    for i in range(M + 1):
        t = i / M
        gap_r = .035 + .24 * t ** 1.35
        gap_l = .035 + .58 * t ** 1.25
        for j in range(N + 1):
            a = gap_r + (2 * pi - gap_r - gap_l) * j / N
            fold = (.001 + .005 * t) * sin(12 * a + 1.7 * t) + .0018 * t * sin(23 * a - 3 * t)
            fold += .003 * gaussian(t, .12, .12) * sin(a * 24 + t * 15)
            rx, ry = .154 + .095 * t ** .75, .107 + .033 * t
            z = 1.19 - .843 * t + .032 * t ** 3 * sin(a + .6) + .009 * t ** 4 * sin(a * 5)
            vs.append(((rx + fold) * sin(a), -(ry + fold) * cos(a), z))
    for i in range(M):
        for j in range(N):
            k = i * (N + 1) + j; fs.append((k, k + 1, k + N + 2, k + N + 1))
    tails = mesh('Coat | asymmetric riding skirts and weighted folds', vs, fs, coat, 1, .004)
    curves('Coat | rolled split edges', [[vs[i * (N + 1) + j] for i in range(M + 1)] for j in [0, N]], .0026, dark)
    curves('Coat | narrow weighted hem', [[vs[M * (N + 1) + j] for j in range(N + 1)]], .0021, dark)
    # Cloth pulling toward the cinched belt, with diagonal tension at the armholes.
    torso = bpy.data.objects.get('Quilted riding coat | torso')
    for v in torso.data.vertices:
        x, y, z = v.co
        front = max(0, -y / .12)
        v.co.y += front * (.0024 * gaussian(z, 1.245 + .10 * abs(x), .024) * sin(x * 115 + z * 20)
                           + .0023 * gaussian(z, 1.43 + .55 * abs(x), .016))
    for s in [-1, 1]:
        vs, fs = [], []
        N, M = 48, 48
        for i in range(M + 1):
            t = i / M; cx = s * (.228 + .084 * t); cy = -.006 - .022 * t
            for j in range(N):
                a = j * 2 * pi / N
                wrinkle = .0030 * gaussian(t, .89, .24) * sin(t * 53 + 2.5 * sin(a)) + .0012 * sin(t * 17 + a * 2)
                r = .077 - .020 * t + wrinkle
                vs.append((cx + r * sin(a), cy - r * .91 * cos(a), 1.556 - .278 * t + .003 * sin(a * 2 + t * 28)))
        for i in range(M):
            for j in range(N):
                k = i * N + j; fs.append((k, i * N + (j + 1) % N, (i + 1) * N + (j + 1) % N, k + N))
        mesh('Coat | fitted sleeve and elbow compression', vs, fs, coat, 1, .003)
    # Fine quilting follows the front surface. The broad cloth folds remain independent of these seams.
    tree = BVHTree.FromObject(torso, bpy.context.evaluated_depsgraph_get())
    stitch_paths = []
    for row in range(32):
        z = 1.245 + row * .0094
        for col in range(-16, 17):
            x = col * .0094 + (row % 2) * .0047
            pts = []
            for dx, dz in [(-.0046, 0), (0, .0046), (.0046, 0)]:
                p, norm, _, _ = tree.ray_cast(Vector((x + dx, -.4, z + dz)), Vector((0, 1, 0)), .5)
                if p is not None and p.y < -.07:
                    pts.append(p + norm * .0007)
            if len(pts) == 3:
                stitch_paths.append(pts)
    curves('Coat | fine chevron jacquard stitching', stitch_paths, .00022, dark, resolution=1, bevel=1)
    # The pauldron's central crest and small scallops break its former smooth hemispherical silhouette.
    for ob in bpy.data.objects:
        if ob.name.startswith('Pauldron | domed main shell'):
            cx = -.244 if sum(v.co.x for v in ob.data.vertices) < 0 else .244
            for v in ob.data.vertices:
                a = math.atan2(v.co.x - cx, -(v.co.y - .008))
                r = sqrt(((v.co.x - cx) / .106) ** 2 + ((v.co.y - .008) / .112) ** 2)
                v.co.z += .007 * sin(a * 3 + .4) * min(1, r) ** 3
                v.co.z -= .012 * (1 - min(1, r))
    # Dense individual sable fibres replace the broad, flat fur wedges.
    remove(('Fur | 1700',))
    fur_mats = [fibre_material('V2 | sable fibres - umber', (.026, .014, .007), .48),
                fibre_material('V2 | sable fibres - warm tips', (.065, .035, .018), .48),
                fibre_material('V2 | sable fibres - charcoal', (.014, .011, .008), .47)]
    groups = [[], [], []]
    for i in range(11500):
        a = RNG.uniform(0, 2 * pi); c = RNG.uniform(-.45, 1); th = math.acos(c)
        p = Vector((-.204 + .168 * sin(th) * sin(a), .004 - .139 * sin(th) * cos(a), 1.593 + .095 * cos(th)))
        norm = Vector(((p.x + .204) / .168, (p.y - .004) / .139, (p.z - 1.593) / .095)).normalized()
        gravity = Vector((-.25, -.05, -1))
        tangent = gravity - norm * gravity.dot(norm)
        if tangent.length < .01:
            tangent = Vector((-.5, -.2, 0))
        flow = tangent.normalized()
        length = RNG.uniform(.025, .061)
        curl = Vector((RNG.uniform(-.008, .008), RNG.uniform(-.006, .006), 0))
        points = [p + flow * (length * t) + norm * (.001 + .006 * sin(pi * t)) + curl * sin(pi * t) + Vector((0, 0, -.003 * t * t)) for t in [0, .2, .4, .6, .8, 1]]
        groups[1 if i % 7 == 0 else 2 if i % 5 == 0 else 0].append(points)
    for i, (paths, mat) in enumerate(zip(groups, fur_mats)):
        fibres('Mantle | fine directional sable fibre layer %d' % i, paths, .00012 if i == 1 else .00015, mat, DETAIL)
    undercoat = []
    for i in range(18000):
        a = RNG.uniform(0, 2 * pi); c = RNG.uniform(-.4, 1); th = math.acos(c)
        p0 = Vector((-.204 + .168 * sin(th) * sin(a), .004 - .139 * sin(th) * cos(a), 1.593 + .095 * cos(th)))
        norm = Vector(((p0.x + .204) / .168, (p0.y - .004) / .139, (p0.z - 1.593) / .095)).normalized()
        g = Vector((-.2, -.02, -1)); tangent = g - norm * g.dot(norm)
        if tangent.length < .01: tangent = Vector((-.3, -.1, 0))
        tangent.normalize(); length = RNG.uniform(.007, .014)
        undercoat.append([p0, p0 + norm * .003 + tangent * length * .3,
                          p0 + norm * .004 + tangent * length * .7, p0 + norm * .003 + tangent * length])
    fibres('Mantle | dense soft sable undercoat', undercoat, .00011, fur_mats[0], DETAIL)
    # Keep the cloak's front silhouette restrained while allowing broad irregular folds at the hem.
    cloak = bpy.data.objects.get('Crimson cloak | deep radial drapery')
    for v in cloak.data.vertices:
        x, y, z = v.co; t = max(0, min(1, (1.622 - z) / 1.566))
        v.co.x += .018 * t * t * sin(y * 9 + 1)
        v.co.y += .012 * t * sin(x * 17 + t * 3)
    # The original sheet's normals faced the lining. Put the textured velvet on the outside.
    cloak.data.update()
    back=[p for p in cloak.data.polygons if p.center.y>.15 and abs(p.center.x)<.15]
    if back and sum(p.normal.y for p in back)<0:
        bm=bmesh.new();bm.from_mesh(cloak.data);bmesh.ops.reverse_faces(bm,faces=list(bm.faces));bm.to_mesh(cloak.data);bm.free()
    cloak.modifiers['Physical thickness'].thickness=.0035
    print('Costume: tailored coat, stitch relief, blackened steel and fine sable groom rebuilt.', flush=True)


def rebuild_boots():
    for ob in list(bpy.data.objects):
        if ob.name.startswith(('Tall leather boot', 'Boot |', 'Boot welt', 'Boot back seam', 'Boot cuff')):
            bpy.data.objects.remove(ob, do_unlink=True)
    leather = bpy.data.materials.get('Leather | charcoal')
    sole_mat = material('V2 | boot sole - worn charcoal leather', (.012, .010, .009), .73)
    stitch = material('V2 | boot welt - muted flax', (.10, .076, .047), .8)
    for sign in [-1, 1]:
        cx, cy = sign * .107, -.039 if sign < 0 else .030
        theta = sign * .10
        def P(x, y, z):
            return Vector((cx + x * cos(theta) - y * sin(theta), cy + x * sin(theta) + y * cos(theta), z))
        # A fitted shaft, with most compression around the ankle rather than equal rings up the entire leg.
        N, M = 64, 80; vs, fs = [], []
        for i in range(M + 1):
            t = i / M; z = .078 + .585 * t
            r = .043 + .017 * sin(pi * min(1, t * 1.10)) ** 1.4 + .011 * t ** 4
            for j in range(N):
                a = j * 2 * pi / N
                amp = .0012 + .0033 * gaussian(z, .205, .085) + .0008 * gaussian(z, .43, .13)
                wrinkle = amp * sin(t * 61 + 2.4 * sin(a) + .4 * cos(a * 3))
                v = P((r + wrinkle) * sin(a), -(r * .89 + wrinkle) * cos(a), z + .0022 * sin(a * 3 + t * 35))
                vs.append(v)
        for i in range(M):
            for j in range(N):
                k = i * N + j; fs.append((k, i * N + (j + 1) % N, (i + 1) * N + (j + 1) % N, k + N))
        mesh('Boot | fitted calf and compressed ankle leather', vs, fs, leather, 1, .003)
        curves('Boot | stitched back seam', [[P(0, .052, z) for z in [.12, .25, .42, .65]]], .0008, stitch)
        curves('Boot | double cuff seam', [[P(.057 * sin(a), -.052 * cos(a), z) for a in [2 * pi * j / 64 for j in range(65)]] for z in [.643, .653]], .0008, stitch)
        # A pointed riding-boot last with a shaped instep, heel and low vamp.
        sections = [(-.194, .006, .035), (-.185, .025, .041), (-.15, .044, .051),
                    (-.105, .053, .063), (-.065, .055, .087), (-.020, .051, .129),
                    (.028, .044, .106), (.064, .037, .067), (.069, .025, .047)]
        vs, fs = [], []; N = 48
        for y, width, top in sections:
            for j in range(N):
                a = j * 2 * pi / N
                z = (.023 + top) / 2 + (top - .023) / 2 * cos(a)
                vs.append(P(width * sin(a), y, z))
        for i in range(len(sections) - 1):
            for j in range(N):
                k = i * N + j; fs.append((k, i * N + (j + 1) % N, (i + 1) * N + (j + 1) % N, k + N))
        fs += [tuple(range(N - 1, -1, -1)), tuple((len(sections) - 1) * N + j for j in range(N))]
        mesh('Boot | pointed toe and shaped instep', vs, fs, leather, 2)
        outline = [(-w, y) for y, w, _ in sections] + [(w, y) for y, w, _ in reversed(sections)]
        vs, fs = [], []; n = len(outline)
        for z, scale in [(.001, .97), (.004, 1.02), (.020, 1.02), (.023, .99)]:
            for x, y in outline:
                vs.append(P(x * scale, y, z))
        for i in range(3):
            for j in range(n):
                k = i * n + j; fs.append((k, i * n + (j + 1) % n, (i + 1) * n + (j + 1) % n, k + n))
        fs += [tuple(range(n - 1, -1, -1)), tuple(3 * n + j for j in range(n))]
        mesh('Boot | layered leather outsole', vs, fs, sole_mat, 1)
        curves('Boot | fine welt stitching', [[P(x * 1.005, y, .0225) for x, y in outline + [outline[0]]]], .00075, stitch)
        folds = []
        for k in range(3):
            folds.append([P(x, -.077 + .012 * k + .007 * (x / .05) ** 2, .080 + .011 * k - .017 * abs(x) / .05) for x in [-.045, -.025, 0, .025, .045]])
        curves('Boot | instep tension creases', folds, .0010, leather)
    print('Pointed riding boots rebuilt with fitted shafts and weighted stance.', flush=True)


def garment_uv(ob, kind, tile):
    uv = ob.data.uv_layers.get('Garment UV') or ob.data.uv_layers.new(name='Garment UV')
    mw = ob.matrix_world
    for poly in ob.data.polygons:
        values = []
        for li in poly.loop_indices:
            p = mw @ ob.data.vertices[ob.data.loops[li].vertex_index].co
            x, y, z = p
            if kind == 'coat':
                if 'sleeve' in ob.name:
                    t = max(0, min(1, (1.556-z)/.278)); sign = 1 if x > 0 else -1
                    cx, cy, r = sign*(.228+.084*t), -.006-.022*t, .067
                else:
                    cx, cy, r = 0, 0, .19 if z > 1.19 else .205
                u = math.atan2(x-cx, -(y-cy))*r/tile
                v = z/tile; circumference = 2*pi*r/tile
            elif kind == 'cape':
                t = max(0, min(1, (1.622-z)/1.566)); rx, ry = .245+.4*t, .108+.27*t
                u = math.atan2(x/rx, (y-.035)/ry)*.43/tile
                v = z/tile; circumference = 2*pi*.43/tile
            else:
                normal = poly.normal
                if abs(normal.y) >= max(abs(normal.x), abs(normal.z)):
                    u, v = x/tile, z/tile
                elif abs(normal.z) >= abs(normal.x):
                    u, v = x/tile, y/tile
                else:
                    u, v = y/tile, z/tile
                circumference = 0
            values.append((li, u, v))
        if circumference and max(v[1] for v in values)-min(v[1] for v in values) > circumference*.5:
            values = [(li, u+circumference if u < 0 else u, v) for li,u,v in values]
        for li,u,v in values:
            uv.data[li].uv = (u+.147, v+.073)
    uv.active_render = True


def scanned_material(name, asset, value, rough_range, sheen, leather=False):
    m = material(name, (.1,.01,.02))
    n,l = m.node_tree.nodes,m.node_tree.links; n.clear()
    p = n.new('ShaderNodeBsdfPrincipled'); out=n.new('ShaderNodeOutputMaterial'); l.new(p.outputs[0],out.inputs['Surface'])
    p.inputs['Specular IOR Level'].default_value = .3 if leather else .24
    p.inputs['Sheen Weight'].default_value = sheen
    tc=n.new('ShaderNodeUVMap');tc.uv_map='Garment UV'; vector=tc.outputs[0]
    if leather:
        # The scan includes a sofa seam near its left edge. Sample the uninterrupted hide region;
        # construction seams are modelled where they belong on the garment.
        frac=n.new('ShaderNodeVectorMath');frac.operation='FRACTION';l.new(vector,frac.inputs[0])
        scale=n.new('ShaderNodeVectorMath');scale.operation='MULTIPLY';scale.inputs[1].default_value=(.60,.88,1);l.new(frac.outputs[0],scale.inputs[0])
        add=n.new('ShaderNodeVectorMath');add.operation='ADD';add.inputs[1].default_value=(.37,.055,0);l.new(scale.outputs[0],add.inputs[0]);vector=add.outputs[0]
    maps={}
    suffixes = ['diff','rough','nor_gl','disp'] + ([] if leather else ['anisotropy_rotation','anisotropy_strength','spec_ior'])
    for suffix in suffixes:
        path=OUT+'/textures/'+asset+'_'+suffix+'_4k.jpg'
        img=bpy.data.images.load(path,check_existing=True)
        if suffix!='diff':img.colorspace_settings.name='Non-Color'
        img.pack()
        t=n.new('ShaderNodeTexImage');t.image=img;t.label=asset+' | '+suffix+' | 4K scan';l.new(vector,t.inputs['Vector']);maps[suffix]=t
    if leather:
        bw=n.new('ShaderNodeRGBToBW');l.new(maps['diff'].outputs['Color'],bw.inputs[0])
        ramp=n.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].color=(.003,.0025,.002,1);ramp.color_ramp.elements[1].color=(.055,.040,.028,1)
        l.new(bw.outputs[0],ramp.inputs[0]);l.new(ramp.outputs[0],p.inputs['Base Color'])
    else:
        hsv=n.new('ShaderNodeHueSaturation');hsv.inputs['Value'].default_value=value;hsv.inputs['Saturation'].default_value=1.03
        l.new(maps['diff'].outputs['Color'],hsv.inputs['Color'])
        color=hsv.outputs[0]
        if asset=='quatrefoil_jacquard_fabric':
            # The scan's bulk albedo varies by only a few percent. Retain the actual photographed
            # threads while making the dye wear readable at the character's review scale.
            bw=n.new('ShaderNodeRGBToBW');l.new(maps['diff'].outputs['Color'],bw.inputs[0])
            contrast=n.new('ShaderNodeMapRange');contrast.inputs['From Min'].default_value=.052;contrast.inputs['From Max'].default_value=.078;contrast.inputs['To Min'].default_value=.35;contrast.inputs['To Max'].default_value=1.75
            l.new(bw.outputs[0],contrast.inputs[0]);mult=n.new('ShaderNodeMixRGB');mult.blend_type='MULTIPLY';mult.inputs[0].default_value=1
            l.new(hsv.outputs[0],mult.inputs[1]);l.new(contrast.outputs[0],mult.inputs[2]);color=mult.outputs[0]
        l.new(color,p.inputs['Base Color']);l.new(color,p.inputs['Sheen Tint'])
        tangent=n.new('ShaderNodeTangent');tangent.direction_type='UV_MAP';tangent.uv_map='Garment UV';l.new(tangent.outputs['Tangent'],p.inputs['Tangent'])
        strength=n.new('ShaderNodeMath');strength.operation='MULTIPLY';strength.inputs[1].default_value=.72;l.new(maps['anisotropy_strength'].outputs['Color'],strength.inputs[0])
        l.new(strength.outputs[0],p.inputs['Anisotropic']);l.new(maps['anisotropy_rotation'].outputs['Color'],p.inputs['Anisotropic Rotation'])
        spec=n.new('ShaderNodeMapRange');spec.inputs['To Min'].default_value=.19;spec.inputs['To Max'].default_value=.48;l.new(maps['spec_ior'].outputs['Color'],spec.inputs[0]);l.new(spec.outputs[0],p.inputs['Specular IOR Level'])
    remap=n.new('ShaderNodeMapRange');remap.inputs['To Min'].default_value=rough_range[0];remap.inputs['To Max'].default_value=rough_range[1]
    l.new(maps['rough'].outputs['Color'],remap.inputs[0]);l.new(remap.outputs[0],p.inputs['Roughness'])
    normal=n.new('ShaderNodeNormalMap');normal.uv_map='Garment UV';normal.inputs['Strength'].default_value=.95 if leather else 1.20 if asset=='quatrefoil_jacquard_fabric' else .65
    l.new(maps['nor_gl'].outputs['Color'],normal.inputs['Color'])
    bump=n.new('ShaderNodeBump');bump.inputs['Distance'].default_value=.0006 if leather else .0018 if asset=='quatrefoil_jacquard_fabric' else .0008;bump.inputs['Strength'].default_value=.50 if asset=='quatrefoil_jacquard_fabric' else .30
    l.new(maps['disp'].outputs['Color'],bump.inputs['Height']);l.new(normal.outputs[0],bump.inputs['Normal']);l.new(bump.outputs[0],p.inputs['Normal'])
    m['source']='https://polyhaven.com/a/'+asset;m['license']='CC0';m['maps']='4K scanned albedo, OpenGL normal, roughness and height; packed into this file.'
    return m


def apply_scanned_costume():
    coat_old=bpy.data.materials.get('Coat | oxblood woven wool');cape_old=bpy.data.materials.get('Cape | deep crimson velvet');leather_old=bpy.data.materials.get('Leather | charcoal');lining_old=bpy.data.materials.get('Cape | wine lining')
    coat=scanned_material('V3 | scanned burgundy jacquard - 4K', 'quatrefoil_jacquard_fabric', .20, (.35,.66), .28)
    cape=scanned_material('V3 | scanned wine velour velvet - 4K', 'velour_velvet', .28, (.52,.88), .58)
    lining=cape.copy();lining.name='V3 | scanned deep-wine cloak lining - 4K'
    next(n for n in lining.node_tree.nodes if n.bl_idname=='ShaderNodeHueSaturation').inputs['Value'].default_value=.14
    leather=scanned_material('V3 | scanned dyed worn hide - 4K', 'fabric_leather_01', .5, (.28,.63), .03, True)
    for ob in list(bpy.data.objects):
        if ob.name.startswith(('Coat | fine chevron jacquard stitching','Coat | vertical tailored seam')):
            bpy.data.objects.remove(ob,do_unlink=True);continue
        if ob.type!='MESH':continue
        kind=None
        for slot in ob.material_slots:
            if slot.material==coat_old:slot.material=coat;kind='coat'
            elif slot.material==cape_old:slot.material=cape;kind='cape'
            elif slot.material==lining_old:slot.material=lining;kind='cape'
            elif slot.material==leather_old:slot.material=leather;kind='leather'
        if kind:garment_uv(ob,kind,.18 if kind=='coat' else .30 if kind=='cape' else .40)
    # Actual tailor seams and individual thread stitches, independent of the scanned weave.
    torso=bpy.data.objects.get('Quilted riding coat | torso');tree=BVHTree.FromObject(torso,bpy.context.evaluated_depsgraph_get())
    thread=material('V3 | oxblood waxed sewing thread',(.10,.014,.018),.77);seams=[];stitches=[]
    for sign in [-1,1]:
        path=[]
        for j in range(61):
            z=1.233+.305*j/60;x=sign*(.105+.030*sin(pi*j/60)-.012*j/60)
            p,normal,_,_=tree.ray_cast(Vector((x,-.4,z)),Vector((0,1,0)),.5)
            if p is not None:path.append(p+normal*.0010)
        seams.append(path)
        for j in range(0,len(path)-1,2):
            a=path[j]+Vector((-.0011,-.0002,0));b=path[min(j+1,len(path)-1)]+Vector((.0011,-.0002,0));stitches.append([a,b])
    curves('Coat | tailored curved panel seam',seams,.00055,thread,resolution=2,bevel=1)
    curves('Coat | individual waxed thread stitches',stitches,.00020,thread,resolution=1,bevel=1)
    # Give the belt room over the compressed cloth so the lining cannot poke through it.
    for ob in bpy.data.objects:
        if ob.name.startswith('Waist belt |'):
            for v in ob.data.vertices:v.co.x*=1.04;v.co.y*=1.075
        elif ob.name.startswith(('Belt |','Buckle tongue')) and ob.type=='CURVE':
            for sp in ob.data.splines:
                for p in sp.bezier_points:p.co.x*=1.04;p.co.y*=1.075
        elif ob.name.startswith('Pewter rivet') and 1.17<ob.location.z<1.224 and abs(ob.location.x)<.12:
            ob.location.x*=1.04;ob.location.y*=1.075
    cloak=bpy.data.objects.get('Crimson cloak | deep radial drapery')
    for ob in bpy.data.objects:
        if ob.name.startswith('Cape | rolled selvage'):
            points=ob.data.splines[0].bezier_points;j=0 if points[0].co.x<0 else 104
            for i,p in enumerate(points):p.co=cloak.data.vertices[i*105+j].co
        elif ob.name.startswith('Cape | weighted hem'):
            for j,p in enumerate(ob.data.splines[0].bezier_points):p.co=cloak.data.vertices[64*105+j].co
    print('4K scanned jacquard, velvet and leather applied with garment UVs; all maps packed.',flush=True)


def configure_render(portrait=False):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE' if '--eevee' in ARGS else 'CYCLES'
    sc.cycles.samples = 16 if '--draft' in ARGS else 64
    sc.cycles.use_denoising = True
    sc.cycles.adaptive_threshold = .035
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type == 'METAL'
        if any(d.type == 'METAL' for d in prefs.devices):
            sc.cycles.device = 'GPU'
    except Exception:
        pass
    sc.render.resolution_x = 1000 if portrait else 1150
    sc.render.resolution_y = 1150 if portrait else 1500
    if '--draft' in ARGS:
        sc.render.resolution_percentage = 65
    else:
        sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Medium High Contrast'
    sc.world.node_tree.nodes.get('Background').inputs['Strength'].default_value = .16
    for o in bpy.data.objects:
        if o.type != 'LIGHT':
            continue
        if o.name.startswith('KEY'):
            o.data.energy = 420; o.data.size = 1.8
        elif o.name.startswith('FILL'):
            o.data.energy = 130; o.data.size = 3.0
        elif o.name.startswith('RIM'):
            o.data.energy = 500; o.data.size = 1.4
        else:
            o.data.energy = 25
    cam = sc.camera
    if portrait:
        cam.location = (.65, -3.8, 1.94)
        target = Vector((0, -.015, 1.79))
        cam.data.ortho_scale = .61
    else:
        cam.location = (1.6, -8, 2.25)
        target = Vector((-.02, 0, 1.0))
        cam.data.ortho_scale = 2.30
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = OUT + ('/daemon_v2_portrait.png' if portrait else '/daemon_v2_full.png')
    if '--clothes' in ARGS:
        cam.location=(.7,-3,1.48);target=Vector((.025,0,1.30));cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=.85
        sc.render.resolution_x=1200;sc.render.resolution_y=1000;sc.render.filepath=OUT+'/daemon_v2_clothing.png'


def main():
    global ROOT, HEAD, HAIR, DETAIL, SKIN, SCLERA, IRIS, HAIRROOT, HAIRMID, HAIRLIGHT, HAIRDARK
    bpy.ops.wm.open_mainfile(filepath=OUT + '/daemon_rider_study.blend', load_ui=False)
    ROOT = bpy.data.objects.get('DAEMON | standing study')
    for o in list(bpy.data.collections.get('03 | Face and silver hair').objects):
        bpy.data.objects.remove(o, do_unlink=True)
    HEAD = collection('V2 | Anatomical head and eyes')
    HAIR = collection('V2 | Fitted swept-back silver grooming')
    DETAIL = collection('V2 | Costume construction and chasing')
    SKIN = skin_material()
    SCLERA = eye_material()
    IRIS = iris_material()
    HAIRROOT = material('V2 | silver hair roots', (.19, .175, .15), .51)
    HAIRMID = fibre_material('V2 | platinum hair', (.40, .39, .36), .38)
    HAIRLIGHT = fibre_material('V2 | ivory guard strands', (.56, .54, .49), .36)
    HAIRDARK = fibre_material('V2 | silver lowlight strands', (.24, .21, .17), .39)
    head = make_head()
    print('Anatomical head built', flush=True)
    make_hair(head)
    print('Fitted swept hair built', flush=True)
    rebuild_costume()
    rebuild_boots()
    apply_scanned_costume()
    configure_render('--portrait' in ARGS)
    ROOT['revision'] = 'V2: anatomical face, fitted swept hair, physically richer costume.'
    bpy.ops.object.select_all(action='DESELECT')
    head.select_set(True)
    bpy.context.view_layer.objects.active = head
    bpy.ops.wm.save_as_mainfile(filepath=OUT + '/daemon_rider_v2.blend')
    bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    main()
