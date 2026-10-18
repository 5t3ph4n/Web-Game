import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toonify } from './toon.js';
import { R, sample, overHorizon } from './planet.js';

const loader = new GLTFLoader();
const BASE = import.meta.env.BASE_URL + 'assets/';
// model file extension (the hosted artifact build uses self-contained .json glTF)
const EXT = import.meta.env.VITE_MODEL_EXT || '.glb';
const cache = new Map();

export function loadGLB(path) {
  if (!cache.has(path)) {
    cache.set(path, new Promise((res, rej) => loader.load(BASE + path + EXT, res, undefined, rej)));
  }
  return cache.get(path);
}

const models = new Map();
/**
 * Preload a set of static models. Each becomes { parts:[{geometry, material}], box, size }
 * with geometry baked into model space and materials converted to toon.
 */
export async function preloadModels(list, onProgress) {
  let done = 0;
  await Promise.all(
    list.map(async (entry) => {
      const { path, wind = 0 } = typeof entry === 'string' ? { path: entry } : entry;
      const gltf = await loadGLB(path);
      gltf.scene.updateMatrixWorld(true);
      const byMat = new Map();
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        const g = o.geometry.clone();
        g.applyMatrix4(o.matrixWorld);
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
        if (!g.attributes.uv) {
          g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        }
        const m = toonify(o.material, { wind, windows: path.startsWith('houses/building'), detail: true });
        if (!byMat.has(m)) byMat.set(m, []);
        byMat.get(m).push(g.index ? g.toNonIndexed() : g);
      });
      const parts = [];
      for (const [material, geoms] of byMat) {
        const geometry = geoms.length > 1 ? mergeGeometries(geoms) : geoms[0];
        parts.push({ geometry, material });
      }
      const box = new THREE.Box3().setFromObject(gltf.scene);
      models.set(path, { parts, box, size: box.getSize(new THREE.Vector3()) });
      done++;
      onProgress && onProgress(done / list.length);
    })
  );
}

export function getModel(path) {
  const m = models.get(path);
  if (!m) throw new Error('Model not preloaded: ' + path);
  return m;
}

// ------------------------------------------------------------------ collision shapes from meshes
const hfCache = new Map();
const clampI = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * Collision heightfield of a model, in model units: for each cell of a grid over its footprint, the highest
 * surface (`top`) and the lowest (`bot`). Cells are ~25cm at the given scale. Built from the actual triangles
 * (vertices, points along every edge, and cell centres inside each triangle) so walls, eaves, porches, thin
 * posts and offset geometry all land where you can see them.
 */
export function getHeightfield(path, scale = 1) {
  const m = getModel(path);
  const nx = clampI(Math.round((m.size.x * scale) / 0.25), 1, 64);
  const nz = clampI(Math.round((m.size.z * scale) / 0.25), 1, 64);
  const key = path + '|' + nx + '|' + nz;
  if (hfCache.has(key)) return hfCache.get(key);
  const minX = m.box.min.x, minZ = m.box.min.z;
  const sx = m.size.x / nx || 1, sz = m.size.z / nz || 1;
  const top = new Float32Array(nx * nz).fill(-Infinity);
  const bot = new Float32Array(nx * nz).fill(Infinity);
  const mark = (x, y, z) => {
    const k = clampI(Math.floor((z - minZ) / sz), 0, nz - 1) * nx + clampI(Math.floor((x - minX) / sx), 0, nx - 1);
    if (y > top[k]) top[k] = y;
    if (y < bot[k]) bot[k] = y;
  };
  const sp = Math.min(sx, sz) * 0.5;
  for (const part of m.parts) {
    const a = part.geometry.attributes.position.array;
    for (let t = 0; t + 8 < a.length; t += 9) {
      const ax = a[t], ay = a[t + 1], az = a[t + 2], bx = a[t + 3], by = a[t + 4], bz = a[t + 5], cx = a[t + 6], cy = a[t + 7], cz = a[t + 8];
      // along the edges (catches walls, posts and rails thinner than a cell)
      for (const [x0, y0, z0, x1, y1, z1] of [[ax, ay, az, bx, by, bz], [bx, by, bz, cx, cy, cz], [cx, cy, cz, ax, ay, az]]) {
        const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / sp));
        for (let i = 0; i <= n; i++) { const f = i / n; mark(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, z0 + (z1 - z0) * f); }
      }
      // cell centres covered by the triangle (roofs, floors, big flat faces)
      const den = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
      if (Math.abs(den) < 1e-10) continue;
      const i0 = clampI(Math.floor((Math.min(ax, bx, cx) - minX) / sx), 0, nx - 1), i1 = clampI(Math.floor((Math.max(ax, bx, cx) - minX) / sx), 0, nx - 1);
      const j0 = clampI(Math.floor((Math.min(az, bz, cz) - minZ) / sz), 0, nz - 1), j1 = clampI(Math.floor((Math.max(az, bz, cz) - minZ) / sz), 0, nz - 1);
      for (let j = j0; j <= j1; j++) {
        const pz = minZ + (j + 0.5) * sz;
        for (let i = i0; i <= i1; i++) {
          const px = minX + (i + 0.5) * sx;
          const u = ((bx - px) * (cz - pz) - (cx - px) * (bz - pz)) / den;
          const v = ((cx - px) * (az - pz) - (ax - px) * (cz - pz)) / den;
          if (u < 0 || v < 0 || u + v > 1) continue;
          mark(px, u * ay + v * by + (1 - u - v) * cy, pz);
        }
      }
    }
  }
  const hf = { nx, nz, sx, sz, minX, minZ, top, bot };
  hfCache.set(key, hf);
  return hf;
}

/** Trunk radius of a tree-like model (widest point in the bottom 5% of its height), in model units. */
export function trunkRadius(path) {
  const m = getModel(path);
  if (m.trunk === undefined) {
    let r = 0;
    const lim = m.box.min.y + m.size.y * 0.05;
    for (const part of m.parts) {
      const a = part.geometry.attributes.position.array;
      for (let i = 0; i < a.length; i += 3) if (a[i + 1] <= lim) r = Math.max(r, Math.hypot(a[i], a[i + 2]));
    }
    m.trunk = r || m.size.x * 0.15;
  }
  return m.trunk;
}

/** A heightfield collider for a model placed like surfaceMatrix(up, { yaw, scale }) with its origin at `pos`. */
export function modelCollider(path, pos, up, { yaw = 0, scale = 1, ...extra } = {}) {
  const m = getModel(path);
  const q = surfaceQuat(up, yaw);
  return {
    shape: 'hf', pos, up: up.clone().normalize(), hf: getHeightfield(path, scale), s: scale,
    ax: new THREE.Vector3(1, 0, 0).applyQuaternion(q), az: new THREE.Vector3(0, 0, 1).applyQuaternion(q),
    hx: (m.size.x * scale) / 2, hz: (m.size.z * scale) / 2,
    cx: ((m.box.min.x + m.box.max.x) / 2) * scale, cz: ((m.box.min.z + m.box.max.z) / 2) * scale,
    y0: m.box.min.y * scale, y1: m.box.max.y * scale,
    ...extra,
  };
}

/** Create a normal (non-instanced) toon Object3D for a preloaded model. */
export function makeObject(path, { shadow = true } = {}) {
  const m = getModel(path);
  const g = new THREE.Group();
  for (const p of m.parts) {
    const mesh = new THREE.Mesh(p.geometry, p.material);
    mesh.castShadow = shadow; mesh.receiveShadow = true;
    g.add(mesh);
  }
  return g;
}

// ------------------------------------------------------------------ placement helpers
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _Y = new THREE.Vector3(0, 1, 0);
const _p = new THREE.Vector3(), _s = new THREE.Vector3();

/** Quaternion that stands an object upright at direction `up`, rotated by yaw around up. */
export function surfaceQuat(up, yaw = 0, out = new THREE.Quaternion()) {
  out.setFromUnitVectors(_Y, up);
  _q2.setFromAxisAngle(_Y, yaw);
  return out.multiply(_q2);
}

export function surfaceMatrix(dir, { yaw = 0, scale = 1, lift = 0, height } = {}, out = new THREE.Matrix4()) {
  const h = height !== undefined ? height : sample(dir);
  _p.copy(dir).multiplyScalar(R + h + lift);
  surfaceQuat(dir, yaw, _q);
  if (typeof scale === 'number') _s.set(scale, scale, scale); else _s.copy(scale);
  return out.compose(_p, _q, _s);
}

// ------------------------------------------------------------------ instancing with per-instance culling
/**
 * Static props share one InstancedMesh per model part for the whole planet (one draw call each). A few times a
 * second the instances that are in range and over the horizon are packed to the front of the buffer, so far
 * away and hidden ones cost nothing; small props (flowers, pebbles) get a shorter range and cast no shadow.
 */
export class Scatter {
  constructor() {
    this.items = new Map(); // id -> {path, shadow, mats}
    this.sets = [];
    this.group = new THREE.Group();
    this.last = new THREE.Vector3(1e9, 0, 0);
    this.lastT = 0;
  }
  add(path, matrix, { shadow = true } = {}) {
    const id = path + (shadow ? '' : '#ns');
    if (!this.items.has(id)) this.items.set(id, { path, shadow, mats: [] });
    this.items.get(id).mats.push(matrix.clone());
  }
  build() {
    for (const [, { path, shadow, mats }] of this.items) {
      const model = getModel(path);
      const rad = model.size.length() / 2;
      const n = mats.length;
      const dirs = new Float32Array(n * 3), tops = new Float32Array(n), dists = new Float32Array(n);
      let sc = 0;
      for (let i = 0; i < n; i++) {
        _p.setFromMatrixPosition(mats[i]);
        const s = mats[i].getMaxScaleOnAxis();
        sc = Math.max(sc, s);
        tops[i] = _p.length() + rad * 2 * s;
        _p.normalize().toArray(dirs, i * 3);
      }
      const small = rad * sc < 0.6;
      const ims = model.parts.map((part) => {
        const im = new THREE.InstancedMesh(part.geometry, part.material, n);
        im.castShadow = shadow && !small; im.receiveShadow = true;
        im.count = 0;
        this.group.add(im);
        return im;
      });
      this.sets.push({ mats, dirs, tops, dists, small, ims, n });
    }
    return this.group;
  }
  update(cameraPos, viewDist = 120) {
    // re-pack only after moving a bit, or now and then for camera turns around the player
    const now = performance.now();
    if (this.last.distanceToSquared(cameraPos) < 2.25 && now - this.lastT < 400) return;
    this.last.copy(cameraPos);
    this.lastT = now;
    const vd = viewDist, sd = viewDist * 0.55;
    for (const set of this.sets) {
      const { mats, dirs, tops, small, ims, n } = set;
      const max = small ? sd : vd;
      let count = 0;
      for (let i = 0; i < n; i++) {
        const e = mats[i].elements;
        const dx = e[12] - cameraPos.x, dy = e[13] - cameraPos.y, dz = e[14] - cameraPos.z;
        if (dx * dx + dy * dy + dz * dz > max * max) continue;
        _p.fromArray(dirs, i * 3);
        if (!overHorizon(cameraPos, _p, tops[i])) continue;
        for (const im of ims) im.instanceMatrix.array.set(e, count * 16);
        count++;
      }
      for (const im of ims) {
        im.count = count;
        im.visible = count > 0;
        if (!count) continue;
        im.instanceMatrix.clearUpdateRanges();
        im.instanceMatrix.addUpdateRange(0, count * 16);
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
      }
    }
  }
}
