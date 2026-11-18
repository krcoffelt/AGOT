// HDR render pipeline: scene (MSAA, depth) → volumetric clouds → bloom → grade / tone map.
import * as THREE from 'three';
import { fsQuad, fsMaterial } from '../core/glsl.js';

const DOWN_FRAG = /* glsl */`
precision highp float; varying vec2 vUv; uniform sampler2D uSrc; uniform vec2 uTexel; uniform float uKaris;
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 kar(vec3 a, vec3 b, vec3 c, vec3 d){
  if (uKaris < 0.5) return (a + b + c + d) * 0.25;
  float wa = 1.0/(1.0+luma(a)), wb = 1.0/(1.0+luma(b)), wc = 1.0/(1.0+luma(c)), wd = 1.0/(1.0+luma(d));
  return (a*wa + b*wb + c*wc + d*wd) / (wa + wb + wc + wd);
}
void main(){
  vec2 t = uTexel;
  vec3 A = texture(uSrc, vUv + t*vec2(-2,-2)).rgb, B = texture(uSrc, vUv + t*vec2(0,-2)).rgb, C = texture(uSrc, vUv + t*vec2(2,-2)).rgb;
  vec3 D = texture(uSrc, vUv + t*vec2(-2,0)).rgb, E = texture(uSrc, vUv).rgb, F = texture(uSrc, vUv + t*vec2(2,0)).rgb;
  vec3 Gg = texture(uSrc, vUv + t*vec2(-2,2)).rgb, Hh = texture(uSrc, vUv + t*vec2(0,2)).rgb, I = texture(uSrc, vUv + t*vec2(2,2)).rgb;
  vec3 J = texture(uSrc, vUv + t*vec2(-1,-1)).rgb, K = texture(uSrc, vUv + t*vec2(1,-1)).rgb, L = texture(uSrc, vUv + t*vec2(-1,1)).rgb, M = texture(uSrc, vUv + t*vec2(1,1)).rgb;
  vec3 c = kar(J, K, L, M) * 0.5 + kar(A, B, D, E) * 0.125 + kar(B, C, E, F) * 0.125 + kar(D, E, Gg, Hh) * 0.125 + kar(E, F, Hh, I) * 0.125;
  gl_FragColor = vec4(min(c, vec3(60.0)), 1.0);
}`;
const UP_FRAG = /* glsl */`
precision highp float; varying vec2 vUv; uniform sampler2D uSrc; uniform vec2 uTexel;
void main(){
  vec2 t = uTexel;
  vec3 c = texture(uSrc, vUv).rgb * 4.0;
  c += (texture(uSrc, vUv + vec2(t.x, 0)).rgb + texture(uSrc, vUv - vec2(t.x, 0)).rgb + texture(uSrc, vUv + vec2(0, t.y)).rgb + texture(uSrc, vUv - vec2(0, t.y)).rgb) * 2.0;
  c += texture(uSrc, vUv + t).rgb + texture(uSrc, vUv - t).rgb + texture(uSrc, vUv + vec2(t.x, -t.y)).rgb + texture(uSrc, vUv + vec2(-t.x, t.y)).rgb;
  gl_FragColor = vec4(c / 16.0, 1.0);
}`;
// Ambient occlusion, at half resolution from the scene's depth alone: the shade that gathers where surfaces meet (under
// eaves, down alleys, where walls meet the street, between a dragon's scales). Twelve samples in the hemisphere over each
// point, a radius that grows with distance (a crease at 20 m, a street at 400 m), faded out beyond ~1.5 km where depth gets
// coarse. g carries the view distance for the depth-aware blur that follows.
const AO_FRAG = /* glsl */`
precision highp float; varying vec2 vUv;
uniform highp sampler2D uDepth; uniform sampler2D uScene; uniform mat4 uProj, uInvProj; uniform vec2 uTexel; uniform float uRadius, uStrength;
vec3 vpos(vec2 uv){ float d = texture(uDepth, uv).r; vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return v.xyz / v.w; }
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main(){
  if (texture(uDepth, vUv).r >= 0.9999999) { gl_FragColor = vec4(1.0, 1e5, 0.0, 1.0); return; }
  vec3 P = vpos(vUv); float dist = -P.z;
  // The near foliage already carries sky visibility from the full crown.
  // Real depth between its leaves would otherwise count this occlusion twice.
  if (dist < 140.0 && texture(uScene, vUv).a > 1.4) { gl_FragColor = vec4(1.0, dist, 0.0, 1.0); return; }
  // the surface normal from the flatter neighbour on each axis, so it never smears across a silhouette
  vec3 l = vpos(vUv - vec2(uTexel.x, 0.0)), r = vpos(vUv + vec2(uTexel.x, 0.0)), b = vpos(vUv - vec2(0.0, uTexel.y)), t = vpos(vUv + vec2(0.0, uTexel.y));
  vec3 dx = abs(r.z - P.z) < abs(P.z - l.z) ? r - P : P - l, dy = abs(t.z - P.z) < abs(P.z - b.z) ? t - P : P - b;
  vec3 N = normalize(cross(dx, dy));
  float R = clamp(dist * 0.011, 0.8, 7.0) * uRadius;
  vec3 T = normalize(cross(N, abs(N.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0))), B = cross(N, T);
  float a0 = hash(gl_FragCoord.xy) * 6.2832, j = hash(gl_FragCoord.yx + 7.3), occ = 0.0;
  for (int i = 0; i < 12; i++) {
    float fi = float(i), ang = a0 + fi * 2.39996, u = (fi + j) / 12.0;
    vec3 s = normalize(T * cos(ang) + B * sin(ang) + N * (0.2 + 1.3 * fract(fi * 0.618 + j))) * R * mix(0.12, 1.0, u * u);
    vec3 S = P + s; vec4 c = uProj * vec4(S, 1.0); vec2 suv = c.xy / c.w * 0.5 + 0.5;
    if (suv.x < 0.0 || suv.y < 0.0 || suv.x > 1.0 || suv.y > 1.0) continue;
    float sz = vpos(suv).z;
    occ += step(S.z + 0.02 * R, sz) * smoothstep(0.0, 1.0, R / max(abs(P.z - sz), 1e-3));
  }
  float ao = 1.0 - occ / 12.0 * uStrength;
  ao = mix(ao, 1.0, smoothstep(700.0, 1800.0, dist));
  gl_FragColor = vec4(clamp(ao, 0.0, 1.0), dist, 0.0, 1.0);
}`;
const AO_BLUR_FRAG = /* glsl */`
precision highp float; varying vec2 vUv; uniform sampler2D uSrc; uniform vec2 uStep;
void main(){
  vec2 c0 = texture(uSrc, vUv).rg; float sum = c0.r, wsum = 1.0;
  for (int i = -4; i <= 4; i++) {
    if (i == 0) continue;
    vec2 c = texture(uSrc, vUv + uStep * float(i)).rg;
    float w = exp(-float(i * i) / 10.0) * exp(-abs(c.g - c0.g) / (0.02 * c0.g + 0.4));      // don't blur across a change in depth
    sum += c.r * w; wsum += w;
  }
  gl_FragColor = vec4(sum / wsum, c0.g, 0.0, 1.0);
}`;
const FINAL_FRAG = /* glsl */`
precision highp float; varying vec2 vUv;
uniform sampler2D uScene, uBloom, uAO;
uniform float uExposure, uBloomStrength, uTime, uVignette, uSaturation, uFade;
uniform vec2 uSunScreen; uniform float uSunVis; uniform vec3 uSunTint;
uniform vec2 uTexel; uniform float uSharpen, uShaftThr, uSpeed, uGrade;
vec3 RRTAndODTFit(vec3 v){ vec3 a = v*(v + 0.0245786) - 0.000090537; vec3 b = v*(0.983729*v + 0.4329510) + 0.238081; return a/b; }
vec3 aces(vec3 color){
  const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color = I * color; color = RRTAndODTFit(color); color = O * color; return clamp(color, 0.0, 1.0);
}
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main(){
  vec2 uv = vUv;
  vec2 qc = uv - 0.5; float r2 = dot(qc, qc);
  vec3 col = texture(uScene, uv).rgb;
  // speed: the edges of the frame streak past, the centre stays sharp
  if (uSpeed > 0.01) {
    vec2 dirv = qc * uSpeed * 0.07 * smoothstep(0.05, 0.5, r2);
    vec3 acc = col; float jt = hash(gl_FragCoord.xy + 3.7);
    for (int i = 1; i <= 7; i++) acc += texture(uScene, uv - dirv * (float(i) - jt) / 7.0).rgb;
    col = acc / 8.0;
  }
  // lens: a trace of colour fringing toward the corners
  {
    vec2 ca = qc * r2 * 0.0028;
    col.r = mix(col.r, texture(uScene, uv - ca).r, 0.7); col.b = mix(col.b, texture(uScene, uv + ca).b, 0.7);
  }
  // gentle sharpening (damped on very bright pixels so sun glitter does not ring)
  vec3 nb = (texture(uScene, uv + vec2(uTexel.x, 0.0)).rgb + texture(uScene, uv - vec2(uTexel.x, 0.0)).rgb
           + texture(uScene, uv + vec2(0.0, uTexel.y)).rgb + texture(uScene, uv - vec2(0.0, uTexel.y)).rgb) * 0.25;
  col = max(col + (col - nb) * uSharpen / (1.0 + 0.6 * max(col.r, max(col.g, col.b))), 0.0);
  // contact shade, after the steps above that re-read the scene (else they put the colour back unshaded and fringe it).
  // Spared on bright light sources: fire, lit windows, the sun's glint.
  { float ao = texture(uAO, uv).r, lum = dot(col, vec3(0.2126, 0.7152, 0.0722)); col *= mix(ao, 1.0, smoothstep(6.0, 18.0, lum)); }
  vec3 bloom = texture(uBloom, uv).rgb / 6.0;
  col = mix(col, bloom, uBloomStrength);
  // crepuscular rays: bright sky near the sun smeared radially past whatever blocks it
  if (uSunVis > 0.001) {
    vec2 dv = uSunScreen - uv;
    float dl = length(dv * vec2(1.78, 1.0));
    vec2 stp = dv / 26.0 * min(1.0, 0.85 / max(dl, 0.001));
    vec2 sp = uv + stp * hash(gl_FragCoord.xy);
    float acc = 0.0, wgt = 1.0;
    for (int i = 0; i < 26; i++) {
      sp += stp;
      vec3 sm = texture(uBloom, clamp(sp, 0.0, 1.0)).rgb / 6.0;
      vec2 sd = (sp - uSunScreen) * vec2(1.78, 1.0);
      float inb = step(0.0, sp.x) * step(sp.x, 1.0) * step(0.0, sp.y) * step(sp.y, 1.0);      // never smear the screen border
      acc += max(dot(sm, vec3(0.2126, 0.7152, 0.0722)) - uShaftThr, 0.0) * exp(-dot(sd, sd) * 22.0) * wgt * inb; wgt *= 0.95;
    }
    float cap = uShaftThr * 14.0;
    col += uSunTint * cap * (1.0 - exp(-acc / cap)) * uSunVis * 0.045 * exp(-dl * dl * 1.1);      // soft shoulder, fading with distance from the sun
  }
  // soft anamorphic sun veil
  if (uSunVis > 0.001) {
    vec2 d = uv - uSunScreen; d.x *= 1.6;
    col += uSunTint * uSunVis * uShaftThr * (0.05 * exp(-dot(d, d) * 9.0) + 0.02 * exp(-abs(d.y) * 26.0) * exp(-abs(d.x) * 2.2));
  }
  col *= uExposure;
  col = aces(col / 0.6);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSaturation);
  // film grade: cool teal shadows, warm amber highlights, a firmer S-curve
  float lg = dot(col, vec3(0.2126, 0.7152, 0.0722));
  vec3 tone = mix(vec3(0.90, 1.0, 1.10), vec3(1.07, 1.0, 0.90), smoothstep(0.05, 0.75, lg));
  col *= mix(vec3(1.0), tone, uGrade);
  col = mix(col, col * col * (3.0 - 2.0 * col), 0.34);
  vec2 q = uv - 0.5; float vig = 1.0 - dot(q, q) * uVignette;
  col *= vig;
  col = pow(max(col, 0.0), vec3(1.0 / 2.2));
  col += (hash(gl_FragCoord.xy + fract(uTime) * 91.7) - 0.5) / 255.0 * 1.5;
  col *= uFade;
  gl_FragColor = vec4(col, 1.0);
}`;

export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    this.scale = 1;
    this.downMat = fsMaterial(DOWN_FRAG, { uSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uKaris: { value: 0 } });
    this.upMat = fsMaterial(UP_FRAG, { uSrc: { value: null }, uTexel: { value: new THREE.Vector2() } }, { blending: THREE.AdditiveBlending, transparent: true });
    this.finalMat = fsMaterial(FINAL_FRAG, {
      uScene: { value: null }, uBloom: { value: null }, uAO: { value: null }, uExposure: { value: 0.36 }, uBloomStrength: { value: 0.105 },
      uTime: { value: 0 }, uVignette: { value: 0.72 }, uSaturation: { value: 1.08 }, uFade: { value: 1 },
      uSunScreen: { value: new THREE.Vector2(0.5, 0.5) }, uSunVis: { value: 0 }, uSunTint: { value: new THREE.Color(1, 0.8, 0.6) },
      uTexel: { value: new THREE.Vector2() }, uSharpen: { value: 0.45 }, uShaftThr: { value: 2.0 }, uSpeed: { value: 0 }, uGrade: { value: 0.85 },
    });
    this.aoMat = fsMaterial(AO_FRAG, { uScene: { value: null }, uDepth: { value: null }, uProj: { value: new THREE.Matrix4() }, uInvProj: { value: new THREE.Matrix4() }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1.6 }, uStrength: { value: 2.0 } });
    this.aoBlurMat = fsMaterial(AO_BLUR_FRAG, { uSrc: { value: null }, uStep: { value: new THREE.Vector2() } });
    this.aoOn = true;
    this.clouds = null;     // set by main when the cloud pass exists
    this.mips = [];
    this.w = 0; this.h = 0;
  }
  setSize(w, h) {
    w = Math.max(8, Math.floor(w)); h = Math.max(8, Math.floor(h));
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    if (this.rtScene) { this.rtScene.dispose(); this.rtComp.dispose(); this.mips.forEach(m => m.dispose()); this.rtAO.forEach(m => m.dispose()); }
    const aw = Math.max(4, w >> 1), ah = Math.max(4, h >> 1);
    this.rtAO = [0, 1].map(() => new THREE.WebGLRenderTarget(aw, ah, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }));
    const depthTexture = new THREE.DepthTexture(w, h);
    depthTexture.type = THREE.UnsignedIntType;
    this.rtScene = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, samples: 4, depthTexture, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.rtComp = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.mips = [];
    let mw = w, mh = h;
    for (let i = 0; i < 6; i++) {
      mw = Math.max(2, mw >> 1); mh = Math.max(2, mh >> 1);
      this.mips.push(new THREE.WebGLRenderTarget(mw, mh, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }));
    }
    if (this.clouds) this.clouds.setSize(w, h);
  }
  render(scene, camera, time) {
    const r = this.renderer;
    r.setRenderTarget(this.rtScene);
    r.clear();
    r.render(scene, camera);
    let src = this.rtScene;
    // ambient occlusion from the scene's depth, before the clouds are laid over it
    const [ao0, ao1] = this.rtAO, au = this.aoMat.uniforms, bu = this.aoBlurMat.uniforms;
    if (this.aoOn) {
      au.uScene.value = this.rtScene.texture; au.uDepth.value = this.rtScene.depthTexture; au.uProj.value.copy(camera.projectionMatrix); au.uInvProj.value.copy(camera.projectionMatrixInverse);
      au.uTexel.value.set(1 / ao0.width, 1 / ao0.height);
      fsQuad.render(r, this.aoMat, ao0);
      bu.uSrc.value = ao0.texture; bu.uStep.value.set(1 / ao0.width, 0); fsQuad.render(r, this.aoBlurMat, ao1);
      bu.uSrc.value = ao1.texture; bu.uStep.value.set(0, 1 / ao0.height); fsQuad.render(r, this.aoBlurMat, ao0);
    }
    this.finalMat.uniforms.uAO.value = this.aoOn ? ao0.texture : (this.noAO ||= Object.assign(new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1), { needsUpdate: true }));
    if (this.clouds && this.clouds.enabled) {
      this.clouds.render(this.rtScene, camera, this.rtComp);
      src = this.rtComp;
    }
    // bloom chain
    const autoClear = r.autoClear;
    let prev = src;
    for (let i = 0; i < this.mips.length; i++) {
      const m = this.mips[i];
      this.downMat.uniforms.uSrc.value = prev.texture;
      this.downMat.uniforms.uTexel.value.set(1 / prev.width, 1 / prev.height);
      this.downMat.uniforms.uKaris.value = i === 0 ? 1 : 0;
      fsQuad.render(r, this.downMat, m);
      prev = m;
    }
    r.autoClear = false;
    for (let i = this.mips.length - 1; i > 0; i--) {
      const from = this.mips[i], to = this.mips[i - 1];
      this.upMat.uniforms.uSrc.value = from.texture;
      this.upMat.uniforms.uTexel.value.set(1 / from.width, 1 / from.height);
      fsQuad.render(r, this.upMat, to);
    }
    r.autoClear = autoClear;
    const f = this.finalMat.uniforms;
    f.uScene.value = src.texture; f.uBloom.value = this.mips[0].texture; f.uTime.value = time; f.uTexel.value.set(1 / this.w, 1 / this.h);
    // the additive up-chain sums 6 levels: normalise
    fsQuad.render(r, this.finalMat, null);
  }
}
