import * as THREE from 'three';

/**
 * Ink-outline post pass: renders the scene once (color + depth), then draws
 * hand-drawn style outlines from depth discontinuities, creases and color edges.
 */
export class InkPass {
  constructor(renderer) {
    this.renderer = renderer;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.depthTex = new THREE.DepthTexture(size.x, size.y);
    this.depthTex.type = THREE.UnsignedIntType;
    this.rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      depthTexture: this.depthTex,
      samples: 0,
      type: THREE.HalfFloatType,
    });
    this.rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.rt.texture },
        tDepth: { value: this.depthTex },
        uRes: { value: new THREE.Vector2(size.x, size.y) },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
        uLine: { value: Math.max(1, renderer.getPixelRatio()) },
        uInk: { value: new THREE.Color(0x2b2d42) },
        uTime: { value: 0 },
        uNight: { value: 0 },
        uStrength: { value: 1 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor; uniform sampler2D tDepth;
        uniform vec2 uRes; uniform float uNear; uniform float uFar; uniform float uLine;
        uniform vec3 uInk; uniform float uTime; uniform float uNight; uniform float uStrength;
        varying vec2 vUv;
        float lin(float d){ float z = d * 2.0 - 1.0; return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear)); }
        float D(vec2 uv){ return lin(texture2D(tDepth, uv).x); }
        float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
        float luma(vec3 c){ return dot(c, vec3(0.299,0.587,0.114)); }
        void main(){
          // wobble the sample position slightly so lines feel hand-drawn
          vec2 px = uLine / uRes;
          vec2 wob = (vec2(hash(floor(vUv*uRes/3.0)+floor(uTime*4.0)), hash(floor(vUv*uRes/3.0)+7.0+floor(uTime*4.0))) - 0.5) * px * 0.6;
          vec2 uv = vUv + wob;
          vec3 col = texture2D(tColor, vUv).rgb;
          float raw = texture2D(tDepth, uv).x;
          float dc = lin(raw);
          float dl = D(uv - vec2(px.x,0.0)), dr = D(uv + vec2(px.x,0.0));
          float du = D(uv + vec2(0.0,px.y)), dd = D(uv - vec2(0.0,px.y));
          // silhouette: neighbour much farther/closer relative to depth
          float sil = max(max(abs(dl-dc), abs(dr-dc)), max(abs(du-dc), abs(dd-dc))) / dc;
          float e1 = smoothstep(0.035, 0.08, sil);
          // creases: second derivative of depth
          float lap = (abs(dl + dr - 2.0*dc) + abs(du + dd - 2.0*dc)) / dc;
          float e2 = smoothstep(0.012, 0.03, lap) * 0.8;
          // colour edges (cheap & painterly)
          vec3 cl = texture2D(tColor, uv - vec2(px.x,0.0)).rgb, cr = texture2D(tColor, uv + vec2(px.x,0.0)).rgb;
          vec3 cu = texture2D(tColor, uv + vec2(0.0,px.y)).rgb, cd = texture2D(tColor, uv - vec2(0.0,px.y)).rgb;
          float ce = abs(luma(cl)-luma(cr)) + abs(luma(cu)-luma(cd));
          float e3 = smoothstep(0.16, 0.34, ce) * 0.55;
          float edge = max(e1, max(e2, e3));
          // fade lines with distance so the horizon stays airy
          edge *= 1.0 - smoothstep(70.0, 190.0, dc);
          if (raw >= 0.99999) edge *= step(0.9999, 1.0) * e1; // sky: only true silhouettes
          edge *= uStrength;
          vec3 ink = mix(col * vec3(0.32,0.33,0.42), uInk, 0.35);
          ink = mix(ink, col * 0.55, uNight * 0.5);
          col = mix(col, ink, clamp(edge, 0.0, 1.0));
          // paper grain + soft vignette
          float g = hash(vUv * uRes + fract(uTime) * 100.0) - 0.5;
          col += g * 0.025;
          vec2 q = vUv - 0.5;
          col *= 1.0 - dot(q, q) * 0.45;
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  setSize(w, h) {
    this.rt.setSize(w, h);
    this.material.uniforms.uRes.value.set(w, h);
    this.material.uniforms.uLine.value = Math.max(1, this.renderer.getPixelRatio());
  }
  render(scene, camera, time) {
    const u = this.material.uniforms;
    u.uNear.value = camera.near; u.uFar.value = camera.far; u.uTime.value = time;
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.cam);
  }
}
