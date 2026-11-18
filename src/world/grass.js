// Real grass: clumps of tapered, curved blades standing on the terrain around the camera, in three rings (dense near, sparser
// and coarser further out). Everything is placed on the GPU from the instance number: each clump sits on a jittered grid cell
// that scrolls with the camera, reads the terrain's own height, slope, biome, paving and scorch maps to decide whether grass
// grows there and how tall, and takes its colour from the same formula the ground uses, so the blades rise out of the
// textured ground instead of sitting on it. They sway in the wind and are flattened by the dragon's downdraft.
import * as THREE from 'three';
import { MAP, toMap } from './mapdata.js';
import { DETAIL } from './heightmap.js';
import { G, GLSL_ATMOS, GLSL_ATMOS_UNIFORMS, GLSL_WEATHER } from '../core/glsl.js';
const MAP_CY = toMap(0, 0)[1];

// rings: cell size (m), grid count per side, blades per clump, blade segments, blade width (m), height multiplier
const RINGS = [
  { cell: 0.5, n: 80, blades: 18, segs: 3, width: 0.045, tall: 1.0 },
  { cell: 1.0, n: 90, blades: 12, segs: 2, width: 0.11, tall: 1.05 },
  { cell: 2.0, n: 100, blades: 10, segs: 1, width: 0.26, tall: 1.1 },
];

const VERT = /* glsl */`
#include <common>
#include <shadowmap_pars_vertex>
attribute vec3 aB;                 // blade index, height along the blade 0..1, side -1 / +1
uniform sampler2D uHeightTex, uNormalTex, uBiomeTex, uDetailTex, uPaveMap;
uniform sampler2DArray uGroundAlb;
uniform vec3 uTexMean[8];
uniform vec2 uMapSize, uOrigin;
uniform float uCell, uN, uInner, uOuter, uWidth, uTall, uTime;
uniform vec4 uScorch[24];
uniform vec4 uWake;
varying vec3 vWorld; varying vec3 vCol; varying vec3 vNrm; varying float vT;
const float DT1 = ${DETAIL.T1.toFixed(1)}, DA1 = ${DETAIL.A1.toFixed(1)}, DT2 = ${DETAIL.T2.toFixed(1)}, DA2 = ${DETAIL.A2.toFixed(1)}, DO2 = ${DETAIL.O2};
vec3 S(float r, float g, float b){ return pow(vec3(r, g, b) / 255.0, vec3(2.2)); }
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
float groundY(vec2 wp, out vec4 H){
  vec2 uv = wp / uMapSize + 0.5;
  H = textureLod(uHeightTex, uv, 0.0);
  float r1 = textureLod(uDetailTex, wp / DT1, 0.0).r * 2.0 - 1.0;
  float disp = DA1 * (0.35 * r1 + 0.65 * (1.0 - 2.0 * abs(r1))) + (textureLod(uDetailTex, wp / DT2 + DO2, 0.0).r - 0.5) * 2.0 * DA2;
  return H.r + disp * H.a;
}
void main(){
  float id = float(gl_InstanceID);
  vec2 cell = uOrigin + (vec2(mod(id, uN), floor(id / uN)) - uN * 0.5 + 0.5) * uCell;
  vec2 base = cell + (vec2(h12(cell * 0.731 + 1.1), h12(cell * 1.313 + 7.7)) - 0.5) * uCell;
  float dc = distance(base, cameraPosition.xz);
  // this ring only: fade in past the inner ring's edge, out toward its own
  float ring = (uInner > 0.0 ? smoothstep(uInner - uCell * 3.0, uInner, dc) : 1.0) * (1.0 - smoothstep(uOuter * 0.72, uOuter, dc));
  // ---- does grass grow here (the ground shader's own masks), and how tall
  vec4 H; float hd = groundY(base, H);
  vec2 uv = base / uMapSize + 0.5;
  vec4 Nt = textureLod(uNormalTex, uv, 0.0), Bi = textureLod(uBiomeTex, uv, 0.0);
  vec2 n2 = Nt.rg * 2.0 - 1.0; float steep = 1.0 - sqrt(max(1.0 - dot(n2, n2), 0.02));
  vec4 nA = textureLod(uDetailTex, base / 5200.0, 0.0), nB = textureLod(uDetailTex, base / DT1, 0.0), nC = textureLod(uDetailTex, base / DT2 + DO2, 0.0);
  vec4 nD = textureLod(uDetailTex, base / 47.0 + 0.61, 0.0), nE = textureLod(uDetailTex, base / 11.0 + 0.23, 0.0);
  float lat = (base.y / 400.0 + ${MAP_CY.toFixed(2)}) / 200.0;
  float macro = nA.r, macro2 = nA.a;
  float desert = Bi.r, swamp = Bi.g, farm = Bi.b, forest = H.b;
  float cold = 1.0 - smoothstep(0.2, 0.46, lat + (macro - 0.5) * 0.05), south = smoothstep(0.55, 0.8, lat), latS = smoothstep(0.12, 0.60, lat + (macro - 0.5) * 0.03);
  float snowLine = mix(-500.0, 1500.0, latS);
  float snow = smoothstep(snowLine - 80.0, snowLine + 260.0, hd + (nB.a - 0.5) * 240.0 + (macro2 - 0.5) * 160.0);
  float pave = textureLod(uPaveMap, uv, 0.0).r;
  float dirt = smoothstep(0.6, 0.82, nC.a);
  float treeLine = mix(520.0, 1250.0, latS);
  float treeP = smoothstep(0.30, 0.45, forest + (macro - 0.5) * 0.7) * (1.0 - smoothstep(treeLine - 120.0, treeLine, hd));
  float dens = smoothstep(2.6, 4.6, hd) * (1.0 - smoothstep(0.38, 0.5, H.g)) * (1.0 - smoothstep(0.12, 0.19, steep + (nD.r - 0.5) * 0.06));
  dens *= (1.0 - desert) * (1.0 - snow) * (1.0 - smoothstep(0.1, 0.45, pave + (nD.a - 0.5) * 0.3)) * (1.0 - 0.8 * dirt) * (1.0 - 0.55 * treeP);
  dens *= 1.0 - 0.75 * smoothstep(0.25, 0.5, farm + (macro2 - 0.5) * 0.3) * (1.0 - smoothstep(0.012, 0.04, steep));      // fields are short stubble
  for (int i = 0; i < 24; i++) { vec4 sc = uScorch[i]; if (sc.z > 0.0 && distance(base, sc.xy) < sc.z * 0.8) dens = 0.0; }      // burnt off
  // tussocks: tall clumps in drifts, short turf between them
  float tuss = smoothstep(0.38, 0.72, nD.a * 0.55 + nE.a * 0.45);
  float tall = mix(0.3, 0.9, tuss) * mix(1.0, 0.6, cold) * mix(1.0, 1.3, swamp);
  // ---- the blade
  float b = aB.x, t = aB.y;
  float hb1 = h12(base + b * 3.17), hb2 = h12(base * 1.7 + b * 5.31), hb3 = h12(base * 2.3 + b * 1.91);
  float ang = hb1 * 6.2832; vec2 p = base + vec2(cos(ang), sin(ang)) * sqrt(hb2) * uCell * 0.78;
  float hgt = tall * (0.45 + 0.75 * hb3) * uTall * ring * smoothstep(0.15, 0.45, dens);
  if (hgt < 0.03) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec4 Hp; float y = max(groundY(p, Hp), 0.0) - 0.04;
  float face = h12(p * 4.37) * 6.2832; vec2 fdir = vec2(cos(face), sin(face)), side = vec2(-fdir.y, fdir.x);
  // bend: each blade arcs over its own way, the wind leans the whole sward and runs gusts through it, the downdraft flattens it
  vec2 lean = fdir * (0.25 + 0.45 * hb2);
  vec2 wind = normalize(vec2(0.8, 0.45));
  float gust = sin(uTime * 1.6 + dot(p, wind) * 0.18) * 0.5 + 0.5;
  gust = gust * (0.6 + 0.4 * sin(uTime * 0.37 + dot(p, vec2(0.031, -0.027))));
  lean += wind * (0.12 + 0.55 * gust) + vec2(sin(uTime * 3.1 + hb1 * 20.0), cos(uTime * 2.7 + hb2 * 20.0)) * 0.05;
  if (uWake.w > 0.001) { vec2 dw = p - uWake.xy; float wd = length(dw); lean += dw / max(wd, 0.1) * uWake.w * 1.6 * (1.0 - smoothstep(uWake.z * 0.2, uWake.z * 0.9, wd)); }
  float ll = length(lean); if (ll > 1.3) lean *= 1.3 / ll;
  float bend = t * t;
  vec3 pos = vec3(p.x, y, p.y) + vec3(lean.x * bend * hgt, hgt * t * (1.0 - 0.32 * bend * min(ll, 1.3)), lean.y * bend * hgt);
  float wid = uWidth * (0.7 + 0.6 * hb3) * (1.0 - t * 0.92);
  pos.xz += side * aB.z * wid * 0.5;
  // ---- colour: the ground's grass at this spot (as terrain.js), shaded darker at the root and lighter, drier at the tip
  vec3 grass = mix(S(66., 86., 42.), S(78., 100., 44.), south);
  grass = mix(grass, S(112., 104., 64.), cold * 0.85);
  grass *= 0.62 + 0.62 * macro;
  grass = mix(grass, grass * vec3(1.3, 1.1, 0.66), smoothstep(0.45, 0.8, nB.a) * 0.6);
  grass = mix(grass, S(58., 84., 40.), smoothstep(0.55, 0.85, nC.a) * 0.5);
  grass = mix(grass, S(150., 138., 84.), smoothstep(0.56, 0.78, macro2) * 0.32 * (1.0 - cold * 0.5));
  grass *= 0.86 + 0.28 * nD.a;
  vec3 aF = textureLod(uGroundAlb, vec3(base / 173.0, 5.0), 2.0).rgb, aN = textureLod(uGroundAlb, vec3(base / 6.5 + 0.37, 0.0), 3.0).rgb;
  grass *= mix(vec3(1.0), clamp(aF / uTexMean[5], 0.0, 3.0) * clamp(aN / uTexMean[0], 0.0, 3.0), 0.9);      // both scan layers, as the ground
  float var = h12(p * 7.13);
  vec3 tip = mix(grass * vec3(1.12, 1.15, 0.9), S(160., 148., 92.), (0.04 + 0.16 * var) * (1.0 - cold * 0.6));
  vCol = mix(grass * (0.62 + 0.2 * var), tip, smoothstep(0.0, 1.0, t)) * (0.88 + 0.24 * var);
  vec3 up = vec3(0.0, 1.0, 0.0), fn = vec3(fdir.x, 0.0, fdir.y);
  vNrm = normalize(mix(fn, up, 0.55 + 0.25 * t));
  vT = t;
  vWorld = pos;
  vec4 worldPosition = vec4(pos, 1.0);
  vec3 transformedNormal = mat3(viewMatrix) * vNrm;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
  #include <shadowmap_vertex>
}
`;

const FRAG = /* glsl */`
#include <common>
#include <packing>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
uniform sampler2D uShadowBake;
uniform vec2 uMapSize;
uniform vec3 uSunDir, uSunColor, uAmbSky, uAmbGround;
${GLSL_ATMOS_UNIFORMS}
${GLSL_ATMOS}
${GLSL_WEATHER}
varying vec3 vWorld; varying vec3 vCol; varying vec3 vNrm; varying float vT;
void main(){
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N = normalize(vNrm); if (dot(N, V) < 0.0) N.xz = -N.xz;       // the blade's other face
  float shadow = texture(uShadowBake, vWorld.xz / uMapSize + 0.5).r * cloudShadow(vWorld, uSunDir) * getShadowMask();
  float ndl = max(dot(N, uSunDir), 0.0) * 0.8 + 0.2 * max(uSunDir.y, 0.0);
  float through = pow(max(dot(-V, uSunDir), 0.0), 3.0) * 0.6 * vT;                // sun shining through the blade tips
  float ao = 0.6 + 0.4 * vT;                                                       // the sward shades its own roots
  vec3 col = vCol * (uSunColor * (ndl + through) * shadow + mix(uAmbGround, uAmbSky, 0.6) * ao);
  col = applyAtmosphere(col, vWorld, cameraPosition);
  gl_FragColor = vec4(col, 1.0);
}
`;

function bladeGeometry(BLADES, segs) {
  // BLADES blades of `segs` segments: two vertices per row, a triangle strip per blade as indexed quads
  const rows = segs + 1, aB = [], idx = [];
  for (let b = 0; b < BLADES; b++) {
    const o = b * rows * 2;
    for (let r = 0; r < rows; r++) { const t = r / segs; aB.push(b, t, -1, b, t, 1); }
    for (let r = 0; r < segs; r++) { const a = o + r * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(aB.length), 3));
  g.setAttribute('aB', new THREE.Float32BufferAttribute(aB, 3));
  g.setIndex(idx);
  return g;
}

export class Grass {
  constructor(scene, terrain) {
    this.group = new THREE.Group(); this.group.name = 'grass'; scene.add(this.group);
    const T = terrain.levels[0].material.uniforms;
    const shared = {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.lights),
      uHeightTex: T.uHeightTex, uNormalTex: T.uNormalTex, uBiomeTex: T.uBiomeTex, uDetailTex: T.uDetailTex, uShadowBake: T.uShadowBake,
      uPaveMap: T.uPaveMap, uGroundAlb: T.uGroundAlb, uTexMean: T.uTexMean, uScorch: T.uScorch, uMapSize: T.uMapSize,
      uTime: G.uTime, uSunDir: G.uSunDir, uSunColor: G.uSunColor, uAmbSky: G.uAmbSky, uAmbGround: G.uAmbGround,
      uSkyLUT: G.uSkyLUT, uTrueSunDir: G.uTrueSunDir, uFogParams: G.uFogParams, uWeather: G.uWeather, uCloudParams: G.uCloudParams, uWind: G.uWind, uWake: G.uWake,
    };
    this.terrain = terrain;
    this.rings = RINGS.map((R, i) => {
      const outer = R.cell * R.n * 0.5, inner = i ? RINGS[i - 1].cell * RINGS[i - 1].n * 0.5 * 0.92 : -1;
      const geo = bladeGeometry(R.blades, R.segs); geo.instanceCount = R.n * R.n;
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG, lights: true, side: THREE.DoubleSide,
        uniforms: { ...shared, uOrigin: { value: new THREE.Vector2() }, uCell: { value: R.cell }, uN: { value: R.n }, uInner: { value: inner }, uOuter: { value: outer }, uWidth: { value: R.width }, uTall: { value: R.tall } },
      });
      const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.receiveShadow = true; m.castShadow = false;
      m.userData.ring = R; this.group.add(m); return m;
    });
    // the uScorch uniform array is the terrain's own (same Vector4s), so new scorch marks burn the grass off too
  }
  // agl: the camera's height above the ground; nothing is drawn once the blades would be under a pixel
  update(cam, agl) {
    const show = agl < 160; this.group.visible = show;
    if (!show) return;
    for (const m of this.rings) { const c = m.userData.ring.cell; m.material.uniforms.uOrigin.value.set(Math.round(cam.x / c) * c, Math.round(cam.z / c) * c); }
  }
}
