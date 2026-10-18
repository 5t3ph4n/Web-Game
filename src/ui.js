import * as THREE from 'three';
import { CHARACTER_SKINS, PALETTES, HATS, FACES, BACKS, LABELS, defaultLook, randomLook } from './character.js';
import { settings, saveSettings } from './settings.js';
import { REGIONS } from './planet.js';
import { NPCS, CRITTER_NAMES } from './content.js';
import { IS_TOUCH } from './input.js';

const $ = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};

// Control names in game text are written as {tokens} and shown for the device in hand: [keyboard, touch].
const CONTROL_WORDS = {
  'press E': ['press E', 'tap the pop-up button'],
  'Press E': ['Press E', 'Tap the pop-up button'],
  'SPACE': ['SPACE', 'the jump button'],
  'Space': ['SPACE', 'The jump button'],
  'hold SPACE': ['hold SPACE', 'hold the jump button'],
  'Hold SPACE': ['Hold SPACE', 'Hold the jump button'],
  'Press J': ['Press TAB or J', 'Tap the 📖 button'],
  'run': ['run (SHIFT)', 'push the stick all the way'],
  'row': ['Steer with A and D, row with W.', 'Push the stick to row and steer.'],
};
export const ctl = (text) => text.replace(/\{([^}]+)\}/g, (m, k) => (CONTROL_WORDS[k] ? CONTROL_WORDS[k][IS_TOUCH ? 1 : 0] : m));

// pop-up button icons for each kind of interaction
const ICONS = {
  'Talk': '💬', 'Pet': '❤️', 'Pick up': '✋', 'Sit': '🪑', 'Read': '📜', 'Make a wish': '✨', 'Stand up': '⬆️', 'Hop out': '🏝️', 'Jump out': '🪂',
};

export class UI {
  constructor() {
    this.root = document.getElementById('ui');
    this.modal = false;
    this.focus = null;
    if (IS_TOUCH) document.body.classList.add('is-touch');
    this.toasts = $('<div class="toasts"></div>');
    this.root.appendChild(this.toasts);
    this.loader = $(`<div class="loader"><div class="title-logo">WANDERER</div><div class="bar"><i></i></div><div class="msg">Loading…</div></div>`);
    this.root.appendChild(this.loader);
    this.bubbles = new Map();
    this.bubbleLayer = $('<div class="bubbles"></div>');
    this.root.appendChild(this.bubbleLayer);
    this.prompt = $('<div class="prompt hidden"><b class="key">E</b><span></span></div>');
    this.root.appendChild(this.prompt);
    this.place = $('<div class="place"><div class="pname"></div><div class="psub"></div><div class="pnew">NEW PLACE DISCOVERED</div></div>');
    this.root.appendChild(this.place);
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this.ctx = null;
  }

  loading(p, msg) {
    this.loader.querySelector('i').style.width = Math.round(p * 100) + '%';
    this.loader.querySelector('.msg').textContent = msg;
  }
  error(e) {
    this.loader.querySelector('.msg').textContent = 'Something went wrong: ' + (e && e.message ? e.message : e);
    this.loader.classList.add('err');
  }

  /** Title screen. Resolves when the player presses Start. */
  title(save, renderStill) {
    this.loader.classList.add('fade');
    setTimeout(() => this.loader.remove(), 800);
    return new Promise((resolve) => {
      const returning = save.data.places && save.data.places.length > 0;
      const el = $(`
        <div class="titlescreen">
          <div class="title-logo big">WANDERER</div>
          <div class="tagline">It's a big little planet. Go see all of it.</div>
          <div class="title-actions">
            <button class="start">${returning ? 'Continue' : 'Start exploring'}</button>
            <button class="secondary create">Character creator</button>
          </div>
          <div class="hint">${IS_TOUCH
            ? 'Left thumb to walk · JUMP to jump (hold to glide) · DIVE to go under water · tap the pop-up buttons to talk, pet, grab & ride · drag to look · pinch to zoom'
            : 'WASD / Arrows to walk · SHIFT run · SPACE jump/swim up · C dive · E interact · F pick up/throw · Drag to look'}</div>
          ${returning ? '<button class="linkish reset">Start over (erase save)</button>' : ''}
        </div>`);
      this.root.appendChild(el);
      const reset = el.querySelector('.reset');
      if (reset) reset.addEventListener('click', () => { save.reset(); location.reload(); });
      let alive = true;
      const loop = () => { if (!alive) return; renderStill(); requestAnimationFrame(loop); };
      loop();
      el.querySelector('.create').addEventListener('click', async () => {
        el.classList.add('hidden');
        await this.openCreator();
        el.classList.remove('hidden');
      });
      el.querySelector('.start').addEventListener('click', () => {
        alive = false;
        if (IS_TOUCH) this.fullscreen(true); // phones: get the browser bars out of the way
        el.classList.add('fade');
        setTimeout(() => el.remove(), 600);
        resolve();
      });
    });
  }

  // ------------------------------------------------------------------ character creator
  openCreator() {
    const g = this.game;
    if (this.creator) return Promise.resolve();
    if (g.player && g.player.mode !== 'walk' && g.player.mode !== 'sit') { this.toast('Find solid ground first, then change your look.'); return Promise.resolve(); }
    return new Promise((resolve) => {
      const look = { ...defaultLook(), ...(g.save.data.look || { base: g.save.data.skin || CHARACTER_SKINS[0] }) };
      const before = JSON.stringify(look);
      this.modal = true;
      this.creatorState = { yaw: 0, zoom: 0, tab: 'body' };
      const swatches = (key, list) => `<div class="swatches" data-k="${key}">${list.map((c) => `<button class="sw" data-v="${c}" style="--c:${c}" aria-label="${key} ${c}"></button>`).join('')}</div>`;
      const chips = (key, list) => `<div class="chips" data-k="${key}">${list.map((v) => `<button class="chip" data-v="${v}">${LABELS[v]}</button>`).join('')}</div>`;
      const slider = (key, label, min, max) => `<label class="slider"><span>${label}</span><input type="range" id="cc-${key}" data-k="${key}" min="${min}" max="${max}" step="0.01"><b></b></label>`;
      const el = $(`
        <div class="creator">
          <div class="cc-head">
            <div class="cc-title">CHARACTER</div>
            <input class="cc-name" id="cc-name" maxlength="16" placeholder="Your name" aria-label="Your name">
          </div>
          <div class="cc-tabs">
            <button data-t="body" class="on">Body</button><button data-t="hair">Hair & face</button><button data-t="clothes">Clothes</button><button data-t="extras">Extras</button>
          </div>
          <div class="cc-body">
            <section data-t="body">
              <h4>Base style</h4>
              <div class="stepper"><button class="arrow small" data-d="-1" aria-label="Previous style">◀</button><b class="base-n"></b><button class="arrow small" data-d="1" aria-label="Next style">▶</button></div>
              <h4>Skin tone</h4>${swatches('skin', PALETTES.skin)}
              <h4>Proportions</h4>
              ${slider('height', 'Height', 0.85, 1.15)}${slider('headSize', 'Head size', 0.85, 1.35)}${slider('build', 'Build', 0.85, 1.25)}
            </section>
            <section data-t="hair" hidden>
              <h4>Hair colour</h4>${swatches('hair', PALETTES.hair)}
              <h4>Hat</h4>${chips('hat', HATS)}
              <h4>Face</h4>${chips('face', FACES)}
            </section>
            <section data-t="clothes" hidden>
              <label class="toggle"><input type="checkbox" id="cc-recolor"> <span>Use my own colours (off = the style's original outfit)</span></label>
              <h4>Top</h4>${swatches('shirt', PALETTES.cloth)}
              <h4>Bottoms</h4>${swatches('pants', PALETTES.cloth)}
              <h4>Shoes</h4>${swatches('shoes', PALETTES.cloth)}
            </section>
            <section data-t="extras" hidden>
              <h4>On your back</h4>${chips('back', BACKS)}
              <h4>Accessory colour</h4>${swatches('accent', PALETTES.cloth)}
              <p class="cc-note">Capes and scarves are simulated cloth: they flutter when you run and float when you swim.</p>
            </section>
          </div>
          <div class="cc-foot">
            <button class="secondary rnd">Randomize</button>
            <button class="secondary undo">Reset</button>
            <button class="start done">Done</button>
          </div>
        </div>`);
      const hint = $('<div class="cc-hint">Drag the background to turn around</div>');
      this.root.appendChild(hint);
      this.root.appendChild(el);
      this.creator = el;
      const refresh = () => {
        el.querySelector('.base-n').textContent = `${CHARACTER_SKINS.indexOf(look.base) + 1} / ${CHARACTER_SKINS.length}`;
        el.querySelectorAll('.swatches').forEach((w) => w.querySelectorAll('.sw').forEach((b) => b.classList.toggle('on', look[w.dataset.k] === b.dataset.v)));
        el.querySelectorAll('.chips').forEach((w) => w.querySelectorAll('.chip').forEach((b) => b.classList.toggle('on', look[w.dataset.k] === b.dataset.v)));
        el.querySelectorAll('input[type=range]').forEach((r) => { r.value = look[r.dataset.k]; r.nextElementSibling.textContent = Math.round(look[r.dataset.k] * 100) + '%'; });
        el.querySelector('#cc-recolor').checked = !!look.recolor;
        el.querySelector('#cc-name').value = look.name || '';
      };
      let pending = null, building = false;
      const rebuild = async () => {
        if (building) { pending = true; return; }
        building = true;
        await g.setLook({ ...look });
        building = false;
        if (pending) { pending = false; rebuild(); }
      };
      const recolorOnly = () => {
        const a = g.player.anim;
        if (a.recolor && look.recolor && a.look.base === look.base) { Object.assign(a.look, look); a.recolor.paint(look); return true; }
        return false;
      };
      el.querySelectorAll('.cc-tabs button').forEach((b) => b.addEventListener('click', () => {
        el.querySelectorAll('.cc-tabs button').forEach((x) => x.classList.toggle('on', x === b));
        el.querySelectorAll('.cc-body section').forEach((sct) => { sct.hidden = sct.dataset.t !== b.dataset.t; });
        this.creatorState.tab = b.dataset.t;
      }));
      el.querySelectorAll('.stepper .arrow').forEach((b) => b.addEventListener('click', () => {
        const i = CHARACTER_SKINS.indexOf(look.base);
        look.base = CHARACTER_SKINS[(i + Number(b.dataset.d) + CHARACTER_SKINS.length) % CHARACTER_SKINS.length];
        refresh(); rebuild();
      }));
      el.querySelectorAll('.swatches').forEach((w) => w.addEventListener('click', (e) => {
        const b = e.target.closest('.sw'); if (!b) return;
        look[w.dataset.k] = b.dataset.v;
        const structural = w.dataset.k === 'accent';
        if (!look.recolor && w.dataset.k !== 'accent') look.recolor = true;
        refresh();
        if (structural || !recolorOnly()) rebuild();
      }));
      el.querySelectorAll('.chips').forEach((w) => w.addEventListener('click', (e) => {
        const b = e.target.closest('.chip'); if (!b) return;
        look[w.dataset.k] = b.dataset.v; refresh(); rebuild();
      }));
      el.querySelectorAll('input[type=range]').forEach((r) => {
        r.addEventListener('input', () => {
          look[r.dataset.k] = parseFloat(r.value);
          r.nextElementSibling.textContent = Math.round(look[r.dataset.k] * 100) + '%';
          const a = g.player.anim;
          if (r.dataset.k === 'headSize') a.proportions.head = look.headSize;
          if (r.dataset.k === 'build') a.proportions.build = look.build;
        });
        r.addEventListener('change', () => { if (r.dataset.k === 'height' || r.dataset.k === 'build') rebuild(); });
      });
      el.querySelector('#cc-recolor').addEventListener('change', (e) => { look.recolor = e.target.checked; rebuild(); });
      el.querySelector('#cc-name').addEventListener('input', (e) => { look.name = e.target.value.slice(0, 16); });
      el.querySelector('#cc-name').addEventListener('keydown', (e) => e.stopPropagation());
      el.querySelector('.rnd').addEventListener('click', () => { Object.assign(look, randomLook(), { name: look.name }); refresh(); rebuild(); });
      el.querySelector('.undo').addEventListener('click', () => { Object.assign(look, JSON.parse(before)); refresh(); rebuild(); });
      el.querySelector('.done').addEventListener('click', async () => {
        await g.setLook({ ...look }, true);
        el.classList.add('out');
        hint.remove();
        setTimeout(() => el.remove(), 250);
        this.creator = null;
        this.creatorState = null;
        this.modal = false;
        g.audio.discover();
        resolve();
      });
      refresh();
    });
  }

  toggleSettings() {
    const g = this.game;
    if (this.settingsEl) { this.settingsEl.remove(); this.settingsEl = null; this.modal = false; return; }
    if (this.modal) return;
    this.modal = true;
    const el = $(`
      <div class="journal settings">
        <div class="jhead">SETTINGS <button class="close" aria-label="Close">✕</button></div>
        <h4>Graphics quality</h4>
        <div class="chips" data-k="quality">${['low', 'medium', 'high'].map((v) => `<button class="chip ${settings.quality === v ? 'on' : ''}" data-v="${v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div>
        <p class="cc-note">High adds sharper shadows, anti-aliasing and more lights. Medium and High use ambient occlusion and bloom.</p>
        <label class="toggle"><input type="checkbox" id="st-auto" ${settings.autoQuality ? 'checked' : ''}> <span>Lower quality automatically if the game runs slowly</span></label>
        <h4>Art style</h4>
        <div class="chips" data-k="style">${[['realistic', 'Realistic'], ['storybook', 'Storybook']].map(([v, l]) => `<button class="chip ${settings.style === v ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>
        <p class="cc-note">Changing the art style reloads the game. Your progress is kept.</p>
        <label class="toggle"><input type="checkbox" id="st-ink" ${settings.outlines ? 'checked' : ''}> <span>Ink outlines</span></label>
        <label class="toggle"><input type="checkbox" id="st-music" ${settings.music ? 'checked' : ''}> <span>Music</span></label>
        <label class="toggle"><input type="checkbox" id="st-lamp" ${g.lights.carryOn ? 'checked' : ''}> <span>Carry a lantern at night (L)</span></label>
      </div>`);
    el.querySelector('.close').addEventListener('click', () => this.toggleSettings());
    el.querySelectorAll('.chips[data-k=quality] .chip').forEach((b) => b.addEventListener('click', () => {
      el.querySelectorAll('.chips[data-k=quality] .chip').forEach((x) => x.classList.toggle('on', x === b));
      g.applyQuality(b.dataset.v);
    }));
    el.querySelectorAll('.chips[data-k=style] .chip').forEach((b) => b.addEventListener('click', () => {
      if (settings.style === b.dataset.v) return;
      settings.style = b.dataset.v;
      settings.outlines = b.dataset.v === 'storybook';
      saveSettings();
      g.save.write();
      location.reload();
    }));
    el.querySelector('#st-auto').addEventListener('change', (e) => { settings.autoQuality = e.target.checked; saveSettings(); });
    el.querySelector('#st-ink').addEventListener('change', (e) => { settings.outlines = e.target.checked; saveSettings(); });
    el.querySelector('#st-music').addEventListener('change', (e) => { settings.music = e.target.checked; g.audio.musicOn = settings.music; saveSettings(); });
    el.querySelector('#st-lamp').addEventListener('change', (e) => { g.lights.carryOn = e.target.checked; });
    this.root.appendChild(el);
    this.settingsEl = el;
  }

  bind(game) {
    this.game = game;
    const { save, audio } = game;
    this.hudEl = $(`
      <div class="hud hidden">
        <div class="hud-left"><div class="here"></div></div>
        <div class="hud-right">
          <div class="stars" title="Stardrops"><span class="star-ico">★</span><span class="count">0</span></div>
          <button class="hb journal-btn" title="Journal (J)" aria-label="Journal">📖</button>
          <button class="hb wardrobe-btn" title="Character (K)" aria-label="Character creator">👕</button>
          <button class="hb photo-btn" title="Photo mode (P)" aria-label="Photo mode">📷</button>
          <button class="hb mute-btn" title="Sound (M)" aria-label="Sound">${save.data.muted ? '🔇' : '🔊'}</button>
          <button class="hb settings-btn" title="Settings" aria-label="Settings">⚙</button>
          <button class="hb help-btn" title="Controls (H)" aria-label="Help">?</button>
        </div>
        <div class="clock"></div>
        <div class="breath hidden"><span>AIR</span><div class="bar"><i></i></div></div>
      </div>`);
    this.root.appendChild(this.hudEl);
    this.hudEl.querySelector('.journal-btn').addEventListener('click', () => this.toggleJournal());
    this.hudEl.querySelector('.wardrobe-btn').addEventListener('click', () => { if (!this.modal) this.openCreator(); });
    this.hudEl.querySelector('.photo-btn').addEventListener('click', () => this.togglePhoto());
    this.hudEl.querySelector('.help-btn').addEventListener('click', () => this.toggleHelp());
    this.hudEl.querySelector('.settings-btn').addEventListener('click', () => this.toggleSettings());
    const mb = this.hudEl.querySelector('.mute-btn');
    mb.addEventListener('click', () => {
      save.data.muted = !save.data.muted; save.write();
      audio.setMuted(save.data.muted);
      mb.textContent = save.data.muted ? '🔇' : '🔊';
    });
    // photo mode hides the HUD, so it needs its own way out (there's no Escape key on a phone)
    this.photoExit = $(`<button class="photo-exit" aria-label="Leave photo mode">✕ Done</button>`);
    this.photoExit.addEventListener('click', () => { if (this.photo) this.togglePhoto(); });
    this.root.appendChild(this.photoExit);
    // the floating prompt can be tapped too
    this.prompt.addEventListener('pointerdown', (e) => {
      if (!this.ctx || !this.ctx.code) return;
      e.preventDefault();
      input.pressed.add(this.ctx.code);
    });
    this.starCount(save.data.stars.length, game.world.totalStars);
  }

  fullscreen(on) {
    const d = document, el = d.documentElement;
    try {
      if (on && !d.fullscreenElement && el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
      else if (!on && d.fullscreenElement) d.exitFullscreen().catch(() => {});
    } catch (e) { /* not supported (iPhone Safari) */ }
  }

  hud(show) { this.hudEl.classList.toggle('hidden', !show); }
  starCount(n, total) {
    const c = this.hudEl && this.hudEl.querySelector('.count');
    if (c) c.textContent = `${n} / ${total}`;
    if (this.hudEl) { this.hudEl.querySelector('.stars').classList.remove('pop'); void this.hudEl.offsetWidth; this.hudEl.querySelector('.stars').classList.add('pop'); }
    if (n === total && total > 0) this.toast('You found every Stardrop! The planet glows a little brighter tonight. ★', 'star');
  }

  toast(text, kind = '') {
    const t = $(`<div class="toast ${kind}"></div>`);
    t.textContent = ctl(text);
    this.toasts.appendChild(t);
    setTimeout(() => t.classList.add('out'), 3800);
    setTimeout(() => t.remove(), 4400);
    while (this.toasts.children.length > 4) this.toasts.firstChild.remove();
  }

  placeTitle(name, sub, isNew) {
    const p = this.place;
    p.querySelector('.pname').textContent = name;
    p.querySelector('.psub').textContent = sub;
    p.querySelector('.pnew').style.display = isNew ? '' : 'none';
    p.classList.remove('show'); void p.offsetWidth; p.classList.add('show');
    if (this.hudEl) this.hudEl.querySelector('.here').textContent = name;
  }

  /** Messenger-style dialogue box with typewriter text. */
  dialogue(name, lines, pitch, focusPos, onClose) {
    if (this.dlg) return;
    this.modal = true;
    this.focus = focusPos ? focusPos.clone().addScaledVector(focusPos.clone().normalize(), 1.2) : null;
    const el = $(`<div class="dialogue"><div class="dname"></div><div class="dtext"></div><div class="dnext">▼</div></div>`);
    el.querySelector('.dname').textContent = name;
    if (!name) el.querySelector('.dname').remove();
    this.root.appendChild(el);
    const st = { el, lines: lines.map(ctl), i: 0, shown: 0, pitch, onClose, t: 0 };
    this.dlg = st;
    el.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.advance(); });
    this.prompt.classList.add('hidden');
  }
  advance() {
    const st = this.dlg;
    if (!st) return;
    const line = st.lines[st.i];
    if (st.shown < line.length) { st.shown = line.length; return; }
    st.i++; st.shown = 0;
    if (st.i >= st.lines.length) {
      st.el.classList.add('out');
      setTimeout(() => st.el.remove(), 250);
      this.dlg = null;
      this.modal = false;
      this.focus = null;
      st.onClose && st.onClose();
    }
  }

  toggleJournal(force) {
    const g = this.game;
    if (this.journal || force === false) {
      if (this.journal) { this.journal.remove(); this.journal = null; this.modal = false; }
      return;
    }
    if (this.modal) return;
    this.modal = true;
    const save = g.save.data;
    const places = REGIONS.map((r) => {
      const got = save.places.includes(r.id);
      return `<li class="${got ? 'got' : ''}">${got ? `<button class="go" data-r="${r.id}">Travel</button>` : ''}<b>${got ? r.name : '???'}</b><small>${got ? r.sub : 'Not yet discovered'}</small></li>`;
    }).join('');
    const friends = NPCS.map((n) => `<li class="${save.friends.includes(n.id) ? 'got' : ''}"><b>${save.friends.includes(n.id) ? n.name : '???'}</b><small>${save.friends.includes(n.id) ? REGIONS.find((r) => r.id === n.region).name : 'Someone out there…'}</small></li>`).join('');
    const critterTypes = Object.keys(CRITTER_NAMES).filter((t) => t !== 'fish');
    const crit = critterTypes.map((t) => `<li class="${save.critters.includes(t) ? 'got' : ''}"><b>${save.critters.includes(t) ? CRITTER_NAMES[t] : '???'}</b></li>`).join('');
    const el = $(`
      <div class="journal">
        <div class="jhead">JOURNAL <button class="close" aria-label="Close">✕</button></div>
        <div class="jstats">
          <div><b>${save.places.length}</b>/${REGIONS.length}<small>Places</small></div>
          <div><b>${save.friends.length}</b>/${NPCS.length}<small>Friends</small></div>
          <div><b>${save.critters.length}</b>/${critterTypes.length}<small>Critters</small></div>
          <div><b>${save.stars.length}</b>/${g.world.totalStars}<small>Stardrops</small></div>
        </div>
        <div class="jtabs"><button class="on" data-t="p">Places</button><button data-t="f">Friends</button><button data-t="c">Critters</button></div>
        <ul class="jlist" data-t="p">${places}</ul>
        <ul class="jlist hidden" data-t="f">${friends}</ul>
        <ul class="jlist cols hidden" data-t="c">${crit}</ul>
        <div class="jfoot">${g.player.hasGlider ? ctl('☂ You have a parasol: {hold SPACE} while falling.') : 'Tip: someone in Pebbleton makes parasols…'}</div>
      </div>`);
    el.querySelectorAll('.jtabs button').forEach((b) => b.addEventListener('click', () => {
      el.querySelectorAll('.jtabs button').forEach((x) => x.classList.toggle('on', x === b));
      el.querySelectorAll('.jlist').forEach((l) => l.classList.toggle('hidden', l.dataset.t !== b.dataset.t));
    }));
    el.querySelector('.close').addEventListener('click', () => this.toggleJournal(false));
    el.querySelectorAll('.go').forEach((b) => b.addEventListener('click', () => {
      this.toggleJournal(false);
      g.world.travelTo(b.dataset.r);
    }));
    this.root.appendChild(el);
    this.journal = el;
  }

  toggleHelp() {
    if (this.help) { this.help.remove(); this.help = null; return; }
    const rows = IS_TOUCH ? `
          <tr><td><b>Left thumb</b></td><td>Touch anywhere on the left and drag to walk · push all the way to run (scares animals!)</td></tr>
          <tr><td><b>JUMP</b></td><td>Jump · hold it in the air to glide (once you have a parasol)</td></tr>
          <tr><td><b>Pop-up button</b></td><td>Appears when something's nearby: talk, pet, sit, read, ride, hop out…</td></tr>
          <tr><td><b>Drag</b> · <b>Pinch</b></td><td>Look around · Zoom</td></tr>
          <tr><td><b>📖 📷 🔊</b></td><td>Journal · Photo mode · Sound</td></tr>` : `
          <tr><td><b>WASD</b> / Arrows</td><td>Walk</td></tr>
          <tr><td><b>Shift</b></td><td>Run (scares animals!)</td></tr>
          <tr><td><b>Space</b></td><td>Jump · hold in the air to glide (once you have a parasol) · swim up</td></tr>
          <tr><td><b>C</b> / Ctrl</td><td>Dive under water (watch your air!)</td></tr>
          <tr><td><b>F</b></td><td>Pick up / throw balls, crates, fruit and snowballs</td></tr>
          <tr><td><b>K</b></td><td>Character creator</td></tr>
          <tr><td><b>L</b></td><td>Toggle your night lantern</td></tr>
          <tr><td><b>E</b> / Click</td><td>Talk, pet, sit, ride, read</td></tr>
          <tr><td><b>Drag</b> · <b>Scroll</b></td><td>Look around · Zoom</td></tr>
          <tr><td><b>J</b> / Tab</td><td>Journal</td></tr>
          <tr><td><b>P</b></td><td>Photo mode (hide UI)</td></tr>
          <tr><td><b>M</b></td><td>Mute</td></tr>`;
    const canFull = IS_TOUCH && document.fullscreenEnabled;
    this.help = $(`
      <div class="help">
        <div class="jhead">HOW TO WANDER <button class="close" aria-label="Close">✕</button></div>
        <table>${rows}</table>
        <p>Find all the places, make friends, befriend critters and collect Stardrops. Or just walk around. That's fine too.</p>
        ${canFull ? '<button class="fs-btn">⛶ Toggle fullscreen</button>' : ''}
      </div>`);
    this.help.querySelector('.close').addEventListener('click', () => this.toggleHelp());
    const fs = this.help.querySelector('.fs-btn');
    if (fs) fs.addEventListener('click', () => this.fullscreen(!document.fullscreenElement));
    this.root.appendChild(this.help);
  }

  togglePhoto() {
    this.photo = !this.photo;
    document.body.classList.toggle('photo', this.photo);
    if (this.photo) this.toastPhoto = setTimeout(() => {}, 0);
  }

  /** On-screen controls: floating joystick (left), jump (right), and a pop-up action button above it. */
  showTouch(input) {
    const el = $(`
      <div class="touch">
        <div class="joyzone"></div>
        <div class="joy"><div class="knob"></div></div>
        <button class="tb jump" aria-label="Jump"><span class="ico">⤒</span><small>JUMP</small></button>
        <button class="tb dive" aria-label="Dive"><span class="ico">⤓</span><small>DIVE</small></button>
        <button class="act" aria-label="Interact"><span class="ico"></span><span class="lbl"></span></button>
      </div>`);
    this.root.appendChild(el);
    input.bindJoystick(el.querySelector('.joyzone'), el.querySelector('.joy'), el.querySelector('.knob'));
    input.bindButton(el.querySelector('.jump'), 'Space');
    input.bindButton(el.querySelector('.dive'), 'KeyDive');
    this.diveBtn = el.querySelector('.dive');
    this.actBtn = el.querySelector('.act');
    input.bindButton(this.actBtn, () => (this.ctx && this.ctx.code) || null);
    this.jumpIco = el.querySelector('.jump .ico');
    document.body.classList.add('is-touch');
  }

  /**
   * Float the prompt over whatever you can interact with (or over yourself for stand up / hop out / jump out),
   * and on touch screens pop up the big action button in thumb reach.
   */
  showAction(ctx, game) {
    const { player, camera } = game;
    this.ctx = ctx;
    const key = ctx ? ctx.label + '|' + (ctx.name || '') : '';
    const icon = ctx ? ctx.icon || ICONS[ctx.label] || '✋' : '';
    if (key !== this._ctxKey) {
      this._ctxKey = key;
      if (ctx) {
        this.prompt.querySelector('span').textContent = ctx.label + (ctx.name ? ' · ' + ctx.name : '');
        const k = this.prompt.querySelector('.key');
        k.textContent = IS_TOUCH ? icon : ctx.key;
        k.classList.toggle('wide', !IS_TOUCH && ctx.key.length > 1);
      }
      if (this.actBtn) {
        this.actBtn.classList.toggle('show', !!ctx);
        if (ctx) {
          this.actBtn.querySelector('.ico').textContent = icon;
          this.actBtn.querySelector('.lbl').innerHTML = '';
          this.actBtn.querySelector('.lbl').append(ctx.label, ...(ctx.name ? [Object.assign(document.createElement('small'), { textContent: ctx.name })] : []));
          this.actBtn.classList.remove('pop'); void this.actBtn.offsetWidth; this.actBtn.classList.add('pop');
        }
      }
    }
    if (this.jumpIco) {
      const glide = player.hasGlider && !player.onGround && player.mode !== 'swim' && player.mode !== 'ride';
      const ico = glide ? '☂' : '⤒';
      if (this.jumpIco.textContent !== ico) this.jumpIco.textContent = ico;
    }
    if (!ctx) { this.prompt.classList.add('hidden'); return; }
    const at = ctx.it ? ctx.it.pos : player.pos;
    const lift = ctx.it ? (ctx.it.npc ? 2.6 : 1.6) : 2.4;
    const v = this._v.copy(at).addScaledVector(this._v2.copy(at).normalize(), lift).project(camera);
    if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) { this.prompt.classList.add('hidden'); return; } // behind / off screen
    this.prompt.classList.remove('hidden');
    // keep the whole bubble on screen when its target is near an edge
    const hw = this.prompt.offsetWidth / 2 + 8, ph = this.prompt.offsetHeight + 8;
    const x = Math.min(Math.max(((v.x + 1) / 2) * innerWidth, hw), innerWidth - hw);
    const y = Math.max(((1 - v.y) / 2) * innerHeight, ph);
    this.prompt.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
  }

  // ------------------------------------------------------------------ per-frame
  update(dt, game) {
    const { input, player, camera, interactables, audio } = game;
    // global keys
    if (input.hit('KeyJ', 'Tab')) this.toggleJournal();
    if (input.hit('KeyH')) this.toggleHelp();
    if (input.hit('KeyP')) this.togglePhoto();
    if (input.hit('KeyM')) this.hudEl.querySelector('.mute-btn').click();
    if (input.hit('KeyK') && !this.modal) this.openCreator();
    if (input.hit('KeyL')) { game.lights.carryOn = !game.lights.carryOn; this.toast(game.lights.carryOn ? 'Lantern on' : 'Lantern off'); }
    // breath meter
    const br = this.hudEl.querySelector('.breath');
    const showBreath = player.mode === 'dive' || player.breath < 0.999;
    br.classList.toggle('hidden', !showBreath);
    if (showBreath) { const i = br.querySelector('i'); i.style.width = Math.round(player.breath * 100) + '%'; br.classList.toggle('low', player.breath < 0.25); }
    if (this.diveBtn) this.diveBtn.classList.toggle('show', player.inWater);
    if (input.hit('Escape')) { this.toggleJournal(false); if (this.help) this.toggleHelp(); if (this.photo) this.togglePhoto(); if (this.settingsEl) this.toggleSettings(); }
    if (this.modal !== this._wasModal) { this._wasModal = this.modal; document.body.classList.toggle('modal', this.modal); }
    if (this.creator) return;

    // dialogue typing
    if (this.dlg) {
      this.showAction(null, game);
      const st = this.dlg;
      const line = st.lines[st.i];
      if (st.shown < line.length) {
        st.t += dt;
        const before = st.shown;
        st.shown = Math.min(line.length, st.shown + dt * 48);
        if (Math.floor(st.shown / 3) !== Math.floor(before / 3) && st.pitch > 0) audio.blip(st.pitch);
      }
      st.el.querySelector('.dtext').textContent = line.slice(0, Math.floor(st.shown));
      st.el.querySelector('.dnext').style.visibility = st.shown >= line.length ? 'visible' : 'hidden';
      if (input.hit('KeyE', 'Space', 'Enter', 'Tap', 'TouchTap')) this.advance();
      return;
    }

    // clock
    const t = game.sky.time;
    const hrs = Math.floor(t * 24), mins = Math.floor((t * 24 * 60) % 60);
    const icon = game.sky.night > 0.5 ? '☾' : game.sky.weather === 'rain' ? '☂' : game.sky.weather === 'cloudy' ? '☁' : '☀';
    const clk = this.hudEl.querySelector('.clock');
    const txt = `${icon} ${String(hrs).padStart(2, '0')}:${String(Math.floor(mins / 10) * 10).padStart(2, '0')}`;
    if (clk.textContent !== txt) clk.textContent = txt;

    // nearest interactable, preferring whatever you're facing
    let best = null, bestS = Infinity;
    const pp = player.pos;
    if (player.mode !== 'sit' && player.mode !== 'ride' && !this.modal) {
      for (const it of interactables) {
        if (it.enabled === false) continue;
        if (it.body && player.holding) continue;
        const d = it.pos.distanceTo(pp);
        if (d >= it.radius) continue;
        const ahead = d > 0.01 ? this._v.copy(it.pos).sub(pp).dot(player.facing) / d : 1;
        const score = d - Math.max(0, ahead) * 0.9;
        if (score < bestS) { best = it; bestS = score; }
      }
    }
    this.current = best;

    // what E (or the pop-up button) does right now
    const { boat, balloon } = game.world;
    let ctx = null;
    if (!this.modal) {
      if (player.mode === 'sit') ctx = { label: 'Stand up', code: 'KeyE', key: 'E' };
      else if (boat && boat.riding) ctx = boat.landing ? { label: 'Hop out', code: 'KeyE', key: 'E' } : null;
      else if (balloon && balloon.flying && player.mode === 'ride') ctx = { label: 'Jump out', code: 'Space', key: 'SPACE' };
      else if (player.holding) ctx = { label: 'Throw', name: player.holding.name, code: 'KeyF', key: 'F', icon: '🤾' };
      else if (best) ctx = { label: best.label, name: best.name, icon: best.icon, code: 'KeyE', key: 'E', it: best };
    }
    this.showAction(ctx, game);
    if (best && (input.hit('KeyE', 'Enter') || input.hit('Tap'))) {
      best.action();
      input.pressed.clear();
    }

    // NPC speech bubbles
    const npcs = game.world.people.npcs;
    for (const n of npcs) {
      let b = this.bubbles.get(n);
      const show = n.near !== undefined && n.near < 13 && !n.talking && !this.modal && (!best || best.npc !== n);
      if (show && !b) {
        b = $(`<div class="bubble"></div>`);
        b.textContent = n.def.hi;
        this.bubbleLayer.appendChild(b);
        this.bubbles.set(n, b);
      }
      if (b) {
        if (!show) { b.remove(); this.bubbles.delete(n); continue; }
        const v = this._v.copy(n.pos).addScaledVector(n.up, 2.3).project(camera);
        if (v.z > 1) { b.style.display = 'none'; continue; }
        b.style.display = '';
        b.style.opacity = String(1 - Math.max(0, (n.near - 9) / 4));
        b.style.transform = `translate(${((v.x + 1) / 2) * innerWidth}px, ${((1 - v.y) / 2) * innerHeight}px) translate(-50%, -100%)`;
      }
    }
  }
}
