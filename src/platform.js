// Native bridges: storage, haptics, ads, back button. Falls back gracefully in a browser.
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { App } from '@capacitor/app';
import { AdMob, AdmobConsentStatus } from '@capacitor-community/admob';
import { ADS } from './config.js';

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
// Interstitials are only shown at natural breaks (level end, retry, back to
// menu) - never in the middle of a level. Two triggers:
//   * every ADS.interstitialEveryNLevels won levels
//   * every ADS.timedEverySec seconds of active play ("every 3 minutes")
// and never closer together than ADS.interstitialCooldownSec.
//
// The AdMob plugin resolves showRewardVideoAd() ONLY when a reward is earned
// and showInterstitial() as soon as the ad opens, so both are driven by the
// plugin's Dismissed / FailedToShow events instead (otherwise closing a
// rewarded ad early froze the button and the game kept running behind ads).
const EV = {
  intDismissed: 'interstitialAdDismissed',
  intFailedShow: 'interstitialAdFailedToShow',
  rewRewarded: 'onRewardedVideoAdReward',
  rewDismissed: 'onRewardedVideoAdDismissed',
  rewFailedShow: 'onRewardedVideoAdFailedToShow',
};
let adsReady = false;
let lastInterstitial = Date.now();
const loaded = { level: false, timed: false, reward: false };
const loading = { level: false, timed: false, reward: false };
const retryDelay = { level: 15, timed: 15, reward: 15 };
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

const UNIT = () => ({ level: ADS.interstitialId, timed: ADS.timedInterstitialId || ADS.interstitialId, reward: ADS.rewardedId });

async function preload(kind) {
  if (!adsReady || loaded[kind] || loading[kind]) return;
  loading[kind] = true;
  try {
    const opts = { adId: UNIT()[kind], isTesting: ADS.testing };
    if (kind === 'reward') await AdMob.prepareRewardVideoAd(opts);
    else await AdMob.prepareInterstitial(opts);
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

/**
 * Registers listeners for `events`; resolves (once registered) with { done },
 * a promise for the name of the first event that fires (or 'timeout').
 */
async function firstEvent(events, timeoutMs) {
  let finish;
  const result = new Promise((resolve) => (finish = resolve));
  let done = false;
  const handles = await Promise.all(
    events.map((e) =>
      AdMob.addListener(e, () => {
        if (done) return;
        done = true;
        finish(e);
      }).catch(() => null)
    )
  );
  const timer = setTimeout(() => {
    if (!done) {
      done = true;
      finish('timeout');
    }
  }, timeoutMs);
  return {
    done: result.then((name) => {
      clearTimeout(timer);
      handles.forEach((h) => h && h.remove().catch(() => {}));
      return name;
    }),
  };
}

export async function initAds() {
  if (!isNative) return;
  try {
    await AdMob.initialize({ initializeForTesting: ADS.testing });
    try {
      const info = await AdMob.requestConsentInfo();
      if (info.isConsentFormAvailable && info.status === AdmobConsentStatus.REQUIRED) {
        await AdMob.showConsentForm();
      }
    } catch {
      /* consent is best-effort */
    }
    adsReady = true;
    preload('reward');
    preload('level');
    if (ADS.timedInterstitialId) preload('timed');
  } catch {
    adsReady = false;
  }
}

export async function showPrivacyOptions() {
  if (!isNative) return false;
  try {
    await AdMob.showPrivacyOptionsForm();
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
  // prefer the unit that matches the trigger, fall back to the other one
  let kind = timed && loaded.timed ? 'timed' : loaded.level ? 'level' : loaded.timed ? 'timed' : null;
  if (!kind) {
    preload('level');
    if (ADS.timedInterstitialId) preload('timed');
    return false;
  }
  let shown = false;
  adOnScreen = true;
  audioHooks.pause();
  try {
    loaded[kind] = false;
    const closed = await firstEvent([EV.intDismissed, EV.intFailedShow], 90000);
    await AdMob.showInterstitial({ adId: UNIT()[kind] });
    const how = await closed.done;
    shown = how !== EV.intFailedShow;
    if (shown) {
      lastInterstitial = Date.now();
      playSinceAd = 0;
    }
  } catch {
    /* not shown: try again at the next break */
  } finally {
    adOnScreen = false;
    audioHooks.resume();
    preload(kind);
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
  const rewardSub = AdMob.addListener(EV.rewRewarded, () => (earned = true)).catch(() => null);
  try {
    await rewardSub;
    loaded.reward = false;
    const closed = await firstEvent([EV.rewDismissed, EV.rewFailedShow], 180000);
    AdMob.showRewardVideoAd()
      .then(() => (earned = true))
      .catch(() => {});
    await closed.done;
    // the reward callback can arrive a moment after the close event
    if (!earned) await new Promise((r) => setTimeout(r, 400));
    lastRewardResult = earned ? 'earned' : 'closed';
    if (earned) {
      playSinceAd = 0;
      lastInterstitial = Date.now(); // don't stack an interstitial right after a rewarded ad
    }
  } catch {
    earned = false;
  } finally {
    rewardSub.then((h) => h && h.remove()).catch(() => {});
    adOnScreen = false;
    audioHooks.resume();
    preload('reward');
  }
  return earned;
}
