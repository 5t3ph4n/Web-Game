import * as THREE from 'three';
import { R } from './planet.js';

/**
 * Static colliders standing on the planet surface. Every collider has a base point `pos`, an `up` axis and a
 * vertical span [y0, y1] measured from the base along `up` (y1 = Infinity: a wall nothing can stand on).
 * Shapes:
 *  - cylinder (default): radius `r`, optional `rt` = radius at the top (cones, tapering towers) and `standR` =
 *    how far from the axis you can stand on top
 *  - box: half extents `hx`/`hz` along tangent axes `ax`/`az`, centre offset `cx`/`cz`
 *  - sphere: radius `r` with its centre `cy` above the base (domes, boulders)
 *  - hf: a heightfield built from a model's own mesh (houses, rocks, carts…), scaled by `s`. Each cell is solid
 *    between its underside and its top, so roofs can be stood on and canopies/eaves walked under.
 * Optional: `step` (walk-up height override), `onLand(player, c)`, `onTouch(player, c)`, `passive`, `removed`.
 */
export const STEP = 0.55; // walk straight up onto anything this much higher than your feet
export const BODY_H = 1.7; // body height, for overhangs and ceilings
const CELL = 8;

export class Colliders {
  constructor() { this.map = new Map(); this.all = []; this.stamp = 0; }
  key(x, y, z) { return ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) | 0; }
  add(c) {
    c.up = c.up || c.pos.clone().normalize();
    c.base = c.pos.length();
    c.y0 = c.y0 ?? 0;
    c.y1 = c.y1 ?? c.top ?? Infinity;
    c.shape = c.shape || (c.hf ? 'hf' : c.hx !== undefined ? 'box' : 'cyl');
    c.cx = c.cx || 0; c.cz = c.cz || 0;
    if (c.shape === 'cyl') { c.rt = c.rt ?? c.r; c.standR = c.standR ?? c.rt; }
    c.seen = 0;
    this.all.push(c);
    // register in every cell touched by the collider's bounding sphere
    const ext = c.shape === 'box' || c.shape === 'hf' ? Math.hypot(c.hx, c.hz) + Math.hypot(c.cx, c.cz) : Math.max(c.r, c.rt || 0);
    const lo = Math.max(c.y0, -4), hi = Math.min(c.y1, lo + 40);
    const mid = (lo + hi) / 2, rad = Math.hypot(ext, (hi - lo) / 2);
    const mx = c.pos.x + c.up.x * mid, my = c.pos.y + c.up.y * mid, mz = c.pos.z + c.up.z * mid;
    for (let x = Math.floor((mx - rad) / CELL); x <= Math.floor((mx + rad) / CELL); x++)
      for (let y = Math.floor((my - rad) / CELL); y <= Math.floor((my + rad) / CELL); y++)
        for (let z = Math.floor((mz - rad) / CELL); z <= Math.floor((mz + rad) / CELL); z++) {
          const k = this.key(x, y, z);
          let l = this.map.get(k);
          if (!l) this.map.set(k, (l = []));
          l.push(c);
        }
    return c;
  }
  remove(c) {
    c.removed = true;
  }
  near(p, out = []) {
    out.length = 0;
    const s = ++this.stamp;
    const cx = Math.floor(p.x / CELL), cy = Math.floor(p.y / CELL), cz = Math.floor(p.z / CELL);
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      const l = this.map.get(this.key(cx + x, cy + y, cz + z));
      if (l) for (const c of l) if (c.seen !== s && !c.removed) { c.seen = s; out.push(c); }
    }
    return out;
  }
}

const _d = new THREE.Vector3(), _n = new THREE.Vector3();
const _list = [];
const _res = { floor: -Infinity, floorC: null, ceil: Infinity, push: new THREE.Vector3() };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * Resolve a body whose feet are at world position `pos`, radius `r`. Mutates `pos` to push it out of anything
 * it walks into. Returns { floor, floorC, ceil, push }: the highest top it can stand on and a ceiling it bumped
 * into (both as distances from the planet centre), and the total horizontal push applied.
 * opts: { step, height, vUp, prevR } — prevR is the feet radius before this frame's fall, so a fast fall can't
 * tunnel through a roof.
 */
export function resolve(colliders, pos, r, opts = {}, onHit) {
  const st = { step: opts.step ?? STEP, H: opts.height ?? BODY_H, rising: (opts.vUp || 0) > 0.5, fallen: 0 };
  if (opts.prevR !== undefined) st.fallen = Math.max(0, opts.prevR - pos.length());
  const res = _res;
  res.floor = -Infinity; res.floorC = null; res.ceil = Infinity; res.push.set(0, 0, 0);
  const list = colliders.near(pos, _list);
  for (const c of list) {
    if (collide(c, pos, r, st, res) && onHit) onHit(c);
  }
  return res;
}

function standOn(c, res, y, horiz) {
  const fr = Math.sqrt((c.base + y) ** 2 + horiz * horiz);
  if (fr > res.floor) { res.floor = fr; res.floorC = c; }
}
function bump(c, res, y, horiz, H) {
  res.ceil = Math.min(res.ceil, Math.sqrt((c.base + y - H) ** 2 + horiz * horiz));
}
function shove(c, pos, res, x, z, inWorld) {
  // x/z are along the collider's own tangent axes unless inWorld (then _n already holds the push)
  if (!inWorld) _n.copy(c.ax).multiplyScalar(x).addScaledVector(c.az, z);
  pos.add(_n);
  res.push.add(_n);
}

/** Collide one collider. Returns true if the body touched it (pushed, landed or bumped). */
function collide(c, pos, r, st, res) {
  _d.copy(pos).sub(c.pos);
  const hy = _d.dot(c.up); // feet height above the collider's base
  _d.addScaledVector(c.up, -hy); // horizontal offset from its axis
  const feet = hy + st.fallen; // where the feet were before falling this frame
  const step = Math.max(st.step, c.step || 0);
  const H = st.H;

  if (c.shape === 'cyl' || c.shape === 'sphere') {
    const dist = _d.length();
    if (c.shape === 'sphere') {
      if (dist >= c.r + r) return false;
      const dc = Math.max(0, dist - r); // highest point of the dome under the body's footprint
      if (dc < c.r) {
        const top = c.cy + Math.sqrt(c.r * c.r - dc * dc);
        if (feet >= top - step) { standOn(c, res, top, dist); return true; }
      }
      const yn = clamp(c.cy, hy, hy + H);
      const rad = Math.sqrt(Math.max(0, c.r * c.r - (yn - c.cy) ** 2));
      if (dist >= rad + r) return false;
      return pushRadial(c, pos, res, dist, rad + r - dist);
    }
    if (dist >= Math.max(c.r, c.rt) + r) return false;
    if (c.y1 !== Infinity && feet >= c.y1 - step) {
      if (dist < c.standR + r * 0.3) standOn(c, res, c.y1, dist);
      return dist < c.standR + r;
    }
    if (hy + H <= c.y0) return false; // walking underneath
    if (st.rising && hy < c.y0 && dist < c.r) { bump(c, res, c.y0, dist, H); return true; }
    if (c.passive) return true;
    const lo = Math.max(hy, c.y0), hi = Math.min(hy + H, c.y1);
    const span = c.y1 - c.y0;
    const rad = c.rt === c.r || span === Infinity ? c.r : Math.max(c.r + (c.rt - c.r) * (lo - c.y0) / span, c.r + (c.rt - c.r) * (hi - c.y0) / span);
    if (dist >= rad + r) return false;
    return pushRadial(c, pos, res, dist, rad + r - dist);
  }

  // box & heightfield: work in the collider's local tangent frame
  let lx = _d.dot(c.ax), lz = _d.dot(c.az);
  if (c.shape === 'box') {
    const x0 = c.cx - c.hx, x1 = c.cx + c.hx, z0 = c.cz - c.hz, z1 = c.cz + c.hz;
    const px = lx - clamp(lx, x0, x1), pz = lz - clamp(lz, z0, z1);
    const dd = Math.hypot(px, pz);
    if (dd >= r) return false;
    if (c.y1 !== Infinity && feet >= c.y1 - step) {
      if (dd < r * 0.3) standOn(c, res, c.y1, Math.hypot(lx, lz));
      return true;
    }
    if (hy + H <= c.y0) return false;
    if (st.rising && hy < c.y0 && dd === 0) { bump(c, res, c.y0, Math.hypot(lx, lz), H); return true; }
    if (c.passive) return true;
    const p = rectPush(lx, lz, x0, x1, z0, z1, px, pz, dd, r, null);
    shove(c, pos, res, p.x, p.z);
    return true;
  }

  // heightfield: push out of the deepest blocking cell, a few times over
  const hf = c.hf, s = c.s;
  const cw = hf.sx * s, ch = hf.sz * s, gx = hf.minX * s, gz = hf.minZ * s;
  let touched = false;
  for (let iter = 0; iter < 4; iter++) {
    const i0 = Math.max(0, Math.floor((lx - r - gx) / cw)), i1 = Math.min(hf.nx - 1, Math.floor((lx + r - gx) / cw));
    const j0 = Math.max(0, Math.floor((lz - r - gz) / ch)), j1 = Math.min(hf.nz - 1, Math.floor((lz + r - gz) / ch));
    let bestPen = 0, bx = 0, bz = 0;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * hf.nx + i;
        const top = hf.top[k] * s;
        if (top === -Infinity) continue;
        const x0 = gx + i * cw, z0 = gz + j * ch;
        const px = lx - clamp(lx, x0, x0 + cw), pz = lz - clamp(lz, z0, z0 + ch);
        const dd = Math.hypot(px, pz);
        if (dd >= r) continue;
        const bot = hf.bot[k] * s;
        if (feet >= top - step) {
          if (dd < r * 0.3) standOn(c, res, top, Math.hypot(lx, lz));
          touched = true;
          continue;
        }
        if (hy + H <= bot) continue; // under an eave / canopy
        touched = true;
        if (st.rising && hy < bot && dd === 0) { bump(c, res, bot, Math.hypot(lx, lz), H); continue; }
        const p = rectPush(lx, lz, x0, x0 + cw, z0, z0 + ch, px, pz, dd, r, (di, dj) => blocking(hf, i + di, j + dj, s, hy, H, step),
          lx - (gx + hf.nx * cw * 0.5), lz - (gz + hf.nz * ch * 0.5));
        if (p.pen > bestPen) { bestPen = p.pen; bx = p.x; bz = p.z; }
      }
    }
    if (bestPen <= 0 || c.passive) break;
    lx += bx; lz += bz;
    shove(c, pos, res, bx, bz);
  }
  return touched;
}

function pushRadial(c, pos, res, dist, pen) {
  if (c.passive) return true;
  if (dist < 1e-4) _n.set(1, 0, 0).cross(c.up); else _n.copy(_d);
  _n.normalize().multiplyScalar(pen);
  shove(c, pos, res, 0, 0, true);
  return true;
}

function blocking(hf, i, j, s, hy, H, step) {
  if (i < 0 || j < 0 || i >= hf.nx || j >= hf.nz) return false;
  const k = j * hf.nx + i;
  return hf.top[k] * s > hy + step && hf.bot[k] * s < hy + H;
}

const _p = { x: 0, z: 0, pen: 0 };
/**
 * Push a circle (centre lx/lz, radius r) out of a rectangle. px/pz/dd = offset & distance from the rectangle's
 * closest point. If the centre is inside, leave through the nearest side that isn't walled off by a neighbour,
 * or failing that the side facing away from the whole shape (ox/oz = offset from its middle).
 */
function rectPush(lx, lz, x0, x1, z0, z1, px, pz, dd, r, isBlocked, ox = 0, oz = 0) {
  if (dd > 1e-6) {
    const pen = r - dd;
    _p.x = (px / dd) * pen; _p.z = (pz / dd) * pen; _p.pen = pen;
    return _p;
  }
  const sides = [[lx - x0, -1, 0], [x1 - lx, 1, 0], [lz - z0, 0, -1], [z1 - lz, 0, 1]].sort((a, b) => a[0] - b[0]);
  let pick = sides[0];
  if (isBlocked) {
    pick = sides.find((sd) => !isBlocked(sd[1], sd[2]));
    if (!pick) pick = sides.find((sd) => (Math.abs(ox) > Math.abs(oz) ? sd[1] === Math.sign(ox) : sd[2] === Math.sign(oz))) || sides[0];
  }
  const pen = pick[0] + r;
  _p.x = pick[1] * pen; _p.z = pick[2] * pen; _p.pen = pen;
  return _p;
}

export { R };
