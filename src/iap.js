// Google Play in-app purchases (real money). Product IDs must be created in
// Play Console > Monetize > In-app products with exactly these IDs.
import { NativePurchases, PURCHASE_TYPE } from '@capgo/native-purchases';
import { isNative } from './platform.js';

export const PRODUCTS = [
  { key: 'noads', id: 'remove_ads', consumable: false, icon: '🚫', fallback: '₺49,99', grant: { noAds: true } },
  { key: 'starter', id: 'starter_pack', consumable: false, icon: '🎁', fallback: '₺79,99', grant: { noAds: true, coins: 3000, boosters: 5 }, badge: 'best' },
  { key: 'coins_s', id: 'coins_small', consumable: true, icon: '💰', fallback: '₺29,99', grant: { coins: 2000 } },
  { key: 'coins_m', id: 'coins_medium', consumable: true, icon: '💰', fallback: '₺79,99', grant: { coins: 6500 }, badge: 'popular' },
  { key: 'coins_l', id: 'coins_large', consumable: true, icon: '🏦', fallback: '₺179,99', grant: { coins: 16000 } },
  { key: 'boosters', id: 'booster_bundle', consumable: true, icon: '🧰', fallback: '₺39,99', grant: { boosters: 5 } },
  { key: 'piggy', id: 'piggy_bank', consumable: true, icon: '🐷', fallback: '₺59,99', grant: { piggy: true }, hidden: true },
];

let ready = false;
const prices = {};

export function priceOf(key) {
  return prices[key];
}
export function storeReady() {
  return ready;
}

export async function initIAP() {
  if (!isNative) return false;
  try {
    const { isBillingSupported } = await NativePurchases.isBillingSupported();
    if (!isBillingSupported) return false;
    const { products } = await NativePurchases.getProducts({
      productIdentifiers: PRODUCTS.map((p) => p.id),
      productType: PURCHASE_TYPE.INAPP,
    });
    for (const pr of products || []) {
      const p = PRODUCTS.find((x) => x.id === pr.identifier);
      if (p) prices[p.key] = pr.priceString;
    }
    ready = (products || []).length > 0;
    return ready;
  } catch {
    ready = false;
    return false;
  }
}

/** returns the product keys of owned non-consumables (for restore) */
export async function ownedNonConsumables() {
  if (!isNative) return [];
  try {
    const { purchases } = await NativePurchases.getPurchases({ productType: PURCHASE_TYPE.INAPP });
    const keys = [];
    for (const t of purchases || []) {
      if (t.purchaseState !== undefined && String(t.purchaseState) !== '1' && String(t.purchaseState).toUpperCase() !== 'PURCHASED') continue;
      const p = PRODUCTS.find((x) => x.id === t.productIdentifier && !x.consumable);
      if (p) keys.push(p.key);
    }
    return keys;
  } catch {
    return [];
  }
}

/** resolves {ok:true} or {ok:false, reason} */
export async function buy(key) {
  const p = PRODUCTS.find((x) => x.key === key);
  if (!p) return { ok: false, reason: 'unknown' };
  if (!isNative || !ready || !prices[key]) return { ok: false, reason: 'unavailable' };
  try {
    const tx = await NativePurchases.purchaseProduct({
      productIdentifier: p.id,
      productType: PURCHASE_TYPE.INAPP,
      quantity: 1,
      isConsumable: p.consumable,
    });
    if (tx && tx.purchaseState !== undefined && String(tx.purchaseState) !== '1' && String(tx.purchaseState).toUpperCase() !== 'PURCHASED') {
      return { ok: false, reason: 'pending' };
    }
    return { ok: true };
  } catch (e) {
    const msg = String(e?.message || e || '').toLowerCase();
    return { ok: false, reason: msg.includes('cancel') ? 'cancelled' : 'error' };
  }
}
