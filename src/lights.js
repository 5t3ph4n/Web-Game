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
    // light a torch automatically in dark places (toggled with L)
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
    this.night = night;
    for (const s of this.sources) {
      if (s.sprite) {
        s.night = !s.sprite.userData.always;
        if (s.sprite.scale.x === 0) continue;
      }
      if (s.night && night < (s.sprite?.userData.onAt ?? 0.02)) continue;
      const d2 = s.pos.distanceToSquared(player.pos);
      if (d2 > 70 * 70) continue;
      list.push([d2, s]);
    }
    list.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < this.pool.length; i++) {
      const l = this.pool[i];
      const e = i < active ? list[i] : null;
      // keep the number of visible lights fixed (changing it recompiles every shader); unused ones just go dark
      l.visible = i < active;
      if (!e) { l.intensity = 0; continue; }
      const s = e[1];
      l.position.copy(s.pos);
      l.color.copy(s.col);
      l.distance = s.range;
      let k = s.night ? night : 1;
      if (s.flicker) k *= 1 - s.flicker * (0.5 + 0.5 * Math.sin(time * 13 + s.phase) * Math.sin(time * 7.3 + s.phase * 2));
      // fade out with distance so swaps are invisible
      k *= 1 - THREE.MathUtils.smoothstep(e[0], 45 * 45, 65 * 65);
      l.intensity = s.intensity * k;
    }
  }
  /** Roughly how brightly the lamps, fires and windows around light point p (0 = pitch dark, ~1 = well lit). */
  litAt(p) {
    let lit = 0;
    for (const s of this.sources) {
      if (s.sprite && s.sprite.scale.x === 0) continue;
      const k = s.night ? this.night || 0 : 1;
      if (k < 0.02) continue;
      const d2 = s.pos.distanceToSquared(p);
      const r = s.range * 0.55;
      if (d2 > s.range * s.range * 1.5) continue;
      lit += (s.intensity / 6) * k / (1 + d2 / (r * r));
    }
    return lit;
  }
}
