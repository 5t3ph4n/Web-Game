import * as THREE from 'three';
import { R, sample, biomeAt, tangentBasis } from './planet.js';
import { globalUniforms, toonMaterial } from './toon.js';
import { orient, tangent } from './player.js';

function canvasTex(draw, size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const heartTex = () => canvasTex((g, s) => {
  g.fillStyle = '#ff6f91'; g.strokeStyle = '#2b2d42'; g.lineWidth = 4;
  g.beginPath();
  g.moveTo(s / 2, s * 0.85);
  g.bezierCurveTo(s * 0.05, s * 0.5, s * 0.15, s * 0.1, s / 2, s * 0.32);
  g.bezierCurveTo(s * 0.85, s * 0.1, s * 0.95, s * 0.5, s / 2, s * 0.85);
  g.fill(); g.stroke();
});
const sparkTex = () => canvasTex((g, s) => {
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, 'rgba(255,255,240,1)'); gr.addColorStop(0.25, 'rgba(255,240,180,0.8)'); gr.addColorStop(1, 'rgba(255,220,120,0)');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
});
const starTex = () => canvasTex((g, s) => {
  g.translate(s / 2, s / 2);
  g.fillStyle = '#fff3a8'; g.strokeStyle = '#2b2d42'; g.lineWidth = 3;
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? s * 0.18 : s * 0.42, a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath(); g.fill(); g.stroke();
});

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.tex = { heart: heartTex(), spark: sparkTex(), star: starTex() };
    this.pool = [];
    this.active = [];
    this.glows = [];
    this.buildButterflies();
    this.buildFireflies();
    this.buildBirds();
    this.shooting = [];
  }

  sprite(kind, pos, { vel, life = 1.2, size = 0.6, additive = false, color } = {}) {
    let s = this.pool.pop();
    if (!s) {
      s = new THREE.Sprite(new THREE.SpriteMaterial({ depthWrite: false, transparent: true, fog: false }));
      this.scene.add(s);
    }
    s.material.map = this.tex[kind];
    s.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    s.material.color.set(color || 0xffffff);
    s.material.needsUpdate = true;
    s.visible = true;
    s.position.copy(pos);
    s.scale.setScalar(size);
    s.userData = { vel: vel ? vel.clone() : new THREE.Vector3(), life, max: life, size };
    this.active.push(s);
    return s;
  }
  hearts(pos) {
    const up = pos.clone().normalize();
    for (let i = 0; i < 5; i++) {
      const v = up.clone().multiplyScalar(1.5 + Math.random()).add(new THREE.Vector3().randomDirection().multiplyScalar(0.7));
      this.sprite('heart', pos.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(0.3)), { vel: v, life: 1.3, size: 0.45 + Math.random() * 0.2 });
    }
  }
  sparkle(pos, n = 14, color) {
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(2 + Math.random() * 3);
      this.sprite('spark', pos, { vel: v, life: 0.7 + Math.random() * 0.5, size: 0.5, additive: true, color });
    }
  }
  burst(pos, n = 10) {
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(3 + Math.random() * 2).addScaledVector(pos.clone().normalize(), 3);
      this.sprite('star', pos, { vel: v, life: 1.0, size: 0.4 });
    }
  }

  addGlow(pos, color = 0xffd27a, size = 2.5) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.spark, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    s.position.copy(pos); s.scale.setScalar(size);
    s.userData.base = size;
    s.userData.phase = Math.random() * 6;
    this.scene.add(s);
    this.glows.push(s);
    return s;
  }

  // ------------------------------------------------ butterflies
  buildButterflies() {
    const g = new THREE.BufferGeometry();
    // two wings as quads hinged at x=0
    const v = [0, 0, -0.12, 0.25, 0, -0.18, 0.25, 0, 0.12, 0, 0, -0.12, 0.25, 0, 0.12, 0, 0, 0.12,
      0, 0, -0.12, -0.25, 0, 0.12, -0.25, 0, -0.18, 0, 0, -0.12, 0, 0, 0.12, -0.25, 0, 0.12];
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(v.length / 3).fill([0, 1, 0]).flat(), 3));
    const mat = toonMaterial({ side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = globalUniforms.uTime;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `vec3 transformed = position;
          float ph = instanceMatrix[3].x * 3.1 + instanceMatrix[3].z;
          float flap = sin(uTime * 18.0 + ph) * 0.9;
          float sx = sign(position.x);
          float ax = abs(position.x);
          transformed.y = sin(flap) * ax;
          transformed.x = sx * cos(flap) * ax;`);
    };
    mat.customProgramCacheKey = () => 'butterfly';
    this.bfly = new THREE.InstancedMesh(g, mat, 40);
    this.bfly.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(40 * 3), 3);
    const cols = [0xffe36e, 0xff9ec4, 0xffffff, 0x9fd8ff, 0xffb36b];
    this.bflyState = [];
    for (let i = 0; i < 40; i++) {
      this.bfly.setColorAt(i, new THREE.Color(cols[i % cols.length]));
      this.bflyState.push({ pos: new THREE.Vector3(), dir: new THREE.Vector3(), t: Math.random() * 10, alive: false });
    }
    this.bfly.frustumCulled = false;
    this.scene.add(this.bfly);
  }
  buildFireflies() {
    const N = 160;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    const ph = new Float32Array(N);
    for (let i = 0; i < N; i++) ph[i] = Math.random() * 10;
    g.setAttribute('phase', new THREE.BufferAttribute(ph, 1));
    this.ffMat = new THREE.ShaderMaterial({
      uniforms: { uTime: globalUniforms.uTime, uAmt: { value: 0 }, uTex: { value: this.tex.spark } },
      vertexShader: `attribute float phase; uniform float uTime; uniform float uAmt; varying float vA;
        void main(){ vec3 p = position + vec3(sin(uTime*0.7+phase*3.0), sin(uTime*0.9+phase*5.0)*0.6, cos(uTime*0.6+phase*2.0)) * 0.8;
          vec4 mv = modelViewMatrix * vec4(p,1.0); gl_Position = projectionMatrix * mv;
          vA = uAmt * (0.5 + 0.5 * sin(uTime * 3.0 + phase * 7.0));
          gl_PointSize = 70.0 / -mv.z; }`,
      fragmentShader: `uniform sampler2D uTex; varying float vA;
        void main(){ vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(vec3(0.85,1.0,0.45) * t.a, t.a * vA); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.ff = new THREE.Points(g, this.ffMat);
    this.ff.frustumCulled = false;
    this.ffCenter = new THREE.Vector3(1e9, 0, 0);
    this.scene.add(this.ff);
  }
  buildBirds() {
    const wingGeo = new THREE.BufferGeometry();
    wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.25, 0, 0, -0.2, 0.9, 0, -0.05], 3));
    wingGeo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    const mat = toonMaterial({ color: 0xffffff, side: THREE.DoubleSide }, { fade: false });
    const body = new THREE.SphereGeometry(0.18, 6, 4);
    const NB = 26;
    this.birdBody = new THREE.InstancedMesh(body, mat, NB);
    this.birdL = new THREE.InstancedMesh(wingGeo, mat, NB);
    this.birdR = new THREE.InstancedMesh(wingGeo, mat, NB);
    for (const m of [this.birdBody, this.birdL, this.birdR]) { m.frustumCulled = false; this.scene.add(m); }
    this.birds = [];
    for (let i = 0; i < NB; i++) {
      this.birds.push({ obj: new THREE.Object3D(), ang: Math.random() * 6.28, speed: 0.012 + Math.random() * 0.01, alt: 14 + Math.random() * 14, rad: 0.05 + Math.random() * 0.12, phase: Math.random() * 6, center: null });
    }
  }
  setBirdCenters(centers) {
    this.birds.forEach((b, i) => { b.center = centers[i % centers.length]; });
  }

  update(dt, game) {
    const { player, sky } = game;
    // particles
    for (let i = this.active.length - 1; i >= 0; i--) {
      const s = this.active[i];
      const u = s.userData;
      u.life -= dt;
      if (u.life <= 0) { s.visible = false; this.active.splice(i, 1); this.pool.push(s); continue; }
      s.position.addScaledVector(u.vel, dt);
      u.vel.multiplyScalar(1 - dt * 1.5);
      const k = u.life / u.max;
      s.material.opacity = Math.min(1, k * 2.5);
      s.scale.setScalar(u.size * (0.6 + 0.4 * Math.min(1, (1 - k) * 6)));
    }
    // night glows
    for (const g of this.glows) {
      g.visible = (sky.night > 0.05 || g.userData.always) && g.position.distanceToSquared(player.pos) < 130 * 130;
      g.material.opacity = Math.max(sky.night, g.userData.always ? 0.6 : 0) * (0.85 + Math.sin(game.time * 3 + g.userData.phase) * 0.15);
    }
    // butterflies (daytime, in flowery places)
    const up = player.up;
    const biome = game.world.biomeHere;
    const flowery = ['meadow', 'village', 'farm', 'forest', 'ruins', 'mushroom', 'beach'].includes(biome) && sky.night < 0.3 && sky.rainAmt < 0.3;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), t1 = new THREE.Vector3(), t2 = new THREE.Vector3();
    for (let i = 0; i < this.bflyState.length; i++) {
      const b = this.bflyState[i];
      const far = b.pos.distanceTo(player.pos) > 30;
      if ((!b.alive || far) && flowery && Math.random() < dt * 2) {
        tangentBasis(up, t1, t2);
        const d = player.pos.clone().normalize().addScaledVector(t1, (Math.random() - 0.5) * 0.4).addScaledVector(t2, (Math.random() - 0.5) * 0.4).normalize();
        const h = sample(d);
        if (h > 0.8) {
          b.pos.copy(d).multiplyScalar(R + h + 1 + Math.random() * 1.5);
          b.dir.randomDirection(); b.alive = true;
        }
      } else if (far || !flowery) b.alive = b.alive && !far && flowery;
      if (b.alive) {
        b.t += dt;
        const bu = b.pos.clone().normalize();
        b.dir.add(new THREE.Vector3().randomDirection().multiplyScalar(dt * 3));
        tangent(b.dir, bu);
        b.pos.addScaledVector(b.dir, dt * 1.6);
        const gh = R + Math.max(sample(bu), 0);
        const want = gh + 1.0 + Math.sin(b.t * 2 + i) * 0.5;
        b.pos.setLength(b.pos.length() + (want - b.pos.length()) * dt * 2);
        const o = new THREE.Object3D();
        orient(o, bu, b.dir);
        m.compose(b.pos, o.quaternion, sc.setScalar(0.9));
      } else m.makeScale(0, 0, 0);
      this.bfly.setMatrixAt(i, m);
    }
    this.bfly.instanceMatrix.needsUpdate = true;

    // fireflies around player at night
    const ffAmt = sky.night * (['forest', 'meadow', 'mushroom', 'village', 'ruins', 'farm'].includes(biome) ? 1 : 0.15);
    this.ffMat.uniforms.uAmt.value += (ffAmt - this.ffMat.uniforms.uAmt.value) * Math.min(1, dt);
    if (this.ffMat.uniforms.uAmt.value > 0.01 && this.ffCenter.distanceTo(player.pos) > 20) {
      this.ffCenter.copy(player.pos);
      const pos = this.ff.geometry.attributes.position;
      tangentBasis(up, t1, t2);
      for (let i = 0; i < pos.count; i++) {
        const d = player.pos.clone().normalize().addScaledVector(t1, (Math.random() - 0.5) * 0.6).addScaledVector(t2, (Math.random() - 0.5) * 0.6).normalize();
        const h = Math.max(sample(d), 0);
        const p = d.multiplyScalar(R + h + 0.6 + Math.random() * 2.5);
        pos.setXYZ(i, p.x, p.y, p.z);
      }
      pos.needsUpdate = true;
    }

    // birds circle their roost
    {
      const bm = new THREE.Matrix4(), wm = new THREE.Matrix4(), out = new THREE.Matrix4(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
      const wq = new THREE.Quaternion(), Z = new THREE.Vector3(0, 0, 1), one = new THREE.Vector3(1, 1, 1), mir = new THREE.Vector3(-1, 1, 1), o0 = new THREE.Vector3();
      this.birds.forEach((b, i) => {
        if (!b.center) return;
        b.ang += dt * b.speed * 40 / (b.rad * 60);
        tangentBasis(b.center, t1, t2);
        const d = b.center.clone().addScaledVector(t1, Math.cos(b.ang) * b.rad).addScaledVector(t2, Math.sin(b.ang) * b.rad).normalize();
        const h = Math.max(sample(d), 0);
        const np = d.clone().multiplyScalar(R + h + b.alt + Math.sin(game.time + b.phase) * 2);
        const fwd = np.clone().sub(b.obj.position);
        b.obj.position.copy(np);
        if (fwd.lengthSq() > 1e-6) orient(b.obj, d, tangent(fwd, d));
        b.obj.scale.setScalar(1.3);
        b.obj.updateMatrix();
        if (np.distanceToSquared(player.pos) > 150 * 150) {
          this.birdBody.setMatrixAt(i, zero); this.birdL.setMatrixAt(i, zero); this.birdR.setMatrixAt(i, zero);
          return;
        }
        const flap = Math.sin(game.time * 9 + b.phase) * 0.6;
        this.birdBody.setMatrixAt(i, out.multiplyMatrices(b.obj.matrix, wm.makeScale(1, 0.8, 2)));
        this.birdL.setMatrixAt(i, out.multiplyMatrices(b.obj.matrix, wm.compose(o0, wq.setFromAxisAngle(Z, flap), one)));
        this.birdR.setMatrixAt(i, out.multiplyMatrices(b.obj.matrix, wm.compose(o0, wq.setFromAxisAngle(Z, -flap), mir)));
      });
      this.birdBody.instanceMatrix.needsUpdate = this.birdL.instanceMatrix.needsUpdate = this.birdR.instanceMatrix.needsUpdate = true;
    }

    // shooting stars at night
    if (sky.night > 0.6 && Math.random() < dt * (game.world.regionHere && game.world.regionHere.id === 'crater' ? 1.5 : 0.15)) this.shootingStar(game);
    for (let i = this.shooting.length - 1; i >= 0; i--) {
      const s = this.shooting[i];
      s.userData.life -= dt;
      s.position.addScaledVector(s.userData.vel, dt);
      s.material.opacity = Math.max(0, s.userData.life);
      if (s.userData.life <= 0) { this.scene.remove(s); this.shooting.splice(i, 1); }
    }
  }
  shootingStar(game) {
    const up = game.player.up;
    const t1 = new THREE.Vector3(), t2 = new THREE.Vector3();
    tangentBasis(up, t1, t2);
    const start = game.camera.position.clone().addScaledVector(up, 140 + Math.random() * 60).addScaledVector(t1, (Math.random() - 0.5) * 300).addScaledVector(t2, (Math.random() - 0.5) * 300);
    const vel = t1.clone().multiplyScalar(Math.random() - 0.5).addScaledVector(t2, Math.random() - 0.5).addScaledVector(up, -0.3).setLength(160);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.spark, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
    s.scale.set(5, 5, 1);
    s.position.copy(start);
    s.userData = { vel, life: 1 };
    this.scene.add(s);
    this.shooting.push(s);
    // trail
    for (let k = 1; k < 6; k++) {
      const tr = s.clone(); tr.material = s.material.clone();
      tr.scale.setScalar(5 - k * 0.7);
      tr.position.copy(start).addScaledVector(vel, -k * 0.02);
      tr.userData = { vel, life: 1 - k * 0.1 };
      this.scene.add(tr); this.shooting.push(tr);
    }
  }
}
