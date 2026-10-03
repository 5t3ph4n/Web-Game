import * as THREE from 'three';
import { R, sample } from './planet.js';
import { globalUniforms } from './toon.js';

/** Stylised toon ocean: depth-tinted, animated shore foam and sparkles. */
export function buildWater(sky) {
  const geo = new THREE.SphereGeometry(R, 320, 160);
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
        uShallow: { value: new THREE.Color(0x7fd6cf) },
        uDeep: { value: new THREE.Color(0x2f8fa6) },
        uFoam: { value: new THREE.Color(0xf4fbf8) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uNight: { value: 0 },
        uSky: { value: new THREE.Color() },
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
        float w = sin(dot(position, vec3(0.31,0.17,0.23)) + uTime * 1.3) * 0.08 + sin(dot(position, vec3(-0.21,0.37,0.11)) * 1.7 + uTime * 1.9) * 0.05;
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
      uniform vec3 uSunDir; uniform float uNight; uniform vec3 uSky;
      varying float vDepth; varying vec3 vWorld; varying vec3 vNormal2;
      float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
      float vnoise(vec3 p){ vec3 i = floor(p); vec3 f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x), mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x), mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z); }
      void main(){
        float dep = clamp(-vDepth / 9.0, 0.0, 1.0);
        vec3 col = mix(uShallow, uDeep, smoothstep(0.0, 1.0, dep));
        // banded toon depth
        col = mix(col, uDeep, step(0.55, dep) * 0.25);
        // shore foam rings that pulse toward land
        float n = vnoise(vWorld * 0.45 + vec3(uTime * 0.2));
        float shore = 1.0 - smoothstep(0.0, 1.6, -vDepth + n * 0.6);
        float ring = step(0.55, fract(-vDepth * 0.9 - uTime * 0.35 + n * 0.5)) * (1.0 - smoothstep(0.4, 2.6, -vDepth));
        float foam = max(step(0.45, shore), ring * 0.8);
        // drifting foam streaks in open water
        float streak = step(0.86, vnoise(vWorld * vec3(0.18, 0.5, 0.18) + vec3(uTime * 0.15, 0.0, uTime * 0.1)));
        foam = max(foam, streak * 0.25);
        col = mix(col, uFoam, foam);
        // light
        float sh = getShadowMask();
        vec3 L = uSunDir;
        float ndl = dot(vNormal2, L);
        float lit = mix(0.72, 1.0, smoothstep(-0.05, 0.1, ndl)) * mix(0.75, 1.0, sh);
        col *= lit;
        // sparkles
        vec3 V = normalize(cameraPosition - vWorld);
        vec3 H = normalize(L + V);
        float sp = pow(max(dot(vNormal2 + (vec3(vnoise(vWorld*2.0+uTime), vnoise(vWorld*2.0-uTime), 0.0)-0.5)*0.35, H), 0.0), 220.0);
        col += step(0.5, sp) * (1.0 - uNight) * 0.8;
        // night tint
        col = mix(col, col * vec3(0.35, 0.45, 0.75), uNight * 0.75);
        // fresnel to sky
        float fr = pow(1.0 - max(dot(V, vNormal2), 0.0), 4.0);
        col = mix(col, uSky, fr * 0.35);
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
      }`,
    lights: true,
    fog: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.update = () => {
    mat.uniforms.uSunDir.value.copy(sky.sunDir);
    mat.uniforms.uNight.value = sky.night;
    mat.uniforms.uSky.value.copy(sky.skyHorizon);
  };
  return mesh;
}
