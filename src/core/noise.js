// CPU-side deterministic noise helpers.
import * as THREE from 'three';

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(ix, iy, seed = 0) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// periodic value noise, lattice coordinates
export function tileNoise(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const x0 = ((xi % period) + period) % period, x1 = (x0 + 1) % period;
  const y0 = ((yi % period) + period) % period, y1 = (y0 + 1) % period;
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed), c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

export function tileFbm(u, v, basePeriod, octaves, seed) {
  let amp = 0.5, sum = 0, norm = 0, p = basePeriod;
  for (let o = 0; o < octaves; o++) {
    sum += amp * tileNoise(u * p, v * p, p, seed + o * 17);
    norm += amp; amp *= 0.5; p *= 2;
  }
  return sum / norm;
}

export const DETAIL_SIZE = 512;
export const DETAIL_GK = 8;   // gradient encode gain

// RGBA8 tileable detail texture: R fbm, G/B d(R)/dx,dy (encoded), A independent fbm
export function makeDetailData() {
  const S = DETAIL_SIZE;
  const R = new Float32Array(S * S), A = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    R[y * S + x] = tileFbm(u, v, 8, 6, 11);
    A[y * S + x] = tileFbm(u, v, 6, 6, 97);
  }
  // normalise contrast
  const stretch = (arr) => {
    let mn = 1, mx = 0; for (let i = 0; i < arr.length; i++) { mn = Math.min(mn, arr[i]); mx = Math.max(mx, arr[i]); }
    for (let i = 0; i < arr.length; i++) arr[i] = (arr[i] - mn) / (mx - mn);
  };
  stretch(R); stretch(A);
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const xl = (x + S - 1) % S, xr = (x + 1) % S, yu = (y + S - 1) % S, yd = (y + 1) % S;
    const gx = (R[y * S + xr] - R[y * S + xl]) * 0.5, gy = (R[yd * S + x] - R[yu * S + x]) * 0.5;
    data[i * 4] = Math.round(R[i] * 255);
    data[i * 4 + 1] = Math.max(0, Math.min(255, Math.round((0.5 + gx * DETAIL_GK) * 255)));
    data[i * 4 + 2] = Math.max(0, Math.min(255, Math.round((0.5 + gy * DETAIL_GK) * 255)));
    data[i * 4 + 3] = Math.round(A[i] * 255);
  }
  return { data, R, size: S };
}

export function makeDetailTexture(detail) {
  const tex = new THREE.DataTexture(detail.data, detail.size, detail.size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true; tex.anisotropy = 8; tex.needsUpdate = true;
  return tex;
}

// bilinear wrap sample of the detail R channel (matches the GPU lookup)
export function sampleDetailR(detail, u, v) {
  const S = detail.size;
  let x = u * S - 0.5, y = v * S - 0.5;
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const x0 = ((xi % S) + S) % S, x1 = (x0 + 1) % S, y0 = ((yi % S) + S) % S, y1 = (y0 + 1) % S;
  const R = detail.R;
  const a = R[y0 * S + x0], b = R[y0 * S + x1], c = R[y1 * S + x0], d = R[y1 * S + x1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
