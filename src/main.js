import * as THREE from 'three';
import { G } from './core/glsl.js';
import { makeDetailData, makeDetailTexture } from './core/noise.js';
import { buildHeightField } from './world/heightmap.js';
import { Terrain } from './world/terrain.js';
import { Grass } from './world/grass.js';
import { loadGroundTextures } from './world/groundtex.js';
import { Sky } from './world/sky.js';
import { Clouds } from './world/clouds.js';
import { Trees, loadImpostors } from './world/trees.js';
import { Landmarks } from './world/landmarks.js';
import { loadTidalCoast, landingSurface, CoastReflection } from './world/tidalcoast.js';
import { Rocks, loadCliffKit, loadScrubKit, loadHeadland, loadTalusKit } from './world/rocks.js';
import { loadHouseKit, HouseDetail } from './world/castlekit.js';
import { PostFX } from './fx/post.js';
import { Fire } from './fx/fire.js';
import { CityFire } from './fx/cityfire.js';
import { LANDMARKS, MAP, toWorld } from './world/mapdata.js';
import { Dragon, createDragon, loadDragonSkins, loadDragonModels, loadRiggedDragons } from './dragon/dragon.js';
import { buildRider, loadKnight } from './dragon/rider.js';
import { DRAGONS, RIDERS } from './game/roster.js';
import { Input } from './game/input.js';
import { Flight, ChaseCamera, dirFrom } from './game/flight.js';
import { GameAudio } from './game/audio.js';
import { UI } from './ui/ui.js';

const canvas = document.getElementById('game');
const loadFill = document.getElementById('load-fill'), loadText = document.getElementById('load-text');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function progress(p, text) { loadFill.style.width = (p * 100).toFixed(0) + '%'; if (text) loadText.textContent = text; await sleep(30); }

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;   // the post pipeline does the encoding
renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setPixelRatio(1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, 1, 1.2, 120000);

// Graphics presets. q: the render scale it starts at; floor: the lowest the resolution governor may take it; fps: the frame
// rate the governor defends (0: never lowered); maxH: most lines rendered. High, the default, keeps the picture sharp and
// settles for ~45 fps rather than blurring it to hold 60; Ultra renders at the screen's own resolution whatever it costs.
const GFX = {
  low: { q: 0.6, floor: 0.45, fps: 60, maxH: 1300 },
  medium: { q: 0.85, floor: 0.6, fps: 60, maxH: 1640 },
  high: { q: 1, floor: 0.82, fps: 45, maxH: 1640 },
  ultra: { q: 1, floor: 1, fps: 0, maxH: 4000 },
};
let gfx = 'high'; try { gfx = GFX[localStorage.getItem('dr.gfx')] ? localStorage.getItem('dr.gfx') : 'high'; } catch (e) { /* storage blocked: default */ }
const saved = JSON.parse(localStorage.getItem('dr.sel') || 'null');
const game = {
  renderer, scene, camera, G, state: 'loading', time: 0, quality: GFX[gfx].q, gfx, GFX, free: false,
  sel: saved && DRAGONS.some(d => d.id === saved.dragon) && RIDERS.some(r => r.id === saved.rider) ? saved : { dragon: 'drogon', rider: 'daenerys' },
  frameTimes: new Float32Array(240), frameIdx: 0, menuT: 0,
};
window.game = game;

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = window.innerWidth * dpr, h = window.innerHeight * dpr;
  const maxH = GFX[game.gfx].maxH; if (h > maxH) { w *= maxH / h; h = maxH; }      // a Retina laptop's full screen is ~1960 lines
  w = Math.floor(w * game.quality); h = Math.floor(h * game.quality);
  renderer.setSize(w, h, false);
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  if (game.post) game.post.setSize(w, h);
}
window.addEventListener('resize', resize);
game.setQuality = (q) => { game.quality = q; game.clouds.mat.uniforms.uSteps.value = q < 0.7 ? 44 : q < 0.9 ? 60 : 84; resize(); };
game.setGraphics = (name) => {
  if (!GFX[name]) return; game.gfx = name; try { localStorage.setItem('dr.gfx', name); } catch (e) { /* not remembered */ }
  game.setQuality(GFX[name].q);
};
// what is actually being drawn, for the pause menu
game.renderInfo = () => { const c = renderer.domElement, sh = Math.round(window.innerHeight * Math.min(window.devicePixelRatio || 1, 2)); return { w: c.width, h: c.height, pct: Math.round(c.height / sh * 100) }; };

const _tips = [new THREE.Vector3(), new THREE.Vector3()];
// ------------------------------------------------------------ dragon + rider
game.spawn = (dragonId = game.sel.dragon, riderId = game.sel.rider) => {
  if (game.dragon) scene.remove(game.dragon.group);
  const def = DRAGONS.find(q => q.id === dragonId), rdef = RIDERS.find(q => q.id === riderId);
  const d = createDragon(def); game.dragon = d;
  d.surfaceAt = (x, z) => game.field.surfaceAt(x, z);      // so a rigged dragon can set its feet on the ground
  const r = buildRider(rdef, d.saddleRadius * def.scale); game.rider = r;
  r.group.scale.setScalar(1 / def.scale); d.bones.saddle.add(r.group);
  scene.add(d.group);
  game.flight.setDragon(def, d.standHeight, !!d.rigged);
  if (game.fire) game.fire.setDragon(def);
  game.sel.dragon = dragonId; game.sel.rider = riderId;
  localStorage.setItem('dr.sel', JSON.stringify(game.sel));
  return d;
};
game.selectCharacter = (dragonId, riderId) => {
  const fl = game.flight; const keep = { x: fl.pos.x, z: fl.pos.z, yaw: fl.yaw };
  game.spawn(dragonId, riderId);
  fl.place(keep.x, keep.z, keep.yaw, 0); fl.applyTo(game.dragon.group);
  game.dragon.pose.landed = 1;
};
game.teleport = (id, air = 0, yaw) => {
  const lm = LANDMARKS.find(l => l.id === id); const [x, z] = toWorld(lm.pos[0], lm.pos[1]);
  game.flight.place(x + (lm.r || 300) * 1.4, z + 200, yaw ?? -Math.PI / 2, air);
  game.flight.applyTo(game.dragon.group); game.chase.snap(game.flight);
};
// the menu perch: on the cleared headland beside Dragonstone castle, facing out to sea
game.perch = () => {
  const lm = LANDMARKS.find(l => l.id === 'dragonstone'); const [x, z] = toWorld(lm.pos[0], lm.pos[1]);
  game.flight.place(x + 178, z + 72, Math.atan2(178, -72), 0);
  game.flight.applyTo(game.dragon.group); game.chase.snap(game.flight);
};
game.fastTravel = (id) => {
  const lm = LANDMARKS.find(l => l.id === id); const [x, z] = toWorld(lm.pos[0], lm.pos[1]);
  // arrive from the south-west, a couple of kilometres out, already on the wing
  const a = -2.2, d = (lm.r || 300) + 1700;
  const px = x + Math.cos(a) * d * -1, pz = z + Math.sin(a) * d * -1;
  const yaw = Math.atan2(x - px, -(z - pz));
  const alt = Math.max(260, game.field.surfaceAt(x, z) - game.field.surfaceAt(px, pz) + 320);
  game.flight.place(px, pz, yaw, alt);
  game.flight.applyTo(game.dragon.group); game.dragon.pose.landed = 0; game.chase.snap(game.flight);
  game.post.finalMat.uniforms.uFade.value = 0;
  game.setState('playing');
};
game.startFlight = () => {
  if (!game.audio) { try { game.audio = new GameAudio(); } catch (e) { console.warn('audio unavailable', e); } }
  if (game.audio) game.audio.resume();
  game.chase.snap(game.flight);
  game.setState('playing');
  game.ui.hint('Hold W to take wing');
  if (game.audio) setTimeout(() => game.audio.roar(1), 500);
};
game.setState = (s) => {
  const prev = game.state; game.state = s;
  document.body.classList.toggle('photo', s === 'photo');
  game.input.enabled = (s === 'playing' || s === 'photo');
  if (s !== 'playing' && s !== 'photo') game.input.releaseLock();
  if (s === 'menu') { game.perch(); game.dragon.pose.landed = 1; }
  if (s === 'playing' && prev === 'photo') { game.chase.orbit = 0; game.chase.orbitPitch = 0; }
  game.ui.show(s);
  if (s === 'paused' && game.ui.refreshGfx) game.ui.refreshGfx();
};
const _a = new THREE.Vector3();
// the reticle: where the breath will land if the aim ray strikes something within reach, else far along the aim
game.aimScreen = () => {
  const fl = game.flight;
  if (game.aimHit) _a.copy(game.aimPoint); else dirFrom(fl.aimYaw, fl.aimPitch, _a).multiplyScalar(600).add(fl.pos);
  _a.project(camera);
  if (_a.z > 1) return null;
  return { x: (_a.x * 0.5 + 0.5) * window.innerWidth, y: (-_a.y * 0.5 + 0.5) * window.innerHeight, hit: game.aimHit };
};
// Dragonfire goes where the rider aims. Find what the aim ray strikes within the breath's reach (ground or a roof), then point the jet from the mouth so its falling arc (fire.js drops it 0.0012·s² m) lands on that spot. The heads
// alone are no guide: the rigged Drogon's snout points ~75° down and swings with the flight animation.
game.aimPoint = new THREE.Vector3(); game.aimHit = false;
const _ad = new THREE.Vector3();
function aimBreath(fl, mouth, out) {
  dirFrom(fl.aimYaw, fl.aimPitch, _ad);
  const reach = 140 * Math.sqrt(game.fire.power) * 0.95; let s = reach, hit = false;
  for (let d = 10; d <= reach; d += 4) {
    const x = fl.pos.x + _ad.x * d, y = fl.pos.y + _ad.y * d, z = fl.pos.z + _ad.z * d;
    if (y < Math.max(game.field.heightAt(x, z), 0) + 1 || (game.fire.obstacle && y < game.fire.obstacle(x, y, z))) { s = d; hit = true; break; }
  }
  game.aimHit = hit; game.aimPoint.copy(fl.pos).addScaledVector(_ad, s);
  out.subVectors(game.aimPoint, mouth); let L = out.length();
  for (let k = 0; k < 2; k++) { out.subVectors(game.aimPoint, mouth); out.y += 0.0012 * L * L; L = out.length(); }
  return out.normalize();
}

async function init() {
  await progress(0.05, 'Charting the coasts…');
  const detail = makeDetailData();
  const detailTex = makeDetailTexture(detail);
  await progress(0.2, 'Raising mountains…');
  const field = buildHeightField(renderer, detail);
  game.field = field;
  await progress(0.5, 'Kindling the sun…');
  game.sky = new Sky(renderer, scene);
  const ground = await loadGroundTextures();
  game.terrain = new Terrain(field, detailTex, ground);
  scene.add(game.terrain.group);
  game.grass = new Grass(scene, game.terrain);
  await progress(0.58, 'Raising castles…');
  await loadHouseKit();
  await Promise.all([loadDragonSkins(DRAGONS.map(d => d.id)), loadDragonModels(DRAGONS.map(d => d.id)), loadRiggedDragons(), loadKnight()]);
  game.landmarks = new Landmarks(field);
  game.terrain.setPaving(game.landmarks.pavingMap(MAP.W, MAP.H).tex);
  scene.add(game.landmarks.group);
  game.houseDetail = new HouseDetail(scene, game.landmarks);
  game.trees = new Trees(field, game.terrain.scorch, game.landmarks.sites.flatMap(s => [{ x: s.x, z: s.z, r: s.lm.r * 1.05 }, ...(s.clearings || [])]), ground);
  game.trees.paveAt = game.landmarks.paveAt;
  game.terrain.shared.uCanopy.value = game.trees.canopyTex;      // the ground under the forest is shaded from the trees' canopy map,
  game.trees.onOcta = (on) => { game.terrain.shared.uCanopyK.value = on ? 1 : 0; };      // along with the new trees (game.trees.setOcta)
  const impostors = await loadImpostors();
  const nearTreesReady = impostors && game.trees.setImpostors(impostors);
  scene.add(game.trees.group);
  // broken limestone on King's Landing's headland, sea cliffs and rocky shore (never on its streets or squares)
  {
    const kl = game.landmarks.sites.find(s => s.lm.id === 'kingslanding');
    // clear of the Red Keep's cliff curtain (a rounded square on the seaward arc; see landmarks.js)
    const avoid = (x, z) => kl.avoid.some(A => {
      const a = Math.atan2(z - A.z, x - A.x); if (a < A.a0 - 0.15 || a > A.a1 + 0.15) return false;
      const d = Math.hypot(x - A.x, z - A.z), r = A.R / Math.pow(Math.pow(Math.abs(Math.cos(a)), 2.4) + Math.pow(Math.abs(Math.sin(a)), 2.4), 1 / 2.4);
      return d > r - A.band - 6 && d < r + 4;      // nothing inside or through the wall; outside, the rock may pile against its foot
    });
    const [scrubKit, headland, talusKit, rubbleKit, coast] = await Promise.all([loadScrubKit(), loadHeadland(), loadTalusKit(), loadTalusKit('rubble'), loadTidalCoast()]);
    if (kl && headland) {
      // The Blender cliff follows the curtain down to the scanned tidal ledges.
      const [hx, hz] = headland.centre;
      game.sky.bayCentre=headland.centre;
      game.rocks = new Rocks(scene, field, [{ x: kl.x + 300, z: kl.z + 200, r: 2800, step: 11 }], (x, z) => game.landmarks.paveAt(x, z) > 0.3 || Math.hypot(x - hx, z - hz) < 340, null, scrubKit);
      const tidalHeight = landingSurface(coast, headland.centre);
      game.rocks.addHeadland(scene, headland, talusKit, rubbleKit, tidalHeight, coast);
      for (const { mesh, hi, lo } of coast) {
        mesh.position.set(hx, 0, hz);
        game.rocks.group.add(mesh);
        mesh.userData = { hi, lo, near: 245, c: hi.boundingSphere.center.clone().add(mesh.position) };
        game.rocks.lodMeshes.push(mesh);
      }
      const cliffPatches = headland.parts.filter(part => part.patch);
      if (coast.length || cliffPatches.length) {
        const blackwaterSurface = landingSurface([...cliffPatches, ...coast], headland.centre);
        field.rockSurface = blackwaterSurface;
        game.coastReflection = new CoastReflection(headland.centre, headland, coast, game.terrain.shared);
        const island = game.landmarks.sites.find(s => s.lm.id === 'dragonstone');
        const inlet = cliffPatches.filter(part => part.name.startsWith('Cove_'));
        if (island && inlet.length) {
          // The inlet sits at (+160,+173) in the Blender headland frame.
          // Its back meets the island's north shore 200 m east and 600 m north of the keep.
          const origin = [island.x + 200 - 160, island.z - 600 - 173];
          const placement = new THREE.Matrix4().makeTranslation(origin[0], 0, origin[1]);
          for (const part of inlet) game.rocks.addCliffPart(part, placement, 'dragonstone_' + part.name);
          const islandSurface = landingSurface(inlet, origin);
          field.rockSurface = (x, z) => Math.max(blackwaterSurface(x, z), islandSurface(x, z));
          game.coastReflection.addSite(origin, inlet);
        }
      }
    } else if (kl) game.rocks = new Rocks(scene, field, [{ clad: true, avoid, x: kl.x + 925, z: kl.z + 400, r0: 95, r1: 300 }, { x: kl.x + 925, z: kl.z + 400, r: 560, step: 6 }, { x: kl.x + 300, z: kl.z + 200, r: 2800, step: 11 }], (x, z) => game.landmarks.paveAt(x, z) > 0.3, await loadCliffKit(), scrubKit);
  }
  await nearTreesReady;
  await progress(0.68, 'Gathering clouds…');
  game.post = new PostFX(renderer);
  game.clouds = new Clouds(renderer);
  game.post.clouds = game.clouds;
  await progress(0.8, 'Waking the dragons…');
  game.input = new Input(canvas);
  game.flight = new Flight(field);
  game.chase = new ChaseCamera(camera, field);
  game.fire = new Fire(scene, field, game.terrain);
  // towns burn: the breath stops at rooftops, heats the houses it lands on, and the townsfolk run
  game.city = new CityFire(scene, game.landmarks, field, game.fire);
  game.fire.obstacle = (x, y, z) => game.city.roofAt(x, y, z);
  game.fire.onHit = (x, y, z, r) => game.city.heat(x, y, z, r);
  // Dragonmont's smoke and the Hightower's beacon
  const ds = game.landmarks.sites.find(s => s.lm.id === 'dragonstone');
  game.fire.plumes.push({ pos: new THREE.Vector3(ds.x + 980, field.surfaceAt(ds.x + 980, ds.z + 560) + 10, ds.z + 560), rate: 22, size: 11, life: 26, kind: 1 });      // many small puffs: a column, not a few huge dark discs that read as a balloon
  const ot = game.landmarks.sites.find(s => s.lm.id === 'oldtown');
  if (ot && ot.beacon) game.fire.plumes.push({ pos: ot.beacon.clone(), rate: 16, size: 5, life: 1.4, kind: 0 });
  // (hearth smoke over towns is drawn by CityFire's chimney strips; the old dark particle plumes read as floating blobs)
  game.spawn();
  game.perch();
  await progress(0.92, 'Drawing the maps…');
  game.ui = new UI(game);
  resize();
  await progress(1.0, 'Ready');
  document.getElementById('loading').classList.add('hide');
  setTimeout(() => { document.getElementById('loading').style.display = 'none'; }, 1400);
  game.setState('menu');
  renderer.setAnimationLoop(frame);
}
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && game.state === 'playing' && game._hadLock) game.setState('paused');
  game._hadLock = !!document.pointerLockElement;
});

// ---- debug helpers
const dbg = { yaw: 0, pitch: -0.2, speed: 400 };
game.dbg = dbg;
// set houses alight around (x, z) without aiming (world metres); returns how many caught
game.ignite = (x, z, r = 20) => game.city.heat(x, game.field.heightAt(x, z) + 4, z, r, 5);
game.cam = (x, y, z, yaw, pitch) => { game.free = true; camera.position.set(x, y, z); if (yaw !== undefined) dbg.yaw = yaw; if (pitch !== undefined) dbg.pitch = pitch; };
// dev: write each dragon's body shapes, weights and bones to public/impostors/rig_<id>.json for tools/blender/dragon.py
game.exportDragonRigs = async (ids) => {
  const out = [];
  for (const def of DRAGONS) {
    if (ids && !ids.includes(def.id)) continue;
    Dragon.exportMode = true; let d; try { d = new Dragon(def); } finally { Dragon.exportMode = false; }
    const r = await fetch(`/__save?name=rig_${def.id}.json`, { method: 'POST', body: JSON.stringify(d.exportData) }); out.push(def.id + ':' + r.status + ':' + d.exportData.parts.length);
  }
  return out;
};
// free camera at (x, y, z) looking at (tx, ty, tz); with `site`, coordinates are metres from that landmark's centre
game.look = (x, y, z, tx, ty, tz, site) => {
  if (site) { const lm = LANDMARKS.find(l => l.id === site); const [ox, oz] = toWorld(lm.pos[0], lm.pos[1]); x += ox; tx += ox; z += oz; tz += oz; }
  game.free = true; camera.position.set(x, y, z); dbg.yaw = Math.atan2(x - tx, z - tz); dbg.pitch = -Math.atan2(y - ty, Math.hypot(x - tx, z - tz));
};
game.goto = (id, dist = 1500, alt = 500, yaw = 0) => {
  const lm = LANDMARKS.find(l => l.id === id); const [x, z] = toWorld(lm.pos[0], lm.pos[1]);
  game.free = true;
  camera.position.set(x + Math.sin(yaw) * dist, game.field.surfaceAt(x, z) + alt, z + Math.cos(yaw) * dist);
  dbg.yaw = yaw; dbg.pitch = -Math.atan2(alt * 0.8, dist);
};
game.viewDragon = (az = 0.6, el = 0.25, dist = 60, fov = 50) => {
  const p = game.dragon.group.position; game.free = true;
  camera.position.set(p.x + Math.sin(az) * Math.cos(el) * dist, p.y + Math.sin(el) * dist, p.z + Math.cos(az) * Math.cos(el) * dist);
  dbg.yaw = az; dbg.pitch = -el; camera.fov = fov; camera.updateProjectionMatrix();
};
// close-up on a bone ('head', 'saddle', 'chest', 'hip', 'handL', 'footL', 'tail5' ...)
game.viewBone = (name, az = 0.6, el = 0.15, dist = 8, fov = 40) => {
  const b = game.dragon.bones; game.dragon.group.updateMatrixWorld(true);
  const bone = name === 'handL' ? b.wing.L.hand : name === 'footL' ? b.leg.L.foot : name.startsWith('tail') ? b.tail[+name.slice(4)] : name.startsWith('neck') ? b.neck[+name.slice(4)] : b[name];
  const p = new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld); game.free = true;
  camera.position.set(p.x + Math.sin(az) * Math.cos(el) * dist, p.y + Math.sin(el) * dist, p.z + Math.cos(az) * Math.cos(el) * dist);
  dbg.yaw = az; dbg.pitch = -el; camera.fov = fov; camera.updateProjectionMatrix();
};
game.bench = (n = 30) => {
  const gl = renderer.getContext(); const px = new Uint8Array(4);
  render(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const t0 = performance.now();
  for (let i = 0; i < n; i++) { update(1 / 60); render(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
  const ms = (performance.now() - t0) / n;
  return { msPerFrame: +ms.toFixed(2), fps: +(1000 / ms).toFixed(1), res: [game.post.w, game.post.h], calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
};
// dev: render a frame and save it as .shots/<name>.jpg (works with the preview pane hidden)
game.capture = async (name = 'shot') => {
  render(); const url = renderer.domElement.toDataURL('image/jpeg', 0.9);
  const blob = await (await fetch(url)).blob();
  return (await fetch(`/__shot?name=${name}.jpg`, { method: 'POST', body: blob })).status;
};
game.lookdev = () => import('./tools/lookdev.js');
// draw = false skips the render, for long scripted runs
game.step = (seconds = 1, keys = [], hz = 60, draw = true) => {
  for (const k of keys) game.input.keys.add(k);
  const n = Math.round(seconds * hz);
  for (let i = 0; i < n; i++) update(1 / hz);
  for (const k of keys) game.input.keys.delete(k);
  if (draw) render();
  const f = game.flight;
  return { state: game.state, mode: f.mode, speed: +f.speed.toFixed(1), agl: +f.agl.toFixed(1), pos: f.pos.toArray().map(v => Math.round(v)), yaw: +f.yaw.toFixed(2), pitch: +f.pitch.toFixed(2) };
};

let last = performance.now();
let govT = 0, govN = 0, govSlow = 0, govFast = 0, govCap = 1, govCapT = 0, sdt = 16.7;
function frame() {
  const now = performance.now(); const rawDt = now - last; last = now;
  game.frameTimes[game.frameIdx++ % 240] = rawDt;
  // resolution governor: defend the preset's frame rate. Missing it for a couple of seconds lowers the render scale a notch
  // (never below the preset's floor); a long clean run tries a notch higher again, and a notch that failed is not retried
  // for a minute. Ultra has no governor.
  const P = GFX[game.gfx];
  if (P.fps && rawDt < 250 && document.visibilityState === 'visible') {
    govT += rawDt; govN++; govCapT = Math.max(0, govCapT - rawDt);
    if (govT > 1200) {
      const avg = govT / govN, budget = 1000 / P.fps; govT = 0; govN = 0;
      govSlow = avg > budget * 1.07 ? govSlow + 1 : 0; govFast = avg < budget * 1.03 ? govFast + 1 : 0;
      if (govSlow >= 2 && game.quality > P.floor + 0.001) { govSlow = 0; govFast = 0; govCap = game.quality; govCapT = 60000; game.setQuality(Math.max(P.floor, +(game.quality - (avg > budget * 1.4 ? 0.1 : 0.05)).toFixed(2))); console.info('[quality] render scale', game.quality); }
      else if (govFast >= 12 && game.quality < P.q && (govCapT <= 0 || game.quality + 0.05 < govCap - 0.001)) { govFast = 0; game.setQuality(Math.min(P.q, +(game.quality + 0.05).toFixed(2))); console.info('[quality] render scale', game.quality); }
    }
  }
  // animation runs on a lightly smoothed frame time, so an uneven frame does not show up as a twitch
  sdt += (Math.min(rawDt, 50) - sdt) * 0.3;
  update(Math.min(0.05, sdt / 1000));
  render();
}

const _shadowAt = new THREE.Vector3();
const _mouth = new THREE.Vector3(), _mdir = new THREE.Vector3(), _zero = new THREE.Vector3(), _sun = new THREE.Vector3(), _fwd = new THREE.Vector3();
function update(dt) {
  game.time += dt; G.uTime.value = game.time;
  const input = game.input, fl = game.flight, ui = game.ui;
  const inp = input.poll();
  // ---- global keys
  if (input.hit('Escape')) { if (game.state === 'playing') game.setState('paused'); else if (game.state === 'paused' || game.state === 'map' || game.state === 'photo') game.setState('playing'); }
  if (input.hit('KeyM')) { if (game.state === 'playing') game.setState('map'); else if (game.state === 'map') game.setState('playing'); }
  if (input.hit('KeyP')) { if (game.state === 'playing') game.setState('photo'); else if (game.state === 'photo') game.setState('playing'); }
  if ((game.state === 'playing' || game.state === 'photo') && input.hit('KeyT')) game.sky.setTime(game.sky.time + 1.5);

  let firing = false;
  if (game.free) {
    const k = input.keys; const rot = 1.2 * dt;
    if (k.has('ArrowLeft')) dbg.yaw += rot; if (k.has('ArrowRight')) dbg.yaw -= rot;
    if (k.has('ArrowUp')) dbg.pitch += rot; if (k.has('ArrowDown')) dbg.pitch -= rot;
    camera.rotation.set(dbg.pitch, dbg.yaw, 0, 'YXZ');
    const fwd = new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation), right = new THREE.Vector3(1, 0, 0).applyEuler(camera.rotation);
    const sp = dbg.speed * (k.has('ShiftLeft') ? 6 : 1) * dt;
    if (k.has('KeyW')) camera.position.addScaledVector(fwd, sp); if (k.has('KeyS')) camera.position.addScaledVector(fwd, -sp);
    if (k.has('KeyD')) camera.position.addScaledVector(right, sp); if (k.has('KeyA')) camera.position.addScaledVector(right, -sp);
    camera.updateMatrixWorld();
    game.dragon.update(dt, game.animOverride || fl.anim);
  } else if (game.state === 'playing') {
    fl.update(dt, inp);
    fl.applyTo(game.dragon.group);
    firing = fl.firing;
    game.dragon.update(dt, fl.anim);
    game.rider.setWind(Math.min(1, fl.speed / 60));
    game.rider.pose(fl.roll, fl.mode === 'fly' ? Math.min(1, fl.speed / 80) : 0, fl.anim.lookYaw, fl.anim.lookPitch, game.dragon.pose.landed);
    if (input.hit('KeyC')) { game.chase.cycle(); ui.hint({ chase: 'Camera: chase', close: 'Camera: over the shoulder', wide: 'Camera: wide' }[game.chase.modeName]); clearTimeout(game._camT); game._camT = setTimeout(() => ui.hint(''), 1500); }
    if (input.hit('KeyR')) { if (game.audio) game.audio.roar(1); fl.shake = Math.max(fl.shake, 0.35); game.roarT = 1.4; if (game.dragon.roar) game.dragon.roar(); }
    if (input.hit('KeyH')) document.getElementById('help').classList.toggle('off');
    game.roarT = Math.max(0, (game.roarT || 0) - dt); if (game.roarT > 0) fl.anim.mouth = Math.max(fl.anim.mouth, 0.8);
    game.chase.update(dt, fl, inp);
    for (const ev of fl.events) {
      if (ev === 'takeoff') {
        ui.hint('Move the mouse to look and steer · ↑ ↓ climb and dive');
        clearTimeout(game._hintT); game._hintT = setTimeout(() => { if (fl.mode === 'fly') ui.hint(''); }, 7000);
        if (game.audio) game.audio.thud(0.5);
      }
      if (ev === 'land') { ui.hint('Hold W to take wing'); if (game.audio) game.audio.thud(1); }
      if ((ev === 'scrape' || ev === 'splash') && game.audio) game.audio.thud(0.8);
      if (ev === 'splash') game.fire.splash(fl.pos.x, Math.max(0, game.field.heightAt(fl.pos.x, fl.pos.z)), fl.pos.z, fl.vel, 1.2);
      if (ev === 'skim') game.fire.splash(fl.pos.x, Math.max(0, game.field.heightAt(fl.pos.x, fl.pos.z)), fl.pos.z, fl.vel, 0.35);
      if (ev === 'boost' && game.audio && Math.random() < 0.5) game.audio.roar(0.6);
    }
    fl.events.length = 0;
    // ---- low over water: the wing tips cut the surface and throw spray, and the downwash rings the water beneath
    {
      const p = fl.pos, overWater = fl.mode === 'fly' && game.field.isWater(p.x, p.z), wy = Math.max(0, game.field.heightAt(p.x, p.z));
      const low = overWater ? THREE.MathUtils.clamp(1 - (p.y - wy) / (26 * game.dragon.def.scale), 0, 1) : 0;
      G.uWake.value.set(p.x, p.z, 34 * game.dragon.def.scale, G.uWake.value.w + (low * (0.35 + 0.65 * game.dragon.pose.flap) - G.uWake.value.w) * Math.min(1, dt * 3));
      if (overWater && game.dragon.wingTips) {
        const tips = game.dragon.wingTips(_tips);
        for (let s = 0; s < 2; s++) {
          const t = tips[s]; if (!game.field.isWater(t.x, t.z)) continue;
          const ty = Math.max(0, game.field.heightAt(t.x, t.z)), dip = ty + 0.8 - t.y;
          if (dip > 0) { game.fire.spray(t.x, ty, t.z, fl.vel, Math.min(1, dip / 3), dt); if (game.audio && dip > 0.6 && (game._sprayS || 0) <= 0) { game.audio.thud(0.18); game._sprayS = 0.5; } }
        }
        game._sprayS = Math.max(0, (game._sprayS || 0) - dt);
      }
    }
    ui.updateHud(dt);
  } else if (game.state === 'photo') {
    // frozen moment: orbit the camera freely
    game.chase.orbit += inp.mx + (inp.turn + inp.lookX) * dt; game.chase.orbitPitch = Math.max(-1, Math.min(1, game.chase.orbitPitch - inp.my + (inp.pitch - inp.lookY) * dt));
    game.chase.update(dt * 3, fl, inp);
  } else if (game.state === 'menu') {
    // the dragon waits on Dragonstone while the camera circles
    game.menuT += dt;
    fl.update(dt, { mx: 0, my: 0, turn: 0, pitch: 0, throttle: 0, boost: false, fire: false, wheel: 0 });
    fl.applyTo(game.dragon.group);
    fl.anim.lookYaw = Math.sin(game.menuT * 0.3) * 0.5; fl.anim.lookPitch = 0.1 + Math.sin(game.menuT * 0.21) * 0.12;
    game.dragon.update(dt, fl.anim); game.rider.setWind(0.18);
    game.rider.pose(0, 0, Math.sin(game.menuT * 0.23) * 0.5, Math.sin(game.menuT * 0.17) * 0.15, 1);
    const s = fl.scale, a = fl.yaw + 0.62 + Math.sin(game.menuT * 0.07) * 0.5, R = 31 * Math.pow(s, 0.85);
    camera.position.set(fl.pos.x + Math.sin(a) * R, fl.pos.y - 0.6 * s + Math.sin(game.menuT * 0.11) * 1.5, fl.pos.z - Math.cos(a) * R);
    const gy = game.field.surfaceAt(camera.position.x, camera.position.z) + 2.2; if (camera.position.y < gy) camera.position.y = gy;
    camera.up.set(0, 1, 0); camera.lookAt(fl.pos.x, fl.pos.y + 1.6 * s, fl.pos.z);
    if (camera.fov !== 40) { camera.fov = 40; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
  }
  // ---- world systems
  const paused = game.state === 'paused' || game.state === 'map' || game.state === 'photo';
  if (!paused) {
    game.dragon.group.updateMatrixWorld(true);
    game.dragon.getMouth(_mouth, _mdir);
    if (game.state === 'playing' && !game.free) aimBreath(fl, _mouth, _mdir); else game.aimHit = false;
    game.fire.update(dt, firing, _mouth, _mdir, game.state === 'playing' ? fl.vel : _zero, camera.position);
    game.city.update(dt, camera.position);
    G.uWind.value.x += dt * 14; G.uWind.value.y += dt * 5;
  }
  game.sky.paused = paused || game.state === 'menu' || game.sky.locked;
  // sun shadows cover what the camera looks at: a box centred ~520 m ahead of it (the dragon, just in front, is inside it)
  camera.getWorldDirection(_fwd); { const l = Math.hypot(_fwd.x, _fwd.z) || 1; _shadowAt.set(camera.position.x + _fwd.x / l * 520, 0, camera.position.z + _fwd.z / l * 520); _shadowAt.y = game.field.surfaceAt(_shadowAt.x, _shadowAt.z); }
  game.sky.update(dt, _shadowAt);
  game.field.bakeShadow(G.uSunDir.value);
  game.terrain.update(camera.position);
  game.grass.update(camera.position, camera.position.y - game.field.surfaceAt(camera.position.x, camera.position.z));
  game.trees.update(camera.position, camera);
  if (game.rocks) game.rocks.update(camera.position);
  game.landmarks.update(camera.position);
  game.houseDetail.update(camera.position, dt);
  if (game.audio) game.audio.update(dt, { playing: game.state === 'playing', speed: game.state === 'playing' ? fl.speed : 4, fire: Math.max(game.fire.intensity, game.city.blaze(game.dragon.group.position) * 0.45), flap: game.state === 'playing' ? game.dragon.pose.flap : 0, phase: game.dragon.phase, scale: fl.scale });
  const f = game.post.finalMat.uniforms;
  f.uExposure.value += (game.sky.exposure - f.uExposure.value) * Math.min(1, dt * 2.5);
  f.uFade.value = Math.min(1, f.uFade.value + dt * 1.2);
  // where is the sun on screen? (drives the light shafts and lens veil)
  const sunD = G.uTrueSunDir.value;
  _sun.copy(camera.position).addScaledVector(sunD, 1e4).project(camera);
  camera.getWorldDirection(_fwd);
  const facing = Math.max(0, Math.min(1, _fwd.dot(sunD) * 1.6));
  const off = Math.max(Math.abs(_sun.x), Math.abs(_sun.y));
  const up = Math.max(0, Math.min(1, (sunD.y + 0.05) / 0.08));
  f.uSunVis.value = _sun.z < 1 ? facing * up * (1 - Math.max(0, Math.min(1, (off - 0.98) / 0.3))) : 0;
  f.uSunScreen.value.set(_sun.x * 0.5 + 0.5, _sun.y * 0.5 + 0.5);
  f.uSunTint.value.copy(game.sky.domeMat.uniforms.uSunDisc.value);
  f.uShaftThr.value = 1.15 / game.sky.exposure;
  const spd = game.state === 'playing' && fl.mode === 'fly' ? Math.max(0, Math.min(1, (fl.speed - 45) / 90)) : 0;
  f.uSpeed.value += (spd - f.uSpeed.value) * Math.min(1, dt * 3);
  f.uSaturation.value = 1.08 - 0.34 * game.sky.night;       // moonlit nights are cooler and less saturated
  input.endFrame();
}
function render() {
  game.coastReflection?.render(renderer, camera, game.time);
  game.post.render(scene, camera, game.time);
}

init().catch(err => { console.error(err); loadText.textContent = 'Error: ' + err.message; });
