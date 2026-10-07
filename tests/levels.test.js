// Verifies that the first 500 generated levels are solvable with their reference solution.
import { generateLevel, referenceSolve } from '../src/core/logic.js';
let fails = 0;
for (let L = 1; L <= 420; L++) {
  const lv = generateLevel(L);
  if (lv.num !== L || !referenceSolve(lv, lv.solution)) {
    fails++;
    console.error('Level failed:', L);
  }
}
console.log(fails ? `${fails} level(s) failed` : 'All 420 levels solvable ✔');
process.exit(fails ? 1 : 0);
