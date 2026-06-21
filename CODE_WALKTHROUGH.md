# 코드 정독 (Code Walkthrough) — 채색화 숲 버전

> `replica/`의 **현재 코드**가 어떻게 동작하는지 파일별·라인별로 설명합니다.
> 이 프로젝트는 "안개 낀 3D 산 복제" → "절차적 채색화 숲"으로 발전했고, 이 문서는 **현재(숲) 상태** 기준입니다.
> 처음이면 10장(GLSL 미니 사전)을 먼저 훑고 오면 셰이더가 잘 읽힙니다.

---

## 0. 큰 그림

### 파일 맵
```
src/
  main.js       ← 진입점: 렌더러·카메라·루프·패널, 모든 모듈 조립 + applyPreset(메뉴 전환)
  Terrain.js    ← 산 (높이맵 변위 + 숲/암석/폭포/조명/안개)   ★ 셰이더의 심장
  Sky.js        ← 하늘 그라데이션 돔
  Water.js      ← 물 (지형 높이 읽어 해안선·반사·잔물결)
  Fluid.js      ← GPU 유체 시뮬 (마우스 안개), 8종 셰이더 ping-pong
  Post.js       ← 후처리: 유체 합성 + 블룸 + 톤매핑
  projects.js   ← 데이터: 11개 프로젝트 프리셋 (원본 bundle.js에서 추출한 실값)
  ui.js         ← 메뉴 리스트 + 클릭 핸들 + 로더
  panel.js      ← 13겹 빌드스택 토글 패널
```

### 데이터 흐름
```
  높이맵·텍스처 ─▶ Terrain(정점 변위 + 표면 셰이더) ─┐
                       Sky · Water ─────────────────┤─▶ RenderPass(텍스처로 렌더)
  마우스 ─▶ Fluid(유체) ─▶ dye/velocity ────────────┘          │
                                                               ▼
                          Composite(유체 덧칠) ▶ Bloom ▶ Tonemap ▶ 화면
  메뉴 클릭 ─▶ applyPreset() ─▶ GSAP이 uniforms를 1.6초 트윈 ─▶ 다음 프레임부터 산·색 변함
```

핵심 통찰: **거의 모든 효과는 "uniform(셰이더에 넘기는 숫자) 하나"로 제어**됩니다. 13겹 패널·메뉴 전환이 전부 uniform 값을 바꾸는 것이고, 셰이더가 매 프레임 그 값으로 다시 그립니다.

---

## 1. 한 프레임에 일어나는 일

`main.js`의 `frame()`이 초당 약 60번:
```
1. fluid.update(dt)      // 유체 물리 1스텝 (Fluid 켜졌을 때)
2. terrain.update(t)     // uTime 갱신 (living motion·폭포 애니용)
3. water.update(t, cam)  // uTime + 카메라 위치 (반사용)
4. controls.update()     // OrbitControls 카메라
5. post.render()         // 씬→텍스처→합성→블룸→톤매핑→화면
```
**메뉴 전환은 루프 밖**에서: 클릭 → `applyPreset()` → GSAP이 uniform을 트윈. 루프는 그저 매 프레임 "현재 uniform 값"으로 그림.

---

## 2. 반드시 알 개념 4가지

### (A) 셰이더 = GPU에서 점/픽셀마다 도는 함수
- **버텍스 셰이더**: 정점(14.8만)마다 1번 — 점의 최종 위치
- **프래그먼트 셰이더**: 픽셀(200만)마다 1번 — 그 픽셀 색
- `varying` = 버텍스→프래그로 값 전달(중간 보간), `uniform` = JS→셰이더 상수

### (B) 텍스처 = "숫자 격자"
- `texture2D(t, uv)` = uv 위치의 RGBA(0~1). 높이맵은 `.r`을 **높이**로 사용.

### (C) plane 회전 규칙
- `PlaneGeometry`는 XY 평면. `mesh.rotation.x = -PI/2`로 눕히면 **로컬 +Z(변위) = 월드 +Y(위)**. 그래서 `pos.z += 높이` → 산이 위로.

### (D) 두 상태 모프 (two-state cross-fade)
- 산 전환 시 **출발 지형(A)·도착 지형(B)을 둘 다 완성**해두고 `uMorph`(0→1)로 높이를 보간.
- 이유: 높이맵 offset을 연속으로 밀면 텍스처가 **옆으로 미끄러져** 보임. 두 완성본을 cross-fade하면 봉우리가 **제자리에서** 솟고 꺼짐.

---

## 3. `main.js`

### 렌더러 / 톤매핑
```js
renderer.toneMapping = THREE.ACESFilmicToneMapping;  // 밝기 1.0 초과를 압축(흰색 폭발 방지)
renderer.toneMappingExposure = 0.95;
```

### 카메라 (원본 실값)
```js
new THREE.PerspectiveCamera(30, aspect, 0.1, 3000);  // fov 30
camera.position.set(0, 65, 200);
camera.lookAt(0, 0, 0);
```

### 모듈 생성
```js
const terrain = new Terrain(manager); scene.add(terrain.mesh);
const sky = new Sky();    scene.add(sky.mesh);
const water = new Water(terrain);  scene.add(water.mesh);  // terrain의 높이 uniform 공유
const fluid = new Fluid(renderer, { simRes: 256 });        // 오프스크린(씬에 안 넣음)
const post = new Post(renderer, scene, camera);
```

### 메뉴 전환 = `applyPreset()` (핵심)
클릭하면 그 프로젝트로 전환. **두 상태 모프** + **분위기 트윈** + **물 높이**:
```js
function applyPreset(p) {
  // 1) 현재 "도착(B)"을 "출발(A)"로 스냅샷
  U.uDispAlphaA.value.copy(U.uDispAlphaB.value);
  U.uDispOffA.value.copy(U.uDispOffB.value);
  U.uDispScaleA.value = U.uDispScaleB.value; ...

  // 2) 새 프리셋을 "도착(B)"으로 (즉시)
  U.uDispAlphaB.value.set(...one-hot p.disp...);
  U.uDispOffB.value.set(p.dispOff[0], p.dispOff[1]);
  U.uDispScaleB.value = p.dispScale * DISP_MULT;   // DISP_MULT=1.6 (우리 스케일로 환산)
  ...

  // 3) uMorph 0→1 트윈 → 제자리 모프
  U.uMorph.value = 0;
  gsap.to(U.uMorph, { value: 1, duration: 1.6, ease: 'power2.inOut' });

  // 4) 분위기: 프로젝트 fog색을 크림/초록과 섞어 하늘·물·안개·배경에 틴트
  const fog = new THREE.Color(p.fog);
  const haze = fog.clone().lerp(new THREE.Color('#e6e3d4'), 0.62);
  tweenColorTo(U.uFogColor.value, haze);
  tweenColorTo(sky.uniforms.uHorizon.value, haze); ...

  // 5) 해수면 = 산 높이의 55% (원본: 봉우리가 물 위 섬처럼)
  const waterY = terrain.mesh.position.y + 0.55 * (p.dispScale * DISP_MULT);
  gsap.to(water.mesh.position, { y: waterY, duration: 1.6 });
  gsap.to(water.uniforms.uWaterLevel, { value: waterY, duration: 1.6 });
}
```

### 메뉴는 **클릭** 선택 (호버 아님)
`ui.js`가 각 `<a>`에 `click` → `onHover(i)` → `applyPreset(PROJECTS[i])`. 다른 메뉴 클릭 전까지 유지.

### 마우스 → 유체 splat
`pointermove`에서 이동량(dx,dy)을 유체에 주입 + 카메라 parallax 목표.

### 빌드스택 패널 (13겹)
```js
new Panel([
  { id:1, label:'Terrain', on:()=>scene.add(terrain.mesh), ... },
  { id:2, label:'Color grade', on:()=>U.uGradeOn.value=1, ... },
  { id:3, label:'Lighting',  ... uLightOn },
  { id:4, label:'Fog / haze',... uFogOn },
  { id:5, label:'Sky',       ... scene.add/remove sky },
  { id:6, label:'Water',     ... scene.add/remove water },
  { id:7, label:'Living motion', ... uAnimOn },
  { id:8, label:'Click morph',   ... state.morph },
  { id:9, label:'Fluid mist', on:()=>{ state.fluid=true; setMist(0.35); post.composite.enabled=true; }, ... }, // 유체+합성 합침
  { id:10, label:'Bloom',    ... post.bloom.enabled },
  { id:11, label:'Tonemap',  ... renderer.toneMapping },
  { id:12, label:'Rock / Waterfall', ... uRockOn },
  { id:13, label:'Forest',   ... uForestOn },
]);
panel.reset();  // 시작은 Terrain만
```

---

## 4. `Terrain.js` — 가장 중요한 파일

### 4.1 버텍스 — 산 모양 + 법선 + 곡률

**두 상태 높이 블렌드** (모프):
```glsl
float bh(vec2 uv, vec4 alpha, vec2 off) {           // 4개 높이맵을 알파로 섞음
  vec2 s = uv + off;
  return (texture2D(tDisp0,s).r*alpha.x + ... ) / wsum;
}
float worldH(vec2 uv) {                              // 두 완성 지형을 uMorph로 섞음
  return mix(bh(uv, uDispAlphaA, uDispOffA) * uDispScaleA,
             bh(uv, uDispAlphaB, uDispOffB) * uDispScaleB, uMorph);
}
```
**main()**:
```glsl
float h = worldH(uv);
// living motion: 흐르는 노이즈를 아주 살짝(±0.4) — 강하면 물 경계가 깜빡임
h += (texture2D(tDisp0, uv*1.7 + uTime*0.01).r - 0.5) * 0.8 * uAnimOn;

vHeight = mix(bh(uv,A,offA), bh(uv,B,offB), uMorph);   // 0~1 정규화 높이(색용)

// 법선 = 이웃 높이차(기울기)
float hX = worldH(uv+오른쪽), hY = worldH(uv+위);
vNormal = normalize(vec3(-(hX-h)/dx, 1.0, -(hY-h)/dy));

// 곡률(Laplacian): 이웃합 - 4*중심 → 양수=오목한 골(폭포용)
vConcavity = (hX + hXn + hY + hYn - 4.0*h);

pos.z += h;   // 위로 변위
```

### 4.2 프래그먼트 — 표면 색 (미스티/숲 + 암석/폭포 + 조명 + 안개)

**A) 미스티 마블 표면** (Forest OFF):
```glsl
float gg = (흑백텍스처 두 상태 블렌드 + contrast);
vec3 marble = mix(vec3(0.5), mix(uColorA, uColorB, t), uGradeOn) * (0.4 + gg*0.75);
```

**B) 절차적 숲** (Forest ON) — Voronoi 나무:
```glsl
vec2 fuv = vUv * 240.0;                  // 칸 밀도
// 9개 이웃 셀 중 가장 가까운 점까지 거리 md, 그 셀 id
for (y=-1..1) for (x=-1..1) { 점=hash2(셀+이웃); md=min(md, 거리²); }
float dab = smoothstep(sz, sz*0.35, sqrt(md));    // 둥근 나무 도장 (랜덤 크기 sz)

// 경사: 절벽엔 나무 제거(암석 자리)
float slope = 1.0 - normalize(vNormal).y;
float steepM = smoothstep(0.40, 0.54, slope);
dab *= 1.0 - steepM * uRockOn;

// 색 = 높이로 초록 그라데이션 + 랜덤 + 드물게 벚꽃/노랑
vec3 baseGreen = mix(진초록, 연두, t);
vec3 forestAlbedo = baseGreen * mix(0.74,1.0,dab) * (0.90+0.2*r2);
if (r3>0.93) forestAlbedo = mix(forestAlbedo, 핑크, dab*0.6);   // 벚꽃
```

**암석 + 폭포** (uRockOn):
```glsl
// 암석: 가파른 곳을 회청색 바위로 (같은 steepM → 나무와 안 겹침)
vec3 rockCol = mix(짙은회청, 밝은회청, rockTex);
vec3 rw = mix(forestAlbedo, rockCol, steepM);

// 폭포: 오목한 골(곡률) + 가파름 + 가는 세로줄기 + 높이대
float valley = smoothstep(0.15, 1.0, vConcavity);
float wf = valley * 세로줄기 * steepM * 높이대 * 흐름 * uRockOn;  // 마스크 보관
forestAlbedo = mix(forestAlbedo, rw, uRockOn);
```

**표면 선택 + 조명 + 폭포 + 안개**:
```glsl
vec3 albedo = mix(marble, forestAlbedo, uForestOn);   // 13번 토글

// 강한 빛/그림자 → 숲을 켜도 3D 형태가 읽힘
float diff = dot(normalize(vNormal), uSunDir);
vec3 lit = albedo*(0.25 + 0.8*diff) + 하늘앰비언트 + 햇빛하이라이트;
vec3 col = mix(albedo, lit, uLightOn);

// 폭포는 조명 뒤에 파란색으로 덧칠(그늘에서도 밝게)
col = mix(col, vec3(0.20,0.55,1.0), wf * uForestOn);

// 대기 원근: 멀수록 (메뉴별) 안개색
col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, vViewZ) * uFogOn);
```

### 4.3 JS (Terrain 클래스)
- 높이맵 4종 로드(`NoColorSpace` — 데이터라 sRGB 변환 금지), 흑백 표면맵 1종
- uniforms: 두 상태 쌍(`uDispAlphaA/B`, `uDispOffA/B`, `uDispScaleA/B`, `uMorph`, `uTexScaleA/B`...) + 토글들(`uForestOn·uRockOn·uGradeOn·uLightOn·uFogOn·uAnimOn`)
- `PlaneGeometry(800, 1200, 320, 460)` ≈ 14.8만 정점, `rotation.x=-PI/2`, `position.y=-18`

---

## 5. `Sky.js`
큰 구(BackSide) 안쪽 그라데이션 — 바라보는 높이로 천정↔지평선 색 섞기 + 지평선 발광. 색은 메뉴마다 크림/초록 틴트로 트윈.

---

## 6. `Water.js`
물 평면. **핵심: 그 아래 지형 높이를 셰이더에서 다시 계산**(Terrain과 같은 두 상태 블렌드)해 해안선을 만듦.
```glsl
float terrainHeight(vec3 w) {                // 물 픽셀 아래 지형 높이
  vec2 tuv = 월드→지형UV;
  float hA = sampleH(tuv+uDispOffA, uDispAlphaA) * uDispScaleA;
  float hB = sampleH(tuv+uDispOffB, uDispAlphaB) * uDispScaleB;
  return baseY + mix(hA, hB, uMorph) * inside;  // 산이 모프하면 해안선도 같이
}
float depth = uWaterLevel - terrainHeight(vWorld);
if (depth < -1.5) discard;                   // 산이 높으면 물 안 그림(땅)
// + 얕을수록 거품, 프레넬 하늘반사, 높이텍스처 2번 스크롤 잔물결
```
- 머티리얼에 **polygonOffset** → 해안선 z-fighting(물·지형 면 충돌 깜빡임) 방지
- `uWaterLevel`과 `mesh.position.y`를 applyPreset에서 동기화 트윈

---

## 7. `Fluid.js` — GPU 유체
8종 풀스크린 셰이더를 텍스처(FBO)에 ping-pong으로 그려 Navier-Stokes를 풂.
```
splat(마우스 주입) → curl → vorticity → divergence → pressure(Jacobi 20회)
→ gradientSubtract → advect velocity → advect dye
```
- 속도장/염료장/압력장은 **두 장씩(read/write) swap** (같은 텍스처 읽으며 못 씀)
- `HalfFloatType` (음수·소수 저장), simRes 256
- 결과 `dyeTexture`(보이는 안개) + `velocityTexture`(왜곡용)을 Post가 가져감

---

## 8. `Post.js` — 후처리
```js
RenderPass(scene, camera)         // ① 씬을 텍스처로
ShaderPass(Composite)             // ② 유체 dye 덧칠 + velocity로 살짝 왜곡
UnrealBloomPass(size,0.15,0.5,0.9)// ③ 밝은 부분 번지게(은은)
OutputPass                        // ④ 톤매핑 + sRGB 출력
```
합성 셰이더: `col = scene(살짝 왜곡) + dye*uMist`. 9번 토글이 유체+합성을 함께 켬.

---

## 9. 나머지 파일

### projects.js — 원본에서 추출한 실프리셋
```js
{ name:'Victorinox', disp:0, dispScale:77.2, dispOff:[.283,.543], fog:'#E8664B', texScale:1.0, texOff:[.283,.489], contrast:2.29 }
// disp=높이맵번호, dispScale=산높이, dispOff=높이맵위치, fog=분위기색
```
- 표면 텍스처 = `base-grayscale.jpg`(흑백 마블). 원본도 컬러 텍스처를 **채도 0**으로 흑백화해 씀 → 색은 fog에서.

### ui.js
- `_buildList()`: 각 메뉴 `<a>`에 **click** → `onHover(i)` (active 표시 + 프리셋 적용). 호버 아님, 유지됨.
- LoadingManager 진행률, 자동 입장(소리 없음).

### panel.js
- main이 넘긴 `[{id,label,on,off}]`로 동작. NEXT(한 겹씩)·RESET(1번만)·ALL.

---

## 10. GLSL 미니 사전

| 함수 | 뜻 |
|------|-----|
| `mix(a,b,t)` | a,b를 t비율로 섞기 |
| `smoothstep(lo,hi,x)` | x를 lo~hi에서 0→1 부드럽게 |
| `clamp(x,lo,hi)` | 범위로 가둠 |
| `dot(a,b)` | 두 벡터 일치도(조명·각도) |
| `normalize(v)` | 길이 1로(방향만) |
| `texture2D(t,uv)` | 텍스처 픽셀값 |
| `fract / floor` | 소수부 / 내림 (셀 격자·해시) |
| `sin / pow / length` | 파동·프레넬·거리 |
| `discard` | 이 픽셀 안 그림 |

---

## 11. 부록: "이 효과 바꾸려면 어디를?"

| 바꾸고 싶은 것 | 위치 |
|----------------|------|
| 나무 밀도 | `Terrain.js` `vUv * 240.0` |
| 나무 색 / 벚꽃 양 | `Terrain.js` `baseGreen`, `r3 > 0.93` |
| 암석 경사 문턱 | `Terrain.js` `smoothstep(0.40, 0.54, slope)` |
| 폭포 양 / 위치 | `Terrain.js` `valley`(0.15), `streak`(0.88) |
| 조명 세기 | `Terrain.js` `0.25 + 0.8*diff` + `uSunDir` |
| 안개 거리 | `Terrain.js` `uFogNear/uFogFar` (560/1450) |
| 해수면 높이 | `main.js` `applyPreset`의 `0.55` |
| 카메라 | `main.js` `camera.position` / `fov 30` |
| 모프 속도 | `main.js` `uMorph` 트윈 `duration: 1.6` |
| 무드 색 | `projects.js` 각 프리셋 `fog` |
| 블룸 세기 | `Post.js` `UnrealBloomPass(..., 0.15, ...)` |
