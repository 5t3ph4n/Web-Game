// Keyboard, mouse-drag camera and touch controls (floating joystick, pinch zoom, on-screen buttons).

/** Touch-first device? (`?touch=1` / `?touch=0` in the URL forces it either way.) */
export const IS_TOUCH = (() => {
  try {
    const q = new URLSearchParams(location.search).get('touch');
    if (q !== null) return q !== '0';
  } catch (e) { /* no location */ }
  return matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && matchMedia('(hover: none)').matches);
})();

export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.pressed = new Set(); // edge-triggered this frame
    this.look = { dx: 0, dy: 0 };
    this.zoom = 0;
    this.move = { x: 0, y: 0 };
    this.touchMove = { x: 0, y: 0, active: false };
    this.touchRun = false;
    this.enabled = true;
    this.isTouch = IS_TOUCH;

    addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    // drag to orbit the camera, pinch to zoom; a click/tap without dragging is a 'Tap' (mouse) or 'TouchTap'
    const pts = new Map();
    let pinch = 0, pinched = false;
    const spread = () => {
      const [a, b] = [...pts.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY, moved: 0, type: e.pointerType });
      if (pts.size === 2) { pinch = spread(); pinched = true; }
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      p.moved += Math.abs(dx) + Math.abs(dy);
      if (pts.size >= 2) {
        const s = spread();
        this.zoom += (pinch - s) * 0.035;
        pinch = s;
        return;
      }
      const k = p.type === 'touch' ? 1.3 : 1; // phones are small: turn a bit further per pixel
      this.look.dx += dx * k; this.look.dy += dy * k;
    });
    const end = (e) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      pts.delete(e.pointerId);
      if (p.moved < 8 && !pinched && e.type === 'pointerup') this.pressed.add(p.type === 'touch' ? 'TouchTap' : 'Tap');
      if (pts.size === 0) pinched = false;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', (e) => { this.zoom += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
  }

  /**
   * Floating joystick: touch anywhere in `zone` and the stick centres under your thumb, following it if you
   * drag past the rim. `base`/`knob` are the visible stick, which rests at its CSS position when idle.
   */
  bindJoystick(zone, base, knob) {
    const st = this.touchMove;
    const RAD = 52;
    const place = (x, y) => { base.style.left = x + 'px'; base.style.top = y + 'px'; base.classList.add('live'); };
    zone.addEventListener('pointerdown', (e) => {
      if (st.active) return;
      e.preventDefault();
      st.active = true; st.id = e.pointerId;
      const zr = zone.getBoundingClientRect();
      st.cx = Math.max(zr.left + RAD + 8, Math.min(e.clientX, zr.right - RAD - 8));
      st.cy = Math.max(zr.top + RAD + 8, Math.min(e.clientY, innerHeight - RAD - 8));
      place(st.cx, st.cy);
      zone.setPointerCapture(e.pointerId);
      upd(e);
    });
    const upd = (e) => {
      if (!st.active || e.pointerId !== st.id) return;
      let dx = e.clientX - st.cx, dy = e.clientY - st.cy;
      const l = Math.hypot(dx, dy);
      if (l > RAD) {
        // drag the stick along so turning around is instant
        st.cx += (dx / l) * (l - RAD); st.cy += (dy / l) * (l - RAD);
        place(st.cx, st.cy);
        dx *= RAD / l; dy *= RAD / l;
      }
      st.x = dx / RAD; st.y = -dy / RAD;
      this.touchRun = Math.hypot(dx, dy) > RAD * 0.92;
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      knob.classList.toggle('run', this.touchRun);
    };
    zone.addEventListener('pointermove', upd);
    const stop = (e) => {
      if (e.pointerId !== st.id) return;
      st.active = false; st.x = st.y = 0; this.touchRun = false;
      knob.style.transform = '';
      knob.classList.remove('run');
      base.style.left = base.style.top = '';
      base.classList.remove('live');
    };
    zone.addEventListener('pointerup', stop);
    zone.addEventListener('pointercancel', stop);
  }

  /** An on-screen button that acts like a key (held while pressed). `code` may be a function, read on press. */
  bindButton(el, code) {
    let held = null;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      held = typeof code === 'function' ? code() : code;
      if (!held) return;
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* already gone */ }
      this.pressed.add(held); this.keys.add(held);
      el.classList.add('down');
    });
    const up = () => { if (held) this.keys.delete(held); held = null; el.classList.remove('down'); };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  down(...codes) { return this.enabled && codes.some((c) => this.keys.has(c)); }
  hit(...codes) { return this.enabled && codes.some((c) => this.pressed.has(c)); }

  axes() {
    let x = 0, y = 0;
    if (!this.enabled) return { x, y };
    if (this.down('KeyW', 'ArrowUp')) y += 1;
    if (this.down('KeyS', 'ArrowDown')) y -= 1;
    if (this.down('KeyA', 'ArrowLeft')) x -= 1;
    if (this.down('KeyD', 'ArrowRight')) x += 1;
    if (this.touchMove.active) { x += this.touchMove.x; y += this.touchMove.y; }
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    return { x, y };
  }

  endFrame() {
    this.pressed.clear();
    this.look.dx = this.look.dy = 0;
    this.zoom = 0;
  }
}
