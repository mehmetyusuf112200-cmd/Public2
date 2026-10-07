import { chromium } from '/tmp/claude-0/-home-claude/0e101b7b-49a8-5f01-ade2-029a4ff8eccd/scratchpad/node_modules/playwright-core/index.mjs';
import fs from 'fs';
const bus = fs.readFileSync(new URL('./bus.svg', import.meta.url),'utf8');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
async function shot(html, w, h, out, transparent=false){
  const p = await b.newPage({ viewport:{width:w,height:h} });
  await p.setContent(`<html><body style="margin:0;background:transparent">${html}</body></html>`);
  await p.waitForTimeout(150);
  await p.screenshot({ path: out, omitBackground: transparent });
  await p.close();
}
const bg = `background:radial-gradient(circle at 50% 35%, #6fb4ff, #2f7bf5 55%, #1b56c2)`;
// full square icon (Play store 512, legacy launcher)
await shot(`<div style="width:1024px;height:1024px;${bg};display:grid;place-items:center"><div style="width:800px;height:800px">${bus}</div></div>`,1024,1024,'icon-square.png');
// adaptive foreground (bus within 66% safe zone)
await shot(`<div style="width:1024px;height:1024px;display:grid;place-items:center"><div style="width:600px;height:600px">${bus}</div></div>`,1024,1024,'icon-fg.png',true);
// splash
await shot(`<div style="width:1080px;height:1920px;${bg};display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:sans-serif"><div style="width:520px;height:520px">${bus}</div></div>`,1080,1920,'splash-port.png');
// feature graphic 1024x500
await shot(`<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@800&display=swap" rel="stylesheet"><div style="width:1024px;height:500px;${bg};display:flex;align-items:center;justify-content:center;gap:30px;font-family:'Baloo 2',sans-serif"><div style="width:380px;height:380px">${bus}</div><div style="color:#fff;font-size:110px;line-height:.9;font-weight:800;text-shadow:0 8px 0 #143f8f">Commute<br><span style="color:#ffc928">Craze</span></div></div>`,1024,500,'feature.png');
await b.close();
