// ---------------------------------------------------------------------------
// AdMob settings — real IDs of the "Commute Craze" app in AdMob.
// App ID (strings.xml admob_app_id): ca-app-pub-8983296148880903~8188694706
// ---------------------------------------------------------------------------
export const ADS = {
  testing: false,
  interstitialId: 'ca-app-pub-8983296148880903/3702654782',
  rewardedId: 'ca-app-pub-8983296148880903/8828567964',
  interstitialFromLevel: 6, // no interstitials during the first levels
  interstitialEveryNLevels: 3,
  interstitialCooldownSec: 120,
  // "every 3 minutes" break: after 180 s of active play the next natural break
  // (level end, retry, back to menu) shows an interstitial from its own ad unit
  timedEverySec: 180,
  timedInterstitialId: 'ca-app-pub-8983296148880903/2002385294', // AdMob: max 1 per user per 3 min
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
