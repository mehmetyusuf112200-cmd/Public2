// Difficulty check: win rates of three simulated players (not part of CI).
// node tests/difficulty.bot.js
import { generateLevel, Game, mulberry32 } from '../src/core/logic.js';

function bot(level, rand, mode) {
  const g = new Game(level);
  g.settle();
  let guard = 0;
  while (g.status === 'playing' && guard++ < 500) {
    const mov = g.lotVehicles().filter((v) => v.ice === 0 && g.pathCheck(v).free && g.slotFor(v.color) >= 0);
    if (!mov.length) return false;
    let pick;
    if (mode === 'smart') {
      const c = g.queue[0];
      const m = mov.filter((v) => v.revealed && v.color === c);
      if (m.length) pick = m[0];
      else {
        let best = 1e9;
        for (const v of mov) {
          const k = v.revealed ? g.queue.indexOf(v.color) : 40;
          const s = (k < 0 ? 200 : k) + rand() * 3;
          if (s < best) {
            best = s;
            pick = v;
          }
        }
      }
    } else if (mode === 'casual') {
      const look = g.queue.slice(0, 8);
      const m = mov.filter((v) => v.revealed && look.includes(v.color));
      pick = m.length ? m[Math.floor(rand() * m.length)] : mov[Math.floor(rand() * mov.length)];
    } else pick = mov[Math.floor(rand() * mov.length)];
    g.tap(pick.id);
  }
  return g.status === 'won';
}

const N = 30;
for (const L of (process.argv[2] || "3,5,8,10,12,15,20,25,30,40,50,60,80,100,150,200,300,400").split(",").map(Number)) {
  const lv = generateLevel(L);
  let s = 0,
    c = 0,
    r = 0;
  for (let i = 0; i < N; i++) {
    if (bot(lv, mulberry32(i * 31 + L), 'smart')) s++;
    if (bot(lv, mulberry32(i * 17 + L), 'casual')) c++;
    if (bot(lv, mulberry32(i * 7 + L), 'random')) r++;
  }
  console.log(`${L}\t${lv.difficulty}\tveh ${lv.vehicles.length}\tsmart ${Math.round((s / N) * 100)}%\tcasual ${Math.round((c / N) * 100)}%\trandom ${Math.round((r / N) * 100)}%`);
}
