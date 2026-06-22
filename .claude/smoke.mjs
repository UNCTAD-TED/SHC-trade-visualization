import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const URL = 'http://localhost:5173/SHC-trade-visualization/';
const OUT = '.claude/shots';
mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 820 } });

const msgs = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') msgs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => msgs.push(`[PAGEERROR] ${e.message}`));
page.on('requestfailed', r => msgs.push(`[REQFAIL] ${r.url()} :: ${r.failure()?.errorText}`));

await page.goto(URL, { waitUntil: 'networkidle' });
await sleep(1200);

await page.click('#story-btn');
await sleep(2500);
// pause so seeks land precisely
await page.click('#story-playpause-btn');
await sleep(300);

const TOTAL = 99000;
const scenes = [
  ['01-intro', 3500], ['02-global-scale', 11500], ['03-flow-structure', 21000],
  ['04-east-africa', 31000], ['05-bale', 41500], ['06-china-shift', 53000],
  ['07-why-china', 64000], ['08-livelihoods', 74000], ['09-policy', 85000], ['10-outro', 95000],
];
const track = await page.$('#story-tl-track');
const box = await track.boundingBox();
for (const [name, ms] of scenes) {
  const frac = ms / TOTAL;
  await page.mouse.click(box.x + box.width * frac, box.y + box.height / 2);
  await sleep(1600);
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

// resume + stop
await page.click('#story-playpause-btn');
await sleep(500);
await page.click('#story-stop-btn');
await sleep(1500);
await page.screenshot({ path: `${OUT}/11-stopped.png` });

console.log('=== ERRORS/WARNINGS ===');
console.log(msgs.join('\n') || '(none)');
await browser.close();
