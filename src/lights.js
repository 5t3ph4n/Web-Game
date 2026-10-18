import * as THREE from 'three';
import { q } from './settings.js';

/**
 * A fixed pool of point lights that is assigned each frame to the light sources
 * nearest the player (lanterns, campfires, mushrooms...). Keeping the count
 * fixed avoids shader recompiles while still giving lots of dynamic lights.
 */
export class LightPool {
  constructor(scene) {
    this.sources = [];
    this.pool = [];
    const n = 8; // max; quality decides how many are active
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(0xffc070, 0, 14, 1.6);
      l.castShadow = false;
      scene.add(l);
      this.pool.push(l);
    }
    // the player's own little lantern
    this.carry = new THREE.PointLight(0xffd29a, 0, 11, 1.4);
    scene.add(this.carry);
    this.carryOn = true;
    this._tmp = [];
  }
  /** { pos, color, intensity, range, flicker, night(true = only at night) } */
  add(src) {
    this.sources.push({ color: 0xffc070, intensity: 6, range: 12, flicker: 0, night: true, ...src, col: new THREE.Color(src.color ?? 0xffc070), phase: Math.random() * 10 });
  }
  update(dt, game) {
    const { player, sky, time } = game;
    const night = sky.night;
    const active = q().lights;
    const list = this._tmp;
    list.length = 0;
    for (const s of this.sources) {
      if (s.sprite) {
        s.night = !s.sprite.userData.always;
        if (s.sprite.scale.x === 0) continue;
      }
      if (s.night && night < 0.02) continue;
      const d2 = s.pos.distanceToSquared(player.pos);
      if (d2 > 70 * 70) continue;
      list.push([d2, s]);
    }
    list.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < this.pool.length; i++) {
      const l = this.pool[i];
      const e = i < active ? list[i] : null;
      if (!e) { l.intensity = 0; l.visible = false; continue; }
      const s = e[1];
      l.visible = true;
      l.position.copy(s.pos);
      l.color.copy(s.col);
      l.distance = s.range;
      let k = s.night ? night : 1;
      if (s.flicker) k *= 1 - s.flicker * (0.5 + 0.5 * Math.sin(time * 13 + s.phase) * Math.sin(time * 7.3 + s.phase * 2));
      // fade out with distance so swaps are invisible
      k *= 1 - THREE.MathUtils.smoothstep(e[0], 45 * 45, 65 * 65);
      l.intensity = s.intensity * k;
    }
    // carried lantern
    const want = this.carryOn ? THREE.MathUtils.smoothstep(night, 0.35, 0.8) : 0;
    this.carry.intensity += (want * 5 - this.carry.intensity) * Math.min(1, dt * 3);
    this.carry.position.copy(player.pos).addScaledVector(player.up, 2.2).addScaledVector(player.facing, 0.6);
  }
}
