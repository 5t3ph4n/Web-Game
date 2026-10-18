import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { loadGLB } from './assets.js';
import { toonify, toonMaterial } from './toon.js';
import { REALISTIC } from './settings.js';

export const CHARACTER_SKINS = [
  'character-male-a', 'character-female-a', 'character-male-b', 'character-female-b',
  'character-male-c', 'character-female-c', 'character-male-d', 'character-female-d',
  'character-male-e', 'character-female-e', 'character-male-f', 'character-female-f',
];

export const ANIMAL_TYPES = [
  'beaver', 'bee', 'bunny', 'cat', 'caterpillar', 'chick', 'cow', 'crab', 'deer', 'dog', 'elephant', 'fish',
  'fox', 'giraffe', 'hog', 'koala', 'lion', 'monkey', 'panda', 'parrot', 'penguin', 'pig', 'polar', 'tiger',
];

// ------------------------------------------------------------------ customisation options
export const PALETTES = {
  skin: ['#f8dcc8', '#f0c4a2', '#e0a982', '#c98d62', '#ad7048', '#8d5536', '#6c3e27', '#4b2a1b'],
  hair: ['#1d1a1c', '#3b2a22', '#6b4632', '#9a5a32', '#c96f35', '#e3c06e', '#efe3c4', '#9b9ba3', '#e889b5', '#5a8de0', '#4fb38a', '#8a62d6'],
  cloth: ['#e05a50', '#f08a3c', '#f2c94c', '#7cc56a', '#3f9d6a', '#4aa3c9', '#3b6fd1', '#6b5bd6', '#c065c9', '#f2f2ee', '#8e8e94', '#2c2d33', '#8a5a3c', '#d9b98a'],
};
export const HATS = ['none', 'cap', 'beanie', 'tophat', 'straw', 'crown', 'wizard', 'party', 'flower', 'bunny', 'headphones', 'cowboy'];
export const FACES = ['none', 'glasses', 'sunglasses', 'mustache', 'blush', 'monocle'];
export const BACKS = ['none', 'cape', 'backpack', 'wings', 'scarf'];
export const LABELS = {
  none: 'None', cap: 'Cap', beanie: 'Beanie', tophat: 'Top hat', straw: 'Straw hat', crown: 'Crown', wizard: 'Wizard hat',
  party: 'Party hat', flower: 'Flower', bunny: 'Bunny ears', headphones: 'Headphones', cowboy: 'Cowboy hat',
  glasses: 'Glasses', sunglasses: 'Sunglasses', mustache: 'Mustache', blush: 'Rosy cheeks', monocle: 'Monocle',
  cape: 'Cape', backpack: 'Backpack', wings: 'Fairy wings', scarf: 'Scarf',
};

export function defaultLook(base = CHARACTER_SKINS[0]) {
  return {
    base, recolor: false, skin: PALETTES.skin[2], hair: PALETTES.hair[1], shirt: PALETTES.cloth[3], pants: PALETTES.cloth[6],
    shoes: PALETTES.cloth[11], accent: PALETTES.cloth[0], hat: 'none', face: 'none', back: 'none',
    height: 1, headSize: 1, build: 1, name: '',
  };
}
export function randomLook() {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  return {
    ...defaultLook(pick(CHARACTER_SKINS)), recolor: true,
    skin: pick(PALETTES.skin), hair: pick(PALETTES.hair), shirt: pick(PALETTES.cloth), pants: pick(PALETTES.cloth),
    shoes: pick(PALETTES.cloth), accent: pick(PALETTES.cloth),
    hat: Math.random() < 0.6 ? pick(HATS) : 'none', face: Math.random() < 0.4 ? pick(FACES) : 'none',
    back: Math.random() < 0.4 ? pick(BACKS) : 'none',
    height: 0.9 + Math.random() * 0.2, headSize: 0.95 + Math.random() * 0.25, build: 0.9 + Math.random() * 0.2,
  };
}

/**
 * An animated, skinned model (character or animal) with crossfading actions.
 * Model faces +Z. A `pose` group pivots around the hips so the body can lie
 * down (swimming) or lean without sliding the feet.
 */
export class Animated {
  constructor(gltf, height, { recolorTex, noFade } = {}) {
    this.root = new THREE.Group();
    this.pose = new THREE.Group();
    this.root.add(this.pose);
    this.model = cloneSkinned(gltf.scene);
    this.model.traverse((o) => {
      if (o.isMesh) {
        o.material = recolorTex ? recolorTex.material
          : noFade ? toonMaterial({ map: o.material.map, roughness: 0.75 }, { fade: false }) : toonify(o.material);
        if (noFade && o.material.map) { o.material.map.colorSpace = THREE.SRGBColorSpace; o.material.map.magFilter = THREE.NearestFilter; }
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
      }
    });
    const box = new THREE.Box3().setFromObject(this.model);
    const h = box.max.y - box.min.y;
    const s = height / h;
    this.baseScale = s;
    this.height = height;
    this.model.scale.setScalar(s);
    this.hip = height * 0.42;
    this.pose.position.y = this.hip;
    this.model.position.y = -box.min.y * s - this.hip;
    this.pose.add(this.model);
    this.bones = {};
    this.model.traverse((o) => { if (o.isBone) this.bones[o.name] = o; });
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const clip of gltf.animations) this.actions[clip.name] = this.mixer.clipAction(clip);
    this.current = null;
    this.play('idle', 0);
    this.proportions = { head: 1, build: 1 };
  }
  has(name) { return !!this.actions[name]; }
  play(name, fade = 0.2, { once = false, timeScale = 1 } = {}) {
    const a = this.actions[name] || this.actions.idle;
    if (!a) return;
    a.timeScale = timeScale;
    if (this.current === a) return;
    a.reset();
    a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = once;
    a.enabled = true;
    a.setEffectiveWeight(1);
    if (this.current && fade > 0) a.crossFadeFrom(this.current, fade, false);
    else if (this.current) this.current.stop();
    a.play();
    this.current = a;
    this.currentName = name;
  }
  setSpeed(ts) { if (this.current) this.current.timeScale = ts; }
  update(dt) {
    this.mixer.update(dt);
    const b = this.bones;
    if (b.head && this.proportions.head !== 1) b.head.scale.setScalar(this.proportions.head);
    if (b.torso && this.proportions.build !== 1) b.torso.scale.set(this.proportions.build, 1, this.proportions.build);
    if (this.afterUpdate) this.afterUpdate(dt);
  }
}

// ------------------------------------------------------------------ recolouring
/**
 * Work out which palette cells of the shared colormap are skin / hair / shirt /
 * pants / shoes for a given base model, by looking at which bone each vertex
 * follows and where it sits on the body. Cached per base model.
 */
const regionCache = new Map();
function analyseRegions(gltf, base) {
  if (regionCache.has(base)) return regionCache.get(base);
  const meshes = [];
  gltf.scene.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); });
  const keyOf = (u, v) => (v * 512 >= 384 ? 8 : 0) + Math.min(7, Math.floor(u * 8));
  const stats = {}; // part -> key -> {n, ysum}
  const add = (part, key, y) => {
    const p = stats[part] || (stats[part] = {});
    const e = p[key] || (p[key] = { n: 0, y: 0 });
    e.n++; e.y += y;
  };
  for (const m of meshes) {
    const g = m.geometry;
    const uv = g.attributes.uv, pos = g.attributes.position, ji = g.attributes.skinIndex, jw = g.attributes.skinWeight;
    const bones = m.skeleton.bones;
    for (let i = 0; i < uv.count; i++) {
      let bi = 0, bw = -1;
      for (let k = 0; k < 4; k++) { const w = jw.getComponent(i, k); if (w > bw) { bw = w; bi = ji.getComponent(i, k); } }
      const bone = bones[bi].name;
      const part = bone === 'head' ? 'head' : bone.startsWith('arm') ? 'arm' : bone.startsWith('leg') ? 'leg' : 'torso';
      add(part, keyOf(uv.getX(i), uv.getY(i)), pos.getY(i));
    }
  }
  const S = (part) => stats[part] || {};
  // skin: the colour shared by head and hands
  let skin = -1, best = 0;
  for (const k of Object.keys(S('head'))) {
    const score = Math.min(S('head')[k].n, (S('arm')[k] || { n: 0 }).n + (S('leg')[k] || { n: 0 }).n * 0.5);
    if (score > best) { best = score; skin = +k; }
  }
  if (skin < 0) skin = +Object.entries(S('head')).sort((a, b) => b[1].n - a[1].n)[0][0];
  // hair: highest non-skin colour on the head
  const headTotal = Object.values(S('head')).reduce((s, e) => s + e.n, 0);
  let hair = -1, hy = -Infinity;
  for (const [k, e] of Object.entries(S('head'))) {
    if (+k === skin || e.n < headTotal * 0.08) continue;
    const my = e.y / e.n;
    if (my > hy) { hy = my; hair = +k; }
  }
  // shirt: most common non-skin colour on torso + arms
  const merged = {};
  for (const part of ['torso', 'arm']) for (const [k, e] of Object.entries(S(part))) merged[k] = (merged[k] || 0) + e.n;
  let shirt = -1, sn = 0;
  for (const [k, n] of Object.entries(merged)) if (+k !== skin && n > sn) { sn = n; shirt = +k; }
  // shoes: lowest leg colour; pants: most common other leg colour
  const legTotal = Object.values(S('leg')).reduce((s, e) => s + e.n, 0);
  let shoes = -1, ly = Infinity;
  for (const [k, e] of Object.entries(S('leg'))) {
    if (+k === skin || e.n < legTotal * 0.06) continue;
    const my = e.y / e.n;
    if (my < ly) { ly = my; shoes = +k; }
  }
  let pants = -1, pn = 0;
  for (const [k, e] of Object.entries(S('leg'))) if (+k !== skin && +k !== shoes && e.n > pn) { pn = e.n; pants = +k; }
  if (pants === shirt) pants = -1; // dresses: keep the dress as the shirt colour
  const res = { skin, hair: hair === shirt ? -1 : hair, shirt, pants, shoes };
  regionCache.set(base, res);
  return res;
}

const SLOT = { skin: 0, hair: 1, shirt: 2, pants: 3, shoes: 4 };
/** Build per-character geometry (UVs pointed at custom slots) and its texture. */
function buildRecolor(gltf, base, look) {
  const reg = analyseRegions(gltf, base);
  const keyToSlot = {};
  for (const [name, key] of Object.entries(reg)) if (key >= 0) keyToSlot[key] = SLOT[name];
  // texture: original atlas + our slot gradients in the unused top area
  let srcImg = null;
  gltf.scene.traverse((o) => { if (o.isMesh && o.material.map && !srcImg) srcImg = o.material.map.image; });
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const g = canvas.getContext('2d');
  if (srcImg) g.drawImage(srcImg, 0, 0, 512, 512);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.magFilter = THREE.NearestFilter;
  const material = toonMaterial({ map: tex, roughness: 0.75 }, { fade: false });
  const paint = (lk) => {
    const shade = (hex, k) => {
      const c = new THREE.Color(hex);
      return `rgb(${Math.round(Math.min(1, c.r * k) * 255)},${Math.round(Math.min(1, c.g * k) * 255)},${Math.round(Math.min(1, c.b * k) * 255)})`;
    };
    for (const [name, slot] of Object.entries(SLOT)) {
      const hex = lk[name];
      const grad = g.createLinearGradient(0, 0, 0, 128);
      grad.addColorStop(0, shade(hex, 1.12));
      grad.addColorStop(0.5, shade(hex, 1.0));
      grad.addColorStop(1, shade(hex, 0.78));
      g.fillStyle = grad;
      g.fillRect(slot * 64, 0, 64, 128);
    }
    tex.needsUpdate = true;
  };
  paint(look);
  return { keyToSlot, material, paint, tex };
}

function remapUVs(model, keyToSlot) {
  model.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    o.geometry = o.geometry.clone();
    const uv = o.geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i), v = uv.getY(i);
      const key = (v * 512 >= 384 ? 8 : 0) + Math.min(7, Math.floor(u * 8));
      const slot = keyToSlot[key];
      if (slot === undefined) continue;
      const rowStart = key >= 8 ? 384 : 256;
      const inU = (u * 512) % 64, inV = v * 512 - rowStart;
      uv.setXY(i, (slot * 64 + inU) / 512, Math.max(0.5, Math.min(127.5, inV)) / 512);
    }
    uv.needsUpdate = true;
  });
}

// ------------------------------------------------------------------ accessories
function headFrame(anim) {
  // bounds of the head mesh in head-bone space (bind pose)
  let headMesh = null;
  anim.model.traverse((o) => { if (o.isSkinnedMesh && o.name.includes('head')) headMesh = o; });
  const bone = anim.bones.head;
  if (!headMesh || !bone) return null;
  const idx = headMesh.skeleton.bones.indexOf(bone);
  const inv = headMesh.skeleton.boneInverses[idx];
  const m = new THREE.Matrix4().multiplyMatrices(inv, headMesh.bindMatrix);
  const box = new THREE.Box3();
  const p = new THREE.Vector3();
  const pos = headMesh.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) box.expandByPoint(p.fromBufferAttribute(pos, i).applyMatrix4(m));
  return { bone, box };
}

function mat(color, opts = {}) { return toonMaterial({ color, roughness: opts.rough ?? 0.7, metalness: opts.metal ?? 0, ...opts.extra }, { fade: false }); }

function buildHat(type, accent, size) {
  const g = new THREE.Group();
  const A = mat(accent);
  const W = size.x, top = 0;
  const add = (geo, m, y = 0, x = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
  switch (type) {
    case 'cap': {
      add(new THREE.SphereGeometry(W * 0.56, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), A, -W * 0.08);
      const brim = add(new THREE.CylinderGeometry(W * 0.32, W * 0.32, W * 0.04, 20, 1, false, -Math.PI / 2, Math.PI), A, -W * 0.06, 0, W * 0.3);
      brim.scale.z = 1.3;
      add(new THREE.SphereGeometry(W * 0.06, 8, 6), mat('#ffffff'), W * 0.47);
      break;
    }
    case 'beanie': {
      add(new THREE.SphereGeometry(W * 0.58, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), A, -W * 0.12);
      add(new THREE.TorusGeometry(W * 0.56, W * 0.07, 8, 24), mat('#f2f2ee'), -W * 0.1).rotation.x = Math.PI / 2;
      add(new THREE.SphereGeometry(W * 0.13, 10, 8), mat('#f2f2ee'), W * 0.5);
      break;
    }
    case 'tophat': {
      add(new THREE.CylinderGeometry(W * 0.7, W * 0.7, W * 0.05, 24), mat('#22232a'), 0);
      add(new THREE.CylinderGeometry(W * 0.42, W * 0.44, W * 0.75, 24), mat('#22232a'), W * 0.38);
      add(new THREE.CylinderGeometry(W * 0.445, W * 0.445, W * 0.12, 24), A, W * 0.08);
      break;
    }
    case 'straw': {
      add(new THREE.CylinderGeometry(W * 1.0, W * 1.05, W * 0.04, 28), mat('#e8cf8a'), 0);
      add(new THREE.CylinderGeometry(W * 0.42, W * 0.48, W * 0.32, 24), mat('#e8cf8a'), W * 0.16);
      add(new THREE.CylinderGeometry(W * 0.485, W * 0.485, W * 0.09, 24), A, W * 0.06);
      break;
    }
    case 'cowboy': {
      const brim = add(new THREE.CylinderGeometry(W * 0.95, W * 0.95, W * 0.05, 28), mat('#8a5a3c'), 0);
      brim.scale.x = 1.15;
      add(new THREE.CylinderGeometry(W * 0.4, W * 0.48, W * 0.45, 20), mat('#8a5a3c'), W * 0.22);
      add(new THREE.CylinderGeometry(W * 0.485, W * 0.485, W * 0.08, 20), A, W * 0.06);
      break;
    }
    case 'crown': {
      const gold = mat('#f2c94c', { metal: 0.8, rough: 0.3 });
      add(new THREE.CylinderGeometry(W * 0.42, W * 0.42, W * 0.22, 16, 1, true), gold, W * 0.05).material.side = THREE.DoubleSide;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        add(new THREE.ConeGeometry(W * 0.08, W * 0.2, 4), gold, W * 0.25, Math.cos(a) * W * 0.4, Math.sin(a) * W * 0.4);
        add(new THREE.SphereGeometry(W * 0.04, 6, 4), mat(accent, { extra: { emissive: new THREE.Color(accent), emissiveIntensity: 0.4 } }), W * 0.08, Math.cos(a) * W * 0.43, Math.sin(a) * W * 0.43);
      }
      break;
    }
    case 'wizard': {
      add(new THREE.CylinderGeometry(W * 0.75, W * 0.75, W * 0.04, 24), A, 0);
      const cone = add(new THREE.ConeGeometry(W * 0.45, W * 1.3, 20), A, W * 0.65);
      cone.rotation.z = 0.15;
      for (let i = 0; i < 4; i++) add(new THREE.OctahedronGeometry(W * 0.05), mat('#f2c94c', { extra: { emissive: new THREE.Color('#f2c94c'), emissiveIntensity: 0.6 } }), W * (0.3 + i * 0.22), Math.sin(i * 2) * W * 0.25, Math.cos(i * 2) * W * 0.25 + W * 0.05);
      break;
    }
    case 'party': {
      add(new THREE.ConeGeometry(W * 0.28, W * 0.8, 16), A, W * 0.35);
      add(new THREE.SphereGeometry(W * 0.08, 8, 6), mat('#f2f2ee'), W * 0.78);
      break;
    }
    case 'flower': {
      const fl = new THREE.Group();
      for (let i = 0; i < 6; i++) {
        const p = new THREE.Mesh(new THREE.SphereGeometry(W * 0.09, 8, 6), A);
        const a = (i / 6) * Math.PI * 2;
        p.position.set(Math.cos(a) * W * 0.12, Math.sin(a) * W * 0.12, 0);
        p.scale.set(1, 1, 0.4);
        fl.add(p);
      }
      fl.add(new THREE.Mesh(new THREE.SphereGeometry(W * 0.07, 8, 6), mat('#f2c94c')));
      fl.position.set(W * 0.38, -W * 0.05, W * 0.15);
      fl.rotation.y = 0.9;
      g.add(fl);
      break;
    }
    case 'bunny': {
      for (const s of [-1, 1]) {
        const ear = add(new THREE.CapsuleGeometry(W * 0.08, W * 0.45, 4, 8), mat('#f2f2ee'), W * 0.32, s * W * 0.2, 0);
        ear.rotation.z = -s * 0.2;
        const inner = add(new THREE.CapsuleGeometry(W * 0.045, W * 0.35, 4, 8), mat('#f4a6c0'), W * 0.32, s * W * 0.2, W * 0.05);
        inner.rotation.z = -s * 0.2;
      }
      break;
    }
    case 'headphones': {
      const band = add(new THREE.TorusGeometry(W * 0.55, W * 0.05, 8, 24, Math.PI), mat('#2c2d33'), -W * 0.25);
      for (const s of [-1, 1]) {
        const cup = add(new THREE.CylinderGeometry(W * 0.17, W * 0.17, W * 0.12, 16), A, -W * 0.3, s * W * 0.55, 0);
        cup.rotation.z = Math.PI / 2;
      }
      band.rotation.z = 0;
      break;
    }
    default:
  }
  return g;
}

function buildFace(type, accent, size) {
  const g = new THREE.Group();
  const W = size.x;
  const add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); g.add(o); return o; };
  if (type === 'glasses' || type === 'sunglasses') {
    const frame = mat(type === 'glasses' ? accent : '#1d1a1c');
    const lens = type === 'sunglasses' ? mat('#141418', { rough: 0.1, metal: 0.3 }) : toonMaterial({ color: 0xd8f0ff, transparent: true, opacity: 0.25, roughness: 0.05 }, { fade: false });
    for (const s of [-1, 1]) {
      add(new THREE.TorusGeometry(W * 0.12, W * 0.022, 6, 16), frame, s * W * 0.2, 0, 0);
      add(new THREE.CircleGeometry(W * 0.115, 16), lens, s * W * 0.2, 0, -0.001);
    }
    add(new THREE.BoxGeometry(W * 0.15, W * 0.03, W * 0.03), frame, 0, W * 0.02, 0);
  } else if (type === 'mustache') {
    for (const s of [-1, 1]) {
      const m = add(new THREE.CapsuleGeometry(W * 0.045, W * 0.14, 4, 8), mat('#3b2a22'), s * W * 0.09, -W * 0.22, 0);
      m.rotation.z = Math.PI / 2 + s * 0.25;
    }
  } else if (type === 'blush') {
    for (const s of [-1, 1]) {
      const b = add(new THREE.CircleGeometry(W * 0.08, 16), toonMaterial({ color: 0xff7f9a, transparent: true, opacity: 0.55 }, { fade: false }), s * W * 0.3, -W * 0.12, 0);
      b.scale.y = 0.6;
    }
  } else if (type === 'monocle') {
    add(new THREE.TorusGeometry(W * 0.13, W * 0.02, 6, 16), mat('#f2c94c', { metal: 0.8, rough: 0.3 }), W * 0.2, 0, 0);
    add(new THREE.CircleGeometry(W * 0.12, 16), toonMaterial({ color: 0xd8f0ff, transparent: true, opacity: 0.3 }, { fade: false }), W * 0.2, 0, -0.001);
  }
  return g;
}

// ------------------------------------------------------------------ cloth (cape / scarf)
/** A small verlet cloth hanging from two anchor points, simulated in world space. */
export class Cloth {
  constructor(scene, color, { w = 6, h = 9, width = 0.75, length = 1.05 } = {}) {
    this.w = w; this.h = h;
    this.restX = width / (w - 1); this.restY = length / (h - 1);
    const n = w * h;
    this.p = new Float32Array(n * 3);
    this.prev = new Float32Array(n * 3);
    const geo = new THREE.PlaneGeometry(1, 1, w - 1, h - 1);
    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, toonMaterial({ color, side: THREE.DoubleSide, roughness: 0.9 }, { fade: false }));
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    scene.add(this.mesh);
    this.ready = false;
    this.scene = scene;
  }
  dispose() { this.scene.remove(this.mesh); this.geo.dispose(); }
  /**
   * anchors: { a, b } world positions for the top corners; body: { center, radius } to collide with;
   * up: planet up; back: direction behind the character.
   */
  step(dt, anchors, body, up, back, wind) {
    const { w, h, p, prev } = this;
    if (!this.ready) {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const k = (j * w + i) * 3;
        const t = i / (w - 1);
        const x = anchors.a.x + (anchors.b.x - anchors.a.x) * t - up.x * j * this.restY + back.x * 0.1;
        const y = anchors.a.y + (anchors.b.y - anchors.a.y) * t - up.y * j * this.restY + back.y * 0.1;
        const z = anchors.a.z + (anchors.b.z - anchors.a.z) * t - up.z * j * this.restY + back.z * 0.1;
        p[k] = prev[k] = x; p[k + 1] = prev[k + 1] = y; p[k + 2] = prev[k + 2] = z;
      }
      this.ready = true;
    }
    dt = Math.min(dt, 1 / 30);
    const g = -14 * dt * dt;
    const damp = 0.97;
    for (let idx = 0; idx < w * h; idx++) {
      const k = idx * 3;
      const vx = (p[k] - prev[k]) * damp, vy = (p[k + 1] - prev[k + 1]) * damp, vz = (p[k + 2] - prev[k + 2]) * damp;
      prev[k] = p[k]; prev[k + 1] = p[k + 1]; prev[k + 2] = p[k + 2];
      p[k] += vx + up.x * g + wind.x * dt * dt; p[k + 1] += vy + up.y * g + wind.y * dt * dt; p[k + 2] += vz + up.z * g + wind.z * dt * dt;
    }
    const constrain = (a, b, rest) => {
      const ka = a * 3, kb = b * 3;
      const dx = p[kb] - p[ka], dy = p[kb + 1] - p[ka + 1], dz = p[kb + 2] - p[ka + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
      const diff = (d - rest) / d * 0.5;
      p[ka] += dx * diff; p[ka + 1] += dy * diff; p[ka + 2] += dz * diff;
      p[kb] -= dx * diff; p[kb + 1] -= dy * diff; p[kb + 2] -= dz * diff;
    };
    for (let it = 0; it < 4; it++) {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const id = j * w + i;
        if (i < w - 1) constrain(id, id + 1, this.restX);
        if (j < h - 1) constrain(id, id + w, this.restY);
      }
      // pin the top row to the shoulders
      for (let i = 0; i < w; i++) {
        const t = i / (w - 1), k = i * 3;
        p[k] = anchors.a.x + (anchors.b.x - anchors.a.x) * t;
        p[k + 1] = anchors.a.y + (anchors.b.y - anchors.a.y) * t;
        p[k + 2] = anchors.a.z + (anchors.b.z - anchors.a.z) * t;
      }
      // keep the cloth outside the body capsule (approximated by spheres)
      for (const sph of body) {
        for (let idx = w; idx < w * h; idx++) {
          const k = idx * 3;
          const dx = p[k] - sph.c.x, dy = p[k + 1] - sph.c.y, dz = p[k + 2] - sph.c.z;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d < sph.r && d > 1e-5) { const s = sph.r / d; p[k] = sph.c.x + dx * s; p[k + 1] = sph.c.y + dy * s; p[k + 2] = sph.c.z + dz * s; }
        }
      }
    }
    const pos = this.geo.attributes.position;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = (j * w + i) * 3;
      pos.setXYZ(j * w + i, p[k], p[k + 1], p[k + 2]);
    }
    pos.needsUpdate = true;
    this.geo.computeVertexNormals();
  }
}

// ------------------------------------------------------------------ public factories
/**
 * Make a character. `look` is either a base model name (NPCs) or a full look
 * object from the character creator.
 */
export async function makeCharacter(look, height = 1.75) {
  if (typeof look === 'string') {
    const gltf = await loadGLB('characters/' + look);
    return new Animated(gltf, height);
  }
  const L = { ...defaultLook(), ...look };
  const gltf = await loadGLB('characters/' + L.base);
  let recolor = null;
  if (L.recolor) recolor = buildRecolor(gltf, L.base, L);
  const a = new Animated(gltf, height * L.height, { recolorTex: recolor, noFade: true });
  if (recolor) remapUVs(a.model, recolor.keyToSlot);
  a.look = L;
  a.recolor = recolor;
  a.proportions.head = L.headSize;
  a.proportions.build = L.build;
  // accessories on the head
  const hf = headFrame(a);
  if (hf) {
    const size = hf.box.getSize(new THREE.Vector3());
    const holder = new THREE.Group();
    hf.bone.add(holder);
    if (L.hat !== 'none') {
      const hat = buildHat(L.hat, L.accent, size);
      hat.position.set((hf.box.min.x + hf.box.max.x) / 2, hf.box.max.y - size.y * 0.12, (hf.box.min.z + hf.box.max.z) / 2);
      holder.add(hat);
    }
    if (L.face !== 'none') {
      const face = buildFace(L.face, L.accent, size);
      face.position.set((hf.box.min.x + hf.box.max.x) / 2, hf.box.min.y + size.y * 0.42, hf.box.max.z + size.z * 0.02);
      holder.add(face);
    }
    holder.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  }
  // backpack / wings attach to the torso; cape & scarf are simulated cloth (see Player)
  const torso = a.bones.torso;
  if (torso && (L.back === 'backpack' || L.back === 'wings')) {
    const s = 1 / a.baseScale; // author in metres
    const g = new THREE.Group();
    g.scale.setScalar(s);
    if (L.back === 'backpack') {
      const bag = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.2), mat(L.accent));
      bag.position.set(0, 0.32, -0.22);
      const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.08), mat(L.accent));
      pocket.position.set(0, 0.18, -0.33);
      const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.44, 12), mat('#8a5a3c'));
      roll.rotation.z = Math.PI / 2; roll.position.set(0, 0.6, -0.22);
      g.add(bag, pocket, roll);
    } else {
      const wingMat = toonMaterial({ color: 0xe8f6ff, transparent: true, opacity: 0.55, side: THREE.DoubleSide, roughness: 0.2, emissive: new THREE.Color(L.accent), emissiveIntensity: 0.25 }, { fade: false });
      for (const sd of [-1, 1]) {
        const wing = new THREE.Mesh(new THREE.CircleGeometry(0.35, 16), wingMat);
        wing.scale.set(1, 1.5, 1);
        wing.position.set(sd * 0.3, 0.45, -0.2);
        wing.rotation.y = sd * 0.5;
        wing.userData.side = sd;
        g.add(wing);
      }
      a.wings = g;
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    torso.add(g);
  }
  return a;
}

export const ANIMAL_HEIGHT = {
  beaver: 0.9, bee: 0.6, bunny: 0.8, cat: 0.8, caterpillar: 0.5, chick: 0.55, cow: 1.7, crab: 0.55, deer: 1.8,
  dog: 0.95, elephant: 3.0, fish: 0.6, fox: 0.95, giraffe: 4.2, hog: 1.1, koala: 0.9, lion: 1.5, monkey: 1.0,
  panda: 1.4, parrot: 0.7, penguin: 0.9, pig: 1.0, polar: 1.8, tiger: 1.5,
};
export async function makeAnimal(type) {
  const gltf = await loadGLB('animals/animal-' + type);
  return new Animated(gltf, ANIMAL_HEIGHT[type] || 1);
}
