// Chapter themes: every 20 levels the scenery changes.
export const CHAPTER_SIZE = 20;

export const THEMES = [
  {
    id: 'city',
    name: { tr: 'Güneşli Şehir', en: 'Sunny City' },
    sky: 0x8fd8ff,
    ground: '#7fd06a',
    ground2: '#6fc35b',
    flowers: ['#ffffff', '#ffe066', '#ff8fb8'],
    lot: '#556071',
    lotLine: 'rgba(255,255,255,0.2)',
    sidewalk: 0xeadfc8,
    hemi: [0xffffff, 0x88b070, 1.0],
    sun: [0xfff4e0, 2.1],
    env: 0.45,
    tree: 'round',
    buildings: [0xff8a65, 0xffd166, 0x6ec6ff, 0xa5d6a7, 0xce93d8, 0xffab91],
    night: false,
    map: ['#7fd06a', '#4caf50'],
  },
  {
    id: 'beach',
    name: { tr: 'Sahil Kasabası', en: 'Beach Town' },
    sky: 0x7fe3ff,
    ground: '#f4dca2',
    ground2: '#ead08f',
    flowers: ['#ffffff', '#ff7aa8', '#7ee0ff'],
    lot: '#5d6878',
    lotLine: 'rgba(255,255,255,0.22)',
    sidewalk: 0xfff1d0,
    hemi: [0xffffff, 0xd8c08a, 1.0],
    sun: [0xfff0d0, 2.2],
    env: 0.5,
    tree: 'palm',
    buildings: [0x4fc3f7, 0xfff59d, 0xff8a80, 0xffffff, 0x80deea, 0xffcc80],
    night: false,
    map: ['#f4dca2', '#29b6f6'],
  },
  {
    id: 'snow',
    name: { tr: 'Karlı Dağlar', en: 'Snowy Peaks' },
    sky: 0xcfe8ff,
    ground: '#f2f8fc',
    ground2: '#e2eef7',
    flowers: ['#d6ecff', '#ffffff', '#bfe3ff'],
    lot: '#5a6680',
    lotLine: 'rgba(255,255,255,0.25)',
    sidewalk: 0xdde7f0,
    hemi: [0xffffff, 0xb8c8dc, 0.95],
    sun: [0xffffff, 1.9],
    env: 0.5,
    tree: 'pine',
    buildings: [0xb71c1c, 0x8d6e63, 0x1565c0, 0x2e7d32, 0xf9a825, 0x6d4c41],
    night: false,
    map: ['#e3f2fd', '#64b5f6'],
  },
  {
    id: 'night',
    name: { tr: 'Gece Şehri', en: 'Night City' },
    sky: 0x1a2747,
    ground: '#2f5a43',
    ground2: '#284e3a',
    flowers: ['#ffe082', '#80deea', '#f48fb1'],
    lot: '#3d4659',
    lotLine: 'rgba(160,200,255,0.22)',
    sidewalk: 0x8e95a8,
    hemi: [0xaab8ff, 0x203040, 0.75],
    sun: [0xb8c8ff, 0.95],
    env: 0.35,
    tree: 'round',
    buildings: [0x3949ab, 0x5e35b1, 0x00838f, 0x455a64, 0x6a1b9a, 0x283593],
    night: true,
    map: ['#283593', '#7e57c2'],
  },
];

export function themeForLevel(level) {
  return THEMES[Math.floor((Math.max(1, level) - 1) / CHAPTER_SIZE) % THEMES.length];
}
export function chapterOf(level) {
  return Math.floor((Math.max(1, level) - 1) / CHAPTER_SIZE);
}

// Cosmetic vehicle paint styles (sold in the shop)
export const STYLES = [
  { id: 'classic', price: 0, icon: '🚗' },
  { id: 'metallic', price: 1500, icon: '✨' },
  { id: 'candy', price: 2500, icon: '🍬' },
  { id: 'neon', price: 4000, icon: '💡' },
];
