import * as THREE from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { settings, q } from './settings.js';

const FS_VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/**
 * Render pipeline:
 *   scene (HDR, MSAA, depth) → SSAO (half res) → composite (AO, ink lines, underwater, fog tint)
 *   → bloom → final (ACES tone mapping, vignette, grain) → screen
 */
export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.qScene = new THREE.Scene();
    this.qScene.add(this.quad);
    this.qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.size = new THREE.Vector2(1, 1);
    this.build();
  }

  build() {
    const Q = q();
    const s = this.renderer.getDrawingBufferSize(this.size);
    if (this.rtScene) { this.rtScene.dispose(); this.rtComp.dispose(); this.rtAO.dispose(); }
    this.depthTex = new THREE.DepthTexture(s.x, s.y);
    this.depthTex.type = THREE.UnsignedIntType;
    this.rtScene = new THREE.WebGLRenderTarget(s.x, s.y, { type: THREE.HalfFloatType, depthTexture: this.depthTex, samples: Q.msaa });
    this.rtComp = new THREE.WebGLRenderTarget(s.x, s.y, { type: THREE.HalfFloatType, depthBuffer: false });
    this.rtAO = new THREE.WebGLRenderTarget(Math.ceil(s.x / 2), Math.ceil(s.y / 2), { type: THREE.UnsignedByteType, depthBuffer: false });

    this.aoMat = new THREE.ShaderMaterial({
      uniforms: {
        tDepth: { value: this.depthTex }, uRes: { value: new THREE.Vector2(s.x / 2, s.y / 2) },
        uProjInv: { value: new THREE.Matrix4() }, uProj: { value: new THREE.Matrix4() },
      },
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDepth; uniform vec2 uRes; uniform mat4 uProjInv; uniform mat4 uProj; varying vec2 vUv;
        vec3 viewPos(vec2 uv){ float d = texture2D(tDepth, uv).x; vec4 p = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return p.xyz / p.w; }
        float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main(){
          float d0 = texture2D(tDepth, vUv).x;
          if (d0 >= 0.99999) { gl_FragColor = vec4(1.0); return; }
          vec3 P = viewPos(vUv);
          vec2 px = 1.0 / uRes;
          vec3 N = normalize(cross(viewPos(vUv + vec2(px.x, 0.0)) - P, viewPos(vUv + vec2(0.0, px.y)) - P));
          float radius = 0.6;
          float occ = 0.0;
          float rnd = hash(gl_FragCoord.xy) * 6.2831;
          const int S = 12;
          for (int i = 0; i < S; i++) {
            float fi = float(i);
            float a = rnd + fi * 2.39996;
            float r = radius * (0.2 + 0.8 * fract(fi * 0.618 + rnd));
            // hemisphere sample around the normal
            vec3 t = normalize(cross(N, vec3(0.3, 1.0, 0.2)));
            vec3 b = cross(N, t);
            vec3 dir = normalize(t * cos(a) + b * sin(a) + N * (0.4 + 0.6 * fract(fi * 0.37 + rnd)));
            vec3 S3 = P + dir * r;
            vec4 cl = uProj * vec4(S3, 1.0);
            vec2 suv = cl.xy / cl.w * 0.5 + 0.5;
            if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;
            float sz = viewPos(suv).z;
            float range = smoothstep(0.0, 1.0, radius / abs(P.z - sz));
            occ += step(S3.z + 0.05, sz) * range;
          }
          float ao = 1.0 - occ / float(S);
          gl_FragColor = vec4(vec3(pow(clamp(ao, 0.0, 1.0), 1.4)), 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });

    this.compMat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.rtScene.texture }, tDepth: { value: this.depthTex }, tAO: { value: this.rtAO.texture },
        uRes: { value: new THREE.Vector2(s.x, s.y) }, uNear: { value: 0.1 }, uFar: { value: 1000 },
        uAO: { value: Q.ao ? 1 : 0 }, uInk: { value: settings.outlines ? 1 : 0 }, uLine: { value: Math.max(1, this.renderer.getPixelRatio()) },
        uUnder: { value: 0 }, uUnderDepth: { value: 0 }, uWaterCol: { value: new THREE.Color(0x1f6f86) }, uTime: { value: 0 },
      },
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor; uniform sampler2D tDepth; uniform sampler2D tAO;
        uniform vec2 uRes; uniform float uNear; uniform float uFar; uniform float uAO; uniform float uInk; uniform float uLine;
        uniform float uUnder; uniform float uUnderDepth; uniform vec3 uWaterCol; uniform float uTime;
        varying vec2 vUv;
        float lin(float d){ float z = d * 2.0 - 1.0; return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear)); }
        float D(vec2 uv){ return lin(texture2D(tDepth, uv).x); }
        void main(){
          vec2 uv = vUv;
          if (uUnder > 0.0) uv += vec2(sin(vUv.y * 40.0 + uTime * 2.0), cos(vUv.x * 30.0 + uTime * 1.7)) * 0.0025 * uUnder;
          vec3 col = texture2D(tColor, uv).rgb;
          float raw = texture2D(tDepth, uv).x;
          float dc = lin(raw);
          if (uAO > 0.5 && raw < 0.99999) {
            // 4-tap blur of the half-res AO
            vec2 p = 1.5 / uRes;
            float ao = (texture2D(tAO, uv + vec2(p.x, p.y)).r + texture2D(tAO, uv - vec2(p.x, p.y)).r +
                        texture2D(tAO, uv + vec2(p.x, -p.y)).r + texture2D(tAO, uv + vec2(-p.x, p.y)).r) * 0.25;
            col *= mix(1.0, ao, (1.0 - smoothstep(30.0, 90.0, dc)) * 0.85);
          }
          if (uInk > 0.5) {
            vec2 px = uLine / uRes;
            float dl = D(uv - vec2(px.x, 0.0)), dr = D(uv + vec2(px.x, 0.0));
            float du = D(uv + vec2(0.0, px.y)), dd = D(uv - vec2(0.0, px.y));
            float sil = max(max(abs(dl - dc), abs(dr - dc)), max(abs(du - dc), abs(dd - dc))) / dc;
            float lap = (abs(dl + dr - 2.0 * dc) + abs(du + dd - 2.0 * dc)) / dc;
            float edge = max(smoothstep(0.035, 0.08, sil), smoothstep(0.012, 0.03, lap) * 0.8);
            edge *= 1.0 - smoothstep(70.0, 190.0, dc);
            col = mix(col, col * vec3(0.25, 0.26, 0.34), edge * 0.85);
          }
          if (uUnder > 0.0) {
            // underwater: heavy absorption & scattering with distance and depth
            float fogK = 1.0 - exp(-dc * (0.07 + uUnderDepth * 0.01));
            vec3 deep = uWaterCol * (1.0 - clamp(uUnderDepth / 14.0, 0.0, 0.7));
            col = mix(col * vec3(0.6, 0.88, 0.95), deep, fogK);
            // light shafts from the surface
            float shaft = pow(max(0.0, sin(vUv.x * 18.0 + sin(vUv.x * 5.0 + uTime * 0.4) * 2.0 + uTime * 0.3)), 8.0) * smoothstep(0.2, 1.0, vUv.y);
            col += vec3(0.55, 0.8, 0.85) * shaft * 0.12 * (1.0 - clamp(uUnderDepth / 10.0, 0.0, 1.0));
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });

    this.finalMat = new THREE.ShaderMaterial({
      uniforms: { tColor: { value: this.rtComp.texture }, uRes: { value: new THREE.Vector2(s.x, s.y) }, uTime: { value: 0 }, uExposure: { value: 1 } },
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor; uniform vec2 uRes; uniform float uTime; uniform float uExposure; varying vec2 vUv;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main(){
          vec3 col = texture2D(tColor, vUv).rgb * uExposure;
          // gentle chromatic fringe at the edges
          vec2 q = vUv - 0.5;
          float e = dot(q, q);
          col.r = mix(col.r, texture2D(tColor, vUv - q * 0.004).r * uExposure, e * 2.0);
          col.b = mix(col.b, texture2D(tColor, vUv + q * 0.004).b * uExposure, e * 2.0);
          col *= 1.0 - e * 0.55;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          gl_FragColor.rgb += (hash(vUv * uRes + fract(uTime) * 91.0) - 0.5) * 0.018;
        }`,
      depthTest: false, depthWrite: false,
    });

    if (this.bloom) this.bloom.dispose();
    this.bloom = Q.bloom ? new UnrealBloomPass(new THREE.Vector2(s.x / 2, s.y / 2), 0.32, 0.55, 0.92) : null;
  }

  setSize() { this.build(); }

  pass(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.qScene, this.qCam);
  }

  render(scene, camera, time, { under = 0, underDepth = 0, exposure = 1, waterColor } = {}) {
    const r = this.renderer;
    const c = this.compMat.uniforms;
    c.uNear.value = camera.near; c.uFar.value = camera.far; c.uTime.value = time;
    c.uUnder.value = under; c.uUnderDepth.value = underDepth;
    if (waterColor) c.uWaterCol.value.copy(waterColor);
    c.uInk.value = settings.outlines ? 1 : 0;
    this.finalMat.uniforms.uTime.value = time;
    this.finalMat.uniforms.uExposure.value = exposure;

    r.setRenderTarget(this.rtScene);
    r.render(scene, camera);
    if (q().ao) {
      this.aoMat.uniforms.uProj.value.copy(camera.projectionMatrix);
      this.aoMat.uniforms.uProjInv.value.copy(camera.projectionMatrixInverse);
      this.pass(this.aoMat, this.rtAO);
    }
    c.uAO.value = q().ao ? 1 : 0;
    this.pass(this.compMat, this.rtComp);
    if (this.bloom) this.bloom.render(r, null, this.rtComp, 0, false);
    this.pass(this.finalMat, null);
  }
}
