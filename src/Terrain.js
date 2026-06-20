import * as THREE from 'three';
import { HEIGHTMAPS, COLOR_TEXTURE, DEFAULT_MOOD } from './projects.js';

/**
 * Terrain = a heavily subdivided plane whose vertices are pushed up by a
 * BLEND of several heightmap textures (the real site's mechanism: blended
 * displacement maps weighted by alphas, NOT glb morph targets).
 *
 * Morphing between mountains = animating uDispAlpha[i] (done in main.js via GSAP).
 */

const VERT = /* glsl */ `
  uniform sampler2D tDisp0;
  uniform sampler2D tDisp1;
  uniform sampler2D tDisp2;
  uniform sampler2D tDisp3;
  uniform vec4 uDispAlpha;      // weights for the 4 heightmaps (we normalize)
  uniform float uDispScale;
  uniform float uTime;
  uniform float uAnimOn;        // toggle: living micro-displacement
  uniform vec2 uTerrainSize;    // (width, depth) for slope -> normal scaling

  varying float vHeight;
  varying vec2  vUv;
  varying float vViewZ;
  varying vec3  vNormal;        // world-ish surface normal for lighting

  float bh(vec2 uv) {
    float wsum = dot(uDispAlpha, vec4(1.0)) + 1e-4;
    float h = texture2D(tDisp0, uv).r * uDispAlpha.x
            + texture2D(tDisp1, uv).r * uDispAlpha.y
            + texture2D(tDisp2, uv).r * uDispAlpha.z
            + texture2D(tDisp3, uv).r * uDispAlpha.w;
    return h / wsum;
  }

  void main() {
    vUv = uv;
    float h = bh(uv);

    // "living" micro displacement
    float anim = texture2D(tDisp0, uv * 1.7 + vec2(uTime * 0.012, uTime * 0.008)).r;
    h += (anim - 0.5) * 0.035 * uAnimOn;
    vHeight = h;

    // surface normal from the height gradient (finite differences)
    float e = 1.0 / 600.0;
    float hX = bh(uv + vec2(e, 0.0));
    float hY = bh(uv + vec2(0.0, e));
    vNormal = normalize(vec3(
      -(hX - h) * uDispScale / (e * uTerrainSize.x),
      1.0,
      -(hY - h) * uDispScale / (e * uTerrainSize.y)
    ));

    vec3 pos = position;
    pos.z += h * uDispScale;     // plane is in XY, displaced along local +Z (=world up after rotation)

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    vViewZ = -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D tColor;     // kleur4 — used only as subtle light/dark detail, not raw color
  uniform vec3  uColorA;        // shadowed valley
  uniform vec3  uColorB;        // lit ridge
  uniform vec3  uFogColor;      // horizon haze (terrain melts into sky)
  uniform float uFogNear;
  uniform float uFogFar;

  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uGradeOn;   // toggle: mood color grading
  uniform float uLightOn;   // toggle: directional lighting
  uniform float uFogOn;     // toggle: distance haze

  varying float vHeight;
  varying vec2  vUv;
  varying float vViewZ;
  varying vec3  vNormal;

  void main() {
    // atmospheric grade: color comes from height (valley->ridge), NOT from the photo
    float t = smoothstep(0.0, 0.6, vHeight);
    vec3 grade = mix(uColorA, uColorB, t);

    // grade OFF -> neutral grey so you can see the bare geometry
    float detail = dot(texture2D(tColor, vUv).rgb, vec3(0.333));
    vec3 albedo = mix(vec3(0.55), grade, uGradeOn) * (0.7 + detail * 0.3);

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
      uDispAlpha: { value: new THREE.Vector4(1, 0, 0, 0) }, // default = landscape (single massif)
      uDispScale: { value: 108.0 },          // tall but softer single massif
      uTime: { value: 0 },
      uAnimOn: { value: 1 },
      uGradeOn: { value: 1 },
      uLightOn: { value: 1 },
      uFogOn: { value: 1 },
      uColorA: { value: c(DEFAULT_MOOD.a) },
      uColorB: { value: c(DEFAULT_MOOD.b) },
      uFogColor: { value: c(DEFAULT_MOOD.haze) },
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
