// Dragon flight model + chase camera.
import * as THREE from 'three';
import { MAP, REGION } from '../world/mapdata.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const wrapPi = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const _f = new THREE.Vector3(), _l = new THREE.Vector3(), _u = new THREE.Vector3(), _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _n = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export function dirFrom(yaw, pitch, out) {
  const cp = Math.cos(pitch);
  return out.set(Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}

export class Flight {
  constructor(field) {
    this.field = field;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0; this.roll = 0;
    this.aimYaw = 0; this.aimPitch = 0;
    this.speed = 0; this.mode = 'ground';
    this.stamina = 1; this.boosting = false; this.braking = false; this.firing = false;
    this.turnRate = 0; this.pitchRate = 0;
    this.holdAim = false; this.climbT = 0;
    this.landT = 1; this.groundY = 0; this.agl = 0;
    this.shake = 0; this.flapBurst = 0; this.glidePhase = 0;
    this.anim = { flap: 0, rate: 0.7, tuck: 0, brake: 0, landed: 1, mouth: 0, lookYaw: 0, lookPitch: 0, bank: 0, yawRate: 0, pitchRate: 0, walk: 0, walkSpeed: 0 };
    this.setDragon({ scale: 1.3, stats: { speed: 0.85, agility: 0.8, fire: 0.9 } }, 4.55);
    this.events = [];
  }
  setDragon(def, standHeight, canWalk = false) {
    this.def = def; this.scale = def.scale;
    this.canWalk = canWalk; this.walkV = 0; this.walkMax = 5.5;      // dragons with a walk cycle stride about on the ground; Shift launches them
    const s = def.stats;
    this.cruise = 38 + 16 * s.speed;           // m/s
    this.fast = 58 + 26 * s.speed;
    this.boostSpeed = 92 + 44 * s.speed;
    this.maxTurn = 0.42 + 0.62 * s.agility;    // rad/s
    this.pitchSpeed = 0.55 + 0.65 * s.agility;
    this.stand = standHeight * def.scale;
    this.belly = 2.6 * def.scale;
    this.flapHz = 0.72 / Math.sqrt(def.scale);      // a big animal: slow, deep beats
  }
  place(x, z, yaw = 0, air = 0) {
    this.yaw = this.aimYaw = yaw; this.pitch = this.aimPitch = 0; this.roll = 0;
    const g = this.field.surfaceAt(x, z);
    if (air > 0) { this.mode = 'fly'; this.pos.set(x, g + air, z); this.speed = this.cruise; this.landT = 0; }
    else { this.mode = 'ground'; this.pos.set(x, g + this.stand, z); this.speed = 0; this.landT = 1; }
  }
  takeOff() {
    if (this.mode !== 'ground') return;
    // timed to the take-off clip: crouch where he stands, then spring up and climb out, gathering speed (see update)
    this.mode = 'fly'; this.speed = 0; this.aimPitch = Math.max(this.aimPitch, 0.32); this.launchT = 0; this.launchVy = 0;
    this.climbT = 4.5; this.holdAim = false;   // climb out, then level off unless the rider takes over
    this.flapBurst = 2.2; this.events.push('takeoff');
  }

  update(dt, inp) {
    const field = this.field;
    // ---- aim
    const lookX = inp.lookX || 0, lookY = inp.lookY || 0;   // cursor resting at a screen edge (mouse without pointer lock)
    this.aimYaw += inp.mx + (inp.turn * 1.15 + lookX * 1.3) * dt;
    this.aimPitch = clamp(this.aimPitch - inp.my + (inp.pitch * 0.9 - lookY * 0.9) * dt, -1.25, 1.25);
    // the mouse leaves the aim where it was put; arrow keys, the stick and the take-off climb ease back to
    // level flight once let go, so a rider on keys alone is never stuck climbing or diving
    if (inp.my !== 0 || lookY !== 0) this.holdAim = true; else if (inp.pitch !== 0) this.holdAim = false;
    this.climbT = Math.max(0, this.climbT - dt);
    if (this.mode === 'fly' && !this.holdAim && inp.pitch === 0 && this.climbT <= 0) this.aimPitch = damp(this.aimPitch, 0, 1.6, dt);
    this.firing = inp.fire;

    if (this.mode === 'ground') {
      this.landT = Math.min(1, this.landT + dt * 0.9);
      // turn on the spot, keep feet on the terrain
      const dy = wrapPi(this.aimYaw - this.yaw);
      this.turnRate = clamp(dy * 1.5, -0.5, 0.5);
      this.yaw += this.turnRate * dt;
      this.aimYaw = this.yaw + clamp(dy, -1.0, 1.0);
      this.aimPitch = clamp(this.aimPitch, -0.5, 0.7);
      this.pitch = damp(this.pitch, 0, 4, dt); this.roll = damp(this.roll, 0, 4, dt);
      // after touching down he carries on a few metres with what speed is left (he used to stop dead at touchdown)
      if (this.speed > 0.3) { dirFrom(this.yaw, 0, _f); const step = this.speed * dt; const nx = this.pos.x + _f.x * step, nz = this.pos.z + _f.z * step; if (!field.isWater(nx, nz) && field.slopeAt(nx, nz) < 0.7) { this.pos.x = nx; this.pos.z = nz; } }
      this.speed = damp(this.speed, 0, 4.5, dt);
      const g = field.surfaceAt(this.pos.x, this.pos.z);
      this.groundY = g; this.pos.y = damp(this.pos.y, g + this.stand, 5, dt); this.agl = this.pos.y - g;
      this.vel.set(0, 0, 0);
      if (this.canWalk) {
        // W walks (never into water or up a cliff); Shift throws the dragon into the air
        this.walkV = damp(this.walkV, clamp(inp.throttle, 0, 1) * this.walkMax, 3.2, dt);
        if (this.walkV > 0.02) {
          dirFrom(this.yaw, 0, _f); const nx = this.pos.x + _f.x * this.walkV * dt, nz = this.pos.z + _f.z * this.walkV * dt;
          if (!field.isWater(nx, nz) && field.slopeAt(nx, nz) < 0.7) { this.pos.x = nx; this.pos.z = nz; this.vel.set(_f.x * this.walkV, 0, _f.z * this.walkV); } else this.walkV = 0;
        }
        if (inp.boost) { this.walkV = 0; this.takeOff(); }
      } else if (inp.throttle > 0 || inp.boost) this.takeOff();
      const a = this.anim; a.walk = this.canWalk ? this.walkV / this.walkMax : 0; a.walkSpeed = this.canWalk ? this.walkV : 0;
      a.flap = 0; a.rate = this.flapHz; a.tuck = 0; a.brake = 0; a.landed = 1; a.mouth = this.firing ? 1 : 0;
      a.lookYaw = clamp(dy, -1, 1); a.lookPitch = this.aimPitch; a.bank = 0; a.yawRate = this.turnRate; a.pitchRate = 0;
      return;
    }

    // ---- the launch: ~0.55 s crouched where he stands, then a leap (strong lift, little speed) and a climb gathering
    // speed, matching the take-off clip (2.2 s); normal flight takes over from there at ~26 m/s
    if (this.launchT !== undefined && this.launchT < 2.2) {
      this.launchT += dt; const t = this.launchT, g = field.surfaceAt(this.pos.x, this.pos.z);
      const dY = wrapPi(this.aimYaw - this.yaw); this.turnRate = damp(this.turnRate, clamp(dY * 1.2, -0.35, 0.35), 3, dt); this.yaw += this.turnRate * dt;
      if (Math.abs(dY) > 1.0) this.aimYaw = this.yaw + Math.sign(dY) * 1.0;
      if (t < 0.55) { this.speed = 0; this.vel.set(0, 0, 0); this.pos.y = damp(this.pos.y, g + this.stand, 8, dt); }
      else {
        if (!this.launchVy) { this.launchVy = 15; this.shake = Math.max(this.shake, 0.35); }
        this.launchVy = damp(this.launchVy, 5, 1.3, dt);
        this.speed = Math.min(26, this.speed + 12 * dt);
        dirFrom(this.yaw, 0, _f); this.vel.set(_f.x * this.speed, this.launchVy, _f.z * this.speed);
        this.pos.addScaledVector(this.vel, dt);
      }
      this.pitch = damp(this.pitch, Math.atan2(this.vel.y, Math.max(this.speed, 6)) * 0.8, 3, dt); this.roll = damp(this.roll, 0, 3, dt);
      if (t >= 2.2) { this.pitch = Math.atan2(this.launchVy, this.speed); this.launchT = undefined; }
      this.groundY = g; this.agl = this.pos.y - g;
      const a = this.anim; a.flap = 1.2; a.rate = this.flapHz * 1.25; a.launch = 1; a.tuck = 0; a.brake = 0; a.landed = 0; a.walk = 0; a.walkSpeed = 0; a.mouth = this.firing ? 1 : 0;
      a.lookYaw = clamp(dY, -1, 1); a.lookPitch = 0; a.bank = this.roll; a.yawRate = this.turnRate; a.pitchRate = 0;
      return;
    }

    // ---- steering toward the aim direction
    this.landT = Math.max(0, this.landT - dt * 0.8);
    const dYaw = wrapPi(this.aimYaw - this.yaw), dPitch = this.aimPitch - this.pitch;
    const speedTurn = lerp(1.15, 0.72, clamp((this.speed - this.cruise) / (this.boostSpeed - this.cruise), 0, 1));
    const maxTurn = this.maxTurn * speedTurn * (this.braking ? 1.35 : 1);
    const wantTurn = clamp(dYaw * 2.4, -maxTurn, maxTurn);
    this.turnRate = damp(this.turnRate, wantTurn, 3.2, dt);
    this.yaw += this.turnRate * dt;
    const wantPitchRate = clamp(dPitch * 2.6, -this.pitchSpeed, this.pitchSpeed);
    this.pitchRate = damp(this.pitchRate, wantPitchRate, 4, dt);
    this.pitch = clamp(this.pitch + this.pitchRate * dt, -1.3, 1.3);
    const bank = clamp(this.turnRate / this.maxTurn, -1, 1) * 0.56 + clamp(dYaw, -1, 1) * 0.08;      // up to ~43°: a hard turn, not a wing pointing at the sky
    this.roll = damp(this.roll, bank, 3.4, dt);
    // keep the aim from running away from the dragon
    if (Math.abs(dYaw) > 2.2) this.aimYaw = this.yaw + Math.sign(dYaw) * 2.2;

    // ---- speed
    this.braking = inp.throttle < 0;
    const wantBoost = inp.boost && this.stamina > 0.02 && !this.braking;
    if (wantBoost && !this.boosting && this.stamina > 0.15) { this.boosting = true; this.flapBurst = 1.4; this.events.push('boost'); }
    if (!wantBoost) this.boosting = false;
    this.stamina = clamp(this.stamina + (this.boosting ? -dt / 14 : dt / 9), 0, 1);
    let target = this.cruise;
    if (inp.throttle > 0) target = this.fast;
    if (this.boosting) target = this.boostSpeed;
    if (this.braking) target = 15;
    const sinP = Math.sin(this.pitch);
    // gravity trades height for speed
    this.speed += -sinP * 9.81 * (sinP < 0 ? 1.9 : 1.15) * dt;
    const rate = this.speed < target ? (this.boosting ? 0.75 : 0.42) : (this.braking ? 1.1 : (sinP < -0.15 ? 0.05 : 0.3));
    this.speed = damp(this.speed, target, rate, dt);
    this.speed = clamp(this.speed, 9, 190);

    dirFrom(this.yaw, this.pitch, _f);
    this.vel.copy(_f).multiplyScalar(this.speed);
    // slow flight loses a little lift
    const sink = clamp((22 - this.speed) / 22, 0, 1);
    this.vel.y -= sink * 3.0 * (this.braking ? 0.4 : 1);
    // braking with the nose down settles the dragon toward the ground for a landing
    if (this.braking) this.vel.y -= clamp(-this.aimPitch * 4, 0, 1) * 11;
    // braking slowly near the ground he settles in to land (he hovered for seconds before)
    const settling = this.braking && this.speed < 32 && this.agl < 45;
    if (settling) this.vel.y -= 5.5 * clamp((32 - this.speed) / 14, 0.3, 1);
    this.pos.addScaledVector(this.vel, dt);

    // ---- world bounds: gently turn back at the edge of the map
    const bx = MAP.W / 2 - (REGION.EDGE + 1.2) * MAP.UNIT, bz = MAP.H / 2 - (REGION.EDGE + 1.2) * MAP.UNIT;      // the playable region, clear of the faded coast
    if (Math.abs(this.pos.x) > bx || Math.abs(this.pos.z) > bz) {
      const toC = Math.atan2(-this.pos.x, this.pos.z);   // yaw pointing at the origin
      this.aimYaw += wrapPi(toC - this.aimYaw) * dt * 0.6;
    }
    this.pos.y = Math.min(this.pos.y, 6500);
    if (this.pos.y > 6200) this.aimPitch = Math.min(this.aimPitch, 0);

    // ---- terrain
    const g = field.surfaceAt(this.pos.x, this.pos.z);
    this.groundY = g; this.agl = this.pos.y - g;
    // look-ahead pull-up assist
    const la = 1.4;
    const ax = this.pos.x + this.vel.x * la, az = this.pos.z + this.vel.z * la;
    const gAhead = field.surfaceAt(ax, az) + this.belly + 6;
    const yAhead = this.pos.y + this.vel.y * la;
    if (yAhead < gAhead && !(this.braking && this.speed < 32)) {      // (not while settling in to land)
      const need = Math.atan2(gAhead - this.pos.y, Math.max(20, this.speed * la));
      if (this.pitch < need) { this.pitch = damp(this.pitch, need, 5, dt); this.aimPitch = Math.max(this.aimPitch, Math.min(need, 0.9)); }
    }
    const minY = g + this.belly;
    if (this.pos.y < minY) {
      const water = field.isWater(this.pos.x, this.pos.z);
      const slow = this.speed < 34;
      if (slow && !water && this.braking) {
        this.mode = 'ground'; this.events.push('land'); this.shake = Math.max(this.shake, 0.5);
      } else {
        const impact = clamp(-this.vel.y / 30, 0, 1);
        this.pos.y = minY;
        if (this.pitch < 0.04) { this.pitch = 0.04; this.aimPitch = Math.max(this.aimPitch, 0.06); }
        if (impact > 0.25) { this.shake = Math.max(this.shake, impact); this.speed *= 1 - impact * 0.35; this.events.push(water ? 'splash' : 'scrape'); }
        else if (water && this.speed > 20) this.events.push('skim');
      }
    } else if (this.agl < this.stand * 1.5 && this.braking && this.speed < 30 && !field.isWater(this.pos.x, this.pos.z)) {
      this.mode = 'ground'; this.events.push('land'); this.shake = Math.max(this.shake, 0.4);
    }
    this.shake = Math.max(0, this.shake - dt * 1.6);

    // ---- animation intent
    const a = this.anim;
    const climb = clamp(sinP, 0, 1), dive = clamp(-sinP, 0, 1);
    const accel = clamp((target - this.speed) / 30, 0, 1);
    this.flapBurst = Math.max(0, this.flapBurst - dt);
    // big wings alternate between bursts of flapping and long glides when cruising
    this.glidePhase += dt * 0.12;      // a run of slow beats, then a long glide (~8 s cycle)
    const burst = Math.sin(this.glidePhase * Math.PI * 2) > 0.25 ? 1 : 0;
    let flap = 0.34 * burst + accel * 0.6 + climb * 1.25 + (this.boosting ? 0.55 : 0) + (this.braking ? 0.75 : 0) + sink * 0.8 - dive * 1.6;
    flap = clamp(Math.max(flap, this.flapBurst > 0 ? 1.15 : 0), 0, 1.3);
    if (this.speed > this.boostSpeed * 1.05 && dive > 0.2) flap = 0;
    a.flap = flap;
    a.rate = this.flapHz * (0.82 + 0.3 * flap + (this.boosting ? 0.22 : 0) + (this.flapBurst > 0 ? 0.25 : 0));
    a.tuck = clamp(dive * 1.5 - 0.25, 0, 0.85) + (this.boosting ? 0.1 : 0);
    a.brake = this.braking ? 1 : 0;
    a.landed = 0; a.launch = 0; a.walk = 0; a.walkSpeed = 0; a.mouth = this.firing ? 1 : 0;
    a.lookYaw = clamp(dYaw, -1, 1); a.lookPitch = clamp(dPitch, -0.6, 0.6);
    a.bank = this.roll; a.yawRate = this.turnRate; a.pitchRate = this.pitchRate;
  }

  // orient an Object3D (local +Z forward, +X left, +Y up)
  applyTo(obj) {
    dirFrom(this.yaw, this.pitch, _f);
    _l.crossVectors(UP, _f).normalize(); _u.crossVectors(_f, _l).normalize();
    const c = Math.cos(this.roll), s = Math.sin(this.roll);
    _v.copy(_l).multiplyScalar(c).addScaledVector(_u, s);       // rolled left
    _n.copy(_u).multiplyScalar(c).addScaledVector(_l, -s);      // rolled up
    _m.makeBasis(_v, _n, _f);
    obj.quaternion.setFromRotationMatrix(_m);
    obj.position.copy(this.pos);
  }
}

// ----------------------------------------------------------------- camera
// Follows the dragon in its own frame: the camera's heading and pitch are smoothed angles about the dragon (not a point lagging
// behind it in the world), so it never drifts out to the side in a turn or falls behind at speed; it stays above the dragon
// through climbs and dives, leads a little toward where the rider aims, and keeps the whole dragon in view.
const MODES = [
  { name: 'chase', dist: 1.45, elev: 0.17, lead: 0.28, fov: 56, fovK: 10, rate: 3.2, aimY: 0.16 },     // the whole dragon, wings and tail
  { name: 'close', dist: 0.85, elev: 0.22, lead: 0.4, fov: 66, fovK: 12, rate: 5.0, aimY: 0.2 },      // over the shoulder, behind the rider
  { name: 'wide', dist: 2.6, elev: 0.24, lead: 0.2, fov: 50, fovK: 8, rate: 2.4, aimY: 0.12 },        // cinematic
];
export class ChaseCamera {
  constructor(camera, field) {
    this.camera = camera; this.field = field;
    this.mode = 0;
    this.pos = new THREE.Vector3(); this.look = new THREE.Vector3();
    this.fov = 56; this.roll = 0; this.zoom = 1; this.orbit = 0; this.orbitPitch = 0;
    this.t = 0; this.cyaw = 0; this.cpitch = 0; this.cdist = 40;
  }
  cycle() { this.mode = (this.mode + 1) % MODES.length; }
  get modeName() { return MODES[this.mode].name; }
  _targets(fl) {
    const M_ = MODES[this.mode], s = fl.scale, ground = fl.mode === 'ground';
    const L = 26 * s;                                                                     // the dragon's length
    // on the wing the camera keeps clear of the wings; on the ground the folded dragon is smaller, so it comes in closer
    this.gk = (this.gk === undefined ? (ground ? 1 : 0) : this.gk); const dist = (M_.dist * L * this.zoom + fl.speed * 0.05) * (1 - 0.32 * this.gk);
    const yaw = fl.yaw + clamp(wrapPi(fl.aimYaw - fl.yaw) * M_.lead, -0.4, 0.4) + this.orbit;
    const pitch = clamp(fl.pitch * 0.3 + (fl.aimPitch - fl.pitch) * 0.15, -0.3, 0.3) + this.orbitPitch;
    return { dist, yaw, pitch, elev: M_.elev + (ground ? 0.08 : 0) };
  }
  _place(fl, yaw, pitch, dist, elev, outPos, outLook) {
    dirFrom(yaw, pitch, _f);
    outPos.copy(fl.pos).addScaledVector(_f, -dist * Math.cos(elev));
    outPos.y += Math.sin(elev) * dist;
    outPos.y = Math.max(outPos.y, fl.pos.y + 0.06 * dist);                               // never below the dragon (a climb looked into the sun up its belly)
    // look past the dragon, a little above it, so it sits in the lower middle of the frame with the way ahead open
    outLook.copy(fl.pos).addScaledVector(_f, dist * 0.9);
    outLook.y += MODES[this.mode].aimY * dist;
  }
  snap(fl) {
    const t = this._targets(fl); this.cyaw = t.yaw; this.cpitch = t.pitch; this.cdist = t.dist;
    this._place(fl, t.yaw, t.pitch, t.dist, t.elev, this.pos, this.look);
  }
  update(dt, fl, inp) {
    this.t += dt;
    this.gk = (this.gk || 0) + ((fl.mode === 'ground' ? 1 : 0) - (this.gk || 0)) * (1 - Math.exp(-dt * 1.2));      // eases between the two
    if (inp) { this.zoom = clamp(this.zoom + inp.wheel * 0.08, 0.5, 2.5); }
    const M_ = MODES[this.mode], t = this._targets(fl);
    const k = 1 - Math.exp(-dt * M_.rate);
    this.cyaw += wrapPi(t.yaw - this.cyaw) * k;
    this.cpitch += (t.pitch - this.cpitch) * k;
    this.cdist += (t.dist - this.cdist) * (1 - Math.exp(-dt * 1.5));
    this._place(fl, this.cyaw, this.cpitch, this.cdist, t.elev, this.pos, this.look);
    // never into the ground
    const g = this.field.surfaceAt(this.pos.x, this.pos.z) + 3.5;
    if (this.pos.y < g) this.pos.y = g;
    const cam = this.camera;
    cam.position.copy(this.pos);
    if (fl.shake > 0) {
      const a = fl.shake * 0.9;
      cam.position.x += (Math.sin(this.t * 61) + Math.sin(this.t * 37.3)) * a * 0.35;
      cam.position.y += (Math.sin(this.t * 53) + Math.cos(this.t * 41.7)) * a * 0.35;
    }
    cam.up.set(0, 1, 0);
    cam.lookAt(this.look);
    this.roll = damp(this.roll, -fl.roll * 0.14, 3, dt);                                // lean with the bank, a little
    cam.rotateZ(this.roll);
    const speedF = clamp((fl.speed - fl.cruise) / (fl.boostSpeed - fl.cruise), 0, 1.4);
    const targetFov = M_.fov + speedF * M_.fovK + (fl.boosting ? 3 : 0);
    this.fov = damp(this.fov, targetFov, 2.5, dt);
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
  }
}
