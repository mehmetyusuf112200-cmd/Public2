// Promo kit: renders the game's own 3D vehicles / passengers into marketing
// art (icon, feature graphic). Uses the real Renderer as a model factory.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Renderer } from '../../src/render.js';

const hidden = document.createElement('canvas');
hidden.width = hidden.height = 8;
hidden.style.display = 'none';
document.body.appendChild(hidden);
export const factory = new Renderer(hidden);
factory.paused = true;

let vid = 1000;
export function vehicle(kind, color, variant, opts = {}) {
  const len = { car: 2, van: 3, bus: 4 }[kind];
  const cap = { car: 4, van: 6, bus: 10 }[kind];
  const m = factory.makeVehicle({ id: vid++, kind, color, variant, len, cap, revealed: true, ice: opts.ice || 0 });
  if (opts.pips) m.userData.parts.pips.visible = true;
  if (opts.noArrow) m.userData.parts.arrow.visible = false;
  return m;
}
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
export function tree(type = 'round') {
  return factory.makeTree(type, rnd);
}
export function bush() {
  return factory.makeBush(rnd);
}
export function passenger(color) {
  return factory.makePassenger(color);
}

export function stage(canvas, w, h, { fov = 30 } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x88aadd, 1.3));
  const sun = new THREE.DirectionalLight(0xffffff, 2.3);
  sun.position.set(-5, 10, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 0.5, far: 40 });
  sun.shadow.bias = -0.0005;
  sun.shadow.radius = 6;
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0xbfe3ff, 1.1);
  rim.position.set(6, 4, -6);
  scene.add(rim);
  const camera = new THREE.PerspectiveCamera(fov, w / h, 0.1, 200);
  // soft contact-shadow catcher
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: 0.28 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  return { THREE, renderer, scene, camera, sun, ground, render: () => renderer.render(scene, camera) };
}
export { THREE };
