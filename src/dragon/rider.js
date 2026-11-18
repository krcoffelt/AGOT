// Targaryen rider: a seated figure with layered clothing, a modelled face, flowing hair and cloak.
import * as THREE from 'three';
import { G, patchAtmosphere } from '../core/glsl.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = new THREE.Vector3(0, 1, 0);

function limb(a, b, r0, r1 = r0, seg = 12) {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, new THREE.Vector3().subVectors(b, a).normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}
function ball(c, r, sx = 1, sy = 1, sz = 1, w = 16, h = 12) {
  const g = new THREE.SphereGeometry(r, w, h); g.scale(sx, sy, sz); g.translate(c.x, c.y, c.z); return g;
}
function merge(list) {
  const parts = list.map(g => (g.index ? g.toNonIndexed() : g));
  let n = 0; for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) { pos.set(p.attributes.position.array, o * 3); nor.set(p.attributes.normal.array, o * 3); o += p.attributes.position.count; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}
function mat(color, rough = 0.8, metal = 0.0, key = 'rider') {
  return patchAtmosphere(new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }), null, key);
}

// cloth / hair that streams in the wind (vertex attribute `flow`: 0 at the root → 1 at the tip)
function flowMaterial(color, rough, amp, freq, key) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, side: THREE.DoubleSide });
  return patchAtmosphere(m, (shader) => {
    shader.uniforms.uTime = G.uTime; shader.uniforms.uFlow = { value: new THREE.Vector3(amp, freq, 1) };
    m.userData.flow = shader.uniforms.uFlow;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform vec3 uFlow;\nattribute float flow;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float f = flow * flow;
          float ph = uTime * (4.0 + 7.0 * uFlow.z) - position.z * uFlow.y * 6.0 + position.x * 3.0 + position.y * 2.0;
          transformed.y += (sin(ph) * 0.6 + sin(ph * 1.7 + 1.3) * 0.4) * uFlow.x * f * (0.3 + 0.7 * uFlow.z) + f * 0.32 * uFlow.z;
          transformed.x += sin(ph * 0.8 + 2.0) * uFlow.x * 0.55 * f;
          transformed.z -= f * 0.22 * uFlow.z;
        }`);
  }, 'flow' + key);
}
function strip(w0, w1, len, nx, nz, origin, droop, curveX = 0) {
  const pos = [], flow = [], idx = [];
  for (let j = 0; j <= nz; j++) {
    const t = j / nz; const w = w0 + (w1 - w0) * t;
    for (let i = 0; i <= nx; i++) {
      const s = i / nx - 0.5;
      pos.push(origin.x + s * w, origin.y - droop * t * t * len - Math.abs(s) * curveX * w * (1 - t * 0.5), origin.z - t * len * (1 - 0.3 * droop) - Math.abs(s) * 0.03 + Math.sin(s * 9 + j) * 0.006);
      flow.push(t);
    }
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('flow', new THREE.Float32BufferAttribute(flow, 1));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
// a tapered lock of hair along a path; radius may pulse (braids)
function lock(pts, r0, r1, sides = 6, braid = 0, flowFrom = 0) {
  const n = pts.length, pos = [], flow = [], idx = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const tan = new THREE.Vector3().subVectors(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
    const sx = new THREE.Vector3(1, 0, 0); const sy = new THREE.Vector3().crossVectors(tan, sx).normalize(); sx.crossVectors(sy, tan).normalize();
    const r = (r0 + (r1 - r0) * t) * (1 + braid * Math.abs(Math.sin(i * 1.9)) );
    for (let k = 0; k < sides; k++) { const a = (k / sides) * Math.PI * 2; pos.push(pts[i].x + (sx.x * Math.cos(a) + sy.x * Math.sin(a)) * r, pts[i].y + (sx.y * Math.cos(a) + sy.y * Math.sin(a)) * r * 0.75, pts[i].z + (sx.z * Math.cos(a) + sy.z * Math.sin(a)) * r); flow.push(Math.max(0, (t - flowFrom) / (1 - flowFrom))); }
  }
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < sides; k++) { const a = i * sides + k, b = i * sides + (k + 1) % sides, c = a + sides, d = b + sides; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('flow', new THREE.Float32BufferAttribute(flow, 1));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function mergeFlow(list) {
  const parts = list.map(g => g.toNonIndexed());
  let n = 0; for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), fl = new Float32Array(n); let o = 0;
  for (const p of parts) { pos.set(p.attributes.position.array, o * 3); nor.set(p.attributes.normal.array, o * 3); fl.set(p.attributes.flow.array, o); o += p.attributes.position.count; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('flow', new THREE.BufferAttribute(fl, 1));
  return g;
}

// The knight: the user's own scan, seated in Blender (tools/blender/rider_knight_web.py, from the Unreal prototype's pose).
// One rigid figure with his own saddle, origin at the seat, facing +Z. Vertex colour R marks the cloak (how freely it
// trails), so the shader can stream it in the wind.
let KNIGHT = null;
export async function loadKnight() {
  try {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const gltf = await new GLTFLoader().loadAsync('/models/rider_knight.glb');
    const flow = { value: 0 }, parts = [];
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const geo = o.geometry.clone(); geo.applyMatrix4(o.matrixWorld);
      const c = geo.getAttribute('color'); if (c) { geo.setAttribute('aTrail', c); geo.deleteAttribute('color'); }
      const m = o.material.clone(); m.vertexColors = false; m.side = THREE.DoubleSide;
      if (c) m.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = G.uTime; sh.uniforms.uFlow = flow;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aTrail;\nuniform float uTime, uFlow;')
          .replace('#include <begin_vertex>', `vec3 transformed = vec3(position);
          { float k = aTrail.r * (0.25 + uFlow), z = -position.z;      // the cloak streams back and ripples, more the faster he flies
            transformed.y += k * (0.05 * sin(uTime * 9.0 - z * 7.0) + 0.025 * sin(uTime * 15.0 - z * 13.0 + position.x * 6.0) + 0.12 * uFlow * z);
            transformed.x += k * 0.035 * sin(uTime * 7.0 - z * 5.0 + 1.3);
            transformed.z -= k * 0.08 * uFlow; }`);
      };
      parts.push({ geo, mat: patchAtmosphere(m, null, 'knight' + parts.length) });
    });
    KNIGHT = { parts, flow };
  } catch (e) { console.warn('[rider] knight not loaded:', e.message); }
  return !!KNIGHT;
}
function buildKnight() {
  const group = new THREE.Group(), body = new THREE.Group(); group.add(body);
  for (const p of KNIGHT.parts) { const m = new THREE.Mesh(p.geo, p.mat); m.castShadow = true; m.receiveShadow = true; body.add(m); }
  return {
    group, body, head: body,
    setWind(speed01) { KNIGHT.flow.value = speed01; },
    // a rigid figure, so the whole of him leans: forward into the wind, against the bank, back when the dragon rears
    pose(bank, speed01, lookYaw, lookPitch, upright = 0) { body.rotation.set(0.1 * speed01 - upright * 0.22, lookYaw * 0.12, -bank * 0.22); },
  };
}

export function buildRider(def, saddleRadius = 1.0) {
  if (def.model === 'knight' && KNIGHT) return buildKnight();
  const group = new THREE.Group();
  const fem = def.female, armor = def.armor;
  const skin = mat(def.skin, 0.55, 0, 'riderSkin'), outfit = mat(def.outfit, armor ? 0.42 : 0.8, armor ? 0.6 : 0.03, 'riderB');
  const outfit2 = mat(new THREE.Color(def.outfit).multiplyScalar(1.5).addScalar(0.01), 0.7, armor ? 0.35 : 0.02, 'riderB2');
  const trim = mat(def.trim, 0.36, 0.8, 'riderC'), leather = mat('#2a1c14', 0.72, 0, 'riderL'), dark = mat('#0c0b0c', 0.55, 0.1, 'riderD');
  const hairM = mat(def.hair, 0.42, 0.0, 'riderH'), steel = mat('#8f959c', 0.28, 0.95, 'riderS');
  const flows = [];
  const R = saddleRadius;
  const surf = (x) => -(R - Math.sqrt(Math.max(0.01, R * R - x * x)));
  const add = (parent, geo, m) => { const mesh = new THREE.Mesh(geo, m); mesh.castShadow = true; parent.add(mesh); return mesh; };

  // ---- torso group leans into the wind
  const body = new THREE.Group(); body.position.set(0, 0.1, 0); body.rotation.x = 0.3; group.add(body);
  const sh = fem ? 0.172 : 0.208, waist = fem ? 0.108 : 0.145, hipW = fem ? 0.162 : 0.158, depth = fem ? 0.6 : 0.66;
  const prof = [[0.0, hipW * 0.55], [0.03, hipW * 0.96], [0.1, hipW], [0.18, hipW * 0.9], [0.26, waist], [0.33, waist * 1.04], [0.4, waist * 1.18], [0.47, sh * 0.93], [0.53, sh], [0.58, sh * 0.97], [0.62, sh * 0.8], [0.65, 0.075], [0.68, 0.052]]
    .map(([y, r]) => new THREE.Vector2(r, y));
  const torso = new THREE.LatheGeometry(prof, 24); torso.scale(1, 1, depth);
  add(body, torso, outfit);
  if (fem) add(body, merge([ball(V(0.062, 0.468, 0.078), 0.06, 1, 0.95, 0.85), ball(V(-0.062, 0.468, 0.078), 0.06, 1, 0.95, 0.85)]), outfit);
  else add(body, ball(V(0, 0.48, 0.05), 0.15, 1.15, 0.7, 0.55), outfit);                         // chest
  // coat skirts falling over the saddle
  const skirt = new THREE.CylinderGeometry(waist * 1.04, hipW * 1.75, 0.34, 20, 1, true); skirt.scale(1, 1, 0.95); skirt.translate(0, 0.1, -0.02);
  add(body, skirt, outfit2).material.side = THREE.DoubleSide;
  // belt, buckle, collar, shoulder seams
  const belt = new THREE.TorusGeometry(waist * 1.07, 0.02, 8, 28); belt.rotateX(Math.PI / 2); belt.scale(1, 1, depth + 0.04); belt.translate(0, 0.265, 0);
  const buckle = new THREE.BoxGeometry(0.05, 0.045, 0.02); buckle.translate(0, 0.265, waist * (depth + 0.04) + 0.012);
  const collar = new THREE.TorusGeometry(0.066, 0.017, 6, 18); collar.rotateX(Math.PI / 2 - 0.25); collar.translate(0, 0.655, 0.004);
  add(body, merge([belt, buckle, collar]), trim);
  // chest piece: three-headed-dragon brooch and a diagonal baldric / chain
  const brooch = new THREE.CylinderGeometry(0.034, 0.034, 0.014, 6); brooch.rotateX(Math.PI / 2); brooch.translate(0, 0.52, sh * depth * 0.96 + 0.012);
  add(body, merge([brooch, limb(V(sh * 0.72, 0.6, 0.06), V(-waist * 0.9, 0.29, 0.085), 0.014, 0.014, 6), limb(V(sh * 0.72, 0.6, -0.07), V(-waist * 0.9, 0.29, -0.09), 0.014, 0.014, 6)]), trim);
  if (armor) {
    // layered pauldrons, breastplate ridge, vambraces handled with the arms
    const pd = []; for (const sx of [1, -1]) { pd.push(ball(V(sx * sh * 1.0, 0.6, 0), 0.082, 1.15, 0.72, 1.05)); pd.push(ball(V(sx * sh * 1.1, 0.56, 0), 0.07, 1.1, 0.6, 1.0)); }
    add(body, merge(pd), steel);
    add(body, merge([ball(V(0, 0.47, 0.07), 0.14, 1.2, 0.95, 0.5), limb(V(0, 0.32, 0.105), V(0, 0.6, 0.1), 0.014, 0.01, 6)]), steel);
  } else {
    add(body, merge([ball(V(sh * 0.98, 0.585, 0), 0.062, 1.05, 0.8, 1.0), ball(V(-sh * 0.98, 0.585, 0), 0.062, 1.05, 0.8, 1.0)]), outfit2);
  }
  if (def.fur) {
    const fur = []; for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; fur.push(ball(V(Math.cos(a) * sh * 0.92, 0.615 + Math.sin(i * 2.3) * 0.012, Math.sin(a) * sh * 0.62 - 0.01), 0.062 + (i % 3) * 0.008, 1, 0.8, 1, 8, 6)); }
    add(body, merge(fur), mat('#2a241e', 1.0, 0, 'riderFur'));
  }

  // ---- arms reach forward to the saddle horn
  for (const sx of [1, -1]) {
    const s = V(sx * (sh - 0.012), 0.585, 0), e = V(sx * (sh + 0.055), 0.36, 0.15), h = V(sx * 0.085, 0.2, 0.37);
    add(body, merge([limb(s, e, 0.05, 0.043), ball(s, 0.054), ball(e, 0.045), limb(e, lerp3(e, h, 0.55), 0.043, 0.036)]), outfit);
    add(body, merge([limb(lerp3(e, h, 0.5), h, 0.041, 0.034), limb(lerp3(e, h, 0.5), lerp3(e, h, 0.56), 0.046, 0.046, 10)]), armor ? steel : leather);   // bracer / glove cuff
    // hand: palm, fingers curled round the horn, thumb
    const hand = [ball(h, 0.036, 0.95, 0.8, 1.2)];
    for (let f = 0; f < 4; f++) hand.push(limb(V(h.x - sx * 0.022 + sx * f * 0.014, h.y - 0.005, h.z + 0.03), V(h.x - sx * 0.03 + sx * f * 0.014 - sx * 0.02, h.y - 0.035, h.z + 0.045), 0.0085, 0.007, 5));
    hand.push(limb(V(h.x - sx * 0.03, h.y + 0.01, h.z + 0.01), V(h.x - sx * 0.05, h.y + 0.005, h.z + 0.04), 0.0095, 0.008, 5));
    add(body, merge(hand), armor ? dark : skin);
  }

  // ---- head (own group so it can turn toward where the rider is looking)
  const headG = new THREE.Group(); headG.position.set(0, 0.76, 0.012); headG.rotation.x = -0.22; body.add(headG);
  add(body, limb(V(0, 0.655, 0.0), V(0, 0.775, 0.012), 0.047, 0.041), skin);
  const hc = V(0, 0.095, 0.018);
  add(headG, merge([
    ball(hc, 0.104, 0.84, 1.05, 0.97, 22, 16),
    ball(V(0, 0.04, 0.056), 0.066, 0.92, 0.95, 0.86, 16, 12),                        // lower face
    ball(V(0, 0.004, 0.078), 0.03, 1.0, 0.7, 0.8, 10, 8),                            // chin
    ball(V(0.052, 0.07, 0.07), 0.03, 0.9, 0.7, 0.6, 10, 8), ball(V(-0.052, 0.07, 0.07), 0.03, 0.9, 0.7, 0.6, 10, 8),   // cheekbones
    limb(V(0, 0.118, 0.108), V(0, 0.07, 0.126), 0.011, 0.016, 6), ball(V(0, 0.066, 0.124), 0.017, 1.15, 0.8, 0.9, 8, 6),   // nose bridge + tip
    ball(V(0.086, 0.092, 0.022), 0.022, 0.45, 1.2, 0.8, 8, 6), ball(V(-0.086, 0.092, 0.022), 0.022, 0.45, 1.2, 0.8, 8, 6), // ears
    ball(V(0, 0.118, 0.094), 0.05, 1.5, 0.35, 0.5, 10, 6),                           // brow ridge
  ]), skin);
  add(headG, ball(V(0, 0.038, 0.108), 0.019, 1.5, 0.42, 0.6, 10, 6), mat(fem ? '#a8504a' : '#96605a', 0.5, 0, 'riderLip'));
  // eyes: whites, violet irises, dark lashes and brows
  const eyeW = [], eyeI = [], lash = [];
  for (const sx of [1, -1]) {
    if (def.eyepatch && sx < 0) continue;
    eyeW.push(ball(V(sx * 0.036, 0.102, 0.103), 0.0125, 1.35, 0.72, 0.6, 10, 8));
    eyeI.push(ball(V(sx * 0.036, 0.102, 0.1105), 0.0068, 1, 1, 0.5, 8, 6));
    lash.push(limb(V(sx * 0.019, 0.111, 0.11), V(sx * 0.054, 0.1115, 0.103), 0.0028, 0.002, 4));
  }
  add(headG, merge(eyeW), mat('#e4e0d8', 0.25, 0, 'riderEyeW'));
  add(headG, merge(eyeI), mat(def.id === 'jon' ? '#2a2018' : '#6a34a8', 0.2, 0, 'riderEyeI'));
  add(headG, merge([...lash, limb(V(0.014, 0.127, 0.112), V(0.062, 0.131, 0.098), 0.0048, 0.003, 5), limb(V(-0.014, 0.127, 0.112), V(-0.062, 0.131, 0.098), 0.0048, 0.003, 5)]),
    mat(new THREE.Color(def.hair).multiplyScalar(def.id === 'jon' ? 0.6 : 0.42), 0.6, 0, 'riderBrow'));
  if (def.eyepatch) {
    add(headG, merge([ball(V(-0.036, 0.102, 0.104), 0.021, 1.25, 1.0, 0.45, 10, 8), limb(V(-0.088, 0.135, 0.04), V(0.084, 0.142, 0.05), 0.0045, 0.0045, 5), limb(V(-0.088, 0.135, 0.04), V(-0.03, 0.12, -0.09), 0.0045, 0.0045, 5)]), dark);
    add(headG, ball(V(-0.036, 0.102, 0.114), 0.006, 1, 1, 0.6, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x2a6cff).multiplyScalar(2.2) }));   // the sapphire
  }

  // ---- hair
  const cap = new THREE.SphereGeometry(0.112, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.6);
  cap.scale(0.88, 1.05, 1.02); cap.rotateX(-0.5); cap.translate(hc.x, hc.y + 0.012, hc.z - 0.014);
  const hairSolid = [cap];
  const hairFlow = flowMaterial(def.hair, 0.42, 0.045, 1.4, 'hair' + def.id); flows.push(hairFlow);
  const locks = [];
  const lockPath = (ox, oy, len, sweep, lift, n = 9) => { const p = []; for (let i = 0; i < n; i++) { const t = i / (n - 1); p.push(V(ox * (1 + t * sweep), oy - t * t * len * 0.75 + lift * t, -0.085 - t * len * 0.55 - Math.sin(t * 3 + ox * 20) * 0.012)); } return p; };
  if (def.hairStyle === 'long') {
    hairSolid.push(ball(V(0, 0.045, -0.075), 0.09, 0.95, 1.25, 0.6, 14, 10));
    for (let i = 0; i < 11; i++) { const ox = (i / 10 - 0.5) * 0.17; locks.push(lock(lockPath(ox, 0.1 - Math.abs(ox) * 0.5, 0.5 + (i % 3) * 0.09, 0.5, 0.02), 0.03, 0.006, 6, 0, 0.12)); }
    for (const sx of [1, -1]) locks.push(lock([V(sx * 0.09, 0.12, 0.04), V(sx * 0.1, 0.05, 0.03), V(sx * 0.1, -0.03, 0.0), V(sx * 0.105, -0.12, -0.05), V(sx * 0.11, -0.2, -0.12)], 0.02, 0.006, 5, 0, 0.3));
  } else if (def.hairStyle === 'braid') {
    hairSolid.push(ball(V(0, 0.05, -0.078), 0.085, 0.95, 1.1, 0.6, 14, 10));
    const crown = new THREE.TorusGeometry(0.098, 0.019, 6, 26, Math.PI * 1.35); crown.rotateX(Math.PI / 2 - 0.4); crown.rotateY(-Math.PI * 0.175); crown.translate(hc.x, hc.y + 0.04, hc.z - 0.012);
    hairSolid.push(crown);
    const main = []; for (let i = 0; i <= 14; i++) { const t = i / 14; main.push(V(Math.sin(t * 5) * 0.008, 0.07 - t * 0.5, -0.1 - t * 0.2 - Math.sin(t * 3) * 0.02)); }
    locks.push(lock(main, 0.034, 0.016, 7, 0.38, 0.35));
    for (const sx of [1, -1]) { const side = []; for (let i = 0; i <= 10; i++) { const t = i / 10; side.push(V(sx * (0.085 - t * 0.06), 0.13 - t * 0.2, 0.02 - t * 0.16)); } hairSolid.push(lock(side, 0.016, 0.012, 5, 0.35)); }
    for (let i = 0; i < 5; i++) { const ox = (i / 4 - 0.5) * 0.12; locks.push(lock(lockPath(ox, 0.06, 0.32, 0.6, 0.02, 7), 0.02, 0.004, 5, 0, 0.1)); }
  } else if (def.hairStyle === 'tied') {
    hairSolid.push(ball(V(0, 0.105, -0.108), 0.042, 1, 1, 0.9, 10, 8));
    for (let i = 0; i < 7; i++) { const ox = (i / 6 - 0.5) * 0.14; locks.push(lock(lockPath(ox, 0.07, 0.17, 0.3, 0.0, 6), 0.022, 0.005, 5, 0, 0.1)); }
    for (let i = 0; i < 5; i++) { const ox = (i / 4 - 0.5) * 0.15; hairSolid.push(lock([V(ox, 0.185, 0.07), V(ox * 1.2, 0.165, 0.105), V(ox * 1.3, 0.13, 0.115)], 0.02, 0.008, 5)); }   // curls over the brow
    add(headG, merge([ball(V(0, 0.028, 0.07), 0.062, 1.0, 0.92, 0.82, 14, 10), ball(V(0, 0.052, 0.112), 0.022, 1.6, 0.35, 0.5, 8, 6)]), mat('#1e1714', 0.9, 0, 'riderBeard'));
  } else {
    for (let i = 0; i < 9; i++) { const ox = (i / 8 - 0.5) * 0.16; locks.push(lock(lockPath(ox, 0.1, 0.1, 0.2, 0.01, 5), 0.026, 0.008, 5, 0, 0.3)); }
    hairSolid.push(ball(V(0, 0.07, -0.07), 0.08, 1, 0.9, 0.6, 12, 8));
  }
  add(headG, merge(hairSolid.map(g => { if (g.attributes.flow) g.deleteAttribute('flow'); if (!g.attributes.normal) g.computeVertexNormals(); return g; })), hairM);
  if (locks.length) add(headG, mergeFlow(locks), hairFlow);
  if (def.crown) {
    const cr = new THREE.TorusGeometry(0.097, 0.011, 6, 28); cr.rotateX(Math.PI / 2 - 0.12); cr.translate(hc.x, hc.y + 0.062, hc.z);
    const pts = [cr]; for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; const c = new THREE.ConeGeometry(0.011, 0.05, 4); c.translate(Math.cos(a) * 0.097, hc.y + 0.092, hc.z + Math.sin(a) * 0.097); pts.push(c); }
    add(headG, merge(pts), mat('#c9a13a', 0.28, 0.95, 'riderG'));
    for (let i = 0; i < 3; i++) add(headG, ball(V(Math.sin((i - 1) * 0.5) * 0.097, hc.y + 0.066, hc.z + Math.cos((i - 1) * 0.5) * 0.097), 0.009, 1, 1, 1, 6, 5), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xc0100c).multiplyScalar(1.6) }));
  }

  // ---- legs straddle the neck (not leaned with the torso)
  for (const sx of [1, -1]) {
    const hp = V(sx * 0.085, 0.1, 0), kx = Math.min(R * 0.72, 0.5), fx = Math.min(R * 0.95, 0.8);
    const k = V(sx * kx, surf(kx) + 0.105, 0.25), f = V(sx * fx, surf(fx * 0.98) - 0.19, 0.03);
    add(group, merge([limb(hp, k, 0.086, 0.064), ball(hp, 0.09), ball(k, 0.066)]), outfit);
    const boot = [limb(lerp3(k, f, 0.12), f, 0.062, 0.05), limb(lerp3(k, f, 0.1), lerp3(k, f, 0.2), 0.07, 0.068, 10), ball(V(f.x, f.y - 0.02, f.z + 0.055), 0.055, 0.85, 0.7, 1.9), ball(V(f.x, f.y - 0.035, f.z - 0.03), 0.045, 0.8, 0.6, 0.9)];
    add(group, merge(boot), leather);
    if (armor) add(group, merge([ball(V(k.x, k.y + 0.01, k.z + 0.03), 0.06, 1, 1.1, 0.8, 10, 8), limb(lerp3(k, f, 0.25), lerp3(k, f, 0.75), 0.066, 0.058, 8)]), steel);
    // stirrup leather
    add(group, limb(V(sx * 0.2, 0.02, 0.05), V(f.x, f.y - 0.06, f.z + 0.02), 0.012, 0.012, 5), leather);
  }

  // ---- saddle: blanket, padded seat, pommel horn, cantle, girth
  const pad = new THREE.SphereGeometry(0.33, 18, 10); pad.scale(1.05, 0.24, 1.45); pad.translate(0, 0.03, 0.02);
  const cantle = new THREE.TorusGeometry(0.2, 0.055, 8, 14, Math.PI); cantle.rotateX(-0.3); cantle.translate(0, 0.02, -0.3);
  add(group, merge([pad, limb(V(0, 0.03, 0.36), V(0, 0.25, 0.41), 0.045, 0.03, 10), ball(V(0, 0.26, 0.412), 0.04), cantle]), leather);
  // girth straps over the top of the neck (short arcs so they hug the hide in any pose)
  const strap = (z, tube) => { const g = new THREE.TorusGeometry(R * 1.004, tube, 6, 18, Math.PI * 0.3); g.rotateZ(Math.PI * 0.35); g.translate(0, -R, z); return g; };
  add(group, merge([strap(0.02, 0.034), strap(-0.34, 0.028)]), leather);
  add(group, merge([ball(V(0.32, 0.0, 0.3), 0.03), ball(V(-0.32, 0.0, 0.3), 0.03), ball(V(0.32, 0.0, -0.3), 0.03), ball(V(-0.32, 0.0, -0.3), 0.03)]), trim);

  // ---- cloak: shoulder mantle + long streaming cape
  const cloakM = flowMaterial(def.cloak, 0.86, 0.11, 0.9, 'cloak' + def.id); flows.push(cloakM);
  const mantle = new THREE.CylinderGeometry(sh * 0.8, sh * 1.2, 0.13, 18, 1, true, Math.PI * 0.62, Math.PI * 1.76); mantle.scale(1, 1, 0.75); mantle.translate(0, 0.565, -0.02);
  add(body, mantle, mat(def.cloak, 0.86, 0, 'riderMantle')).material.side = THREE.DoubleSide;
  add(body, strip(sh * 2.1, sh * 3.3, 1.3, 10, 18, V(0, 0.6, -0.09), 0.4, 0.44), cloakM);
  add(body, merge([ball(V(sh * 0.66, 0.622, 0.062), 0.024), ball(V(-sh * 0.66, 0.622, 0.062), 0.024), limb(V(sh * 0.66, 0.622, 0.066), V(-sh * 0.66, 0.622, 0.066), 0.006, 0.006, 5)]), trim);

  // ---- sword
  if (armor) {
    const blade = merge([limb(V(0.15, 0.6, -0.14), V(-0.21, 0.0, -0.19), 0.02, 0.014, 6), limb(V(0.215, 0.555, -0.14), V(0.09, 0.64, -0.14), 0.013, 0.013, 6)]);
    add(body, blade, leather);
    add(body, merge([limb(V(0.15, 0.6, -0.14), V(0.215, 0.725, -0.13), 0.012, 0.013, 6), ball(V(0.222, 0.74, -0.129), 0.02)]), steel);
    add(body, ball(V(0.222, 0.74, -0.129), 0.011), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xb01010).multiplyScalar(1.5) }));
  }

  return {
    group, body, head: headG,
    // speed01: how hard the wind is blowing (0 on the ground → 1 at full flight)
    setWind(speed01) { for (const m of flows) if (m.userData.flow) m.userData.flow.value.z = speed01; },
    // lean against the bank, crouch at speed, and look where the dragon is being steered
    // upright: 0 in flight → 1 when the dragon is rearing on the ground (sit up against the tilt of the neck)
    pose(bank, speed01, lookYaw, lookPitch, upright = 0) {
      body.rotation.set(0.24 + 0.2 * speed01 + upright * 0.5, 0, -bank * 0.32);
      headG.rotation.set(-0.16 - 0.2 * speed01 - lookPitch * 0.4 + upright * 0.1, -lookYaw * 0.7, 0);
    },
  };
}
function lerp3(a, b, t) { return new THREE.Vector3().lerpVectors(a, b, t); }
