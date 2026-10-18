import * as THREE from 'three';
import { R, sample, normalAt } from './planet.js';
import { waveHeight } from './water.js';
import { tangent } from './player.js';
import { resolve } from './collision.js';

const G = 20;
const _d = new THREE.Vector3(), _n = new THREE.Vector3(), _t = new THREE.Vector3(), _q = new THREE.Quaternion();
const _up = new THREE.Vector3(), _rel = new THREE.Vector3();

/**
 * Lightweight rigid-body physics for props on a spherical planet.
 * Bodies are spheres (good for balls, barrels, fruit, and fine for crates),
 * with gravity toward the planet centre, terrain + prop collisions, buoyancy,
 * body-body impulses and player interaction (kicks, pick-up and throw).
 */
export class Physics {
  constructor(game) {
    this.game = game;
    this.bodies = [];
    this.held = null;
  }

  /**
   * opts: { obj, pos, radius, mass, bounce, friction, density (<1 floats), roll (spin visually), holdable, name, onHit }
   */
  add(opts) {
    const b = {
      vel: new THREE.Vector3(), spin: new THREE.Vector3(), sleep: 0, asleep: false, mass: 1, bounce: 0.3, friction: 0.6,
      density: 0.6, roll: true, holdable: true, ...opts,
    };
    b.home = b.pos.clone();
    b.obj.position.copy(b.pos);
    this.bodies.push(b);
    if (b.holdable) {
      this.game.interactables.push({
        get pos() { return b.pos; }, radius: 2.0 + b.radius, label: 'Pick up', name: b.name,
        get enabled() { return !b.held && !this.blocked; },
        action: () => this.pickUp(b),
        body: b,
      });
    }
    return b;
  }

  wake(b) { b.asleep = false; b.sleep = 0; }

  pickUp(b) {
    if (this.held) this.drop();
    const p = this.game.player;
    if (p.inWater && b.mass > 3) return;
    this.held = b; b.held = true; this.wake(b);
    p.holding = b;
    this.game.audio.kick();
  }
  drop(throwIt = false) {
    const b = this.held;
    if (!b) return;
    const p = this.game.player;
    b.held = false; this.held = null; p.holding = null;
    if (throwIt) {
      b.vel.copy(p.facing).multiplyScalar(11 / Math.sqrt(b.mass)).addScaledVector(p.up, 6 / Math.sqrt(b.mass)).add(p.vel);
      b.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(10);
      p.anim.play('attack-melee-right', 0.05, { once: true, timeScale: 1.6 });
      p.petT = 0.35;
      this.game.audio.jump();
    } else {
      b.vel.copy(p.vel);
    }
  }

  update(dt, game) {
    const p = game.player;
    const t = game.time;
    dt = Math.min(dt, 1 / 30);
    // throw / drop input
    if (this.held && (game.input.hit('KeyF', 'KeyThrow') || (game.input.hit('KeyE') && !game.ui.current))) this.drop(true);
    else if (!this.held && game.input.hit('KeyF')) {
      let best = null, bd = 3.2;
      for (const b of this.bodies) { if (!b.holdable) continue; const d = b.pos.distanceTo(p.pos); if (d < bd) { bd = d; best = b; } }
      if (best) this.pickUp(best);
    }
    const near = [];
    for (const b of this.bodies) {
      const d2 = b.pos.distanceToSquared(p.pos);
      b.obj.visible = d2 < 140 * 140;
      if (d2 > 90 * 90) continue;
      near.push(b);
    }
    for (const b of near) {
      if (b.held) {
        // carried above the head
        const hold = _t.copy(p.pos).addScaledVector(p.up, 1.95 + b.radius * 0.9).addScaledVector(p.facing, 0.15);
        b.vel.copy(hold).sub(b.pos).multiplyScalar(18);
        b.pos.lerp(hold, Math.min(1, dt * 18));
        b.obj.position.copy(b.pos);
        continue;
      }
      // player contact: kick
      _rel.copy(b.pos).sub(p.pos);
      const upP = p.up;
      const along = _rel.dot(upP);
      if (along > -b.radius && along < 1.8 + b.radius) {
        _t.copy(_rel).addScaledVector(upP, -along);
        const dist = _t.length();
        const minD = b.radius + p.radius;
        if (dist < minD && dist > 1e-4) {
          this.wake(b);
          _t.normalize();
          b.pos.addScaledVector(_t, minD - dist);
          const push = Math.max(0, p.vel.dot(_t));
          const k = Math.min(2.2, 2 / Math.sqrt(b.mass));
          b.vel.addScaledVector(_t, push * k + 0.5);
          if (push > 4 && b.mass < 3) { b.vel.addScaledVector(upP, push * 0.35); game.audio.kick(); }
          if (b.mass >= 3) p.vel.multiplyScalar(0.85); // heavy things resist
        }
      }
      if (b.asleep) continue;
      this.integrate(b, dt, t, game);
    }
    // body vs body
    for (let i = 0; i < near.length; i++) {
      const a = near[i];
      for (let j = i + 1; j < near.length; j++) {
        const c = near[j];
        _d.copy(c.pos).sub(a.pos);
        const dist = _d.length(), minD = a.radius + c.radius;
        if (dist >= minD || dist < 1e-5) continue;
        _d.divideScalar(dist);
        const ia = 1 / a.mass, ic = 1 / c.mass;
        const corr = (minD - dist) / (ia + ic);
        if (!a.held) a.pos.addScaledVector(_d, -corr * ia);
        if (!c.held) c.pos.addScaledVector(_d, corr * ic);
        const rv = _rel.copy(c.vel).sub(a.vel).dot(_d);
        if (rv < 0) {
          const e = Math.min(a.bounce, c.bounce);
          const jimp = -(1 + e) * rv / (ia + ic);
          a.vel.addScaledVector(_d, -jimp * ia);
          c.vel.addScaledVector(_d, jimp * ic);
          this.wake(a); this.wake(c);
          if (-rv > 3) game.audio.kick();
        }
      }
    }
  }

  integrate(b, dt, t, game) {
    _up.copy(b.pos).normalize();
    // gravity
    b.vel.addScaledVector(_up, -G * dt);
    // water: buoyancy & drag
    const gh = sample(_up);
    const surf = R + waveHeight(b.pos, t) * (THREE.MathUtils.clamp(-gh / 2.5, 0, 1) * 0.85 + 0.15);
    const r = b.pos.length();
    const sub = THREE.MathUtils.clamp((surf - (r - b.radius)) / (2 * b.radius), 0, 1);
    if (sub > 0) {
      b.vel.addScaledVector(_up, G * sub / b.density * dt);
      b.vel.multiplyScalar(1 - Math.min(1, dt * 1.8 * sub));
      b.spin.multiplyScalar(1 - Math.min(1, dt * 2));
      if (!b.wet && b.vel.dot(_up) < -4) { game.world && game.world.fx.sparkle(b.pos.clone().setLength(surf), 8, 0xdff6ff); game.audio.splash(); }
      b.wet = true;
      // waves gently push floating things around
      b.vel.addScaledVector(_t.set(Math.sin(t * 0.3 + b.pos.x), 0, Math.cos(t * 0.27 + b.pos.z)), 0.3 * dt * sub);
    } else b.wet = false;
    b.pos.addScaledVector(b.vel, dt);

    // terrain
    const nd = _d.copy(b.pos).normalize();
    const groundR = R + sample(nd);
    const rr = b.pos.length();
    let grounded = false;
    if (rr - b.radius < groundR) {
      normalAt(nd, _n);
      const pen = groundR - (rr - b.radius);
      b.pos.addScaledVector(_n, pen * _n.dot(nd) > 0 ? pen : pen);
      const vn = b.vel.dot(_n);
      if (vn < 0) {
        b.vel.addScaledVector(_n, -vn * (1 + b.bounce));
        if (-vn > 4) { b.onHit && b.onHit(b, -vn); if (-vn > 6) game.audio.land(); }
      }
      // rolling friction
      const tv = _t.copy(b.vel).addScaledVector(_n, -b.vel.dot(_n));
      b.vel.addScaledVector(tv, -Math.min(1, dt * b.friction * (b.roll ? 1.2 : 4)));
      grounded = true;
    }
    // static props: same mesh-based colliders the player uses (houses, rocks, carts, piers...)
    {
      const up2 = _t.copy(b.pos).normalize();
      const feet = _rel.copy(b.pos).addScaledVector(up2, -b.radius);
      const res = resolve(game.colliders, feet, b.radius * 0.9, { height: b.radius * 2, step: b.radius * 0.6, prevR: b.prevFeetR });
      if (res.push.lengthSq() > 1e-10) {
        const nrm = _n.copy(res.push).normalize();
        const vn = b.vel.dot(nrm);
        if (vn < 0) { b.vel.addScaledVector(nrm, -vn * (1 + b.bounce)); if (-vn > 5) game.audio.kick(); }
      }
      const fr = feet.length();
      if (res.floor > fr - 0.02 && res.floor > -Infinity) {
        feet.setLength(res.floor);
        const vn = b.vel.dot(up2);
        if (vn < 0) b.vel.addScaledVector(up2, -vn * (1 + b.bounce));
        grounded = true;
      }
      b.pos.copy(feet).addScaledVector(_d.copy(feet).normalize(), b.radius);
      b.prevFeetR = b.pos.length() - b.radius;
    }
    // visual rotation
    const sp = b.vel.length();
    if (b.roll && grounded && sp > 0.05) {
      _t.crossVectors(_up, b.vel).normalize();
      _q.setFromAxisAngle(_t, (sp * dt) / b.radius);
      b.obj.quaternion.premultiply(_q);
    } else if (!grounded || !b.roll) {
      const s = b.spin.length();
      if (s > 0.01) { _q.setFromAxisAngle(_t.copy(b.spin).divideScalar(s), s * dt); b.obj.quaternion.premultiply(_q); }
      b.spin.multiplyScalar(1 - Math.min(1, dt * (grounded ? 6 : 0.3)));
      if (!b.roll && grounded) {
        // crates settle upright-ish on the ground
        const curUp = _t.set(0, 1, 0).applyQuaternion(b.obj.quaternion);
        _q.setFromUnitVectors(curUp, _up);
        b.obj.quaternion.premultiply(_q.slerp(new THREE.Quaternion(), 1 - Math.min(1, dt * 4)));
      }
    }
    b.obj.position.copy(b.pos);
    // sleep when resting
    if (grounded && sp < 0.15 && !b.wet) { b.sleep += dt; if (b.sleep > 1.5) { b.asleep = true; b.vel.set(0, 0, 0); } }
    else b.sleep = 0;
    // lost at sea or fell through: send it home
    if (gh < -8 && b.pos.distanceTo(game.player.pos) > 70 && b.density > 1) { b.pos.copy(b.home); b.vel.set(0, 0, 0); }
  }
}
