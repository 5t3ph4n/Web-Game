import * as THREE from 'three';
import { REALISTIC } from './settings.js';

// Shared uniforms used by all animated materials
export const globalUniforms = {
  uTime: { value: 0 },
  uWind: { value: 1 },
  uPlayer: { value: new THREE.Vector3() },
  uPlayerView: { value: new THREE.Vector3(0, 0, -10) }, // player chest in view space
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
  for (const g of nightGlow) g.material.emissiveIntensity = g.base + n * g.night;
}

/** Underwater caustics + wet sand darkening for the terrain (realistic mode). */
export function addCaustics(material) {
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, r) => {
    if (prev) prev.call(material, shader, r);
    shader.uniforms.uTime = globalUniforms.uTime;
    shader.uniforms.uSeaR = { value: 100 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldP;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // procedural bump: little lumps, pebbles and tufts so the ground isn't flat plastic
          float hgt = tDetail(vWorldP);
          vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
          float dhx = dFdx(hgt), dhy = dFdy(hgt);
          vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
          float det = dot(dpx, r1);
          vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
          float fadeB = 1.0 - smoothstep(15.0, 45.0, length(vViewPosition));
          normal = normalize(abs(det) * normal - grad * 0.4 * fadeB);
        }`)
      .replace('#include <common>', `#include <common>
        varying vec3 vWorldP; uniform float uTime; uniform float uSeaR;
        float cHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float tHash(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        float tNoise(vec3 p){ vec3 i = floor(p); vec3 f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(mix(tHash(i), tHash(i+vec3(1,0,0)), f.x), mix(tHash(i+vec3(0,1,0)), tHash(i+vec3(1,1,0)), f.x), f.y),
                     mix(mix(tHash(i+vec3(0,0,1)), tHash(i+vec3(1,0,1)), f.x), mix(tHash(i+vec3(0,1,1)), tHash(i+vec3(1,1,1)), f.x), f.y), f.z); }
        float tDetail(vec3 p){ return tNoise(p * 1.7) * 0.5 + tNoise(p * 4.3) * 0.3 + tNoise(p * 11.0) * 0.2; }
        float caustic(vec3 p){
          vec2 uv = p.xz * 0.35 + p.y * 0.21;
          float c = 0.0;
          for (int i = 0; i < 3; i++) {
            vec2 q = uv * (1.0 + float(i) * 0.7) + vec2(uTime * (0.3 + float(i) * 0.13), uTime * 0.21);
            vec2 g = fract(q) - 0.5;
            c += pow(1.0 - abs(sin((q.x + sin(q.y * 1.7 + uTime)) * 2.1) * cos((q.y + cos(q.x * 1.3 - uTime)) * 2.3)), 6.0);
          }
          return c / 3.0;
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          diffuseColor.rgb *= 0.86 + tDetail(vWorldP * 0.35) * 0.28;
          float rr = length(vWorldP);
          float under = smoothstep(uSeaR + 0.15, uSeaR - 0.4, rr);
          float depthK = clamp((uSeaR - rr) / 10.0, 0.0, 1.0);
          // wet sand band just above the waterline
          float wet = smoothstep(uSeaR + 0.9, uSeaR + 0.1, rr) * (1.0 - under);
          diffuseColor.rgb *= 1.0 - wet * 0.28;
          // absorb reds with depth, add moving caustics
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.55, 0.85, 0.95), under * (0.4 + depthK * 0.6));
          totalEmissiveRadiance += vec3(0.75, 0.95, 1.0) * caustic(vWorldP) * under * (1.0 - depthK * 0.8) * 0.35;
        }`);
  };
  material.customProgramCacheKey = () => (prevKey ? prevKey.call(material) : '') + 'caustics';
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
  const key = mat.uuid + (opts.wind ? 'w' + opts.wind : '') + (opts.windows ? 'win' : '');
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
  m.name = mat.name;
  toonCache.set(key, m);
  return m;
}
