// Procedural architecture kit: accumulates boxes / towers / roofs into a few merged meshes.
import * as THREE from 'three';
import { G, patchAtmosphere } from '../core/glsl.js';
import { hash2, tileFbm, mulberry32 } from '../core/noise.js';
import { planCity } from './cityplan.js';
import { mapLat } from './mapdata.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Buildings modelled and baked in Blender (tools/blender/houses.py: timber-framed northern set; tools/blender/kl_kit.py:
// stone-and-terracotta southern set). Each set shares one atlas; emission atlas R = window glow, B = roof mask.
let HOUSEKIT = null;
// Street-life props (tools/blender/props_kit.py): stalls, carts, boats, ships, banners, townsfolk… one atlas, one material.
let PROPKIT = null;
const LANDMODELS = {};      // landmark meshes modelled in Blender (tools/blender/kl_landmarks.py): name → [{ geo, mat }]
function houseMaterial(map, normalMap, emissiveMap) {
  const m = new THREE.MeshStandardMaterial({ map, normalMap, emissiveMap, emissive: 0xffb060, emissiveIntensity: 0, roughness: 0.92, metalness: 0, normalScale: new THREE.Vector2(1, -1) });
  // aBurn (per house, set by CityFire): x = how fiercely it is burning now, y = how charred it is (stays at 1 once burnt out)
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = G.uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aRoof;\nattribute vec2 aBurn;\nattribute float aLod;\nvarying vec3 vRoofTint;\nvarying vec2 vBurn;').replace('#include <color_vertex>', '#include <color_vertex>\nvRoofTint = aRoof;\nvBurn = aBurn;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nif (aLod > 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);      // drawn in detail by HouseDetail (its shadow still comes from here)');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vRoofTint;\nvarying vec2 vBurn;\nuniform float uTime;')
      .replace('#include <color_fragment>', `vec4 hkE = texture2D(emissiveMap, vEmissiveMapUv);
        diffuseColor.rgb *= mix(vColor, vRoofTint, smoothstep(0.3, 0.62, hkE.b));
        // soot: patchy, heaviest low down and on the roof, near-black where it has taken hold
        float hkSoot = fract(sin(dot(floor(vAtmoWorld * vec3(1.3, 0.9, 1.3)), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.026, 0.023) * (0.55 + 0.9 * hkSoot), clamp(vBurn.y * (0.8 + 0.35 * hkSoot), 0.0, 1.0));`)
      .replace('#include <emissivemap_fragment>', `{ vec3 wc = floor(vAtmoWorld * vec3(0.42, 0.36, 0.42));
        float lit = step(0.42, fract(sin(dot(wc, vec3(12.9898, 78.233, 37.719))) * 43758.5453));
        totalEmissiveRadiance *= smoothstep(0.25, 0.7, hkE.r) * lit * (1.0 - smoothstep(0.3, 0.6, hkE.b)) * (1.0 - vBurn.y); }
        if (vBurn.x > 0.001) {      // firelight: every window blazes, and embers glow through the charred walls and roof
          vec3 ep = vAtmoWorld * 2.6; vec3 ei = floor(ep), ef = smoothstep(0.0, 1.0, fract(ep));     // smooth value noise: glowing cracks, not tiles
          #define EH(o) fract(sin(dot(ei + o, vec3(7.13, 157.1, 113.7))) * 43758.5453)
          float eb = mix(mix(mix(EH(vec3(0,0,0)), EH(vec3(1,0,0)), ef.x), mix(EH(vec3(0,1,0)), EH(vec3(1,1,0)), ef.x), ef.y),
                         mix(mix(EH(vec3(0,0,1)), EH(vec3(1,0,1)), ef.x), mix(EH(vec3(0,1,1)), EH(vec3(1,1,1)), ef.x), ef.y), ef.z);
          float flick = 0.65 + 0.35 * sin(uTime * 8.0 + eb * 30.0);
          totalEmissiveRadiance += vec3(1.0, 0.32, 0.05) * vBurn.x * flick * (smoothstep(0.25, 0.7, hkE.r) * 6.0 + smoothstep(0.7, 0.9, eb) * 1.5 * vBurn.y);
        }`);
  };
  return patchAtmosphere(m, null, 'housekit');
}
export async function loadHouseKit() {
  HOUSEKIT = { types: {}, mats: [] };
  const tl = new THREE.TextureLoader();
  const tex = async (n, srgb) => { const t = await tl.loadAsync('/models/' + n); t.flipY = false; t.anisotropy = 8; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; return t; };
  for (const kit of ['houses', 'kl']) {
    try {
      const [gltf, meta, map, normalMap, emissiveMap] = await Promise.all([new GLTFLoader().loadAsync(`/models/${kit}.glb`), fetch(`/models/${kit}.json`).then(r => r.json()),
        tex(kit + '_albedo.jpg', true), tex(kit + '_normal.jpg', false), tex(kit + '_emit.jpg', false)]);
      const mat = houseMaterial(map, normalMap, emissiveMap); HOUSEKIT.mats.push(mat);
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse(o => { if (o.isMesh && o.name.startsWith('lo_')) { const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); const n = o.name.slice(3); if (meta[n]) HOUSEKIT.types[n] = { geo: g, meta: meta[n], mat }; } });
    } catch (e) { console.warn('[houses] kit', kit, 'not loaded:', e.message); }
  }
  // the King's Landing landmarks prefer their detailed versions (the Unreal prototype's Tools/blender/kl_landmarks_hd.py,
  // same frame, about twice the triangles, with gold, glass and wood picked out); Dragonstone has none
  for (const n of ['redkeep', 'sept', 'dragonpit', 'dragonstone', 'seafort']) {
    try {
      let g = null;
      if (n !== 'dragonstone' && n !== 'seafort') try { g = await new GLTFLoader().loadAsync(`/models/${n}_hd.glb`); } catch (e) { g = null; }
      if (!g) g = await new GLTFLoader().loadAsync(`/models/${n}.glb`);
      const parts = []; g.scene.updateMatrixWorld(true);
      g.scene.traverse(o => { if (o.isMesh) { const geo = o.geometry.clone(); geo.applyMatrix4(o.matrixWorld); geo.computeBoundingBox(); geo.computeBoundingSphere(); parts.push({ geo, mat: o.material.name }); } });
      LANDMODELS[n] = parts;
    } catch (e) { console.warn('[landmark model]', n, 'not loaded:', e.message); }
  }
  try {
    const [gltf, meta, map] = await Promise.all([new GLTFLoader().loadAsync('/models/props.glb'), fetch('/models/props.json').then(r => r.json()), tex('props_albedo.jpg', true)]);
    const mat = patchAtmosphere(new THREE.MeshStandardMaterial({ map, roughness: 0.9, metalness: 0, side: THREE.DoubleSide }), null, 'propkit');
    PROPKIT = { types: {}, mat }; gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(o => { if (o.isMesh && o.name.startsWith('p_')) { const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); const n = o.name.slice(2); if (meta[n]) PROPKIT.types[n] = { geo: g, meta: meta[n], world: o.matrixWorld.clone() }; } });
    animateProps(map);
    swayProps(map);
  } catch (e) { PROPKIT = null; console.warn('[props] kit not loaded:', e.message); }
  if (!Object.keys(HOUSEKIT.types).length) HOUSEKIT = null;
  else await loadHouseDetail();
  return HOUSEKIT;
}

// ---- close-up King's Landing houses (tools/blender/kl_hd_web.py, from the Unreal prototype's detailed kit). Each building is
// one mesh whose second UV's u is a material slot; the eight textured slots read one layer each of two texture stacks (the
// same Poly Haven scans and colour gains Unreal used), the rest are vertex colour only. Kit.build gives every chunk of baked
// houses a detailed twin sharing its instance matrices, tints and fire state; Landmarks.update shows whichever suits the distance.
// The wall gains are lower and warmer than Unreal's (which read grey-white under this game's light), set so each scan's
// average lands on the cream and tan of the baked houses around them.
const HD_SLOTS = [      // texture folder, colour gain, [wall tint, roof tint, streaks, dirt], [lichen, bump]
  ['white_sandstone_bricks_03', [1.15, 1.1, 1.1], [1, 0, 0.5, 0.55], [0, 1.2]],     // stone
  ['white_plaster_rough_01', [2.8, 2.6, 2.7], [1, 0, 0.8, 0.6], [0, 0.8]],           // plaster
  ['plastered_stone_wall', [7.8, 6.9, 6.4], [1, 0, 0.6, 0.6], [0, 1.2]],             // rubble
  ['clay_roof_tiles_03', [1.68, 2.1, 2.65], [0, 1, 0, 0], [0.7, 1.6]],               // roof_a
  ['ceramic_roof_01', [1.45, 1.04, 1.2], [0, 1, 0, 0], [0.8, 1.6]],                  // roof_b
  ['roof_tiles_14', [2.86, 1.84, 2.0], [0, 1, 0, 0], [0.6, 1.6]],                    // roof_c
  ['dark_planks', [1.6, 1.6, 1.6], [0, 0, 0.3, 0.4], [0, 1.2]],                      // wood
  ['wood_shutter', [1.9, 5.0, 16.0], [0, 0, 0.4, 0.5], [0, 1.2]],                    // shutter
];                       // slots 8 glass, 9 flat, 10 cloth
// The houses nearest the camera, drawn in detail: every so often the closest (within RANGE, at most CAP of them) are copied into
// one instanced mesh per building type, and their baked boxes are hidden from the main pass by aLod. The boxes still cast
// the shadows, which is close enough and keeps the shadow pass as cheap as before.
export class HouseDetail {
  constructor(scene, landmarks, range = 170, cap = 260) {
    this.range = range; this.cap = cap; this.houses = []; this.grid = new Map(); this.meshes = {}; this.shown = []; this.last = null; this.t = 0;
    if (!HOUSEKIT || !HOUSEKIT.hdMat) return;
    const mtx = new THREE.Matrix4();
    for (const s of landmarks.sites) {
      s.group.updateMatrixWorld(true);
      for (const im of s.group.children) {
        const list = im.userData.houseList; if (!list) continue;
        const T = HOUSEKIT.types[list[0].type]; if (!T || !T.hd) continue;
        const geo = im.geometry, lod = geo.getAttribute('aLod'), roof = geo.getAttribute('aRoof'), burn = geo.getAttribute('aBurn');
        list.forEach((h, i) => {
          im.getMatrixAt(i, mtx); mtx.premultiply(s.group.matrixWorld);
          const k = this.houses.push({ type: h.type, x: s.x + h.x, y: h.y, z: s.z + h.z, m: mtx.clone(), wall: h.tint, roof, burn, lod, i }) - 1;
          const key = Math.floor((s.x + h.x) / 64) * 100003 + Math.floor((s.z + h.z) / 64); let l = this.grid.get(key); if (!l) this.grid.set(key, l = []); l.push(k);
        });
      }
    }
    for (const type of new Set(this.houses.map((h) => h.type))) {
      const hd = HOUSEKIT.types[type].hd, g = new THREE.BufferGeometry(); g.index = hd.index; for (const a in hd.attributes) g.setAttribute(a, hd.attributes[a]);
      for (const [n, sz] of [['aWall', 3], ['aRoof', 3], ['aBurn', 2]]) g.setAttribute(n, new THREE.InstancedBufferAttribute(new Float32Array(cap * sz), sz).setUsage(THREE.DynamicDrawUsage));
      const m = new THREE.InstancedMesh(g, HOUSEKIT.hdMat, cap); m.count = 0; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = true; m.name = 'hd_' + type;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); this.meshes[type] = m;
    }
    console.log(`[houses] ${this.houses.length} houses can be drawn in detail`);
  }
  update(camPos, dt = 0) {
    if (!this.houses.length) return;
    this.t += dt;
    const moved = !this.last || Math.hypot(camPos.x - this.last.x, camPos.y - this.last.y, camPos.z - this.last.z) > 6;
    if (!moved && this.t < 0.25) return;
    this.t = 0; this.last = camPos.clone();
    // who is close enough, nearest first
    const R = this.range, near = [];
    for (let ix = Math.floor((camPos.x - R) / 64); ix <= Math.floor((camPos.x + R) / 64); ix++) for (let iz = Math.floor((camPos.z - R) / 64); iz <= Math.floor((camPos.z + R) / 64); iz++) {
      const l = this.grid.get(ix * 100003 + iz); if (!l) continue;
      for (const k of l) { const h = this.houses[k], d = Math.hypot(h.x - camPos.x, h.y - camPos.y, h.z - camPos.z); if (d < R) near.push([d, k]); }
    }
    near.sort((a, b) => a[0] - b[0]); if (near.length > this.cap) near.length = this.cap;
    const dirty = new Set();
    for (const k of this.shown) { const h = this.houses[k]; h.lod.array[h.i] = 0; dirty.add(h.lod); }
    for (const m of Object.values(this.meshes)) m.count = 0;
    this.shown = near.map((n) => n[1]);
    for (const k of this.shown) {
      const h = this.houses[k], m = this.meshes[h.type], j = m.count++, g = m.geometry;
      m.setMatrixAt(j, h.m);
      g.attributes.aWall.array.set(h.wall, j * 3);
      g.attributes.aRoof.array.set(h.roof.array.subarray(h.i * 3, h.i * 3 + 3), j * 3);
      g.attributes.aBurn.array.set(h.burn.array.subarray(h.i * 2, h.i * 2 + 2), j * 2);
      h.lod.array[h.i] = 1; dirty.add(h.lod);
    }
    for (const m of Object.values(this.meshes)) { m.instanceMatrix.needsUpdate = true; for (const n of ['aWall', 'aRoof', 'aBurn']) m.geometry.attributes[n].needsUpdate = true; }
    for (const a of dirty) a.needsUpdate = true;
  }
}
async function textureStack(files, srgb, S = 1024) {
  const data = new Uint8Array(S * S * 4 * files.length), cv = document.createElement('canvas'); cv.width = cv.height = S;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  // load events, not img.decode(): decode() never settles while the tab is in the background
  const imgs = await Promise.all(files.map((f) => new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = () => rej(new Error('no ' + f)); img.src = f; })));
  for (let i = 0; i < files.length; i++) {
    const img = imgs[i];
    ctx.drawImage(img, 0, 0, S, S); data.set(ctx.getImageData(0, 0, S, S).data, i * S * S * 4);       // top row first: glTF's uv convention
  }
  const t = new THREE.DataArrayTexture(data, S, S, files.length);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.anisotropy = 8;
  t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;      // colour layers are decoded from sRGB in the shader (an sRGB array texture was not)
  return t;
}
async function loadHouseDetail() {
  try {
    const [gltf, diff, norm] = await Promise.all([new GLTFLoader().loadAsync('/models/kl_hd.glb'),
      textureStack(HD_SLOTS.map((s) => `/textures/${s[0]}/diff.jpg`), true), textureStack(HD_SLOTS.map((s) => `/textures/${s[0]}/nor.jpg`), false)]);
    const { mergeGeometries } = await import('three/examples/jsm/utils/BufferGeometryUtils.js');
    const parts = {}; gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      let n = o; while (n && !/^hd_/.test(n.name)) n = n.parent; if (!n) return;
      const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
      (parts[n.name.slice(3).replace(/_\d+$/, '')] ||= []).push(g);
    });
    const mat = hdHouseMaterial(diff, norm); HOUSEKIT.mats.push(mat); HOUSEKIT.hdMat = mat;
    let n = 0;
    for (const [type, list] of Object.entries(parts)) {
      const T = HOUSEKIT.types[type]; if (!T) continue;
      const g = list.length > 1 ? mergeGeometries(list) : list[0];
      g.setAttribute('aTexUv', g.getAttribute('uv')); g.setAttribute('aSlotUv', g.getAttribute('uv1'));
      const c = g.getAttribute('color');
      if (c.itemSize === 3) { const a = new Float32Array(c.count * 4); for (let i = 0; i < c.count; i++) { a.set([c.getX(i), c.getY(i), c.getZ(i), 1], i * 4); } g.setAttribute('color', new THREE.BufferAttribute(a, 4)); }
      g.deleteAttribute('uv'); g.deleteAttribute('uv1');
      T.hd = g; n++;
    }
    console.log(`[houses] ${n} close-up house models`);
  } catch (e) { console.warn('[houses] close-up kit not loaded:', e.message); }
}
function hdHouseMaterial(diff, norm) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, emissive: 0xffb060, emissiveIntensity: 0 });
  m.onBeforeCompile = (sh) => {
    m.userData.shader = sh;       // for tuning from the console
    Object.assign(sh.uniforms, { uTime: G.uTime, uHdDiff: { value: diff }, uHdNorm: { value: norm },
      uHdGain: { value: HD_SLOTS.map((s) => new THREE.Vector3(...s[1])) }, uHdW: { value: HD_SLOTS.map((s) => new THREE.Vector4(...s[2])) }, uHdL: { value: HD_SLOTS.map((s) => new THREE.Vector2(...s[3])) } });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      attribute vec2 aTexUv, aSlotUv, aBurn; attribute vec3 aRoof, aWall;
      varying vec2 hdUv, hdBurn; varying float hdSlot; varying vec3 hdWall, hdRoof;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      hdUv = aTexUv; hdSlot = aSlotUv.x - 0.5; hdWall = aWall; hdRoof = aRoof; hdBurn = aBurn;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform float uTime; uniform highp sampler2DArray uHdDiff, uHdNorm; uniform vec3 uHdGain[8]; uniform vec4 uHdW[8]; uniform vec2 uHdL[8];
      varying vec2 hdUv, hdBurn; varying float hdSlot; varying vec3 hdWall, hdRoof;
      float hdHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      float hdNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hdHash(i), hdHash(i + vec2(1, 0)), f.x), mix(hdHash(i + vec2(0, 1)), hdHash(i + vec2(1, 1)), f.x), f.y); }
      mat3 hdFrame(vec3 N, vec3 p, vec2 uv) {
        vec3 dp1 = dFdx(p), dp2 = dFdy(p); vec2 du1 = dFdx(uv), du2 = dFdy(uv);
        vec3 a = cross(dp2, N), b = cross(N, dp1); vec3 T = a * du1.x + b * du2.x, B = a * du1.y + b * du2.y;
        float k = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-12)); return mat3(T * k, B * k, N); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      int hs = int(hdSlot + 0.5); vec3 hp = vAtmoWorld; float clean = vColor.a;
      float m1 = hdNoise(hp.xz / 31.0 + hp.y / 17.0), m2 = hdNoise(vec2((hp.x + hp.z) / 2.3, hp.y / 7.0)), m3 = hdNoise(hp.xz / 4.7 + hp.y / 3.1);
      float bn = hdNoise(hp.xz / 2.9 + hp.y / 2.1), charW = smoothstep(0.0, 0.3, hdBurn.y * 1.25 - bn * 0.6);
      vec3 hdN = vec3(0.0, 0.0, 1.0); float hdBump = 0.0;
      if (hs < 8) {
        vec3 d = clamp(pow(texture(uHdDiff, vec3(hdUv, float(hs))).rgb, vec3(2.2)) * uHdGain[hs], 0.0, 1.0);
        vec4 w = uHdW[hs]; vec2 l = uHdL[hs];
        vec3 col = diffuseColor.rgb * d * mix(vec3(1.0), hdWall, w.x) * mix(vec3(1.0), hdRoof, w.y) * mix(0.84, 1.12, m1);
        col = mix(col, col * vec3(0.60, 0.56, 0.49), clamp((1.0 - clean) * 1.15 + (m2 - 0.55) * w.z, 0.0, 1.0) * w.w);   // rain streaks and mud, worst low down
        col = mix(col, col * vec3(0.80, 0.82, 0.70) + 0.02, smoothstep(0.55, 0.8, m3) * l.x);                              // lichen on the tiles
        col = mix(col, col * 0.62, smoothstep(0.72, 0.9, m2) * l.x);
        diffuseColor.rgb = mix(col, vec3(0.013, 0.012, 0.011) + col * 0.05, charW);
        hdN = texture(uHdNorm, vec3(hdUv, float(hs))).xyz * 2.0 - 1.0; hdBump = l.y;
      } else {
        if (hs == 8) diffuseColor.rgb *= vec3(0.014, 0.016, 0.022);       // window glass: dark, glossy, catches the sky
        diffuseColor.rgb *= 1.0 - 0.93 * hdBurn.y;
      }`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = hs == 8 ? 0.12 : mix(clamp(roughness + (m2 - 0.5) * 0.12, 0.0, 1.0), 0.96, charW);`)
      .replace('#include <normal_fragment_maps>', `if (hdBump > 0.0) normal = normalize(hdFrame(normal, -vViewPosition, hdUv) * vec3(hdN.xy * hdBump, hdN.z));`)
      .replace('#include <emissivemap_fragment>', `{ float lit = step(0.42, hdHash(floor(hp.xz * 0.42) + floor(hp.y * 0.36) * 7.31));
        bool win = hs == 8 || (hs == 9 && max(vColor.r, max(vColor.g, vColor.b)) < 0.03);     // glass, or the dark opening behind a shutter
        totalEmissiveRadiance *= (win ? lit : 0.0) * (1.0 - hdBurn.y);
        if (hdBurn.x > 0.001) {      // firelight in every window, and embers glowing in the cracks
          float ember = hdNoise(hp.xz / 1.7 + vec2(hp.y / 1.3, uTime * 0.11));
          totalEmissiveRadiance += vec3(1.0, 0.26, 0.03) * hdBurn.x * (smoothstep(0.5, 0.82, ember + 0.12 * sin(uTime * 11.0 + hp.x * 2.0)) * 3.0 * hdBurn.y + (win ? 6.0 * (0.7 + 0.3 * sin(uTime * 9.0 + hp.x)) : 0.0));
        } }`);
  };
  return patchAtmosphere(m, null, 'househd');
}
// Townsfolk come with their animation baked as one morph target per frame (the loops in props.json: idle, walk, talk). An
// instanced mesh cannot play morph targets per instance cheaply, so the frames go into one float texture, a row per frame and
// a texel per vertex, and a second prop material reads its two nearest frames for each instance from there. Walkers are also
// carried up and down a straight beat by the shader, turning round at each end, with the walk timed by the ground covered.
function animateProps(map) {
  const types = Object.values(PROPKIT.types).filter((T) => T.meta.clips && T.geo.morphAttributes.position);
  if (!types.length) return;
  const W = Math.max(...types.map((T) => T.geo.attributes.position.count)), H = types.reduce((n, T) => n + T.geo.morphAttributes.position.length, 0);
  const data = new Float32Array(W * H * 4), lin = new THREE.Matrix3(); let row = 0;
  for (const T of types) {
    const base = T.geo.attributes.position, rel = T.geo.morphTargetsRelative; T.row = row; lin.setFromMatrix4(T.world);
    for (const f of T.geo.morphAttributes.position) {
      if (rel) f.applyMatrix3(lin); else f.applyMatrix4(T.world);
      for (let i = 0, k = row * W * 4; i < base.count; i++, k += 4) { data[k] = f.getX(i) + (rel ? base.getX(i) : 0); data[k + 1] = f.getY(i) + (rel ? base.getY(i) : 0); data[k + 2] = f.getZ(i) + (rel ? base.getZ(i) : 0); }
      row++;
    }
    T.geo.morphAttributes = {}; T.geo.morphTargetsRelative = false;
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType); tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
  PROPKIT.animMat = patchAtmosphere(new THREE.MeshStandardMaterial({ map, roughness: 0.9, metalness: 0, side: THREE.DoubleSide }), (sh) => {
    sh.uniforms.uAnimTex = { value: tex }; sh.uniforms.uTime = G.uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      uniform highp sampler2D uAnimTex; uniform float uTime;
      attribute vec4 aAnimA;      // first frame's row, frames in the loop, loops a second (unused when walking), phase 0..1
      attribute vec4 aAnimB;      // a walker's beat: metres behind and ahead of where it stands, and how far the ground rises to each end
      attribute vec2 aAnimC;      // ground covered by one walk loop, walking speed (0: stays put)
      attribute vec2 aFlee;       // running from a fire (set by CityFire): the time they set off, 1 while running (0: not)`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
      float anRot = 0.0, anFwd = 0.0, anUp = 0.0, anLoop = uTime * aAnimA.z + aAnimA.w, anP = aAnimB.x + aAnimB.y;
      if (aFlee.y > 0.0) {        // one way only: straight ahead to the end of the run, then they stop
        anFwd = clamp((uTime - aFlee.x) * aAnimC.y, 0.0, aAnimB.y);
        anUp = aAnimB.w * anFwd / max(aAnimB.y, 0.001); anLoop = anFwd / aAnimC.x;
      } else if (aAnimC.y > 0.0) {
        float dist = uTime * aAnimC.y + aAnimA.w * 2.0 * anP, m = mod(dist, 2.0 * anP), w = min(0.7, 0.25 * anP);
        anFwd = m < anP ? m - aAnimB.x : aAnimB.y - (m - anP);
        anRot = m < w ? PI + PI * smoothstep(-w, w, m) : m > 2.0 * anP - w ? PI + PI * smoothstep(2.0 * anP - w, 2.0 * anP + w, m) : PI * smoothstep(anP - w, anP + w, m);
        anUp = anFwd < 0.0 ? aAnimB.z * anFwd / -max(aAnimB.x, 0.001) : aAnimB.w * anFwd / max(aAnimB.y, 0.001);
        anLoop = dist / aAnimC.x;
      }
      float anF = fract(anLoop) * aAnimA.y, anF0 = floor(anF);
      vec3 anPos = mix(texelFetch(uAnimTex, ivec2(gl_VertexID, int(aAnimA.x + anF0)), 0).xyz, texelFetch(uAnimTex, ivec2(gl_VertexID, int(aAnimA.x + mod(anF0 + 1.0, aAnimA.y))), 0).xyz, anF - anF0);
      float anC = cos(anRot), anS = sin(anRot);
      objectNormal = vec3(objectNormal.x * anC + objectNormal.z * anS, objectNormal.y, objectNormal.z * anC - objectNormal.x * anS);`)
      .replace('#include <begin_vertex>', 'vec3 transformed = vec3(anPos.x * anC + anPos.z * anS, anPos.y + anUp, anPos.z * anC - anPos.x * anS + anFwd);');
  }, 'propkit_anim');
}
// Banners stir in the wind and boats ride the swell, all in the vertex shader (each instance gets its own phase from where
// it stands). A banner's cloth is a five-point pennant from the kit, so it is cut into small triangles first to bend.
const SWAY = { banner: 'FLAG', boat: 'BOAT', ship: 'SHIP', galley: 'SHIP' };
function subdivide(geo, keep, levels) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone(), names = Object.keys(g.attributes), src = names.map((n) => g.attributes[n]);
  const out = names.map(() => []), pos = g.attributes.position;
  const vert = (k, i) => src.map((a) => Array.from({ length: a.itemSize }, (_, c) => a.array[i * a.itemSize + c]));
  const mid = (a, b) => a.map((v, j) => v.map((x, c) => (x + b[j][c]) / 2));
  const emit = (a, b, c, l) => {
    if (l === 0) { for (const v of [a, b, c]) v.forEach((vals, j) => out[j].push(...vals)); return; }
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
    emit(a, ab, ca, l - 1); emit(ab, b, bc, l - 1); emit(ca, bc, c, l - 1); emit(ab, bc, ca, l - 1);
  };
  for (let i = 0; i < pos.count; i += 3) {
    const cut = [i, i + 1, i + 2].every((k) => keep(pos.getX(k), pos.getY(k), pos.getZ(k)));
    emit(vert(0, i), vert(0, i + 1), vert(0, i + 2), cut ? levels : 0);
  }
  const res = new THREE.BufferGeometry();
  names.forEach((n, j) => res.setAttribute(n, new THREE.Float32BufferAttribute(out[j], src[j].itemSize)));
  return res;
}
function swayProps(map) {
  const B = PROPKIT.types.banner;
  if (B) B.geo = subdivide(B.geo, (x, y) => y > 3.0 && y < 6.56, 3);
  PROPKIT.sway = {};
  for (const kind of new Set(Object.values(SWAY))) PROPKIT.sway[kind] = patchAtmosphere(new THREE.MeshStandardMaterial({ map, roughness: 0.9, metalness: 0, side: THREE.DoubleSide }), (sh) => {
    sh.uniforms.uTime = G.uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `vec3 transformed = vec3(position);
      vec2 swP = vec2(0.0);
      #ifdef USE_INSTANCING
        swP = instanceMatrix[3].xz;
      #endif
      float swPh = fract(sin(dot(swP, vec2(12.9898, 78.233))) * 43758.5453) * 6.2832, swT = uTime;
      ${kind === 'FLAG' ? `
      float swW = step(3.0, position.y) * smoothstep(6.55, 3.5, position.y);      // the cloth below the crossbar: free end moves most
      transformed.z += swW * (0.28 + 0.32 * sin(swT * 3.3 + position.y * 1.7 + position.x * 2.3 + swPh) + 0.1 * sin(swT * 7.3 + position.y * 3.1 + swPh * 2.0));
      transformed.x += swW * 0.1 * sin(swT * 2.1 + position.y * 1.2 + swPh);` : `
      float swRate = ${kind === 'BOAT' ? '1.35' : '0.7'}, swRoll = ${kind === 'BOAT' ? '0.07' : '0.028'} * sin(swT * swRate + swPh), swPitch = ${kind === 'BOAT' ? '0.035' : '0.01'} * sin(swT * swRate * 0.73 + swPh * 1.7);
      transformed = vec3(transformed.x, transformed.y * cos(swRoll) - transformed.z * sin(swRoll), transformed.y * sin(swRoll) + transformed.z * cos(swRoll));
      transformed = vec3(transformed.x * cos(swPitch) - transformed.y * sin(swPitch), transformed.x * sin(swPitch) + transformed.y * cos(swPitch), transformed.z);
      transformed.y += ${kind === 'BOAT' ? '0.1' : '0.22'} * sin(swT * swRate * 0.8 + swPh * 0.6);`}`);
  }, 'propsway_' + kind);
}
const ROOF_TINTS = [[1.06, 0.98, 0.9], [1.0, 1.0, 1.0], [0.9, 0.86, 0.8], [1.12, 1.04, 0.9], [0.8, 0.76, 0.72], [1.0, 0.9, 0.82], [0.95, 1.0, 0.94]];

export const C = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
export const shade = (c, f) => [c[0] * f, c[1] * f, c[2] * f];
const UVS = 0.22;   // texture repeats per metre

// ---------------------------------------------------------------- textures
function canvasTex(draw, S = 512) {
  const cv = document.createElement('canvas'); cv.width = cv.height = S; const ctx = cv.getContext('2d');
  draw(ctx, S);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return { tex: t, ctx, S };
}
function normalFrom(ctx, S, strength) {
  const src = ctx.getImageData(0, 0, S, S).data; const out = new Uint8Array(S * S * 4);
  const h = (x, y) => src[(((y + S) % S) * S + ((x + S) % S)) * 4] / 255;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let nx = (h(x - 1, y) - h(x + 1, y)) * strength, ny = (h(x, y - 1) - h(x, y + 1)) * strength, nz = 1;
    const l = Math.hypot(nx, ny, nz); const o = (y * S + x) * 4;
    out[o] = (nx / l * 0.5 + 0.5) * 255; out[o + 1] = (ny / l * 0.5 + 0.5) * 255; out[o + 2] = (nz / l * 0.5 + 0.5) * 255; out[o + 3] = 255;
  }
  const t = new THREE.DataTexture(out, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
  return t;
}
let _mats = null;
export function kitMaterials() {
  if (_mats) return _mats;
  // masonry: staggered ashlar blocks
  const stone = canvasTex((ctx, S) => {
    ctx.fillStyle = '#6a6a6a'; ctx.fillRect(0, 0, S, S);
    const rows = 10, rh = S / rows; const rnd = mulberry32(5);
    for (let r = 0; r < rows; r++) {
      let x = (r % 2) * -30 - rnd() * 20;
      while (x < S) {
        const w = 60 + rnd() * 70; const v = 150 + rnd() * 70;
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(x + 2, r * rh + 2, w - 4, rh - 4);
        if (x + w > S) ctx.fillRect(x + 2 - S, r * rh + 2, w - 4, rh - 4);
        x += w;
      }
    }
    const img = ctx.getImageData(0, 0, S, S); const d = img.data;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const n = (tileFbm(x / S, y / S, 16, 4, 3) - 0.5) * 70 + (tileFbm(x / S, y / S, 3, 3, 8) - 0.5) * 50; const o = (y * S + x) * 4; d[o] += n; d[o + 1] += n; d[o + 2] += n; }
    ctx.putImageData(img, 0, 0);
  });
  // roof: overlapping tiles / slates
  const roof = canvasTex((ctx, S) => {
    ctx.fillStyle = '#555'; ctx.fillRect(0, 0, S, S);
    const rows = 16, rh = S / rows, cw = S / 16; const rnd = mulberry32(9);
    for (let r = 0; r < rows; r++) for (let c = -1; c < 17; c++) {
      const v = 140 + rnd() * 90; ctx.fillStyle = `rgb(${v},${v},${v})`;
      const x = c * cw + (r % 2) * cw * 0.5;
      ctx.fillRect(x + 1, r * rh, cw - 2, rh - 3);
      const g = ctx.createLinearGradient(0, r * rh, 0, r * rh + rh); g.addColorStop(0, 'rgba(0,0,0,0.45)'); g.addColorStop(0.4, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(x, r * rh, cw, rh);
    }
  });
  // weathering laid over the masonry in world space, so a long wall is not one repeating pattern: broad patches of lighter and
  // darker stone, rain streaks running down from the battlements, and a darker tide line where walls stand in the sea
  const weather = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      float kvh(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float kvn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(kvh(i), kvh(i + vec3(1,0,0)), f.x), mix(kvh(i + vec3(0,1,0)), kvh(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(kvh(i + vec3(0,0,1)), kvh(i + vec3(1,0,1)), f.x), mix(kvh(i + vec3(0,1,1)), kvh(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
      { vec3 wq = vAtmoWorld;
        float patchy = kvn(wq * 0.035) * 0.6 + kvn(wq * 0.11) * 0.4;
        float streak = kvn(vec3(wq.x * 0.35, wq.y * 0.018, wq.z * 0.35));
        diffuseColor.rgb *= mix(0.66, 1.18, patchy) * mix(0.7, 1.05, smoothstep(0.25, 0.7, streak));
        diffuseColor.rgb *= mix(0.55, 1.0, smoothstep(0.3, 4.5, wq.y)); }`);
  };
  const mk = (map, nrm, rough, key, extra = {}) => patchAtmosphere(new THREE.MeshStandardMaterial({ vertexColors: true, map, normalMap: nrm, roughness: rough, metalness: 0, ...extra }), key === 'r' ? null : weather, 'kit' + key);
  const glow = patchAtmosphere(new THREE.MeshStandardMaterial({ color: 0x1a1612, emissive: 0xffa040, emissiveIntensity: 0, roughness: 0.4 }), null, 'kitglow');
  // the detailed landmarks' extra parts: gilding (domes, finials, statues), window glass that is lit at night, timber
  const gold = patchAtmosphere(new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xffffff, roughness: 0.32, metalness: 0.85 }), null, 'kitgold');
  const glass = patchAtmosphere(new THREE.MeshStandardMaterial({ vertexColors: true, color: 0x0c0e12, roughness: 0.1, metalness: 0.1, emissive: 0xffa040, emissiveIntensity: 0 }), null, 'kitglass');
  _mats = {
    stone: mk(stone.tex, normalFrom(stone.ctx, stone.S, 3.0), 0.92, 's'),
    ashlar: mk(stone.tex, normalFrom(stone.ctx, stone.S, 3.0), 0.9, 'a'),
    roof: mk(roof.tex, normalFrom(roof.ctx, roof.S, 3.5), 0.8, 'r'),
    plain: patchAtmosphere(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }), null, 'kitp'),
    wood: patchAtmosphere(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 }), null, 'kitw'),
    // each great landmark's own stone (scans swapped in by upgradeKitTextures; LANDMARK_STONE says which part uses which)
    redstone: mk(stone.tex, normalFrom(stone.ctx, stone.S, 3.0), 0.9, 'rk'),
    marble: mk(stone.tex, normalFrom(stone.ctx, stone.S, 3.0), 0.55, 'mb'),
    ruin: mk(stone.tex, normalFrom(stone.ctx, stone.S, 3.0), 0.95, 'ru'),
    glow, gold, glass,
    update() { glow.emissiveIntensity = 0.12 + G.uNight.value * 9.0; glass.emissiveIntensity = G.uNight.value * 2.2; if (HOUSEKIT) for (const m of HOUSEKIT.mats) m.emissiveIntensity = G.uNight.value * 3.2; },
  };
  return _mats;
}

// Swap the hand-drawn masonry / roof patterns for scanned ones (Poly Haven, CC0) once they have loaded.
// The scans are normalised to a neutral grey so each building's own stone colour still comes from its vertex colours.
export function upgradeKitTextures() {
  const mats = kitMaterials();
  const apply = (mat, id, tile, bump, contrast = 1) => {
    const img = new Image();
    img.onload = () => {
      const S = 1024; const cv = document.createElement('canvas'); cv.width = cv.height = S; const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, S, S); const im = ctx.getImageData(0, 0, S, S); const d = im.data;
      let r = 0, g = 0, b = 0, n = 0; for (let i = 0; i < d.length; i += 4 * 29) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; } r /= n; g /= n; b /= n;
      for (let i = 0; i < d.length; i += 4) { d[i] = Math.min(255, 188 + (d[i] / r * 188 - 188) * contrast); d[i + 1] = Math.min(255, 188 + (d[i + 1] / g * 188 - 188) * contrast); d[i + 2] = Math.min(255, 188 + (d[i + 2] / b * 188 - 188) * contrast); }
      ctx.putImageData(im, 0, 0);
      const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.repeat.set(tile, tile);
      new THREE.TextureLoader().load(`/textures/${id}/nor.jpg`, (nt) => {
        nt.wrapS = nt.wrapT = THREE.RepeatWrapping; nt.repeat.set(tile, tile); nt.anisotropy = 8;
        mat.map = t; mat.normalMap = nt; mat.normalScale.set(bump, bump); mat.needsUpdate = true;
      });
    };
    img.src = `/textures/${id}/diff.jpg`;
  };
  apply(mats.stone, 'medieval_blocks_02', 0.5, 1.5, 0.62);      // big blocks, soft mortar: reads as masonry from the air, not wallpaper
  apply(mats.ashlar, 'white_sandstone_bricks_03', 1.0, 1.1);
  apply(mats.roof, 'clay_roof_tiles_02', 1.6, 1.2);
  apply(mats.redstone, 'red_sandstone_wall', 0.8, 1.4);      // neutral: the Red Keep's brick red and pale trim are in its vertex colours
  apply(mats.marble, 'marble_01', 0.8, 0.6);
  apply(mats.ruin, 'defense_wall', 1.0, 1.3);
}
// which material each part of a great landmark uses, where it differs from the kit's (as the Unreal prototype has them)
const LANDMARK_STONE = { redkeep: { ashlar: 'redstone' }, sept: { ashlar: 'marble' }, dragonpit: { ashlar: 'ruin' } };

// --------------------------------------------------------------------- kit
export class Kit {
  constructor(field, ox, oz, seed = 1) {
    this.field = field; this.ox = ox; this.oz = oz;
    this.rnd = mulberry32(seed * 9973 + 17);
    this.b = { stone: { p: [], n: [], u: [], c: [] }, roof: { p: [], n: [], u: [], c: [] }, plain: { p: [], n: [], u: [], c: [] }, glow: { p: [], n: [], u: [], c: [] } };
    this.maxR = 0; this.minY = 1e9; this.maxY = -1e9;
    this.hinst = [];       // baked-house instances
    this.pinst = [];       // street-life prop instances
    this.models = [];      // Blender landmark models placed on this site
    this.pave = [];        // ground to pave: { poly, s } or { c: [x, z], r, s } in site-local metres
  }
  g(x, z) { return this.field.heightAt(this.ox + x, this.oz + z); }
  gs(x, z) { return Math.max(this.g(x, z), 0); }
  _tri(bk, a, b, c, ua, ub, uc, col, colB) {
    const B = this.b[bk];
    const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2], e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (const v of [a, b, c]) {
      B.p.push(v[0], v[1], v[2]); B.n.push(nx, ny, nz);
      const r = Math.hypot(v[0], v[2]); if (r > this.maxR) this.maxR = r; if (v[1] < this.minY) this.minY = v[1]; if (v[1] > this.maxY) this.maxY = v[1];
    }
    B.u.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
    const cb = colB || col;
    // colB: darker tint for low vertices (cheap ambient occlusion / grime)
    for (const v of [a, b, c]) { const k = colB ? (v[3] || 0) : 0; B.c.push(col[0] + (cb[0] - col[0]) * k, col[1] + (cb[1] - col[1]) * k, col[2] + (cb[2] - col[2]) * k); }
  }
  _quad(bk, a, b, c, d, w, h, col, colB) {
    // a,b bottom (left,right), c,d top (right,left)
    const u0 = this._uo || 0;
    this._tri(bk, a, b, c, [u0, a[1] * UVS], [u0 + w * UVS, b[1] * UVS], [u0 + w * UVS, c[1] * UVS], col, colB);
    this._tri(bk, a, c, d, [u0, a[1] * UVS], [u0 + w * UVS, c[1] * UVS], [u0, d[1] * UVS], col, colB);
  }
  // axis-aligned box rotated about Y; (x, z) centre, y bottom
  box(x, y, z, sx, sy, sz, rot = 0, bk = 'stone', col = [0.5, 0.5, 0.5], opts = {}) {
    const c = Math.cos(rot), s = Math.sin(rot), hx = sx / 2, hz = sz / 2;
    const P = (lx, ly, lz, k = 0) => [x + lx * c + lz * s, y + ly, z - lx * s + lz * c, k];
    const b0 = P(-hx, 0, -hz, 1), b1 = P(hx, 0, -hz, 1), b2 = P(hx, 0, hz, 1), b3 = P(-hx, 0, hz, 1);
    const t0 = P(-hx, sy, -hz), t1 = P(hx, sy, -hz), t2 = P(hx, sy, hz), t3 = P(-hx, sy, hz);
    const dark = opts.noAO ? null : shade(col, 0.62);
    this._uo = (x + z) * 0.13;
    this._quad(bk, b1, b0, t0, t1, sx, sy, col, dark); this._quad(bk, b3, b2, t2, t3, sx, sy, col, dark);
    this._quad(bk, b2, b1, t1, t2, sz, sy, col, dark); this._quad(bk, b0, b3, t3, t0, sz, sy, col, dark);
    if (!opts.noTop) {
      const tc = opts.topColor || shade(col, 1.08);
      this._tri(bk, t0, t3, t2, [t0[0] * UVS, t0[2] * UVS], [t3[0] * UVS, t3[2] * UVS], [t2[0] * UVS, t2[2] * UVS], tc);
      this._tri(bk, t0, t2, t1, [t0[0] * UVS, t0[2] * UVS], [t2[0] * UVS, t2[2] * UVS], [t1[0] * UVS, t1[2] * UVS], tc);
    }
  }
  // tapered cylinder (frustum); r1 = top radius
  cyl(x, y, z, r0, r1, h, sides = 12, bk = 'stone', col = [0.5, 0.5, 0.5], opts = {}) {
    const dark = opts.noAO ? null : shade(col, 0.6);
    const tx = opts.tiltX || 0, tz = opts.tiltZ || 0;
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const b0 = [x + c0 * r0, y, z + s0 * r0, 1], b1 = [x + c1 * r0, y, z + s1 * r0, 1];
      const t0 = [x + tx + c0 * r1, y + h, z + tz + s0 * r1], t1 = [x + tx + c1 * r1, y + h, z + tz + s1 * r1];
      const w = (2 * Math.PI * r0) / sides; this._uo = i * w * UVS;
      this._quad(bk, b1, b0, t0, t1, w, h, col, dark);
      if (!opts.noTop) { const cc = [x + tx, y + h, z + tz]; this._tri(bk, cc, t1, t0, [0, 0], [0.2, 0], [0.1, 0.2], shade(col, 1.05)); }
    }
  }
  cone(x, y, z, r, h, sides = 12, bk = 'roof', col = [0.3, 0.3, 0.35], over = 1.12) {
    const R = r * over, apex = [x, y + h, z];
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
      const b0 = [x + Math.cos(a0) * R, y, z + Math.sin(a0) * R], b1 = [x + Math.cos(a1) * R, y, z + Math.sin(a1) * R];
      const w = (2 * Math.PI * R) / sides, sl = Math.hypot(R, h);
      this._tri(bk, b1, b0, apex, [w * UVS, 0], [0, 0], [w * 0.5 * UVS, sl * UVS], col);
    }
  }
  dome(x, y, z, r, bk = 'roof', col = [0.6, 0.5, 0.2], squash = 1, sides = 14, rings = 6) {
    for (let j = 0; j < rings; j++) {
      const p0 = (j / rings) * Math.PI / 2, p1 = ((j + 1) / rings) * Math.PI / 2;
      const r0 = Math.cos(p0) * r, r1 = Math.cos(p1) * r, y0 = y + Math.sin(p0) * r * squash, y1 = y + Math.sin(p1) * r * squash;
      for (let i = 0; i < sides; i++) {
        const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
        const b0 = [x + Math.cos(a0) * r0, y0, z + Math.sin(a0) * r0], b1 = [x + Math.cos(a1) * r0, y0, z + Math.sin(a1) * r0];
        const t0 = [x + Math.cos(a0) * r1, y1, z + Math.sin(a0) * r1], t1 = [x + Math.cos(a1) * r1, y1, z + Math.sin(a1) * r1];
        const sh = shade(col, 0.8 + 0.25 * j / rings);
        this._tri(bk, b1, b0, t0, [1, 0], [0, 0], [0, 1], sh); if (j < rings - 1) this._tri(bk, b1, t0, t1, [1, 0], [0, 1], [1, 1], sh);
      }
    }
  }
  // gable roof: ridge runs along local X
  gable(x, y, z, w, d, h, rot = 0, bk = 'roof', col = [0.4, 0.2, 0.15], wallCol = null) {
    const c = Math.cos(rot), s = Math.sin(rot), hx = w / 2 + 0.4, hz = d / 2 + 0.5;
    const P = (lx, ly, lz) => [x + lx * c + lz * s, y + ly, z - lx * s + lz * c];
    const a = P(-hx, 0, -hz), b = P(hx, 0, -hz), cc = P(hx, 0, hz), dd = P(-hx, 0, hz), r0 = P(-hx, h, 0), r1 = P(hx, h, 0);
    const sl = Math.hypot(hz, h);
    this._tri(bk, b, a, r0, [w * UVS, 0], [0, 0], [0, sl * UVS], col); this._tri(bk, b, r0, r1, [w * UVS, 0], [0, sl * UVS], [w * UVS, sl * UVS], col);
    this._tri(bk, dd, cc, r1, [0, 0], [w * UVS, 0], [w * UVS, sl * UVS], shade(col, 0.86)); this._tri(bk, dd, r1, r0, [0, 0], [w * UVS, sl * UVS], [0, sl * UVS], shade(col, 0.86));
    const wc = wallCol || shade(col, 0.7), wb = wallCol ? 'stone' : bk;
    this._tri(wb, a, dd, r0, [0, 0], [d * UVS, 0], [d * 0.5 * UVS, h * UVS], wc); this._tri(wb, cc, b, r1, [0, 0], [d * UVS, 0], [d * 0.5 * UVS, h * UVS], wc);
  }
  pyramid(x, y, z, w, d, h, rot = 0, bk = 'roof', col = [0.3, 0.3, 0.35]) {
    const c = Math.cos(rot), s = Math.sin(rot), hx = w / 2 + 0.4, hz = d / 2 + 0.4;
    const P = (lx, ly, lz) => [x + lx * c + lz * s, y + ly, z - lx * s + lz * c];
    const q = [P(-hx, 0, -hz), P(hx, 0, -hz), P(hx, 0, hz), P(-hx, 0, hz)], ap = P(0, h, 0);
    for (let i = 0; i < 4; i++) this._tri(bk, q[(i + 1) % 4], q[i], ap, [1, 0], [0, 0], [0.5, 1], shade(col, i % 2 ? 0.88 : 1));
  }

  // ------------------------------------------------------------ composites
  merlons(x0, z0, x1, z1, y, thick, col, sz = 1.5) {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.floor(len / (sz * 2.1))); const rot = -Math.atan2(z1 - z0, x1 - x0);
    for (let i = 0; i < n; i++) { const t = (i + 0.5) / n; this.box(x0 + (x1 - x0) * t, y, z0 + (z1 - z0) * t, sz, sz * 1.1, thick, rot, 'stone', col, { noAO: true }); }
  }
  wall(x0, z0, x1, z1, h, thick, col, opts = {}) {
    const len = Math.hypot(x1 - x0, z1 - z0); const n = Math.max(1, Math.ceil(len / (opts.step || 26))); const rot = -Math.atan2(z1 - z0, x1 - x0);
    for (let i = 0; i < n; i++) {
      const ta = i / n, tb = (i + 1) / n;
      const ax = x0 + (x1 - x0) * ta, az = z0 + (z1 - z0) * ta, bx = x0 + (x1 - x0) * tb, bz = z0 + (z1 - z0) * tb;
      const ga = this.gs(ax, az), gb = this.gs(bx, bz), base = Math.min(ga, gb) - 4, top = (opts.level !== undefined ? opts.level : Math.max(ga, gb) + h);
      this.box((ax + bx) / 2, base, (az + bz) / 2, len / n + 0.3, top - base, thick, rot, 'stone', col);
      if (opts.crenel !== false) this.merlons(ax, az, bx, bz, top, thick * 0.35 + 0.6, col, opts.merlon || 1.5);
    }
  }
  tower(x, z, r, h, col, o = {}) {
    const g = o.y !== undefined ? o.y : this.gs(x, z); const base = g - (o.depth ?? 5); const sides = o.sides || 12;
    const taper = o.taper ?? 0.9;
    this.cyl(x, base, z, r, r * taper, h + (g - base), sides, 'stone', col, { noTop: o.roof === 'cone' || o.roof === 'dome' });
    const top = g + h, rt = r * taper;
    if (o.roof === 'cone') { this.cyl(x, top, z, rt * 1.1, rt * 1.1, r * 0.25, sides, 'stone', shade(col, 0.9)); this.cone(x, top + r * 0.25, z, rt * 1.08, o.roofH ?? r * 2.1, sides, 'roof', o.roofColor || [0.2, 0.22, 0.26]); }
    else if (o.roof === 'dome') { this.dome(x, top, z, rt * 1.02, 'roof', o.roofColor || [0.6, 0.5, 0.2], o.squash ?? 1, sides); if (o.finial) this.cone(x, top + rt * (o.squash ?? 1) * 0.95, z, rt * 0.12, rt * 1.2, 6, 'roof', o.roofColor || [0.6, 0.5, 0.2], 1); }
    else if (o.roof === 'spikes') { this.cyl(x, top, z, rt * 1.12, rt * 1.12, r * 0.22, sides, 'stone', shade(col, 0.9)); const n = o.spikes || 10; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; this.cone(x + Math.cos(a) * rt * 1.02, top + r * 0.22, z + Math.sin(a) * rt * 1.02, rt * 0.16, rt * (o.spikeH ?? 0.9), 5, 'stone', shade(col, 0.85), 1); } }
    else if (o.roof !== 'none') {     // flat with battlements
      this.cyl(x, top, z, rt * 1.1, rt * 1.1, 1.2, sides, 'stone', shade(col, 0.92));
      const n = Math.max(6, Math.round(rt * 1.1)); for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; this.box(x + Math.cos(a) * rt * 1.04, top + 1.2, z + Math.sin(a) * rt * 1.04, Math.min(1.8, rt * 0.4), 1.7, 0.9, -a + Math.PI / 2, 'stone', col, { noAO: true }); }
    }
    if (o.windows !== false && h > 14) {
      const lv = Math.max(1, Math.floor(h / 13)); const nw = Math.max(3, Math.round(r / 3));
      for (let l = 0; l < lv; l++) for (let i = 0; i < nw; i++) {
        if (this.rnd() < 0.35) continue;
        const a = (i / nw) * Math.PI * 2 + l * 0.7, yy = g + 7 + l * 13 + this.rnd() * 2, rr = r * (1 - (1 - taper) * ((yy - base) / (h + g - base))) + 0.05;
        this.box(x + Math.cos(a) * rr, yy, z + Math.sin(a) * rr, 0.9, 2.0, 0.4, -a + Math.PI / 2, 'glow', [1, 1, 1], { noAO: true });
      }
    }
    return top;
  }
  keep(x, z, w, d, h, rot, col, o = {}) {
    const g = o.y !== undefined ? o.y : Math.min(this.gs(x - w * 0.3, z), this.gs(x + w * 0.3, z), this.gs(x, z)); const base = g - 5;
    this.box(x, base, z, w, h + 5, d, rot, 'stone', col);
    const top = g + h;
    if (o.roof === 'gable') this.gable(x, top, z, w, d, o.roofH ?? d * 0.45, rot, 'roof', o.roofColor || [0.2, 0.22, 0.26], shade(col, 0.95));
    else if (o.roof === 'pyramid') this.pyramid(x, top, z, w, d, o.roofH ?? Math.min(w, d) * 0.6, rot, 'roof', o.roofColor || [0.2, 0.22, 0.26]);
    else if (o.roof !== 'none') { const c = Math.cos(rot), s = Math.sin(rot); const P = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c]; const q = [P(-w / 2, -d / 2), P(w / 2, -d / 2), P(w / 2, d / 2), P(-w / 2, d / 2)]; for (let i = 0; i < 4; i++) this.merlons(q[i][0], q[i][1], q[(i + 1) % 4][0], q[(i + 1) % 4][1], top, 1.0, col, 1.5); }
    if (o.turrets) { const c = Math.cos(rot), s = Math.sin(rot); for (const [lx, lz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const px = x + lx * w / 2 * c + lz * d / 2 * s, pz = z - lx * w / 2 * s + lz * d / 2 * c; this.tower(px, pz, o.turrets, h + (o.turretH ?? 8), col, { y: g, roof: o.turretRoof || 'cone', roofColor: o.roofColor, windows: false }); } }
    if (o.windows !== false && h > 10) {
      const c = Math.cos(rot), s = Math.sin(rot); const lv = Math.max(1, Math.floor(h / 9));
      for (let l = 0; l < lv; l++) for (const [fx, fz, span] of [[0, 1, w], [0, -1, w], [1, 0, d], [-1, 0, d]]) {
        const n = Math.max(1, Math.floor(span / 9));
        for (let i = 0; i < n; i++) { if (this.rnd() < 0.4) continue; const t = ((i + 0.5) / n - 0.5) * span * 0.85; const lx = fx ? fx * (w / 2 + 0.05) : t, lz = fz ? fz * (d / 2 + 0.05) : t; this.box(x + lx * c + lz * s, g + 5 + l * 9, z - lx * s + lz * c, fx ? 0.4 : 1.0, 2.2, fz ? 0.4 : 1.0, rot, 'glow', [1, 1, 1], { noAO: true }); }
      }
    }
    return top;
  }
  // a Blender-built landmark, standing on the ground at (x, z); false if the model file is missing
  model(name, x, z, rot = 0, yOff = 0, scale = 1) {
    const parts = LANDMODELS[name]; if (!parts) return false;
    const y = this.gs(x, z) + yOff; this.models.push({ name, parts, x, y, z, rot, scale });
    for (const p of parts) { const b = p.geo.boundingBox; const r = Math.hypot(x, z) + Math.max(b.max.x, -b.min.x, b.max.z, -b.min.z) * scale; if (r > this.maxR) this.maxR = r; if (y + b.min.y * scale < this.minY) this.minY = y + b.min.y * scale; if (y + b.max.y * scale > this.maxY) this.maxY = y + b.max.y * scale; }
    return y;
  }
  houseMeta(type) { return HOUSEKIT && HOUSEKIT.types[type] ? HOUSEKIT.types[type].meta : null; }
  hasProp(type) { return !!(PROPKIT && PROPKIT.types[type]); }
  propMeta(type) { return this.hasProp(type) ? PROPKIT.types[type].meta : null; }
  propAnimated(type) { return this.hasProp(type) && PROPKIT.types[type].row !== undefined; }
  // one prop from the street-life kit: front faces local +Z, length runs along local X. o: { scale, shade (brightness),
  // tint [r, g, b] (only props built grey take a colour), water: true floats it at sea level, y: explicit height,
  // anim: for animated townsfolk { clip: 'idle' | 'walk' | 'talk', phase 0..1, rate (speed of the loop, 1 = as made), and for a
  // walker speed (m/s), back / ahead (metres it may walk each way along its facing), riseBack / riseAhead (ground height there) } }
  prop(type, x, z, rot = 0, o = {}) {
    const T = PROPKIT && PROPKIT.types[type]; if (!T) return false;
    let y = o.y;
    if (y === undefined) { const g = this.g(x, z); if (o.water) { if (g > -1) return false; y = 0; } else { if (g < 0.8) return false; y = g - 0.04; } }
    const s = o.scale ?? 1, sh = o.shade ?? 1, t = T.meta.tint && o.tint ? o.tint : [1, 1, 1];
    this.pinst.push({ type, x, y, z, rot, s, tint: [t[0] * sh, t[1] * sh, t[2] * sh], anim: o.anim });
    const rr = Math.hypot(x, z) + Math.max(T.meta.w, T.meta.d) * s; if (rr > this.maxR) this.maxR = rr; if (y < this.minY) this.minY = y; if (y + T.meta.h * s > this.maxY) this.maxY = y + T.meta.h * s;
    return true;
  }
  // one baked building: front faces local +Z, rotated by rot about Y. Sits on the lowest ground under its corners.
  placeHouse(type, x, z, rot, o = {}) {
    const m = this.houseMeta(type); if (!m) return false;
    const sx = o.sx ?? 1, sy = o.sy ?? 1, sz = o.sz ?? 1, c = Math.cos(rot), sn = Math.sin(rot);
    let gy = this.g(x, z), gmax = gy;
    for (const [lx, lz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const hx = lx * m.w * sx * 0.5, hz = lz * m.d * sz * 0.5; const g = this.g(x + hx * c + hz * sn, z - hx * sn + hz * c); gy = Math.min(gy, g); gmax = Math.max(gmax, g); }
    if (gy < 1.0 || gmax - gy > 7) return false;
    let tint;
    if (o.wall) { const w = o.wall, mx = Math.max(w[0], w[1], w[2], 1e-3), br = 0.9 + this.rnd() * 0.2; tint = [(0.5 + 0.5 * w[0] / mx) * br, (0.5 + 0.5 * w[1] / mx) * br, (0.5 + 0.5 * w[2] / mx) * br]; }
    else { const br = (o.district === 'poor' ? 0.74 : 0.86) + this.rnd() * 0.26, warm = (this.rnd() - 0.5) * 0.1; tint = [br * (1 + warm), br, br * (1 - warm * 1.4)]; }
    const rt = ROOF_TINTS[(this.rnd() * ROOF_TINTS.length) | 0], rb = (o.district === 'poor' ? 0.7 : 0.82) + this.rnd() * 0.34;
    this.hinst.push({ type, x, y: gy - 0.08, z, rot, sx, sy, sz, tint, roof: [rt[0] * rb, rt[1] * rb, rt[2] * rb] });
    const rr = Math.hypot(x, z) + Math.max(m.w, m.d); if (rr > this.maxR) this.maxR = rr; if (gy < this.minY) this.minY = gy; if (gy + m.h * sy > this.maxY) this.maxY = gy + m.h * sy;
    return true;
  }
  house(x, z, w, d, h, rot, wall, roof, o = {}) {
    const g = this.g(x, z); if (g < 0.6) return;
    if (HOUSEKIT) {
      const style = o.style || 'city', r = this.rnd();
      const type = o.type || (o.flat ? 'mudbrick' : style === 'village' ? (r < 0.62 ? 'cottage' : r < 0.9 ? 'longhouse' : 'loghall')
        : style === 'north' ? (r < 0.45 ? 'stonehouse' : r < 0.75 ? 'loghall' : 'cottage') : (r < 0.46 ? 'townhouse' : r < 0.84 ? 'merchant' : r < 0.94 ? 'stonehouse' : 'inn'));
      const m = this.houseMeta(type); const sc = Math.min(1.25, Math.max(0.85, o.scale ?? (w / m.w + d / m.d) * 0.5));
      this.placeHouse(type, x, z, rot, { sx: sc, sy: sc, sz: sc, wall });
      return;
    }
    this.box(x, g - 2, z, w, h + 2, d, rot, 'stone', wall, { noTop: !o.flat });
    if (o.flat) { if (this.rnd() < 0.3) this.box(x + (this.rnd() - 0.5) * w * 0.4, g + h, z + (this.rnd() - 0.5) * d * 0.4, w * 0.4, 2.2, d * 0.4, rot, 'stone', shade(wall, 0.95)); }
    else this.gable(x, g + h, z, w, d, d * (0.42 + this.rnd() * 0.2), rot, 'roof', roof, shade(wall, 0.96));
    if (o.light !== false && this.rnd() < 0.55) { const c = Math.cos(rot), s = Math.sin(rot), sd = this.rnd() < 0.5 ? 1 : -1; const lz = sd * (d / 2 + 0.05), lx = (this.rnd() - 0.5) * w * 0.5; this.box(x + lx * c + lz * s, g + h * 0.45, z - lx * s + lz * c, 0.8, 1.1, 0.3, rot, 'glow', [1, 1, 1], { noAO: true }); }
  }
  // closed polygonal curtain wall with towers at the corners
  wallLoop(pts, h, thick, col, o = {}) {
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      if (o.skip && o.skip.includes(i)) continue;
      if (o.gates && o.gates.includes(i)) {
        const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz), gw = Math.min(16, l * 0.3);
        const ux = dx / l, uz = dz / l;
        this.wall(a[0], a[1], mx - ux * gw / 2, mz - uz * gw / 2, h, thick, col, o); this.wall(mx + ux * gw / 2, mz + uz * gw / 2, b[0], b[1], h, thick, col, o);
        const rot = -Math.atan2(dz, dx), g = this.gs(mx, mz);
        this.box(mx, g + h * 0.55, mz, gw + 2, h * 0.75, thick + 3, rot, 'stone', col);                    // gate lintel block
        this.box(mx, g, mz, gw * 0.8, h * 0.55, thick + 0.4, rot, 'plain', [0.09, 0.06, 0.04], { noAO: true }); // doors
        for (const sd of [-1, 1]) this.tower(mx + ux * sd * (gw / 2 + 3), mz + uz * sd * (gw / 2 + 3), (o.tower ? o.tower.r : 5) * 0.9, h * 1.5, col, { roof: o.tower ? o.tower.roof : 'flat', roofColor: o.tower && o.tower.roofColor });
      } else this.wall(a[0], a[1], b[0], b[1], h, thick, col, o);
      if (o.tower && !(o.noTowerAt && o.noTowerAt.includes(i))) this.tower(a[0], a[1], o.tower.r, o.tower.h, col, o.tower);
    }
  }
  ringPts(cx, cz, r, n, jitter = 0, squash = 1, phase = 0) {
    const pts = []; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + phase; const rr = r * (1 + (this.rnd() - 0.5) * 2 * jitter); pts.push([cx + Math.cos(a) * rr, cz + Math.sin(a) * rr * squash]); } return pts;
  }
  inside(pts, x, z) { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
  // fill a polygon with houses on a jittered grid; filter(x,z) → false to leave open
  // fill a walled area with a planned town: irregular blocks, lanes, a market square (see cityplan.js)
  houses(pts, cell, palette, roofs, o = {}) {
    if (!HOUSEKIT) return;
    let cx = 0, cz = 0; for (const p of pts) { cx += p[0]; cz += p[1]; } cx /= pts.length; cz /= pts.length;
    // architecture follows the land: timber and thatch in the North, half-timbered towns in the Riverlands and Vale, stone and terracotta from the Crownlands south
    const lat = mapLat(this.oz);
    const style = o.flat ? 'dorne' : (o.style === 'north' || o.style === 'village' || lat < 0.42) ? 'north' : (o.style === 'kl' || lat > 0.6) ? 'kl' : 'tudor';
    const big = cell * 2.4;
    this.pave.push({ poly: pts, s: o.style === 'village' ? 0.55 : 1 });
    return planCity(this, { poly: pts, style, inset: o.inset ?? 10, keep: o.filter, plazas: o.plazas || (o.noSquare ? [] : [[cx, cz, Math.max(14, cell * 0.9)]]),
      roads: o.roads || [], cell: () => big * (0.9 + this.rnd() * 0.25), district: o.district || ((x, z) => (Math.hypot(x - cx, z - cz) < big * 1.6 ? 'common' : this.rnd() < 0.35 ? 'poor' : 'common')) });
  }
  // a cypress or a round-headed courtyard tree
  yardTree(x, z, sc = 1) {
    const g = this.g(x, z); if (g < 1) return;
    if (this.rnd() < 0.6) { const h = (8 + this.rnd() * 6) * sc, c = [0.05 + this.rnd() * 0.02, 0.1 + this.rnd() * 0.03, 0.045]; this.cyl(x, g - 0.5, z, 0.22, 0.2, 1.6, 5, 'plain', [0.13, 0.09, 0.06], { noAO: true }); this.cone(x, g + 0.9, z, 1.15 * sc, h, 7, 'plain', c, 1); this.cone(x, g + 0.9 + h * 0.35, z, 0.9 * sc, h * 0.72, 7, 'plain', shade(c, 1.15), 1); }
    else { const r = (2.6 + this.rnd() * 1.6) * sc, c = [0.09 + this.rnd() * 0.03, 0.15 + this.rnd() * 0.04, 0.05]; this.cyl(x, g - 0.5, z, 0.3, 0.24, 3.4, 5, 'plain', [0.14, 0.1, 0.07], { noAO: true }); this.dome(x, g + 2.2, z, r, 'plain', c, 0.85, 7, 3); this.dome(x + r * 0.5, g + 2.0, z + r * 0.3, r * 0.7, 'plain', shade(c, 0.85), 0.8, 6, 3); this.dome(x - r * 0.45, g + 2.5, z - r * 0.35, r * 0.66, 'plain', shade(c, 1.12), 0.8, 6, 3); }
  }
  tree(x, z, sc = 1, leaf = [0.1, 0.2, 0.05], trunk = [0.16, 0.11, 0.075]) {
    const g = this.g(x, z); if (g < 0.5) return;
    this.cyl(x, g - 0.5, z, 0.4 * sc, 0.25 * sc, 5 * sc, 5, 'plain', trunk, { noTop: true });
    this.dome(x, g + 4.2 * sc, z, 3.6 * sc, 'plain', leaf, 1.05, 7, 3);
    this.cone(x, g + 4.4 * sc, z, 3.4 * sc, -1.6 * sc, 7, 'plain', shade(leaf, 0.6), 1);
  }
  ship(x, z, rot, sc = 1, sail = [0.85, 0.82, 0.72]) {
    if (this.hasProp('ship')) {      // a modelled hull from the prop kit; every third one a war galley
      const type = this.hasProp('galley') && Math.abs(Math.round(x * 7.3 + z * 3.1)) % 3 === 0 ? 'galley' : 'ship', m = this.propMeta(type);
      if (this.prop(type, x, z, rot, { y: 0, scale: sc * 26 / Math.max(m.w, m.d) * (type === 'galley' ? 1.25 : 1.1), shade: sail[0] + sail[1] + sail[2] < 0.6 ? 0.5 : 1 })) return;
    }
    const y = -0.6; const wood = [0.16, 0.1, 0.06];
    this.box(x, y, z, 26 * sc, 4.4 * sc, 7 * sc, rot, 'plain', wood);
    const c = Math.cos(rot), s = Math.sin(rot);
    this.box(x + 13.5 * sc * c, y + 1, z - 13.5 * sc * s, 6 * sc, 3.6 * sc, 4.4 * sc, rot + 0.0, 'plain', shade(wood, 0.9));
    this.box(x - 11 * sc * c, y + 4.4 * sc, z + 11 * sc * s, 7 * sc, 2.6 * sc, 6.4 * sc, rot, 'plain', shade(wood, 1.15));
    for (const [off, hh] of [[4, 24], [-6, 19]]) {
      const mx = x + off * sc * c, mz = z - off * sc * s;
      this.cyl(mx, y + 4, mz, 0.35 * sc, 0.25 * sc, hh * sc, 5, 'plain', shade(wood, 0.8), { noAO: true });
      this.box(mx, y + (hh * 0.42) * sc, mz, 0.5 * sc, hh * 0.5 * sc, 13 * sc, rot, 'plain', sail, { noAO: true });
    }
  }
  bridge(x0, z0, x1, z1, w, yDeck, col, piers = 4) {
    const len = Math.hypot(x1 - x0, z1 - z0), rot = -Math.atan2(z1 - z0, x1 - x0), mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    this.box(mx, yDeck - 2.2, mz, len, 2.2, w, rot, 'stone', col);
    this.box(mx, yDeck, mz, len, 1.3, 0.8, rot, 'stone', col, { noAO: true });
    const c = Math.cos(rot), s = Math.sin(rot);
    for (const sd of [-1, 1]) this.box(mx + sd * (w / 2 - 0.4) * s, yDeck, mz + sd * (w / 2 - 0.4) * c, len, 1.4, 0.8, rot, 'stone', col, { noAO: true });
    for (let i = 0; i <= piers; i++) { const t = i / piers; const px = x0 + (x1 - x0) * t, pz = z0 + (z1 - z0) * t; const g = Math.min(this.g(px, pz), 0) - 6; this.box(px, g, pz, Math.min(6, len / piers * 0.3), yDeck - 2.2 - g, w * 0.9, rot, 'stone', shade(col, 0.9)); }
  }

  build(name) {
    const mats = kitMaterials(); const group = new THREE.Group(); group.name = name || 'landmark';
    group.position.set(this.ox, 0, this.oz);
    const sphere = new THREE.Sphere(new THREE.Vector3(0, (this.minY + this.maxY) / 2, 0), Math.hypot(this.maxR, (this.maxY - this.minY) / 2) + 5);
    for (const k of Object.keys(this.b)) {
      const B = this.b[k]; if (!B.p.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(B.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(B.u, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(B.c, 3));
      g.boundingSphere = sphere.clone();
      const m = new THREE.Mesh(g, mats[k]); m.castShadow = k !== 'glow'; m.receiveShadow = k !== 'glow'; m.matrixAutoUpdate = true;
      group.add(m);
    }
    if (HOUSEKIT && this.hinst.length) {
      const CH = 340, by = {};
      for (const h of this.hinst) { const key = h.type + '|' + Math.floor(h.x / CH) + '|' + Math.floor(h.z / CH); (by[key] = by[key] || []).push(h); }
      const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
      for (const key of Object.keys(by)) {
        const list = by[key], T = HOUSEKIT.types[list[0].type]; const geo = T.geo.clone(); const roof = new Float32Array(list.length * 3);
        const im = new THREE.InstancedMesh(geo, T.mat, list.length);
        list.forEach((h, i) => {
          q.setFromAxisAngle(up, h.rot); mtx.compose(pos.set(h.x, h.y, h.z), q, scl.set(h.sx, h.sy, h.sz)); im.setMatrixAt(i, mtx);
          im.setColorAt(i, col.setRGB(h.tint[0], h.tint[1], h.tint[2])); roof.set(h.roof, i * 3);
        });
        geo.setAttribute('aRoof', new THREE.InstancedBufferAttribute(roof, 3));
        geo.setAttribute('aBurn', new THREE.InstancedBufferAttribute(new Float32Array(list.length * 2), 2));
        im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere();
        im.userData.houseList = list; im.userData.houseMeta = T.meta;      // for CityFire
        group.add(im);
        geo.setAttribute('aLod', new THREE.InstancedBufferAttribute(new Float32Array(list.length), 1));    // 1: HouseDetail draws this one instead
      }
    }
    if (PROPKIT && this.pinst.length) {       // one instanced mesh per kind of prop; each is hidden beyond the distance it stops being visible at
      const by = {}; for (const p of this.pinst) (by[p.type] = by[p.type] || []).push(p);
      const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
      group.userData.props = Object.keys(by).map((type) => {
        const list = by[type], T = PROPKIT.types[type], moving = T.row !== undefined; let geo = T.geo;
        if (moving) {       // its own geometry (sharing the kit's buffers) to carry what each instance is doing
          geo = new THREE.BufferGeometry(); geo.index = T.geo.index; for (const a in T.geo.attributes) geo.setAttribute(a, T.geo.attributes[a]);
          const A = new Float32Array(list.length * 4), B = new Float32Array(list.length * 4), Cc = new Float32Array(list.length * 2), clips = T.meta.clips;
          list.forEach((p, i) => {
            const an = p.anim || {}, walk = an.clip === 'walk' && clips.walk && an.speed > 0 && (an.back || 0) + (an.ahead || 0) > 1, c = clips[walk ? 'walk' : an.clip === 'walk' ? 'idle' : an.clip] || clips.idle || Object.values(clips)[0];
            const h = Math.sin(p.x * 12.9898 + p.z * 78.233) * 43758.5453, ph = an.phase ?? h - Math.floor(h);
            A.set([T.row + c[0], c[1], (an.rate ?? 1) / (c[2] || 1), ph], i * 4);
            if (walk) { B.set([(an.back || 0) / p.s, (an.ahead || 0) / p.s, (an.riseBack || 0) / p.s, (an.riseAhead || 0) / p.s], i * 4); Cc.set([T.meta.stride || 1.4, an.speed / p.s], i * 2); }
          });
          geo.setAttribute('aAnimA', new THREE.InstancedBufferAttribute(A, 4)); geo.setAttribute('aAnimB', new THREE.InstancedBufferAttribute(B, 4)); geo.setAttribute('aAnimC', new THREE.InstancedBufferAttribute(Cc, 2));
          geo.setAttribute('aFlee', new THREE.InstancedBufferAttribute(new Float32Array(list.length * 2), 2));
        }
        const im = new THREE.InstancedMesh(geo, moving ? PROPKIT.animMat : (SWAY[type] && PROPKIT.sway && PROPKIT.sway[SWAY[type]]) || PROPKIT.mat, list.length);
        list.forEach((p, i) => { q.setFromAxisAngle(up, p.rot); mtx.compose(pos.set(p.x, p.y, p.z), q, scl.setScalar(p.s)); im.setMatrixAt(i, mtx); im.setColorAt(i, col.setRGB(p.tint[0], p.tint[1], p.tint[2])); });
        im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true;
        im.castShadow = T.meta.h > 2.5; im.receiveShadow = true; im.computeBoundingSphere(); im.name = 'props_' + type;
        if (moving) { im.boundingSphere.radius += 40; im.userData.anim = { list, row: T.row, clips: T.meta.clips, stride: T.meta.stride || 1.4 }; }      // walkers stray from where they were put
        im.userData.cull = Math.min(14000, Math.max(1500, Math.max(T.meta.w, T.meta.d, T.meta.h) * 420));
        group.add(im); return im;
      });
    }
    for (const md of this.models) for (const p of md.parts) {
      const m = new THREE.Mesh(p.geo, mats[(LANDMARK_STONE[md.name] || {})[p.mat] || p.mat] || mats.stone); m.position.set(md.x, md.y, md.z); m.rotation.y = md.rot; m.scale.setScalar(md.scale); m.castShadow = p.mat !== 'glow'; m.receiveShadow = p.mat !== 'glow'; group.add(m);
    }
    group.userData.radius = sphere.radius; group.userData.houses = this.hinst.length; group.userData.pave = this.pave;
    return group;
  }
}
