import '@fontsource/baloo-2/600.css';
import '@fontsource/baloo-2/800.css';
import './style.css';
import { Game, generateLevel } from './core/logic.js';
import { Renderer } from './render.js';
import { t, setLang, getLang } from './i18n.js';
import { sfx, unlockAudio, setSfx, setMusic, suspendAudio, resumeAudio, audioState } from './audio.js';
import {
  loadSave,
  writeSave,
  haptics,
  initAds,
  maybeInterstitial,
  showRewarded,
  showPrivacyOptions,
  onBackButton,
  onPause,
  isNative,
} from './platform.js';
import { ECONOMY, PRIVACY_URL } from './config.js';

const $ = (s) => document.querySelector(s);

const state = {
  level: 1,
  coins: ECONOMY.startCoins,
  boosters: { ...ECONOMY.startBoosters },
  settings: { sfx: true, music: true, haptic: true, lang: getLang() },
  noAds: false,
};

let game = null;
let levelData = null;
let craneMode = false;
let ended = false;
let usedContinue = 0;

const R = new Renderer($('#scene'));
R.onPick = onPick;

/* ------------------------------------------------------------------ */
function persist() {
  writeSave(state);
}

function applySettings() {
  setSfx(state.settings.sfx);
  setMusic(state.settings.music);
  haptics.enabled = state.settings.haptic;
  setLang(state.settings.lang);
  document.documentElement.lang = getLang();
  document.querySelectorAll('[data-t]').forEach((el) => (el.textContent = t(el.dataset.t)));
  $('#btnPlay').textContent = t('play');
  $('#homeLevel').textContent = `${t('level')} ${state.level}`;
  updateHud();
}

function updateHud() {
  $('#levelText').textContent = `${t('level')} ${state.level}`;
  $('#coinText').textContent = state.coins;
  const b = $('#diffBadge');
  if (levelData && levelData.difficulty !== 'normal') {
    b.classList.remove('hidden');
    b.classList.toggle('super', levelData.difficulty === 'superhard');
    b.textContent = t(levelData.difficulty);
  } else b.classList.add('hidden');
  document.querySelectorAll('.booster').forEach((el) => {
    const k = el.dataset.b;
    const n = state.boosters[k] || 0;
    const c = el.querySelector('.cnt');
    c.textContent = n > 0 ? n : '+';
    c.classList.toggle('plus', n === 0);
    el.classList.toggle('active', k === 'crane' && craneMode);
  });
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
}

function tip(msg) {
  const el = $('#tip');
  if (!msg) return el.classList.add('hidden');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function addCoins(n) {
  state.coins += n;
  persist();
  updateHud();
  const c = $('.coins');
  c.classList.remove('bump');
  void c.offsetWidth;
  c.classList.add('bump');
}

/* ------------------------------------------------------------------ */
/* level flow                                                          */
/* ------------------------------------------------------------------ */

function startLevel() {
  closeModal();
  levelData = generateLevel(state.level);
  game = new Game(levelData);
  game.settle();
  R.loadLevel(game);
  craneMode = false;
  ended = false;
  usedContinue = 0;
  updateHud();
  // tutorial
  if (state.level === 1) tip(t('tutorial1'));
  else if (state.level === 2) tip(t('tutorial2'));
  else if (state.level === 3) tip(t('tutorial3'));
  else tip(null);
  refreshHint();
  if (levelData.difficulty !== 'normal') {
    const sp = $('#splash');
    sp.innerHTML = `<div class="${levelData.difficulty === 'superhard' ? 'super' : ''}">${t(levelData.difficulty)}<small>${t('level')} ${state.level}</small></div>`;
    sp.classList.remove('hidden');
    setTimeout(() => sp.classList.add('hidden'), 1700);
  }
}

function refreshHint() {
  if (state.level > 2 || !game || game.status !== 'playing') return R.removeHint();
  const front = game.queue[0];
  const movable = game.lotVehicles().filter((v) => game.pathCheck(v).free);
  const best = movable.find((v) => v.color === front) || movable[0];
  if (best) R.whenIdle(() => game.status === 'playing' && R.showHint(best.id));
}

function onPick(id) {
  if (!game || ended || !$('#modal').classList.contains('hidden')) return;
  unlockAudio();
  if (craneMode) {
    const ev = game.crane(id);
    if (!ev) {
      toast(t('noslot'));
      return;
    }
    craneMode = false;
    state.boosters.crane--;
    persist();
    updateHud();
    tip(null);
    handleEvents(ev);
    return;
  }
  sfx.tap();
  const ev = game.tap(id);
  if (!ev.length) return;
  if (ev[0].type === 'blocked') toast(t('blocked'));
  if (ev[0].type === 'noslot') toast(t('noslot'));
  handleEvents(ev);
}

function handleEvents(ev) {
  R.play(ev, game);
  if (ev.some((e) => e.type === 'exit') && state.level <= 2) refreshHint();
  if (ev.some((e) => e.type === 'win')) {
    ended = true;
    R.whenIdle(onWin, 0.3);
  } else if (ev.some((e) => e.type === 'lose')) {
    ended = true;
    R.whenIdle(onLose, 0.5);
  }
}

function reward() {
  let r = ECONOMY.winCoins;
  if (levelData.difficulty === 'hard') r += ECONOMY.hardBonus;
  if (levelData.difficulty === 'superhard') r += ECONOMY.superhardBonus;
  return r;
}

function onWin() {
  sfx.win();
  haptics.heavy();
  R.confetti();
  tip(null);
  const r = reward();
  const won = state.level;
  state.level++;
  persist();
  openModal(`
    <div class="stars">⭐⭐⭐</div>
    <h2>${t('win')}</h2>
    <p>${t('winSub')}</p>
    <div class="reward"><span class="coin"></span>+<span id="rw">${r}</span></div>
    <button class="btn yellow" id="bDouble">▶ ${t('double')}</button>
    <button class="btn" id="bNext">${t('next')}</button>
  `);
  let claimed = false;
  const claim = (mult) => {
    if (claimed) return;
    claimed = true;
    addCoins(r * mult);
    sfx.coin();
  };
  $('#bDouble').onclick = async () => {
    $('#bDouble').disabled = true;
    const ok = await showRewarded();
    if (ok) {
      $('#rw').textContent = r * 2;
      claim(2);
      $('#bDouble').classList.add('hidden');
    } else {
      toast(t('adFail'));
      $('#bDouble').disabled = false;
    }
  };
  $('#bNext').onclick = async () => {
    claim(1);
    $('#bNext').disabled = true;
    await maybeInterstitial(won, state.noAds);
    startLevel();
  };
}

function onLose() {
  sfx.lose();
  haptics.heavy();
  const canAfford = state.coins >= ECONOMY.continueCost;
  openModal(`
    <div class="big-ico">🚦</div>
    <h2>${t('lose')}</h2>
    <p>${t('loseSub')}</p>
    <button class="btn yellow" id="bAd">▶ ${t('contAd')}</button>
    <button class="btn blue" id="bCoins" ${canAfford ? '' : 'disabled'}>${t('contCoins')} · <span class="coin"></span>${ECONOMY.continueCost}</button>
    <button class="btn ghost" id="bRetry">↻ ${t('retry')}</button>
  `);
  $('#bAd').onclick = async () => {
    $('#bAd').disabled = true;
    const ok = await showRewarded();
    if (ok) doContinue();
    else {
      toast(t('adFail'));
      $('#bAd').disabled = false;
    }
  };
  $('#bCoins').onclick = () => {
    if (state.coins < ECONOMY.continueCost) return toast(t('notEnough'));
    addCoins(-ECONOMY.continueCost);
    doContinue();
  };
  $('#bRetry').onclick = () => startLevel();
}

function doContinue() {
  closeModal();
  usedContinue++;
  ended = false;
  let ev = game.addSlot();
  if (!ev) ev = game.sortQueue(40) || [];
  handleEvents(ev);
  if (game.status === 'lost') {
    ended = true;
    R.whenIdle(onLose, 0.3);
  }
}

/* ------------------------------------------------------------------ */
/* boosters                                                            */
/* ------------------------------------------------------------------ */

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
    state.boosters.sort--;
    persist();
    updateHud();
    handleEvents(ev);
    return;
  } else if (k === 'slot') {
    const ev = game.addSlot();
    if (!ev) return toast(t('slotMax'));
    state.boosters.slot--;
    handleEvents(ev);
    persist();
    updateHud();
  }
}

function boosterClick(k) {
  if (!game || ended) return;
  if ((state.boosters[k] || 0) > 0 || (k === 'crane' && craneMode)) return useBooster(k);
  const price = ECONOMY.prices[k];
  openModal(`
    <button class="closex" id="bClose">✕</button>
    <div class="big-ico">${{ crane: '🏗️', sort: '🔀', slot: '🅿️' }[k]}</div>
    <h2>${t('boosterTitle')[k]}</h2>
    <p>${t('boosterDesc')[k]}</p>
    <button class="btn yellow" id="bAd">▶ ${t('freeWithAd')}</button>
    <button class="btn blue" id="bBuy" ${state.coins >= price ? '' : 'disabled'}>${t('buy')} · <span class="coin"></span>${price}</button>
  `);
  $('#bClose').onclick = closeModal;
  $('#bAd').onclick = async () => {
    $('#bAd').disabled = true;
    const ok = await showRewarded();
    if (ok) {
      state.boosters[k] = (state.boosters[k] || 0) + 1;
      persist();
      closeModal();
      updateHud();
      useBooster(k);
    } else {
      toast(t('adFail'));
      $('#bAd').disabled = false;
    }
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

/* ------------------------------------------------------------------ */
/* modal & settings                                                    */
/* ------------------------------------------------------------------ */

function openModal(html) {
  $('#modalCard').innerHTML = html;
  $('#modal').classList.remove('hidden');
}
function closeModal() {
  $('#modal').classList.add('hidden');
}

function openSettings() {
  const tg = (k) => `<button class="toggle ${state.settings[k] ? 'on' : ''}" data-k="${k}"></button>`;
  openModal(`
    <button class="closex" id="bClose">✕</button>
    <h2>${t('settings')}</h2>
    <div style="margin-top:12px">
      <div class="row">${t('sound')} ${tg('sfx')}</div>
      <div class="row">${t('music')} ${tg('music')}</div>
      <div class="row">${t('vibration')} ${tg('haptic')}</div>
      <div class="row">${t('language')}
        <div class="seg"><button data-l="tr" class="${getLang() === 'tr' ? 'on' : ''}">TR</button><button data-l="en" class="${getLang() === 'en' ? 'on' : ''}">EN</button></div>
      </div>
    </div>
    <button class="btn blue" id="bRestart">↻ ${t('restart')}</button>
    <button class="linkbtn" id="bPriv">${t('privacy')}</button>
    ${isNative ? `<br><button class="linkbtn" id="bPrivOpt">${t('privacyOptions')}</button>` : ''}
  `);
  $('#bClose').onclick = closeModal;
  document.querySelectorAll('.toggle').forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.k;
      state.settings[k] = !state.settings[k];
      b.classList.toggle('on', state.settings[k]);
      applySettings();
      persist();
      if (k === 'sfx' && state.settings.sfx) sfx.tap();
    };
  });
  document.querySelectorAll('.seg button').forEach((b) => {
    b.onclick = () => {
      state.settings.lang = b.dataset.l;
      applySettings();
      persist();
      openSettings();
    };
  });
  $('#bRestart').onclick = () => startLevel();
  $('#bPriv').onclick = () => window.open(PRIVACY_URL, '_blank');
  const po = $('#bPrivOpt');
  if (po) po.onclick = () => showPrivacyOptions();
}

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */

async function boot() {
  const saved = await loadSave();
  if (saved) {
    Object.assign(state, saved, {
      boosters: { ...ECONOMY.startBoosters, ...(saved.boosters || {}) },
      settings: { ...state.settings, ...(saved.settings || {}) },
    });
  }
  audioState.sfx = state.settings.sfx;
  audioState.music = state.settings.music;
  applySettings();
  startLevel();

  $('#btnSettings').onclick = () => {
    unlockAudio();
    openSettings();
  };
  document.querySelectorAll('.booster').forEach((el) => (el.onclick = () => boosterClick(el.dataset.b)));
  $('#btnPlay').onclick = () => {
    unlockAudio();
    $('#home').classList.add('fade');
    setTimeout(() => $('#home').classList.add('hidden'), 400);
    initAds();
  };
  onBackButton(() => {
    if (!$('#modal').classList.contains('hidden') && !ended) {
      closeModal();
      return true;
    }
    if (craneMode) {
      craneMode = false;
      tip(null);
      updateHud();
      return true;
    }
    return false;
  });
  onPause(() => suspendAudio());
  document.addEventListener('visibilitychange', () => (document.hidden ? suspendAudio() : resumeAudio()));
  // debug helper for browser testing
  window.__cc = { state, get game() { return game; }, startLevel, R };
}

boot();
