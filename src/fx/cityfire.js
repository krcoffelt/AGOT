// Burning towns, ported from the Unreal prototype (unreal/Dragonrider/Source/Dragonrider/DragonCity.cpp).
// Dragonfire heats the baked houses it lands on; one that takes enough catches, its windows blaze and it chars black over
// a minute, and after a few seconds the fire may jump to the houses touching it (each jump less likely than the last, so a
// blaze takes a block, not the city). Townsfolk near a fire run from it. Flames and smoke columns are camera-facing strips
// with their own clocks, so a burning house costs nothing on the CPU between its 0.2 s updates.
import * as THREE from 'three';
import { G, GLSL_ATMOS_UNIFORMS, GLSL_ATMOS } from '../core/glsl.js';
import { tileFbm } from '../core/noise.js';

const CELL = 24;                       // metres: the grid houses and people are filed under (no house is wider than this)
const FLAME_CAP = 900, SMOKE_CAP = 400;
const keyOf = (ix, iz) => (ix + 32768) * 65536 + (iz + 32768);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0), _p = new THREE.Vector3(), _s = new THREE.Vector3();

const VERT = /* glsl */`
attribute vec4 aA;      // base xyz, width
attribute vec4 aB;      // height, seed, lit at (seconds), lasts (seconds)
uniform float uTime; uniform vec2 uLean;
varying vec2 vUv; varying float vSeed; varying float vEnv; varying vec3 vWorld;
void main(){
  float age = uTime - aB.z;
#if defined(CHIMNEY)
  float env = 1.0 - step(aB.w, age);
  float h = aB.x, w = aA.w * mix(0.35, 3.6, position.y);
#elif defined(SMOKE)
  float env = smoothstep(0.0, 5.0, age) * (1.0 - smoothstep(aB.w - 18.0, aB.w, age));
  float h = aB.x * (0.35 + 0.65 * smoothstep(0.0, 14.0, age)), w = aA.w * mix(0.45, 1.7, position.y);
#else
  float env = smoothstep(0.0, 2.5, age) * (1.0 - smoothstep(aB.w - 8.0, aB.w, age));
  float h = aB.x * (0.8 + 0.2 * sin(uTime * 3.1 + aB.y * 20.0)), w = aA.w;
#endif
  if (age < 0.0 || env <= 0.001) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 toCam = cameraPosition - aA.xyz;
  vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x) + vec3(1e-4, 0.0, 0.0));
  vec3 wp = aA.xyz + right * position.x * w * 0.5 + vec3(0.0, position.y * h, 0.0);
#if defined(CHIMNEY)
  wp.xz += uLean * 3.0 * position.y * position.y * h + vec2(sin(uTime * 0.7 + aB.y * 9.0), cos(uTime * 0.53 + aB.y * 7.0)) * position.y * 2.0;
#elif defined(SMOKE)
  wp.xz += uLean * position.y * position.y * h;
#endif
  vUv = vec2(position.x * 0.5 + 0.5, position.y); vSeed = aB.y; vEnv = env; vWorld = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;
const FRAG = /* glsl */`
precision highp float;
uniform sampler2D uNoise; uniform float uTime; uniform vec3 uSunColor, uAmbSky;
varying vec2 vUv; varying float vSeed; varying float vEnv; varying vec3 vWorld;
${GLSL_ATMOS_UNIFORMS}
${GLSL_ATMOS}
void main(){
  float x = abs(vUv.x * 2.0 - 1.0);
#if defined(CHIMNEY)        // a thin wisp of hearth smoke, pale and drifting, fading out as it rises
  float n = texture(uNoise, vec2(vUv.x * 0.5 + vSeed * 3.1, vUv.y * 0.6 - uTime * 0.07 + vSeed)).r;
  float n2 = texture(uNoise, vec2(vUv.x * 1.2 + vSeed * 5.7, vUv.y * 1.4 - uTime * 0.13)).r;
  float shape = smoothstep(1.0, 0.1, x + (n - 0.5) * 1.1 + (n2 - 0.5) * 0.5) * smoothstep(0.0, 0.06, vUv.y) * (1.0 - smoothstep(0.25, 1.0, vUv.y + (n - 0.5) * 0.3));
  float a = shape * vEnv * 0.42;
  if (a < 0.004) discard;
  vec3 col = vec3(0.30, 0.29, 0.28) * (uSunColor * 0.28 + uAmbSky * 0.55) * (0.7 + 0.5 * n);
  gl_FragColor = vec4(applyAtmosphere(col, vWorld, cameraPosition) * a, a);
#elif defined(SMOKE)
  float n = texture(uNoise, vec2(vUv.x * 0.6 + vSeed * 3.1, vUv.y * 0.35 - uTime * 0.05 + vSeed)).r;
  float n2 = texture(uNoise, vec2(vUv.x * 1.4 + vSeed * 7.7, vUv.y * 0.9 - uTime * 0.1)).r;
  float shape = smoothstep(1.0, 0.2, x + (n - 0.5) * 1.0 + (n2 - 0.5) * 0.45) * smoothstep(0.0, 0.12, vUv.y) * (1.0 - smoothstep(0.5, 1.0, vUv.y + (n - 0.5) * 0.35));
  float a = shape * vEnv * 0.78;
  if (a < 0.004) discard;
  vec3 col = vec3(0.065, 0.058, 0.052) * (uSunColor * 0.25 + uAmbSky * 0.45) * (0.55 + 0.9 * n);
  col += vec3(1.0, 0.32, 0.06) * smoothstep(0.22, 0.0, vUv.y) * 0.6;          // lit from below by the fire
  gl_FragColor = vec4(applyAtmosphere(col, vWorld, cameraPosition) * a, a);
#else
  float n = texture(uNoise, vec2(vUv.x * 0.7 + vSeed * 3.1, vUv.y * 0.5 - uTime * 0.9 + vSeed)).r;
  float n2 = texture(uNoise, vec2(vUv.x * 1.7 + vSeed * 7.3, vUv.y * 1.1 - uTime * 1.8)).r;
  float f = (1.0 - x * x) * (1.0 - vUv.y) * 1.7 - (n * 0.8 + n2 * 0.45) * (0.3 + vUv.y * 0.95);
  float shape = smoothstep(0.04, 0.32, f) * smoothstep(0.0, 0.1, vUv.y);
  float a = shape * vEnv;
  if (a < 0.01) discard;
  float heat = clamp(f * 1.5, 0.0, 1.0);
  vec3 col = mix(vec3(0.55, 0.07, 0.01), vec3(1.0, 0.4, 0.06), smoothstep(0.1, 0.5, heat));
  col = mix(col, vec3(1.0, 0.82, 0.48), smoothstep(0.55, 0.95, heat));
  gl_FragColor = vec4(applyAtmosphere(col * (1.3 + heat * heat * 4.5), vWorld, cameraPosition) * a, a * 0.75);
#endif
}`;

function noiseTexture() {
  const S = 128, d = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const v = tileFbm(x / S, y / S, 4, 5, 321) * 255, o = (y * S + x) * 4; d[o] = d[o + 1] = d[o + 2] = v; d[o + 3] = 255; }
  const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

// a pool of strips; the oldest gives up its place once the pool is full
class Strips {
  constructor(scene, cap, smoke, noise, lean, chimney = false) {
    this.cap = cap; this.next = 0;
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 0, 0, 1, 1, 0, -1, 1, 0], 3));
    this.aA = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); this.aB = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    geo.setAttribute('aA', this.aA); geo.setAttribute('aB', this.aB); geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, defines: chimney ? { CHIMNEY: 1 } : smoke ? { SMOKE: 1 } : {}, transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      uniforms: { uNoise: { value: noise }, uTime: G.uTime, uLean: { value: lean }, uSunColor: G.uSunColor, uAmbSky: G.uAmbSky,
        uSkyLUT: G.uSkyLUT, uWeather: G.uWeather, uTrueSunDir: G.uTrueSunDir, uFogParams: G.uFogParams },
    });
    this.mesh = new THREE.Mesh(geo, mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = chimney ? 47 : smoke ? 48 : 49; this.mesh.name = chimney ? 'chimneySmoke' : smoke ? 'citySmoke' : 'cityFlames';
    scene.add(this.mesh);
  }
  add(x, y, z, w, h, start, life) {
    const i = this.next % this.cap; this.next++;
    this.aA.array.set([x, y, z, w], i * 4); this.aB.array.set([h, Math.random(), start, life], i * 4);
    this.mesh.geometry.instanceCount = Math.min(this.next, this.cap);
    this.aA.needsUpdate = true; this.aB.needsUpdate = true;
    return i;
  }
  end(i, t) { this.aB.array[i * 4 + 3] = t - this.aB.array[i * 4 + 2]; this.aB.needsUpdate = true; }
}

export class CityFire {
  constructor(scene, landmarks, field, fire) {
    this.field = field; this.fire = fire;
    this.houses = []; this.hgrid = new Map(); this.people = []; this.pgrid = new Map();
    this.burning = []; this.running = []; this.stepT = 0; this.nBurnt = 0; this.nFled = 0;
    for (const s of landmarks.sites) for (const m of s.group.children) {
      const ud = m.userData;
      if (ud.houseList) {
        const attr = m.geometry.getAttribute('aBurn'), M = ud.houseMeta;
        ud.houseList.forEach((h, i) => {
          const hx = M.w * h.sx / 2, hz = M.d * h.sz / 2;
          this._file(this.hgrid, s.x + h.x, s.z + h.z, this.houses.push({ attr, i, x: s.x + h.x, y: h.y, z: s.z + h.z, c: Math.cos(h.rot), s: Math.sin(h.rot), hx, hz, R: Math.max(hx, hz), H: M.h * h.sy, state: 0, heat: 0 }) - 1);
        });
      }
      if (ud.anim) {
        const geo = m.geometry, A = geo.getAttribute('aAnimA'), B = geo.getAttribute('aAnimB'), C = geo.getAttribute('aAnimC'), F = geo.getAttribute('aFlee');
        ud.anim.list.forEach((p, i) => {
          if (Math.abs(p.y - field.heightAt(s.x + p.x, s.z + p.z)) > 0.6) return;        // on a pier or a deck: nowhere to run
          this._file(this.pgrid, s.x + p.x, s.z + p.z, this.people.push({ mesh: m, A, B, C, F, an: ud.anim, i, ox: s.x, oz: s.z, x: s.x + p.x, z: s.z + p.z, rot: p.rot, s: p.s, running: false }) - 1);
        });
      }
    }
    const noise = noiseTexture();
    this.lean = new THREE.Vector2(0.18, 0.08);
    this.flames = new Strips(scene, FLAME_CAP, false, noise, this.lean);
    this.smoke = new Strips(scene, SMOKE_CAP, true, noise, this.lean);
    // hearth smoke from about one house in forty; a house that catches fire stops smoking from its chimney
    const fr = (v) => v - Math.floor(v), lit = this.houses.filter((H, i) => fr(Math.sin(i * 12.9898 + 4.1) * 43758.5453) < 0.025);
    this.chimneys = new Strips(scene, Math.max(1, lit.length), true, noise, this.lean, true);
    lit.forEach((H, i) => {
      const u = fr(Math.sin(i * 78.233) * 43758.5453) - 0.5, v = fr(Math.sin(i * 37.719) * 43758.5453) - 0.5, lx = u * H.hx, lz = v * H.hz;
      H.chimney = this.chimneys.add(H.x + lx * H.c + lz * H.s, H.y + H.H * 0.9, H.z - lx * H.s + lz * H.c, 2.2 + (u + 0.5) * 1.6, 16 + (v + 0.5) * 22, -1, 1e6);      // ~11 days of play (a 1e9 life never drew)
    });
    this.light = new THREE.PointLight(0xff6a1c, 0, 420, 1.6); scene.add(this.light);
    console.log(`[cityfire] ${this.houses.length} houses (${lit.length} with hearth smoke), ${this.people.length} townsfolk`);
  }
  _file(grid, x, z, i) { const k = keyOf(Math.floor(x / CELL), Math.floor(z / CELL)); let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(i); }
  _near(grid, x, z, r, fn) {
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL), z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) { const l = grid.get(keyOf(ix, iz)); if (l) for (const i of l) fn(i); }
  }
  _inside(H, x, z, m = 0) { const dx = x - H.x, dz = z - H.z; return Math.abs(dx * H.c - dz * H.s) < H.hx + m && Math.abs(dx * H.s + dz * H.c) < H.hz + m; }
  // the height of the roof the breath runs into at (x, y, z), or -Infinity if no house stands there
  roofAt(x, y, z) {
    let top = -Infinity;
    this._near(this.hgrid, x, z, CELL / 2, (i) => { const H = this.houses[i], t = H.y + H.H * 0.8; if (y < t && y > H.y - 2 && t > top && this._inside(H, x, z)) top = t; });
    return top;
  }
  houseAt(x, z, m = 0.6) { let hit = false; this._near(this.hgrid, x, z, CELL / 2, (i) => { if (!hit && this._inside(this.houses[i], x, z, m)) hit = true; }); return hit; }

  // dragonfire landing at (x, y, z), spread over radius r: houses close enough warm up, and catch at heat 1
  heat(x, y, z, r, amount = 0.5) {
    const lit = [];
    this._near(this.hgrid, x, z, r + 14, (i) => {
      const H = this.houses[i];
      if (H.state !== 0 || y > H.y + H.H + 8 || y < H.y - 8) return;
      const d = Math.hypot(x - H.x, z - H.z) - H.R; if (d > r * 0.5) return;
      H.heat += amount * (1 - 0.6 * Math.min(1, Math.max(0, d / (r * 0.5))));
      if (H.heat >= 1) lit.push(i);
    });
    for (const i of lit) this.ignite(i, 0);
    this.scare(x, z, 60);
    return lit.length;
  }
  ignite(i, gen = 0) {
    const H = this.houses[i]; if (H.state !== 0) return;
    const t = G.uTime.value;
    Object.assign(H, { state: 1, t: 0, gen, life: 26 + Math.random() * 24, spreadAt: 5 + Math.random() * 9, spread: false });
    this.burning.push(i);
    if (H.chimney !== undefined) this.chimneys.end(H.chimney, t);
    const n = 3 + (H.R > 7 ? 1 : 0) + (H.R > 10 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const a = Math.random() * 6.283, d = Math.random() * H.R * 0.45;
      this.flames.add(H.x + Math.cos(a) * d, H.y + H.H * (0.45 + Math.random() * 0.3), H.z + Math.sin(a) * d, H.R * (1.2 + Math.random() * 0.9), H.H * 0.7 + 8 + Math.random() * 10, t + k * 0.6, H.life + Math.random() * 6);
    }
    this.smoke.add(H.x, H.y + H.H * 0.7, H.z, H.R * (2.6 + Math.random() * 1.2), 60 + Math.random() * 50, t + 1.5, H.life * 1.7 + 25);
    this.scare(H.x, H.z, 75);
  }

  // where a townsperson is right now: walkers are carried along their beat by the shader, so follow the same sums here
  _where(q, t) {
    const i = q.i, A = q.A.array, B = q.B.array, C = q.C.array, F = q.F.array, fx = Math.sin(q.rot), fz = Math.cos(q.rot);
    let fwd = 0;
    if (F[i * 2 + 1] > 0) fwd = Math.min((t - F[i * 2]) * C[i * 2 + 1], B[i * 4 + 1]);
    else if (C[i * 2 + 1] > 0) {
      const back = B[i * 4], ahead = B[i * 4 + 1], P = back + ahead, dist = t * C[i * 2 + 1] + A[i * 4 + 3] * 2 * P, m = ((dist % (2 * P)) + 2 * P) % (2 * P);
      fwd = m < P ? m - back : ahead - (m - P);
    }
    return [q.x + fx * fwd * q.s, q.z + fz * fwd * q.s];
  }
  _place(q, x, z, rot) {
    q.x = x; q.z = z; q.rot = rot;
    _q.setFromAxisAngle(_up, rot); _m.compose(_p.set(x - q.ox, this.field.heightAt(x, z) - 0.04, z - q.oz), _q, _s.setScalar(q.s));
    q.mesh.setMatrixAt(q.i, _m); q.mesh.instanceMatrix.needsUpdate = true;
  }
  // everyone within r of a fire runs from it: straight away from it if the way is clear, or as near to that as it can
  scare(x, z, r) {
    const t = G.uTime.value, dirty = new Set();
    this._near(this.pgrid, x, z, r + 40, (k) => {
      const q = this.people[k]; if (q.running) return;
      const [px, pz] = this._where(q, t); if (Math.hypot(px - x, pz - z) > r) return;
      let ax = px - x, az = pz - z, al = Math.hypot(ax, az); if (al < 0.01) { ax = 1; az = 0; al = 1; } ax /= al; az /= al;
      const want = 22 + Math.random() * 14, g0 = this.field.heightAt(px, pz);
      let best = 0, bx = ax, bz = az;
      for (const turn of [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4]) {
        const c = Math.cos(turn), s = Math.sin(turn), dx = ax * c - az * s, dz = ax * s + az * c;
        let d = 0, g = g0;
        for (let u = 0.75; u <= want; u += 0.75) {
          const sx = px + dx * u, sz = pz + dz * u, gh = this.field.heightAt(sx, sz);
          if (gh < 0.9 || Math.abs(gh - g) > 0.6 || this.houseAt(sx, sz)) break;
          g = gh; d = u;
        }
        if (d > best + 2) { best = d; bx = dx; bz = dz; }
        if (best >= want - 1) break;
      }
      if (best < 2) return;                    // cornered: they stay where they are
      const speed = 4.2 + Math.random() * 1.8, rot = Math.atan2(bx, bz), an = q.an, i = q.i;
      this._place(q, px, pz, rot);
      const rise = this.field.heightAt(px + bx * best, pz + bz * best) - g0;
      q.A.array.set([an.row + an.clips.walk[0], an.clips.walk[1], 0, 0], i * 4);
      q.B.array.set([0, best / q.s, 0, rise / q.s], i * 4);
      q.C.array.set([an.stride, speed / q.s], i * 2);
      q.F.array.set([t, 1], i * 2);
      q.running = true; this.nFled++;
      this.running.push({ q, at: t + best / speed, x: px + bx * best, z: pz + bz * best, rot });
      dirty.add(q);
    });
    const meshes = new Set();
    for (const q of dirty) { q.A.needsUpdate = q.B.needsUpdate = q.C.needsUpdate = q.F.needsUpdate = true; meshes.add(q.mesh); }
    for (const m of meshes) { m.computeBoundingSphere(); m.boundingSphere.radius += 40; }
  }
  // a runner who has reached the end of the run stands there, catching their breath, and can be sent off again later
  _arrive(r) {
    const q = r.q, an = q.an, i = q.i, idle = an.clips.idle || an.clips.walk;
    this._place(q, r.x, r.z, r.rot);
    q.A.array.set([an.row + idle[0], idle[1], 1 / (idle[2] || 1), Math.random()], i * 4);
    q.B.array.set([0, 0, 0, 0], i * 4); q.C.array.set([an.stride, 0], i * 2); q.F.array.set([0, 0], i * 2);
    q.A.needsUpdate = q.B.needsUpdate = q.C.needsUpdate = q.F.needsUpdate = true;
    setTimeout(() => { q.running = false; }, 4000);
  }

  update(dt, camPos) {
    const t = G.uTime.value;
    for (let k = this.running.length - 1; k >= 0; k--) if (t >= this.running[k].at) { this._arrive(this.running[k]); this.running.splice(k, 1); }
    // sparks and firelight from the burning houses near the camera
    let lx = 0, ly = 0, lz = 0, lw = 0;
    for (const i of this.burning) {
      const H = this.houses[i], d = Math.hypot(H.x - camPos.x, H.z - camPos.z); if (d > 1200) continue;
      const k = Math.min(1, H.t / 4) * (1 - Math.min(1, Math.max(0, (H.t - H.life + 8) / 8))), w = k / (1 + d / 150);
      lx += H.x * w; ly += (H.y + H.H) * w; lz += H.z * w; lw += w;
      if (d < 700 && Math.random() < dt * 6 * k) this.fire._spawn(H.x + (Math.random() - 0.5) * H.R, H.y + H.H, H.z + (Math.random() - 0.5) * H.R, (Math.random() - 0.5) * 4 + this.lean.x * 20, 8 + Math.random() * 10, (Math.random() - 0.5) * 4 + this.lean.y * 20, 2 + Math.random() * 2, 0.35, 0.1, 3, 2, 0.4);
    }
    if (lw > 0.01) { this.light.position.set(lx / lw, ly / lw + 6, lz / lw); this.light.intensity = Math.min(1, lw) * 7000 * (0.85 + 0.15 * Math.sin(t * 13) * Math.sin(t * 7.7)); }
    else this.light.intensity = 0;
    // the fires themselves move on five times a second
    this.stepT += dt;
    if (this.stepT < 0.2 || !this.burning.length) return;
    const step = this.stepT; this.stepT = 0;
    const touched = new Set(), catching = [];
    for (let b = this.burning.length - 1; b >= 0; b--) {
      const i = this.burning[b], H = this.houses[i]; H.t += step;
      const done = H.t >= H.life;
      const burn = done ? 0 : Math.min(1, H.t / 4) * (1 - smooth(H.life - 8, H.life, H.t)), char = done ? 1 : Math.min(1, H.t / 16);
      H.attr.array[H.i * 2] = burn; H.attr.array[H.i * 2 + 1] = char; touched.add(H.attr);
      if (!H.spread && H.t > H.spreadAt) {
        H.spread = true;
        if (H.gen < 3) this._near(this.hgrid, H.x, H.z, H.R + 16, (j) => { const N = this.houses[j]; if (N.state === 0 && Math.hypot(H.x - N.x, H.z - N.z) < H.R + N.R + 2.5 && Math.random() < 0.6 - H.gen * 0.17) catching.push([j, H.gen + 1]); });
      }
      if (done) { H.state = 2; this.nBurnt++; this.burning.splice(b, 1); }
    }
    for (const a of touched) a.needsUpdate = true;
    for (const [j, gen] of catching) this.ignite(j, gen);
  }
  // 0..1: how much of a town is on fire around p (for the sound)
  blaze(p) { let s = 0; for (const i of this.burning) { const H = this.houses[i]; s += Math.max(0, 1 - Math.hypot(p.x - H.x, p.y - H.y, p.z - H.z) / 380); } return Math.min(1, s / 5); }
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
