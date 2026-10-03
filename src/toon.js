import * as THREE from 'three';

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

export function toonMaterial(params = {}, { fade = true } = {}) {
  const m = new THREE.MeshToonMaterial({ gradientMap: getGradientMap(), ...params });
  if (fade) addOccluderFade(m);
  return m;
}

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
  const key = mat.uuid + (opts.wind ? 'w' + opts.wind : '') + (opts.emissive ? 'e' : '');
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
  if (opts.wind) addWind(m, opts.wind);
  m.name = mat.name;
  toonCache.set(key, m);
  return m;
}
