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

// cosmetic body styles per vehicle kind
export const VARIANTS = {
  car: ['sedan', 'sedan', 'taxi', 'sport', 'pickup', 'police', 'beetle'],
  van: ['van', 'minibus', 'icecream', 'delivery'],
  bus: ['city', 'double', 'school'],
};

export const MAX_SLOTS = 7;
export const MAX_LEVEL = 400;

export function vehicleCells(v) {
  const d = DIRS[v.dir];
  const cells = [];
  for (let i = 0; i < v.len; i++) cells.push([v.hx - d.dx * i, v.hy - d.dy * i]);
  return cells;
}

export class Game {
  /**
   * level: { w, h, vehicles:[{id,color,kind,len,cap,hx,hy,dir,mystery,ice}], queue:[color],
   *          slots, slotColors?:[color|null], moves?:number }
   */
  constructor(level) {
    this.w = level.w;
    this.h = level.h;
    this.vehicles = level.vehicles.map((v) => ({
      ...v,
      ice: v.ice || 0,
      state: 'lot', // lot | slot | gone
      seats: 0,
      slot: -1,
      revealed: !v.mystery,
    }));
    this.byId = new Map(this.vehicles.map((v) => [v.id, v]));
    this.queue = level.queue.slice();
    this.boarded = 0;
    this.totalPassengers = this.queue.length;
    const n = level.slots ?? 5;
    this.slots = new Array(n).fill(null);
    this.slotColors = (level.slotColors || []).slice(0, n);
    while (this.slotColors.length < n) this.slotColors.push(null);
    this.maxSlots = MAX_SLOTS;
    this.movesLeft = level.moves ?? null;
    this.status = 'playing'; // playing | won | lost
    this.loseReason = null; // stuck | moves | time
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

  /** {free:true} or {free:false, dist, blocker} */
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

  /** a free slot that accepts this colour; colour-reserved slots are preferred */
  slotFor(color) {
    let generic = -1;
    for (let i = 0; i < this.slots.length; i++) {
      if (this.slots[i] !== null) continue;
      const c = this.slotColors[i];
      if (c === color) return i;
      if (c === null && generic < 0) generic = i;
    }
    return generic;
  }

  freeSlotIndex() {
    return this.slots.findIndex((s, i) => s === null && this.slotColors[i] === null);
  }

  lotVehicles() {
    return this.vehicles.filter((v) => v.state === 'lot');
  }

  /** can the player make any successful move right now? */
  anyMove() {
    for (const v of this.vehicles) {
      if (v.state !== 'lot' || v.ice > 0) continue;
      if (this.slotFor(v.color) < 0) continue;
      if (this.pathCheck(v).free) return true;
    }
    return false;
  }

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

  useMove(ev) {
    if (this.movesLeft === null) return;
    this.movesLeft = Math.max(0, this.movesLeft - 1);
    ev.push({ type: 'moves', left: this.movesLeft });
  }

  checkMovesOut(ev) {
    if (this.status === 'playing' && this.movesLeft !== null && this.movesLeft <= 0 && this.queue.length) {
      this.status = 'lost';
      this.loseReason = 'moves';
      ev.push({ type: 'lose', reason: 'moves' });
    }
    return ev;
  }

  tap(id) {
    if (this.status !== 'playing') return [];
    const v = this.byId.get(id);
    if (!v || v.state !== 'lot') return [];
    const ev = [];
    if (v.ice > 0) {
      ev.push({ type: 'frozen', id, ice: v.ice });
      return ev; // tapping ice is free: it is clearly visible
    }
    const pc = this.pathCheck(v);
    if (!pc.free) {
      this.useMove(ev);
      ev.unshift({ type: 'blocked', id, dist: pc.dist, blocker: pc.blocker });
      return this.checkMovesOut(ev);
    }
    const slot = this.slotFor(v.color);
    if (slot < 0) return [{ type: 'noslot', id }];
    this.useMove(ev);
    ev.unshift(...this.moveToSlot(v, slot, 'exit'));
    return this.checkMovesOut(ev);
  }

  /** booster: lift any vehicle (even frozen / blocked) to a slot */
  crane(id) {
    if (this.status !== 'playing') return null;
    const v = this.byId.get(id);
    if (!v || v.state !== 'lot') return null;
    const slot = this.slotFor(v.color);
    if (slot < 0) return null;
    v.revealed = true;
    v.ice = 0;
    return this.moveToSlot(v, slot, 'crane');
  }

  addSlot() {
    if (this.slots.length >= this.maxSlots) return null;
    this.slots.push(null);
    this.slotColors.push(null);
    const ev = [{ type: 'addslot', slot: this.slots.length - 1 }];
    this.revive();
    ev.push(...this.settle());
    return ev;
  }

  addMoves(n) {
    if (this.movesLeft === null) return;
    this.movesLeft += n;
    this.revive();
  }

  revive() {
    if (this.status === 'lost') {
      this.status = 'playing';
      this.loseReason = null;
    }
  }

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
    const tail2 = [];
    for (const c of tail) {
      if ((need.get(c) || 0) > 0) {
        front.push(c);
        need.set(c, need.get(c) - 1);
      } else tail2.push(c);
    }
    this.queue = [...front, ...back, ...tail2];
    this.revive();
    return [{ type: 'queue', queue: this.queue.slice() }, ...this.settle()];
  }

  moveToSlot(v, slot, how) {
    v.state = 'slot';
    v.slot = slot;
    this.slots[slot] = v.id;
    this.rebuildGrid();
    const ev = [{ type: how, id: v.id, slot, color: v.color }];
    for (const o of this.vehicles) {
      if (o.state === 'lot' && o.ice > 0) {
        o.ice--;
        ev.push({ type: o.ice === 0 ? 'thaw' : 'ice', id: o.id, ice: o.ice });
      }
    }
    ev.push(...this.revealPass());
    ev.push(...this.settle());
    return ev;
  }

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
      this.status = 'won';
      ev.push({ type: 'win' });
    } else if (this.status === 'playing' && !this.anyMove()) {
      this.status = 'lost';
      this.loseReason = 'stuck';
      ev.push({ type: 'lose', reason: 'stuck' });
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

/** which special rules a level uses (deterministic) */
export function levelMechanics(L) {
  const m = { moves: false, time: false, ice: false, colorSlots: 0 };
  // first appearance of each rule (with an explanation popup in the game)
  if (L === 7) m.moves = true;
  else if (L === 13) m.ice = true;
  else if (L === 19) m.time = true;
  else if (L === 25) m.colorSlots = 1;
  else if (L > 7) {
    const r = mulberry32(L * 2654435761);
    const spike = L % 10 === 0 ? 2 : L % 10 === 5 ? 1 : 0;
    const want = spike === 2 ? 2 : spike === 1 ? 1 + (r() < 0.4 ? 1 : 0) : r() < Math.min(0.75, 0.3 + L / 300) ? 1 : 0;
    const pool = ['moves'];
    if (L > 13) pool.push('ice', 'ice');
    if (L > 19) pool.push('time');
    if (L > 25) pool.push('color');
    for (let i = 0; i < want && pool.length; i++) {
      const k = pool.splice(Math.floor(r() * pool.length), 1)[0];
      if (k === 'color') m.colorSlots = L > 80 && r() < 0.4 ? 2 : 1;
      else m[k] = true;
      for (let j = pool.length - 1; j >= 0; j--) if (pool[j] === k) pool.splice(j, 1);
    }
  }
  return m;
}

/** level number -> generation params. Difficulty rises steadily with a saw-tooth every 5/10 levels. */
export function levelParams(level) {
  const L = Math.max(1, level);
  const cycle = L % 10;
  const spike = cycle === 0 ? 2 : cycle === 5 ? 1 : 0;
  const relax = cycle === 1 || cycle === 6 ? -1 : 0;
  if (L === 1) return { w: 4, h: 4, count: 3, colors: 2, window: 1, mystery: 0, kinds: ['car'], slots: 5, spike: 0 };
  if (L === 2) return { w: 4, h: 5, count: 5, colors: 2, window: 1, mystery: 0, kinds: ['car'], slots: 5, spike: 0 };
  if (L === 3) return { w: 5, h: 5, count: 7, colors: 3, window: 2, mystery: 0, kinds: ['car', 'car', 'van'], slots: 5, spike: 0 };
  const w = Math.min(9, 5 + Math.floor(L / 9));
  const h = Math.min(12, 6 + Math.floor(L / 6));
  const cells = w * h;
  const fill = Math.min(0.86, 0.6 + L * 0.005 + spike * 0.05 + relax * 0.05);
  const kinds = L < 6 ? ['car', 'car', 'van'] : L < 20 ? ['car', 'car', 'van', 'van', 'bus'] : ['car', 'car', 'van', 'van', 'bus'];
  const avgLen = kinds.reduce((s, k) => s + KINDS[k].len, 0) / kinds.length;
  const count = Math.max(6, Math.round((cells * fill) / avgLen));
  const colors = Math.min(COLORS.length, 3 + Math.floor(L / 5) + (spike ? 1 : 0));
  let window = 1 + Math.floor(L / 5) + spike + relax;
  window = Math.max(2, Math.min(L < 30 ? 3 : 4, window));
  const mystery = L < 9 ? 0 : Math.min(0.45, 0.12 + (L - 9) * 0.004 + spike * 0.06);
  return { w, h, count, colors, window, mystery, kinds, slots: 5, spike };
}

function canClearAll(w, h, vehicles) {
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
  while (vehicles.length < count && attempts < 6000) {
    attempts++;
    // prefer longer vehicles first, small cars fill the gaps later
    const late = vehicles.length > count * 0.6;
    const kind = late && rand() < 0.6 ? 'car' : kinds[Math.floor(rand() * kinds.length)];
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

/** Reference solver: taps vehicles in `order`. Returns true if the level is won. */
export function referenceSolve(level, order) {
  const g = new Game({ ...level, moves: null });
  let p = 0;
  let guard = 0;
  g.settle();
  while (g.status === 'playing' && guard++ < 10000) {
    if (p >= order.length) return false;
    const ev = g.tap(order[p]);
    if (!ev.length || ['blocked', 'noslot', 'frozen'].includes(ev[0].type)) return false;
    p++;
  }
  return g.status === 'won';
}

export function generateLevel(levelNum) {
  const params = levelParams(levelNum);
  const mech = levelMechanics(levelNum);
  for (let attempt = 0; attempt < 80; attempt++) {
    const rand = mulberry32(levelNum * 7919 + 13 + attempt * 104729);
    // later attempts relax the interleaving so a valid level is always found
    const window = Math.max(1, params.window - (mech.colorSlots ? 1 : 0) - Math.floor(attempt / 25));
    const base = tryBuild(params, rand);
    if (base.length < Math.min(3, params.count)) continue;
    const layers = canClearAll(params.w, params.h, base);
    if (!layers) continue;

    const nColors = Math.min(params.colors, base.length);
    const palette = COLORS.slice();
    for (let i = palette.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [palette[i], palette[j]] = [palette[j], palette[i]];
    }
    const cols = palette.slice(0, nColors);
    base.forEach((v, i) => {
      v.color = i < nColors ? cols[i] : cols[Math.floor(rand() * nColors)];
    });
    for (let i = base.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [base[i].color, base[j].color] = [base[j].color, base[i].color];
    }
    base.forEach((v) => {
      const list = VARIANTS[v.kind];
      v.variant = list[Math.floor(rand() * list.length)];
    });

    // reference exit order
    const order = [];
    {
      const remaining = new Set(base.map((v) => v.id));
      while (remaining.size) {
        const subset = base.filter((v) => remaining.has(v.id));
        const idx = subset.map((v, i) => ({ ...v, id: i }));
        const lay = canClearAll(params.w, params.h, idx);
        const first = lay[0];
        const pick = subset[first[Math.floor(rand() * first.length)]];
        order.push(pick.id);
        remaining.delete(pick.id);
      }
    }

    // passenger queue interleaving `window` vehicles of the reference order
    const seatsLeft = new Map(base.map((v) => [v.id, v.cap]));
    const open = [];
    const queue = [];
    let p = 0;
    const totalSeats = base.reduce((s, v) => s + v.cap, 0);
    while (queue.length < totalSeats) {
      while (open.length < window && p < order.length) open.push(order[p++]);
      const oi = rand() < 0.5 ? 0 : Math.floor(rand() * open.length);
      const id = open[oi];
      const v = base[id];
      let run = 1 + Math.floor(rand() * 3);
      run = Math.min(run, seatsLeft.get(id));
      for (let k = 0; k < run; k++) queue.push(v.color);
      seatsLeft.set(id, seatsLeft.get(id) - run);
      if (seatsLeft.get(id) === 0) open.splice(oi, 1);
    }

    // mystery vehicles
    const firstLayer = new Set(layers[0]);
    base.forEach((v) => {
      v.mystery = !firstLayer.has(v.id) && rand() < params.mystery;
      v.ice = 0;
    });

    // frozen vehicles: ice counter never exceeds how many vehicles leave before it in the reference order
    if (mech.ice) {
      const share = 0.15 + Math.min(0.2, levelNum / 1000);
      order.forEach((id, i) => {
        if (i >= 2 && rand() < share) base[id].ice = 1 + Math.floor(rand() * Math.min(i, 3 + Math.floor(levelNum / 60)));
      });
    }

    // colour-reserved slots (taken from the regular 5)
    const slotColors = [null, null, null, null, null];
    if (mech.colorSlots) {
      const count = new Map();
      for (const v of base) count.set(v.color, (count.get(v.color) || 0) + 1);
      const byFreq = [...count.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
      for (let k = 0; k < mech.colorSlots && k < byFreq.length; k++) slotColors[4 - k] = byFreq[k];
    }

    const level = {
      num: levelNum,
      w: params.w,
      h: params.h,
      vehicles: base,
      queue,
      slots: params.slots,
      slotColors,
    };
    if (!referenceSolve(level, order)) continue;

    if (mech.moves) {
      const slack = params.spike === 2 ? 2 : params.spike === 1 ? 3 : Math.max(3, 6 - Math.floor(levelNum / 80));
      level.moves = base.length + slack;
    }
    if (mech.time) {
      const pace = params.spike === 2 ? 2.0 : params.spike === 1 ? 2.3 : 2.7;
      level.time = Math.round((base.length * pace + 15) / 5) * 5;
    }
    level.mech = mech;
    level.difficulty = params.spike === 2 && levelNum >= 10 ? 'superhard' : params.spike >= 1 && levelNum >= 5 ? 'hard' : 'normal';
    level.depth = layers.length;
    level.solution = order;
    return level;
  }
  return generateLevel(Math.max(1, levelNum - 1));
}
