// Geometry-clipmap terrain with integrated ocean / river shading.
import * as THREE from 'three';
import { MAP, toMap } from './mapdata.js';
const MAP_CY = toMap(0, 0)[1];
import { DETAIL } from './heightmap.js';
import { CANOPY_SPAN } from './trees.js';
import { G, GLSL_ATMOS, GLSL_ATMOS_UNIFORMS, GLSL_WEATHER } from '../core/glsl.js';

const N = 160;          // cells per side of each clipmap level
const S0 = 4;           // finest cell size (m)
const LEVELS = 9;

const VERT = /* glsl */`
#include <common>
#include <shadowmap_pars_vertex>
uniform sampler2D uHeightTex, uDetailTex;
uniform vec2 uMapSize;
uniform vec2 uOrigin;
uniform float uScale, uLevel;
varying vec3 vWorld;
const float DT1 = ${DETAIL.T1.toFixed(1)}, DA1 = ${DETAIL.A1.toFixed(1)}, DT2 = ${DETAIL.T2.toFixed(1)}, DA2 = ${DETAIL.A2.toFixed(1)}, DO2 = ${DETAIL.O2};
void main(){
  vec2 g = position.xz;
  float d = max(abs(g.x), abs(g.y)) / ${(N / 2).toFixed(1)};
  float k = clamp((d - 0.70) / 0.2, 0.0, 1.0);
  vec2 odd = mod(g, 2.0);
  vec2 wp = uOrigin + (g - odd * k) * uScale;
  float lod = uLevel + k;
  vec2 uv = wp / uMapSize + 0.5;
  vec4 H = textureLod(uHeightTex, uv, max(0.0, lod - 2.3));
  float f1 = clamp(5.6 - lod, 0.0, 1.0), f2 = clamp(3.4 - lod, 0.0, 1.0);
  float r1 = textureLod(uDetailTex, wp / DT1, 0.0).r * 2.0 - 1.0;
  float disp = DA1 * (0.35 * r1 + 0.65 * (1.0 - 2.0 * abs(r1))) * f1
             + (textureLod(uDetailTex, wp / DT2 + DO2, 0.0).r - 0.5) * 2.0 * DA2 * f2;
  float h = H.r + disp * H.a;
  float y = max(h, 0.0);
  vWorld = vec3(wp.x, y, wp.y);
  vec4 worldPosition = vec4(vWorld, 1.0);
  vec3 transformedNormal = mat3(viewMatrix) * vec3(0.0, 1.0, 0.0);
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
uniform sampler2D uHeightTex, uNormalTex, uBiomeTex, uDetailTex, uShadowBake, uCanopy;
uniform float uCanopyK, uCoastVisible;
uniform vec2 uCoastCentre;
uniform sampler2D uCoastMirror, uCoastContact, uCoastRipple;
uniform mat4 uCoastProject;
uniform vec2 uMapSize;
uniform float uTime;
uniform vec3 uSunDir, uSunColor, uAmbSky, uAmbGround;
uniform vec4 uFireLight; uniform vec3 uFireColor;
uniform vec4 uScorch[24];
uniform sampler2DArray uGroundAlb, uGroundNrm;     // scanned ground materials: colour / tangent normal + height
uniform vec3 uTexMean[8];
uniform sampler2D uPaveMap;
uniform vec4 uWake;
${GLSL_ATMOS_UNIFORMS}
${GLSL_ATMOS}
${GLSL_WEATHER}
varying vec3 vWorld;
const float DT1 = ${DETAIL.T1.toFixed(1)}, DA1 = ${DETAIL.A1.toFixed(1)}, DT2 = ${DETAIL.T2.toFixed(1)}, DA2 = ${DETAIL.A2.toFixed(1)}, DO2 = ${DETAIL.O2};

vec3 S(float r, float g, float b){ return pow(vec3(r, g, b) / 255.0, vec3(2.2)); }
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

struct GM { vec3 c; vec2 n; float h; };
// One scanned material at two scales: the far layer breaks up tiling, the near layer adds blade- and pebble-level detail.
// Colour is returned relative to the scan's own average so the biome tint still decides the hue.
// sat 1 keeps the scan's colour variation channel by channel; sat 0 keeps only its light and dark. The rock scans need 0:
// 'rocky_terrain_02' is mostly grass and 'rock_face' is rust brown, so their average has almost no blue, and dividing a
// grey pebble or a grey patch by that average channel by channel multiplies its blue up to the clamp: violet rock.
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
vec3 relTex(vec3 a, vec3 mean, float sat){ return mix(vec3(dot(a, LUMA) / dot(mean, LUMA)), a / mean, sat); }
GM gmatS(int LN, int LF, vec2 p, vec2 gx, vec2 gy, float sN, float sF, float nearW, float sat){
  GM m;
  vec3 qF = vec3(p / sF, float(LF));
  vec4 aF = textureGrad(uGroundAlb, qF, gx / sF, gy / sF), nFr = textureGrad(uGroundNrm, qF, gx / sF, gy / sF);
  m.c = relTex(aF.rgb, uTexMean[LF], sat); m.n = (nFr.rg * 2.0 - 1.0) * 0.6; m.h = nFr.b;
  if (nearW > 0.01) {
    vec3 qN = vec3(p / sN + 0.37, float(LN));
    vec4 aN = textureGrad(uGroundAlb, qN, gx / sN, gy / sN), nN = textureGrad(uGroundNrm, qN, gx / sN, gy / sN);
    m.c *= mix(vec3(1.0), relTex(aN.rgb, uTexMean[LN], sat), nearW);
    m.n += (nN.rg * 2.0 - 1.0) * nearW; m.h = mix(m.h, nN.b, nearW * 0.7);
  }
  m.c = clamp(m.c, 0.0, 3.0);
  return m;
}
GM gmat(int LN, int LF, vec2 p, vec2 gx, vec2 gy, float sN, float sF, float nearW){ return gmatS(LN, LF, p, gx, gy, sN, sF, nearW, 1.0); }
vec3 fieldColor(vec2 p, vec2 warp, out float hedge){
  vec2 q = p + warp * 240.0;
  vec2 c = mat2(0.94, -0.34, 0.34, 0.94) * q / 150.0;
  vec2 id = floor(c); vec2 f = fract(c);
  float hs = h12(id);
  if (hs > 0.45) { float sp = step(0.5, f.x); id.x += sp * 0.5 + 0.13; f.x = fract(f.x * 2.0); }
  if (hs < 0.25 || hs > 0.8) { float sp = step(0.5, f.y); id.y += sp * 0.5 + 0.29; f.y = fract(f.y * 2.0); }
  float k = h12(id * 3.7 + 1.3);
  vec3 col = k < 0.26 ? S(196., 170., 84.) : k < 0.48 ? S(112., 146., 58.) : k < 0.64 ? S(124., 96., 66.) : k < 0.84 ? S(134., 150., 70.) : S(78., 112., 48.);
  col *= 0.85 + 0.3 * h12(id + 9.1);
  // furrows
  float fr = sin((f.x + f.y * (k - 0.5) * 2.0) * 60.0);
  col *= 1.0 + 0.05 * fr;
  vec2 e = min(f, 1.0 - f);
  hedge = 1.0 - smoothstep(0.008, 0.026, min(e.x, e.y));
  return col;
}

void main(){
  vec2 wp = vWorld.xz; vec2 uv = wp / uMapSize + 0.5;
  vec3 toCam = cameraPosition - vWorld; float dist = length(toCam); vec3 V = toCam / dist;
  vec4 H = texture(uHeightTex, uv); vec4 Nt = texture(uNormalTex, uv); vec4 Bi = texture(uBiomeTex, uv);
  float h = H.r, river = H.g, forest = H.b, amp = H.a;
  float ao = Nt.b, conv = Nt.a;
  vec4 nA = texture(uDetailTex, wp / 5200.0);
  vec4 nB = texture(uDetailTex, wp / DT1);
  vec4 nC = texture(uDetailTex, wp / DT2 + DO2);
  vec4 nD = texture(uDetailTex, wp / 47.0 + 0.61);
  vec4 nE = texture(uDetailTex, wp / 11.0 + 0.23);
  float nearF = 1.0 - smoothstep(80.0, 500.0, dist);
  float nearF2 = 1.0 - smoothstep(18.0, 160.0, dist);
  vec4 nF = texture(uDetailTex, wp / 2.9 + 0.43);                 // blade-scale detail, only visible skimming the ground
  vec2 gwx = dFdx(wp), gwy = dFdy(wp); float gyx = dFdx(vWorld.y), gyy = dFdy(vWorld.y);
  float nearT = 1.0 - smoothstep(140.0, 800.0, dist);
  GM mG = gmat(0, 5, wp, gwx, gwy, 6.5, 173.0, nearT);
  GM mD = GM(vec3(1.0), vec2(0.0), 0.5); GM mR = mD; GM mS = mD; GM mN = mD;

  vec2 n2 = Nt.rg * 2.0 - 1.0; float ny = sqrt(max(1.0 - dot(n2, n2), 0.02));
  vec2 slope = -n2 / ny;
  const float GS = 64.0;
  vec2 gB = (nB.gb - 0.5) * GS / DT1, gC = (nC.gb - 0.5) * GS / DT2;
  float r1 = nB.r * 2.0 - 1.0;
  slope += (gB * DA1 * (0.7 - 2.6 * sign(r1)) + gC * 2.0 * DA2) * amp;
  float hd = h + amp * (DA1 * (0.35 * r1 + 0.65 * (1.0 - 2.0 * abs(r1))) + (nC.r - 0.5) * 2.0 * DA2);
  vec3 Ng = normalize(vec3(-slope.x, 1.0, -slope.y));
  float steep = 1.0 - Ng.y;

  float lat = (wp.y / 400.0 + ${MAP_CY.toFixed(2)}) / 200.0;      // true latitude (the world is one region of the map: mapdata.mapLat)
  float macro = nA.r, macro2 = nA.a;
  float desert = Bi.r, swamp = Bi.g, farm = Bi.b, mtMask = Bi.a;
  float cold = 1.0 - smoothstep(0.2, 0.46, lat + (macro - 0.5) * 0.05);
  float south = smoothstep(0.55, 0.8, lat);
  float latS = smoothstep(0.12, 0.60, lat + (macro - 0.5) * 0.03);

  // ---- snow
  float snowLine = mix(-500.0, 1500.0, latS);
  float snow = smoothstep(snowLine - 80.0, snowLine + 260.0, hd + (nB.a - 0.5) * 240.0 + (macro2 - 0.5) * 160.0);
  snow *= 1.0 - smoothstep(0.30, 0.62, steep + (nB.a - 0.5) * 0.14);
  snow = max(snow, (1.0 - smoothstep(0.13, 0.17, lat)) * (1.0 - smoothstep(0.5, 0.8, steep)));

  // ---- ground albedo
  vec3 grass = mix(S(66., 86., 42.), S(78., 100., 44.), south);
  grass = mix(grass, S(112., 104., 64.), cold * 0.85);
  grass = mix(grass, S(142., 128., 78.), desert * 0.8 + mtMask * 0.25);          // dry scrub near Dorne and on high ground
  grass *= 0.62 + 0.62 * macro;
  grass = mix(grass, grass * vec3(1.3, 1.1, 0.66), smoothstep(0.45, 0.8, nB.a) * 0.6);
  grass = mix(grass, S(58., 84., 40.), smoothstep(0.55, 0.85, nC.a) * 0.5);       // darker clover / heath patches
  grass = mix(grass, S(150., 138., 84.), smoothstep(0.56, 0.78, macro2) * 0.32 * (1.0 - cold * 0.5));   // sun-bleached straw
  grass *= 0.86 + 0.28 * nD.a;
  grass *= 0.9 + 0.2 * nE.a * nearF;
  grass *= 0.92 + 0.16 * nF.r * nearF2;
  grass *= mix(vec3(1.0), mG.c, 0.9);
  // heather in the North, wildflowers in the South: fine speckle that only resolves up close
  float bloomMask = smoothstep(0.7, 0.8, nF.r) * smoothstep(0.52, 0.7, nE.a) * smoothstep(0.5, 0.68, nC.r) * nearF2;
  vec3 flower = mix(S(126., 86., 128.), mix(S(216., 196., 84.), S(214., 210., 200.), step(0.5, nF.a)), south * 0.8 + 0.1);
  grass = mix(grass, flower, bloomMask * 0.4);
  vec3 dirt = mix(S(112., 90., 62.), S(88., 78., 62.), cold);
  vec3 sand = S(214., 192., 150.);
  vec3 desertCol = mix(S(224., 182., 122.), S(198., 142., 94.), macro2) * (0.9 + 0.2 * nD.a);
  vec3 rockCol = mix(S(118., 112., 106.), S(82., 82., 86.), cold);
  rockCol = mix(rockCol, S(164., 100., 70.), desert);
  rockCol *= mix(vec3(1.0), vec3(1.14, 1.0, 0.85), (1.0 - smoothstep(70.0, 240.0, hd)) * (1.0 - cold) * (1.0 - desert));   // crags and sea cliffs weather browner than the high rock
  rockCol *= (0.66 + 0.6 * nD.a) * (0.9 + 0.14 * sin(hd * 0.11 + nB.r * 9.0) * (1.0 - smoothstep(1500.0, 5000.0, dist)));
  rockCol *= 0.8 + 0.4 * nB.a;
  float cliffF = smoothstep(0.3, 0.55, steep);
  if (cliffF > 0.0) {
    vec4 nV = texture(uDetailTex, vec2((wp.x + wp.y * 0.7) / 61.0, hd / 23.0));
    vec4 nV2 = texture(uDetailTex, vec2((wp.x - wp.y) / 13.0, hd / 5.5));
    float strata = 0.5 + 0.5 * sin(hd * 0.42 + nV.r * 7.0 + macro * 9.0);
    vec3 cliffCol = rockCol * (0.55 + 0.7 * nV.a) * (0.82 + 0.3 * strata) * (0.8 + 0.4 * nV2.a * nearF + 0.2 * (1.0 - nearF));
    rockCol = mix(rockCol, cliffCol, cliffF);
  }
  vec3 swampCol = mix(S(58., 70., 38.), S(78., 72., 48.), nD.a);
  vec3 snowCol = S(236., 242., 250.);

  vec3 alb = grass;
  // streets and yards of towns, villages and castles
  float pave = texture2D(uPaveMap, uv + (nD.rg - 0.5) * vec2(0.0009, 0.00045)).r;
  float dirtPatch = smoothstep(0.6, 0.82, nC.a) * 0.45;
  if (dirtPatch > 0.02 || forest > 0.02 || farm > 0.02 || pave > 0.01) mD = gmat(1, 1, wp, gwx, gwy, 5.0, 37.0, nearT);
  alb = mix(alb, dirt * mD.c, dirtPatch);
  if (pave > 0.01) {
    GM mP = gmat(7, 7, wp, gwx, gwy, 2.3, 6.9, nearT);
    vec3 street = mix(S(126., 110., 90.) * mD.c, S(146., 138., 124.) * mix(vec3(1.0), mP.c, 0.8), smoothstep(0.62, 0.86, pave + (nD.a - 0.5) * 0.3));
    alb = mix(alb, street, smoothstep(0.08, 0.42, pave) * 0.94);
  }
  float microAmp = 0.34;

  // farmland
  if (farm > 0.02) {
    float hedge; vec3 fc = fieldColor(wp, nB.ra - 0.5, hedge);
    fc *= 0.55 + 0.45 * mD.c;
    fc = mix(fc, S(52., 76., 36.), hedge);
    fc = mix(fc, S(128., 136., 66.), smoothstep(4000.0, 11000.0, dist));
    float fa = smoothstep(0.25, 0.5, farm + (macro2 - 0.5) * 0.3) * (1.0 - smoothstep(0.012, 0.04, steep));      // fields keep to the flats; hillsides stay wild
    alb = mix(alb, fc, fa * 0.92);
  }

  // forest
  float treeLine = mix(520.0, 1250.0, latS);
  float treeP = smoothstep(0.30, 0.45, forest + (macro - 0.5) * 0.7);
  treeP *= (1.0 - smoothstep(0.22, 0.42, steep)) * (1.0 - smoothstep(treeLine - 120.0, treeLine, hd)) * smoothstep(1.0, 4.0, hd);
  vec3 floorCol = mix(S(60., 64., 38.), S(74., 70., 50.), cold);
  alb = mix(alb, floorCol * mD.c, treeP * 0.75);
  vec3 canopy = mix(S(30., 52., 32.), S(48., 80., 28.), smoothstep(0.38, 0.56, lat));
  canopy *= 0.65 + 0.7 * nD.r;
  float farForest = treeP * smoothstep(2400.0, 4300.0, dist);
  canopy *= 0.8 + 0.4 * nB.a;
  alb = mix(alb, canopy, farForest);
  microAmp = mix(microAmp, 2.6, farForest);

  alb = mix(alb, swampCol, swamp * 0.9);
  if (desert > 0.02 || hd < 6.5) mS = gmat(3, 3, wp, gwx, gwy, 4.5, 31.0, nearT);
  alb = mix(alb, desertCol * mS.c, desert * (1.0 - treeP));
  microAmp = mix(microAmp, 0.12, desert);

  // beach + wet sand
  float beach = (1.0 - smoothstep(1.4, 4.5, hd + (nD.r - 0.5) * 2.4)) * (1.0 - smoothstep(0.12, 0.3, steep));
  alb = mix(alb, sand * (0.92 + 0.16 * nD.a) * mS.c, beach);
  alb *= mix(0.62, 1.0, smoothstep(0.15, 1.3, hd));

  // rock
  float rock = smoothstep(0.19, 0.27, steep + (nD.r - 0.5) * 0.15 + (nC.a - 0.5) * 0.08 + (nE.r - 0.5) * 0.07 * nearF);
  rockCol *= 1.0 - 0.45 * smoothstep(0.55, 0.3, nE.a) * nearF;                              // cracks up close
  rockCol = mix(rockCol, rockCol * vec3(0.8, 0.86, 0.72), smoothstep(0.5, 0.75, nC.a) * 0.5 * (1.0 - desert));   // lichen
  rock = max(rock, smoothstep(0.55, 1.0, amp) * smoothstep(treeLine, treeLine + 500.0, hd) * 0.75);
  if (rock > 0.01) {
    mR = gmatS(6, 6, wp, gwx, gwy, 8.0, 53.0, nearT, 0.0);                 // broken, stony ground (relief only: the hue is rockCol's)
    if (cliffF > 0.02) {
      // cliffs: lay the rock-face scan onto the wall from the side instead of smearing it down from above
      float wX = Ng.x * Ng.x, wZ = Ng.z * Ng.z; float ws = max(wX + wZ, 1e-4); wX /= ws; wZ /= ws;
      GM mC = GM(vec3(0.0), vec2(0.0), 0.0);
      if (wX > 0.08) { GM a = gmatS(2, 2, vec2(wp.y, vWorld.y), vec2(gwx.y, gyx), vec2(gwy.y, gyy), 12.0, 67.0, nearT, 0.0); mC.c += a.c * wX; mC.h += a.h * wX; }
      if (wZ > 0.08) { GM b = gmatS(2, 2, vec2(wp.x, vWorld.y), vec2(gwx.x, gyx), vec2(gwy.x, gyy), 12.0, 67.0, nearT, 0.0); mC.c += b.c * wZ; mC.h += b.h * wZ; }
      float wsum = (wX > 0.08 ? wX : 0.0) + (wZ > 0.08 ? wZ : 0.0);
      mC.c /= max(wsum, 1e-3);
      mR.c = mix(mR.c, mC.c, cliffF); mR.n *= 1.0 - cliffF;
    }
    rockCol *= mix(vec3(1.0), mR.c, 0.92);
  }
  alb = mix(alb, rockCol, rock);
  microAmp = mix(microAmp, 1.7, rock);
  alb *= mix(1.0, 0.82, rock);
  float snowS = snow * (1.0 - farForest * 0.55);
  if (snowS > 0.01) mN = gmat(4, 4, wp, gwx, gwy, 7.0, 43.0, nearT);
  alb = mix(alb, snowCol * mix(vec3(1.0), mN.c, 0.55), snowS);
  microAmp = mix(microAmp, 0.10, snowS);

  // scorch marks from dragonfire
  float glow = 0.0;
  for (int i = 0; i < 24; i++) {
    vec4 sc = uScorch[i]; if (sc.z <= 0.0) continue;
    float dd = distance(wp, sc.xy) / sc.z;
    float kk = 1.0 - smoothstep(0.45, 1.0, dd + (nD.r - 0.5) * 0.5);
    alb = mix(alb, vec3(0.012, 0.011, 0.010), kk * 0.93);
    glow += kk * sc.w * smoothstep(0.55, 0.9, nE.a + nD.a * 0.5);
  }

  // ---- lighting
  vec2 micro = (nD.gb - 0.5) * GS / 47.0 * microAmp * 0.7 + (nE.gb - 0.5) * GS / 11.0 * microAmp * 0.24 * nearF + (nF.gb - 0.5) * GS / 2.9 * microAmp * 0.05 * nearF2;
  // surface relief from the scans, weighted by what the ground actually is here
  {
    float wR = rock * (1.0 - snowS), wSn = snowS;
    float wSd = clamp(max(beach, desert), 0.0, 1.0) * (1.0 - rock) * (1.0 - snowS);
    float wDt = clamp(treeP * 0.75 + dirtPatch, 0.0, 1.0) * (1.0 - wR) * (1.0 - wSn) * (1.0 - wSd);
    float wGr = max(0.0, 1.0 - wR - wSn - wSd - wDt);
    vec2 tn = mG.n * wGr * 0.8 + mD.n * wDt * 0.9 + mR.n * wR * 1.6 + mS.n * wSd * 0.5 + mN.n * wSn * 0.5;
    micro += vec2(-tn.x, tn.y) * 0.9 * (1.0 - farForest);
  }
  vec3 Nn = normalize(vec3(-(slope.x + micro.x), 1.0, -(slope.y + micro.y)));
  float ndl = max(dot(Nn, uSunDir), 0.0);
  float bake = texture(uShadowBake, uv).r;
  float cs = cloudShadow(vWorld, uSunDir);
  float sm = getShadowMask();
  // forest floor: the trees' canopy map (trees.js) says how high the forest stands over the ground. Looking from this spot
  // toward the sun, ground with canopy above the line of sight is in the trees' shade (the real shadow map only reaches
  // the forest near the camera); and under the trees the ground sees less sky, faded in beyond the grass blades' reach.
  float underSky = 0.0;
  if (forest > 0.02 && uCanopyK > 0.0) {
    vec2 sh = normalize(uSunDir.xz + vec2(1e-5, 0.0)); float st = max(uSunDir.y, 0.0) / max(length(uSunDir.xz), 1e-3);
    float over = max(max(texture(uCanopy, (wp + sh * 5.0) / ${CANOPY_SPAN.toFixed(1)}).r - 5.0 * st, texture(uCanopy, (wp + sh * 12.0) / ${CANOPY_SPAN.toFixed(1)}).r - 12.0 * st), texture(uCanopy, (wp + sh * 24.0) / ${CANOPY_SPAN.toFixed(1)}).r - 24.0 * st) - vWorld.y;
    sm = min(sm, mix(1.0, 0.3, smoothstep(1.0, 6.0, over) * uCanopyK));
    underSky = smoothstep(3.0, 10.0, texture(uCanopy, wp / ${CANOPY_SPAN.toFixed(1)}).r - vWorld.y) * smoothstep(150.0, 400.0, dist) * uCanopyK;
  }
  float shadow = bake * cs * sm;
  float aoF = (0.4 + 0.6 * ao) * mix(1.0, 0.72, farForest) * mix(1.0, 0.65, underSky);
  vec3 ambient = mix(uAmbGround, uAmbSky, Nn.y * 0.5 + 0.5) * aoF;
  vec3 direct = uSunColor * ndl * shadow;
  vec3 col = alb * (direct + ambient);
  // snow sheen
  vec3 Hh = normalize(uSunDir + V);
  col += snowS * uSunColor * shadow * pow(max(dot(Nn, Hh), 0.0), 48.0) * 0.22;
  // fire light
  if (uFireLight.w > 0.0) {
    vec3 fl = uFireLight.xyz - vWorld; float fd = length(fl);
    col += alb * uFireColor * uFireLight.w * max(dot(Nn, fl / fd), 0.0) / (1.0 + fd * fd * 0.0025);
  }
  col += vec3(1.0, 0.32, 0.05) * glow * 2.2;

  // ---- water
  float waterAmt = max(1.0 - smoothstep(-0.3, 0.3, hd), smoothstep(0.44, 0.56, river)) * (1.0 - smoothstep(0.45, 0.75, steep));      // a steep face at the waterline is rock, not water
  if (waterAmt > 0.001) {
    float depth = max(max(-hd, 0.0), (river - 0.42) * 10.0);
    float t = uTime;
    float isRiver = step(0.3, river);
    vec2 g1 = texture(uDetailTex, wp / 290.0 + t * vec2(0.0055, 0.004)).gb - 0.5;
    vec2 g2 = texture(uDetailTex, wp / 67.0 - t * vec2(0.019, 0.012)).gb - 0.5;
    vec2 g3 = texture(uDetailTex, wp / 19.0 + t * vec2(0.041, -0.036)).gb - 0.5;
    float calm = mix(1.0, 0.35, isRiver) * mix(0.45, 1.0, smoothstep(0.0, 6.0, depth));
    float cove = uCoastVisible * (1.0 - smoothstep(240.0, 540.0, length(wp-uCoastCentre))) * (1.0-isRiver);
    calm *= mix(1.0,.39,cove);
    vec2 g0 = texture(uDetailTex, wp / 1150.0 + t * vec2(0.0021, 0.0016)).gb - 0.5;                  // long ocean swell
    vec2 gw = (g0 * 0.9 * (1.0 - isRiver) + g1 * 1.0 + g2 * 0.9 + g3 * 0.55) * calm;
    float rockDistance=12.;
    if (cove > .001) {
      rockDistance=texture(uCoastContact,(wp-uCoastCentre)/512.+.5).r*12.;
      vec2 rippleUV=wp/14.+g1*.075;
      vec2 fine=texture(uCoastRipple,rippleUV+t*vec2(.017,-.022)).rg-.5;
      mat2 turn=mat2(.83,-.56,.56,.83);
      vec2 crossRipples=turn* (texture(uCoastRipple,transpose(turn)*rippleUV*1.72+
                                   t*vec2(-.026,.019)+vec2(.29,.57)).rg-.5);
      gw+=(fine*.78+crossRipples*.34)*cove*(1.-smoothstep(95.,330.,dist));
    }
    // wing wash: a low dragon flattens a ring of ripples racing outward beneath it
    float wakeF = 0.0, wakeRip = 0.0;
    if (uWake.w > 0.001) {
      float wd = distance(wp, uWake.xy); wakeF = uWake.w * (1.0 - smoothstep(uWake.z * 0.25, uWake.z, wd));
      wakeRip = sin(wd * 1.35 - t * 11.0) * 0.5 + 0.5;
      gw += normalize(wp - uWake.xy + 1e-3) * (wakeRip - 0.5) * wakeF * 1.6;
    }
    float crest = smoothstep(0.1, 0.55, (g0.x * 1.4 * (1.0 - isRiver) + g1.x * 1.6 + g2.x) * calm + 0.2);     // sun-facing wave tops
    float chop = 0.5 * mix(1.0, 0.5, smoothstep(250.0, 3500.0, dist));      // a sheltered sea (as in the references): glassy swell, small ripples, glassier with distance
    vec3 Nw = normalize(vec3(-gw.x * chop, 1.0, -gw.y * chop));
    float nv = max(dot(Nw, V), 0.0);
    float fres = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
    vec3 R = reflect(-V, Nw); R.y = abs(R.y) + 0.02;
    vec3 skyR = skyLUT(normalize(R));
    // cloud reflection (cheap)
    float cr = cloudCoverage(wp + R.xz / max(R.y, 0.15) * (uCloudParams.x + 400.0));
    skyR = mix(skyR, skyR * 0.6 + (uAmbSky + uSunColor * 0.25) * 0.5, cr * 0.5);
    if (cove > .001) {
      vec4 proj = uCoastProject * vec4(wp.x,0.,wp.y,1.);
      vec2 uvMirror = proj.xy / proj.w * .5 + .5 + gw * vec2(.035,.108);
      if (proj.w > 0. && all(greaterThan(uvMirror,vec2(0.))) && all(lessThan(uvMirror,vec2(1.)))) {
        vec4 cliff = texture(uCoastMirror,uvMirror);
        skyR = mix(skyR,cliff.rgb/max(.01,cliff.a),cliff.a*cove*.97);
      }
    }
    vec3 lightW = uSunColor * max(uSunDir.y, 0.0) * bake * cs * 0.9 + uAmbSky * 0.9;
    vec3 scat = mix(vec3(0.0035, 0.024, 0.040), vec3(0.006, 0.022, 0.028), cold);
    scat = mix(scat, vec3(0.004, 0.036, 0.046), south);
    scat = mix(scat, vec3(0.03, 0.045, 0.02), isRiver * 0.6 + swamp);
    scat = mix(scat,vec3(.047,.095,.075),cove);
    vec3 ext = exp(-depth * vec3(0.46, 0.13, 0.085));
    vec3 body = col * ext * 0.85 + scat * lightW * (1.0 - ext) * (1.0 + 1.5 * crest * smoothstep(1.0, 9.0, depth));     // light glows through the thin tops of waves
    body = mix(body,body*vec3(.88,.92,.88),cove);
    body *= 1.-cove*(1.-smoothstep(.4,7.,rockDistance))*.36;
    vec3 wcol = mix(body, skyR, fres * (1.-.27*cove));
    float sp = mix(700.0, 70.0, smoothstep(60.0, 7000.0, dist));
    float nh = max(dot(Nw, normalize(uSunDir + V)), 0.0);
    wcol += uSunColor * shadow * pow(nh, sp) * (sp + 8.0) / 25.0 * (0.05 + 0.85 * fres);
    wcol += uSunColor * shadow * pow(nh, 22.0) * 0.16 * (0.4 + 0.6 * crest) * (1.0 - isRiver);                 // the broad dazzle of the sun's road
    // foam: shore breakers + whitecaps
    float ph = depth * 3.2 - t * 1.25 + nD.r * 5.0 + nB.a * 9.0;
    float shore = (1.0 - smoothstep(0.0, 3.6, depth)) * (1.0 - isRiver);
    float lines = smoothstep(0.55, 1.0, sin(ph) * 0.5 + 0.5) * smoothstep(0.25, 0.6, nE.a + nD.a * 0.4);
    float foam = shore * (0.25 + 0.75 * lines) + (1.0 - smoothstep(0.0, 0.25, depth)) * 0.6 * (1.0 - isRiver);
    float wc = smoothstep(0.64, 0.84, g1.x * 2.0 + g0.x * 0.8 + 0.5 + (texture(uDetailTex, wp / 140.0 + t * vec2(0.012, 0.006)).a - 0.5) * 0.9) * smoothstep(8.0, 40.0, depth) * mix(0.5, 1.0, cold) * (1.0 - isRiver);
    foam = clamp(foam + wc * smoothstep(0.38, 0.68, nE.a) * 0.85, 0.0, 1.0);
    foam *= 1.0 - .76*cove;
    float wash=rockDistance+.65*sin(t*1.2+dot(wp,vec2(.24,.15)))+g2.x*.85;
    float lace=(1.-smoothstep(.05,.55,abs(wash-.9)))*smoothstep(.42,.75,nD.r+g3.y*.65);
    float fronds=texture(uDetailTex,wp*vec2(.53,1.9)+t*vec2(.005,-.008)).a;
    foam+=.075*cove*lace*smoothstep(.36,.72,fronds);
    float kelp=cove*(1.-smoothstep(.3,1.24,rockDistance))*smoothstep(.34,.64,nD.r+.35*g3.x)*
               smoothstep(.48,.70,fronds);
    wcol=mix(wcol,vec3(.145,.080,.027)*lightW,kelp*.72);
    foam = clamp(foam + wakeF * (0.1 + 0.55 * wakeRip * smoothstep(0.35, 0.7, nE.a + nD.a * 0.3)), 0.0, 1.0);
    vec3 foamCol = vec3(0.86) * (uSunColor * max(uSunDir.y, 0.05) * shadow + mix(uAmbGround, uAmbSky, 1.0));
    wcol = mix(wcol, foamCol, foam * 0.9);
    // sea ice in the far north
    float ice = (1.0 - smoothstep(0.10, 0.165, lat + (macro - 0.5) * 0.05)) * smoothstep(0.42, 0.5, nB.a * 0.6 + nC.a * 0.25 + nA.a * 0.3) * (1.0 - isRiver);
    vec3 iceCol = S(214., 232., 244.) * (uSunColor * max(dot(vec3(0., 1., 0.), uSunDir), 0.0) * shadow + uAmbSky);
    wcol = mix(wcol, iceCol, ice);
    // frozen rivers beyond the wall
    float frozen = isRiver * (1.0 - smoothstep(0.15, 0.2, lat));
    wcol = mix(wcol, iceCol * 0.92, frozen * 0.9);
    col = mix(col, wcol, waterAmt);
  }

  col = applyAtmosphere(col, vWorld, cameraPosition);
  gl_FragColor = vec4(col, 1.0);
}
`;

function ringGeometry(hole) {
  const half = N / 2, vps = N + 1;
  const pos = new Float32Array(vps * vps * 3);
  for (let j = 0; j < vps; j++) for (let i = 0; i < vps; i++) {
    const o = (j * vps + i) * 3; pos[o] = i - half; pos[o + 1] = 0; pos[o + 2] = j - half;
  }
  const idx = [];
  const hh = N / 4 - 1;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const cx = i - half, cz = j - half;
    if (hole && cx >= -hh && cx + 1 <= hh && cz >= -hh && cz + 1 <= hh) continue;
    const a = j * vps + i, b = a + 1, c = a + vps, d = c + 1;
    if ((i + j) % 2 === 0) idx.push(a, c, b, b, c, d); else idx.push(a, c, d, a, d, b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  return geo;
}

export class Terrain {
  constructor(field, detailTex, ground) {
    this.field = field;
    this.group = new THREE.Group();
    this.scorch = []; for (let i = 0; i < 24; i++) this.scorch.push(new THREE.Vector4(0, 0, 0, 0));
    this.scorchIdx = 0;
    this.paveTex = new THREE.DataTexture(new Uint8Array([0]), 1, 1, THREE.RedFormat); this.paveTex.needsUpdate = true;
    const shared = {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.lights),
      uHeightTex: { value: field.heightTex }, uNormalTex: { value: field.normalTex }, uBiomeTex: { value: field.biomeTex },
      uDetailTex: { value: detailTex }, uShadowBake: { value: field.shadowTex },
      uMapSize: { value: new THREE.Vector2(MAP.W, MAP.H) },
      uCoastVisible: { value: 0 }, uCoastCentre: { value: new THREE.Vector2() },
      uCoastRipple: { value: null }, uCoastContact: { value: null }, uCoastMirror: { value: null }, uCoastProject: { value: new THREE.Matrix4() },
      uTime: G.uTime, uSunDir: G.uSunDir, uSunColor: G.uSunColor, uAmbSky: G.uAmbSky, uAmbGround: G.uAmbGround,
      uSkyLUT: G.uSkyLUT, uTrueSunDir: G.uTrueSunDir, uFogParams: G.uFogParams,
      uWeather: G.uWeather, uCloudParams: G.uCloudParams, uWind: G.uWind,
      uFireLight: G.uFireLight, uFireColor: G.uFireColor,
      uScorch: { value: this.scorch },
      uPaveMap: { value: this.paveTex }, uWake: G.uWake,
      uGroundAlb: { value: ground.albedo }, uGroundNrm: { value: ground.normal }, uTexMean: { value: ground.means },
      uCanopy: { value: null }, uCanopyK: { value: 1 },      // the forest's canopy map (set by main.js once the trees exist) and how strongly it shades the ground
    };
    this.shared = shared;
    const full = ringGeometry(false), ring = ringGeometry(true);
    this.levels = [];
    for (let l = 0; l < LEVELS; l++) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG, lights: true,
        uniforms: { ...shared, uOrigin: { value: new THREE.Vector2() }, uScale: { value: S0 * (1 << l) }, uLevel: { value: l } },
      });
      const mesh = new THREE.Mesh(l === 0 ? full : ring, mat);
      mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
      mesh.renderOrder = -10 + l * 0.01;
      this.group.add(mesh); this.levels.push(mesh);
    }
  }
  update(camPos) {
    for (let l = 0; l < LEVELS; l++) {
      const s = S0 * (1 << l), snap = s * 2;
      this.levels[l].material.uniforms.uOrigin.value.set(Math.floor(camPos.x / snap) * snap, Math.floor(camPos.z / snap) * snap);
    }
  }
  setPaving(tex) { this.paveTex = tex; for (const m of this.levels) m.material.uniforms.uPaveMap.value = tex; }
  addScorch(x, z, radius, heat = 1) {
    this.scorch[this.scorchIdx].set(x, z, radius, heat);
    this.scorchIdx = (this.scorchIdx + 1) % this.scorch.length;
  }
  coolScorch(dt) { for (const s of this.scorch) if (s.w > 0) s.w = Math.max(0, s.w - dt * 0.12); }
}
