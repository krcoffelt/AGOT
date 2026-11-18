// Instanced forests: chunked placement on the CPU, three distance tiers on the GPU.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MAP, mapLat } from './mapdata.js';
import { G, GLSL_ATMOS, GLSL_ATMOS_UNIFORMS, GLSL_WEATHER } from '../core/glsl.js';
import { hash2, sampleDetailR } from '../core/noise.js';

const CS = 400, GRID = 42, SP = CS / GRID;
export const NEAR_IN = 40, NEAR_OUT = 64;
// Alpha cutoff preserves the projected area of minified sprigs. The scalar
// gains balance mesh brightness through the handover. Foliage tints were fitted
// on final-frame leaf pixels against the Blender near-model close-ups.
const NEAR_MODEL = {
  c: { name: 'conifer_a', cutoff: 0.19, leafGain: 1.12, puff: 0.45, foliageTint: [0.82, 0.78, 1.86] },
  b: { name: 'broadleaf_a', cutoff: 0.32, leafGain: 1.14, puff: 0.6, foliageTint: [0.54, 0.59, 1.58] },
  b2: { name: 'broadleaf_b', cutoff: 0.32, leafGain: 1.19, puff: 0.6, foliageTint: [0.67, 0.71, 1.39] },
};
const R_HI = 520, R_MID = 2000, R_FAR = 4300;
// the canopy map: how high the forest stands, on a grid that wraps (it spans more than the forest drawn at once). Each tree
// looks across it toward the sun to find how far up its neighbours shade it.
const CAN_N = 1024, CAN_CELL = 10, TREE_SIZE = { c: 17, b: 16, b2: 18 };
export const CANOPY_SPAN = CAN_N * CAN_CELL;      // metres the canopy map covers before it wraps
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- geometry
function pushTri(P, N, C, a, b, c, na, nb, nc, ca, cb, cc) {
  P.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  N.push(na.x, na.y, na.z, nb.x, nb.y, nb.z, nc.x, nc.y, nc.z);
  C.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2], cc[0], cc[1], cc[2]);
}
function cone(P, N, C, y0, y1, r0, sides, colLow, colTip, twist = 0, droop = 0) {
  const tip = new THREE.Vector3(0, y1, 0);
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2 + twist, a1 = ((i + 1) / sides) * Math.PI * 2 + twist;
    const p0 = new THREE.Vector3(Math.cos(a0) * r0, y0 - droop, Math.sin(a0) * r0), p1 = new THREE.Vector3(Math.cos(a1) * r0, y0 - droop, Math.sin(a1) * r0);
    const slope = r0 / (y1 - y0);
    const n0 = new THREE.Vector3(Math.cos(a0), slope, Math.sin(a0)).normalize(), n1 = new THREE.Vector3(Math.cos(a1), slope, Math.sin(a1)).normalize();
    const nt = new THREE.Vector3().addVectors(n0, n1).normalize();
    pushTri(P, N, C, p0, tip, p1, n0, nt, n1, colLow, colTip, colLow);
  }
}
function cylinder(P, N, C, y0, y1, r0, r1, sides, col) {
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    const b0 = new THREE.Vector3(c0 * r0, y0, s0 * r0), b1 = new THREE.Vector3(c1 * r0, y0, s1 * r0);
    const t0 = new THREE.Vector3(c0 * r1, y1, s0 * r1), t1 = new THREE.Vector3(c1 * r1, y1, s1 * r1);
    const n0 = new THREE.Vector3(c0, 0, s0), n1 = new THREE.Vector3(c1, 0, s1);
    pushTri(P, N, C, b0, t0, b1, n0, n0, n1, col, col, col);
    pushTri(P, N, C, b1, t0, t1, n1, n0, n1, col, col, col);
  }
}
function blob(P, N, C, center, r, detail, crownC, seed, colDark, colLight, squash = 0.8) {
  const g = new THREE.IcosahedronGeometry(1, detail); const pos = g.attributes.position;
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], n = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], c = [null, null, null];
  for (let i = 0; i < pos.count; i += 3) {
    for (let k = 0; k < 3; k++) {
      v[k].fromBufferAttribute(pos, i + k);
      const d = 0.82 + 0.36 * hash2(Math.round(v[k].x * 7.3 + 20), Math.round(v[k].y * 7.3 + v[k].z * 13.1 + 40), seed);
      v[k].multiplyScalar(r * d); v[k].y *= squash; v[k].add(center);
      n[k].subVectors(v[k], crownC).normalize();
      const t = Math.min(1, Math.max(0, (v[k].y - (crownC.y - r * 1.2)) / (r * 2.6)));
      c[k] = [colDark[0] + (colLight[0] - colDark[0]) * t, colDark[1] + (colLight[1] - colDark[1]) * t, colDark[2] + (colLight[2] - colDark[2]) * t];
    }
    pushTri(P, N, C, v[0], v[1], v[2], n[0], n[1], n[2], c[0], c[1], c[2]);
  }
}
function finish(P, N, C) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  return g;
}
const TRUNK = [0.16, 0.11, 0.075];
function coniferHi() {
  const P = [], N = [], C = []; const d = [0.028, 0.055, 0.034], l = [0.06, 0.115, 0.055];
  cylinder(P, N, C, -0.5, 5, 0.36, 0.2, 5, TRUNK);
  // seven drooping whorls of branches, each twisted against the last
  for (let i = 0; i < 7; i++) {
    const y0 = 1.5 + i * 2.0, r = 3.4 * (1 - i / 7.7) * (i % 2 ? 0.92 : 1.0);
    cone(P, N, C, y0, y0 + 4.4 - i * 0.2, r, 8, d, l, i * 0.62, 0.55);
  }
  return finish(P, N, C);
}
function bushGeo() {
  const P = [], N = [], C = []; const d = [0.03, 0.058, 0.02], l = [0.09, 0.15, 0.045];
  const cc = new THREE.Vector3(0, 0.3, 0);
  blob(P, N, C, new THREE.Vector3(0, 0.8, 0), 1.25, 0, cc, 11, d, l, 0.72);
  blob(P, N, C, new THREE.Vector3(0.95, 0.6, 0.3), 0.9, 0, cc, 12, d, l, 0.7);
  blob(P, N, C, new THREE.Vector3(-0.7, 0.55, -0.6), 0.95, 0, cc, 13, d, l, 0.7);
  return finish(P, N, C);
}
function rockGeo() {
  const P = [], N = [], C = [];
  const g = new THREE.IcosahedronGeometry(1, 1); const pos = g.attributes.position;
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (let i = 0; i < pos.count; i += 3) {
    for (let k = 0; k < 3; k++) {
      v[k].fromBufferAttribute(pos, i + k);
      const dsp = 0.62 + 0.7 * hash2(Math.round(v[k].x * 9.1 + 30), Math.round(v[k].y * 9.1 + v[k].z * 17.3 + 50), 77);
      v[k].multiplyScalar(dsp); v[k].y = v[k].y * 0.66 + 0.25;
    }
    const n = new THREE.Vector3().subVectors(v[1], v[0]).cross(new THREE.Vector3().subVectors(v[2], v[0])).normalize();
    const sh = 0.085 + 0.06 * hash2(i, 3, 5);
    const c = [sh * 1.04, sh, sh * 0.93];
    pushTri(P, N, C, v[0], v[1], v[2], n, n, n, c, c, c);
  }
  return finish(P, N, C);
}
function coniferLo() {
  const P = [], N = [], C = [];
  cone(P, N, C, 1.6, 16.0, 2.9, 5, [0.03, 0.058, 0.036], [0.058, 0.11, 0.053]);
  return finish(P, N, C);
}
function broadHi() {
  const P = [], N = [], C = []; const d = [0.026, 0.055, 0.016], l = [0.075, 0.14, 0.036];
  cylinder(P, N, C, -0.5, 4.2, 0.62, 0.36, 6, TRUNK);
  cylinder(P, N, C, 3.6, 6.6, 0.3, 0.12, 4, TRUNK);
  const cc = new THREE.Vector3(0, 6.4, 0);
  blob(P, N, C, new THREE.Vector3(0, 8.0, 0), 3.5, 1, cc, 1, d, l, 0.82);
  blob(P, N, C, new THREE.Vector3(2.9, 6.3, 0.8), 2.9, 1, cc, 2, d, l, 0.8);
  blob(P, N, C, new THREE.Vector3(-2.6, 6.5, -1.5), 3.0, 1, cc, 3, d, l, 0.8);
  blob(P, N, C, new THREE.Vector3(-0.8, 6.0, 2.9), 2.8, 1, cc, 4, d, l, 0.8);
  blob(P, N, C, new THREE.Vector3(1.2, 6.2, -2.9), 2.7, 1, cc, 5, d, l, 0.8);
  blob(P, N, C, new THREE.Vector3(-3.0, 5.2, 1.6), 2.0, 0, cc, 6, d, l, 0.8);
  blob(P, N, C, new THREE.Vector3(3.0, 5.0, -1.8), 2.1, 0, cc, 7, d, l, 0.8);
  return finish(P, N, C);
}
function broadLo() {
  const P = [], N = [], C = []; const d = [0.028, 0.058, 0.017], l = [0.072, 0.135, 0.036];
  cylinder(P, N, C, 0, 4.0, 0.6, 0.4, 3, TRUNK);
  const cc = new THREE.Vector3(0, 5.8, 0);
  blob(P, N, C, new THREE.Vector3(0.6, 7.0, 0), 4.3, 0, cc, 7, d, l, 0.74);
  blob(P, N, C, new THREE.Vector3(-1.8, 5.6, 1.0), 3.3, 0, cc, 8, d, l, 0.74);
  return finish(P, N, C);
}

// ------------------------------------------------------------------ shader
const VERT = /* glsl */`
attribute vec4 aOffset;   // xyz position, w scale
attribute vec4 aParams;   // rotation, hue variation, snow, autumn
attribute vec3 color;
uniform float uTime, uScaleBoost, uFar;
uniform sampler2D uShadowBake; uniform vec2 uMapSize;
varying vec3 vCol; varying vec3 vNrm; varying vec3 vWorld; varying float vBake; varying float vH; varying vec4 vPar;
void main(){
  float c = cos(aParams.x), s = sin(aParams.x);
  vec3 p = position; p.xz = mat2(c, -s, s, c) * p.xz;
  vec3 n = normal; n.xz = mat2(c, -s, s, c) * n.xz;
  float dist = distance(aOffset.xyz, cameraPosition);
  float fade = 1.0 - smoothstep(uFar * 0.86, uFar, dist);
  p *= aOffset.w * uScaleBoost * fade;
  float sway = sin(uTime * 1.3 + aOffset.x * 0.07 + aOffset.z * 0.05) * 0.012 + sin(uTime * 2.9 + aOffset.x * 0.3) * 0.005;
  p.xz += sway * p.y * vec2(1.0, 0.6) * (1.0 - step(1.5, aParams.y));
  vWorld = aOffset.xyz + p;
  vH = position.y / 16.0;
  vCol = color; vNrm = n; vPar = aParams;
  vBake = texture(uShadowBake, aOffset.xz / uMapSize + 0.5).r;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}`;
const FRAG = /* glsl */`
precision highp float;
uniform vec3 uSunDir, uSunColor, uAmbSky, uAmbGround;
uniform vec4 uScorch[24];
uniform vec4 uFireLight; uniform vec3 uFireColor;
uniform sampler2DArray uGroundAlb; uniform vec3 uRockMean; uniform float uRockTex;
${GLSL_ATMOS_UNIFORMS}
${GLSL_ATMOS}
${GLSL_WEATHER}
varying vec3 vCol; varying vec3 vNrm; varying vec3 vWorld; varying float vBake; varying float vH; varying vec4 vPar;
void main(){
  vec3 N = normalize(vNrm);
  vec3 col = vCol;
  bool rock = vPar.y > 1.5;
  bool trunk = !rock && vCol.r > vCol.g;
  if (rock) {
    col *= 0.7 + 0.6 * fract(vPar.y);
    if (uRockTex > 0.5) {
      // scanned stone, projected from above and from the side so boulders are not smeared
      vec3 top = texture(uGroundAlb, vec3(vWorld.xz / 3.4, 6.0)).rgb, side = texture(uGroundAlb, vec3(vec2(vWorld.x + vWorld.z, vWorld.y) / 3.4, 6.0)).rgb;
      // light and dark from the scan only: dividing channel by channel by its mean turned grey pebbles violet
      col = col * 2.6 * (dot(mix(side, top, smoothstep(0.35, 0.75, abs(N.y))), vec3(0.3, 0.59, 0.11)) / max(dot(uRockMean, vec3(0.3, 0.59, 0.11)), 0.02)) * 0.42;
    }
    col = mix(col, vec3(0.80, 0.84, 0.90), vPar.z * smoothstep(0.25, 0.7, N.y));
  } else if (!trunk) {
    col *= 0.78 + 0.5 * vPar.y;
    col = mix(col, col * vec3(1.55, 1.02, 0.5) + vec3(0.02, 0.008, 0.0), vPar.w);            // autumn
    col = mix(col, vec3(0.62, 0.66, 0.72), vPar.z * smoothstep(0.0, 0.6, N.y) * 0.85);      // snow load
  }
  float burnt = 0.0;
  for (int i = 0; i < 24; i++) { vec4 sc = uScorch[i]; if (sc.z <= 0.0) continue; burnt = max(burnt, 1.0 - smoothstep(0.7, 1.25, distance(vWorld.xz, sc.xy) / sc.z)); }
  col = mix(col, vec3(0.012, 0.010, 0.009), burnt * 0.95);
  float ndl = dot(N, uSunDir);
  float wrap = max(0.0, ndl * 0.62 + 0.38);
  float shadow = vBake * cloudShadow(vWorld, uSunDir);
  float ao = rock ? 0.7 + 0.3 * N.y : 0.45 + 0.55 * smoothstep(0.05, 0.75, vH);
  vec3 lit = col * (uSunColor * wrap * shadow * ao + mix(uAmbGround, uAmbSky, N.y * 0.5 + 0.5) * ao);
  // light scattering through the leaves when looking toward the sun
  vec3 V = normalize(cameraPosition - vWorld);
  float trans = pow(max(dot(-V, uSunDir), 0.0), 3.0) * max(0.0, 0.4 - ndl * 0.4);
  if (!trunk && !rock) lit += col * uSunColor * trans * shadow * 0.9;
  if (uFireLight.w > 0.0) { vec3 fl = uFireLight.xyz - vWorld; float fd = length(fl); lit += col * uFireColor * uFireLight.w / (1.0 + fd * fd * 0.0025); }
  gl_FragColor = vec4(applyAtmosphere(lit, vWorld, cameraPosition), 1.0);
}`;
const DEPTH_VERT = /* glsl */`
attribute vec4 aOffset; attribute vec4 aParams;
void main(){
  float c = cos(aParams.x), s = sin(aParams.x);
  vec3 p = position; p.xz = mat2(c, -s, s, c) * p.xz;
  p *= aOffset.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(aOffset.xyz + p, 1.0);
}`;
const DEPTH_FRAG = /* glsl */`
#include <packing>
void main(){ gl_FragColor = packDepthToRGBA(gl_FragCoord.z); }`;

// ---- impostors: every tree is one camera-facing quad showing a real model baked from 12 directions × 2 heights
const IMP_VERT = /* glsl */`
attribute vec4 aOffset;   // xyz position, w scale
attribute vec4 aParams;   // rotation, hue variation, snow, autumn
uniform vec4 uImp;        // model half-width, height, half-height of the low / high view
uniform float uSizeM, uFar, uTime, uFrames, uBoost;
uniform sampler2D uShadowBake; uniform vec2 uMapSize;
uniform vec3 uSunDir;
uniform vec4 uScorch[24];
${GLSL_ATMOS_UNIFORMS}
${GLSL_ATMOS}
${GLSL_WEATHER}
varying vec2 vUv; varying vec3 vWorld; varying vec4 vPar;
varying vec3 vFogAdd, vFogMul; varying vec2 vShade;    // x: sun shadow, y: burnt
void main(){
  float k = uSizeM / uImp.y * aOffset.w * uBoost;
  vec3 center = aOffset.xyz + vec3(0.0, uImp.y * 0.5 * k, 0.0);
  vec3 toCam = cameraPosition - center; float dist = length(toCam); vec3 d = toCam / dist;
  float fade = 1.0 - smoothstep(uFar * 0.86, uFar, dist);
  float ring = step(0.63, asin(clamp(d.y, -1.0, 1.0)));
  float hv = mix(uImp.z, uImp.w, ring);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), d) + vec3(1e-5, 0.0, 0.0));
  vec3 upv = cross(d, right);
  float sway = (sin(uTime * 1.3 + aOffset.x * 0.07 + aOffset.z * 0.05) * 0.012 + sin(uTime * 2.9 + aOffset.x * 0.3) * 0.005) * (position.y * 0.5 + 0.5);
  vWorld = center + (right * (position.x * uImp.x + sway * uImp.y) + upv * position.y * hv) * k * fade;
  float az = atan(d.x, d.z) - aParams.x;
  float fr = mod(floor(az / 6.2831853 * uFrames + 0.5), uFrames);
  vec2 q = mix(vec2(0.004), vec2(0.996), position.xy * 0.5 + 0.5);
  vUv = vec2((fr + q.x) / uFrames, (ring + q.y) * 0.5);
  vPar = aParams;
  // per-tree terms are evaluated here, once per corner, instead of for every pixel
  float burnt = 0.0;
  for (int i = 0; i < 24; i++) { vec4 sc = uScorch[i]; if (sc.z <= 0.0) continue; burnt = max(burnt, 1.0 - smoothstep(0.7, 1.25, distance(aOffset.xz, sc.xy) / sc.z)); }
  vShade = vec2(texture(uShadowBake, aOffset.xz / uMapSize + 0.5).r * cloudShadow(center, uSunDir), burnt);
  vFogAdd = applyAtmosphere(vec3(0.0), center, cameraPosition);
  vFogMul = applyAtmosphere(vec3(1.0), center, cameraPosition) - vFogAdd;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}`;
const IMP_FRAG = /* glsl */`
precision highp float;
uniform sampler2D uAlb, uNrm, uMask;
uniform vec3 uTint, uSunDir, uSunColor, uAmbSky, uAmbGround;
uniform vec4 uFireLight; uniform vec3 uFireColor;
varying vec2 vUv; varying vec3 vWorld; varying vec4 vPar;
varying vec3 vFogAdd, vFogMul; varying vec2 vShade;
void main(){
  vec4 m = texture(uMask, vUv);
  if (m.r < 0.06) discard;
  float alpha = clamp((m.r - 0.5) / max(fwidth(m.r), 1e-4) + 0.5, 0.0, 1.0);
  vec3 col = texture(uAlb, vUv).rgb * uTint * (0.78 + 0.44 * vPar.y);
  vec3 n = texture(uNrm, vUv).rgb * 2.0 - 1.0;
  float c = cos(vPar.x), s = sin(vPar.x);
  vec3 N = normalize(vec3(n.x * c + n.z * s, n.y, -n.x * s + n.z * c));
  col = mix(col, col * vec3(1.55, 1.0, 0.48) + vec3(0.02, 0.008, 0.0), vPar.w);
  col = mix(col, vec3(0.62, 0.66, 0.72), vPar.z * smoothstep(0.0, 0.6, N.y) * 0.85);
  col = mix(col, vec3(0.012, 0.010, 0.009), vShade.y * 0.95);
  float ndl = dot(N, uSunDir);
  float ao = (0.5 + 0.5 * smoothstep(0.0, 0.55, m.g)) * (0.55 + 0.45 * smoothstep(0.15, 0.85, m.b));
  vec3 lit = col * (uSunColor * max(0.0, ndl * 0.6 + 0.4) * vShade.x * ao + mix(uAmbGround, uAmbSky, N.y * 0.5 + 0.5) * ao);
  vec3 V = normalize(cameraPosition - vWorld);
  lit += col * uSunColor * pow(max(dot(-V, uSunDir), 0.0), 3.0) * max(0.0, 0.4 - ndl * 0.4) * vShade.x * 0.9;
  if (uFireLight.w > 0.0) { vec3 fl = uFireLight.xyz - vWorld; float fd = length(fl); lit += col * uFireColor * uFireLight.w / (1.0 + fd * fd * 0.0025); }
  gl_FragColor = vec4(lit * vFogMul + vFogAdd, alpha);
}`;
const IMP_DEPTH_FRAG = /* glsl */`
#include <packing>
uniform sampler2D uMask; varying vec2 vUv; varying vec3 vWorld; varying vec4 vPar; varying vec3 vFogAdd, vFogMul; varying vec2 vShade;
void main(){ if (texture(uMask, vUv).r < 0.5) discard; gl_FragColor = packDepthToRGBA(gl_FragCoord.z); }`;

// ---- octahedral impostors: the tree baked from a grid of views spread evenly over the upper hemisphere (tools/bake.js,
// bakeOct). The tree is drawn on one quad; each corner works out where it falls in the three baked views that surround
// the camera's direction, and every pixel blends those three. Nothing snaps as the camera circles or climbs, and from
// above the tree is seen from above. The tree's own shading is baked too: per texel, how much sun gets through the crown
// to it as a function of the sun's direction, and how much open sky it sees.
// With OCT_ONE only the nearest view is drawn (distant forest and the shadow pass).
// The viewing eye is explicit: the shadow camera must make the same distance
// decision as the colour pass. Both representations use the same pixel threshold.
const TREE_LOD = /* glsl */`
uniform vec3 uEye;
uniform float uNearEnabled;
varying float vNear;
float meshCover(vec3 center) {
  return uNearEnabled * (1.0 - smoothstep(${NEAR_IN}.0, ${NEAR_OUT}.0, distance(center, uEye)));
}`;
const TREE_DITHER = /* glsl */`
varying float vNear;
float treeThreshold(float rotation) {
  vec2 p = floor(gl_FragCoord.xy) + floor(rotation * vec2(17.0, 37.0));
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}`;
const TREE_ENV = /* glsl */`
float treeBurn(vec2 xz) {
  float burnt = 0.0;
  for (int i = 0; i < 24; i++) {
    vec4 sc = uScorch[i];
    if (sc.z > 0.0) burnt = max(burnt, 1.0 - smoothstep(0.7, 1.25, distance(xz, sc.xy) / sc.z));
  }
  return burnt;
}
const float CAN_TAP[5] = float[5](7.0, 13.0, 22.0, 36.0, 58.0);
float shadeHeight(vec2 xz) {
  vec2 sh = normalize(uSunDir.xz + vec2(1e-5, 0.0));
  float st = max(uSunDir.y, 0.0) / max(length(uSunDir.xz), 1e-3);
  float shadeTo = -1e4;
  for (int i = 0; i < 5; i++) shadeTo = max(shadeTo, texture(uCanopy, (xz + sh * CAN_TAP[i]) / ${CAN_N * CAN_CELL}.0).r - CAN_TAP[i] * st);
  return shadeTo;
}
float canopyHeight(vec2 xz) {
  vec2 uv = xz / ${CAN_N * CAN_CELL}.0, dx = vec2(9.0 / ${CAN_N * CAN_CELL}.0, 0.0);
  return 0.25 * (texture(uCanopy, uv + dx).r + texture(uCanopy, uv - dx).r
               + texture(uCanopy, uv + dx.yx).r + texture(uCanopy, uv - dx.yx).r);
}`;
const OCT_VERT = /* glsl */`
attribute vec4 aOffset;   // xyz position, w scale
attribute vec4 aParams;   // rotation, hue variation, snow, autumn
uniform vec4 uImp;        // model half-width, height
uniform float uSizeM, uFar, uTime, uGrid, uBoost;
uniform sampler2D uShadowBake, uCanopy; uniform vec2 uMapSize;
uniform vec3 uSunDir;
uniform vec4 uScorch[24];
${GLSL_ATMOS_UNIFORMS}
${GLSL_ATMOS}
${GLSL_WEATHER}
varying vec3 vWorld, vW; varying vec4 vPar, vF01, vQ01; varying vec2 vF2, vQ2;
varying vec3 vFogAdd, vFogMul; varying vec3 vShade;    // x: sun shadow, y: burnt, z: 0 when the camera is in among the branches
varying vec4 vAmong;                                   // height its neighbours shade it up to, its middle, half its height, how far the quad lies flat
varying float vCanopy;                                 // height of the forest close round it
${TREE_LOD}
${TREE_ENV}
// where a point of the tree lands in baked view idx (0 … 1 across that view's frame), exactly as the bake set its camera
vec2 inView(vec2 idx, vec3 P){
  vec2 p = idx / (uGrid - 1.0) * 2.0 - 1.0; vec2 t = vec2(p.x + p.y, p.x - p.y) * 0.5;
  vec3 f = normalize(vec3(t.x, max(1.0 - abs(t.x) - abs(t.y), 0.0), t.y));
  vec3 rt = normalize(vec3(f.z, 0.0, -f.x)), up = cross(f, rt);
  return vec2(dot(P, rt) / uImp.x, dot(P, up) / (uImp.y * 0.5 * length(f.xz) + uImp.x * f.y)) * 0.5 + 0.5;
}
void main(){
  float k = uSizeM / uImp.y * aOffset.w * uBoost;
  vec3 center = aOffset.xyz + vec3(0.0, uImp.y * 0.5 * k, 0.0);
  #if !defined(OCT_ONE) || defined(OCT_DEPTH)
  vNear = meshCover(center);
  #else
  vNear = 0.0;
  #endif
  if (vNear >= 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 toCam = cameraPosition - center; float dist = length(toCam);
  float fade = 1.0 - smoothstep(uFar * 0.86, uFar, dist);
  // the camera in the tree's own frame (metres of the source model, before the tree's turn about its trunk)
  float c = cos(aParams.x), s = sin(aParams.x);
  vec3 O = vec3(toCam.x * c - toCam.z * s, toCam.y, toCam.x * s + toCam.z * c) / k;
  vec3 d = normalize(O);
  // the quad stands in for the tree, and the views are lined up on it. A broad crown (OCT_FACING) gets a quad that faces
  // the camera. A tall narrow tree gets an upright one through its trunk, turned to the camera: the trunk lies in it, so
  // it never doubles or changes length. Only from almost straight above does that one tip over to face the camera.
  #ifdef OCT_FACING
  vec3 n = d;
  #else
  vec3 n = normalize(vec3(d.x, d.y * smoothstep(OCT_T0, OCT_T1, abs(d.y)), d.z) + vec3(1e-5, 0.0, 0.0));
  #endif
  vec3 right = normalize(vec3(n.z, 0.0, -n.x) + vec3(1e-5, 0.0, 0.0));
  vec3 upv = cross(n, right);
  // tall enough to hold the tree's outline as the camera sees it, carried onto the quad along the line of sight
  float hv = uImp.y * 0.5 * abs(upv.y) + uImp.x * length(upv.xz) + abs(dot(upv, d)) / max(dot(d, n), 0.2) * (uImp.y * 0.5 * abs(n.y) + uImp.x * length(n.xz));
  float sway = (sin(uTime * 1.3 + aOffset.x * 0.07 + aOffset.z * 0.05) * 0.012 + sin(uTime * 2.9 + aOffset.x * 0.3) * 0.005) * (position.y * 0.5 + 0.5);
  // up close the near side of the crown looms wider than the tree's outline at its centre: give the quad room for it
  float rd = uImp.x / length(O);
  float pad = 1.04 * inversesqrt(max(1.0 - rd * rd, 0.16));
  vec3 Pl = right * (position.x * uImp.x * pad) + upv * (position.y * hv * pad);
  vec3 Pm = Pl + right * (sway * uImp.y);
  vWorld = center + vec3(Pm.x * c + Pm.z * s, Pm.y, -Pm.x * s + Pm.z * c) * k * fade;
  // the three baked views round the camera's direction, and how much of each
  vec3 dh = vec3(d.x, max(d.y, 0.0), d.z); dh /= abs(dh.x) + abs(dh.y) + abs(dh.z);
  vec2 g = clamp(vec2(dh.x + dh.z, dh.x - dh.z) * 0.5 + 0.5, 0.0, 1.0) * (uGrid - 1.0);
  vec2 cell = min(floor(g), uGrid - 2.0), fr = g - cell;
  vec2 mid = fr.x > fr.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec3 w = vec3(1.0 - max(fr.x, fr.y), abs(fr.x - fr.y), min(fr.x, fr.y));
  w = max(w - OCT_SHARP, 0.0); w /= w.x + w.y + w.z;      // a view with little say is dropped (and costs nothing); the rest share its weight
  #ifdef OCT_ONE
  vec2 best = (w.x >= w.y && w.x >= w.z) ? cell : (w.y >= w.z ? cell + mid : cell + 1.0);
  vF01 = vec4(best, best); vF2 = best; vW = vec3(1.0, 0.0, 0.0);
  vQ01 = vec4(inView(best, Pl), 0.0, 0.0); vQ2 = vec2(0.0);
  #else
  vF01 = vec4(cell, cell + mid); vF2 = cell + 1.0; vW = w;
  vQ01 = vec4(inView(cell, Pl), inView(cell + mid, Pl)); vQ2 = inView(cell + 1.0, Pl);
  #endif
  vPar = aParams;
  float inCrown = uNearEnabled > 0.0 ? 1.0 : smoothstep(0.95, 1.2, length(O / vec3(uImp.x * 1.6, uImp.y * 0.575, uImp.x * 1.6)));
  vShade = vec3(texture(uShadowBake, aOffset.xz / uMapSize + 0.5).r * cloudShadow(center, uSunDir), treeBurn(aOffset.xz), inCrown);
  vAmong = vec4(shadeHeight(aOffset.xz), center.y, uImp.y * 0.5 * k, abs(n.y));
  vCanopy = canopyHeight(aOffset.xz);
  vFogAdd = applyAtmosphere(vec3(0.0), center, cameraPosition);
  vFogMul = applyAtmosphere(vec3(1.0), center, cameraPosition) - vFogAdd;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}`;
const OCT_COMMON = TREE_DITHER + /* glsl */`
precision highp float;
uniform sampler2D uAlb, uNrm, uMask, uLight;
uniform float uGrid;
varying vec3 vWorld, vW; varying vec4 vPar, vF01, vQ01; varying vec2 vF2, vQ2;
varying vec3 vFogAdd, vFogMul; varying vec3 vShade; varying vec4 vAmong; varying float vCanopy;
vec4 gA; vec3 gN, gB, gM;      // colour × coverage + coverage, normal, sun fit b, (sun fit a, sky seen, weight used)
void octFrame(vec2 idx, float w, vec2 q01, vec2 gx, vec2 gy){
  if (w <= 0.0) return;
  gM.z += w;
  float inb = step(0.0, min(min(q01.x, q01.y), min(1.0 - q01.x, 1.0 - q01.y)));
  vec2 uv = (idx + clamp(q01, 0.004, 0.996)) / uGrid;
  vec4 m = textureGrad(uMask, uv, gx, gy);
  float wc = w * m.r * inb;
  if (wc < 0.002) return;      // open air in this view (most of the quad ends here)
  #ifdef OCT_DEPTH
  gA.a += wc;
  #else
  gA += vec4(textureGrad(uAlb, uv, gx, gy).rgb, 1.0) * wc;
  gN += (textureGrad(uNrm, uv, gx, gy).rgb * 2.0 - 1.0) * wc;
  gB += textureGrad(uLight, uv, gx, gy).rgb * wc;
  gM.xy += m.gb * wc;
  #endif
}
float octSample(){
  gA = vec4(0.0); gN = vec3(0.0); gB = vec3(0.0); gM = vec3(0.0);
  octFrame(floor(vF01.xy + 0.5), vW.x, vQ01.xy, dFdx(vQ01.xy) / uGrid, dFdy(vQ01.xy) / uGrid);
  #ifndef OCT_ONE
  octFrame(floor(vF01.zw + 0.5), vW.y, vQ01.zw, dFdx(vQ01.zw) / uGrid, dFdy(vQ01.zw) / uGrid);
  octFrame(floor(vF2 + 0.5), vW.z, vQ2, dFdx(vQ2) / uGrid, dFdy(vQ2) / uGrid);
  #endif
  return gA.a;
}`;
const TREE_LIGHT = /* glsl */`
uniform vec3 uTint, uFoliageTint, uSunDir, uSunColor, uAmbSky, uAmbGround;
uniform vec4 uFireLight; uniform vec3 uFireColor;
vec3 treeLight(vec3 col, vec3 N, float sunVis, float skyVis, float texelY, float translucent, vec2 shade, vec2 canopy) {
  col = mix(col, col * vec3(1.55, 1.0, 0.48) + vec3(0.02, 0.008, 0.0), vPar.w);
  col = mix(col, vec3(0.62, 0.66, 0.72), vPar.z * smoothstep(0.0, 0.6, N.y) * 0.85);
  col = mix(col, vec3(0.012, 0.010, 0.009), shade.y * 0.95);
  sunVis *= mix(1.0, min(skyVis * 1.6, 1.0), OCT_TIERS);
  sunVis *= mix(OCT_SHADE, 1.0, smoothstep(-OCT_SOFT, OCT_SOFT, texelY - canopy.x));
  skyVis *= mix(1.0, OCT_SKYSHADE, smoothstep(0.0, 9.0, canopy.y - texelY));      // down among its neighbours it sees less sky
  float ndl = dot(N, uSunDir);
  vec3 lit = col * (uSunColor * max(0.0, ndl * 0.6 + 0.4) * shade.x * sunVis * OCT_SUN + mix(uAmbGround, uAmbSky, N.y * 0.5 + 0.5) * skyVis * OCT_AMB);
  vec3 V = normalize(cameraPosition - vWorld);
  lit += translucent * col * uSunColor * pow(max(dot(-V, uSunDir), 0.0), 3.0) * max(0.0, 0.4 - ndl * 0.4) * shade.x * 0.9 * mix(0.25, 1.0, sunVis);
  if (uFireLight.w > 0.0) { vec3 fl = uFireLight.xyz - vWorld; float fd = length(fl); lit += col * uFireColor * uFireLight.w / (1.0 + fd * fd * 0.0025); }
  return lit;
}`;
const OCT_FRAG = OCT_COMMON + TREE_LIGHT + /* glsl */`
void main(){
  if (vNear > 0.0 && treeThreshold(vPar.x) < vNear) discard;
  float wc = octSample();
  // a branch counts as solid if the views carrying about a third of the say show it: thin twigs that the views place a
  // little differently would otherwise average away
  float cov = min(wc / max(gM.z, 1e-4) * 1.4, 1.0) * vShade.z;
  if (cov < 0.06) discard;
  // edges are sharpened as on the other trees, but only so far: where the views disagree over a whole patch it shows as
  // partial cover (the 4 MSAA samples dither it) and eases in and out as the camera moves, instead of popping
  float alpha = clamp((cov - 0.5) / max(fwidth(cov), 0.45) + 0.5, 0.0, 1.0);
  vec3 albedo = gA.rgb / wc;
  // The generated foliage has blue/red <= 0.35, bark >= 0.58. Blend
  // the two tints on atlas texels where mip filtering mixes bark and leaves.
  float bark = smoothstep(0.38 * albedo.r, max(0.56 * albedo.r, 1e-6), albedo.b);
  vec3 col = albedo * mix(uFoliageTint, uTint, bark) * (0.78 + 0.44 * vPar.y);
  vec3 n = gN / wc;
  float c = cos(vPar.x), s = sin(vPar.x);
  vec3 N = normalize(vec3(n.x * c + n.z * s, n.y, -n.x * s + n.z * c));
  // the baked light: sun reaching this texel through the crown is a + b·L for the sun's direction in the tree's own
  // frame (stored a/2 + 1/4 and b/4 + 1/2), and skyVis is the share of the sky it sees
  vec3 Ls = vec3(uSunDir.x * c - uSunDir.z * s, uSunDir.y, uSunDir.x * s + uSunDir.z * c);
  float sunVis = clamp(gM.x / wc * 2.0 - 0.5 + dot((gB / wc - 0.5) * 4.0, Ls), 0.0, 1.0);
  float skyVis = gM.y / wc;
  // shade from the trees round it: below the line its neighbours' tops draw across it (vAmong.x) only dappled light gets
  // through. How high this texel is comes from where it sits on the quad; when the quad lies flat (seen from above) that
  // says nothing, so there the open sky it sees stands in for height: tops see the sky, the skirts do not.
  float onQuad = vAmong.y + clamp((vWorld.y - vAmong.y) / max(1.0 - vAmong.w * vAmong.w, 0.15), -vAmong.z, vAmong.z);      // a tilted quad foreshortens height
  float texelY = mix(onQuad, vAmong.y + (skyVis - 0.45) * 1.8 * vAmong.z, smoothstep(0.55, 0.95, vAmong.w));
  vec3 lit = treeLight(col, N, sunVis, skyVis, texelY, 1.0, vShade.xy, vec2(vAmong.x, vCanopy));
  gl_FragColor = vec4(lit * vFogMul + vFogAdd, alpha);
}`;
// per species: strength of baked sunlight and skylight (fitted so the forest's overall tone stays what it was with the
// ring-of-views trees); whether the quad faces the camera (broad crowns) or stands upright through the trunk; and how
// much say a view needs before it is blended in (the broadleafs' lopsided crowns double up if their views are mixed
// freely, so they mostly show one view and cross-fade to the next)
// Atlas filtering averages leaf edges. Fit its tint to the near mesh over several sun and viewing angles.
const OCT_CFG = {
  c: { sun: 1.38, amb: 1.9, foliageTint: [0.799, 0.801, 1.677] },
  b: { sun: 1.12, amb: 1.17, facing: true, sharp: 0.2, foliageTint: [0.525, 0.580, 1.306] },
  b2: { sun: 1.25, amb: 1.4, facing: true, sharp: 0.2, foliageTint: [0.656, 0.702, 1.187] },
};
const OCT_DEPTH_FRAG = /* glsl */`
#include <packing>
` + OCT_COMMON + /* glsl */`
void main(){ if (vNear > 0.0 && treeThreshold(vPar.x) < vNear) discard; if (octSample() < 0.5) discard; gl_FragColor = packDepthToRGBA(gl_FragCoord.z); }`;

// The vertex attributes carry the visibility fit from the full tree. Evaluate
// environmental terms per shaded fragment, so culled leaves never sample maps.
const NEAR_VERT = TREE_LOD + /* glsl */`
attribute vec4 aOffset, aParams;
uniform vec4 uImp;
uniform float uSizeM, uTime;
varying vec2 vSprig;
varying vec4 vPar;
#ifndef TREE_DEPTH
attribute vec3 color, _sun, _sky;
uniform vec3 uSunDir;
varying vec3 vCol, vN, vWorld, vCenter;
varying vec3 vLight;
#endif
void main() {
  float k = uSizeM / uImp.y * aOffset.w;
  vec3 center = aOffset.xyz + vec3(0.0, 0.5 * uImp.y * k, 0.0);
  vNear = meshCover(center);
  vSprig = uv;
  vPar = aParams;
  float c = cos(aParams.x), s = sin(aParams.x);
  mat2 turn = mat2(c, -s, s, c);
  vec3 p = position * k;
  p.xz = turn * p.xz;
  vec2 eye = uEye.xz - center.xz;
  vec2 right = normalize(vec2(eye.y, -eye.x) + vec2(1e-5, 0.0));
  float sway = sin(uTime * 1.3 + aOffset.x * 0.07 + aOffset.z * 0.05) * 0.012 + sin(uTime * 2.9 + aOffset.x * 0.3) * 0.005;
  p.xz += right * sway * p.y;
  vec3 world = aOffset.xyz + p;
  #ifndef TREE_DEPTH
  vCol = color;
  vec3 n = normal; n.xz = turn * n.xz;
  if (dot(n, uEye - world) < 0.0) n = -n;
  vN = normalize(mix(n, normalize(world - center), TREE_PUFF));
  vec3 localSun = uSunDir; localSun.xz = transpose(turn) * localSun.xz;
  vLight = vec3(clamp(_sky.x + dot(_sun, localSun), 0.0, 1.0), _sky.yz);
  vWorld = world; vCenter = center;
  #endif
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`;
const SPRIG = /* glsl */`
uniform sampler2D uSprig;
varying vec2 vSprig;
vec3 sprigTint() {
  if (vSprig.x < 0.0) return vec3(1.0); // bark
  vec4 blade = texture(uSprig, vSprig);
  if (blade.a < TREE_CUT) discard;
  return blade.rgb * TREE_LEAF_GAIN;
}`;
const NEAR_FRAG = TREE_DITHER + SPRIG + /* glsl */`
varying vec4 vPar;
varying vec3 vCol, vN, vWorld, vCenter, vLight;
uniform sampler2D uShadowBake, uCanopy;
uniform vec2 uMapSize;
uniform vec4 uScorch[24];
${GLSL_ATMOS_UNIFORMS}
${GLSL_ATMOS}
${GLSL_WEATHER}
${TREE_LIGHT}
${TREE_ENV}
void main() {
  if (vNear < 1.0 && treeThreshold(vPar.x) >= vNear) discard;
  vec3 col = vCol * sprigTint() * mix(uTint, uFoliageTint, vLight.z) * (0.78 + 0.44 * vPar.y);
  vec2 xz = vCenter.xz;
  vec2 shade = vec2(texture(uShadowBake, xz / uMapSize + 0.5).r * cloudShadow(vCenter, uSunDir), treeBurn(xz));
  vec2 canopy = vec2(shadeHeight(xz), canopyHeight(xz));
  vec3 lit = treeLight(col, normalize(vN), vLight.x, vLight.y, vWorld.y, vLight.z, shade, canopy);
  gl_FragColor = vec4(applyAtmosphere(lit, vCenter, cameraPosition), 2.0);  // HDR alpha marks a crown with baked self-occlusion for SSAO
}`;
const NEAR_DEPTH_FRAG = TREE_DITHER + SPRIG + /* glsl */`
#include <packing>
varying vec4 vPar;
void main() {
  if (vNear < 1.0 && treeThreshold(vPar.x) >= vNear) discard;
  sprigTint();
  gl_FragColor = packDepthToRGBA(gl_FragCoord.z);
}`;

// loads the baked atlases from public/impostors; resolves to null if they are missing (procedural trees are used instead)
export async function loadImpostors() {
  try {
    const meta = await (await fetch('/impostors/meta.json')).json();
    const loader = new THREE.TextureLoader(); const out = {};
    const tex = async (name, srgb) => { const t = await loader.loadAsync('/impostors/' + name); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = 4; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
    for (const k of ['c', 'b', 'b2', 'u', 'co', 'bo', 'b2o']) {
      if (!meta[k]) continue;          // co, bo, b2o are the forest trees again as octahedral impostors (optional); b2 (the second broadleaf) is optional: without it every broadleaf tree is b
      out[k] = { meta: meta[k], albedo: await tex(k + '_albedo.png', true), normal: await tex(k + '_normal.png', false), mask: await tex(k + '_mask.png', false), light: meta[k].light ? await tex(k + '_light.png', false) : null };
    }
    return out;
  } catch (e) { console.warn('[trees] impostor atlases not found, using procedural trees:', e.message); return null; }
}

export class Trees {
  constructor(field, scorch, sites = [], ground = null) {
    this.field = field; this.sites = sites; this.scorchRef = scorch; this.imp = null;   // keep-clear circles around castles and towns
    this.group = new THREE.Group();
    this.chunks = new Map();       // key → { data per type, meshes }
    this.cache = new Map();        // key → generated instance arrays (or null)
    const bg = bushGeo(), rg = rockGeo();
    this.geo = { c: [coniferHi(), coniferLo()], b: [broadHi(), broadLo()], u: [bg, bg], r: [rg, rg] };
    const mk = (boost, far) => new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: {
        uTime: G.uTime, uScaleBoost: { value: boost }, uFar: { value: far },
        uShadowBake: { value: field.shadowTex }, uMapSize: { value: new THREE.Vector2(MAP.W, MAP.H) },
        uSunDir: G.uSunDir, uSunColor: G.uSunColor, uAmbSky: G.uAmbSky, uAmbGround: G.uAmbGround,
        uSkyLUT: G.uSkyLUT, uTrueSunDir: G.uTrueSunDir, uFogParams: G.uFogParams,
        uWeather: G.uWeather, uCloudParams: G.uCloudParams, uWind: G.uWind,
        uScorch: { value: scorch }, uFireLight: G.uFireLight, uFireColor: G.uFireColor,
        uGroundAlb: { value: ground ? ground.albedo : null }, uRockMean: { value: ground ? ground.means[6] : new THREE.Vector3(0.2, 0.2, 0.2) }, uRockTex: { value: ground && ground.loaded ? 1 : 0 },
      },
    });
    this.mats = [mk(1, 1e9), mk(1.08, 1e9), mk(1.75, R_FAR)];
    this.matSmall = mk(1, R_HI + 40);
    this.depthMat = new THREE.ShaderMaterial({ vertexShader: DEPTH_VERT, fragmentShader: DEPTH_FRAG });
    this.near = {};
    this.nearEnabled = true;
    this.nearEye = new THREE.Vector3();
    this.nearFrustum = new THREE.Frustum();
    this.nearProjection = new THREE.Matrix4();
    this.nearBounds = new THREE.Sphere();
    this.count = 0;
    this._queue = [];
    this._lastCell = null;
    // canopy map (see CAN_N): ground height where nothing grows, tree-top height where a tree stands; filled chunk by chunk
    this.canopy = new Uint16Array(CAN_N * CAN_N).fill(THREE.DataUtils.toHalfFloat(-1000));
    this.canopyTex = new THREE.DataTexture(this.canopy, CAN_N, CAN_N, THREE.RedFormat, THREE.HalfFloatType);
    this.canopyTex.wrapS = this.canopyTex.wrapT = THREE.RepeatWrapping; this.canopyTex.magFilter = this.canopyTex.minFilter = THREE.LinearFilter; this.canopyTex.needsUpdate = true;
    this._canopyDirty = false; this._canopyWait = 0;
  }
  // write one chunk of forest into the canopy map
  _canopyChunk(cx, cz, data) {
    const n = CS / CAN_CELL, i0 = cx * n, j0 = cz * n, wrap = (v) => ((v % CAN_N) + CAN_N) % CAN_N, hf = THREE.DataUtils.toHalfFloat;
    const top = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) top[j * n + i] = this.field.baseHeight((i0 + i + 0.5) * CAN_CELL, (j0 + j + 0.5) * CAN_CELL);
    if (data) for (const kind in TREE_SIZE) {
      const a = data[kind]; if (!a) continue;
      for (let t = 0; t < a.length; t += 4) {
        const i = Math.min(n - 1, Math.max(0, Math.floor(a[t] / CAN_CELL) - i0)), j = Math.min(n - 1, Math.max(0, Math.floor(a[t + 2] / CAN_CELL) - j0));
        const y = a[t + 1] + TREE_SIZE[kind] * a[t + 3] * 0.88;      // a crown narrows toward its tip: what shades a neighbour is a little under the top
        if (y > top[j * n + i]) top[j * n + i] = y;
      }
    }
    for (let j = 0; j < n; j++) { const row = wrap(j0 + j) * CAN_N; for (let i = 0; i < n; i++) this.canopy[row + wrap(i0 + i)] = hf(top[j * n + i]); }
    this._canopyDirty = true;
  }

  _generate(cx, cz) {
    const f = this.field; const x0 = cx * CS, z0 = cz * CS;
    // quick reject: no forest and no scatter possible in the sea
    const mid = f.baseHeight(x0 + CS / 2, z0 + CS / 2);
    if (mid < -30) return null;
    const out = { c: [], cp: [], b: [], bp: [], b2: [], b2p: [] };
    const clear = this._clearNear(x0, z0);
    const lat0 = mapLat(z0 + CS / 2);
    const latS = smooth(0.12, 0.60, lat0);
    const treeLine = 520 + (1250 - 520) * latS;   // matches the terrain shader
    const coniferShare = 1 - smooth(0.36, 0.56, lat0);
    const snowy = 1 - smooth(0.15, 0.3, lat0);
    const autumnBase = smooth(0.2, 0.3, lat0) * (1 - smooth(0.42, 0.56, lat0));
    for (let n = 0; n < GRID * GRID; n++) {
      const i = (n * 617) % (GRID * GRID); const gx = i % GRID, gz = (i / GRID) | 0;
      const hx = cx * GRID + gx, hz = cz * GRID + gz;
      const x = x0 + (gx + hash2(hx, hz, 1) * 1.9 - 0.45) * SP, z = z0 + (gz + hash2(hx, hz, 2) * 1.9 - 0.45) * SP;   // loose jitter: no visible planting rows
      if ((clear.length || this.paveAt) && this._blocked(clear, x, z)) continue;
      const forest = f.forestAt(x, z);
      const macro = sampleDetailR(f.detail, x / 5200, z / 5200);
      let p = smooth(0.30, 0.45, forest + (macro - 0.5) * 0.7);
      // scattered trees and copses in open country
      const copse = smooth(0.62, 0.8, sampleDetailR(f.detail, x / 1300 + 0.3, z / 1300 + 0.7));
      const desert = f.biomeAt(x, z, 0), farm = f.biomeAt(x, z, 2);
      // trees gather into groves with clearings between them rather than an even sprinkle
      const grove = smooth(0.36, 0.62, sampleDetailR(f.detail, x / 230 + 0.11, z / 230 + 0.57));
      const open = (0.004 + copse * 0.42 * grove + grove * 0.035) * (1 - desert) * (1 - farm * 0.75) * (1 - snowy * 0.8);
      const core = p;
      p = Math.max(p * (0.5 + 0.5 * grove), open);
      if (p <= 0.002 || hash2(hx, hz, 3) > p) continue;
      const h = f.heightAt(x, z);
      if (h < 2.2 || h > treeLine) continue;
      if (f.riverAt(x, z) > 0.3) continue;
      const hx1 = f.heightAt(x + 6, z), hz1 = f.heightAt(x, z + 6);
      const sl = Math.hypot(hx1 - h, hz1 - h) / 6;
      if (sl > 0.75) continue;                               // too steep (≈ steep 0.2 in the shader)
      if (hash2(hx, hz, 4) < smooth(0.45, 0.75, sl)) continue;
      const conifer = hash2(hx, hz, 5) < coniferShare * 0.92 + 0.04;
      const hs = hash2(hx, hz, 6);
      const sc = (0.6 + 0.55 * hs + 0.75 * hs * hs * hs) * (0.9 + 0.35 * core) * (conifer ? 1.0 : 0.95) * (1 - 0.3 * smooth(treeLine - 350, treeLine, h));
      const rot = hash2(hx, hz, 7) * 6.283, hue = hash2(hx, hz, 8);
      const snow = Math.min(1, snowy * 1.2 + smooth(treeLine - 300, treeLine, h) * 0.22) * (0.6 + 0.4 * hash2(hx, hz, 9));
      const autumn = conifer ? 0 : (hash2(hx, hz, 10) < autumnBase * 0.3 ? 0.5 + 0.5 * hash2(hx, hz, 11) : 0);
      // broadleaf woods mix two species, in patches rather than evenly
      const kind = conifer ? 'c' : (this.imp && this.imp.b2 && sampleDetailR(f.detail, x / 700 + 0.41, z / 700 + 0.19) + (hash2(hx, hz, 12) - 0.5) * 0.5 > 0.5 ? 'b2' : 'b');
      out[kind].push(x, h - 0.3, z, sc); out[kind + 'p'].push(rot, hue, snow, autumn);
    }
    if (out.c.length === 0 && out.b.length === 0 && out.b2.length === 0) return null;
    return { c: new Float32Array(out.c), cp: new Float32Array(out.cp), b: new Float32Array(out.b), bp: new Float32Array(out.bp), b2: new Float32Array(out.b2), b2p: new Float32Array(out.b2p) };
  }

  // switch tree rendering from procedural meshes to baked impostors (call before any chunk is built)
  setImpostors(imp) {
    this.imp = imp;
    const loading = [];
    const quad = new THREE.BufferGeometry();
    quad.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    quad.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(18).fill(0), 3));   // unused, kept so chunk geometry setup is uniform
    quad.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(18).fill(1), 3));
    const cfg = { c: { size: TREE_SIZE.c, tint: [0.62, 0.78, 0.66], far: R_FAR }, b: { size: TREE_SIZE.b, tint: [0.8, 0.92, 0.72], far: R_FAR }, b2: { size: TREE_SIZE.b2, tint: [0.8, 0.92, 0.72], far: R_FAR }, u: { size: 1.25, tint: [0.85, 0.95, 0.75], far: R_HI + 40 } };
    this.impMats = {}; this.impDepth = {};
    for (const k of ['c', 'b', 'b2', 'u']) {
      if (!imp[k]) continue;
      const t = imp[k], m = t.meta;
      const uniforms = {
        uImp: { value: new THREE.Vector4(m.halfW, m.height, m.hv[0], m.hv[1]) }, uSizeM: { value: cfg[k].size }, uFar: { value: cfg[k].far }, uFrames: { value: m.frames },
        uTime: G.uTime, uAlb: { value: t.albedo }, uNrm: { value: t.normal }, uMask: { value: t.mask }, uTint: { value: new THREE.Vector3(...cfg[k].tint) },
        uShadowBake: { value: this.field.shadowTex }, uMapSize: { value: new THREE.Vector2(MAP.W, MAP.H) },
        uSunDir: G.uSunDir, uSunColor: G.uSunColor, uAmbSky: G.uAmbSky, uAmbGround: G.uAmbGround,
        uSkyLUT: G.uSkyLUT, uTrueSunDir: G.uTrueSunDir, uFogParams: G.uFogParams,
        uWeather: G.uWeather, uCloudParams: G.uCloudParams, uWind: G.uWind,
        uScorch: { value: this.scorchRef }, uFireLight: G.uFireLight, uFireColor: G.uFireColor,
      };
      const mkM = (boost) => new THREE.ShaderMaterial({ vertexShader: IMP_VERT, fragmentShader: IMP_FRAG, uniforms: { ...uniforms, uBoost: { value: boost } }, side: THREE.DoubleSide, alphaToCoverage: true });
      // [near / mid, far]: distant forest is drawn with a third of the trees, each a little larger
      this.impMats[k] = [mkM(1), mkM(1.55)];
      this.impDepth[k] = new THREE.ShaderMaterial({ vertexShader: IMP_VERT, fragmentShader: IMP_DEPTH_FRAG, uniforms: { ...uniforms, uBoost: { value: 1 } }, side: THREE.DoubleSide });
      this.geo[k] = [quad, quad];
      // the forest trees also come as octahedral impostors with their own light baked in (atlas sets 'co', 'bo', 'b2o'):
      // the near forest blends three views; beyond that, and in the shadow pass, the nearest view is drawn.
      // setOcta(false) puts the ring-of-views trees back, to compare.
      const o = imp[k + 'o'];
      if (o && o.light) {
        const om = o.meta, oc = OCT_CFG[k];
        const ou = { ...uniforms, uFoliageTint: { value: new THREE.Vector3(...oc.foliageTint) }, uEye: { value: this.nearEye }, uNearEnabled: { value: 0 }, uImp: { value: new THREE.Vector4(om.halfW, om.height, 0, 0) }, uGrid: { value: om.oct }, uAlb: { value: o.albedo }, uNrm: { value: o.normal }, uMask: { value: o.mask }, uLight: { value: o.light }, uCanopy: { value: this.canopyTex } };
        const defs = { OCT_T0: '0.94', OCT_T1: '0.995', OCT_SHARP: (oc.sharp || 0.1).toFixed(3), OCT_SUN: oc.sun.toFixed(3), OCT_AMB: oc.amb.toFixed(3), OCT_TIERS: '0.6', OCT_SHADE: '0.22', OCT_SOFT: '3.5', OCT_SKYSHADE: '0.55', ...(oc.facing ? { OCT_FACING: 1 } : {}) };
        const mkO = (boost, one) => new THREE.ShaderMaterial({ vertexShader: OCT_VERT, fragmentShader: OCT_FRAG, uniforms: { ...ou, uBoost: { value: boost } }, defines: { ...defs, ...(one ? { OCT_ONE: 1 } : {}) }, side: THREE.DoubleSide, alphaToCoverage: true });
        (this.ring || (this.ring = {}))[k] = { mats: this.impMats[k], depth: this.impDepth[k] };
        (this.oct || (this.oct = {}))[k] = { mats: [mkO(1, false), mkO(1, true), mkO(1.55, true)],
          depth: new THREE.ShaderMaterial({ vertexShader: OCT_VERT, fragmentShader: OCT_DEPTH_FRAG, uniforms: { ...ou, uBoost: { value: 1 } }, defines: { ...defs, OCT_ONE: 1, OCT_DEPTH: 1 }, side: THREE.DoubleSide }) };
        loading.push(this._loadNear(k, ou, defs).catch(e => console.warn(`[trees] ${k} near mesh unavailable:`, e)));
      }
    }
    if (this.oct) this.setOcta(true);
    return Promise.all(loading);
  }
  async _loadNear(kind, uniforms, defs) {
    const model = NEAR_MODEL[kind];
    const { scene } = await new GLTFLoader().loadAsync('/models/' + model.name + '_near.glb');
    scene.updateMatrixWorld(true);
    const parts = [];
    let sprig;
    scene.traverse(o => {
      if (!o.isMesh) return;
      const g = o.geometry.applyMatrix4(o.matrixWorld);
      if (o.material.map) sprig = o.material.map;
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2).fill(-1), 2));
      parts.push(g);
    });
    if (!sprig) throw new Error('Missing foliage texture');
    uniforms = { ...uniforms, uSprig: { value: sprig }, uFoliageTint: { value: new THREE.Vector3(...model.foliageTint) } };
    const base = mergeGeometries(parts);
    const g = new THREE.InstancedBufferGeometry();
    g.setIndex(base.index);
    for (const [name, attr] of Object.entries(base.attributes)) g.setAttribute(name, attr);
    // One trunk per jittered placement cell bounds the allocation, even when
    // allKind assigns the whole forest to one species in the dev harness.
    const capacity = (2 * Math.ceil(NEAR_OUT / SP) + 6) ** 2;
    for (const key of ['aOffset', 'aParams']) {
      g.setAttribute(key, new THREE.InstancedBufferAttribute(new Float32Array(4 * capacity), 4).setUsage(THREE.DynamicDrawUsage));
    }
    const defines = { ...defs, TREE_PUFF: model.puff.toFixed(2), TREE_CUT: model.cutoff.toFixed(2), TREE_LEAF_GAIN: model.leafGain.toFixed(2) };
    const mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms, defines, vertexShader: NEAR_VERT, fragmentShader: NEAR_FRAG, side: THREE.DoubleSide }));
    mesh.customDepthMaterial = new THREE.ShaderMaterial({ uniforms, defines: { ...defines, TREE_DEPTH: 1 }, vertexShader: NEAR_VERT, fragmentShader: NEAR_DEPTH_FRAG, side: THREE.DoubleSide });
    mesh.castShadow = true; mesh.frustumCulled = false; mesh.visible = false;
    // Off-screen trees still cast into the sun's map. Put visible instances
    // first so the colour pass submits just that prefix of the same buffer.
    mesh.onBeforeRender = () => { g.instanceCount = mesh.userData.inView; };
    mesh.onAfterRender = () => { g.instanceCount = mesh.userData.total; };
    mesh.name = 'near_' + kind;
    this.group.add(mesh);
    this.near[kind] = mesh;
  }
  setNear(on) {
    this.nearEnabled = !!on;
  }
  _updateNear(pos, camera) {
    this.nearEye.copy(pos);
    const active = this.octa && this.nearEnabled;
    if (active && camera) this.nearFrustum.setFromProjectionMatrix(this.nearProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    for (const mesh of Object.values(this.near)) {
      mesh.material.uniforms.uNearEnabled.value = active ? 1 : 0;
      mesh.visible = false;
      mesh.geometry.instanceCount = 0;
      mesh.userData.inView = 0;
    }
    if (!active) return;
    // Loose grid jitter can put a trunk just outside its generating chunk.
    const r = NEAR_OUT + SP;
    for (let z = Math.floor((pos.z-r)/CS); z <= Math.floor((pos.z+r)/CS); z++) {
      for (let x = Math.floor((pos.x-r)/CS); x <= Math.floor((pos.x+r)/CS); x++) {
        const chunk = this.chunks.get(x + ',' + z);
        if (!chunk) continue;
        for (const source of chunk.meshes) {
          const kind = source.userData.type, mesh = this.near[kind];
          if (!mesh) continue;
          const a = source.geometry.attributes.aOffset.array, p = source.geometry.attributes.aParams.array;
          const g = mesh.geometry;
          for (let i = 0; i < a.length; i += 4) {
            const dx = a[i] - pos.x, dy = a[i+1] + TREE_SIZE[kind] * a[i+3] * 0.5 - pos.y, dz = a[i+2] - pos.z;
            if (dx*dx + dy*dy + dz*dz >= NEAR_OUT*NEAR_OUT) continue;
            let j = g.instanceCount++;
            this.nearBounds.center.set(a[i], a[i+1] + TREE_SIZE[kind] * a[i+3] * 0.5, a[i+2]);
            this.nearBounds.radius = TREE_SIZE[kind] * a[i+3] * 0.85;
            if (!camera || this.nearFrustum.intersectsSphere(this.nearBounds)) {
              const front = mesh.userData.inView++;
              if (front < j) {
                g.attributes.aOffset.copyAt(j, g.attributes.aOffset, front);
                g.attributes.aParams.copyAt(j, g.attributes.aParams, front);
              }
              j = front;
            }
            g.attributes.aOffset.setXYZW(j, a[i], a[i+1], a[i+2], a[i+3]);
            g.attributes.aParams.setXYZW(j, p[i], p[i+1], p[i+2], p[i+3]);
          }
        }
      }
    }
    for (const mesh of Object.values(this.near)) {
      const g = mesh.geometry;
      if (!g.instanceCount) continue;
      mesh.visible = true;
      mesh.userData.total = g.instanceCount;
      for (const attr of [g.attributes.aOffset, g.attributes.aParams]) {
        attr.clearUpdateRanges(); attr.addUpdateRange(0, 4 * g.instanceCount); attr.needsUpdate = true;
      }
    }
  }
  // forest trees as octahedral impostors with baked light (true) or the older ring of 12 × 2 views (false)
  setOcta(on) {
    if (!this.oct) return false;
    this.octa = !!on;
    for (const k in this.oct) { const set = on ? this.oct[k] : this.ring[k]; this.impMats[k] = set.mats; this.impDepth[k] = set.depth; }
    for (const ch of this.chunks.values()) if (ch) ch.tier = -1;      // update() hands every chunk its material again
    if (this.onOcta) this.onOcta(this.octa);      // main.js switches the ground's canopy shade with it
    return this.octa;
  }
  _clearNear(x0, z0) { const cxm = x0 + CS / 2, czm = z0 + CS / 2; return this.sites.filter(s => Math.hypot(s.x - cxm, s.z - czm) < s.r + CS * 0.75); }
  _blocked(list, x, z) { for (const s of list) if ((x - s.x) * (x - s.x) + (z - s.z) * (z - s.z) < s.r * s.r) return true; return !!(this.paveAt && this.paveAt(x, z) > 0.3); }
  _generateSmall(cx, cz) {
    const f = this.field; const x0 = cx * CS, z0 = cz * CS; const G2 = 46, S2 = CS / G2;
    const u = [], up = [], r = [], rp = []; const clear = this._clearNear(x0, z0);
    const lat0 = mapLat(z0 + CS / 2); const snowy = 1 - smooth(0.15, 0.3, lat0);
    for (let gz = 0; gz < G2; gz++) for (let gx = 0; gx < G2; gx++) {
      const hx = cx * G2 + gx + 9000, hz = cz * G2 + gz + 9000;
      const x = x0 + (gx + hash2(hx, hz, 21)) * S2, z = z0 + (gz + hash2(hx, hz, 22)) * S2;
      if ((clear.length || this.paveAt) && this._blocked(clear, x, z)) continue;
      const h = f.heightAt(x, z); if (h < 1.4) continue;
      if (f.riverAt(x, z) > 0.3) continue;
      const sl = Math.hypot(f.heightAt(x + 4, z) - h, f.heightAt(x, z + 4) - h) / 4;
      const amp = f.ampAt(x, z), pick = hash2(hx, hz, 23);
      const pr = (0.003 + amp * 0.3 + smooth(0.3, 0.8, sl) * 0.5) * (1 - f.biomeAt(x, z, 2));
      const snow = Math.min(1, snowy * 1.2) * (0.6 + 0.4 * hash2(hx, hz, 24));
      if (pick < pr) {
        const sc = (0.5 + 2.2 * Math.pow(hash2(hx, hz, 25), 3)) * (1 + amp * 1.6);
        r.push(x, h - 0.3 * sc, z, sc); rp.push(hash2(hx, hz, 26) * 6.283, 2 + hash2(hx, hz, 27) * 0.99, snow, 0);
        continue;
      }
      if (sl > 0.8) continue;
      const forest = smooth(0.30, 0.45, f.forestAt(x, z) + (sampleDetailR(f.detail, x / 5200, z / 5200) - 0.5) * 0.7);
      const grove = smooth(0.36, 0.62, sampleDetailR(f.detail, x / 230 + 0.11, z / 230 + 0.57));
      const pb = (0.035 + 0.3 * forest + 0.3 * grove) * (1 - f.biomeAt(x, z, 2)) * (1 - f.biomeAt(x, z, 0) * 0.75) * (1 - snowy * 0.6);
      if (hash2(hx, hz, 28) < pb) { const sc = 0.6 + 1.3 * hash2(hx, hz, 29); u.push(x, h - 0.15, z, sc); up.push(hash2(hx, hz, 30) * 6.283, hash2(hx, hz, 31), snow, 0); }
    }
    return { u: new Float32Array(u), up: new Float32Array(up), r: new Float32Array(r), rp: new Float32Array(rp) };
  }
  _addSmall(ch) {
    ch.small = true;
    const data = this._generateSmall(ch.cx, ch.cz);
    const center = new THREE.Vector3(ch.cx * CS + CS / 2, this.field.baseHeight(ch.cx * CS + CS / 2, ch.cz * CS + CS / 2), ch.cz * CS + CS / 2);
    for (const type of ['u', 'r']) {
      const off = data[type], par = data[type + 'p']; const n = off.length / 4; if (!n) continue;
      const base = this.geo[type][0]; const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('position', base.attributes.position); g.setAttribute('normal', base.attributes.normal); g.setAttribute('color', base.attributes.color);
      g.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 4)); g.setAttribute('aParams', new THREE.InstancedBufferAttribute(par, 4));
      g.instanceCount = n; g.boundingSphere = new THREE.Sphere(center, CS * 0.75 + 60);
      const useImp = this.imp && type === 'u';
      const mesh = new THREE.Mesh(g, useImp ? this.impMats.u[0] : this.matSmall); mesh.customDepthMaterial = useImp ? this.impDepth.u : this.depthMat; mesh.castShadow = type === 'r';
      mesh.userData = { geos: [g, g], n, small: true, type };
      this.group.add(mesh); ch.meshes.push(mesh);
    }
  }
  _activate(key, cx, cz) {
    let data = this.cache.get(key);
    if (data === undefined) {
      data = this._generate(cx, cz); this.cache.set(key, data);
      if (this.cache.size > 2600) { const k = this.cache.keys().next().value; if (!this.chunks.has(k)) this.cache.delete(k); }
    }
    const ch = { meshes: [], tier: -1, cx, cz, small: false };
    this._canopyChunk(cx, cz, data);
    if (!data) { this.chunks.set(key, ch); return; }
    const center = new THREE.Vector3(cx * CS + CS / 2, this.field.baseHeight(cx * CS + CS / 2, cz * CS + CS / 2), cz * CS + CS / 2);
    for (const type of ['c', 'b', 'b2']) {
      const off = data[type], par = data[type + 'p']; const n = off ? off.length / 4 : 0; if (!n) continue;
      const aOff = new THREE.InstancedBufferAttribute(off, 4), aPar = new THREE.InstancedBufferAttribute(par, 4);
      const geos = this.geo[type].map((base) => {
        const g = new THREE.InstancedBufferGeometry();
        g.setAttribute('position', base.attributes.position); g.setAttribute('normal', base.attributes.normal); g.setAttribute('color', base.attributes.color);
        g.setAttribute('aOffset', aOff); g.setAttribute('aParams', aPar);
        g.instanceCount = n;
        g.boundingSphere = new THREE.Sphere(center, CS * 0.75 + 60);
        return g;
      });
      const mesh = new THREE.Mesh(geos[1], this.mats[1]);
      mesh.customDepthMaterial = this.depthMat; mesh.userData = { geos, n, type };
      this.group.add(mesh); ch.meshes.push(mesh); this.count += n;
    }
    this.chunks.set(key, ch);
  }
  _deactivate(key) {
    const ch = this.chunks.get(key); this.chunks.delete(key);
    if (!ch) return;
    for (const m of ch.meshes) { this.group.remove(m); if (!m.userData.small) this.count -= m.userData.n; m.userData.geos[0].dispose(); if (m.userData.geos[1] !== m.userData.geos[0]) m.userData.geos[1].dispose(); }
  }

  update(camPos, camera) {
    const ccx = Math.floor(camPos.x / CS), ccz = Math.floor(camPos.z / CS);
    const rad = Math.ceil(R_FAR / CS);
    const cellKey = ccx + ',' + ccz;
    if (cellKey !== this._lastCell) {
      this._lastCell = cellKey;
      // drop chunks out of range
      for (const [key, ch] of this.chunks) {
        const [kx, kz] = key.split(',').map(Number);
        if (Math.abs(kx - ccx) > rad + 1 || Math.abs(kz - ccz) > rad + 1) this._deactivate(key);
      }
      // queue new chunks, nearest first
      this._queue.length = 0;
      for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
        if (dx * dx + dz * dz > (rad + 0.5) * (rad + 0.5)) continue;
        const key = (ccx + dx) + ',' + (ccz + dz);
        if (!this.chunks.has(key)) this._queue.push([dx * dx + dz * dz, key, ccx + dx, ccz + dz]);
      }
      this._queue.sort((a, b) => b[0] - a[0]);
    }
    let budget = this.chunks.size < 40 ? 400 : 10;
    const t0 = performance.now();
    while (budget-- > 0 && this._queue.length && performance.now() - t0 < 5) { const q = this._queue.pop(); if (!this.chunks.has(q[1])) this._activate(q[1], q[2], q[3]); }
    // the canopy map is sent to the GPU whole, so not on every frame that forest streams in
    if (this._canopyDirty && (--this._canopyWait <= 0 || !this._queue.length)) { this.canopyTex.needsUpdate = true; this._canopyDirty = false; this._canopyWait = 8; }
    // tier selection
    for (const ch of this.chunks.values()) {
      if (!ch) continue;
      const dx = (ch.cx + 0.5) * CS - camPos.x, dz = (ch.cz + 0.5) * CS - camPos.z;
      const d = Math.hypot(dx, dz);
      const tier = d < R_HI ? 0 : d < R_MID ? 1 : 2;
      const order = Math.floor(d / CS); if (order !== ch.order) { ch.order = order; for (const m of ch.meshes) m.renderOrder = order; }
      if (tier === ch.tier) continue;
      ch.tier = tier;
      if (tier === 0 && !ch.small) this._addSmall(ch);
      for (const m of ch.meshes) {
        if (m.userData.small) { m.visible = tier === 0; continue; }
        if (this.imp) {
          const ms = this.impMats[m.userData.type];
          m.material = ms.length > 2 ? ms[tier] : ms[tier === 2 ? 1 : 0]; m.customDepthMaterial = this.impDepth[m.userData.type];
          m.geometry.instanceCount = tier === 2 ? Math.max(1, Math.ceil(m.userData.n * 0.36)) : m.userData.n; m.castShadow = tier === 0;
          continue;
        }
        m.geometry = m.userData.geos[tier === 0 ? 0 : 1]; m.material = this.mats[tier];
        m.geometry.instanceCount = tier === 2 ? Math.max(1, Math.ceil(m.userData.n * 0.3)) : m.userData.n;
        m.castShadow = tier === 0;
      }
    }
    this._updateNear(camPos, camera);
  }
}
