// City planner. Streets come from a Voronoi partition of the ground inside the walls: every cell is a city block, the gaps
// between cells are lanes, avenues are forced by seeding mirrored pairs of blocks along them, and squares / precincts are
// kept open by "ghost" cells. Buildings then line each block's perimeter facing the street, shoulder to shoulder, with
// yards, trees and the odd back building inside — the way an old walled town actually grows.

// building mixes per architectural style and district: [type, weight]
const MIX = {
  kl: {
    common: [['kl_house_a', 3], ['kl_house_b', 3], ['kl_house_c', 2.2], ['kl_tenement', 1.6], ['kl_corner', 0.9], ['kl_shop', 2], ['kl_narrow', 2.2], ['kl_inn', 0.35], ['kl_lshape', 0.4]],
    rich: [['kl_manse', 3], ['kl_lshape', 2], ['kl_house_b', 2], ['kl_corner', 1], ['kl_tenement', 0.6]],
    poor: [['kl_hovel', 3], ['kl_hovel_b', 3], ['kl_house_c', 1.2], ['kl_narrow', 1], ['kl_shop', 0.5]],
    harbor: [['kl_warehouse', 2.4], ['kl_hovel_b', 1], ['kl_shop', 1.2], ['kl_house_c', 1.4], ['kl_house_a', 1]],
    civic: [['kl_hall', 2], ['kl_sept', 1.3]], tower: 'kl_tower',
  },
  tudor: {
    common: [['townhouse', 3], ['merchant', 3], ['stonehouse', 1], ['inn', 0.3]],
    rich: [['merchant', 3], ['inn', 1], ['stonehouse', 1.5]],
    poor: [['cottage', 2.4], ['longhouse', 1], ['townhouse', 1.2]],
    harbor: [['longhouse', 1.5], ['stonehouse', 2], ['merchant', 1]],
    civic: [['inn', 1]], tower: null,
  },
  north: {
    common: [['stonehouse', 3], ['loghall', 2], ['cottage', 1.5], ['longhouse', 1], ['merchant', 0.6]],
    rich: [['stonehouse', 2], ['merchant', 1.5], ['inn', 0.6]],
    poor: [['cottage', 2], ['loghall', 2], ['longhouse', 1]],
    harbor: [['longhouse', 2], ['stonehouse', 1.5]],
    civic: [['inn', 1]], tower: null,
  },
  dorne: {
    common: [['mudbrick', 4], ['kl_house_c', 1], ['kl_shop', 1], ['kl_corner', 0.4]],
    rich: [['kl_manse', 1.5], ['mudbrick', 2], ['kl_lshape', 1]],
    poor: [['mudbrick', 3], ['kl_hovel_b', 1]],
    harbor: [['mudbrick', 2], ['kl_warehouse', 1]],
    civic: [['kl_sept', 1], ['kl_hall', 1]], tower: 'kl_tower',
  },
};
// weathered terracotta runs from fresh orange through tan to sooty brown
const ROOF_TINTS = [[1.06, 0.98, 0.9], [1.0, 1.0, 1.0], [0.9, 0.86, 0.8], [1.12, 1.04, 0.9], [0.8, 0.76, 0.72], [1.0, 0.9, 0.82], [0.95, 1.0, 0.94]];

function pick(list, r) { let t = 0; for (const e of list) t += e[1]; let x = r * t; for (const e of list) { x -= e[1]; if (x <= 0) return e[0]; } return list[0][0]; }
function segDist(px, pz, ax, az, bx, bz) { const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1; let t = ((px - ax) * dx + (pz - az) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t; return Math.hypot(px - ax - dx * t, pz - az - dz * t); }
export function lineDist(px, pz, pts) { let d = 1e9; for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, segDist(px, pz, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])); return d; }
export function polyDist(px, pz, pts) { let d = 1e9; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; d = Math.min(d, segDist(px, pz, a[0], a[1], b[0], b[1])); } return d; }
function inside(pts, x, z) { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
// keep the part of polygon `poly` where nx*x + nz*z <= c
function clip(poly, nx, nz, c) {
  const out = []; const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n]; const da = nx * a[0] + nz * a[1] - c, db = nx * b[0] + nz * b[1] - c;
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) { const t = da / (da - db); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}

// o: { poly, style, roads: [{ pts, hw }], plazas: [[x, z, r]], keep(x, z) → bool, district(x, z) → 'common'|'rich'|'poor'|'harbor',
//      cell(x, z) → block size in metres, inset, lane, towers (bell-tower frequency) }
export function planCity(k, o) {
  const rnd = k.rnd, poly = o.poly, style = MIX[o.style || 'kl'], inset = o.inset ?? 14, lane = o.lane ?? 2.3;
  const roads = o.roads || [], plazas = o.plazas || [];
  const cellAt = o.cell || (() => 50), districtAt = o.district || (() => 'common');
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const p of poly) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
  const PAD = 90; x0 -= PAD; x1 += PAD; z0 -= PAD; z1 += PAD;
  // ---------------------------------------------------------------- seeds
  const seeds = []; const HS = 70, hash = new Map();
  const hkey = (x, z) => Math.floor(x / HS) + ',' + Math.floor(z / HS);
  const add = (s) => { s.i = seeds.length; seeds.push(s); const key = hkey(s.x, s.z); let a = hash.get(key); if (!a) hash.set(key, a = []); a.push(s); return s; };
  const near = (x, z, r, fn) => { const c = Math.ceil(r / HS), gx = Math.floor(x / HS), gz = Math.floor(z / HS); for (let i = -c; i <= c; i++) for (let j = -c; j <= c; j++) { const a = hash.get((gx + i) + ',' + (gz + j)); if (a) for (const s of a) fn(s); } };
  const clearOf = (x, z, r) => { let ok = true; near(x, z, r + 150, (s) => { const d = Math.hypot(s.x - x, s.z - z); if (d < (s.R ? s.R + r * 0.5 : r)) ok = false; }); return ok; };
  for (const p of plazas) add({ x: p[0], z: p[1], R: p[2], ghost: true });
  // avenues: mirrored pairs so the block edges run along the road
  roads.forEach((rd, ri) => {
    let acc = 0, next = 6;
    for (let i = 0; i < rd.pts.length - 1; i++) {
      const a = rd.pts[i], b = rd.pts[i + 1]; const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L;
      while (next < acc + L) {
        const t = next - acc, px = a[0] + ux * t, pz = a[1] + uz * t; const cs = cellAt(px, pz); const off = rd.hw + cs * 0.4;
        for (const sd of [-1, 1]) {
          const sx = px - uz * off * sd, sz = pz + ux * off * sd;
          let okp = true; for (const p of plazas) if (Math.hypot(sx - p[0], sz - p[1]) < p[2] + cs * 0.42) okp = false;
          if (okp && clearOf(sx, sz, cs * 0.7)) add({ x: sx, z: sz, cell: cs, road: ri, side: sd, hw: rd.hw });
        }
        next += cs * (0.82 + rnd() * 0.2);
      }
      acc += L;
    }
  });
  // everything else: dart throwing with a local spacing
  const tries = Math.round(((x1 - x0) * (z1 - z0)) / 320);
  for (let t = 0; t < tries; t++) {
    const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0); const cs = cellAt(x, z);
    if (!clearOf(x, z, cs * 0.86)) continue;
    let nr = false; for (const rd of roads) if (lineDist(x, z, rd.pts) < rd.hw + cs * 0.78) { nr = true; break; }
    if (nr) continue;
    add({ x, z, cell: cs, ghost: !inside(poly, x, z) });
  }
  // ---------------------------------------------------------------- blocks
  const usable = (x, z) => inside(poly, x, z) && polyDist(x, z, poly) > inset && (!o.keep || o.keep(x, z));
  const inPlaza = (x, z, m = 0) => { for (const p of plazas) if (Math.hypot(x - p[0], z - p[1]) < p[2] + m) return true; return false; };
  let nb = 0, nblocks = 0;
  const put = (type, x, z, rot, opt) => { if (k.placeHouse(type, x, z, rot, opt)) { nb++; return true; } return false; };
  for (const s of seeds) {
    if (s.ghost) continue;
    const cs = s.cell; let cellPoly = [[s.x - cs * 2.4, s.z - cs * 2.4], [s.x + cs * 2.4, s.z - cs * 2.4], [s.x + cs * 2.4, s.z + cs * 2.4], [s.x - cs * 2.4, s.z + cs * 2.4]];
    const nbs = []; near(s.x, s.z, cs * 3.4, (q) => { if (q !== s) nbs.push(q); });
    nbs.sort((a, b) => Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(b.x - s.x, b.z - s.z));
    for (const q of nbs) {
      const dx = q.x - s.x, dz = q.z - s.z, d = Math.hypot(dx, dz) || 1, nx = dx / d, nz = dz / d;
      let c;
      if (q.R) c = nx * q.x + nz * q.z - q.R - lane;                                  // stay outside a square or precinct
      else { const gap = (s.road !== undefined && q.road === s.road && q.side !== s.side) ? s.hw : lane * (0.75 + ((s.i * 7 + q.i * 13) % 10) * 0.05); c = nx * (s.x + q.x) / 2 + nz * (s.z + q.z) / 2 - gap; }
      cellPoly = clip(cellPoly, nx, nz, c);
      if (cellPoly.length < 3) break;
    }
    if (cellPoly.length < 3) continue;
    // orientation and in-radius
    let area = 0; for (let i = 0; i < cellPoly.length; i++) { const a = cellPoly[i], b = cellPoly[(i + 1) % cellPoly.length]; area += a[0] * b[1] - b[0] * a[1]; }
    if (area < 0) cellPoly.reverse(); area = Math.abs(area) / 2;
    if (area < 90 || area > cs * cs * 6) continue;
    let ccx = 0, ccz = 0; for (const p of cellPoly) { ccx += p[0]; ccz += p[1]; } ccx /= cellPoly.length; ccz /= cellPoly.length;
    let inr = 1e9; for (let i = 0; i < cellPoly.length; i++) { const a = cellPoly[i], b = cellPoly[(i + 1) % cellPoly.length]; inr = Math.min(inr, segDist(ccx, ccz, a[0], a[1], b[0], b[1])); }
    if (!usable(ccx, ccz) && !usable(s.x, s.z)) continue;
    nblocks++;
    const dist = districtAt(ccx, ccz); const mix = style[dist] || style.common;
    if (inr < 5.2) { if (inr > 3 && rnd() < 0.5 && usable(ccx, ccz)) k.yardTree(ccx, ccz, 0.9 + rnd() * 0.3); continue; }   // too small to build: a pocket yard
    const Dref = Math.min(dist === 'poor' ? 6.4 : dist === 'rich' ? 10.5 : 9.2, inr * 0.96);
    const civic = style.civic && inr > 13 && (s.i % (o.civicEvery || 11) === 3);
    const n = cellPoly.length; let prevD = Dref, civicDone = false;
    const hBoost = 1 + (o.tall ? o.tall(ccx, ccz) : 0);
    for (let e = 0; e < n; e++) {
      const a = cellPoly[e], b = cellPoly[(e + 1) % n], pv = cellPoly[(e + n - 1) % n];
      const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz); if (L < 4.5) continue;
      const tx = dx / L, tz = dz / L; let ox = tz, oz = -tx;                                  // outward normal
      if (ox * (a[0] + dx / 2 - ccx) + oz * (a[1] + dz / 2 - ccz) < 0) { ox = -ox; oz = -oz; }
      const p0x = a[0] - pv[0], p0z = a[1] - pv[1], pl = Math.hypot(p0x, p0z) || 1;
      const cosA = (-(p0x / pl) * tx) + (-(p0z / pl) * tz); const alpha = Math.acos(Math.max(-1, Math.min(1, cosA)));
      let u = alpha >= Math.PI / 2 ? prevD * Math.sin(alpha) + 0.2 : prevD / Math.max(0.5, Math.sin(alpha));
      if (alpha < 0.9) u += 2;
      const rot = Math.atan2(ox, oz);
      while (u < L - 2.6) {
        let type = pick(mix, rnd());
        if (civic && !civicDone && L - u > 12) { type = pick(style.civic, rnd()); civicDone = true; }
        let m = k.houseMeta(type); if (!m) break;
        let sx = 0.9 + rnd() * 0.22; let W = m.w * sx; const rem = L - u;
        if (W > rem + 0.6) {
          const f = rem / m.w;
          if (f >= 0.8) { sx = f; W = rem; }
          else { // try something narrower before giving up on this stretch
            let done = false;
            for (const alt of mix) { const am = k.houseMeta(alt[0]); if (am && am.w * 0.82 <= rem) { type = alt[0]; m = am; sx = Math.max(0.82, Math.min(1.15, rem / am.w)); W = am.w * sx; done = true; break; } }
            if (!done) break;
          }
        }
        const sz = Math.max(0.72, Math.min(1.22, Dref / m.d)) * (0.94 + rnd() * 0.12); const D = m.d * sz;
        const set = dist === 'poor' ? rnd() * 0.9 : rnd() * 0.25;
        const px = a[0] + tx * (u + W / 2) - ox * (D / 2 + set), pz = a[1] + tz * (u + W / 2) - oz * (D / 2 + set);
        if (usable(px, pz) && !inPlaza(px, pz, 2)) {
          const sy = (0.9 + rnd() * 0.3) * hBoost * (m.cls === 'civic' ? 1 : 1);
          put(type, px, pz, rot + (rnd() - 0.5) * (dist === 'poor' ? 0.12 : 0.03), { sx, sy, sz, district: dist });
          if (type === 'kl_hall' && style.tower && rnd() < 0.7) put(style.tower, px + tx * (W / 2 + 2.9) - ox * 1.5, pz + tz * (W / 2 + 2.9) - oz * 1.5, rot, { sx: 1, sy: 0.9 + rnd() * 0.25, sz: 1 });
        }
        prevD = D;
        u += W + (rnd() < (dist === 'poor' ? 0.2 : 0.1) ? 1.2 + rnd() * 2.2 : 0.05);
      }
    }
    // the inside of a big block: a back building, a bell tower now and then, trees in the yards
    if (inr > Dref + 8.5) {
      const free = inr - Dref - 3;
      if (rnd() < 0.55) { const type = pick(style.poor || mix, rnd()); const a = rnd() * 6.283, r = rnd() * free * 0.4; if (usable(ccx, ccz)) put(type, ccx + Math.cos(a) * r, ccz + Math.sin(a) * r, rnd() * 6.283, { sx: 0.95, sy: 0.9, sz: 0.95, district: dist }); }
      const nt = 1 + Math.floor(rnd() * 3);
      for (let i = 0; i < nt; i++) { const a = rnd() * 6.283, r = free * (0.45 + rnd() * 0.5); const tx2 = ccx + Math.cos(a) * r, tz2 = ccz + Math.sin(a) * r; if (usable(tx2, tz2)) k.yardTree(tx2, tz2, 0.8 + rnd() * 0.4); }
    }
    if (style.tower && (s.i % (o.towerEvery || 17) === 5) && inr > 9 && usable(ccx, ccz)) put(style.tower, ccx, ccz, rnd() * 6.283, { sx: 1, sy: 0.85 + rnd() * 0.4, sz: 1 });
  }
  return { buildings: nb, blocks: nblocks, seeds: seeds.length };
}
