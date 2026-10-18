import * as THREE from 'three';
import { R, sample } from './planet.js';
import { globalUniforms } from './toon.js';
import { REALISTIC } from './settings.js';

// Wave field shared by the shader and gameplay (buoyancy, boats, swimming).
const W = [
  [0.31, 0.17, 0.23, 1.3, 0.16],
  [-0.21, 0.37, 0.11, 1.9, 0.1],
  [0.12, -0.27, 0.41, 2.6, 0.06],
];
const WAVE_GLSL = W.map(([x, y, z, sp, a], i) => `w += sin(dot(p, vec3(${x}, ${y}, ${z})) * ${(1 + i * 0.7).toFixed(2)} + t * ${sp.toFixed(2)}) * ${a.toFixed(3)};`).join('\n');

/** Height of the water surface (relative to sea level) at world point p and time t. */
export function waveHeight(p, t) {
  let w = 0;
  W.forEach(([x, y, z, sp, a], i) => {
    w += Math.sin((p.x * x + p.y * y + p.z * z) * (1 + i * 0.7) + t * sp) * a;
  });
  return w;
}

export function buildWater(sky) {
  const geo = new THREE.SphereGeometry(R, 360, 180);
  const pos = geo.attributes.position;
  const depth = new Float32Array(pos.count);
  const d = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    d.fromBufferAttribute(pos, i).normalize();
    depth[i] = sample(d);
  }
  geo.setAttribute('depth', new THREE.BufferAttribute(depth, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      THREE.UniformsLib.lights,
      {
        uTime: globalUniforms.uTime,
        uShallow: { value: new THREE.Color(REALISTIC ? 0x3fb8b4 : 0x7fd6cf) },
        uDeep: { value: new THREE.Color(REALISTIC ? 0x0c4f6e : 0x2f8fa6) },
        uFoam: { value: new THREE.Color(0xf4fbf8) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunCol: { value: new THREE.Color(1, 1, 1) },
        uNight: { value: 0 },
        uSky: { value: new THREE.Color() },
        uSkyTop: { value: new THREE.Color() },
        uReal: { value: REALISTIC ? 1 : 0 },
      },
    ]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      #include <common>
      #include <shadowmap_pars_vertex>
      attribute float depth;
      uniform float uTime;
      varying float vDepth; varying vec3 vWorld; varying vec3 vNormal2;
      void main(){
        vDepth = depth;
        vec3 n = normalize(position);
        vec3 p = position; float t = uTime; float w = 0.0;
        ${WAVE_GLSL}
        // waves calm down in the shallows
        w *= smoothstep(0.0, -2.5, depth) * 0.85 + 0.15;
        vec3 transformed = position + n * w;
        vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
        vWorld = worldPosition.xyz;
        vNormal2 = n;
        vec3 objectNormal = n;
        vec3 transformedNormal = normalMatrix * objectNormal;
        #include <shadowmap_vertex>
        vec4 mvPosition = viewMatrix * worldPosition;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <packing>
      #include <fog_pars_fragment>
      #include <bsdfs>
      #include <lights_pars_begin>
      #include <shadowmap_pars_fragment>
      #include <shadowmask_pars_fragment>
      uniform float uTime; uniform vec3 uShallow; uniform vec3 uDeep; uniform vec3 uFoam;
      uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uNight; uniform vec3 uSky; uniform vec3 uSkyTop; uniform float uReal;
      varying float vDepth; varying vec3 vWorld; varying vec3 vNormal2;
      float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
      float vnoise(vec3 p){ vec3 i = floor(p); vec3 f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x), mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x), mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z); }
      // ripple normal from layered moving noise (finite differences)
      vec3 rippleNormal(vec3 p, vec3 n){
        vec3 t1 = normalize(cross(n, vec3(0.3, 1.0, 0.2)));
        vec3 t2 = cross(n, t1);
        float e = 0.15;
        float h0 = vnoise(p * 0.9 + uTime * 0.35) + vnoise(p * 2.3 - uTime * 0.6) * 0.5 + vnoise(p * 5.1 + uTime) * 0.2;
        vec3 p1 = p + t1 * e; vec3 p2 = p + t2 * e;
        float h1 = vnoise(p1 * 0.9 + uTime * 0.35) + vnoise(p1 * 2.3 - uTime * 0.6) * 0.5 + vnoise(p1 * 5.1 + uTime) * 0.2;
        float h2 = vnoise(p2 * 0.9 + uTime * 0.35) + vnoise(p2 * 2.3 - uTime * 0.6) * 0.5 + vnoise(p2 * 5.1 + uTime) * 0.2;
        return normalize(n - (t1 * (h1 - h0) + t2 * (h2 - h0)) * 1.6);
      }
      void main(){
        float dep = clamp(-vDepth / 9.0, 0.0, 1.0);
        vec3 V = normalize(cameraPosition - vWorld);
        bool below = dot(V, vNormal2) < 0.0;
        vec3 N = uReal > 0.5 ? rippleNormal(vWorld, vNormal2) : vNormal2;
        if (below) N = -N;
        // body colour: absorption with depth
        vec3 col = mix(uShallow, uDeep, smoothstep(0.0, 1.0, pow(dep, 0.7)));
        float sh = getShadowMask();
        float ndl = dot(vNormal2, uSunDir);
        float day = smoothstep(-0.1, 0.15, ndl);
        col *= mix(0.55, 1.0, day) * mix(0.8, 1.0, sh);
        // shore foam & drifting foam
        float n = vnoise(vWorld * 0.45 + vec3(uTime * 0.2));
        float shore = 1.0 - smoothstep(0.0, 1.4, -vDepth + n * 0.6);
        float ring = step(0.58, fract(-vDepth * 0.9 - uTime * 0.35 + n * 0.5)) * (1.0 - smoothstep(0.3, 2.2, -vDepth));
        float foam = max(step(0.5, shore) * (0.7 + 0.3 * n), ring * 0.65);
        // reflection of the sky (fresnel)
        float fr = pow(1.0 - max(dot(V, N), 0.0), 5.0) * 0.9 + 0.04;
        vec3 Rf = reflect(-V, N);
        float upness = clamp(dot(Rf, normalize(vWorld)), 0.0, 1.0);
        vec3 skyRef = mix(uSky, uSkyTop, pow(upness, 0.6));
        col = mix(col, skyRef, below ? 0.0 : fr);
        // sun glints
        vec3 H = normalize(uSunDir + V);
        float spec = pow(max(dot(N, H), 0.0), uReal > 0.5 ? 420.0 : 220.0);
        col += uSunCol * spec * (uReal > 0.5 ? 6.0 : 0.8) * (1.0 - uNight) * sh * day;
        col = mix(col, uFoam * mix(0.6, 1.0, day), foam * (below ? 0.0 : 1.0));
        col = mix(col, col * vec3(0.35, 0.45, 0.75), uNight * 0.7);
        // transparency: see the sea floor in the shallows
        float alpha = uReal > 0.5 ? clamp(mix(0.42, 0.97, smoothstep(0.0, 6.0, -vDepth)) + fr * 0.5 + foam, 0.0, 1.0) : 1.0;
        if (below) { col = mix(uShallow * 0.9, uSky, 0.25) * (0.5 + day * 0.5); alpha = 0.85; }
        gl_FragColor = vec4(col, alpha);
        #include <fog_fragment>
      }`,
    lights: true,
    fog: true,
    transparent: REALISTIC,
    side: THREE.DoubleSide,
    depthWrite: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  mesh.update = () => {
    mat.uniforms.uSunDir.value.copy(sky.sunDir);
    mat.uniforms.uSunCol.value.copy(sky.sun.color);
    mat.uniforms.uNight.value = sky.night;
    mat.uniforms.uSky.value.copy(sky.skyHorizon);
    mat.uniforms.uSkyTop.value.copy(sky.skyTop);
  };
  return mesh;
}
