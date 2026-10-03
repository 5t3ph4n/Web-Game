import * as THREE from 'three';
import { makeNoise3, fbm3, smoothstep, lerp, clamp } from './noise.js';

export const R = 100; // planet radius (world units ~ metres)
export const SEA = 0; // sea level, as height above R

const noise = makeNoise3(7);
const noiseB = makeNoise3(23);

export function dirFromLatLon(lat, lon, out = new THREE.Vector3()) {
  const la = THREE.MathUtils.degToRad(lat);
  const lo = THREE.MathUtils.degToRad(lon);
  return out.set(Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo));
}

// Named places. `r` = land radius in radians (1 rad = 100 units of walking).
export const REGIONS = [
  { id: 'village', name: 'Pebbleton', sub: 'A sleepy little town', lat: 14, lon: 0, r: 0.55, biome: 'village', flat: { r: 0.2, h: 2.2 } },
  { id: 'lake', name: 'Mirror Lake', sub: 'Still waters, curious fish', lat: 24, lon: -32, r: 0.32, biome: 'meadow', lake: 0.1 },
  { id: 'meadow', name: 'Bloom Meadow', sub: 'Where the bees hum', lat: -18, lon: -38, r: 0.48, biome: 'meadow' },
  { id: 'farm', name: 'Windmill Farm', sub: 'Turnips, cows and a creaky mill', lat: -36, lon: -2, r: 0.36, biome: 'farm', flat: { r: 0.13, h: 2.6 } },
  { id: 'forest', name: 'Whisperwood', sub: 'The trees are talking', lat: 44, lon: -62, r: 0.52, biome: 'forest' },
  { id: 'grove', name: 'Glowcap Grove', sub: 'Mind the bouncy mushrooms', lat: 6, lon: -88, r: 0.34, biome: 'mushroom', flat: { r: 0.07, h: 3.0 } },
  { id: 'mountain', name: 'Mount Hush', sub: 'Silence at the top of the world', lat: 52, lon: 42, r: 0.5, biome: 'mountain', peak: 26 },
  { id: 'harbor', name: 'Gull Harbor', sub: 'Boats, gulls and salty air', lat: 2, lon: 40, r: 0.3, biome: 'village', flat: { r: 0.1, h: 1.6 } },
  { id: 'lighthouse', name: 'Lighthouse Point', sub: 'Keeper of the night', lat: 24, lon: 74, r: 0.22, biome: 'beach' },
  { id: 'desert', name: 'Sunscorch Dunes', sub: 'Hot sand, cool critters', lat: -34, lon: 88, r: 0.5, biome: 'desert' },
  { id: 'oasis', name: 'Palm Oasis', sub: 'A puddle of paradise', lat: -52, lon: 118, r: 0.18, biome: 'desert', lake: 0.05 },
  { id: 'frost', name: 'Frostcap', sub: 'Penguins welcome', lat: -76, lon: 10, r: 0.5, biome: 'snow' },
  { id: 'crater', name: 'Starfall Crater', sub: 'Something fell here long ago', lat: -46, lon: -102, r: 0.3, biome: 'crater', crater: 0.13 },
  { id: 'ruins', name: 'Old Ruins', sub: 'Stones that remember', lat: 70, lon: -150, r: 0.36, biome: 'ruins' },
  { id: 'isle', name: 'Turtle Isle', sub: 'Tiny island, big sunsets', lat: -6, lon: 168, r: 0.13, biome: 'beach' },
  { id: 'reef', name: 'Coral Shallows', sub: 'Fish everywhere', lat: 28, lon: 140, r: 0.0, biome: 'ocean', marker: true },
];
for (const r of REGIONS) r.dir = dirFromLatLon(r.lat, r.lon);
export const regionById = Object.fromEntries(REGIONS.map((r) => [r.id, r]));


const BIOME_COLORS = {
  village: [0x93c06c, 0x86b764],
  meadow: [0xa9d16e, 0x9ccc6a],
  farm: [0xb3cf72, 0xa3c467],
  forest: [0x5f9a5c, 0x548d55],
  mushroom: [0x8fa3d6, 0x7f93cc],
  mountain: [0x82ad6f, 0x76a067],
  beach: [0xb8d47a, 0xa9cd70],
  desert: [0xe9c98d, 0xe0bc7c],
  snow: [0xf2f6fa, 0xe3edf5],
  crater: [0xc19bb8, 0xb08aa8],
  ruins: [0x9fbf78, 0x93b46f],
  ocean: [0x93c06c, 0x93c06c],
};
const C_SAND = new THREE.Color(0xf0dcaa);
const C_ROCK = new THREE.Color(0xa59c92);
const C_ROCK_DARK = new THREE.Color(0x8a8079);
const C_SNOW = new THREE.Color(0xf4f8fb);
const C_SEABED = new THREE.Color(0xd9c99a);
const C_PATH = new THREE.Color(0xd8c39a);

const _tmp = new THREE.Vector3();
const angle = (a, b) => Math.acos(clamp(a.x * b.x + a.y * b.y + a.z * b.z, -1, 1));

// Paths between places (great-circle segments) that get a dirt-road tint & slight flattening.
export const PATHS = [
  ['village', 'harbor'], ['village', 'lake'], ['village', 'farm'], ['lake', 'forest'],
  ['harbor', 'lighthouse'], ['village', 'mountain'], ['farm', 'meadow'], ['meadow', 'grove'],
  ['harbor', 'desert'], ['farm', 'frost'], ['desert', 'oasis'], ['meadow', 'crater'],
  ['forest', 'ruins'],
];
const pathSegs = PATHS.map(([a, b]) => {
  const A = regionById[a].dir, B = regionById[b].dir;
  const n = new THREE.Vector3().crossVectors(A, B).normalize();
  return { A, B, n, len: angle(A, B) };
});

// Returns angular distance (radians) to the nearest path arc, or 1 if none nearby.
function pathDist(d) {
  let best = 1;
  for (const s of pathSegs) {
    const off = Math.abs(d.x * s.n.x + d.y * s.n.y + d.z * s.n.z); // ~ distance to great circle
    if (off > 0.06 || off > best) continue;
    const a1 = angle(d, s.A), a2 = angle(d, s.B);
    if (a1 + a2 > s.len + 0.01) continue;
    best = off;
  }
  if (best < 1) best = Math.abs(best + noiseB(d.x * 9, d.y * 9, d.z * 9) * 0.006);
  return best;
}

/**
 * Sample terrain at unit direction d. Returns height above R (can be negative = sea floor)
 * and fills `info` with biome data when provided.
 */
export function sample(d, info) {
  const x = d.x, y = d.y, z = d.z;
  // continent mask from region cones
  let cone = -1, wsum = 0;
  let mount = 0, flatW = 0, flatH = 0, lake = 0, crater = 0;
  const bw = info ? info.weights : null;
  if (bw) bw.length = 0;
  if (info) info.plaza = 0;
  for (let i = 0; i < REGIONS.length; i++) {
    const r = REGIONS[i];
    const a = angle(d, r.dir);
    if (r.r > 0) {
      const c = 1 - a / r.r;
      if (c > cone) cone = c;
      if (bw && c > -0.4) { const w = smoothstep(-0.4, 0.6, c); bw.push(i, w); wsum += w; }
    }
    if (r.peak) mount += r.peak * Math.exp(-((a / 0.25) ** 2));
    if (r.flat) {
      const w = 1 - smoothstep(r.flat.r * 0.75, r.flat.r * 1.35, a);
      if (w > flatW) { flatW = w; flatH = r.flat.h; }
      if (info && (r.id === 'village' || r.id === 'harbor')) {
        const pz = 1 - smoothstep(r.flat.r * 0.62, r.flat.r * 0.72, a);
        if (pz > (info.plaza || 0)) info.plaza = pz;
      }
    }
    if (r.lake) lake = Math.max(lake, 1 - smoothstep(r.lake * 0.45, r.lake * 1.6, a));
    if (r.crater) {
      crater += 7 * Math.exp(-(((a - r.crater) / 0.035) ** 2)) - 6 * Math.exp(-((a / (r.crater * 0.75)) ** 2));
    }
  }
  const n1 = fbm3(noise, x * 2.2, y * 2.2, z * 2.2, 4);
  let e = cone + n1 * 0.28 - 0.05;
  // paths always walkable: raise sandbars/causeways where they cross the sea
  const pd = pathDist(d);
  const bridge = 1 - smoothstep(0.012, 0.035, pd);
  if (bridge > 0 && e < 0.09) e = lerp(e, 0.09, bridge);

  let h;
  if (e > 0) {
    const hills = fbm3(noise, x * 7 + 3, y * 7, z * 7, 4) * 3.2 * smoothstep(0, 0.35, e);
    h = 0.45 + e * 9 + hills;
    if (h < 0.45 + e * 4) h = 0.45 + e * 4;
  } else {
    h = 0.45 + e * 18;
    if (h < -14) h = -14 + (h + 14) * 0.2;
  }

  // mountains with a ridged touch
  if (mount > 0.01) {
    const rid = 1 - Math.abs(noise(x * 10, y * 10, z * 10));
    h += mount * (0.85 + rid * 0.25);
  }
  // biome specific relief
  let noTerrace = 0;
  {
    const desertW = biomeInfluence(d, 'desert');
    if (desertW > 0) {
      const dune = Math.sin((x * 0.8 + z * 0.6) * 45 + noise(x * 4, y * 4, z * 4) * 3);
      h += (dune * 0.5 + 0.5) * 1.1 * desertW;
      noTerrace = desertW;
    }
  }
  h += crater;

  // gentle terracing gives the cliffy Messenger look
  if (h > 2) {
    const step = 3.2;
    const t = h / step;
    const fl = Math.floor(t), fr = t - fl;
    const terr = (fl + smoothstep(0.62, 0.95, fr)) * step;
    h = lerp(h, terr, 0.5 * (1 - noTerrace));
  }

  if (lake > 0) h = lerp(h, -3.5, lake);
  if (flatW > 0) h = lerp(h, flatH, flatW);

  const pw = 1 - smoothstep(0.006, 0.016, pd);
  if (pw > 0 && flatW < 0.99) h = lerp(h, h * 0.92 + 0.1, pw * 0.5);

  if (info) {
    info.h = h;
    info.e = e;
    info.path = pw;
    info.lake = lake;
    info.wsum = wsum;
    info.mount = mount;
  }
  return h;
}

const biomeCache = {};
function biomeInfluence(d, biome) {
  let list = biomeCache[biome];
  if (!list) list = biomeCache[biome] = REGIONS.filter((r) => r.biome === biome);
  let w = 0;
  for (const r of list) {
    const a = angle(d, r.dir);
    w = Math.max(w, 1 - smoothstep(r.r * 0.35, r.r * 0.95, a));
  }
  return w;
}

export function heightAt(d) { return sample(d); }

/** Returns the region (place) that dominates direction d, or null in open sea. */
export function regionAt(d) {
  let best = null, bestC = -Infinity;
  for (const r of REGIONS) {
    const rr = r.r > 0 ? r.r : 0.12;
    const c = 1 - angle(d, r.dir) / rr;
    if (c > bestC) { bestC = c; best = r; }
  }
  return bestC > 0.05 ? best : null;
}

export function biomeAt(d) {
  const r = regionAt(d);
  return r ? r.biome : 'ocean';
}

const _n = new THREE.Vector3(), _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3();
const _p0 = new THREE.Vector3(), _p1 = new THREE.Vector3(), _p2 = new THREE.Vector3();
/** World-space surface normal at direction d (finite differences). */
export function normalAt(d, out = new THREE.Vector3(), eps = 0.004) {
  tangentBasis(d, _t1, _t2);
  const h0 = sample(d);
  _p0.copy(d).multiplyScalar(R + h0);
  _n.copy(d).addScaledVector(_t1, eps).normalize();
  _p1.copy(_n).multiplyScalar(R + sample(_n));
  _n.copy(d).addScaledVector(_t2, eps).normalize();
  _p2.copy(_n).multiplyScalar(R + sample(_n));
  _p1.sub(_p0); _p2.sub(_p0);
  out.crossVectors(_p1, _p2).normalize();
  if (out.dot(d) < 0) out.negate();
  return out;
}

export function tangentBasis(d, t1, t2) {
  const ref = Math.abs(d.y) < 0.95 ? _tmp.set(0, 1, 0) : _tmp.set(1, 0, 0);
  t1.crossVectors(ref, d).normalize();
  t2.crossVectors(d, t1).normalize();
}

// ---------------------------------------------------------------- terrain mesh
export function buildTerrain(material, res = 150) {
  const faces = [
    [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)],
    [new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)],
    [new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1)],
    [new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)],
    [new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)],
    [new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0)],
  ];
  const group = new THREE.Group();
  const info = { weights: [] };
  const col = new THREE.Color(), tmpC = new THREE.Color(), tmpC2 = new THREE.Color();
  const d = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const seabedHeights = [];

  for (const [N, U, V] of faces) {
    const vcount = (res + 1) * (res + 1);
    const pos = new Float32Array(vcount * 3);
    const nor = new Float32Array(vcount * 3);
    const colr = new Float32Array(vcount * 3);
    let k = 0;
    for (let j = 0; j <= res; j++) {
      for (let i = 0; i <= res; i++) {
        // equal-angle cube mapping for even vertex spacing
        const a = Math.tan(((i / res) * 2 - 1) * Math.PI / 4);
        const b = Math.tan(((j / res) * 2 - 1) * Math.PI / 4);
        d.copy(N).addScaledVector(U, a).addScaledVector(V, b).normalize();
        const h = sample(d, info);
        pos[k * 3] = d.x * (R + h); pos[k * 3 + 1] = d.y * (R + h); pos[k * 3 + 2] = d.z * (R + h);
        normalAt(d, nrm, 0.006);
        nor[k * 3] = nrm.x; nor[k * 3 + 1] = nrm.y; nor[k * 3 + 2] = nrm.z;
        terrainColor(d, h, nrm, info, col, tmpC, tmpC2);
        colr[k * 3] = col.r; colr[k * 3 + 1] = col.g; colr[k * 3 + 2] = col.b;
        k++;
      }
    }
    const idx = new Uint32Array(res * res * 6);
    let q = 0;
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const a = j * (res + 1) + i, b = a + 1, c = a + res + 1, e2 = c + 1;
        idx[q++] = a; idx[q++] = b; idx[q++] = e2;
        idx[q++] = a; idx[q++] = e2; idx[q++] = c;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(colr, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    // ensure outward winding
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, material);
    mesh.receiveShadow = true;
    // the cube-sphere face may be wound inward depending on axes, fix by checking a triangle
    const pa = new THREE.Vector3().fromBufferAttribute(g.attributes.position, idx[0]);
    const pb = new THREE.Vector3().fromBufferAttribute(g.attributes.position, idx[1]);
    const pc = new THREE.Vector3().fromBufferAttribute(g.attributes.position, idx[2]);
    const fn = new THREE.Vector3().crossVectors(pb.clone().sub(pa), pc.clone().sub(pa));
    if (fn.dot(pa) < 0) {
      for (let t = 0; t < idx.length; t += 3) { const s = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = s; }
      g.index.needsUpdate = true;
    }
    group.add(mesh);
  }
  return group;
}

function terrainColor(d, h, nrm, info, out, tmp, tmp2) {
  // biome blend
  out.setRGB(0, 0, 0);
  let tot = 0;
  const vary = noiseB(d.x * 30, d.y * 30, d.z * 30) * 0.5 + 0.5;
  const w = info.weights;
  for (let i = 0; i < w.length; i += 2) {
    const reg = REGIONS[w[i]];
    const pal = BIOME_COLORS[reg.biome];
    tmp.setHex(pal[0]).lerp(tmp2.setHex(pal[1]), vary);
    out.r += tmp.r * w[i + 1]; out.g += tmp.g * w[i + 1]; out.b += tmp.b * w[i + 1];
    tot += w[i + 1];
  }
  if (tot < 0.001) { out.setHex(0x93c06c); tot = 1; } else out.multiplyScalar(1 / tot);

  const slope = nrm.dot(d); // 1 = flat
  // beaches
  const beach = 1 - smoothstep(0.7, 1.6, h);
  if (beach > 0) out.lerp(C_SAND, beach);
  if (h < -0.2) out.lerp(C_SEABED, smoothstep(-0.2, -2, h));
  // paths
  if (info.path > 0 && h > 0.6) out.lerp(C_PATH, info.path * 0.85);
  // town plazas: warm cobbles with a subtle pattern
  if (info.plaza > 0) {
    const cob = noise(d.x * 260, d.y * 260, d.z * 260) > 0.25 ? 0.92 : 1.0;
    out.lerp(tmp.setHex(0xd9cdb6).multiplyScalar(cob), info.plaza);
  }
  // rock on steep slopes
  const rock = 1 - smoothstep(0.72, 0.86, slope);
  if (rock > 0 && h > 0.5) out.lerp(vary > 0.5 ? C_ROCK : C_ROCK_DARK, rock);
  // snow caps on high ground
  const snow = smoothstep(17, 21, h + vary * 3) * smoothstep(0.6, 0.8, slope);
  if (snow > 0) out.lerp(C_SNOW, snow);
  // painterly speckle
  const sp = noise(d.x * 140, d.y * 140, d.z * 140);
  out.multiplyScalar(1 + sp * 0.05);
}

export { angle };

// Flat summit for the mountain temple, at the height of the raw peak.
{
  const m = regionById.mountain;
  m.flat = { r: 0.095, h: sample(m.dir) - 1.0 };
}
