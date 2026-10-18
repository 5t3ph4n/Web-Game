import * as THREE from 'three';
import { R, sample, normalAt } from './planet.js';
import { resolve, STEP } from './collision.js';
import { toonMaterial, globalUniforms } from './toon.js';
import { waveHeight } from './water.js';
import { Cloth } from './character.js';

const _m = new THREE.Matrix4();
const _right = new THREE.Vector3();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _up = new THREE.Vector3();
const _n = new THREE.Vector3();

const AIR_STEP = 1.0; // how far below a ledge you can be mid-jump and still pull yourself up onto it
const SWIM_STEP = 1.2; // climb out of the water onto anything up to ~25cm above the surface (lily pads, boats)

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

/** Water surface radius at a world point (waves calm down in the shallows). */
export function waterSurfaceR(p, t, groundH) {
  const calm = THREE.MathUtils.clamp(-groundH / 2.5, 0, 1) * 0.85 + 0.15;
  return R + waveHeight(p, t) * calm;
}

export const WATER_DEPTH_SWIM = -1.25; // water this deep (or more) means swimming
const CHEST = 1.2; // feet-to-chest: how deep the feet hang when treading water
const BREATH_TIME = 14; // seconds of air

export class Player {
  constructor(anim, colliders, audio) {
    this.colliders = colliders;
    this.audio = audio;
    this.up = new THREE.Vector3(0, 1, 0);
    this.facing = new THREE.Vector3(0, 0, 1);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3(); // tangential velocity
    this.vUp = 0;
    this.onGround = true;
    this.mode = 'walk'; // walk | swim | dive | glide | sit | ride
    this.hasGlider = false;
    this.speed = 0;
    this.stepT = 0;
    this.coyote = 0;
    this.jumpBuf = 0;
    this.lastFloorC = null;
    this.airTime = 0;
    this.bounce = 0;
    this.radius = 0.45;
    this.frozen = false;
    this.touching = null;
    this.breath = 1;
    this.swimT = 0;
    this.swimLean = 0;
    this.landSquash = 0;
    this.depth = 0;
    this.events = []; // gameplay events for fx/ui: splash, bubble, hardLand, outOfBreath...

    // little parasol glider
    const g = new THREE.Group();
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(1.3, 0.55, 12, 1, true), toonMaterial({ color: 0xf3a6a0, side: THREE.DoubleSide }));
    canopy.position.y = 2.95;
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4), toonMaterial({ color: 0x6b4a3a }));
    stick.position.y = 2.2;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.08), toonMaterial({ color: 0xffe08a }));
    knob.position.y = 3.25;
    g.add(canopy, stick, knob);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.visible = false;
    this.parasol = g;
    this.setAnim(anim);
  }

  /** Swap the character model (character creator). */
  setAnim(anim, scene) {
    if (this.anim && scene) scene.remove(this.anim.root);
    this.anim = anim;
    this.obj = anim.root;
    this.obj.add(this.parasol);
    if (scene) scene.add(this.obj);
    if (this.cloth) { this.cloth.dispose(); this.cloth = null; }
    const look = anim.look;
    if (look && (look.back === 'cape' || look.back === 'scarf') && scene) {
      this.cloth = new Cloth(scene, look.accent, look.back === 'cape'
        ? { w: 6, h: 9, width: 0.62 * look.build, length: 1.0 * look.height }
        : { w: 3, h: 7, width: 0.16, length: 0.7 });
      this.clothKind = look.back;
    }
    if (this.pos) this.sync();
  }

  place(dir, facing) {
    this.up.copy(dir).normalize();
    const h = Math.max(sample(this.up), 0);
    this.pos.copy(this.up).multiplyScalar(R + h + 0.1);
    if (facing) this.facing.copy(facing);
    tangent(this.facing, this.up);
    this.vel.set(0, 0, 0); this.vUp = 0;
    this.mode = 'walk';
    if (this.cloth) this.cloth.ready = false;
    this.sync();
  }

  get feetR() { return this.pos.length(); }
  get inWater() { return this.mode === 'swim' || this.mode === 'dive'; }

  update(dt, input, cam) {
    if (this.mode === 'sit' || this.mode === 'ride' || this.frozen) {
      this.anim.update(dt);
      this.updateCloth(dt);
      return;
    }
    const t = globalUniforms.uTime.value;
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
    const water = this.inWater;
    const diving = this.mode === 'dive';
    let maxSpeed = running ? 10.5 : 5.2;
    if (this.mode === 'swim') maxSpeed = running ? 5.2 : 3.2;
    if (diving) maxSpeed = running ? 5.8 : 3.8;
    if (this.mode === 'glide') maxSpeed = 11;

    const sp0 = this.vel.length();
    if (sp0 > 1e-5) tangent(this.vel, up).multiplyScalar(sp0); else this.vel.set(0, 0, 0);

    // momentum: snappy on the ground, floaty in water, a little air control
    const accel = water ? 9 : this.onGround ? 40 : 14;
    if (mag > 0.05) {
      want.normalize().multiplyScalar(maxSpeed * mag);
      this.vel.lerp(want, Math.min(1, (accel * dt) / Math.max(maxSpeed, 1)));
      const tgt = _v.copy(want).normalize();
      this.facing.lerp(tgt, Math.min(1, dt * (water ? 4 : 12)));
      tangent(this.facing, up);
    } else {
      this.vel.multiplyScalar(Math.max(0, 1 - dt * (water ? 1.6 : this.onGround ? 14 : 1)));
    }

    // very steep ground makes you slide downhill
    this.sliding = false;
    if (this.onGround && !water && !this.floorC) {
      normalAt(up, _n);
      const steep = _n.dot(up);
      if (steep < 0.62) {
        const down = _v.copy(_n).addScaledVector(up, -_n.dot(up));
        this.vel.addScaledVector(down, (0.62 - steep) * 60 * dt);
        this.sliding = true;
      }
    }
    this.speed = this.vel.length();

    // jumping / gliding (a press just before landing still counts)
    if (this.onGround) this.coyote = 0.12; else this.coyote -= dt;
    this.jumpBuf = input.hit('Space') ? 0.15 : this.jumpBuf - dt;
    if (this.jumpBuf > 0 && this.coyote > 0 && !water) {
      this.vUp = 8.6;
      this.onGround = false;
      this.coyote = 0;
      this.jumpBuf = 0;
      this.anim.play('jump', 0.08, { once: true, timeScale: 1.4 });
      this.audio && this.audio.jump();
    }
    const gliding = !water && !this.onGround && this.hasGlider && input.down('Space') && this.vUp < 0 && this.airTime > 0.25;
    if (gliding) this.mode = 'glide'; else if (this.mode === 'glide') this.mode = 'walk';
    this.parasol.visible = gliding;

    // integrate tangential motion (move along the sphere) in short substeps, so running can't tunnel into
    // props, and slide along walls and cliffs instead of stopping dead
    this.touching = null;
    const onHit = (c) => {
      this.touching = c;
      if (c.onTouch) c.onTouch(this, c);
    };
    const opts = { step: water ? SWIM_STEP : STEP, vUp: this.vUp };
    const n = Math.min(4, Math.ceil((this.vel.length() * dt) / 0.22));
    for (let i = 0; i < n; i++) {
      if (!this.moveStep(dt / n, water)) break;
      const res = resolve(this.colliders, this.pos, this.radius, opts, onHit);
      this.slide(res.push);
    }

    const gh0 = sample(_up.copy(this.pos).normalize());
    const surfR = waterSurfaceR(this.pos, t, gh0);
    const deepHere = gh0 < WATER_DEPTH_SWIM;
    const wasGround = this.onGround;
    const wasWater = water;
    const prevR = this.pos.length();

    // ------------------------------------------------------------ water
    if (deepHere && (water || prevR < surfR - CHEST + 0.25)) {
      if (!wasWater) {
        this.events.push({ type: 'splash', big: this.vUp < -10 });
        this.mode = 'swim';
        this.vUp *= 0.35;
      }
      const wantDive = input.down('KeyC', 'ControlLeft', 'ControlRight', 'KeyDive');
      const wantUp = input.down('Space');
      const restR = surfR - CHEST; // treading-water feet height
      let r = prevR;
      if (this.mode === 'swim' && wantDive && this.breath > 0.1) {
        this.mode = 'dive';
        this.vUp = -3;
        this.audio && this.audio.splash();
      }
      if (this.mode === 'dive') {
        // underwater: free vertical control, gentle buoyancy, drag
        let vt = 0;
        if (wantDive) vt -= 3.4;
        if (wantUp || this.breath <= 0) vt += 3.6;
        if (!wantDive && !wantUp) vt += 0.6; // you slowly float up
        this.vUp += (vt - this.vUp) * Math.min(1, dt * 3);
        r += this.vUp * dt;
        const floorLimit = R + gh0 + 0.3;
        if (r < floorLimit) { r = floorLimit; if (this.vUp < 0) this.vUp = 0; }
        if (r >= restR) { r = restR; this.mode = 'swim'; this.vUp = 0; this.events.push({ type: 'surface' }); }
        this.breath = Math.max(0, this.breath - dt / BREATH_TIME);
        if (this.breath === 0 && !this.outOfBreath) { this.outOfBreath = true; this.events.push({ type: 'outOfBreath' }); }
        if (Math.random() < dt * 3) this.events.push({ type: 'bubble' });
      } else {
        // surface swimming: spring to the wave surface (bobbing with it)
        this.vUp += (restR - r) * 26 * dt;
        this.vUp *= 1 - Math.min(1, dt * 5);
        r += this.vUp * dt;
        this.breath = Math.min(1, this.breath + dt / 3);
        if (this.breath > 0.3) this.outOfBreath = false;
        // jump out when there's shallow ground (or a pad / pier) ahead
        if (this.jumpBuf > 0) {
          const ahead = _v.copy(this.pos).addScaledVector(this.facing, 1.6).normalize();
          if (sample(ahead) > -1.0 || this.touching) {
            this.vUp = 7.5; r += 0.3; this.mode = 'walk'; this.jumpBuf = 0;
            this.anim.play('jump', 0.1, { once: true });
          } else { this.vUp = 2.5; this.jumpBuf = 0; this.events.push({ type: 'splash', big: false }); }
        }
      }
      this.pos.setLength(r);
      // still collide with piers, rocks and boats while swimming (and climb onto low ones)
      opts.vUp = this.vUp; opts.prevR = prevR;
      const res = resolve(this.colliders, this.pos, this.radius, opts, onHit);
      this.slide(res.push);
      if (res.ceil < this.pos.length()) { this.pos.setLength(res.ceil); if (this.vUp > 0) this.vUp = 0; }
      if (this.mode === 'swim' && res.floor > this.pos.length() && res.floor - this.pos.length() < SWIM_STEP) {
        // climbed onto something (lily pad, low rock)
        this.pos.setLength(res.floor);
        this.mode = 'walk'; this.vUp = 0; this.onGround = true; this.floorC = res.floorC;
      } else {
        this.onGround = false;
        this.coyote = 0;
      }
    } else {
      if (wasWater) { this.mode = this.mode === 'dive' || this.mode === 'swim' ? 'walk' : this.mode; this.breath = 1; }
      // gravity
      const g = gliding ? 7 : 24;
      this.vUp = Math.max(this.vUp - g * dt, -40);
      if (gliding && this.vUp < -2.2) this.vUp = -2.2;
      this.pos.setLength(prevR + this.vUp * dt);

      // collisions with props: get pushed out, stand on tops, bump your head on undersides
      opts.vUp = this.vUp; opts.prevR = prevR;
      const res = resolve(this.colliders, this.pos, this.radius, opts, onHit);
      this.slide(res.push);
      if (res.ceil < this.pos.length()) {
        this.pos.setLength(res.ceil);
        if (this.vUp > 0) this.vUp = 0;
      }
      const floorR = res.floor;
      this.floorC = res.floorC;
      const gh = sample(_up.copy(this.pos).normalize());
      let groundR = R + gh;
      if (floorR > groundR) groundR = floorR;
      const r = this.pos.length();
      if (r <= groundR + 0.02) {
        this.pos.setLength(groundR);
        if (!wasGround) {
          const impact = -this.vUp;
          if (impact > 3) this.audio && this.audio.land();
          if (this.bounce > 0) { this.vUp = this.bounce; this.bounce = 0; }
          if (impact > 15) { this.landSquash = Math.min(1, (impact - 15) / 12 + 0.4); this.events.push({ type: 'hardLand', impact }); this.vel.multiplyScalar(0.4); }
          else if (impact > 7) this.landSquash = 0.25;
        }
        if (this.vUp <= 0) {
          this.vUp = 0; this.onGround = true;
          // landing on (or walking onto) something that reacts: bouncy caps, singing stones…
          const c = this.floorC;
          if (c && c.onLand && (!wasGround || c !== this.lastFloorC)) {
            const now = performance.now();
            if (now - (c.landT || 0) > 350) { c.landT = now; c.onLand(this, c); }
          }
        }
      } else if (r > groundR + 0.25) {
        this.onGround = false;
      } else if (this.onGround && this.vUp <= 0) {
        this.pos.setLength(groundR); // stick to slopes going downhill
      }
    }
    this.lastFloorC = this.onGround ? this.floorC : null;
    this.airTime = this.onGround || this.inWater ? 0 : this.airTime + dt;
    this.depth = Math.max(0, waterSurfaceR(this.pos, t, sample(_up.copy(this.pos).normalize())) - (this.pos.length() + 1.5));

    this.sync();
    this.animate(dt, running);
    this.updateCloth(dt);
  }

  /** Move along the surface by vel*dt. Too-steep terrain makes the velocity slide along the slope instead. */
  moveStep(dt, swimming) {
    const up = _up.copy(this.pos).normalize();
    const feetH = this.feetR - R;
    const curH = sample(up);
    for (let attempt = 0; attempt < 2; attempt++) {
      const step = _v.copy(this.vel).multiplyScalar(dt);
      const len = step.length();
      if (len < 1e-6) return false;
      const nd = _v2.copy(this.pos).add(step).normalize();
      const nh = sample(nd);
      const rise = nh - Math.max(curH, feetH);
      const tooSteep = this.onGround
        ? rise > 0.18 && rise / len > 2.0
        : nh > feetH + (swimming ? SWIM_STEP : AIR_STEP); // in the air you can only mantle a small ledge
      if (!tooSteep) {
        const r = this.pos.length();
        this.pos.copy(nd).multiplyScalar(r);
        return true;
      }
      // the slope's downhill direction acts like a wall normal
      normalAt(nd, _n);
      _n.addScaledVector(nd, -_n.dot(nd));
      const vn = this.vel.dot(_n);
      if (_n.lengthSq() < 1e-8 || vn >= 0) { this.vel.multiplyScalar(0.2); return false; }
      _n.normalize();
      this.vel.addScaledVector(_n, -this.vel.dot(_n));
    }
    return false;
  }

  /** After being pushed out of a prop, drop the part of the velocity that keeps running into it. */
  slide(push) {
    const l = push.length();
    if (l < 1e-6) return;
    _n.copy(push).divideScalar(l);
    const vn = this.vel.dot(_n);
    if (vn < 0) this.vel.addScaledVector(_n, -vn);
  }

  animate(dt, running) {
    const a = this.anim;
    const b = a.bones;
    this.landSquash = Math.max(0, this.landSquash - dt * 2.5);
    if (this.petT > 0) { this.petT -= dt; a.update(dt); return; }
    const water = this.inWater;
    // body lean: horizontal while swimming forward or diving
    const moving = this.speed > 0.6;
    const targetLean = this.mode === 'dive' ? (moving ? 1.35 : 0.9) + THREE.MathUtils.clamp(-this.vUp * 0.15, -0.5, 0.5)
      : this.mode === 'swim' ? (moving ? 1.2 : 0.15) : 0;
    this.swimLean += (targetLean - this.swimLean) * Math.min(1, dt * 4);
    a.pose.rotation.x = this.swimLean;
    // when horizontal at the surface, lift the hips so the back is at the waterline
    a.pose.position.y = a.hip + (this.mode === 'swim' ? 0.25 + Math.sin(Math.min(this.swimLean, 1.3)) * 0.55 : 0);
    const sq = this.landSquash;
    a.pose.scale.set(1 + sq * 0.12, 1 - sq * 0.22, 1 + sq * 0.12);

    if (water) a.play('idle', 0.3);
    else if (this.mode === 'glide') a.play('holding-both', 0.2);
    else if (!this.onGround && this.airTime > 0.12) {
      if (this.vUp < -1 && a.currentName !== 'fall') a.play('fall', 0.25);
    } else if (this.speed > 7) { a.play('sprint', 0.15); a.setSpeed(this.speed / 9); }
    else if (this.speed > 0.4) { a.play('walk', 0.15); a.setSpeed(Math.max(0.6, this.speed / 4.2)); }
    else if (this.holding) a.play('holding-both', 0.2);
    else a.play('idle', 0.25);
    a.update(dt);

    // procedural swim strokes on top of the idle animation
    if (water && b['arm-left'] && b['arm-right']) {
      const rate = moving ? 1.6 + this.speed * 0.35 : 0.9;
      this.swimT += dt * rate * Math.PI;
      const st = this.swimT;
      if (moving) {
        // front crawl: arms windmill, legs flutter
        b['arm-left'].rotation.x = -st;
        b['arm-right'].rotation.x = -st - Math.PI;
        b['arm-left'].rotation.z = 0.15; b['arm-right'].rotation.z = -0.15;
        if (b['leg-left']) b['leg-left'].rotation.x = Math.sin(st * 2.2) * 0.45;
        if (b['leg-right']) b['leg-right'].rotation.x = -Math.sin(st * 2.2) * 0.45;
        if (b.head && this.mode === 'swim') b.head.rotation.x = -0.9 + Math.max(0, Math.sin(st)) * 0.3;
      } else {
        // treading water: sculling arms, slow kicks
        b['arm-left'].rotation.z = 1.1 + Math.sin(st) * 0.35;
        b['arm-right'].rotation.z = -1.1 - Math.sin(st) * 0.35;
        b['arm-left'].rotation.x = Math.cos(st) * 0.3;
        b['arm-right'].rotation.x = Math.cos(st) * 0.3;
        if (b['leg-left']) b['leg-left'].rotation.x = Math.sin(st * 1.3) * 0.35;
        if (b['leg-right']) b['leg-right'].rotation.x = -Math.sin(st * 1.3) * 0.35;
      }
    }
    // fairy wings flap
    if (a.wings) {
      const f = Math.sin(performance.now() / 1000 * (this.onGround ? 3 : 14)) * (this.onGround ? 0.15 : 0.5);
      a.wings.children.forEach((w) => { w.rotation.y = w.userData.side * (0.5 + f); });
    }

    // footsteps & strokes
    if (this.onGround && this.speed > 0.6) {
      this.stepT -= dt * this.speed * (running ? 0.52 : 0.62);
      if (this.stepT <= 0) { this.stepT = 1; this.audio && this.audio.step(this.pos); this.events.push({ type: 'step' }); }
    }
    if (this.mode === 'swim' && moving) {
      this.stepT -= dt * 1.4;
      if (this.stepT <= 0) { this.stepT = 1; this.audio && this.audio.swim(); this.events.push({ type: 'stroke' }); }
    }
  }

  updateCloth(dt) {
    if (!this.cloth) return;
    const a = this.anim;
    const torso = a.bones.torso;
    if (!torso) return;
    a.root.updateMatrixWorld(true);
    const up = this.up;
    const right = _right.crossVectors(up, this.facing).normalize();
    const back = this.facing.clone().negate();
    // anchor points just behind the shoulders, following the posed torso
    const tw = new THREE.Vector3().setFromMatrixPosition(torso.matrixWorld);
    const torsoUp = new THREE.Vector3(0, 1, 0).transformDirection(torso.matrixWorld);
    const torsoBack = new THREE.Vector3(0, 0, -1).transformDirection(torso.matrixWorld);
    const L = a.look || { height: 1, build: 1 };
    const sh = 0.62 * L.height;
    const width = this.clothKind === 'cape' ? 0.3 * L.build : 0.05;
    const base = tw.clone().addScaledVector(torsoUp, sh).addScaledVector(torsoBack, this.clothKind === 'cape' ? 0.2 : 0.18);
    const anchors = {
      a: base.clone().addScaledVector(right, width),
      b: base.clone().addScaledVector(right, -width),
    };
    const body = [
      { c: tw.clone().addScaledVector(torsoUp, 0.35 * L.height), r: 0.34 * L.build },
      { c: tw.clone().addScaledVector(torsoUp, 0.05), r: 0.32 * L.build },
      { c: tw.clone().addScaledVector(torsoUp, -0.35), r: 0.28 },
    ];
    const wind = this.vel.clone().multiplyScalar(-1.2).addScaledVector(back, 2).addScaledVector(right, Math.sin(performance.now() / 700) * 1.5);
    if (this.inWater) wind.multiplyScalar(0.2).addScaledVector(up, 10); // floats in water
    this.cloth.step(dt, anchors, body, up, back, wind);
  }

  sync() {
    this.up.copy(this.pos).normalize();
    tangent(this.facing, this.up);
    this.obj.position.copy(this.pos);
    orient(this.obj, this.up, this.facing);
  }
}
