import * as THREE from 'three';

/**
 * Big inward-facing gradient dome = the hazy sky/atmosphere behind the mountains.
 * The horizon band is the brightest (mimics the god-ray haze of the original);
 * bloom catches it. Colors are driven by the active mood so the sky shifts too.
 */
const VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  varying vec3 vDir;
  void main() {
    float h = clamp(vDir.y * 1.4, -1.0, 1.0);          // -1 ground dir .. +1 up
    float t = smoothstep(-0.15, 0.65, h);              // horizon -> zenith blend
    vec3 col = mix(uHorizon, uZenith, t);
    // gentle brightness near the horizon (hazy glow)
    float glow = exp(-abs(h) * 9.0) * 0.18;
    col += uHorizon * glow;
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class Sky {
  constructor() {
    this.uniforms = {
      uZenith: { value: new THREE.Color('#cdd6c4') },   // pale green-cream sky
      uHorizon: { value: new THREE.Color('#e8e4d2') },  // warm cream horizon
    };
    const geo = new THREE.SphereGeometry(900, 32, 16);
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(geo, mat);
  }
}
