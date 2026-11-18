// Street life for a planned city: market stalls on the squares, carts and townsfolk along the avenues, banners at the gates
// and on the wall towers, cranes, cargo and boats on the waterfront, a pavilion camp outside the walls. Everything is an
// instance from the prop kit (tools/blender/props_kit.py), placed with its own random stream so the buildings never move.
import { mulberry32 } from '../core/noise.js';
import { lineDist } from './cityplan.js';

const TAU = Math.PI * 2;
const GARB = [[0.55, 0.42, 0.3], [0.42, 0.36, 0.3], [0.62, 0.58, 0.5], [0.36, 0.42, 0.3], [0.5, 0.26, 0.2], [0.3, 0.36, 0.48], [0.7, 0.62, 0.42], [0.28, 0.26, 0.26], [0.75, 0.72, 0.66], [0.45, 0.3, 0.42]];
const COATS = [[0.42, 0.26, 0.15], [0.3, 0.2, 0.13], [0.16, 0.13, 0.11], [0.7, 0.66, 0.6], [0.55, 0.4, 0.25]];
const PAVILION = [[0.75, 0.14, 0.12], [0.85, 0.68, 0.2], [0.2, 0.32, 0.6], [0.9, 0.88, 0.8], [0.2, 0.45, 0.25], [0.5, 0.2, 0.5]];
const CRIMSON = [0.6, 0.07, 0.06], GOLD = [0.9, 0.68, 0.18];
const STALLS = ['stall_a', 'stall_b', 'stall_c'];

// o: { markets: [[x, z, r]] big squares, squares: [[x, z, r]] small ones, roads: [{ pts, hw }], center: [x, z], gates: [[x, z]],
//      towers: [[x, z]] wall towers that fly a flag, towerTop: metres from the ground to a tower's roof,
//      piers: [{ x, z, len, y }] running east-west, shore(z) → x of the waterline, shoreZ: [z0, z1] where boats lie inshore,
//      camps: [[x, z, dx, dz]] candidate sites outside the walls (dx, dz points away from the city); the first level one is used }
// Returns { count: { type: n }, clearings: [[x, z, r]] ground the forest should keep off }, or null without the kit.
export function livenCity(k, o) {
  if (!k.hasProp('stall_a')) return null;
  const rnd = mulberry32(o.seed ?? 4242), count = {}, clearings = [], roads = o.roads || [], C = o.center || [0, 0];
  // What stands in a walker's way: houses and the solid props, as boxes in a coarse grid.
  const CELL = 12, grid = new Map(), SOLID = /^(stall|cart|barrels|well|tent|crane|horse)/;
  const block = (x, z, rot, hx, hz) => {
    const o = { x, z, c: Math.cos(rot), s: Math.sin(rot), hx, hz }, r = Math.hypot(hx, hz) + 1.5;
    for (let ix = Math.floor((x - r) / CELL); ix <= Math.floor((x + r) / CELL); ix++) for (let iz = Math.floor((z - r) / CELL); iz <= Math.floor((z + r) / CELL); iz++) { const key = (ix + 4096) * 8192 + iz + 4096; let l = grid.get(key); if (!l) grid.set(key, l = []); l.push(o); }
  };
  const blocked = (x, z, m = 0.5) => {
    const l = grid.get((Math.floor(x / CELL) + 4096) * 8192 + Math.floor(z / CELL) + 4096); if (!l) return false;
    for (const o of l) { const dx = x - o.x, dz = z - o.z; if (Math.abs(dx * o.c - dz * o.s) < o.hx + m && Math.abs(dx * o.s + dz * o.c) < o.hz + m) return true; }
    return false;
  };
  const put = (type, x, z, rot, opt) => {
    if (!k.prop(type, x, z, rot, opt)) return false;
    count[type] = (count[type] || 0) + 1;
    if (SOLID.test(type)) { const m = k.propMeta(type), sc = (opt && opt.scale) || 1; block(x, z, rot, m.w * sc / 2, m.d * sc / 2); }
    return true;
  };
  const pickc = (list) => list[(rnd() * list.length) | 0];
  const face = (dx, dz) => Math.atan2(dx, dz);          // turn a prop's front (local +Z) toward (dx, dz)
  const along = (dx, dz) => Math.atan2(-dz, dx);        // lay a prop's length (local +X) along (dx, dz)
  const onRoad = (x, z, m = 0) => { for (const rd of roads) if (lineDist(x, z, rd.pts) < rd.hw + m) return true; return false; };
  const level = (x, z, r, tol = 1) => { const g = k.g(x, z); return g > 2 && Math.abs(k.g(x + r, z) - g) < tol && Math.abs(k.g(x - r, z) - g) < tol && Math.abs(k.g(x, z + r) - g) < tol && Math.abs(k.g(x, z - r) - g) < tol; };
  // Townsfolk: every character the kit holds (person_a, person_b…). Modelled characters keep their own clothes, vary only in
  // size and brightness, and are animated: idling, talking, or walking a beat (settled at the end, once everything that
  // could be in the way has been placed). The grey stand-ins are dyed from GARB and stand still.
  const PEOPLE = ['a', 'b', 'c', 'd'].map((c) => 'person_' + c).filter((t) => k.hasProp(t)), walkers = [];
  // o: { pose: 'stand' | 'walk' | 'talk', rot: the way they face (random if left out), y: a deck to stand on instead of the
  //      ground, back / ahead: how far a walker may go each way, within: [x, z, r] a circle a walker keeps inside }
  const person = (x, z, o = {}) => {
    const type = pickc(PEOPLE), rot = o.rot ?? rnd() * TAU, opt = { tint: pickc(GARB), shade: 0.84 + rnd() * 0.3, scale: 0.94 + rnd() * 0.12, y: o.y };
    if (o.pose !== 'walk' || !k.propAnimated(type)) return put(type, x, z, rot, { ...opt, anim: { clip: o.pose === 'talk' ? 'talk' : 'idle', phase: rnd(), rate: 0.8 + rnd() * 0.5 } });
    let back = o.back ?? 6 + rnd() * 14, ahead = o.ahead ?? 6 + rnd() * 14;
    if (o.within) {
      const [cx, cz, R] = o.within, px = x - cx, pz = z - cz, b = px * Math.sin(rot) + pz * Math.cos(rot), c = px * px + pz * pz - R * R;
      if (c > 0) back = ahead = 0; else { const q = Math.sqrt(b * b - c); ahead = Math.min(ahead, q - b); back = Math.min(back, q + b); }
    }
    walkers.push({ type, x, z, rot, opt, back, ahead, flat: o.y !== undefined, speed: (1.0 + rnd() * 0.4) * (type === 'person_d' ? 0.72 : 1), phase: rnd() });
    return true;
  };
  // a loose crowd: some stand about, some are on their way somewhere, and now and then two have stopped to talk face to face
  const folk = (x, z, r, n) => {
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU, d = Math.sqrt(rnd()) * r, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d, u = rnd();
      if (u < 0.28 && i + 1 < n) { const b = rnd() * TAU, ox = Math.sin(b) * 0.5, oz = Math.cos(b) * 0.5; person(px - ox, pz - oz, { pose: 'talk', rot: b }); person(px + ox, pz + oz, { pose: rnd() < 0.4 ? 'talk' : 'stand', rot: b + Math.PI }); i++; }
      else person(px, pz, { pose: u < 0.58 ? 'walk' : 'stand', within: [x, z, r] });
    }
  };
  // customers at a stall whose front faces (dx, dz): turned toward the counter, one or two of them haggling
  const shoppers = (x, z, dx, dz, n) => { for (let i = 0; i < n; i++) { const a = rnd() * TAU, d = Math.sqrt(rnd()) * 1.7; person(x + Math.cos(a) * d, z + Math.sin(a) * d, { pose: rnd() < 0.45 ? 'talk' : 'stand', rot: face(-dx, -dz) + (rnd() - 0.5) * 1.1 }); } };
  const stallW = Math.max(...STALLS.map((t) => { const m = k.propMeta(t); return m ? Math.max(m.w, m.d) : 4; })) + 1.3;

  // a ring of stalls round a square, fronts toward the shoppers, the avenues left clear
  const stallRing = (cx, cz, r, inward) => {
    const n = Math.floor(TAU * r / stallW), a0 = rnd() * TAU;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * TAU, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (rnd() < 0.14 || onRoad(x, z, 2) || !level(x, z, 2.5)) continue;
      const dx = inward ? -Math.cos(a) : Math.cos(a), dz = inward ? -Math.sin(a) : Math.sin(a);
      if (!put(pickc(STALLS), x, z, face(dx, dz) + (rnd() - 0.5) * 0.16, { shade: 0.9 + rnd() * 0.2 })) continue;
      shoppers(x + dx * 3, z + dz * 3, dx, dz, 1 + ((rnd() * 3) | 0));
      if (rnd() < 0.3) put('barrels', x - dx * 2.6 - dz * 1.5, z - dz * 2.6 + dx * 1.5, rnd() * TAU);
    }
  };
  for (const [x, z, r] of o.markets || []) {
    if (r >= 30) stallRing(x, z, r * 0.42, false);
    stallRing(x, z, r * 0.74, true);
    folk(x, z, r * 0.9, Math.round(r * 1.5));
    for (let i = 0; i < 8; i++) { const a = (i + 0.5) / 8 * TAU, bx = x + Math.cos(a) * r * 0.95, bz = z + Math.sin(a) * r * 0.95; if (!onRoad(bx, bz, 2)) put('banner', bx, bz, face(-Math.cos(a), -Math.sin(a)), { tint: i % 2 ? GOLD : CRIMSON }); }
  }
  for (const [x, z, r] of o.squares || []) {
    if (!onRoad(x, z, 2.5) && level(x, z, 2)) put('well', x, z, rnd() * TAU);
    stallRing(x, z, r * 0.62, true);
    folk(x, z, r * 0.85, 8 + ((rnd() * 8) | 0));
  }
  // the avenues: people walking, a cart drawn up at the kerb every so often, sometimes with its horse
  for (const rd of roads) {
    for (let i = 0; i < rd.pts.length - 1; i++) {
      const a = rd.pts[i], b = rd.pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
      for (let t = rnd() * 6; t < L; t += 4 + rnd() * 9) {
        const off = (rnd() * 2 - 1) * (rd.hw - 0.8), x = a[0] + ux * t - uz * off, z = a[1] + uz * t + ux * off;
        const hd = rnd() < 0.5 ? 1 : -1, rot = face(ux * hd, uz * hd);      // walking up or down the street, as far as this stretch of it runs
        const beat = { pose: 'walk', rot, ahead: Math.min((hd > 0 ? L - t : t) - 1, 10 + rnd() * 26), back: Math.min((hd > 0 ? t : L - t) - 1, 10 + rnd() * 26) };
        person(x, z, beat); if (rnd() < 0.3) person(x - uz * (0.55 + rnd() * 0.3), z + ux * (0.55 + rnd() * 0.3), beat);
      }
      for (let t = 15 + rnd() * 50; t < L - 10; t += 55 + rnd() * 70) {
        const sd = rnd() < 0.5 ? 1 : -1, hd = rnd() < 0.5 ? 1 : -1, off = sd * (rd.hw - 1.7), x = a[0] + ux * t - uz * off, z = a[1] + uz * t + ux * off;
        if (!level(x, z, 2, 1.4) || !put('cart', x, z, along(ux * hd, uz * hd) + (rnd() - 0.5) * 0.2)) continue;
        if (rnd() < 0.65) put('horse', x + ux * hd * 3.5, z + uz * hd * 3.5, along(ux * hd, uz * hd), { tint: pickc(COATS) });
        if (rnd() < 0.5) put('barrels', x - ux * hd * 3.2, z - uz * hd * 3.2, rnd() * TAU);
      }
    }
  }
  // gates: a pair of banners and a few guards just inside each
  for (const [gx, gz] of o.gates || []) {
    const l = Math.hypot(C[0] - gx, C[1] - gz) || 1, dx = (C[0] - gx) / l, dz = (C[1] - gz) / l;
    for (const sd of [-1, 1]) { const x = gx + dx * 16 - dz * sd * 10, z = gz + dz * 16 + dx * sd * 10; put('banner', x, z, face(dx, dz), { tint: sd > 0 ? CRIMSON : GOLD }); person(x + dx * 1.5, z + dz * 1.5, { pose: 'stand', rot: face(-dx, -dz) + (rnd() - 0.5) * 0.5 }); }
    folk(gx + dx * 24, gz + dz * 24, 9, 5);
  }
  // a flag on the roof of every other wall tower
  (o.towers || []).forEach(([x, z], i) => put('banner', x, z, rnd() * TAU, { y: k.gs(x, z) + (o.towerTop ?? 22), scale: 1.7, tint: i % 2 ? GOLD : CRIMSON }));
  // the waterfront: cargo and dockers on the piers, a crane at every third, rowing boats alongside and inshore
  (o.piers || []).forEach((p, i) => {
    for (let j = 0; j < 3; j++) put('barrels', p.x + (rnd() - 0.5) * p.len * 0.8, p.z + (rnd() - 0.5) * 2.2, rnd() * TAU, { y: p.y });
    for (let j = 0; j < 5; j++) {       // dockers: some carrying on up and down the pier
      const x = p.x + (rnd() - 0.5) * p.len * 0.9, z = p.z + (rnd() - 0.5) * 3.4, hd = rnd() < 0.5 ? 1 : -1;
      if (rnd() < 0.5) person(x, z, { y: p.y, pose: 'walk', rot: face(hd, 0), ahead: (hd > 0 ? p.x + p.len / 2 - x : x - (p.x - p.len / 2)) - 1.5, back: (hd > 0 ? x - (p.x - p.len / 2) : p.x + p.len / 2 - x) - 1.5 });
      else person(x, z, { y: p.y });
    }
    for (const sd of [-1, 1]) if (rnd() < 0.7) put('boat', p.x + (rnd() - 0.3) * p.len * 0.6, p.z + sd * 5.2, along(1, 0) + (rnd() - 0.5) * 0.3, { water: true });
    const qx = p.x - p.len / 2 - 6;
    if (i % 3 === 0) put('crane', qx, p.z + 10, (rnd() - 0.5) * 0.4);
    for (let j = 0; j < 2; j++) put('barrels', qx - rnd() * 10, p.z + (rnd() - 0.5) * 24, rnd() * TAU);
    folk(qx - 6, p.z, 12, 4);
  });
  if (o.shore && o.shoreZ) for (let i = 0; i < 22; i++) { const z = o.shoreZ[0] + rnd() * (o.shoreZ[1] - o.shoreZ[0]); put('boat', o.shore(z) + 12 + rnd() * 110, z, rnd() * TAU, { water: true }); }
  // a pavilion camp on the first level field outside a gate: two rows of tents, banners, horses, a crowd
  for (const [cx, cz, dx, dz] of o.camps || []) {
    const tx = -dz, tz = dx, at = (u, v) => [cx + tx * u + dx * v, cz + tz * u + dz * v];
    if (![[0, 0], [-36, 0], [36, 0], [-36, 14], [36, 14], [-36, -14], [36, -14]].every(([u, v]) => level(...at(u, v), 6, 1.6))) continue;
    for (let i = 0; i < 6; i++) for (const row of [-1, 1]) {
      const [x, z] = at((i - 2.5) * 13 + (rnd() - 0.5) * 3, row * 12 + (rnd() - 0.5) * 2), col = pickc(PAVILION);
      if (!put('tent', x, z, rnd() * TAU, { tint: col, scale: 0.9 + rnd() * 0.35 })) continue;
      if (rnd() < 0.6) put('banner', x - dx * row * 4.5, z - dz * row * 4.5, face(-dx * row, -dz * row), { tint: col, scale: 0.7 });
    }
    for (let i = 0; i < 9; i++) { const [x, z] = at((rnd() - 0.5) * 80, (rnd() - 0.5) * 8); put('horse', x, z, rnd() * TAU, { tint: pickc(COATS) }); }
    for (let i = 0; i < 2; i++) { const [x, z] = at((i ? 1 : -1) * 44, (rnd() - 0.5) * 10); put('cart', x, z, rnd() * TAU); }
    folk(cx, cz, 38, 55); clearings.push([cx, cz, 62]);
    break;
  }
  // ---- the walkers' beats: as far each way as the ground stays walkable and nothing stands in the way, and only as far as
  // the ground between is near enough a straight slope for the shader to carry them along it
  for (const h of k.hinst) { const m = k.houseMeta(h.type); if (m) block(h.x, h.z, h.rot, m.w * h.sx / 2, m.d * h.sz / 2); }
  const reach = (w, dx, dz, want) => {
    let d = 0, g0 = w.flat ? 0 : k.g(w.x, w.z);
    for (let t = 0.75; t <= want; t += 0.75) {
      const x = w.x + dx * t, z = w.z + dz * t; if (blocked(x, z)) break;
      if (!w.flat) { const g = k.g(x, z); if (g < 0.9 || Math.abs(g - g0) > 0.45) break; g0 = g; }
      d = t;
    }
    d = Math.max(0, d - 0.5); if (w.flat) return [d, 0];
    for (; d > 1.5; d *= 0.6) { const a = k.g(w.x, w.z), b = k.g(w.x + dx * d, w.z + dz * d); if (Math.abs(k.g(w.x + dx * d / 2, w.z + dz * d / 2) - (a + b) / 2) < 0.12) return [d, b - a]; }
    return [0, 0];
  };
  for (const w of walkers) {
    const dx = Math.sin(w.rot), dz = Math.cos(w.rot), [ahead, riseAhead] = reach(w, dx, dz, w.ahead), [back, riseBack] = reach(w, -dx, -dz, w.back);
    put(w.type, w.x, w.z, w.rot, { ...w.opt, anim: ahead + back >= 3 ? { clip: 'walk', speed: w.speed, phase: w.phase, back, ahead, riseBack, riseAhead } : { clip: 'idle', phase: w.phase } });
  }
  return { count, clearings };
}
