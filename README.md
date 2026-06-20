# Glenn Catteeuw — 핵심 기능 복제 (study)

`../ANALYSIS.md` 의 분석을 Three.js로 재구현한 것. 실제 사이트의 디컴파일 분석을 바탕으로
**핵심 메커니즘**을 동일한 원리로 만든 학습용 복제본입니다. (에셋 일부는 실제 사이트 CDN에서 받음)

## 실행
```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/ 로 정적 빌드
```

## 조작
- **프로젝트 글씨에 마우스 오버** → 산이 다른 산으로 모핑 + 분위기 색 전환
- **마우스 이동** → 유체 안개가 커서 따라 휘몰아침 + 카메라 parallax
- **스크롤** → 카메라 dolly(전진)
- **ENTER WITH SOUND** → WebAudio 앰비언트 패드

## 어떤 파일이 무슨 메커니즘인가

| 파일 | 사이트의 무엇을 재현하나 | 핵심 기법 |
|------|------------------------|----------|
| `src/Terrain.js` | 레이어1 — 안개 낀 산 | 세분화 평면을 **여러 높이맵 블렌드**(`uDispAlpha`)로 변위 + colormap 그레이딩 + fog |
| `src/Fluid.js` | 레이어2 — 마우스 반응 안개 | **GPU 유체 sim** (advection/curl/vorticity/divergence/pressure jacobi/gradientSubtract, ping-pong FBO) |
| `src/Post.js` | 합성 + 발광 | 유체 dye를 산 위에 덧칠 + 속도장으로 왜곡 + **UnrealBloomPass** |
| `src/main.js` | 인터랙션 배선 | 호버 → **GSAP**이 `uDispAlpha`/색/fog 동시 트윈, 마우스 → 유체 splat + parallax, **Lenis** 스크롤 |
| `src/ui.js` | 프로젝트 리스트 / 로딩 / Enter | DOM 리스트 + 호버 핸들러 + LoadingManager 진행률 + 사운드 |
| `src/projects.js` | 프로젝트별 분위기 | 높이맵 인덱스 + 색 팔레트(mood) 매핑 |

## 실제 사이트 대비 차이 / 단순화
- **산**: 실제는 높이맵 N장을 알파로 섞음(동일 원리). 여기선 4장(`landscape/terrain003/terrain005/aztec`)을 one-hot 블렌드.
- **유체**: 실제 알고리즘과 동일(Pavel Dobryakov 계열). dye를 velocity와 같은 해상도(256)로 단순화.
- **물 표면(일렁임)**: 실제는 **flow map + 노멀맵 2장 스크롤 + 반사/굴절 + 유체 datamosh**로 별도 물 평면을 둠.
  → 이 복제본에는 **아직 미포함**. 추가하려면 `Water.js` 모듈로 flow-map 물 평면을 얹으면 됨.
- **오디오**: 실제는 Howler + mp3. 여기선 자산 없이 WebAudio 패드로 대체(`ui.js`의 `startAmbient`).

## 에셋 출처
`public/textures/` 의 높이맵·색맵은 실제 사이트 CDN(`assets.basehub.com`)에서 받은 것.
저작권이 신경 쓰이면 절차적 노이즈로 교체 가능(높이맵을 코드 생성 DataTexture로 대체).
