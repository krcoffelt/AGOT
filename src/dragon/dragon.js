// Procedural skinned dragon: geometry, skeleton and procedural animation.
// Local space: +Z forward (head), +Y up, +X is the dragon's left.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GeoBuilder, curve, lerp, clamp01, mixC, hexC } from './builder.js';
import { scaleTextures, membraneTextures, registerMembraneMaterial } from './textures.js';
import { G, patchAtmosphere } from '../core/glsl.js';
import { RIGGED, RiggedDragon, loadRiggedDragons } from './rigged.js';
export { loadRiggedDragons };
// a fully rigged and animated model wins over the procedural dragon when one exists for this id
export function createDragon(def) { return RIGGED[def.id] ? new RiggedDragon(def, RIGGED[def.id]) : new Dragon(def); }

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const NECK_N = 6, TAIL_N = 10;
const lerpV = (a, b, t) => new THREE.Vector3().lerpVectors(a, b, t);
const scaleSk = (sk, f) => sk.map(([b, w]) => [b, w * f]);

// Blender-built skins, keyed by dragon id: { geo, joints: [bone names], map, normalMap }
export const DRAGON_SKINS = {};
export async function loadDragonSkins(ids) {
  await Promise.all(ids.map(async (id) => {
    try {
      const gltf = await new GLTFLoader().loadAsync(`/models/dragon_${id}.glb`); let sm = null; gltf.scene.traverse(o => { if (o.isSkinnedMesh) sm = o; });
      if (sm) DRAGON_SKINS[id] = { geo: sm.geometry, joints: sm.skeleton.bones.map(b => b.name), map: null, normalMap: null, waiting: [] };
    } catch (e) { /* no baked skin for this dragon: the procedural body is used */ }
  }));
}
// the 2k maps are fetched the first time a dragon is actually shown
function skinTextures(id, mat) {
  const S = DRAGON_SKINS[id]; const set = () => { mat.map = S.map; mat.normalMap = S.normalMap; mat.needsUpdate = true; };
  if (S.map) return set();
  S.waiting.push(set); if (S.waiting.length > 1) return;
  const tl = new THREE.TextureLoader(); const tex = async (n, srgb) => { const t = await tl.loadAsync(n); t.flipY = false; t.anisotropy = 8; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; return t; };
  Promise.all([tex(`/models/dragon_${id}_a.jpg`, true), tex(`/models/dragon_${id}_n.jpg`, false)]).then(([a, n]) => { S.map = a; S.normalMap = n; for (const f of S.waiting) f(); S.waiting.length = 0; }).catch(() => {});
}
// Dragons designed in Blender (tools/blender/dragon_model.py): id → { parts: { skin, hard, membrane }, meta, tex }
export const DRAGON_MODELS = {};
export async function loadDragonModels(ids) {
  await Promise.all(ids.map(async (id) => {
    try {
      const [gltf, meta] = await Promise.all([new GLTFLoader().loadAsync(`/models/dragonfull_${id}.glb`), fetch(`/models/dragonfull_${id}.json`).then(r => r.json())]);
      const parts = {}; gltf.scene.traverse(o => { if (o.isSkinnedMesh) parts[o.name.replace(/[^a-z]/gi, '').toLowerCase()] = { geo: o.geometry, joints: o.skeleton.bones.map(b => b.name) }; });
      if (parts.skin) DRAGON_MODELS[id] = { parts, meta, tex: null, waiting: [] };
    } catch (e) { /* not modelled yet: the older body is used */ }
  }));
}
function modelTextures(id, mat, wing) {
  const M = DRAGON_MODELS[id];
  const set = () => {
    mat.map = M.tex[0]; mat.normalMap = M.tex[1]; mat.roughnessMap = M.tex[2]; mat.aoMap = M.tex[2]; mat.needsUpdate = true;
    if (wing && M.tex[3]) { wing.map = M.tex[3]; wing.normalMap = M.tex[4]; wing.color.set(0xffffff); wing.needsUpdate = true; }
  };
  if (M.tex) return set();
  M.waiting.push(set); if (M.waiting.length > 1) return;
  const tl = new THREE.TextureLoader(); const tex = async (n, srgb) => { const t = await tl.loadAsync(n); t.flipY = false; t.anisotropy = 8; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; return t; };
  const list = [tex(`/models/dragonfull_${id}_a.jpg`, true), tex(`/models/dragonfull_${id}_n.jpg`, false), tex(`/models/dragonfull_${id}_orm.jpg`, false)];
  if (M.meta.memTex) list.push(tex(`/models/dragonfull_${id}_mem_a.jpg`, true), tex(`/models/dragonfull_${id}_mem_n.jpg`, false));
  Promise.all(list).then((t) => { M.tex = t; for (const f of M.waiting) f(); M.waiting.length = 0; }).catch(() => {});
}
export class Dragon {
  constructor(def) {
    this.def = def;
    this.group = new THREE.Group();
    this.phase = 0; this.t = 0;
    this.pose = { flap: 0, tuck: 0, brake: 0, landed: 0, mouth: 0, lookYaw: 0, lookPitch: 0, bank: 0, yawRate: 0, pitchRate: 0 };
    this._build();
  }

  _build() {
    const def = this.def;
    const nk = def.neck, tl = def.tail, wg = def.wing, bk = def.bulk, hd = def.head;
    const headZ = 3.4 + nk * 5.3, tailTip = -3.2 - tl * 11.4;
    this.headZ = headZ; this.tailTip = tailTip;
    const spineY = (z) => {
      if (z > 2.6) return 0.68 * Math.pow(clamp01((z - 2.6) / (headZ - 2.6)), 1.25);
      if (z < -3.2) return -0.3 * clamp01((-3.2 - z) / (-3.2 - tailTip));
      return 0;
    };
    const bodyR = (z) => {
      if (z < -3.2) {
        const t = (-3.2 - z) / (-3.2 - tailTip);
        const r = curve([[0, 1.3], [0.1, 1.08], [0.28, 0.8], [0.55, 0.5], [0.8, 0.26], [1, 0.03]], t) * bk;
        return { rx: r, rt: r, rb: r * 0.92 };
      }
      if (z <= 3.4) {
        return {
          rx: curve([[-3.2, 1.3], [-2, 1.6], [-0.4, 1.78], [1.4, 1.92], [2.6, 1.66], [3.4, 1.2]], z) * bk,
          rt: curve([[-3.2, 1.28], [-2, 1.46], [-0.4, 1.5], [1.4, 1.66], [2.6, 1.56], [3.4, 1.16]], z) * bk,
          rb: curve([[-3.2, 1.16], [-2, 1.42], [-0.4, 1.72], [1.4, 2.0], [2.6, 1.6], [3.4, 1.14]], z) * bk,
        };
      }
      const t = (z - 3.4) / (headZ - 3.4);
      const r = curve([[0, 1.18], [0.15, 0.98], [0.4, 0.8], [0.7, 0.68], [1, 0.62]], t) * lerp(bk, 1, 0.5);
      return { rx: r, rt: r, rb: r };
    };

    // ------------------------------------------------------------ skeleton
    const bones = [];
    const mk = (name, parent, p) => {
      const b = new THREE.Bone(); b.name = name; b.userData.bind = p.clone(); b.userData.index = bones.length;
      if (parent) { parent.add(b); b.position.copy(p).sub(parent.userData.bind); } else b.position.copy(p);
      bones.push(b); return b;
    };
    const root = mk('root', null, V(0, 0, 0));
    const chest = mk('chest', root, V(0, 0, 1.6));
    const neck = []; let prev = chest;
    for (let i = 0; i < NECK_N; i++) { const z = 3.4 + nk * 0.9 * i; prev = mk('neck' + i, prev, V(0, spineY(z), z)); neck.push(prev); }
    const head = mk('head', prev, V(0, spineY(headZ), headZ));
    const hip = mk('hip', root, V(0, 0, -1.8));
    const tail = []; prev = hip;
    for (let i = 0; i < TAIL_N; i++) { const z = -3.2 - tl * 1.2 * i; prev = mk('tail' + i, prev, V(0, spineY(z), z)); tail.push(prev); }
    const fwd = [root, chest, ...neck, head], back = [root, hip, ...tail];
    const fz = fwd.map(b => b.userData.bind.z), bz = back.map(b => b.userData.bind.z);
    const chainSkin = (chain, zs, z, dir) => {
      let k = 0; while (k < chain.length - 1 && (z - zs[k + 1]) * dir >= 0) k++;
      const z0 = zs[k], z1 = k < chain.length - 1 ? zs[k + 1] : z0 + dir;
      const t = clamp01((z - z0) / (z1 - z0)); const b = chain[k].userData.index;
      if (t < 0.5) { if (k === 0) return [[b, 1]]; return [[b, 0.5 + t], [chain[k - 1].userData.index, 0.5 - t]]; }
      if (k === chain.length - 1) return [[b, 1]];
      return [[b, 1.5 - t], [chain[k + 1].userData.index, t - 0.5]];
    };
    const spineSkin = (z) => (z >= 0 ? chainSkin(fwd, fz, z, 1) : chainSkin(back, bz, z, -1));

    // head metrics
    const Lh = 3.0 * hd, hz0 = headZ - 0.3 * hd, hy = spineY(headZ);
    const hzt = (t) => hz0 + t * Lh;
    const lipY = hy - 0.14 * hd, jawY = lipY - 0.035 * hd;
    const hW = (t) => curve([[-0.05, 0.08], [0, 0.52], [0.1, 0.7], [0.25, 0.76], [0.42, 0.62], [0.6, 0.5], [0.8, 0.4], [0.93, 0.31], [1, 0.08]], t) * hd;
    const hT = (t) => curve([[-0.05, 0.04], [0, 0.44], [0.12, 0.62], [0.26, 0.66], [0.4, 0.5], [0.6, 0.4], [0.8, 0.36], [0.9, 0.38], [0.97, 0.26], [1, 0.05]], t) * hd;
    const hB = (t) => curve([[0, 0.05], [0.06, 0.3], [0.18, 0.42], [0.32, 0.36], [0.6, 0.25], [0.85, 0.17], [0.96, 0.04]], t) * hd;
    const jaw = mk('jaw', head, V(0, jawY, hzt(0.1)));

    const wingB = {}, legB = {};
    const J = {};   // joint bind positions per side
    for (const side of [1, -1]) {
      const sx = side, key = side > 0 ? 'L' : 'R';
      const S = V(sx * 1.25 * bk, 1.05, 2.3), E = V(sx * (1.25 * bk + 3.4 * wg), 1.16, 3.1), W = V(sx * (1.25 * bk + 7.8 * wg), 1.08, 3.5);
      const fm = [V(sx * 3.8 * wg, -0.05, -0.5), V(sx * 3.4 * wg, -0.05, -3.5 * wg), V(sx * 1.8 * wg, -0.05, -5.1 * wg), V(sx * -0.4 * wg, -0.05, -5.1 * wg)].map(o => o.add(W));
      const ft = [V(sx * 7.2 * wg, -0.1, -1.9), V(sx * 5.8 * wg, -0.1, -6.9 * wg), V(sx * 2.4 * wg, -0.1, -10.1 * wg), V(sx * -1.6 * wg, -0.1, -9.7 * wg)].map(o => o.add(W));
      const hum = mk('hum' + key, chest, S), fore = mk('fore' + key, hum, E), hand = mk('hand' + key, fore, W);
      const fingers = [];
      for (let k = 0; k < 4; k++) { const a = mk(`f${k}a${key}`, hand, W), b = mk(`f${k}b${key}`, a, fm[k]); fingers.push([a, b]); }
      wingB[key] = { hum, fore, hand, fingers };
      const HJ = V(sx * 1.1 * bk, -0.55, -1.7), K = V(sx * (1.1 * bk + 0.4), -2.4, -0.9), A = V(sx * (1.1 * bk + 0.35), -4.0, -1.9), T = V(sx * (1.1 * bk + 0.35), -4.45, -1.0);
      const thigh = mk('thigh' + key, hip, HJ), shin = mk('shin' + key, thigh, K), foot = mk('foot' + key, shin, A);
      legB[key] = { thigh, shin, foot };
      J[key] = { S, E, W, fm, ft, HJ, K, A, T };
    }
    const sadZ = 3.4 + nk * 0.55;
    const saddle = mk('saddle', neck[0], V(0, bodyR(sadZ).rt + spineY(sadZ) - 0.04, sadZ));
    this.saddleRadius = bodyR(sadZ).rx;
    const ix = (b) => b.userData.index;

    // ------------------------------------------------------------- colours
    const cBody = hexC(def.body), cBelly = hexC(def.belly), cAcc = hexC(def.accent), cMem = hexC(def.membrane).map(v => Math.min(1, v * 2.5 + 0.012));
    const cMouth = [0.28, 0.02, 0.02], cTooth = [0.78, 0.72, 0.58], cHorn = mixC(mixC(cAcc, cBody, 0.5), [0.02, 0.02, 0.02], 0.35), cHornTip = mixC(cHorn, [0.75, 0.68, 0.55], 0.45);
    const cClaw = mixC(cHorn, [0.05, 0.05, 0.05], 0.4);
    const mott = (a, b) => 0.82 + 0.36 * (0.5 + 0.5 * Math.sin(a * 2.3 + Math.sin(b * 3.1) * 1.9) * Math.sin(a * 0.83 + b * 2.0 + 1.3));
    const bodyColor = (cosT, z, th) => {
      const bellyF = clamp01((-cosT - 0.25) / 0.5), dorsal = clamp01((cosT - 0.8) / 0.18);
      let c = mixC(cBody, cBelly, bellyF * 0.9);
      c = mixC(c, cAcc, dorsal * 0.3 + clamp01(Math.sin(z * 1.7 + Math.sin(th * 2.0) * 2.0) - 0.84) * 1.6 * (1 - bellyF) * (0.3 + 0.7 * clamp01(cosT + 0.6)));
      const m = mott(z, th);
      return [c[0] * m, c[1] * m, c[2] * m];
    };

    const B = new GeoBuilder();     // body / limbs
    // the fleshy parts are replaced by a Blender-built fused skin when one has been baked for this dragon (tools/blender/dragon.py)
    const MODEL = Dragon.exportMode ? null : (DRAGON_MODELS[def.id] || null);
    const SKIN = Dragon.exportMode || MODEL ? null : (DRAGON_SKINS[def.id] || null);
    const softB = (fn) => { if (SKIN) return; B.beginSoft(); fn(); B.endSoft(); };
    const Mb = new GeoBuilder();    // membranes

    // ------------------------------------------------------------- body loft
    const zs = [];
    for (let i = 0; i <= 34; i++) zs.push(lerp(tailTip, -3.2, Math.pow(i / 34, 0.9)));
    for (let i = 1; i <= 22; i++) zs.push(lerp(-3.2, 3.4, i / 22));
    for (let i = 1; i <= 22; i++) zs.push(lerp(3.4, headZ + 0.15, i / 22));
    const MR = 28; let vlen = 0; const vAcc = [0];
    for (let i = 1; i < zs.length; i++) { vlen += zs[i] - zs[i - 1]; vAcc.push(vlen); }
    softB(() => B.grid(MR, zs.length - 1, (i, j) => {
      const z = zs[j], th = (i / MR) * Math.PI * 2; const R = bodyR(z);
      const sT = Math.sin(th), cT = Math.cos(th);
      // ventral scutes: broad overlapping plates from throat to tail tip
      const vent = clamp01((-cT - 0.6) / 0.2), plate = j % 2;
      const bulge = 1 + vent * (plate ? 0.05 : -0.025);
      const keel = 1 + 0.07 * clamp01((cT - 0.9) / 0.1);          // raised ridge along the spine
      const x = R.rx * Math.sign(sT) * Math.pow(Math.abs(sT), 0.86) * (1 + vent * (plate ? 0.025 : 0));
      const y = spineY(z) + (cT >= 0 ? R.rt * keel : R.rb * bulge) * Math.sign(cT) * Math.pow(Math.abs(cT), 0.9);
      let c = bodyColor(cT, z, th);
      if (vent > 0) { const pc = plate ? 1.15 : 0.5; c = mixC(c, [cBelly[0] * pc, cBelly[1] * pc, cBelly[2] * pc], vent * 0.92); }
      return { p: V(x, y, z), uv: [i / MR * 10, vAcc[j] * 0.9], c, sk: spineSkin(z) };
    }, true));

    // ------------------------------------------------------------------ head
    const hk = ix(head), jk = ix(jaw);
    const cTongue = [0.34, 0.06, 0.06], cToothB = [0.26, 0.21, 0.14];
    const gauss = (x, m, sg) => Math.exp(-((x - m) / sg) * ((x - m) / sg));
    const tU = []; for (let i = 0; i <= 30; i++) tU.push(-0.05 + 1.05 * (i / 30));
    const MH = 28;
    B.grid(MH, tU.length - 1, (i, j) => {
      const t = tU[j], ph = (i / MH) * Math.PI * 2, w = hW(t), h = hT(t);
      const c = Math.cos(ph), s = Math.sin(ph), ac = Math.abs(c);
      let x, y, col;
      if (s >= 0) {
        x = w * Math.sign(c) * Math.pow(ac, 0.72); y = lipY + h * Math.pow(s, 0.8);
        const brow = gauss(t, 0.33, 0.085) * gauss(ac, 0.6, 0.2);                       // heavy ridge over each eye
        const socket = gauss(t, 0.375, 0.05) * gauss(ac, 0.88, 0.14) * gauss(s, 0.5, 0.25);
        const cheek = gauss(t, 0.14, 0.09) * gauss(s, 0.25, 0.22);
        const nostril = gauss(t, 0.9, 0.045) * gauss(ac, 0.5, 0.2);
        const crest = gauss(ac, 0, 0.14) * clamp01((0.5 - t) / 0.4) * clamp01(t / 0.06);  // sagittal crest
        const ridge = gauss(ac, 0, 0.2) * gauss(t, 0.68, 0.16);                         // bony snout ridge
        y += (brow * 0.15 + nostril * 0.055 + crest * 0.07 + ridge * 0.035) * hd;
        x += Math.sign(c) * (brow * 0.07 + cheek * 0.07 - socket * 0.075) * hd;
        if (s < 0.2 && t > 0.28) y -= (0.5 + 0.5 * Math.sin(t * 120.8)) * 0.02 * hd * (1 - s / 0.2);   // scalloped lip
        col = bodyColor(s * 0.9 + 0.1, hzt(t), ph);
        col = mixC(col, cAcc, clamp01(crest * 0.5 + brow * 0.25));
        col = mixC(col, [0.008, 0.008, 0.008], clamp01(socket * 1.15));
        if (s < 0.1) col = mixC(col, cMouth, 0.55);
      } else { x = w * c * 0.94; y = lipY + 0.05 * hd * s; col = cMouth; }
      return { p: V(x, y, hzt(t)), uv: [i / MH * 5, t * Lh * 0.9], c: col, sk: [[hk, 1]] };
    }, true);
    const tJ = []; for (let i = 0; i <= 22; i++) tJ.push(0.96 * (i / 22));
    B.grid(MH, tJ.length - 1, (i, j) => {
      const t = tJ[j], ph = (i / MH) * Math.PI * 2, w = hW(t) * 0.86, h = hB(t);
      const c = Math.cos(ph), s = Math.sin(ph);
      let x, y, col;
      if (s >= 0) { x = w * c * 0.92; y = jawY + 0.035 * hd * s; col = mixC(cMouth, [0.45, 0.1, 0.09], clamp01(s) * 0.6); }
      else {
        const mass = gauss(t, 0.16, 0.1) * gauss(-s, 0.45, 0.3);                        // jaw muscle
        x = w * Math.sign(c) * Math.pow(Math.abs(c), 0.8) + Math.sign(c) * mass * 0.07 * hd; y = jawY - h * Math.pow(-s, 0.8);
        if (s > -0.2 && t > 0.28) y += (0.5 + 0.5 * Math.sin((t - 0.026) * 120.8)) * 0.016 * hd * (1 + s / 0.2);
        col = bodyColor(s * 0.7 - 0.3, hzt(t), ph); if (s > -0.1) col = mixC(col, cMouth, 0.55);
      }
      return { p: V(x, y, hzt(t)), uv: [i / MH * 5, t * Lh * 0.9], c: col, sk: [[jk, 1]] };
    }, true);
    // teeth: hooked, uneven, stained at the gum
    const tooth = (base, tip, r, sk) => {
      const mid = lerpV(base, tip, 0.5); mid.z += 0.014 * hd;
      B.tube([{ p: base, r, sk, c: cToothB }, { p: mid, r: r * 0.72, sk, c: mixC(cToothB, cTooth, 0.6) }, { p: tip, r: 0.003, sk, c: cTooth }], 5, cTooth, { up: V(1, 0, 0) });
    };
    for (const sx of [1, -1]) for (let i = 0; i < 14; i++) {
      const t = 0.29 + i * 0.052; const fang = gauss(t, 0.87, 0.06) + 0.6 * gauss(t, 0.6, 0.04);
      const jit = 0.72 + 0.5 * Math.abs(Math.sin(i * 12.9898 + sx * 1.7));
      const lu = (0.085 + 0.17 * fang) * jit * hd, ll = (0.075 + 0.12 * fang) * jit * hd;
      const xu = sx * hW(t) * 0.9, xl = sx * hW(t + 0.026) * 0.86 * 0.88;
      tooth(V(xu, lipY + 0.015 * hd, hzt(t)), V(xu * 0.95, lipY - lu, hzt(t) - 0.03 * hd), (0.022 + 0.02 * fang) * hd, [[hk, 1]]);
      if (i < 13) tooth(V(xl, jawY - 0.01 * hd, hzt(t + 0.026)), V(xl * 0.96, jawY + ll, hzt(t + 0.026) - 0.02 * hd), (0.02 + 0.016 * fang) * hd, [[jk, 1]]);
    }
    for (let i = -2; i <= 2; i++) { const xx = i * 0.05 * hd; tooth(V(xx, lipY + 0.01 * hd, hzt(0.985)), V(xx, lipY - 0.1 * hd, hzt(0.985)), 0.018 * hd, [[hk, 1]]); }
    // tongue
    B.tube([0.12, 0.3, 0.5, 0.68, 0.8].map((t, i) => ({ p: V(0, jawY + (0.05 + 0.03 * Math.sin(i * 1.3)) * hd, hzt(t)), r: (0.15 - i * 0.027) * hd, r2: (0.06 - i * 0.008) * hd, sk: [[jk, 1]] })), 8, cTongue, { up: V(0, 1, 0) });
    // nostrils
    for (const sx of [1, -1]) B.blob(V(sx * 0.21 * hd, lipY + hT(0.915) * 0.9 + 0.012 * hd, hzt(0.915)), V(0.045 * hd, 0.022 * hd, 0.075 * hd), [0.004, 0.003, 0.003], [[hk, 1]], 8, 5);
    // horns
    const horn = (base, ctrl, tip, r, sk, n = 7) => {
      const path = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n; const a = lerpV(base, ctrl, t), b = lerpV(ctrl, tip, t), p = lerpV(a, b, t);
        const ring = 1 + 0.07 * Math.sin(t * 40);
        path.push({ p, r: Math.max(0.006, r * (1 - t * 0.97)) * ring, sk, c: mixC(cHorn, cHornTip, t * t) });
      }
      B.tube(path, 7, cHorn, { up: V(0, 0, 1), uvScale: 1.5 });
    };
    const hl = def.hornLen;
    for (const sx of [1, -1]) {
      const b1 = V(sx * 0.34 * hd, lipY + hT(0.1) * 0.86, hzt(0.09));
      horn(b1, V(sx * 0.52 * hd, b1.y + 0.6 * hd * hl, b1.z - 0.55 * hd * hl), V(sx * 0.44 * hd, b1.y + 0.62 * hd * hl, b1.z - 1.85 * hd * hl), 0.17 * hd, [[hk, 1]]);
      const b2 = V(sx * 0.6 * hd, lipY + 0.32 * hd, hzt(0.05));
      horn(b2, V(sx * 0.9 * hd, b2.y + 0.16 * hd, b2.z - 0.3 * hd * hl), V(sx * 0.98 * hd, b2.y + 0.34 * hd, b2.z - 1.2 * hd * hl), 0.115 * hd, [[hk, 1]]);
      const b3 = V(sx * 0.66 * hd, lipY + 0.0 * hd, hzt(0.13));
      horn(b3, V(sx * 0.86 * hd, b3.y - 0.05 * hd, b3.z - 0.2 * hd * hl), V(sx * 0.98 * hd, b3.y - 0.02 * hd, b3.z - 0.8 * hd * hl), 0.08 * hd, [[hk, 1]], 5);
      const b4 = V(sx * 0.22 * hd, jawY - hB(0.34) * 0.9, hzt(0.34));
      horn(b4, V(sx * 0.26 * hd, b4.y - 0.2 * hd, b4.z - 0.1 * hd), V(sx * 0.28 * hd, b4.y - 0.3 * hd * hl, b4.z - 0.5 * hd * hl), 0.07 * hd, [[jk, 1]], 5);
      // cheek frill
      for (let i = 0; i < 6; i++) {
        const t = 0.02 + i * 0.03, a = 0.18 + i * 0.13;
        const bx = sx * hW(t) * Math.pow(Math.cos(a), 0.72), by = lipY + hT(t) * Math.pow(Math.sin(a), 0.8), bz = hzt(t);
        const L = (0.55 - Math.abs(i - 2) * 0.07) * hd * hl;
        horn(V(bx, by, bz), V(bx + sx * 0.2 * L, by + 0.1 * L, bz - 0.5 * L), V(bx + sx * 0.3 * L, by + 0.12 * L, bz - L), 0.055 * hd, [[hk, 1]], 4);
      }
      // brow spines and jawline spines
      for (let i = 0; i < 3; i++) { const t = 0.3 + i * 0.045; const bx = sx * hW(t) * 0.62, by = lipY + hT(t) * 0.86 + 0.13 * hd; B.spike(V(bx, by, hzt(t)), V(bx + sx * 0.05 * hd, by + (0.16 - i * 0.03) * hd, hzt(t) - 0.22 * hd), 0.04 * hd, 4, cHorn, [[hk, 1]], V(1, 0, 0)); }
      for (let i = 0; i < 5; i++) { const t = 0.16 + i * 0.1; const bx = sx * hW(t) * 0.86 * 0.8, by = jawY - hB(t) * 0.8; B.spike(V(bx, by, hzt(t)), V(bx + sx * 0.04 * hd, by - (0.2 - i * 0.025) * hd * hl, hzt(t) - 0.16 * hd), 0.035 * hd, 4, cHorn, [[jk, 1]], V(1, 0, 0)); }
    }

    // ----------------------------------------------------------- back spikes
    const spikeH = (z) => {
      if (z > headZ) return 0.26;
      if (z > 3.4) return lerp(0.44, 0.3, (z - 3.4) / (headZ - 3.4));
      if (z > -3.2) return curve([[-3.2, 0.44], [-2, 0.5], [1.5, 0.64], [3.4, 0.44]], z);
      return lerp(0.44, 0.1, clamp01((-3.2 - z) / (-3.2 - tailTip)));
    };
    {
      let z = hzt(0.34);
      while (z > tailTip * 0.96) {
        const h = spikeH(z) * def.spike * (0.85 + 0.3 * Math.abs(Math.sin(z * 3.3)));
        const onHead = z > headZ + 0.1;
        const top = onHead ? lipY + hT((z - hz0) / Lh) : spineY(z) + bodyR(z).rt;
        if (Math.abs(z - (3.4 + nk * 0.55)) < 0.75) { z -= 0.5; continue; }   // leave room for the rider
        const sk = onHead ? [[hk, 1]] : spineSkin(z);
        const base = V(0, top - 0.05, z);
        B.spike(base, V(0, top + h * 0.9, z - h * 0.95), 0.17 * h + 0.035, 4, mixC(cAcc, cHorn, 0.45), sk, V(1, 0, 0));
        z -= 0.34 + h * 0.75;
      }
      // tail blade
      const tz = tailTip + 0.2; const sk = spineSkin(tz);
      B.spike(V(0, spineY(tz), tz + 0.9), V(0, spineY(tz) + 0.9 * def.spike, tz - 0.6), 0.2, 4, cHorn, sk, V(1, 0, 0));
      B.spike(V(0, spineY(tz), tz + 0.9), V(0, spineY(tz) - 0.7 * def.spike, tz - 0.5), 0.18, 4, cHorn, sk, V(1, 0, 0));
    }

    // ------------------------------------------------------------- limbs
    for (const side of [1, -1]) {
      const key = side > 0 ? 'L' : 'R', sx = side; const j = J[key]; const wb = wingB[key], lb = legB[key];
      const limbC = mixC(cBody, cAcc, 0.12), limbD = mixC(cBody, [0, 0, 0], 0.25);
      // leg
      const th = ix(lb.thigh), sh = ix(lb.shin), ft = ix(lb.foot), hp = ix(hip);
      const inner = V(sx * 0.3 * bk, -0.2, -1.6);
      softB(() => B.tube([
        { p: inner, r: 0.6 * bk, sk: [[hp, 1]] },
        { p: j.HJ.clone(), r: 0.95 * bk, r2: 1.2 * bk, sk: [[hp, 0.5], [th, 0.5]] },
        { p: lerpV(j.HJ, j.K, 0.5), r: 0.82 * bk, r2: 1.05 * bk, sk: [[th, 1]] },
        { p: j.K.clone(), r: 0.52 * bk, r2: 0.6 * bk, sk: [[th, 0.5], [sh, 0.5]] },
        { p: lerpV(j.K, j.A, 0.5), r: 0.4 * bk, r2: 0.48 * bk, sk: [[sh, 1]] },
        { p: j.A.clone(), r: 0.29 * bk, sk: [[sh, 0.5], [ft, 0.5]] },
        { p: j.T.clone(), r: 0.31 * bk, r2: 0.24 * bk, sk: [[ft, 1]] },
        { p: j.T.clone().add(V(0, -0.05, 0.25)), r: 0.02, sk: [[ft, 1]] },
      ], 10, limbC, { up: V(0, 0, 1), uRepeat: 3 }));
      for (const [dx, dz, len] of [[0.0, 1, 1.0], [0.38, 0.85, 0.9], [-0.38, 0.85, 0.9], [0, -0.8, 0.7]]) {
        const a = j.T.clone().add(V(0, -0.02, 0)), b = a.clone().add(V(sx * dx * 0.7 * len, -0.12, dz * 0.7 * len)), c = b.clone().add(V(sx * dx * 0.45 * len, -0.26, dz * 0.45 * len));
        softB(() => B.tube([{ p: a, r: 0.13 * bk, sk: [[ft, 1]] }, { p: b, r: 0.11 * bk, sk: [[ft, 1]] }, { p: lerpV(b, c, 0.1), r: 0.09 * bk, sk: [[ft, 1]], c: cClaw }, { p: c, r: 0.008, sk: [[ft, 1]], c: cClaw }], 6, limbD, { up: V(0, 1, 0) }));
        if (SKIN) B.spike(lerpV(b, c, 0.05), c.clone().add(V(sx * dx * 0.12, -0.06, dz * 0.12)), 0.1 * bk, 5, cClaw, [[ft, 1]], V(0, 1, 0));
      }
      // wing arm
      const hu = ix(wb.hum), fo = ix(wb.fore), ha = ix(wb.hand), ch = ix(chest);
      softB(() => B.tube([
        { p: V(sx * 0.4 * bk, 0.8, 2.2), r: 0.6, sk: [[ch, 1]] },
        { p: j.S.clone(), r: 0.66, r2: 0.74, sk: [[ch, 0.5], [hu, 0.5]] },
        { p: lerpV(j.S, j.E, 0.45), r: 0.5, r2: 0.6, sk: [[hu, 1]] },
        { p: j.E.clone(), r: 0.38, sk: [[hu, 0.5], [fo, 0.5]] },
        { p: lerpV(j.E, j.W, 0.5), r: 0.33, sk: [[fo, 1]] },
        { p: j.W.clone(), r: 0.27, sk: [[fo, 0.5], [ha, 0.5]] },
        { p: j.W.clone().add(V(sx * 0.25, 0, 0.1)), r: 0.02, sk: [[ha, 1]] },
      ], 9, limbC, { up: V(0, 1, 0), uRepeat: 2 }));
      B.spike(j.W.clone().add(V(0, 0.05, 0.12)), j.W.clone().add(V(sx * 0.35, 0.12, 1.25)), 0.15, 5, cClaw, [[ha, 1]], V(1, 0, 0));
      // muscle masses, joints and spurs
      const mus = (d) => { const m = 0.82 + 0.3 * (0.5 + 0.5 * d.y); return [limbC[0] * m, limbC[1] * m, limbC[2] * m]; };
      softB(() => B.blob(V(j.S.x - sx * 0.55 * bk, j.S.y - 0.05, j.S.z - 0.2), V(0.85 * bk, 0.7 * bk, 1.3 * bk), mus, [[ch, 0.65], [hu, 0.35]], 12, 8));
      softB(() => B.blob(V(sx * 0.62 * bk, -0.62 * bk, 1.9), V(0.8 * bk, 0.95 * bk, 1.6 * bk), (d) => bodyColor(d.y * 0.6 - 0.25, 1.9 + d.z, 1 + d.x), [[ch, 1]], 12, 8));
      softB(() => B.blob(V(j.HJ.x - sx * 0.1, j.HJ.y + 0.25, j.HJ.z), V(0.95 * bk, 1.25 * bk, 1.45 * bk), mus, [[hp, 0.55], [th, 0.45]], 12, 8));
      softB(() => B.blob(lerpV(j.K, j.A, 0.3).add(V(0, 0, -0.18)), V(0.42 * bk, 0.75 * bk, 0.5 * bk), mus, [[sh, 1]], 8, 6));
      B.spike(j.A.clone().add(V(0, 0.05, -0.2)), j.A.clone().add(V(0, 0.25, -0.95)), 0.13 * bk, 5, cClaw, [[ft, 1]], V(1, 0, 0));
      softB(() => B.blob(j.E.clone(), V(0.46, 0.42, 0.46), mus, [[hu, 0.5], [fo, 0.5]], 8, 6));
      softB(() => B.blob(j.W.clone(), V(0.36, 0.3, 0.36), mus, [[fo, 0.5], [ha, 0.5]], 8, 6));
      // fingers
      for (let k = 0; k < 4; k++) {
        const fa = ix(wb.fingers[k][0]), fb = ix(wb.fingers[k][1]);
        softB(() => B.tube([
          { p: j.W.clone(), r: 0.19, sk: [[ha, 0.5], [fa, 0.5]] },
          { p: lerpV(j.W, j.fm[k], 0.5), r: 0.15, sk: [[fa, 1]] },
          { p: j.fm[k].clone(), r: 0.125, sk: [[fa, 0.5], [fb, 0.5]] },
          { p: lerpV(j.fm[k], j.ft[k], 0.5), r: 0.085, sk: [[fb, 1]] },
          { p: j.ft[k].clone(), r: 0.012, sk: [[fb, 1]], c: cClaw },
        ], 6, limbD, { up: V(0, 1, 0), uRepeat: 1 }));
        softB(() => B.blob(j.fm[k].clone(), V(0.18, 0.16, 0.18), limbD, [[fa, 0.5], [fb, 0.5]], 6, 4));
        const dirT = new THREE.Vector3().subVectors(j.ft[k], j.fm[k]).normalize();
        B.spike(j.ft[k].clone(), j.ft[k].clone().addScaledVector(dirT, 0.6).add(V(0, -0.14, 0)), 0.055, 4, cClaw, [[fb, 1]], V(0, 1, 0));
      }
      // ---- membranes
      const spoke = (k, r) => {
        const fa = ix(wb.fingers[k][0]), fb = ix(wb.fingers[k][1]);
        const wHand = clamp01(1 - r / 0.14) * 0.5, wFb = clamp01((r - 0.38) / 0.24);
        const p = r <= 0.5 ? lerpV(j.W, j.fm[k], r / 0.5) : lerpV(j.fm[k], j.ft[k], (r - 0.5) / 0.5);
        return { p, sk: [[ha, wHand], [fa, Math.max(0, 1 - wHand - wFb)], [fb, wFb]] };
      };
      const memC = (shade) => [cMem[0] * shade, cMem[1] * shade, cMem[2] * shade];
      for (let k = 0; k < 3; k++) {
        Mb.grid(7, 12, (i, jj) => {
          const a = i / 7, r = jj / 12; const rr = r * (1 - 0.2 * Math.sin(Math.PI * a) * r * r);
          const A = spoke(k, rr), Bq = spoke(k + 1, rr);
          const p = lerpV(A.p, Bq.p, a); p.y += 0.1 * Math.sin(Math.PI * a) * r;
          return { p, uv: [(k + a) * 0.8, rr * 2.4], c: memC(0.7 + 0.3 * Math.sin(Math.PI * a)), sk: [...scaleSk(A.sk, 1 - a), ...scaleSk(Bq.sk, a)] };
        });
      }
      // inner panel: arm chain ↔ flank
      const f4a = ix(wb.fingers[3][0]), f4b = ix(wb.fingers[3][1]);
      const chainPts = [j.S, j.E, j.W, j.fm[3], j.ft[3]], chainBones = [hu, fo, f4a, f4b];
      const segL = []; let tot = 0; for (let i = 0; i < 4; i++) { const l = chainPts[i].distanceTo(chainPts[i + 1]); segL.push(l); tot += l; }
      const chainAt = (u) => {
        let d = u * tot, k = 0; while (k < 3 && d > segL[k]) { d -= segL[k]; k++; }
        const t = clamp01(d / segL[k]); const p = lerpV(chainPts[k], chainPts[k + 1], t);
        const sk = [];
        if (t < 0.2 && k > 0) { sk.push([chainBones[k], 0.5 + t * 2.5], [chainBones[k - 1], 0.5 - t * 2.5]); }
        else if (t > 0.8 && k < 3) { sk.push([chainBones[k], 0.5 + (1 - t) * 2.5], [chainBones[k + 1], 0.5 - (1 - t) * 2.5]); }
        else sk.push([chainBones[k], 1]);
        return { p, sk };
      };
      const FA = V(sx * 1.2 * bk, 0.7, 1.75), FB = V(sx * 0.85 * bk, 0.14, -4.0);
      Mb.grid(9, 16, (i, jj) => {
        const v = i / 9, u = jj / 16; const uu = u * (1 - 0.17 * Math.sin(Math.PI * v) * u);
        const C = chainAt(uu); const e = uu * uu * (3 - 2 * uu);
        const fp = lerpV(FA, FB, e); const bz2 = fp.z; const R = bodyR(bz2);
        fp.x = sx * Math.max(Math.abs(fp.x), R.rx * 0.93);
        const p = lerpV(C.p, fp, v); p.y += 0.12 * Math.sin(Math.PI * v) * uu;
        return { p, uv: [2.4 + v * 1.6, uu * 2.4], c: memC(0.68 + 0.32 * Math.sin(Math.PI * v)), sk: [...scaleSk(C.sk, 1 - v), ...scaleSk(spineSkin(bz2), v)] };
      });
      // propatagium (leading membrane in front of the arm)
      const A0 = V(sx * 0.8 * bk, 1.1, 3.4);
      const armAt = (u) => {
        const l1 = segL[0], l2 = segL[1], d = u * (l1 + l2);
        if (d < l1) { const t = d / l1; return { p: lerpV(j.S, j.E, t), sk: [[hu, 1 - t * 0.5], [fo, t * 0.5]] }; }
        const t = (d - l1) / l2; return { p: lerpV(j.E, j.W, t), sk: [[fo, 1 - t * 0.5], [ha, t * 0.5], [hu, 0]] };
      };
      Mb.grid(4, 8, (i, jj) => {
        const v = i / 4, u = jj / 8; const C = armAt(u);
        const lead = lerpV(A0, j.W, u); lead.z += 0.75 * Math.sin(Math.PI * u) * 0.6; lead.y -= 0.1 * Math.sin(Math.PI * u);
        const p = lerpV(C.p, lead, v * (1 - 0.12 * Math.sin(Math.PI * u)));
        return { p, uv: [v * 0.8, u * 2], c: memC(0.72 + 0.2 * v), sk: [...scaleSk(C.sk, 1 - v * 0.55), [ch, v * 0.55 * (1 - u)], [fo, v * 0.55 * u]] };
      });
    }

    // ------------------------------------------------------------- materials
    const st = scaleTextures(), mt = membraneTextures();
    const bodyMat = patchAtmosphere(new THREE.MeshStandardMaterial({
      vertexColors: true, map: st.map, normalMap: st.normalMap, roughnessMap: st.roughnessMap,
      roughness: 0.88, metalness: 0.08, normalScale: new THREE.Vector2(1.5, 1.5), envMapIntensity: 0.22,
    }), (shader) => {
      // sky-coloured rim light so a dark dragon keeps its shape on the shaded side
      shader.uniforms.uRim = G.uAmbSky;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uRim;')
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
          {
            float rim = pow(1.0 - saturate(dot(normal, geometryViewDir)), 5.0);
            reflectedLight.indirectSpecular += uRim * rim * (0.35 + 0.65 * saturate(normal.y * 0.5 + 0.5)) * 0.2;
          }`);
    }, 'dragonbody');
    const glow = new THREE.Color(def.glow);
    const memMat = patchAtmosphere(new THREE.MeshPhysicalMaterial({
      vertexColors: true, map: mt.map, normalMap: mt.normalMap, roughness: 0.82, metalness: 0.0, side: THREE.DoubleSide,
      specularIntensity: 0.16, normalScale: new THREE.Vector2(1.8, 1.8), envMapIntensity: 0.3,
    }), (shader) => {
      shader.uniforms.uGlow = { value: glow };
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uGlow;')
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
          #if NUM_DIR_LIGHTS > 0
          {
            // light bleeding through the membrane when it is back-lit; veins stay dark
            float back = saturate(dot(-normal, directionalLights[0].direction));
            float thin = clamp(diffuseColor.g / max(0.04, max(vColor.g, max(vColor.r, vColor.b))) * 2.4 - 0.25, 0.0, 1.3);
            reflectedLight.directDiffuse += (uGlow * 0.9 + diffuseColor.rgb * 2.5) * RECIPROCAL_PI * directionalLights[0].color * (0.25 + 0.75 * back) * back * 0.62 * thin;
          }
          #endif`);
    }, 'dragonmem' + def.id);

    registerMembraneMaterial(memMat);
    const bodyGeo = B.build(), memGeo = Mb.build();
    const skeleton = new THREE.Skeleton(bones);
    if (Dragon.exportMode) {
      // everything Blender needs to rebuild the body as one skin: the fleshy part meshes with their skin weights, and the bones
      const tailOf = (b) => { const c = b.children.find(ch => ch.isBone && !/^(saddle|jaw|hum|thigh)/.test(ch.name)) || b.children.find(ch => ch.isBone); return c ? c.userData.bind.toArray() : null; };
      this.exportData = {
        id: def.id, bulk: bk, headZ, tailTip, def: { neck: nk, tail: tl, wing: wg, bulk: bk, head: hd, spike: def.spike, scale: def.scale, body: def.body, belly: def.belly, accent: def.accent, membrane: def.membrane },
        head: { Lh, hz0, hy, lipY, jawY }, NECK_N, TAIL_N, sadZ,
        joints: Object.fromEntries(Object.entries(J).map(([k, j]) => [k, { S: j.S.toArray(), E: j.E.toArray(), W: j.W.toArray(), fm: j.fm.map(v => v.toArray()), ft: j.ft.map(v => v.toArray()), HJ: j.HJ.toArray(), K: j.K.toArray(), A: j.A.toArray(), T: j.T.toArray() }])),
        bones: bones.map(b => ({ name: b.name, parent: b.parent && b.parent.isBone ? b.parent.name : null, head: b.userData.bind.toArray(), tail: tailOf(b) })),
        parts: B.soft.map(([v0, v1, i0, i1]) => ({ pos: B.pos.slice(v0 * 3, v1 * 3).map(v => +v.toFixed(4)), idx: B.idx.slice(i0, i1).map(i => i - v0), si: B.si.slice(v0 * 4, v1 * 4), sw: B.sw.slice(v0 * 4, v1 * 4).map(v => +v.toFixed(3)) })),
      };
    }
    if (SKIN) {
      const g = SKIN.geo.clone(); const pos = g.attributes.position, nor = g.attributes.normal, n = pos.count;
      const map = SKIN.joints.map(nm => { const b = bones.find(bb => bb.name === nm); return b ? b.userData.index : 0; });
      const si = new Uint16Array(n * 4), src = g.attributes.skinIndex; for (let i = 0; i < n * 4; i++) si[i] = map[src.array[i]];
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
      const col = new Float32Array(n * 3); const limbC = mixC(cBody, cAcc, 0.12);
      for (let i = 0; i < n; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = Math.min(headZ + 0.1, Math.max(tailTip, pos.getZ(i))); const R = bodyR(z), dy = y - spineY(z);
        const ex = x / R.rx, ey = dy / (dy >= 0 ? R.rt : R.rb), e = Math.hypot(ex, ey) || 1e-3, cT = ey / e;
        let c = bodyColor(cT, z, Math.atan2(x, dy)); const vent = clamp01((-cT - 0.6) / 0.2); c = mixC(c, [cBelly[0] * 0.9, cBelly[1] * 0.9, cBelly[2] * 0.9], vent * 0.85);
        const m = 0.82 + 0.3 * (0.5 + 0.5 * nor.getY(i)); const lc = [limbC[0] * m, limbC[1] * m, limbC[2] * m];
        c = mixC(c, lc, clamp01((e - 1.12) / 0.3));
        col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
      }
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      const skinMat = bodyMat.clone(); skinMat.onBeforeCompile = bodyMat.onBeforeCompile; skinMat.customProgramCacheKey = () => 'dragonskin';
      skinMat.roughnessMap = null; skinMat.roughness = 0.72; skinMat.normalScale = new THREE.Vector2(1.4, -1.4); skinTextures(def.id, skinMat);
      const skin = new THREE.SkinnedMesh(g, skinMat); skin.castShadow = true; skin.receiveShadow = true; skin.frustumCulled = false;
      this.group.add(skin); this._skin = skin;
    }
    const body = new THREE.SkinnedMesh(bodyGeo, bodyMat), mem = new THREE.SkinnedMesh(memGeo, memMat);
    for (const m of [body, mem]) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; }
    let mBody = body, mMem = mem, wingMat = null;
    if (MODEL) {
      // the whole dragon comes from Blender: fused skin with baked maps, crisp horns / spines / teeth / claws, wing membranes
      const skinned = (part, mat) => {
        const g = part.geo.clone(); const n = g.attributes.position.count, src = g.attributes.skinIndex;
        const map = part.joints.map(nm => { const b = bones.find(bb => bb.name === nm); return b ? b.userData.index : 0; });
        const si = new Uint16Array(n * 4); for (let i = 0; i < n * 4; i++) si[i] = map[src.array[i]];
        g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
        const m = new THREE.SkinnedMesh(g, mat); m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; return m;
      };
      const skinMat = bodyMat.clone(); skinMat.onBeforeCompile = bodyMat.onBeforeCompile; skinMat.customProgramCacheKey = () => 'dragonfull';
      skinMat.vertexColors = false; skinMat.map = null; skinMat.normalMap = null; skinMat.roughnessMap = null; skinMat.roughness = 1.0; skinMat.metalness = 0.0; skinMat.envMapIntensity = 0.45;
      skinMat.normalScale = new THREE.Vector2(1.3, -1.3); skinMat.aoMapIntensity = 0.8;
      mBody = skinned(MODEL.parts.skin, skinMat);
      if (MODEL.parts.hard) {
        const hardMat = patchAtmosphere(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.0, envMapIntensity: 0.45 }), null, 'dragonhard');
        this._hard = skinned(MODEL.parts.hard, hardMat);
      }
      if (MODEL.parts.membrane && MODEL.meta.memTex) {
        // wing skin painted and wrinkled in Blender: its own colour and normal maps, lit through from behind
        wingMat = patchAtmosphere(new THREE.MeshPhysicalMaterial({ color: new THREE.Color(cMem[0], cMem[1], cMem[2]), roughness: 0.74, metalness: 0.0, side: THREE.DoubleSide, specularIntensity: 0.3, normalScale: new THREE.Vector2(1.7, -1.7), envMapIntensity: 0.35 }), (shader) => {
          shader.uniforms.uGlow = { value: glow };
          shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uGlow;').replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
            #if NUM_DIR_LIGHTS > 0
            {
              float back = saturate(dot(-normal, directionalLights[0].direction));
              float thin = clamp(dot(diffuseColor.rgb, vec3(0.3, 0.6, 0.1)) * 14.0, 0.1, 1.2);
              reflectedLight.directDiffuse += (uGlow * 0.35 + diffuseColor.rgb * 2.2) * RECIPROCAL_PI * directionalLights[0].color * (0.25 + 0.75 * back) * back * 0.3 * thin;
            }
            #endif`);
        }, 'dragonwing' + def.id);
        mMem = skinned(MODEL.parts.membrane, wingMat);
      } else if (MODEL.parts.membrane) {
        mMem = skinned(MODEL.parts.membrane, memMat); const g = mMem.geometry, c = g.attributes.color, n = g.attributes.position.count, col = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { const sh = (c ? c.getX(i) : 0.8) * 1.5; col[i * 3] = cMem[0] * sh; col[i * 3 + 1] = cMem[1] * sh; col[i * 3 + 2] = cMem[2] * sh; }
        g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      }
    }
    if (MODEL) modelTextures(def.id, mBody.material, wingMat);
    const body0 = body, mem0 = mem;
    this.group.add(root); this.group.add(mBody); this.group.add(mMem); if (this._hard) this.group.add(this._hard);
    this.group.updateMatrixWorld(true);
    mBody.bind(skeleton); mMem.bind(skeleton); if (this._skin) this._skin.bind(skeleton); if (this._hard) this._hard.bind(skeleton);
    if (MODEL) { body0.geometry.dispose(); if (mMem !== mem0) mem0.geometry.dispose(); }
    this.body = mBody; this.mem = mMem; this.skeleton = skeleton;

    // eyes (rigid children of the head bone): dark wet eyeball, burning iris, slit pupil
    const scleraMat = new THREE.MeshStandardMaterial({ color: 0x0a0605, roughness: 0.18, metalness: 0.0 });
    const irisMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(def.eye).multiplyScalar(2.0) });
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x020202 });
    const eyeGeo = new THREE.SphereGeometry(1, 18, 12);
    for (const sx of [1, -1]) {
      const e = new THREE.Group();
      const ep = MODEL ? new THREE.Vector3().fromArray(MODEL.meta.eyes[sx > 0 ? 0 : 1]) : V(sx * (hW(0.375) * 0.9 - 0.03 * hd), lipY + hT(0.375) * 0.56, hzt(0.375));
      e.position.copy(ep).sub(head.userData.bind);
      const ball = new THREE.Mesh(eyeGeo, scleraMat); ball.scale.setScalar(0.1 * hd);
      const iris = new THREE.Mesh(eyeGeo, irisMat); iris.scale.set(0.035 * hd, 0.08 * hd, 0.088 * hd); iris.position.set(sx * 0.074 * hd, 0, 0);
      const pupil = new THREE.Mesh(eyeGeo, pupilMat); pupil.scale.set(0.02 * hd, 0.072 * hd, 0.02 * hd); pupil.position.set(sx * 0.094 * hd, 0, 0);
      e.add(ball, iris, pupil); e.rotation.y = -sx * 0.3; if (MODEL && MODEL.meta.eyeR) e.scale.setScalar(MODEL.meta.eyeR / (0.1 * hd));
      head.add(e);
    }

    this.bones = { root, chest, neck, head, jaw, hip, tail, wing: wingB, leg: legB, saddle };
    this.fingerAngles = [0, 0.62, 1.08, 1.47];
    this.mouthLocal = V(0, lipY - head.userData.bind.y - 0.06 * hd, hzt(0.82) - head.userData.bind.z);
    this.standHeight = 4.55;   // root height above the feet in bind pose
    this.length = headZ + Lh - tailTip;
    this.span = 2 * (1.0 * bk + 15 * wg);
    this.group.scale.setScalar(def.scale);
  }

  // world-space mouth position and facing
  getMouth(pos, dir) {
    const h = this.bones.head;
    pos.copy(this.mouthLocal); h.localToWorld(pos);
    if (dir) { dir.set(0, -0.08, 1).transformDirection(h.matrixWorld); }
  }

  // a: { flap 0..1.4, rate (Hz), tuck, brake, landed, mouth, lookYaw, lookPitch, bank, yawRate, pitchRate }
  update(dt, a) {
    const P = this.pose, b = this.bones;
    const k6 = 1 - Math.exp(-dt * 6), k3 = 1 - Math.exp(-dt * 3), k10 = 1 - Math.exp(-dt * 10);
    P.flap += (a.flap - P.flap) * k6; P.tuck += (a.tuck - P.tuck) * k3; P.brake += (a.brake - P.brake) * k3;
    P.landed += (a.landed - P.landed) * (1 - Math.exp(-dt * 2.2)); P.mouth += (a.mouth - P.mouth) * k10;
    P.lookYaw += (a.lookYaw - P.lookYaw) * k3; P.lookPitch += (a.lookPitch - P.lookPitch) * k3;
    P.bank += (a.bank - P.bank) * k6; P.yawRate += (a.yawRate - P.yawRate) * k3; P.pitchRate += (a.pitchRate - P.pitchRate) * k3;
    this.t += dt;
    this.phase += dt * a.rate * Math.PI * 2;
    const t = this.t, ph = this.phase, sn = Math.sin(ph), cs = Math.cos(ph);
    const F = P.flap, T = P.tuck, Bk = P.brake, Ld = P.landed, fly = 1 - Ld;
    const up = Math.max(0, cs);
    const idle = Math.sin(t * 0.9) * 0.5 + Math.sin(t * 2.3 + 1.0) * 0.2;

    // ---- body
    b.root.position.set(0, -0.5 * F * sn * fly + Ld * 0.07 * Math.sin(t * 1.15), 0);
    b.root.rotation.set(0.045 * F * cs * fly - 0.32 * Ld - 0.1 * Bk * fly, 0, 0);
    b.chest.rotation.set(-0.03 * F * cs * fly + 0.02 * idle * Ld, 0, 0);

    // ---- wings
    for (const side of [1, -1]) {
      const w = side > 0 ? b.wing.L : b.wing.R;
      const flut = 0.012 * Math.sin(t * 7.3 + side) * (1 - F) * fly;
      let elev = 0.11 + F * 0.82 * sn + Bk * 0.28 + flut + side * P.bank * -0.05;
      let sweep = 0.10 + F * 0.15 * cs + T * 0.78 - Bk * 0.24;
      let twist = 0.02 - F * 0.30 * cs - Bk * 0.45 + T * 0.04;
      let foreZ = 0.05 + F * 0.38 * Math.sin(ph - 1.0), foreY = 0.08 + F * 0.44 * up + T * 0.5;
      let handZ = 0.06 + F * 0.36 * Math.sin(ph - 1.7), handY = 0.10 + F * 0.5 * up + T * 0.8;
      let tipZ = 0.08 + F * 0.32 * Math.sin(ph - 2.3) + flut * 3;
      let fan = 1 - 0.55 * T - 0.28 * F * up;
      // folded on the ground
      elev = lerp(elev, 0.98 + 0.03 * idle, Ld); sweep = lerp(sweep, 1.28, Ld); twist = lerp(twist, -0.1, Ld);
      foreZ = lerp(foreZ, 0.0, Ld); foreY = lerp(foreY, -2.42, Ld);
      handZ = lerp(handZ, 0.0, Ld); handY = lerp(handY, 2.55, Ld);
      tipZ = lerp(tipZ, 0.02, Ld); fan = lerp(fan, 0.16, Ld);
      w.hum.rotation.set(twist, side * sweep, side * elev, 'ZYX');
      w.fore.rotation.set(0, side * foreY, side * foreZ, 'ZYX');
      w.hand.rotation.set(0, side * handY, side * handZ, 'ZYX');
      const fw = [1, 0.8, 0.55, 0.3];
      for (let k = 0; k < 4; k++) {
        const close = -(this.fingerAngles[k]) * (1 - fan);
        w.fingers[k][0].rotation.set(0, side * close, side * tipZ * fw[k], 'ZYX');
        w.fingers[k][1].rotation.set(0, side * close * 0.15, side * tipZ * 0.7 * fw[k], 'ZYX');
      }
    }

    // ---- legs
    for (const side of [1, -1]) {
      const l = side > 0 ? b.leg.L : b.leg.R;
      const trail = 0.05 * Math.sin(ph - 0.6) * F;
      l.thigh.rotation.set(lerp(0.32, 1.78 + trail, fly), 0, side * lerp(0.06, -0.16, fly));
      l.shin.rotation.set(lerp(0.0, -0.55, fly), 0, 0);
      l.foot.rotation.set(lerp(0.0, 1.5, fly), 0, 0);
    }

    // ---- tail: trailing, swaying, reacting to turns
    for (let i = 0; i < TAIL_N; i++) {
      const f = i / (TAIL_N - 1);
      const sway = Math.sin(t * 1.25 - i * 0.55) * (0.035 + 0.03 * f) * fly + Math.sin(t * 0.6 - i * 0.4) * 0.04 * Ld;
      const yaw = sway + P.yawRate * (0.10 + 0.10 * f) + P.bank * 0.02;
      const pit = P.pitchRate * (0.06 + 0.07 * f) + Math.sin(ph - 0.9 - i * 0.35) * 0.035 * F * fly + lerp(0.01, i < 3 ? -0.11 : 0.045, Ld);
      b.tail[i].rotation.set(pit, yaw, 0);
    }
    b.hip.rotation.set(-0.02 * F * cs * fly, 0, 0);

    // ---- neck & head: look toward aim, keep head level against the bank
    const ly = THREE.MathUtils.clamp(P.lookYaw, -1.0, 1.0), lp = THREE.MathUtils.clamp(P.lookPitch, -0.7, 0.7);
    const sC = [-0.12, -0.08, -0.02, 0.05, 0.08, 0.06];
    const sG = [-0.3, -0.26, -0.12, 0.1, 0.22, 0.2];
    for (let i = 0; i < NECK_N; i++) {
      const wave = Math.sin(ph - 0.5 + i * 0.4) * 0.025 * F * fly + Math.sin(t * 0.7 + i * 0.5) * 0.012;
      const base = lerp(sC[i], sG[i], Ld) - 0.05 * Bk * fly;
      b.neck[i].rotation.set(base + wave - lp / NECK_N * 0.8, -ly / NECK_N * 0.85, -P.bank * 0.5 / NECK_N * fly, 'YXZ');
    }
    b.head.rotation.set(lerp(0.08, 0.28, Ld) - lp * 0.25 + 0.05 * F * cs * fly - P.mouth * 0.12, -ly * 0.2, -P.bank * 0.12 * fly, 'YXZ');
    b.jaw.rotation.set(0.04 + P.mouth * 0.62 + Math.max(0, Math.sin(t * 0.45)) * 0.03, 0, 0);
  }
}
