// Small skinned-geometry builder used by the dragon and rider models.
import * as THREE from 'three';

export class GeoBuilder {
  constructor() {
    this.pos = []; this.nrm = []; this.uv = []; this.col = []; this.si = []; this.sw = []; this.idx = [];
    this.count = 0;
    this.soft = [];      // vertex / index ranges of the fleshy parts (exported to Blender for the fused skin)
  }
  beginSoft() { this._s = [this.count, this.idx.length]; }
  endSoft() { this.soft.push([this._s[0], this.count, this._s[1], this.idx.length]); }
  vertex(p, n, uv, c, sk) {
    this.pos.push(p.x, p.y, p.z); this.nrm.push(n.x, n.y, n.z); this.uv.push(uv[0], uv[1]); this.col.push(c[0], c[1], c[2]);
    const s = [0, 0, 0, 0], w = [0, 0, 0, 0];
    let tot = 0;
    const merged = new Map();
    for (const [b, wt] of sk) if (wt > 0) merged.set(b, (merged.get(b) || 0) + wt);
    const list = Array.from(merged.entries()).sort((a, b) => b[1] - a[1]).slice(0, 4);
    for (let i = 0; i < list.length; i++) { s[i] = list[i][0]; w[i] = list[i][1]; tot += list[i][1]; }
    if (tot <= 0) { w[0] = 1; tot = 1; }
    this.si.push(s[0], s[1], s[2], s[3]); this.sw.push(w[0] / tot, w[1] / tot, w[2] / tot, w[3] / tot);
    return this.count++;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
  // Parametric grid. fn(i, j) → { p, uv, c, sk }. wrapU: column nu coincides with column 0.
  grid(nu, nv, fn, wrapU = false, outward = true) {
    const P = [], D = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const d = fn(i, j); D.push(d); P.push(d.p); }
    const at = (i, j) => P[j * (nu + 1) + i];
    const N = [];
    const du = new THREE.Vector3(), dv = new THREE.Vector3();
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      let i0 = i - 1, i1 = i + 1;
      if (wrapU) { i0 = (i - 1 + nu) % nu; i1 = (i + 1) % nu; } else { i0 = Math.max(0, i0); i1 = Math.min(nu, i1); }
      const j0 = Math.max(0, j - 1), j1 = Math.min(nv, j + 1);
      du.subVectors(at(i1, j), at(i0, j)); dv.subVectors(at(i, j1), at(i, j0));
      const n = new THREE.Vector3().crossVectors(dv, du);
      if (n.lengthSq() < 1e-12) { n.copy(dv); if (j === 0) n.negate(); }
      N.push(n.normalize());
    }
    // orientation: for tubes make normals point away from the ring centroid
    let sgn = 1;
    if (wrapU) {
      const jm = nv >> 1; const c = new THREE.Vector3();
      for (let i = 0; i < nu; i++) c.add(at(i, jm)); c.multiplyScalar(1 / nu);
      let acc = 0;
      for (let i = 0; i < nu; i++) acc += N[jm * (nu + 1) + i].dot(new THREE.Vector3().subVectors(at(i, jm), c));
      sgn = acc >= 0 ? 1 : -1;
      if (!outward) sgn = -sgn;
    } else if (!outward) sgn = -1;
    const base = this.count;
    for (let k = 0; k < P.length; k++) { const d = D[k]; this.vertex(d.p, d.n ? d.n : N[k].multiplyScalar(sgn), d.uv, d.c, d.sk); }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = base + j * (nu + 1) + i, b = a + 1, c = a + (nu + 1), d = c + 1;
      if (sgn > 0) { this.tri(a, c, b); this.tri(b, c, d); } else { this.tri(a, b, c); this.tri(b, d, c); }
    }
  }
  // Tube through path points [{p, r, sk, c?}]; elliptical via r2 (second radius) optional.
  tube(path, M, color, opts = {}) {
    const n = path.length;
    const tang = [], nor = [], bin = [];
    for (let i = 0; i < n; i++) {
      const t = new THREE.Vector3().subVectors(path[Math.min(n - 1, i + 1)].p, path[Math.max(0, i - 1)].p).normalize();
      tang.push(t);
    }
    let up = opts.up ? opts.up.clone() : new THREE.Vector3(0, 1, 0);
    if (Math.abs(tang[0].dot(up)) > 0.9) up.set(1, 0, 0);
    for (let i = 0; i < n; i++) {
      const b = new THREE.Vector3().crossVectors(tang[i], up).normalize();
      const nn = new THREE.Vector3().crossVectors(b, tang[i]).normalize();
      nor.push(nn); bin.push(b); up = nn;
    }
    let len = 0; const lens = [0];
    for (let i = 1; i < n; i++) { len += path[i].p.distanceTo(path[i - 1].p); lens.push(len); }
    const uvs = opts.uvScale || 0.5;
    this.grid(M, n - 1, (i, j) => {
      const a = (i / M) * Math.PI * 2;
      const pt = path[j]; const r1 = pt.r, r2 = pt.r2 ?? pt.r;
      const p = pt.p.clone().addScaledVector(bin[j], Math.cos(a) * r1).addScaledVector(nor[j], Math.sin(a) * r2);
      return { p, uv: [i / M * (opts.uRepeat || 2), lens[j] * uvs], c: pt.c || color, sk: pt.sk };
    }, true);
  }
  // Ellipsoid lump (muscle mass, knuckle, eyeball...). color may be a function (unit normal) → rgb.
  blob(center, radii, color, sk, nu = 12, nv = 8, uvs = 0.5) {
    this.grid(nu, nv, (i, j) => {
      const th = (i / nu) * Math.PI * 2, ph = (j / nv) * Math.PI;
      const d = new THREE.Vector3(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th));
      const p = new THREE.Vector3(center.x + d.x * radii.x, center.y + d.y * radii.y, center.z + d.z * radii.z);
      const n = new THREE.Vector3(d.x / radii.x, d.y / radii.y, d.z / radii.z).normalize();
      return { p, n, uv: [i / nu * radii.x * 4 * uvs, j / nv * radii.y * 4 * uvs], c: typeof color === 'function' ? color(d) : color, sk };
    }, true);
  }
  // Cone / spike from base centre to tip.
  spike(base, tip, r, M, color, sk, side) {
    const axis = new THREE.Vector3().subVectors(tip, base);
    const path = [{ p: base.clone(), r, sk }, { p: base.clone().addScaledVector(axis, 0.45), r: r * 0.62, sk }, { p: tip.clone(), r: 0.004, sk }];
    this.tube(path, M, color, { up: side });
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

// piecewise-linear lookup with smooth interpolation: keys [[x, v], ...] sorted by x
export function curve(keys, x) {
  if (x <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (x <= keys[i][0]) {
      const t = (x - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]);
      const s = t * t * (3 - 2 * t);
      return keys[i - 1][1] + (keys[i][1] - keys[i - 1][1]) * s;
    }
  }
  return keys[keys.length - 1][1];
}
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const mixC = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const hexC = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
