// DOM overlay: title / selection screen, HUD, world map, pause menu.
import { DRAGONS, RIDERS } from '../game/roster.js';
import { LANDMARKS, MAP, REGION, toWorld, toMap, regionAt } from '../world/mapdata.js';
import { buildMapCanvas } from './mapimage.js';

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const bar = (v) => `<span class="stat"><i style="width:${Math.round(v * 100)}%"></i></span>`;

export class UI {
  constructor(game) {
    this.game = game;
    this.root = $('#ui');
    this.discovered = new Set(JSON.parse(localStorage.getItem('dr.discovered') || '[]'));
    this.mapCanvas = buildMapCanvas(game.field, 640);
    this._hudT = 0; this._toastQ = []; this._toastT = 0;
    this._buildMenu(); this._buildHud(); this._buildMap(); this._buildPause();
    this.show('menu');
  }

  // ------------------------------------------------------------------ menu
  _buildMenu() {
    const m = this.menu = el('div', 'screen menu');
    m.innerHTML = `
      <div class="brand"><div class="brand-title">DRAGONRIDER</div><div class="brand-sub">Skies of Westeros</div></div>
      <div class="panel left"><h2>Choose your rider</h2><div class="list" id="rider-list"></div><div class="lore" id="rider-lore"></div></div>
      <div class="panel right"><h2>Choose your dragon</h2><div class="list" id="dragon-list"></div><div class="lore" id="dragon-lore"></div></div>
      <div class="menu-bottom">
        <div class="tod"><span>Time of day</span><button data-t="7.1" class="on">Dawn</button><button data-t="11">Day</button><button data-t="17.25">Dusk</button><button data-t="22.5">Night</button></div>
        <button class="cta" id="fly">Take Flight</button>
        <div class="keys">Mouse looks and steers · <b>↑ ↓</b> climb / dive · <b>A D</b> turn · <b>W</b> faster · <b>S</b> brake / land · <b>Shift</b> surge · <b>Space</b> dragonfire · <b>M</b> map</div>
      </div>
      <button class="credits-link" id="credits-open">Credits</button>
      <div class="credits" id="credits"><div class="credits-card"><h2>Credits</h2><div class="credits-body" id="credits-body"></div><button class="ghost" id="credits-close">Close</button></div></div>`;
    this.root.appendChild(m);
    const cr = $('#credits', m);
    $('#credits-open', m).onclick = () => { this._fillCredits(); cr.classList.add('on'); };
    $('#credits-close', m).onclick = () => cr.classList.remove('on');
    cr.onclick = (e) => { if (e.target === cr) cr.classList.remove('on'); };
    const rl = $('#rider-list', m), dl = $('#dragon-list', m);
    for (const r of RIDERS) { const b = el('button', 'item', `<b>${r.name}</b><span>${r.title}</span>`); b.dataset.id = r.id; b.onclick = () => this.pick(r.id, null, true); rl.appendChild(b); }
    for (const d of DRAGONS) { const b = el('button', 'item', `<b>${d.name}</b><span>${d.title}</span>`); b.dataset.id = d.id; b.onclick = () => this.pick(null, d.id); dl.appendChild(b); }
    m.querySelectorAll('.tod button').forEach(b => b.onclick = () => { m.querySelectorAll('.tod button').forEach(x => x.classList.remove('on')); b.classList.add('on'); this.game.sky.setTime(parseFloat(b.dataset.t)); });
    $('#fly', m).onclick = () => this.game.startFlight();
    this.refreshMenu();
  }
  // Who made what. The street props come from other people's models under CC-BY, which asks for exactly this: the list is read
  // from public/models/props.json, written by tools/blender/props_kit.py from each download's own licence file.
  async _fillCredits() {
    if (this._credits) return; this._credits = true;
    const body = $('#credits-body', this.menu), text = (tag, cls, t) => { const e = el(tag, cls); e.textContent = t; return e; };
    const link = (label, url, ok) => { if (!url || !ok.test(url)) return text('span', '', label); const a = text('a', '', label); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; };
    const split = (v) => { const m = /^(.*?)\s*\((https?:\/\/[^)\s]+)\)\s*$/.exec(v || ''); return m ? [m[1], m[2]] : [v || 'unknown', null]; };   // "Name (https://…)"
    let props = {}; try { props = await fetch('/models/props.json').then(r => r.json()); } catch (e) { /* no prop kit built */ }
    const seen = new Set(), models = Object.values(props).map(p => p.credit).filter(c => c && c.title && !seen.has(c.source || c.title) && seen.add(c.source || c.title));
    if (models.length) {
      body.appendChild(text('h4', '', 'Street props'));
      body.appendChild(text('p', 'credits-note', 'Market stalls, carts, cargo and ships are adapted from these models (resized, simplified and re-textured):'));
      for (const c of models) {
        const [author, authorUrl] = split(c.author), [lic, licUrl] = split(c.license), row = el('p');
        row.append(link('“' + c.title + '”', c.source, /^https:\/\/sketchfab\.com\//), ' by ', link(author, authorUrl, /^https:\/\/sketchfab\.com\//), ' · ', link(lic.replace(/-/g, ' '), licUrl, /^https?:\/\/creativecommons\.org\//));
        body.appendChild(row);
      }
    }
    body.appendChild(text('h4', '', 'Public-domain material'));
    const ph = el('p'); ph.append('Ground, stone, roof, timber and cloth textures and the tree models: ', link('Poly Haven', 'https://polyhaven.com', /^https:/), ' (CC0).'); body.appendChild(ph);
    const bs = el('p'); bs.append('Rider anatomy: ', link('Blender Studio Human Base Meshes', 'https://www.blender.org/download/demo-files/', /^https:/), ' (CC0).'); body.appendChild(bs);
  }
  pick(riderId, dragonId, bonded = false) {
    const g = this.game; const sel = { ...g.sel };
    if (riderId) { sel.rider = riderId; if (bonded) sel.dragon = RIDERS.find(r => r.id === riderId).dragon; }
    if (dragonId) sel.dragon = dragonId;
    g.selectCharacter(sel.dragon, sel.rider);
    this.refreshMenu();
  }
  refreshMenu() {
    const { dragon, rider } = this.game.sel; const m = this.menu;
    m.querySelectorAll('#rider-list .item').forEach(b => b.classList.toggle('on', b.dataset.id === rider));
    m.querySelectorAll('#dragon-list .item').forEach(b => b.classList.toggle('on', b.dataset.id === dragon));
    const r = RIDERS.find(x => x.id === rider), d = DRAGONS.find(x => x.id === dragon);
    $('#rider-lore', m).innerHTML = `<h3>${r.name}</h3><em>${r.title}</em><p>${r.lore}</p><p class="bond">Bonded dragon: <b>${DRAGONS.find(x => x.id === r.dragon).name}</b></p>`;
    $('#dragon-lore', m).innerHTML = `<h3>${d.name}</h3><em>${d.title}</em><p>${d.lore}</p>
      <div class="stats"><label>Speed</label>${bar(d.stats.speed)}<label>Agility</label>${bar(d.stats.agility)}<label>Fire</label>${bar(d.stats.fire)}<label>Size</label>${bar((d.scale - 0.8) / 1.3)}</div>`;
  }

  // ------------------------------------------------------------------- HUD
  _buildHud() {
    const h = this.hud = el('div', 'screen hud');
    h.innerHTML = `
      <canvas id="compass" width="720" height="54"></canvas>
      <div class="region"><div id="region-name">Blackwater Bay</div><div id="near-name"></div></div>
      <div class="toast" id="toast"><div class="toast-kicker"></div><div class="toast-title"></div><div class="toast-sub"></div></div>
      <div class="minimap"><canvas id="minimap" width="200" height="200"></canvas></div>
      <div class="gauges">
        <div class="g"><label>Speed</label><b id="g-speed">0</b><small>km/h</small></div>
        <div class="g"><label>Altitude</label><b id="g-alt">0</b><small>m</small></div>
        <div class="bars"><div class="bar surge"><i id="b-stam"></i></div><div class="bar fire"><i id="b-fire"></i></div></div>
      </div>
      <div class="hint" id="hint"></div>
      <div class="reticle" id="reticle"></div>
      <div class="help" id="help"><b>W</b> faster / walk &nbsp; <b>S</b> brake / land &nbsp; <b>Shift</b> surge / take off &nbsp; <b>Space</b> fire &nbsp; <b>R</b> roar &nbsp; <b>C</b> camera &nbsp; <b>T</b> time &nbsp; <b>M</b> map &nbsp; <b>P</b> photo &nbsp; <b>Esc</b> menu</div>`;
    this.root.appendChild(h);
    this.cmp = $('#compass', h).getContext('2d'); this.mm = $('#minimap', h).getContext('2d');
    this.e = { region: $('#region-name', h), near: $('#near-name', h), speed: $('#g-speed', h), alt: $('#g-alt', h), stam: $('#b-stam', h), fire: $('#b-fire', h), hint: $('#hint', h), toast: $('#toast', h), reticle: $('#reticle', h) };
  }
  toast(kicker, title, sub) { this._toastQ.push([kicker, title, sub]); }
  hint(text) { this.e.hint.textContent = text || ''; this.e.hint.classList.toggle('on', !!text); }

  updateHud(dt) {
    const g = this.game, fl = g.flight;
    // toasts
    this._toastT -= dt;
    if (this._toastT <= 0 && this._toastQ.length) {
      const [k, t, s] = this._toastQ.shift(); const e = this.e.toast;
      $('.toast-kicker', e).textContent = k; $('.toast-title', e).textContent = t; $('.toast-sub', e).textContent = s;
      e.classList.remove('on'); void e.offsetWidth; e.classList.add('on'); this._toastT = 5.2;
    }
    this._hudT -= dt; if (this._hudT > 0) return; this._hudT = 0.05;
    this.e.speed.textContent = Math.round(fl.speed * 3.6);
    this.e.alt.textContent = Math.round(Math.max(0, fl.pos.y - fl.belly));
    this.e.stam.style.width = (fl.stamina * 100).toFixed(0) + '%';
    this.e.fire.style.width = ((g.fire ? g.fire.fuel : 1) * 100).toFixed(0) + '%';
    this.e.region.textContent = regionAt(fl.pos.x, fl.pos.z);
    // discovery + nearest landmark
    let near = null, nd = 1e9;
    for (const s of g.landmarks.sites) {
      const d = Math.hypot(s.x - fl.pos.x, s.z - fl.pos.z);
      if (d < nd) { nd = d; near = s; }
      if (d < s.lm.r + 950 && !this.discovered.has(s.lm.id)) {
        this.discovered.add(s.lm.id); localStorage.setItem('dr.discovered', JSON.stringify([...this.discovered]));
        this.toast(`Discovered · ${this.discovered.size} / ${g.landmarks.sites.length}`, s.lm.name, s.lm.sub);
        if (g.audio) g.audio.chime();
      }
    }
    this.e.near.textContent = near && nd < 9000 ? `${near.lm.name} · ${(nd / 1000).toFixed(1)} km` : '';
    this._compass(fl); this._minimap(fl);
    // aim reticle
    const r = this.e.reticle; const v = g.aimScreen();
    if (v && fl.mode === 'fly') { r.style.display = 'block'; r.style.transform = `translate(${v.x}px, ${v.y}px)`; r.classList.toggle('hot', !!v.hit); } else r.style.display = 'none';
  }
  _compass(fl) {
    const c = this.cmp, W = 720, H = 54; c.clearRect(0, 0, W, H);
    const heading = ((fl.yaw * 180 / Math.PI) % 360 + 360) % 360; const span = 150;
    c.textAlign = 'center'; c.fillStyle = 'rgba(239,230,210,0.9)'; c.strokeStyle = 'rgba(239,230,210,0.55)'; c.lineWidth = 1.5;
    const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let d = 0; d < 360; d += 15) {
      let rel = ((d - heading + 540) % 360) - 180; if (Math.abs(rel) > span / 2) continue;
      const x = W / 2 + (rel / span) * W; const fade = 1 - Math.pow(Math.abs(rel) / (span / 2), 3);
      c.globalAlpha = fade;
      if (names[d]) { c.font = (d % 90 === 0 ? '600 19px Cinzel, serif' : '400 12px Cinzel, serif'); c.fillText(names[d], x, 24); }
      c.beginPath(); c.moveTo(x, 32); c.lineTo(x, d % 45 === 0 ? 42 : 37); c.stroke();
    }
    // landmark pips
    for (const s of this.game.landmarks.sites) {
      const dx = s.x - fl.pos.x, dz = s.z - fl.pos.z, dist = Math.hypot(dx, dz);
      if (!(s.lm.major || this.discovered.has(s.lm.id)) || dist > 30000) continue;
      const brg = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360; const rel = ((brg - heading + 540) % 360) - 180; if (Math.abs(rel) > span / 2) continue;
      const x = W / 2 + (rel / span) * W; c.globalAlpha = (1 - Math.pow(Math.abs(rel) / (span / 2), 3)) * (this.discovered.has(s.lm.id) ? 1 : 0.55);
      c.fillStyle = '#d8b36a'; c.beginPath(); c.moveTo(x, 44); c.lineTo(x + 5, 50); c.lineTo(x, 54); c.lineTo(x - 5, 50); c.closePath(); c.fill();
    }
    c.globalAlpha = 1; c.fillStyle = '#d8b36a'; c.beginPath(); c.moveTo(W / 2, 30); c.lineTo(W / 2 + 6, 4 + 0); c.lineTo(W / 2 - 6, 4); c.closePath(); c.globalAlpha = 0.0; c.fill(); c.globalAlpha = 1;
    c.fillRect(W / 2 - 1, 28, 2, 16);
  }
  _minimap(fl) {
    const c = this.mm, S = 200, mc = this.mapCanvas; const view = 9000;      // metres across
    const px = (fl.pos.x / MAP.W + 0.5) * mc.width, py = (fl.pos.z / MAP.H + 0.5) * mc.height, sp = view / MAP.W * mc.width;
    c.clearRect(0, 0, S, S); c.imageSmoothingQuality = 'high';
    c.drawImage(mc, px - sp / 2, py - sp / 2, sp, sp, 0, 0, S, S);
    for (const s of this.game.landmarks.sites) {
      const mx = S / 2 + (s.x - fl.pos.x) / view * S, my = S / 2 + (s.z - fl.pos.z) / view * S; if (mx < 4 || my < 4 || mx > S - 4 || my > S - 4) continue;
      c.fillStyle = this.discovered.has(s.lm.id) ? '#8e1b1b' : 'rgba(40,30,20,0.7)'; c.beginPath(); c.arc(mx, my, s.lm.major ? 4 : 3, 0, 6.3); c.fill();
    }
    c.save(); c.translate(S / 2, S / 2); c.rotate(fl.yaw); c.fillStyle = '#1a1410'; c.strokeStyle = '#efe6d2'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(0, -10); c.lineTo(7, 8); c.lineTo(0, 4); c.lineTo(-7, 8); c.closePath(); c.fill(); c.stroke(); c.restore();
  }

  // ------------------------------------------------------------- world map
  _buildMap() {
    const m = this.mapEl = el('div', 'screen map');
    m.innerHTML = `<div class="map-frame"><div class="map-inner" id="map-inner"></div></div>
      <div class="map-side"><h2>The Crownlands</h2><p class="map-count" id="map-count"></p><p>Select a seat to fly there at once.</p><div class="map-list" id="map-list"></div><button class="ghost" id="map-close">Return (M)</button></div>`;
    this.root.appendChild(m);
    const inner = $('#map-inner', m); this.mapCanvas.className = 'map-canvas'; inner.appendChild(this.mapCanvas);
    this.pins = {};
    for (const lm of LANDMARKS) {
      const p = el('button', 'pin' + (lm.major ? ' major' : ''), `<i></i><span>${lm.name}</span>`);
      p.style.left = ((lm.pos[0] - REGION.x0) / (REGION.x1 - REGION.x0) * 100) + '%'; p.style.top = ((lm.pos[1] - REGION.y0) / (REGION.y1 - REGION.y0) * 100) + '%';
      p.onclick = () => { this.game.fastTravel(lm.id); };
      inner.appendChild(p); this.pins[lm.id] = p;
    }
    this.you = el('div', 'you'); inner.appendChild(this.you);
    $('#map-close', m).onclick = () => this.game.setState('playing');
  }
  refreshMap() {
    const fl = this.game.flight; const [mx, my] = toMap(fl.pos.x, fl.pos.z);
    this.you.style.left = ((mx - REGION.x0) / (REGION.x1 - REGION.x0) * 100) + '%'; this.you.style.top = ((my - REGION.y0) / (REGION.y1 - REGION.y0) * 100) + '%'; this.you.style.transform = `translate(-50%,-50%) rotate(${fl.yaw}rad)`;
    for (const lm of LANDMARKS) this.pins[lm.id].classList.toggle('found', this.discovered.has(lm.id));
    $('#map-count', this.mapEl).textContent = `${this.discovered.size} of ${this.game.landmarks.sites.length} places discovered`;
    const list = $('#map-list', this.mapEl); list.innerHTML = '';
    for (const lm of LANDMARKS.filter(l => l.major)) { const b = el('button', 'item' + (this.discovered.has(lm.id) ? ' found' : ''), `<b>${lm.name}</b><span>${lm.region}</span>`); b.onclick = () => this.game.fastTravel(lm.id); list.appendChild(b); }
  }

  // ------------------------------------------------------------ pause menu
  _buildPause() {
    const p = this.pause = el('div', 'screen pause');
    const g = this.game;
    p.innerHTML = `<div class="pause-card"><h2>Paused</h2>
      <button class="cta small" id="p-resume">Resume</button>
      <button class="ghost" id="p-map">World Map</button>
      <button class="ghost" id="p-select">Change Rider or Dragon</button>
      <div class="opt"><label>Graphics</label><div class="seg" id="p-q"><button data-gfx="low">Low</button><button data-gfx="medium">Medium</button><button data-gfx="high">High</button><button data-gfx="ultra">Ultra</button></div><p class="gfx-note" id="p-res"></p></div>
      <div class="opt"><label>Mouse sensitivity</label><input type="range" id="p-sens" min="0.3" max="2.5" step="0.1" value="1"></div>
      <div class="opt"><label>Volume</label><input type="range" id="p-vol" min="0" max="1" step="0.05" value="0.8"></div>
      <div class="opt"><label><input type="checkbox" id="p-inv"> Invert vertical look</label><label><input type="checkbox" id="p-music" checked> Music</label></div>
      <div class="controls"><b>Mouse</b> look and steer &nbsp; <b>↑ ↓</b> climb · dive &nbsp; <b>A D / ← →</b> turn<br><b>W</b> fly faster · on the ground: walk (Drogon) or take off &nbsp; <b>S</b> brake · land (low and slow)<br><b>Shift</b> surge · take off &nbsp; <b>Space / Click</b> dragonfire &nbsp; <b>R</b> roar<br><b>C</b> camera &nbsp; <b>T</b> advance time &nbsp; <b>M</b> map &nbsp; <b>P</b> photo mode</div>
    </div>`;
    this.root.appendChild(p);
    $('#p-resume', p).onclick = () => g.setState('playing');
    $('#p-map', p).onclick = () => g.setState('map');
    $('#p-select', p).onclick = () => g.setState('menu');
    // Low / Medium hold 60 fps by lowering the resolution; High stays sharp and settles for ~45 fps; Ultra is the screen's own resolution
    const GFX_NOTE = { low: 'Smoothest: holds 60 fps, may drop to a soft picture.', medium: 'Holds 60 fps; the picture softens when busy.', high: 'Sharp picture, ~45 fps or better.', ultra: "Your screen's full resolution, whatever the frame rate." };
    this.refreshGfx = () => {
      p.querySelectorAll('#p-q button').forEach(x => x.classList.toggle('on', x.dataset.gfx === g.gfx));
      const r = g.renderInfo(); $('#p-res', p).textContent = `${GFX_NOTE[g.gfx]} Drawing ${r.w} × ${r.h} (${r.pct}% of your screen).`;
    };
    p.querySelectorAll('#p-q button').forEach(b => b.onclick = () => { g.setGraphics(b.dataset.gfx); this.refreshGfx(); });
    this.refreshGfx();
    $('#p-sens', p).oninput = (e) => { g.input.sensitivity = parseFloat(e.target.value); };
    $('#p-vol', p).oninput = (e) => { if (g.audio) g.audio.setVolume(parseFloat(e.target.value)); };
    $('#p-inv', p).onchange = (e) => { g.input.invertY = e.target.checked; };
    $('#p-music', p).onchange = (e) => { if (g.audio) g.audio.setMusic(e.target.checked); };
  }

  show(state) {
    this.menu.classList.toggle('on', state === 'menu');
    this.hud.classList.toggle('on', state === 'playing');
    this.mapEl.classList.toggle('on', state === 'map');
    this.pause.classList.toggle('on', state === 'paused');
    if (state === 'map') this.refreshMap();
    if (state === 'menu') this.refreshMenu();
  }
}
