import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { loadGLB } from './assets.js';
import { toonify } from './toon.js';

export const CHARACTER_SKINS = [
  'character-male-a', 'character-female-a', 'character-male-b', 'character-female-b',
  'character-male-c', 'character-female-c', 'character-male-d', 'character-female-d',
  'character-male-e', 'character-female-e', 'character-male-f', 'character-female-f',
];

export const ANIMAL_TYPES = [
  'beaver', 'bee', 'bunny', 'cat', 'caterpillar', 'chick', 'cow', 'crab', 'deer', 'dog', 'elephant', 'fish',
  'fox', 'giraffe', 'hog', 'koala', 'lion', 'monkey', 'panda', 'parrot', 'penguin', 'pig', 'polar', 'tiger',
];

/**
 * An animated, skinned model (character or animal) with crossfading actions.
 * Model faces +Z. `height` is the desired world height.
 */
export class Animated {
  constructor(gltf, height) {
    this.root = new THREE.Group();
    this.model = cloneSkinned(gltf.scene);
    this.model.traverse((o) => {
      if (o.isMesh) {
        o.material = toonify(o.material);
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
      }
    });
    const box = new THREE.Box3().setFromObject(this.model);
    const h = box.max.y - box.min.y;
    const s = height / h;
    this.model.scale.setScalar(s);
    this.model.position.y = -box.min.y * s;
    this.root.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const clip of gltf.animations) this.actions[clip.name] = this.mixer.clipAction(clip);
    this.current = null;
    this.play('idle', 0);
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
  update(dt) { this.mixer.update(dt); }
}

export async function makeCharacter(skin, height = 1.75) {
  const gltf = await loadGLB('characters/' + skin);
  return new Animated(gltf, height);
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
