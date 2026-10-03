import * as THREE from 'three';
import { R } from './planet.js';

/**
 * Colliders are vertical cylinders standing on the planet surface.
 * { pos: Vector3 (world, at ground), up: unit Vector3, r: radius, top: height above base (Infinity = wall),
 *   base: radius-from-centre of its base, onTouch?: fn }
 * Objects with a finite top can be stood on.
 */
const CELL = 8;
export class Colliders {
  constructor() { this.map = new Map(); this.all = []; }
  key(x, y, z) { return ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) | 0; }
  add(c) {
    c.up = c.up || c.pos.clone().normalize();
    c.base = c.base ?? c.pos.length();
    this.all.push(c);
    const ext = Math.ceil(c.r / CELL);
    const cx = Math.floor(c.pos.x / CELL), cy = Math.floor(c.pos.y / CELL), cz = Math.floor(c.pos.z / CELL);
    for (let x = -ext; x <= ext; x++) for (let y = -ext; y <= ext; y++) for (let z = -ext; z <= ext; z++) {
      const k = this.key(cx + x, cy + y, cz + z);
      if (!this.map.has(k)) this.map.set(k, []);
      this.map.get(k).push(c);
    }
    return c;
  }
  remove(c) {
    c.removed = true;
  }
  near(p, out = []) {
    out.length = 0;
    const cx = Math.floor(p.x / CELL), cy = Math.floor(p.y / CELL), cz = Math.floor(p.z / CELL);
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      const l = this.map.get(this.key(cx + x, cy + y, cz + z));
      if (l) for (const c of l) if (!c.removed && !out.includes(c)) out.push(c);
    }
    return out;
  }
}

const _d = new THREE.Vector3();
const _list = [];
/**
 * Resolve a body at world position `pos` (feet), radius `r`. Mutates pos to push it out.
 * Returns the highest standable top (as radius from centre) under the body, or -Infinity.
 */
const _res = { floor: -Infinity, floorC: null };
export function resolve(colliders, pos, r, feetRadius, onHit) {
  let floor = -Infinity, floorC = null;
  const list = colliders.near(pos, _list);
  for (const c of list) {
    _d.copy(pos).sub(c.pos);
    const along = _d.dot(c.up);
    _d.addScaledVector(c.up, -along);
    const dist = _d.length();
    const rr = c.r + r;
    if (dist >= rr) continue;
    const topR = c.base + c.top;
    if (feetRadius >= topR - 0.35 && c.top !== Infinity) {
      // standing over it
      if (dist < c.r + r * 0.3 && topR > floor) { floor = topR; floorC = c; }
      continue;
    }
    if (feetRadius > topR) continue;
    if (c.passive) { onHit && onHit(c); continue; }
    // push out
    if (dist < 1e-4) _d.set(1, 0, 0).cross(c.up);
    _d.normalize().multiplyScalar(rr - dist);
    pos.add(_d);
    onHit && onHit(c);
  }
  _res.floor = floor; _res.floorC = floorC;
  return _res;
}

export { R };
