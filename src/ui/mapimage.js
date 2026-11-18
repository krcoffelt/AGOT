// Renders a parchment-style map of Westeros from the generated heightfield.
import { MAP, REGION } from '../world/mapdata.js';

export function buildMapCanvas(field, W = 640) {
  const H = Math.round(W * MAP.H / MAP.W);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H); const d = img.data;
  const TW = field.W, TH = field.H, sx = TW / W, sy = TH / H;
  const hAt = (x, y) => field.h[Math.min(TH - 1, Math.max(0, Math.floor(y * sy))) * TW + Math.min(TW - 1, Math.max(0, Math.floor(x * sx)))];
  let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const ti = Math.min(TH - 1, Math.floor(y * sy)) * TW + Math.min(TW - 1, Math.floor(x * sx));
    const h = field.h[ti], riv = field.river[ti] / 255, forest = field.forest[ti] / 255, amp = field.amp[ti] / 255;
    const lat = (REGION.y0 + (y / H) * (REGION.y1 - REGION.y0)) / 200;
    let r, g, b;
    const grain = (rnd() - 0.5) * 7;
    if (h < 0.2) {
      const dp = Math.min(1, -h / 160);
      r = 196 - dp * 44; g = 204 - dp * 34; b = 196 - dp * 18;
      const ring = Math.max(0, 1 - Math.abs(-h - 6) / 6); r -= ring * 26; g -= ring * 22; b -= ring * 16;
      if (lat < 0.15) { r += 18; g += 16; b += 14; }
    } else {
      const hl = hAt(x - 1, y), hr = hAt(x + 1, y), hu = hAt(x, y - 1), hd = hAt(x, y + 1);
      const cell = MAP.W / W;
      let shade = ((hl - hr) * 0.7 + (hu - hd) * 0.7) / cell;       // light from NW
      shade = Math.max(-1, Math.min(1, shade * 1.6));
      r = 226; g = 208; b = 168;
      const snow = Math.max(0, Math.min(1, (0.21 - lat) / 0.07)) * 0.9 + Math.max(0, Math.min(1, (h - (lat * 2600 - 150)) / 300)) * 0.8;
      const desert = Math.max(0, Math.min(1, (lat - 0.80) / 0.04)) * Math.max(0, Math.min(1, ((REGION.x0 + (x / W) * (REGION.x1 - REGION.x0)) / 100 - 0.36) / 0.08));
      const f = Math.min(1, forest * 1.3);
      r += (150 - r) * f * 0.75; g += (164 - g) * f * 0.75; b += (112 - b) * f * 0.75;
      const m = Math.min(1, amp * 1.2 + Math.max(0, (h - 300) / 900));
      r += (176 - r) * m * 0.6; g += (156 - g) * m * 0.6; b += (128 - b) * m * 0.6;
      r += (236 - r) * desert * 0.5; g += (204 - g) * desert * 0.5; b += (142 - b) * desert * 0.5;
      const sn = Math.min(1, snow);
      r += (244 - r) * sn; g += (243 - g) * sn; b += (238 - b) * sn;
      const k = 1 + shade * 0.34; r *= k; g *= k; b *= k;
      if (riv > 0.45) { r = 128; g = 158; b = 172; }
      // coast ink
      if (hl < 0.2 || hr < 0.2 || hu < 0.2 || hd < 0.2) { r *= 0.5; g *= 0.48; b *= 0.45; }
    }
    const o = (y * W + x) * 4; d[o] = r + grain; d[o + 1] = g + grain; d[o + 2] = b + grain; d[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}
