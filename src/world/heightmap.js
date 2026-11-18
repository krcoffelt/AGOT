// Builds the Westeros heightfield: authored masks (CPU) → GPU synthesis → CPU readback.
import * as THREE from 'three';
import {
  MAP, REGION, MAINLAND, ISLANDS, LAKES, MOUNTAINS, HILLS, RIVERS, FORESTS, DESERT, SWAMP, FARMS, LANDMARKS, toWorld,
} from './mapdata.js';
import { GLSL_NOISE, fsQuad, fsMaterial } from '../core/glsl.js';
import { mulberry32, sampleDetailR } from '../core/noise.js';

// detail displacement constants (shared CPU / GPU)
export const DETAIL = { T1: 3600, A1: 46, T2: 700, A2: 9, O2: 0.37 };
// detail octave 1 is partly ridged: d = A1 * (0.35 r + 0.65 (1 - 2|r|)), r = 2R - 1

// ------------------------------------------------------------ mask helpers
function blobPoints(b, n = 30) {
  const rnd = mulberry32(b.seed * 7919 + 13);
  const ph = [rnd() * 6.283, rnd() * 6.283, rnd() * 6.283];
  const rot = (b.rot || 0) * Math.PI / 180, cr = Math.cos(rot), sr = Math.sin(rot);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const wob = 1 + 0.15 * Math.sin(2 * a + ph[0]) + 0.10 * Math.sin(3 * a + ph[1]) + 0.07 * Math.sin(5 * a + ph[2]);
    const x = Math.cos(a) * b.r[0] * wob, y = Math.sin(a) * b.r[1] * wob;
    pts.push([b.c[0] + x * cr - y * sr, b.c[1] + x * sr + y * cr]);
  }
  return pts;
}
function traceClosed(ctx, pts, sx, sy) {
  const n = pts.length;
  const mid = (a, b) => [(a[0] + b[0]) * 0.5 * sx, (a[1] + b[1]) * 0.5 * sy];
  let m = mid(pts[n - 1], pts[0]);
  ctx.beginPath(); ctx.moveTo(m[0], m[1]);
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n]; m = mid(p, q);
    ctx.quadraticCurveTo(p[0] * sx, p[1] * sy, m[0], m[1]);
  }
  ctx.closePath();
}
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  const f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])];
}
// smooth polyline; meander > 0 adds lateral sine offsets that vanish at control points. Segments shorter than 1.6 map units
// get a smaller swing, so a course drawn with close-set points (a river led round a town's walls) is followed closely.
export function smoothLine(pts, meander = 0, seed = 1) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const steps = Math.max(4, Math.ceil(len / 0.2));
    const k = Math.max(1, Math.round(len / 3.2));
    const sign = ((i + seed) % 2) ? 1 : -1;
    const amp = meander * Math.min(1, (len / 1.6) ** 2);
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const p = catmull(p0, p1, p2, p3, t);
      if (meander > 0) {
        const q = catmull(p0, p1, p2, p3, t + 0.01);
        let tx = q[0] - p[0], ty = q[1] - p[1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
        const off = amp * sign * Math.sin(Math.PI * 2 * k * t) * (0.6 + 0.4 * Math.sin(t * 9.1 + i * 2.3 + seed));
        p[0] += -ty * off; p[1] += tx * off;
      }
      out.push(p);
    }
  }
  out.push(pts[n - 1].slice());
  return out;
}
function strokeLine(ctx, pts, sx, sy) {
  ctx.beginPath(); ctx.moveTo(pts[0][0] * sx, pts[0][1] * sy);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * sx, pts[i][1] * sy);
  ctx.stroke();
}
function readR(ctx, W, H) {
  const d = ctx.getImageData(0, 0, W, H).data; const out = new Float32Array(W * H);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4] / 255;
  return out;
}
function boxBlur(a, W, H, r, iters = 2) {
  const tmp = new Float32Array(a.length); const inv = 1 / (2 * r + 1);
  for (let it = 0; it < iters; it++) {
    for (let y = 0; y < H; y++) {
      const o = y * W; let s = 0;
      for (let k = -r; k <= r; k++) s += a[o + Math.min(W - 1, Math.max(0, k))];
      for (let x = 0; x < W; x++) { tmp[o + x] = s * inv; s += a[o + Math.min(W - 1, x + r + 1)] - a[o + Math.max(0, x - r)]; }
    }
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += tmp[Math.min(H - 1, Math.max(0, k)) * W + x];
      for (let y = 0; y < H; y++) { a[y * W + x] = s * inv; s += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x]; }
    }
  }
  return a;
}
function chamfer(d, W, H) {
  const D = 1.41421356;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; let v = d[i]; if (v === 0) continue;
    if (x > 0) v = Math.min(v, d[i - 1] + 1);
    if (y > 0) { v = Math.min(v, d[i - W] + 1); if (x > 0) v = Math.min(v, d[i - W - 1] + D); if (x < W - 1) v = Math.min(v, d[i - W + 1] + D); }
    d[i] = v;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x; let v = d[i]; if (v === 0) continue;
    if (x < W - 1) v = Math.min(v, d[i + 1] + 1);
    if (y < H - 1) { v = Math.min(v, d[i + W] + 1); if (x < W - 1) v = Math.min(v, d[i + W + 1] + D); if (x > 0) v = Math.min(v, d[i + W - 1] + D); }
    d[i] = v;
  }
}
function fillShapes(ctx, list, sx, sy) {
  for (const f of list) {
    const g = Math.round(255 * (f.d ?? f.s ?? 1));
    ctx.fillStyle = `rgb(${g},${g},${g})`;
    if (f.poly) { traceClosed(ctx, f.poly, sx, sy); ctx.fill(); }
    else { ctx.beginPath(); ctx.ellipse(f.c[0] * sx, f.c[1] * sy, f.r[0] * sx, f.r[1] * sy, 0, 0, Math.PI * 2); ctx.fill(); }
  }
}

export function buildMasks() {
  // the masks cover the playable REGION; shapes are authored in whole-map units, so the canvas is shifted onto the region,
  // and widths / blur radii given in pixels are scaled by K to stay the same on the ground at the finer resolution
  const W = MAP.MASK_W, H = MAP.MASK_H, sx = W / (REGION.x1 - REGION.x0), sy = H / (REGION.y1 - REGION.y0), K = MAP.PX_SCALE;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const onMap = () => ctx.setTransform(1, 0, 0, 1, -REGION.x0 * sx, -REGION.y0 * sy);
  const clear = () => { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); onMap(); };
  const blur = (a, r, it) => boxBlur(a, W, H, Math.max(1, Math.round(r * K)), it);

  // ---- land / sea SDF
  clear(); ctx.fillStyle = '#fff';
  traceClosed(ctx, MAINLAND, sx, sy); ctx.fill();
  for (const isl of ISLANDS) if (!isl.inLake) { traceClosed(ctx, blobPoints(isl), sx, sy); ctx.fill(); }
  ctx.fillStyle = '#000';
  for (const l of LAKES) { traceClosed(ctx, blobPoints(l), sx, sy); ctx.fill(); }
  ctx.fillStyle = '#fff';
  for (const isl of ISLANDS) if (isl.inLake) { traceClosed(ctx, blobPoints(isl), sx, sy); ctx.fill(); }
  // the world's edge: the land gives way to open sea before the border (soft, wandering shore rather than a straight cut)
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#000';
  { const e = REGION.EDGE * sx, rnd = mulberry32(77), wob = () => e * (0.55 + 0.6 * rnd()); ctx.beginPath(); ctx.rect(0, 0, W, H);
    const n = 48, pts = [];
    for (let i = 0; i < n; i++) { const t = i / n; pts.push([t * W, wob()]); }
    for (let i = 0; i < n; i++) { const t = i / n; pts.push([W - wob(), t * H]); }
    for (let i = 0; i < n; i++) { const t = i / n; pts.push([W - t * W, H - wob()]); }
    for (let i = 0; i < n; i++) { const t = i / n; pts.push([wob(), H - t * H]); }
    ctx.moveTo(pts[0][0], pts[0][1]); for (const q of pts) ctx.lineTo(q[0], q[1]); ctx.closePath(); ctx.fill('evenodd'); }
  onMap();
  const land = readR(ctx, W, H);
  const dIn = new Float32Array(W * H), dOut = new Float32Array(W * H);
  for (let i = 0; i < land.length; i++) { const on = land[i] > 0.5; dIn[i] = on ? 1e6 : 0; dOut[i] = on ? 0 : 1e6; }
  chamfer(dIn, W, H); chamfer(dOut, W, H);
  const px = MAP.W / W;
  const sdf = new Float32Array(W * H);
  for (let i = 0; i < sdf.length; i++) sdf[i] = (dIn[i] > 0 ? dIn[i] - 0.5 : -(dOut[i] - 0.5)) * px;
  blur(sdf, 1, 1);

  // ---- feature channels
  const lineSetup = () => { ctx.lineCap = 'round'; ctx.lineJoin = 'round'; };
  // mountains
  clear(); lineSetup(); ctx.globalCompositeOperation = 'lighter';
  for (const m of MOUNTAINS) {
    const g = Math.round(255 * m.s); ctx.strokeStyle = `rgb(${g},${g},${g})`; ctx.lineWidth = m.w * sx * 1.0;
    strokeLine(ctx, smoothLine(m.pts), sx, sy);
  }
  const mount = blur(readR(ctx, W, H), 12, 2);
  // river valleys (wide)
  clear(); lineSetup(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 13 * K;
  RIVERS.forEach((r, i) => strokeLine(ctx, smoothLine(r.pts, 0.3, i), sx, sy));
  const valley = blur(readR(ctx, W, H), 8, 2);
  // forest / desert / swamp / farms / hills
  clear(); ctx.globalCompositeOperation = 'lighten'; fillShapes(ctx, FORESTS, sx, sy);
  const forest = blur(readR(ctx, W, H), 5, 2);
  clear(); ctx.globalCompositeOperation = 'lighten'; fillShapes(ctx, DESERT, sx, sy);
  const desert = blur(readR(ctx, W, H), 14, 2);
  clear(); ctx.globalCompositeOperation = 'lighten'; fillShapes(ctx, SWAMP, sx, sy);
  const swamp = blur(readR(ctx, W, H), 10, 2);
  clear(); ctx.globalCompositeOperation = 'lighten'; fillShapes(ctx, FARMS, sx, sy);
  const farm = blur(readR(ctx, W, H), 8, 2);
  clear(); ctx.globalCompositeOperation = 'lighten'; fillShapes(ctx, HILLS, sx, sy);
  const hills = blur(readR(ctx, W, H), 14, 2);

  const feat1 = new Uint8Array(W * H * 4), feat2 = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    feat1[i * 4] = mount[i] * 255; feat1[i * 4 + 1] = valley[i] * 255; feat1[i * 4 + 2] = forest[i] * 255; feat1[i * 4 + 3] = desert[i] * 255;
    feat2[i * 4] = swamp[i] * 255; feat2[i * 4 + 1] = farm[i] * 255; feat2[i * 4 + 2] = hills[i] * 255; feat2[i * 4 + 3] = 255;
  }

  // ---- rivers at full resolution
  const RW = MAP.TEX_W, RH = MAP.TEX_H;
  const rc = document.createElement('canvas'); rc.width = RW; rc.height = RH;
  const rctx = rc.getContext('2d', { willReadFrequently: true });
  rctx.fillStyle = '#000'; rctx.fillRect(0, 0, RW, RH);
  rctx.lineCap = 'round'; rctx.lineJoin = 'round'; rctx.strokeStyle = '#fff';
  const rsx = RW / (REGION.x1 - REGION.x0), rsy = RH / (REGION.y1 - REGION.y0); rctx.setTransform(1, 0, 0, 1, -REGION.x0 * rsx, -REGION.y0 * rsy);
  RIVERS.forEach((r, i) => { rctx.lineWidth = (4.4 * r.w + 2.2) * K; strokeLine(rctx, smoothLine(r.pts, 0.3, i), rsx, rsy); });
  const rf = boxBlur(readR(rctx, RW, RH), RW, RH, Math.round(K), 2);
  const river = new Uint8Array(RW * RH);
  for (let i = 0; i < river.length; i++) river[i] = rf[i] * 255;

  return { sdf, feat1, feat2, river, W, H, RW, RH };
}

// --------------------------------------------------------------- stamps
// per-landmark terrain sculpting. offsets in metres from the landmark position.
// type: 1 hill(+H), 2 mesa(abs top), 3 spire(abs peak), 4 volcano(+H, crater), 5 rough hills(+H, noise-broken)
// mesa options: soft = share of R given to the slope; flat = radius (m) that is guaranteed to be level plateau whatever the
// edge noise does (what the castle on top needs); crag = 1 shapes the slope as a rock face (sheer wall, scree, gullies).
const SITE_STAMPS = {
  // King's Landing climbs three hills above the bay; the land behind it rises gently westward
  kingslanding: [
    { t: 1, o: [-700, -100], R: 1000, H: 20 },
    { t: 5, o: [-2500, -700], R: 1700, H: 230 }, { t: 5, o: [-2200, 1400], R: 1300, H: 160 }, { t: 5, o: [-1000, -2400], R: 1500, H: 190 },   // hills behind the city
    { t: 1, o: [925, 400], R: 250, H: 30 }, { t: 2, o: [925, 400], R: 178, H: 92, soft: 0.2, flat: 118, crag: 1 },      // Aegon's High Hill: a sheer crag rising out of the water, the Red Keep on its crown
    { t: 1, o: [-360, 250], R: 430, H: 46 }, { t: 2, o: [-360, 250], R: 150, H: 70, soft: 0.3 },    // Visenya's Hill (Great Sept)
    { t: 1, o: [40, -400], R: 430, H: 40 }, { t: 2, o: [40, -400], R: 150, H: 62, soft: 0.3 },      // Rhaenys's Hill (Dragonpit)
    { t: 1, o: [330, 80], R: 300, H: 14 }, { t: 1, o: [-200, -180], R: 260, H: 12 }, { t: 1, o: [-80, 520], R: 260, H: 9 },
  ],
  eyrie: [
    { t: 3, o: [0, 0], R: 620, H: 1560, pre: true },
    { t: 2, o: [0, 0], R: 130, H: 1480, soft: 0.3, pre: true },
  ],
  casterlyrock: [{ t: 2, o: [0, 0], R: 470, H: 380, soft: 0.45, flat: 250, pre: true }],     // the Rock towers over Lannisport; the curtain wall rings the top at up to 232 m
  dragonstone: [{ t: 4, o: [980, 560], R: 880, H: 560, crater: 120, depth: 80 }],
  pyke: [
    { t: 2, o: [0, 0], R: 150, H: 82, soft: 0.3, pre: true },
    { t: 2, o: [70, 230], R: 85, H: 78, soft: 0.3, pre: true },
    { t: 2, o: [-20, 420], R: 70, H: 72, soft: 0.3, pre: true },
    { t: 2, o: [110, 590], R: 60, H: 66, soft: 0.3, pre: true },
  ],
  fist: [{ t: 1, o: [0, 0], R: 480, H: 190 }, { t: 2, o: [0, 0], R: 150, H: -1, soft: 0.5, rel: 150 }],
  highgarden: [{ t: 1, o: [0, 0], R: 620, H: 50 }],
  stormsend: [],
  oldtown: [{ t: 2, o: [-600, 1160], R: 120, H: 16, soft: 0.35, pre: true }],
};
const NO_FLATTEN = new Set(['eyrie', 'casterlyrock', 'pyke', 'fist']);
// Walled towns whose streets fill the flattened ground: no river water is drawn inside their walls. Their rivers are led
// round the walls in mapdata (RIVERS); a river drawn through one of these sites would stop at the wall, so move the river.
// Riverrun and the Twins stand in their rivers and are deliberately not listed.
const DRY_KINDS = new Set(['town', 'oldtown', 'kingslanding']);

// ------------------------------------------------------------- GPU shaders
const GEN_COMMON = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D uSdf, uFeat1, uFeat2, uRiver;
uniform vec2 uMapSize;
uniform vec4 uSites[48];
uniform int uSiteCount;
${GLSL_NOISE}
struct Gen { float h; float river; float forest; float amp; float desert; float swamp; float farm; float mt; };
Gen generate(vec2 p){
  float att = 0.0;
  for (int i = 0; i < 48; i++) { if (i >= uSiteCount) break; vec4 s = uSites[i]; att = max(att, 1.0 - smoothstep(s.z*1.2+200.0, s.z*3.0+1500.0, distance(p, s.xy))); }
  vec2 w1 = vec2(fbm(p*0.00022+vec2(3.1,7.7)), fbm(p*0.00022+vec2(19.3,2.9))) - 0.5;
  vec2 w2 = vec2(fbm(p*0.0011+vec2(5.0,1.0)), fbm(p*0.0011+vec2(31.0,17.0))) - 0.5;
  vec2 q = p + (w1*1500.0 + w2*280.0) * (1.0 - att);
  vec2 uv = q / uMapSize + 0.5;
  float sdf = texture(uSdf, uv).r;
  sdf += ((fbm(p*0.0035) - 0.5) * 170.0 + (fbm(p*0.0009 + 4.7) - 0.5) * 520.0) * (1.0 - att);
  vec4 f1 = texture(uFeat1, uv);
  vec4 f2 = texture(uFeat2, uv);
  float riv = texture(uRiver, uv).r;
  float mt = f1.r, valley = f1.g, swamp = f2.r, hillMask = f2.b, desert = f1.a;

  float inland = smoothstep(0.0, 5000.0, sdf);
  float region = fbm(p*0.00006 + 11.0);
  float base = 4.0 + inland * (16.0 + 95.0*region*region);
  float hills = (terrainE(p*0.0005 + 40.0, 8) - 0.38) * (26.0 + 160.0*hillMask);
  hills *= smoothstep(50.0, 1500.0, sdf);
  float mShape = ridged(p*0.00016 + 7.0, 8);
  float mE = terrainE(p*0.00034 + 90.0, 9);
  float mm = pow(mt, 1.2);
  float mountains = mm * (260.0 + 1750.0*mShape*(0.5+0.5*mE) + 260.0*mE);
  mountains *= (1.0 - 0.8*valley);
  float land = base + hills*(1.0-0.6*valley)*(1.0-0.85*swamp) + mountains;
  land = mix(land, 2.6 + 2.4*fbm(p*0.004), swamp*0.88);
  // dunes
  float duneAmt = desert * (1.0 - smoothstep(0.08, 0.35, mt)) * smoothstep(150.0, 1200.0, sdf) * (1.0 - valley);
  float dn = fbm(p*0.0016 + 3.0)*2.0 - 1.0;
  float dr = 1.0 - abs(sin(p.x*0.0105 + p.y*0.0061 + dn*5.0));
  land += duneAmt * (dr*dr*17.0 + fbm3(p*0.004)*9.0);

  float cliff = smoothstep(0.50, 0.66, fbm(p*0.00025 + 23.0)) * (1.0 - swamp) * (1.0 - att);
  cliff = max(cliff, smoothstep(0.2, 0.55, mt));
  float rise = mix(smoothstep(-20.0, 800.0, sdf), smoothstep(-6.0, 110.0, sdf), cliff);
  float beach = clamp(sdf*0.03, -3.0, 2.4);
  float hLand = beach + land*rise;
  float o = max(-sdf, 0.0);
  float hSea = -(o*0.04 + 55.0*smoothstep(0.0, 3500.0, o) + 180.0*smoothstep(2500.0, 14000.0, o));
  float h = sdf > 0.0 ? hLand : max(hSea, -400.0);

  // rivers: carve a smooth channel whose bed is the water surface
  float landMask = smoothstep(0.0, 60.0, sdf);
  float r = riv * landMask;
  float riverLevel = beach + mix(land, base, 0.85)*rise - 1.6;
  // the channel is cut right through the beach (its bed is below sea level there), so a river mouth opens into the sea
  // instead of stopping behind a sand bar where the drawn river mask fades out
  h = mix(h, min(h, riverLevel), smoothstep(0.12, 0.5, riv * smoothstep(-40.0, 10.0, sdf)));

  Gen g;
  g.h = h;
  g.river = r;
  g.forest = f1.b * smoothstep(60.0, 220.0, sdf) * (1.0 - smoothstep(0.25, 0.5, r)) * (1.0 - 0.9*desert);
  g.amp = clamp(0.07 + mm*1.0 + hillMask*0.22 + cliff*0.25*smoothstep(0.0,100.0,sdf), 0.0, 1.0) * (1.0 - smoothstep(0.1,0.4,r)) * (1.0 - swamp*0.8) * smoothstep(-80.0, 20.0, sdf);
  g.desert = desert; g.swamp = swamp;
  g.farm = f2.g * (1.0 - smoothstep(0.05, 0.3, mt)) * smoothstep(100.0, 500.0, sdf) * (1.0 - smoothstep(0.3,0.6,f1.b));
  g.mt = mt;
  return g;
}
`;
const GEN_HEIGHT = GEN_COMMON + /* glsl */`
void main(){ Gen g = generate((vUv - 0.5) * uMapSize); gl_FragColor = vec4(g.h, g.river, g.forest, g.amp); }`;
const GEN_BIOME = GEN_COMMON + /* glsl */`
void main(){ Gen g = generate((vUv - 0.5) * uMapSize); gl_FragColor = vec4(g.desert, g.swamp, g.farm, g.mt); }`;

const STAMP_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uMapSize;
uniform vec4 uA[96]; uniform vec4 uB[96];
uniform int uCount;
${GLSL_NOISE}
void main(){
  vec4 H = texelFetch(uSrc, ivec2(gl_FragCoord.xy), 0);
  vec2 p = (vUv - 0.5) * uMapSize;
  for (int i = 0; i < 96; i++) {
    if (i >= uCount) break;
    vec4 a = uA[i], b = uB[i];
    float d = distance(p, a.xy);
    if (d > a.z * 2.4) continue;
    int type = int(b.x + 0.5);
    if (type == 0) {            // flatten to a.w
      float k = 1.0 - smoothstep(a.z*0.92, a.z*1.9, d);
      H.g *= 1.0 - b.y * (1.0 - smoothstep(a.z, a.z*1.25, d));      // b.y = 1: dry inside the walls
      float target = a.w - 2.2*smoothstep(0.2, 0.55, H.g);
      H.r = mix(H.r, target, k);
      H.a *= 1.0 - k; H.b *= 1.0 - k;
    } else if (type == 1) {     // hill
      float t = clamp(1.0 - d/a.z, 0.0, 1.0);
      H.r += a.w * t*t*(3.0-2.0*t);
    } else if (type == 5) {     // rough hills: a rise broken into spurs and gullies, to frame a city
      float t = clamp(1.0 - (d + (fbm3(p*0.0016 + a.xy*0.001) - 0.5) * a.z * 0.5)/a.z, 0.0, 1.0);
      H.r += a.w * t*t*(3.0-2.0*t) * (0.4 + 1.0*fbm3(p*0.0012 + a.xy*0.002)) * (1.0 - smoothstep(0.02, 0.35, H.g));      // a river keeps its valley through them
    } else if (type == 2) {     // mesa with absolute top
      float n = (fbm3(p*0.011 + a.xy*0.01) - 0.5) * a.z * 0.5;
      float rin = a.z*(1.0-b.y), e = d + n;
      float k = 1.0 - smoothstep(rin, a.z, e);
      if (b.w > 0.0) {
        // crag: a sheer upper face above a scree apron instead of one even S-curve, with gullies cut back into the face.
        // The rim (t = 0) stays put and nothing reaches past R, so the plateau and the ground around the rock do not move.
        float t = clamp((e - rin) / (a.z - rin), 0.0, 1.0);
        float cut = smoothstep(0.38, 0.72, noised(p*0.019 + a.xy*0.013).x);
        t = min(1.0, t + b.w * 0.75 * cut * smoothstep(0.0, 0.3, t));
        k = 0.72 * (1.0 - smoothstep(0.02, 0.5, t)) + 0.28 * (1.0 - smoothstep(0.35, 1.0, t));
      }
      if (b.z > 0.0) k = max(k, 1.0 - smoothstep(b.z, b.z + 30.0, d));      // guaranteed level radius
      H.r = mix(H.r, max(H.r, a.w), k);
      H.a = mix(H.a, 0.15, k); H.b *= 1.0 - k; H.g *= 1.0 - k;
    } else if (type == 3) {     // spire with absolute peak
      float t = d / a.z;
      float n = 0.75 + 0.5*fbm3(p*0.006 + 3.0);
      float sp = a.w * exp(-t*t*4.2) * n;
      H.r = max(H.r, sp);
      H.a = max(H.a, exp(-t*t*2.0)); H.b *= smoothstep(0.5, 1.2, t);
    } else if (type == 4) {     // volcano
      float t = clamp(1.0 - d/a.z, 0.0, 1.0);
      float cone = a.w * pow(t, 1.6) * (0.85 + 0.3*fbm3(p*0.004));
      float cr = smoothstep(b.y*1.5, b.y*0.5, d);
      H.r += cone - cr * b.z;
      H.a = max(H.a, t*0.9); H.b *= 1.0 - smoothstep(0.1, 0.4, t);
    }
  }
  gl_FragColor = H;
}`;

const COPY_FRAG = /* glsl */`
precision highp float; varying vec2 vUv; uniform sampler2D uSrc;
void main(){ gl_FragColor = texture(uSrc, vUv); }`;

const NORMAL_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D uH; uniform vec2 uTexel; uniform float uCell;
float hh(vec2 uv, float lod){ return textureLod(uH, uv, lod).r; }
void main(){
  float hL = hh(vUv - vec2(uTexel.x,0), 0.0), hR = hh(vUv + vec2(uTexel.x,0), 0.0);
  float hU = hh(vUv - vec2(0,uTexel.y), 0.0), hD = hh(vUv + vec2(0,uTexel.y), 0.0);
  vec3 n = normalize(vec3(hL - hR, 2.0*uCell, hU - hD));
  float h = hh(vUv, 0.0);
  float occ = 0.0; float conv = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.7853982 + 0.3;
    vec2 dir = vec2(cos(a), sin(a));
    float h1 = hh(vUv + dir*uTexel*(3.0*${MAP.PX_SCALE.toFixed(3)}), 0.0), h2 = hh(vUv + dir*uTexel*(9.0*${MAP.PX_SCALE.toFixed(3)}), 1.5), h3 = hh(vUv + dir*uTexel*(26.0*${MAP.PX_SCALE.toFixed(3)}), 3.0);      // the same reach on the ground at any resolution
    occ += clamp((h1 - h)/(3.0*uCell), 0.0, 1.2)*0.45 + clamp((h2 - h)/(9.0*uCell), 0.0, 1.2)*0.35 + clamp((h3 - h)/(26.0*uCell), 0.0, 1.2)*0.3;
    conv += (h2 - h);
  }
  float ao = clamp(1.0 - occ/8.0*1.35, 0.0, 1.0);
  float cv = clamp(0.5 + conv/8.0/60.0, 0.0, 1.0);
  gl_FragColor = vec4(n.x*0.5+0.5, n.z*0.5+0.5, ao, cv);
}`;

const SHADOW_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D uH; uniform vec2 uMapSize; uniform vec3 uLight;
void main(){
  vec2 p = (vUv - 0.5) * uMapSize;
  float h0 = max(textureLod(uH, vUv, 1.0).r, 0.0) + 3.0;
  float sh = 1.0;
  float t = 40.0;
  vec2 ldir = uLight.xz; float ly = max(uLight.y, 0.02);
  for (int i = 0; i < 44; i++) {
    vec2 q = p + ldir * t;
    float hs = textureLod(uH, q / uMapSize + 0.5, 1.0 + float(i)*0.045).r;
    float ry = h0 + ly * t;
    sh = min(sh, clamp((ry - hs) / (t * 0.045) + 0.5, 0.0, 1.0));
    if (sh <= 0.0 || ry > 2600.0) break;
    t *= 1.135;
  }
  gl_FragColor = vec4(sh, sh, sh, 1.0);
}`;

// ------------------------------------------------------------ HeightField
export class HeightField {
  constructor(h, river, forest, amp, detail) {
    this.h = h; this.river = river; this.forest = forest; this.amp = amp; this.detail = detail;
    this.W = MAP.TEX_W; this.H = MAP.TEX_H;
  }
  _bil(arr, x, z) {
    const W = this.W, H = this.H;
    let fx = (x / MAP.W + 0.5) * W - 0.5, fy = (z / MAP.H + 0.5) * H - 0.5;
    if (fx < 0) fx = 0; else if (fx > W - 1.001) fx = W - 1.001;
    if (fy < 0) fy = 0; else if (fy > H - 1.001) fy = H - 1.001;
    const x0 = fx | 0, y0 = fy | 0; const tx = fx - x0, ty = fy - y0; const i = y0 * W + x0;
    const a = arr[i], b = arr[i + 1], c = arr[i + W], d = arr[i + W + 1];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  }
  baseHeight(x, z) { return this._bil(this.h, x, z); }
  riverAt(x, z) { return this._bil(this.river, x, z) / 255; }
  forestAt(x, z) { return this._bil(this.forest, x, z) / 255; }
  ampAt(x, z) { return this._bil(this.amp, x, z) / 255; }
  // terrain surface including detail displacement
  heightAt(x, z) {
    const b = this._bil(this.h, x, z);
    const amp = this._bil(this.amp, x, z) / 255;
    if (amp <= 0.001) return b;
    const r1 = sampleDetailR(this.detail, x / DETAIL.T1, z / DETAIL.T1) * 2 - 1;
    const d1 = DETAIL.A1 * (0.35 * r1 + 0.65 * (1 - 2 * Math.abs(r1)));
    const d2 = (sampleDetailR(this.detail, x / DETAIL.T2 + DETAIL.O2, z / DETAIL.T2 + DETAIL.O2) - 0.5) * 2 * DETAIL.A2;
    return b + amp * (d1 + d2);
  }
  // biome channels: 0 desert, 1 swamp, 2 farmland, 3 mountain mask (nearest sample, 0..1)
  biomeAt(x, z, ch) {
    const W = MAP.MASK_W, H = MAP.MASK_H;
    const ix = Math.min(W - 1, Math.max(0, Math.floor((x / MAP.W + 0.5) * W))), iy = Math.min(H - 1, Math.max(0, Math.floor((z / MAP.H + 0.5) * H)));
    return this.biome[(iy * W + ix) * 4 + ch] / 255;
  }
  // solid surface the dragon can touch: ground or water
  solidHeightAt(x, z) {
    const height = this.heightAt(x, z), rock = this.rockSurface?.(x, z);
    return rock > 0 ? Math.max(height, rock) : height;
  }
  surfaceAt(x, z) { return Math.max(0, this.solidHeightAt(x, z)); }
  isWater(x, z) {
    if (this.rockSurface?.(x, z) > 0.2) return false;
    return this._bil(this.h, x, z) < 0.2 || this.riverAt(x, z) > 0.5;
  }
  normalAt(x, z, out, e = 8) {
    const hl = this.heightAt(x - e, z), hr = this.heightAt(x + e, z), hu = this.heightAt(x, z - e), hd = this.heightAt(x, z + e);
    out.set(hl - hr, 2 * e, hu - hd).normalize();
    return out;
  }
  slopeAt(x, z) { const e = 10; const dx = this.solidHeightAt(x + e, z) - this.solidHeightAt(x - e, z), dz = this.solidHeightAt(x, z + e) - this.solidHeightAt(x, z - e); return Math.hypot(dx, dz) / (2 * e); }
}

// ----------------------------------------------------------------- build
export function buildHeightField(renderer, detail) {
  const t0 = performance.now();
  const masks = buildMasks();
  const t1 = performance.now();
  const W = MAP.TEX_W, H = MAP.TEX_H;

  const half = new Uint16Array(masks.sdf.length);
  for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(Math.max(-60000, Math.min(60000, masks.sdf[i])));
  const mkTex = (data, w, h, fmt, type) => {
    const t = new THREE.DataTexture(data, w, h, fmt, type);
    t.minFilter = t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true; return t;
  };
  const sdfTex = mkTex(half, masks.W, masks.H, THREE.RedFormat, THREE.HalfFloatType);
  const feat1Tex = mkTex(masks.feat1, masks.W, masks.H, THREE.RGBAFormat, THREE.UnsignedByteType);
  const feat2Tex = mkTex(masks.feat2, masks.W, masks.H, THREE.RGBAFormat, THREE.UnsignedByteType);
  const riverTex = mkTex(masks.river, masks.RW, masks.RH, THREE.RedFormat, THREE.UnsignedByteType);

  const sites = [];
  for (const lm of LANDMARKS) { const [x, z] = toWorld(lm.pos[0], lm.pos[1]); sites.push(new THREE.Vector4(x, z, lm.r, 0)); }
  const siteCount = sites.length;
  while (sites.length < 48) sites.push(new THREE.Vector4(0, 0, 1, 0));

  const genUniforms = {
    uSdf: { value: sdfTex }, uFeat1: { value: feat1Tex }, uFeat2: { value: feat2Tex }, uRiver: { value: riverTex },
    uMapSize: { value: new THREE.Vector2(MAP.W, MAP.H) }, uSites: { value: sites }, uSiteCount: { value: siteCount },
  };
  const rtOpts = { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false };
  const rtA = new THREE.WebGLRenderTarget(W, H, rtOpts);
  const rtB = new THREE.WebGLRenderTarget(W, H, rtOpts);
  const genMat = fsMaterial(GEN_HEIGHT, genUniforms);
  fsQuad.render(renderer, genMat, rtA);

  // biome texture
  const rtBiome = new THREE.WebGLRenderTarget(MAP.MASK_W, MAP.MASK_H, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: true });
  const biomeMat = fsMaterial(GEN_BIOME, genUniforms);
  fsQuad.render(renderer, biomeMat, rtBiome);
  const biome = new Uint8Array(MAP.MASK_W * MAP.MASK_H * 4);
  renderer.readRenderTargetPixels(rtBiome, 0, 0, MAP.MASK_W, MAP.MASK_H, biome);

  // stamps: sample pass-1 heights at site centres for auto-flatten
  const A = [], B = [];
  const px1 = new Float32Array(4);
  const readH = (x, z) => {
    const ix = Math.max(0, Math.min(W - 1, Math.floor((x / MAP.W + 0.5) * W)));
    const iy = Math.max(0, Math.min(H - 1, Math.floor((z / MAP.H + 0.5) * H)));
    renderer.readRenderTargetPixels(rtA, ix, iy, 1, 1, px1); return px1[0];
  };
  const siteHeights = {};
  const pushStamp = (st, x, z, baseH) => {
    const sx = x + st.o[0], sz = z + st.o[1];
    if (st.t === 1) { A.push(new THREE.Vector4(sx, sz, st.R, st.H)); B.push(new THREE.Vector4(1, 0, 0, 0)); }
    else if (st.t === 5) { A.push(new THREE.Vector4(sx, sz, st.R, st.H)); B.push(new THREE.Vector4(5, 0, 0, 0)); }
    else if (st.t === 2) { A.push(new THREE.Vector4(sx, sz, st.R, st.rel !== undefined ? baseH + st.rel : st.H)); B.push(new THREE.Vector4(2, st.soft ?? 0.3, st.flat ?? 0, st.crag ?? 0)); }
    else if (st.t === 3) { A.push(new THREE.Vector4(sx, sz, st.R, st.H)); B.push(new THREE.Vector4(3, 0, 0, 0)); }
    else if (st.t === 4) { A.push(new THREE.Vector4(sx, sz, st.R, st.H)); B.push(new THREE.Vector4(4, st.crater, st.depth, 0)); }
  };
  for (const lm of LANDMARKS) {
    const [x, z] = toWorld(lm.pos[0], lm.pos[1]);
    const h0 = readH(x, z);
    const target = Math.max(h0, lm.minH || 0);
    siteHeights[lm.id] = target;
    const stamps = SITE_STAMPS[lm.id] || [];
    for (const st of stamps) if (st.pre) pushStamp(st, x, z, target);
    if (!NO_FLATTEN.has(lm.id)) { A.push(new THREE.Vector4(x, z, lm.r, target)); B.push(new THREE.Vector4(0, DRY_KINDS.has(lm.kind) ? 1 : 0, 0, 0)); }
    for (const st of stamps) if (!st.pre) pushStamp(st, x, z, target);
  }
  const stampCount = A.length;
  while (A.length < 96) { A.push(new THREE.Vector4()); B.push(new THREE.Vector4()); }
  const stampMat = fsMaterial(STAMP_FRAG, { uSrc: { value: rtA.texture }, uMapSize: { value: new THREE.Vector2(MAP.W, MAP.H) }, uA: { value: A }, uB: { value: B }, uCount: { value: stampCount } });
  fsQuad.render(renderer, stampMat, rtB);

  // final sampled height texture (half float, mipmapped)
  const rtHeight = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: true });
  const copyMat = fsMaterial(COPY_FRAG, { uSrc: { value: rtB.texture } });
  fsQuad.render(renderer, copyMat, rtHeight);

  const rtNormal = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: true });
  rtNormal.texture.anisotropy = 4;
  const normalMat = fsMaterial(NORMAL_FRAG, { uH: { value: rtHeight.texture }, uTexel: { value: new THREE.Vector2(1 / W, 1 / H) }, uCell: { value: MAP.W / W } });
  fsQuad.render(renderer, normalMat, rtNormal);

  // CPU readback in strips
  const h = new Float32Array(W * H), river = new Uint8Array(W * H), forest = new Uint8Array(W * H), amp = new Uint8Array(W * H);
  const STRIP = 256; const buf = new Float32Array(W * STRIP * 4);
  for (let y0 = 0; y0 < H; y0 += STRIP) {
    renderer.readRenderTargetPixels(rtB, 0, y0, W, STRIP, buf);
    let o = y0 * W;
    for (let i = 0, n = W * STRIP; i < n; i++, o++) {
      h[o] = buf[i * 4];
      river[o] = Math.max(0, Math.min(255, buf[i * 4 + 1] * 255));
      forest[o] = Math.max(0, Math.min(255, buf[i * 4 + 2] * 255));
      amp[o] = Math.max(0, Math.min(255, buf[i * 4 + 3] * 255));
    }
  }
  renderer.setRenderTarget(null);
  rtA.dispose(); rtB.dispose(); sdfTex.dispose(); feat1Tex.dispose(); feat2Tex.dispose(); riverTex.dispose();
  genMat.dispose(); biomeMat.dispose(); stampMat.dispose(); copyMat.dispose(); normalMat.dispose();

  // terrain sun-shadow bake target
  const rtShadow = new THREE.WebGLRenderTarget(1024, 2048, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
  const shadowMat = fsMaterial(SHADOW_FRAG, { uH: { value: rtHeight.texture }, uMapSize: { value: new THREE.Vector2(MAP.W, MAP.H) }, uLight: { value: new THREE.Vector3(0, 1, 0) } });

  const field = new HeightField(h, river, forest, amp, detail);
  field.heightTex = rtHeight.texture; field.normalTex = rtNormal.texture; field.biomeTex = rtBiome.texture; field.shadowTex = rtShadow.texture;
  field.siteHeights = siteHeights; field.biome = biome;
  field._lastLight = new THREE.Vector3(0, -1, 0);
  field.bakeShadow = (lightDir, force = false) => {
    if (!force && field._lastLight.dot(lightDir) > 0.99996) return false;
    field._lastLight.copy(lightDir);
    shadowMat.uniforms.uLight.value.copy(lightDir);
    fsQuad.render(renderer, shadowMat, rtShadow);
    renderer.setRenderTarget(null);
    return true;
  };
  console.log(`[heightfield] masks ${(t1 - t0).toFixed(0)} ms, gpu+readback ${(performance.now() - t1).toFixed(0)} ms`);
  return field;
}
