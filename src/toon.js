import * as THREE from 'three';
import { REALISTIC } from './settings.js';

// Shared uniforms used by all animated materials
export const globalUniforms = {
  uTime: { value: 0 },
  uWind: { value: 1 },
  uPlayer: { value: new THREE.Vector3() },
  uPlayerView: { value: new THREE.Vector3(0, 0, -10) }, // player chest in view space
  uDay: { value: 1 },
};

/**
 * Screen-door fade for anything between the camera and the player, so trees and
 * houses never hide your character. Chains with any existing onBeforeCompile.
 */
export function addOccluderFade(material) {
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, r) => {
    if (prev) prev.call(material, shader, r);
    shader.uniforms.uPlayerView = globalUniforms.uPlayerView;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uPlayerView;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        {
          vec3 fp = -vViewPosition;
          vec3 P = uPlayerView;
          float t = dot(fp, P) / dot(P, P);
          float dl = length(fp - P * t);
          float k = (1.0 - smoothstep(1.1, 2.4, dl)) * step(0.05, t) * (1.0 - smoothstep(0.78, 0.9, t));
          k = max(k, 1.0 - smoothstep(1.2, 3.0, length(fp)));
          if (k > 0.0) {
            vec2 g = mod(floor(gl_FragCoord.xy), 4.0);
            float b = mod(g.x * 2.0 + g.y * 3.0 + floor(g.y / 2.0) * 5.0, 8.0) / 8.0;
            if (k * 0.85 > b) discard;
          }
        }`);
  };
  material.customProgramCacheKey = () => (prevKey ? prevKey.call(material) : '') + 'fade';
  return material;
}

let gradientMap;
export function getGradientMap() {
  if (gradientMap) return gradientMap;
  // 4-band cel ramp, soft-ish like a painted look
  const data = new Uint8Array([90, 90, 90, 255, 168, 168, 168, 255, 225, 225, 225, 255, 255, 255, 255, 255]);
  gradientMap = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
  gradientMap.minFilter = THREE.NearestFilter;
  gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.generateMipmaps = false;
  gradientMap.needsUpdate = true;
  return gradientMap;
}

/**
 * The game's base material. Realistic mode uses physically based shading;
 * storybook mode uses the original cel ramp.
 */
export function toonMaterial(params = {}, { fade = true } = {}) {
  const m = REALISTIC
    ? new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0, ...params })
    : new THREE.MeshToonMaterial({ gradientMap: getGradientMap(), ...stripPBR(params) });
  if (fade) addOccluderFade(m);
  return m;
}
function stripPBR(p) {
  const { roughness, metalness, envMapIntensity, ...rest } = p;
  return rest;
}

// Materials whose glow follows the night (windows, lamps, mushrooms...)
export const nightGlow = [];
export function setNight(n) {
  globalUniforms.uDay.value = 1 - n;
  for (const g of nightGlow) g.material.emissiveIntensity = g.base + n * g.night;
}

// Shared procedural texture helpers (GLSL). Hashes avoid sin() so they stay stable at world scale.
const TEX_GLSL = /* glsl */ `
  float h13(vec3 p3){ p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
  float vn3(vec3 p){ vec3 i = floor(p); vec3 f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(mix(h13(i), h13(i+vec3(1,0,0)), f.x), mix(h13(i+vec3(0,1,0)), h13(i+vec3(1,1,0)), f.x), f.y),
               mix(mix(h13(i+vec3(0,0,1)), h13(i+vec3(1,0,1)), f.x), mix(h13(i+vec3(0,1,1)), h13(i+vec3(1,1,1)), f.x), f.y), f.z); }
  // cellular noise: x = distance to nearest cell point, y = gap to the second nearest (0 on cell borders), z = cell id
  vec3 vor3(vec3 p){
    vec3 i = floor(p), f = fract(p);
    float d1 = 8.0, d2 = 8.0, id = 0.0;
    for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec3 g = vec3(float(x), float(y), float(z));
      vec3 c = i + g;
      vec3 r = g + vec3(h13(c), h13(c + 17.13), h13(c + 31.71)) - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; id = h13(c + 5.3); } else if (d < d2) d2 = d;
    }
    d1 = sqrt(d1); d2 = sqrt(d2);
    return vec3(d1, d2 - d1, id);
  }
  // bump the (view space) normal by a scalar height field
  vec3 bumpNormal(vec3 nrm, vec3 viewPos, float hgt, float k){
    vec3 dpx = dFdx(-viewPos), dpy = dFdy(-viewPos);
    float dhx = dFdx(hgt), dhy = dFdy(hgt);
    vec3 r1 = cross(dpy, nrm), r2 = cross(nrm, dpx);
    float det = dot(dpx, r1);
    vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
    return normalize(abs(det) * nrm - grad * k);
  }
`;

/**
 * Realistic ground: procedural grass, sand ripples, layered rock, snow, gravel paths and cobbled plazas
 * (blended by the terrain's surfA/surfB vertex weights), plus wet sand, underwater caustics and red absorption.
 */
export function addTerrainShading(material) {
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, r) => {
    if (prev) prev.call(material, shader, r);
    shader.uniforms.uTime = globalUniforms.uTime;
    shader.uniforms.uSeaR = { value: 100 };
    shader.uniforms.uDay = globalUniforms.uDay;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 surfA; attribute vec2 surfB;
        varying vec3 vWorldP; varying vec3 vSurfA; varying vec2 vSurfB;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vSurfA = surfA; vSurfB = surfB;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWorldP; varying vec3 vSurfA; varying vec2 vSurfB; uniform float uTime; uniform float uSeaR; uniform float uDay;
        ${TEX_GLSL}
        float caustic(vec3 p){
          vec2 uv = p.xz * 0.35 + p.y * 0.21;
          float c = 0.0;
          for (int i = 0; i < 3; i++) {
            vec2 q = uv * (1.0 + float(i) * 0.7) + vec2(uTime * (0.3 + float(i) * 0.13), uTime * 0.21);
            c += pow(1.0 - abs(sin((q.x + sin(q.y * 1.7 + uTime)) * 2.1) * cos((q.y + cos(q.x * 1.3 - uTime)) * 2.3)), 6.0);
          }
          return c / 3.0;
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec3 gAlb = vec3(1.0); float gHgt = 0.0; float gGlint = 0.0;
        {
          vec3 p = vWorldP;
          float dist = length(vViewPosition);
          float nearK = 1.0 - smoothstep(18.0, 70.0, dist);   // fine detail only up close
          float sand = vSurfA.x, rock = vSurfA.y, snow = vSurfA.z, path = vSurfB.x, cob = vSurfB.y;
          float grass = max(0.0, 1.0 - sand - rock - snow - path - cob);
          float big = vn3(p * 0.3);
          if (grass > 0.01) {
            // tufts and blades, with sun-dried and lush patches
            float g = vn3(p * vec3(9.0, 4.0, 9.0)) * 0.55 + vn3(p * 23.0) * 0.45;
            float dry = smoothstep(0.55, 0.85, vn3(p * 0.21 + 3.0));
            vec3 a = mix(vec3(0.86, 0.98, 0.84), vec3(1.14, 1.06, 0.78), dry) * mix(1.0, 0.8 + g * 0.4, nearK);
            a *= 0.92 + big * 0.16;
            gAlb += (a - 1.0) * grass; gHgt += g * grass;
          }
          if (sand > 0.01) {
            // wind ripples and grain
            float warp = vn3(p * 0.5) * 4.0;
            float rip = sin(dot(p, vec3(2.4, 0.9, 1.7)) + warp) * 0.5 + 0.5;
            float grain = vn3(p * 31.0);
            vec3 a = vec3(0.94 + rip * 0.08 + (grain - 0.5) * 0.1 * nearK);
            gAlb += (a - 1.0) * sand; gHgt += (rip * 0.7 + grain * 0.3 * nearK) * sand;
            gGlint += step(0.992, h13(floor(p * 38.0))) * sand * nearK;
          }
          if (rock > 0.01) {
            // sediment layers that follow the altitude, broken up by cracks
            float r = length(p);
            float wob = vn3(p * 0.7) * 2.5;
            float strata = sin(r * 4.5 + wob) * 0.5 + 0.5;
            float n = vn3(p * 2.7) * 0.6 + vn3(p * 8.0) * 0.4;
            float crack = smoothstep(0.86, 0.97, 1.0 - abs(vn3(p * 1.1 + 7.0) * 2.0 - 1.0)) * nearK;
            vec3 tint = mix(vec3(1.05, 1.0, 0.94), vec3(0.92, 0.95, 1.02), vn3(p * 0.4 + 11.0));
            vec3 a = tint * (0.8 + strata * 0.14 + n * 0.14) * (1.0 - crack * 0.18);
            gAlb += (a - 1.0) * rock; gHgt += (strata * 0.5 + n * 0.5 - crack * 0.3) * rock;
          }
          if (snow > 0.01) {
            float n = vn3(p * 1.3) * 0.7 + vn3(p * 6.0) * 0.3;
            vec3 a = mix(vec3(0.86, 0.91, 1.0), vec3(1.02), n);
            gAlb += (a - 1.0) * snow; gHgt += n * 0.6 * snow;
            gGlint += step(0.994, h13(floor(p * 45.0) + floor(dot(normalize(vViewPosition), vec3(4.0))))) * snow * nearK;
          }
          if (path > 0.01 && nearK > 0.0) {
            // packed dirt with scattered pebbles
            vec3 v = vor3(p * 4.5);
            float peb = smoothstep(0.02, 0.12, v.y) * step(0.45, v.z) * smoothstep(0.5, 0.2, v.x);
            float dirt = vn3(p * 13.0);
            vec3 pc = mix(vec3(0.86, 0.84, 0.8), vec3(1.1, 1.02, 0.9), fract(v.z * 7.0));
            vec3 a = mix(vec3(0.88 + dirt * 0.2), pc, peb);
            a = mix(vec3(1.0), a, nearK);
            gAlb += (a - 1.0) * path; gHgt += (peb * 0.7 + dirt * 0.3) * path * nearK;
          }
          if (cob > 0.01 && nearK > 0.0) {
            // cobblestones: rounded stones with dark mortar between them
            vec3 v = vor3(p * 2.1);
            float mortar = 1.0 - smoothstep(0.01, 0.07, v.y);
            float dome = smoothstep(0.0, 0.25, v.y);
            float wear = vn3(p * 9.0);
            vec3 st = mix(vec3(0.84, 0.82, 0.8), vec3(1.12, 1.04, 0.92), v.z) * (0.92 + wear * 0.16);
            vec3 a = mix(st, vec3(0.66, 0.62, 0.56), mortar);
            a = mix(vec3(1.0), a, nearK);
            gAlb += (a - 1.0) * cob; gHgt += (dome * 0.8 + wear * 0.2) * cob * nearK;
          }
          gHgt += vn3(p * 1.7) * 0.25;
          float fadeB = 1.0 - smoothstep(12.0, 45.0, dist);
          normal = bumpNormal(normal, vViewPosition, gHgt, 0.55 * fadeB);
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          diffuseColor.rgb *= gAlb;
          float rr = length(vWorldP);
          float under = smoothstep(uSeaR + 0.15, uSeaR - 0.4, rr);
          float depthK = clamp((uSeaR - rr) / 10.0, 0.0, 1.0);
          // wet sand band just above the waterline
          float wet = smoothstep(uSeaR + 0.9, uSeaR + 0.1, rr) * (1.0 - under);
          diffuseColor.rgb *= 1.0 - wet * 0.28;
          // sparkles in sand and snow
          totalEmissiveRadiance += vec3(1.0, 0.97, 0.9) * gGlint * 0.5 * uDay * (1.0 - under);
          // absorb reds with depth, add moving caustics
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.55, 0.85, 0.95), under * (0.4 + depthK * 0.6));
          totalEmissiveRadiance += vec3(0.75, 0.95, 1.0) * caustic(vWorldP) * under * (1.0 - depthK * 0.8) * 0.35;
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor - vSurfA.z * 0.35 - vSurfB.y * 0.12, 0.3, 1.0);`);
  };
  material.customProgramCacheKey = () => (prevKey ? prevKey.call(material) : '') + 'terrain';
  return material;
}

/**
 * Procedural surface detail for props: wood grain, bark ridges, leafy clumps, stone and general weathering.
 * Pattern coordinates are the object's own (scaled) vertex positions, so the texture sticks to moving props.
 */
const DETAIL = {
  wood: `float ring = sin(length(q.xz) * 16.0 + vn3(q * vec3(2.0, 0.25, 2.0)) * 5.0) * 0.5 + 0.5;
         float fib = vn3(q * vec3(18.0, 1.6, 18.0));
         dA = vec3(0.84 + ring * 0.12 + fib * 0.12); dH = fib * 0.6 + ring * 0.4;`,
  bark: `float ang = atan(q.z, q.x);
         float ridge = abs(sin(ang * 7.0 + vn3(q * vec3(1.5, 0.35, 1.5)) * 4.0));
         float n = vn3(q * 6.0);
         dA = vec3(0.72 + ridge * 0.3 + n * 0.12); dH = ridge * 0.8 + n * 0.2;`,
  leaf: `float c = vn3(q * 3.2) * 0.6 + vn3(q * 9.0) * 0.4;
         dA = mix(vec3(0.74, 0.8, 0.78), vec3(1.14, 1.12, 0.92), c); dH = c;`,
  stone: `float n = vn3(q * 2.4) * 0.6 + vn3(q * 8.0) * 0.4;
          float crack = smoothstep(0.9, 0.97, 1.0 - abs(vn3(q * 1.8 + 3.0) * 2.0 - 1.0));
          dA = vec3(0.86 + n * 0.2) * (1.0 - crack * 0.2) * mix(vec3(1.03, 1.0, 0.95), vec3(0.95, 0.98, 1.03), vn3(q * 0.5));
          dH = n - crack * 0.8;`,
  generic: `float n = vn3(q * 3.0) * 0.7 + vn3(q * 9.0) * 0.3;
            dA = vec3(0.96 + n * 0.07); dH = n * 0.25;`,
};
function detailKind(name = '') {
  if (/Bark|Birch/i.test(name)) return 'bark';
  if (/^wood|plank/i.test(name)) return 'wood';
  if (/leaf|leafs|grass|bush|hedge/i.test(name)) return 'leaf';
  if (/stone|rock|dirt|metal/i.test(name)) return 'stone';
  return 'generic';
}
export function addPropDetail(material, kind = 'generic') {
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, r) => {
    if (prev) prev.call(material, shader, r);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDetP;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float dS = length(modelMatrix[0].xyz);
          vec3 off = vec3(0.0);
          #ifdef USE_INSTANCING
            dS *= length(instanceMatrix[0].xyz);
            off = instanceMatrix[3].xyz * 0.37;
          #endif
          vDetP = position * dS + off;
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vDetP;
        ${TEX_GLSL}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec3 dA = vec3(1.0); float dH = 0.0;
        {
          vec3 q = vDetP;
          ${DETAIL[kind]}
          float dist = length(vViewPosition);
          float k = 1.0 - smoothstep(10.0, 40.0, dist);
          dA = mix(vec3(1.0), dA, 0.35 + 0.65 * k);
          // a little grime where things meet the ground
          dA *= mix(0.8, 1.0, smoothstep(0.0, 0.9, q.y));
          normal = bumpNormal(normal, vViewPosition, dH, 0.35 * k);
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        diffuseColor.rgb *= dA;`);
  };
  material.customProgramCacheKey = () => (prevKey ? prevKey.call(material) : '') + 'detail' + kind;
  return material;
}

/** Turn light-blue window pixels of a colormap into a warm emissive map (lit at night). */
const windowMaps = new Map();
function windowEmissive(tex) {
  if (windowMaps.has(tex)) return windowMaps.get(tex);
  const img = tex.image;
  if (!img || !img.width) return null;
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height);
  const px = d.data;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], gg = px[i + 1], b = px[i + 2];
    const win = b > 170 && b > r + 35 && gg > 140 && gg < b + 10;
    px[i] = win ? 255 : 0; px[i + 1] = win ? 196 : 0; px[i + 2] = win ? 112 : 0; px[i + 3] = 255;
  }
  g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = tex.flipY;
  t.magFilter = THREE.NearestFilter;
  windowMaps.set(tex, t);
  return t;
}

const ROUGH = { water: 0.08, stone: 0.92, stoneDark: 0.95, leafsGreen: 0.7, leafsDark: 0.72, leafsFall: 0.7, grass: 0.8 };

/** Adds instance-aware wind sway to a material. strength scales with local vertex height. */
export function addWind(material, strength = 0.05, opts = {}) {
  const pushPlayer = !!opts.push;
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, r) => {
    if (prev) prev.call(material, shader, r);
    shader.uniforms.uTime = globalUniforms.uTime;
    shader.uniforms.uWind = globalUniforms.uWind;
    shader.uniforms.uPlayer = globalUniforms.uPlayer;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime; uniform float uWind; uniform vec3 uPlayer;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 ip = vec3(0.0);
          #ifdef USE_INSTANCING
            ip = instanceMatrix[3].xyz;
          #endif
          float ph = dot(ip, vec3(0.13, 0.21, 0.17));
          float hh = max(position.y, 0.0);
          float k = ${strength.toFixed(4)} * hh * hh * uWind;
          transformed.x += sin(uTime * 1.6 + ph) * k + sin(uTime * 3.7 + ph * 2.0) * k * 0.3;
          transformed.z += cos(uTime * 1.3 + ph * 1.3) * k * 0.7;
        }`
      );
    if (pushPlayer) {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        `
        vec4 mvPosition = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        mvPosition = modelMatrix * mvPosition;
        {
          vec3 toP = mvPosition.xyz - uPlayer;
          float dist = length(toP);
          float infl = (1.0 - smoothstep(0.0, 1.6, dist)) * max(position.y, 0.0);
          vec3 upv = normalize(mvPosition.xyz);
          vec3 side = toP - upv * dot(toP, upv);
          mvPosition.xyz += normalize(side + vec3(1e-4)) * infl * 0.8 - upv * infl * 0.3;
        }
        mvPosition = viewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;
        `
      );
    }
  };
  material.customProgramCacheKey = () => (prevKey ? prevKey.call(material) : '') + `wind${strength}${pushPlayer}`;
  return material;
}

// Kenney's nature kit is very teal; remap it toward a softer, painterly palette.
const PALETTE = {
  leafsDark: 0x4f8f5a, leafsGreen: 0x72b05e, grass: 0x80ba5f, leafsFall: 0xe8a04c, woodBark: 0x9a6b4f,
  woodBarkDark: 0x7f5a46, wood: 0xb07d55, woodDark: 0x8b5e44, dirt: 0xb8875e, dirtDark: 0x9a6f50,
  stone: 0xc4bdb1, stoneDark: 0x9d968c, water: 0x8fd4d8, woodBirch: 0xefe6d6, colorPurple: 0xa78fe0,
  colorRed: 0xe0605a, colorRedDark: 0xb94a48, colorYellow: 0xf6c453, colorTan: 0xe7b98a, corn: 0xf2c66b,
};
const toonCache = new Map();
/** Convert a glTF standard material into a cel-shaded toon material (cached). */
export function toonify(mat, opts = {}) {
  const key = mat.uuid + (opts.wind ? 'w' + opts.wind : '') + (opts.windows ? 'win' : '') + (opts.detail ? 'd' : '');
  if (toonCache.has(key)) return toonCache.get(key);
  const m = toonMaterial({
    color: mat.color ? mat.color.clone() : new THREE.Color(1, 1, 1),
    map: mat.map || null,
    transparent: mat.transparent,
    opacity: mat.opacity,
    side: mat.side,
    alphaTest: mat.alphaTest,
  });
  if (m.map) {
    m.map.colorSpace = THREE.SRGBColorSpace;
    m.map.minFilter = THREE.NearestMipmapLinearFilter;
    m.map.magFilter = THREE.NearestFilter;
  }
  if (PALETTE[mat.name] !== undefined && !m.map) m.color.setHex(PALETTE[mat.name]);
  // Slight pastel lift so things feel soft & sunny
  m.color.lerp(new THREE.Color(1, 1, 1), 0.06);
  if (REALISTIC) {
    m.roughness = ROUGH[mat.name] ?? 0.8;
    if (opts.windows && m.map) {
      const em = windowEmissive(m.map);
      if (em) {
        m.emissiveMap = em;
        m.emissive.setRGB(1, 1, 1);
        nightGlow.push({ material: m, base: 0, night: 2.2 });
      }
    }
  }
  if (opts.wind) addWind(m, opts.wind);
  if (REALISTIC && opts.detail) addPropDetail(m, detailKind(mat.name));
  m.name = mat.name;
  toonCache.set(key, m);
  return m;
}
