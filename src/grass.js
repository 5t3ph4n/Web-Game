import * as THREE from 'three';
import { R, sample, normalAt, biomeAt, REGIONS, angle } from './planet.js';
import { globalUniforms, getGradientMap } from './toon.js';
import { mulberry32 } from './noise.js';

const PLAZAS = REGIONS.filter((r) => r.id === 'village' || r.id === 'harbor');
const GRASSY = { village: 1, meadow: 1.3, farm: 1.1, forest: 0.9, mountain: 0.7, ruins: 1, beach: 0.25, mushroom: 0.8 };
const TINT = {
  village: 0x86b85f, meadow: 0x9fcf5d, farm: 0xa9c95c, forest: 0x4f8f4f, mountain: 0x76a663, ruins: 0x8fba67,
  beach: 0xa6c96a, mushroom: 0x7e94d8,
};

/** Tufts of wind-blown grass blades, chunked for culling. */
export function buildGrass(scene, count = 70000) {
  // one tuft = 3 crossed blades
  const blade = new THREE.BufferGeometry();
  const verts = [], cols = [];
  for (let b = 0; b < 3; b++) {
    const a = (b / 3) * Math.PI + 0.3;
    const ca = Math.cos(a) * 0.06, sa = Math.sin(a) * 0.06;
    const ox = (b - 1) * 0.1, oz = ((b * 7) % 3 - 1) * 0.08;
    const hgt = 0.3 + b * 0.07;
    verts.push(ox - ca, 0, oz - sa, ox + ca, 0, oz + sa, ox, hgt, oz);
    cols.push(0, 0, 1);
  }
  blade.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  blade.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(verts.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));

  const mat = new THREE.MeshToonMaterial({ gradientMap: getGradientMap(), side: THREE.DoubleSide, vertexColors: false });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = globalUniforms.uTime;
    shader.uniforms.uWind = globalUniforms.uWind;
    shader.uniforms.uPlayer = globalUniforms.uPlayer;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform float uWind; uniform vec3 uPlayer; varying float vH;`)
      .replace('#include <beginnormal_vertex>', `vec3 objectNormal = vec3(0.0, 1.0, 0.0);`)
      .replace('#include <begin_vertex>', `vec3 transformed = position; vH = position.y;`)
      .replace('#include <project_vertex>', `
        vec4 mvPosition = vec4(transformed, 1.0);
        mvPosition = instanceMatrix * mvPosition;
        vec3 wp = (modelMatrix * mvPosition).xyz;
        vec3 upv = normalize(wp);
        float h = position.y;
        float ph = dot(instanceMatrix[3].xyz, vec3(0.3, 0.2, 0.25));
        vec3 side = normalize(cross(upv, vec3(0.3, 0.9, 0.2)));
        vec3 side2 = cross(upv, side);
        float sway = (sin(uTime * 2.0 + ph) * 0.18 + sin(uTime * 3.3 + ph * 1.7) * 0.07) * uWind;
        wp += (side * sway + side2 * sway * 0.5) * h;
        vec3 toP = wp - uPlayer;
        float dist = length(toP);
        float infl = (1.0 - smoothstep(0.2, 1.4, dist)) * h;
        vec3 flat_ = toP - upv * dot(toP, upv);
        wp += normalize(flat_ + 1e-4) * infl * 0.6 - upv * infl * 0.35;
        mvPosition = viewMatrix * vec4(wp, 1.0);
        gl_Position = projectionMatrix * mvPosition;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vH;`)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `
        vec4 diffuseColor = vec4( diffuse * mix(0.72, 1.18, smoothstep(0.0, 0.7, vH)), opacity );`);
  };
  mat.customProgramCacheKey = () => 'grass';

  // generate tufts
  const rand = mulberry32(1234);
  const chunks = new Map();
  const d = new THREE.Vector3(), n = new THREE.Vector3();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), s = new THREE.Vector3();
  const Y = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  let placed = 0, tries = 0;
  while (placed < count && tries < count * 4) {
    tries++;
    d.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
    const l = d.length(); if (l > 1 || l < 0.1) continue;
    d.divideScalar(l);
    const biome = biomeAt(d);
    const dens = GRASSY[biome] || 0;
    if (rand() > dens) continue;
    const info = { weights: null };
    const h = sample(d, info);
    if (h < 1.0 || h > 19) continue;
    if (info.path > 0.3) continue;
    let plaza = false;
    for (const r of PLAZAS) if (angle(d, r.dir) < r.flat.r * 0.85) plaza = true;
    if (plaza) continue;
    normalAt(d, n);
    if (n.dot(d) < 0.86) continue;
    q.setFromUnitVectors(Y, d);
    q2.setFromAxisAngle(Y, rand() * 6.28);
    q.multiply(q2);
    const sc = 0.8 + rand() * 0.7;
    s.set(sc * 1.3, sc, sc * 1.3);
    m.compose(d.clone().multiplyScalar(R + h - 0.05), q, s);
    // chunk by quantized direction
    const key = `${Math.round(d.x * 4)},${Math.round(d.y * 4)},${Math.round(d.z * 4)}`;
    if (!chunks.has(key)) chunks.set(key, { mats: [], cols: [], center: new THREE.Vector3() });
    const c = chunks.get(key);
    c.mats.push(m.clone());
    col.setHex(TINT[biome] || 0x86b85f).offsetHSL((rand() - 0.5) * 0.04, 0, (rand() - 0.5) * 0.08);
    c.cols.push(col.r, col.g, col.b);
    c.center.add(d);
    placed++;
  }
  const group = new THREE.Group();
  const list = [];
  for (const [, c] of chunks) {
    const im = new THREE.InstancedMesh(blade, mat, c.mats.length);
    c.mats.forEach((mm, i) => im.setMatrixAt(i, mm));
    im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(c.cols), 3);
    im.computeBoundingSphere();
    im.receiveShadow = true;
    im.userData.center = c.center.normalize().multiplyScalar(R);
    group.add(im);
    list.push(im);
  }
  scene.add(group);
  return {
    update(camPos) {
      for (const im of list) im.visible = im.userData.center.distanceToSquared(camPos) < 70 * 70;
    },
  };
}
