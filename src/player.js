import * as THREE from 'three';
import { R, sample } from './planet.js';
import { resolve } from './collision.js';
import { toonMaterial } from './toon.js';

const _m = new THREE.Matrix4();
const _right = new THREE.Vector3();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

/** Orient an object so +Y = up and +Z = forward. */
export function orient(obj, up, forward) {
  _right.crossVectors(up, forward).normalize();
  _v.crossVectors(_right, up).normalize();
  _m.makeBasis(_right, up, _v);
  obj.quaternion.setFromRotationMatrix(_m);
}

/** Remove the component of v along up and renormalise. */
export function tangent(v, up) {
  v.addScaledVector(up, -v.dot(up));
  const l = v.length();
  if (l < 1e-6) {
    v.set(1, 0, 0).addScaledVector(up, -up.x);
    if (v.lengthSq() < 1e-6) v.set(0, 0, 1).addScaledVector(up, -up.z);
  }
  return v.normalize();
}

export const WATER_DEPTH_SWIM = -0.95;

export class Player {
  constructor(anim, colliders, audio) {
    this.anim = anim;
    this.obj = anim.root;
    this.colliders = colliders;
    this.audio = audio;
    this.up = new THREE.Vector3(0, 1, 0);
    this.facing = new THREE.Vector3(0, 0, 1);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3(); // tangential velocity
    this.vUp = 0;
    this.onGround = true;
    this.mode = 'walk'; // walk | swim | glide | sit | ride
    this.hasGlider = false;
    this.speed = 0;
    this.stepT = 0;
    this.coyote = 0;
    this.lastGroundH = 0;
    this.airTime = 0;
    this.bounce = 0;
    this.radius = 0.45;
    this.frozen = false;
    this.touching = null;

    // little parasol glider
    const g = new THREE.Group();
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(1.3, 0.55, 10, 1, true), toonMaterial({ color: 0xf3a6a0, side: THREE.DoubleSide }));
    canopy.position.y = 2.95;
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4), toonMaterial({ color: 0x6b4a3a }));
    stick.position.y = 2.2;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.08), toonMaterial({ color: 0xffe08a }));
    knob.position.y = 3.25;
    g.add(canopy, stick, knob);
    g.visible = false;
    this.parasol = g;
    this.obj.add(g);
  }

  place(dir, facing) {
    this.up.copy(dir).normalize();
    const h = Math.max(sample(this.up), 0);
    this.pos.copy(this.up).multiplyScalar(R + h + 0.1);
    if (facing) this.facing.copy(facing);
    tangent(this.facing, this.up);
    this.vel.set(0, 0, 0); this.vUp = 0;
    this.sync();
  }

  get feetR() { return this.pos.length(); }

  update(dt, input, cam) {
    if (this.mode === 'sit' || this.mode === 'ride' || this.frozen) {
      this.anim.update(dt);
      return;
    }
    const up = this.up.copy(this.pos).normalize();
    tangent(this.facing, up);

    // desired movement relative to camera
    const ax = input.axes();
    const camF = _v2.copy(cam.forward);
    tangent(camF, up);
    const camR = _right.crossVectors(camF, up).normalize();
    const want = new THREE.Vector3().addScaledVector(camF, ax.y).addScaledVector(camR, ax.x);
    const mag = Math.min(1, want.length());
    const running = input.down('ShiftLeft', 'ShiftRight') || input.touchRun;
    const swimming = this.mode === 'swim';
    let maxSpeed = running ? 10.5 : 5.2;
    if (swimming) maxSpeed = running ? 5.5 : 3.4;
    if (this.mode === 'glide') maxSpeed = 11;

    const sp0 = this.vel.length();
    if (sp0 > 1e-5) tangent(this.vel, up).multiplyScalar(sp0); else this.vel.set(0, 0, 0);

    const accel = this.onGround || swimming ? 40 : 14;
    if (mag > 0.05) {
      want.normalize().multiplyScalar(maxSpeed * mag);
      this.vel.lerp(want, Math.min(1, (accel * dt) / Math.max(maxSpeed, 1)));
      // turn to face movement
      const tgt = _v.copy(want).normalize();
      this.facing.lerp(tgt, Math.min(1, dt * 12));
      tangent(this.facing, up);
    } else {
      this.vel.multiplyScalar(Math.max(0, 1 - dt * (this.onGround ? 14 : 2)));
    }
    this.speed = this.vel.length();

    // jumping / gliding
    if (this.onGround) this.coyote = 0.12; else this.coyote -= dt;
    if (input.hit('Space') && (this.coyote > 0 || swimming)) {
      this.vUp = swimming ? 6.5 : 8.6;
      this.onGround = false;
      this.coyote = 0;
      this.mode = 'walk';
      this.anim.play('jump', 0.08, { once: true, timeScale: 1.4 });
      this.audio && this.audio.jump();
    }
    const gliding = !this.onGround && this.hasGlider && input.down('Space') && this.vUp < 0 && this.airTime > 0.25;
    this.mode = gliding ? 'glide' : this.mode === 'glide' ? 'walk' : this.mode;
    this.parasol.visible = gliding;

    // integrate tangential motion (move along the sphere)
    const curH = sample(up);
    const step = _v.copy(this.vel).multiplyScalar(dt);
    if (step.lengthSq() > 0) {
      const newPos = _v2.copy(this.pos).add(step);
      const nd = newPos.clone().normalize();
      const nh = sample(nd);
      const rise = nh - Math.max(curH, this.feetR - R);
      const slope = rise / Math.max(step.length(), 1e-4);
      if (this.onGround && rise > 0.18 && slope > 2.0) {
        // too steep: slide along by cancelling the climbing part
        this.vel.multiplyScalar(0.2);
      } else {
        const r = this.pos.length();
        this.pos.copy(nd).multiplyScalar(r);
      }
    }

    // vertical
    const g = gliding ? 7 : 24;
    this.vUp -= g * dt;
    if (gliding && this.vUp < -2.2) this.vUp = -2.2;
    let r = this.pos.length() + this.vUp * dt;
    this.pos.setLength(r);

    // collisions with props (can stand on finite-height props)
    this.touching = null;
    const res = resolve(this.colliders, this.pos, this.radius, this.pos.length(), (c) => {
      this.touching = c;
      if (c.onTouch) c.onTouch(this, c);
    });
    const floorR = res.floor;
    this.floorC = res.floorC;
    const ud = this.pos.clone().normalize();
    const gh = sample(ud);
    let groundR = R + gh;
    if (floorR > groundR) groundR = floorR;

    // water
    const seaFloat = R + WATER_DEPTH_SWIM;
    const deep = gh < WATER_DEPTH_SWIM && floorR < seaFloat;
    r = this.pos.length();
    const wasGround = this.onGround;
    if (deep && r <= seaFloat + 0.05) {
      if (this.mode !== 'swim' && this.vUp < -6) this.audio && this.audio.splash();
      this.mode = 'swim';
      // buoyancy
      this.vUp += (seaFloat - r) * 30 * dt;
      this.vUp *= 1 - Math.min(1, dt * 4);
      if (r < seaFloat - 0.4) this.pos.setLength(seaFloat - 0.4);
      this.onGround = false;
      this.coyote = 0;
    } else {
      if (this.mode === 'swim') this.mode = 'walk';
      if (r <= groundR + 0.02) {
        this.pos.setLength(groundR);
        if (!wasGround && this.vUp < -3) {
          this.audio && this.audio.land();
          if (this.bounce > 0) { this.vUp = this.bounce; this.bounce = 0; }
        }
        if (this.vUp <= 0) {
          this.vUp = 0; this.onGround = true;
          if (this.floorC && this.floorC.onLand && !wasGround) this.floorC.onLand(this, this.floorC);
        }
      } else if (r > groundR + 0.25) {
        this.onGround = false;
      } else if (this.onGround && this.vUp <= 0) {
        // stick to slopes going downhill
        this.pos.setLength(groundR);
      }
    }
    this.airTime = this.onGround ? 0 : this.airTime + dt;

    this.sync();
    this.animate(dt, running);
  }

  animate(dt, running) {
    const a = this.anim;
    if (this.petT > 0) { this.petT -= dt; a.update(dt); return; }
    if (this.mode === 'swim') {
      a.play(this.speed > 0.5 ? 'sprint' : 'idle', 0.25);
      a.setSpeed(this.speed > 0.5 ? 0.55 : 0.6);
      this.anim.model.position.y = -0.95;
    } else {
      this.anim.model.position.y += (0 - this.anim.model.position.y) * Math.min(1, dt * 10);
      if (this.mode === 'glide') a.play('holding-both', 0.2);
      else if (!this.onGround && this.airTime > 0.12) {
        if (this.vUp < -1 && a.currentName !== 'fall') a.play('fall', 0.25);
      } else if (this.speed > 7) { a.play('sprint', 0.15); a.setSpeed(this.speed / 9); }
      else if (this.speed > 0.4) { a.play('walk', 0.15); a.setSpeed(Math.max(0.6, this.speed / 4.2)); }
      else a.play('idle', 0.25);
    }
    // footsteps
    if (this.onGround && this.speed > 0.6) {
      this.stepT -= dt * this.speed * (running ? 0.52 : 0.62);
      if (this.stepT <= 0) { this.stepT = 1; this.audio && this.audio.step(this.pos); }
    }
    if (this.mode === 'swim' && this.speed > 0.6) {
      this.stepT -= dt * 1.5;
      if (this.stepT <= 0) { this.stepT = 1; this.audio && this.audio.swim(); }
    }
    a.update(dt);
  }

  sync() {
    this.up.copy(this.pos).normalize();
    tangent(this.facing, this.up);
    this.obj.position.copy(this.pos);
    orient(this.obj, this.up, this.facing);
  }
}
