// A dragon that arrives fully modelled, rigged and animated (the user's own Drogon, converted by tools/blender/drogon_user.py).
// It exposes the same surface as the procedural Dragon class (group, bones.saddle, pose, phase, update, getMouth, standHeight …)
// so flight, camera, fire and rider code do not care which kind they are driving.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { patchAtmosphere } from '../core/glsl.js';

export const RIGGED = {};   // dragon id → { scene, clips }
const FILES = { drogon: 'drogon_rig' };
const FPS = 24;

export async function loadRiggedDragons() {
  await Promise.all(Object.entries(FILES).map(async ([id, file]) => {
    try {
      const gltf = await new GLTFLoader().loadAsync(`/models/${file}.glb`);
      const tl = new THREE.TextureLoader();
      const nrm = async (part) => { try { const t = await tl.loadAsync(`/models/${file}_${part}_n.jpg`); t.flipY = false; t.anisotropy = 8; t.colorSpace = THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; } catch (e) { return null; } };
      const [nBody, nHead] = await Promise.all([nrm('body'), nrm('head')]);
      const seen = new Set();
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        const m = o.material; if (seen.has(m)) return; seen.add(m);
        const n = /head/i.test(m.name) ? nHead : nBody;
        if (m.map) { m.map.anisotropy = 8; }
        if (n) { m.normalMap = n; m.normalScale = new THREE.Vector2(0.3, -0.3); }
        m.roughness = 0.7; m.metalness = 0.0; m.envMapIntensity = 0.4; m.side = THREE.DoubleSide;
        m.transparent = false; m.depthWrite = true; m.alphaTest = 0; m.opacity = 1;      // the source textures carry an alpha channel; the hide is opaque
        patchAtmosphere(m, null, 'rigged' + m.name);
      });
      const clips = {}; for (const c of gltf.animations) clips[c.name] = c;
      // The 'Spawn' clip (our landing) was authored facing the other way: its root bone (Bip002) is turned 180° about the
      // vertical from every other clip, so a landing twisted the dragon round backwards and snapped him back. Turn it round.
      if (clips.Spawn) {
        const qz = new THREE.Quaternion(0, 0, 1, 0), q = new THREE.Quaternion();      // 180° about the Root's own up (+Z: the rig is Z-up)
        for (const t of clips.Spawn.tracks) {
          if (t.name === 'Bip002.quaternion') for (let i = 0; i < t.values.length; i += 4) { q.fromArray(t.values, i); qz.clone().multiply(q).toArray(t.values, i); }
          if (t.name === 'Bip002.position') for (let i = 0; i < t.values.length; i += 3) { t.values[i] = -t.values[i]; t.values[i + 1] = -t.values[i + 1]; }
        }
      }
      RIGGED[id] = { scene: gltf.scene, clips };
    } catch (e) { console.warn('[rigged dragon]', id, 'not loaded:', e.message); }
  }));
}

const _q = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _wq = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _m1 = new THREE.Matrix4(), _p1 = new THREE.Vector3(), _p2 = new THREE.Vector3(), _s1 = new THREE.Vector3(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
// turn a bone about an axis given in world space, whatever its parents are doing
function turnWorld(bone, axis, angle) {
  if (Math.abs(angle) < 1e-5) return;
  bone.parent.getWorldQuaternion(_pq); bone.getWorldQuaternion(_wq);
  _q.setFromAxisAngle(axis, angle).multiply(_wq);
  bone.quaternion.copy(_pq.invert().multiply(_q));
}

const _a1 = new THREE.Vector3(), _a2 = new THREE.Vector3(), _a3 = new THREE.Vector3(), _aq = new THREE.Quaternion(), _gq = new THREE.Quaternion();
// rotate a bone (by world-space quaternion q, a fraction w of it) about its own joint, whatever its parents are doing
function rotWorld(bone, q, w) {
  if (w <= 1e-4) return;
  if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);      // the short way round
  _aq.identity().slerp(q, Math.min(1, w));
  bone.parent.getWorldQuaternion(_pq); bone.getWorldQuaternion(_wq);
  bone.quaternion.copy(_pq.invert().multiply(_aq.multiply(_wq)));
  bone.updateMatrixWorld(true);
}
// turn a bone so the line from it to `child` points along `dir` (world, unit), a fraction w of the way
function aimBone(bone, child, dir, w) {
  if (w <= 1e-4) return;
  bone.getWorldPosition(_a1); child.getWorldPosition(_a2); _a2.sub(_a1);
  if (_a2.lengthSq() < 1e-8) return;
  rotWorld(bone, _gq.setFromUnitVectors(_a2.normalize(), dir), w);
}

export class RiggedDragon {
  constructor(def, asset) {
    this.def = def; this.rigged = true;
    this.group = new THREE.Group(); this.rig = new THREE.Group(); this.group.add(this.rig);
    this.t = 0; this.phase = 0;
    this.pose = { flap: 0, tuck: 0, brake: 0, landed: 1, mouth: 0, lookYaw: 0, lookPitch: 0, bank: 0, yawRate: 0, pitchRate: 0, walk: 0 };
    const model = SkeletonUtils.clone(asset.scene); this.model = model;
    model.traverse((o) => { if (o.isSkinnedMesh) { o.frustumCulled = false; o.castShadow = true; o.receiveShadow = true; } });
    // the model is ~42 units nose to tail, standing with its hips ~7.3 up; the game's dragons are 26.3 long about their own centre
    this.length = 26.3; const s = this.length / 42.07; this.s = s;
    model.scale.setScalar(s); model.position.set(0, -7.3 * s, 1.0 * s); this.rig.add(model);
    this.standHeight = 7.3 * s; this.saddleRadius = 1.05;
    this.group.scale.setScalar(def.scale);
    const B = (n) => model.getObjectByName(n) || model.getObjectByName(n.replace(/[^A-Za-z0-9_]/g, ''));
    const spine3 = B('Bip002-Spine3'), pelvis = B('Bip002-Pelvis'), head = B('Bip002-Head'), jaw = B('Bip002-Ponytail1'), snout = B('Dummy001');
    this._B = B;
    this.neck = [B('Bip002-Neck'), B('Bip002-Neck1'), B('Bip002-Neck2')].filter(Boolean);
    this._b = { spine3, pelvis, head, jaw, snout };
    this.legs = ['L', 'R'].map(k => ({ thigh: B(`Bip002-${k}-Thigh`), calf: B(`Bip002-${k}-Calf`), foot: B(`Bip002-${k}-Foot`),
      // each toe a chain of bones (Toe0 → Toe01 → Toe02 → end): the talons
      toes: [0, 1, 2, 3].map(t => { const c = []; let b = B(`Bip002-${k}-Toe${t}`); while (b) { c.push(b); b = b.children.find(x => x.isBone); } return c; }).filter(c => c.length > 1) })).filter(l => l.thigh && l.calf);
    this.tail = ['', '1', '2', '3', '4', '5', '6', '7', '8'].map(k => B('Bip002-Tail' + k)).filter(Boolean);
    this.wings = [['L', 1], ['R', -1]].map(([k, sx]) => ({ sx, clav: B(`Bip002-${k}-Clavicle`), upper: B(`Bip002-${k}-UpperArm`), fore: B(`Bip002-${k}-Forearm`), hand: B(`Bip002-${k}-Hand`),
      // the six membrane struts, three joints each
      fingers: [0, 1, 2, 3, 4, 5].map(f => [B(`Bip002-${k}-Finger${f}`), B(`Bip002-${k}-Finger${f}1`), B(`Bip002-${k}-Finger${f}2`)].filter(Boolean)).filter(c => c.length) })).filter(w => w.upper && w.fore && w.hand);
    this.spine = ['Bip002-Spine1', 'Bip002-Spine2', 'Bip002-Spine3'].map(B).filter(Boolean);
    // what touches the ground: the hind toes and the wing-hands he walks on
    this.contacts = [];
    model.traverse(o => { if (o.isBone && /^Bip002-[LR]-(Toe\d+_end|Finger0)$/.test(o.name)) this.contacts.push(o); });
    this.groundOff = 0;

    // ---- clips: idle on the ground, the wing-beat (a 35-frame hover cycle inside the take-off clip), and its spread-wing frame as the glide
    const U = THREE.AnimationUtils, c = asset.clips;
    this.mixer = new THREE.AnimationMixer(model);
    const mk = (clip, loop = true) => { const a = this.mixer.clipAction(clip); a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1); a.clampWhenFinished = !loop; a.play(); a.setEffectiveWeight(0); return a; };
    this.act = {
      stand: mk(c.Stand),
      fly: mk(U.subclip(c.Up, 'Fly', 126, 161, FPS)),
      glide: mk(U.subclip(c.Up, 'Glide', 126, 128, FPS)),
      // take-off: rear up, throw the wings open and haul into the air; it ends on the first frame of the wing-beat
      takeoff: c.Up ? mk(U.subclip(c.Up, 'TakeOff', 1, 91, FPS), false) : null,
      // landing: sink onto the haunches, rear up with wings spread, then fold them away into the stand
      land: c.Spawn ? mk(U.subclip(c.Spawn, 'Land', 11, 151, FPS), false) : null,
    };
    // the glide is ONE frame held still: as a 1/24 s looping clip it flickered between frames 126 and 127 twenty-four times a
    // second, a fast shake of the whole wing (~1.5 m at the tip)
    this.act.glide.timeScale = 0; this.act.glide.time = 0;
    this.act.takeoff && (this.act.takeoff.timeScale = 1.7); this.act.land && (this.act.land.timeScale = 1.3);
    // on the ground: the walk cycle (in place; 2.9 m/s of ground covered at its authored speed), and the roar — head thrown up, jaws wide
    this.act.walk = c.Walk ? mk(c.Walk) : null;
    this.act.roar = c.Roar ? mk(U.subclip(c.Roar, 'RoarG', 122, 200, FPS), false) : null;
    this.act.roar && (this.act.roar.timeScale = 1.15);
    this.airRoar = 0;
    this.seq = null;
    this.flyLen = 35 / FPS;

    // ---- how the hover pose sits in space, so forward flight can be levelled about the body's centre
    const measure = (action, n) => {
      const mid = new THREE.Vector3(); let pitch = 0;
      for (const k of Object.keys(this.act)) this.act[k].setEffectiveWeight(this.act[k] === action ? 1 : 0);
      for (let i = 0; i < n; i++) {
        action.time = (i / n) * action.getClip().duration; this.mixer.update(0); this.group.updateMatrixWorld(true);
        const p = this.group.worldToLocal(pelvis.getWorldPosition(_v)).clone(), q = this.group.worldToLocal(spine3.getWorldPosition(_v2)).clone();
        mid.add(p).add(q); pitch += Math.atan2(q.y - p.y, q.z - p.z);
      }
      return { mid: mid.multiplyScalar(0.5 / n), pitch: pitch / n };
    };
    this.rest = { fly: measure(this.act.fly, 8), stand: measure(this.act.stand, 4) };
    // The hover beat also throws the head, lashes the tail and paddles the legs with every stroke. In forward flight those ride
    // quietly, so each is pulled most of the way back to where the spread-wing glide frame holds it.
    for (const k of Object.keys(this.act)) this.act[k].setEffectiveWeight(k === 'glide' ? 1 : 0);
    this.mixer.update(0);
    this.calm = [];
    const hold = (bones, f) => { for (const b of bones) if (b) this.calm.push({ b, q: b.quaternion.clone(), f }); };
    hold([...this.neck, head], 0.94); hold(this.tail, 0.86); hold(this.legs.flatMap(l => [l.thigh, l.calf, l.foot]), 0.75);
    hold(['Bip002-Spine', 'Bip002-Spine1', 'Bip002-Spine2', 'Bip002-Spine3'].map(B), 0.6);
    // the chest (where the rider sits and the wings root) is the anchor: remember where the glide frame holds it
    this.rest.glide = measure(this.act.glide, 1);
    this.group.updateMatrixWorld(true);
    { const m = new THREE.Matrix4().copy(this.rig.matrixWorld).invert().multiply(spine3.matrixWorld); this._refP = new THREE.Vector3(); this._refQ = new THREE.Quaternion(); m.decompose(this._refP, this._refQ, new THREE.Vector3()); }

    // ---- the rider's seat: on the shoulders, upright when the body is levelled for flight
    for (const k of Object.keys(this.act)) this.act[k].setEffectiveWeight(k === 'glide' ? 1 : 0);
    this.mixer.update(0); this._place(1, 1, this.rest.glide.pitch, this.rest.glide.mid); this.group.updateMatrixWorld(true);
    // The clip's flight frames were animated on an upright, hovering body: levelled for forward flight, its spread wings hang
    // down at the sides like curtains. Measure, on the glide frame, the turn at each shoulder that lifts the wing out level
    // (a little dihedral and sweep), its membrane flat: in flight it is applied to the upper arm on top of every frame.
    this.group.updateMatrixWorld(true);
    this.wingFix = this.wings.map(w => {
      const tips = ['02', '12', '22', '32'].map(f => B(`Bip002-${w.sx > 0 ? 'L' : 'R'}-Finger${f}`)).filter(Boolean);
      w.tips = tips;
      const sh = w.upper.getWorldPosition(new THREE.Vector3()), wr = w.hand.getWorldPosition(new THREE.Vector3());
      const tip = new THREE.Vector3(); for (const t of tips) tip.add(t.getWorldPosition(_v)); tip.multiplyScalar(1 / Math.max(1, tips.length));
      const d = wr.clone().sub(sh).normalize(), e = tip.clone().sub(sh).normalize();
      const D = new THREE.Vector3(w.sx, 0.14, -0.12).normalize();                       // out, a little up, a little back
      const q1 = new THREE.Quaternion().setFromUnitVectors(d, D);
      // then twist about the arm until the membrane (the plane of arm and finger tips) lies flat
      const n = d.clone().cross(e).applyQuaternion(q1), Y = new THREE.Vector3(0, 1, 0);
      const np = n.addScaledVector(D, -n.dot(D)).normalize(), yp = Y.addScaledVector(D, -Y.dot(D)).normalize();
      let ang = Math.atan2(np.clone().cross(yp).dot(D), np.dot(yp));
      if (Math.abs(ang) > Math.PI / 2) ang -= Math.sign(ang) * Math.PI;                  // flat either way up: take the smaller turn
      return new THREE.Quaternion().setFromAxisAngle(D, ang).multiply(q1);
    });
    const seat = new THREE.Object3D(); this.group.add(seat);
    const sp = this.group.worldToLocal(spine3.getWorldPosition(_v));
    seat.position.set(0, sp.y + 1.5 * s, sp.z + 0.5 * s); seat.updateMatrixWorld(true); spine3.attach(seat);
    this.bones = { saddle: seat, head, chest: spine3, hip: pelvis, jaw, neck: this.neck };
    for (const k of Object.keys(this.act)) this.act[k].setEffectiveWeight(k === 'stand' ? 1 : 0);
    this.mixer.update(0); this._place(0, 1);
    // ---- the folded wing, as the artist posed it standing: shoulder and upper arm relative to the chest, every joint
    // beyond (forearm, hand, all 18 finger joints) as it sits on its parent. A dive folds toward this, joint by joint.
    this.group.updateMatrixWorld(true);
    const cq = spine3.getWorldQuaternion(new THREE.Quaternion()).invert();
    this.fold = this.wings.map(w => {
      const rel = (b) => b ? cq.clone().multiply(b.getWorldQuaternion(new THREE.Quaternion())) : null;
      const local = []; w.hand.traverse(b => { if (b.isBone && b !== w.hand) local.push([b, b.quaternion.clone()]); });
      local.unshift([w.fore, w.fore.quaternion.clone()], [w.hand, w.hand.quaternion.clone()]);
      return { relC: rel(w.clav), relU: rel(w.upper), local };
    });
  }

  // level: 0 = as authored (standing), 1 = hover pose rotated nose-down until the back is flat and centred on the group origin
  _place(fly, level, pitch = this.rest.fly.pitch, mid = this.rest.fly.mid) {
    const a = pitch * fly * level;
    this.rig.rotation.set(a, 0, 0);
    _v.copy(mid).applyAxisAngle(_v2.set(1, 0, 0), a).multiplyScalar(-fly);
    this.rig.position.copy(_v);
  }

  getMouth(pos, dir) {
    const { snout, head } = this._b;
    (snout || head).getWorldPosition(pos);
    if (dir) { head.getWorldPosition(_v); dir.copy(pos).sub(_v).normalize(); if (dir.lengthSq() < 0.5) dir.set(0, 0, 1).transformDirection(this.group.matrixWorld); }
  }

  // world positions of the lowest finger tips of each wing (for spray when they cut the water)
  wingTips(out) {
    if (!this._tips) { const B = (n) => this.model.getObjectByName(n); this._tips = ['L', 'R'].map(k => ['02', '12', '22'].map(f => B(`Bip002-${k}-Finger${f}`)).filter(Boolean)); }
    for (let s = 0; s < 2; s++) {
      let best = null;
      for (const b of this._tips[s]) { b.getWorldPosition(_v); if (!best || _v.y < best.y) best = (best || new THREE.Vector3()).copy(_v); }
      out[s].copy(best || this.group.position);
    }
    return out;
  }

  // R: on the ground the full roar clip; in the air the neck arches up while the jaws gape (the game opens the mouth and plays the sound)
  roar() {
    const A = this.act;
    if (this._grounded && A.roar && (!this.seq || this.seq.kind === 'roar')) { A.roar.reset(); A.roar.play(); this.seq = { kind: 'roar', t: 0, len: A.roar.getClip().duration / A.roar.timeScale }; }
    else if (!this._grounded) this.airRoar = 1.5;
  }

  // a: { flap 0..1.4, rate (Hz), tuck, brake, landed, mouth, lookYaw, lookPitch, bank, yawRate, pitchRate, walk 0..1, walkSpeed m/s }
  update(dt, a) {
    const P = this.pose, M = THREE.MathUtils; const k6 = 1 - Math.exp(-dt * 6), k3 = 1 - Math.exp(-dt * 3), k10 = 1 - Math.exp(-dt * 10);
    P.flap += (a.flap - P.flap) * k6; P.tuck += (a.tuck - P.tuck) * k3; P.brake += (a.brake - P.brake) * k3;
    P.landed += (a.landed - P.landed) * (1 - Math.exp(-dt * 2.2)); P.mouth += (a.mouth - P.mouth) * k10;
    P.lookYaw += (a.lookYaw - P.lookYaw) * k3; P.lookPitch += (a.lookPitch - P.lookPitch) * k3;
    P.bank += (a.bank - P.bank) * k6; P.yawRate += (a.yawRate - P.yawRate) * k3; P.pitchRate += (a.pitchRate - P.pitchRate) * k3;
    P.walk += ((a.walk || 0) - P.walk) * k6; this.airRoar = Math.max(0, this.airRoar - dt);
    this.t += dt; this.phase += dt * a.rate * Math.PI * 2;
    const A = this.act, grounded = a.landed > 0.5;
    // leaving or meeting the ground starts the matching clip (not on the very first frame: a dragon may spawn already aloft)
    if (this._grounded === undefined) this._grounded = grounded;
    if (grounded !== this._grounded) {
      // (the take-off clip only for a real launch from the ground: fast travel or a respawn aloft goes straight to flight)
      this._grounded = grounded; const clip = grounded ? A.land : (a.launch ? A.takeoff : null);
      if (clip) { clip.reset(); clip.play(); this.seq = { kind: grounded ? 'land' : 'takeoff', t: 0, len: clip.getClip().duration / clip.timeScale }; } else this.seq = null;
    }
    // the wing-beat eases in and out rather than switching: its strength and its tempo are both smoothed, and a glide always
    // parks the cycle on the spread-wing frame so the next stroke grows out of the glide instead of cutting in mid-beat
    // Strokes are whole or not at all: flapping starts from the spread-wing frame and only stops when the cycle is back on it,
    // so the wings never flutter at half depth or cut out mid-beat. How hard the dragon is working sets the tempo, not the depth.
    const want = a.flap * (1 - 0.7 * M.clamp(a.tuck || 0, 0, 1));
    this.wph = this.wph || 0;
    if (!this.flapping && want > 0.24) { this.flapping = true; if (this.beatS < 0.05) this.wph = 0; }
    else if (this.flapping && want < 0.13 && this.wph % 1 > 0.8) this.flapping = false;      // stop at the top of a stroke, never mid-beat
    const beatT = this.flapping ? 1 : 0;
    // eased on an S-curve over ~0.6 s (an exponential ease jumped hardest on its first frame: a pop at the wing tips)
    this.beatL = this.beatL === undefined ? beatT : M.clamp(this.beatL + Math.sign(beatT - this.beatL) * dt / (beatT ? 0.55 : 0.7), 0, 1);
    this.beatS = this.beatL * this.beatL * (3 - 2 * this.beatL);
    this.rateS = this.rateS === undefined ? a.rate : this.rateS + (a.rate - this.rateS) * (1 - Math.exp(-dt * 2.5));
    const beat = this.beatS;
    const wk = A.walk ? M.smoothstep(P.walk, 0.02, 0.35) : 0;           // how much of the ground pose is the walk cycle
    // the hover clip's stroke runs from just above level to ~80° below: in forward flight only part of it is used (blended
    // with the level glide frame), deeper the harder the dragon works, and the stroke is lifted to swing about the horizontal
    let wGround = grounded ? 1 : 0, wFly = 0, wGlide = grounded ? 0 : 1, wTo = 0, wLand = 0, wRoar = 0, air = grounded ? 0 : 1;
    const q = this.seq;
    if (q) {
      q.t += dt; const u = q.t / q.len;
      if (q.kind === 'takeoff') {
        // eased in over the stand (no snap), and handed over to the flight posture over its last fifth (no pop at the end)
        wTo = M.smoothstep(q.t, 0, 0.25) * (1 - M.smoothstep(u, 0.8, 1.0)); wFly = 0;
        wGround = u < 0.5 ? 1 - wTo : 0; wGlide = u < 0.5 ? 0 : 1 - wTo; air = M.smoothstep(u, 0.15, 1.0);
        if (u >= 1) { this.seq = null; A.fly.time = 0; wTo = 0; wFly = 0; wGlide = 1; air = 1; }
      } else if (q.kind === 'land') {
        const fin = M.smoothstep(q.t, 0, 0.4), out = M.smoothstep(u, 0.88, 1.0);      // fold out of flight into the clip, then settle into the idle
        wLand = fin * (1 - out) * (1 - wk); wGround = fin - wLand; wFly = 0; wGlide = 1 - fin; air = 1 - M.smoothstep(q.t, 0, 0.45);
        if (u >= 1 || (wk > 0.95 && q.t > 0.5)) this.seq = null;                       // walking off cuts the flourish short
      } else {
        wRoar = M.smoothstep(q.t, 0, 0.3) * (1 - M.smoothstep(u, 0.82, 1.0)) * (1 - wk); wGround = 1 - wRoar;
        if (u >= 1 || wk > 0.95) this.seq = null;
      }
    }
    A.stand.setEffectiveWeight(wGround * (1 - wk)); A.fly.setEffectiveWeight(wFly); A.glide.setEffectiveWeight(wGlide);
    if (A.walk) { A.walk.setEffectiveWeight(wGround * wk); A.walk.timeScale = M.clamp((a.walkSpeed || 0) / (2.9 * this.def.scale / 1.3), 0.5, 2.4); }
    if (A.takeoff) A.takeoff.setEffectiveWeight(wTo); if (A.land) A.land.setEffectiveWeight(wLand); if (A.roar) A.roar.setEffectiveWeight(wRoar);
    A.fly.timeScale = Math.max(0.45, this.rateS) * this.flyLen * (0.72 + 0.3 * M.clamp(P.flap, 0, 1.2));      // one clip cycle per wing-beat; harder work, quicker beat
    if (!this.seq && wFly < 0.02) A.fly.time = 0;
    // three's mixer only writes a bone when its animated value differs from the last frame's. A held pose (the glide, the
    // stand) then never overwrote the turns applied on top of it below, and they piled up frame after frame: the wings spun
    // and shook. So every bone is put back to what the clips gave it last frame before the mixer runs, and the posing below
    // always starts from the clean animated pose.
    if (!this._bones) { this._bones = []; this.model.traverse(o => { if (o.isBone) this._bones.push(o); }); }
    const bs = this._bones;
    if (this._snapQ) for (let i = 0; i < bs.length; i++) { bs[i].quaternion.copy(this._snapQ[i]); bs[i].position.copy(this._snapP[i]); }
    this.mixer.update(dt);
    if (!this._snapQ) { this._snapQ = bs.map(() => new THREE.Quaternion()); this._snapP = bs.map(() => new THREE.Vector3()); }
    for (let i = 0; i < bs.length; i++) { this._snapQ[i].copy(bs[i].quaternion); this._snapP[i].copy(bs[i].position); }
    this.air = air;
    // braking rears the body back up toward the hover it was animated in; a dive tips it a little further over
    // quiet the head, tail, legs and spine first; the chest anchor below is then measured on the pose that will be drawn
    const toK = M.clamp(wTo, 0, 1);      // how much the take-off clip is in charge (blends the posing in and out, never switches it)
    const quiet = air * air * (1 - toK);
    if (quiet > 0.01) for (const c of this.calm) c.b.quaternion.slerp(c.q, c.f * quiet);
    // The wing-beat was animated as a hover, where the whole body rocks and bobs with every stroke. In forward flight the chest
    // rides steady and the wings do the work: each frame the rig is counter-moved so the chest stays where the glide holds it.
    const stab = (this.stab === undefined ? 0.9 : this.stab) * air * air * (1 - 0.5 * toK);
    this._place(air, 1 - 0.55 * M.clamp(P.brake, 0, 1) + 0.12 * M.clamp(P.tuck, 0, 1), this.rest.glide.pitch, this.rest.glide.mid);
    if (stab > 0.01) {
      this.rig.updateMatrixWorld(true);
      _m1.copy(this.rig.matrixWorld).invert().multiply(this._b.spine3.matrixWorld).decompose(_p1, _q1, _s1);
      _q2.copy(this._refQ).multiply(_q1.invert());                         // rotation that carries the chest back to its glide attitude
      _p2.copy(_p1).applyQuaternion(_q2).negate().add(this._refP);          // and the shift that goes with it
      _q1.identity().slerp(_q2, stab); _p2.multiplyScalar(stab);
      this.rig.position.add(_p2.applyQuaternion(this.rig.quaternion)); this.rig.quaternion.multiply(_q1);
    }
    this.group.updateMatrixWorld(true);
    // ---- forward-flight posture over the hover clip (on the wing only; the take-off and landing clips play as authored)
    const fp = air * air * (1 - toK);
    const gq = this.group.getWorldQuaternion(new THREE.Quaternion()), gqi = gq.clone().invert();
    const G = (x, y, z) => _a3.set(x, y, z).normalize().applyQuaternion(gq);       // a direction in the dragon's frame (+Z ahead, +X left, +Y up) → world
    // wings out level at the shoulder (the clip's stroke then sweeps above and below the body instead of below it)
    const fwdW = G(0, 0, 1).clone();
    // ---- the wing-beat, from the spread glide pose: a quick, powerful downstroke from a high V to below level (45% of the
    // cycle), then a slower upstroke with the forearm folding in and the hand trailing so the wing lifts edge-on; the tip lags
    // the arm, and the body rides up a little on each downstroke. How hard he works sets the depth and the tempo.
    this.wph += dt * Math.max(0.35, this.rateS) * (this.beatS > 0.01 ? 1 : 0);
    const amp = this.beatS * (0.5 + 0.22 * M.clamp(P.flap, 0, 1.3)) * fp;
    // (cosine half-waves dwell at the ends; c·(0.6 + 0.4c²) shortens the hang at the top and bottom of the stroke and stays
    // smooth through mid-stroke, where a power curve had an infinitely steep point)
    const strokeE = (u) => { u = ((u % 1) + 1) % 1; const c = u < 0.45 ? Math.cos(Math.PI * u / 0.45) : -Math.cos(Math.PI * (u - 0.45) / 0.55); return c * (0.6 + 0.4 * c * c); };
    const ph = this.wph % 1, e = strokeE(ph), eLag = strokeE(ph - 0.1), upS = ph > 0.45 ? Math.sin(Math.PI * (ph - 0.45) / 0.55) : 0;
    const upW = G(0, 1, 0).clone();
    this.wings.forEach((w, i) => {
      rotWorld(w.upper, _q.copy(gq).multiply(this.wingFix[i]).multiply(gqi), fp);
      // raise / lower at the shoulder; in a bank the wings stay partly level while the body rolls under them (as a bird's do),
      // and the high (outer) wing is never thrown past ~55° from the horizon, whatever the stroke is doing
      const bankW = M.clamp(P.bank, -1.2, 1.2) * fp, outerW = M.clamp(bankW * w.sx, 0, 1.2);
      let el = 0.1 * amp / 0.72 + amp * e - 0.3 * bankW * w.sx;
      el -= Math.max(0, outerW * 0.7 + 0.14 + el - 0.95);
      if (w.clav) { turnWorld(w.clav, fwdW, w.sx * 0.22 * el); el *= 0.78; }      // the shoulder rides up and down with the stroke
      turnWorld(w.upper, fwdW, w.sx * el);
      turnWorld(w.upper, upW, -w.sx * 0.16 * amp * Math.sin(2 * Math.PI * ph));             // forward on the downstroke, back on the upstroke
      turnWorld(w.fore, upW, -w.sx * 0.75 * upS * amp / 0.72);                               // forearm folds in on the upstroke
      turnWorld(w.hand, upW, w.sx * 0.9 * upS * amp / 0.72);                                 // the hand trails
      turnWorld(w.hand, fwdW, w.sx * 0.22 * amp * (eLag - e));                              // and the tip lags the arm
      // the membrane struts flex behind the arm (cupping the air on the way down) and draw together on the way up
      w.fingers.forEach((c, fi) => c.forEach((b, j) => { turnWorld(b, fwdW, w.sx * 0.06 * amp * (eLag - e) * (j + 1) / c.length); turnWorld(b, upW, w.sx * 0.1 * upS * amp * (fi / 5) * (j === 0 ? 1 : 0.4)); }));
    });
    this.rig.position.y += -0.35 * amp * strokeE(ph - 0.22) / this.group.scale.x;          // the body rides up on each downstroke
    this.group.updateMatrixWorld(true);
    // (the shoulders hang off the base of the neck in this rig: whatever the neck does below, the wings are held where they are now)
    const clavHold = this.wings.map(w => w.clav ? w.clav.getWorldQuaternion(new THREE.Quaternion()) : null);
    // neck reaching forward and a little up, the head level, looking ahead (the steering look is added below)
    const nk = [...this.neck, this._b.head], nkTo = [...this.neck.slice(1), this._b.head, this._b.snout], nkUp = [0.34, 0.16, 0.02, -0.2];
    for (let i = 0; i < nk.length; i++) if (nk[i] && nkTo[i]) aimBone(nk[i], nkTo[i], G(0, nkUp[Math.min(i, 3)], 1), fp * 0.85);
    // look where the rider is steering: spread the turn along the neck, most of it at the head
    const up = _v.set(0, 1, 0).transformDirection(this.group.matrixWorld).clone(), right = _v2.set(1, 0, 0).transformDirection(this.group.matrixWorld).clone();
    const chain = [...this.neck, this._b.head], n = chain.length, steer = this.seq && this.seq.kind !== 'takeoff' ? 0.35 : 1;
    for (let i = 0; i < n; i++) {
      const w = (i === n - 1 ? 0.4 : 0.6 / (n - 1));
      turnWorld(chain[i], up, P.lookYaw * w * 0.9 * steer); turnWorld(chain[i], right, (-P.lookPitch * w * 0.9) * steer);
    }
    // a roar on the wing: the neck arches and the head lifts while the jaws gape
    const ar = M.smoothstep(this.airRoar, 0, 0.35) * (1 - M.smoothstep(this.airRoar, 1.15, 1.5)) * air;
    if (ar > 0.001) for (let i = 0; i < n; i++) turnWorld(chain[i], right, -0.16 * ar);
    if (this._b.jaw) turnWorld(this._b.jaw, right, Math.max(P.mouth * 0.55, ar * 0.7) * (wRoar > 0.5 ? 0.3 : 1));
    // ---- standing idle: he breathes (chest and neck rise and settle every ~3.6 s), and every few seconds looks somewhere
    // new, turning his head there and holding it. Gives way to walking, fire, a roar or any clip.
    const idle = (1 - air) * (1 - M.clamp((P.walk || 0) * 3, 0, 1)) * (this.seq ? 0 : 1) * (1 - M.clamp(P.mouth, 0, 1));
    this.idleW = (this.idleW || 0) + (idle - (this.idleW || 0)) * (1 - Math.exp(-dt * 1.5));
    if (this.idleW > 0.01) {
      this.lookT = (this.lookT || 0) - dt;
      if (this.lookT <= 0) { this.lookT = 2.5 + Math.random() * 4.5; this.lookTo = [(Math.random() - 0.5) * 1.3, (Math.random() - 0.35) * 0.5]; }
      const lt = this.lookTo || [0, 0], ln = this.lookNow = this.lookNow || [0, 0], kl = 1 - Math.exp(-dt * 1.8);
      ln[0] += (lt[0] - ln[0]) * kl; ln[1] += (lt[1] - ln[1]) * kl;
      const br = Math.sin(this.t * 2 * Math.PI / 3.6), iw = this.idleW;
      for (let i = 0; i < n; i++) { const w = (i === n - 1 ? 0.4 : 0.6 / (n - 1)); turnWorld(chain[i], up, ln[0] * w * iw); turnWorld(chain[i], right, (-ln[1] * w + 0.012 * br) * iw); }
      for (const b of this.spine) turnWorld(b, right, -0.018 * br * iw);
    }
    this.wings.forEach((w, i) => { if (!clavHold[i]) return; const cur = w.clav.getWorldQuaternion(new THREE.Quaternion()).invert(); rotWorld(w.clav, clavHold[i].clone().multiply(cur), 1); });
    // in level flight the hind legs trail back under the tail instead of hanging as they do in the hover
    const cruiseT = air * (1 - 0.85 * M.clamp(P.brake, 0, 1)) * (1 - 0.6 * toK);
    this.cruiseS = (this.cruiseS || 0) + (cruiseT - (this.cruiseS || 0)) * (1 - Math.exp(-dt * 2.2)); const cruise = this.cruiseS;
    // In flight the hind legs lie back along the tail, feet folded back and talons curled shut; braking to land they swing
    // down and forward with the talons opening, ready to take the ground. They swing a little with each wing-beat.
    const brkL = M.clamp(P.brake, 0, 1) * air, reach = brkL * brkL * (3 - 2 * brkL), sw = 0.08 * amp * Math.sin(2 * Math.PI * (ph - 0.15));
    const legW = air * (1 - 0.7 * toK) * 0.95;
    for (const l of this.legs) {
      // folded up under the belly in a Z: thigh down and back, shin folded back up toward the tail, foot laid back. Reaching
      // to land: thigh forward and down, shin down, foot forward, talons open.
      const mx = (a_, b_) => a_ + (b_ - a_) * reach;
      aimBone(l.thigh, l.calf, G(0, mx(-0.8, -1) + sw, mx(-0.6, 0.45)).clone(), legW);
      if (l.foot) aimBone(l.calf, l.foot, G(0, mx(0.35, -1), mx(-1, -0.35)).clone(), legW);
      if (l.foot && l.toes.length) aimBone(l.foot, l.toes[0][0], G(0, mx(0.15, -0.3), mx(-1, 1)).clone(), legW);
      for (const c of l.toes) for (let j = 0; j < c.length - 1; j++) {
        // curled: each joint bends further down and in; opened: the toes splay forward and down
        const curl = (j + 1) * 0.55 * (1 - reach);
        aimBone(c[j], c[j + 1], G(0, -Math.sin(curl) - 0.6 * reach, -Math.cos(curl) * (1 - reach) + 0.8 * reach).clone(), legW * 0.9);
      }
    }
    // ---- wings: shaped into a turn, folded in a dive
    const rUp = new THREE.Vector3(0, 1, 0).transformDirection(this.rig.matrixWorld);
    const T = M.clamp(P.tuck, 0, 1) * air, turn = M.clamp(P.bank, -1.2, 1.2) * air;
    const fk = M.clamp(T / 0.85, 0, 1) * 0.92 * (1 - toK);      // a full dive is ~90% folded: a stoop, the wrists still out a little
    const s3q = this._b.spine3.getWorldQuaternion(new THREE.Quaternion()), _cur = new THREE.Quaternion();
    this.wings.forEach((w, i) => {
      const inner = M.clamp(-turn * w.sx, 0, 1), outer = M.clamp(turn * w.sx, 0, 1);       // the low wing is the inside of the turn
      turnWorld(w.upper, rUp, w.sx * (0.07 * inner - 0.04 * outer)); turnWorld(w.fore, rUp, -w.sx * 0.14 * inner); turnWorld(w.hand, rUp, w.sx * 0.18 * inner);
      if (fk < 0.001) return;
      // fold toward the artist's folded wing: shoulder and upper arm swing to where the fold holds them against the chest,
      // then every joint beyond eases to its folded angle. Each wing folds down its own side, never over the back.
      const F = this.fold[i];
      const toward = (bone, rel) => { if (!bone || !rel) return; const tgt = s3q.clone().multiply(rel); bone.getWorldQuaternion(_cur); rotWorld(bone, tgt.multiply(_cur.invert()), fk); };
      toward(w.clav, F.relC); toward(w.upper, F.relU);
      for (const [bn, q] of F.local) bn.quaternion.slerp(q, fk);
      (w.clav || w.upper).updateMatrixWorld(true);
      // the standing fold holds the elbows out; diving, the folded wing is swept back tight along the flanks (a stoop)
      aimBone(w.upper, w.fore, G(w.sx * 0.42, -0.08, -1).clone(), fk * 0.85);
    });
    // the spine bows into the turn and the body stretches out long in a dive
    for (const b of this.spine) turnWorld(b, up, P.yawRate * 0.05 * air);
    // the tail streams out behind along the line of the body: it swings to the outside of a turn, drops behind a climb, hangs
    // lower when braking, and carries a slow travelling wave (the clip's hover curl is replaced, not added to)
    // the tail hands between its flight line, the clips and the ground on its own, slower blend: it is ~13 m long and a quick
    // handover (landing) whipped the tip
    this.tA = this.tA === undefined ? air : this.tA + (air * (1 - toK) - this.tA) * (1 - Math.exp(-dt * 2.2)); const tailW = this.tA * this.tA;
    const nt = this.tail.length, brk = M.clamp(P.brake, 0, 1);
    for (let i = 0; i < nt - 1; i++) {
      const f = (i + 1) / nt;
      const phi = P.yawRate * 0.35 * f + (0.09 * Math.sin(this.t * 1.3 - i * 0.75) + 0.04 * Math.sin(this.t * 2.9 - i * 1.1)) * f;
      let th = 0.05 + 0.1 * f + 0.45 * brk * f + P.pitchRate * 0.1 * f + 0.04 * Math.sin(this.t * 1.0 - i * 0.55) * f
             + 0.12 * amp * Math.sin(2 * Math.PI * (ph - 0.1) - i * 0.55) * f;      // each wing-beat sends a ripple down the tail
      th = Math.max(th, -0.06);      // never curls up over the body line
      aimBone(this.tail[i], this.tail[i + 1], G(Math.sin(phi) * Math.cos(th), -Math.sin(th), -Math.cos(phi) * Math.cos(th)), tailW * 0.92);
    }
    // ---- on the ground: settle the lowest toe or wing-hand onto the terrain under it (the authored stance stood ~1.5 m
    // proud of the ground: he floated). Eased, and faded out as he leaves the ground.
    const gw = this.seq && this.seq.kind === 'takeoff' ? 1 - M.smoothstep(this.seq.t / this.seq.len, 0.2, 0.32) : 1 - air;      // through the take-off crouch only, never during the leap
    if (this.surfaceAt && this.contacts.length) {
      let low = Infinity;
      if (gw > 0.01) for (const c of this.contacts) { c.getWorldPosition(_a1); low = Math.min(low, _a1.y - this.surfaceAt(_a1.x, _a1.z)); }
      const want = gw > 0.01 && isFinite(low) ? (0.08 - low) * gw : 0;      // (the rig is re-placed every frame, so `low` is measured before this offset)
      this.groundOff += (want - this.groundOff) * (1 - Math.exp(-dt * 6));
      this.rig.position.y += this.groundOff / this.group.scale.x;
      this.group.updateMatrixWorld(true);
    }
    // on the ground the tail comes down and lies along it, with a slow idle sway (it stood out stiffly in the air)
    if (this.surfaceAt && gw > 0.01) {
      const back = _a3.set(0, 0, -1).transformDirection(this.group.matrixWorld); back.y = 0; back.normalize();
      const bx = back.x, bz = back.z, nt2 = this.tail.length;
      for (let i = 0; i < nt2 - 1; i++) {
        const b = this.tail[i], c = this.tail[i + 1];
        b.getWorldPosition(_a1); c.getWorldPosition(_a2); const L = _a2.distanceTo(_a1);
        const sw = (0.22 * Math.sin(this.t * 0.45 + i * 0.5) + 0.12 * (P.walk || 0) * Math.sin(this.t * 2.6 - i * 0.6)) * (i + 1) / nt2;
        const dx = bx * Math.cos(sw) - bz * Math.sin(sw), dz = bz * Math.cos(sw) + bx * Math.sin(sw);
        const tx = _a1.x + dx * L, tz = _a1.z + dz * L;
        const ty = Math.max(this.surfaceAt(tx, tz) + 0.45 * this.group.scale.x, _a1.y - L * 0.7);
        _a2.set(tx - _a1.x, ty - _a1.y, tz - _a1.z).normalize();
        aimBone(b, c, _a2.clone(), (1 - this.tA) * gw * 0.85);
      }
    }
  }
}
