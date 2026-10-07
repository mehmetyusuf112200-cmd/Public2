// Fully synthesized sound effects + multi-track procedural music (no audio files).
let ctx = null;
let master, sfxGain, musicGain, musicBus, noiseBuf;
export const audioState = { sfx: true, music: true };
let timeShift = 0; // only used by renderOffline()
const MUSIC_VOL = 0.22;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  buildGraph(ctx);
  return ctx;
}

function buildGraph(c) {
  master = c.createGain();
  master.gain.value = 0.9;
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 3;
  master.connect(comp);
  comp.connect(c.destination);
  sfxGain = c.createGain();
  sfxGain.gain.value = audioState.sfx ? 0.6 : 0;
  sfxGain.connect(master);
  musicGain = c.createGain();
  musicGain.gain.value = audioState.music ? MUSIC_VOL : 0;
  musicGain.connect(master);
  // gentle reverb-ish echo on music
  musicBus = c.createGain();
  const delay = c.createDelay();
  delay.delayTime.value = 0.28;
  const fb = c.createGain();
  fb.gain.value = 0.22;
  const wet = c.createGain();
  wet.gain.value = 0.25;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2400;
  musicBus.connect(musicGain);
  musicBus.connect(delay);
  delay.connect(lp);
  lp.connect(fb);
  fb.connect(delay);
  lp.connect(wet);
  wet.connect(musicGain);
  const len = c.sampleRate;
  noiseBuf = c.createBuffer(1, len, c.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
}

export function unlockAudio() {
  const c = ensure();
  if (c && c.state === 'suspended') c.resume();
  if (!currentSong && wantedSong) startSong(wantedSong);
}
export function suspendAudio() {
  if (ctx && ctx.state === 'running') ctx.suspend();
}
export function resumeAudio() {
  if (ctx && ctx.state === 'suspended') ctx.resume();
}
export function setSfx(on) {
  audioState.sfx = on;
  if (sfxGain) sfxGain.gain.value = on ? 0.6 : 0;
}
export function setMusic(on) {
  audioState.music = on;
  if (musicGain) musicGain.gain.setTargetAtTime(on ? MUSIC_VOL : 0, ctx.currentTime, 0.2);
}

/* ---------------- primitives ---------------- */
function tone({ freq = 440, type = 'sine', dur = 0.12, vol = 0.5, attack = 0.005, slideTo = null, at = null, when = 0, dest = null, detune = 0 }) {
  const c = ensure();
  if (!c) return;
  if (!dest && !audioState.sfx) return;
  const t = at ?? c.currentTime + timeShift + when;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.detune.value = detune;
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(dest || sfxGain);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise({ dur = 0.2, vol = 0.3, freq = 1200, type = 'bandpass', at = null, when = 0, dest = null, q = 1 }) {
  const c = ensure();
  if (!c) return;
  if (!dest && !audioState.sfx) return;
  const t = at ?? c.currentTime + timeShift + when;
  const s = c.createBufferSource();
  s.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f);
  f.connect(g);
  g.connect(dest || sfxGain);
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur + 0.02);
}

export const sfx = {
  tap() {
    tone({ freq: 520, type: 'triangle', dur: 0.07, vol: 0.35, slideTo: 760 });
  },
  click() {
    tone({ freq: 700, type: 'triangle', dur: 0.05, vol: 0.25 });
  },
  whoosh() {
    noise({ dur: 0.35, vol: 0.18, freq: 600, q: 0.7 });
  },
  go() {
    tone({ freq: 220, type: 'sawtooth', dur: 0.25, vol: 0.1, slideTo: 440 });
    noise({ dur: 0.25, vol: 0.14, freq: 900 });
  },
  honk() {
    tone({ freq: 392, type: 'square', dur: 0.14, vol: 0.11 });
    tone({ freq: 494, type: 'square', dur: 0.14, vol: 0.09 });
    tone({ freq: 392, type: 'square', dur: 0.12, vol: 0.11, when: 0.17 });
    tone({ freq: 494, type: 'square', dur: 0.12, vol: 0.09, when: 0.17 });
  },
  bump() {
    tone({ freq: 140, type: 'sine', dur: 0.12, vol: 0.5, slideTo: 70 });
  },
  board(i = 0) {
    const scale = [523, 587, 659, 784, 880, 988, 1047, 1175, 1319, 1568];
    tone({ freq: scale[i % scale.length], type: 'sine', dur: 0.09, vol: 0.25 });
  },
  depart() {
    tone({ freq: 330, type: 'triangle', dur: 0.15, vol: 0.25 });
    tone({ freq: 494, type: 'triangle', dur: 0.15, vol: 0.25, when: 0.1 });
    tone({ freq: 659, type: 'triangle', dur: 0.25, vol: 0.25, when: 0.2 });
    noise({ dur: 0.4, vol: 0.1, freq: 700, when: 0.1 });
  },
  reveal() {
    tone({ freq: 880, type: 'sine', dur: 0.2, vol: 0.2, slideTo: 1320 });
  },
  coin() {
    tone({ freq: 988, type: 'square', dur: 0.06, vol: 0.1 });
    tone({ freq: 1319, type: 'square', dur: 0.18, vol: 0.1, when: 0.06 });
  },
  win() {
    [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.3, vol: 0.3, when: i * 0.11 }));
    tone({ freq: 1568, type: 'sine', dur: 0.6, vol: 0.15, when: 0.45 });
  },
  lose() {
    [392, 349, 311, 262].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.32, vol: 0.28, when: i * 0.16 }));
  },
  booster() {
    tone({ freq: 660, type: 'sine', dur: 0.4, vol: 0.25, slideTo: 1320 });
    noise({ dur: 0.3, vol: 0.1, freq: 3000 });
  },
  levelUp() {
    [523, 659, 784, 1047, 1319].forEach((f, i) => tone({ freq: f, type: 'square', dur: 0.18, vol: 0.12, when: i * 0.08 }));
  },
  shatter() {
    noise({ dur: 0.35, vol: 0.3, freq: 4200, q: 0.8 });
    [1568, 2093, 2637].forEach((f, i) => tone({ freq: f, type: 'sine', dur: 0.15, vol: 0.08, when: i * 0.04 }));
  },
  alarm() {
    tone({ freq: 880, type: 'square', dur: 0.08, vol: 0.08 });
  },
  tick() {
    tone({ freq: 1200, type: 'square', dur: 0.025, vol: 0.08 });
  },
};

/* ------------------------------------------------------------------ */
/* Music                                                               */
/* ------------------------------------------------------------------ */
// Notes are semitones relative to the song key (0 = root). null = rest.
const N = null;
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

// chord degrees in a major key -> semitone triads
const CH = {
  I: [0, 4, 7],
  ii: [2, 5, 9],
  iii: [4, 7, 11],
  IV: [5, 9, 12],
  V: [7, 11, 14],
  vi: [9, 12, 16],
  bVII: [10, 14, 17],
};

const SONGS = {
  menu: {
    bpm: 96,
    key: 60, // C
    chords: ['I', 'vi', 'IV', 'V'],
    drums: { kick: [0, 8], snare: [4, 12], hat: [2, 6, 10, 14] },
    bass: 'root8',
    pad: 'soft',
    arp: [0, 7, 12, 7],
    lead: [
      [12, N, 14, N, 16, N, N, 14, 12, N, 9, N, 7, N, N, N],
      [9, N, 12, N, 16, N, 14, 12, 14, N, N, N, N, N, N, N],
      [9, N, 12, N, 17, N, 16, 14, 12, N, 9, N, 12, N, N, N],
      [11, N, 14, N, 19, N, 17, N, 14, N, 11, N, 7, N, N, N],
    ],
    leadType: 'triangle',
  },
  city: {
    bpm: 118,
    key: 62, // D
    chords: ['I', 'V', 'vi', 'IV'],
    drums: { kick: [0, 6, 8, 14], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
    bass: 'pump',
    pad: 'stab',
    arp: [0, 4, 7, 12, 7, 4],
    lead: [
      [7, N, 7, 9, 11, N, 9, 7, 4, N, 4, N, 7, N, N, N],
      [7, N, 7, 9, 11, N, 14, N, 11, 9, 7, N, 9, N, N, N],
      [12, N, 11, 9, 7, N, 4, N, 7, N, 9, 11, 12, N, N, N],
      [9, N, 9, 7, 5, N, 7, 9, 11, N, 9, N, 7, N, N, N],
    ],
    leadType: 'square',
  },
  beach: {
    bpm: 104,
    key: 65, // F
    chords: ['I', 'IV', 'V', 'IV'],
    drums: { kick: [0, 3, 8, 11], snare: [6, 14], hat: [2, 4, 7, 10, 12, 15] },
    bass: 'reggae',
    pad: 'marimba',
    arp: [0, 7, 4, 12],
    lead: [
      [12, N, 9, N, 7, 9, N, 12, N, 14, N, 12, 9, N, N, N],
      [14, N, 12, N, 9, 12, N, 14, N, 17, N, 14, 12, N, N, N],
      [16, N, 14, N, 12, 14, N, 16, N, 19, N, 16, 14, N, N, N],
      [14, N, 12, N, 9, 7, N, 9, N, 12, N, N, N, N, N, N],
    ],
    leadType: 'sine',
  },
  snow: {
    bpm: 88,
    key: 67, // G
    chords: ['I', 'iii', 'IV', 'V'],
    drums: { kick: [0, 10], snare: [8], hat: [4, 12] },
    bass: 'root8',
    pad: 'soft',
    arp: [0, 4, 7, 11, 12, 11, 7, 4],
    lead: [
      [19, N, N, 16, N, N, 14, N, 12, N, N, N, 14, N, N, N],
      [16, N, N, 14, N, N, 12, N, 11, N, N, N, 7, N, N, N],
      [17, N, N, 16, N, N, 14, N, 12, N, N, N, 9, N, N, N],
      [14, N, N, 12, N, N, 11, N, 14, N, N, N, N, N, N, N],
    ],
    leadType: 'bell',
  },
  night: {
    bpm: 110,
    key: 57, // A (minor feel via vi-IV-I-V of C)
    chords: ['vi', 'IV', 'I', 'V'],
    drums: { kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14] },
    bass: 'octave',
    pad: 'saw',
    arp: [0, 7, 12, 16, 12, 7],
    lead: [
      [12, N, N, 11, 12, N, 16, N, 14, N, N, 12, 11, N, N, N],
      [9, N, N, 7, 9, N, 12, N, 11, N, N, 9, 7, N, N, N],
      [12, N, N, 11, 12, N, 16, N, 19, N, N, 17, 16, N, N, N],
      [14, N, N, 12, 11, N, 7, N, 11, N, N, N, N, N, N, N],
    ],
    leadType: 'saw',
  },
};

let currentSong = null;
let wantedSong = 'menu';
let schedTimer = null;
let nextStepTime = 0;
let step = 0;
let fadeGain = null;

function drum(kind, t, dest) {
  if (kind === 'kick') {
    tone({ freq: 150, slideTo: 45, type: 'sine', dur: 0.28, vol: 0.9, at: t, dest });
  } else if (kind === 'snare') {
    noise({ dur: 0.16, vol: 0.35, freq: 1800, at: t, dest, q: 0.6 });
    tone({ freq: 220, type: 'triangle', dur: 0.08, vol: 0.25, at: t, dest });
  } else {
    noise({ dur: 0.04, vol: 0.12, freq: 8000, type: 'highpass', at: t, dest });
  }
}

function playStep(song, s, t, dest) {
  const spb = 60 / song.bpm / 4; // sixteenth
  const bar = Math.floor(s / 16) % song.chords.length;
  const phrase = Math.floor(s / 64) % 2; // alternate sections
  const i = s % 16;
  const chord = CH[song.chords[bar]];
  const root = song.key + chord[0];
  // drums (lighter in the first phrase of a cycle for variation)
  if (song.drums.kick.includes(i)) drum('kick', t, dest);
  if (song.drums.snare.includes(i)) drum('snare', t, dest);
  if (song.drums.hat.includes(i) && (phrase || i % 4 === 2)) drum('hat', t, dest);
  // bass
  const bassNote = root - 24;
  switch (song.bass) {
    case 'pump':
      if (i % 2 === 0) tone({ freq: midi(bassNote), type: 'triangle', dur: spb * 1.6, vol: 0.45, at: t, dest });
      break;
    case 'reggae':
      if (i === 0 || i === 3 || i === 8 || i === 10) tone({ freq: midi(bassNote + (i === 10 ? 7 : 0)), type: 'triangle', dur: spb * 2.2, vol: 0.5, at: t, dest });
      break;
    case 'octave':
      if (i % 2 === 0) tone({ freq: midi(bassNote + (i % 4 === 2 ? 12 : 0)), type: 'sawtooth', dur: spb * 1.5, vol: 0.18, at: t, dest });
      break;
    default:
      if (i % 4 === 0) tone({ freq: midi(bassNote), type: 'triangle', dur: spb * 3.5, vol: 0.5, at: t, dest });
  }
  // pad / chords
  if (song.pad === 'soft' && i === 0) {
    chord.forEach((n) => tone({ freq: midi(song.key + n - 12), type: 'triangle', dur: spb * 15, vol: 0.12, attack: 0.25, at: t, dest }));
  } else if (song.pad === 'saw' && i === 0) {
    chord.forEach((n) => {
      tone({ freq: midi(song.key + n - 12), type: 'sawtooth', dur: spb * 15, vol: 0.045, attack: 0.3, at: t, dest, detune: -8 });
      tone({ freq: midi(song.key + n - 12), type: 'sawtooth', dur: spb * 15, vol: 0.045, attack: 0.3, at: t, dest, detune: 8 });
    });
  } else if (song.pad === 'stab' && (i === 2 || i === 6 || i === 10 || i === 14)) {
    chord.forEach((n) => tone({ freq: midi(song.key + n), type: 'square', dur: spb * 0.9, vol: 0.04, at: t, dest }));
  } else if (song.pad === 'marimba' && i % 2 === 0) {
    const n = chord[(i / 2) % 3];
    tone({ freq: midi(song.key + n), type: 'sine', dur: spb * 1.5, vol: 0.16, at: t, dest });
    tone({ freq: midi(song.key + n + 24), type: 'sine', dur: spb * 0.4, vol: 0.03, at: t, dest });
  }
  // arpeggio sparkle in the second phrase
  if (phrase && i % 2 === 1) {
    const a = song.arp[((i - 1) / 2) % song.arp.length];
    tone({ freq: midi(root + a + 12), type: 'triangle', dur: spb * 0.9, vol: 0.05, at: t, dest });
  }
  // lead melody
  const ln = song.lead[bar][i];
  if (ln !== null && ln !== undefined) {
    const f = midi(song.key + ln);
    const dur = spb * 1.8;
    switch (song.leadType) {
      case 'bell':
        tone({ freq: f, type: 'sine', dur: spb * 6, vol: 0.16, at: t, dest });
        tone({ freq: f * 2.76, type: 'sine', dur: spb * 2, vol: 0.04, at: t, dest });
        break;
      case 'saw':
        tone({ freq: f, type: 'sawtooth', dur, vol: 0.06, attack: 0.02, at: t, dest, detune: -6 });
        tone({ freq: f, type: 'sawtooth', dur, vol: 0.06, attack: 0.02, at: t, dest, detune: 6 });
        break;
      case 'square':
        tone({ freq: f, type: 'square', dur, vol: 0.07, at: t, dest });
        break;
      case 'sine':
        tone({ freq: f, type: 'sine', dur: dur * 1.3, vol: 0.18, at: t, dest });
        break;
      default:
        tone({ freq: f, type: 'triangle', dur: dur * 1.3, vol: 0.18, at: t, dest });
    }
  }
}

function scheduler() {
  if (!ctx || !currentSong) return;
  const song = SONGS[currentSong];
  const spb = 60 / song.bpm / 4;
  while (nextStepTime < ctx.currentTime + 0.2) {
    if (ctx.state === 'running') playStep(song, step, nextStepTime, fadeGain);
    nextStepTime += spb;
    step++;
  }
}

/** switch music track: menu | city | beach | snow | night */
export function startSong(id) {
  wantedSong = id;
  const c = ensure();
  if (!c || c.state !== 'running') return;
  if (currentSong === id) return;
  // fade out the old track
  if (fadeGain) {
    const old = fadeGain;
    old.gain.setTargetAtTime(0, c.currentTime, 0.3);
    setTimeout(() => old.disconnect(), 1500);
  }
  fadeGain = c.createGain();
  fadeGain.gain.setValueAtTime(0, c.currentTime);
  fadeGain.gain.linearRampToValueAtTime(1, c.currentTime + 1.2);
  fadeGain.connect(musicBus);
  currentSong = id;
  step = 0;
  nextStepTime = c.currentTime + 0.1;
  if (!schedTimer) schedTimer = setInterval(scheduler, 40);
}

/**
 * Render a song plus timed sound effects into an AudioBuffer (used to make the
 * store trailer soundtrack). events: [{ t: seconds, name: 'tap' | 'board' ..., args: [] }]
 */
export async function renderOffline({ song = 'city', seconds = 20, events = [], musicVol = MUSIC_VOL * 1.6, fadeOut = 1.5 } = {}) {
  const saved = [ctx, master, sfxGain, musicGain, musicBus, noiseBuf];
  const sr = 44100;
  const oc = new OfflineAudioContext(2, Math.ceil(sr * seconds), sr);
  ctx = oc;
  try {
    buildGraph(oc);
    musicGain.gain.value = musicVol;
    sfxGain.gain.value = 0.6;
    const fg = oc.createGain();
    fg.gain.setValueAtTime(0, 0);
    fg.gain.linearRampToValueAtTime(1, 0.6);
    fg.gain.setValueAtTime(1, Math.max(0.7, seconds - fadeOut));
    fg.gain.linearRampToValueAtTime(0, seconds);
    fg.connect(musicBus);
    const S = SONGS[song] || SONGS.menu;
    const spb = 60 / S.bpm / 4;
    for (let st = 0, t = 0.05; t < seconds; st++, t += spb) playStep(S, st, t, fg);
    for (const e of events) {
      timeShift = e.t;
      sfx[e.name]?.(...(e.args || []));
    }
    timeShift = 0;
    return await oc.startRendering();
  } finally {
    timeShift = 0;
    [ctx, master, sfxGain, musicGain, musicBus, noiseBuf] = saved;
  }
}
