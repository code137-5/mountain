import * as THREE from 'three';
import { HEIGHTMAPS, COLOR_TEXTURE } from './projects.js';

/**
 * Terrain = a heavily subdivided plane whose vertices are pushed up by a
 * BLEND of several heightmap textures (the real site's mechanism: blended
 * displacement maps weighted by alphas, NOT glb morph targets).
 *
 * Morphing between mountains = animating uDispAlpha[i] (done in main.js via GSAP).
 */

const VERT = /* glsl */ `
  uniform sampler2D tDisp0, tDisp1, tDisp2, tDisp3;
  uniform vec4 uDispAlphaA, uDispAlphaB;   // from-state / to-state heightmap weights
  uniform vec2 uDispOffA, uDispOffB;       // from/to heightmap offsets
  uniform float uDispScaleA, uDispScaleB;  // from/to mountain heights
  uniform float uMorph;                    // 0 = from, 1 = to  (cross-fade, no UV scroll)
  uniform float uTime;
  uniform float uAnimOn;
  uniform vec2 uTerrainSize;

  varying float vHeight;
  varying vec2  vUv;
  varying float vViewZ;
  varying vec3  vNormal;

  float bh(vec2 uv, vec4 alpha, vec2 off) {
    vec2 s = uv + off;
    float wsum = dot(alpha, vec4(1.0)) + 1e-4;
    return (texture2D(tDisp0, s).r * alpha.x + texture2D(tDisp1, s).r * alpha.y
          + texture2D(tDisp2, s).r * alpha.z + texture2D(tDisp3, s).r * alpha.w) / wsum;
  }
  // world height = blend of the two FULLY-FORMED terrains -> morphs in place (no sliding)
  float worldH(vec2 uv) {
    return mix(bh(uv, uDispAlphaA, uDispOffA) * uDispScaleA,
               bh(uv, uDispAlphaB, uDispOffB) * uDispScaleB, uMorph);
  }

  void main() {
    vUv = uv;
    float h = worldH(uv);

    // living micro displacement (small absolute amount)
    float anim = texture2D(tDisp0, uv * 1.7 + vec2(uTime * 0.012, uTime * 0.008)).r;
    h += (anim - 0.5) * 3.0 * uAnimOn;

    // normalized height (0-1) for the colour ramp
    vHeight = mix(bh(uv, uDispAlphaA, uDispOffA), bh(uv, uDispAlphaB, uDispOffB), uMorph);

    // normal from the world-height gradient
    float e = 1.0 / 600.0;
    float hX = worldH(uv + vec2(e, 0.0));
    float hY = worldH(uv + vec2(0.0, e));
    vNormal = normalize(vec3(
      -(hX - h) / (e * uTerrainSize.x),
      1.0,
      -(hY - h) / (e * uTerrainSize.y)
    ));

    vec3 pos = position;
    pos.z += h;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    vViewZ = -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D tColor;     // base-grayscale marble — surface detail (grayscale)
  uniform vec3  uColorA;        // mood: shadowed valley (derived from fog colour)
  uniform vec3  uColorB;        // mood: lit ridge
  uniform float uTexScaleA, uTexScaleB;   // from/to surface uv scale
  uniform vec2  uTexOffA, uTexOffB;       // from/to surface uv offset
  uniform float uContrastA, uContrastB;   // from/to grayscale contrast
  uniform float uMorph;
  uniform vec3  uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;

  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uGradeOn;
  uniform float uLightOn;
  uniform float uFogOn;

  varying float vHeight;
  varying vec2  vUv;
  varying float vViewZ;
  varying vec3  vNormal;

  void main() {
    // grayscale marble — cross-faded between the two states (no UV scroll)
    float gA = texture2D(tColor, vUv * uTexScaleA + uTexOffA).r;
    float gB = texture2D(tColor, vUv * uTexScaleB + uTexOffB).r;
    float g = mix(gA, gB, uMorph);
    g = clamp((g - 0.5) * mix(uContrastA, uContrastB, uMorph) + 0.5, 0.0, 1.0);

    // colour from the mood (fog-derived) palette by height, tinted by the grayscale pattern
    float t = smoothstep(0.0, 0.55, vHeight);
    vec3 grade = mix(uColorA, uColorB, t);
    vec3 albedo = mix(vec3(0.5), grade, uGradeOn) * (0.4 + g * 0.75);

    // --- directional lighting gives the rock its 3D relief ---
    vec3 n = normalize(vNormal);
    float diff = clamp(dot(n, normalize(uSunDir)), 0.0, 1.0);
    float skyAmb = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);   // brighter facing up
    vec3 lit = albedo * (0.5 + 0.5 * diff)             // sun (lifted shadows = softer)
             + albedo * skyAmb * 0.3                   // sky ambient
             + uSunColor * pow(diff, 5.0) * 0.18;      // warm sunlit kicker
    vec3 col = mix(albedo, lit, uLightOn);             // lighting OFF -> flat albedo

    // gentle aerial perspective + distance haze (the "fog" group)
    col = mix(col, uFogColor, smoothstep(0.45, 1.0, vHeight) * 0.18 * uFogOn);
    float fog = smoothstep(uFogNear, uFogFar, vViewZ);
    col = mix(col, uFogColor, fog * uFogOn);

    gl_FragColor = vec4(col, 1.0);
  }
`;

export class Terrain {
  constructor(loadingManager) {
    const loader = new THREE.TextureLoader(loadingManager);
    const load = (url) => {
      const t = loader.load(url);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.NoColorSpace; // heightmaps are data, not sRGB
      return t;
    };

    const disp = HEIGHTMAPS.map(load);
    this.textures = disp;   // exposed so Water can reuse one as a ripple source
    const color = loader.load(COLOR_TEXTURE);
    color.wrapS = color.wrapT = THREE.RepeatWrapping;
    color.colorSpace = THREE.SRGBColorSpace;

    const c = (hex) => new THREE.Color(hex);

    this.uniforms = {
      tDisp0: { value: disp[0] },
      tDisp1: { value: disp[1] },
      tDisp2: { value: disp[2] },
      tDisp3: { value: disp[3] },
      tColor: { value: color },
      // two-state morph (from = A, to = B), cross-faded by uMorph
      uDispAlphaA: { value: new THREE.Vector4(1, 0, 0, 0) },
      uDispAlphaB: { value: new THREE.Vector4(1, 0, 0, 0) },
      uDispOffA: { value: new THREE.Vector2(0.2, 0.4) },
      uDispOffB: { value: new THREE.Vector2(0.2, 0.4) },
      uDispScaleA: { value: 108.0 },
      uDispScaleB: { value: 108.0 },
      uMorph: { value: 1 },
      uTime: { value: 0 },
      uAnimOn: { value: 1 },
      uGradeOn: { value: 1 },
      uLightOn: { value: 1 },
      uFogOn: { value: 1 },
      uColorA: { value: c('#2a2f35') },
      uColorB: { value: c('#9aa0a6') },
      uTexScaleA: { value: 1.0 },
      uTexScaleB: { value: 1.0 },
      uTexOffA: { value: new THREE.Vector2(0.2, 0.4) },
      uTexOffB: { value: new THREE.Vector2(0.2, 0.4) },
      uContrastA: { value: 1.3 },
      uContrastB: { value: 1.3 },
      uFogColor: { value: c('#aeb4ba') },
      uFogNear: { value: 560 },               // mountains stay readable; only the deep background hazes
      uFogFar: { value: 1450 },
      uTerrainSize: { value: new THREE.Vector2(800, 1200) },
      uSunDir: { value: new THREE.Vector3(-0.5, 0.45, 0.4).normalize() },
      uSunColor: { value: c('#fff1e0') },
    };

    const geo = new THREE.PlaneGeometry(800, 1200, 320, 460); // wide + DEEP so it recedes to a hazy horizon
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
    });

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.rotation.x = -Math.PI / 2;   // lay flat; local +Z -> world up
    this.mesh.position.y = -18;
  }

  update(t) {
    this.uniforms.uTime.value = t;
  }
}
