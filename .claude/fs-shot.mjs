import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const URL = 'http://127.0.0.1:5173/SHC-trade-visualization/factsheet.html';
const OUT = 'c:/tmp/fsshots';
mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

const msgs = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') msgs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => msgs.push(`[PAGEERROR] ${e.message}`));
page.on('requestfailed', r => msgs.push(`[REQFAIL] ${r.url()} :: ${r.failure()?.errorText}`));

await page.goto(URL, { waitUntil: 'networkidle' });
await sleep(800);

// Section ids in order
const sections = ['sec-hero','sec-key','sec-quality','sec-supply','sec-china','sec-africa','sec-social','sec-afford','sec-sector','sec-policy','sec-outro'];

// First pass: scroll through to trigger all reveals/counters
for (const id of sections) {
  await page.evaluate((sid) => document.getElementById(sid)?.scrollIntoView({ behavior: 'instant', block: 'start' }), id);
  await sleep(700);
}
// Settle: let every bar / donut / count-up finish before any capture
await sleep(2600);

// Second pass: screenshot each section from the top
let i = 0;
for (const id of sections) {
  await page.evaluate((sid) => document.getElementById(sid)?.scrollIntoView({ behavior: 'instant', block: 'start' }), id);
  await sleep(1100);
  await page.screenshot({ path: `${OUT}/${String(i).padStart(2,'0')}-${id}.png` });
  i++;
}

// Full-page tall screenshot
await page.evaluate(() => window.scrollTo(0, 0));
await sleep(400);
await page.screenshot({ path: `${OUT}/full.png`, fullPage: true });

console.log('=== CONSOLE ERRORS/WARNINGS ===');
console.log(msgs.join('\n') || '(none)');
await browser.close();
