import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toonify } from './toon.js';
import { R, sample } from './planet.js';

const loader = new GLTFLoader();
const BASE = import.meta.env.BASE_URL + 'assets/';
const cache = new Map();

export function loadGLB(path) {
  if (!cache.has(path)) {
    cache.set(path, new Promise((res, rej) => loader.load(BASE + path + '.glb', res, undefined, rej)));
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
        const m = toonify(o.material, { wind });
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

// ------------------------------------------------------------------ chunked instancing
const CH = 3; // grid per cube face
function chunkKey(d) {
  const ax = Math.abs(d.x), ay = Math.abs(d.y), az = Math.abs(d.z);
  let f, u, v;
  if (ax >= ay && ax >= az) { f = d.x > 0 ? 0 : 1; u = d.y / ax; v = d.z / ax; }
  else if (ay >= az) { f = d.y > 0 ? 2 : 3; u = d.x / ay; v = d.z / ay; }
  else { f = d.z > 0 ? 4 : 5; u = d.x / az; v = d.y / az; }
  const iu = Math.min(CH - 1, Math.floor(((u + 1) / 2) * CH));
  const iv = Math.min(CH - 1, Math.floor(((v + 1) / 2) * CH));
  return f * 100 + iu * 10 + iv;
}

export class Scatter {
  constructor() {
    this.items = new Map(); // key -> Map(path -> {matrices, shadow})
    this.chunks = [];
    this.group = new THREE.Group();
  }
  add(path, matrix, { shadow = true } = {}) {
    _p.setFromMatrixPosition(matrix).normalize();
    const key = chunkKey(_p);
    if (!this.items.has(key)) this.items.set(key, new Map());
    const m = this.items.get(key);
    const id = path + (shadow ? '' : '#ns');
    if (!m.has(id)) m.set(id, { path, shadow, mats: [] });
    m.get(id).mats.push(matrix.clone());
  }
  build() {
    for (const [, byPath] of this.items) {
      const g = new THREE.Group();
      const center = new THREE.Vector3();
      let n = 0;
      for (const [, { path, shadow, mats }] of byPath) {
        const model = getModel(path);
        for (const part of model.parts) {
          const im = new THREE.InstancedMesh(part.geometry, part.material, mats.length);
          for (let i = 0; i < mats.length; i++) {
            im.setMatrixAt(i, mats[i]);
            if (part === model.parts[0]) { center.add(_p.setFromMatrixPosition(mats[i])); n++; }
          }
          im.castShadow = shadow; im.receiveShadow = true;
          im.computeBoundingSphere();
          g.add(im);
        }
      }
      center.divideScalar(Math.max(n, 1));
      g.userData.center = center;
      this.chunks.push(g);
      this.group.add(g);
    }
    return this.group;
  }
  update(cameraPos, viewDist = 120) {
    const vd2 = viewDist * viewDist;
    for (const c of this.chunks) c.visible = c.userData.center.distanceToSquared(cameraPos) < vd2;
  }
}
