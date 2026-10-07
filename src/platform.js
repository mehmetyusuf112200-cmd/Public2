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
// Interstitials are only shown between levels (never mid-game) and never more
// than once every ADS.interstitialCooldownSec seconds.
let adsReady = false;
let lastInterstitial = Date.now();
let interstitialLoaded = false;
let rewardLoaded = false;

async function preloadInterstitial() {
  if (!adsReady || interstitialLoaded) return;
  try {
    await AdMob.prepareInterstitial({ adId: ADS.interstitialId, isTesting: ADS.testing });
    interstitialLoaded = true;
  } catch {
    interstitialLoaded = false;
  }
}
async function preloadReward() {
  if (!adsReady || rewardLoaded) return;
  try {
    await AdMob.prepareRewardVideoAd({ adId: ADS.rewardedId, isTesting: ADS.testing });
    rewardLoaded = true;
  } catch {
    rewardLoaded = false;
  }
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
    preloadInterstitial();
    preloadReward();
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

export async function maybeInterstitial(levelJustWon, noAds) {
  if (noAds) return;
  if (levelJustWon < ADS.interstitialFromLevel) return;
  if (levelJustWon % ADS.interstitialEveryNLevels !== 0) return;
  if ((Date.now() - lastInterstitial) / 1000 < ADS.interstitialCooldownSec) return;
  if (!isNative || !adsReady || !interstitialLoaded) return;
  try {
    interstitialLoaded = false;
    await AdMob.showInterstitial();
    lastInterstitial = Date.now();
  } catch {
    /* ignore */
  }
  preloadInterstitial();
}

/** resolves true if the user earned the reward */
export async function showRewarded() {
  if (!isNative) {
    // browser preview: simulate a short ad
    await new Promise((r) => setTimeout(r, 600));
    return true;
  }
  if (!adsReady) return false;
  if (!rewardLoaded) {
    await preloadReward();
    if (!rewardLoaded) return false;
  }
  try {
    rewardLoaded = false;
    const item = await AdMob.showRewardVideoAd();
    lastInterstitial = Date.now(); // don't stack an interstitial right after a rewarded ad
    preloadReward();
    return !!item;
  } catch {
    preloadReward();
    return false;
  }
}
