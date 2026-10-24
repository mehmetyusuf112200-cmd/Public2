// ---------------------------------------------------------------------------
// Unity Ads settings (Unity Dashboard > Monetization > Commute Craze).
// AdMob was removed in favour of Unity Ads.
// ---------------------------------------------------------------------------
export const ADS = {
  // The TEST apk is built with VITE_ADS_TEST=1 and shows Unity test ads (safe to
  // click). The Play Store build serves real ads.
  testing: import.meta.env.VITE_ADS_TEST === '1',
  gameId: '800410220',
  interstitialId: 'BP_Interstitial_Android',
  rewardedId: 'BP_Rewarded_Android',
  interstitialFromLevel: 6, // no interstitials during the first levels
  interstitialEveryNLevels: 3,
  interstitialCooldownSec: 120,
  // "every 3 minutes" break: after 180 s of active play the next natural break
  // (level end, retry, back to menu) shows an interstitial
  timedEverySec: 180,
};

// ---------------------------------------------------------------------------
// Google Play Games leaderboard.
//   Play Console > Play Games Services > Setup: copy the numeric Project ID into
//   android/app/src/main/res/values/strings.xml (game_services_project_id),
//   create a leaderboard "En Yüksek Bölüm" and paste its ID (CgkI...) below.
// ---------------------------------------------------------------------------
export const GAMES = {
  leaderboardId: '',
};

export const ECONOMY = {
  startCoins: 300,
  winCoins: 25,
  hardBonus: 15,
  superhardBonus: 35,
  replayCoins: 5,
  prices: { crane: 150, sort: 100, slot: 200 },
  startBoosters: { crane: 2, sort: 2, slot: 1 },
  continueCost: 250,
};

export const PRIVACY_URL = 'https://mehmetyusuf112200-cmd.github.io/commute-craze-privacy.html';
