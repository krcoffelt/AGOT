"""Reconstruct rock surfaces in the supplied 1456 x 816 inlet reference.
python reference_inlet.py reference.png work [relative-depth.npy]
With no depth input, estimate it using Depth Anything V2 Small (torch/transformers).
Only de-lit stone, surface normals and closed meshes are exported to the game.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt, gaussian_filter, gaussian_filter1d, map_coordinates, maximum_filter1d

W,H=1456,816
FOCAL,EYE=1030.,4.35
BODIES={
    # Visible crown and contact with the water, traced independently of the depth model.
    'Cove_Wall': (
        [(-310,581),(-235,284),(-155,145),(-72,-23),(0,-28),(52,-4),(76,17),(110,34),(141,43),(195,43),(235,47),(252,64),(282,57),(309,67),(328,61),(341,58),(355,69),(381,56),(390,65),(406,53),(421,53),(432,74),(457,79),(469,94),(490,98),(494,141),(522,144),(548,149),(574,147),(598,149),(610,145),(629,149),(641,150),(665,164),(685,154),(705,151),(721,124),(743,114),(755,99),(776,89),(789,90),(804,94),(821,90),(840,81),(862,76),(886,64),(908,57),(924,48),(954,39),(982,24),(1005,10),(1032,-2),(1110,-69),(1240,-133),(1330,-116),(1455,-75),(1560,-14),(1662,97),(1780,252),(1880,550)],
        [(-310,584),(-80,563),(0,548),(67,545),(115,548),(159,550),(222,548),(254,548),(298,545),(345,546),(401,549),(451,543),(485,524),(526,520),(560,517),(596,519),(638,517),(690,517),(740,516),(801,518),(828,519),(851,538),(899,542),(922,544),(959,540),(1009,537),(1067,541),(1162,549),(1290,557),(1455,561),(1880,556)],
        513,193,64,17.0),
    'Cove_Split_Slab':(
        [(1008,613),(1028,569),(1050,545),(1068,536),(1078,521),(1098,520),(1109,505),(1123,499),(1130,478),(1149,474),(1163,466),(1180,449),(1184,423),(1193,410),(1200,369),(1211,332),(1224,314),(1243,314),(1260,301),(1283,300),(1313,307),(1336,287),(1354,279),(1382,298),(1399,314),(1421,298),(1455,273),(1530,236),(1615,289),(1690,450),(1740,616)],
        [(1008,614),(1034,595),(1069,609),(1106,615),(1150,616),(1190,622),(1234,620),(1292,624),(1350,626),(1403,626),(1455,627),(1740,620)],257,145,48,8.4),
    'Cove_Foreground_Skerry':(
        [(-360,789),(-280,722),(-185,649),(-96,582),(0,561),(23,554),(54,559),(79,559),(100,568),(112,602),(126,620),(151,633),(184,635),(207,640),(237,643),(264,650),(279,661),(313,666),(344,666),(373,681),(395,671),(419,660),(441,659),(446,674),(479,677),(494,682),(507,695),(523,700)],
        [(-360,791),(0,778),(64,778),(110,785),(174,784),(229,780),(275,774),(286,752),(329,750),(376,750),(419,736),(454,728),(493,719),(523,703)],257,97,48,3.5)
}
def bound(points,x):
    return np.interp(x,*np.array(points).T)

def estimate(image,work):
    import torch
    from transformers import AutoImageProcessor,AutoModelForDepthEstimation
    model='depth-anything/Depth-Anything-V2-Small-hf'
    proc=AutoImageProcessor.from_pretrained(model,use_fast=False)
    device='mps' if torch.backends.mps.is_available() else 'cpu'
    net=AutoModelForDepthEstimation.from_pretrained(model).to(device).eval()
    maps=[]
    with torch.inference_mode():
        for size in (518,840):
            inputs=proc(images=image,return_tensors='pt',size={'height':size,'width':size})
            res=net(**{k:v.to(device) for k,v in inputs.items()}).predicted_depth.cpu()
            m=torch.nn.functional.interpolate(res[:,None],size=(H,W),mode='bicubic',align_corners=False)[0,0].numpy()
            maps.append((m-np.quantile(m,.02))/(np.quantile(m,.97)-np.quantile(m,.02)))
    return .39*maps[0]+.61*maps[1]

def smooth(a,b,v):
    v=np.clip((v-a)/(b-a),0,1)
    return v*v*(3-2*v)

def prep(photo,depth,work):
    yy,xx=np.mgrid[:H,:W]
    masks={}
    for name,(hi,lo,*_) in BODIES.items():
        masks[name]=(yy>=bound(hi,xx))&(yy<=bound(lo,xx))&(xx>=hi[0][0])&(xx<=hi[-1][0])
    silhouette=np.logical_or.reduce(list(masks.values()))
    Image.fromarray((silhouette*255).astype('uint8')).save(work/'reference_rock_mask.png')
    theta=np.radians(34.5); R=np.array([np.cos(theta),np.sin(theta)])
    T=np.array([-R[1],R[0]]); F=.96*T-.28*R
    right=np.array([-F[1],F[0]]);camera=245*R
    # Fill hidden regions with adjacent rock of the same body. Sky and water
    # never become part of an albedo atlas, including on the unseen returns.
    clean=photo.astype('f4')/255
    texdir=Path(__file__).resolve().parents[2]/'public/textures/rock_boulder_dry'
    bedrock=np.asarray(Image.open(texdir/'diff.jpg').convert('RGB'),dtype='f4')/255
    reverse_scan=np.load(work/'coastal_cliff_02.npy')
    rough=(np.asarray(Image.open(texdir/'disp.jpg').convert('L'),dtype='f4')-128)/95
    masks['Cove_Wall']&=~(masks['Cove_Split_Slab']|masks['Cove_Foreground_Skerry'])
    for name,(crown,toe,nx,nfront,nback,thickness) in BODIES.items():
        valid=masks[name]
        distance,nearest=distance_transform_edt(~valid,return_indices=True)
        hidden=smooth(1.,28.,distance)
        # Out-of-sight surfaces cannot inherit a stretched border pixel. Replace
        # them with a separate patch of limestone and a smoothly continued depth.
        ru=(.73*xx+.08*yy)%506
        rv=(.69*yy-.06*xx)%450
        rx=766+np.minimum(ru,506-ru);ry=134+np.minimum(rv,450-rv)
        continuation=np.stack([map_coordinates(clean[:,:,j],[ry,rx],order=1) for j in range(3)],axis=-1)
        filled=clean[tuple(nearest)]*(1-hidden[:,:,None])+continuation*hidden[:,:,None]
        immediate=depth[tuple(nearest)]
        den=gaussian_filter(valid.astype('f4'),45)
        far=gaussian_filter(depth*valid,45)/np.maximum(.0001,den)
        fallback=gaussian_filter(immediate,40)
        far=np.where(den>.015,far,fallback)
        dep=gaussian_filter(immediate*(1-hidden)+hidden*far,3.)
        grey=filled@np.array([.213,.715,.072],dtype='f4')
        broad=gaussian_filter(grey,19)
        # Remove most of the directional light but retain actual mineral boundaries.
        # The game relights the displaced surface and its fitted tangent normals.
        intrinsic=np.clip(filled*(.49/np.maximum(.12,broad))[:,:,None]**.69,.025,.92)
        tone=intrinsic@np.array([.213,.715,.072],dtype='f4')
        intrinsic=.30*intrinsic+.70*tone[:,:,None]*np.array([1.018,1.014,.985])
        residual=grey-gaussian_filter(grey,3.6)
        # A source patch for the rest of the cape. The bandpassed inverse depth
        # and narrow fracture residual remain registered with the stone colour.
        if name=='Cove_Wall':
            for idx,(left,top,end,bottom) in enumerate(((679,143,1148,501),(34,99,392,397),(782,112,1120,431))):
                rect=np.s_[top:bottom,left:end]
                ridge=(dep-gaussian_filter(dep,29))*44+residual*.82
                source=np.dstack((ridge,intrinsic*255))[rect]
                np.save(work/f'limestone_plate_{idx}.npy',source.astype('f4'))
        def sample(data,px,py):
            # Mirror the photographed stone across the image edge for the portion
            # of the formation that continues out of frame in the original view.
            def mirror(a,limit):return limit-np.abs(np.mod(a,2*limit)-limit)
            coords=[mirror(py,H-1),mirror(px,W-1)]
            if data.ndim==2:return map_coordinates(data,coords,order=1)
            return np.stack([map_coordinates(data[:,:,i],coords,order=1) for i in range(data.shape[2])],axis=-1)
        def generate(cols,rows,start=0,stop=None):
            u,v=np.meshgrid(np.linspace(0,1,cols),np.linspace(0,1,rows)[start:stop])
            px=crown[-1][0]-(crown[-1][0]-crown[0][0])*u
            crest=bound(crown,px); contact=bound(toe,px)
            split=(nfront-1)/(nfront+nback-1)
            t=np.clip(v/split,0,1)
            # The lower edge extends below the water for parallax and reflections.
            py=(1-t)*(contact+16)+t*crest
            dt=sample(dep,px,np.clip(contact-6,0,H-1))
            dt=gaussian_filter1d(dt,max(.8,cols*.014),axis=1,mode='nearest')
            value=sample(dep,px,py)
            base=FOCAL*EYE/np.maximum(76,contact-H/2)
            delta=np.clip((value-dt)*1.20,-.25,.53)
            zview=base/(1+delta)
            # Lift fine cleavage into the mesh and continue the darker arch and
            # notch several metres back beneath the projecting upper rock.
            if name=='Cove_Wall':
                left=np.exp(-((px-419)/62)**4-((py-437)/105)**4)
                cleft=np.exp(-((px-1197)/42)**4-((py-354)/126)**4)
                zview+=(left*5.3+cleft*3.7)*smooth(2,55,contact-py)
            detail=sample(residual,px,py)
            zview-=detail*np.clip(base*.041,.45,2.0)
            # Depth estimators lose precision on a skyline. Constrain the depth
            # gradient there before unprojection; unfiltered jumps create long
            # needles behind the ridge even when its front outline looks correct.
            gentle=gaussian_filter1d(zview,max(1,cols*.016),axis=1,mode='nearest')
            broad_depth=gaussian_filter1d(zview,max(1,cols*.035),axis=1,mode='nearest')
            crest_mix=smooth(.65,.96,t)
            zview=gentle+.48*np.tanh((zview-gentle)/.48)
            zview=(1-crest_mix)*zview+crest_mix*(broad_depth+.36*np.tanh((zview-broad_depth)/.36))
            zview+=(1-smooth(0,22,contact-py))*(base-zview)
            lateral=(px-W/2)*zview/FOCAL
            alt=EYE+(H/2-py)*zview/FOCAL
            back=np.clip((v-split)/(1-split),0,1)
            lip=np.sin(back*np.pi)
            # Construct the reverse slope from a separate, smoothly varying toe
            # and real rock relief. Its angular parameter stays monotone from
            # crest to seabed, even across abrupt depth jumps in the front wall.
            midpx=(crown[-1][0]+crown[0][0])*.5
            toe_depth=gaussian_filter1d(zview,max(1,cols*.065),axis=1,mode='nearest')
            toe_depth+=thickness*(1.22+.42*np.cos(8.9*u+.3)+.17*np.sin(17.4*u-.6))
            ab=smooth(0,.83,back)
            zview=(1-ab)*zview+ab*toe_depth
            return_h=gaussian_filter1d(alt,max(1,cols*.035),axis=1,mode='nearest')
            alt=(1-smooth(.02,.49,back))*alt+smooth(.02,.49,back)*return_h
            drop=smooth(.12,1.,back)
            alt=alt*(1-drop)-2.5*drop
            # The outside of the promontory carries its own leaning beds and
            # fractures. Register their photograph to their relief on that side.
            def mirrored(t):return 1.-np.abs(np.mod(t,2.)-1.)
            sx=mirrored(u*2.43+.14*back+.046*np.sin(alt*.17))
            sy=mirrored(.12+(alt+.10*u*70)/13.5)
            resolution=reverse_scan.shape
            rc=[sy*(resolution[0]-1),sx*(resolution[1]-1)]
            relief=map_coordinates(reverse_scan[:,:,0],rc,order=1)
            crestbelt=smooth(0,.10,back)*(1-smooth(.87,1.,back))
            zview+=crestbelt*min(1.,thickness/13)*(relief*1.55+1.25*np.sin(18.*u+3.8*back))
            alt+=lip*(1.05*np.sin(u*21+.5)+.64*np.cos(u*39.-back*3.))
            proj=px+(midpx-px)*(.12*back)
            lateral=np.where(back>0,(proj-W/2)*zview/FOCAL,lateral)
            plan=camera+zview[:,:,None]*F+lateral[:,:,None]*right
            def ground_texture(data,a,b,scale):
                coords=[(b/scale%1)*(data.shape[0]-1),(a/scale%1)*(data.shape[1]-1)]
                if data.ndim==2:return map_coordinates(data,coords,order=1,mode='wrap')
                return np.stack([map_coordinates(data[:,:,j],coords,order=1,mode='wrap') for j in range(3)],axis=-1)
            chips=ground_texture(rough,plan[:,:,0]+.55*alt,plan[:,:,1]+.8*alt,7.1)
            alt+=lip*chips*.61
            # The hidden side of a low skerry slopes away below its leading rim.
            # Preserve the observed horizon when it is seen from the inlet.
            proj=W/2+lateral*FOCAL/zview
            projected_crown=bound(crown,proj)
            broad_crest=maximum_filter1d(projected_crown,max(3,int(cols*.016)),axis=1,mode='nearest')
            crown_limit=projected_crown+smooth(.03,.40,back)*(broad_crest-projected_crown)
            ceiling=EYE+(H/2-crown_limit)*zview/FOCAL
            ceiling=np.where((proj<crown[0][0])|(proj>crown[-1][0]),-1.8,ceiling)
            alt=np.where(back>0,np.minimum(alt,ceiling-.07*back),alt)
            positions=np.stack([plan[:,:,0],-plan[:,:,1],alt],axis=-1)
            color=sample(intrinsic,px,py)
            # Roll the back and crown away from the lens with a second crop of the
            # rock texture, so the far side has its own grain under flight lighting.
            cap=ground_texture(bedrock,plan[:,:,0]+.62*alt,plan[:,:,1]+.81*alt,7.1)
            cap_photo=np.stack([map_coordinates(reverse_scan[:,:,j],rc,order=1) for j in range(1,4)],axis=-1)/255.
            cap=.32*cap+.68*cap_photo
            fade=smooth(0,.10,back)[:,:,None]
            color=(1-fade)*color+fade*cap*([.85,.89,.79] if name=='Cove_Wall' else [.93,.95,.92])
            return positions,color
        pos,_=generate(nx,nfront+nback)
        np.save(work/(name+'.npy'),pos.astype('f4'))
        # Bake at a higher resolution than the mesh so fine surface grain survives.
        texcols,texrows=(2305,897) if name=='Cove_Wall' else (1281,641)
        paint=np.concatenate([generate(texcols,texrows,start,start+64)[1]
                              for start in range(0,texrows,64)])
        Image.fromarray((paint[::-1].clip(0,1)*255).astype('uint8')).save(work/(name+'.jpg'),quality=95)
        g=paint@np.array([.213,.715,.072])
        v,u=np.gradient(g-gaussian_filter(g,2.6))
        norm=np.stack((-u*2.15,-v*2.15,np.ones_like(u)),axis=-1)
        norm/=np.linalg.norm(norm,axis=-1,keepdims=True)
        Image.fromarray(((norm[::-1]*.5+.5)*255).astype('uint8')).save(work/(name+'_n.jpg'),quality=89)

if __name__=='__main__':
    image=Image.open(sys.argv[1]).convert('RGB').resize((W,H))
    work=Path(sys.argv[2]);work.mkdir(exist_ok=True,parents=True)
    depth=np.load(sys.argv[3]) if len(sys.argv)>3 else estimate(image,work)
    prep(np.asarray(image),depth,work)
