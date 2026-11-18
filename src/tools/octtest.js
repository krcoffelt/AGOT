// Dev harness for checking a tree impostor against its real mesh (not loaded by the game).
// In a test tab: await (await import('/src/tools/octtest.js')).setup('b')      // 'c' fir, 'b' / 'b2' broadleaf
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { toWorld } from '../world/mapdata.js';

const SRC = {
  c: { url: '/assets-src/models/conifer_a/conifer_a.glb', size: 17, origin: true },
  b: { url: '/assets-src/models/broadleaf_a/broadleaf_a.glb', size: 16, origin: true },
  b2: { url: '/assets-src/models/broadleaf_b/broadleaf_b.glb', size: 18, origin: true },
};

export async function setup(kind = 'c') {
  const game = window.game, tr = game.trees, src = SRC[kind];
  const [kx, kz] = toWorld(68.5, 138.6);      // Kingswood
  document.getElementById('ui').style.display = 'none'; game.sky.locked = true; game.sky.setTime(15);
  const gy = game.field.surfaceAt(kx, kz); window.T = { kx, kz, gy };
  game.look(kx, gy + 70, kz, kx + 120, gy + 5, kz + 60); game.step(3, [], 60, false);
  // every tree drawn as one species, so the whole forest shows the impostor under test; allKind(null) puts the mix back
  const orig = new Map();
  window.allKind = (k) => { let n = 0; for (const ch of tr.chunks.values()) { if (!ch) continue; for (const mm of ch.meshes) { if (mm.userData.small) continue; if (!orig.has(mm)) orig.set(mm, mm.userData.type); const want = k || orig.get(mm); if (mm.userData.type !== want) { mm.userData.type = want; n++; } } ch.tier = -1; } window.KIND = k; return n; };
  window.KIND = null;
  window.shot = async (name, on) => { tr.setOcta(on); allKind(window.KIND); game.step(0.05); game.step(0.05); return game.capture(name); };
  // the real mesh, stood exactly where one impostor tree is
  const gltf = await new GLTFLoader().loadAsync(src.url);
  const root = src.node ? gltf.scene.getObjectByName(src.node) : gltf.scene; root.updateMatrixWorld(true); const box = new THREE.Box3().setFromObject(root);
  root.traverse(o => { if (o.isMesh) { const mt = o.material; o.material = new THREE.MeshBasicMaterial({ map: mt.map, color: mt.color, vertexColors: !!o.geometry.attributes.color, side: THREE.DoubleSide, alphaTest: (mt.transparent || mt.alphaTest > 0) ? Math.max(mt.alphaTest, 0.5) : 0 }); } });
  const tx = kx + 120, tz = kz + 60; let best = null;
  for (const ch of tr.chunks.values()) { if (!ch) continue; for (const mm of ch.meshes) { if (mm.userData.small) continue; const a = mm.geometry.attributes.aOffset.array, p = mm.geometry.attributes.aParams.array; for (let i = 0; i < mm.userData.n; i++) { const d = Math.hypot(a[i * 4] - tx, a[i * 4 + 2] - tz); if (!best || d < best.d) best = { d, x: a[i * 4], y: a[i * 4 + 1], z: a[i * 4 + 2], w: a[i * 4 + 3], rot: p[i * 4] }; } } }
  const Ht = box.max.y - box.min.y, k = src.size / Ht * best.w; const cx = src.origin ? 0 : (box.min.x + box.max.x) / 2, cz = src.origin ? 0 : (box.min.z + box.max.z) / 2;
  const holder = new THREE.Group(), inner = new THREE.Group(); inner.add(root); inner.position.set(-cx, -box.min.y, -cz); holder.add(inner);
  holder.position.set(best.x, best.y, best.z); holder.scale.setScalar(k); holder.rotation.y = best.rot; holder.visible = false; tr.group.parent.add(holder);
  const g = new THREE.InstancedBufferGeometry(); for (const n of ['position', 'normal', 'color']) g.setAttribute(n, tr.geo[kind][0].attributes[n]);
  g.setAttribute('aOffset', new THREE.InstancedBufferAttribute(new Float32Array([best.x, best.y, best.z, best.w]), 4)); g.setAttribute('aParams', new THREE.InstancedBufferAttribute(new Float32Array([best.rot, 0.5, 0, 0]), 4)); g.instanceCount = 1;
  // The solo quad compares the atlas to its source even inside the game's mesh range.
  const oct = tr.oct[kind].mats[0];
  const soloOct = new THREE.ShaderMaterial({ vertexShader: oct.vertexShader, fragmentShader: oct.fragmentShader,
    uniforms: { ...oct.uniforms, uNearEnabled: { value: 0 } }, defines: oct.defines, side: oct.side, alphaToCoverage: true });
  const newMat = () => soloOct, oldMat = () => tr.ring[kind].mats[0];
  const solo = new THREE.Mesh(g, newMat()); solo.frustumCulled = false; solo.visible = false; tr.group.parent.add(solo);
  window.RT = { holder, best, solo, newMat, oldMat, half: src.size * best.w / 2 };
  window.orbit = (az, el, dist) => { const b = best, cy = b.y + RT.half; game.look(b.x + Math.sin(az) * Math.cos(el) * dist, cy + Math.sin(el) * dist, b.z + Math.cos(az) * Math.cos(el) * dist, b.x, cy, b.z); };
  // one tree alone against an empty background: .shots/<tag>_{bg,mesh,new,old}.jpg
  const scene = tr.group.parent;
  window.quad = async (tag, az, el, dist) => {
    orbit(az, el, dist); game.step(0.05); game.step(0.05);
    const vis = scene.children.map(c => c.visible); const hide = () => scene.children.forEach(c => { if (c !== holder && c !== solo) c.visible = false; });
    holder.visible = false; solo.visible = false; hide(); await game.capture('tmp');
    hide(); await game.capture(tag + '_bg'); hide(); holder.visible = true; await game.capture(tag + '_mesh'); holder.visible = false; solo.visible = true;
    hide(); solo.material = newMat(); await game.capture(tag + '_new'); hide(); solo.material = oldMat(); await game.capture(tag + '_old');
    scene.children.forEach((c, i) => { c.visible = vis[i]; }); solo.visible = false; holder.visible = false;
  };
  window.QV = [[0.5, 0.05], [0.5, 0.35], [0.5, 0.75], [0.5, 1.2], [0.72, 0.5], [2.3, 0.2], [3.9, 0.95], [5.2, 1.45]];
  window.quads = async (pre = 'q', dist = 32) => { for (let i = 0; i < QV.length; i++) await quad(pre + i, QV[i][0], QV[i][1], dist); return 'ok'; };
  // forest overview from the air, new and old: .shots/<tag>_{new,old}.jpg
  window.forest = async (tag, alt = 70, dx = 120, dz = 60) => { game.look(kx, gy + alt, kz, kx + dx, gy + 5, kz + dz); game.step(1, [], 60, false); allKind(window.KIND); return [await shot(tag + '_new', true), await shot(tag + '_old', false)]; };
  // how much the tree's picture changes per small camera step along a path of [az, el]: a snapping impostor spikes
  const cv = document.querySelector('canvas'); const c2 = document.createElement('canvas'); c2.width = 512; c2.height = 384; const ctx = c2.getContext('2d', { willReadFrequently: true });
  const grab = () => { ctx.drawImage(cv, 0, 0, 512, 384); return ctx.getImageData(0, 0, 512, 384).data; };
  window.sweep = (mat, path, dist = 40) => {
    const gk = game.grass.group.children.slice(); gk.forEach(c => game.grass.group.remove(c));      // grass switches itself back on every frame
    const vis = scene.children.map(c => c.visible); const hide = () => scene.children.forEach(c => { if (c !== solo) c.visible = false; }); solo.material = mat; let prev = null; const d = [];
    for (const [az, el] of path) {
      orbit(az, el, dist); hide(); solo.visible = false; game.step(1 / 60); hide(); game.step(0); const bg = grab().slice(); hide(); solo.visible = true; game.step(0); const px = grab();
      const t = new Int16Array(px.length / 4); for (let i = 0; i < t.length; i++) t[i] = px[i * 4 + 1] - bg[i * 4 + 1];
      if (prev) { let sum = 0; for (let i = 0; i < t.length; i++) sum += Math.abs(t[i] - prev[i]); d.push(sum / t.length); } prev = t;
    }
    gk.forEach(c => game.grass.group.add(c)); scene.children.forEach((c, i) => { c.visible = vis[i]; }); solo.visible = false;
    const srt = d.slice().sort((a, b) => a - b); return { median: +srt[srt.length >> 1].toFixed(3), max: +srt[srt.length - 1].toFixed(3) };
  };
  window.pops = () => { const circle = [], climb = [], high = []; for (let i = 0; i <= 120; i++) { circle.push([0.3 + i * 0.008, 0.45]); climb.push([0.5, 0.15 + i * 0.011]); high.push([0.5 + i * 0.02, 1.25]); } const out = {}; for (const [k, p] of [['circle', circle], ['climb', climb], ['circleHigh', high]]) out[k] = { new: sweep(newMat(), p), old: sweep(oldMat(), p) }; return out; };
  // mean brightness of the forest picture, new and old, at four times of day from three heights (used to fit OCT_TONE)
  const c3 = document.createElement('canvas'); c3.width = 256; c3.height = 192; const ctx3 = c3.getContext('2d', { willReadFrequently: true });
  const lum = () => { game.step(0.05); game.step(0.05); ctx3.drawImage(cv, 0, 0, 256, 192); const px = ctx3.getImageData(0, 60, 256, 132).data; let s = 0; for (let i = 0; i < px.length; i += 4) s += px[i] * 0.3 + px[i + 1] * 0.6 + px[i + 2] * 0.1; return s / (px.length / 4); };
  window.setDef = (kinds, key, v) => { for (const k of kinds) for (const m of new Set(tr.oct[k].mats)) { m.defines[key] = v; m.needsUpdate = true; } };
  window.toneRun = (kinds, cfgs) => {
    const conds = []; for (const h of [8, 12, 15, 18]) for (const v of [[70, 120, 60], [35, 90, 20], [160, 30, 15]]) conds.push([h, ...v]);
    const out = cfgs.map(() => []), old = [];
    for (const [h, alt, dx, dz] of conds) {
      game.sky.setTime(h); game.look(kx, gy + alt, kz, kx + dx, gy + 5, kz + dz); game.step(0.3, [], 60, false);
      tr.setOcta(false); allKind(window.KIND); old.push(lum()); tr.setOcta(true); allKind(window.KIND);
      cfgs.forEach(([S, A], i) => { setDef(kinds, 'OCT_SUN', S.toFixed(3)); setDef(kinds, 'OCT_AMB', A.toFixed(3)); out[i].push(lum()); });
    }
    game.sky.setTime(15); return { old, out };
  };
  // least-squares OCT_SUN / OCT_AMB that bring the new forest's brightness to the old one's
  window.toneFit = (kinds, s0 = 1.3, a0 = 1.55) => {
    const r = toneRun(kinds, [[s0, a0], [s0 - 0.4, a0], [s0, a0 - 0.4]]); let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
    r.old.forEach((o, i) => { const n0 = r.out[0][i], ds = (n0 - r.out[1][i]) / 0.4, da = (n0 - r.out[2][i]) / 0.4, d = o - n0; a11 += ds * ds; a12 += ds * da; a22 += da * da; b1 += ds * d; b2 += da * d; });
    const det = a11 * a22 - a12 * a12; const fit = [s0 + (b1 * a22 - b2 * a12) / det, a0 + (a11 * b2 - a12 * b1) / det];
    const chk = toneRun(kinds, [fit]); return { fit: fit.map(v => +v.toFixed(2)), ratio: chk.out[0].map((v, i) => +(v / chk.old[i]).toFixed(2)) };
  };
  return { best, octa: tr.octa };
}
