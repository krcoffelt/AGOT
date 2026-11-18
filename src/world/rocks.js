// Rock outcrops: real geometry on the sea cliffs, crags and rocky shores, so a headland reads as broken limestone rather than
// a smooth painted mound. A handful of procedural rock shapes (a lumpy sphere cut by flat cleavage planes, then squashed
// or stretched) are instanced over steep ground and the waterline, half-buried, in chunks that drop out with distance.
// The surface is the 'rock_face' scan mapped triplanar in world space (no stretching on any instance), bleached toward
// pale limestone, with grass and scrub-green settling on the tops.
import * as THREE from 'three';
import { mergeVertices, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { loadScannedHeadland } from './tidalcoast.js';
import { patchAtmosphere } from '../core/glsl.js';

// sculpted limestone cliff faces (tools/blender/cliff_kit.py): { cliff_0 … cliff_3, cliff_0_lo … } or null
// maquis scrub (tools/blender/scrub_kit.py): domes of leaf cards rendered from a real shrub scan; { hi: [3], lo: [3], map } or null
export async function loadScrubKit() {
  try {
    const [g, map] = await Promise.all([new GLTFLoader().loadAsync('/models/scrub.glb'), new THREE.TextureLoader().loadAsync('/models/scrub_card.png')]);
    map.colorSpace = THREE.SRGBColorSpace; map.flipY = false; map.anisotropy = 4;
    const by = {}; g.scene.traverse(o => { if (o.isMesh) { const geo = o.geometry.clone(); geo.scale(1.9, 1.9, 1.9); by[o.name] = geo; } });
    const ids = [0, 1, 2].filter(i => by['scrub_' + i]);
    return ids.length ? { hi: ids.map(i => by['scrub_' + i]), lo: ids.map(i => by['scrub_' + i + '_lo'] || by['scrub_' + i]), map } : null;
  } catch (e) { console.warn('[scrub] kit not loaded:', e.message); return null; }
}
function scrubMaterial(map) {
  // dark evergreen maquis: the scan's leaves tinted toward olive; cut out by alpha; lit as one soft mass (bent normals)
  const mat = new THREE.MeshStandardMaterial({ map, color: new THREE.Color(0.34, 0.4, 0.25), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.95, metalness: 0 });
  return patchAtmosphere(mat, null, 'scrub');
}

// the Red Keep's headland as one continuous cliff over the game's own terrain (tools/blender/headland_cliff.py):
// { centre: [x, z], parts: [{ geo, map }] } or null
// fallen limestone blocks for the cliff foot (tools/blender/talus_kit.py): ~1 m across, resting on y = 0
export async function loadTalusKit(name = 'talus') {
  try {
    const g = await new GLTFLoader().loadAsync(`/models/${name}.glb`), by = {};
    g.scene.traverse(o => { if (o.isMesh) by[o.name] = o.geometry; });
    const names = Object.keys(by).filter(n => new RegExp(`^${name}_\\d+$`).test(n)).sort();
    const out = names.map(n => by[n]);
    out.lods = names.map(n => [by[n], by[n + '_l1'], by[n + '_l2'], by[n + '_l3']].map(g => g || by[n]));      // 20k / 4k / 1.5k / 220 triangles
    return out.length ? out : null;
  } catch (e) { console.warn('[talus] not loaded:', e.message); return null; }
}

export async function loadHeadland() {
  try { return await loadScannedHeadland(); }
  catch (e) { console.warn('[headland] using legacy sculpt:', e.message); }
  try {
    const [g, meta] = await Promise.all([new GLTFLoader().loadAsync('/models/headland.glb'), fetch('/models/headland.json').then(r => r.json())]);
    const tl = new THREE.TextureLoader(), parts = [];
    const meshes = []; g.scene.traverse(o => { if (o.isMesh) meshes.push(o); });
    const byName = Object.fromEntries(meshes.map(o => [o.name, o]));
    for (const o of meshes) {
      const m = meta[o.name]; if (!m) continue;
      if (!m.map) { parts.push({ name: o.name, geo: o.geometry, mid: m.mid && byName[m.mid] ? byName[m.mid].geometry : null, lo: m.lo && byName[m.lo] ? byName[m.lo].geometry : o.geometry }); continue; }      // the sculpt itself (tools/blender/headland_cliff.py, geometry mode): no maps
      const map = await tl.loadAsync('/models/' + m.map); map.flipY = false; map.colorSpace = THREE.NoColorSpace; map.anisotropy = 8;
      let cav = null;
      if (m.cav) { try { cav = await tl.loadAsync('/models/' + m.cav); cav.flipY = false; cav.colorSpace = THREE.NoColorSpace; cav.anisotropy = 8; } catch (e) { cav = null; } }
      parts.push({ name: o.name, geo: o.geometry, map, cav });
    }
    return parts.length ? { centre: meta._centre, parts } : null;
  } catch (e) { console.warn('[headland] not loaded:', e.message); return null; }
}

// prefers the jointed 3D crags (tools/blender/crag_kit.py); falls back to the cliff-face sheets (cliff_kit.py)
export async function loadCliffKit() {
  for (const kit of ['crags', 'cliffs']) {
    try {
      const [g, meta] = await Promise.all([new GLTFLoader().loadAsync(`/models/${kit}.glb`), fetch(`/models/${kit}.json`).then(r => r.json())]);
      const out = {}; g.scene.traverse(o => { if (o.isMesh) out[o.name] = o.geometry; });
      if (Object.keys(out).length) {
        out._meta = meta; out._kind = kit; out._maps = {};
        // baked detail (tools/blender/crag_bake.py): a tangent-space normal map and an occlusion map per crag
        const tl = new THREE.TextureLoader();
        await Promise.all(Object.entries(meta).filter(([n, m]) => m.maps).map(async ([n, m]) => {
          const [nm, ao] = await Promise.all(m.maps.map(f => tl.loadAsync('/models/' + f)));
          for (const t of [nm, ao]) { t.flipY = false; t.colorSpace = THREE.NoColorSpace; t.anisotropy = 8; }
          out._maps[n] = { nm, ao };
        }));
        return out;
      }
    } catch (e) { console.warn('[cliffs] kit', kit, 'not loaded:', e.message); }
  }
  return null;
}

const CHUNK = 600;
function mulberry(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function hash3(x, y, z, s) { let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177) + Math.imul(s, 1442695041)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y, z, s) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz), L = (a, b, t) => a + (b - a) * t;
  const c = (i, j, k) => hash3(xi + i, yi + j, zi + k, s);
  return L(L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v), L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
const fbm = (x, y, z, s) => vnoise(x, y, z, s) * 0.55 + vnoise(x * 2.1, y * 2.1, z * 2.1, s + 1) * 0.28 + vnoise(x * 4.3, y * 4.3, z * 4.3, s + 2) * 0.17;

// one rock: unit-ish size, base at y ≈ -0.4 (it is sunk into the ground anyway)
function rockGeometry(seed, kind, detail = 4) {
  const rnd = mulberry(seed * 7919 + 13);
  let g = new THREE.IcosahedronGeometry(1, detail); g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g);
  // limestone breaks along bedding (near-horizontal) and joints (near-vertical): cut the blob by planes of both kinds
  const planes = [];
  const nB = 2 + Math.floor(rnd() * 2), nJ = 5 + Math.floor(rnd() * 4);
  for (let i = 0; i < nB; i++) planes.push([(rnd() - 0.5) * 0.3, i % 2 ? -1 : 1, (rnd() - 0.5) * 0.3, 0.45 + rnd() * 0.25]);
  for (let i = 0; i < nJ; i++) { const th = (i / nJ + rnd() * 0.15) * Math.PI * 2; planes.push([Math.cos(th), (rnd() - 0.5) * 0.5, Math.sin(th), 0.55 + rnd() * 0.25]); }
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    let r = 1.0 + 0.16 * (fbm(v.x * 1.6 + seed, v.y * 1.6, v.z * 1.6, seed) - 0.5) * 2;
    for (const [nx, ny, nz, d] of planes) { const nl = Math.hypot(nx, ny, nz), dp = (v.x * nx + v.y * ny + v.z * nz) / nl; if (dp > 0.05) r = Math.min(r, d / dp); }
    v.multiplyScalar(r);
    // stepped bedding: the face breaks back in ledges every so often, with a little erosion noise on each edge
    const bed = 0.16 + 0.05 * rnd();
    const yy = v.y / bed, step = Math.floor(yy), f = yy - step;
    const inset = 1.0 - 0.06 * Math.pow(Math.max(0, f - 0.75) / 0.25, 2) - 0.04 * (fbm(v.x * 5, v.y * 5, v.z * 5, seed + 4) - 0.5);
    v.x *= inset; v.z *= inset;
    if (kind === 'column') v.set(v.x * 0.8, v.y * 1.7, v.z * 0.85);
    else if (kind === 'slab') v.set(v.x * 1.4, v.y * 0.6, v.z * 1.25);
    else v.set(v.x * 1.15, v.y * 0.9, v.z);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  // sharp where cleavage faces meet, smooth across each face: broken stone, not pillows
  g = toCreasedNormals(g, 0.42); g.computeBoundingSphere();
  return g;
}

function rockMaterial(o = {}) {
  const tl = new THREE.TextureLoader();
  // dry limestone (Poly Haven 'rock_boulder_dry', CC0): pale, chipped, the stone of the user's reference cliffs
  const map = tl.load('/textures/rock_boulder_dry/diff.jpg'); map.colorSpace = THREE.SRGBColorSpace;
  const nor = tl.load('/textures/rock_boulder_dry/nor.jpg');
  const fnor = tl.load('/textures/rock_face_03/nor.jpg'); fnor.wrapS = fnor.wrapT = THREE.RepeatWrapping;      // fracture relief, layered over the headland's baked normals
  for (const t of [map, nor]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, vertexColors: !!o.vertexColors, side: o.side || THREE.FrontSide,
    normalMap: o.normalMap || null, aoMap: o.aoMap || null, aoMapIntensity: 1.0 });

  mat.defines = o.vertexColors ? { CLIFF: 1, TONE: 'vec3(1.0, 0.98, 0.93)' } : { TONE: 'vec3(1.0, 0.98, 0.93)' };
  if (o.normalMap) mat.defines.BAKED = 1;
  if (o.cavMap && o.normalMap) mat.defines.CAV = 1;      // sharp crevices and edges baked from the detail mesh (headland)      // sea cliffs weather greyer than loose rock
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uRock = { value: map }; sh.uniforms.uRockN = { value: nor }; sh.uniforms.uCav = { value: o.cavMap || null }; sh.uniforms.uFace = { value: fnor }; sh.uniforms.uCavK = { value: 0.42 }; sh.uniforms.uAgree = { value: new THREE.Vector2(0.45, 0.75) }; sh.uniforms.uFaceK = { value: 1.0 }; sh.uniforms.uScanK = { value: 0.45 }; mat.userData.shader = sh;      // (kept: live tuning from the console)
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRockN;\n#ifdef BAKED\nvarying mat3 vNrmM;\n#endif')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n vRockN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);\n#ifdef BAKED\n vNrmM = mat3(modelMatrix) * inverse(transpose(mat3(instanceMatrix)));\n#endif');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vRockN; uniform sampler2D uRock, uRockN, uCav, uFace; uniform float uCavK, uFaceK, uScanK; uniform vec2 uAgree;\n#ifdef BAKED\nvarying mat3 vNrmM;\n#endif')
      .replace('#include <map_fragment>', `
        vec3 rw = vAtmoWorld; vec3 bw = pow(abs(vRockN), vec3(4.0)); bw /= bw.x + bw.y + bw.z;
        float sc = 1.0 / 9.0;
        vec3 cx = texture2D(uRock, rw.zy * sc).rgb, cy = texture2D(uRock, rw.xz * sc * 0.8).rgb, cz = texture2D(uRock, rw.xy * sc).rgb;
        vec3 rc = cx * bw.x + cy * bw.y + cz * bw.z;
        vec3 cxl = texture2D(uRock, rw.zy * sc * 0.13 + 0.3).rgb, czl = texture2D(uRock, rw.xy * sc * 0.13 + 0.7).rgb;
        float big = dot(cxl * (bw.x + bw.y * 0.5) + czl * (bw.z + bw.y * 0.5), vec3(0.333));
        float l = dot(rc, vec3(0.299, 0.587, 0.114));
        // pale, warm limestone: the scan's own light and dark (contrast pushed) over a bleached tone, darker where water runs
        float lc = clamp((l - 0.33) * 3.2 + 0.5, 0.0, 1.4);
        vec3 lime = mix(vec3(l), rc, 0.35) / max(l, 0.02) * 0.62 * TONE;
        lime = clamp(lime, 0.0, 1.0) * mix(0.4, 1.18, lc) * (0.72 + 0.5 * big);
        lime *= 1.0 - 0.5 * smoothstep(0.42, 0.25, big) * smoothstep(0.5, -0.2, vRockN.y);           // dark streaks down the faces
        lime *= mix(1.0, 0.55, smoothstep(-0.2, -0.7, vRockN.y));                                        // overhang undersides
        // the coast's limestone, crags and loose rock alike: pale grey-white, the scan only breaking it up; cooler grey streaks
        // where rain runs down; damp at the waterline
        lime = vec3(0.3, 0.292, 0.276) * mix(0.55, 1.1, smoothstep(0.16, 0.5, l)) * (0.82 + 0.3 * big);      // (tuned to the dry-limestone scan: l ≈ 0.22–0.47)
        float stk = texture2D(uRock, vec2(dot(rw.xz, vec2(0.71, 0.71)) * 0.05, rw.y * 0.004)).r;
        lime *= mix(vec3(0.55, 0.57, 0.6), vec3(1.0), smoothstep(0.08, 0.32, stk));      // rain streaks, cooler and darker
        lime = mix(lime, lime * vec3(0.78, 0.8, 0.72), (1.0 - smoothstep(0.5, 5.0, rw.y)) * 0.6);
        lime *= mix(1.0, 0.55, smoothstep(-0.2, -0.7, vRockN.y));
        #ifdef CAV
        lime = mix(lime, vec3(0.3, 0.292, 0.276) * 0.97, uScanK);      // the headland: cleaner stone (its cracks come from the baked cavity, not the scan's spots)
        #endif
        #ifdef CLIFF
        // scrub where the baked mask says (gullies, ledges, the foot): dark olive maquis, broken into clumps
        float vm = vColor.g * smoothstep(0.25, 0.75, vColor.g + (texture2D(uRock, rw.xz * 0.21).r - 0.4) * 0.9);
        vm *= smoothstep(0.35, 0.75, vRockN.y);      // scrub tint only where something can root (ledges, slopes), not smeared down sheer faces
        vec3 scrub = mix(vec3(0.035, 0.05, 0.02), vec3(0.11, 0.13, 0.05), smoothstep(0.1, 0.5, texture2D(uRock, rw.xz * 0.37 + rw.y * 0.11).g));
        lime = mix(lime, scrub, vm);
        #endif
        // grass and scrub on the ledges and tops
        float up = smoothstep(0.6, 0.85, vRockN.y + (big - 0.4) * 0.6);
        vec3 veg = mix(vec3(0.07, 0.085, 0.03), vec3(0.2, 0.2, 0.08), lc * 0.7);
        #ifdef CLIFF
        // the scan's fine dark cracks, sharpened, so each facet reads fractured up close
        float cr = texture2D(uRock, (bw.x > bw.z ? rw.zy : rw.xy) * vec2(0.29, 0.37) + 0.41).r;
        lime *= mix(0.62, 1.0, smoothstep(0.18, 0.34, cr));
        #ifdef CAV
        // every joint and crack drawn dark, every outer edge caught a little lighter (as in the reference cliffs)
        vec2 cvm = texture2D(uCav, vNormalMapUv).rg;
        lime *= mix(uCavK, 1.0, smoothstep(0.45, 0.8, cvm.r));      // (baked occlusion: open faces ≈ 0.8–0.93, cracks 0.3–0.6)
        #endif
        diffuseColor.rgb = lime;
        #else
        diffuseColor.rgb = mix(lime, veg, up * 0.9 * smoothstep(3.0, 9.0, rw.y));      // nothing grows in the surf
        #endif
      `)
      .replace('#include <color_fragment>', `
        #ifdef CLIFF
        diffuseColor.rgb *= vColor.r;            // baked occlusion only; G carries the scrub mask
        #else
        #include <color_fragment>
        #endif`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        #ifdef BAKED
        {
          // object-space normal baked in Blender (Z up) → glTF axes (Y up), then through the instance's rotation and scale
          vec3 nb = texture2D(normalMap, vNormalMapUv).xyz * 2.0 - 1.0;
          vec3 wn = normalize(vNrmM * vec3(nb.x, nb.z, -nb.y));
          // where the bake caught the wall of a crack the game mesh does not have, its normal turns far from the surface's:
          // keep the baked detail only where it agrees with the surface, else fall back to the surface itself
          vec3 gn = normalize(vRockN); if (!gl_FrontFacing) gn = -gn;
          float agree = dot(wn, gn);
          #ifdef CAV
          wn = normalize(mix(gn, wn, smoothstep(uAgree.x, uAgree.y, agree)));      // the headland: a little more trusting than the crags (its game mesh follows the detail closely)
          {
            // fracture relief finer than the bake can hold (a scanned rock face at 5 m and 1.7 m, triplanar), fading out with distance
            vec3 b3 = pow(abs(wn), vec3(4.0)); b3 /= b3.x + b3.y + b3.z;
            vec3 p3 = vAtmoWorld;
            vec3 fx = texture2D(uFace, p3.zy / 5.0).xyz * 2.0 - 1.0, fz = texture2D(uFace, p3.xy / 5.0 + 0.37).xyz * 2.0 - 1.0, fy = texture2D(uFace, p3.xz / 5.0 + 0.71).xyz * 2.0 - 1.0;
            vec3 gx = texture2D(uFace, p3.zy / 1.7 + 0.13).xyz * 2.0 - 1.0, gz = texture2D(uFace, p3.xy / 1.7 + 0.59).xyz * 2.0 - 1.0;
            float fd = 1.0 - smoothstep(80.0, 520.0, length(vAtmoWorld - cameraPosition)), fd2 = 1.0 - smoothstep(30.0, 160.0, length(vAtmoWorld - cameraPosition));
            vec3 dn = (vec3(0.0, fx.y, fx.x * sign(wn.x)) * b3.x + vec3(fz.x * sign(wn.z), fz.y, 0.0) * b3.z + vec3(fy.x, 0.0, fy.y) * b3.y) * 0.85 * fd
                    + (vec3(0.0, gx.y, gx.x * sign(wn.x)) * b3.x + vec3(gz.x * sign(wn.z), gz.y, 0.0) * b3.z) * 0.6 * fd2;
            wn = normalize(wn + dn * uFaceK);
          }
          #else
          wn = normalize(mix(gn, wn, smoothstep(0.55, 0.85, agree)));
          #endif
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
        }
        #endif
        #ifndef BAKED
        {
          vec3 nx = texture2D(uRockN, vAtmoWorld.zy / 9.0).xyz * 2.0 - 1.0, nz = texture2D(uRockN, vAtmoWorld.xy / 9.0).xyz * 2.0 - 1.0;
          // and a finer layer (3 m, rotated against the first so they do not line up): fracture texture inside each facet
          vec3 nx2 = texture2D(uRockN, vAtmoWorld.zy * vec2(0.29, 0.37) + 0.41).xyz * 2.0 - 1.0, nz2 = texture2D(uRockN, vAtmoWorld.xy * vec2(0.37, 0.29) + 0.17).xyz * 2.0 - 1.0;
          vec3 ny2 = texture2D(uRockN, vAtmoWorld.xz * 0.33 + 0.63).xyz * 2.0 - 1.0;
          vec3 bw2 = pow(abs(vRockN), vec3(4.0)); bw2 /= bw2.x + bw2.y + bw2.z;
          float fine = 1.0 - smoothstep(60.0, 400.0, length(vAtmoWorld - cameraPosition));
          vec3 wn = normalize(vRockN + vec3(0.0, nx.y, nx.x) * bw2.x * 0.9 + vec3(nz.x, nz.y, 0.0) * bw2.z * 0.9
                    + (vec3(0.0, nx2.y, nx2.x) * bw2.x + vec3(nz2.x, nz2.y, 0.0) * bw2.z + vec3(ny2.x, 0.0, ny2.y) * bw2.y) * 0.75 * fine);
          #ifdef CLIFF
          if (fine > .01) {
            vec3 p = vAtmoWorld / 2.4;
            vec2 fx = texture2D(uFace,vec2(-sign(wn.x)*p.z,p.y)).rg * 2.0 - 1.0;
            vec2 fz = texture2D(uFace,vec2(sign(wn.z)*p.x,p.y)).rg * 2.0 - 1.0;
            vec3 flake = vec3(0.,fx.y,-sign(wn.x)*fx.x)*bw2.x + vec3(sign(wn.z)*fz.x,fz.y,0.)*bw2.z;
            wn = normalize(wn + .54*fine*(flake-wn*dot(wn,flake)));
          }
          #endif
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
        }
        #endif`);
  };
  return patchAtmosphere(mat, null, o.vertexColors ? 'cliffs' : 'rocks');
}

// a clump of maquis scrub: a few lumpy blobs, dark olive, lighter on top
function bushGeometry(seed) {
  const rnd = mulberry(seed * 104729 + 7), parts = [];
  const n = 3 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    let g = new THREE.IcosahedronGeometry(1, 1); g.deleteAttribute('uv'); g.deleteAttribute('normal'); g = mergeVertices(g);
    const ox = (rnd() - 0.5) * 1.3, oz = (rnd() - 0.5) * 1.3, r = 0.55 + rnd() * 0.45, p = g.attributes.position, v = new THREE.Vector3();
    for (let k = 0; k < p.count; k++) { v.fromBufferAttribute(p, k); const f = 0.75 + 0.5 * fbm(v.x * 2.5 + i, v.y * 2.5, v.z * 2.5, seed); v.multiplyScalar(r * f); v.y *= 0.72; p.setXYZ(k, v.x + ox, v.y + r * 0.45, v.z + oz); }
    g.computeVertexNormals(); parts.push(g);
  }
  const P = [], N = [], I = []; let off = 0;
  for (const g of parts) { P.push(...g.attributes.position.array); N.push(...g.attributes.normal.array); for (const k of g.index.array) I.push(k + off); off += g.attributes.position.count; }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); out.setIndex(I); out.computeBoundingSphere();
  return out;
}
function bushMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vUp;').replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n vUp = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal).y;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vUp;')
      .replace('#include <map_fragment>', `
        float lf = fract(sin(dot(floor(vAtmoWorld * 3.1), vec3(12.99, 78.23, 37.71))) * 43758.55);      // leafy speckle
        diffuseColor.rgb = mix(vec3(0.035, 0.045, 0.018), vec3(0.11, 0.12, 0.045), smoothstep(-0.2, 0.9, vUp)) * (0.75 + 0.5 * lf);`);
  };
  return patchAtmosphere(mat, null, 'bushes');
}

const _tc = new THREE.Color(), _q2 = new THREE.Quaternion(), _p2 = new THREE.Vector3(), _s2 = new THREE.Vector3();
export class Rocks {
  // areas: [{ x, z, r, step }] world metres; keepOut(x, z) → true where nothing may stand (streets, houses)
  constructor(scene, field, areas, keepOut, cliffKit = null, scrubKit = null) {
    this.field = field;
    this.group = new THREE.Group(); this.group.name = 'rocks'; scene.add(this.group);
    const kinds = ['boulder', 'boulder', 'column', 'slab', 'boulder', 'column', 'slab', 'boulder'];
    this.protos = kinds.map((k, i) => rockGeometry(i + 1, k));
    this.mids = kinds.map((k, i) => rockGeometry(i + 1, k, 2));        // the same shapes, coarser: 450 m – 1.1 km
    this.lods = kinds.map((k, i) => rockGeometry(i + 1, k, 1));        // and coarse beyond
    this.mat = rockMaterial();
    this.scrub = scrubKit;
    this.bushProtos = scrubKit ? scrubKit.hi : [1, 2, 3].map(bushGeometry); this.bushMat = scrubKit ? scrubMaterial(scrubKit.map) : bushMaterial();
    const NP = this.protos.length;
    const rnd = mulberry(4242), chunks = new Map(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3(), n = new THREE.Vector3();
    let count = 0;
    const bush = (x, y, z, sz) => put(NP + Math.floor(rnd() * 3), x, y, z, sz * (0.8 + rnd() * 0.5), sz * (0.6 + rnd() * 0.5), sz * (0.8 + rnd() * 0.5), rnd() * 6.283, 0, 0);
    const put = (proto, x, y, z, sx, sy, sz, yaw, tiltX, tiltZ) => {
      const key = Math.floor(x / CHUNK) + ',' + Math.floor(z / CHUNK); let c = chunks.get(key); if (!c) chunks.set(key, c = { x: (Math.floor(x / CHUNK) + 0.5) * CHUNK, z: (Math.floor(z / CHUNK) + 0.5) * CHUNK, list: [...this.protos, ...this.bushProtos].map(() => []) });
      e.set(tiltX, yaw, tiltZ); q.setFromEuler(e); c.list[proto].push(m.compose(p.set(x, y, z), q, s.set(sx, sy, sz)).clone()); count++;
    };
    for (const A of areas) {
      if (A.clad && cliffKit) { this._cliffs(scene, field, A, cliffKit, rnd); continue; }
      if (A.clad) {
        // a headland's cliff, clad from the waterline to the brink: march out along radial lines and, wherever the ground
        // passes down through a height band, set a block into the face there
        const arc = 7, BAND = 9, rm = (A.r0 + A.r1) / 2, na = Math.round(Math.PI * 2 * rm / arc);
        for (let k = 0; k < na; k++) {
          const a = (k + rnd() * 0.6) / na * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
          let prev = field.heightAt(A.x + ca * A.r0, A.z + sa * A.r0), band = Math.floor(prev / BAND);
          for (let d = A.r0 + 1.5; d < A.r1; d += 1.5) {
            const x = A.x + ca * d, z = A.z + sa * d, h = field.heightAt(x, z), b = Math.floor(h / BAND);
            if (b < band && h > -3) {
              band = b; if (field.slopeAt(x, z) < 0.35 || rnd() > 0.8 || (A.avoid && A.avoid(x, z, h))) { prev = h; continue; }      // no keep-out here: nobody builds streets on a cliff face
              // wide, deep-set blocks whose faces run together into one broken wall of ledges
              const sz = 10 + rnd() * 9, proto = rnd() < 0.55 ? 3 : Math.floor(rnd() * this.protos.length);
              put(proto, x - ca * sz * 0.62, (b + 0.5) * BAND - sz * 0.15, z - sa * sz * 0.62, sz * (1.1 + rnd() * 0.5), sz * (0.55 + rnd() * 0.35), sz * (1.1 + rnd() * 0.5), a + (rnd() - 0.5) * 0.6, (rnd() - 0.5) * 0.2, (rnd() - 0.5) * 0.2);
              if (rnd() < 0.55) bush(x - ca * sz * 0.2, (b + 0.5) * BAND + sz * 0.22, z - sa * sz * 0.2, 1.6 + rnd() * 2.2);      // scrub rooted on the ledge
            }
            prev = h;
          }
        }
        continue;
      }
      const st = A.step || 9;
      for (let gz = A.z - A.r; gz < A.z + A.r; gz += st) for (let gx = A.x - A.r; gx < A.x + A.r; gx += st) {
        const x = gx + (rnd() - 0.5) * st, z = gz + (rnd() - 0.5) * st; if (Math.hypot(x - A.x, z - A.z) > A.r) continue;
        const h = field.heightAt(x, z); if (h < -6) continue;
        const sl = field.slopeAt(x, z);
        if (keepOut && keepOut(x, z)) continue;
        // the slope's downhill direction, to lean rocks out of a cliff
        const dx = field.heightAt(x + 4, z) - field.heightAt(x - 4, z), dz = field.heightAt(x, z + 4) - field.heightAt(x, z - 4);
        n.set(-dx / 8, 1, -dz / 8).normalize();
        if (sl > 0.55) {
          // cliff: big blocks and columns stacked into the face, most of each buried in it
          const sz = 5 + rnd() * 9 + Math.min(8, (sl - 0.55) * 10);
          const proto = rnd() < 0.45 ? 2 + (rnd() < 0.5 ? 0 : 3) : Math.floor(rnd() * this.protos.length);
          put(proto, x - n.x * sz * 0.55, h - sz * 0.3, z - n.z * sz * 0.55, sz * (0.8 + rnd() * 0.5), sz * (0.9 + rnd() * 0.8), sz * (0.8 + rnd() * 0.5), rnd() * 6.283, n.z * 0.5, -n.x * 0.5);
        } else if (sl > 0.28) {
          if (rnd() < 0.3) { bush(x, h - 0.3, z, 1.4 + rnd() * 2.2); continue; }
          if (rnd() > 0.45) continue;
          const sz = 3 + rnd() * 7;
          put(Math.floor(rnd() * this.protos.length), x, h - sz * 0.35, z, sz * (0.9 + rnd() * 0.6), sz * (0.6 + rnd() * 0.5), sz * (0.9 + rnd() * 0.6), rnd() * 6.283, (rnd() - 0.5) * 0.4, (rnd() - 0.5) * 0.4);
        } else if (sl > 0.12 && h > 3 && rnd() < 0.06) {
          bush(x, h - 0.3, z, 1.2 + rnd() * 1.8);           // scrub on the hillsides
        } else if (h > -3 && h < 2.2 && A.shore !== false) {
          // the waterline: tumbled boulders in the surf
          let rocky = false; for (const [ox, oz] of [[14, 0], [-14, 0], [0, 14], [0, -14]]) if (field.slopeAt(x + ox, z + oz) > 0.22) rocky = true;
          if (!rocky || rnd() > 0.5) continue;
          const sz = 2 + rnd() * 5.5;
          put(Math.floor(rnd() * this.protos.length), x, h - sz * 0.3, z, sz * (1 + rnd() * 0.6), sz * (0.5 + rnd() * 0.5), sz * (1 + rnd() * 0.6), rnd() * 6.283, (rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.5);
        }
      }
    }
    this.chunks = [];
    for (const c of chunks.values()) {
      const meshes = [];
      c.list.forEach((list, i) => {
        if (!list.length) return;
        const bush = i >= NP, im = new THREE.InstancedMesh(bush ? this.bushProtos[i - NP] : this.protos[i], bush ? this.bushMat : this.mat, list.length);
        if (!bush) { im.userData.hi = this.protos[i]; im.userData.mid = this.mids[i]; im.userData.lo = this.lods[i]; }
        else if (this.scrub) { im.userData.hi = im.userData.mid = this.scrub.hi[i - NP]; im.userData.lo = this.scrub.lo[i - NP]; }
        const col = new THREE.Color();
        list.forEach((mm, k) => { im.setMatrixAt(k, mm); const v = 0.78 + rnd() * 0.36, w = (rnd() - 0.5) * 0.12; im.setColorAt(k, col.setRGB(v * (1 + w), v, v * (1 - w * 1.3))); });
        im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true;
        im.castShadow = !bush; im.receiveShadow = true; im.userData.show = bush ? 1600 : 3500; im.computeBoundingSphere(); this.group.add(im); meshes.push(im);
      });
      this.chunks.push({ x: c.x, z: c.z, meshes });
    }
    this.count = count;
    console.log(`[rocks] ${count} rocks in ${this.chunks.length} chunks`);
  }
  // a headland clad in cliff faces: round it at ~34 m steps, find where the ground falls from the brink to the foot, and stand
  // a face there, turned outward, as tall as the drop (pieces overlap; their ends turn back into the hill)
  _cliffs(scene, field, A, kit, rnd) {
    const names = Object.keys(kit).filter(n => !n.startsWith('_') && !n.endsWith('_lo')).sort();
    const nominal = (n) => (kit._meta && kit._meta[n] && kit._meta[n].h) || 42;
    const lists = names.map(() => []), m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3(), col = [];
    const rm = (A.r0 + A.r1) / 2, na = Math.round(Math.PI * 2 * rm / 34);
    const top = field.heightAt(A.x, A.z);
    for (let k = 0; k < na; k++) {
      const a = (k + (rnd() - 0.5) * 0.3) / na * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      let brink = null, foot = null;
      for (let d = A.r0; d < A.r1; d += 2) {
        const h = field.heightAt(A.x + ca * d, A.z + sa * d);
        if (brink === null && h < top - 5) brink = d;
        if (brink !== null && (field.slopeAt(A.x + ca * d, A.z + sa * d) < 0.22 || h < 0.5)) { foot = d; break; }
      }
      if (brink === null || foot === null) continue;
      const hB = field.heightAt(A.x + ca * brink, A.z + sa * brink), hF = Math.max(field.heightAt(A.x + ca * foot, A.z + sa * foot), -2), drop = hB - hF;
      if (drop < 12) continue;
      // up to the brink (so no bare terrace shows under the walls), set in and out along the coast and turned a little
      const i = Math.floor(rnd() * names.length);
      const s = Math.min(1.9, Math.max(0.5, (drop - 3) / nominal(names[i]))),      // tops out at the brink (its own tops vary below it)
        d = foot - 4 * s + (rnd() - 0.5) * 12;
      e.set(0, Math.atan2(ca, sa) + (rnd() - 0.5) * 0.5, 0); q.setFromEuler(e);
      lists[i].push(m.compose(p.set(A.x + ca * d, hF - 4 - rnd() * 2, A.z + sa * d), q, sc.set(s * (0.8 + rnd() * 0.4), s * (0.9 + rnd() * 0.1), s * 0.5)).clone());      // shallow: the back must not reach the walls
      // now and then a lower crag or pinnacle standing out toward the water in front: depth, as in the references
      if (kit._kind === 'crags' && rnd() < 0.35) {
        const d2 = foot + 6 + rnd() * 16, x2 = A.x + ca * d2, z2 = A.z + sa * d2, g2 = field.heightAt(x2, z2);
        if (g2 > -4) {
          const j = Math.floor(rnd() * names.length), s2 = (0.3 + rnd() * 0.35) * Math.max(0.6, drop / nominal(names[j]));
          e.set(0, Math.atan2(ca, sa) + (rnd() - 0.5) * 1.4, 0); q.setFromEuler(e);
          lists[j].push(m.compose(p.set(x2, Math.max(g2, -3) - 2, z2), q, sc.set(s2 * (0.5 + rnd() * 0.4), s2, s2 * 0.7)).clone());
        }
      }
    }
    // scrub rooted on the ledges: cast rays at each face and keep the hits that land on a shelf
    const rc = new THREE.Raycaster(), probe = new THREE.Mesh(), o = new THREE.Vector3(), dir = new THREE.Vector3(), nW = new THREE.Vector3();
    const bushes = [];
    names.forEach((n, i) => {
      probe.geometry = kit[n];
      for (const M of lists[i]) {
        probe.matrixWorld.copy(M); probe.matrix.copy(M);
        for (let t = 0; t < 40; t++) {
          o.set((rnd() - 0.5) * 40, 4 + rnd() * 36, 40).applyMatrix4(M); dir.set(0, -0.25, -1).transformDirection(M);
          rc.set(o, dir); rc.far = 120; const hit = rc.intersectObject(probe, false)[0];
          if (!hit || !hit.face) continue;
          nW.copy(hit.face.normal).transformDirection(M);
          if (nW.y < 0.72) continue;      // only on real ledges and tops (on a face it looks stuck on)
          bushes.push([hit.point.x, hit.point.y - 0.4, hit.point.z, 1.6 + rnd() * 2.6]);
        }
      }
    });
    if (this.bushProtos && bushes.length) {
      const bl = this.bushProtos.map(() => []);
      for (const [x, y, z, b] of bushes) { e.set(0, rnd() * 6.283, 0); q.setFromEuler(e); bl[Math.floor(rnd() * bl.length)].push(m.compose(p.set(x, y, z), q, sc.set(b * (0.8 + rnd() * 0.5), b * (0.6 + rnd() * 0.5), b * (0.8 + rnd() * 0.5))).clone()); }
      bl.forEach((list, i) => { if (!list.length) return; const im = new THREE.InstancedMesh(this.bushProtos[i], this.bushMat, list.length); list.forEach((mm, k) => im.setMatrixAt(k, mm)); im.instanceMatrix.needsUpdate = true; im.receiveShadow = true; im.computeBoundingSphere(); if (this.scrub) { im.userData.hiG = this.scrub.hi[i]; im.userData.loG = this.scrub.lo[i]; } this.group.add(im); this.cliffBush = (this.cliffBush || []).concat(im); });
    }
    const mat = rockMaterial({ vertexColors: true, side: THREE.DoubleSide }), meshes = [], c = new THREE.Color();
    names.forEach((n, i) => {
      if (!lists[i].length) return;
      const mp = kit._maps && kit._maps[n];
      const im = new THREE.InstancedMesh(kit[n], mp ? rockMaterial({ vertexColors: true, side: THREE.DoubleSide, normalMap: mp.nm }) : mat, lists[i].length);      // (the occlusion bake is not usable yet)
      lists[i].forEach((mm, k) => im.setMatrixAt(k, mm));      // no instance colours: the vertex colours carry occlusion and the scrub mask
      im.instanceMatrix.needsUpdate = true; im.castShadow = true; im.receiveShadow = true;
      im.userData = { hi: kit[n], lo: kit[n + '_lo'] || kit[n], show: 8000 }; im.computeBoundingSphere(); this.group.add(im); meshes.push(im);
    });
    this.cliffSet = { x: A.x, z: A.z, meshes, lo: false };
    console.log(`[rocks] cliff faces: ${lists.reduce((t, l) => t + l.length, 0)}, ledge scrub: ${bushes.length}`);
  }
  addCliffPart(part, transform, name) {
    const material = part.material || rockMaterial(part.map
      ? { vertexColors: true, side: THREE.DoubleSide, normalMap: part.map, cavMap: part.cav }
      : { vertexColors: true });
    const mesh = new THREE.InstancedMesh(part.geo, material, 1);
    mesh.setMatrixAt(0, transform);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    mesh.name = name;
    this.group.add(mesh);
    if (part.lo) {
      mesh.userData = { hi: part.geo, mid: part.mid, lo: part.lo, c: mesh.boundingSphere.center.clone(), near: 450, far: 1100 };
      (this.lodMeshes ??= []).push(mesh);
    }
    return mesh;
  }
  // the headland cliff: one mesh per segment, each with its baked normals; scrub on its benches and ledges (the G mask)
  addHeadland(scene, hl, talusKit = null, rubbleKit = null, tidalHeight = null, tidalSections = []) {
    const [cx, cz] = hl.centre, m = new THREE.Matrix4().makeTranslation(cx, 0, cz);
    const rnd = mulberry(77), bushes = [], p = new THREE.Vector3(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3();
    this.headland = [];
    for (const part of hl.parts) {
      this.headland.push(this.addCliffPart(part, m, 'headland_' + part.name));
      const pos = part.geo.getAttribute('position'), nor = part.geo.getAttribute('normal'), col = part.geo.getAttribute('color');
      const inlet = part.name.startsWith('Cove_');
      const dens = Math.min(1, 22000 / pos.count);      // the same scrub per square metre however finely the cliff is meshed
      for (let i = 0; i < pos.count; i++) {
        if (pos.getY(i) < 2.5 || rnd() > (inlet ? .013 : part.patch ? .072 : .17) * dens) continue;
        if (part.patch) {
          // Weathered olive pockets on the authored rock mark the soil that holds scrub.
          const soil = col ? col.getY(i) - col.getZ(i) : .08;
          if (nor.getY(i) < .39 || soil < .022 ||
              vnoise(pos.getX(i)*.07,pos.getY(i)*.08,pos.getZ(i)*.07,107) + soil*1.7 < .60) continue;
        } else if (!col || col.getY(i) < .55 || nor.getY(i) < .2) continue;
        const b = inlet ? .18 + rnd() * .48 : part.patch ? .72 + rnd() * 1.95 : 1.4 + rnd() * 2.4; e.set(0, rnd() * 6.283, 0); q.setFromEuler(e);
        bushes.push(new THREE.Matrix4().compose(p.set(cx + pos.getX(i), pos.getY(i) - 0.3, cz + pos.getZ(i)), q, sc.set(b * (0.8 + rnd() * 0.5), b * (0.6 + rnd() * 0.5), b * (0.8 + rnd() * 0.5))));
      }
    }
    // Small patches of salt-tolerant scrub on the calmer, soil-catching ledges.
    for (const { hi } of tidalSections) {
      const pos = hi.attributes.position, normal = hi.attributes.normal;
      for (let i = 0; i < pos.count; i += 5) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        if (y < 6 || normal.getY(i) < .70 || rnd() > .10) continue;
        if (vnoise(x * .082, y * .09, z * .082, 107) < .60) continue;
        const size = 1.0 + 1.9 * rnd();
        e.set(0, rnd() * 2 * Math.PI, 0); q.setFromEuler(e);
        bushes.push(new THREE.Matrix4().compose(p.set(cx+x, y-.19, cz+z), q, sc.set(size, size*.60, size)));
      }
    }
    // the apron at the cliff foot: blocks fallen from the face, piled at the waterline and tumbling out into the shallows
    if (this.protos) {
      const kit = talusKit || this.protos, NS = talusKit ? 12 : 1, tl = [], rl = [], out = new THREE.Vector3();      // by kit piece and by sector round the headland (each sector culls and swaps detail on its own)
      for (let k = 0; k < NS * kit.length; k++) tl.push([]);
      const slot = (x, z) => (NS > 1 ? Math.min(NS - 1, Math.floor((Math.atan2(z - cz, x - cx) + Math.PI) / (2 * Math.PI) * NS)) : 0) * kit.length + Math.floor(rnd() * kit.length);
      for (const part of hl.parts) {
        const pos = part.geo.getAttribute('position'), nor = part.geo.getAttribute('normal'), dens = Math.min(1, 22000 / pos.count);
        for (let i = 0; i < pos.count; i++) {
          const y = pos.getY(i), ny = nor.getY(i);
          if (y < -1.5 || y > 3.0 || Math.abs(ny) > 0.6 || rnd() > 0.16 * dens) continue;
          out.set(nor.getX(i), 0, nor.getZ(i)); if (out.lengthSq() < 0.05) continue; out.normalize();
          // in heaps: dense and high where the noise says a big fall came down, sparse elsewhere
          const wx = cx + pos.getX(i), wz = cz + pos.getZ(i), heap = 0.5 + 0.5 * Math.sin(wx * 0.045 + Math.sin(wz * 0.031) * 2.3) * Math.cos(wz * 0.052 - wx * 0.017);
          if (rnd() > 0.25 + 0.75 * heap || (part.patch && this.field.heightAt(wx,wz) > y + 1.5)) continue;
          const far = rnd(), big = rnd() < 0.06 + 0.1 * heap;
          const sz = big ? 6 + rnd() * 6 : (1.5 + rnd() * 4.5) * (1 - far * 0.45);
          const d = sz * 0.3 + far * far * (8 + 10 * heap);
          const x = wx + out.x * d + (rnd() - 0.5) * 3, z = wz + out.z * d + (rnd() - 0.5) * 3;
          if (tidalHeight && tidalHeight(x, z) > 0.3) continue;
          const yb = this.field.heightAt(x, z);
          if (yb + sz < 0) continue;
          e.set((rnd() - 0.5) * 0.8, rnd() * 6.283, (rnd() - 0.5) * 0.8); q.setFromEuler(e);
          if (talusKit && rubbleKit) for (let r = 0, nr = 3 + Math.floor(rnd() * 6); r < nr; r++) {      // smaller pieces packed round its foot
            const a = rnd() * 6.283, rr = sz * (0.5 + rnd() * 0.7), s2 = 0.35 + rnd() * rnd() * 1.6; e.set(rnd() * 3, rnd() * 6.283, rnd() * 3); _q2.setFromEuler(e);
            const rx = x + Math.cos(a) * rr, rz = z + Math.sin(a) * rr;
            const ry = this.field.heightAt(rx, rz);
            if (ry + s2 < 0 || (tidalHeight && tidalHeight(rx, rz) > .3)) continue;
            rl.push(new THREE.Matrix4().compose(_p2.set(rx, ry - s2 * .12, rz), _q2, _s2.set(s2 * (0.8 + rnd() * 0.4), s2 * (0.8 + rnd() * 0.4), s2 * (0.8 + rnd() * 0.4))));
          }
          if (talusKit) { const S = Math.min(sz * 1.7, 7 + rnd() * 4);      // (a 1 m block stretched past ~11 m loses its fracture detail)
            tl[slot(x, z)].push(new THREE.Matrix4().compose(p.set(x, yb - S * 0.15, z), q, sc.set(S * (0.85 + rnd() * 0.3), S * (0.85 + rnd() * 0.3), S * (0.85 + rnd() * 0.3)))); continue; }      // (the kit's blocks carry their own proportions; 1 m across)
          tl[slot(x, z)].push(new THREE.Matrix4().compose(p.set(x, yb - sz * 0.2, z), q, sc.set(sz * (0.8 + rnd() * 0.6), sz * (0.6 + rnd() * 0.5), sz * (0.8 + rnd() * 0.6))));
        }
      }
      let n = 0, c = new THREE.Color();
      if (talusKit && talusKit.lods) {
        // every block picks its own detail by distance (see _lodScatter)
        const items = []; tl.forEach((list, i) => list.forEach(mm => items.push({ k: i % kit.length, m: mm, v: 0.8 + rnd() * 0.3 })));
        this._lodScatter(talusKit, items, [60, 160, 350]);
        if (rubbleKit && rubbleKit.lods) this._lodScatter(rubbleKit, rl.map(mm => ({ k: Math.floor(rnd() * rubbleKit.length), m: mm, v: 0.78 + rnd() * 0.3 })), [25, 60, 140], 900);
        n = items.length + rl.length;
      } else tl.forEach((list, i) => {
        if (!list.length) return;
        const im = new THREE.InstancedMesh(kit[i % kit.length], this.mat, list.length);
        list.forEach((mm, k) => { im.setMatrixAt(k, mm); const v = 0.8 + rnd() * 0.3; im.setColorAt(k, c.setRGB(v, v, v * 0.97)); });
        im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere();
        im.name = 'headland_talus'; this.group.add(im); n += list.length;
      });
      console.log(`[headland] talus ${n}`);
    }
    if (this.bushProtos && bushes.length) {
      const bl = this.bushProtos.map(() => []); for (const mm of bushes) bl[Math.floor(rnd() * bl.length)].push(mm);
      bl.forEach((list, i) => { if (!list.length) return; const im = new THREE.InstancedMesh(this.bushProtos[i], this.bushMat, list.length); list.forEach((mm, k) => im.setMatrixAt(k, mm)); im.instanceMatrix.needsUpdate = true; im.receiveShadow = true; im.computeBoundingSphere(); if (this.scrub) { im.userData.hiG = this.scrub.hi[i]; im.userData.loG = this.scrub.lo[i]; } this.group.add(im); this.cliffBush = (this.cliffBush || []).concat(im); });
    }
    this.cliffSet = this.cliffSet || { x: cx, z: cz, meshes: [], lo: false };
    console.log(`[headland] ${hl.parts.length} segments, ${bushes.length} scrub`);
  }
  // instanced pieces of a kit, each drawn at its own detail level by distance from the camera: one InstancedMesh per kit piece
  // per level, refilled whenever the camera has moved 8 m. `hide`: beyond it, not drawn at all
  _lodScatter(kit, items, bands, hide = Infinity) {
    const mat = this.talusMat = this.talusMat || rockMaterial({ vertexColors: true }), cnt = new Array(kit.length).fill(0);
    for (const it of items) { it.p = new THREE.Vector3().setFromMatrixPosition(it.m); cnt[it.k]++; }
    const meshes = kit.lods.map((levels, k) => levels.map(g => {
      const im = new THREE.InstancedMesh(g, mat, Math.max(1, cnt[k])); im.count = 0; im.castShadow = true; im.receiveShadow = true;
      im.frustumCulled = false; im.name = 'headland_talus'; this.group.add(im); return im;
    }));
    (this.scatterSys = this.scatterSys || []).push({ items, meshes, at: new THREE.Vector3(1e9, 0, 0), bands, hide });
    if (!this.talusSys) this.talusSys = this.scatterSys[0];
  }
  update(cam) {
    if (this.scatterSys) for (const T of this.scatterSys) {
      if (T.at.distanceToSquared(cam) > 64) {      // moved more than 8 m: re-sort the pieces into their detail levels
        T.at.copy(cam); const c = _tc;
        for (const row of T.meshes) for (const im of row) im.count = 0;
        for (const it of T.items) {
          const d = it.p.distanceTo(cam); if (d > T.hide) continue;
          const lvl = d < T.bands[0] ? 0 : d < T.bands[1] ? 1 : d < T.bands[2] ? 2 : 3;
          const im = T.meshes[it.k][lvl], j = im.count++; im.setMatrixAt(j, it.m); im.setColorAt(j, c.setRGB(it.v, it.v, it.v * 0.97));
        }
        for (const row of T.meshes) for (const im of row) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
      }
    }
    if (this.lodMeshes) for (const m of this.lodMeshes) { const u = m.userData, d = Math.hypot(u.c.x - cam.x, u.c.y - cam.y, u.c.z - cam.z), g = d < u.near ? u.hi : u.mid && d < u.far ? u.mid : u.lo; if (m.geometry !== g) m.geometry = g; }      // the headland's segments and talus sectors, each by its own distance
    if (this.cliffSet) { const d = Math.hypot(this.cliffSet.x - cam.x, this.cliffSet.z - cam.z), lo = d > 1300; if (lo !== this.cliffSet.lo) { this.cliffSet.lo = lo; for (const m of this.cliffSet.meshes) m.geometry = lo ? m.userData.lo : m.userData.hi; } }
    if (this.cliffBush && this.cliffSet) { const d = Math.hypot(this.cliffSet.x - cam.x, this.cliffSet.z - cam.z); for (const m of this.cliffBush) { m.visible = d < 2200; if (m.userData.loG) { const g = d < 500 ? m.userData.hiG : m.userData.loG; if (m.geometry !== g) m.geometry = g; } } }
    for (const c of this.chunks) {
      const d = Math.hypot(c.x - cam.x, c.z - cam.z);
      for (const m of c.meshes) { m.visible = d < m.userData.show; if (m.userData.lo) { const g = m.material === this.bushMat ? (d < 350 ? m.userData.hi : m.userData.lo) : d < 450 ? m.userData.hi : d < 1100 ? m.userData.mid : m.userData.lo; if (m.geometry !== g) m.geometry = g; } }
    }
  }      // scrub drops out first, then the rocks
}
