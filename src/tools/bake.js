// One-off dev tool: renders the source plant models (assets-src/models) from a ring of angles into impostor atlases
// (colour, normal, mask) and posts them to the dev server, which writes them to public/impostors.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Full-size scans (Poly Haven, CC0) for the forest trees: a mature fir for the North, two broadleaf trees for the south.
// F is each frame's size in the atlas: the trees get 512 px frames so they stay sharp close to the camera.
// Bake only some species by naming them: /bake.html?only=c,b2 (meta.json keeps the others' entries).
const SPECIES = [
  { key: 'c', url: '/assets-src/models/fir_tree_01/fir_tree_01.gltf', node: 'fir_tree_01_a_LOD0', puff: 0.45, F: 512 },
  { key: 'b', url: '/assets-src/models/island_tree_01/island_tree_01.gltf', puff: 0.6, F: 512 },
  { key: 'b2', url: '/assets-src/models/island_tree_03/island_tree_03.gltf', puff: 0.6, F: 512 },
  { key: 'u', url: '/assets-src/models/shrub_04/shrub_04.gltf', puff: 0.5, F: 256 },
  // the forest trees again, as hemi-octahedral impostors: oct × oct views spread evenly over the upper hemisphere (frames FW × FH px),
  // with its own light baked in: how much sun reaches each point from any direction, and how much open sky it sees.
  // These trees are built from scratch with every leaf as geometry (tools/blender/tree_gen.py); `origin` keeps the
  // trunk, which stands on the model's origin, on the middle line of every view
  { key: 'co', url: '/assets-src/models/conifer_a/conifer_a.glb', puff: 0.45, oct: 8, FW: 256, FH: 512, origin: true },
  { key: 'bo', url: '/assets-src/models/broadleaf_a/broadleaf_a.glb', puff: 0.6, oct: 8, FW: 320, FH: 448, origin: true },
  { key: 'b2o', url: '/assets-src/models/broadleaf_b/broadleaf_b.glb', puff: 0.6, oct: 8, FW: 320, FH: 448, origin: true },
];
const FR = 12, ELEV = [0.28, 0.98], SS = 2;
let F = 256, W = 0, H = 0;
const logEl = document.getElementById('log');
const log = (s) => { logEl.textContent += '\n' + s; console.log('[bake]', s); };
window.bakeStatus = 'running';

const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
renderer.setSize(16, 16); renderer.setClearColor(0x000000, 0);
const mkRT = (srgb) => { const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }); if (srgb) rt.texture.colorSpace = THREE.SRGBColorSpace; return rt; };
let rt = null;      // one target, reused pass by pass so a 512 px atlas (12288 × 2048 before downsampling) fits in memory

const extraMat = (mode) => new THREE.ShaderMaterial({
  side: THREE.DoubleSide,
  uniforms: { uCenter: { value: new THREE.Vector3() }, uCamDir: { value: new THREE.Vector3() }, uPuff: { value: 0.5 }, uMode: { value: mode }, uH: { value: 1 }, uR: { value: 1 }, uMinY: { value: 0 } },
  vertexShader: `varying vec3 vN; varying vec3 vP; void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `precision highp float; varying vec3 vN; varying vec3 vP; uniform vec3 uCenter, uCamDir; uniform float uPuff, uH, uR, uMinY; uniform int uMode;
    void main(){
      vec3 n = normalize(vN); if (dot(n, uCamDir) < 0.0) n = -n;
      n = normalize(mix(n, normalize(vP - uCenter), uPuff));
      if (uMode == 0) gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
      else gl_FragColor = vec4(1.0, clamp((vP.y - uMinY) / uH, 0.0, 1.0), clamp(length(vP - uCenter) / uR, 0.0, 1.0), 1.0);
    }`,
});

function downsample(src, alphaSrc) {
  // SS×SS box filter, colour weighted by coverage; returns { rgb (Uint8 w*h*3), a (Float32 w*h) } with rows flipped to image order
  const w = W / SS, h = H / SS; const rgb = new Float32Array(w * h * 3), a = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, cov = 0;
    for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) { const o = ((y * SS + j) * W + x * SS + i) * 4; const al = alphaSrc[o + 3] / 255; r += src[o] * al; g += src[o + 1] * al; b += src[o + 2] * al; cov += al; }
    const oy = h - 1 - y, o2 = oy * w + x;
    if (cov > 0) { rgb[o2 * 3] = r / cov; rgb[o2 * 3 + 1] = g / cov; rgb[o2 * 3 + 2] = b / cov; }
    a[o2] = cov / (SS * SS);
  }
  return { rgb, a, w, h };
}
function dilate(img, passes = 12) {
  // bleed colour outward into empty texels so filtering never pulls in black
  const { rgb, a, w, h } = img; let filled = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) filled[i] = a[i] > 0.02 ? 1 : 0;
  for (let p = 0; p < passes; p++) {
    const next = filled.slice();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (filled[i]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const j = yy * w + xx; if (filled[j]) { r += rgb[j * 3]; g += rgb[j * 3 + 1]; b += rgb[j * 3 + 2]; n++; } }
      if (n) { rgb[i * 3] = r / n; rgb[i * 3 + 1] = g / n; rgb[i * 3 + 2] = b / n; next[i] = 1; }
    }
    filled = next;
  }
  return filled;
}
function halve(img) {
  // 2×2 box filter weighted by coverage
  const { rgb, a, w, h } = img; const w2 = w >> 1, h2 = h >> 1; const o = new Float32Array(w2 * h2 * 3), oa = new Float32Array(w2 * h2);
  for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) {
    let r = 0, g = 0, b = 0, c = 0;
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) { const k = (y * 2 + j) * w + x * 2 + i, al = a[k]; r += rgb[k * 3] * al; g += rgb[k * 3 + 1] * al; b += rgb[k * 3 + 2] * al; c += al; }
    const k2 = y * w2 + x; if (c > 0) { o[k2 * 3] = r / c; o[k2 * 3 + 1] = g / c; o[k2 * 3 + 2] = b / c; } oa[k2] = c / 4;
  }
  return { rgb: o, a: oa, w: w2, h: h2 };
}
async function save(name, w, h, fill) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const ctx = cv.getContext('2d'); const im = ctx.createImageData(w, h);
  fill(im.data); ctx.putImageData(im, 0, 0); document.body.appendChild(cv);
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  const res = await fetch('/__save?name=' + name, { method: 'POST', body: blob }); if (!res.ok) throw new Error('save failed ' + name);
  log(`saved ${name} (${(blob.size / 1024).toFixed(0)} KB)`);
}

// frame (i, j) of an N × N hemi-octahedral atlas looks at the tree from this direction; trees.js decodes it the same way
function hemiOctDir(i, j, N) {
  const px = i / (N - 1) * 2 - 1, py = j / (N - 1) * 2 - 1; const tx = (px + py) / 2, tz = (px - py) / 2;
  return new THREE.Vector3(tx, Math.max(0, 1 - Math.abs(tx) - Math.abs(tz)), tz).normalize();
}
// ---- baked light for the octahedral impostor. The tree is drawn from SKY directions spread over the sky as shadow maps
// (one tile each in a big target); every visible point is then tested against all of them. Light is dimmed by how much
// tree it passed through (first surface to the point; about a fifth of the crown's radius cuts it to a third), not cut
// off at the first leaf, which suits foliage and hides the leaf cards. Per point this leaves: a straight-line fit of sun reaching it against the sun's
// direction (a + b·L, the game evaluates it for the current sun), and the share of the sky it sees (for skylight).
const SKY = 32, SKY_TILES = [8, 4], SKY_PX = 1024, TAU = 0.22, BIAS = 0.03;      // TAU, BIAS: in crown radii
function skyDirs(K) { const out = []; for (let k = 0; k < K; k++) { const y = (k + 0.5) / K, r = Math.sqrt(1 - y * y), a = k * 2.399963; out.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r)); } return out; }
const LIGHT_AXES = /* glsl */`vec3 rt = normalize(vec3(L.z, 0.0, -L.x) + vec3(1e-4, 0.0, 0.0)), up = cross(L, rt);`;
const shadowMat = (map, cut) => new THREE.ShaderMaterial({
  side: THREE.DoubleSide,
  uniforms: { uCenter: { value: new THREE.Vector3() }, uL: { value: new THREE.Vector3(0, 1, 0) }, uR: { value: 1 }, uMap: { value: map }, uCut: { value: map ? cut : 0 } },
  vertexShader: `uniform vec3 uCenter, uL; uniform float uR; varying vec2 vUv; varying float vD;
    void main(){ vUv = uv; vec3 p = (modelMatrix * vec4(position, 1.0)).xyz - uCenter; vec3 L = uL; ${LIGHT_AXES}
      vD = dot(p, L) / uR; gl_Position = vec4(dot(p, rt) / uR, dot(p, up) / uR, -vD, 1.0); }`,
  fragmentShader: `precision highp float;
    #include <packing>
    uniform sampler2D uMap; uniform float uCut; varying vec2 vUv; varying float vD;
    void main(){ if (uCut > 0.0 && texture2D(uMap, vUv).a < uCut) discard; gl_FragColor = packDepthToRGBA(clamp(vD * 0.5 + 0.5, 0.0, 0.9999)); }`,
});
const visMat = (map, cut) => new THREE.ShaderMaterial({
  side: THREE.DoubleSide, defines: { SKY },
  uniforms: { uCenter: { value: new THREE.Vector3() }, uR: { value: 1 }, uMap: { value: map }, uCut: { value: map ? cut : 0 }, uShadow: { value: null }, uDirs: { value: [] }, uFit: { value: new THREE.Matrix4() },
    uTiles: { value: new THREE.Vector2(...SKY_TILES) }, uTau: { value: TAU }, uBias: { value: BIAS }, uMode: { value: 0 }, uMinY: { value: 0 }, uH: { value: 1 } },
  vertexShader: `varying vec2 vUv; varying vec3 vP; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `precision highp float;
    #include <packing>
    uniform sampler2D uMap, uShadow; uniform float uCut, uR, uTau, uBias, uMinY, uH; uniform vec3 uCenter; uniform vec3 uDirs[SKY]; uniform mat4 uFit; uniform vec2 uTiles; uniform int uMode;
    varying vec2 vUv; varying vec3 vP;
    void main(){
      if (uCut > 0.0 && texture2D(uMap, vUv).a < uCut) discard;
      vec3 p = vP - uCenter; float s0 = 0.0; vec3 s1 = vec3(0.0);
      for (int k = 0; k < SKY; k++) {
        vec3 L = uDirs[k]; ${LIGHT_AXES}
        vec2 uv = vec2(dot(p, rt), dot(p, up)) / uR * 0.5 + 0.5;
        vec2 tile = vec2(mod(float(k), uTiles.x), floor(float(k) / uTiles.x));
        float first = (unpackRGBAToDepth(texture2D(uShadow, (tile + clamp(uv, 0.002, 0.998)) / uTiles)) * 2.0 - 1.0) * uR;      // where this light first meets the tree
        float v = exp(-max(first - dot(p, L) - uBias, 0.0) / uTau);
        s0 += v; s1 += v * L;
      }
      // the tree is baked standing alone, but it lives among others that take light from its lower parts and its foot
      // (the ring-of-views trees darkened the same way, by height)
      float among = mix(0.4, 1.0, smoothstep(0.0, 0.3, (vP.y - uMinY) / uH)); s0 *= among; s1 *= among;
      vec4 ab = uFit * vec4(s0, s1);
      if (uMode == 0) gl_FragColor = vec4(clamp(ab.x * 0.5 + 0.25, 0.0, 1.0), s0 / float(SKY), 0.0, 1.0);      // a in −0.5 … 1.5, sky share
      else gl_FragColor = vec4(clamp(ab.yzw * 0.25 + 0.5, 0.0, 1.0), 1.0);                                   // b in −2 … 2
    }`,
});

async function bakeOct(sp) {
  const N = sp.oct, FW = sp.FW, FH = sp.FH; W = N * FW * SS; H = N * FH * SS;
  // two targets of its own: colour is stored sRGB, everything else as plain numbers. (The shared target above is created
  // sRGB by its first colour pass and stays that way, so the older atlases' normal and mask values are sRGB-encoded.)
  if (rt) { rt.dispose(); rt = null; }
  const rtA = mkRT(true), rtL = mkRT(false);
  const gltf = await new GLTFLoader().loadAsync(sp.url);
  const root = sp.node ? gltf.scene.getObjectByName(sp.node) : gltf.scene;
  const scene = new THREE.Scene(); scene.add(root); root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root); const size = box.getSize(new THREE.Vector3());
  const cx = sp.origin ? 0 : (box.min.x + box.max.x) / 2, cz = sp.origin ? 0 : (box.min.z + box.max.z) / 2; const Ht = size.y;
  const meshes = []; root.traverse(o => { if (o.isMesh) { o.frustumCulled = false; meshes.push(o); } });
  // a view's width: for a tree standing on its origin, the farthest any of it gets from the trunk's line
  let reach = 0;
  if (sp.origin) { const v = new THREE.Vector3(); for (const o of meshes) { const pa = o.geometry.attributes.position; for (let i = 0; i < pa.count; i++) { v.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld); reach = Math.max(reach, Math.hypot(v.x, v.z)); } } }
  const halfW = sp.origin ? reach * 1.02 : Math.hypot(size.x, size.z) * 0.5 * 0.9;
  const center = new THREE.Vector3(cx, box.min.y + Ht / 2, cz); const Rb = Math.hypot(sp.origin ? halfW : halfW / 0.9, Ht / 2) * 1.02;
  const mN = extraMat(0); mN.uniforms.uCenter.value.copy(center); mN.uniforms.uPuff.value = sp.puff;
  const cut = (m) => (m.transparent || m.alphaTest > 0) ? Math.max(m.alphaTest, 0.5) : 0;
  const basics = meshes.map(o => new THREE.MeshBasicMaterial({ map: o.material.map, color: o.material.color, vertexColors: !!o.geometry.attributes.color, side: THREE.DoubleSide, alphaTest: cut(o.material) }));
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100); const dist = Rb * 4;

  // the shadow maps, one sky direction per tile
  const dirs = skyDirs(SKY); const [TX, TY] = SKY_TILES;
  const rtS = new THREE.WebGLRenderTarget(TX * SKY_PX, TY * SKY_PX, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const shadows = meshes.map((o, i) => { const m = shadowMat(basics[i].map, basics[i].alphaTest); m.uniforms.uCenter.value.copy(center); m.uniforms.uR.value = Rb; return m; });
  meshes.forEach((o, i) => { o.material = shadows[i]; });
  renderer.setRenderTarget(rtS); renderer.setClearColor(0x000000, 0); renderer.setScissorTest(false); renderer.clear(); renderer.setScissorTest(true);
  dirs.forEach((L, k) => {
    for (const m of shadows) m.uniforms.uL.value.copy(L);
    const x = (k % TX) * SKY_PX, y = Math.floor(k / TX) * SKY_PX; renderer.setViewport(x, y, SKY_PX, SKY_PX); renderer.setScissor(x, y, SKY_PX, SKY_PX);
    renderer.render(scene, cam);
  });
  renderer.setScissorTest(false);
  // least-squares fit of v(L) = a + b·L over those directions: [a, b] = fit · [Σv, Σv·L]
  const M = new Array(16).fill(0); for (const L of dirs) { const v = [1, L.x, L.y, L.z]; for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) M[r * 4 + c] += v[r] * v[c]; }
  const fit = new THREE.Matrix4().set(...M).invert();
  const vis = meshes.map((o, i) => { const m = visMat(basics[i].map, basics[i].alphaTest); m.uniforms.uCenter.value.copy(center); m.uniforms.uR.value = Rb; m.uniforms.uShadow.value = rtS.texture; m.uniforms.uDirs.value = dirs; m.uniforms.uFit.value = fit; m.uniforms.uTau.value = TAU * halfW; m.uniforms.uBias.value = BIAS * halfW; m.uniforms.uMinY.value = box.min.y; m.uniforms.uH.value = Ht; return m; });

  let cur = null;
  const read = () => { const b = new Uint8Array(W * H * 4); renderer.readRenderTargetPixels(cur, 0, 0, W, H, b); return b; };
  const passes = [['A', (i) => basics[i]], ['N', () => mN], ['V0', (i) => vis[i]], ['V1', (i) => vis[i]]];
  let pa = null; const out = {};
  for (const [which, pick] of passes) {
    meshes.forEach((o, i) => { o.material = pick(i); });
    if (which[0] === 'V') for (const m of vis) m.uniforms.uMode.value = +which[1];
    cur = which === 'A' ? rtA : rtL;
    renderer.setRenderTarget(cur); renderer.setScissorTest(false); renderer.clear();
    renderer.setScissorTest(true);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const f = hemiOctDir(i, j, N);
      // the frame's axes: right is level, up is square to it and to the view; its height is the tree's outline from that angle
      const right = new THREE.Vector3(f.z, 0, -f.x).normalize(), up = new THREE.Vector3().crossVectors(f, right);
      const hv = (Ht / 2) * Math.hypot(f.x, f.z) + halfW * f.y;
      cam.left = -halfW; cam.right = halfW; cam.top = hv; cam.bottom = -hv; cam.far = dist * 2; cam.updateProjectionMatrix();
      cam.position.copy(center).addScaledVector(f, dist); cam.up.copy(up); cam.lookAt(center); cam.updateMatrixWorld();
      mN.uniforms.uCamDir.value.copy(f);
      renderer.setViewport(i * FW * SS, j * FH * SS, FW * SS, FH * SS); renderer.setScissor(i * FW * SS, j * FH * SS, FW * SS, FH * SS);
      renderer.render(scene, cam);
    }
    renderer.setScissorTest(false);
    if (which === 'A') { pa = read(); out.A = downsample(pa, pa); } else out[which] = downsample(read(), pa);
  }
  pa = null; renderer.setRenderTarget(null); rtA.dispose(); rtL.dispose(); rtS.dispose();
  // normals and the sun fit's direction term vary gently: they are kept at half size
  const { A, V0 } = out, Nn = halve(out.N), V1 = halve(out.V1);
  dilate(A); dilate(Nn); dilate(V0); dilate(V1);
  const w = A.w, h = A.h, w2 = Nn.w, h2 = Nn.h;
  await save(sp.key + '_albedo.png', w, h, (d) => { for (let i = 0; i < w * h; i++) { d[i * 4] = A.rgb[i * 3]; d[i * 4 + 1] = A.rgb[i * 3 + 1]; d[i * 4 + 2] = A.rgb[i * 3 + 2]; d[i * 4 + 3] = 255; } });
  await save(sp.key + '_normal.png', w2, h2, (d) => { for (let i = 0; i < w2 * h2; i++) { d[i * 4] = Nn.rgb[i * 3] || 128; d[i * 4 + 1] = Nn.rgb[i * 3 + 1] || 128; d[i * 4 + 2] = Nn.rgb[i * 3 + 2] || 128; d[i * 4 + 3] = 255; } });
  // mask: R coverage, G the sun fit's constant a (stored a/2 + 1/4), B share of the sky seen
  await save(sp.key + '_mask.png', w, h, (d) => { for (let i = 0; i < w * h; i++) { d[i * 4] = A.a[i] * 255; d[i * 4 + 1] = V0.rgb[i * 3]; d[i * 4 + 2] = V0.rgb[i * 3 + 1]; d[i * 4 + 3] = 255; } });
  // light: the sun fit's direction term b (stored b/4 + 1/2), in the tree's own frame
  await save(sp.key + '_light.png', w2, h2, (d) => { for (let i = 0; i < w2 * h2; i++) { d[i * 4] = V1.rgb[i * 3] || 128; d[i * 4 + 1] = V1.rgb[i * 3 + 1] || 128; d[i * 4 + 2] = V1.rgb[i * 3 + 2] || 128; d[i * 4 + 3] = 255; } });
  let cover = 0, sky = 0, sa = 0; for (let i = 0; i < w * h; i++) { cover += A.a[i]; sky += A.a[i] * V0.rgb[i * 3 + 1] / 255; sa += A.a[i] * (V0.rgb[i * 3] / 255 * 2 - 0.5); }
  log(`${sp.key}: ${N}×${N} views, atlas ${w}×${h}, height ${Ht.toFixed(2)} m, half-width ${halfW.toFixed(2)} m, coverage ${(cover / (w * h) * 100).toFixed(1)}%, mean sky seen ${(sky / cover).toFixed(2)}, mean a ${(sa / cover).toFixed(2)}, ${meshes.length} meshes`);
  scene.remove(root);
  return { halfW, height: Ht, oct: N, light: true };
}

async function bake(sp) {
  if (sp.oct) return bakeOct(sp);
  F = sp.F || 256; W = FR * F * SS; H = ELEV.length * F * SS;
  if (!rt || rt.width !== W || rt.height !== H) { if (rt) rt.dispose(); rt = mkRT(false); }
  const gltf = await new GLTFLoader().loadAsync(sp.url);
  const root = sp.node ? gltf.scene.getObjectByName(sp.node) : gltf.scene;
  const scene = new THREE.Scene(); scene.add(root); root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root); const size = box.getSize(new THREE.Vector3());
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2; const Ht = size.y, halfW = Math.hypot(size.x, size.z) * 0.5 * 0.9;
  const center = new THREE.Vector3(cx, box.min.y + Ht / 2, cz);
  const meshes = []; root.traverse(o => { if (o.isMesh) meshes.push(o); });
  const mN = extraMat(0), mM = extraMat(1);
  for (const m of [mN, mM]) { m.uniforms.uCenter.value.copy(center); m.uniforms.uPuff.value = sp.puff; m.uniforms.uH.value = Ht; m.uniforms.uR.value = Math.max(halfW, Ht / 2); m.uniforms.uMinY.value = box.min.y; }
  // leaves come as alpha-blended cards (glTF BLEND): cut them out, or each leaf bakes as a solid square
  const cut = (m) => (m.transparent || m.alphaTest > 0) ? Math.max(m.alphaTest, 0.5) : 0;
  const basics = meshes.map(o => new THREE.MeshBasicMaterial({ map: o.material.map, color: o.material.color, side: THREE.DoubleSide, alphaTest: cut(o.material) }));
  const hv = ELEV.map(e => (Ht / 2) * Math.cos(e) + halfW * Math.sin(e));
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
  const dist = Math.max(halfW, Ht) * 4;
  const read = () => { const b = new Uint8Array(W * H * 4); renderer.readRenderTargetPixels(rt, 0, 0, W, H, b); return b; };
  const passes = [['A', (i) => basics[i]], ['N', () => mN], ['M', () => mM]];
  let pa = null, A = null, N = null, M = null;
  for (const [which, pick] of passes) {
    meshes.forEach((o, i) => { o.material = pick(i); });
    rt.texture.colorSpace = which === 'A' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    renderer.setRenderTarget(rt); renderer.setScissorTest(false); renderer.clear();
    renderer.setScissorTest(true);
    for (let r = 0; r < ELEV.length; r++) for (let k = 0; k < FR; k++) {
      const az = (k / FR) * Math.PI * 2, e = ELEV[r];
      const dir = new THREE.Vector3(Math.sin(az) * Math.cos(e), Math.sin(e), Math.cos(az) * Math.cos(e));
      cam.left = -halfW; cam.right = halfW; cam.top = hv[r]; cam.bottom = -hv[r]; cam.far = dist * 2; cam.updateProjectionMatrix();
      cam.position.copy(center).addScaledVector(dir, dist); cam.up.set(0, 1, 0); cam.lookAt(center); cam.updateMatrixWorld();
      mN.uniforms.uCamDir.value.copy(dir); mM.uniforms.uCamDir.value.copy(dir);
      renderer.setViewport(k * F * SS, r * F * SS, F * SS, F * SS); renderer.setScissor(k * F * SS, r * F * SS, F * SS, F * SS);
      renderer.render(scene, cam);
    }
    renderer.setScissorTest(false);
    // read each pass back and shrink it before the next is drawn; the colour pass's coverage weights the other two
    if (which === 'A') { pa = read(); A = downsample(pa, pa); }
    else if (which === 'N') N = downsample(read(), pa);
    else M = downsample(read(), pa);
  }
  pa = null;
  dilate(A); dilate(N);
  const w = A.w, h = A.h;
  await save(sp.key + '_albedo.png', w, h, (d) => { for (let i = 0; i < w * h; i++) { d[i * 4] = A.rgb[i * 3]; d[i * 4 + 1] = A.rgb[i * 3 + 1]; d[i * 4 + 2] = A.rgb[i * 3 + 2]; d[i * 4 + 3] = 255; } });
  await save(sp.key + '_normal.png', w, h, (d) => { for (let i = 0; i < w * h; i++) { d[i * 4] = N.rgb[i * 3] || 128; d[i * 4 + 1] = N.rgb[i * 3 + 1] || 128; d[i * 4 + 2] = N.rgb[i * 3 + 2] || 128; d[i * 4 + 3] = 255; } });
  await save(sp.key + '_mask.png', w, h, (d) => { for (let i = 0; i < w * h; i++) { d[i * 4] = A.a[i] * 255; d[i * 4 + 1] = M.rgb[i * 3 + 1]; d[i * 4 + 2] = M.rgb[i * 3 + 2]; d[i * 4 + 3] = 255; } });
  let cover = 0; for (let i = 0; i < w * h; i++) cover += A.a[i]; 
  log(`${sp.key}: height ${Ht.toFixed(2)} m, half-width ${halfW.toFixed(2)} m, coverage ${(cover / (w * h) * 100).toFixed(1)}%, ${meshes.length} meshes`);
  scene.remove(root);
  return { halfW, height: Ht, hv, elev: ELEV, frames: FR };
}

(async () => {
  try {
    const only = new URLSearchParams(location.search).get('only');
    const meta = only ? await (await fetch('/impostors/meta.json')).json().catch(() => ({})) : {};
    for (const sp of SPECIES) { if (only && !only.split(',').includes(sp.key)) continue; log('baking ' + sp.url); meta[sp.key] = await bake(sp); }
    const res = await fetch('/__save?name=meta.json', { method: 'POST', body: JSON.stringify(meta) }); if (!res.ok) throw new Error('meta save failed');
    log('done'); window.bakeStatus = 'done'; window.bakeMeta = meta;
  } catch (e) { log('ERROR ' + e.message); window.bakeStatus = 'error: ' + e.message; console.error(e); }
})();
