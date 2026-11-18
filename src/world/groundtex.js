// Scanned ground materials (Poly Haven, CC0) packed into two texture arrays for the terrain shader.
import * as THREE from 'three';

export const GROUND_LAYERS = ['leafy_grass', 'forest_ground_04', 'rock_face', 'coast_sand_01', 'snow_02', 'aerial_grass_rock', 'rocky_terrain_02', 'cobblestone_floor_04'];
const S = 1024;

function loadImage(url) {
  return new Promise((resolve, reject) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = () => reject(new Error('missing ' + url)); im.src = url; });
}
function pixels(img, ctx) { ctx.clearRect(0, 0, S, S); ctx.drawImage(img, 0, 0, S, S); return ctx.getImageData(0, 0, S, S).data; }
const lin = (v) => Math.pow(v / 255, 2.2);

function arrayTex(data, w, h, d, srgb) {
  const t = new THREE.DataArrayTexture(data, w, h, d);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
  return t;
}

// → { albedo, normal, means } ; albedo.rgb = colour, normal.rg = tangent normal, normal.b = height
export async function loadGroundTextures() {
  const L = GROUND_LAYERS.length;
  const means = []; for (let i = 0; i < L; i++) means.push(new THREE.Vector3(0.2, 0.2, 0.2));
  try {
    const cv = document.createElement('canvas'); cv.width = cv.height = S; const ctx = cv.getContext('2d', { willReadFrequently: true });
    const alb = new Uint8Array(S * S * 4 * L), nrm = new Uint8Array(S * S * 4 * L);
    const imgs = await Promise.all(GROUND_LAYERS.flatMap(id => ['diff', 'nor', 'disp'].map(k => loadImage(`/textures/${id}/${k}.jpg`))));
    for (let l = 0; l < L; l++) {
      const o = l * S * S * 4;
      const d = pixels(imgs[l * 3], ctx); alb.set(d, o);
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4 * 37) { r += lin(d[i]); g += lin(d[i + 1]); b += lin(d[i + 2]); n++; }
      means[l].set(r / n, g / n, b / n);
      const nd = pixels(imgs[l * 3 + 1], ctx); nrm.set(nd, o);
      const hd = pixels(imgs[l * 3 + 2], ctx);
      for (let i = 0; i < S * S; i++) { nrm[o + i * 4 + 2] = hd[i * 4]; nrm[o + i * 4 + 3] = 255; }
    }
    return { albedo: arrayTex(alb, S, S, L, true), normal: arrayTex(nrm, S, S, L, false), means, loaded: true };
  } catch (e) {
    console.warn('[ground textures] falling back to procedural detail:', e.message);
    const alb = new Uint8Array(4 * L), nrm = new Uint8Array(4 * L);
    for (let l = 0; l < L; l++) { alb.set([124, 124, 124, 255], l * 4); nrm.set([128, 128, 128, 255], l * 4); means[l].set(0.2, 0.2, 0.2); }
    return { albedo: arrayTex(alb, 1, 1, L, true), normal: arrayTex(nrm, 1, 1, L, false), means, loaded: false };
  }
}
