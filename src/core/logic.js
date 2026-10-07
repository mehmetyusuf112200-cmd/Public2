// Pure game logic — no rendering, no timing. Node-testable.

export const DIRS = {
  U: { dx: 0, dy: -1 },
  D: { dx: 0, dy: 1 },
  L: { dx: -1, dy: 0 },
  R: { dx: 1, dy: 0 },
};
export const DIR_KEYS = ['U', 'D', 'L', 'R'];

export const COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan'];

// vehicle kinds: length in cells -> seats
export const KINDS = {
  car: { len: 2, cap: 4 },
  van: { len: 3, cap: 6 },
  bus: { len: 4, cap: 10 },
};

export function vehicleCells(v) {
  const d = DIRS[v.dir];
  const cells = [];
  for (let i = 0; i < v.len; i++) cells.push([v.hx - d.dx * i, v.hy - d.dy * i]);
  return cells;
}

export class Game {
  /**
   * @param {object} level  { w, h, vehicles:[{id,color,kind,len,cap,hx,hy,dir,mystery}], queue:[color], slots }
   */
  constructor(level) {
    this.w = level.w;
    this.h = level.h;
    this.vehicles = level.vehicles.map((v) => ({
      ...v,
      state: 'lot', // lot | slot | gone
      seats: 0,
      slot: -1,
      revealed: !v.mystery,
    }));
    this.byId = new Map(this.vehicles.map((v) => [v.id, v]));
    this.queue = level.queue.slice();
    this.boarded = 0;
    this.totalPassengers = this.queue.length;
    this.slots = new Array(level.slots ?? 5).fill(null);
    this.maxSlots = 7;
    this.status = 'playing'; // playing | won | lost
    this.grid = [];
    this.rebuildGrid();
  }

  rebuildGrid() {
    this.grid = Array.from({ length: this.h }, () => new Array(this.w).fill(null));
    for (const v of this.vehicles) {
      if (v.state !== 'lot') continue;
      for (const [x, y] of vehicleCells(v)) this.grid[y][x] = v.id;
    }
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  /** returns {free:true} or {free:false, dist, blocker} where dist = empty cells before blocker */
  pathCheck(v) {
    const d = DIRS[v.dir];
    let x = v.hx + d.dx;
    let y = v.hy + d.dy;
    let dist = 0;
    while (this.inBounds(x, y)) {
      const occ = this.grid[y][x];
      if (occ !== null && occ !== v.id) return { free: false, dist, blocker: occ };
      dist++;
      x += d.dx;
      y += d.dy;
    }
    return { free: true, dist };
  }

  freeSlotIndex() {
    return this.slots.findIndex((s) => s === null);
  }

  lotVehicles() {
    return this.vehicles.filter((v) => v.state === 'lot');
  }

  /** reveal mystery vehicles that became movable. returns events */
  revealPass() {
    const ev = [];
    for (const v of this.vehicles) {
      if (v.state === 'lot' && !v.revealed && this.pathCheck(v).free) {
        v.revealed = true;
        ev.push({ type: 'reveal', id: v.id, color: v.color });
      }
    }
    return ev;
  }

  /** tap a vehicle in the lot */
  tap(id) {
    if (this.status !== 'playing') return [];
    const v = this.byId.get(id);
    if (!v || v.state !== 'lot') return [];
    const pc = this.pathCheck(v);
    if (!pc.free) return [{ type: 'blocked', id, dist: pc.dist, blocker: pc.blocker }];
    const slot = this.freeSlotIndex();
    if (slot < 0) return [{ type: 'noslot', id }];
    return this.moveToSlot(v, slot, 'exit');
  }

  /** booster: lift any vehicle to a slot ignoring blockers */
  crane(id) {
    if (this.status !== 'playing') return null;
    const v = this.byId.get(id);
    if (!v || v.state !== 'lot') return null;
    const slot = this.freeSlotIndex();
    if (slot < 0) return null;
    v.revealed = true;
    return this.moveToSlot(v, slot, 'crane');
  }

  /** booster: add a slot */
  addSlot() {
    if (this.slots.length >= this.maxSlots) return null;
    this.slots.push(null);
    const ev = [{ type: 'addslot', slot: this.slots.length - 1 }];
    if (this.status === 'lost') this.status = 'playing';
    ev.push(...this.settle());
    return ev;
  }

  /** booster: bring passengers that match parked vehicles to the front (looks at next N) */
  sortQueue(n = 16) {
    if (this.status !== 'playing' && this.status !== 'lost') return null;
    const parked = this.slots.map((id) => (id === null ? null : this.byId.get(id))).filter(Boolean);
    if (!parked.length) return null;
    const need = new Map();
    for (const v of parked) need.set(v.color, (need.get(v.color) || 0) + (v.cap - v.seats));
    const head = this.queue.slice(0, n);
    const tail = this.queue.slice(n);
    const front = [];
    const back = [];
    for (const c of head) {
      if ((need.get(c) || 0) > 0) {
        front.push(c);
        need.set(c, need.get(c) - 1);
      } else back.push(c);
    }
    // also pull matching passengers from further back
    const tail2 = [];
    for (const c of tail) {
      if ((need.get(c) || 0) > 0) {
        front.push(c);
        need.set(c, need.get(c) - 1);
      } else tail2.push(c);
    }
    this.queue = [...front, ...back, ...tail2];
    if (this.status === 'lost') this.status = 'playing';
    return [{ type: 'queue', queue: this.queue.slice() }, ...this.settle()];
  }

  moveToSlot(v, slot, how) {
    v.state = 'slot';
    v.slot = slot;
    this.slots[slot] = v.id;
    this.rebuildGrid();
    const ev = [{ type: how, id: v.id, slot, color: v.color }];
    ev.push(...this.revealPass());
    ev.push(...this.settle());
    return ev;
  }

  /** board passengers as long as possible, then evaluate win/lose */
  settle() {
    const ev = [];
    let progressed = true;
    while (progressed && this.queue.length) {
      progressed = false;
      const c = this.queue[0];
      let target = null;
      for (const id of this.slots) {
        if (id === null) continue;
        const v = this.byId.get(id);
        if (v.color === c && v.seats < v.cap) {
          target = v;
          break;
        }
      }
      if (target) {
        this.queue.shift();
        target.seats++;
        this.boarded++;
        ev.push({ type: 'board', id: target.id, slot: target.slot, color: c, seat: target.seats - 1 });
        if (target.seats >= target.cap) {
          this.slots[target.slot] = null;
          ev.push({ type: 'depart', id: target.id, slot: target.slot });
          target.state = 'gone';
          target.slot = -1;
        }
        progressed = true;
      }
    }
    if (!this.queue.length) {
      // any vehicles still around with empty seats shouldn't exist in a valid level, but clear them
      this.status = 'won';
      ev.push({ type: 'win' });
    } else if (this.freeSlotIndex() < 0) {
      this.status = 'lost';
      ev.push({ type: 'lose' });
    }
    return ev;
  }
}

/* ------------------------------------------------------------------ */
/* Level generation                                                    */
/* ------------------------------------------------------------------ */

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** level number -> generation params. Difficulty rises steadily with a gentle saw-tooth. */
export function levelParams(level) {
  const L = Math.max(1, level);
  const cycle = L % 10; // 0 = "boss" level of the decade
  const spike = cycle === 0 ? 2 : cycle === 5 ? 1 : 0;
  const relax = cycle === 1 ? -1 : 0;

  let w, h, count, colors, window, mystery, kinds;
  if (L === 1) {
    return { w: 4, h: 4, count: 3, colors: 2, window: 1, mystery: 0, kinds: ['car'], slots: 5, spike: 0 };
  }
  if (L === 2) {
    return { w: 4, h: 5, count: 5, colors: 2, window: 1, mystery: 0, kinds: ['car'], slots: 5, spike: 0 };
  }
  if (L === 3) {
    return { w: 5, h: 5, count: 6, colors: 3, window: 2, mystery: 0, kinds: ['car', 'car', 'van'], slots: 5, spike: 0 };
  }
  w = Math.min(8, 5 + Math.floor(L / 15));
  h = Math.min(10, 6 + Math.floor(L / 10));
  const cells = w * h;
  const fill = Math.min(0.8, 0.5 + L * 0.004 + spike * 0.05 + relax * 0.05);
  kinds = L < 8 ? ['car', 'car', 'van'] : L < 25 ? ['car', 'car', 'van', 'van', 'bus'] : ['car', 'van', 'van', 'bus'];
  const avgLen = kinds.reduce((s, k) => s + KINDS[k].len, 0) / kinds.length;
  count = Math.max(5, Math.round((cells * fill) / avgLen));
  colors = Math.min(COLORS.length, 3 + Math.floor(L / 9) + (spike ? 1 : 0));
  window = Math.min(L < 40 ? 3 : 4, 1 + Math.floor(L / 9) + spike + relax);
  window = Math.max(1, window);
  mystery = L < 15 ? 0 : Math.min(0.4, 0.1 + (L - 15) * 0.004 + spike * 0.05);
  return { w, h, count, colors, window, mystery, kinds, slots: 5, spike };
}

function canClearAll(w, h, vehicles) {
  // greedy peel: removal only frees space, so order doesn't matter for feasibility
  const g = Array.from({ length: h }, () => new Array(w).fill(-1));
  const alive = new Set();
  for (const v of vehicles) {
    alive.add(v.id);
    for (const [x, y] of vehicleCells(v)) g[y][x] = v.id;
  }
  const layers = [];
  while (alive.size) {
    const removable = [];
    for (const id of alive) {
      const v = vehicles[id];
      const d = DIRS[v.dir];
      let x = v.hx + d.dx;
      let y = v.hy + d.dy;
      let ok = true;
      while (x >= 0 && y >= 0 && x < w && y < h) {
        if (g[y][x] !== -1 && g[y][x] !== id) {
          ok = false;
          break;
        }
        x += d.dx;
        y += d.dy;
      }
      if (ok) removable.push(id);
    }
    if (!removable.length) return null;
    for (const id of removable) {
      alive.delete(id);
      for (const [x, y] of vehicleCells(vehicles[id])) g[y][x] = -1;
    }
    layers.push(removable);
  }
  return layers;
}

function tryBuild(params, rand) {
  const { w, h, count, kinds } = params;
  const vehicles = [];
  const occ = Array.from({ length: h }, () => new Array(w).fill(false));
  let attempts = 0;
  while (vehicles.length < count && attempts < 4000) {
    attempts++;
    const kind = kinds[Math.floor(rand() * kinds.length)];
    const { len, cap } = KINDS[kind];
    const dir = DIR_KEYS[Math.floor(rand() * 4)];
    const hx = Math.floor(rand() * w);
    const hy = Math.floor(rand() * h);
    const v = { id: vehicles.length, kind, len, cap, dir, hx, hy };
    const cells = vehicleCells(v);
    if (!cells.every(([x, y]) => x >= 0 && y >= 0 && x < w && y < h && !occ[y][x])) continue;
    vehicles.push(v);
    if (!canClearAll(w, h, vehicles)) {
      vehicles.pop();
      continue;
    }
    for (const [x, y] of cells) occ[y][x] = true;
  }
  return vehicles;
}

/** Reference solver: plays the game by exiting vehicles in `order` only when needed. Returns true if it wins. */
export function referenceSolve(level, order) {
  const g = new Game(level);
  let p = 0;
  let guard = 0;
  g.settle();
  while (g.status === 'playing' && guard++ < 10000) {
    // need a vehicle for the front passenger?
    if (p >= order.length) return false;
    const ev = g.tap(order[p]);
    if (!ev.length || ev[0].type === 'blocked' || ev[0].type === 'noslot') return false;
    p++;
  }
  return g.status === 'won';
}

export function generateLevel(levelNum) {
  const params = levelParams(levelNum);
  for (let attempt = 0; attempt < 60; attempt++) {
    const rand = mulberry32(levelNum * 7919 + 13 + attempt * 104729);
    const base = tryBuild(params, rand);
    if (base.length < Math.min(3, params.count)) continue;
    const layers = canClearAll(params.w, params.h, base);
    if (!layers) continue;

    // assign colors: make sure every colour used at least once when possible
    const nColors = Math.min(params.colors, base.length);
    const palette = COLORS.slice();
    // shuffle palette deterministically so early levels aren't always red/blue
    for (let i = palette.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [palette[i], palette[j]] = [palette[j], palette[i]];
    }
    const cols = palette.slice(0, nColors);
    base.forEach((v, i) => {
      v.color = i < nColors ? cols[i] : cols[Math.floor(rand() * nColors)];
    });
    // shuffle colors among vehicles so the first-placed aren't special
    for (let i = base.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [base[i].color, base[j].color] = [base[j].color, base[i].color];
    }

    // reference exit order: random pick from currently removable each step
    const order = [];
    {
      const remaining = new Set(base.map((v) => v.id));
      while (remaining.size) {
        const subset = base.filter((v) => remaining.has(v.id));
        // reindex for canClearAll
        const idx = subset.map((v, i) => ({ ...v, id: i }));
        const lay = canClearAll(params.w, params.h, idx);
        const first = lay[0];
        // prefer deeper picks sometimes to make the solution less obvious
        const pick = subset[first[Math.floor(rand() * first.length)]];
        order.push(pick.id);
        remaining.delete(pick.id);
      }
    }

    // passenger queue
    const seatsLeft = new Map(base.map((v) => [v.id, v.cap]));
    const open = [];
    const queue = [];
    let p = 0;
    while (queue.length < base.reduce((s, v) => s + v.cap, 0)) {
      while (open.length < params.window && p < order.length) open.push(order[p++]);
      const r = rand();
      const oi = r < 0.55 ? 0 : Math.floor(rand() * open.length);
      const id = open[oi];
      const v = base[id];
      let run = 1 + Math.floor(rand() * 3);
      run = Math.min(run, seatsLeft.get(id));
      for (let k = 0; k < run; k++) queue.push(v.color);
      seatsLeft.set(id, seatsLeft.get(id) - run);
      if (seatsLeft.get(id) === 0) open.splice(oi, 1);
    }

    // mystery
    const firstLayer = new Set(layers[0]);
    base.forEach((v) => {
      v.mystery = !firstLayer.has(v.id) && rand() < params.mystery;
    });

    const level = {
      num: levelNum,
      w: params.w,
      h: params.h,
      vehicles: base,
      queue,
      slots: params.slots,
    };
    if (!referenceSolve(level, order)) continue;

    // difficulty label: spike levels are built with more cars, colours and interleaving
    level.difficulty = params.spike === 2 && levelNum >= 10 ? 'superhard' : params.spike >= 1 && levelNum >= 5 ? 'hard' : 'normal';
    level.depth = layers.length;
    level.solution = order;
    return level;
  }
  // fallback: trivial level (should never happen)
  return generateLevel(Math.max(1, levelNum - 1));
}
