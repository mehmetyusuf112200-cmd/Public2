// Meta progression: player XP/level, stars, daily missions, achievements,
// daily login rewards, lucky wheel and shop catalogue. Pure data + logic.
import { ECONOMY } from './config.js';

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
function dayNumber(dstr) {
  const [y, m, d] = dstr.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

export function defaultState() {
  return {
    level: 1, // next level to play (highest unlocked)
    stars: {}, // level -> 1..3
    coins: ECONOMY.startCoins,
    boosters: { ...ECONOMY.startBoosters },
    xp: 0,
    plevel: 1,
    settings: { sfx: true, music: true, haptic: true, lang: null },
    noAds: false,
    style: 'classic',
    ownedStyles: ['classic'],
    coinBonus: 0, // upgrade level 0..5
    daily: { last: null, streak: 0 },
    wheel: { day: null, freeUsed: false, adSpins: 0 },
    freeCoins: { day: null, count: 0 },
    missions: { day: null, list: [] },
    achClaimed: {},
    stats: { wins: 0, passengers: 0, departures: 0, boosters: 0, hardWins: 0, threeStars: 0, spins: 0, noBoosterWins: 0, ads: 0 },
    purchases: {},
    tutorialDone: false,
    seenMech: {},
    winStreak: 0,
    bestStreak: 0,
    chestStars: 0,
    chapterGifts: {},
    dc: { day: null, done: false, streak: 0, last: null },
    piggy: 0,
    offerUntil: 0,
    offerShown: false,
    notifAsked: false,
  };
}

/* ---------------- player level ---------------- */
export function xpToNext(plevel) {
  return 80 + plevel * 40;
}
export function xpForWin(difficulty, stars) {
  return 20 + (difficulty === 'hard' ? 10 : difficulty === 'superhard' ? 25 : 0) + stars * 5;
}
/** adds xp, returns list of level-ups [{plevel, coins, booster}] */
export function addXp(state, amount) {
  const ups = [];
  state.xp += amount;
  while (state.xp >= xpToNext(state.plevel)) {
    state.xp -= xpToNext(state.plevel);
    state.plevel++;
    const booster = ['crane', 'sort', 'slot'][state.plevel % 3];
    const coins = 100 + state.plevel * 10;
    state.coins += coins;
    state.boosters[booster] = (state.boosters[booster] || 0) + 1;
    ups.push({ plevel: state.plevel, coins, booster });
  }
  return ups;
}

export function coinMultiplier(state) {
  return 1 + 0.1 * (state.coinBonus || 0);
}
export const COIN_BONUS_PRICES = [600, 1200, 2400, 4000, 6000];

/* ---------------- daily missions ---------------- */
const MISSION_POOL = [
  { type: 'wins', targets: [3, 5], reward: [120, 200] },
  { type: 'passengers', targets: [100, 200], reward: [100, 180] },
  { type: 'departures', targets: [20, 40], reward: [100, 180] },
  { type: 'boosters', targets: [2, 3], reward: [90, 130] },
  { type: 'hardWins', targets: [1, 2], reward: [150, 250] },
  { type: 'threeStars', targets: [3, 5], reward: [120, 200] },
  { type: 'noBoosterWins', targets: [2, 4], reward: [120, 200] },
  { type: 'spins', targets: [1], reward: [80] },
];

export function ensureMissions(state) {
  const d = today();
  if (state.missions.day === d && state.missions.list.length) return false;
  // deterministic per day
  let seed = dayNumber(d) * 9301 + 49297;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pool = MISSION_POOL.slice();
  const list = [];
  while (list.length < 3 && pool.length) {
    const i = Math.floor(rnd() * pool.length);
    const m = pool.splice(i, 1)[0];
    const ti = Math.floor(rnd() * m.targets.length);
    list.push({ type: m.type, target: m.targets[ti], reward: m.reward[ti], progress: 0, claimed: false });
  }
  state.missions = { day: d, list };
  return true;
}

/** increase stat + mission progress; returns missions newly completed */
export function track(state, type, n = 1) {
  state.stats[type] = (state.stats[type] || 0) + n;
  const done = [];
  for (const m of state.missions.list) {
    if (m.type !== type || m.claimed) continue;
    const before = m.progress;
    m.progress = Math.min(m.target, m.progress + n);
    if (before < m.target && m.progress >= m.target) done.push(m);
  }
  return done;
}
export function missionsReady(state) {
  return state.missions.list.filter((m) => !m.claimed && m.progress >= m.target).length;
}

/* ---------------- achievements ---------------- */
export const ACHIEVEMENTS = [
  { id: 'lvl10', stat: 'level', target: 10, reward: 300, icon: '🚩' },
  { id: 'lvl25', stat: 'level', target: 25, reward: 600, icon: '🏁' },
  { id: 'lvl50', stat: 'level', target: 50, reward: 1000, icon: '🎖️' },
  { id: 'lvl100', stat: 'level', target: 100, reward: 2000, icon: '🏆' },
  { id: 'lvl200', stat: 'level', target: 200, reward: 4000, icon: '👑' },
  { id: 'pax500', stat: 'passengers', target: 500, reward: 300, icon: '🧍' },
  { id: 'pax2k', stat: 'passengers', target: 2000, reward: 800, icon: '👥' },
  { id: 'pax10k', stat: 'passengers', target: 10000, reward: 2500, icon: '🏙️' },
  { id: 'dep200', stat: 'departures', target: 200, reward: 500, icon: '🚌' },
  { id: 'hard10', stat: 'hardWins', target: 10, reward: 700, icon: '🔥' },
  { id: 'star30', stat: 'threeStars', target: 30, reward: 600, icon: '⭐' },
  { id: 'plvl10', stat: 'plevel', target: 10, reward: 800, icon: '🎓' },
];
export function achValue(state, a) {
  if (a.stat === 'level') return state.level - 1;
  if (a.stat === 'plevel') return state.plevel;
  return state.stats[a.stat] || 0;
}
export function achReady(state) {
  return ACHIEVEMENTS.filter((a) => !state.achClaimed[a.id] && achValue(state, a) >= a.target).length;
}

/* ---------------- daily login reward ---------------- */
export const DAILY_REWARDS = [
  { coins: 100 },
  { coins: 150 },
  { booster: 'crane', n: 1 },
  { coins: 250 },
  { booster: 'sort', n: 2 },
  { coins: 400 },
  { coins: 600, booster: 'slot', n: 2 },
];
/** returns {available, dayIndex} */
export function dailyStatus(state) {
  const d = today();
  if (state.daily.last === d) return { available: false, dayIndex: (state.daily.streak - 1 + 7) % 7 };
  let streak = state.daily.streak;
  if (!state.daily.last || dayNumber(d) - dayNumber(state.daily.last) > 1) streak = 0;
  return { available: true, dayIndex: streak % 7, streak };
}
export function claimDaily(state, mult = 1) {
  const st = dailyStatus(state);
  if (!st.available) return null;
  const r = DAILY_REWARDS[st.dayIndex];
  if (r.coins) state.coins += r.coins * mult;
  if (r.booster) state.boosters[r.booster] = (state.boosters[r.booster] || 0) + r.n * mult;
  state.daily = { last: today(), streak: st.streak + 1 };
  return r;
}

/* ---------------- lucky wheel ---------------- */
export const WHEEL = [
  { coins: 50, color: '#ffd166', w: 22 },
  { booster: 'sort', color: '#6ec6ff', w: 12 },
  { coins: 100, color: '#ff8fab', w: 18 },
  { booster: 'crane', color: '#b39ddb', w: 10 },
  { coins: 250, color: '#80e27e', w: 12 },
  { booster: 'slot', color: '#ffab76', w: 10 },
  { coins: 500, color: '#4dd0e1', w: 6 },
  { coins: 1000, color: '#ff6b6b', w: 2 },
];
export const WHEEL_AD_SPINS = 3;
export function wheelStatus(state) {
  const d = today();
  if (state.wheel.day !== d) state.wheel = { day: d, freeUsed: false, adSpins: 0 };
  return { free: !state.wheel.freeUsed, adLeft: WHEEL_AD_SPINS - state.wheel.adSpins };
}
export function rollWheel() {
  const total = WHEEL.reduce((s, x) => s + x.w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < WHEEL.length; i++) {
    r -= WHEEL[i].w;
    if (r <= 0) return i;
  }
  return 0;
}
export function grant(state, prize) {
  if (prize.coins) state.coins += prize.coins;
  if (prize.booster) state.boosters[prize.booster] = (state.boosters[prize.booster] || 0) + (prize.n || 1);
}

/* ---------------- free coins (rewarded ad) ---------------- */
export const FREE_COINS = { amount: 120, perDay: 5 };
export function freeCoinsLeft(state) {
  const d = today();
  if (state.freeCoins.day !== d) state.freeCoins = { day: d, count: 0 };
  return FREE_COINS.perDay - state.freeCoins.count;
}

export function totalStars(state) {
  return Object.values(state.stars).reduce((s, x) => s + x, 0);
}

/* ---------------- win streak ---------------- */
// tier 1: free Sort, tier 2: + free Crane, tier 3: + extra parking spot
export function streakTier(state) {
  return Math.min(3, state.winStreak || 0);
}

/* ---------------- star chest ---------------- */
export const CHEST_STARS = 15;
export function chestReady(state) {
  return (state.chestStars || 0) >= CHEST_STARS;
}
export function rollChest(big = false) {
  const coins = big ? 400 + Math.floor(Math.random() * 3) * 100 : 120 + Math.floor(Math.random() * 5) * 30;
  const boosters = {};
  const n = big ? 3 : 1 + (Math.random() < 0.4 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const k = ['crane', 'sort', 'slot'][Math.floor(Math.random() * 3)];
    boosters[k] = (boosters[k] || 0) + 1;
  }
  return { coins, boosters };
}
export function grantChest(state, r) {
  state.coins += r.coins;
  for (const [k, n] of Object.entries(r.boosters)) state.boosters[k] = (state.boosters[k] || 0) + n;
}

/* ---------------- daily puzzle ---------------- */
export function dcLevelNum() {
  return 401 + (dayNumber(today()) % 600);
}
export function dcStatus(state) {
  const d = today();
  if (state.dc.day !== d) {
    // streak survives only if yesterday was solved
    const keep = state.dc.last && dayNumber(d) - dayNumber(state.dc.last) <= 1;
    state.dc = { day: d, done: false, streak: keep ? state.dc.streak : 0, last: state.dc.last };
  }
  return { done: state.dc.done, streak: state.dc.streak, reward: 250 + Math.min(6, state.dc.streak) * 50 };
}
export function dcComplete(state) {
  const st = dcStatus(state);
  state.dc.done = true;
  state.dc.last = today();
  state.dc.streak += 1;
  return st.reward;
}

/* ---------------- events ---------------- */
export function weekendEvent() {
  const d = new Date().getDay();
  return d === 0 || d === 6;
}

/* ---------------- piggy bank ---------------- */
export const PIGGY = { perWin: 40, cap: 4000, minBreak: 600 };
export function feedPiggy(state, n = PIGGY.perWin) {
  state.piggy = Math.min(PIGGY.cap, (state.piggy || 0) + n);
}

/* ---------------- limited starter offer ---------------- */
export const OFFER_HOURS = 24;
export function offerActive(state) {
  return !state.purchases?.starter && state.offerUntil && Date.now() < state.offerUntil;
}
export function maybeStartOffer(state) {
  if (state.purchases?.starter || state.offerUntil || state.level < 6) return false;
  state.offerUntil = Date.now() + OFFER_HOURS * 3600 * 1000;
  return true;
}
