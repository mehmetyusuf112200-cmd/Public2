// 30 languages. English is bundled as the fallback; the others load on demand.
import en from './locales/en.json';

export const LANGS = [
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'tr', name: 'Türkçe', flag: '🇹🇷' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'pt', name: 'Português', flag: '🇧🇷' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'it', name: 'Italiano', flag: '🇮🇹' },
  { code: 'ru', name: 'Русский', flag: '🇷🇺' },
  { code: 'uk', name: 'Українська', flag: '🇺🇦' },
  { code: 'pl', name: 'Polski', flag: '🇵🇱' },
  { code: 'nl', name: 'Nederlands', flag: '🇳🇱' },
  { code: 'ro', name: 'Română', flag: '🇷🇴' },
  { code: 'cs', name: 'Čeština', flag: '🇨🇿' },
  { code: 'hu', name: 'Magyar', flag: '🇭🇺' },
  { code: 'el', name: 'Ελληνικά', flag: '🇬🇷' },
  { code: 'sv', name: 'Svenska', flag: '🇸🇪' },
  { code: 'ar', name: 'العربية', flag: '🇸🇦', rtl: true },
  { code: 'fa', name: 'فارسی', flag: '🇮🇷', rtl: true },
  { code: 'he', name: 'עברית', flag: '🇮🇱', rtl: true },
  { code: 'ur', name: 'اردو', flag: '🇵🇰', rtl: true },
  { code: 'hi', name: 'हिन्दी', flag: '🇮🇳' },
  { code: 'bn', name: 'বাংলা', flag: '🇧🇩' },
  { code: 'id', name: 'Bahasa Indonesia', flag: '🇮🇩' },
  { code: 'ms', name: 'Bahasa Melayu', flag: '🇲🇾' },
  { code: 'vi', name: 'Tiếng Việt', flag: '🇻🇳' },
  { code: 'th', name: 'ไทย', flag: '🇹🇭' },
  { code: 'fil', name: 'Filipino', flag: '🇵🇭' },
  { code: 'zh', name: '中文', flag: '🇨🇳' },
  { code: 'ja', name: '日本語', flag: '🇯🇵' },
  { code: 'ko', name: '한국어', flag: '🇰🇷' },
];

const loaders = import.meta.glob(['./locales/*.json', '!./locales/en.json']);
const cache = { en };
let lang = 'en';
let dict = en;

/** best match for the device language */
export function detectLang() {
  const prefs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en'];
  for (const p of prefs) {
    const base = String(p).toLowerCase().split('-')[0];
    const code = base === 'tl' ? 'fil' : base === 'nb' || base === 'no' ? 'sv' : base;
    if (LANGS.some((l) => l.code === code)) return code;
  }
  return 'en';
}

export async function setLang(code) {
  if (!LANGS.some((l) => l.code === code)) code = 'en';
  if (!cache[code]) {
    try {
      const mod = await loaders[`./locales/${code}.json`]();
      cache[code] = mod.default || mod;
    } catch {
      code = 'en';
    }
  }
  lang = code;
  dict = cache[code];
  const info = LANGS.find((l) => l.code === code);
  document.documentElement.lang = code;
  document.documentElement.dir = info?.rtl ? 'rtl' : 'ltr';
  return code;
}

export function getLang() {
  return lang;
}

export function t(key) {
  const v = dict[key];
  if (v === undefined || v === null || v === '') return en[key] ?? key;
  if (typeof v === 'object' && typeof en[key] === 'object') return { ...en[key], ...v };
  return v;
}

export function dayLabel(n) {
  return dict.dayN ? dict.dayN.replace('{n}', n) : `${t('day')} ${n}`;
}

const localeMap = { fil: 'fil-PH', zh: 'zh-CN', pt: 'pt-BR' };
export function fmt(n) {
  try {
    return Number(n).toLocaleString(localeMap[lang] || lang);
  } catch {
    return String(n);
  }
}
