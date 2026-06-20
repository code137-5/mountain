import * as THREE from 'three';

/**
 * Reflective water that READS the terrain height beneath it, so the shoreline
 * follows the mountains (soft foam in the shallows) instead of being a fixed line.
 * Shares the terrain's displacement uniforms, so when the mountains morph, the
 * waterline morphs with them.
 *
 * Techniques (matching the bundle: tShore / flow / dual scrolling normals):
 *  - terrain-depth shoreline + animated foam
 *  - dual scrolling height samples -> ripple normals
 *  - Fresnel sky-haze reflection
 */
const VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D tRipple;
  uniform sampler2D tDisp0, tDisp1, tDisp2, tDisp3;
  uniform vec4 uDispAlphaA, uDispAlphaB;
  uniform float uDispScaleA, uDispScaleB;
  uniform vec2 uDispOffA, uDispOffB;
  uniform float uMorph;
  uniform float uTime;
  uniform vec3 uHorizon, uDeep, uCamPos;
  uniform float uFogNear, uFogFar;
  uniform float uWaterLevel;
  uniform vec2 uTerrainSize;
  uniform float uTerrainBaseY;
  varying vec3 vWorld;

  float ripple(vec2 uv) {
    float a = texture2D(tRipple, uv * 0.012 + uTime * vec2(0.010, 0.007)).r;
    float b = texture2D(tRipple, uv * 0.022 - uTime * vec2(0.008, 0.011)).r;
    return a + b;
  }

  float sampleH(vec2 c, vec4 alpha) {
    float wsum = dot(alpha, vec4(1.0)) + 1e-4;
    return (texture2D(tDisp0, c).r * alpha.x + texture2D(tDisp1, c).r * alpha.y
          + texture2D(tDisp2, c).r * alpha.z + texture2D(tDisp3, c).r * alpha.w) / wsum;
  }
  // terrain world-height directly under a world position (mirrors Terrain.js two-state blend)
  float terrainHeight(vec3 w) {
    vec2 tuv = vec2(w.x / uTerrainSize.x + 0.5, 0.5 - w.z / uTerrainSize.y);
    float inside = step(0.0, tuv.x) * step(tuv.x, 1.0) * step(0.0, tuv.y) * step(tuv.y, 1.0);
    vec2 cc = clamp(tuv, 0.0, 1.0);
    float hA = sampleH(cc + uDispOffA, uDispAlphaA) * uDispScaleA;
    float hB = sampleH(cc + uDispOffB, uDispAlphaB) * uDispScaleB;
    return uTerrainBaseY + mix(hA, hB, uMorph) * inside;
  }

  void main() {
    float terrainY = terrainHeight(vWorld);
    float depth = uWaterLevel - terrainY;       // >0 = underwater
    if (depth < -1.5) discard;                  // clearly dry land -> no water here

    // ripple surface normal (dual scrolling height -> finite-difference normal)
    float e = 1.5;
    float hL = ripple(vWorld.xz - vec2(e, 0.0));
    float hR = ripple(vWorld.xz + vec2(e, 0.0));
    float hD = ripple(vWorld.xz - vec2(0.0, e));
    float hU = ripple(vWorld.xz + vec2(0.0, e));
    vec3 n = normalize(vec3((hL - hR) * 0.5, 0.5, (hD - hU) * 0.5));

    vec3 viewDir = normalize(uCamPos - vWorld);
    float fres = pow(1.0 - clamp(dot(n, viewDir), 0.0, 1.0), 3.0);
    vec3 col = mix(uDeep, uHorizon, clamp(fres + 0.18, 0.0, 1.0));

    // specular glint on ripple crests
    float glint = pow(max(n.y - 0.46, 0.0) * 2.0, 6.0);
    col += uHorizon * glint * 0.7;

    // soft shoreline foam: bright where shallow, broken up + drifting (not a fixed line)
    float shore = smoothstep(0.0, 9.0, depth);          // 0 at edge -> 1 deep
    float foam = (1.0 - shore);
    foam *= 0.45 + 0.55 * ripple(vWorld.xz + uTime * 6.0);
    col = mix(col, uHorizon * 1.2, foam * foam * 0.7);

    // distance haze
    float fog = smoothstep(uFogNear, uFogFar, length(uCamPos - vWorld));
    col = mix(col, uHorizon, fog);

    gl_FragColor = vec4(col, 1.0);
  }
`;

export class Water {
  constructor(terrain, { waterLevel = -14, terrainSize = [800, 1200] } = {}) {
    const U = terrain.uniforms;
    this.uniforms = {
      tRipple: { value: terrain.textures[2] },
      tDisp0: U.tDisp0, tDisp1: U.tDisp1, tDisp2: U.tDisp2, tDisp3: U.tDisp3,
      uDispAlphaA: U.uDispAlphaA, uDispAlphaB: U.uDispAlphaB,  // shared two-state morph
      uDispScaleA: U.uDispScaleA, uDispScaleB: U.uDispScaleB,
      uDispOffA: U.uDispOffA, uDispOffB: U.uDispOffB,
      uMorph: U.uMorph,
      uTime: { value: 0 },
      uHorizon: { value: new THREE.Color('#c2c7c8') },
      uDeep: { value: new THREE.Color('#12171c') },
      uCamPos: { value: new THREE.Vector3() },
      uFogNear: { value: 200 },
      uFogFar: { value: 820 },
      uWaterLevel: { value: waterLevel },
      uTerrainSize: { value: new THREE.Vector2(terrainSize[0], terrainSize[1]) },
      uTerrainBaseY: { value: terrain.mesh.position.y },
    };
    const geo = new THREE.PlaneGeometry(2600, 2600, 1, 1);
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = waterLevel;
  }

  update(t, camPos) {
    this.uniforms.uTime.value = t;
    this.uniforms.uCamPos.value.copy(camPos);
  }
}
