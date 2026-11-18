// Procedural textures for dragon hide and wing membrane.
import * as THREE from 'three';
import { hash2, tileFbm } from '../core/noise.js';

function heightToNormal(h, S, strength) {
  const out = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const l = h[y * S + (x + S - 1) % S], r = h[y * S + (x + 1) % S];
    const u = h[((y + S - 1) % S) * S + x], d = h[((y + 1) % S) * S + x];
    let nx = (l - r) * strength, ny = (u - d) * strength, nz = 1;
    const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
    const o = (y * S + x) * 4;
    out[o] = (nx * 0.5 + 0.5) * 255; out[o + 1] = (ny * 0.5 + 0.5) * 255; out[o + 2] = (nz * 0.5 + 0.5) * 255; out[o + 3] = 255;
  }
  return out;
}
function dataTex(data, S, srgb) {
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
  return t;
}

let _scale = null, _mem = null;
const _memMats = new Set();
// wing materials register here so they pick up the leather scan when it arrives
export function registerMembraneMaterial(m) { _memMats.add(m); if (_mem) m.normalMap = _mem.normalMap; }

// Overlapping reptile scales: albedo modulation (grey) + normal map + roughness in alpha.
export function scaleTextures() {
  if (_scale) return _scale;
  const S = 512, COLS = 8, ROWS = 8;
  const h = new Float32Array(S * S), tone = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S * COLS, v = y / S * ROWS;
    let best = 0, bestTone = 0.5;
    // check this row and the two rows above (scales overlap downward)
    for (let dr = -1; dr <= 1; dr++) {
      const row = Math.floor(v) + dr;
      const off = (((row % 2) + 2) % 2) * 0.5;
      for (let dc = -1; dc <= 1; dc++) {
        const col = Math.floor(u - off) + dc;
        const cx = col + 0.5 + off, cy = row + 0.5;
        const rr = ((row % ROWS) + ROWS) % ROWS, cc = ((col % COLS) + COLS) % COLS;
        const jit = hash2(cc, rr, 5);
        const dx = (u - cx) / (0.56 + jit * 0.06), dy = (v - cy) / 0.86;
        // rounded shield shape, pointed at the trailing (+v) edge
        const d = Math.sqrt(dx * dx + dy * dy * (dy > 0 ? 0.9 : 1.25));
        if (d < 1) {
          const dome = Math.sqrt(1 - d * d);
          const tilt = 0.45 + 0.55 * (0.5 - dy * 0.5);        // rises toward the leading edge
          const ridge = 1 - Math.min(1, Math.abs(dx) * 2.4);   // central keel
          const hh = (dome * 0.7 + 0.3 * Math.pow(dome, 0.3)) * tilt + ridge * 0.08 * dome + dr * -0.001;
          const layered = hh + (1 - (v - cy + 0.5)) * 0.15;
          if (layered > best) { best = layered; bestTone = hash2(cc, rr, 9); }
        }
      }
    }
    const grain = tileFbm(x / S, y / S, 32, 3, 77);
    h[y * S + x] = best + grain * 0.06;
    tone[y * S + x] = bestTone;
  }
  const nrm = heightToNormal(h, S, 5.5);
  const alb = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    const cav = Math.min(1, Math.max(0, (h[i] - 0.12) / 0.5));
    const g = (0.5 + 0.5 * cav) * (0.82 + 0.36 * tone[i]);
    const v = Math.min(255, g * 215);
    alb[i * 4] = v; alb[i * 4 + 1] = v; alb[i * 4 + 2] = v; alb[i * 4 + 3] = 255;
  }
  // roughness map (G channel is used by three): crevices rough, scale faces glossier
  const rough = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    const cav = Math.min(1, Math.max(0, (h[i] - 0.12) / 0.5));
    const r = 0.92 - cav * 0.42 + (tone[i] - 0.5) * 0.12;
    rough[i * 4] = 255; rough[i * 4 + 1] = Math.min(255, Math.max(0, r * 255)); rough[i * 4 + 2] = 0; rough[i * 4 + 3] = 255;
  }
  _scale = { map: dataTex(alb, S, true), normalMap: dataTex(nrm, S, false), roughnessMap: dataTex(rough, S, false) };
  return _scale;
}

// Wing membrane: veins running along v (root → trailing edge) + leathery mottling.
export function membraneTextures() {
  if (_mem) return _mem;
  const S = 512;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#9a9a9a'; ctx.fillRect(0, 0, S, S);
  // mottling
  const img = ctx.getImageData(0, 0, S, S); const d = img.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = tileFbm(x / S, y / S, 6, 5, 31), n2 = tileFbm(x / S, y / S, 24, 3, 57);
    const v = 120 + (n - 0.5) * 120 + (n2 - 0.5) * 40;
    const o = (y * S + x) * 4; d[o] = d[o + 1] = d[o + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  // veins: branching dark lines flowing along +y
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const vein = (x, y, ang, w, depth) => {
    let px = x, py = y;
    const steps = 26 + Math.floor(rnd() * 20);
    ctx.beginPath(); ctx.moveTo(px, py);
    for (let i = 0; i < steps; i++) {
      ang += (rnd() - 0.5) * 0.35; ang = Math.max(0.5, Math.min(2.64, ang));
      px += Math.cos(ang) * 9; py += Math.sin(ang) * 9;
      ctx.lineTo(px, py);
      if (depth < 3 && rnd() < 0.11) { ctx.stroke(); vein(px, py, ang + (rnd() < 0.5 ? -0.7 : 0.7), w * 0.6, depth + 1); ctx.beginPath(); ctx.moveTo(px, py); }
    }
    ctx.lineWidth = w; ctx.stroke();
  };
  ctx.strokeStyle = 'rgba(40,36,36,0.55)'; ctx.lineCap = 'round';
  for (let k = 0; k < 3; k++) for (let i = 0; i < 9; i++) {
    const x0 = (i + rnd()) / 9 * S;
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0]) { const s0 = seed; ctx.save(); ctx.translate(ox, oy); vein(x0, -10 + k * 170, Math.PI / 2, 3.2 - k * 0.5, 0); ctx.restore(); if (!(ox === S && oy === 0)) seed = s0; }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  // normal from luminance
  const src = ctx.getImageData(0, 0, S, S).data; const hh = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) hh[i] = src[i * 4] / 255;
  _mem = { map: tex, normalMap: dataTex(heightToNormal(hh, S, 2.2), S, false) };
  // scanned leather grain (Poly Haven, CC0) replaces the synthetic wing normal map once it has loaded
  new THREE.TextureLoader().load('/textures/brown_leather/nor.jpg', (lt) => {
    lt.wrapS = lt.wrapT = THREE.RepeatWrapping; lt.repeat.set(2.5, 2.5); lt.anisotropy = 8;
    _mem.normalMap = lt;
    for (const m of _memMats) { m.normalMap = lt; m.needsUpdate = true; }
  }, undefined, () => {});
  return _mem;
}
