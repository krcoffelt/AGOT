// Raymarched volumetric cumulus layer, rendered at reduced resolution and depth-aware upsampled.
import * as THREE from 'three';
import { G, GLSL_ATMOS, GLSL_ATMOS_UNIFORMS, GLSL_WEATHER, fsQuad, fsMaterial } from '../core/glsl.js';

function hash3(ix, iy, iz, seed) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(iz, 2147483647) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function valueNoise3(x, y, z, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const w = (v) => ((v % period) + period) % period;
  const x0 = w(xi), x1 = w(xi + 1), y0 = w(yi), y1 = w(yi + 1), z0 = w(zi), z1 = w(zi + 1);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(hash3(x0, y0, z0, seed), hash3(x1, y0, z0, seed), ux), l(hash3(x0, y1, z0, seed), hash3(x1, y1, z0, seed), ux), uy),
    l(l(hash3(x0, y0, z1, seed), hash3(x1, y0, z1, seed), ux), l(hash3(x0, y1, z1, seed), hash3(x1, y1, z1, seed), ux), uy), uz);
}
function worley3(x, y, z, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let best = 9;
  const w = (v) => ((v % period) + period) % period;
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = xi + dx, cy = yi + dy, cz = zi + dz;
    const wx = w(cx), wy = w(cy), wz = w(cz);
    const px = cx + hash3(wx, wy, wz, seed), py = cy + hash3(wx, wy, wz, seed + 1), pz = cz + hash3(wx, wy, wz, seed + 2);
    const d = (px - x) * (px - x) + (py - y) * (py - y) + (pz - z) * (pz - z);
    if (d < best) best = d;
  }
  return 1 - Math.min(1, Math.sqrt(best));
}
function makeNoise3D(S = 64) {
  const data = new Uint8Array(S * S * S * 4);
  let o = 0;
  for (let z = 0; z < S; z++) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, w = z / S;
    const perlin = valueNoise3(u * 4, v * 4, w * 4, 4, 1) * 0.5 + valueNoise3(u * 8, v * 8, w * 8, 8, 2) * 0.3 + valueNoise3(u * 16, v * 16, w * 16, 16, 3) * 0.2;
    const w1 = worley3(u * 4, v * 4, w * 4, 4, 11), w2 = worley3(u * 8, v * 8, w * 8, 8, 21), w3 = worley3(u * 16, v * 16, w * 16, 16, 31);
    const wf = w1 * 0.625 + w2 * 0.25 + w3 * 0.125;
    // perlin-worley blend for billowy shapes
    const pw = Math.min(1, Math.max(0, perlin * 0.55 + wf * 0.62 - 0.06));
    const e = w2 * 0.6 + w3 * 0.4;
    data[o++] = Math.round(Math.min(1, pw * 0.92) * 255);
    data[o++] = Math.round(e * 255);
    data[o++] = Math.round(w1 * 255);
    data[o++] = 255;
  }
  const tex = new THREE.Data3DTexture(data, S, S, S);
  tex.format = THREE.RGBAFormat; tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping; tex.generateMipmaps = true; tex.needsUpdate = true;
  return tex;
}

const CLOUD_FRAG = /* glsl */`
precision highp float; precision highp sampler3D;
varying vec2 vUv;
uniform sampler2D uDepth; uniform sampler3D uNoise;
uniform mat4 uInvProj, uCamWorld;
uniform vec3 uCamPos; uniform float uNear, uFar, uTime, uSteps, uFrame;
uniform vec3 uSunDir, uSunColor, uAmbSky, uAmbGround;
${GLSL_ATMOS_UNIFORMS}
${GLSL_ATMOS}
${GLSL_WEATHER}
const float SIGMA = 0.014;
float hgp(float mu, float g){ float gg = g*g; return (1.0 - gg) / pow(1.0 + gg - 2.0*g*mu, 1.5); }
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float wnoise(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float gLod = 0.0;      // mip level for this ray's distance (set per step): far clouds read coarser noise instead of aliasing into streaks
float density(vec3 p, float cov, float detail, float baseOff){
  float hf = (p.y - uCloudParams.x - baseOff) / (uCloudParams.y - uCloudParams.x);
  if (hf <= 0.0 || hf >= 1.0) return 0.0;
  float topF = mix(0.42, 1.0, smoothstep(0.25, 0.9, cov));
  float hg = smoothstep(0.0, 0.09, hf) * (1.0 - smoothstep(topF * 0.45, topF, hf));
  vec3 q = (p + vec3(uWind.x, 0.0, uWind.y)) / 5600.0;
  float n = textureLod(uNoise, q, max(gLod - 2.3, 0.0)).r;
  float d = clamp((n * hg - (1.0 - cov) * 0.9) / (0.12 + cov * 0.4), 0.0, 1.0);
  if (detail > 0.0 && d > 0.0) {
    float e = textureLod(uNoise, q * 5.1 + vec3(0.0, uTime * 0.004, 0.0), gLod).g;
    d = clamp((d - e * 0.34 * (1.0 - 0.45 * hf) * detail) / (1.0 - 0.3 * detail), 0.0, 1.0);
  }
  return d;
}
void main(){
  vec4 v = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 rd = normalize(mat3(uCamWorld) * (v.xyz / v.w));
  vec3 ro = uCamPos;
  float depth = texture(uDepth, vUv).r;
  float viewZ = uNear * uFar / (uFar - depth * (uFar - uNear));
  vec3 fwd = -normalize(vec3(uCamWorld[2]));
  float sceneT = depth >= 0.99999 ? 1e9 : viewZ / max(dot(rd, fwd), 1e-3);
  float base = uCloudParams.x, top = uCloudParams.y;
  float ry = abs(rd.y) < 1e-4 ? 1e-4 : rd.y;
  float ta = (base - ro.y) / ry, tb = (top - ro.y) / ry;
  float t0 = max(min(ta, tb), 0.0), t1 = min(max(ta, tb), min(sceneT, 70000.0));
  if (t1 <= t0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float mu = dot(rd, uSunDir);
  float phase = mix(hgp(mu, 0.72), hgp(mu, -0.22), 0.38);
  phase = min(phase, 9.0);
  vec3 L = vec3(0.0); float T = 1.0; float tMean = 0.0, wSum = 0.0;
  // a different start offset each frame (golden-ratio sequence): the temporal pass below averages the grain away
  float jit = fract(ign(gl_FragCoord.xy) + wnoise(gl_FragCoord.xy) * 0.5 + uFrame * 0.618034);
  float t = t0 + jit * clamp(t0 * 0.013, 30.0, 650.0);
  int maxSteps = int(uSteps);
  for (int i = 0; i < 96; i++) {
    if (i >= maxSteps || t >= t1 || T < 0.025) break;
    vec3 p = ro + rd * t;
    float dt = clamp(t * 0.013, 30.0, 650.0) * (0.85 + 0.3 * fract(jit * 7.3 + float(i) * 0.618));
    float cov = cloudCoverage(p.xz);
    if (cov < 0.01) { t += dt * 2.2; continue; }
    float det = 1.0 - smoothstep(9000.0, 26000.0, t);
    gLod = clamp(log2(t / 1400.0), 0.0, 5.0);
    // ragged cloud bases: the underside rises and falls instead of forming a flat slab
    float baseOff = (textureLod(uWeather, (p.xz + uWind) / 7300.0 + 0.21, 0.0).g - 0.5) * 620.0;
    float d = density(p, cov, det, baseOff);
    if (d > 0.003) {
      float od = 0.0; float ls = 60.0 * (0.7 + 0.6 * jit); vec3 lp = p;
      for (int j = 0; j < 5; j++) { lp += uSunDir * ls; od += density(lp, cloudCoverage(lp.xz), 0.0, baseOff) * ls; ls *= 1.75; }
      float hf = clamp((p.y - base - baseOff) / (top - base), 0.0, 1.0);
      float beer = exp(-od * SIGMA * 0.85);
      float ms = exp(-od * SIGMA * 0.18) * 0.42;      // multiple-scatter approximation
      float powder = 1.0 - exp(-d * 9.0 - od * SIGMA * 0.6);
      vec3 sunL = uSunColor * (beer * phase + ms) * mix(0.55, 1.0, powder) * 0.92;
      vec3 amb = mix(uAmbGround * 0.2 + uAmbSky * 0.5, uAmbSky * 1.25, hf) * (0.55 + 0.45 * exp(-d * 3.0));
      float ext = d * SIGMA;
      vec3 S = (sunL + amb) * ext;
      float Tr = exp(-ext * dt);
      L += T * (S - S * Tr) / max(ext, 1e-6);
      float wgt = T * (1.0 - Tr); tMean += t * wgt; wSum += wgt;
      T *= Tr;
    }
    t += dt;
  }
  if (wSum > 1e-4) {
    float dm = tMean / wSum;
    float od = fogOpticalDepth(ro, rd, dm) * 0.8;
    vec3 ext = exp(-od * vec3(0.82, 1.0, 1.30));
    vec3 fogCol = skyLUT(normalize(vec3(rd.x, max(rd.y, 0.0) * 0.6 + 0.03, rd.z)));
    float fl = dot(fogCol, vec3(0.2126, 0.7152, 0.0722));
    fogCol *= (1.0 + fl * 0.12) / (1.0 + fl * 0.75);
    float a = 1.0 - T;
    L = L * ext + fogCol * a * (1.0 - ext);
  }
  if (T < 0.025) T = 0.0;
  gl_FragColor = vec4(L, T);
}`;

// Temporal accumulation: the new (grainy) frame is blended into the history, reprojected to where the cloud layer sat last
// frame and clamped to the new frame's neighbourhood so nothing ghosts.
const TAA_FRAG = /* glsl */`
precision highp float; varying vec2 vUv;
uniform sampler2D uCur, uHist; uniform mat4 uInvProj, uCamWorld, uPrevVP; uniform vec3 uCamPos; uniform vec2 uLowSize; uniform float uReset;
uniform vec4 uCloudParams;
void main(){
  vec4 cur = texture(uCur, vUv); vec2 px = 1.0 / uLowSize;
  vec4 m1 = vec4(0.0), m2 = vec4(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { vec4 s = texture(uCur, vUv + vec2(float(i), float(j)) * px); m1 += s; m2 += s * s; }
  m1 /= 9.0; vec4 sd = sqrt(max(m2 / 9.0 - m1 * m1, 0.0));
  vec4 v = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0); vec3 rd = normalize(mat3(uCamWorld) * (v.xyz / v.w));
  float mid = (uCloudParams.x + uCloudParams.y) * 0.5, ry = abs(rd.y) < 1e-4 ? 1e-4 : rd.y;
  float t = (mid - uCamPos.y) / ry; if (t < 0.0) t = 20000.0; t = min(t, 60000.0);
  vec4 cp = uPrevVP * vec4(uCamPos + rd * t, 1.0); vec2 puv = cp.xy / cp.w * 0.5 + 0.5;
  if (uReset > 0.5 || cp.w <= 0.0 || puv.x < 0.0 || puv.y < 0.0 || puv.x > 1.0 || puv.y > 1.0) { gl_FragColor = cur; return; }
  vec4 h = clamp(texture(uHist, puv), m1 - sd * 1.25, m1 + sd * 1.25);
  gl_FragColor = mix(h, cur, 0.12);
}`;

const COMP_FRAG = /* glsl */`
precision highp float; varying vec2 vUv;
uniform sampler2D uScene, uCloud, uDepth;
uniform vec2 uLowSize; uniform float uNear, uFar;
float lin(float d){ return uNear * uFar / (uFar - d * (uFar - uNear)); }
void main(){
  vec3 scene = texture(uScene, vUv).rgb;
  float z = lin(texture(uDepth, vUv).r);
  vec2 lp = vUv * uLowSize - 0.5; vec2 b = floor(lp); vec2 f = lp - b;
  vec4 acc = vec4(0.0); float ws = 0.0;
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
    vec2 c = clamp(b + vec2(float(i), float(j)), vec2(0.0), uLowSize - 1.0);
    float zc = lin(texture(uDepth, (c + 0.5) / uLowSize).r);
    float bw = (i == 1 ? f.x : 1.0 - f.x) * (j == 1 ? f.y : 1.0 - f.y);
    float w = (bw + 0.002) / (0.002 + abs(zc - z) / z);
    acc += texelFetch(uCloud, ivec2(c), 0) * w; ws += w;
  }
  vec4 cl = acc / ws;
  // gentle depth-aware blur to hide ray-march grain
  vec4 bl = cl * 2.0; float bw2 = 2.0; vec2 cc = floor(lp + 0.5);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    if (i == 0 && j == 0) continue;
    vec2 c = clamp(cc + vec2(float(i), float(j)), vec2(0.0), uLowSize - 1.0);
    float zc = lin(texture(uDepth, (c + 0.5) / uLowSize).r);
    float w = 1.0 / (1.0 + 400.0 * abs(zc - z) / z);
    bl += texelFetch(uCloud, ivec2(c), 0) * w; bw2 += w;
  }
  cl = bl / bw2;
  gl_FragColor = vec4(scene * cl.a + cl.rgb, 1.0);
}`;

export class Clouds {
  constructor(renderer) {
    this.renderer = renderer; this.enabled = true; this.resScale = 0.5;
    this.noise = makeNoise3D(64);
    this.mat = fsMaterial(CLOUD_FRAG, {
      uDepth: { value: null }, uNoise: { value: this.noise },
      uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
      uNear: { value: 1 }, uFar: { value: 1000 }, uTime: G.uTime, uSteps: { value: 84 },
      uSunDir: G.uSunDir, uSunColor: G.uSunColor, uAmbSky: G.uAmbSky, uAmbGround: G.uAmbGround,
      uSkyLUT: G.uSkyLUT, uTrueSunDir: G.uTrueSunDir, uFogParams: G.uFogParams,
      uWeather: G.uWeather, uCloudParams: G.uCloudParams, uWind: G.uWind, uFrame: { value: 0 },
    });
    this.taa = fsMaterial(TAA_FRAG, {
      uCur: { value: null }, uHist: { value: null }, uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uPrevVP: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() }, uLowSize: { value: new THREE.Vector2() }, uReset: { value: 1 },
      uCloudParams: G.uCloudParams,
    });
    this.frame = 0; this.prevVP = new THREE.Matrix4(); this.hist = [];
    this.comp = fsMaterial(COMP_FRAG, {
      uScene: { value: null }, uCloud: { value: null }, uDepth: { value: null },
      uLowSize: { value: new THREE.Vector2() }, uNear: { value: 1 }, uFar: { value: 1000 },
    });
    this.rt = null;
  }
  setSize(w, h) {
    if (this.rt) { this.rt.dispose(); this.hist.forEach(h => h.dispose()); }
    const lw = Math.max(4, Math.round(w * this.resScale)), lh = Math.max(4, Math.round(h * this.resScale));
    const mk = () => new THREE.WebGLRenderTarget(lw, lh, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.rt = mk(); this.hist = [mk(), mk()]; this.taa.uniforms.uReset.value = 1;
    this.comp.uniforms.uLowSize.value.set(lw, lh); this.taa.uniforms.uLowSize.value.set(lw, lh);
  }
  render(rtScene, camera, target) {
    const u = this.mat.uniforms;
    u.uDepth.value = rtScene.depthTexture;
    u.uInvProj.value.copy(camera.projectionMatrixInverse); u.uCamWorld.value.copy(camera.matrixWorld);
    u.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
    u.uNear.value = camera.near; u.uFar.value = camera.far;
    u.uFrame.value = this.frame % 64;
    fsQuad.render(this.renderer, this.mat, this.rt);
    // blend into the history (ping-pong), then composite the history
    const tu = this.taa.uniforms, [hPrev, hNext] = this.frame % 2 ? [this.hist[1], this.hist[0]] : [this.hist[0], this.hist[1]];
    tu.uCur.value = this.rt.texture; tu.uHist.value = hPrev.texture; tu.uInvProj.value.copy(camera.projectionMatrixInverse); tu.uCamWorld.value.copy(camera.matrixWorld);
    tu.uCamPos.value.copy(u.uCamPos.value); tu.uPrevVP.value.copy(this.prevVP);
    fsQuad.render(this.renderer, this.taa, hNext); tu.uReset.value = 0;
    this.prevVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); this.frame++;
    const c = this.comp.uniforms;
    c.uScene.value = rtScene.texture; c.uCloud.value = hNext.texture; c.uDepth.value = rtScene.depthTexture;
    c.uNear.value = camera.near; c.uFar.value = camera.far;
    fsQuad.render(this.renderer, this.comp, target);
  }
}
