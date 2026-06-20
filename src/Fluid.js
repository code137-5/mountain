import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

/**
 * Compact GPU fluid simulation (Navier-Stokes, semi-Lagrangian) adapted from
 * Pavel Dobryakov's "WebGL Fluid Simulation" into three.js render targets.
 *
 * Per frame: splat (mouse) -> curl -> vorticity -> divergence -> pressure(jacobi)
 *            -> gradientSubtract -> advect velocity -> advect dye.
 * Exposes this.dye.texture (visible mist) and this.velocity.texture (for distortion).
 */

const BASE_VERT = /* glsl */ `
  precision highp float;
  attribute vec3 position;
  attribute vec2 uv;
  varying vec2 vUv;
  varying vec2 vL, vR, vT, vB;
  uniform vec2 texelSize;
  void main() {
    vUv = uv;
    vL = vUv - vec2(texelSize.x, 0.0);
    vR = vUv + vec2(texelSize.x, 0.0);
    vT = vUv + vec2(0.0, texelSize.y);
    vB = vUv - vec2(0.0, texelSize.y);
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const f = (frag, uniforms) =>
  new THREE.RawShaderMaterial({
    vertexShader: BASE_VERT,
    fragmentShader: 'precision highp float;\nvarying vec2 vUv;\nvarying vec2 vL, vR, vT, vB;\nuniform vec2 texelSize;\n' + frag,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });

export class Fluid {
  constructor(renderer, { simRes = 256 } = {}) {
    this.renderer = renderer;
    this.quad = new FullScreenQuad();

    this.simRes = simRes;
    this.texel = new THREE.Vector2(1 / simRes, 1 / simRes);

    const make = () =>
      new THREE.WebGLRenderTarget(simRes, simRes, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        depthBuffer: false,
        stencilBuffer: false,
      });

    const dbl = () => ({ read: make(), write: make(), swap() { const t = this.read; this.read = this.write; this.write = t; } });

    this.velocity = dbl();
    this.dye = dbl();
    this.pressure = dbl();
    this.divergence = make();
    this.curl = make();

    const T = { texelSize: { value: this.texel } };

    this.mat = {
      splat: f(`
        uniform sampler2D uTarget;
        uniform float aspectRatio;
        uniform vec3 color;
        uniform vec2 point;
        uniform float radius;
        void main() {
          vec2 p = vUv - point;
          p.x *= aspectRatio;
          vec3 splat = exp(-dot(p, p) / radius) * color;
          vec3 base = texture2D(uTarget, vUv).xyz;
          gl_FragColor = vec4(base + splat, 1.0);
        }
      `, { ...T, uTarget: { value: null }, aspectRatio: { value: 1 }, color: { value: new THREE.Vector3() }, point: { value: new THREE.Vector2() }, radius: { value: 0.0002 } }),

      curl: f(`
        uniform sampler2D uVelocity;
        void main() {
          float L = texture2D(uVelocity, vL).y;
          float R = texture2D(uVelocity, vR).y;
          float T = texture2D(uVelocity, vT).x;
          float B = texture2D(uVelocity, vB).x;
          gl_FragColor = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
        }
      `, { ...T, uVelocity: { value: null } }),

      vorticity: f(`
        uniform sampler2D uVelocity;
        uniform sampler2D uCurl;
        uniform float curl;
        uniform float dt;
        void main() {
          float L = texture2D(uCurl, vL).x;
          float R = texture2D(uCurl, vR).x;
          float T = texture2D(uCurl, vT).x;
          float B = texture2D(uCurl, vB).x;
          float C = texture2D(uCurl, vUv).x;
          vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
          force /= length(force) + 0.0001;
          force *= curl * C;
          force.y *= -1.0;
          vec2 vel = texture2D(uVelocity, vUv).xy;
          vel += force * dt;
          vel = clamp(vel, -1000.0, 1000.0);
          gl_FragColor = vec4(vel, 0.0, 1.0);
        }
      `, { ...T, uVelocity: { value: null }, uCurl: { value: null }, curl: { value: 26 }, dt: { value: 0.016 } }),

      divergence: f(`
        uniform sampler2D uVelocity;
        void main() {
          float L = texture2D(uVelocity, vL).x;
          float R = texture2D(uVelocity, vR).x;
          float T = texture2D(uVelocity, vT).y;
          float B = texture2D(uVelocity, vB).y;
          vec2 C = texture2D(uVelocity, vUv).xy;
          if (vL.x < 0.0) L = -C.x;
          if (vR.x > 1.0) R = -C.x;
          if (vT.y > 1.0) T = -C.y;
          if (vB.y < 0.0) B = -C.y;
          gl_FragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
        }
      `, { ...T, uVelocity: { value: null } }),

      clear: f(`
        uniform sampler2D uTexture;
        uniform float value;
        void main() { gl_FragColor = value * texture2D(uTexture, vUv); }
      `, { ...T, uTexture: { value: null }, value: { value: 0.8 } }),

      pressure: f(`
        uniform sampler2D uPressure;
        uniform sampler2D uDivergence;
        void main() {
          float L = texture2D(uPressure, vL).x;
          float R = texture2D(uPressure, vR).x;
          float T = texture2D(uPressure, vT).x;
          float B = texture2D(uPressure, vB).x;
          float divergence = texture2D(uDivergence, vUv).x;
          gl_FragColor = vec4((L + R + B + T - divergence) * 0.25, 0.0, 0.0, 1.0);
        }
      `, { ...T, uPressure: { value: null }, uDivergence: { value: null } }),

      gradientSubtract: f(`
        uniform sampler2D uPressure;
        uniform sampler2D uVelocity;
        void main() {
          float L = texture2D(uPressure, vL).x;
          float R = texture2D(uPressure, vR).x;
          float T = texture2D(uPressure, vT).x;
          float B = texture2D(uPressure, vB).x;
          vec2 velocity = texture2D(uVelocity, vUv).xy;
          velocity -= vec2(R - L, T - B);
          gl_FragColor = vec4(velocity, 0.0, 1.0);
        }
      `, { ...T, uPressure: { value: null }, uVelocity: { value: null } }),

      advection: f(`
        uniform sampler2D uVelocity;
        uniform sampler2D uSource;
        uniform float dt;
        uniform float dissipation;
        void main() {
          vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
          gl_FragColor = texture2D(uSource, coord) / (1.0 + dissipation * dt);
        }
      `, { ...T, uVelocity: { value: null }, uSource: { value: null }, dt: { value: 0.016 }, dissipation: { value: 0.2 } }),
    };

    this._splatStack = [];
  }

  _blit(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.quad.render(this.renderer);
  }

  // Queue a splat at normalized point (0..1) with a velocity force and dye color.
  splat(x, y, dx, dy, color) {
    this._splatStack.push({ x, y, dx, dy, color });
  }

  _applySplats(aspect) {
    const m = this.mat.splat;
    for (const s of this._splatStack) {
      // velocity splat
      m.uniforms.uTarget.value = this.velocity.read.texture;
      m.uniforms.aspectRatio.value = aspect;
      m.uniforms.point.value.set(s.x, s.y);
      m.uniforms.radius.value = 0.0004;
      m.uniforms.color.value.set(s.dx, s.dy, 0);
      this._blit(m, this.velocity.write);
      this.velocity.swap();

      // dye splat
      m.uniforms.uTarget.value = this.dye.read.texture;
      m.uniforms.color.value.set(s.color.x, s.color.y, s.color.z);
      m.uniforms.radius.value = 0.0015;
      this._blit(m, this.dye.write);
      this.dye.swap();
    }
    this._splatStack.length = 0;
  }

  update(dt, aspect = 1) {
    dt = Math.min(dt, 0.016);

    this._applySplats(aspect);

    // curl
    this.mat.curl.uniforms.uVelocity.value = this.velocity.read.texture;
    this._blit(this.mat.curl, this.curl);

    // vorticity confinement
    this.mat.vorticity.uniforms.uVelocity.value = this.velocity.read.texture;
    this.mat.vorticity.uniforms.uCurl.value = this.curl.texture;
    this.mat.vorticity.uniforms.dt.value = dt;
    this._blit(this.mat.vorticity, this.velocity.write);
    this.velocity.swap();

    // divergence
    this.mat.divergence.uniforms.uVelocity.value = this.velocity.read.texture;
    this._blit(this.mat.divergence, this.divergence);

    // decay pressure
    this.mat.clear.uniforms.uTexture.value = this.pressure.read.texture;
    this.mat.clear.uniforms.value.value = 0.8;
    this._blit(this.mat.clear, this.pressure.write);
    this.pressure.swap();

    // jacobi pressure solve
    this.mat.pressure.uniforms.uDivergence.value = this.divergence.texture;
    for (let i = 0; i < 20; i++) {
      this.mat.pressure.uniforms.uPressure.value = this.pressure.read.texture;
      this._blit(this.mat.pressure, this.pressure.write);
      this.pressure.swap();
    }

    // subtract pressure gradient
    this.mat.gradientSubtract.uniforms.uPressure.value = this.pressure.read.texture;
    this.mat.gradientSubtract.uniforms.uVelocity.value = this.velocity.read.texture;
    this._blit(this.mat.gradientSubtract, this.velocity.write);
    this.velocity.swap();

    // advect velocity
    this.mat.advection.uniforms.dt.value = dt;
    this.mat.advection.uniforms.uVelocity.value = this.velocity.read.texture;
    this.mat.advection.uniforms.uSource.value = this.velocity.read.texture;
    this.mat.advection.uniforms.dissipation.value = 0.2;
    this._blit(this.mat.advection, this.velocity.write);
    this.velocity.swap();

    // advect dye
    this.mat.advection.uniforms.uVelocity.value = this.velocity.read.texture;
    this.mat.advection.uniforms.uSource.value = this.dye.read.texture;
    this.mat.advection.uniforms.dissipation.value = 0.9;
    this._blit(this.mat.advection, this.dye.write);
    this.dye.swap();

    this.renderer.setRenderTarget(null);
  }

  get dyeTexture() { return this.dye.read.texture; }
  get velocityTexture() { return this.velocity.read.texture; }
}
