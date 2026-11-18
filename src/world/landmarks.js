// The castles and cities of Westeros, assembled from the kit.
import * as THREE from 'three';
import { LANDMARKS, VILLAGES, WALL, toWorld, regionAt, inRegion } from './mapdata.js';
import { Kit, C, shade, kitMaterials, upgradeKitTextures } from './castlekit.js';
import { planCity } from './cityplan.js';
import { livenCity } from './cityprops.js';
import { G, patchAtmosphere } from '../core/glsl.js';
import { smoothLine } from './heightmap.js';

const SLATE = C('#3d444e'), DARKSLATE = C('#2a2e36'), TERRA = C('#b4552e'), THATCH = C('#7a6a48'), SNOWROOF = C('#c9d0d8');
const TAU = Math.PI * 2;

// direction (radians, atan2(z, x)) toward the nearest open water around a site
function seaDir(k, r) { let best = 0, bh = 1e9; for (let i = 0; i < 24; i++) { const a = (i / 24) * TAU; const h = k.g(Math.cos(a) * r, Math.sin(a) * r) + k.g(Math.cos(a) * r * 1.5, Math.sin(a) * r * 1.5); if (h < bh) { bh = h; best = a; } } return best; }
function harbor(k, r, n, wood = C('#3a2a1c')) {
  const a0 = seaDir(k, r);
  for (let i = 0; i < n; i++) {
    const a = a0 + (i - (n - 1) / 2) * 0.16;
    // walk outward to the waterline
    let d = r * 0.5; while (d < r * 2.2 && k.g(Math.cos(a) * d, Math.sin(a) * d) > 0.4) d += 8;
    const px = Math.cos(a) * (d + 22), pz = Math.sin(a) * (d + 22);
    k.box(px, -1.5, pz, 56, 3.2, 5, -a, 'plain', wood);
    if (i % 2 === 0) k.ship(Math.cos(a) * (d + 70) + Math.sin(a) * 14, Math.sin(a) * (d + 70) - Math.cos(a) * 14, -a + 0.2 + k.rnd() * 0.5, 0.85 + k.rnd() * 0.4);
  }
  for (let i = 0; i < 3; i++) { const a = a0 + (k.rnd() - 0.5) * 1.2, d = r * 1.9 + k.rnd() * r; if (k.g(Math.cos(a) * d, Math.sin(a) * d) < -3) k.ship(Math.cos(a) * d, Math.sin(a) * d, k.rnd() * TAU, 1); }
}

// ---- the Red Keep: pale red stone, stepped curtain walls, a crowd of drum towers, Maegor's Holdfast, the domed throne hall
function redKeep(k, rx, rz, red, roof) {
  const dark = shade(red, 0.82), lite = shade(red, 1.08);
  // outer ward, lower on the hill; inner ward on the crown
  const outer = k.ringPts(rx, rz, 150, 14, 0.06, 0.92);
  k.wallLoop(outer, 17, 6, dark, { tower: { r: 9, h: 27, roof: 'flat' }, gates: [7] });
  const inner = k.ringPts(rx + 8, rz, 92, 10, 0.08, 0.9, 0.3);
  k.wallLoop(inner, 22, 6, red, { tower: { r: 8, h: 38, roof: 'cone', roofColor: roof, roofH: 15 }, gates: [5] });
  const top = k.gs(rx + 8, rz);
  // Maegor's Holdfast: a square fortress within the fortress
  k.keep(rx + 30, rz + 6, 50, 46, 58, 0.15, red, { y: top - 3, roof: 'none', turrets: 7.5, turretH: 16, roofColor: roof });
  k.keep(rx + 30, rz + 6, 34, 30, 76, 0.15, lite, { y: top - 3, roof: 'pyramid', roofColor: roof, roofH: 20 });
  // the Great Hall (throne room): long nave, apse dome ringed with spire-buttresses
  const hx = rx - 34, hz = rz + 40;
  k.keep(hx, hz, 78, 28, 34, -0.2, red, { y: top - 4, roof: 'gable', roofColor: roof, roofH: 13 });
  const ax = hx - Math.cos(-0.2) * 44, az = hz + Math.sin(-0.2) * 44;
  k.cyl(ax, top - 6, az, 22, 21, 44, 16, 'stone', red, { noTop: true }); k.dome(ax, top + 38, az, 21.5, 'roof', roof, 0.8, 16, 6);
  for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; k.cyl(ax + Math.cos(a) * 23.5, top - 6, az + Math.sin(a) * 23.5, 1.5, 1.1, 50, 6, 'stone', lite); k.cone(ax + Math.cos(a) * 23.5, top + 44, az + Math.sin(a) * 23.5, 1.5, 16, 6, 'stone', lite, 1); }
  for (let i = 0; i < 7; i++) { const t = (i + 0.5) / 7 - 0.5; for (const sd of [-1, 1]) { const px = hx + Math.cos(-0.2) * t * 70 + Math.sin(-0.2) * sd * 15.5, pz = hz - Math.sin(-0.2) * t * 70 + Math.cos(-0.2) * sd * 15.5; k.box(px, top - 4, pz, 2.6, 30, 4.5, -0.2, 'stone', lite); k.cone(px, top + 26, pz, 1.8, 9, 4, 'stone', lite, 1); } }
  // towers: the Tower of the Hand, the White Sword Tower and their lesser kin
  const T = [[-58, -34, 11, 84, 'flat'], [66, -46, 9, 64, 'cone'], [78, 44, 12, 56, 'flat'], [20, -74, 8, 70, 'cone'], [-12, -22, 7, 58, 'cone'], [-84, 6, 7.5, 50, 'cone'], [52, 70, 7, 46, 'cone'], [-30, 84, 6.5, 44, 'flat'], [96, -4, 7, 48, 'cone']];
  for (const [dx, dz, r, h, rf] of T) {
    const g = k.gs(rx + dx, rz + dz);
    k.tower(rx + dx, rz + dz, r, h, k.rnd() < 0.5 ? red : lite, { roof: rf, roofColor: roof, roofH: r * 2.4, taper: 0.88 });
    k.cyl(rx + dx, g + h * 0.62, rz + dz, r * 0.93, r * 0.93, 1.0, 12, 'stone', dark);                       // string course
    if (rf === 'flat') k.tower(rx + dx + r * 0.45, rz + dz - r * 0.3, r * 0.34, h + 13, lite, { y: g, roof: 'cone', roofColor: roof, windows: false });   // stair turret
  }
  // serpentine steps and a barbican toward the city
  const gx = rx - 150, gz = rz - 6;
  k.keep(gx - 6, gz, 22, 30, 24, 0.05, dark, { roof: 'flat', turrets: 5.5, turretH: 9, roofColor: roof });
  k.userData = k.userData || {}; k.userData.beacon = [rx + 30, top + 100, rz + 6];
}
// ---- the Great Sept of Baelor: a domed rotunda on a stepped plinth, seven crystal-capped towers
function greatSept(k, sx, sz, white, gold) {
  const sy = k.gs(sx, sz), lead = C('#8f8a7c');
  for (let i = 0; i < 4; i++) k.cyl(sx, sy - 8 + i * 1.6, sz, 88 - i * 5, 88 - i * 5, i === 0 ? 9.6 : 1.6, 28, 'stone', shade(white, 0.92 + i * 0.03));   // stepped plinth
  const y0 = sy - 1.6;
  k.cyl(sx, y0, sz, 46, 45, 30, 28, 'stone', white, { noTop: true });                    // lower rotunda
  k.cyl(sx, y0 + 30, sz, 48, 48, 2.2, 28, 'stone', shade(white, 1.05));                  // cornice
  k.cone(sx, y0 + 32.2, sz, 47, 9, 28, 'roof', lead, 1);                                 // low roof up to the drum
  k.cyl(sx, y0 + 36, sz, 30, 29.5, 20, 28, 'stone', white, { noTop: true });             // drum
  for (let i = 0; i < 14; i++) { const a = (i / 14) * TAU; k.box(sx + Math.cos(a) * 30.2, y0 + 39, sz + Math.sin(a) * 30.2, 3.2, 12, 0.8, -a + Math.PI / 2, 'glow', [1, 1, 1], { noAO: true }); k.box(sx + Math.cos(a + TAU / 28) * 30.6, y0 + 36, sz + Math.sin(a + TAU / 28) * 30.6, 2.2, 20, 2.4, -(a + TAU / 28) + Math.PI / 2, 'stone', shade(white, 1.04)); }
  k.cyl(sx, y0 + 56, sz, 31.5, 31.5, 1.8, 28, 'stone', shade(white, 1.05));
  k.dome(sx, y0 + 57.8, sz, 30, 'roof', lead, 0.86, 28, 9);
  k.cyl(sx, y0 + 82.5, sz, 4, 3.6, 9, 10, 'stone', white); k.dome(sx, y0 + 91.5, sz, 4.2, 'roof', gold, 1.1, 10, 5); k.cone(sx, y0 + 95.5, sz, 0.9, 12, 6, 'roof', gold, 1);
  // porches on the seven faces, and the seven towers
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + 0.224;
    const px = sx + Math.cos(a) * 49, pz = sz + Math.sin(a) * 49;
    k.box(px, y0, pz, 20, 22, 9, -a + Math.PI / 2, 'stone', shade(white, 0.98)); k.gable(px, y0 + 22, pz, 20, 9, 5, -a + Math.PI / 2, 'roof', lead, white);
    k.box(sx + Math.cos(a) * 53.6, y0 + 1, sz + Math.sin(a) * 53.6, 6, 13, 0.6, -a + Math.PI / 2, 'glow', [1, 1, 1], { noAO: true });
    const b = a + TAU / 14, tx = sx + Math.cos(b) * 62, tz = sz + Math.sin(b) * 62;
    k.tower(tx, tz, 6.2, 66, white, { y: y0, roof: 'none', sides: 8, taper: 0.86, depth: 6 });
    k.cyl(tx, y0 + 66, tz, 6.4, 6.4, 1.6, 8, 'stone', shade(white, 1.06));
    for (let j = 0; j < 8; j++) { const c = (j / 8) * TAU; k.cyl(tx + Math.cos(c) * 4.4, y0 + 67.6, tz + Math.sin(c) * 4.4, 0.5, 0.5, 7, 5, 'stone', white); }      // open belfry colonnade
    k.cyl(tx, y0 + 74.6, tz, 5.6, 5.6, 1.2, 8, 'stone', shade(white, 1.06)); k.dome(tx, y0 + 75.8, tz, 5.2, 'roof', lead, 1.05, 8, 5); k.cone(tx, y0 + 80.6, tz, 0.6, 9, 6, 'roof', gold, 1);
  }
  // the grand stair toward the central square
  const a = Math.atan2(40 - sz, -40 - sx);
  for (let i = 0; i < 9; i++) k.box(sx + Math.cos(a) * (92 + i * 3.2), sy - 9.5 - i * 1.0, sz + Math.sin(a) * (92 + i * 3.2), 3.4, 9, 44, -a, 'stone', shade(white, 0.94));
}
// ---- the Dragonpit: a vast ruined rotunda, its dome fallen in, the arcades blackened
function dragonpit(k, dx, dz) {
  const dy = k.gs(dx, dz), soot = C('#5a544c'), R = 86;
  k.cyl(dx, dy - 7, dz, R + 10, R + 10, 8.5, 32, 'stone', shade(soot, 1.1));
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * TAU; const gapA = i >= 5 && i <= 8, low = i >= 18 && i <= 20;
    const hh = gapA ? 6 + k.rnd() * 8 : low ? 14 + k.rnd() * 8 : 30 + k.rnd() * 9; const px = dx + Math.cos(a) * R, pz = dz + Math.sin(a) * R;
    k.box(px, dy - 2, pz, 6.5, hh + 2, 9, -a + Math.PI / 2, 'stone', shade(soot, 0.8 + k.rnd() * 0.35));                        // piers
    if (!gapA) { const b = a + TAU / 64; k.box(dx + Math.cos(b) * R, dy + hh * 0.52, dz + Math.sin(b) * R, 11, hh * 0.2, 7, -b + Math.PI / 2, 'stone', shade(soot, 0.9)); k.box(dx + Math.cos(b) * R, dy + hh - 3, dz + Math.sin(b) * R, 11, 3.2, 8, -b + Math.PI / 2, 'stone', shade(soot, 0.95)); }
    if (!gapA && !low && i % 3 === 0) k.cyl(px - Math.cos(a) * 5, dy + hh, pz - Math.sin(a) * 5, 2.6, 0.9, 24 + k.rnd() * 14, 5, 'stone', shade(soot, 0.85), { tiltX: -Math.cos(a) * 26, tiltZ: -Math.sin(a) * 26 });   // broken dome ribs
  }
  for (let i = 0; i < 14; i++) { const a = k.rnd() * TAU, r = k.rnd() * R * 0.8; k.box(dx + Math.cos(a) * r, dy - 1, dz + Math.sin(a) * r, 4 + k.rnd() * 7, 2 + k.rnd() * 4, 3 + k.rnd() * 5, k.rnd() * TAU, 'stone', shade(soot, 0.7 + k.rnd() * 0.4)); }
}

const BUILD = {
  // King's Landing. +x east (Blackwater Bay), +z south. Three hills: Aegon's (Red Keep, on the headland), Visenya's (Great Sept), Rhaenys's (Dragonpit).
  kingslanding(k, lm) {
    const stone = C('#bba585'), red = C('#c49a84'), redRoof = C('#7a3a2c'), white = C('#e4dccb'), gold = C('#c9a86a');
    const shore = (z) => { let x = 380; while (x < 1400 && k.g(x, z) > 1.1) x += 6; return x; };
    const RK = [925, 400], SP = [-360, 250], DP = [40, -400], CS = [-40, 40];
    // ---- wall line: landward walls, then the seawall along the bay
    const corners = [
      [-690, -230], [-540, -510, 'gods'], [-260, -680], [50, -735, 'old'], [350, -700, 'dragon'], [600, -575], [shore(-400) + 4, -400, 'iron'],
      [shore(-170) + 4, -170], [shore(50) + 4, 50], [RK[0] - 70, 250, 'skip'], [RK[0] - 60, 550], [shore(650) + 4, 650, 'mud'], [shore(790) + 4, 790],
      [340, 860], [-40, 850, 'king'], [-420, 770], [-640, 540, 'lion'], [-735, 210],
    ];
    const poly = corners.map(c => [c[0], c[1]]);
    // subdivide so there is a tower every ~110 m; a gate sits mid-way along the edge that starts at a tagged corner
    const W = [], gates = [], skip = [], gate = {};
    corners.forEach((c, i) => {
      const d = corners[(i + 1) % corners.length]; const L = Math.hypot(d[0] - c[0], d[1] - c[1]); const n = Math.max(1, Math.round(L / 110)); const gi = Math.floor(n / 2);
      for (let j = 0; j < n; j++) {
        if (c[2] === 'skip') skip.push(W.length); else if (c[2] && j === gi) { gates.push(W.length); gate[c[2]] = [c[0] + (d[0] - c[0]) * (j + 0.5) / n, c[1] + (d[1] - c[1]) * (j + 0.5) / n]; }
        W.push([c[0] + (d[0] - c[0]) * j / n, c[1] + (d[1] - c[1]) * j / n]);
      }
    });
    // the walls are massive, as Dubrovnik's are: 24 m of masonry with broad round towers, the seaward stretch standing in the surf
    k.wallLoop(W, 24, 9, stone, { tower: { r: 10.5, h: 34, roof: 'flat' }, gates, skip, merlon: 2.2 });
    // great round sea forts at the harbour corners, on battered bases in the water
    const FORTS = [[shore(-400) + 4, -400], [shore(50) + 4, 50], [shore(650) + 4, 650], [shore(790) + 4, 790]];
    for (const [x, z] of FORTS) {
      // the Blender model (tools/blender/sea_fort.py), its watch turret turned toward the city; plain drums if it is missing
      if (k.model('seafort', x, z, Math.atan2(CS[1] - z, -(CS[0] - x))) !== false) continue;
      const g = k.gs(x, z);
      k.cyl(x, Math.min(g, 0) - 6, z, 31, 25.5, 20 + g, 28, 'stone', shade(stone, 0.9));
      k.tower(x, z, 24, 31, stone, { y: g, roof: 'flat', sides: 28, taper: 0.98, depth: 8 });
      k.cyl(x, g + 31, z, 23, 23, 3.4, 28, 'stone', shade(stone, 1.05));           // a corbelled parapet ring
    }
    const inward = (p, d) => { const l = Math.hypot(p[0] - CS[0], p[1] - CS[1]) || 1; return [p[0] + (CS[0] - p[0]) / l * d, p[1] + (CS[1] - p[1]) / l * d]; };
    // ---- squares and precincts
    const FS = inward(gate.mud, 95);                                   // Fishmonger's Square, inside the Mud Gate
    const RG = [RK[0] - 215, RK[1] - 10];                              // square below the Red Keep gate
    const CB = [-330, -270];                                           // Cobbler's Square
    const plazas = [[CS[0], CS[1], 54], [FS[0], FS[1], 40], [RG[0], RG[1], 34], [CB[0], CB[1], 30], [SP[0], SP[1], 104], [DP[0], DP[1], 108], [RK[0], RK[1], 136],
      [250, 620, 20], [-150, -420, 20], [420, -330, 22], [-520, 40, 20], [230, -40, 18]];
    for (const key of Object.keys(gate)) { const g = inward(gate[key], 34); plazas.push([g[0], g[1], 22]); }
    const G = (key, d) => inward(gate[key], d);
    const roads = [
      { hw: 7.5, pts: [G('mud', 60), FS, [330, 430], [140, 210], CS] },                                        // Muddy Way
      { hw: 6.5, pts: [[SP[0] + 100, SP[1] - 66], [-150, 110], CS, [0, -130], [DP[0] - 8, DP[1] + 116]] },      // Street of the Sisters
      { hw: 5.5, pts: [FS, [300, 640], [60, 560], [-180, 420], [SP[0] + 60, SP[1] + 104]] },                   // Street of Steel
      { hw: 5, pts: [FS, [FS[0] + 10, 520], [RG[0] - 30, 470], RG] },                                          // the Hook
      { hw: 7.5, pts: [CS, [200, 150], [400, 300], RG] },                                                      // the king's way up Aegon's Hill
      { hw: 6, pts: [G('gods', 50), CB, [-190, -110], CS] },                                                   // Gate of the Gods
      { hw: 5.5, pts: [G('old', 50), [-70, -520], [-120, -330], [-100, -150], CS] },                           // Old Gate
      { hw: 5, pts: [G('dragon', 50), [210, -470], [215, -300], [270, -120], [330, 120], [400, 300]] },        // Dragon Gate, through Flea Bottom
      { hw: 5.5, pts: [G('lion', 50), [-520, 360], [SP[0] - 118, SP[1] + 30]] },                               // Lion Gate
      { hw: 5.5, pts: [G('king', 50), [-80, 700], [60, 560]] },                                                // King's Gate
      { hw: 5, pts: [[-380, 700], [-80, 700], [150, 760], FS] },                                               // River Row
      { hw: 5, pts: [G('iron', 50), [600, -230], [540, 0], [560, 220], RG] },                                  // Iron Gate
      { hw: 5, pts: [CB, [-430, -40], [-470, 180]] },
    ];
    const nearSea = (x, z) => x > shore(z) - 150;
    const res = planCity(k, {
      poly, style: 'kl', inset: 16, plazas, roads, lane: 2.2, civicEvery: 9, towerEvery: 15,
      keep: (x, z) => k.g(x, z) > 2.5 && Math.hypot(x - RK[0], z - RK[1]) > 138 && FORTS.every(([fx, fz]) => Math.hypot(x - fx, z - fz) > 42),
      district: (x, z) => {
        if (Math.hypot(x - 300, z + 170) < 250) return 'poor';                                                 // Flea Bottom
        if (Math.hypot(x - FS[0], z - FS[1]) < 150 || (nearSea(x, z) && z > 450)) return k.rnd() < 0.6 ? 'harbor' : 'common';
        if (Math.hypot(x - SP[0], z - SP[1]) < 250 || Math.hypot(x - RG[0], z - RG[1]) < 190) return k.rnd() < 0.7 ? 'rich' : 'common';
        return k.rnd() < 0.1 ? 'poor' : 'common';
      },
      cell: (x, z) => (Math.hypot(x - 300, z + 170) < 250 ? 36 : Math.hypot(x - SP[0], z - SP[1]) < 250 ? 60 : 46) * (0.9 + k.rnd() * 0.25),
      tall: (x, z) => 0.16 * Math.max(0, 1 - Math.hypot(x - CS[0], z - CS[1]) / 420),
    });
    k.pave.push({ poly, s: 1 });
    k.userData = k.userData || {}; k.userData.plan = res;
    // fountains / statues in the squares
    for (const [px, pz, pr] of plazas.slice(0, 4)) { const g = k.gs(px, pz); k.cyl(px, g - 0.5, pz, pr * 0.16, pr * 0.16, 1.3, 12, 'stone', white); k.cyl(px, g + 0.8, pz, 1.1, 0.8, 5.5, 8, 'stone', white); k.dome(px, g + 6.3, pz, 1.3, 'roof', gold, 1.2, 8, 4); }
    const ry = k.model('redkeep', RK[0], RK[1], 0, 0, 1.3);
    k.pave.push({ c: [RK[0], RK[1]], r: 150, s: 0.7 });
    if (ry === false) redKeep(k, RK[0], RK[1], red, redRoof); else { k.userData.beacon = [RK[0] + 30, ry + 150, RK[1] - 10]; }
    // the Red Keep's outer curtain on the seaward side follows the cliff brink round the castle: its walls stand on the rock
    // face and rise above the rim, its drum towers' shafts run down the cliff (a rounded square just outside the keep)
    {
      const top = k.gs(RK[0], RK[1]), R = 118, a0 = -2.05, a1 = 2.05, N = 22, rkStone = C('#b9a690');      // pale grey stone below the red keep, as the references have it
      const sq = (a) => R / Math.pow(Math.pow(Math.abs(Math.cos(a)), 2.4) + Math.pow(Math.abs(Math.sin(a)), 2.4), 1 / 2.4);      // a rounded outline that keeps inside the cliff's brink
      let prev = null;
      for (let i = 0; i <= N; i++) {
        const a = a0 + (a1 - a0) * i / N, d = sq(a), p = [RK[0] + Math.cos(a) * d, RK[1] + Math.sin(a) * d];
        if (prev) k.wall(prev[0], prev[1], p[0], p[1], 0, 7, rkStone, { level: top + 13, merlon: 1.9, step: 18 });
        const gt = Math.max(k.g(p[0], p[1]), 0), corner = Math.abs(Math.abs(Math.cos(a)) - Math.abs(Math.sin(a))) < 0.25;
        if (i % 2 === 0 || corner) k.tower(p[0], p[1], corner ? 13 : 8.5, top + (corner ? 30 : 21) - gt, corner ? shade(rkStone, 1.04) : rkStone,
          { y: gt, roof: corner && i % 3 === 0 ? 'cone' : 'flat', roofColor: redRoof, roofH: 26, depth: 6, taper: 0.94 });
        prev = p;
      }
      k.userData.avoid = [{ x: RK[0], z: RK[1], R, a0, a1, band: 14 }];
    }
    if (k.model('sept', SP[0], SP[1], Math.atan2(-(CS[1] - SP[1]), CS[0] - SP[0])) === false) greatSept(k, SP[0], SP[1], white, gold);
    if (k.model('dragonpit', DP[0], DP[1], 0) === false) dragonpit(k, DP[0], DP[1]);
    // ---- the harbour outside the Mud Gate: a stone quay, timber piers, ships at anchor
    const wood = C('#3a2a1c');
    for (let i = 0; i < 9; i++) {
      const z = 560 + i * 34, xs = shore(z);
      k.box(xs + 26, -1.6, z, 70, 3.4, 5.5, 0, 'plain', wood);
      if (i % 2 === 0) k.ship(xs + 84, z + 13, 0.2 + k.rnd() * 0.5, 0.85 + k.rnd() * 0.4);
    }
    for (let i = 0; i < 7; i++) { const z = -300 + k.rnd() * 1300, x = shore(z) + 180 + k.rnd() * 520; if (k.g(x, z) < -3) k.ship(x, z, k.rnd() * TAU, 0.9 + k.rnd() * 0.4); }
    // ---- street life: markets on the squares, carts and townsfolk on the avenues, banners, harbour clutter, a pavilion camp
    k.userData.life = livenCity(k, {
      markets: plazas.slice(0, 4), squares: plazas.slice(7), roads, center: CS, gates: Object.values(gate),
      towers: W.filter((p, i) => i % 2 === 0 && !skip.includes(i)), towerTop: 35.2,
      piers: Array.from({ length: 9 }, (_, i) => { const z = 560 + i * 34; return { x: shore(z) + 26, z, len: 70, y: 1.8 }; }), shore, shoreZ: [500, 900],
      camps: ['king', 'lion', 'gods', 'old', 'dragon'].map((key) => { const p = inward(gate[key], -150), l = Math.hypot(p[0] - CS[0], p[1] - CS[1]); return [p[0], p[1], (p[0] - CS[0]) / l, (p[1] - CS[1]) / l]; }),
    });
  },

  winterfell(k) {
    const st = C('#7d7f84'), roof = SNOWROOF;
    const outer = k.ringPts(0, 0, 215, 14, 0.06, 0.86), inner = k.ringPts(0, 0, 165, 12, 0.05, 0.84, 0.2);
    k.wallLoop(outer, 22, 6, st, { tower: { r: 8.5, h: 30, roof: 'cone', roofColor: roof }, gates: [3, 10] });
    k.wallLoop(inner, 30, 7, shade(st, 0.95), { tower: { r: 9.5, h: 40, roof: 'cone', roofColor: roof }, gates: [3, 9] });
    k.keep(-10, 10, 52, 40, 42, 0.1, st, { roof: 'gable', roofColor: roof, turrets: 7, turretH: 12 });        // Great Keep
    k.keep(48, 44, 62, 22, 18, 0.1, st, { roof: 'gable', roofColor: roof });                                   // Great Hall
    k.tower(-78, -60, 17, 30, shade(st, 0.85), { roof: 'flat' });                                              // First Keep
    const bt = k.tower(-104, -18, 8.5, 42, shade(st, 0.8), { roof: 'none' });                                  // Broken Tower
    for (let i = 0; i < 5; i++) k.box(-104 + Math.cos(i * 1.3) * 6.5, bt, -18 + Math.sin(i * 1.3) * 6.5, 3, 3 + k.rnd() * 6, 2.4, i, 'stone', shade(st, 0.8));
    k.tower(70, -40, 8, 48, st, { roof: 'cone', roofColor: roof });                                            // Bell Tower
    k.tower(30, -78, 10, 34, st, { roof: 'cone', roofColor: roof });                                           // Library Tower
    k.keep(84, -4, 30, 24, 16, 0.3, st, { roof: 'gable', roofColor: roof });                                   // armoury
    k.keep(-40, 82, 34, 20, 13, -0.2, st, { roof: 'gable', roofColor: roof });                                 // stables
    k.box(0, k.gs(0, -52), -52, 34, 9, 20, 0.1, 'glow', [1, 1, 1], { noAO: true });                            // glass gardens
    k.gable(0, k.gs(0, -52) + 9, -52, 34, 20, 6, 0.1, 'glow', [1, 1, 1]);
    // godswood with its heart tree
    for (let i = 0; i < 46; i++) { const a = k.rnd() * TAU, r = 18 + k.rnd() * 52; k.tree(-60 + Math.cos(a) * r * 0.9, 50 + Math.sin(a) * r * 0.7, 0.9 + k.rnd() * 0.7, shade(C('#22361f'), 0.8 + k.rnd() * 0.5)); }
    k.tree(-60, 50, 1.7, C('#9a1512'), C('#d8d2c6'));
    // winter town
    k.houses(k.ringPts(330, 30, 150, 9, 0.2, 0.7), 22, [C('#b8b0a2'), C('#a89c8c'), C('#c8c0b0')], [THATCH, roof, C('#8a7a5c')], { inset: 6, gap: 0.25, h0: 3.5, h1: 3, style: 'north' });
  },

  castleblack(k) {
    const st = C('#5c5a58'), wood = C('#3c2c20'), roof = SNOWROOF;
    k.tower(-40, 30, 8, 30, st, { roof: 'cone', roofColor: roof });                 // King's Tower
    k.tower(20, 46, 7, 24, st, { roof: 'flat' });                                   // Lord Commander's Tower
    k.tower(64, 20, 6.5, 26, shade(st, 0.85), { roof: 'flat' });                    // Hardin's Tower
    k.tower(-78, 58, 7, 20, st, { roof: 'cone', roofColor: roof });                 // the Lance
    k.keep(-6, 84, 40, 16, 9, 0.05, wood, { roof: 'gable', roofColor: roof, windows: true });      // common hall
    k.keep(44, 80, 26, 13, 8, -0.1, wood, { roof: 'gable', roofColor: roof });
    k.keep(-56, 96, 22, 12, 7, 0.2, wood, { roof: 'gable', roofColor: roof });
    k.keep(86, 64, 20, 12, 7, 0.4, wood, { roof: 'gable', roofColor: roof });
    k.keep(10, 12, 18, 14, 12, 0, st, { roof: 'gable', roofColor: roof });          // armoury / forge
    // the switchback stair and winch cage climbing the ice
    const g = k.gs(0, 0);
    for (let i = 0; i < 16; i++) { const y = g + 6 + i * 13, dir = i % 2 ? 1 : -1; k.box(dir * 0, y, -14 - i * 0.6, 46, 1.2, 3, dir * 0.27, 'plain', wood, { noAO: true }); }
    k.box(30, g, -12, 5, 215, 5, 0, 'plain', shade(wood, 0.8), { noAO: true });
    for (let i = 0; i < 30; i++) { const a = k.rnd() * TAU, r = 100 + k.rnd() * 90; if (Math.sin(a) > -0.2) k.house(Math.cos(a) * r, 60 + Math.sin(a) * r * 0.6, 8, 6, 3.5, k.rnd() * 6.28, C('#a89c8c'), roof, { style: 'north' }); }
  },

  dragonstone(k) {
    // the castle, its inner ward, the Stone Drum, the dragon hall and the causeway down to the western shore are one
    // Blender model (tools/blender/dragonstone.py); only the ships off the jetty are added here
    if (k.model('dragonstone', 0, 0) !== false) {
      for (const [x, z, rot, sc] of [[-700, 96, 1.2, 1.1], [-742, -30, 1.75, 1.2], [-668, 150, 0.5, 0.95]]) if (k.g(x, z) < -3) k.ship(x, z, rot, sc, C('#1a1a1c'));
      return;
    }
    const st = C('#1e1f24'), dk = C('#15161a'), roof = C('#101114');
    const wl = k.ringPts(0, 0, 118, 10, 0.12, 0.85);
    k.wallLoop(wl, 18, 6, st, { tower: { r: 8, h: 34, roof: 'spikes', spikes: 7, spikeH: 1.6 }, gates: [4] });
    const drum = k.tower(0, 0, 30, 58, st, { roof: 'spikes', spikes: 14, spikeH: 0.8, sides: 16 });        // the Stone Drum
    k.tower(0, 0, 13, 92, dk, { y: k.gs(0, 0), roof: 'cone', roofColor: roof, roofH: 34 });
    // dragon-shaped towers: tall shafts with wing-like buttresses and horned crowns
    for (const [x, z, r, h] of [[-64, -34, 10, 84], [62, -44, 9, 70], [70, 40, 11, 96], [-58, 52, 9, 62], [10, -82, 8, 76]]) {
      const top = k.tower(x, z, r, h, st, { roof: 'cone', roofColor: roof, roofH: r * 3.4 });
      for (const s of [-1, 1]) { const a = Math.atan2(z, x) + s * 1.25; k.cyl(x + Math.cos(a) * r * 0.9, top - h * 0.5, z + Math.sin(a) * r * 0.9, 2.2, 0.3, h * 0.62, 4, 'stone', dk, { tiltX: Math.cos(a) * r * 2.4, tiltZ: Math.sin(a) * r * 2.4 }); }
      k.cone(x - Math.cos(Math.atan2(z, x)) * r * 1.0, top + r * 1.0, z - Math.sin(Math.atan2(z, x)) * r * 1.0, r * 0.35, r * 1.6, 5, 'stone', dk, 1);
    }
    k.keep(-14, 60, 60, 24, 20, 0.3, st, { roof: 'gable', roofColor: roof });        // the Great Hall (a dragon lying on its belly)
    // the long stair down to the shore
    const a = seaDir(k, 300); let px = Math.cos(a) * 124, pz = Math.sin(a) * 124;
    for (let i = 0; i < 26; i++) {
      const zig = Math.sin(i * 0.9) * 0.5; const nx = px + Math.cos(a + zig) * 20, nz = pz + Math.sin(a + zig) * 20;
      const g0 = k.gs(px, pz), g1 = k.gs(nx, nz); if (g1 < 1) break;
      k.wall(px, pz, nx, nz, 5, 6, shade(st, 1.1), { crenel: true, merlon: 1.2, step: 40 });
      px = nx; pz = nz;
    }
    for (let i = 0; i < 3; i++) { const b = a + (i - 1) * 0.3; let d = 200; while (d < 900 && k.g(Math.cos(b) * d, Math.sin(b) * d) > -4) d += 20; k.ship(Math.cos(b) * (d + 40), Math.sin(b) * (d + 40), -b + 1.4, 1.1, C('#1a1a1c')); }
  },

  eyrie(k) {
    const st = C('#e4e2dc'), roof = C('#6f8aa8'); const y = k.gs(0, 0);
    k.wallLoop(k.ringPts(0, 0, 78, 12, 0.03), 9, 4, st, { crenel: true });
    k.tower(0, 0, 22, 34, st, { roof: 'cone', roofColor: roof, roofH: 30, sides: 14 });
    for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU + 0.3; k.tower(Math.cos(a) * 48, Math.sin(a) * 48, 7 + (i % 3), 52 + ((i * 37) % 30), st, { roof: 'cone', roofColor: roof, roofH: 26, sides: 10 }); }
    k.keep(0, 34, 40, 16, 20, 0, st, { roof: 'gable', roofColor: roof });
    // the waycastles Stone, Snow and Sky on the way up
    for (const [d, h] of [[320, 0], [520, 0], [760, 0]]) { const a = 2.2; const px = Math.cos(a) * d, pz = Math.sin(a) * d; k.tower(px, pz, 7, 16, shade(st, 0.9), { roof: 'cone', roofColor: roof }); }
    // Gates of the Moon at the foot of the mountain
    const gx = Math.cos(2.2) * 1250, gz = Math.sin(2.2) * 1250;
    k.wallLoop(k.ringPts(gx, gz, 70, 6, 0.05), 14, 5, shade(st, 0.85), { tower: { r: 8, h: 26, roof: 'cone', roofColor: roof }, gates: [1] });
    k.keep(gx, gz, 34, 26, 24, 0.2, shade(st, 0.85), { roof: 'gable', roofColor: roof });
  },

  casterlyrock(k) {
    const st = C('#c0a476'), roof = C('#7a2018'), gold = C('#d8a838');
    const top = k.gs(0, 0);
    const wl = k.ringPts(0, 0, 215, 14, 0.08);
    k.wallLoop(wl, 16, 6, st, { tower: { r: 9, h: 30, roof: 'cone', roofColor: roof } , level: undefined });
    k.keep(0, 0, 76, 64, 64, 0.15, st, { roof: 'pyramid', roofColor: roof, turrets: 9, turretH: 18 });
    k.tower(0, 0, 14, 110, st, { y: top, roof: 'dome', roofColor: gold, finial: true });
    for (const [x, z, r, h] of [[-90, 40, 12, 60], [84, -60, 11, 72], [70, 86, 13, 52], [-70, -92, 10, 66], [-130, -20, 9, 48], [120, 20, 10, 58]]) k.tower(x, z, r, h, st, { roof: 'cone', roofColor: roof });
    k.keep(-40, 96, 56, 22, 22, 0.4, st, { roof: 'gable', roofColor: roof });
    k.keep(60, -10, 30, 44, 30, 0.1, st, { roof: 'gable', roofColor: roof });
    // watchtowers on the ledges and the sea gate
    for (let i = 0; i < 9; i++) {
      // the Rock's sides are sheer now: stand each tower on the first gentle ground, on the rim or at the foot
      const a = (i / 9) * TAU + 0.3; let d = i % 2 ? 236 : 540, ok = false;
      for (let n = 0; n < 14 && !ok; n++) { if (k.field.slopeAt(k.ox + Math.cos(a) * d, k.oz + Math.sin(a) * d) < 0.4 && k.g(Math.cos(a) * d, Math.sin(a) * d) > 4) ok = true; else d += i % 2 ? -8 : 22; }
      if (ok) k.tower(Math.cos(a) * d, Math.sin(a) * d, 6, 22, shade(st, 0.9), { roof: 'flat' });
    }
  },

  harrenhal(k) {
    const st = C('#2e2c2b'), bl = C('#1a1918');
    const wl = k.ringPts(0, 0, 330, 16, 0.05, 0.9);
    k.wallLoop(wl, 38, 13, st, { gates: [4], merlon: 2.6, noTowerAt: [] });
    // five colossal towers, melted and slumped by dragonfire
    const tw = [[-150, -110, 44, 150], [130, -140, 38, 125], [190, 60, 42, 165], [-20, 170, 36, 110], [-200, 90, 40, 135]];
    for (const [x, z, r, h] of tw) {
      const g = k.gs(x, z); let y = g - 6, rr = r, ox = 0, oz = 0; const lean = (k.rnd() - 0.5) * 0.5, la = k.rnd() * TAU; const segs = 7;
      for (let s = 0; s < segs; s++) {
        const sh = (h + 6) / segs * (1 + (k.rnd() - 0.5) * 0.2); const nr = rr * (0.9 - s * 0.012 - k.rnd() * 0.05);
        const tx = Math.cos(la) * lean * sh * (s / segs) * 2.0, tz = Math.sin(la) * lean * sh * (s / segs) * 2.0;
        k.cyl(x + ox, y, z + oz, rr, nr, sh, 14, 'stone', shade(s > 4 ? bl : st, 0.8 + k.rnd() * 0.35), { tiltX: tx, tiltZ: tz, noTop: s < segs - 1 });
        ox += tx; oz += tz; y += sh; rr = nr * (1.02 + k.rnd() * 0.05);
      }
      for (let i = 0; i < 9; i++) { const a = k.rnd() * TAU; k.cyl(x + ox + Math.cos(a) * rr * 0.7, y - 4, z + oz + Math.sin(a) * rr * 0.7, rr * 0.24, rr * 0.05, 10 + k.rnd() * 26, 5, 'stone', bl, { tiltX: Math.cos(a) * 6, tiltZ: Math.sin(a) * 6 }); }
    }
    k.keep(0, 0, 130, 44, 34, 0.25, st, { roof: 'none', windows: false });           // Hall of a Hundred Hearths (roofless)
    k.keep(-70, 30, 50, 36, 26, -0.3, bl, { roof: 'none', windows: false });
    for (let i = 0; i < 26; i++) { const a = k.rnd() * TAU, r = 60 + k.rnd() * 230; k.box(Math.cos(a) * r, k.gs(Math.cos(a) * r, Math.sin(a) * r) - 2, Math.sin(a) * r * 0.9, 8 + k.rnd() * 22, 4 + k.rnd() * 16, 3 + k.rnd() * 5, k.rnd() * 3, 'stone', shade(st, 0.7 + k.rnd() * 0.5)); }
    k.houses(k.ringPts(-470, 120, 110, 8, 0.2), 22, [C('#6a5e50'), C('#766a5a')], [THATCH, C('#6a5a40')], { inset: 5, gap: 0.3, h0: 3.5, h1: 3, style: 'village' });
  },

  stormsend(k) {
    const st = C('#8a8a86'), dk = C('#6c6c6a');
    // one colossal drum tower crowned with battlements like a spiked fist
    const top = k.tower(0, 0, 50, 98, st, { roof: 'spikes', spikes: 16, spikeH: 0.42, sides: 24, taper: 0.96, depth: 12 });
    k.tower(0, 0, 30, 112, dk, { y: k.gs(0, 0), roof: 'flat', sides: 20, taper: 0.97, windows: false });
    // the great curtain wall: smooth, round and immensely thick
    const wl = k.ringPts(0, 0, 150, 30, 0.0);
    k.wallLoop(wl, 30, 16, st, { gates: [22], merlon: 2.4, step: 40 });
    k.keep(70, 60, 44, 20, 14, 0.7, dk, { roof: 'gable', roofColor: DARKSLATE });
    k.keep(-80, 40, 36, 18, 12, -0.5, dk, { roof: 'gable', roofColor: DARKSLATE });
    k.keep(-30, -92, 30, 16, 12, 0.2, dk, { roof: 'gable', roofColor: DARKSLATE });
  },

  highgarden(k) {
    const st = C('#e6e0d0'), roof = C('#5c8a6a'), hedge = C('#2c5a24');
    const rings = [[330, 12, 5, 22], [245, 15, 5, 18], [165, 20, 6, 14]];
    rings.forEach(([r, h, t, n], i) => k.wallLoop(k.ringPts(0, 0, r, n, 0.02, 1, i * 0.2), h, t, st, { tower: { r: 6.5 + i, h: h + 14 + i * 4, roof: 'cone', roofColor: roof, roofH: 20 }, gates: [1 + i, Math.floor(n / 2) + i] }));
    // the briar maze between the outer walls
    for (let i = 0; i < 90; i++) { const a = (i / 90) * TAU, r = 262 + (i % 3) * 20; if (k.rnd() < 0.25) continue; const x = Math.cos(a) * r, z = Math.sin(a) * r; k.box(x, k.gs(x, z) - 1, z, 20, 4.2, 2.6, -a + Math.PI / 2 + (i % 2 ? 0.5 : 0), 'plain', shade(hedge, 0.8 + k.rnd() * 0.4), { noAO: true }); }
    for (let i = 0; i < 110; i++) { const a = k.rnd() * TAU, r = 175 + k.rnd() * 70; k.tree(Math.cos(a) * r, Math.sin(a) * r, 0.8 + k.rnd() * 0.6, shade(i % 7 === 0 ? C('#c86a8a') : C('#3a7028'), 0.8 + k.rnd() * 0.5)); }
    // the palace: tall slender towers and airy halls
    k.keep(0, 0, 70, 46, 40, 0.1, st, { roof: 'gable', roofColor: roof, turrets: 7, turretH: 22 });
    k.tower(0, 0, 13, 98, st, { y: k.gs(0, 0), roof: 'cone', roofColor: roof, roofH: 40 });
    for (const [x, z, r, h] of [[-60, 44, 9, 66], [64, 40, 8, 74], [56, -56, 10, 58], [-66, -50, 8, 80], [0, 86, 7, 52], [-100, 0, 7, 46], [104, -6, 7, 50]]) k.tower(x, z, r, h, st, { roof: 'cone', roofColor: roof, roofH: 28 });
    k.keep(-30, -70, 50, 20, 22, -0.2, st, { roof: 'gable', roofColor: roof });
    k.keep(40, 80, 44, 18, 18, 0.5, st, { roof: 'gable', roofColor: roof });
    for (let i = 0; i < 40; i++) { const a = k.rnd() * TAU, r = 30 + k.rnd() * 120; k.tree(Math.cos(a) * r, Math.sin(a) * r, 0.7 + k.rnd() * 0.5, shade(C('#3a7028'), 0.8 + k.rnd() * 0.5)); }
  },

  sunspear(k) {
    const st = C('#d9bd8c'), mud = [C('#d2b488'), C('#c8a678'), C('#dcc49c'), C('#be9a6c')], gold = C('#e0b040');
    // the Winding Walls
    [[330, 22], [250, 18], [170, 16]].forEach(([r, n], i) => { const pts = []; for (let j = 0; j < n; j++) { const a = (j / n) * TAU; const rr = r * (1 + 0.12 * Math.sin(a * 4 + i * 1.7)); pts.push([Math.cos(a) * rr, Math.sin(a) * rr * 0.86]); } k.wallLoop(pts, 12 + i * 2, 4.5, st, { gates: [i * 3 + 2], tower: i === 2 ? { r: 6, h: 22, roof: 'dome', roofColor: gold, sides: 8 } : null }); });
    k.houses(k.ringPts(0, 0, 320, 18, 0.05, 0.86), 17, mud, mud, { flat: true, inset: 12, gap: 0.14, h0: 4, h1: 6, rotJ: 0.3, filter: (x, z) => Math.hypot(x, z) > 150 });
    // the Old Palace: Tower of the Sun and the Spear Tower
    const y = k.gs(0, 0);
    k.tower(-30, 10, 28, 44, st, { roof: 'dome', roofColor: gold, squash: 0.9, finial: true, sides: 16 });
    k.tower(46, -20, 8.5, 150, st, { roof: 'cone', roofColor: gold, roofH: 46, taper: 0.62, sides: 10 });
    // the Sandship: a keep shaped like a great dromond
    k.keep(20, 70, 110, 30, 24, 0.35, st, { roof: 'none' });
    k.pyramid(20 + Math.cos(0.35) * 70, y + 0, 70 - Math.sin(0.35) * 70, 34, 28, 26, 0.35, 'stone', st);
    for (const [x, z] of [[-90, -60], [90, 50], [-70, 90], [100, -70]]) k.tower(x, z, 7, 30, st, { roof: 'dome', roofColor: gold, sides: 8 });
    for (let i = 0; i < 26; i++) { const a = k.rnd() * TAU, r = 60 + k.rnd() * 250; const x = Math.cos(a) * r, z = Math.sin(a) * r * 0.86, g = k.g(x, z); if (g < 1) continue; k.cyl(x, g, z, 0.35, 0.25, 9, 5, 'plain', C('#5a4630'), { noTop: true }); k.dome(x, g + 8.4, z, 3.2, 'plain', C('#3c6a26'), 0.45, 7, 2); }   // palms
    harbor(k, 330, 6);
  },

  pyke(k) {
    const st = C('#3a3f3d'), dk = C('#2a2e2d'), roof = C('#1e2224');
    const stacks = [[0, 0, 150], [70, 230, 85], [-20, 420, 70], [110, 590, 60]];
    const ys = stacks.map(s => k.gs(s[0], s[1]));
    // Great Keep on the headland with its curtain wall
    k.wallLoop(k.ringPts(0, -30, 92, 9, 0.1, 0.8), 12, 5, st, { tower: { r: 7, h: 22, roof: 'flat' }, gates: [6] });
    k.keep(0, -20, 58, 42, 46, 0.2, st, { roof: 'gable', roofColor: roof, turrets: 6, turretH: 10, turretRoof: 'flat' });
    k.tower(-40, 30, 9, 56, dk, { roof: 'flat' });
    // Kitchen Keep, Bloody Keep and the Sea Tower on their stacks
    k.keep(70, 230, 44, 34, 34, 0.5, st, { y: ys[1], roof: 'gable', roofColor: roof });
    k.tower(96, 250, 7, 44, dk, { y: ys[1], roof: 'flat' });
    k.keep(-20, 420, 40, 30, 40, -0.3, dk, { y: ys[2], roof: 'pyramid', roofColor: roof, turrets: 5, turretRoof: 'flat' });
    k.tower(110, 590, 11, 62, st, { y: ys[3], roof: 'flat', taper: 0.84 });
    // bridges: a stone span, then swaying rope walks
    k.bridge(20, 60, 60, 190, 7, Math.min(ys[0], ys[1]) + 1, st, 3);
    for (let i = 1; i < 3; i++) {
      const a = stacks[i], b = stacks[i + 1]; const ya = ys[i] + 1, yb = ys[i + 1] + 1;
      const n = 12; for (let j = 0; j < n; j++) { const t0 = j / n, t1 = (j + 1) / n; const sag = (t) => -9 * Math.sin(t * Math.PI);
        const x0 = a[0] + (b[0] - a[0]) * (0.25 + 0.5 * t0), z0 = a[1] + (b[1] - a[1]) * (0.25 + 0.5 * t0), x1 = a[0] + (b[0] - a[0]) * (0.25 + 0.5 * t1), z1 = a[1] + (b[1] - a[1]) * (0.25 + 0.5 * t1);
        const yy = ya + (yb - ya) * (t0 + t1) / 2 + sag((t0 + t1) / 2);
        k.box((x0 + x1) / 2, yy, (z0 + z1) / 2, Math.hypot(x1 - x0, z1 - z0) + 0.4, 0.5, 2.4, -Math.atan2(z1 - z0, x1 - x0), 'plain', C('#3a2a1c'), { noAO: true }); }
    }
    // Lordsport on the bay and the Iron Fleet
    for (let i = 0; i < 9; i++) { const a = -1.4 + i * 0.22; k.ship(Math.cos(a) * (520 + (i % 3) * 60), Math.sin(a) * (520 + (i % 3) * 60) - 150, a + 1.2, 0.9, C('#16161a')); }
  },

  oldtown(k) {
    const st = C('#b8b2a4'), palette = [C('#c8c0b0'), C('#b4ac9c'), C('#d4ccb8'), C('#a8a090')], roofs = [C('#8a4a34'), C('#6a5a50'), C('#9a6a48'), SLATE];
    const walls = k.ringPts(0, 0, 500, 16, 0.07, 0.92);
    k.wallLoop(walls, 14, 5, st, { tower: { r: 7, h: 22, roof: 'cone', roofColor: SLATE }, gates: [1, 6, 11] });
    k.houses(walls, 20, palette, roofs, { inset: 18, gap: 0.12, h0: 5, h1: 8, rotJ: 0.7, filter: (x, z) => Math.hypot(x - 120, z + 80) > 80 && Math.hypot(x + 180, z - 60) > 70 && Math.abs(z + x * 0.2) > 9 });
    // the Citadel: domes and towers linked by bridges
    for (const [x, z, r, h] of [[120, -80, 22, 22], [158, -50, 14, 30], [90, -44, 13, 34], [140, -120, 12, 26]]) k.tower(x, z, r, h, C('#d0c8b4'), { roof: 'dome', roofColor: C('#7a8a7a'), sides: 14 });
    // the Starry Sept
    k.tower(-180, 60, 30, 28, C('#2a2a30'), { roof: 'dome', roofColor: C('#1a1a22'), finial: true, sides: 14 });
    for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU; k.tower(-180 + Math.cos(a) * 44, 60 + Math.sin(a) * 44, 4.5, 40, C('#2a2a30'), { roof: 'cone', roofColor: C('#1a1a22'), sides: 8 }); }
    // the Hightower on Battle Isle: a stepped tower with a beacon on top
    const [hx, hz] = [-600, 1160], hy = k.gs(hx, hz);
    k.cyl(hx, hy - 8, hz, 66, 60, 44, 14, 'stone', C('#16161a'));        // the black fortress
    let y = hy + 36, r = 44; const tiers = 7;
    for (let i = 0; i < tiers; i++) { const h = 40 - i * 2.5; k.cyl(hx, y, hz, r, r * 0.9, h, 14, 'stone', shade(C('#e0dccc'), 1 - i * 0.02)); y += h; k.cyl(hx, y, hz, r * 0.98, r * 0.98, 2.4, 14, 'stone', C('#bcb6a6')); y += 2.4; r *= 0.8; }
    k.cyl(hx, y, hz, r * 1.4, r * 1.6, 5, 10, 'stone', C('#bcb6a6'));
    k.dome(hx, y + 5, hz, r * 1.0, 'glow', [1, 1, 1], 1.5, 8, 4);        // the beacon
    k.userData = { beacon: [hx, y + 12, hz] };
    k.bridge(-420, 520, -560, 1080, 9, 5, st, 9);
    harbor(k, 500, 8);
  },

  riverrun(k) {
    const st = C('#b4826a'), roof = C('#5a3c34');
    // triangular castle at the meeting of the rivers
    const pts = [[-110, -80], [120, -40], [-30, 120]];
    k.wallLoop(pts, 20, 6, st, { tower: { r: 11, h: 34, roof: 'cone', roofColor: roof }, gates: [0] });
    k.keep(-10, 0, 50, 38, 34, 0.2, st, { roof: 'gable', roofColor: roof, turrets: 6 });
    k.tower(40, -10, 9, 46, st, { roof: 'cone', roofColor: roof });
    k.keep(-50, 30, 34, 18, 14, -0.4, st, { roof: 'gable', roofColor: roof });
    k.tower(-6, 100, 7, 28, st, { roof: 'flat' });      // the water gate
    k.houses(k.ringPts(-260, -160, 110, 8, 0.2), 22, [C('#8a7460'), C('#9a846c')], [THATCH, roof], { inset: 5, gap: 0.3, h0: 3.5, h1: 3, style: 'village' });
  },

  twins(k) {
    const st = C('#77746c'), roof = SLATE;
    // find the river crossing direction: scan for the bank on each side
    let best = 0, bs = -1; for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI; let s = 0; for (const d of [-150, 150]) s += k.field.riverAt(k.ox + Math.cos(a) * d, k.oz + Math.sin(a) * d) < 0.3 ? 1 : 0; let mid = 0; for (const d of [-40, 0, 40]) mid += k.field.riverAt(k.ox + Math.cos(a) * d, k.oz + Math.sin(a) * d) > 0.4 ? 1 : 0; if (s * 3 + mid > bs) { bs = s * 3 + mid; best = a; } }
    const ca = Math.cos(best), sa = Math.sin(best);
    for (const sd of [-1, 1]) {
      const cx = ca * sd * 170, cz = sa * sd * 170;
      const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [cx + (u * ca - v * sa) * 52, cz + (u * sa + v * ca) * 52]);
      k.wallLoop(pts, 20, 6, st, { tower: { r: 9, h: 32, roof: 'cone', roofColor: roof }, gates: [sd > 0 ? 3 : 1] });
      k.keep(cx, cz, 44, 40, 40, -best, st, { roof: 'pyramid', roofColor: roof, turrets: 6 });
    }
    const yd = Math.max(k.gs(ca * 120, sa * 120), k.gs(-ca * 120, -sa * 120)) + 9;
    k.bridge(-ca * 120, -sa * 120, ca * 120, sa * 120, 11, yd, st, 7);
    k.tower(0, 0, 9, yd - k.gs(0, 0) + 34, st, { y: k.gs(0, 0), roof: 'cone', roofColor: roof, depth: 12 });   // the Water Tower
  },

  moatcailin(k) {
    const st = C('#33382f'), moss = C('#3e4a2c');
    const t1 = k.tower(-60, 20, 13, 30, st, { roof: 'none', taper: 0.84 });      // Gatehouse Tower
    k.cyl(60, k.gs(60, -30) - 5, -30, 12, 9, 36, 12, 'stone', moss, { tiltX: 9, tiltZ: -4 });     // Drunkard's Tower, leaning
    const t3 = k.tower(10, 90, 8, 54, st, { roof: 'none', taper: 0.8 });         // Children's Tower
    for (const [x, z, y, r] of [[-60, 20, t1, 12], [10, 90, t3, 6.5]]) for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + 0.4; k.box(x + Math.cos(a) * r * 0.8, y, z + Math.sin(a) * r * 0.8, 3, 2 + k.rnd() * 7, 2.4, -a, 'stone', st); }
    for (let i = 0; i < 34; i++) { const a = k.rnd() * TAU, r = 30 + k.rnd() * 170; const x = Math.cos(a) * r, z = Math.sin(a) * r; k.box(x, k.gs(x, z) - 2, z, 4 + k.rnd() * 9, 2 + k.rnd() * 5, 4 + k.rnd() * 6, k.rnd() * 3, 'stone', shade(i % 3 ? st : moss, 0.7 + k.rnd() * 0.5)); }
  },

  // a village: two rows of cottages along a lane, an inn, a small sept, a well and haystacks
  village(k, lm) {
    const north = lm.lat < 0.44, dorne = lm.region === 'Dorne';
    const ang = k.rnd() * Math.PI, ca = Math.cos(ang), sa = Math.sin(ang);
    const wallsC = dorne ? [C('#d8be90'), C('#cfae7c')] : north ? [C('#b8b0a2'), C('#a89c8c')] : [C('#e0d8c4'), C('#d2c4a4'), C('#e8e0d0')];
    const n = 5 + Math.floor(k.rnd() * 5), pitch = 12.5;
    const at = (lx, lz) => [lx * ca + lz * sa, -lx * sa + lz * ca];
    for (let i = 0; i < n; i++) for (const side of [-1, 1]) {
      if (k.rnd() < 0.14) continue;
      const lx = (i - (n - 1) / 2) * pitch + (k.rnd() - 0.5) * 3, lz = side * (9.5 + k.rnd() * 3) + Math.sin(i * 0.9) * 3;
      const [x, z] = at(lx, lz);
      if (k.field.slopeAt(k.ox + x, k.oz + z) > 0.3) continue;
      const mid = i === Math.floor(n / 2) && side === 1;
      k.house(x, z, 8, 6, 5, ang + (side < 0 ? 0 : Math.PI) + (k.rnd() - 0.5) * 0.25, wallsC[(k.rnd() * wallsC.length) | 0], THATCH, { style: dorne ? 'city' : north ? 'north' : 'village', flat: dorne, type: mid && !dorne ? 'inn' : undefined, scale: 0.9 + k.rnd() * 0.25 });
    }
    // outlying crofts
    for (let i = 0; i < 4; i++) { const a = k.rnd() * TAU, r = 60 + k.rnd() * 45; const x = Math.cos(a) * r, z = Math.sin(a) * r; if (k.field.slopeAt(k.ox + x, k.oz + z) < 0.25) k.house(x, z, 8, 6, 5, k.rnd() * TAU, wallsC[0], THATCH, { style: dorne ? 'city' : north ? 'north' : 'village', flat: dorne }); }
    // sept and well at the head of the lane
    const [sx, sz] = at(-(n / 2) * pitch - 12, 0);
    if (k.g(sx, sz) > 1) { k.tower(sx, sz, 4.6, 7.5, dorne ? C('#d8be90') : C('#cfc8b8'), { roof: dorne ? 'dome' : 'cone', roofColor: dorne ? C('#c9a050') : SLATE, roofH: 7, sides: 7, windows: false, depth: 2 }); }
    const [wx, wz] = at(0, 0); const gw = k.g(wx, wz);
    if (gw > 1) { k.cyl(wx, gw - 0.5, wz, 1.3, 1.3, 1.4, 8, 'stone', C('#8a8478')); k.cone(wx, gw + 2.6, wz, 1.5, 1.2, 6, 'roof', C('#5a4630')); for (const s of [-1, 1]) k.cyl(wx + s * 1.1, gw, wz, 0.12, 0.12, 2.7, 4, 'plain', C('#3a2a1c'), { noAO: true }); }
    if (!dorne) for (let i = 0; i < 7; i++) { const a = k.rnd() * TAU, r = 28 + k.rnd() * 50; const x = Math.cos(a) * r, z = Math.sin(a) * r, g = k.g(x, z); if (g > 1 && k.field.slopeAt(k.ox + x, k.oz + z) < 0.2) k.dome(x, g - 0.2, z, 1.7 + k.rnd() * 0.8, 'plain', shade(C('#b89a52'), 0.8 + k.rnd() * 0.4), 1.25, 7, 3); }
  },

  // ------------------------------------------------------------ generic sites
  castle(k, lm) {
    const styles = {
      north: { st: C('#6e7074'), roof: SNOWROOF, n: 8, r: 80, kh: 30 }, dread: { st: C('#3a3436'), roof: C('#1e1a1c'), n: 9, r: 90, kh: 44 },
      wood: { st: C('#4a3a2a'), roof: SNOWROOF, n: 10, r: 70, kh: 18 }, watch: { st: C('#58585a'), roof: SNOWROOF, n: 6, r: 60, kh: 26 },
      river: { st: C('#8a8474'), roof: SLATE, n: 8, r: 85, kh: 32 }, pale: { st: C('#d8d2c4'), roof: C('#7a6aa0'), n: 8, r: 80, kh: 38 },
    };
    const s = styles[lm.style] || styles.north;
    k.wallLoop(k.ringPts(0, 0, s.r, s.n, 0.1, 0.9), 15, 5, s.st, { tower: { r: 7, h: 26, roof: lm.style === 'dread' ? 'spikes' : 'cone', roofColor: s.roof, spikes: 6, spikeH: 1.4 }, gates: [1] });
    k.keep(0, 0, 36, 30, s.kh, k.rnd(), s.st, { roof: lm.style === 'dread' ? 'pyramid' : 'gable', roofColor: s.roof, turrets: 5 });
    k.tower(s.r * 0.45, -s.r * 0.3, 7.5, s.kh + 16, s.st, { roof: lm.style === 'dread' ? 'spikes' : 'cone', roofColor: s.roof, spikes: 6, spikeH: 1.5 });
    k.keep(-s.r * 0.4, s.r * 0.35, 30, 14, 11, 0.6, s.st, { roof: 'gable', roofColor: s.roof });
    k.houses(k.ringPts(s.r * 2.1, s.r * 0.6, s.r * 1.1, 8, 0.25), 22, [C('#6a5e50'), C('#766a5a'), C('#5c5248')], [THATCH, s.roof], { inset: 5, gap: 0.3, h0: 3.5, h1: 3, style: 'village' });
    if (lm.id === 'eastwatch') harbor(k, 110, 3);
  },
  town(k, lm) {
    const styles = {
      white: { st: C('#e2e0da'), walls: [C('#e6e4de'), C('#d8d6d0'), C('#f0eee8')], roofs: [C('#5a7a8a'), SLATE, C('#6a8a9a')] },
      gold: { st: C('#c8ac7c'), walls: [C('#dcc8a0'), C('#d0b888'), C('#e4d4b4')], roofs: [C('#9a3a24'), TERRA, C('#b85a34')] },
      grey: { st: C('#8e8a82'), walls: [C('#b0a898'), C('#9c9488'), C('#c0b8a8')], roofs: [SLATE, C('#7a5444'), C('#5c5450')] },
    };
    const s = styles[lm.style] || styles.grey; const R = lm.r * 0.82;
    const walls = k.ringPts(0, 0, R, 14, 0.08, 0.9);
    k.wallLoop(walls, 13, 5, s.st, { tower: { r: 6.5, h: 20, roof: 'cone', roofColor: s.roofs[0] }, gates: [2, 9] });
    k.houses(walls, 20, s.walls, s.roofs, { inset: 16, gap: 0.14, h0: 4.5, h1: 7, rotJ: 0.7, filter: (x, z) => Math.hypot(x, z) > R * 0.2 && Math.abs(x - z * 0.3) > 8 });
    k.keep(0, 0, 44, 34, 34, 0.3, s.st, { roof: 'gable', roofColor: s.roofs[0], turrets: 6 });
    k.tower(R * 0.12, -R * 0.1, 8, 56, s.st, { roof: 'cone', roofColor: s.roofs[0] });
    harbor(k, R, 6);
  },
  ruin(k) {
    const wood = C('#1e1a16'), st = C('#4a4a4c');
    for (let i = 0; i < 60; i++) { const a = k.rnd() * TAU, r = 20 + k.rnd() * 180; const x = Math.cos(a) * r, z = Math.sin(a) * r, g = k.g(x, z); if (g < 0.8) continue; if (i % 3 === 0) k.box(x, g - 1, z, 6 + k.rnd() * 8, 1.5 + k.rnd() * 3, 0.8, k.rnd() * 3, 'stone', st); else k.cyl(x, g - 1, z, 0.35, 0.2, 3 + k.rnd() * 6, 5, 'plain', wood, { tiltX: (k.rnd() - 0.5) * 2, tiltZ: (k.rnd() - 0.5) * 2 }); }
  },
  fist(k) {
    const st = C('#5a5c60');
    for (let i = 0; i < 44; i++) { if (i % 11 === 0) continue; const a = (i / 44) * TAU, x = Math.cos(a) * 118, z = Math.sin(a) * 118; k.box(x, k.gs(x, z) - 2, z, 14, 5 + k.rnd() * 3, 5, -a + Math.PI / 2, 'stone', shade(st, 0.8 + k.rnd() * 0.4)); }
    for (let i = 0; i < 9; i++) { const a = (i / 9) * TAU, x = Math.cos(a) * 30, z = Math.sin(a) * 30; k.box(x, k.gs(x, z) - 2, z, 3, 8 + k.rnd() * 4, 2.4, -a, 'stone', st); }
  },
};

// ------------------------------------------------------------------ the Wall
function buildWall(field) {
  const pts = smoothLine(WALL, 0, 1).map(p => toWorld(p[0], p[1]));
  // resample every ~70 m
  const path = []; let acc = 0; path.push(pts[0]);
  for (let i = 1; i < pts.length; i++) { acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (acc >= 70) { path.push(pts[i]); acc = 0; } }
  const n = path.length;
  // smoothed ground profile so the top stays nearly level
  const ground = path.map(p => Math.max(field.heightAt(p[0], p[1]), 0));
  const sm = ground.map((_, i) => { let s = 0, c = 0; for (let j = -14; j <= 14; j++) { const q = Math.min(n - 1, Math.max(0, i + j)); s += ground[q]; c++; } return s / c; });
  const H = 215;
  const P = [], N = [], U = [], Cc = [], idx = [];
  const prof = [[-34, -1], [-26, 0.32], [-17, 0.72], [-13, 1.0], [13, 1.0], [17, 0.72], [26, 0.32], [34, -1]];  // across (m), height fraction (-1 = buried base)
  for (let i = 0; i < n; i++) {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(n - 1, i + 1)]; const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l, nz = dx / l;      // across direction (north/south)
    const top = sm[i] + H + Math.sin(i * 0.37) * 3 + Math.sin(i * 1.3) * 1.5;
    const taper = Math.min(1, Math.min(i, n - 1 - i) / 6);          // sink into the terrain at both ends
    for (let j = 0; j < prof.length; j++) {
      const [off, f] = prof[j]; const wob = Math.sin(i * 0.9 + j * 1.7) * 2.2 + Math.sin(i * 0.23 + j) * 3;
      const x = path[i][0] + nx * (off + (f < 1 && f > -1 ? wob : 0)), z = path[i][1] + nz * (off + (f < 1 && f > -1 ? wob : 0));
      const gy = Math.min(ground[i], field.heightAt(x, z));
      const y = f < 0 ? gy - 30 : gy + (top - gy) * f * taper;
      P.push(x, y, z); U.push(i * 0.35, (y - sm[i]) / 60);
      const t = Math.max(0, f); const v = 0.86 + 0.14 * Math.sin(i * 2.1 + j * 0.7);
      Cc.push((0.50 + 0.26 * t) * v, (0.63 + 0.24 * t) * v, (0.74 + 0.2 * t) * v);
    }
  }
  const m = prof.length;
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < m - 1; j++) { const a = i * m + j, b = a + 1, c = a + m, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3));
  g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
  // streaked ice texture
  const cv = document.createElement('canvas'); cv.width = cv.height = 512; const ctx = cv.getContext('2d');
  ctx.fillStyle = '#c8d8e4'; ctx.fillRect(0, 0, 512, 512);
  let seed = 3; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 900; i++) { const x = rnd() * 512, w = 1 + rnd() * 5, v = 150 + rnd() * 105; ctx.fillStyle = `rgba(${v - 20},${v},${Math.min(255, v + 18)},${0.12 + rnd() * 0.3})`; ctx.fillRect(x, rnd() * 512, w, 60 + rnd() * 400); }
  for (let i = 0; i < 60; i++) { ctx.fillStyle = `rgba(90,120,150,${0.1 + rnd() * 0.2})`; ctx.fillRect(0, rnd() * 512, 512, 1 + rnd() * 3); }
  const tex = new THREE.CanvasTexture(cv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const mat = patchAtmosphere(new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, roughness: 0.34, metalness: 0.0, emissive: 0x7fa6c4, emissiveIntensity: 0.0, side: THREE.DoubleSide }), null, 'wall');
  const mesh = new THREE.Mesh(g, mat); mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'theWall';
  return mesh;
}

export class Landmarks {
  constructor(field) {
    this.group = new THREE.Group(); this.sites = [];
    kitMaterials(); upgradeKitTextures();
    let seed = 1;
    for (const lm of LANDMARKS) {
      const [x, z] = toWorld(lm.pos[0], lm.pos[1]);
      const k = new Kit(field, x, z, seed++);
      const fn = BUILD[lm.kind]; if (!fn) continue;
      try { fn(k, lm); } catch (e) { console.error('landmark failed', lm.id, e); }
      const g = k.build(lm.id);
      this.group.add(g);
      this.sites.push({ lm, x, z, y: field.surfaceAt(x, z), group: g, radius: g.userData.radius, pave: g.userData.pave, avoid: ((k.userData && k.userData.avoid) || []).map(a => ({ ...a, x: x + a.x, z: z + a.z })), clearings: ((k.userData && k.userData.life && k.userData.life.clearings) || []).map(c => ({ x: x + c[0], z: z + c[1], r: c[2] })), beacon: k.userData && k.userData.beacon ? new THREE.Vector3(x + k.userData.beacon[0], k.userData.beacon[1], z + k.userData.beacon[2]) : null });
    }
    // villages
    VILLAGES.forEach(([name, vx, vy], i) => {
      const [x, z] = toWorld(vx, vy);
      if (field.heightAt(x, z) < 2.5 || field.riverAt(x, z) > 0.3 || field.slopeAt(x, z) > 0.28) return;
      const region = regionAt(x, z);
      const lm = { id: 'v_' + name.toLowerCase().replace(/[^a-z]/g, ''), name, sub: 'Village of ' + region.replace(/^The /, 'the '), region, pos: [vx, vy], r: 95, kind: 'village', minor: true, lat: vy / 200 };
      const k = new Kit(field, x, z, 500 + i);
      try { BUILD.village(k, lm); } catch (e) { console.error('village failed', name, e); }
      const g = k.build(lm.id); this.group.add(g);
      this.sites.push({ lm, x, z, y: field.surfaceAt(x, z), group: g, radius: g.userData.radius, beacon: null });
    });
    this.wall = WALL.some(([x, y]) => inRegion(x, y)) ? buildWall(field) : null; if (this.wall) this.group.add(this.wall);
    this.mats = kitMaterials();
  }
  // where the ground should read as trodden earth and cobbles: one world-wide mask (R8, ~20 m / texel), drawn from each
  // site's own shapes (walled-town polygons) or a default disc by kind. 1 = cobbled city, ~0.5 = village lane / castle yard.
  pavingMap(W, H) {
    const PW = 2048, PH = Math.round(2048 * H / W); const cv = document.createElement('canvas'); cv.width = PW; cv.height = PH; const ctx = cv.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, PW, PH); ctx.filter = 'blur(1.6px)';
    const X = (x) => (x / W + 0.5) * PW, Z = (z) => (z / H + 0.5) * PH; const col = (s) => { const v = Math.round(s * 255); return `rgb(${v},${v},${v})`; };
    const disc = (x, z, r, s) => { ctx.fillStyle = col(s); ctx.beginPath(); ctx.ellipse(X(x), Z(z), r / W * PW, r / H * PH, 0, 0, TAU); ctx.fill(); };
    const order = [...this.sites].sort((a, b) => (a.lm.kind === 'village' ? 0 : 1) - (b.lm.kind === 'village' ? 0 : 1));
    for (const s of order) {
      const kd = s.lm.kind; let drew = false;
      for (const p of s.pave || []) {
        if (p.poly) { ctx.fillStyle = col(p.s); ctx.beginPath(); p.poly.forEach((q, i) => (i ? ctx.lineTo(X(s.x + q[0]), Z(s.z + q[1])) : ctx.moveTo(X(s.x + q[0]), Z(s.z + q[1])))); ctx.closePath(); ctx.fill(); drew = true; }
        else if (p.c) { disc(s.x + p.c[0], s.z + p.c[1], p.r, p.s); drew = true; }
      }
      if (kd === 'village') disc(s.x, s.z, 66, 0.5);
      else if (!drew && ['winterfell', 'castle', 'riverrun', 'highgarden', 'harrenhal', 'stormsend', 'dragonstone', 'castleblack', 'twins', 'moatcailin'].includes(kd)) disc(s.x, s.z, s.lm.r * 0.5, 0.55);
    }
    const img = ctx.getImageData(0, 0, PW, PH).data; const data = new Uint8Array(PW * PH); for (let i = 0; i < data.length; i++) data[i] = img[i * 4];
    const tex = new THREE.DataTexture(data, PW, PH, THREE.RedFormat, THREE.UnsignedByteType); tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = true; tex.needsUpdate = true;
    const at = (x, z) => { const px = Math.floor(X(x)), pz = Math.floor(Z(z)); return px < 0 || pz < 0 || px >= PW || pz >= PH ? 0 : data[pz * PW + px] / 255; };
    this.paveAt = at;
    return { tex, at };
  }
  update(camPos) {
    this.mats.update();
    // ice glows faintly with scattered daylight, so the shaded north face is never navy-black
    if (this.wall) this.wall.material.emissiveIntensity = 0.03 + 0.42 * Math.min(1, G.uAmbSky.value.b / 0.8);
    // hide far-away sites entirely (they are below pixel size and still cost draw calls)
    for (const s of this.sites) {
      const d = Math.hypot(s.x - camPos.x, s.z - camPos.z); s.group.visible = d < 26000 + s.radius; s.dist = d;
      const props = s.group.userData.props;       // small street props are dropped long before the buildings are
      if (props && s.group.visible) for (const m of props) { const b = m.boundingSphere; m.visible = Math.hypot(s.x + b.center.x - camPos.x, b.center.y - camPos.y, s.z + b.center.z - camPos.z) - b.radius < m.userData.cull; }    }
  }
}
