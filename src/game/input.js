// Keyboard / mouse (pointer lock) / gamepad input.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set(); this.pressed = new Set();
    this.mouseDX = 0; this.mouseDY = 0; this.mouseButtons = 0; this.wheel = 0;
    this.locked = false; this.enabled = false;
    this.sensitivity = 1.0; this.invertY = false;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code); this.pressed.add(e.code);
      if (this.enabled && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    this.lockFailed = false; this.edgeX = 0; this.edgeY = 0;
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseButtons = 0; this.edgeX = this.edgeY = 0; });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; if (this.locked) { this.lockFailed = false; this.edgeX = this.edgeY = 0; } });
    document.addEventListener('pointerlockerror', () => { this.lockFailed = true; });
    document.addEventListener('mousemove', (e) => {
      if (this.locked) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; return; }
      if (!this.enabled) return;
      // No pointer lock (embedded previews refuse it, and a browser has none until the first click):
      // steer with plain cursor movement instead.
      const c = (v) => Math.max(-90, Math.min(90, v || 0));
      this.mouseDX += c(e.movementX); this.mouseDY += c(e.movementY);
      // A free cursor runs out of window, so once lock has been refused, resting it near an edge keeps turning that way.
      if (this.lockFailed) {
        const band = 0.09, edge = (n) => (n < band ? n / band - 1 : n > 1 - band ? 1 - (1 - n) / band : 0);
        this.edgeX = edge(e.clientX / window.innerWidth); this.edgeY = edge(e.clientY / window.innerHeight);
      }
    });
    document.documentElement.addEventListener('mouseleave', () => { this.edgeX = this.edgeY = 0; });
    canvas.addEventListener('mousedown', (e) => {
      this.mouseButtons |= (1 << e.button);
      if (this.enabled && !this.locked) { try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => { this.lockFailed = true; }); } catch (err) { this.lockFailed = true; } }
    });
    window.addEventListener('mouseup', (e) => { this.mouseButtons &= ~(1 << e.button); });
    canvas.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  down(code) { return this.keys.has(code); }
  hit(code) { return this.pressed.has(code); }
  releaseLock() { if (document.pointerLockElement) document.exitPointerLock(); }
  // returns the per-frame control intent, then clears accumulated deltas
  poll() {
    const k = (c) => (this.keys.has(c) ? 1 : 0);
    let turn = k('KeyD') + k('ArrowRight') - k('KeyA') - k('ArrowLeft');
    let pitch = k('ArrowUp') - k('ArrowDown');
    let throttle = k('KeyW') - k('KeyS');
    let boost = k('ShiftLeft') || k('ShiftRight');
    let fire = k('Space') || (this.mouseButtons & 1 ? 1 : 0);
    let mx = this.mouseDX * 0.0022 * this.sensitivity, my = this.mouseDY * 0.0022 * this.sensitivity * (this.invertY ? -1 : 1);
    // gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp) continue;
      const dz = (v) => (Math.abs(v) < 0.14 ? 0 : v);
      turn += dz(gp.axes[0] || 0); pitch -= dz(gp.axes[1] || 0);
      mx += dz(gp.axes[2] || 0) * 0.035; my += dz(gp.axes[3] || 0) * 0.03;
      const b = (i) => (gp.buttons[i] ? gp.buttons[i].value : 0);
      throttle += b(7) - b(6); boost = boost || b(0) > 0.5; fire = fire || b(5) > 0.5 || b(2) > 0.5;
      if (b(3) > 0.5 && !this._padY) this.pressed.add('KeyR'); this._padY = b(3) > 0.5;
      if (b(9) > 0.5 && !this._padS) this.pressed.add('Escape'); this._padS = b(9) > 0.5;
      break;
    }
    const out = {
      turn: Math.max(-1, Math.min(1, turn)), pitch: Math.max(-1, Math.min(1, pitch)), throttle: Math.max(-1, Math.min(1, throttle)),
      boost: !!boost, fire: !!fire, mx, my, wheel: this.wheel,
      // edge-of-screen look rates (-1..1), only while steering with an unlocked cursor
      lookX: this.enabled && !this.locked ? this.edgeX : 0,
      lookY: this.enabled && !this.locked ? this.edgeY * (this.invertY ? -1 : 1) : 0,
    };
    this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0;
    return out;
  }
  endFrame() { this.pressed.clear(); }
}
