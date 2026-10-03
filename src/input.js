// Keyboard, mouse-drag camera and touch joystick input.
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
    this.isTouch = matchMedia('(pointer: coarse)').matches;

    addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    // mouse / touch drag to orbit the camera
    let dragId = null, lx = 0, ly = 0;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' && this.touchMove.active && e.pointerId === this.touchMove.id) return;
      dragId = e.pointerId; lx = e.clientX; ly = e.clientY;
      this.dragMoved = 0;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== dragId) return;
      const dx = e.clientX - lx, dy = e.clientY - ly;
      this.look.dx += dx; this.look.dy += dy;
      this.dragMoved += Math.abs(dx) + Math.abs(dy);
      lx = e.clientX; ly = e.clientY;
    });
    const end = (e) => {
      if (e.pointerId !== dragId) return;
      dragId = null;
      if (this.dragMoved < 6) this.pressed.add('Tap');
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', (e) => { this.zoom += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
  }

  /** Wire up on-screen touch controls. */
  bindTouch(joy, knob, buttons) {
    const st = this.touchMove;
    const R = 50;
    joy.addEventListener('pointerdown', (e) => {
      st.active = true; st.id = e.pointerId;
      const r = joy.getBoundingClientRect();
      st.cx = r.left + r.width / 2; st.cy = r.top + r.height / 2;
      joy.setPointerCapture(e.pointerId);
      upd(e);
    });
    const upd = (e) => {
      if (!st.active || e.pointerId !== st.id) return;
      let dx = e.clientX - st.cx, dy = e.clientY - st.cy;
      const l = Math.hypot(dx, dy);
      if (l > R) { dx *= R / l; dy *= R / l; }
      st.x = dx / R; st.y = -dy / R;
      this.touchRun = l > R * 0.95;
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    joy.addEventListener('pointermove', upd);
    const stop = (e) => {
      if (e.pointerId !== st.id) return;
      st.active = false; st.x = st.y = 0; this.touchRun = false;
      knob.style.transform = '';
    };
    joy.addEventListener('pointerup', stop);
    joy.addEventListener('pointercancel', stop);
    for (const [el, code] of buttons) {
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); this.pressed.add(code); this.keys.add(code); });
      const up = () => this.keys.delete(code);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointerleave', up);
      el.addEventListener('pointercancel', up);
    }
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
