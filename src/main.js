import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { gsap } from 'gsap';
import Lenis from 'lenis';

import { Terrain } from './Terrain.js';
import { Sky } from './Sky.js';
import { Water } from './Water.js';
import { Fluid } from './Fluid.js';
import { Post } from './Post.js';
import { UI } from './ui.js';
import { Panel } from './panel.js';
import { PROJECTS, DEFAULT } from './projects.js';

// runtime toggles driven by the build-stack panel
const state = { morph: true, fluid: true };

// ---------- renderer / scene / camera ----------
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
// tone mapping compresses bright values so bloom/fog don't blow out to pure white
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#e8e4d2');

// REAL bundle values: fov 30, position (0, 65, 200), lookAt (0, 0, 0).
const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 3000);
camera.position.set(0, 65, 200);
const camTarget = new THREE.Vector3(0, 0, 0);
camera.lookAt(camTarget);

// ---------- OrbitControls: drag to inspect / find a good angle ----------
// Set CONTROLS = false to switch back to the scripted parallax+scroll camera.
const CONTROLS = true;
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.target.copy(camTarget);
controls.maxDistance = 600;
controls.update();
// log camera state when you stop dragging, so we can bake a nice default
controls.addEventListener('end', () => {
  const p = camera.position, t = controls.target;
  console.log(
    `camera.position.set(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)});  ` +
    `target (${t.x.toFixed(1)}, ${t.y.toFixed(1)}, ${t.z.toFixed(1)})`
  );
});

// ---------- assets via a loading manager ----------
const manager = new THREE.LoadingManager();
const terrain = new Terrain(manager);
scene.add(terrain.mesh);

const sky = new Sky();
scene.add(sky.mesh);

const water = new Water(terrain);
scene.add(water.mesh);

const fluid = new Fluid(renderer, { simRes: 256 });
const post = new Post(renderer, scene, camera);

// ---------- UI ----------
const ui = new UI({
  onHover: (i) => { if (state.morph) applyPreset(PROJECTS[i]); },
  onLeave: () => { if (state.morph) applyPreset(DEFAULT); },
  onEnter: () => { started = true; },
});

manager.onProgress = (_url, loaded, total) => ui.setProgress(loaded / total);
manager.onLoad = () => ui.ready();

// ---------- hover -> apply the project's REAL scene preset (extracted from the original) ----------
const U = terrain.uniforms;
const DISP_MULT = 1.6;  // their dispScale (~42-78) -> our plane/camera scale
const tweenColorTo = (col, c, d = 1.4) =>
  gsap.to(col, { r: c.r, g: c.g, b: c.b, duration: d, ease: 'power2.out' });

// derive valley / ridge / haze colours from the project's single `fog` colour
function moodFromFog(hex) {
  const fog = new THREE.Color(hex);
  const white = new THREE.Color('#ffffff');
  return {
    valley: fog.clone().multiplyScalar(0.28),               // dark
    ridge: fog.clone().lerp(white, 0.25),                   // ~fog, a touch lighter
    haze: fog.clone().lerp(white, 0.5),                     // bright horizon/fog/sky
    zenith: fog.clone().lerp(new THREE.Color('#1a2330'), 0.45),
    deep: fog.clone().multiplyScalar(0.2),
  };
}

let morphTween = null;
function applyPreset(p) {
  // snapshot the current "to" state into "from", set the new "to", then cross-fade uMorph 0->1.
  // (blending two fully-formed terrains morphs in place — no UV sliding)
  if (morphTween) morphTween.progress(1); // finish any in-flight morph first
  U.uDispAlphaA.value.copy(U.uDispAlphaB.value);
  U.uDispOffA.value.copy(U.uDispOffB.value);
  U.uDispScaleA.value = U.uDispScaleB.value;
  U.uTexScaleA.value = U.uTexScaleB.value;
  U.uTexOffA.value.copy(U.uTexOffB.value);
  U.uContrastA.value = U.uContrastB.value;

  const a = [0, 0, 0, 0]; a[p.disp] = 1;
  U.uDispAlphaB.value.set(a[0], a[1], a[2], a[3]);
  U.uDispOffB.value.set(p.dispOff[0], p.dispOff[1]);
  U.uDispScaleB.value = p.dispScale * DISP_MULT;
  U.uTexScaleB.value = p.texScale;
  U.uTexOffB.value.set(p.texOff[0], p.texOff[1]);
  U.uContrastB.value = p.contrast;

  U.uMorph.value = 0;
  morphTween = gsap.to(U.uMorph, { value: 1, duration: 1.6, ease: 'power2.inOut' });
  // (forest prototype: colour is a fixed green world; hover only morphs the mountain shape)
}

// ---------- mouse: fluid splat + camera parallax ----------
const pointer = { x: 0.5, y: 0.5, px: 0.5, py: 0.5, moved: false };
const parallax = { x: 0, y: 0, tx: 0, ty: 0 };

window.addEventListener('pointermove', (e) => {
  const x = e.clientX / window.innerWidth;
  const y = 1 - e.clientY / window.innerHeight;
  pointer.px = pointer.x; pointer.py = pointer.y;
  pointer.x = x; pointer.y = y;
  pointer.moved = true;

  parallax.tx = (x - 0.5) * 10;
  parallax.ty = (y - 0.5) * 5;
});

const splatColor = new THREE.Vector3();
function pumpFluid() {
  if (!pointer.moved) return;
  pointer.moved = false;
  const dx = (pointer.x - pointer.px) * 1200;
  const dy = (pointer.y - pointer.py) * 1200;
  if (dx === 0 && dy === 0) return;
  const tint = U.uFogColor.value;   // tint the mist with the current haze color
  splatColor.set(tint.r, tint.g, tint.b).multiplyScalar(0.12).addScalar(0.04);
  fluid.splat(pointer.x, pointer.y, dx, dy, splatColor);
}

// ---------- smooth scroll (Lenis) dollies the camera ----------
const lenis = new Lenis({ smoothWheel: true, syncTouch: true });
let scrollZ = 0;
lenis.on('scroll', ({ scroll }) => { scrollZ = scroll; });

// ---------- resize ----------
window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  post.setSize(w, h);
});

// ---------- loop ----------
let started = false;
const clock = new THREE.Clock();
function frame(time) {
  requestAnimationFrame(frame);
  lenis.raf(time);

  const dt = Math.min(clock.getDelta(), 0.033);
  const t = clock.elapsedTime;
  const aspect = window.innerWidth / window.innerHeight;

  if (state.fluid) {
    pumpFluid();
    fluid.update(dt, aspect);
  }

  terrain.update(t);
  water.update(t, camera.position);

  if (CONTROLS) {
    controls.update();
  } else {
    // scripted camera parallax + scroll dolly
    parallax.x += (parallax.tx - parallax.x) * 0.04;
    parallax.y += (parallax.ty - parallax.y) * 0.04;
    camera.position.x = parallax.x;
    camera.position.y = 7 + parallax.y - scrollZ * 0.01;
    camera.position.z = 70 - scrollZ * 0.04;
    camera.lookAt(camTarget);
  }

  post.setFluid(fluid.dyeTexture, fluid.velocityTexture);
  post.render();
}
requestAnimationFrame(frame);

// set an initial mood so the scene isn't flat before first hover
applyPreset(DEFAULT);

// ---------- build-stack toggle panel ----------
const setMist = (v) => { post.composite.uniforms.uMist.value = v; post.composite.uniforms.uDistort.value = v > 0 ? 0.0018 : 0; };
const panel = new Panel([
  { id: 1, label: 'Terrain', on: () => scene.add(terrain.mesh), off: () => scene.remove(terrain.mesh) },
  { id: 2, label: 'Color grade', on: () => (U.uGradeOn.value = 1), off: () => (U.uGradeOn.value = 0) },
  { id: 3, label: 'Lighting', on: () => (U.uLightOn.value = 1), off: () => (U.uLightOn.value = 0) },
  { id: 4, label: 'Fog / haze', on: () => (U.uFogOn.value = 1), off: () => (U.uFogOn.value = 0) },
  { id: 5, label: 'Sky', on: () => scene.add(sky.mesh), off: () => scene.remove(sky.mesh) },
  { id: 6, label: 'Water', on: () => scene.add(water.mesh), off: () => scene.remove(water.mesh) },
  { id: 7, label: 'Living motion', on: () => (U.uAnimOn.value = 1), off: () => (U.uAnimOn.value = 0) },
  { id: 8, label: 'Hover morph', on: () => (state.morph = true), off: () => (state.morph = false) },
  { id: 9, label: 'Fluid mist', on: () => { state.fluid = true; setMist(0.35); }, off: () => { state.fluid = false; setMist(0); } },
  { id: 10, label: 'Composite', on: () => (post.composite.enabled = true), off: () => (post.composite.enabled = false) },
  { id: 11, label: 'Bloom', on: () => (post.bloom.enabled = true), off: () => (post.bloom.enabled = false) },
  { id: 12, label: 'Tonemap', on: () => (renderer.toneMapping = THREE.ACESFilmicToneMapping), off: () => (renderer.toneMapping = THREE.NoToneMapping) },
  { id: 13, label: 'Rock / Waterfall', on: () => (U.uRockOn.value = 1), off: () => (U.uRockOn.value = 0) },
  { id: 14, label: 'Forest', on: () => (U.uForestOn.value = 1), off: () => (U.uForestOn.value = 0) },
]);
panel.reset();  // start on bare terrain — only "01 Terrain" checked
