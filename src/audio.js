// Fully synthesized sound effects + light background music (no external audio files).
let ctx = null;
let master, sfxGain, musicGain;
export const audioState = { sfx: true, music: true };

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);
  sfxGain = ctx.createGain();
  sfxGain.gain.value = audioState.sfx ? 0.6 : 0;
  sfxGain.connect(master);
  musicGain = ctx.createGain();
  musicGain.gain.value = audioState.music ? 0.16 : 0;
  musicGain.connect(master);
  return ctx;
}

export function unlockAudio() {
  const c = ensure();
  if (c && c.state === 'suspended') c.resume();
  startMusic();
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
  if (musicGain) musicGain.gain.setTargetAtTime(on ? 0.16 : 0, ctx.currentTime, 0.2);
}

function tone({ freq = 440, type = 'sine', dur = 0.12, vol = 0.5, attack = 0.005, slideTo = null, when = 0, dest = null }) {
  const c = ensure();
  if (!c || (!audioState.sfx && !dest)) return;
  const t = c.currentTime + when;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(dest || sfxGain);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise({ dur = 0.2, vol = 0.3, freq = 1200, when = 0 }) {
  const c = ensure();
  if (!c || !audioState.sfx) return;
  const t = c.currentTime + when;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = c.createBufferSource();
  s.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  const g = c.createGain();
  g.gain.value = vol;
  s.connect(f);
  f.connect(g);
  g.connect(sfxGain);
  s.start(t);
}

export const sfx = {
  tap() {
    tone({ freq: 520, type: 'triangle', dur: 0.07, vol: 0.35, slideTo: 760 });
  },
  go() {
    tone({ freq: 220, type: 'sawtooth', dur: 0.25, vol: 0.12, slideTo: 440 });
    noise({ dur: 0.25, vol: 0.15, freq: 900 });
  },
  honk() {
    tone({ freq: 392, type: 'square', dur: 0.14, vol: 0.12 });
    tone({ freq: 494, type: 'square', dur: 0.14, vol: 0.1 });
    tone({ freq: 392, type: 'square', dur: 0.12, vol: 0.12, when: 0.17 });
    tone({ freq: 494, type: 'square', dur: 0.12, vol: 0.1, when: 0.17 });
  },
  bump() {
    tone({ freq: 140, type: 'sine', dur: 0.12, vol: 0.5, slideTo: 70 });
  },
  board(i = 0) {
    const scale = [523, 587, 659, 784, 880, 988, 1047];
    tone({ freq: scale[i % scale.length], type: 'sine', dur: 0.09, vol: 0.25 });
  },
  depart() {
    tone({ freq: 330, type: 'triangle', dur: 0.15, vol: 0.25 });
    tone({ freq: 494, type: 'triangle', dur: 0.15, vol: 0.25, when: 0.1 });
    tone({ freq: 659, type: 'triangle', dur: 0.25, vol: 0.25, when: 0.2 });
    noise({ dur: 0.4, vol: 0.12, freq: 700, when: 0.1 });
  },
  reveal() {
    tone({ freq: 880, type: 'sine', dur: 0.2, vol: 0.2, slideTo: 1320 });
  },
  coin() {
    tone({ freq: 988, type: 'square', dur: 0.06, vol: 0.12 });
    tone({ freq: 1319, type: 'square', dur: 0.18, vol: 0.12, when: 0.06 });
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
};

/* ---------------- music: gentle procedural loop ---------------- */
let musicTimer = null;
let step = 0;
const chords = [
  [261.6, 329.6, 392.0], // C
  [220.0, 261.6, 329.6], // Am
  [174.6, 220.0, 261.6], // F
  [196.0, 246.9, 293.7], // G
];
const melody = [0, 2, 4, 2, 5, 4, 2, 1, 0, 2, 4, 7, 5, 4, 2, 4];
const pent = [523.3, 587.3, 659.3, 784.0, 880.0, 1046.5, 1174.7, 1318.5];

function musicTick() {
  const c = ctx;
  if (!c) return;
  const bar = Math.floor(step / 8) % 4;
  const beat = step % 8;
  if (beat === 0) {
    chords[bar].forEach((f) => tone({ freq: f / 2, type: 'triangle', dur: 1.7, vol: 0.18, attack: 0.05, dest: musicGain }));
  }
  if (beat % 2 === 0) tone({ freq: chords[bar][0] / 4, type: 'sine', dur: 0.25, vol: 0.35, dest: musicGain });
  const m = melody[step % melody.length];
  if (step % 16 < 12 && Math.random() < 0.75) tone({ freq: pent[m], type: 'sine', dur: 0.22, vol: 0.12, dest: musicGain });
  step++;
}

export function startMusic() {
  if (musicTimer || !ensure()) return;
  musicTimer = setInterval(() => {
    if (ctx.state === 'running') musicTick();
  }, 230);
}
