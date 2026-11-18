// Atmosphere: scattering LUT, sky dome, sun / moon lighting, time of day.
import * as THREE from 'three';
import { G, GLSL_ATMOS, GLSL_ATMOS_UNIFORMS, fsQuad, fsMaterial } from '../core/glsl.js';
import { tileFbm } from '../core/noise.js';

const LUT_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform vec3 uSun;
uniform float uSkyScale, uBayHaze;
#define PI 3.141592653589793
#define iSteps 16
#define jSteps 6
vec2 rsi(vec3 r0, vec3 rd, float sr){
  float a = dot(rd, rd), b = 2.0*dot(rd, r0), c = dot(r0, r0) - sr*sr; float d = b*b - 4.0*a*c;
  if (d < 0.0) return vec2(1e5, -1e5);
  return vec2((-b - sqrt(d))/(2.0*a), (-b + sqrt(d))/(2.0*a));
}
vec3 atmosphere(vec3 r, vec3 r0, vec3 pSun, float iSun, float rPlanet, float rAtmos, vec3 kRlh, float kMie, float shRlh, float shMie, float g){
  vec2 p = rsi(r0, r, rAtmos); if (p.x > p.y) return vec3(0.0);
  p.y = min(p.y, rsi(r0, r, rPlanet).x);
  float iStepSize = (p.y - p.x) / float(iSteps); float iTime = 0.0;
  vec3 totalRlh = vec3(0.0), totalMie = vec3(0.0); float iOdRlh = 0.0, iOdMie = 0.0;
  float mu = dot(r, pSun); float mumu = mu*mu; float gg = g*g;
  float pRlh = 3.0/(16.0*PI)*(1.0+mumu);
  float pMie = 3.0/(8.0*PI)*((1.0-gg)*(mumu+1.0))/(pow(1.0+gg-2.0*mu*g, 1.5)*(2.0+gg));
  for (int i = 0; i < iSteps; i++) {
    vec3 iPos = r0 + r*(iTime + iStepSize*0.5); float iHeight = length(iPos) - rPlanet;
    float odStepRlh = exp(-iHeight/shRlh)*iStepSize, odStepMie = exp(-iHeight/shMie)*iStepSize;
    iOdRlh += odStepRlh; iOdMie += odStepMie;
    float jStepSize = rsi(iPos, pSun, rAtmos).y / float(jSteps); float jTime = 0.0, jOdRlh = 0.0, jOdMie = 0.0;
    for (int j = 0; j < jSteps; j++) {
      vec3 jPos = iPos + pSun*(jTime + jStepSize*0.5); float jHeight = length(jPos) - rPlanet;
      jOdRlh += exp(-jHeight/shRlh)*jStepSize; jOdMie += exp(-jHeight/shMie)*jStepSize; jTime += jStepSize;
    }
    vec3 attn = exp(-(kMie*(iOdMie+jOdMie) + kRlh*(iOdRlh+jOdRlh)));
    totalRlh += odStepRlh*attn; totalMie += odStepMie*attn; iTime += iStepSize;
  }
  return iSun*(pRlh*kRlh*totalRlh + pMie*kMie*totalMie);
}
float mu0(vec3 a, vec3 b){ return dot(a, normalize(b)); }
void main(){
  float u = (gl_FragCoord.x - 0.5) / 255.0, v = (gl_FragCoord.y - 0.5) / 127.0;
  float phi = u * PI; float e = 0.045 + v*v * (PI * 0.5 - 0.045);
  vec2 s = normalize(uSun.xz + vec2(1e-5, 0.0)); vec2 pp = vec2(-s.y, s.x);
  vec2 hz = cos(phi)*s + sin(phi)*pp;
  vec3 dir = normalize(vec3(hz.x*cos(e), sin(e), hz.y*cos(e)));
  vec3 col = atmosphere(dir, vec3(0.0, 6371e3 + 400.0, 0.0), normalize(uSun), 22.0, 6371e3, 6471e3,
    vec3(5.8e-6, 13.5e-6, 30.0e-6), 14e-6, 8e3, 1.2e3, 0.76);
  // the single-scatter model ignores the planet's shadow: fade deep twilight manually
  // approximate multiple scattering: the day-time horizon is a bright blue-white haze, not a brown band
  float hz2 = exp(-e * 9.0) * smoothstep(0.02, 0.4, uSun.y) * (1.0 - 0.6 * pow(max(mu0(dir, uSun), 0.0), 6.0));
  float lm = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, lm * vec3(0.80, 0.95, 1.20) * 1.25, hz2 * 0.85);
  float tw = smoothstep(-0.30, -0.02, uSun.y);
  col *= uSkyScale * tw * tw;
  // Sunlit marine haze contributes diffuse skylight above Blackwater Bay.
  float veil=uBayHaze*exp(-1.5*e);
  vec3 mist=mix(vec3(1.95,1.30,.77),vec3(1.76,2.48,3.28),smoothstep(.06,.27,uSun.y));
  col=mix(col,mist,veil*.76);
  // night sky floor (airglow + moonlit haze)
  float night = 1.0 - smoothstep(-0.18, 0.02, uSun.y);
  col += night * mix(vec3(0.010, 0.016, 0.034), vec3(0.004, 0.007, 0.018), sqrt(clamp(dir.y, 0.0, 1.0)));
  gl_FragColor = vec4(col, 1.0);
}`;

const DOME_VERT = /* glsl */`
varying vec3 vDir;
void main(){
  gl_Position = vec4(position.xy, 1.0, 1.0);
  vec4 v = inverse(projectionMatrix) * vec4(position.xy, 1.0, 1.0);
  vDir = transpose(mat3(viewMatrix)) * (v.xyz / v.w);
}`;
const DOME_FRAG = /* glsl */`
precision highp float;
varying vec3 vDir;
${GLSL_ATMOS_UNIFORMS}
uniform vec3 uMoonDir, uSunDisc, uGroundCol, uAmbSkyC;
uniform float uNight, uTime, uGroundMix;
uniform vec2 uWind;
${GLSL_ATMOS}
float h13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
void main(){
  vec3 dir = normalize(vDir);
  vec3 col = skyLUT(dir);
  if (dir.y < 0.0) col *= mix(1.0, 0.55, smoothstep(0.0, -0.5, dir.y));
  if (dir.y < 0.0) col = mix(col, uGroundCol, uGroundMix * smoothstep(0.0, -0.12, dir.y));
  float mu = dot(dir, uTrueSunDir);
  float horizon = smoothstep(-0.015, 0.01, dir.y);
  // high cirrus: thin, wind-combed ice cloud far above the cumulus layer
  if (dir.y > 0.012) {
    vec2 cp = dir.xz / (dir.y + 0.1);
    vec2 q = cp * 0.06 + uWind * 0.0000012;
    float streak = texture(uWeather, vec2(q.x * 0.35 + q.y * 0.1, q.y * 1.6)).g;
    float field = texture(uWeather, q * 0.42 + 0.3).r;
    float ci = smoothstep(0.5, 0.82, streak * 0.75 + field * 0.5) * smoothstep(0.32, 0.7, field) * smoothstep(0.012, 0.22, dir.y);
    vec3 lit = uSunDisc * 1.5 * (1.0 + 3.0 * pow(max(mu, 0.0), 8.0)) + uAmbSkyC * 0.9;
    col = mix(col, lit, ci * 0.42);
  }
  float disc = smoothstep(0.99992, 0.99996, mu);
  col += uSunDisc * horizon * (disc * 90.0 + pow(max(mu, 0.0), 1500.0) * 5.0 + pow(max(mu, 0.0), 120.0) * 0.28);
  if (uNight > 0.01) {
    // stars
    vec3 p = dir * 260.0; vec3 ip = floor(p); vec3 fp = fract(p) - 0.5;
    float hsh = h13(ip);
    float st = step(0.9935, hsh) * smoothstep(0.32, 0.0, length(fp));
    float tw = 0.75 + 0.25 * sin(uTime * (2.0 + hsh * 5.0) + hsh * 80.0);
    vec3 tint = mix(vec3(1.0, 0.82, 0.65), vec3(0.7, 0.82, 1.0), fract(hsh * 311.7));
    col += tint * st * tw * 2.4 * uNight * smoothstep(0.0, 0.18, dir.y);
    // milky band
    float band = exp(-pow(dot(dir, normalize(vec3(0.35, 0.5, -0.8))) * 3.2, 2.0));
    col += vec3(0.014, 0.017, 0.028) * band * uNight * smoothstep(0.0, 0.3, dir.y);
    // moon
    float mm = dot(dir, uMoonDir);
    float md = smoothstep(0.99975, 0.99985, mm);
    vec3 mp = dir * 400.0;
    float crater = 0.75 + 0.25 * h13(floor(mp * 0.35));
    col += vec3(0.86, 0.9, 1.0) * (md * 2.6 * crater + pow(max(mm, 0.0), 700.0) * 0.5 + pow(max(mm, 0.0), 40.0) * 0.05) * uNight * horizon;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

function makeWeatherTexture() {
  const S = 512; const data = new Uint8Array(S * S * 4);
  const a = new Float32Array(S * S), b = new Float32Array(S * S);
  let mn = 1, mx = 0;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    // domain-warped fbm → clumpy cumulus fields
    const wx = tileFbm(u, v, 3, 3, 301) - 0.5, wy = tileFbm(u, v, 3, 3, 407) - 0.5;
    const f = tileFbm(u + wx * 0.12, v + wy * 0.12, 5, 5, 53);
    a[y * S + x] = f; mn = Math.min(mn, f); mx = Math.max(mx, f);
    b[y * S + x] = tileFbm(u, v, 9, 4, 211);
  }
  for (let i = 0; i < S * S; i++) {
    data[i * 4] = Math.round(((a[i] - mn) / (mx - mn)) * 255);
    data[i * 4 + 1] = Math.round(b[i] * 255);
    data[i * 4 + 2] = 0; data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true; tex.needsUpdate = true;
  return tex;
}

const _c = new THREE.Color();
const _r = new THREE.Vector3(), _u2 = new THREE.Vector3(), _f = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class Sky {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.time = 7.1;             // hours: the game opens in early-morning golden light
    this.dayLength = 1500;       // seconds for a full day
    this.paused = false;
    this.lut = new THREE.WebGLRenderTarget(256, 128, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
    this.lut.texture.wrapS = THREE.ClampToEdgeWrapping; this.lut.texture.wrapT = THREE.ClampToEdgeWrapping;
    G.uSkyLUT.value = this.lut.texture;
    G.uWeather.value = makeWeatherTexture();
    this.lutMat = fsMaterial(LUT_FRAG, { uSun: { value: new THREE.Vector3() }, uSkyScale: { value: 1.45 }, uBayHaze: { value: 0 } });
    this._lutSun = new THREE.Vector3(0, -2, 0);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.domeMat = new THREE.ShaderMaterial({
      vertexShader: DOME_VERT, fragmentShader: DOME_FRAG, depthWrite: false, depthTest: true,
      uniforms: {
        uSkyLUT: G.uSkyLUT, uTrueSunDir: G.uTrueSunDir, uFogParams: G.uFogParams, uMoonDir: G.uMoonDir,
        uSunDisc: { value: new THREE.Color(1, 1, 1) }, uNight: G.uNight, uTime: G.uTime,
        uGroundCol: { value: new THREE.Color(0, 0, 0) }, uGroundMix: { value: 0 },
        uAmbSkyC: G.uAmbSky, uWeather: G.uWeather, uWind: G.uWind,
      },
    });
    this.dome = new THREE.Mesh(geo, this.domeMat);
    this.dome.frustumCulled = false; this.dome.renderOrder = 900;
    scene.add(this.dome);
    // environment lighting: the sky (without the sun disc) rendered to a cube and prefiltered,
    // so dragon scales, armour and wet stone pick up real sky reflections and fill light
    this.scene = scene;
    this.envMat = new THREE.ShaderMaterial({
      vertexShader: DOME_VERT, fragmentShader: DOME_FRAG, depthWrite: false, depthTest: false,
      uniforms: {
        uSkyLUT: G.uSkyLUT, uTrueSunDir: G.uTrueSunDir, uFogParams: G.uFogParams, uMoonDir: G.uMoonDir,
        uSunDisc: { value: new THREE.Color(0, 0, 0) }, uNight: { value: 0 }, uTime: G.uTime,
        uGroundCol: G.uAmbGround, uGroundMix: { value: 1 },
        uAmbSkyC: G.uAmbSky, uWeather: G.uWeather, uWind: G.uWind,
      },
    });
    this.envScene = new THREE.Scene();
    const envDome = new THREE.Mesh(geo, this.envMat); envDome.frustumCulled = false; this.envScene.add(envDome);
    this.cubeRT = new THREE.WebGLCubeRenderTarget(64, { type: THREE.HalfFloatType });
    this.cubeCam = new THREE.CubeCamera(1, 100, this.cubeRT);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null; this._envSun = new THREE.Vector3(0, -2, 0);
    scene.environmentIntensity = 0.45;

    this.sun = new THREE.DirectionalLight(0xffffff, Math.PI);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.6; this.sun.shadow.radius = 2.2;
    const sc = this.sun.shadow.camera; this.sc = sc; sc.left = -950; sc.right = 950; sc.top = 950; sc.bottom = -950; sc.near = 10; sc.far = 9000;      // ~0.46 m texels, centred ahead of the camera (main.js)
    scene.add(this.sun); scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, Math.PI * 0.72);
    scene.add(this.hemi);
    this.update(0, new THREE.Vector3());
  }
  setTime(h) { this.time = ((h % 24) + 24) % 24; }
  update(dt, focus) {
    if (!this.paused) this.time = (this.time + dt * 24 / this.dayLength) % 24;
    const th = (this.time - 6) / 24 * Math.PI * 2, tilt = 38 * Math.PI / 180;
    const sun = G.uTrueSunDir.value.set(Math.cos(th), Math.sin(th) * Math.cos(tilt), Math.sin(th) * Math.sin(tilt)).normalize();
    const tm = th + Math.PI + 0.5;
    const moon = G.uMoonDir.value.set(Math.cos(tm), Math.sin(tm) * Math.cos(0.5), -Math.sin(tm) * Math.sin(0.5) + 0.25).normalize();
    const s = sun.y;
    // direct sunlight colour through the atmosphere
    const elev = Math.asin(Math.max(-1, Math.min(1, s))) * 180 / Math.PI;
    const m = 1 / (Math.max(Math.sin(Math.max(elev, 0) * Math.PI / 180), 0) + 0.50572 * Math.pow(Math.max(elev, 0) + 6.07995, -1.6364));
    const tr = Math.exp(-0.055 * m), tg = Math.exp(-0.105 * m), tb = Math.exp(-0.215 * m);
    const day = smooth(-0.08, 0.5, s);
    const night = 1 - smooth(-0.2, 0.0, s);
    G.uNight.value = night;
    const bay=this.bayCentre;
    const haze=bay ? (1-smooth(500,2600,Math.hypot(focus.x-bay[0],focus.z-bay[1])))*
      (1-smooth(45,540,focus.y))*smooth(.005,.29,s) : 0;
    let lightDir, k;
    if (s > -0.045) {
      lightDir = sun; k = smooth(-0.045, 0.05, s);
      G.uSunColor.value.setRGB(tr * 3.5 * k, tg * 3.5 * k, tb * 3.5 * k);
    } else {
      lightDir = moon; k = smooth(-0.045, -0.16, s) * smooth(0.0, 0.12, moon.y);
      G.uSunColor.value.setRGB(0.085 * k, 0.125 * k, 0.215 * k);
    }
    G.uSunColor.value.multiplyScalar(1-.19*haze);
    G.uSunDir.value.copy(lightDir);
    this.domeMat.uniforms.uSunDisc.value.setRGB(tr, tg, tb);
    // ambient
    const sunset = smooth(-0.14, 0.0, s) * (1 - smooth(0.0, 0.32, s));
    G.uAmbSky.value.setRGB(
      0.010 + day * 0.33 + sunset * 0.20,
      0.016 + day * 0.47 + sunset * 0.11,
      0.036 + day * 0.76 + sunset * 0.10);
    G.uAmbGround.value.setRGB(
      0.008 + day * 0.20 + tr * day * 0.08,
      0.011 + day * 0.185 + tg * day * 0.06,
      0.020 + day * 0.16 + tb * day * 0.04);
    G.uAmbSky.value.addScalar(.07*haze);
    G.uFogParams.value.w = (0.3 + 1.0 * (1 - smooth(0.05, 0.55, Math.abs(s)))) / 5200;   // mist density
    // auto exposure keyed to the light reaching level ground
    const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    const E = lum(G.uSunColor.value) * Math.max(lightDir.y, 0) + lum(G.uAmbSky.value);
    this.exposure = Math.min(2.3, Math.max(0.2, 0.9 / Math.pow(E, 0.8)));   // expose for the highlights when the sun is low
    this.night = night;

    // three.js lights (for built-in materials)
    this.sun.color.copy(G.uSunColor.value);
    // snap the shadow box to whole shadow-map texels in the light's frame, so a moving camera does not make the edges crawl
    {
      const sc = this.sc, T = (sc.right - sc.left) / this.sun.shadow.mapSize.x;
      _r.crossVectors(_up, lightDir); if (_r.lengthSq() < 1e-6) _r.set(1, 0, 0); _r.normalize(); _u2.crossVectors(lightDir, _r);
      const a = Math.round(focus.dot(_r) / T) * T, b = Math.round(focus.dot(_u2) / T) * T, c = focus.dot(lightDir);
      _f.copy(_r).multiplyScalar(a).addScaledVector(_u2, b).addScaledVector(lightDir, c);
    }
    this.sun.position.copy(_f).addScaledVector(lightDir, 4000);
    this.sun.target.position.copy(_f);
    this.sun.target.updateMatrixWorld();
    this.hemi.color.copy(G.uAmbSky.value); this.hemi.groundColor.copy(G.uAmbGround.value);

    // refresh the scattering LUT when the sun has moved
    if (this._lutSun.dot(sun) < 0.999995 || Math.abs(this.lutMat.uniforms.uBayHaze.value-haze)>.025) {
      this.lutMat.uniforms.uBayHaze.value=haze;
      this._lutSun.copy(sun);
      this.lutMat.uniforms.uSun.value.copy(sun);
      fsQuad.render(this.renderer, this.lutMat, this.lut);
      this.renderer.setRenderTarget(null);
    }
    if (this._envSun.dot(sun) < 0.9996 || Math.abs((this._envHaze || 0)-haze)>.16) {
      this._envHaze=haze;
      this._envSun.copy(sun);
      this.cubeCam.update(this.renderer, this.envScene);
      this.envRT = this.pmrem.fromCubemap(this.cubeRT.texture, this.envRT);
      this.scene.environment = this.envRT.texture;
      this.renderer.setRenderTarget(null);
    }
  }
}
