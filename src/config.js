// ---------------------------------------------------------------------------
// AdMob settings.
// These are Google's official TEST ad unit IDs. Before releasing:
//   1. Create the app in AdMob (https://apps.admob.com) -> get the App ID
//      (ca-app-pub-8983296148880903~XXXXXXXXXX) and put it into
//      android/app/src/main/res/values/strings.xml  (admob_app_id)
//   2. Create one Interstitial and one Rewarded ad unit, paste their IDs below
//   3. Set testing: false
// ---------------------------------------------------------------------------
export const ADS = {
  testing: true,
  interstitialId: 'ca-app-pub-3940256099942544/1033173712',
  rewardedId: 'ca-app-pub-3940256099942544/5224354917',
  interstitialFromLevel: 6, // no interstitials during the first levels
  interstitialEveryNLevels: 3,
  interstitialCooldownSec: 120,
};

export const ECONOMY = {
  startCoins: 300,
  winCoins: 25,
  hardBonus: 15,
  superhardBonus: 35,
  prices: { crane: 150, sort: 100, slot: 200 },
  startBoosters: { crane: 2, sort: 2, slot: 1 },
  continueCost: 250,
};

export const PRIVACY_URL = 'https://mehmetyusuf112200-cmd.github.io/commute-craze-privacy.html';
