// Native bridges: storage, haptics, ads, back button. Falls back gracefully in a browser.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { App } from '@capacitor/app';
import { ADS, PRIVACY_URL } from './config.js';

export const isNative = Capacitor.isNativePlatform();

/* ---------------- storage ---------------- */
const SAVE_KEY = 'cc_save_v1';
export async function loadSave() {
  try {
    const { value } = await Preferences.get({ key: SAVE_KEY });
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}
let saveTimer = null;
export function writeSave(data) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    Preferences.set({ key: SAVE_KEY, value: JSON.stringify(data) }).catch(() => {});
  }, 150);
}

/* ---------------- haptics ---------------- */
export const haptics = {
  enabled: true,
  light() {
    if (!this.enabled) return;
    if (isNative) Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
    else navigator.vibrate?.(8);
  },
  medium() {
    if (!this.enabled) return;
    if (isNative) Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
    else navigator.vibrate?.(18);
  },
  heavy() {
    if (!this.enabled) return;
    if (isNative) Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {});
    else navigator.vibrate?.([20, 40, 20]);
  },
};

/* ---------------- back button ---------------- */
export function onBackButton(handler) {
  if (!isNative) return;
  App.addListener('backButton', () => {
    if (!handler()) App.minimizeApp().catch(() => {});
  });
}
export function onPause(handler) {
  if (!isNative) return;
  App.addListener('pause', handler);
}

/* ---------------- ads ---------------- */
// Ads are served by Unity Ads through the small native bridge in
// android/app/src/main/java/.../UnityAdsPlugin.java ("UnityAdsBridge").
//
// Interstitials are only shown at natural breaks (level end, retry, back to
// menu) - never in the middle of a level. Two triggers:
//   * every ADS.interstitialEveryNLevels won levels
//   * every ADS.timedEverySec seconds of active play ("every 3 minutes")
// and never closer together than ADS.interstitialCooldownSec.
//
// UnityAdsBridge.show() resolves only after the ad is closed, with
// { state: 'completed' | 'skipped' | 'failed' }.
const UnityAds = registerPlugin('UnityAdsBridge');

let adsReady = false;
let lastInterstitial = Date.now();
const loaded = { level: false, reward: false };
const loading = { level: false, reward: false };
const retryDelay = { level: 15, reward: 15 };
let playingNow = false;
let playSinceAd = 0;
let adOnScreen = false;
let audioHooks = { pause: () => {}, resume: () => {} };

setInterval(() => {
  if (playingNow && !document.hidden && !adOnScreen) playSinceAd++;
}, 1000);
/** true while a level is on screen and not paused */
export function setPlaying(v) {
  playingNow = !!v;
}
/** main.js passes its audio suspend/resume so music stops while an ad plays */
export function setAdAudioHooks(pause, resume) {
  audioHooks = { pause, resume };
}
export function adIsOnScreen() {
  return adOnScreen;
}

const UNIT = () => ({ level: ADS.interstitialId, reward: ADS.rewardedId });

async function preload(kind) {
  if (!adsReady || loaded[kind] || loading[kind]) return;
  loading[kind] = true;
  try {
    await UnityAds.load({ placementId: UNIT()[kind] });
    loaded[kind] = true;
    retryDelay[kind] = 15;
  } catch {
    loaded[kind] = false;
    // no fill / offline: try again later with back-off (15 s ... 5 min)
    const d = retryDelay[kind];
    retryDelay[kind] = Math.min(300, d * 2);
    setTimeout(() => preload(kind), d * 1000);
  } finally {
    loading[kind] = false;
  }
}

export async function initAds() {
  if (!isNative || !ADS.gameId) return;
  for (let attempt = 0; attempt < 5 && !adsReady; attempt++) {
    try {
      await UnityAds.initialize({ gameId: ADS.gameId, testMode: ADS.testing });
      adsReady = true;
    } catch {
      await new Promise((r) => setTimeout(r, 20000 * (attempt + 1)));
    }
  }
  if (!adsReady) return;
  preload('reward');
  preload('level');
}

/** Unity Ads shows its own privacy controls inside every ad; this opens our privacy policy. */
export async function showPrivacyOptions() {
  try {
    window.open(PRIVACY_URL, '_blank');
    return true;
  } catch {
    return false;
  }
}

/**
 * Call at a natural break. Resolves after the ad was closed (or right away
 * when no ad is due / available).
 * progress  = player's current level (no ads during the first levels)
 * wonLevel  = level just won (null for retry / back-to-menu breaks)
 */
export async function maybeInterstitial(noAds, { progress = 0, wonLevel = null } = {}) {
  if (noAds || adOnScreen) return false;
  if (progress < ADS.interstitialFromLevel) return false;
  if ((Date.now() - lastInterstitial) / 1000 < ADS.interstitialCooldownSec) return false;
  const timed = playSinceAd >= ADS.timedEverySec;
  const byLevel = wonLevel != null && wonLevel % ADS.interstitialEveryNLevels === 0;
  if (!timed && !byLevel) return false;
  if (!isNative || !adsReady) return false;
  if (!loaded.level) {
    preload('level');
    return false;
  }
  let shown = false;
  adOnScreen = true;
  audioHooks.pause();
  try {
    loaded.level = false;
    const res = await UnityAds.show({ placementId: UNIT().level });
    shown = !!res && res.state !== 'failed';
    if (shown) {
      lastInterstitial = Date.now();
      playSinceAd = 0;
    }
  } catch {
    /* not shown: try again at the next break */
  } finally {
    adOnScreen = false;
    audioHooks.resume();
    preload('level');
  }
  return shown;
}

/** true when a rewarded ad is ready to play right now */
export function rewardedReady() {
  return !isNative || loaded.reward;
}

/** why the last showRewarded() returned: 'earned' | 'closed' (closed early) | 'noad' */
export let lastRewardResult = 'noad';

/** resolves true if the user earned the reward (false if closed early / no ad) */
export async function showRewarded() {
  lastRewardResult = 'noad';
  if (!isNative) {
    // browser preview: simulate a short ad
    await new Promise((r) => setTimeout(r, 600));
    lastRewardResult = 'earned';
    return true;
  }
  if (!adsReady || adOnScreen) return false;
  if (!loaded.reward) {
    // give a just-started load a few seconds to finish
    preload('reward');
    for (let i = 0; i < 16 && !loaded.reward; i++) await new Promise((r) => setTimeout(r, 250));
    if (!loaded.reward) return false;
  }
  adOnScreen = true;
  audioHooks.pause();
  let earned = false;
  try {
    loaded.reward = false;
    const res = await UnityAds.show({ placementId: UNIT().reward });
    const state = res && res.state;
    earned = state === 'completed';
    lastRewardResult = earned ? 'earned' : state === 'skipped' ? 'closed' : 'noad';
    if (earned) {
      playSinceAd = 0;
      lastInterstitial = Date.now(); // don't stack an interstitial right after a rewarded ad
    }
  } catch {
    earned = false;
  } finally {
    adOnScreen = false;
    audioHooks.resume();
    preload('reward');
  }
  return earned;
}
