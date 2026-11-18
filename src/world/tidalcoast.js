// Tidal limestone below the Red Keep. The Blender asset contains the colour, distant
// meshes and metre-spaced landing surfaces for each formation around the headland.
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { G, patchAtmosphere } from '../core/glsl.js';

// Keep the UVs of the photograph, its registered normal map and its roughness.
// The extra fine normal breaks up the image texels on the largest cliff faces.
function coastalStone(source, detail, ledge, headwall) {
  const mat = source.clone();
  mat.side = THREE.DoubleSide;
  mat.metalness = 0;
  mat.roughness = .94;
  mat.aoMap = mat.roughnessMap;
  mat.aoMapIntensity = .65;
  for (const tex of [mat.map, mat.normalMap, mat.roughnessMap]) {
    if (tex) tex.anisotropy = 8;
  }
  return patchAtmosphere(mat, shader => {
    shader.uniforms.uFineStone = { value: detail };
    shader.uniforms.uLedge = { value: ledge };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uFineStone, uLedge;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        float luma = dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
        float plants = smoothstep(.005,.048,diffuseColor.g-diffuseColor.r*.92);
        vec3 stone = mix(vec3(luma)*vec3(1.02,1.015,.99),diffuseColor.rgb,.34);
        diffuseColor.rgb = mix(stone*${headwall ? '1.48' : '1.68'},diffuseColor.rgb*1.14,plants);
        // The camera can see the backs of turned-in scan edges from the air.
        // Give upward-facing benches soil and grain at a fixed scale in metres.
        #ifdef FLAT_SHADED
          vec3 face=normalize(cross(dFdx(vAtmoWorld),dFdy(vAtmoWorld)));
        #else
          vec3 face=inverseTransformDirection(normalize(vNormal),viewMatrix);
          if (!gl_FrontFacing) face=-face;
        #endif
        ${headwall ? `
        vec3 blend=pow(abs(face),vec3(4.));
        blend/=max(dot(blend,vec3(1.)),.001);
        vec3 p=vAtmoWorld/6.3;
        vec3 surface=texture2D(uLedge,p.zy).rgb*blend.x
                    +texture2D(uLedge,p.xz).rgb*blend.y
                    +texture2D(uLedge,p.xy).rgb*blend.z;
        // Estimate the physical area and aspect ratio of one photo texel on
        // this face. Replace grazing, smeared UVs with metre-scale stone grain.
        vec2 dx=dFdx(vMapUv),dy=dFdy(vMapUv);
        vec3 wx=dFdx(vAtmoWorld),wy=dFdy(vAtmoWorld);
        vec2 texels=vec2(textureSize(map,0));
        vec3 pu=(wx*dy.y-wy*dx.y)/texels.x;
        vec3 pv=(wy*dx.x-wx*dy.x)/texels.y;
        float sum=dot(pu,pu)+dot(pv,pv);
        float anisotropy=sum/max(length(cross(pu,pv)),1e-15);
        float worn=smoothstep(5.,13.,anisotropy);
        vec3 broken=surface*vec3(.98,1.01,.99);
        diffuseColor.rgb=mix(diffuseColor.rgb,broken,.83*worn);
        float mineral=dot(surface,vec3(.2126,.7152,.0722));
        diffuseColor.rgb*=clamp(.62+mineral*2.05,.70,1.40);
        ` : ''}
        float bench=smoothstep(.45,.84,face.y)*smoothstep(2.,8.,vAtmoWorld.y);
        if (bench>.001) {
          vec3 chips=texture2D(uLedge,vAtmoWorld.xz*.29).rgb;
          float soil=texture2D(uLedge,vAtmoWorld.xz*.051+vec2(.31,.55)).g;
          vec3 bed=mix(chips*vec3(.88,.87,.78),chips*vec3(.24,.34,.14),smoothstep(.20,.39,soil));
          diffuseColor.rgb=mix(diffuseColor.rgb,bed,bench*.68);
        }
        float wet=0.;
        if (vAtmoWorld.y<3.) {
          vec2 shore=vec2(dot(vAtmoWorld.xz,vec2(.82,.57)),vAtmoWorld.y);
          float growth=texture2D(uLedge,shore*.63).g;
          float ripple=.16*sin(shore.x*.77)+.13*sin(shore.x*1.67+.9);
          float tide=vAtmoWorld.y+ripple+(growth-.25)*.8;
          wet=1.-smoothstep(.35,1.72,tide);
          diffuseColor.rgb*=mix(vec3(1.),vec3(.35,.43,.40),wet);
          float wrack=(1.-smoothstep(.11,.54,abs(tide-.42)))*smoothstep(.19,.37,growth);
          diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.114,.065,.026)*(.63+growth),wrack*.72);
        }
      `)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor,max(.32,roughnessFactor*.60),wet);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        ${headwall ? '\n#ifndef FLAT_SHADED\nnormal=normalize(mix(normal,normalize(vNormal),.75*worn));\n#endif\n' : ''}
        if (length(vAtmoWorld-cameraPosition) < 145.) {
          vec3 N = inverseTransformDirection(normal,viewMatrix);
          vec3 weights = pow(abs(N),vec3(4.)); weights /= dot(weights,vec3(1.));
          vec3 p = vAtmoWorld / 1.55;
          vec2 sx = texture2D(uFineStone,vec2(-sign(N.x)*p.z,p.y)).rg*2.-1.;
          vec2 sy = texture2D(uFineStone,vec2(p.x,-sign(N.y)*p.z)).rg*2.-1.;
          vec2 sz = texture2D(uFineStone,vec2(sign(N.z)*p.x,p.y)).rg*2.-1.;
          vec3 bump = vec3(0.,sx.y,-sign(N.x)*sx.x)*weights.x
                     +vec3(sy.x,0.,-sign(N.y)*sy.y)*weights.y
                     +vec3(sign(N.z)*sz.x,sz.y,0.)*weights.z;
          float strength=.38*(1.-smoothstep(55.,145.,length(vAtmoWorld-cameraPosition)));
          normal=normalize(normal+mat3(viewMatrix)*(bump-N*dot(bump,N))*strength);
        }`);
  }, headwall ? 'photographed-headwall' : 'photographed-coastal-stone');
}

let detailMaps;
async function loadSections(asset) {
  detailMaps ??= Promise.all([
    new THREE.TextureLoader().loadAsync('/textures/rock_face_03/nor.jpg'),
    new THREE.TextureLoader().loadAsync('/textures/rock_boulder_dry/diff.jpg'),
  ]);
  const [gltf, [detail, ledge]] = await Promise.all([
    new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync('/models/' + asset),
    detailMaps,
  ]);
  ledge.colorSpace = THREE.SRGBColorSpace;
  for (const tex of [detail, ledge]) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.anisotropy = 4; }
  const sections = [], materials = new Map();
  gltf.scene.traverse(mesh => {
    const patch = mesh.userData.heightPatch;
    if (!mesh.isMesh || !patch) return;
    patch.data = Uint8Array.from(atob(patch.data), c => c.charCodeAt(0));
    if (!materials.has(mesh.material)) materials.set(mesh.material, coastalStone(mesh.material, detail, ledge, !!mesh.userData.centre));
    mesh.material = materials.get(mesh.material);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.geometry.computeBoundingSphere();
    sections.push({ mesh, patch, hi: mesh.geometry, mid: gltf.scene.getObjectByName(mesh.name + '_mid')?.geometry,
      lo: gltf.scene.getObjectByName(mesh.name + '_lo').geometry });
  });
  return sections;
}

export async function loadTidalCoast() {
  try { return await loadSections('blackwater_ledges.glb'); }
  catch (e) { console.warn('[tidal coast]', e); return []; }
}

export async function loadScannedHeadland() {
  const sections = await loadSections('blackwater_headland.glb');
  return {
    centre: sections[0].mesh.userData.centre,
    parts: sections.map(({ mesh, patch, hi, mid, lo }) => ({
      name: mesh.name, geo: hi, material: mesh.material, patch, mid, lo,
    })),
  };
}

// The sampled upper envelope matches the flight controller's existing heightfield collision.
export function landingSurface(sections, [cx, cz]) {
  const patches = sections.map(section => section.patch);
  const minX = Math.min(...patches.map(p => p.x)), maxX = Math.max(...patches.map(p => p.x + p.width));
  const minZ = Math.min(...patches.map(p => p.z)), maxZ = Math.max(...patches.map(p => p.z + p.height));
  return (worldX, worldZ) => {
    const x = worldX - cx, z = worldZ - cz;
    if (x < minX || x >= maxX || z < minZ || z >= maxZ) return 0;
    let height = 0;
    for (const p of patches) {
      const fx=x-p.x, fz=z-p.z;
      if (fx<0 || fz<0 || fx>=p.width-1 || fz>=p.height-1) continue;
      const ix=Math.floor(fx), iz=Math.floor(fz), tx=fx-ix, tz=fz-iz, i=ix+iz*p.width;
      const top=THREE.MathUtils.lerp(p.data[i],p.data[i+1],tx);
      const bottom=THREE.MathUtils.lerp(p.data[i+p.width],p.data[i+p.width+1],tx);
      height=Math.max(height,THREE.MathUtils.lerp(top,bottom,tz)*p.unit);
    }
    return height;
  };
}

// Distance in metres to the actual rock/water intersection. A ray drawn under
// an overhang reaches the back of the cave before it meets a wet rock face.
function tidalDistance(geometries) {
  const size = 512, half = size / 2, reach = 12;
  const dist = new Float32Array(size * size).fill(reach);
  const crossings = new Float32Array(4);
  for (const geo of geometries) {
    const p = geo.attributes.position, idx = geo.index;
    const count = idx ? idx.count : p.count;
    for (let i = 0; i < count; i += 3) {
      let used = 0;
      for (let j = 0; j < 3; j++) {
        const a = idx ? idx.getX(i+j) : i+j, k = i+(j+1)%3;
        const b = idx ? idx.getX(k) : k, ya = p.getY(a), yb = p.getY(b);
        if ((ya > .12) === (yb > .12)) continue;
        const t = (.12-ya)/(yb-ya);
        crossings[used++] = half+THREE.MathUtils.lerp(p.getX(a),p.getX(b),t);
        crossings[used++] = half+THREE.MathUtils.lerp(p.getZ(a),p.getZ(b),t);
      }
      if (used !== 4) continue;
      const [x,z,u,v] = crossings, steps = Math.max(1,Math.ceil(Math.hypot(u-x,v-z)*2));
      for (let s=0; s<=steps; s++) {
        const ix=Math.floor(x+(u-x)*s/steps), iz=Math.floor(z+(v-z)*s/steps);
        if (ix>=0 && iz>=0 && ix<size && iz<size) dist[iz*size+ix]=0;
      }
    }
  }
  for (const direction of [1,-1]) {
    for (let j=1;j<size-1;j++) for (let k=1;k<size-1;k++) {
      const y=direction===1?j:size-1-j, x=direction===1?k:size-1-k;
      const i=y*size+x, row=i-direction*size;
      dist[i]=Math.min(dist[i],dist[i-direction]+1,dist[row]+1,
        dist[row-direction]+Math.SQRT2,dist[row+direction]+Math.SQRT2);
    }
  }
  const map=new THREE.DataTexture(Uint8Array.from(dist,v=>Math.round(255*v/reach)),
    size,size,THREE.RedFormat);
  map.minFilter=map.magFilter=THREE.LinearFilter;
  map.needsUpdate=true;
  return map;
}

// A small planar reflection of the actual coast. Only its distant meshes enter
// this pass. Transparent pixels let the existing ocean shader reflect the sky.
export class CoastReflection {
  constructor(centre, headland, sections, uniforms) {
    this.sites = [];
    this.uniforms = uniforms;
    this.camera = new THREE.PerspectiveCamera();
    this.target = new THREE.WebGLRenderTarget(480,270,{type:THREE.HalfFloatType});
    this.clearColor = new THREE.Color();
    this.forward = new THREE.Vector3();
    this.up = new THREE.Vector3();
    this.lastUpdate = -Infinity;
    uniforms.uCoastMirror.value = this.target.texture;
    const ripple=new THREE.TextureLoader().load('/textures/blackwater_ripples.png');
    ripple.wrapS=ripple.wrapT=THREE.RepeatWrapping;
    ripple.anisotropy=8;
    uniforms.uCoastRipple.value=ripple;
    this.addSite(centre, headland.parts, sections);
    uniforms.uCoastContact.value = this.sites[0].contact;
  }

  addSite(centre, parts, sections = []) {
    const position = new THREE.Vector3(centre[0], 0, centre[1]);
    const scene = new THREE.Scene();
    const contact = tidalDistance([...parts.map(p => p.lo || p.geo), ...sections.map(s => s.lo)]);
    this.sites.push({ position, scene, contact });
    const makeMaterial = (map, weathered = false) => new THREE.ShaderMaterial({
      uniforms: { uStone: { value: map }, uSunDir: G.uSunDir, uSunColor: G.uSunColor, uAmbSky: G.uAmbSky, uAmbGround: G.uAmbGround },
      vertexColors: !map || weathered,
      vertexShader: `varying vec3 n, pigment; varying float altitude; varying vec2 vUV;
        void main(){n=normal; ${map ? 'vUV=uv;' : ''} ${!map || weathered ? 'pigment=color.rgb;' : ''} altitude=position.y;
          gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `uniform vec3 uSunDir,uSunColor,uAmbSky,uAmbGround; uniform sampler2D uStone;
        varying vec3 n,pigment; varying float altitude; varying vec2 vUV;
        void main(){if(altitude<0.)discard; vec3 N=normalize(n);
          vec3 stone=${map ? 'texture2D(uStone,vUV).rgb' : 'mix(vec3(.26,.25,.225),vec3(.068,.078,.035),pigment.g*smoothstep(.32,.85,N.y))*pigment.r'};
          ${map ? 'stone=mix(vec3(dot(stone,vec3(.2126,.7152,.0722))),stone,.4)*1.55;' : ''}
          ${weathered ? 'stone*=pigment;' : ''}
          vec3 light=mix(uAmbGround,uAmbSky,N.y*.5+.5)+uSunColor*max(0.,dot(N,uSunDir));
          gl_FragColor=vec4(stone*light*.85,1.);}`,
    });
    const add = (geo,mat) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(position);
      scene.add(mesh);
    };
    const upper = makeMaterial(null), reflected = new Map();
    const reflectedStone = (map, weathered = false) => {
      if (!reflected.has(map)) reflected.set(map, makeMaterial(map, weathered));
      return reflected.get(map);
    };
    for (const part of parts) add(part.lo || part.geo, part.material ? reflectedStone(part.material.map, !!part.geo.attributes.color) : upper);
    for (const section of sections) {
      const map = section.mesh.material.map;
      add(section.lo, reflectedStone(map));
    }
  }

  render(renderer, camera, time) {
    const u=this.uniforms, p=camera.position;
    const site = this.sites.find(s => p.distanceToSquared(s.position) < 1500 * 1500);
    if (!site || p.y > 360 || p.y < 0) { u.uCoastVisible.value=0; return; }
    if (site === this.activeSite && u.uCoastVisible.value && time-this.lastUpdate<.085) return;
    this.activeSite = site;
    const distance = p.distanceTo(site.position);
    u.uCoastContact.value = site.contact;
    u.uCoastCentre.value.set(site.position.x, site.position.z);
    this.lastUpdate=time;
    u.uCoastVisible.value=(1-THREE.MathUtils.smoothstep(distance,1000,1500)) *
      (1-THREE.MathUtils.smoothstep(p.y,230,360));
    const mirror=this.camera;
    mirror.position.copy(p); mirror.position.y *= -1;
    camera.getWorldDirection(this.forward); this.forward.y *= -1;
    this.up.set(0,1,0).applyQuaternion(camera.quaternion); this.up.y *= -1;
    mirror.up.copy(this.up);
    mirror.lookAt(this.forward.add(mirror.position));
    mirror.projectionMatrix.copy(camera.projectionMatrix);
    mirror.updateMatrixWorld();
    u.uCoastProject.value.multiplyMatrices(mirror.projectionMatrix,mirror.matrixWorldInverse);
    const previous=renderer.getRenderTarget(), alpha=renderer.getClearAlpha();
    renderer.getClearColor(this.clearColor);
    renderer.setRenderTarget(this.target); renderer.setClearColor(0x000000,0);
    renderer.clear(); renderer.render(site.scene,mirror);
    renderer.setRenderTarget(previous); renderer.setClearColor(this.clearColor,alpha);
  }
}
