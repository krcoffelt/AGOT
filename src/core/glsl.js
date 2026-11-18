// Shared GLSL chunks + global uniforms + fullscreen helper.
import * as THREE from 'three';
import { toMap } from '../world/mapdata.js';
const MAPCY = toMap(0, 0)[1];      // map y of the world origin

// Global uniforms shared (by reference) across all materials.
export const G = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.5, 0.6, 0.3).normalize() },     // main light direction (sun or moon)
  uTrueSunDir: { value: new THREE.Vector3(0.5, 0.6, 0.3).normalize() }, // actual sun (for sky)
  uMoonDir: { value: new THREE.Vector3(-0.5, 0.4, -0.3).normalize() },
  uSunColor: { value: new THREE.Color(3, 2.8, 2.5) },                   // direct radiance factor
  uAmbSky: { value: new THREE.Color(0.4, 0.55, 0.8) },
  uAmbGround: { value: new THREE.Color(0.25, 0.22, 0.18) },
  uSkyLUT: { value: null },
  uFogParams: { value: new THREE.Vector4(1 / 26000, 1 / 1400, 1 / 90000, 0) }, // density, height falloff, base haze, night
  uNight: { value: 0 },
  uWeather: { value: null },
  uCloudParams: { value: new THREE.Vector4(1950, 3500, 0.43, 0) },       // base, top, coverage, -
  uWind: { value: new THREE.Vector2(0, 0) },                            // cloud scroll offset (m)
  uFireLight: { value: new THREE.Vector4(0, -9999, 0, 0) },             // xyz pos, w intensity
  uWake: { value: new THREE.Vector4(0, 0, 30, 0) },                     // xz centre, radius, strength: wing wash on the water
  uFireColor: { value: new THREE.Color(1, 0.45, 0.1) },
};

export const GLSL_NOISE = /* glsl */`
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec3 noised(vec2 x){
  vec2 i = floor(x); vec2 f = fract(x);
  vec2 u = f*f*f*(f*(f*6.0-15.0)+10.0);
  vec2 du = 30.0*f*f*(f*(f-2.0)+1.0);
  float a = hash12(i), b = hash12(i+vec2(1,0)), c = hash12(i+vec2(0,1)), d = hash12(i+vec2(1,1));
  return vec3(a+(b-a)*u.x+(c-a)*u.y+(a-b-c+d)*u.x*u.y, du*(vec2(b-a,c-a)+(a-b-c+d)*u.yx));
}
const mat2 M2 = mat2(0.8,-0.6,0.6,0.8);
float fbm(vec2 p){ float a = 0.0, b = 0.5; for(int i=0;i<5;i++){ a += b*noised(p).x; b *= 0.5; p = M2*p*2.02; } return a/0.96875; }
float fbm3(vec2 p){ float a = 0.0, b = 0.5; for(int i=0;i<3;i++){ a += b*noised(p).x; b *= 0.5; p = M2*p*2.02; } return a/0.875; }
float terrainE(vec2 p, int oct){
  float a = 0.0, b = 1.0; vec2 d = vec2(0.0);
  for(int i=0;i<12;i++){ if(i>=oct) break; vec3 n = noised(p); d += n.yz; a += b*n.x/(1.0+dot(d,d)); b *= 0.5; p = M2*p*2.0; }
  return a;
}
float ridged(vec2 p, int oct){
  float a = 0.0, amp = 0.5, w = 1.0;
  for(int i=0;i<12;i++){ if(i>=oct) break; float n = 1.0-abs(noised(p).x*2.0-1.0); n *= n; n *= w; w = clamp(n*2.0,0.0,1.0); a += n*amp; amp *= 0.5; p = M2*p*2.03; }
  return a;
}
`;

// Sky LUT lookup + aerial perspective. Requires uSkyLUT, uTrueSunDir, uFogParams uniforms.
export const GLSL_ATMOS_UNIFORMS = /* glsl */`
uniform sampler2D uSkyLUT;
uniform sampler2D uWeather;
uniform vec3 uTrueSunDir;
uniform vec4 uFogParams;
`;
export const GLSL_ATMOS = /* glsl */`
vec3 skyLUT(vec3 dir){
  float e = asin(clamp(dir.y, 0.0, 1.0));
  float v = sqrt(e / 1.5707963);
  vec2 a = normalize(dir.xz + vec2(1e-5, 0.0)); vec2 s = normalize(uTrueSunDir.xz + vec2(1e-5, 0.0));
  float u = acos(clamp(dot(a, s), -1.0, 1.0)) / 3.14159265;
  return textureLod(uSkyLUT, vec2(u * (255.0/256.0) + 0.5/256.0, v * (127.0/128.0) + 0.5/128.0), 0.0).rgb;
}
float fogOpticalDepth(vec3 camPos, vec3 dir, float d){
  float c = uFogParams.y;
  float dy = dir.y; if (abs(dy) < 1e-4) dy = 1e-4;
  float od = uFogParams.x * exp(-max(camPos.y, 0.0) * c) * (1.0 - exp(-min(d * dy * c, 30.0) )) / (dy * c);
  od += d * uFogParams.z;
  return max(od, 0.0);
}
vec3 applyAtmosphere(vec3 col, vec3 wp, vec3 camPos){
  vec3 v = wp - camPos; float d = length(v); vec3 dir = v / max(d, 1e-3);
  float od = fogOpticalDepth(camPos, dir, d);
  // low mist pooling in valleys and over water: thin layer, patchy, thickest at dawn and dusk
  {
    float c = 1.0 / 130.0; float dy = dir.y; if (abs(dy) < 1e-4) dy = 1e-4;
    float m = uFogParams.w * exp(-max(camPos.y, 0.0) * c) * (1.0 - exp(-min(d * dy * c, 30.0))) / (dy * c);
    float bank = texture(uWeather, wp.xz / 8200.0 + 0.37).g;
    od += min(max(m, 0.0) * (0.08 + 1.9 * smoothstep(0.42, 0.74, bank)), 1.6);
  }
  vec3 ext = exp(-od * vec3(0.82, 1.0, 1.30));
  vec3 fogCol = skyLUT(normalize(vec3(dir.x, max(dir.y, 0.0) * 0.6 + 0.03, dir.z)));
  // tame the forward-scatter glare so haze toward the sun does not white out the land
  float fl = dot(fogCol, vec3(0.2126, 0.7152, 0.0722));
  fogCol *= (1.0 + fl * 0.1) / (1.0 + fl * 1.3);
  return col * ext + fogCol * (1.0 - ext);
}
`;

// Cloud coverage shared by the volumetric clouds, ground shadows and water reflections.
export const GLSL_WEATHER = /* glsl */`
uniform vec4 uCloudParams;
uniform vec2 uWind;
float cloudCoverage(vec2 xz){
  vec4 w = textureLod(uWeather, (xz + uWind) / 46000.0, 0.0);      // explicit level: called inside ray-march loops, where derivatives (and so mip choice) are undefined
  // regional weather: brooding skies in the North, clear over Dorne
  float lat = (xz.y / 400.0 + ${MAPCY.toFixed(2)}) / 200.0;      // 0 beyond the Wall → 1 at Dorne's coast (see mapdata.mapLat)
  float c = clamp(uCloudParams.z + mix(0.08, -0.2, smoothstep(0.2, 0.85, lat)), 0.02, 0.95);
  return smoothstep(1.0 - c - 0.05, 1.0 - c + 0.25, w.r);
}
float cloudShadow(vec3 p, vec3 L){
  float t = (uCloudParams.x + 450.0 - p.y) / max(L.y, 0.12);
  if (t < 0.0) return 1.0;
  return 1.0 - 0.72 * cloudCoverage(p.xz + L.xz * t);
}
`;

export const FS_VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export class FSQuad {
  constructor() {
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.mesh = new THREE.Mesh(geo, null);
    this.mesh.frustumCulled = false;
  }
  render(renderer, material, target = null) {
    this.mesh.material = material;
    renderer.setRenderTarget(target);
    renderer.render(this.mesh, this.cam);
  }
}
export const fsQuad = new FSQuad();

export function fsMaterial(fragmentShader, uniforms = {}, opts = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: FS_VERT, fragmentShader, uniforms,
    depthTest: false, depthWrite: false, ...opts,
  });
}

// Patch a built-in material so it gets aerial perspective identical to the terrain.
export function patchAtmosphere(material, extra, key = '') {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    shader.uniforms.uSkyLUT = G.uSkyLUT;
    shader.uniforms.uTrueSunDir = G.uTrueSunDir;
    shader.uniforms.uFogParams = G.uFogParams;
    shader.uniforms.uWeather = G.uWeather;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vAtmoWorld;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        {
          vec4 awp = vec4(transformed, 1.0);
          #ifdef USE_BATCHING
            awp = batchingMatrix * awp;
          #endif
          #ifdef USE_INSTANCING
            awp = instanceMatrix * awp;
          #endif
          vAtmoWorld = (modelMatrix * awp).xyz;
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vAtmoWorld;\n' + GLSL_ATMOS_UNIFORMS + GLSL_ATMOS)
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\n gl_FragColor.rgb = applyAtmosphere(gl_FragColor.rgb, vAtmoWorld, cameraPosition);');
    if (extra) extra(shader);
  };
  material.customProgramCacheKey = () => 'atmo:' + key + (extra ? extra.toString().length : 0) + (prev ? 'p' : '');
  return material;
}
