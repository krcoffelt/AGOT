// Look development: fixed views of King's Landing matching the reference stills, saved to .shots/ for side-by-side comparison.
// In the console:  const L = await game.lookdev();  await L.shoot()   (or L.shoot(['keep'], 'v2'), L.view('bay'))
const VIEWS = {
  // across the water at the walled city with the Red Keep's towers above it (reference 1)
  bay: { pos: [1650, 140, 1650], at: [650, 70, 250], fov: 38, t: 17.7 },
  // down from the harbour hill along the sea walls, ships in the bay (reference 2)
  harbour: { pos: [1350, 75, 1050], at: [450, 40, 350], fov: 44, t: 17.5 },
  // up at the Red Keep from the rocks below its cliffs (reference 3)
  keep: { pos: [1330, 12, 760], at: [930, 85, 380], fov: 46, t: 8.2 },
  // the headland cliffs at sea level, low morning sun raking across them (the user's Red Keep cliff photo)
  inlet: { pos: [1126.9109, 4.35, 538.7695], at: [1095.9307, 4.35, 564.0722], fov: 43.2187, t: 7.7 },
  cliffs: { pos: [1050, 6, 60], at: [930, 60, 400], fov: 50, t: 6.8 },
  cliffs2: { pos: [1200, 6, 120], at: [950, 60, 400], fov: 50, t: 6.8 },
  cliffs3: { pos: [1130, 4, 180], at: [1000, 40, 330], fov: 50, t: 6.8 },
  aerial: { pos: [1400, 320, 900], at: [930, 40, 400], fov: 45, t: 10.5 },
  near: { pos: [1150, 5, 250], at: [1085, 35, 400], fov: 50, t: 7.2 },      // along an east face, the morning sun raking across it from the left
  // the whole city from the hills inland
  overview: { pos: [-1150, 300, -350], at: [650, 60, 380], fov: 42, t: 17.6 },
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export function view(name) {
  const g = window.game, v = VIEWS[name];
  g.sky.locked = true; g.sky.setTime(v.t);
  g.look(...v.pos, ...v.at, 'kingslanding'); g.camera.fov = v.fov; g.camera.updateProjectionMatrix();
  for (let i = 0; i < 4; i++) g.step(1 / 60);       // let the terrain, trees and houses stream in around the camera
  g.post.finalMat.uniforms.uExposure.value = g.sky.exposure;      // settled exposure, so shots compare fairly
  return v;
}
export async function shoot(names = Object.keys(VIEWS), tag = 'a') {
  const g = window.game; document.querySelector('#ui').style.display = 'none';
  const out = [];
  for (const n of names) { view(n); await sleep(300); for (let i = 0; i < 16; i++) g.step(1 / 600); /* frames for the clouds' temporal accumulation to settle */ out.push(`${n}_${tag}: ${await g.capture(`${n}_${tag}`)}`); }
  return out;
}
// the headland comparison set: .shots/cmp_{ref2,side,close,aer}_<tag>.jpg (tiled against the user's photos by the scratchpad tiler)
export async function cmp(tag) {
  const pairs = [['ref2', 'cliffs'], ['side', 'cliffs2'], ['close', 'cliffs3'], ['near', 'near'], ['aer', 'aerial']];
  const out = []; document.querySelector('#ui').style.display = 'none';
  for (const [n, v] of pairs) { view(v); for (let i = 0; i < 14; i++) window.game.step(1 / 600); out.push(await window.game.capture(`cmp_${n}_${tag}`)); }
  return out;
}
export { VIEWS };
