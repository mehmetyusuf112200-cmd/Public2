// Google Play Games leaderboard bridge (native plugin in MainActivity).
import { registerPlugin } from '@capacitor/core';
import { isNative } from './platform.js';
import { GAMES } from './config.js';

const PlayGames = registerPlugin('PlayGames');
let available = false;
let signedIn = false;

export async function initGames() {
  if (!isNative || !GAMES.leaderboardId) return false;
  try {
    available = (await PlayGames.isAvailable()).available;
    if (available) {
      // silent check; Play Games usually signs players in automatically
      signedIn = (await PlayGames.signIn({ interactive: false })).signedIn;
    }
  } catch {
    available = false;
  }
  return available;
}
export function gamesAvailable() {
  return available;
}

export async function submitLevel(level) {
  if (!available) return;
  try {
    await PlayGames.submitScore({ leaderboardId: GAMES.leaderboardId, score: level });
  } catch {
    /* ignore */
  }
}

export async function openLeaderboard() {
  if (!available) return false;
  try {
    if (!signedIn) signedIn = (await PlayGames.signIn({ interactive: true })).signedIn;
    if (!signedIn) return false;
    await PlayGames.showLeaderboard({ leaderboardId: GAMES.leaderboardId });
    return true;
  } catch {
    return false;
  }
}
