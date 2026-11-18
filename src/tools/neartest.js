// Run in a separate, settled test tab after octtest.setup('b').
// const { measureNear } = await import('/src/tools/neartest.js')
// measureNear('c')  // Repeat for b and b2. Results use the game's actual postprocessing.
import * as THREE from 'three';
import { NEAR_IN, NEAR_OUT } from '../world/trees.js';

export function measureNear(kind, { step = 0.5, inner = NEAR_IN, outer = NEAR_OUT } = {}) {
  const game = window.game, trees = game.trees, source = window.RT.best;
  const near = trees.near[kind], oct = trees.oct[kind].mats[0];
  const scene = new THREE.Scene(), cam = game.camera.clone();
  scene.background = new THREE.Color(0);
  const u = near.material.uniforms, center = new THREE.Vector3(source.x, source.y + source.w * u.uSizeM.value / 2, source.z);
  const offset = new THREE.InstancedBufferAttribute(new Float32Array([source.x, source.y, source.z, source.w]), 4);
  const params = new THREE.InstancedBufferAttribute(new Float32Array([source.rot, 0.5, 0, 0]), 4);
  function single(base, mat) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = base.index;
    for (const [key, attr] of Object.entries(base.attributes)) geometry.setAttribute(key, attr);
    geometry.setAttribute('aOffset', offset); geometry.setAttribute('aParams', params);
    geometry.instanceCount = 1;
    const mesh = new THREE.Mesh(geometry, mat); mesh.frustumCulled = false;
    scene.add(mesh);
    return mesh;
  }
  const quad = single(trees.geo[kind][0], oct), mesh = single(near.geometry, near.material);
  // For fixed-pose comparisons and the intentional hard-cut control, force the
  // production mesh fully on without moving the eye used for wind or shading.
  const pure = new THREE.ShaderMaterial({
    uniforms: u, defines: near.material.defines, side: THREE.DoubleSide,
    vertexShader: near.material.vertexShader.replace('vNear = meshCover(center);', 'vNear = 1.0;'),
    fragmentShader: near.material.fragmentShader,
  });
  const probe = document.createElement('canvas');
  probe.width = 768; probe.height = Math.round(probe.width / game.camera.aspect);
  const ctx = probe.getContext('2d', { willReadFrequently: true });
  function picture(mode, dist, az = 0.5, elevation = 0.06) {
    cam.position.copy(center).addScaledVector(new THREE.Vector3(Math.sin(az)*Math.cos(elevation), Math.sin(elevation), Math.cos(az)*Math.cos(elevation)), dist);
    cam.lookAt(center); cam.updateMatrixWorld(); trees.nearEye.copy(cam.position);
    u.uNearEnabled.value = mode === 'oct' ? 0 : 1;
    quad.visible = mode !== 'mesh'; mesh.visible = mode !== 'oct';
    mesh.material = mode === 'mesh' ? pure : near.material;
    game.post.render(scene, cam, game.time);
    ctx.drawImage(game.renderer.domElement, 0, 0, probe.width, probe.height);
    return ctx.getImageData(0, 0, probe.width, probe.height).data;
  }
  function change(a, b) {
    let sum = 0, n = 0;
    for (let i = 0; i < a.length; i += 4) {
      // Normalise by the union of visible foreground in this pair. Comparing
      // entire frames would let a mostly black background hide a popping tree.
      if (Math.max(a[i], a[i+1], a[i+2], b[i], b[i+1], b[i+2]) < 8) continue;
      sum += Math.abs(a[i]-b[i]) + Math.abs(a[i+1]-b[i+1]) + Math.abs(a[i+2]-b[i+2]); n++;
    }
    return sum / (3*n);
  }
  function rgb(px) {
    const out = [0, 0, 0]; let n = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (Math.max(px[i], px[i+1], px[i+2]) < 8) continue;
      for (let c = 0; c < 3; c++) out[c] += px[i+c];
      n++;
    }
    return { rgb: out.map(x => x/n), pixels: n };
  }
  const clouds = game.post.clouds, oldEye = trees.nearEye.clone(), enabled = u.uNearEnabled.value;
  const hour = game.sky.time;
  try {
    game.post.clouds = null; // black background, cloud shadow still active
    const colors = [];
    for (const h of [9, 12, 15]) {
      game.sky.setTime(h); game.step(1/60, [], 60, false);
      for (const az of [0.5, 2.6, 4.6]) {
        for (const dist of [32, (inner+outer)/2]) {
          colors.push({ h, az, dist, oct: rgb(picture('oct', dist, az)), mesh: rgb(picture('mesh', dist, az)) });
        }
      }
    }
    const sweep = {};
    // Same wind phase, projection and light for every representation and step.
    for (const mode of ['band', 'hard', 'oct']) {
      const steps = []; let prev;
      for (let d = inner-2; d <= outer+2+1e-6; d += step) {
        const choice = mode === 'hard' ? (d < (inner+outer)/2 ? 'mesh' : 'oct') : mode;
        const frame = picture(choice, d);
        if (prev) steps.push({ d, change: change(prev, frame) });
        prev = frame;
      }
      sweep[mode] = steps;
    }
    return { kind, step, resolution: [probe.width, probe.height], colors, sweep };
  } finally {
    game.post.clouds = clouds; trees.nearEye.copy(oldEye); u.uNearEnabled.value = enabled;
    game.sky.setTime(hour); game.step(1/60); pure.dispose();
  }
}
