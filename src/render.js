import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { DIRS, vehicleCells, MAX_SLOTS } from './core/logic.js';
import { THEMES } from './theme.js';
import { sfx } from './audio.js';
import { haptics } from './platform.js';

export const PALETTE = {
  red: 0xff4b3e,
  blue: 0x3388ff,
  green: 0x3fd15a,
  yellow: 0xffcc1f,
  purple: 0xa25cf0,
  orange: 0xff8f1f,
  pink: 0xff6fbf,
  cyan: 0x1fd2e0,
  mystery: 0x8c95a3,
};
const SKIN = [0xf6cfaf, 0xe7b48f, 0xc68863, 0x8d5a3b, 0xffdcc2];
const HAIR = [0x3b2a20, 0x6b4226, 0xf4c26b, 0x1d1d1d, 0xb5502b];

const RING = 0.55;
const SLOT_HEAD_Z = -1.55 - 3.6;
const SLOT_SPACING = 1.12;
const ROAD_Z = -6.05;
const QUEUE_Z = -6.95;
const QUEUE_ROW = 0.62;
const QUEUE_PER_ROW = 15;
const QUEUE_SPACING = 0.5;
const QUEUE_VISIBLE = 45;
const SLOT_ORDER = [1, 2, 3, 4, 5, 0, 6];
const SPEED = 13;
const WHEEL_R = 0.14;

const lerp = (a, b, k) => a + (b - a) * k;
const easeOut = (k) => 1 - Math.pow(1 - k, 3);
const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const easeOutBack = (k) => {
  const c1 = 1.70158,
    c3 = c1 + 1;
  return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
};
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
function lighten(hex, amt) {
  const c = new THREE.Color(hex);
  c.lerp(new THREE.Color(0xffffff), amt);
  return c.getHex();
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9fdcff);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.45;
    this.camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 200);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x7aa36a, 1.2);
    this.scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.02;
    this.sun = sun;
    this.scene.add(sun, sun.target);

    this.env = new THREE.Group();
    this.vehGroup = new THREE.Group();
    this.paxGroup = new THREE.Group();
    this.fxGroup = new THREE.Group();
    this.scene.add(this.env, this.vehGroup, this.paxGroup, this.fxGroup);

    this.mats = new Map();
    this.geo = this.buildSharedGeometry();
    this.tasks = [];
    this.tweens = [];
    this.time = 0;
    this.maxDt = 0.05;
    this.padding = { top: 84, bottom: 150, side: 10 };
    this.theme = THEMES[0];
    this.style = 'classic';
    this.blinkers = [];
    this.cloudShadows = [];
    this.paused = false;

    this.raycaster = new THREE.Raycaster();
    this.onPick = null;
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
      if (!this.paused) {
        this.update(dt);
        this.renderer.render(this.scene, this.camera);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /* ------------------------------------------------------------ */
  /* materials                                                      */
  /* ------------------------------------------------------------ */

  mat(color, opts = {}) {
    const key = color + JSON.stringify(opts);
    if (!this.mats.has(key)) this.mats.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, ...opts }));
    return this.mats.get(key);
  }

  /** body paint according to the purchased style */
  paint(colorKey) {
    const hex = PALETTE[colorKey];
    switch (this.style) {
      case 'metallic':
        return this.mat(hex, { roughness: 0.16, metalness: 0.75, envMapIntensity: 4 });
      case 'candy':
        return this.mat(lighten(hex, 0.35), { roughness: 0.85, metalness: 0 });
      case 'neon':
        return this.mat(0x15151f, { roughness: 0.3, emissive: hex, emissiveIntensity: 1.7 });
      default:
        return this.mat(hex, { roughness: 0.42, metalness: 0.1 });
    }
  }

  buildSharedGeometry() {
    const wheel = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.12, 14);
    wheel.rotateZ(Math.PI / 2);
    const hub = new THREE.CylinderGeometry(0.06, 0.06, 0.13, 8);
    hub.rotateZ(Math.PI / 2);
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
    arrow.rotateY(Math.PI);
    const pip = new THREE.CylinderGeometry(0.075, 0.075, 0.035, 12);
    const paxBody = new THREE.CapsuleGeometry(0.12, 0.16, 4, 10);
    const paxHead = new THREE.SphereGeometry(0.105, 14, 10);
    const paxHair = new THREE.SphereGeometry(0.11, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5);
    const eye = new THREE.SphereGeometry(0.018, 6, 5);
    const qTex = canvasTexture(128, 128, (g, w, h) => {
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
    const puff = new THREE.IcosahedronGeometry(0.12, 0);
    const star = (() => {
      const s = new THREE.Shape();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 0.06 : 0.15;
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      s.closePath();
      return new THREE.ShapeGeometry(s);
    })();
    return { wheel, hub, arrow, pip, paxBody, paxHead, paxHair, eye, qMat, qGeo, puff, star, bodies: new Map() };
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
    return this.cx + (SLOT_ORDER[slot] - 3) * SLOT_SPACING;
  }

  queuePos(i) {
    const row = Math.floor(i / QUEUE_PER_ROW);
    const col = i % QUEUE_PER_ROW;
    const left = this.cx - ((QUEUE_PER_ROW - 1) * QUEUE_SPACING) / 2;
    const right = this.cx + ((QUEUE_PER_ROW - 1) * QUEUE_SPACING) / 2;
    const x = row % 2 === 0 ? right - col * QUEUE_SPACING : left + col * QUEUE_SPACING;
    return new THREE.Vector3(x, 0.06, QUEUE_Z - row * QUEUE_ROW);
  }

  resize() {
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
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
    const offset = top + ah / 2 - vh / 2;
    const camCy = cy + offset * s;
    this.camera.left = cx - (vw / 2) * s;
    this.camera.right = cx + (vw / 2) * s;
    this.camera.top = camCy + (vh / 2) * s;
    this.camera.bottom = camCy - (vh / 2) * s;
    this.camera.updateProjectionMatrix();

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

  setStyle(style) {
    this.style = style;
  }

  applyTheme(theme) {
    this.theme = theme;
    this.scene.background = new THREE.Color(theme.sky);
    this.hemi.color.setHex(theme.hemi[0]);
    this.hemi.groundColor.setHex(theme.hemi[1]);
    this.hemi.intensity = theme.hemi[2];
    this.sun.color.setHex(theme.sun[0]);
    this.sun.intensity = theme.sun[1];
    this.scene.environmentIntensity = theme.env * 0.55;
  }

  loadLevel(game, theme) {
    this.game = game;
    this.applyTheme(theme || this.theme);
    this.tasks = [];
    this.tweens = [];
    this.blinkers = [];
    this.cloudShadows = [];
    this.clearGroup(this.env);
    this.clearGroup(this.vehGroup);
    this.clearGroup(this.paxGroup);
    this.clearGroup(this.fxGroup);
    this.vehMeshes = new Map();
    this.lotClear = new Map();
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
    this.buildSlotPads(game);

    // vehicles drop in with a bouncy stagger
    const order = game.vehicles.slice().sort((a, b) => a.hy + a.hx * 0.3 - (b.hy + b.hx * 0.3));
    order.forEach((v, i) => {
      const m = this.makeVehicle(v);
      this.vehMeshes.set(v.id, m);
      this.vehGroup.add(m);
      this.placeInLot(m, v);
      const t0 = this.time + 0.05 + i * 0.035;
      m.position.y = 4;
      m.visible = false;
      this.tween(t0, 0.45, (k) => {
        m.visible = true;
        m.position.y = 4 * (1 - easeOutBack(k)) ;
        if (m.position.y < 0) m.position.y *= 0.25;
      }, () => {
        m.position.y = 0;
        this.squash(m);
      });
    });
    this.at(this.time + 0.2, () => sfx.whoosh && sfx.whoosh());

    this.visQueue = game.queue.slice();
    this.paxMeshes = [];
    for (let i = 0; i < Math.min(QUEUE_VISIBLE, this.visQueue.length); i++) {
      const p = this.makePassenger(this.visQueue[i]);
      const tp = this.queuePos(i);
      p.position.copy(tp).add(new THREE.Vector3(6 + i * 0.25, 0, 0));
      p.userData.target = tp;
      this.paxMeshes.push(p);
      this.paxGroup.add(p);
    }
    this.fitCamera();
  }

  groundTexture() {
    const t = this.theme;
    const tex = canvasTexture(512, 512, (g, w, h) => {
      g.fillStyle = t.ground;
      g.fillRect(0, 0, w, h);
      let s = 7;
      const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      g.fillStyle = t.ground2;
      for (let i = 0; i < 60; i++) {
        g.globalAlpha = 0.6;
        g.beginPath();
        g.ellipse(rnd() * w, rnd() * h, 10 + rnd() * 40, 6 + rnd() * 22, rnd() * 3, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
      for (let i = 0; i < 120; i++) {
        g.fillStyle = t.flowers[i % t.flowers.length];
        const x = rnd() * w,
          y = rnd() * h,
          r = 1.6 + rnd() * 2.2;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      }
    });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(16, 16);
    return tex;
  }

  buildEnvironment(game) {
    const W = game.w,
      H = game.h;
    const theme = this.theme;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshStandardMaterial({ map: this.groundTexture(), roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(this.cx, -0.02, H / 2);
    ground.receiveShadow = true;
    this.env.add(ground);

    // lot surface
    const outer = W + RING * 2 + 0.5;
    const outerH = H + RING * 2 + 0.5;
    const px = 64;
    const lotTex = canvasTexture(Math.round(outer * px), Math.round(outerH * px), (g, w, h) => {
      g.fillStyle = this.theme.night ? '#2f3648' : '#6b7287';
      g.fillRect(0, 0, w, h);
      const o = (RING + 0.25) * px;
      g.fillStyle = theme.lot;
      g.beginPath();
      g.roundRect(o, o, W * px, H * px, 10);
      g.fill();
      // subtle checker
      for (let x = 0; x < W; x++)
        for (let y = 0; y < H; y++)
          if ((x + y) % 2 === 0) {
            g.fillStyle = 'rgba(255,255,255,0.035)';
            g.fillRect(o + x * px, o + y * px, px, px);
          }
      g.strokeStyle = theme.lotLine;
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
      g.strokeStyle = 'rgba(255,214,77,0.85)';
      g.setLineDash([18, 14]);
      g.lineWidth = 4;
      g.strokeRect(o - RING * px * 0.95, o - RING * px * 0.95, W * px + RING * px * 1.9, H * px + RING * px * 1.9);
      g.setLineDash([]);
      g.strokeStyle = '#e4e8ee';
      g.lineWidth = 12;
      g.strokeRect(6, 6, w - 12, h - 12);
    });
    const lot = new THREE.Mesh(new THREE.PlaneGeometry(outer, outerH), new THREE.MeshStandardMaterial({ map: lotTex, roughness: 0.92 }));
    lot.rotation.x = -Math.PI / 2;
    lot.position.set(W / 2, 0, H / 2);
    lot.receiveShadow = true;
    this.env.add(lot);
    // curb
    const curbMat = this.mat(0xe4e8ee);
    for (const [x, z, sx, sz] of [
      [W / 2, -RING - 0.25, outer, 0.12],
      [W / 2, H + RING + 0.25, outer, 0.12],
      [-RING - 0.25, H / 2, 0.12, outerH],
      [W + RING + 0.25, H / 2, 0.12, outerH],
    ]) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.08, sz), curbMat);
      c.position.set(x, 0.04, z);
      c.receiveShadow = true;
      this.env.add(c);
    }

    // apron between lot and road
    const slotsW = 7 * SLOT_SPACING + 0.6;
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(slotsW, outer), 4.5), this.mat(0x4a515d, { roughness: 0.95 }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(this.cx, -0.005, -RING - 2.0);
    pad.receiveShadow = true;
    this.env.add(pad);

    // road
    const roadTex = canvasTexture(1024, 64, (g, w, h) => {
      g.fillStyle = '#343a44';
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

    // sidewalk
    const side = new THREE.Mesh(new THREE.BoxGeometry(80, 0.12, 3.2), this.mat(theme.sidewalk, { roughness: 0.9 }));
    side.position.set(this.cx, 0.04, QUEUE_Z - 1.0);
    side.receiveShadow = true;
    this.env.add(side);

    const front = this.queuePos(0);
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.85), this.mat(0xffffff, { roughness: 0.8 }));
      s.rotation.x = -Math.PI / 2;
      s.position.set(front.x - 0.36 + i * 0.24, 0.006, ROAD_Z);
      this.env.add(s);
    }

    // bus stop shelter
    const shelter = new THREE.Group();
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 0.7), this.mat(0x2f7bf5));
    roof.position.y = 1.15;
    roof.castShadow = true;
    const glass = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.9, 0.04), this.mat(0xbfe9ff, { transparent: true, opacity: 0.45 }));
    glass.position.set(0, 0.62, -0.3);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 8), this.mat(0x9aa3ad));
    pole.position.set(0.85, 0.75, 0);
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 18), this.mat(0xffc928, { emissive: 0xffc928, emissiveIntensity: theme.night ? 0.6 : 0 }));
    plate.rotation.x = Math.PI / 2;
    plate.position.set(0.85, 1.45, 0);
    shelter.add(roof, glass, pole, plate);
    shelter.position.set(front.x + 1.3, 0.1, QUEUE_Z - 0.2);
    this.env.add(shelter);

    let seed = game.w * 31 + game.h * 7 + THEMES.indexOf(theme) * 101;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

    // buildings behind the sidewalk
    const bx0 = this.cx - 22,
      bx1 = this.cx + 22;
    let x = bx0;
    while (x < bx1) {
      const w = 1.6 + rnd() * 1.4;
      const h = 1.6 + rnd() * 2.6;
      const d = 1.6;
      const col = theme.buildings[Math.floor(rnd() * theme.buildings.length)];
      this.env.add(this.makeBuilding(w, h, d, col, rnd, x + w / 2, QUEUE_Z - 3.6));
      x += w + 0.25 + rnd() * 0.4;
    }

    // trees and props around the lot
    const spots = [];
    for (let i = 0; i < 30; i++) {
      const sideLeft = i % 2 === 0;
      const tx = sideLeft ? -RING - 1.0 - rnd() * 4.5 : W + RING + 1.0 + rnd() * 4.5;
      const tz = -RING - 1 + rnd() * (H + 4);
      spots.push([tx, tz]);
    }
    for (let i = 0; i < 10; i++) spots.push([this.cx - 7 + rnd() * 14, H + RING + 1.0 + rnd() * 3]);
    for (const [tx, tz] of spots) {
      const r = rnd();
      let obj;
      if (r < 0.7) obj = this.makeTree(theme.tree, rnd);
      else if (r < 0.85) obj = this.makeBush(rnd);
      else obj = theme.id === 'snow' && rnd() < 0.5 ? this.makeSnowman() : theme.id === 'beach' && rnd() < 0.6 ? this.makeUmbrella(rnd) : this.makeBush(rnd);
      obj.position.set(tx, 0, tz);
      obj.rotation.y = rnd() * 6;
      this.env.add(obj);
    }
    // street lamps along the lot sides
    for (let z = -0.5; z <= H + 0.5; z += 3) {
      for (const lx of [-RING - 0.55, W + RING + 0.55]) this.env.add(this.makeLamp(lx, z));
    }

    // drifting cloud shadows (daytime only)
    if (!theme.night) {
      const cmat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.08, depthWrite: false });
      for (let i = 0; i < 3; i++) {
        const c = new THREE.Mesh(new THREE.CircleGeometry(1, 20), cmat);
        c.rotation.x = -Math.PI / 2;
        c.scale.set(3 + rnd() * 2, 2 + rnd() * 1.5, 1);
        c.position.set(this.bounds.minX - 4 + rnd() * 20, 0.015, -6 + rnd() * (H + 8));
        c.userData.speed = 0.25 + rnd() * 0.25;
        this.cloudShadows.push(c);
        this.env.add(c);
      }
    } else {
      // stars in the sky aren't visible from this angle; add twinkling window lights via blinkers
    }
  }

  makeBuilding(w, h, d, col, rnd, x, z) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(this.bodyGeo(w, h, d, 0.06), this.mat(col, { roughness: 0.75 }));
    body.position.y = h / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);
    const roofType = rnd();
    if (roofType < 0.5) {
      const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.75, 0.9, 4), this.mat(0xb5513a, { roughness: 0.8 }));
      roof.rotation.y = Math.PI / 4;
      roof.scale.set(w / Math.max(w, d), 1, d / Math.max(w, d));
      roof.position.y = h + 0.45;
      roof.castShadow = true;
      g.add(roof);
      if (this.theme.id === 'snow') {
        const cap = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.5, 0.45, 4), this.mat(0xffffff));
        cap.rotation.y = Math.PI / 4;
        cap.scale.copy(roof.scale);
        cap.position.y = h + 0.72;
        g.add(cap);
      }
    } else {
      const ledge = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.12, d + 0.1), this.mat(lighten(col, 0.4)));
      ledge.position.y = h + 0.06;
      g.add(ledge);
    }
    const night = this.theme.night;
    const winOn = this.mat(0xfff3b0, { emissive: 0xffd36b, emissiveIntensity: night ? 1.2 : 0.05, roughness: 0.3 });
    const winOff = this.mat(night ? 0x26324d : 0x9fd8ff, { roughness: 0.15, metalness: 0.3 });
    const cols = Math.max(1, Math.floor(w / 0.55));
    const rows = Math.max(1, Math.floor((h - 0.4) / 0.6));
    const wg = new THREE.PlaneGeometry(0.28, 0.32);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const on = night ? rnd() < 0.6 : rnd() < 0.15;
        const win = new THREE.Mesh(wg, on ? winOn : winOff);
        win.position.set(-w / 2 + (w / cols) * (c + 0.5), 0.55 + r * 0.6, d / 2 + 0.005);
        g.add(win);
      }
    // door
    const door = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.5), this.mat(0x6d4c41));
    door.position.set((rnd() - 0.5) * (w - 0.6), 0.25, d / 2 + 0.006);
    g.add(door);
    g.position.set(x, 0, z);
    return g;
  }

  makeTree(type, rnd) {
    const t = new THREE.Group();
    const trunkMat = this.mat(0x8a5a3b);
    if (type === 'palm') {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 1.3, 7), trunkMat);
      trunk.position.y = 0.65;
      trunk.rotation.z = 0.15;
      trunk.castShadow = true;
      t.add(trunk);
      const leafMat = this.mat(0x3fbf5a, { side: THREE.DoubleSide });
      for (let i = 0; i < 6; i++) {
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.9, 4), leafMat);
        leaf.position.set(0.1, 1.3, 0);
        leaf.rotation.set(Math.PI / 2.4, (i / 6) * Math.PI * 2, 0, 'YXZ');
        leaf.translateY(0.4);
        leaf.castShadow = true;
        t.add(leaf);
      }
      const coco = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), this.mat(0x6d4c41));
      coco.position.set(0.12, 1.22, 0.08);
      t.add(coco);
    } else if (type === 'pine') {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.4, 7), trunkMat);
      trunk.position.y = 0.2;
      t.add(trunk);
      const green = this.mat(0x2e7d4f);
      const snow = this.mat(0xffffff);
      for (let i = 0; i < 3; i++) {
        const r = 0.5 - i * 0.12;
        const cone = new THREE.Mesh(new THREE.ConeGeometry(r, 0.55, 8), green);
        cone.position.y = 0.55 + i * 0.32;
        cone.castShadow = true;
        t.add(cone);
        const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 0.55, 0.26, 8), snow);
        cap.position.y = 0.72 + i * 0.32;
        t.add(cap);
      }
    } else if (type === 'cactus') {
      const cm = this.mat(0x4caf50, { roughness: 0.7 });
      const main = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.6, 4, 8), cm);
      main.position.y = 0.42;
      main.castShadow = true;
      t.add(main);
      for (const sx of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.22, 4, 8), cm);
        arm.position.set(sx * 0.19, 0.5 + rnd() * 0.15, 0);
        t.add(arm);
        const join = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.08, 4, 8), cm);
        join.rotation.z = Math.PI / 2;
        join.position.set(sx * 0.12, arm.position.y - 0.12, 0);
        t.add(join);
      }
      if (rnd() < 0.5) {
        const fl = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), this.mat(0xff5c8a));
        fl.position.y = 0.86;
        t.add(fl);
      }
    } else {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.42, 8), trunkMat);
      trunk.position.y = 0.21;
      trunk.castShadow = true;
      t.add(trunk);
      const greens = this.theme.night ? [0x2e6b45, 0x357a4f, 0x285f3d] : type === 'autumn' ? [0xff7a2f, 0xffb000, 0xe2553d] : [0x4caf50, 0x66c75f, 0x3d9b46];
      const lm = this.mat(greens[Math.floor(rnd() * 3)], { flatShading: true, roughness: 0.8 });
      const big = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), lm);
      big.position.y = 0.65;
      big.castShadow = true;
      t.add(big);
      const small = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 0), lm);
      small.position.set(0.22, 0.85, 0.1);
      small.castShadow = true;
      t.add(small);
      if (rnd() < 0.35 && !this.theme.night) {
        const fruitMat = this.mat(0xff5252);
        for (let i = 0; i < 4; i++) {
          const f = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 5), fruitMat);
          const a = rnd() * 6;
          f.position.set(Math.cos(a) * 0.38, 0.6 + rnd() * 0.25, Math.sin(a) * 0.38);
          t.add(f);
        }
      }
    }
    t.scale.setScalar(0.8 + rnd() * 0.5);
    return t;
  }

  makeBush(rnd) {
    const g = new THREE.Group();
    const cols = this.theme.id === 'snow' ? [0xffffff, 0xe8f2fb] : [0x58b84e, 0x6ccc5c];
    const m = this.mat(cols[Math.floor(rnd() * cols.length)], { flatShading: true });
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.18 + rnd() * 0.08, 0), m);
      b.position.set((i - 1) * 0.2, 0.14, rnd() * 0.1);
      b.castShadow = true;
      g.add(b);
    }
    if (this.theme.id !== 'snow') {
      const fm = this.mat(this.theme.flowers[1]);
      for (let i = 0; i < 3; i++) {
        const f = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 5), fm);
        f.position.set((rnd() - 0.5) * 0.5, 0.28, (rnd() - 0.5) * 0.2);
        g.add(f);
      }
    }
    return g;
  }

  makeSnowman() {
    const g = new THREE.Group();
    const w = this.mat(0xffffff, { roughness: 0.9 });
    const a = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), w);
    a.position.y = 0.2;
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), w);
    b.position.y = 0.48;
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.12, 6), this.mat(0xff8f1f));
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 0.5, 0.17);
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.14, 10), this.mat(0x222222));
    hat.position.y = 0.66;
    a.castShadow = b.castShadow = true;
    g.add(a, b, nose, hat);
    return g;
  }

  makeUmbrella(rnd) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 6), this.mat(0xffffff));
    pole.position.y = 0.45;
    const cols = [0xff5252, 0x40c4ff, 0xffd740];
    const top = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.22, 8), this.mat(cols[Math.floor(rnd() * 3)]));
    top.position.y = 0.95;
    top.castShadow = true;
    const towel = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.7), this.mat(0xffffff));
    towel.rotation.x = -Math.PI / 2;
    towel.position.set(0.35, 0.01, 0.1);
    g.add(pole, top, towel);
    return g;
  }

  makeLamp(x, z) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 1.1, 6), this.mat(0x5b6574));
    pole.position.y = 0.55;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), this.mat(0xfff3c0, { emissive: 0xffd36b, emissiveIntensity: this.theme.night ? 2.2 : 0.1 }));
    head.position.y = 1.12;
    pole.castShadow = true;
    g.add(pole, head);
    if (this.theme.night) {
      const glow = new THREE.Mesh(new THREE.CircleGeometry(0.55, 20), new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.18, depthWrite: false }));
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 0.012;
      g.add(glow);
    }
    g.position.set(x, 0, z);
    return g;
  }

  buildSlotPads(game) {
    if (this.padGroup) this.env.remove(this.padGroup);
    this.padGroup = new THREE.Group();
    this.lockedPads = [];
    const makeTex = (border, fill, label, labelColor) =>
      canvasTexture(128, 448, (g, w, h) => {
        g.fillStyle = fill;
        g.fillRect(0, 0, w, h);
        g.strokeStyle = border;
        g.lineWidth = 8;
        if (label === '+') g.setLineDash([22, 14]);
        g.strokeRect(6, 6, w - 12, h - 12);
        g.setLineDash([]);
        g.fillStyle = labelColor;
        g.font = 'bold 80px system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(label, w / 2, h - 70);
      });
    if (!this.padTex) {
      this.padTex = {
        normal: new THREE.MeshStandardMaterial({ map: makeTex('#ffd34d', '#5d6676', 'P', 'rgba(255,255,255,0.15)'), roughness: 0.9 }),
        locked: new THREE.MeshStandardMaterial({ map: makeTex('#9aa6bb', '#4a5263', '+', 'rgba(140,230,150,0.95)'), roughness: 0.9 }),
      };
    }
    const padGeo = new THREE.PlaneGeometry(1.02, 3.95);
    const z = SLOT_HEAD_Z - 0.45 + 3.95 / 2;
    for (let i = 0; i < MAX_SLOTS; i++) {
      const locked = i >= game.slots.length;
      let mat = locked ? this.padTex.locked : this.padTex.normal;
      const col = !locked && game.slotColors[i];
      if (col) {
        const key = 'pad_' + col;
        if (!this.padTex[key]) {
          const hex = '#' + new THREE.Color(PALETTE[col]).getHexString();
          this.padTex[key] = new THREE.MeshStandardMaterial({ map: makeTex(hex, '#5d6676', '★', hex), roughness: 0.9 });
        }
        mat = this.padTex[key];
      }
      const p = new THREE.Mesh(padGeo, mat);
      p.rotation.x = -Math.PI / 2;
      p.position.set(this.slotX(i), 0.004, z);
      p.receiveShadow = true;
      this.padGroup.add(p);
      if (col) {
        const tint = new THREE.Mesh(padGeo, new THREE.MeshBasicMaterial({ color: PALETTE[col], transparent: true, opacity: 0.22, depthWrite: false }));
        tint.rotation.x = -Math.PI / 2;
        tint.position.set(this.slotX(i), 0.006, z);
        this.padGroup.add(tint);
      }
      if (locked) {
        p.userData.lockedSlot = true;
        this.lockedPads.push(p);
      }
    }
    this.env.add(this.padGroup);
  }

  /* ------------------------------------------------------------ */
  /* vehicles                                                       */
  /* ------------------------------------------------------------ */

  makeVehicle(v) {
    const g = new THREE.Group();
    const inner = new THREE.Group();
    g.add(inner);
    const L = v.len - 0.16;
    const colorKey = v.revealed ? v.color : 'mystery';
    const bodyMat = colorKey === 'mystery' ? this.mat(PALETTE.mystery) : this.paint(colorKey);
    const glass = this.mat(0x1f2c3d, { roughness: 0.12, metalness: 0.5 });
    const white = this.mat(0xffffff, { roughness: 0.4 });
    const dark = this.mat(0x2a2f38, { roughness: 0.7 });
    const parts = { bodyMeshes: [], wheels: [], pick: [] };
    const add = (mesh, isBody = false, pick = true) => {
      inner.add(mesh);
      if (isBody) parts.bodyMeshes.push(mesh);
      if (pick) parts.pick.push(mesh);
      return mesh;
    };
    const variant = v.variant || (v.kind === 'car' ? 'sedan' : v.kind === 'van' ? 'van' : 'city');
    let roofY;
    let roofZ = 0; // center of roof area for arrow / pips
    let roofSpan = L * 0.8;

    if (v.kind === 'car') {
      const low = variant === 'sport';
      const bodyH = low ? 0.24 : 0.3;
      const body = add(new THREE.Mesh(this.bodyGeo(0.8, bodyH, L, 0.11), bodyMat), true);
      body.position.y = 0.17 + bodyH / 2 + 0.03;
      if (variant === 'pickup') {
        const cab = add(new THREE.Mesh(this.bodyGeo(0.7, 0.26, L * 0.38, 0.08), glass));
        cab.position.set(0, 0.55, -L * 0.18);
        const roof = add(new THREE.Mesh(this.bodyGeo(0.66, 0.06, L * 0.34, 0.03), bodyMat), true);
        roof.position.set(0, 0.69, -L * 0.18);
        const bed = add(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.05, L * 0.4), dark), false, false);
        bed.position.set(0, 0.47, L * 0.25);
        roofY = 0.73;
        roofZ = -L * 0.18;
        roofSpan = L * 0.3;
      } else if (variant === 'beetle') {
        const dome = add(new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), bodyMat), true);
        dome.scale.set(0.9, 0.62, L * 0.62 / 0.42 * 0.5);
        dome.position.set(0, 0.46, L * 0.03);
        const win = add(new THREE.Mesh(this.bodyGeo(0.62, 0.14, L * 0.36, 0.06), glass));
        win.position.set(0, 0.56, L * 0.03);
        roofY = 0.73;
        roofZ = L * 0.03;
        roofSpan = L * 0.4;
      } else {
        const cabinH = low ? 0.18 : 0.24;
        const cabin = add(new THREE.Mesh(this.bodyGeo(0.68, cabinH, L * (low ? 0.42 : 0.52), 0.08), glass));
        const cy = body.position.y + bodyH / 2 + cabinH / 2 - 0.02;
        cabin.position.set(0, cy, L * (low ? 0.1 : 0.06));
        const roof = add(new THREE.Mesh(this.bodyGeo(0.62, 0.06, L * (low ? 0.36 : 0.46), 0.03), bodyMat), true);
        roof.position.set(0, cy + cabinH / 2 + 0.02, L * (low ? 0.1 : 0.06));
        roofY = cy + cabinH / 2 + 0.06;
        roofZ = L * (low ? 0.1 : 0.06);
        roofSpan = L * 0.42;
        if (variant === 'sport') {
          const sp = add(new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.04, 0.16), dark), false, false);
          sp.position.set(0, 0.52, L / 2 - 0.1);
          for (const sx of [-0.3, 0.3]) {
            const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.04), dark);
            leg.position.set(sx, 0.45, L / 2 - 0.1);
            inner.add(leg);
          }
          const stripe = add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.01, L * 0.98), white), false, false);
          stripe.position.set(0, body.position.y + bodyH / 2 + 0.002, 0);
        }
        if (variant === 'taxi') {
          const sign = add(new THREE.Mesh(this.bodyGeo(0.34, 0.1, 0.14, 0.03), this.mat(0xfff7d1, { emissive: 0xffe08a, emissiveIntensity: 0.35 })), false, false);
          sign.position.set(0, roofY + 0.05, roofZ - L * 0.17);
          const checks = add(new THREE.Mesh(new THREE.BoxGeometry(0.81, 0.05, L * 0.6), this.mat(0x222222)), false, false);
          checks.position.set(0, body.position.y, 0);
          checks.scale.set(1.002, 1, 1);
        }
        if (variant === 'police') {
          const bar = new THREE.Group();
          const red = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, 0.1), this.mat(0xff2a2a, { emissive: 0xff2a2a, emissiveIntensity: 1 }));
          const blue = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, 0.1), this.mat(0x2a6bff, { emissive: 0x2a6bff, emissiveIntensity: 1 }));
          red.position.x = -0.1;
          blue.position.x = 0.1;
          bar.add(red, blue);
          bar.position.set(0, roofY + 0.035, roofZ - L * 0.17);
          inner.add(bar);
          this.blinkers.push({ a: red.material, b: blue.material, phase: Math.random() * 3 });
          const door = add(new THREE.Mesh(new THREE.BoxGeometry(0.815, 0.12, L * 0.36), white), false, false);
          door.position.set(0, body.position.y, 0);
        }
      }
    } else if (v.kind === 'van') {
      const bodyH = 0.5;
      const body = add(new THREE.Mesh(this.bodyGeo(0.84, bodyH, L, 0.12), bodyMat), true);
      body.position.y = 0.17 + bodyH / 2;
      const band = add(new THREE.Mesh(this.bodyGeo(0.86, 0.17, L * 0.82, 0.05), glass));
      band.position.set(0, 0.17 + bodyH * 0.68, L * 0.02);
      const front = add(new THREE.Mesh(this.bodyGeo(0.7, 0.2, 0.05, 0.02), glass));
      front.position.set(0, 0.17 + bodyH * 0.66, -L / 2 + 0.01);
      const roof = add(new THREE.Mesh(this.bodyGeo(0.76, 0.05, L * 0.94, 0.02), bodyMat), true);
      roof.position.y = 0.17 + bodyH + 0.02;
      roofY = 0.17 + bodyH + 0.05;
      if (variant === 'icecream') {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.3, 10), this.mat(0xe0a85a));
        cone.rotation.x = Math.PI;
        cone.position.set(0, roofY + 0.15, -L * 0.32);
        const scoop = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), this.mat(0xffb3d1));
        scoop.position.set(0, roofY + 0.33, -L * 0.32);
        inner.add(cone, scoop);
        roofZ = L * 0.1;
        roofSpan = L * 0.55;
      }
      if (variant === 'delivery') {
        const box = add(new THREE.Mesh(this.bodyGeo(0.86, 0.6, L * 0.6, 0.05), bodyMat), true, true);
        box.position.set(0, 0.17 + 0.3, L * 0.19);
        roofY = 0.17 + 0.62;
        roofZ = L * 0.19;
        roofSpan = L * 0.52;
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.87, 0.08, L * 0.58), white);
        stripe.position.set(0, 0.5, L * 0.19);
        inner.add(stripe);
      }
      if (variant === 'minibus') {
        const rack = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, L * 0.5), dark);
        rack.position.set(0, roofY + 0.04, -L * 0.15);
        inner.add(rack);
        roofZ = L * 0.15;
        roofSpan = L * 0.5;
      }
    } else {
      const double = variant === 'double';
      const bodyH = double ? 0.8 : 0.56;
      const body = add(new THREE.Mesh(this.bodyGeo(0.84, bodyH, L, 0.12), bodyMat), true);
      body.position.y = 0.17 + bodyH / 2;
      const bands = double ? [0.17 + 0.32, 0.17 + 0.64] : [0.17 + bodyH * 0.68];
      for (const by of bands) {
        const band = add(new THREE.Mesh(this.bodyGeo(0.86, 0.17, L * 0.86, 0.05), glass));
        band.position.set(0, by, L * 0.02);
      }
      const front = add(new THREE.Mesh(this.bodyGeo(0.7, 0.22, 0.05, 0.02), glass));
      front.position.set(0, bands[0], -L / 2 + 0.01);
      const roof = add(new THREE.Mesh(this.bodyGeo(0.76, 0.05, L * 0.94, 0.02), bodyMat), true);
      roof.position.y = 0.17 + bodyH + 0.02;
      roofY = 0.17 + bodyH + 0.05;
      if (variant === 'school') {
        const hood = add(new THREE.Mesh(this.bodyGeo(0.78, 0.32, 0.4, 0.08), bodyMat), true);
        hood.position.set(0, 0.33, -L / 2 - 0.02);
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.862, 0.05, L * 0.96), dark);
        stripe.position.set(0, 0.36, 0);
        inner.add(stripe);
      }
      if (variant === 'city') {
        const dest = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.02), this.mat(0xffb300, { emissive: 0xffb300, emissiveIntensity: 0.8 }));
        dest.position.set(0, 0.17 + bodyH - 0.08, -L / 2 - 0.005);
        inner.add(dest);
      }
    }

    // headlights & taillights
    const lightMat = this.mat(0xfff6c8, { emissive: 0xfff2a0, emissiveIntensity: this.theme.night ? 1.6 : 0.5 });
    const tailMat = this.mat(0xff3b30, { emissive: 0xff3b30, emissiveIntensity: this.theme.night ? 1.2 : 0.3 });
    for (const sx of [-0.27, 0.27]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.07, 0.03), lightMat);
      hl.position.set(sx, 0.32, -L / 2 - 0.005 - (variant === 'school' ? 0.22 : 0));
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.03), tailMat);
      tl.position.set(sx, 0.34, L / 2 + 0.005);
      inner.add(hl, tl);
    }
    if (this.style === 'neon' && v.revealed) {
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.15, L + 0.35), new THREE.MeshBasicMaterial({ color: PALETTE[v.color], transparent: true, opacity: 0.45, depthWrite: false }));
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 0.015;
      inner.add(glow);
      parts.glow = glow;
    }
    if (this.theme.night) {
      const beam = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.9), new THREE.MeshBasicMaterial({ color: 0xfff2a0, transparent: true, opacity: 0.16, depthWrite: false }));
      beam.rotation.x = -Math.PI / 2;
      beam.position.set(0, 0.02, -L / 2 - 0.5);
      inner.add(beam);
    }
    // wheels
    const wMat = this.mat(0x22262c, { roughness: 0.9 });
    const hubMat = this.mat(0xc9d1db, { metalness: 0.6, roughness: 0.3 });
    const axles = v.kind === 'bus' ? [-L / 2 + 0.45, L / 2 - 0.45, L / 2 - 0.85] : [-L / 2 + 0.38, L / 2 - 0.38];
    for (const z of axles)
      for (const x of [-0.41, 0.41]) {
        const wg = new THREE.Group();
        wg.add(new THREE.Mesh(this.geo.wheel, wMat), new THREE.Mesh(this.geo.hub, hubMat));
        wg.position.set(x, WHEEL_R, z);
        inner.add(wg);
        parts.wheels.push(wg);
      }

    const arrow = new THREE.Mesh(this.geo.arrow, this.mat(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.4 }));
    arrow.position.set(0, roofY + 0.012, roofZ);
    inner.add(arrow);
    parts.arrow = arrow;

    if (!v.revealed) {
      const q = new THREE.Mesh(this.geo.qGeo, this.geo.qMat);
      q.position.set(0, roofY + 0.03, roofZ);
      q.renderOrder = 2;
      inner.add(q);
      parts.q = q;
      arrow.position.z = roofZ + 0.02;
      q.position.y = roofY + 0.05;
    }

    // seat pips (shown when parked)
    const pips = new THREE.Group();
    const rows = Math.ceil(v.cap / 2);
    const span = Math.min(roofSpan, rows * 0.19);
    for (let i = 0; i < v.cap; i++) {
      const r = Math.floor(i / 2);
      const c = i % 2;
      const p = new THREE.Mesh(this.geo.pip, this.mat(0xe8edf2));
      p.position.set(c ? 0.13 : -0.13, roofY + 0.03, roofZ - span / 2 + (rows === 1 ? 0 : (r * span) / (rows - 1)));
      pips.add(p);
    }
    pips.visible = false;
    inner.add(pips);
    parts.pips = pips;

    const casters = new Set(parts.pick);
    inner.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = casters.has(o);
        o.userData.vid = v.id;
      }
    });
    g.userData = { id: v.id, len: v.len, parts, heading: 0, inner, lastPos: new THREE.Vector3(), phase: Math.random() * 6 };
    if (v.ice > 0) this.addIce(g, v.ice);
    return g;
  }

  iceLabelTex(n) {
    return canvasTexture(128, 128, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(w / 2, h / 2, 54, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#4fb3ff';
      g.lineWidth = 10;
      g.stroke();
      g.fillStyle = '#1b6fd1';
      g.font = 'bold 76px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(n), w / 2, h / 2 + 4);
    });
  }

  addIce(m, n) {
    const L = m.userData.len - 0.1;
    const ice = new THREE.Group();
    if (!this.iceTex) {
      this.iceTex = canvasTexture(128, 256, (g, w, h) => {
        const gr = g.createLinearGradient(0, 0, w, h);
        gr.addColorStop(0, '#e8fbff');
        gr.addColorStop(0.5, '#8fdcff');
        gr.addColorStop(1, '#c9f1ff');
        g.fillStyle = gr;
        g.fillRect(0, 0, w, h);
        g.strokeStyle = 'rgba(255,255,255,0.9)';
        g.lineWidth = 4;
        for (let i = 0; i < 7; i++) {
          g.beginPath();
          const x = Math.random() * w,
            y = Math.random() * h;
          g.moveTo(x, y);
          g.lineTo(x + (Math.random() - 0.5) * 60, y + (Math.random() - 0.5) * 80);
          g.stroke();
        }
      });
    }
    const block = new THREE.Mesh(
      this.bodyGeo(0.98, 0.9, L, 0.12),
      new THREE.MeshStandardMaterial({ map: this.iceTex, color: 0xffffff, transparent: true, opacity: 0.86, roughness: 0.15, emissive: 0x5cc8ff, emissiveIntensity: 0.35 })
    );
    block.position.y = 0.45;
    block.userData.vid = m.userData.id;
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.78), new THREE.MeshBasicMaterial({ map: this.iceLabelTex(n), transparent: true, depthWrite: false }));
    label.rotation.x = -Math.PI / 2;
    label.position.y = 0.95;
    label.renderOrder = 3;
    ice.add(block, label);
    m.userData.inner.add(ice);
    m.userData.parts.pick.push(block);
    m.userData.ice = { group: ice, label, block };
  }

  setIce(id, n) {
    const m = this.vehMeshes.get(id);
    if (!m || !m.userData.ice) return;
    const ice = m.userData.ice;
    if (n > 0) {
      ice.label.material.map = this.iceLabelTex(n);
      ice.label.material.needsUpdate = true;
      this.pop(ice.label, 0.25, 0.3);
      return;
    }
    // shatter
    m.userData.inner.remove(ice.group);
    m.userData.ice = null;
    const shardMat = new THREE.MeshStandardMaterial({ color: 0xd8f3ff, transparent: true, opacity: 0.9, roughness: 0.1 });
    for (let i = 0; i < 12; i++) {
      const sh = new THREE.Mesh(this.geo.puff, shardMat.clone());
      const x = m.position.x,
        z = m.position.z;
      const a = Math.random() * Math.PI * 2;
      const sp = 0.6 + Math.random() * 0.9;
      const vy = 1.5 + Math.random() * 2;
      this.fxGroup.add(sh);
      this.tween(this.time, 0.6, (k) => {
        sh.position.set(x + Math.cos(a) * sp * k, 0.5 + vy * k - 3 * k * k, z + Math.sin(a) * sp * k);
        sh.rotation.set(k * 8, k * 6, 0);
        sh.material.opacity = 0.9 * (1 - k);
      }, () => this.fxGroup.remove(sh));
    }
  }

  placeInLot(m, v) {
    const cells = vehicleCells(v);
    const cx = cells.reduce((s, c) => s + c[0] + 0.5, 0) / cells.length;
    const cz = cells.reduce((s, c) => s + c[1] + 0.5, 0) / cells.length;
    const d = DIRS[v.dir];
    m.position.set(cx, 0, cz);
    m.userData.heading = headingOf(d.dx, d.dy);
    m.rotation.y = m.userData.heading;
    m.userData.lastPos.copy(m.position);
  }

  makePassenger(color) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(this.geo.paxBody, this.mat(PALETTE[color], { roughness: 0.6 }));
    body.position.y = 0.26;
    const head = new THREE.Mesh(this.geo.paxHead, this.mat(SKIN[Math.floor(Math.random() * SKIN.length)]));
    head.position.y = 0.53;
    const hair = new THREE.Mesh(this.geo.paxHair, this.mat(HAIR[Math.floor(Math.random() * HAIR.length)]));
    hair.position.y = 0.545;
    hair.rotation.x = -0.25;
    const eyeMat = this.mat(0x1d1d1d);
    const e1 = new THREE.Mesh(this.geo.eye, eyeMat);
    const e2 = new THREE.Mesh(this.geo.eye, eyeMat);
    e1.position.set(-0.04, 0.54, 0.095);
    e2.position.set(0.04, 0.54, 0.095);
    body.castShadow = head.castShadow = true;
    g.add(body, head, hair, e1, e2);
    g.userData.phase = Math.random() * 6;
    g.userData.body = body;
    return g;
  }

  setRevealed(id, color) {
    const m = this.vehMeshes.get(id);
    if (!m) return;
    const parts = m.userData.parts;
    const mat = this.paint(color);
    for (const b of parts.bodyMeshes) b.material = mat;
    if (parts.q) parts.q.visible = false;
    parts.arrow.position.z -= 0.02;
    this.pop(m, 0.3);
    this.sparkle(m.position.x, 0.8, m.position.z, PALETTE[color], 8);
  }

  /* ------------------------------------------------------------ */
  /* animation primitives                                           */
  /* ------------------------------------------------------------ */

  at(time, fn) {
    this.tasks.push({ at: time, fn });
    this.endT = Math.max(this.endT, time);
  }
  tween(t0, dur, update, done) {
    this.tweens.push({ t0, dur, update, done });
    this.endT = Math.max(this.endT, t0 + dur);
  }

  pop(obj, dur = 0.3, amt = 0.18) {
    this.tween(this.time, dur, (k) => obj.scale.setScalar(1 + Math.sin(k * Math.PI) * amt), () => obj.scale.setScalar(1));
  }

  squash(obj) {
    const inner = obj.userData.inner;
    this.tween(this.time, 0.25, (k) => {
      const s = Math.sin(k * Math.PI) * 0.12 * (1 - k);
      inner.scale.set(1 + s, 1 - s, 1 + s * 0.5);
    }, () => inner.scale.set(1, 1, 1));
  }

  shake(obj) {
    const inner = obj.userData.inner;
    this.tween(this.time, 0.35, (k) => {
      inner.rotation.z = Math.sin(k * Math.PI * 6) * 0.08 * (1 - k);
    }, () => (inner.rotation.z = 0));
  }

  driveHeadAlong(m, pts, t0, speed, { endHeading = null, onDone, exhaust = false } = {}) {
    const lens = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const l = pts[i].distanceTo(pts[i - 1]);
      lens.push(l);
      total += l;
    }
    const dur = Math.max(0.15, total / speed);
    const half = (m.userData.len - 1) / 2 + 0.5 - 0.08;
    let heading = m.userData.heading;
    const tmp = new THREE.Vector3();
    let lastPuff = 0;
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
        if (exhaust && this.time - lastPuff > 0.07) {
          lastPuff = this.time;
          const back = m.userData.len / 2;
          this.puff(m.position.x + Math.sin(heading) * back, m.position.z + Math.cos(heading) * back);
        }
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
      corners
        .map(([s, c]) => [((s - s1 + per) % per) || per, c])
        .filter(([d]) => d < cw)
        .sort((a, b) => a[0] - b[0])
        .forEach(([, c]) => pts.push(c.clone()));
    } else {
      corners
        .map(([s, c]) => [((s1 - s + per) % per) || per, c])
        .filter(([d]) => d < ccw)
        .sort((a, b) => a[0] - b[0])
        .forEach(([, c]) => pts.push(c.clone()));
    }
    pts.push(T);
    if (Math.abs(tx - sx) > 1e-3) pts.push(new THREE.Vector3(sx, 0, z0));
    pts.push(new THREE.Vector3(sx, 0, SLOT_HEAD_Z));
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
            this.bubble(m.position.x, m.position.z, '💢');
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
          let start = Math.max(now, this.slotFree[ev.slot] - dur + 0.05);
          // don't drive through a vehicle that is still physically leaving the lot
          const dd = DIRS[v.dir];
          const pathCells = new Set();
          let cx = v.hx + dd.dx,
            cy = v.hy + dd.dy,
            steps = 0;
          while (cx >= 0 && cy >= 0 && cx < game.w && cy < game.h) {
            pathCells.add(cx + ',' + cy);
            cx += dd.dx;
            cy += dd.dy;
            steps++;
          }
          for (const info of this.lotClear.values()) {
            if (info.clearT <= start) continue;
            for (const c of info.cells)
              if (pathCells.has(c)) {
                start = Math.max(start, info.clearT);
                break;
              }
          }
          this.lotClear.set(ev.id, {
            cells: vehicleCells(v).map(([x, y]) => x + ',' + y),
            clearT: start + ((steps + RING + v.len) / SPEED) * 1.2,
          });
          sfx.go();
          haptics.light();
          this.pop(m, 0.18, 0.08);
          this.driveHeadAlong(m, pts, start, SPEED, {
            endHeading: 0,
            exhaust: true,
            onDone: () => {
              m.userData.parts.arrow.visible = false;
              m.userData.parts.pips.visible = true;
              this.squash(m);
            },
          });
          this.arriveT.set(ev.id, start + dur);
          this.removeHint();
          break;
        }
        case 'crane': {
          const m = this.vehMeshes.get(ev.id);
          if (m && m.userData.ice) this.setIce(ev.id, 0);
          const from = m.position.clone();
          const fromH = m.userData.heading;
          const half = (m.userData.len - 1) / 2 + 0.5 - 0.08;
          const to = new THREE.Vector3(this.slotX(ev.slot), 0, SLOT_HEAD_Z + half);
          const dur = 1.0;
          const start = Math.max(now, this.slotFree[ev.slot] - dur + 0.05);
          sfx.booster();
          const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 6, 6), this.mat(0x333333));
          this.fxGroup.add(hook);
          this.tween(start, dur, (k) => {
            const e = easeInOut(k);
            m.position.set(lerp(from.x, to.x, e), Math.sin(k * Math.PI) * 2.4, lerp(from.z, to.z, e));
            m.rotation.y = m.userData.heading = angleLerp(fromH, 0, e);
            hook.position.set(m.position.x, m.position.y + 3.8, m.position.z);
          }, () => {
            this.fxGroup.remove(hook);
            m.position.copy(to);
            m.rotation.y = m.userData.heading = 0;
            m.userData.parts.arrow.visible = false;
            m.userData.parts.pips.visible = true;
            this.dust(to.x, to.z);
            this.squash(m);
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
          this.buildSlotPads(game);
          sfx.booster();
          const x = this.slotX(ev.slot);
          this.sparkle(x, 0.3, SLOT_HEAD_Z + 1.5, 0xffd34d, 14);
          break;
        }
        case 'ice': {
          this.at(now + 0.1, () => this.setIce(ev.id, ev.ice));
          break;
        }
        case 'thaw': {
          this.at(now + 0.1, () => {
            this.setIce(ev.id, 0);
            sfx.shatter && sfx.shatter();
          });
          break;
        }
        case 'frozen': {
          const m = this.vehMeshes.get(ev.id);
          if (m) this.shake(m);
          sfx.bump();
          haptics.medium();
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
        p.position.set(lerp(from.x, to.x, k), Math.sin(k * Math.PI) * 0.45, lerp(from.z, to.z, k));
        p.scale.setScalar(1 - k * 0.55);
        p.rotation.y = k * Math.PI;
      }, () => this.paxGroup.remove(p));
    }
    this.paxMeshes.forEach((pm, i) => (pm.userData.target = this.queuePos(i)));
    if (this.visQueue.length > this.paxMeshes.length) {
      const i = this.paxMeshes.length;
      const np = this.makePassenger(this.visQueue[i]);
      const tp = this.queuePos(i);
      np.position.copy(tp).add(new THREE.Vector3(0, 0, -0.6));
      np.userData.target = tp;
      this.paxMeshes.push(np);
      this.paxGroup.add(np);
    }
    if (this.onBoard) this.onBoard();
    this.at(this.time + 0.26, () => {
      if (!m) return;
      const pip = m.userData.parts.pips.children[seat];
      if (pip) {
        pip.material = this.mat(PALETTE[color], { emissive: PALETTE[color], emissiveIntensity: 0.25 });
        pip.scale.setScalar(1.4);
        this.tween(this.time, 0.15, (k) => pip.scale.setScalar(1.4 - k * 0.4));
      }
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
    const head = new THREE.Vector3(slotX, 0, SLOT_HEAD_Z);
    const pts = [head, new THREE.Vector3(slotX, 0, ROAD_Z), new THREE.Vector3(this.bounds.maxX + 8, 0, ROAD_Z)];
    this.sparkle(m.position.x, 1.0, m.position.z, 0xffd34d, 10);
    this.bubble(m.position.x, m.position.z, ['😄', '🎉', '👍', '😍', '🥳'][Math.floor(Math.random() * 5)]);
    this.driveHeadAlong(m, pts, this.time, 11, { exhaust: true, onDone: () => this.vehGroup.remove(m) });
    this.dust(slotX, SLOT_HEAD_Z + 1.2);
    if (this.onDepart) this.onDepart();
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

  /* ------------------------------------------------------------ */
  /* particles                                                      */
  /* ------------------------------------------------------------ */

  dust(x, z) {
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Mesh(this.geo.puff, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false }));
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

  puff(x, z) {
    const s = new THREE.Mesh(this.geo.puff, new THREE.MeshBasicMaterial({ color: 0xdfe4ea, transparent: true, opacity: 0.55, depthWrite: false }));
    s.position.set(x, 0.2, z);
    this.fxGroup.add(s);
    const dx = (Math.random() - 0.5) * 0.3,
      dz = (Math.random() - 0.5) * 0.3;
    this.tween(this.time, 0.5, (k) => {
      s.position.set(x + dx * k, 0.2 + k * 0.4, z + dz * k);
      s.scale.setScalar(0.6 + k * 1.4);
      s.material.opacity = 0.55 * (1 - k);
    }, () => this.fxGroup.remove(s));
  }

  sparkle(x, y, z, color, n = 10) {
    const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true });
    for (let i = 0; i < n; i++) {
      const s = new THREE.Mesh(this.geo.star, mat.clone());
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const sp = 0.8 + Math.random() * 0.8;
      s.position.set(x, y, z);
      this.fxGroup.add(s);
      const vy = 1.5 + Math.random() * 1.5;
      this.tween(this.time, 0.7, (k) => {
        s.position.set(x + Math.cos(a) * sp * k, y + vy * k - 2.5 * k * k, z + Math.sin(a) * sp * k);
        s.rotation.set(-Math.PI / 4, k * 6, 0);
        s.material.opacity = 1 - k * k;
        s.scale.setScalar(1 - k * 0.5);
      }, () => this.fxGroup.remove(s));
    }
  }

  /** floating emoji above a point (DOM overlay) */
  bubble(x, z, emoji) {
    if (!this.onBubble) return;
    const p = this.toScreen(x, 1.2, z);
    this.onBubble(p.x, p.y, emoji);
  }

  confetti() {
    const colors = Object.values(PALETTE);
    const { minX, maxX, minZ, maxZ } = this.bounds;
    const geo = new THREE.PlaneGeometry(0.16, 0.26);
    for (let i = 0; i < 110; i++) {
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
    // passengers that are still visible cheer
    for (const p of this.paxMeshes || []) p.userData.cheer = this.time;
  }

  /* ------------------------------------------------------------ */
  /* hint                                                           */
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
    this.fxGroup.add(ring);
    this.hintMesh = ring;
  }
  removeHint() {
    if (this.hintMesh) this.fxGroup.remove(this.hintMesh);
    this.hintMesh = null;
  }

  /* ------------------------------------------------------------ */

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
    if (!hits.length && this.lockedPads && this.lockedPads.length && this.onLockedSlot) {
      if (this.raycaster.intersectObjects(this.lockedPads, false).length) return this.onLockedSlot();
    }
    if (hits.length) {
      this.onPick(hits[0].object.userData.vid);
      return;
    }
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.3);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, p)) return;
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
    if (best !== null) this.onPick(best);
  }

  isBusy() {
    return this.tasks.length > 0 || this.tweens.length > 0;
  }

  whenIdle(fn, extra = 0) {
    this.at(Math.max(this.time, this.endT) + extra, fn);
  }

  update(dt) {
    this.time += dt;
    const now = this.time;
    if (this.tasks.length) {
      const due = this.tasks.filter((t) => t.at <= now);
      if (due.length) {
        this.tasks = this.tasks.filter((t) => t.at > now);
        due.sort((a, b) => a.at - b.at).forEach((t) => t.fn());
      }
    }
    if (this.tweens.length) {
      const list = this.tweens;
      this.tweens = [];
      const keep = [];
      for (const tw of list) {
        if (now < tw.t0) {
          keep.push(tw);
          continue;
        }
        const k = Math.min(1, (now - tw.t0) / tw.dur);
        tw.update(k);
        if (k >= 1) tw.done && tw.done();
        else keep.push(tw);
      }
      this.tweens = keep.concat(this.tweens);
    }
    // vehicles: wheel spin and gentle idle breathing
    if (this.vehMeshes) {
      for (const m of this.vehMeshes.values()) {
        const ud = m.userData;
        const d = Math.hypot(m.position.x - ud.lastPos.x, m.position.z - ud.lastPos.z);
        if (d > 1e-4) {
          const fwd = -Math.sin(ud.heading) * (m.position.x - ud.lastPos.x) - Math.cos(ud.heading) * (m.position.z - ud.lastPos.z);
          const rot = (Math.sign(fwd) || 1) * (d / WHEEL_R);
          for (const w of ud.parts.wheels) w.rotation.x -= rot;
          ud.lastPos.copy(m.position);
        }
      }
    }
    // police light blink
    for (const b of this.blinkers) {
      const on = Math.sin(now * 10 + b.phase) > 0;
      b.a.emissiveIntensity = on ? 1.6 : 0.1;
      b.b.emissiveIntensity = on ? 0.1 : 1.6;
    }
    for (const c of this.cloudShadows) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > this.bounds.maxX + 6) c.position.x = this.bounds.minX - 6;
    }
    if (this.paxMeshes) {
      for (const p of this.paxMeshes) {
        const tgt = p.userData.target;
        if (!tgt) continue;
        const dx = tgt.x - p.position.x,
          dz = tgt.z - p.position.z;
        const d = Math.hypot(dx, dz);
        const step = Math.min(1, (dt * 7) / Math.max(d, 0.001));
        const cheering = p.userData.cheer && now - p.userData.cheer < 2.5;
        if (d > 0.002) {
          p.position.x += dx * step;
          p.position.z += dz * step;
          p.position.y = tgt.y + Math.abs(Math.sin(now * 18 + p.userData.phase)) * 0.06;
        } else if (cheering) {
          p.position.y = tgt.y + Math.abs(Math.sin(now * 9 + p.userData.phase)) * 0.25;
        } else {
          p.position.y += (tgt.y - p.position.y) * Math.min(1, dt * 10);
          p.userData.body.scale.y = 1 + Math.sin(now * 3 + p.userData.phase) * 0.04;
          p.rotation.y = Math.sin(now * 0.8 + p.userData.phase) * 0.35;
        }
      }
    }
    if (this.hintMesh) {
      const k = (Math.sin(now * 5) + 1) / 2;
      this.hintMesh.material.opacity = 0.35 + k * 0.6;
    }
  }
}
