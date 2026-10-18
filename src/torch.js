import * as THREE from 'three';
import { toonMaterial } from './toon.js';

const smooth = THREE.MathUtils.smoothstep;
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3();

function flameTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  // teardrop: round base, pointed tip
  const gr = g.createRadialGradient(32, 92, 2, 32, 84, 40);
  gr.addColorStop(0, 'rgba(255,255,230,1)');
  gr.addColorStop(0.3, 'rgba(255,214,120,0.95)');
  gr.addColorStop(0.65, 'rgba(255,130,40,0.6)');
  gr.addColorStop(1, 'rgba(255,80,20,0)');
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(32, 4);
  g.bezierCurveTo(46, 40, 62, 70, 58, 96);
  g.bezierCurveTo(54, 124, 10, 124, 6, 96);
  g.bezierCurveTo(2, 70, 18, 40, 32, 4);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Where the end of a limb is, in that bone's own space (from the bind pose of the skinned mesh). */
function limbTip(anim, boneName) {
  const bone = anim.bones[boneName];
  if (!bone) return null;
  let tip = null, best = -1;
  const p = new THREE.Vector3(), m = new THREE.Matrix4();
  anim.model.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const idx = o.skeleton.bones.indexOf(bone);
    if (idx < 0) return;
    m.multiplyMatrices(o.skeleton.boneInverses[idx], o.bindMatrix);
    const pos = o.geometry.attributes.position, si = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight;
    for (let i = 0; i < pos.count; i++) {
      let w = 0;
      for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === idx) w += sw.getComponent(i, k);
      if (w < 0.5) continue;
      p.fromBufferAttribute(pos, i).applyMatrix4(m);
      const d = p.lengthSq();
      if (d > best) { best = d; tip = p.clone(); }
    }
  });
  return tip && { bone, tip };
}

/**
 * The player's torch. It comes out by itself in really dark places (night away from lamps, deep forest
 * after dusk), lights up the surroundings with a flickering point light and goes out with a hiss in water.
 */
export class Torch {
  constructor(scene, fx, audio) {
    this.fx = fx;
    this.audio = audio;
    this.out = 0; // 0 stowed .. 1 in hand
    this.lit = 0; // flame size 0..1
    this.wantT = 0;
    this.on = false;
    this.dark = 0;
    this.emberT = 0;
    this.crackleT = 0;

    const g = new THREE.Group();
    const wood = toonMaterial({ color: 0x7a5236, roughness: 0.9 }, { fade: false });
    const wrap = toonMaterial({ color: 0x3b2c22, roughness: 1, emissive: 0xff6a20, emissiveIntensity: 0 }, { fade: false });
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.62, 8), wood);
    handle.position.y = 0.16;
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.055, 0.17, 10), wrap);
    head.position.y = 0.5;
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 12), toonMaterial({ color: 0x8d8a85, metalness: 0.6, roughness: 0.4 }, { fade: false }));
    band.rotation.x = Math.PI / 2; band.position.y = 0.4;
    for (const m of [handle, head, band]) { m.castShadow = true; g.add(m); }
    this.wrap = wrap;
    const tex = flameTexture();
    const mk = (color, sx, sy) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
      s.center.set(0.5, 0.1);
      s.userData.base = new THREE.Vector2(sx, sy);
      s.position.y = 0.53;
      g.add(s);
      return s;
    };
    this.flames = [mk(0xff7a2a, 0.42, 0.7), mk(0xffd890, 0.24, 0.42)];
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: fx.tex.spark, color: 0xff9a40, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, opacity: 0.5 }));
    this.glow.position.y = 0.66;
    g.add(this.glow);
    this.group = g;
    this.flameTip = new THREE.Object3D();
    this.flameTip.position.y = 0.72;
    g.add(this.flameTip);

    // always in the scene, so the light count never changes (that would recompile every shader)
    this.light = new THREE.PointLight(0xff9a48, 0, 17, 1.5);
    scene.add(this.light);
  }

  /** Put the torch in the right hand of a (new) character model. */
  attach(anim) {
    this.group.removeFromParent();
    const t = limbTip(anim, 'arm-right');
    if (!t) return;
    this.bone = t.bone;
    this.group.position.copy(t.tip).multiplyScalar(0.86);
    t.bone.add(this.group);
    this.group.scale.setScalar(0.001);
  }

  update(dt, game) {
    const { player, sky, lights, world } = game;
    if (!this.bone) return;
    // how dark is it right here?
    const night = sky.night;
    const biome = world.biomeHere;
    const canopy = biome === 'forest' || biome === 'mushroom' ? smooth(night, 0.12, 0.45) : 0;
    let dark = Math.max(smooth(night, 0.4, 0.8), canopy);
    dark *= 1 - smooth(lights.litAt(player.pos), 0.5, 1.4);
    if (player.pos.length() < 100 - 1.5) dark = 0; // under the sea: no fire
    this.dark = dark;

    const busy = player.mode !== 'walk' || player.holding || player.inWater || game.ui.creatorState;
    const want = lights.carryOn && !busy && (this.on ? dark > 0.28 : dark > 0.55);
    // a short delay so it doesn't flicker in and out at the edge of a lamp's light
    this.wantT = want === this.on ? 0 : this.wantT + dt;
    if (this.wantT > (want ? 0.6 : 1.4) || (busy && this.on)) {
      if (this.on && !want && player.inWater && this.lit > 0.3) {
        this.audio.hiss && this.audio.hiss();
        this.flameTip.getWorldPosition(_p);
        this.fx.dust(_p, 8, 0xd8dde2);
      }
      this.on = want;
      this.wantT = 0;
      if (want) this.audio.ignite && this.audio.ignite();
    }

    this.out += ((this.on ? 1 : 0) - this.out) * Math.min(1, dt * 7);
    this.lit += ((this.on && this.out > 0.6 ? 1 : 0) - this.lit) * Math.min(1, dt * (this.on ? 4 : 9));
    player.torchArm = this.out;
    const g = this.group;
    g.visible = this.out > 0.02;
    g.scale.setScalar(Math.max(0.001, smooth(this.out, 0, 0.7)));
    if (!g.visible) { this.light.intensity = 0; return; }

    // keep the torch upright in the world whatever the arm is doing
    player.obj.updateWorldMatrix(true, true);
    this.bone.getWorldQuaternion(_q);
    player.obj.getWorldQuaternion(_q2);
    _q2.multiply(new THREE.Quaternion().setFromAxisAngle(_v.set(1, 0, 0), 0.25 + Math.sin(game.time * 1.7) * 0.04));
    g.quaternion.copy(_q.invert()).multiply(_q2);
    // undo the model's scale so the torch has the same size in every character's hand
    this.bone.getWorldScale(_v);
    g.scale.set(g.scale.x / _v.x, g.scale.y / _v.y, g.scale.z / _v.z);

    // flame
    const t = game.time;
    const fl = 0.82 + Math.sin(t * 17.3) * 0.07 + Math.sin(t * 29.1 + 1.3) * 0.05 + Math.sin(t * 7.1) * 0.06;
    for (const [i, s] of this.flames.entries()) {
      const b = s.userData.base;
      const k = this.lit * (i ? fl * 1.05 : fl);
      s.scale.set(b.x * k * (1 + Math.sin(t * 23 + i) * 0.06), b.y * k, 1);
      s.visible = this.lit > 0.02;
    }
    this.glow.scale.setScalar(1.3 * this.lit * fl);
    this.glow.visible = this.lit > 0.02;
    this.wrap.emissiveIntensity = this.lit * 1.6;

    this.flameTip.getWorldPosition(_p);
    this.light.position.copy(_p);
    this.light.intensity = this.lit * fl * 9;

    // embers and crackle
    if (this.lit > 0.5) {
      this.emberT -= dt;
      if (this.emberT <= 0) {
        this.emberT = 0.08 + Math.random() * 0.25;
        const up = _v.copy(_p).normalize();
        const vel = up.clone().multiplyScalar(1.2 + Math.random()).add(new THREE.Vector3().randomDirection().multiplyScalar(0.4)).addScaledVector(player.vel, 0.5);
        this.fx.sprite('spark', _p, { vel, life: 0.5 + Math.random() * 0.6, size: 0.07 + Math.random() * 0.06, additive: true, color: 0xffa040, grav: -1 });
      }
      this.crackleT -= dt;
      if (this.crackleT <= 0) { this.crackleT = 0.15 + Math.random() * 0.6; this.audio.crackle && this.audio.crackle(); }
    }
  }
}
