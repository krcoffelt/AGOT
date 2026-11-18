"""Prepare the measured relief and photography used by blackwater_headland.py.
Run with Python, NumPy, SciPy, Numba, Pillow and scikit-image:
    python headland_scans.py <Poly Haven glTF directory> <working directory> <reference PNG> [depth.npy]
"""
import json
import sys
from pathlib import Path

import numpy as np
from numba import njit
from PIL import Image
from scipy.ndimage import gaussian_filter, map_coordinates

SCANS = ('coastal_cliff_02', 'coastal_cliff_01', 'coastal_cliff_04', 'rock_face_01')
SECTORS = 12
ANGLE = np.radians(128.)
SPAN = 2 * ANGLE * 155.
BOTTOM = -6.
WALL = 96.
CAP = 15.


@njit
def project(points, faces, uv, depth, photo_uv):
    """Orthographic frontmost triangle and barycentric photo UV at each pixel."""
    for tri in faces:
        a, b, c = points[tri]
        ex, ey = b[0]-a[0], b[1]-a[1]
        fx, fy = c[0]-a[0], c[1]-a[1]
        det = ex*fy-ey*fx
        if abs(det) < 1.e-8:
            continue
        for j in range(max(0,int(np.ceil(min(a[1],b[1],c[1])))), min(depth.shape[0],int(max(a[1],b[1],c[1]))+1)):
            for i in range(max(0,int(np.ceil(min(a[0],b[0],c[0])))), min(depth.shape[1],int(max(a[0],b[0],c[0]))+1)):
                s = ((i-a[0])*fy-(j-a[1])*fx)/det
                t = ((j-a[1])*ex-(i-a[0])*ey)/det
                if min(s,t,1-s-t) < 0:
                    continue
                z = a[2]+s*(b[2]-a[2])+t*(c[2]-a[2])
                if z > depth[j,i]:
                    depth[j,i] = z
                    photo_uv[j,i] = uv[tri[0]]*(1-s-t)+uv[tri[1]]*s+uv[tri[2]]*t


def frontal_scan(directory, name):
    root = directory/name
    gltf = json.loads(next(root.glob('*.gltf')).read_text())
    binary = (root/gltf['buffers'][0]['uri']).read_bytes()
    primitive = gltf['meshes'][0]['primitives'][0]

    def accessor(index):
        acc = gltf['accessors'][index]
        view = gltf['bufferViews'][acc['bufferView']]
        dim = {'VEC2':2,'VEC3':3,'SCALAR':1}[acc['type']]
        return np.frombuffer(binary,{5126:'<f4',5123:'<u2',5125:'<u4'}[acc['componentType']],
                             acc['count']*dim, view.get('byteOffset',0)+acc.get('byteOffset',0)).reshape(-1,dim)

    p = accessor(primitive['attributes']['POSITION']).copy()
    uv = accessor(primitive['attributes']['TEXCOORD_0'])
    tris = accessor(primitive['indices']).reshape(-1,3)
    w = 2048
    scale = (w-1)/np.ptp(p[:,0])
    h = int(np.ceil(np.ptp(p[:,1])*scale))+1
    p[:,:2] = (p[:,:2]-p[:,:2].min(axis=0))*scale
    depth = np.full((h,w),-np.inf,np.float32)
    photo_uv = np.zeros((h,w,2),np.float32)
    project(p,tris,uv,depth,photo_uv)
    # Follow the actual uneven crest and toe of each photograph, cropping grass,
    # sky and the sand apron. Columns all end on measured stone.
    rect = np.zeros((480,w,3),np.float32)
    valid = []
    for i in range(w):
        ys = np.flatnonzero(np.isfinite(depth[:,i]))
        if len(ys)<h*.16:
            continue
        valid.append(i)
        y = np.linspace(np.quantile(ys,.12),np.quantile(ys,.91),480)
        rect[:,i,0] = np.interp(y,ys,depth[ys,i])
        j = np.searchsorted(ys,y).clip(0,len(ys)-1)
        rect[:,i,1:] = photo_uv[ys[j],i]
    left, right = np.quantile(valid,[.045,.955]).astype(int)
    rect = rect[:,left:right].copy()
    src = np.asarray(Image.open(next((root/'textures').glob('*_diff_*.jpg'))).convert('RGB'))
    px = (rect[:,:,1]%1)*(src.shape[1]-1)
    py = (rect[:,:,2]%1)*(src.shape[0]-1)
    rgb = np.stack([map_coordinates(src[:,:,k],[py,px],order=1) for k in range(3)],axis=-1)
    dep = rect[:,:,0]
    # Remove the scan's mean grade and broad curvature, retaining ledges and joints.
    relief = dep-gaussian_filter(dep,(120,125),mode='nearest')
    # A frontal photograph can see the far side through a narrow gap. A single
    # surface cannot bridge that depth discontinuity at the width of one texel.
    limit={'coastal_cliff_01':2.,'coastal_cliff_02':2.3,'coastal_cliff_04':2.,'rock_face_01':.75}[name]
    relief = gaussian_filter(limit*np.tanh(relief/limit), (2.7,6.0))
    return np.dstack((relief,rgb)).astype('f4')


def ease(x):
    x=np.clip(x,0,1)
    return x*x*(3-2*x)


def scan_field(along, level, scans):
    # Warp courses down-dip. Their lengths, inclinations, rock crops and joint
    # offsets vary continuously across the complete cape, including sector borders.
    s = along + 3.1*np.sin(level*.048+along*.015)+.14*level
    y = level + 5*np.sin(along*.037+.6)+2.4*np.sin(along*.081+level*.012)+.037*along
    row = np.floor(y/27.5-.18).astype(int)
    out = np.zeros(along.shape+(4,),np.float32)
    for dr in (0,1):
        j=row+dr
        fy=y/27.5-j
        wy=ease((fy+.18)/.36)*ease((1.18-fy)/.36)
        # The next tile already contributes near the upper edge. Extend the
        # previous row at the lower edge by centring the blending intervals.
        shift=j*23.4+4*np.sin(j*2.4)
        col=np.floor((s+shift)/43.-.17).astype(int)
        for dc in (0,1):
            i=col+dc
            fx=(s+shift)/43.-i
            wx=ease((fx+.17)/.34)*ease((1.17-fx)/.34)
            for jj,ii in ((jj,ii) for jj in range(j.min(),j.max()+1) for ii in range(i.min(),i.max()+1)):
                mask=(j==jj)&(i==ii)&(wx*wy>0)
                if not np.any(mask):
                    continue
                rng=np.random.default_rng((int(jj)*8291+int(ii)*257+78317)%2**32)
                idx=rng.choice(7,p=[.19,.045,.045,.095,.32,.195,.11])
                scan=scans[idx]
                fraction=rng.uniform(.48,.89)
                u=rng.uniform(.025,.97-fraction)+fraction*np.clip((fx[mask]+.17)/1.34,0,1)
                if rng.random()<.5: u=1-u
                v=.035+.925*np.clip((fy[mask]+.18)/1.36,0,1)
                coords=(v*(scan.shape[0]-1),u*(scan.shape[1]-1))
                weight=wx[mask]*wy[mask]
                values=np.stack([map_coordinates(scan[:,:,k],coords,order=1) for k in range(4)],axis=-1)
                values[:,0]*=[3.25,2.8,2.05,9.5,2.85,3.0,2.75][idx]
                out[mask]+=values*weight[:,None]
    return out


def geometry(along, level, relief, d, chips):
    grid = np.asarray(d['h']).reshape(d['n'],d['n'])
    angle = along[0]/155.-ANGLE
    radii=np.arange(111.,206.,.5)
    coord=np.array([(d['R']+radii[:,None]*f(angle))/d['step'] for f in (np.sin,np.cos)])
    profiles=map_coordinates(grid,coord,order=1)
    crest_ground=profiles[14]
    crest=crest_ground+1.2+1.55*np.sin(angle*9.4)+1.15*np.sin(angle*22+.6)+1.05*np.sin(angle*45+.8)
    t=np.clip((level-BOTTOM)/(WALL-BOTTOM),0,1)
    h=BOTTOM+(crest-BOTTOM)*t
    c=ease((level-WALL)/CAP)
    r=np.empty_like(h)
    for i,profile in enumerate(profiles.T):
        # The surrounding beaches continue down gently. The exposed rock ends
        # within a few metres of its toe, including on the two inland shoulders.
        envelope=np.minimum.accumulate(profile)
        r[:,i]=np.interp(np.clip(h[:,i],12,crest_ground[i]-3.8),envelope[::-1],radii[::-1])
    # Leaning buttresses with recessed joint swarms and a locally undercut foot.
    s=along+.12*h+2.1*np.sin(h*.051+along*.019)
    spur=(.5+.5*np.cos(s*.095+1.48*np.sin(s*.039)))**1.8
    r+=7.0+spur*(6.8+5.4*(1-t))+2.2*np.sin(s*.21+.8*np.sin(h*.085))
    # Broken talus ramps run diagonally out to sea between the sheer cliff spurs.
    # Their broad toes and narrow heads give the shore a different outline at each height.
    for bearing, width, reach, lean, shoulder in [
        (-104,29,49,.29,76),(-78,19,48,-.23,87),(-62,16,36,.34,66),
        (-25,24,65,.31,89),(-2,19,46,-.29,75),(22,22,63,.38,88),
        (51,15,40,-.23,71),(69,25,51,-.27,89),(104,23,44,.34,80)]:
        centre=(np.radians(bearing)+ANGLE)*155.+lean*(h-37)
        u=(along-centre)/(width*(1.12-.37*t))
        fan=np.exp(-u*u*1.3)
        toe=(1-ease((h-1)/shoulder))**.80
        r+=reach*fan*toe
    rng=np.random.default_rng(429)
    for loc in np.arange(-18,SPAN+20,14):
        centre=loc+rng.uniform(-5,5)+rng.uniform(-.21,.21)*h+1.3*np.sin(h*.09+rng.uniform(0,6.28))
        width=rng.uniform(.65,2.1)
        slot=np.exp(-((along-centre)/width)**2)
        r-=rng.uniform(2.2,5.2)*slot*(.55+.45*np.cos(h*.043+rng.uniform(0,6.28)))
    # Conjugate joint sets split the exposed piers into unequal, tilted slabs.
    # Each split feathers out above and below its particular bed.
    rng=np.random.default_rng(113)
    for location in np.arange(-15,SPAN+20,6.7):
        mid=rng.uniform(18,91)
        axis=location+rng.uniform(-3.5,3.5)+rng.uniform(-.38,.23)*(h-mid)
        axis+=.53*np.sin(h*.18+location)+.28*np.sin(h*.35-location*.13)
        distance=np.abs(along-axis)
        extent=np.exp(-((h-mid)/rng.uniform(12,32))**4)
        r-=extent*(rng.uniform(.9,2.8)*np.exp(-distance/rng.uniform(.48,.94))+
                   .7*np.maximum(0,1-distance/2.8))
    # Individual weathered beds crop out on separate parts of the face. Their
    # undercuts stop at joints, and their upper lips wear back into the slope.
    rng=np.random.default_rng(761)
    for band in (-6,7,21,38,55,69,83,98):
        for start in np.arange(-75,SPAN+40,32):
            at=start+rng.uniform(-13,13)
            breadth=rng.uniform(9,32)
            window=np.exp(-((along-at)/breadth)**4)
            contact=band+rng.uniform(-7,7)+rng.uniform(-.32,.32)*(along-at)+2.1*np.sin(along*.071+rng.uniform(0,6.28))
            dz=h-contact
            reach=rng.uniform(.78,2.65)
            lip=ease((dz+.9)/rng.uniform(.9,2.6))*np.exp(-np.maximum(0,dz)/rng.uniform(3.,9.))
            r+=reach*window*(lip-.38*np.exp(-((dz+1.1)/1.45)**2))
    # Measured small-scale spalling in exposed planes, including the crest.
    # Sample in metres so large promontories retain the same grain as smaller ones.
    grain_u=along+.21*h+1.05*np.sin(along*.13-h*.046)
    grain_v=h-.18*along+.79*np.sin(along*.19)
    def displaced(u,v,scale):
        uv=[(v/scale%1)*(chips.shape[0]-1),(u/scale%1)*(chips.shape[1]-1)]
        return map_coordinates(chips,uv,order=1,mode='wrap')
    chips_m=displaced(grain_u,grain_v,12.3)*1.50+displaced(-grain_v,grain_u,4.75)*.38
    r+=(relief+chips_m)*(1-.66*c)
    r-=4.5*(1-ease(np.abs(h-11-3*np.sin(along*.06))/5))*(.45+.55*spur)
    # Fold the crown inland into the real terrain. End the cliff below ground
    # on the city side so the continuous face has no exposed cut edges.
    rim=118/(np.abs(np.cos(angle))**2.4+np.abs(np.sin(angle))**2.4)**(1/2.4)
    r=(1-c)*r+c*(rim+.2)
    ground=map_coordinates(grid,[(d['R']+r*np.sin(angle))/d['step'],(d['R']+r*np.cos(angle))/d['step']],order=1)
    h=(1-c)*h+c*(ground-1.3)+2.7*np.sin(np.pi*c)*(.5+.5*spur)
    end=ease((np.abs(angle)-np.radians(117))/np.radians(11))
    h=(1-end)*h+end*np.minimum(h,ground-1.7)
    return np.stack((r*np.cos(angle),-r*np.sin(angle),h),axis=-1).astype('f4')


def bake_ripples():
    # A band-limited directional wave spectrum. Export slopes, so each mip level
    # averages unresolved capillary waves instead of aliasing them into stripes.
    size=256
    k=2*np.pi*np.fft.fftfreq(size,d=14./size)
    x,z=np.meshgrid(k,k)
    length=np.maximum(.001,np.hypot(x,z))
    direction=((.30*x+.954*z)/length)**2
    power=length**-3.6*np.exp(-(6.4/length)**2-(length/48.)**4)*(.11+direction**2)
    noise=np.fft.fft2(np.random.default_rng(6248).normal(size=(size,size)))*np.sqrt(power)
    sx=np.fft.ifft2(1j*x*noise).real
    sz=np.fft.ifft2(1j*z*noise).real
    scale=.30/np.sqrt(np.mean(sx*sx+sz*sz))
    rgb=np.stack((.5+sx*scale,.5+sz*scale,np.full_like(sx,.5)),axis=-1)
    target=Path(__file__).resolve().parents[2]/'public/textures/blackwater_ripples.png'
    Image.fromarray(np.uint8(np.clip(rgb,0,1)*255)).save(target)


def build(directory, work, reference=None, depth=None):
    work.mkdir(parents=True,exist_ok=True)
    d=json.loads((Path(__file__).resolve().parents[2]/'public/impostors/kl_headland.json').read_text())
    image=Path(__file__).resolve().parents[2]/'public/textures/rock_face_03/disp.jpg'
    chips=(np.asarray(Image.open(image),dtype='f4')-145)/82
    scans=[]
    for name in SCANS:
        path=work/(name+'.npy')
        if not path.exists(): np.save(path,frontal_scan(directory,name))
        scans.append(np.load(path))
    if reference:
        from reference_inlet import prep,estimate
        image=Image.open(reference).convert('RGB').resize((1456,816))
        prep(np.asarray(image),np.load(depth) if depth else estimate(image,work),work)
    bake_ripples()
    scans.extend(np.load(work/f'limestone_plate_{i}.npy')[::-1].copy() for i in range(3))
    width,height=1024,1792
    for k in range(SECTORS):
        a0,a1=k*SPAN/SECTORS,(k+1)*SPAN/SECTORS
        # Keep mesh positions and the photographic atlas in the same coordinates.
        along,level=np.meshgrid(np.linspace(a0,a1,145),np.linspace(BOTTOM,WALL+CAP,265))
        shape=scan_field(along,level,scans)[:,:,0]
        np.save(work/f'wall{k:02}.npy',geometry(along,level,shape,d,chips))
        ranges=np.linspace(BOTTOM,WALL+CAP,height)
        fields=[]
        for start in range(0,height,96):
            along,level=np.meshgrid(np.linspace(a0,a1,width),ranges[start:start+96])
            fields.append(scan_field(along,level,scans))
        field=np.concatenate(fields)
        color=field[:,:,1:]
        # Keep the tonal variation that identifies individual stones while bringing
        # differently lit scans into the same pale coastal limestone palette.
        luma=color@np.array([.2126,.7152,.0722],dtype='f4')
        stone=.28*color+.72*luma[:,:,None]*np.array([1.02,1.012,.985])
        depth=field[:,:,0]
        hollow=np.clip(gaussian_filter(depth,(17,17))-depth,0,1.3)
        rock=np.clip((stone*1.08+4)*(1-.18*hollow[:,:,None]),0,255)
        Image.fromarray(rock[::-1].astype('uint8')).save(work/f'wall{k:02}.jpg',quality=91)
        # Residual relief smaller than the vertex spacing is registered to the photo.
        fine=field[:,:,0]-gaussian_filter(field[:,:,0],(3.4,3.6))
        dv,du=np.gradient(fine,(WALL+CAP-BOTTOM)/(height-1),(a1-a0)/(width-1))
        normal=np.stack((-np.clip(du,-2,2),-np.clip(dv,-2,2),np.ones_like(du)),axis=-1)
        normal/=np.linalg.norm(normal,axis=-1,keepdims=True)
        Image.fromarray(((normal[::-1]*.5+.5)*255).astype('uint8')).save(work/f'wall{k:02}_n.jpg',quality=83)
        print('Prepared sector',k,flush=True)
    from headland_grotto import build_grotto
    build_grotto(work)


if __name__=='__main__':
    build(*(Path(arg) for arg in sys.argv[1:]))
