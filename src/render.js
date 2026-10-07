import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { DIRS, vehicleCells } from './core/logic.js';
import { sfx } from './audio.js';
import { haptics } from './platform.js';

export const PALETTE = {
  red: 0xf0453a,
  blue: 0x2f7bf5,
  green: 0x3fc04f,
  yellow: 0xffc928,
  purple: 0x9b59e8,
  orange: 0xff8a1f,
  pink: 0xff6fb5,
  cyan: 0x22c8d8,
  mystery: 0x8c95a3,
};
const SKIN = [0xf1c7a3, 0xe0ac85, 0xc68863, 0x8d5a3b, 0xf6d5bb];

const RING = 0.55; // ring road offset around the lot
const SLOT_HEAD_Z = -1.55 - 3.6; // head position of parked vehicles (top of slot pads)
const SLOT_SPACING = 1.12;
const ROAD_Z = -6.05;
const QUEUE_Z = -6.95;
const QUEUE_ROW = 0.62;
const QUEUE_PER_ROW = 15;
const QUEUE_SPACING = 0.5;
const QUEUE_VISIBLE = 45;
const SLOT_ORDER = [1, 2, 3, 4, 5, 0, 6]; // logical slot -> visual position (extra slots grow outward)
const SPEED = 13;

const lerp = (a, b, k) => a + (b - a) * k;
const easeOut = (k) => 1 - Math.pow(1 - k, 3);
const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
function headingOf(dx, dz) {
  return Math.atan2(-dx, -dz);
}
function angleLerp(a, b, k) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9fdcff);
    this.camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 200);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x7aa36a, 1.25);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.02;
    this.sun = sun;
    this.scene.add(sun);
    this.scene.add(sun.target);

    this.env = new THREE.Group();
    this.vehGroup = new THREE.Group();
    this.paxGroup = new THREE.Group();
    this.fxGroup = new THREE.Group();
    this.scene.add(this.env, this.vehGroup, this.paxGroup, this.fxGroup);

    this.mats = new Map();
    this.geo = this.buildSharedGeometry();
    this.tasks = []; // {at, fn}
    this.tweens = []; // {t0, dur, update(k), done}
    this.time = 0;
    this.maxDt = 0.05;
    this.padding = { top: 84, bottom: 150, side: 10 };

    this.raycaster = new THREE.Raycaster();
    this.onPick = null;
    this.onIdleCallbacks = [];
    this.hintMesh = null;

    let down = null;
    canvas.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 18) return;
      this.pick(e.clientX, e.clientY);
    });

    window.addEventListener('resize', () => this.resize());
    this.resize();

    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(this.maxDt, (now - last) / 1000);
      last = now;
      this.update(dt);
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  mat(color, opts = {}) {
    const key = color + JSON.stringify(opts);
    if (!this.mats.has(key)) this.mats.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, ...opts }));
    return this.mats.get(key);
  }

  buildSharedGeometry() {
    const wheel = new THREE.CylinderGeometry(0.14, 0.14, 0.12, 14);
    wheel.rotateZ(Math.PI / 2);
    const arrowShape = new THREE.Shape();
    arrowShape.moveTo(0, -0.26);
    arrowShape.lineTo(0.2, -0.02);
    arrowShape.lineTo(0.08, -0.02);
    arrowShape.lineTo(0.08, 0.22);
    arrowShape.lineTo(-0.08, 0.22);
    arrowShape.lineTo(-0.08, -0.02);
    arrowShape.lineTo(-0.2, -0.02);
    arrowShape.closePath();
    const arrow = new THREE.ShapeGeometry(arrowShape);
    arrow.rotateX(-Math.PI / 2);
    // ShapeGeometry is in XY; after rotateX(-90) y-> -z, so tip at -0.26 y maps to +z... flip:
    arrow.rotateY(Math.PI);
    const pip = new THREE.CylinderGeometry(0.075, 0.075, 0.035, 12);
    const paxBody = new THREE.CapsuleGeometry(0.12, 0.18, 4, 10);
    const paxHead = new THREE.SphereGeometry(0.105, 14, 10);
    const qTex = canvasTexture(128, 128, (g, w, h) => {
      g.fillStyle = 'rgba(0,0,0,0)';
      g.clearRect(0, 0, w, h);
      g.fillStyle = '#ffffff';
      g.font = 'bold 104px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('?', w / 2, h / 2 + 6);
    });
    const qMat = new THREE.MeshBasicMaterial({ map: qTex, transparent: true, depthWrite: false });
    const qGeo = new THREE.PlaneGeometry(0.62, 0.62);
    qGeo.rotateX(-Math.PI / 2);
    return { wheel, arrow, pip, paxBody, paxHead, qMat, qGeo, bodies: new Map() };
  }

  bodyGeo(w, h, l, r) {
    const key = [w, h, l, r].join(',');
    if (!this.geo.bodies.has(key)) this.geo.bodies.set(key, new RoundedBoxGeometry(w, h, l, 3, r));
    return this.geo.bodies.get(key);
  }

  /* ------------------------------------------------------------ */
  /* layout                                                         */
  /* ------------------------------------------------------------ */

  slotX(slot) {
    const pos = SLOT_ORDER[slot];
    return this.cx + (pos - 3) * SLOT_SPACING;
  }

  queuePos(i) {
    const row = Math.floor(i / QUEUE_PER_ROW);
    const col = i % QUEUE_PER_ROW;
    const left = this.cx - ((QUEUE_PER_ROW - 1) * QUEUE_SPACING) / 2;
    const right = this.cx + ((QUEUE_PER_ROW - 1) * QUEUE_SPACING) / 2;
    const x = row % 2 === 0 ? right - col * QUEUE_SPACING : left + col * QUEUE_SPACING;
    return new THREE.Vector3(x, 0, QUEUE_Z - row * QUEUE_ROW);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.fitCamera();
  }

  fitCamera() {
    if (!this.bounds) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const { minX, maxX, minZ, maxZ } = this.bounds;
    const target = new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    const pitch = THREE.MathUtils.degToRad(58);
    const D = 40;
    this.camera.position.set(target.x, Math.sin(pitch) * D, target.z + Math.cos(pitch) * D);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(target);
    this.camera.updateMatrixWorld(true);
    const inv = this.camera.matrixWorldInverse;
    let x0 = Infinity,
      x1 = -Infinity,
      y0 = Infinity,
      y1 = -Infinity;
    for (const x of [minX, maxX])
      for (const z of [minZ, maxZ])
        for (const y of [0, 0.9]) {
          const p = new THREE.Vector3(x, y, z).applyMatrix4(inv);
          x0 = Math.min(x0, p.x);
          x1 = Math.max(x1, p.x);
          y0 = Math.min(y0, p.y);
          y1 = Math.max(y1, p.y);
        }
    const { top, bottom, side } = this.padding;
    const aw = Math.max(50, vw - side * 2);
    const ah = Math.max(50, vh - top - bottom);
    const s = Math.max((x1 - x0) / aw, (y1 - y0) / ah);
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const offset = top + ah / 2 - vh / 2; // px, positive = content center below screen center
    const camCy = cy + offset * s;
    this.camera.left = cx - (vw / 2) * s;
    this.camera.right = cx + (vw / 2) * s;
    this.camera.top = camCy + (vh / 2) * s;
    this.camera.bottom = camCy - (vh / 2) * s;
    this.camera.near = 0.1;
    this.camera.far = 200;
    this.camera.updateProjectionMatrix();
    this.pxPerUnit = 1 / s;

    // shadow camera covers the play area
    this.sun.position.set(target.x - 6, 18, target.z + 8);
    this.sun.target.position.copy(target);
    const sc = this.sun.shadow.camera;
    const ext = Math.max(maxX - minX, maxZ - minZ) * 0.75 + 2;
    sc.left = -ext;
    sc.right = ext;
    sc.top = ext;
    sc.bottom = -ext;
    sc.near = 1;
    sc.far = 60;
    sc.updateProjectionMatrix();
  }

  /* ------------------------------------------------------------ */
  /* level setup                                                    */
  /* ------------------------------------------------------------ */

  clearGroup(g) {
    while (g.children.length) g.remove(g.children[0]);
  }

  loadLevel(game) {
    this.game = game;
    this.tasks = [];
    this.tweens = [];
    this.clearGroup(this.env);
    this.clearGroup(this.vehGroup);
    this.clearGroup(this.paxGroup);
    this.clearGroup(this.fxGroup);
    this.vehMeshes = new Map();
    this.arriveT = new Map();
    this.lastBoardFor = new Map();
    this.slotFree = new Array(7).fill(0);
    this.lastBoardT = 0;
    this.endT = 0;
    this.hintMesh = null;
    this.cx = game.w / 2;

    const halfQ = ((QUEUE_PER_ROW - 1) * QUEUE_SPACING) / 2 + 0.4;
    this.bounds = {
      minX: Math.min(-RING - 0.5, this.cx - halfQ, this.cx - 3.5 * SLOT_SPACING),
      maxX: Math.max(game.w + RING + 0.5, this.cx + halfQ, this.cx + 3.5 * SLOT_SPACING),
      minZ: QUEUE_Z - QUEUE_ROW * 2 - 0.5,
      maxZ: game.h + RING + 0.5,
    };
    this.buildEnvironment(game);
    this.buildSlotPads(game.slots.length);

    for (const v of game.vehicles) {
      const m = this.makeVehicle(v);
      this.vehMeshes.set(v.id, m);
      this.vehGroup.add(m);
      this.placeInLot(m, v);
    }

    this.visQueue = game.queue.slice();
    this.paxMeshes = [];
    for (let i = 0; i < Math.min(QUEUE_VISIBLE, this.visQueue.length); i++) {
      const p = this.makePassenger(this.visQueue[i]);
      p.position.copy(this.queuePos(i));
      p.userData.target = this.queuePos(i);
      this.paxMeshes.push(p);
      this.paxGroup.add(p);
    }
    this.paxSpawned = this.paxMeshes.length;
    this.fitCamera();
  }

  buildEnvironment(game) {
    const W = game.w,
      H = game.h;
    // grass
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), this.mat(0x86c96a, { roughness: 1 }));
    grass.rotation.x = -Math.PI / 2;
    grass.position.set(this.cx, -0.02, H / 2);
    grass.receiveShadow = true;
    this.env.add(grass);

    // lot surface with painted cells
    const outer = W + RING * 2 + 0.5;
    const outerH = H + RING * 2 + 0.5;
    const px = 64;
    const lotTex = canvasTexture(Math.round(outer * px), Math.round(outerH * px), (g, w, h) => {
      g.fillStyle = '#3f4652';
      g.fillRect(0, 0, w, h);
      const o = (RING + 0.25) * px;
      // inner lot
      g.fillStyle = '#566070';
      g.beginPath();
      g.roundRect(o, o, W * px, H * px, 10);
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.18)';
      g.lineWidth = 2;
      for (let x = 0; x <= W; x++) {
        g.beginPath();
        g.moveTo(o + x * px, o + 4);
        g.lineTo(o + x * px, o + H * px - 4);
        g.stroke();
      }
      for (let y = 0; y <= H; y++) {
        g.beginPath();
        g.moveTo(o + 4, o + y * px);
        g.lineTo(o + W * px - 4, o + y * px);
        g.stroke();
      }
      // dashed ring line
      g.strokeStyle = 'rgba(255,255,255,0.75)';
      g.setLineDash([18, 14]);
      g.lineWidth = 4;
      g.strokeRect(o - RING * px * 0.95, o - RING * px * 0.95, W * px + RING * px * 1.9, H * px + RING * px * 1.9);
      g.setLineDash([]);
      // curb
      g.strokeStyle = '#d9dde3';
      g.lineWidth = 10;
      g.strokeRect(5, 5, w - 10, h - 10);
    });
    const lot = new THREE.Mesh(new THREE.PlaneGeometry(outer, outerH), new THREE.MeshStandardMaterial({ map: lotTex, roughness: 0.95 }));
    lot.rotation.x = -Math.PI / 2;
    lot.position.set(W / 2, 0, H / 2);
    lot.receiveShadow = true;
    this.env.add(lot);

    // connector road from lot top to slot area
    const slotsW = 7 * SLOT_SPACING + 0.6;
    const padArea = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(slotsW, outer), 4.5), this.mat(0x4a515d, { roughness: 0.95 }));
    padArea.rotation.x = -Math.PI / 2;
    padArea.position.set(this.cx, -0.005, -RING - 2.0);
    padArea.receiveShadow = true;
    this.env.add(padArea);

    // top road
    const roadTex = canvasTexture(1024, 64, (g, w, h) => {
      g.fillStyle = '#353b45';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffd34d';
      for (let x = 0; x < w; x += 48) g.fillRect(x, h / 2 - 3, 26, 6);
    });
    roadTex.wrapS = THREE.RepeatWrapping;
    roadTex.repeat.set(4, 1);
    const road = new THREE.Mesh(new THREE.PlaneGeometry(80, 1.0), new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.95 }));
    road.rotation.x = -Math.PI / 2;
    road.position.set(this.cx, 0.002, ROAD_Z);
    road.receiveShadow = true;
    this.env.add(road);

    // sidewalk for the queue
    const side = new THREE.Mesh(new THREE.BoxGeometry(80, 0.12, 3.2), this.mat(0xe9dcc3, { roughness: 0.9 }));
    side.position.set(this.cx, 0.04, QUEUE_Z - 1.0);
    side.receiveShadow = true;
    this.env.add(side);

    // zebra crossing at the front of the queue
    const front = this.queuePos(0);
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.85), this.mat(0xffffff, { roughness: 0.8 }));
      s.rotation.x = -Math.PI / 2;
      s.position.set(front.x - 0.36 + i * 0.24, 0.006, ROAD_Z);
      this.env.add(s);
    }

    // bus stop shelter near the front
    const shelter = new THREE.Group();
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 0.7), this.mat(0x2f7bf5));
    roof.position.y = 1.15;
    roof.castShadow = true;
    const glass = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.9, 0.04), this.mat(0xbfe9ff, { transparent: true, opacity: 0.45 }));
    glass.position.set(0, 0.62, -0.3);
    const sign = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 8), this.mat(0x9aa3ad));
    sign.position.set(0.85, 0.75, 0);
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 18), this.mat(0xffc928));
    plate.rotation.x = Math.PI / 2;
    plate.position.set(0.85, 1.45, 0);
    shelter.add(roof, glass, sign, plate);
    shelter.position.set(front.x + 1.3, 0.1, QUEUE_Z - 0.2);
    this.env.add(shelter);

    // trees & bushes (deterministic)
    let seed = game.w * 31 + game.h * 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const trunkMat = this.mat(0x8a5a3b);
    const leafMats = [this.mat(0x4caf50), this.mat(0x5cc35f), this.mat(0x3d9b46)];
    const trunkGeo = new THREE.CylinderGeometry(0.07, 0.09, 0.4, 8);
    const leafGeo = new THREE.IcosahedronGeometry(0.42, 0);
    const spots = [];
    for (let i = 0; i < 26; i++) {
      const sideLeft = i % 2 === 0;
      const x = sideLeft ? -RING - 1.0 - rnd() * 3.5 : W + RING + 1.0 + rnd() * 3.5;
      const z = -RING - 1 + rnd() * (H + 3);
      spots.push([x, z]);
    }
    for (let i = 0; i < 8; i++) spots.push([this.cx - 6 + rnd() * 12, H + RING + 1.0 + rnd() * 2.5]);
    for (const [x, z] of spots) {
      const t = new THREE.Group();
      const tr = new THREE.Mesh(trunkGeo, trunkMat);
      tr.position.y = 0.2;
      const lf = new THREE.Mesh(leafGeo, leafMats[Math.floor(rnd() * 3)]);
      lf.position.y = 0.62;
      const s = 0.8 + rnd() * 0.6;
      t.scale.setScalar(s);
      tr.castShadow = lf.castShadow = true;
      t.add(tr, lf);
      t.position.set(x, 0, z);
      t.rotation.y = rnd() * 6;
      this.env.add(t);
    }
  }

  buildSlotPads(count) {
    if (this.padGroup) this.env.remove(this.padGroup);
    this.padGroup = new THREE.Group();
    const padTex = canvasTexture(128, 448, (g, w, h) => {
      g.fillStyle = '#5d6676';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#ffd34d';
      g.lineWidth = 8;
      g.strokeRect(6, 6, w - 12, h - 12);
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.font = 'bold 70px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText('P', w / 2, h - 40);
    });
    const padMat = new THREE.MeshStandardMaterial({ map: padTex, roughness: 0.9 });
    const padGeo = new THREE.PlaneGeometry(1.02, 3.95);
    for (let i = 0; i < count; i++) {
      const p = new THREE.Mesh(padGeo, padMat);
      p.rotation.x = -Math.PI / 2;
      p.position.set(this.slotX(i), 0.004, SLOT_HEAD_Z - 0.45 + 3.95 / 2);
      p.receiveShadow = true;
      this.padGroup.add(p);
    }
    this.env.add(this.padGroup);
  }

  /* ------------------------------------------------------------ */
  /* meshes                                                         */
  /* ------------------------------------------------------------ */

  makeVehicle(v) {
    const g = new THREE.Group();
    const inner = new THREE.Group();
    g.add(inner);
    const L = v.len - 0.16;
    const colorKey = v.revealed ? v.color : 'mystery';
    const col = PALETTE[colorKey];
    const bodyMat = this.mat(col);
    const darkGlass = this.mat(0x23303f, { roughness: 0.2, metalness: 0.3 });
    const white = this.mat(0xffffff);
    const parts = { bodyMats: [] };

    let bodyH, roofY;
    if (v.kind === 'car') {
      bodyH = 0.3;
      const body = new THREE.Mesh(this.bodyGeo(0.8, bodyH, L, 0.11), bodyMat);
      body.position.y = 0.3;
      const cabin = new THREE.Mesh(this.bodyGeo(0.68, 0.24, L * 0.52, 0.08), darkGlass);
      cabin.position.set(0, 0.52, L * 0.06);
      const roof = new THREE.Mesh(this.bodyGeo(0.62, 0.06, L * 0.46, 0.03), bodyMat);
      roof.position.set(0, 0.65, L * 0.06);
      inner.add(body, cabin, roof);
      parts.pick = [body, cabin, roof];
      roofY = 0.69;
    } else {
      bodyH = v.kind === 'bus' ? 0.56 : 0.5;
      const body = new THREE.Mesh(this.bodyGeo(0.84, bodyH, L, 0.12), bodyMat);
      body.position.y = 0.17 + bodyH / 2;
      const band = new THREE.Mesh(this.bodyGeo(0.86, 0.17, L * 0.82, 0.05), darkGlass);
      band.position.set(0, 0.17 + bodyH * 0.68, L * 0.02);
      const front = new THREE.Mesh(this.bodyGeo(0.7, 0.2, 0.05, 0.02), darkGlass);
      front.position.set(0, 0.17 + bodyH * 0.66, -L / 2 + 0.01);
      const roof = new THREE.Mesh(this.bodyGeo(0.76, 0.05, L * 0.94, 0.02), v.kind === 'bus' ? white : bodyMat);
      roof.position.y = 0.17 + bodyH + 0.02;
      inner.add(body, band, front, roof);
      parts.pick = [body, band, roof];
      roofY = 0.17 + bodyH + 0.05;
      parts.roof = roof;
    }
    parts.bodyMeshes = inner.children.filter((c) => c.material === bodyMat);

    // headlights
    const lightMat = this.mat(0xfff6c8, { emissive: 0xfff2a0, emissiveIntensity: 0.4 });
    for (const sx of [-0.27, 0.27]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.07, 0.03), lightMat);
      hl.position.set(sx, 0.32, -L / 2 - 0.005);
      inner.add(hl);
    }
    // wheels
    const wMat = this.mat(0x22262c, { roughness: 0.9 });
    const axles = v.kind === 'bus' ? [-L / 2 + 0.45, L / 2 - 0.45, L / 2 - 0.85] : [-L / 2 + 0.38, L / 2 - 0.38];
    for (const z of axles)
      for (const x of [-0.41, 0.41]) {
        const w = new THREE.Mesh(this.geo.wheel, wMat);
        w.position.set(x, 0.14, z);
        inner.add(w);
      }
    // direction arrow on roof
    const arrow = new THREE.Mesh(this.geo.arrow, this.mat(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.35 }));
    arrow.position.set(0, roofY + 0.012, v.kind === 'car' ? L * 0.06 : 0);
    inner.add(arrow);
    parts.arrow = arrow;

    // mystery mark
    if (!v.revealed) {
      const q = new THREE.Mesh(this.geo.qGeo, this.geo.qMat);
      q.position.set(0, roofY + 0.03, v.kind === 'car' ? -L * 0.3 : -L * 0.28);
      q.renderOrder = 2;
      inner.add(q);
      parts.q = q;
    }

    // seat pips (shown when parked)
    const pips = new THREE.Group();
    const rows = Math.ceil(v.cap / 2);
    const span = Math.min(L * 0.8, rows * 0.19);
    for (let i = 0; i < v.cap; i++) {
      const r = Math.floor(i / 2);
      const c = i % 2;
      const p = new THREE.Mesh(this.geo.pip, this.mat(0xe8edf2));
      p.position.set(c ? 0.13 : -0.13, roofY + 0.03, -span / 2 + (rows === 1 ? 0 : (r * span) / (rows - 1)));
      pips.add(p);
    }
    pips.visible = false;
    inner.add(pips);
    parts.pips = pips;

    inner.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.userData.vid = v.id;
      }
    });
    parts.arrow.castShadow = false;
    g.userData = { id: v.id, len: v.len, parts, heading: 0, inner };
    return g;
  }

  placeInLot(m, v) {
    const cells = vehicleCells(v);
    const cx = cells.reduce((s, c) => s + c[0] + 0.5, 0) / cells.length;
    const cz = cells.reduce((s, c) => s + c[1] + 0.5, 0) / cells.length;
    const d = DIRS[v.dir];
    m.position.set(cx, 0, cz);
    m.userData.heading = headingOf(d.dx, d.dy);
    m.rotation.y = m.userData.heading;
  }

  makePassenger(color) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(this.geo.paxBody, this.mat(PALETTE[color]));
    body.position.y = 0.27;
    const head = new THREE.Mesh(this.geo.paxHead, this.mat(SKIN[Math.floor(Math.random() * SKIN.length)]));
    head.position.y = 0.55;
    body.castShadow = head.castShadow = true;
    g.add(body, head);
    g.userData.phase = Math.random() * 6;
    return g;
  }

  setRevealed(id, color) {
    const m = this.vehMeshes.get(id);
    if (!m) return;
    const parts = m.userData.parts;
    for (const b of parts.bodyMeshes) b.material = this.mat(PALETTE[color]);
    if (parts.q) parts.q.visible = false;
    this.pop(m, 0.25);
  }

  /* ------------------------------------------------------------ */
  /* animation primitives                                           */
  /* ------------------------------------------------------------ */

  at(time, fn) {
    this.tasks.push({ at: time, fn });
    this.endT = Math.max(this.endT, time);
  }
  tween(t0, dur, update, done) {
    this.tweens.push({ t0, dur, update, done, started: false });
    this.endT = Math.max(this.endT, t0 + dur);
  }

  pop(obj, dur = 0.3, amt = 0.18) {
    const base = obj.userData.baseScale ?? 1;
    this.tween(this.time, dur, (k) => obj.scale.setScalar(base * (1 + Math.sin(k * Math.PI) * amt)), () => obj.scale.setScalar(base));
  }

  shake(obj) {
    const inner = obj.userData.inner;
    this.tween(this.time, 0.35, (k) => {
      inner.rotation.z = Math.sin(k * Math.PI * 6) * 0.08 * (1 - k);
    }, () => (inner.rotation.z = 0));
  }

  /** animate vehicle so that its HEAD point follows a polyline */
  driveHeadAlong(m, pts, t0, speed, { endHeading = null, onDone } = {}) {
    const lens = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const l = pts[i].distanceTo(pts[i - 1]);
      lens.push(l);
      total += l;
    }
    const dur = Math.max(0.15, total / speed);
    const half = (m.userData.len - 1) / 2 + 0.5 - 0.08; // head point distance from center
    let heading = m.userData.heading;
    const tmp = new THREE.Vector3();
    this.tween(
      t0,
      dur,
      (k) => {
        const e = easeInOut(Math.min(1, k)) * 0.15 + k * 0.85;
        let dist = e * total;
        let i = 0;
        while (i < lens.length - 1 && dist > lens[i]) {
          dist -= lens[i];
          i++;
        }
        const a = pts[i],
          b = pts[i + 1];
        const f = lens[i] > 0 ? Math.min(1, dist / lens[i]) : 1;
        tmp.lerpVectors(a, b, f);
        const dx = b.x - a.x,
          dz = b.z - a.z;
        if (Math.abs(dx) + Math.abs(dz) > 1e-4) heading = angleLerp(heading, headingOf(dx, dz), 0.25);
        m.userData.heading = heading;
        m.rotation.y = heading;
        m.position.set(tmp.x + Math.sin(heading) * half, 0, tmp.z + Math.cos(heading) * half);
      },
      () => {
        if (endHeading !== null) {
          m.userData.heading = endHeading;
          m.rotation.y = endHeading;
          const p = pts[pts.length - 1];
          m.position.set(p.x + Math.sin(endHeading) * half, 0, p.z + Math.cos(endHeading) * half);
        }
        onDone && onDone();
      }
    );
    return dur;
  }

  headPoint(v) {
    return new THREE.Vector3(v.hx + 0.5, 0, v.hy + 0.5);
  }

  exitPath(v, slot) {
    const W = this.game.w,
      H = this.game.h;
    const head = this.headPoint(v);
    const pts = [head.clone()];
    let p1;
    switch (v.dir) {
      case 'U':
        p1 = new THREE.Vector3(head.x, 0, -RING);
        break;
      case 'D':
        p1 = new THREE.Vector3(head.x, 0, H + RING);
        break;
      case 'L':
        p1 = new THREE.Vector3(-RING, 0, head.z);
        break;
      default:
        p1 = new THREE.Vector3(W + RING, 0, head.z);
    }
    pts.push(p1);
    const sx = this.slotX(slot);
    const tx = Math.max(-RING, Math.min(W + RING, sx));
    // perimeter param, clockwise from top-left corner
    const x0 = -RING,
      x1 = W + RING,
      z0 = -RING,
      z1 = H + RING;
    const PW = x1 - x0,
      PH = z1 - z0;
    const per = 2 * (PW + PH);
    const param = (p) => {
      if (Math.abs(p.z - z0) < 1e-3) return p.x - x0;
      if (Math.abs(p.x - x1) < 1e-3) return PW + (p.z - z0);
      if (Math.abs(p.z - z1) < 1e-3) return PW + PH + (x1 - p.x);
      return 2 * PW + PH + (z1 - p.z);
    };
    const corners = [
      [0, new THREE.Vector3(x0, 0, z0)],
      [PW, new THREE.Vector3(x1, 0, z0)],
      [PW + PH, new THREE.Vector3(x1, 0, z1)],
      [2 * PW + PH, new THREE.Vector3(x0, 0, z1)],
    ];
    const T = new THREE.Vector3(tx, 0, z0);
    const s1 = param(p1),
      s2 = param(T);
    const cw = (s2 - s1 + per) % per;
    const ccw = (s1 - s2 + per) % per;
    if (cw <= ccw) {
      const list = corners.map(([s, c]) => [((s - s1 + per) % per) || per, c]).filter(([d]) => d < cw).sort((a, b) => a[0] - b[0]);
      list.forEach(([, c]) => pts.push(c.clone()));
    } else {
      const list = corners.map(([s, c]) => [((s1 - s + per) % per) || per, c]).filter(([d]) => d < ccw).sort((a, b) => a[0] - b[0]);
      list.forEach(([, c]) => pts.push(c.clone()));
    }
    pts.push(T);
    if (Math.abs(tx - sx) > 1e-3) pts.push(new THREE.Vector3(sx, 0, z0));
    pts.push(new THREE.Vector3(sx, 0, SLOT_HEAD_Z));
    // drop duplicates
    return pts.filter((p, i) => i === 0 || p.distanceTo(pts[i - 1]) > 1e-3);
  }

  /* ------------------------------------------------------------ */
  /* event playback                                                 */
  /* ------------------------------------------------------------ */

  play(events, game) {
    const now = this.time;
    for (const ev of events) {
      switch (ev.type) {
        case 'blocked': {
          const m = this.vehMeshes.get(ev.id);
          const v = game.byId.get(ev.id);
          const d = DIRS[v.dir];
          const dist = ev.dist + 0.12;
          const start = m.position.clone();
          sfx.bump();
          haptics.medium();
          const go = Math.max(0.12, dist / 10);
          this.tween(now, go, (k) => {
            const e = k * k;
            m.position.set(start.x + d.dx * dist * e, 0, start.z + d.dy * dist * e);
          });
          this.tween(now + go, 0.25, (k) => {
            const e = easeOut(k);
            m.position.set(start.x + d.dx * dist * (1 - e), 0, start.z + d.dy * dist * (1 - e));
          }, () => m.position.copy(start));
          const b = this.vehMeshes.get(ev.blocker);
          this.at(now + go, () => {
            if (b) this.shake(b);
            sfx.honk();
          });
          break;
        }
        case 'noslot': {
          const m = this.vehMeshes.get(ev.id);
          this.shake(m);
          sfx.bump();
          haptics.medium();
          break;
        }
        case 'exit': {
          const m = this.vehMeshes.get(ev.id);
          const v = game.byId.get(ev.id);
          const pts = this.exitPath(v, ev.slot);
          let total = 0;
          for (let i = 1; i < pts.length; i++) total += pts[i].distanceTo(pts[i - 1]);
          const dur = Math.max(0.15, total / SPEED);
          const start = Math.max(now, this.slotFree[ev.slot] - dur + 0.05);
          sfx.go();
          haptics.light();
          this.driveHeadAlong(m, pts, start, SPEED, {
            endHeading: 0,
            onDone: () => {
              m.userData.parts.arrow.visible = false;
              m.userData.parts.pips.visible = true;
            },
          });
          this.arriveT.set(ev.id, start + dur);
          this.removeHint();
          break;
        }
        case 'crane': {
          const m = this.vehMeshes.get(ev.id);
          const from = m.position.clone();
          const fromH = m.userData.heading;
          const half = (m.userData.len - 1) / 2 + 0.5 - 0.08;
          const to = new THREE.Vector3(this.slotX(ev.slot), 0, SLOT_HEAD_Z + half);
          const dur = 1.0;
          const start = Math.max(now, this.slotFree[ev.slot] - dur + 0.05);
          sfx.booster();
          this.tween(start, dur, (k) => {
            const e = easeInOut(k);
            m.position.set(lerp(from.x, to.x, e), Math.sin(k * Math.PI) * 2.4, lerp(from.z, to.z, e));
            m.rotation.y = m.userData.heading = angleLerp(fromH, 0, e);
          }, () => {
            m.position.copy(to);
            m.rotation.y = m.userData.heading = 0;
            m.userData.parts.arrow.visible = false;
            m.userData.parts.pips.visible = true;
            this.dust(to.x, to.z);
          });
          this.arriveT.set(ev.id, start + dur);
          break;
        }
        case 'reveal': {
          this.at(now + 0.08, () => {
            this.setRevealed(ev.id, ev.color);
            sfx.reveal();
          });
          break;
        }
        case 'board': {
          const t = Math.max(now, this.arriveT.get(ev.id) ?? now, this.lastBoardT + 0.085);
          this.lastBoardT = t;
          this.lastBoardFor.set(ev.id, t + 0.28);
          const seat = ev.seat;
          this.at(t, () => this.boardOne(ev.id, ev.slot, seat, ev.color));
          this.endT = Math.max(this.endT, t + 0.3);
          break;
        }
        case 'depart': {
          const t = (this.lastBoardFor.get(ev.id) ?? now) + 0.2;
          const slotX = this.slotX(ev.slot);
          this.slotFree[ev.slot] = t + 0.55;
          this.at(t, () => this.departOne(ev.id, slotX));
          this.endT = Math.max(this.endT, t + 1.2);
          break;
        }
        case 'addslot': {
          this.buildSlotPads(game.slots.length);
          sfx.booster();
          break;
        }
        case 'queue': {
          this.rebuildQueue(ev.queue);
          break;
        }
        default:
          break;
      }
    }
  }

  boardOne(id, slot, seat, color) {
    const m = this.vehMeshes.get(id);
    const p = this.paxMeshes.shift();
    this.visQueue.shift();
    if (p) {
      const from = p.position.clone();
      const to = new THREE.Vector3(this.slotX(slot), 0, SLOT_HEAD_Z + 0.25);
      p.userData.target = null;
      this.tween(this.time, 0.26, (k) => {
        p.position.set(lerp(from.x, to.x, k), Math.sin(k * Math.PI) * 0.35, lerp(from.z, to.z, k));
        p.scale.setScalar(1 - k * 0.55);
      }, () => this.paxGroup.remove(p));
    }
    // shift the line
    this.paxMeshes.forEach((pm, i) => (pm.userData.target = this.queuePos(i)));
    // spawn the next hidden passenger at the tail
    if (this.visQueue.length > this.paxMeshes.length) {
      const i = this.paxMeshes.length;
      const np = this.makePassenger(this.visQueue[i]);
      const tp = this.queuePos(i);
      np.position.copy(tp).add(new THREE.Vector3(0, 0, -0.6));
      np.userData.target = tp;
      this.paxMeshes.push(np);
      this.paxGroup.add(np);
    }
    this.at(this.time + 0.26, () => {
      if (!m) return;
      const pip = m.userData.parts.pips.children[seat];
      if (pip) pip.material = this.mat(PALETTE[color]);
      sfx.board(seat);
      m.userData.inner.position.y = -0.04;
      this.tween(this.time, 0.12, (k) => (m.userData.inner.position.y = -0.04 * (1 - k)));
    });
  }

  departOne(id, slotX) {
    const m = this.vehMeshes.get(id);
    if (!m) return;
    sfx.depart();
    haptics.light();
    const half = (m.userData.len - 1) / 2 + 0.5 - 0.08;
    const head = new THREE.Vector3(slotX, 0, SLOT_HEAD_Z);
    const pts = [head, new THREE.Vector3(slotX, 0, ROAD_Z), new THREE.Vector3(this.bounds.maxX + 8, 0, ROAD_Z)];
    void half;
    this.driveHeadAlong(m, pts, this.time, 11, { onDone: () => this.vehGroup.remove(m) });
    this.dust(slotX, SLOT_HEAD_Z + 1.2);
  }

  rebuildQueue(queue) {
    for (const p of this.paxMeshes) this.paxGroup.remove(p);
    this.visQueue = queue.slice();
    this.paxMeshes = [];
    for (let i = 0; i < Math.min(QUEUE_VISIBLE, this.visQueue.length); i++) {
      const p = this.makePassenger(this.visQueue[i]);
      p.position.copy(this.queuePos(i)).add(new THREE.Vector3(0, 1.2, 0));
      p.userData.target = this.queuePos(i);
      this.paxMeshes.push(p);
      this.paxGroup.add(p);
    }
  }

  dust(x, z) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false });
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 5), mat.clone());
      const a = Math.random() * Math.PI * 2;
      const r = 0.2 + Math.random() * 0.3;
      s.position.set(x, 0.15, z);
      this.fxGroup.add(s);
      const tx = x + Math.cos(a) * r * 2,
        tz = z + Math.sin(a) * r * 2;
      this.tween(this.time, 0.5, (k) => {
        s.position.set(lerp(x, tx, k), 0.15 + k * 0.3, lerp(z, tz, k));
        s.scale.setScalar(1 + k * 1.5);
        s.material.opacity = 0.7 * (1 - k);
      }, () => this.fxGroup.remove(s));
    }
  }

  confetti() {
    const colors = Object.values(PALETTE);
    const { minX, maxX, minZ, maxZ } = this.bounds;
    const geo = new THREE.PlaneGeometry(0.16, 0.26);
    for (let i = 0; i < 90; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: colors[i % colors.length], side: THREE.DoubleSide }));
      const x = lerp(minX, maxX, Math.random());
      const z = lerp(minZ, maxZ, Math.random());
      const y0 = 6 + Math.random() * 4;
      const rx = Math.random() * 6,
        ry = Math.random() * 6;
      const t0 = this.time + Math.random() * 0.6;
      m.position.set(x, y0, z);
      this.fxGroup.add(m);
      this.tween(t0, 2.4, (k) => {
        m.position.y = y0 - k * (y0 + 0.5);
        m.position.x = x + Math.sin(k * 8 + rx) * 0.4;
        m.rotation.set(rx + k * 9, ry + k * 7, 0);
      }, () => this.fxGroup.remove(m));
    }
  }

  /* ------------------------------------------------------------ */
  /* hint (tutorial)                                                */
  /* ------------------------------------------------------------ */

  showHint(id) {
    this.removeHint();
    const m = this.vehMeshes.get(id);
    if (!m) return;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.78, 36),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(m.position.x, 0.03, m.position.z);
    ring.scale.set(1, m.userData.len * 0.75, 1);
    ring.rotation.z = -m.userData.heading;
    ring.userData.pulse = true;
    this.fxGroup.add(ring);
    this.hintMesh = ring;
  }
  removeHint() {
    if (this.hintMesh) this.fxGroup.remove(this.hintMesh);
    this.hintMesh = null;
  }

  /* ------------------------------------------------------------ */

  /** screen position (px) of a world point – used for floating UI */
  toScreen(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: ((v.x + 1) / 2) * window.innerWidth, y: ((1 - v.y) / 2) * window.innerHeight };
  }

  vehicleScreenPos(id) {
    const m = this.vehMeshes.get(id);
    if (!m) return null;
    return this.toScreen(m.position.x, 0.8, m.position.z);
  }

  pick(clientX, clientY) {
    if (!this.onPick || !this.game) return;
    const ndc = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const targets = [];
    for (const v of this.game.vehicles) {
      if (v.state !== 'lot') continue;
      const m = this.vehMeshes.get(v.id);
      if (m) targets.push(...m.userData.parts.pick);
    }
    const hits = this.raycaster.intersectObjects(targets, false);
    if (hits.length) {
      this.onPick(hits[0].object.userData.vid);
      return;
    }
    // forgiving touch: nearest vehicle footprint within half a cell
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.3);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, p)) return;
    const gx = Math.floor(p.x),
      gy = Math.floor(p.z);
    let best = null,
      bd = 0.75;
    for (const v of this.game.vehicles) {
      if (v.state !== 'lot') continue;
      for (const [x, y] of vehicleCells(v)) {
        const d = Math.hypot(x + 0.5 - p.x, y + 0.5 - p.z);
        if (d < bd) {
          bd = d;
          best = v.id;
        }
      }
    }
    void gx;
    void gy;
    if (best !== null) this.onPick(best);
  }

  isBusy() {
    return this.tasks.length > 0 || this.tweens.length > 0;
  }

  whenIdle(fn, extra = 0) {
    const t = Math.max(this.time, this.endT) + extra;
    this.at(t, fn);
  }

  update(dt) {
    this.time += dt;
    const now = this.time;
    // scheduled tasks
    if (this.tasks.length) {
      const due = this.tasks.filter((t) => t.at <= now);
      if (due.length) {
        this.tasks = this.tasks.filter((t) => t.at > now);
        due.sort((a, b) => a.at - b.at).forEach((t) => t.fn());
      }
    }
    // tweens
    if (this.tweens.length) {
      const keep = [];
      for (const tw of this.tweens) {
        if (now < tw.t0) {
          keep.push(tw);
          continue;
        }
        const k = Math.min(1, (now - tw.t0) / tw.dur);
        tw.update(k);
        if (k >= 1) tw.done && tw.done();
        else keep.push(tw);
      }
      // tweens may have been added during callbacks
      const added = this.tweens.filter((t) => !keep.includes(t) && t.t0 > now);
      this.tweens = keep.concat(added.filter((t) => !keep.includes(t)));
    }
    // passengers: follow targets + idle bob
    if (this.paxMeshes) {
      for (const p of this.paxMeshes) {
        const tgt = p.userData.target;
        if (!tgt) continue;
        const dx = tgt.x - p.position.x,
          dz = tgt.z - p.position.z,
          dy = tgt.y - p.position.y;
        const d = Math.hypot(dx, dz);
        const step = Math.min(1, (dt * 7) / Math.max(d, 0.001));
        if (d > 0.002) {
          p.position.x += dx * Math.min(1, step);
          p.position.z += dz * Math.min(1, step);
          p.position.y = Math.abs(Math.sin(now * 18 + p.userData.phase)) * 0.06;
        } else {
          p.position.y += dy * Math.min(1, dt * 10);
          p.children[0].scale.y = 1 + Math.sin(now * 3 + p.userData.phase) * 0.03;
        }
      }
    }
    if (this.hintMesh) {
      const k = (Math.sin(now * 5) + 1) / 2;
      this.hintMesh.material.opacity = 0.35 + k * 0.6;
    }
  }
}
