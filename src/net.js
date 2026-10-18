import * as THREE from 'three';
import { R, overHorizon } from './planet.js';
import { makeCharacter, defaultLook, CHARACTER_SKINS, HATS, FACES, BACKS } from './character.js';
import { orient, tangent } from './player.js';

/**
 * Multiplayer: everyone who has the game open sees everyone else wandering the planet.
 *
 * Each player shares a small, absolute state (where they are, which way they face, what they're doing, their
 * look) about ten times a second. Transports, first one available wins:
 *   1. the claude.ai artifact room (presence) when the game runs as a published artifact,
 *   2. a WebSocket relay (`?relay=wss://…` or VITE_RELAY at build time, see server/relay.mjs),
 *   3. a BroadcastChannel, so tabs of the same browser see each other.
 * Everything that comes in is untrusted and is validated before it touches the scene.
 */

const SEND_HZ = 10;
const STALE = 6; // seconds without a message before a relay/tab player is dropped
const VIEW = 150;
const ANIMS = ['idle', 'walk', 'sprint', 'fall', 'jump', 'holding-both', 'sit', 'attack-melee-right'];
const MODES = ['walk', 'swim', 'dive', 'glide', 'sit', 'ride'];

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _side = new THREE.Vector3();
const r2 = (x) => Math.round(x * 100) / 100;
const num = (x, lo, hi, d = 0) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d);
const vec3 = (a) => Array.isArray(a) && a.length === 3 && a.every((x) => typeof x === 'number' && Number.isFinite(x)) ? a : null;
const colour = (c, d) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : d);
const oneOf = (x, list, d) => (list.includes(x) ? x : d);

/** A look someone else sent us, reduced to known options. */
function cleanLook(lk) {
  const d = defaultLook();
  if (!lk || typeof lk !== 'object') return d;
  return {
    base: oneOf(lk.base, CHARACTER_SKINS, d.base), recolor: !!lk.recolor,
    skin: colour(lk.skin, d.skin), hair: colour(lk.hair, d.hair), shirt: colour(lk.shirt, d.shirt),
    pants: colour(lk.pants, d.pants), shoes: colour(lk.shoes, d.shoes), accent: colour(lk.accent, d.accent),
    hat: oneOf(lk.hat, HATS, 'none'), face: oneOf(lk.face, FACES, 'none'), back: oneOf(lk.back, BACKS, 'none'),
    height: num(lk.height, 0.8, 1.25, 1), headSize: num(lk.headSize, 0.8, 1.4, 1), build: num(lk.build, 0.8, 1.3, 1),
    name: typeof lk.name === 'string' ? lk.name.slice(0, 16) : '',
  };
}

// ------------------------------------------------------------------ transports
// Each one calls hooks.state(id, obj, info) when a player's state arrives and hooks.leave(id) when they go.

async function roomTransport(hooks) {
  if (!window.claude?.use) return null;
  const room = await window.claude.use('room').catch(() => null);
  if (!room) return null;
  const user = await window.claude.use('user').catch(() => null);
  room.onPeers((ch) => {
    for (const p of ch.left) hooks.leave(p.peer);
    for (const p of [...ch.joined, ...ch.updated]) {
      if (p.sameTab || p.kind === 'agent') continue;
      hooks.state(p.peer, p.presence, { by: p.by, guest: p.guest });
    }
  }, (e) => console.warn('room:', e));
  let lastLook = null;
  return {
    kind: 'room',
    send(s, look) {
      const patch = { ...s };
      const lk = JSON.stringify(look);
      if (lk !== lastLook) { patch.lk = look; lastLook = lk; }
      room.presence(patch).catch(() => { lastLook = null; });
    },
    async name(by) {
      if (!user || !by) return '';
      const ps = await user.profiles([by]).catch(() => null);
      return (ps && ps[by] && ps[by].name) || '';
    },
    close() { room.presence({ p: null }).catch(() => {}); },
  };
}

function relayTransport(url, hooks) {
  let ws = null, open = false, retry = 1, closed = false, n = 0;
  const connect = () => {
    try { ws = new WebSocket(url); } catch (e) { console.warn('relay:', e); return; }
    ws.onopen = () => { open = true; retry = 1; n = 0; };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (!m || typeof m.id !== 'string') return;
      if (m.t === 'l') hooks.leave(m.id);
      else if (m.t === 's' && m.s && typeof m.s === 'object') hooks.state(m.id, m.s, {});
    };
    ws.onclose = () => {
      open = false;
      if (!closed) setTimeout(connect, Math.min(30, retry *= 2) * 1000);
    };
  };
  connect();
  return {
    kind: 'relay', stale: true,
    send(s, look) {
      // the look rides along once a second (and right after connecting) so newcomers get it
      if (open) ws.send(JSON.stringify({ t: 's', s: n++ % SEND_HZ === 0 ? { ...s, lk: look } : s }));
    },
    close() { closed = true; if (ws) ws.close(); },
  };
}

function tabTransport(hooks) {
  if (typeof BroadcastChannel === 'undefined') return null;
  const ch = new BroadcastChannel('wanderer-players');
  const me = Math.random().toString(36).slice(2);
  let n = 0;
  ch.onmessage = (e) => {
    const m = e.data;
    if (!m || typeof m.id !== 'string' || m.id === me) return;
    if (m.t === 'l') hooks.leave(m.id);
    else if (m.s && typeof m.s === 'object') hooks.state(m.id, m.s, {});
  };
  addEventListener('pagehide', () => ch.postMessage({ t: 'l', id: me }));
  return {
    kind: 'tabs', stale: true,
    send(s, look) { ch.postMessage({ t: 's', id: me, s: n++ % SEND_HZ === 0 ? { ...s, lk: look } : s }); },
    close() { ch.postMessage({ t: 'l', id: me }); ch.close(); },
  };
}

// ------------------------------------------------------------------ other players
class RemotePlayer {
  constructor(id, net) {
    this.id = id;
    this.net = net;
    this.anim = null;
    this.lookKey = '';
    this.pos = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.facing = new THREE.Vector3(0, 0, 1);
    this.wantFacing = new THREE.Vector3(0, 0, 1);
    this.up = new THREE.Vector3(0, 1, 0);
    this.state = {};
    this.has = false;
    this.seen = 0;
    this.age = 0;
    this.name = '';
    this.profileName = '';
    this.lean = 0; this.lift = 0;
    this.tag = document.createElement('div');
    this.tag.className = 'ptag';
    net.layer.appendChild(this.tag);
    this.flame = new THREE.Sprite(net.flameMat);
    this.flame.scale.setScalar(0);
    net.game.scene.add(this.flame);
    this.light = null;
  }

  receive(s, info) {
    this.seen = 0;
    if (info.by && info.by !== this.by) {
      this.by = info.by;
      this.net.transport.name?.(info.by).then((n) => { this.profileName = n; this.updateTag(); });
    }
    if (s.lk) {
      const look = cleanLook(s.lk);
      const key = JSON.stringify(look);
      this.name = look.name;
      this.updateTag();
      if (key !== this.lookKey) { this.lookKey = key; this.build(look); }
    }
    const p = vec3(s.p);
    if (!p) return;
    _v.fromArray(p);
    const r = _v.length();
    if (r < R - 80 || r > R + 250) return;
    // estimate velocity from consecutive updates, so we can lead a little between them
    if (this.has && this.age > 0.02) this.vel.subVectors(_v, this.target).divideScalar(this.age).clampLength(0, 40);
    this.target.copy(_v);
    this.age = 0;
    const f = vec3(s.f);
    if (f) this.wantFacing.fromArray(f);
    this.state = {
      m: oneOf(s.m, MODES, 'walk'), a: oneOf(s.a, ANIMS, 'idle'), ts: num(s.ts, 0.2, 3, 1),
      l: num(s.l, -0.5, 2, 0), y: num(s.y, -1, 1.5, 0), t: num(s.t, 0, 1, 0),
    };
    if (!this.has || this.pos.distanceTo(this.target) > 25) { this.pos.copy(this.target); this.facing.copy(this.wantFacing); this.vel.set(0, 0, 0); }
    this.has = true;
  }

  async build(look) {
    const key = this.lookKey;
    const a = await makeCharacter(look);
    if (key !== this.lookKey || this.gone) return; // changed again (or left) while loading
    if (this.anim) this.net.game.scene.remove(this.anim.root);
    this.anim = a;
    this.net.game.scene.add(a.root);
  }

  updateTag() {
    this.tag.textContent = this.name || this.profileName || 'Wanderer';
  }

  get label() { return this.name || this.profileName || 'Someone'; }

  update(dt, cam, frustum) {
    this.seen += dt;
    this.age += dt;
    if (!this.has || !this.anim) { this.tag.style.display = 'none'; return; }
    // move toward where they are now (last update + a short lead), smoothed
    _v.copy(this.target).addScaledVector(this.vel, Math.min(this.age, 0.25));
    const r = this.target.length();
    _v.setLength(r);
    this.pos.lerp(_v, 1 - Math.exp(-dt * 10));
    this.up.copy(this.pos).normalize();
    tangent(this.wantFacing, this.up);
    this.facing.lerp(this.wantFacing, 1 - Math.exp(-dt * 10));
    tangent(this.facing, this.up);
    const st = this.state;
    const a = this.anim;
    a.root.position.copy(this.pos);
    orient(a.root, this.up, this.facing);
    this.lean += (st.l - this.lean) * Math.min(1, dt * 6);
    this.lift += (st.y - this.lift) * Math.min(1, dt * 6);
    a.pose.rotation.x = this.lean;
    a.pose.position.y = a.hip + this.lift;

    const d = cam.distanceTo(this.pos);
    _w.copy(this.pos).addScaledVector(this.up, 1);
    const vis = d < VIEW && frustum.intersectsSphere(this.net._sphere.set(_w, 1.5))
      && overHorizon(cam, _w.clone().normalize(), _w.length() + 1.5);
    a.root.visible = vis;
    if (vis) {
      a.play(st.a, 0.2, { timeScale: st.ts, once: st.a === 'attack-melee-right' });
      a.update(dt);
    }

    // torch: a flame held up in the right hand, and a real light when close by
    const torch = vis ? st.t : 0;
    if (torch > 0.05) {
      _side.crossVectors(this.up, this.facing).normalize();
      this.flame.position.copy(this.pos).addScaledVector(this.up, 1.55 * (a.look?.height || 1)).addScaledVector(_side, -0.38).addScaledVector(this.facing, 0.25);
      this.flame.scale.setScalar(0.45 * torch * (0.9 + 0.1 * Math.sin(this.net.game.time * 17 + this.id.length)));
    } else this.flame.scale.setScalar(0);
    const lights = this.net.game.lights;
    if (torch > 0.3 && d < 60 && !this.light) {
      this.light = { pos: this.flame.position, color: 0xffa04a, intensity: 5, range: 11, flicker: 0.25, night: false };
      lights.add(this.light);
      this.lightRef = lights.sources[lights.sources.length - 1];
    } else if ((torch <= 0.3 || d >= 60) && this.lightRef) this.dropLight();

    // name tag over their head
    if (!vis || d > 60) { this.tag.style.display = 'none'; return; }
    _w.copy(this.pos).addScaledVector(this.up, 2.15 * (a.look?.height || 1)).project(this.net.game.camera);
    if (_w.z > 1) { this.tag.style.display = 'none'; return; }
    this.tag.style.display = '';
    this.tag.style.opacity = String(1 - Math.max(0, (d - 40) / 20));
    this.tag.style.transform = `translate(${((_w.x + 1) / 2) * innerWidth}px, ${((1 - _w.y) / 2) * innerHeight}px) translate(-50%, -100%)`;
  }

  dropLight() {
    const src = this.net.game.lights.sources;
    const i = src.indexOf(this.lightRef);
    if (i >= 0) src.splice(i, 1);
    this.light = this.lightRef = null;
  }

  dispose() {
    this.gone = true;
    if (this.anim) this.net.game.scene.remove(this.anim.root);
    this.net.game.scene.remove(this.flame);
    if (this.lightRef) this.dropLight();
    this.tag.remove();
  }
}

export class Multiplayer {
  constructor(game) {
    this.game = game;
    this.players = new Map();
    this.transport = null;
    this.sendT = 0;
    this.lastSent = '';
    this.idleT = 0;
    this.frustum = new THREE.Frustum();
    this._m = new THREE.Matrix4();
    this._sphere = new THREE.Sphere();
    this.flameMat = new THREE.SpriteMaterial({ color: 0xffb55a, blending: THREE.AdditiveBlending, depthWrite: false, map: flameDot() });
    this.layer = document.createElement('div');
    this.layer.className = 'ptags';
    game.ui.root.appendChild(this.layer);
    this.countEl = document.createElement('div');
    this.countEl.className = 'players hidden';
    game.ui.hudEl.appendChild(this.countEl);
    this.connect();
  }

  async connect() {
    const hooks = {
      state: (id, s, info) => this.onState(id, s, info),
      leave: (id) => this.onLeave(id),
    };
    const relay = new URLSearchParams(location.search).get('relay') || import.meta.env.VITE_RELAY;
    try {
      this.transport = await roomTransport(hooks)
        || (relay && /^wss?:\/\//.test(relay) ? relayTransport(relay, hooks) : null)
        || tabTransport(hooks);
    } catch (e) {
      console.warn('multiplayer unavailable:', e);
    }
    if (this.transport) addEventListener('pagehide', () => this.transport.close());
    window.__net = this;
  }

  onState(id, s, info) {
    if (!s || typeof s !== 'object') return;
    let p = this.players.get(id);
    if (!p) {
      if (!vec3(s.p)) return; // presence not set yet (still on the title screen)
      if (this.players.size >= 64) return;
      p = new RemotePlayer(id, this);
      this.players.set(id, p);
      p.receive(s, info);
      if (this.game.ui.hudEl && !this.game.ui.hudEl.classList.contains('hidden')) {
        setTimeout(() => { if (this.players.get(id) === p) this.game.ui.toast(`${p.label} is exploring the planet too 👋`); }, 1500);
      }
      this.updateCount();
      return;
    }
    if (!vec3(s.p)) { this.onLeave(id); return; } // cleared presence: they left the game
    p.receive(s, info);
  }

  onLeave(id) {
    const p = this.players.get(id);
    if (!p) return;
    p.dispose();
    this.players.delete(id);
    this.updateCount();
  }

  updateCount() {
    const n = this.players.size;
    this.countEl.classList.toggle('hidden', n === 0);
    this.countEl.textContent = n === 1 ? '👥 1 other explorer here' : `👥 ${n} other explorers here`;
  }

  /** Our own state, compact and absolute. */
  myState() {
    const pl = this.game.player;
    const a = pl.anim;
    const torch = this.game.torch;
    return {
      p: pl.pos.toArray().map(r2), f: pl.facing.toArray().map(r2), m: pl.mode,
      a: oneOf(a.currentName, ANIMS, 'idle'), ts: r2(a.current ? a.current.timeScale : 1),
      l: r2(a.pose.rotation.x), y: r2(a.pose.position.y - a.hip), t: r2(torch ? torch.lit : 0),
    };
  }

  update(dt) {
    const game = this.game;
    if (this.transport) {
      this.sendT += dt;
      if (this.sendT >= 1 / SEND_HZ) {
        this.sendT = 0;
        const s = this.myState();
        const key = JSON.stringify(s);
        this.idleT += 1 / SEND_HZ;
        // standing still: only a heartbeat now and then (keeps relay/tab players from timing out)
        if (key !== this.lastSent || this.idleT > 2) {
          this.lastSent = key; this.idleT = 0;
          this.transport.send(s, game.player.anim.look || defaultLook());
        }
      }
    }
    if (!this.players.size) return;
    const cam = game.camera;
    this._m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this._m);
    const hideTags = game.ui.modal || document.body.classList.contains('photo');
    this.layer.style.display = hideTags ? 'none' : '';
    for (const [id, p] of this.players) {
      p.update(dt, cam.position, this.frustum);
      if (this.transport?.stale && p.seen > STALE) this.onLeave(id);
    }
  }
}

function flameDot() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(16, 16, 1, 16, 16, 15);
  gr.addColorStop(0, 'rgba(255,250,220,1)');
  gr.addColorStop(0.35, 'rgba(255,180,80,0.85)');
  gr.addColorStop(1, 'rgba(255,90,20,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
