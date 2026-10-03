import * as THREE from 'three';
import { R } from './planet.js';
import { toonMaterial, globalUniforms } from './toon.js';
import { mulberry32 } from './noise.js';

const KEYS = [
  // t, skyTop, skyHorizon, sunColor, sunIntensity, ambient
  [0.0, 0x0e1a38, 0x24395e, 0x8ea4dd, 0.55, 0.42],
  [0.2, 0x13234a, 0x2d4670, 0x8ea4dd, 0.5, 0.42],
  [0.26, 0x5c8fb8, 0xf4ad86, 0xffb486, 1.3, 0.7],
  [0.34, 0x63b8c2, 0xbfe5d8, 0xfff0d6, 2.3, 1.0],
  [0.5, 0x5fb8c0, 0xc8ebdf, 0xfff6e4, 2.5, 1.05],
  [0.66, 0x63b4c0, 0xc6e3d4, 0xfff0d6, 2.3, 1.0],
  [0.74, 0x6a7fb8, 0xf7a27c, 0xffa070, 1.3, 0.7],
  [0.8, 0x1b2a55, 0x3a4a78, 0x8ea4dd, 0.5, 0.45],
  [1.0, 0x0e1a38, 0x24395e, 0x8ea4dd, 0.55, 0.42],
];
const cA = new THREE.Color(), cB = new THREE.Color();
function keyColor(t, idx, out) {
  for (let i = 0; i < KEYS.length - 1; i++) {
    const a = KEYS[i], b = KEYS[i + 1];
    if (t >= a[0] && t <= b[0]) {
      const f = (t - a[0]) / (b[0] - a[0]);
      if (out) return out.copy(cA.setHex(a[idx])).lerp(cB.setHex(b[idx]), f);
      return a[idx] + (b[idx] - a[idx]) * f;
    }
  }
  return out ? out.setHex(KEYS[0][idx]) : KEYS[0][idx];
}

export class Sky {
  constructor(scene) {
    this.scene = scene;
    this.time = 0.36; // time of day (0..1), starts mid-morning
    this.dayLength = 480; // seconds per full day
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.night = 0;
    this.weather = 'clear';
    this.weatherT = 60;
    this.rainAmt = 0;
    this.cloudCover = 0.3;

    this.skyTop = new THREE.Color();
    this.skyHorizon = new THREE.Color();
    this.fogColor = new THREE.Color();

    // dome
    this.domeMat = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() },
        uUp: { value: new THREE.Vector3(0, 1, 0) }, uSun: { value: new THREE.Vector3() },
        uSunCol: { value: new THREE.Color() }, uNight: { value: 0 }, uTime: globalUniforms.uTime,
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`,
      fragmentShader: `
        uniform vec3 uTop, uHor, uUp, uSun, uSunCol; uniform float uNight; uniform float uTime; varying vec3 vDir;
        float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
        void main(){
          vec3 d = normalize(vDir);
          float h = dot(d, uUp);
          float t = smoothstep(-0.25, 0.65, h);
          vec3 c = mix(uHor, uTop, t);
          float s = max(dot(d, uSun), 0.0);
          c += uSunCol * (pow(s, 600.0) * 2.5 + pow(s, 12.0) * 0.25) * (1.0 - uNight * 0.6);
          // stars
          vec3 g = floor(d * 220.0);
          float st = step(0.9965, hash(g)) * uNight * smoothstep(-0.1, 0.3, h);
          st *= 0.6 + 0.4 * sin(uTime * 2.0 + hash(g + 3.0) * 30.0);
          c += vec3(st);
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), this.domeMat);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    // sun & moon sprites (simple discs)
    this.sunMesh = new THREE.Mesh(new THREE.CircleGeometry(28, 24), new THREE.MeshBasicMaterial({ color: 0xfff4d0, fog: false, depthWrite: false }));
    this.moonMesh = new THREE.Mesh(new THREE.CircleGeometry(18, 24), new THREE.MeshBasicMaterial({ color: 0xe8eeff, fog: false, depthWrite: false }));
    this.sunMesh.renderOrder = this.moonMesh.renderOrder = -9;
    scene.add(this.sunMesh, this.moonMesh);

    // lights
    this.sun = new THREE.DirectionalLight(0xffffff, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 260;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);
    this.ambient = new THREE.AmbientLight(0xffffff, 1);
    scene.add(this.ambient);

    scene.fog = new THREE.Fog(0xbfe5d8, 90, 260);

    this.buildClouds();
    this.buildRain();
  }

  buildClouds() {
    // all cloud puffs live in one InstancedMesh (cheap: 1 draw call + 1 shadow call)
    const rand = mulberry32(99);
    const mat = toonMaterial({ color: 0xffffff }, { fade: false });
    this.cloudMat = mat;
    const puffs = [];
    const list = [];
    for (let i = 0; i < 70; i++) {
      const n = 3 + Math.floor(rand() * 5);
      const parts = [];
      for (let j = 0; j < n; j++) {
        const sc = 2.2 + rand() * 3.2;
        parts.push({ pos: new THREE.Vector3((j - n / 2) * 3 + rand() * 2, rand() * 1.5, rand() * 3 - 1.5), scale: new THREE.Vector3(sc * 1.25, sc * 0.75, sc) });
      }
      const d = new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize();
      list.push({ dir: d, alt: R + 42 + rand() * 22, spin: rand() * Math.PI * 2, parts, obj: new THREE.Object3D() });
      puffs.push(...parts);
    }
    this.clouds = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), mat, puffs.length);
    this.clouds.castShadow = true;
    this.clouds.frustumCulled = false;
    this.cloudList = list;
    this.cloudAxis = new THREE.Vector3(0.2, 1, 0.1).normalize();
    this.scene.add(this.clouds);
  }

  buildRain() {
    const N = 2200;
    const pos = new Float32Array(N * 3);
    const rand = mulberry32(5);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (rand() - 0.5) * 60; pos[i * 3 + 1] = rand() * 30; pos[i * 3 + 2] = (rand() - 0.5) * 60;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rainMat = new THREE.ShaderMaterial({
      uniforms: { uTime: globalUniforms.uTime, uAmt: { value: 0 }, uSnow: { value: 0 }, uSize: { value: 40 } },
      vertexShader: `
        uniform float uTime; uniform float uAmt; uniform float uSnow; uniform float uSize;
        varying float vA;
        void main(){
          vec3 p = position;
          float sp = mix(26.0, 3.5, uSnow);
          p.y = mod(p.y - uTime * sp, 30.0);
          p.x += sin(uTime * 0.8 + position.z) * uSnow * 1.5;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          vA = step(fract(position.x * 13.7), uAmt);
          gl_PointSize = uSize * mix(0.06, 0.12, uSnow) * (30.0 / -mv.z);
        }`,
      fragmentShader: `
        uniform float uSnow; varying float vA;
        void main(){
          if (vA < 0.5) discard;
          vec2 c = gl_PointCoord - 0.5;
          float a = uSnow > 0.5 ? 1.0 - smoothstep(0.3, 0.5, length(c)) : (1.0 - smoothstep(0.05, 0.12, abs(c.x)));
          if (a < 0.1) discard;
          gl_FragColor = vec4(mix(vec3(0.75,0.85,1.0), vec3(1.0), uSnow), a * 0.8);
        }`,
      transparent: true, depthWrite: false,
    });
    this.rain = new THREE.Points(g, this.rainMat);
    this.rain.frustumCulled = false;
    this.scene.add(this.rain);
  }

  update(dt, ctx) {
    const { up, east, camPos, inSnow } = ctx;
    this.time = (this.time + dt / this.dayLength) % 1;
    const t = this.time;
    const ang = (t - 0.25) * Math.PI * 2; // 0 at sunrise
    // sun travels across the sky in the player's local frame (slightly tilted)
    this.sunDir.copy(east).multiplyScalar(Math.cos(ang)).addScaledVector(up, Math.sin(ang)).normalize();
    const tilt = ctx.north;
    this.sunDir.addScaledVector(tilt, 0.35).normalize();
    const elev = Math.sin(ang);
    this.night = THREE.MathUtils.smoothstep(-elev, -0.05, 0.25);

    keyColor(t, 1, this.skyTop);
    keyColor(t, 2, this.skyHorizon);
    const sunCol = keyColor(t, 3, new THREE.Color());
    let sunI = keyColor(t, 4);
    let amb = keyColor(t, 5);

    // weather
    this.weatherT -= dt;
    if (this.weatherT <= 0) {
      const r = Math.random();
      this.weather = r < 0.55 ? 'clear' : r < 0.8 ? 'cloudy' : 'rain';
      this.weatherT = 70 + Math.random() * 90;
    }
    const targetRain = this.weather === 'rain' ? 1 : 0;
    this.rainAmt += (targetRain - this.rainAmt) * Math.min(1, dt * 0.25);
    const targetCover = this.weather === 'clear' ? 0.25 : this.weather === 'cloudy' ? 0.7 : 1;
    this.cloudCover += (targetCover - this.cloudCover) * Math.min(1, dt * 0.2);
    const gloom = this.rainAmt * 0.45 + Math.max(0, this.cloudCover - 0.3) * 0.15;
    const grey = new THREE.Color(0x8a9aa6);
    this.skyTop.lerp(grey, gloom * (1 - this.night));
    this.skyHorizon.lerp(grey, gloom * 0.8 * (1 - this.night));
    sunI *= 1 - gloom * 0.6;
    globalUniforms.uWind.value = 1 + this.rainAmt * 1.5;

    // light direction: sun by day, moon by night
    const lightDir = elev > -0.08 ? this.sunDir : this.sunDir.clone().negate();
    const target = ctx.target;
    this.sun.position.copy(target).addScaledVector(lightDir, 120);
    this.sun.target.position.copy(target);
    this.sun.color.copy(sunCol);
    this.sun.intensity = sunI;
    this.ambient.color.copy(this.skyHorizon).lerp(new THREE.Color(1, 1, 1), 0.55);
    this.ambient.intensity = amb;

    // dome
    const u = this.domeMat.uniforms;
    u.uTop.value.copy(this.skyTop); u.uHor.value.copy(this.skyHorizon);
    u.uUp.value.copy(up); u.uSun.value.copy(this.sunDir); u.uSunCol.value.copy(sunCol); u.uNight.value = this.night;
    this.dome.position.copy(camPos);

    this.sunMesh.position.copy(camPos).addScaledVector(this.sunDir, 700);
    this.sunMesh.lookAt(camPos);
    this.sunMesh.visible = elev > -0.15;
    this.moonMesh.position.copy(camPos).addScaledVector(this.sunDir, -700);
    this.moonMesh.lookAt(camPos);
    this.moonMesh.visible = elev < 0.15;

    this.fogColor.copy(this.skyHorizon).lerp(this.skyTop, 0.25);
    this.scene.fog.color.copy(this.fogColor);
    this.scene.fog.far = 260 - this.rainAmt * 90;
    this.scene.fog.near = 80 - this.rainAmt * 40;

    // clouds drift around the planet
    const shown = Math.floor(this.cloudList.length * (0.35 + this.cloudCover * 0.65));
    const q = new THREE.Quaternion().setFromAxisAngle(this.cloudAxis, dt * 0.004);
    this.cloudMat.color.setRGB(1, 1, 1).lerp(new THREE.Color(0x9aa4ad), this.rainAmt * 0.6);
    const pm = new THREE.Matrix4(), cm = new THREE.Matrix4(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
    let k = 0;
    for (let i = 0; i < this.cloudList.length; i++) {
      const c = this.cloudList[i];
      c.dir.applyQuaternion(q);
      const o = c.obj;
      o.position.copy(c.dir).multiplyScalar(c.alt);
      o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), c.dir);
      o.rotateY(c.spin);
      o.updateMatrix();
      for (const p of c.parts) {
        if (i < shown) {
          pm.compose(p.pos, new THREE.Quaternion(), p.scale);
          cm.multiplyMatrices(o.matrix, pm);
          this.clouds.setMatrixAt(k++, cm);
        } else this.clouds.setMatrixAt(k++, zero);
      }
    }
    this.clouds.instanceMatrix.needsUpdate = true;

    // rain / snow particles follow the camera in local frame
    const snowing = inSnow ? 1 : 0;
    this.rainMat.uniforms.uSnow.value = snowing;
    this.rainMat.uniforms.uAmt.value = snowing ? Math.max(0.35, this.rainAmt) : this.rainAmt;
    this.rain.visible = this.rainMat.uniforms.uAmt.value > 0.02;
    this.rain.position.copy(camPos).addScaledVector(up, -12);
    this.rain.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
  }
}
