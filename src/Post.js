import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * Composite the 3D mountain render (tDiffuse) with the fluid layer:
 *  - distort the scene UVs slightly by the fluid velocity (the "datamosh" warp)
 *  - add the fluid dye as a glowing mist
 * then push the whole thing through bloom.
 */
const CompositeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uDye: { value: null },
    uVelocity: { value: null },
    uDistort: { value: 0.0018 },
    uMist: { value: 0.35 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D uDye;
    uniform sampler2D uVelocity;
    uniform float uDistort;
    uniform float uMist;
    varying vec2 vUv;
    void main() {
      vec2 vel = texture2D(uVelocity, vUv).xy;
      vec2 uv = vUv + vel * uDistort;          // fluid warps the mountains
      vec3 scene = texture2D(tDiffuse, uv).rgb;
      vec3 dye = texture2D(uDye, vUv).rgb;
      vec3 col = scene + dye * uMist;          // additive glowing mist
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class Post {
  constructor(renderer, scene, camera) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    this.composite = new ShaderPass(CompositeShader);
    this.composer.addPass(this.composite);

    const size = renderer.getSize(new THREE.Vector2());
    this.bloom = new UnrealBloomPass(size, 0.15, 0.5, 0.9); // subtle — don't wash out the forest
    this.composer.addPass(this.bloom);

    this.composer.addPass(new OutputPass());
  }

  setFluid(dyeTex, velTex) {
    this.composite.uniforms.uDye.value = dyeTex;
    this.composite.uniforms.uVelocity.value = velTex;
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
  }

  render() {
    this.composer.render();
  }
}
