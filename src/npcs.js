import * as THREE from 'three';
import { R, sample, regionById, tangentBasis } from './planet.js';
import { makeCharacter, makeAnimal } from './character.js';
import { orient, tangent } from './player.js';
import { resolve } from './collision.js';
import { NPCS, CRITTERS, CRITTER_NAMES } from './content.js';
import { mulberry32 } from './noise.js';

const _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3(), _v = new THREE.Vector3();

export function offsetDir(center, east, north, out = new THREE.Vector3()) {
  tangentBasis(center, _t1, _t2);
  return out.copy(center).addScaledVector(_t1, east / R).addScaledVector(_t2, north / R).normalize();
}

/** Something that walks around on the planet surface near a home point. */
class Walker {
  constructor(anim, home, { wander = 0, speed = 1.6, runSpeed = 6, minH = 0.4, maxH = 40, swims = false, lift = 0 } = {}) {
    this.anim = anim;
    this.obj = anim.root;
    this.home = home.clone();
    this.pos = home.clone().multiplyScalar(R + Math.max(sample(home), 0) + lift);
    this.up = home.clone();
    this.facing = new THREE.Vector3();
    tangentBasis(home, this.facing, _t2);
    this.wander = wander;
    this.speed = speed;
    this.runSpeed = runSpeed;
    this.minH = minH; this.maxH = maxH;
    this.lift = lift;
    this.target = null;
    this.wait = Math.random() * 3;
    this.moving = false;
    this.running = false;
    this.lock = 0; // seconds of "busy" animation
    this.sync();
  }
  pickTarget(rand) {
    for (let i = 0; i < 8; i++) {
      const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * this.wander;
      const d = offsetDir(this.home, Math.cos(a) * r, Math.sin(a) * r);
      const h = sample(d);
      if (h >= this.minH && h <= this.maxH) return d;
    }
    return null;
  }
  stepToward(dir, dt, speed, colliders) {
    this.up.copy(this.pos).normalize();
    const to = _v.copy(dir).multiplyScalar(this.pos.length()).sub(this.pos);
    tangent(to, this.up);
    this.facing.lerp(to, Math.min(1, dt * 6));
    tangent(this.facing, this.up);
    const np = this.pos.clone().addScaledVector(this.facing, speed * dt);
    const nd = np.clone().normalize();
    const nh = sample(nd);
    if (nh < this.minH || nh > this.maxH) return false;
    this.pos.copy(nd).multiplyScalar(R + nh + this.lift);
    if (colliders) {
      const res = resolve(colliders, this.pos, 0.4, this.pos.length());
      const gd = this.pos.clone().normalize();
      const gr = Math.max(R + sample(gd) + this.lift, res.floor);
      this.pos.copy(gd).multiplyScalar(gr);
    }
    return true;
  }
  faceToward(p, dt) {
    this.up.copy(this.pos).normalize();
    const to = _v.copy(p).sub(this.pos);
    tangent(to, this.up);
    this.facing.lerp(to, Math.min(1, dt * 5));
    tangent(this.facing, this.up);
  }
  sync() {
    this.up.copy(this.pos).normalize();
    tangent(this.facing, this.up);
    this.obj.position.copy(this.pos);
    orient(this.obj, this.up, this.facing);
  }
}

export class NPC extends Walker {
  constructor(def, anim, home, opts) {
    super(anim, home, { wander: def.wander || 0, speed: 1.5, ...opts });
    this.def = def;
    this.talks = 0;
    this.danceT = 0;
  }
  update(dt, game, rand) {
    const p = game.player;
    const dist = this.pos.distanceTo(p.pos);
    this.near = dist;
    if (this.talking) {
      this.faceToward(p.pos, dt);
      if (this.def.behavior !== 'sit') this.anim.play(this.lock > 0 ? 'emote-yes' : 'idle', 0.3);
      this.lock -= dt;
    } else if (this.def.behavior === 'sit') {
      this.anim.play('sit', 0.3);
    } else if (this.def.behavior === 'dance') {
      this.danceT -= dt;
      if (this.danceT <= 0) {
        this.danceT = 1.2 + Math.random() * 1.5;
        this.anim.play(Math.random() < 0.6 ? 'emote-yes' : 'interact-right', 0.2);
      }
      if (dist < 6) this.faceToward(p.pos, dt);
    } else if (this.def.behavior === 'wander') {
      if (dist < 3.2) {
        this.anim.play('idle', 0.3);
        this.faceToward(p.pos, dt);
      } else if (this.target) {
        const ok = this.stepToward(this.target, dt, this.speed, game.colliders);
        this.anim.play('walk', 0.25, { timeScale: 0.9 });
        if (!ok || this.pos.clone().normalize().angleTo(this.target) * R < 0.6) { this.target = null; this.wait = 2 + rand() * 5; }
      } else {
        this.anim.play('idle', 0.3);
        this.wait -= dt;
        if (this.wait <= 0) this.target = this.pickTarget(rand);
      }
    } else {
      this.anim.play('idle', 0.3);
      if (dist < 7) this.faceToward(p.pos, dt);
    }
    this.sync();
    this.anim.update(dt);
  }
}

export class Critter extends Walker {
  constructor(type, anim, home, opts) {
    super(anim, home, opts);
    this.type = type;
    this.happy = 0;
    this.flyer = type === 'bee' || type === 'parrot';
    this.baseLift = opts.lift || 0;
    this.phase = Math.random() * 10;
  }
  update(dt, game, rand) {
    const p = game.player;
    const dist = this.pos.distanceTo(p.pos);
    this.near = dist;
    this.phase += dt;
    if (this.flyer) this.lift = this.baseLift + Math.sin(this.phase * 2) * 0.3;
    if (this.happy > 0) {
      this.happy -= dt;
      this.anim.play(this.anim.has('dance') ? 'dance' : 'idle', 0.2);
      this.faceToward(p.pos, dt);
      if (this.flyer) this.pos.setLength(R + Math.max(sample(this.up), 0) + this.lift);
    } else if (dist < 6 && p.speed > 7 && !this.flyer && this.type !== 'elephant') {
      // scared! run away
      const away = this.pos.clone().sub(p.pos);
      const d = this.pos.clone().add(away.setLength(6)).normalize();
      if (!this.stepToward(d, dt, this.runSpeed, game.colliders)) this.stepToward(this.home, dt, this.runSpeed, game.colliders);
      this.anim.play(this.anim.has('run') ? 'run' : 'walk', 0.15);
      this.target = null;
    } else if (this.target) {
      const ok = this.stepToward(this.target, dt, this.speed, game.colliders);
      this.anim.play('walk', 0.25);
      if (!ok || this.pos.clone().normalize().angleTo(this.target) * R < 0.5) { this.target = null; this.wait = 2 + rand() * 6; }
    } else {
      this.wait -= dt;
      if (this.flyer) this.pos.setLength(R + Math.max(sample(this.up), 0) + this.lift);
      if (this.wait > 3 && this.anim.has('eat') && !this.flyer) this.anim.play('eat', 0.3);
      else this.anim.play('idle', 0.3);
      if (this.wait <= 0) this.target = this.pickTarget(rand);
    }
    this.sync();
    this.anim.update(dt);
  }
}

/** Build all NPCs & critters. Returns { npcs, critters, update }. */
export async function buildPeople(game, fx) {
  const { scene, save, audio, ui } = game;
  const rand = mulberry32(42);
  const npcs = [], critters = [];

  for (const def of NPCS) {
    const reg = regionById[def.region];
    const home = offsetDir(reg.dir, def.at[0], def.at[1]);
    const anim = await makeCharacter(def.skin);
    const sitting = def.behavior === 'sit';
    const npc = new NPC(def, anim, home, { lift: sitting ? 0.0 : 0 });
    scene.add(anim.root);
    npcs.push(npc);
    if (sitting && game.world && game.world.addSeat) game.world.addSeat(npc);
    game.interactables.push({
      get pos() { return npc.pos; },
      radius: 3.2,
      label: 'Talk',
      name: def.name,
      action: () => talkTo(npc),
      npc,
    });
  }

  function talkTo(npc) {
    const def = npc.def;
    npc.talking = true;
    npc.lock = 1.4;
    const first = npc.talks === 0 && !save.has('friends', def.id);
    let lines = def.lines;
    if (def.gives === 'glider' && game.player.hasGlider && def.after) lines = def.after;
    npc.talks++;
    ui.dialogue(def.name, lines, def.pitch || 1, npc.pos, () => {
      npc.talking = false;
      if (def.gives === 'glider' && !game.player.hasGlider) {
        game.player.hasGlider = true;
        save.data.glider = true; save.write();
        ui.toast('Got the Parasol! Hold SPACE while falling to glide.', 'parasol');
        audio.discover();
      }
      if (save.add('friends', def.id)) {
        ui.toast(`New friend: ${def.name}`, 'friend');
        audio.pickup(2);
      }
    });
    if (first) audio.open();
  }

  // ---- critters
  let animalCount = 0;
  for (const [regionId, list] of Object.entries(CRITTERS)) {
    const reg = regionById[regionId];
    for (const [type, count] of list) {
      for (let i = 0; i < count; i++) {
        let home = null;
        for (let tries = 0; tries < 30 && !home; tries++) {
          const a = rand() * Math.PI * 2, r = 4 + rand() * reg.r * R * 0.45;
          const d = offsetDir(reg.dir, Math.cos(a) * r, Math.sin(a) * r);
          const h = sample(d);
          if (h > 0.5 && h < 30) home = d;
        }
        if (!home) continue;
        const anim = await makeAnimal(type);
        const flyer = type === 'bee' || type === 'parrot';
        const c = new Critter(type, anim, home, {
          wander: type === 'crab' ? 5 : 10, speed: type === 'caterpillar' ? 0.4 : type === 'elephant' || type === 'cow' ? 1.0 : 1.6,
          runSpeed: type === 'bunny' || type === 'deer' ? 8 : 6, lift: flyer ? 1.6 : 0, minH: type === 'crab' ? 0.1 : 0.5,
        });
        scene.add(anim.root);
        critters.push(c);
        animalCount++;
        game.interactables.push({
          get pos() { return c.pos; },
          radius: type === 'giraffe' || type === 'elephant' ? 4 : 2.6,
          label: 'Pet',
          name: CRITTER_NAMES[type],
          action: () => pet(c),
          critter: c,
        });
      }
    }
  }

  function pet(c) {
    c.happy = 2.5;
    c.target = null;
    audio.animal(c.type);
    setTimeout(() => audio.heart(), 200);
    fx.hearts(c.pos.clone().addScaledVector(c.up, 1.6));
    game.player.anim.play('interact-right', 0.1, { once: true });
    game.player.petT = 0.6;
    if (save.add('critters', c.type)) {
      ui.toast(`Befriended a ${CRITTER_NAMES[c.type]}!`, 'critter');
    }
  }

  function update(dt) {
    const pp = game.player.pos;
    for (const n of npcs) {
      const d2 = n.pos.distanceToSquared(pp);
      n.anim.root.visible = d2 < 110 * 110;
      if (d2 < 90 * 90) n.update(dt, game, rand);
    }
    for (const c of critters) {
      const d2 = c.pos.distanceToSquared(pp);
      c.anim.root.visible = d2 < 65 * 65;
      if (d2 < 65 * 65) c.update(dt, game, rand);
    }
  }

  return { npcs, critters, update, pet };
}
