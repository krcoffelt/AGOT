// Dragonfire: billboard particle system, scorching, burning ground fires, smoke plumes.
import * as THREE from 'three';
import { G } from '../core/glsl.js';
import { tileFbm } from '../core/noise.js';

const MAX = 7200;
const _p = new THREE.Vector3(), _d = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _t = new THREE.Vector3();

const VERT = /* glsl */`
attribute vec4 aPos;    // xyz, size
attribute vec4 aData;   // age01, seed, kind, rotation
varying vec2 vUv; varying float vAge; varying float vSeed; varying float vKind;
void main(){
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float c = cos(aData.w), s = sin(aData.w);
  vec2 q = vec2(position.x * c - position.y * s, position.x * s + position.y * c);
  vec3 wp = aPos.xyz + (right * q.x + up * q.y) * aPos.w;
  vUv = position.xy * 0.5 + 0.5; vAge = aData.x; vSeed = aData.y; vKind = aData.z;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;
const FRAG = /* glsl */`
precision highp float;
uniform sampler2D uNoise; uniform vec3 uC0, uC1, uC2; uniform vec3 uSunColor, uAmbSky;
varying vec2 vUv; varying float vAge; varying float vSeed; varying float vKind;
void main(){
  vec2 p = vUv * 2.0 - 1.0; float r = length(p);
  float n = texture(uNoise, vUv * 0.55 + vSeed * vec2(3.1, 7.7) + vec2(0.0, -vAge * 0.45)).r;
  float n2 = texture(uNoise, vUv * 1.3 + vSeed * vec2(5.3, 1.9) + vec2(0.0, -vAge * 0.9)).r;
  float shape = smoothstep(1.0, 0.2, r + (n - 0.5) * 0.9 + (n2 - 0.5) * 0.3);
  if (shape < 0.003) discard;
  vec3 smokeLit = uSunColor * 0.22 + uAmbSky * 0.5;
  if (vKind < 0.5) {          // fire
    float heat = (1.0 - vAge) * shape * (0.7 + 0.6 * n2);
    vec3 col = mix(uC2, uC1, smoothstep(0.08, 0.42, heat));
    col = mix(col, uC0, smoothstep(0.45, 0.85, heat));
    float core = (1.0 - vAge) * (1.0 - vAge) * smoothstep(0.9, 0.0, r);
    col = mix(col, uC0 * 1.3, core * 0.85);
    float em = shape * (1.0 - smoothstep(0.7, 1.0, vAge)) * (0.4 + heat * heat * 14.0 + core * 24.0);
    float smoke = shape * smoothstep(0.5, 0.95, vAge) * (1.0 - smoothstep(0.9, 1.0, vAge)) * 0.42;
    gl_FragColor = vec4(col * em + vec3(0.035) * smokeLit * smoke, smoke);
  } else if (vKind < 1.5) {   // dark smoke
    float a = shape * (1.0 - smoothstep(0.5, 1.0, vAge)) * smoothstep(0.0, 0.08, vAge) * 0.34;
    gl_FragColor = vec4(vec3(0.20, 0.19, 0.18) * smokeLit * (0.55 + 0.9 * n) * a, a);
  } else if (vKind < 2.5) {   // steam / spray
    float a = shape * (1.0 - smoothstep(0.4, 1.0, vAge)) * 0.4;
    gl_FragColor = vec4(vec3(0.8) * smokeLit * a, a);
  } else if (vKind < 3.5) {   // embers
    float a = smoothstep(1.0, 0.0, r) * (1.0 - vAge);
    gl_FragColor = vec4(uC1 * a * 18.0, 0.0);
  } else {                    // water droplets: small bright beads that catch the sun
    float a = smoothstep(1.0, 0.25, r) * (1.0 - smoothstep(0.6, 1.0, vAge));
    gl_FragColor = vec4((uSunColor * 0.5 + uAmbSky * 0.9) * a * 0.75, a * 0.55);
  }
}`;

function noiseTexture() {
  const S = 128; const d = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const v = tileFbm(x / S, y / S, 4, 5, 123) * 255; const o = (y * S + x) * 4; d[o] = d[o + 1] = d[o + 2] = v; d[o + 3] = 255; }
  const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

export class Fire {
  constructor(scene, field, terrain) {
    this.field = field; this.terrain = terrain;
    this.n = 0; this.head = 0;
    this.pos = new Float32Array(MAX * 3); this.vel = new Float32Array(MAX * 3);
    this.age = new Float32Array(MAX); this.life = new Float32Array(MAX).fill(0); this.size0 = new Float32Array(MAX); this.size1 = new Float32Array(MAX);
    this.kind = new Float32Array(MAX); this.seed = new Float32Array(MAX); this.buoy = new Float32Array(MAX); this.drag = new Float32Array(MAX);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4); this.aData = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
    this.aPos.setUsage(THREE.DynamicDrawUsage); this.aData.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPos', this.aPos); geo.setAttribute('aData', this.aData); geo.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      uniforms: { uNoise: { value: noiseTexture() }, uC0: { value: new THREE.Color() }, uC1: { value: new THREE.Color() }, uC2: { value: new THREE.Color() }, uSunColor: G.uSunColor, uAmbSky: G.uAmbSky },
    });
    this.mesh = new THREE.Mesh(geo, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 50;
    scene.add(this.mesh);
    this.light = new THREE.PointLight(0xff7a20, 0, 260, 1.6); scene.add(this.light);
    this.fuel = 1; this.locked = false; this.active = false; this.intensity = 0;
    this.burns = [];        // { x, y, z, t, life, r }
    this.plumes = [];       // persistent smoke emitters { pos, rate, size }
    this._emitAcc = 0; this._hitT = 0; this.onHit = null;
    this.power = 1;
  }
  setDragon(def) {
    this.mat.uniforms.uC0.value.set(def.flame[0]); this.mat.uniforms.uC1.value.set(def.flame[1]); this.mat.uniforms.uC2.value.set(def.flame[2]);
    G.uFireColor.value.set(def.flame[1]); this.light.color.set(def.flame[1]);
    this.power = (0.75 + 0.5 * def.stats.fire) * Math.pow(def.scale, 0.6);
  }
  _spawn(px, py, pz, vx, vy, vz, life, s0, s1, kind, buoy = 6, drag = 1.6) {
    const i = this.head; this.head = (this.head + 1) % MAX;
    this.pos[i * 3] = px; this.pos[i * 3 + 1] = py; this.pos[i * 3 + 2] = pz; this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.age[i] = 0; this.life[i] = life; this.size0[i] = s0; this.size1[i] = s1; this.kind[i] = kind; this.seed[i] = Math.random(); this.buoy[i] = buoy; this.drag[i] = drag;
  }

  // mouth: world position, dir: unit direction, vel: dragon velocity
  // water thrown up where something cuts the surface at speed: beads flung up and back, and a hanging veil of mist
  spray(x, y, z, vel, strength, dt) {
    const sp = Math.hypot(vel.x, vel.z); this._sprayAcc = (this._sprayAcc || 0) + dt * (150 + 430 * strength) * Math.min(1.5, 0.35 + sp / 50);
    while (this._sprayAcc >= 1) {
      this._sprayAcc -= 1; const a = Math.random() * 6.283, r = Math.random() * 1.2;
      this._spawn(x + Math.cos(a) * r, y + 0.2, z + Math.sin(a) * r, vel.x * 0.32 + Math.cos(a) * (3 + Math.random() * 7), (5 + Math.random() * 12) * (0.5 + strength), vel.z * 0.32 + Math.sin(a) * (3 + Math.random() * 7), 0.7 + Math.random() * 0.9, 0.35 + Math.random() * 0.5, 0.15, 4, -17, 0.5);
      if (Math.random() < 0.42) this._spawn(x, y + 0.5, z, vel.x * 0.16 + (Math.random() - 0.5) * 3, 2 + Math.random() * 3.5, vel.z * 0.16 + (Math.random() - 0.5) * 3, 1.5 + Math.random() * 1.6, 2, 10 + Math.random() * 9 * strength, 2, 0.6, 1.4);
    }
  }
  // a body hitting the water: a ring of spray thrown outward
  splash(x, y, z, vel, big = 1) {
    for (let k = 0; k < 70 * big; k++) { const a = Math.random() * 6.283, sv = 6 + Math.random() * 16 * big; this._spawn(x + Math.cos(a) * 2, y + 0.3, z + Math.sin(a) * 2, vel.x * 0.25 + Math.cos(a) * sv, 9 + Math.random() * 22 * big, vel.z * 0.25 + Math.sin(a) * sv, 0.9 + Math.random() * 1.1, 0.3 + Math.random() * 0.5, 0.15, 4, -19, 0.45); }
    for (let k = 0; k < 14 * big; k++) { const a = Math.random() * 6.283; this._spawn(x + Math.cos(a) * 4, y + 1, z + Math.sin(a) * 4, vel.x * 0.2 + Math.cos(a) * 5, 4 + Math.random() * 6, vel.z * 0.2 + Math.sin(a) * 5, 1.8 + Math.random() * 1.6, 3, 16 + Math.random() * 10, 2, 0.8, 1.2); }
  }

  update(dt, firing, mouth, dir, vel, camPos) {
    // ---- fuel
    if (this.fuel <= 0.001) this.locked = true; if (this.locked && this.fuel > 0.3) this.locked = false;
    this.active = firing && !this.locked;
    this.fuel = Math.min(1, Math.max(0, this.fuel + (this.active ? -dt * 0.17 : dt * 0.11)));
    this.intensity += ((this.active ? 1 : 0) - this.intensity) * Math.min(1, dt * (this.active ? 9 : 5));
    const pw = this.power;

    if (this.active) {
      // ---- emit the jet
      this._emitAcc += dt * 1000;
      _r.crossVectors(dir, _u.set(0, 1, 0)).normalize(); _u.crossVectors(_r, dir).normalize();
      while (this._emitAcc >= 1) {
        this._emitAcc -= 1;
        const a = Math.random() * 6.283, sp = Math.sqrt(Math.random()) * 0.095, f = Math.random();
        _d.copy(dir).addScaledVector(_r, Math.cos(a) * sp).addScaledVector(_u, Math.sin(a) * sp);
        const v = (94 + Math.random() * 42) * Math.sqrt(pw);
        this._spawn(mouth.x + dir.x * 1.2 + vel.x * dt * f, mouth.y + dir.y * 1.2 + vel.y * dt * f, mouth.z + dir.z * 1.2 + vel.z * dt * f,
          _d.x * v + vel.x, _d.y * v + vel.y, _d.z * v + vel.z, 0.8 + Math.random() * 0.7, 0.8 * pw, (5.4 + Math.random() * 6.2) * pw, 0, 8, 1.7);
        if (Math.random() < 0.14) this._spawn(mouth.x, mouth.y, mouth.z, _d.x * v * 0.8 + vel.x, _d.y * v * 0.8 + vel.y + 6, _d.z * v * 0.8 + vel.z, 1.2 + Math.random() * 1.4, 0.3, 0.1, 3, -9, 0.6);
        // black smoke rolls off the far end of the jet
        if (Math.random() < 0.035) { const sd = 34 + Math.random() * 50; this._spawn(mouth.x + dir.x * sd, mouth.y + dir.y * sd, mouth.z + dir.z * sd, _d.x * v * 0.22 + vel.x * 0.6, _d.y * v * 0.22 + 4, _d.z * v * 0.22 + vel.z * 0.6, 2.6 + Math.random() * 2.4, 7 * pw, 30 * pw, 1, 3.5, 0.9); }
      }
      // ---- where does the jet strike?
      this._hitT -= dt;
      if (this._hitT <= 0) {
        this._hitT = 0.09;
        const range = 140 * Math.sqrt(pw);
        for (let s = 8; s < range; s += 5) {
          const x = mouth.x + dir.x * s, y = mouth.y + dir.y * s - s * s * 0.0012, z = mouth.z + dir.z * s;
          const g = this.field.heightAt(x, z);
          const roof = this.obstacle ? this.obstacle(x, y, z) : -Infinity;      // a building in the way (CityFire)
          if (y < roof) {
            const rad = (11 + Math.random() * 7) * Math.sqrt(pw);
            if (this.onHit) this.onHit(x, roof, z, rad);
            for (let k = 0; k < 5; k++) { const a2 = Math.random() * 6.283, sv = 10 + Math.random() * 14; this._spawn(x, roof + 0.5, z, Math.cos(a2) * sv, 4 + Math.random() * 10, Math.sin(a2) * sv, 0.6 + Math.random() * 0.6, 3 * pw, (8 + Math.random() * 6) * pw, 0, 14, 2.2); }
            for (let k = 0; k < 3; k++) this._spawn(x, roof + 0.5, z, (Math.random() - 0.5) * 30, 14 + Math.random() * 18, (Math.random() - 0.5) * 30, 1.2 + Math.random() * 1.2, 0.3, 0.1, 3, -14, 0.5);
            break;
          }
          if (y < Math.max(g, 0) + 1.5) {
            if (g > 0.3 && this.field.riverAt(x, z) < 0.5) {
              const rad = (13 + Math.random() * 9) * Math.sqrt(pw);
              this.terrain.addScorch(x + (Math.random() - 0.5) * 6, z + (Math.random() - 0.5) * 6, rad, 1);
              if (this.burns.length < 46) this.burns.push({ x: x + (Math.random() - 0.5) * rad, y: g, z: z + (Math.random() - 0.5) * rad, t: 0, life: 7 + Math.random() * 9, r: rad * 0.5 });
              if (this.onHit) this.onHit(x, g, z, rad);
              // the jet splashes along the ground: flames flare outward from the strike, sparks fly
              for (let k = 0; k < 5; k++) { const a2 = Math.random() * 6.283, sv = 12 + Math.random() * 16; this._spawn(x, g + 1, z, Math.cos(a2) * sv, 5 + Math.random() * 11, Math.sin(a2) * sv, 0.6 + Math.random() * 0.6, 3 * pw, (9 + Math.random() * 6) * pw, 0, 14, 2.2); }
              for (let k = 0; k < 3; k++) this._spawn(x, g + 1, z, (Math.random() - 0.5) * 30, 14 + Math.random() * 18, (Math.random() - 0.5) * 30, 1.2 + Math.random() * 1.2, 0.3, 0.1, 3, -14, 0.5);
            } else {
              for (let k = 0; k < 9; k++) this._spawn(x + (Math.random() - 0.5) * 12, 0.5, z + (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 8, 9 + Math.random() * 13, (Math.random() - 0.5) * 8, 1.8 + Math.random() * 1.4, 4, 20, 2, 3.5, 1.1);
            }
            break;
          }
        }
      }
    }
    // ---- burning ground
    for (let i = this.burns.length - 1; i >= 0; i--) {
      const b = this.burns[i]; b.t += dt; if (b.t > b.life) { this.burns.splice(i, 1); continue; }
      const k = 1 - b.t / b.life;
      if (Math.hypot(b.x - camPos.x, b.z - camPos.z) > 2500) continue;
      if (Math.random() < dt * 42 * k) {
        const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * b.r;
        this._spawn(b.x + Math.cos(a) * r, b.y + 0.5, b.z + Math.sin(a) * r, (Math.random() - 0.5) * 3, 5 + Math.random() * 8, (Math.random() - 0.5) * 3, 0.7 + Math.random() * 0.8, 1.5 + 2.5 * k, 3 + 5 * k, 0, 16, 1.0);
      }
      if (Math.random() < dt * 5) { const a = Math.random() * 6.283; this._spawn(b.x + Math.cos(a) * b.r * 0.6, b.y + 3, b.z + Math.sin(a) * b.r * 0.6, 2 + Math.random() * 3, 7 + Math.random() * 5, 1, 5 + Math.random() * 4, 4, 26, 1, 2.2, 0.35); }
    }
    this.terrain.coolScorch(dt);
    // ---- standing plumes (volcano, beacons)
    for (const p of this.plumes) {
      if (Math.hypot(p.pos.x - camPos.x, p.pos.z - camPos.z) > (p.range || 14000)) continue;
      p.acc = (p.acc || 0) + dt * p.rate;
      while (p.acc >= 1) { p.acc -= 1; this._spawn(p.pos.x + (Math.random() - 0.5) * p.size * 2, p.pos.y, p.pos.z + (Math.random() - 0.5) * p.size * 2, 5 + Math.random() * 4, 16 + Math.random() * 10, 2.5, p.life * (0.7 + Math.random() * 0.6), p.size * 0.8, p.size * 5.5, p.kind, 0.6, 0.1); }
    }

    // ---- simulate + upload
    let n = 0; const P = this.aPos.array, D = this.aData.array;
    let lx = 0, ly = 0, lz = 0, lw = 0;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.age[i] += dt; const t = this.age[i] / this.life[i];
      if (t >= 1) { this.life[i] = 0; continue; }
      const i3 = i * 3; const dr = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= dr; this.vel[i3 + 1] = this.vel[i3 + 1] * dr + this.buoy[i] * dt; this.vel[i3 + 2] *= dr;
      this.pos[i3] += this.vel[i3] * dt; this.pos[i3 + 1] += this.vel[i3 + 1] * dt; this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.kind[i] === 0) {
        // fire splashes along the ground instead of passing through it
        const g = Math.max(this.field.baseHeight(this.pos[i3], this.pos[i3 + 2]), 0);
        if (this.pos[i3 + 1] < g + 0.6) { this.pos[i3 + 1] = g + 0.6; this.vel[i3 + 1] = Math.abs(this.vel[i3 + 1]) * 0.25 + 3; this.vel[i3] *= 0.86; this.vel[i3 + 2] *= 0.86; }
        if (t < 0.5) { const w = 1 - t * 2; lx += this.pos[i3] * w; ly += this.pos[i3 + 1] * w; lz += this.pos[i3 + 2] * w; lw += w; }
      }
      const o = n * 4;
      P[o] = this.pos[i3]; P[o + 1] = this.pos[i3 + 1]; P[o + 2] = this.pos[i3 + 2];
      P[o + 3] = this.size0[i] + (this.size1[i] - this.size0[i]) * (1 - (1 - t) * (1 - t));
      D[o] = t; D[o + 1] = this.seed[i]; D[o + 2] = this.kind[i]; D[o + 3] = this.seed[i] * 6.283 + t * (this.seed[i] - 0.5) * 3;
      n++;
    }
    this.mesh.geometry.instanceCount = n; this.aPos.needsUpdate = true; this.aData.needsUpdate = true;
    // ---- light cast by the flames
    if (lw > 4) {
      const flick = 0.8 + 0.2 * Math.sin(G.uTime.value * 31) * Math.sin(G.uTime.value * 17.3);
      const inten = Math.min(1, lw / 160) * flick;
      this.light.position.set(lx / lw, ly / lw + 4, lz / lw); this.light.intensity = inten * 15000 * pw;
      G.uFireLight.value.set(lx / lw, ly / lw + 6, lz / lw, inten * 22 * pw);
    } else { this.light.intensity = 0; G.uFireLight.value.w = 0; }
  }
}
