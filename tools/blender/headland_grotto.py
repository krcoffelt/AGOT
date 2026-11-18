"""Sample a jointed limestone overhang and its sea-eroded interior in metres."""
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import map_coordinates
from skimage.measure import marching_cubes


def build_grotto(work):
    root=Path(__file__).resolve().parents[2]
    measured=(np.asarray(Image.open(root/'public/textures/rock_face_03/disp.jpg'),dtype='f4')-145)/83
    front=np.load(work/'coastal_cliff_02.npy')
    coast=front[:,:,0]
    Image.fromarray(front[::-1,:,1:].clip(0,255).astype('uint8')).save(work/'grotto_face.jpg',quality=94)

    def grain(u,v,meters):
        u,v=np.broadcast_arrays(u,v)
        return map_coordinates(measured,[v%meters/meters*(measured.shape[0]-1),
                                         u%meters/meters*(measured.shape[1]-1)],order=1)
    def join(a,b,width):
        return np.maximum(a,b)+np.maximum(width-np.abs(a-b),0)**2/(4*width)

    cell=.24
    axes=[np.arange(a,b,cell,dtype='f4') for a,b in [(-33,34),(-33,24),(-7,42)]]
    x,y=np.meshgrid(*axes[:2],indexing='ij')
    volume=np.empty(tuple(len(a) for a in axes),dtype='f4')
    for k,z in enumerate(axes[2]):
        bedding=z+.17*x-.09*y+1.35*np.sin(.13*x+.05*y)
        along=x-.12*z+1.25*np.sin(.13*z)
        rifts=np.zeros_like(x)
        for at,lean,width,depth in [(-16,.14,.75,2.3),(-9,-.19,.55,1.4),(3,.18,.42,1.8),(12,-.22,.73,3.2),(18,-.16,.65,2.6)]:
            rifts+=depth*np.exp(-np.abs(x-at-lean*z-.42*np.sin(z*.41))/width)
        cx=np.clip((along+29)/63,0,1)*(coast.shape[1]-1)
        cz=np.clip((bedding+7)/42,0,1)*(coast.shape[0]-1)
        scan=map_coordinates(coast,[cz,cx],order=1)
        brow=13.4-.12*z+.10*x+2.1*np.cos(x*.19+z*.09)+1.85*scan-rifts
        summit=27.1-.35*y-.18*x+2.6*np.sin(x*.26)+1.8*grain(x,y,19)-.78*rifts
        solid=join(y-brow,z-summit,.95)
        solid=join(solid,abs(x+.16*z+1.35*np.sin(.15*y))-24+.09*z+.10*y,1.8)
        solid=join(solid,.67*abs(x+5)+.52*y+.32*z-22,1.1)
        solid=join(solid,-y-27,1.3)
        solid=join(solid,-z-5.2,.8)
        # The two sides recede at different angles. The vaulted roof steps down
        # toward a blind back wall, with a low rock rib crossing the left jamb.
        offset=-1.5+.18*y-.12*z+.72*np.sin(.22*z+.11*y)
        opening=9.7+.16*y-.205*z
        roof=11.3+.16*y-.20*x-.44*abs(x-offset)+.85*np.sin(.28*x-.08*y)
        cave=join(abs(x-offset)-opening,z-roof,1.45)
        cave=join(cave,-y-10.5+.34*x+1.8*np.sin(x*.24),2.)
        body=join(solid,-cave,.60)
        # Narrow opening fractures leave broken teeth along the lip and split
        # the exposed piers; they taper shut in the intact rock behind the face.
        for at,lean,depth,base in [(-18,.18,4.,1.),(-12,-.27,5.,7.),(-5,.21,6.,13.),
                                   (2,-.08,7.,11.),(10,.23,3.,2.),(19,-.20,4.,1.)]:
            path=at+lean*z+.34*np.sin(.48*z+at)+.13*y
            width=.16+.075*np.maximum(0,y-depth)+.25*np.sin(.32*z+.18*y)
            slit=np.maximum.reduce([abs(x-path)-np.maximum(.09,width),depth-y,base-z+.2*x])
            body=join(body,-slit,.22)
        chip=(.37*grain(along,bedding,8.2)+.19*grain(y+.17*z,bedding,6.7)+.14*grain(x,y,5.4))
        joint=np.minimum.reduce([abs(bedding-v) for v in (-1.2,5.3,14.9,18.1,31.2)])
        volume[:,:,k]=body-chip+.82*np.exp(-joint/.35)
    verts,faces,_,_=marching_cubes(volume,level=0,spacing=(cell,cell,cell),allow_degenerate=False)
    verts+=np.array([a[0] for a in axes])
    # Exterior normals must face into air, including the underside of the roof.
    a,b,c=verts[faces].transpose(1,0,2)
    if np.einsum('ij,ij->',a,np.cross(b,c))<0: faces=faces[:,::-1]
    x,y,z=verts.T
    theta=np.radians(-36.5)
    radius=207+y
    pos=np.stack((radius*np.cos(theta)-x*np.sin(theta),
                  -radius*np.sin(theta)-x*np.cos(theta),z),axis=1)
    # This local tangent/outward/up basis has positive determinant in Blender.
    np.savez_compressed(work/'tidal_grotto.npz',position=pos.astype('f4'),faces=faces.astype('i4'))
