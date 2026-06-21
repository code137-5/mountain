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
  varying float vConcavity;   // >0 = concave gully (valley), <0 = ridge

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

    // living micro displacement (very subtle — strong values cause waterline z-fighting)
    float anim = texture2D(tDisp0, uv * 1.7 + vec2(uTime * 0.012, uTime * 0.008)).r;
    h += (anim - 0.5) * 0.8 * uAnimOn;

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

    // concavity (Laplacian): positive in gullies/valleys, negative on ridges
    float hXn = worldH(uv - vec2(e, 0.0));
    float hYn = worldH(uv - vec2(0.0, e));
    vConcavity = (hX + hXn + hY + hYn - 4.0 * h);

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
  uniform float uForestOn;  // 0 = marble/misty surface, 1 = forest
  uniform float uRockOn;    // rock + waterfall overlay
  uniform float uTime;

  varying float vHeight;
  varying vec2  vUv;
  varying float vViewZ;
  varying vec3  vNormal;
  varying float vConcavity;

  float hash1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  vec2 hash2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }

  void main() {
    float t = smoothstep(0.0, 0.55, vHeight);   // valley -> ridge
    float wf = 0.0;                              // waterfall mask (applied after lighting)

    // === A) marble / misty surface (Forest OFF) ===
    float gA = texture2D(tColor, vUv * uTexScaleA + uTexOffA).r;
    float gB = texture2D(tColor, vUv * uTexScaleB + uTexOffB).r;
    float gg = clamp((mix(gA, gB, uMorph) - 0.5) * mix(uContrastA, uContrastB, uMorph) + 0.5, 0.0, 1.0);
    vec3 marble = mix(vec3(0.5), mix(uColorA, uColorB, t), uGradeOn) * (0.4 + gg * 0.75);

    // === B) procedural forest (Forest ON): voronoi tree-dabs ===
    vec2 fuv = vUv * 240.0;                  // denser, smaller trees
    vec2 cellId = floor(fuv);
    vec2 fp = fract(fuv);
    float md = 8.0; vec2 nearId = cellId;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 gv = vec2(float(x), float(y));
        vec2 r = gv + hash2(cellId + gv) - fp;
        float d = dot(r, r);
        if (d < md) { md = d; nearId = cellId + gv; }
      }
    }
    float r1 = hash1(nearId);
    float r2 = hash1(nearId + 41.7);
    float r3 = hash1(nearId + 113.1);

    float sz = 0.30 + 0.42 * r3;
    float dab = smoothstep(sz, sz * 0.35, sqrt(md));   // soft tree edge (low contrast)

    // slope: trees AVOID steep cliffs so rock/waterfall sit cleanly (when rock layer is on)
    vec3 nrm = normalize(vNormal);
    float slope = 1.0 - clamp(nrm.y, 0.0, 1.0);        // 0 flat .. 1 vertical
    float steepM = smoothstep(0.40, 0.54, slope);      // crisp cliff mask (shared with rock)
    dab *= 1.0 - steepM * uRockOn;                     // remove trees where rock shows

    // cohesive green that FOLLOWS THE FORM (height); trees add only gentle texture
    // so the lighting/relief stays the dominant cue -> still reads as a 3D mountain
    vec3 baseGreen = mix(vec3(0.06, 0.18, 0.09), vec3(0.30, 0.48, 0.17), t);
    float treeShade = mix(0.74, 1.0, dab);             // gaps a touch darker (not black)
    float treeVar = 0.90 + 0.2 * r2;                   // subtle per-tree brightness
    vec3 forestAlbedo = baseGreen * treeShade * treeVar;
    forestAlbedo = mix(forestAlbedo, forestAlbedo * vec3(1.15, 1.05, 0.7), r2 * 0.18); // gentle warm var
    // sparse accents only on tree centres
    if (r3 > 0.93)      forestAlbedo = mix(forestAlbedo, vec3(0.82, 0.54, 0.66), dab * 0.6);  // 벚꽃 pink
    else if (r3 > 0.86) forestAlbedo = mix(forestAlbedo, vec3(0.62, 0.68, 0.28), dab * 0.45); // yellow-green

    // --- ROCK (cliffs) + WATERFALL — gated by uRockOn (toggle 13) ---
    // rock fully REPLACES on cliffs (uses the same steepM) so no tree-voronoi bleeds through
    float rockTex = mix(gg, hash1(floor(vUv * 220.0)), 0.5);    // marble + speckle detail
    vec3 rockCol = mix(vec3(0.26, 0.29, 0.34), vec3(0.52, 0.54, 0.57), rockTex);
    vec3 rw = mix(forestAlbedo, rockCol, steepM);

    // waterfall mask: ONLY in concave gullies (valleys between peaks), thin + few
    float valley = smoothstep(0.15, 1.0, vConcavity);            // concave channel only
    float band   = smoothstep(0.02, 0.15, vHeight) * smoothstep(0.95, 0.40, vHeight);
    float seed   = hash1(vec2(floor(vUv.x * 80.0), 0.0));
    float streak = smoothstep(0.88, 0.97, seed);                 // few, thin columns
    float fall   = 0.5 + 0.5 * sin(vHeight * 80.0 - uTime * 9.0 + seed * 6.28);
    wf = valley * streak * steepM * band * (0.4 + 0.6 * fall) * uRockOn;

    forestAlbedo = mix(forestAlbedo, rw, uRockOn);             // toggle 13
    forestAlbedo = mix(vec3(0.5), forestAlbedo, uGradeOn);

    // choose surface by the Forest toggle (layer 13)
    vec3 albedo = mix(marble, forestAlbedo, uForestOn);

    // --- directional lighting gives the rock its 3D relief ---
    vec3 n = normalize(vNormal);
    float diff = clamp(dot(n, normalize(uSunDir)), 0.0, 1.0);
    float skyAmb = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
    // STRONG light/shadow so the 3D mountain form reads through the forest
    vec3 lit = albedo * (0.25 + 0.8 * diff)
             + albedo * skyAmb * 0.12
             + uSunColor * pow(diff, 4.0) * 0.12;
    vec3 col = mix(albedo, lit, uLightOn);

    // bright VIVID-BLUE waterfalls, drawn after lighting so cliff shadow doesn't bury them
    col = mix(col, vec3(0.20, 0.55, 1.0), clamp(wf * uForestOn, 0.0, 1.0));

    // aerial perspective: distant terrain fades into the (per-menu) haze colour
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
      uForestOn: { value: 1 },   // forest surface on by default
      uRockOn: { value: 1 },     // rock + waterfall overlay

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
