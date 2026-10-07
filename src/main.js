import '@fontsource/baloo-2/600.css';
import '@fontsource/baloo-2/800.css';
import './style.css';
import { Game, generateLevel, levelParams, levelMechanics, MAX_LEVEL } from './core/logic.js';
import { Renderer } from './render.js';
import { t, setLang, getLang, fmt } from './i18n.js';
import { sfx, unlockAudio, setSfx, setMusic, suspendAudio, resumeAudio, audioState, startSong } from './audio.js';
import { loadSave, writeSave, haptics, initAds, maybeInterstitial, showRewarded, showPrivacyOptions, onBackButton, onPause, isNative } from './platform.js';
import { ECONOMY, PRIVACY_URL } from './config.js';
import { THEMES, STYLES, themeForLevel, chapterOf, CHAPTER_SIZE } from './theme.js';
import * as M from './meta.js';
import { PRODUCTS, initIAP, buy, priceOf, storeReady, ownedNonConsumables } from './iap.js';
import { initGames, gamesAvailable, submitLevel, openLeaderboard } from './games.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

let state = M.defaultState();
let game = null;
let levelData = null;
let playing = 0; // level number being played
let craneMode = false;
let ended = false;
let usedBoosters = 0;
let usedContinue = 0;
let tab = 'home';
let inGame = false;
let timeLeft = null;
let timerStarted = false;
let lastAlarm = 0;
let previewLevel = 0;

const R = new Renderer($('#scene'));
R.onPick = onPick;
R.paused = true;
R.onBubble = (x, y, e) => emojiAt(x, y, e);
R.onBoard = () => {
  missionToasts(M.track(state, 'passengers', 1));
  updateProgress();
};
R.onDepart = () => missionToasts(M.track(state, 'departures', 1));
R.onLockedSlot = () => {
  if (inGame && !ended) boosterClick('slot');
};

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */
function persist() {
  writeSave(state);
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}
function tip(msg) {
  const el = $('#tip');
  if (!msg) return el.classList.add('hidden');
  el.textContent = msg;
  el.classList.remove('hidden');
}
function splash(html, cls = '') {
  const sp = $('#splash');
  sp.innerHTML = `<div class="${cls}">${html}</div>`;
  sp.classList.remove('hidden');
  clearTimeout(splash.t);
  splash.t = setTimeout(() => sp.classList.add('hidden'), 1700);
}
function emojiAt(x, y, e) {
  const el = document.createElement('div');
  el.className = 'emoji';
  el.textContent = e;
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  $('#fx').appendChild(el);
  setTimeout(() => el.remove(), 1200);
}
function coinTarget() {
  const el = $$('[data-coins]').find((e) => e.offsetParent !== null);
  if (!el) return { x: window.innerWidth - 60, y: 30 };
  const r = el.querySelector('.coin').getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
/** coins fly from (x,y) to the counter, then are added */
function flyCoins(amount, from) {
  if (amount <= 0) return addCoins(amount);
  const to = coinTarget();
  const src = from || { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const n = Math.min(12, 4 + Math.floor(amount / 50));
  for (let i = 0; i < n; i++) {
    const c = document.createElement('span');
    c.className = 'coin flycoin';
    c.style.left = src.x + (Math.random() - 0.5) * 60 + 'px';
    c.style.top = src.y + (Math.random() - 0.5) * 40 + 'px';
    $('#fx').appendChild(c);
    setTimeout(() => {
      const r = c.getBoundingClientRect();
      c.style.transform = `translate(${to.x - r.left - 13}px, ${to.y - r.top - 13}px) scale(0.8)`;
      c.style.opacity = '0';
    }, 30 + i * 45);
    setTimeout(() => {
      c.remove();
      if (i % 3 === 0) sfx.coin();
    }, 720 + i * 45);
  }
  setTimeout(() => addCoins(amount), 650 + n * 45);
}
function addCoins(n) {
  state.coins += n;
  persist();
  refreshCoins(true);
}
function refreshCoins(bump = false) {
  $$('[data-coins]').forEach((el) => {
    el.querySelector('.coinText').textContent = fmt(state.coins);
    if (bump) {
      el.classList.remove('bump');
      void el.offsetWidth;
      el.classList.add('bump');
    }
  });
}
function missionToasts(done) {
  if (done && done.length) {
    sfx.levelUp();
    toast(`📋 ${t('missionDone')} ${t('mission')[done[0].type]}`);
    persist();
    refreshDots();
  }
}

/* ------------------------------------------------------------------ */
/* settings & modal                                                    */
/* ------------------------------------------------------------------ */
function applySettings() {
  setSfx(state.settings.sfx);
  setMusic(state.settings.music);
  haptics.enabled = state.settings.haptic;
  if (state.settings.lang) setLang(state.settings.lang);
  document.documentElement.lang = getLang();
  $$('[data-t]').forEach((el) => (el.textContent = t(el.dataset.t)));
  R.setStyle(state.style);
}

function openModal(html, { onClose } = {}) {
  $('#modalCard').innerHTML = html;
  $('#modal').classList.remove('hidden');
  const cx = $('#modalCard .closex');
  if (cx)
    cx.onclick = () => {
      sfx.click();
      closeModal();
      onClose && onClose();
    };
}
function closeModal() {
  $('#modal').classList.add('hidden');
}
function modalOpen() {
  return !$('#modal').classList.contains('hidden');
}

function openSettings() {
  const tg = (k) => `<button class="toggle ${state.settings[k] ? 'on' : ''}" data-k="${k}"></button>`;
  openModal(`
    <button class="closex">✕</button>
    <h2>${t('settings')}</h2>
    <div style="margin-top:12px">
      <div class="row">${t('sound')} ${tg('sfx')}</div>
      <div class="row">${t('music')} ${tg('music')}</div>
      <div class="row">${t('vibration')} ${tg('haptic')}</div>
      <div class="row">${t('language')}
        <div class="seg"><button data-l="tr" class="${getLang() === 'tr' ? 'on' : ''}">TR</button><button data-l="en" class="${getLang() === 'en' ? 'on' : ''}">EN</button></div>
      </div>
    </div>
    <button class="btn blue" id="bRestore">${t('restore')}</button>
    <button class="linkbtn" id="bPriv">${t('privacy')}</button>
    ${isNative ? `<br><button class="linkbtn" id="bPrivOpt">${t('privacyOptions')}</button>` : ''}
    <div class="note">Commute Craze v${__APP_VERSION__}</div>
  `);
  $$('.toggle', $('#modalCard')).forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.k;
      state.settings[k] = !state.settings[k];
      b.classList.toggle('on', state.settings[k]);
      applySettings();
      persist();
      if (k === 'sfx' && state.settings.sfx) sfx.tap();
    };
  });
  $$('.seg button', $('#modalCard')).forEach((b) => {
    b.onclick = () => {
      state.settings.lang = b.dataset.l;
      applySettings();
      persist();
      renderTab();
      openSettings();
    };
  });
  $('#bRestore').onclick = restorePurchases;
  $('#bPriv').onclick = () => window.open(PRIVACY_URL, '_blank');
  const po = $('#bPrivOpt');
  if (po) po.onclick = () => showPrivacyOptions();
}

async function rewarded() {
  const ok = await showRewarded();
  if (ok) {
    state.stats.ads = (state.stats.ads || 0) + 1;
    persist();
  } else toast(t('adFail'));
  return ok;
}

/* ------------------------------------------------------------------ */
/* MENU                                                                */
/* ------------------------------------------------------------------ */
function showMenu(toTab = 'home') {
  inGame = false;
  game = null;
  timeLeft = null;
  closeModal();
  tip(null);
  $('#hud').classList.add('hidden');
  $('#menu').classList.remove('hidden', 'fade');
  startSong('menu');
  tab = toTab;
  previewLevel = 0;
  renderMenuTop();
  renderTab();
}

/** the home tab shows the next level's 3D board behind the menu */
function showPreview() {
  if (previewLevel === state.level && !R.paused) return;
  previewLevel = state.level;
  const lv = generateLevelCached(state.level);
  const pg = new Game(lv);
  R.padding = { top: 120, bottom: 300, side: 6 };
  R.setStyle(state.style);
  R.loadLevel(pg, themeForLevel(state.level));
  R.paused = false;
}

function renderMenuTop() {
  $('#plevel').textContent = state.plevel;
  const need = M.xpToNext(state.plevel);
  $('#xpLabel').textContent = `${t('playerLevel')} ${state.plevel} · ${state.xp}/${need} ${t('xp')}`;
  $('#xpFill').style.width = Math.min(100, (state.xp / need) * 100) + '%';
  refreshCoins();
  refreshDots();
}

function refreshDots() {
  M.ensureMissions(state);
  const dot = (tabName, on) => {
    const d = $(`#tabs [data-tab="${tabName}"] .dot`);
    if (d) d.classList.toggle('hidden', !on);
  };
  const dailyOn = M.dailyStatus(state).available;
  const wheelOn = M.wheelStatus(state).free;
  dot('home', dailyOn || wheelOn);
  dot('missions', M.missionsReady(state) + M.achReady(state) > 0);
  dot('shop', M.freeCoinsLeft(state) > 0 && !state.noAds ? false : false);
}

function renderTab() {
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  const body = $('#menuBody');
  body.scrollTop = 0;
  const theme = themeForLevel(state.level);
  const menu = $('#menu');
  const [g1, g2] = theme.map;
  const home = tab === 'home';
  menu.classList.toggle('homeMode', home);
  menu.style.background = home ? 'transparent' : `linear-gradient(#5fb4ff 0%, #8fd2ff 30%, ${g1} 30.2%, ${g2} 100%)`;
  if (home) showPreview();
  else R.paused = true;
  if (home) renderHome(body);
  else if (tab === 'map') renderMap(body);
  else if (tab === 'shop') renderShop(body);
  else if (tab === 'missions') renderMissions(body);
  else renderRank(body);
}

const MECH_ICON = { moves: '🕹️', time: '⏱️', ice: '🧊', colorSlots: '⭐' };
function mechList(lv) {
  const m = lv.mech || {};
  return Object.keys(MECH_ICON).filter((k) => m[k]);
}

function renderHome(body) {
  const lp = generateLevelCached(state.level);
  const theme = themeForLevel(state.level);
  const daily = M.dailyStatus(state).available;
  const wheel = M.wheelStatus(state).free;
  const strip = [];
  for (let n = state.level - 2; n <= state.level + 2; n++) {
    if (n < 1) {
      strip.push('<span class="snode ghost"></span>');
      continue;
    }
    const cls = n < state.level ? 'done' : n === state.level ? 'cur ' + lp.difficulty : 'next ' + difficultyOf(n);
    const label = n < state.level ? '✔' : n % CHAPTER_SIZE === 0 && n > state.level ? '🎁' : n;
    strip.push(`<span class="snode ${cls}">${label}</span>`);
    if (n < state.level + 2) strip.push(`<span class="slink ${n < state.level ? 'done' : ''}"></span>`);
  }
  const mech = mechList(lp)
    .map((k) => `<span class="mchip">${MECH_ICON[k]} ${t('mech')[k]}</span>`)
    .join('');
  body.innerHTML = `
    <div class="home">
      <div class="titlebar"><span>Commute</span> <b>Craze</b></div>
      <div class="sidecol left">
        <button class="side ${daily ? 'glow' : ''}" id="sDaily"><span class="si">📅</span>${t('daily')}${daily ? '<i class="dot"></i>' : ''}</button>
        <button class="side ${wheel ? 'glow' : ''}" id="sWheel"><span class="si">🎡</span>${t('wheel')}${wheel ? '<i class="dot"></i>' : ''}</button>
      </div>
      <div class="sidecol right">
        ${state.noAds ? '' : `<button class="side" id="sNoAds"><span class="si">🚫</span>${t('noAds')}</button>`}
        <button class="side" id="sFree"><span class="si">🎬</span>${t('freeCoins')}</button>
      </div>
      <div class="homeBottom">
        <div class="chapterTag">${t('chapter')} ${chapterOf(state.level) + 1} · ${theme.name[getLang()]}</div>
        <div class="strip">${strip.join('')}</div>
        ${mech ? `<div class="mchips">${mech}</div>` : ''}
        <button class="big ${lp.difficulty}" id="btnPlay"><small>${t('level')} ${state.level}${lp.difficulty !== 'normal' ? ' · ' + t(lp.difficulty) : ''}</small>${t('play')}</button>
      </div>
    </div>`;
  $('#btnPlay').onclick = () => {
    sfx.tap();
    startLevel(state.level);
  };
  $('#sDaily').onclick = openDaily;
  $('#sWheel').onclick = openWheel;
  const na = $('#sNoAds');
  if (na) na.onclick = () => purchase('noads');
  $('#sFree').onclick = freeCoinsAd;
}

const levelCache = new Map();
function generateLevelCached(n) {
  if (!levelCache.has(n)) {
    levelCache.set(n, generateLevel(n));
    if (levelCache.size > 60) levelCache.delete(levelCache.keys().next().value);
  }
  return levelCache.get(n);
}
function mechOf(n) {
  const m = levelMechanics(n);
  return (m.moves ? '🕹️' : '') + (m.time ? '⏱️' : '') + (m.ice ? '🧊' : '') + (m.colorSlots ? '⭐' : '');
}
function difficultyOf(n) {
  const sp = levelParams(n).spike;
  return sp === 2 && n >= 10 ? 'superhard' : sp >= 1 && n >= 5 ? 'hard' : 'normal';
}

function renderMap(body) {
  const cur = state.level;
  const lastChapter = Math.ceil(MAX_LEVEL / CHAPTER_SIZE) - 1;
  let html = '<div class="mapwrap">';
  for (let c = lastChapter; c >= 0; c--) {
    const theme = THEMES[c % THEMES.length];
    const start = c * CHAPTER_SIZE + 1;
    const end = start + CHAPTER_SIZE - 1;
    let rows = '';
    for (let n = end; n >= start; n--) {
      const locked = n > cur;
      const isCur = n === cur;
      const st = state.stars[n] || 0;
      const diff = difficultyOf(n);
      const cls = locked ? 'locked' : isCur ? 'current' : diff;
      const starsHtml = !locked && !isCur ? `<span class="nstars">${'⭐'.repeat(st)}</span>` : '';
      const mi = n >= 7 ? mechOf(n) : '';
      rows += `<div class="noderow"><button class="node ${cls}" data-n="${n}" ${isCur ? 'id="curNode"' : ''}>${n === end && locked ? '🎁' : n}${starsHtml}${mi ? `<span class="nmech">${mi}</span>` : ''}</button></div>`;
    }
    html += `<div class="chapterHead" style="background:${theme.map[1]}">${t('chapter')} ${c + 1}<small>${theme.name[getLang()]}</small></div>
      <div class="path" style="background:${theme.map[0]}55">${rows}</div>`;
  }
  html += '</div>';
  body.innerHTML = html;
  $$('.node', body).forEach((b) => {
    b.onclick = () => {
      const n = +b.dataset.n;
      if (n > cur) {
        sfx.bump();
        return toast(`🔒 ${t('locked')} — ${t('level')} ${cur}`);
      }
      sfx.tap();
      startLevel(n);
    };
  });
  const cn = $('#curNode');
  if (cn) cn.scrollIntoView({ block: 'center' });
}

function stylePreview(id) {
  switch (id) {
    case 'metallic':
      return 'linear-gradient(135deg,#e0e6ee,#7a8794 45%,#f4f7fa 55%,#5b6774)';
    case 'candy':
      return 'linear-gradient(135deg,#ffc2d9,#c6f0ff,#fff3b0)';
    case 'neon':
      return 'linear-gradient(135deg,#ff2bd6,#2bf6ff);box-shadow:0 0 12px #2bf6ff';
    default:
      return 'linear-gradient(135deg,#ff4b3e,#3388ff,#3fd15a)';
  }
}

function renderShop(body) {
  const fcLeft = M.freeCoinsLeft(state);
  const iapItems = PRODUCTS.filter((p) => !(p.key === 'noads' && state.noAds) && !(p.key === 'starter' && state.purchases.starter))
    .map((p) => {
      const price = priceOf(p.key) || p.fallback;
      return `<div class="item ${p.badge ? 'special' : ''}">${p.badge ? `<span class="tag">${t(p.badge)}</span>` : ''}
        <span class="ii">${p.icon}</span>
        <div class="it"><b>${t('iap')[p.key]}</b><span>${t('iapDesc')[p.key]}</span></div>
        <button class="btn small blue" data-iap="${p.key}">${price}</button></div>`;
    })
    .join('');
  const boosters = ['crane', 'sort', 'slot']
    .map(
      (k) => `<div class="item"><span class="ii">${{ crane: '🏗️', sort: '🔀', slot: '🅿️' }[k]}</span>
      <div class="it"><b>${t('boosterTitle')[k]} <small style="opacity:.6">×${state.boosters[k] || 0}</small></b><span>${t('boosterDesc')[k]}</span></div>
      <button class="btn small" data-bb="${k}" ${state.coins >= ECONOMY.prices[k] ? '' : 'disabled'}><span class="coin"></span>${ECONOMY.prices[k]}</button></div>`
    )
    .join('');
  const styles = STYLES.map((s) => {
    const owned = state.ownedStyles.includes(s.id);
    const eq = state.style === s.id;
    const btn = eq
      ? `<button class="btn small blue" disabled>${t('equipped')}</button>`
      : owned
        ? `<button class="btn small blue" data-eq="${s.id}">${t('equip')}</button>`
        : `<button class="btn small" data-st="${s.id}" ${state.coins >= s.price ? '' : 'disabled'}><span class="coin"></span>${fmt(s.price)}</button>`;
    return `<div class="stylecard"><div class="swatch" style="background:${stylePreview(s.id)}"></div><b>${s.icon} ${t('style')[s.id]}</b>${btn}</div>`;
  }).join('');
  const cb = state.coinBonus || 0;
  const cbPrice = M.COIN_BONUS_PRICES[cb];
  body.innerHTML = `
    <div class="panel"><h3>${t('shopReal')}</h3>${iapItems}
      ${storeReady() ? '' : `<div class="note">${t('storeUnavailable')}</div>`}</div>
    <div class="panel"><h3>${t('shopFree')} <small>${fcLeft} ${t('leftToday')}</small></h3>
      <div class="item"><span class="ii">🎬</span><div class="it"><b>+${M.FREE_COINS.amount} <span class="coin" style="width:16px;height:16px;vertical-align:-2px"></span></b><span>${t('watchAd')}</span></div>
      <button class="btn small yellow" id="bFree" ${fcLeft > 0 ? '' : 'disabled'}>▶ ${t('watchAd')}</button></div></div>
    <div class="panel"><h3>${t('shopBoosters')}</h3>${boosters}</div>
    <div class="panel"><h3>${t('shopStyles')}</h3><div class="grid2">${styles}</div></div>
    <div class="panel"><h3>${t('shopUpgrades')}</h3>
      <div class="item"><span class="ii">💹</span><div class="it"><b>${t('coinBonus')} ${cb}/5</b><span>${t('coinBonusDesc')}</span>
      <div class="mbar"><div style="width:${cb * 20}%"></div></div></div>
      ${cb >= 5 ? `<button class="btn small" disabled>${t('max')}</button>` : `<button class="btn small" id="bCB" ${state.coins >= cbPrice ? '' : 'disabled'}><span class="coin"></span>${fmt(cbPrice)}</button>`}</div></div>`;
  $$('[data-iap]', body).forEach((b) => (b.onclick = () => purchase(b.dataset.iap)));
  $$('[data-bb]', body).forEach(
    (b) =>
      (b.onclick = () => {
        const k = b.dataset.bb;
        if (state.coins < ECONOMY.prices[k]) return toast(t('notEnough'));
        addCoins(-ECONOMY.prices[k]);
        state.boosters[k] = (state.boosters[k] || 0) + 1;
        sfx.coin();
        persist();
        renderShop(body);
      })
  );
  $$('[data-st]', body).forEach(
    (b) =>
      (b.onclick = () => {
        const s = STYLES.find((x) => x.id === b.dataset.st);
        if (state.coins < s.price) return toast(t('notEnough'));
        addCoins(-s.price);
        state.ownedStyles.push(s.id);
        state.style = s.id;
        R.setStyle(s.id);
        sfx.levelUp();
        persist();
        renderShop(body);
      })
  );
  $$('[data-eq]', body).forEach(
    (b) =>
      (b.onclick = () => {
        state.style = b.dataset.eq;
        R.setStyle(state.style);
        sfx.click();
        persist();
        renderShop(body);
      })
  );
  const bf = $('#bFree');
  if (bf) bf.onclick = freeCoinsAd;
  const bcb = $('#bCB');
  if (bcb)
    bcb.onclick = () => {
      if (state.coins < cbPrice) return toast(t('notEnough'));
      addCoins(-cbPrice);
      state.coinBonus = cb + 1;
      sfx.levelUp();
      persist();
      renderShop(body);
    };
}

let missionSub = 'daily';
function renderMissions(body) {
  M.ensureMissions(state);
  const mReady = M.missionsReady(state);
  const aReady = M.achReady(state);
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const left = Math.max(0, midnight - now);
  const hh = Math.floor(left / 3600000),
    mm = Math.floor((left % 3600000) / 60000);
  let content;
  if (missionSub === 'daily') {
    content = state.missions.list
      .map((m, i) => {
        const done = m.progress >= m.target;
        const btn = m.claimed
          ? `<button class="btn small" disabled>✔</button>`
          : `<button class="btn small ${done ? '' : 'blue'}" data-mi="${i}" ${done ? '' : 'disabled'}><span class="coin"></span>${m.reward}</button>`;
        return `<div class="item"><span class="ii">${{ wins: '🏁', passengers: '🧍', departures: '🚌', boosters: '🧰', hardWins: '🔥', threeStars: '⭐', noBoosterWins: '💪', spins: '🎡' }[m.type]}</span>
        <div class="it"><b>${t('mission')[m.type]}</b><span>${m.progress}/${m.target}</span><div class="mbar"><div style="width:${(m.progress / m.target) * 100}%"></div></div></div>${btn}</div>`;
      })
      .join('');
    content = `<div class="panel"><h3>${t('dailyMissions')} <small>⏱ ${t('resetsIn')} ${hh}s ${mm}d</small></h3>${content}</div>`;
    if (getLang() === 'en') content = content.replace(`${hh}s ${mm}d`, `${hh}h ${mm}m`);
  } else {
    content = M.ACHIEVEMENTS.map((a) => {
      const v = Math.min(a.target, M.achValue(state, a));
      const done = v >= a.target;
      const claimed = state.achClaimed[a.id];
      const btn = claimed
        ? `<button class="btn small" disabled>✔</button>`
        : `<button class="btn small ${done ? '' : 'blue'}" data-ach="${a.id}" ${done ? '' : 'disabled'}><span class="coin"></span>${fmt(a.reward)}</button>`;
      return `<div class="item"><span class="ii">${a.icon}</span><div class="it"><b>${t('ach')[a.id]}</b><span>${fmt(v)}/${fmt(a.target)}</span><div class="mbar"><div style="width:${(v / a.target) * 100}%"></div></div></div>${btn}</div>`;
    }).join('');
    content = `<div class="panel"><h3>${t('achievements')}</h3>${content}</div>`;
  }
  body.innerHTML = `<div class="subtabs">
      <button data-sub="daily" class="${missionSub === 'daily' ? 'on' : ''}">${t('dailyMissions')}${mReady ? '<i class="dot"></i>' : ''}</button>
      <button data-sub="ach" class="${missionSub === 'ach' ? 'on' : ''}">${t('achievements')}${aReady ? '<i class="dot"></i>' : ''}</button>
    </div>${content}`;
  $$('[data-sub]', body).forEach(
    (b) =>
      (b.onclick = () => {
        missionSub = b.dataset.sub;
        sfx.click();
        renderMissions(body);
      })
  );
  $$('[data-mi]', body).forEach(
    (b) =>
      (b.onclick = (e) => {
        const m = state.missions.list[+b.dataset.mi];
        if (m.claimed || m.progress < m.target) return;
        m.claimed = true;
        const r = b.getBoundingClientRect();
        flyCoins(m.reward, { x: r.left + r.width / 2, y: r.top });
        const ups = M.addXp(state, 15);
        persist();
        renderMissions(body);
        renderMenuTop();
        if (ups.length) setTimeout(() => showLevelUp(ups), 900);
        void e;
      })
  );
  $$('[data-ach]', body).forEach(
    (b) =>
      (b.onclick = () => {
        const a = M.ACHIEVEMENTS.find((x) => x.id === b.dataset.ach);
        if (state.achClaimed[a.id] || M.achValue(state, a) < a.target) return;
        state.achClaimed[a.id] = true;
        const r = b.getBoundingClientRect();
        flyCoins(a.reward, { x: r.left + r.width / 2, y: r.top });
        persist();
        renderMissions(body);
        refreshDots();
      })
  );
}

function renderRank(body) {
  const st = state.stats;
  body.innerHTML = `
    <div class="trophy">🏆</div>
    <div class="panel"><h3>${t('rankTitle')}</h3>
      <button class="btn blue" id="bLB">🌍 ${t('openLeaderboard')}</button>
      ${gamesAvailable() ? '' : `<div class="note">${t('lbUnavailable')}</div>`}
    </div>
    <div class="panel"><h3>${t('yourStats')}</h3>
      <div class="statgrid">
        <div class="stat"><b>${state.level - 1}</b><span>${t('statLevel')}</span></div>
        <div class="stat"><b>${M.totalStars(state)} ⭐</b><span>${t('statStars')}</span></div>
        <div class="stat"><b>${fmt(st.passengers || 0)}</b><span>${t('statPax')}</span></div>
        <div class="stat"><b>${fmt(st.departures || 0)}</b><span>${t('statDep')}</span></div>
        <div class="stat"><b>${fmt(st.wins || 0)}</b><span>${t('statWins')}</span></div>
        <div class="stat"><b>${state.plevel}</b><span>${t('playerLevel')}</span></div>
      </div>
    </div>`;
  $('#bLB').onclick = async () => {
    sfx.click();
    if (!gamesAvailable()) return toast(t('lbUnavailable'));
    const ok = await openLeaderboard();
    if (!ok) toast(t('lbFail'));
  };
}

/* ---------------- daily reward ---------------- */
function rewardIcon(r) {
  if (r.coins && r.booster) return '🎁';
  if (r.coins) return '💰';
  return { crane: '🏗️', sort: '🔀', slot: '🅿️' }[r.booster];
}
function rewardText(r) {
  const parts = [];
  if (r.coins) parts.push(fmt(r.coins));
  if (r.booster) parts.push(`${t('boosterTitle')[r.booster].split(' ')[0]} ×${r.n}`);
  return parts.join(' + ');
}
function openDaily() {
  sfx.click();
  const st = M.dailyStatus(state);
  const days = M.DAILY_REWARDS.map((r, i) => {
    const done = st.available ? i < st.dayIndex : i <= st.dayIndex;
    const today = st.available && i === st.dayIndex;
    return `<div class="dayc ${done ? 'done' : ''} ${today ? 'today' : ''} ${i === 6 ? 'wide' : ''}">${t('day')} ${i + 1}<div class="di">${rewardIcon(r)}</div>${rewardText(r)}</div>`;
  }).join('');
  openModal(`
    <button class="closex">✕</button>
    <div class="big-ico">📅</div>
    <h2>${t('dailyTitle')}</h2>
    <p>${t('dailySub')}</p>
    <div class="days">${days}</div>
    ${
      st.available
        ? `<button class="btn yellow" id="dX2">▶ ${t('claimX2')}</button><button class="btn" id="dClaim">${t('claim')}</button>`
        : `<p style="margin-top:12px">${t('comeTomorrow')}</p>`
    }`);
  const claim = (mult) => {
    const r = M.claimDaily(state, mult);
    if (!r) return;
    if (r.coins) {
      state.coins -= r.coins * mult; // flyCoins will add it back with animation
      flyCoins(r.coins * mult);
    }
    sfx.levelUp();
    persist();
    closeModal();
    renderMenuTop();
    renderTab();
    if (r.booster) toast(`+${r.n * mult} ${t('boosterTitle')[r.booster]}`);
  };
  if (st.available) {
    $('#dClaim').onclick = () => claim(1);
    $('#dX2').onclick = async () => {
      $('#dX2').disabled = true;
      if (await rewarded()) claim(2);
      else $('#dX2').disabled = false;
    };
  }
}

/* ---------------- lucky wheel ---------------- */
let wheelAngle = 0;
function drawWheel(canvas) {
  const g = canvas.getContext('2d');
  const s = canvas.width;
  const r = s / 2;
  const n = M.WHEEL.length;
  g.clearRect(0, 0, s, s);
  M.WHEEL.forEach((seg, i) => {
    const a0 = (i / n) * Math.PI * 2 - Math.PI / 2 - Math.PI / n;
    const a1 = a0 + (Math.PI * 2) / n;
    g.beginPath();
    g.moveTo(r, r);
    g.arc(r, r, r, a0, a1);
    g.closePath();
    g.fillStyle = seg.color;
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 4;
    g.stroke();
    g.save();
    g.translate(r, r);
    g.rotate((a0 + a1) / 2);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `${s * 0.085}px sans-serif`;
    g.fillText(seg.coins ? '💰' : { crane: '🏗️', sort: '🔀', slot: '🅿️' }[seg.booster], r * 0.68, 0);
    g.fillStyle = '#1e2a44';
    g.font = `800 ${s * 0.06}px 'Baloo 2', sans-serif`;
    g.fillText(seg.coins ? seg.coins : '×1', r * 0.42, 0);
    g.restore();
  });
}
function openWheel() {
  sfx.click();
  const st = M.wheelStatus(state);
  openModal(`
    <button class="closex">✕</button>
    <h2>${t('wheelTitle')}</h2>
    <div class="wheelwrap"><canvas id="wheelCv" width="540" height="540"></canvas><div class="hubdot"></div><div class="pointer"></div></div>
    ${st.free ? `<button class="btn" id="wFree">${t('spinFree')}</button>` : st.adLeft > 0 ? `<button class="btn yellow" id="wAd">▶ ${t('spinAd')}</button><div class="note">${t('spinsLeft')}: ${st.adLeft}</div>` : `<p>${t('noSpins')}</p>`}
  `);
  const cv = $('#wheelCv');
  drawWheel(cv);
  cv.style.transition = 'none';
  cv.style.transform = `rotate(${wheelAngle}deg)`;
  const spin = () => {
    const idx = M.rollWheel();
    const n = M.WHEEL.length;
    const segAngle = 360 / n;
    const target = 360 * 6 + (360 - idx * segAngle) + (Math.random() - 0.5) * segAngle * 0.6;
    const base = wheelAngle - (wheelAngle % 360);
    wheelAngle = base + target;
    void cv.offsetWidth;
    cv.style.transition = '';
    cv.style.transform = `rotate(${wheelAngle}deg)`;
    $$('#modalCard .btn').forEach((b) => (b.disabled = true));
    $('#modalCard .closex').disabled = true;
    let ticks = 0;
    const ti = setInterval(() => {
      sfx.tick();
      if (++ticks > 26) clearInterval(ti);
    }, 140);
    missionToasts(M.track(state, 'spins', 1));
    setTimeout(() => {
      clearInterval(ti);
      const prize = M.WHEEL[idx];
      M.grant(state, prize.booster ? { booster: prize.booster, n: 1 } : {});
      persist();
      sfx.win();
      openModal(`
        <div class="big-ico">${prize.coins ? '💰' : { crane: '🏗️', sort: '🔀', slot: '🅿️' }[prize.booster]}</div>
        <h2>${t('youWon')}</h2>
        <div class="reward">${prize.coins ? `<span class="coin"></span>${fmt(prize.coins)}` : `${t('boosterTitle')[prize.booster]} ×1`}</div>
        <button class="btn" id="wOk">${t('claim')}</button>`);
      $('#wOk').onclick = () => {
        closeModal();
        if (prize.coins) flyCoins(prize.coins);
        renderMenuTop();
        renderTab();
      };
    }, 4100);
  };
  const wf = $('#wFree');
  if (wf)
    wf.onclick = () => {
      state.wheel.freeUsed = true;
      persist();
      spin();
    };
  const wa = $('#wAd');
  if (wa)
    wa.onclick = async () => {
      wa.disabled = true;
      if (await rewarded()) {
        state.wheel.adSpins++;
        persist();
        spin();
      } else wa.disabled = false;
    };
}

async function freeCoinsAd() {
  sfx.click();
  if (M.freeCoinsLeft(state) <= 0) return toast(t('noSpins'));
  if (!(await rewarded())) return;
  state.freeCoins.count++;
  persist();
  flyCoins(M.FREE_COINS.amount);
  if (tab === 'shop') setTimeout(renderTab, 1200);
}

/* ---------------- purchases ---------------- */
function grantProduct(key) {
  const p = PRODUCTS.find((x) => x.key === key);
  if (!p) return;
  const g = p.grant;
  if (g.noAds) state.noAds = true;
  if (g.boosters) for (const k of ['crane', 'sort', 'slot']) state.boosters[k] = (state.boosters[k] || 0) + g.boosters;
  if (!p.consumable) state.purchases[key] = true;
  persist();
  if (g.coins) flyCoins(g.coins);
}
async function purchase(key) {
  sfx.click();
  if (!storeReady()) return toast(t('storeUnavailable'));
  const res = await buy(key);
  if (res.ok) {
    grantProduct(key);
    sfx.levelUp();
    toast(t('thanks'));
    renderMenuTop();
    renderTab();
  } else if (res.reason !== 'cancelled') toast(t('purchaseFail'));
}
async function restorePurchases() {
  const keys = await ownedNonConsumables();
  let changed = false;
  for (const k of keys) {
    if (!state.purchases[k]) {
      const p = PRODUCTS.find((x) => x.key === k);
      if (p.grant.noAds) state.noAds = true;
      state.purchases[k] = true;
      changed = true;
    }
  }
  if (keys.some((k) => PRODUCTS.find((p) => p.key === k)?.grant.noAds) && !state.noAds) {
    state.noAds = true;
    changed = true;
  }
  if (changed) persist();
  toast(keys.length ? t('restored') : t('storeUnavailable'));
}

/* ------------------------------------------------------------------ */
/* GAME                                                                */
/* ------------------------------------------------------------------ */
function updateHud() {
  $('#levelText').textContent = `${t('level')} ${playing}`;
  refreshCoins();
  const b = $('#diffBadge');
  if (levelData && levelData.difficulty !== 'normal') {
    b.classList.remove('hidden');
    b.classList.toggle('super', levelData.difficulty === 'superhard');
    b.textContent = t(levelData.difficulty);
  } else b.classList.add('hidden');
  $$('.booster').forEach((el) => {
    const k = el.dataset.b;
    const n = state.boosters[k] || 0;
    const c = el.querySelector('.cnt');
    c.textContent = n > 0 ? n : '+';
    c.classList.toggle('plus', n === 0);
    el.classList.toggle('active', k === 'crane' && craneMode);
  });
  updateChallenge();
  updateProgress();
}
function fmtTime(sec) {
  sec = Math.max(0, Math.ceil(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
function updateChallenge() {
  const el = $('#challenge');
  if (!game) return el.classList.add('hidden');
  const parts = [];
  if (game.movesLeft !== null) parts.push(`<span class="ch ${game.movesLeft <= 3 ? 'warn' : ''}">🕹️ ${game.movesLeft}</span>`);
  if (timeLeft !== null) parts.push(`<span class="ch ${timeLeft <= 10 ? 'warn' : ''}">⏱️ ${fmtTime(timeLeft)}${timerStarted ? '' : ' ⏸'}</span>`);
  el.innerHTML = parts.join('');
  el.classList.toggle('hidden', !parts.length);
}
function updateProgress() {
  if (!game) return;
  const total = game.totalPassengers;
  const left = R.visQueue ? R.visQueue.length : game.queue.length;
  $('#progressFill').style.width = ((total - left) / total) * 100 + '%';
}

function startLevel(n) {
  closeModal();
  playing = n;
  levelData = generateLevel(n);
  game = new Game(levelData);
  game.settle();
  const theme = themeForLevel(n);
  R.setStyle(state.style);
  R.padding = { top: levelData.moves || levelData.time ? 118 : 96, bottom: 150, side: 10 };
  R.loadLevel(game, theme);
  previewLevel = 0;
  R.paused = false;
  craneMode = false;
  ended = false;
  usedBoosters = 0;
  usedContinue = 0;
  inGame = true;
  timeLeft = levelData.time || null;
  timerStarted = false;
  startSong(theme.song || theme.id);
  const menu = $('#menu');
  if (!menu.classList.contains('hidden')) {
    menu.classList.add('fade');
    setTimeout(() => menu.classList.add('hidden'), 350);
  }
  $('#hud').classList.remove('hidden');
  updateHud();
  if (n === 1) tip(t('tutorial1'));
  else if (n === 2) tip(t('tutorial2'));
  else if (n === 3) tip(t('tutorial3'));
  else tip(null);
  refreshHint();
  // explain rules the player has not seen yet
  const fresh = mechList(levelData).filter((k) => !state.seenMech?.[k]);
  if (fresh.length) {
    state.seenMech = state.seenMech || {};
    fresh.forEach((k) => (state.seenMech[k] = true));
    persist();
    const k = fresh[0];
    openModal(`
      <div class="ribbon">${t('newRule')}</div>
      <div class="big-ico">${MECH_ICON[k]}</div>
      <h2>${t('mech')[k]}</h2>
      <p>${t('mechDesc')[k]}</p>
      <button class="btn" id="mOk">${t('gotIt')}</button>`);
    $('#mOk').onclick = () => {
      closeModal();
      ruleSplash(n, theme);
    };
  } else ruleSplash(n, theme);
}

function ruleSplash(n, theme) {
  if (levelData.difficulty !== 'normal') splash(`${t(levelData.difficulty)}<small>${t('level')} ${n}</small>`, levelData.difficulty === 'superhard' ? 'super' : '');
  else if ((n - 1) % CHAPTER_SIZE === 0 && n > 1) splash(`${theme.name[getLang()]}<small>${t('chapter')} ${chapterOf(n) + 1}</small>`, 'info');
  else if (levelData.moves) splash(`🕹️ ${levelData.moves}<small>${t('mech').moves}</small>`, 'info');
  else if (levelData.time) splash(`⏱️ ${fmtTime(levelData.time)}<small>${t('mech').time}</small>`, 'info');
}

function tickTimer() {
  if (!inGame || !game || ended || timeLeft === null || !timerStarted || modalOpen() || document.hidden) return;
  timeLeft -= 0.25;
  if (timeLeft <= 10 && Math.ceil(timeLeft) !== lastAlarm) {
    lastAlarm = Math.ceil(timeLeft);
    sfx.alarm();
  }
  if (timeLeft <= 0) {
    timeLeft = 0;
    if (game.status === 'playing') {
      game.status = 'lost';
      game.loseReason = 'time';
      ended = true;
      onLose();
    }
  }
  updateChallenge();
}
setInterval(tickTimer, 250);

function refreshHint() {
  if (playing > 2 || !game || game.status !== 'playing') return R.removeHint();
  const front = game.queue[0];
  const movable = game.lotVehicles().filter((v) => game.pathCheck(v).free);
  const best = movable.find((v) => v.color === front) || movable[0];
  if (best) R.whenIdle(() => game && game.status === 'playing' && R.showHint(best.id));
}

function onPick(id) {
  if (!game || ended || modalOpen()) return;
  unlockAudio();
  if (craneMode) {
    const ev = game.crane(id);
    if (!ev) return toast(t('noslot'));
    craneMode = false;
    timerStarted = true;
    consumeBooster('crane');
    tip(null);
    handleEvents(ev);
    return;
  }
  sfx.tap();
  const ev = game.tap(id);
  if (!ev.length) return;
  if (ev[0].type === 'blocked') toast(t('blocked'));
  if (ev[0].type === 'noslot') toast(t('noslot'));
  if (ev[0].type === 'frozen') toast(`🧊 ${t('frozenMsg').replace('{n}', ev[0].ice)}`);
  if (ev[0].type === 'exit' || ev[0].type === 'blocked') timerStarted = true;
  handleEvents(ev);
  updateChallenge();
}

function handleEvents(ev) {
  R.play(ev, game);
  if (ev.some((e) => e.type === 'exit') && playing <= 2) refreshHint();
  if (ev.some((e) => e.type === 'win')) {
    ended = true;
    R.whenIdle(onWin, 0.3);
  } else if (ev.some((e) => e.type === 'lose')) {
    ended = true;
    R.whenIdle(onLose, 0.5);
  }
}

function levelReward() {
  const replay = playing < state.level;
  let r = replay ? ECONOMY.replayCoins * 2 : ECONOMY.winCoins;
  if (!replay && levelData.difficulty === 'hard') r += ECONOMY.hardBonus;
  if (!replay && levelData.difficulty === 'superhard') r += ECONOMY.superhardBonus;
  if (!replay) r += 10 * mechList(levelData).length;
  return Math.round(r * M.coinMultiplier(state));
}

function onWin() {
  if (!inGame) return;
  sfx.win();
  haptics.heavy();
  R.confetti();
  tip(null);
  const replay = playing < state.level;
  const stars = Math.max(1, 3 - usedBoosters - usedContinue);
  const prevStars = state.stars[playing] || 0;
  state.stars[playing] = Math.max(prevStars, stars);
  const coins = levelReward();
  const xp = replay ? 5 : M.xpForWin(levelData.difficulty, stars);
  const done = [];
  done.push(...M.track(state, 'wins', 1));
  if (levelData.difficulty !== 'normal') done.push(...M.track(state, 'hardWins', 1));
  if (stars === 3) done.push(...M.track(state, 'threeStars', 1));
  if (usedBoosters === 0 && usedContinue === 0) done.push(...M.track(state, 'noBoosterWins', 1));
  const won = playing;
  if (!replay) {
    state.level = playing + 1;
    submitLevel(won);
  }
  const ups = M.addXp(state, xp);
  persist();
  missionToasts(done);
  const starHtml = [1, 2, 3].map((i) => `<span class="${i <= stars ? '' : 'off'}">⭐</span>`).join('');
  openModal(`
    <div class="ribbon">${t('win')}</div>
    <div class="stars">${starHtml}</div>
    <p>${t('winSub')}</p>
    <div><span class="reward"><span class="coin"></span>+<span id="rw">${coins}</span></span><span class="reward xp">+${xp} ${t('xp')}</span></div>
    <button class="btn yellow" id="bDouble">▶ ${t('double')}</button>
    <div class="btnrow"><button class="btn blue" id="bHome">🏠</button><button class="btn" id="bNext" style="flex:3">${t('next')}</button></div>
  `);
  let claimed = false;
  const claim = (mult) => {
    if (claimed) return;
    claimed = true;
    const r = $('#rw').getBoundingClientRect();
    flyCoins(coins * mult, { x: r.left, y: r.top });
  };
  $('#bDouble').onclick = async () => {
    $('#bDouble').disabled = true;
    if (await rewarded()) {
      $('#rw').textContent = coins * 2;
      claim(2);
      $('#bDouble').classList.add('hidden');
    } else $('#bDouble').disabled = false;
  };
  const proceed = async (toMenu) => {
    claim(1);
    $('#bNext').disabled = true;
    $('#bHome').disabled = true;
    await new Promise((r) => setTimeout(r, 700));
    if (!replay) await maybeInterstitial(won, state.noAds);
    if (ups.length) await showLevelUp(ups);
    if (toMenu || replay) showMenu(replay ? 'map' : 'home');
    else startLevel(state.level);
  };
  $('#bNext').onclick = () => proceed(false);
  $('#bHome').onclick = () => proceed(true);
}

function showLevelUp(ups) {
  return new Promise((resolve) => {
    const last = ups[ups.length - 1];
    const coins = ups.reduce((s, u) => s + u.coins, 0);
    sfx.levelUp();
    state.coins -= coins; // shown via fly animation
    openModal(`
      <div class="big-ico">🎓</div>
      <h2>${t('levelUp')}</h2>
      <div class="plevel" style="margin:10px auto;width:70px;height:70px;font-size:32px">${last.plevel}</div>
      <div><span class="reward"><span class="coin"></span>+${coins}</span></div>
      <p>+1 ${t('boosterTitle')[last.booster]}</p>
      <button class="btn" id="luOk">${t('claim')}</button>`);
    $('#luOk').onclick = () => {
      closeModal();
      flyCoins(coins);
      if (!inGame) renderMenuTop();
      setTimeout(resolve, 500);
    };
  });
}

const LOSE_INFO = {
  stuck: { icon: '🚦', cont: 'contAd', contCoins: 'contCoins' },
  moves: { icon: '🕹️', cont: 'contMovesAd', contCoins: 'contMoves' },
  time: { icon: '⏰', cont: 'contTimeAd', contCoins: 'contTime' },
};
function onLose() {
  if (!inGame || !game) return;
  sfx.lose();
  haptics.heavy();
  const reason = game.loseReason || 'stuck';
  const info = LOSE_INFO[reason];
  const canAfford = state.coins >= ECONOMY.continueCost;
  openModal(`
    <div class="big-ico">${info.icon}</div>
    <h2>${t('loseTitle')[reason]}</h2>
    <p>${t('loseSub')}</p>
    <button class="btn yellow" id="bAd">▶ ${t(info.cont)}</button>
    <button class="btn blue" id="bCoins" ${canAfford ? '' : 'disabled'}>${t(info.contCoins)} · <span class="coin"></span>${ECONOMY.continueCost}</button>
    <div class="btnrow"><button class="btn ghost" id="bHome">🏠 ${t('home')}</button><button class="btn ghost" id="bRetry">↻ ${t('retry')}</button></div>
  `);
  $('#bAd').onclick = async () => {
    $('#bAd').disabled = true;
    if (await rewarded()) doContinue(reason);
    else $('#bAd').disabled = false;
  };
  $('#bCoins').onclick = () => {
    if (state.coins < ECONOMY.continueCost) return toast(t('notEnough'));
    addCoins(-ECONOMY.continueCost);
    doContinue(reason);
  };
  $('#bRetry').onclick = () => startLevel(playing);
  $('#bHome').onclick = () => showMenu('home');
}

function doContinue(reason) {
  closeModal();
  usedContinue++;
  ended = false;
  let ev = [];
  if (reason === 'moves') {
    game.addMoves(5);
    ev = game.settle();
  } else if (reason === 'time') {
    timeLeft = 20;
    game.revive();
    ev = game.settle();
  } else {
    ev = game.addSlot() || game.sortQueue(40) || [];
  }
  handleEvents(ev);
  updateChallenge();
  if (game.status === 'lost' && !ended) {
    ended = true;
    R.whenIdle(onLose, 0.3);
  }
}

function consumeBooster(k) {
  state.boosters[k]--;
  usedBoosters++;
  missionToasts(M.track(state, 'boosters', 1));
  persist();
  updateHud();
}

function useBooster(k) {
  if (!game || ended) return;
  unlockAudio();
  if (k === 'crane') {
    if (craneMode) {
      craneMode = false;
      tip(null);
      updateHud();
      return;
    }
    if (game.freeSlotIndex() < 0) return toast(t('noslot'));
    craneMode = true;
    tip(t('craneHelp'));
    updateHud();
    return;
  }
  if (R.isBusy()) return toast(t('wait'));
  if (k === 'sort') {
    const ev = game.sortQueue(16);
    if (!ev) return toast(t('nothingToSort'));
    sfx.booster();
    consumeBooster('sort');
    handleEvents(ev);
  } else if (k === 'slot') {
    const ev = game.addSlot();
    if (!ev) return toast(t('slotMax'));
    consumeBooster('slot');
    handleEvents(ev);
  }
}

function boosterClick(k) {
  if (!game || ended) return;
  if ((state.boosters[k] || 0) > 0 || (k === 'crane' && craneMode)) return useBooster(k);
  const price = ECONOMY.prices[k];
  openModal(`
    <button class="closex">✕</button>
    <div class="big-ico">${{ crane: '🏗️', sort: '🔀', slot: '🅿️' }[k]}</div>
    <h2>${t('boosterTitle')[k]}</h2>
    <p>${t('boosterDesc')[k]}</p>
    <button class="btn yellow" id="bAd">▶ ${t('freeWithAd')}</button>
    <button class="btn blue" id="bBuy" ${state.coins >= price ? '' : 'disabled'}>${t('buy')} · <span class="coin"></span>${price}</button>
  `);
  $('#bAd').onclick = async () => {
    $('#bAd').disabled = true;
    if (await rewarded()) {
      state.boosters[k] = (state.boosters[k] || 0) + 1;
      persist();
      closeModal();
      updateHud();
      useBooster(k);
    } else $('#bAd').disabled = false;
  };
  $('#bBuy').onclick = () => {
    if (state.coins < price) return toast(t('notEnough'));
    addCoins(-price);
    state.boosters[k] = (state.boosters[k] || 0) + 1;
    persist();
    closeModal();
    updateHud();
    useBooster(k);
  };
}

function openPause() {
  if (!game || ended) return;
  sfx.click();
  const tg = (k) => `<button class="toggle ${state.settings[k] ? 'on' : ''}" data-k="${k}"></button>`;
  openModal(`
    <h2>${t('paused')}</h2>
    <div style="margin-top:8px">
      <div class="row">${t('sound')} ${tg('sfx')}</div>
      <div class="row">${t('music')} ${tg('music')}</div>
      <div class="row">${t('vibration')} ${tg('haptic')}</div>
    </div>
    <button class="btn" id="pRes">▶ ${t('resume')}</button>
    <div class="btnrow"><button class="btn blue" id="pRe">↻ ${t('restart')}</button><button class="btn blue" id="pHome">🏠 ${t('home')}</button></div>`);
  $$('.toggle', $('#modalCard')).forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.k;
      state.settings[k] = !state.settings[k];
      b.classList.toggle('on', state.settings[k]);
      applySettings();
      persist();
    };
  });
  $('#pRes').onclick = closeModal;
  $('#pRe').onclick = () => startLevel(playing);
  $('#pHome').onclick = () => showMenu('home');
}

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */
async function boot() {
  const saved = await loadSave();
  const def = M.defaultState();
  if (saved) {
    state = {
      ...def,
      ...saved,
      boosters: { ...def.boosters, ...(saved.boosters || {}) },
      settings: { ...def.settings, ...(saved.settings || {}) },
      stats: { ...def.stats, ...(saved.stats || {}) },
      daily: { ...def.daily, ...(saved.daily || {}) },
      wheel: { ...def.wheel, ...(saved.wheel || {}) },
      freeCoins: { ...def.freeCoins, ...(saved.freeCoins || {}) },
      missions: saved.missions || def.missions,
      ownedStyles: saved.ownedStyles || def.ownedStyles,
      stars: saved.stars || {},
      achClaimed: saved.achClaimed || {},
      purchases: saved.purchases || {},
      seenMech: saved.seenMech || {},
    };
  }
  M.ensureMissions(state);
  audioState.sfx = state.settings.sfx;
  audioState.music = state.settings.music;
  applySettings();

  $('#btnSettings').onclick = () => {
    unlockAudio();
    openSettings();
  };
  $('#btnPause').onclick = openPause;
  $('#menuCoins').onclick = () => {
    sfx.click();
    tab = 'shop';
    renderTab();
  };
  $$('#tabs button').forEach(
    (b) =>
      (b.onclick = () => {
        unlockAudio();
        sfx.click();
        tab = b.dataset.tab;
        renderTab();
      })
  );
  $$('.booster').forEach((el) => (el.onclick = () => boosterClick(el.dataset.b)));
  document.addEventListener('pointerdown', () => unlockAudio(), { once: true });

  // first launch goes straight into level 1 for a fast start
  if (!saved) {
    state.tutorialDone = true;
    persist();
    showMenu('home');
  } else showMenu('home');

  initAds();
  initIAP().then(async (ok) => {
    if (ok) {
      const keys = await ownedNonConsumables();
      let changed = false;
      for (const k of keys) {
        const p = PRODUCTS.find((x) => x.key === k);
        if (!state.purchases[k]) {
          state.purchases[k] = true;
          changed = true;
        }
        if (p?.grant.noAds && !state.noAds) {
          state.noAds = true;
          changed = true;
        }
      }
      if (changed) persist();
      if (!inGame) renderTab();
    }
  });
  initGames().then(() => {
    if (state.level > 1) submitLevel(state.level - 1);
    if (!inGame && tab === 'rank') renderTab();
  });

  onBackButton(() => {
    if (modalOpen()) {
      if (!ended || !inGame) {
        const cx = $('#modalCard .closex');
        if (cx) cx.click();
        else if (inGame) closeModal();
        else closeModal();
      }
      return true;
    }
    if (craneMode) {
      craneMode = false;
      tip(null);
      updateHud();
      return true;
    }
    if (inGame) {
      openPause();
      return true;
    }
    if (tab !== 'home') {
      tab = 'home';
      renderTab();
      return true;
    }
    return false;
  });
  onPause(() => suspendAudio());
  document.addEventListener('visibilitychange', () => (document.hidden ? suspendAudio() : resumeAudio()));
  window.__cc = {
    get state() {
      return state;
    },
    get game() {
      return game;
    },
    startLevel,
    showMenu,
    R,
  };
}

boot();
