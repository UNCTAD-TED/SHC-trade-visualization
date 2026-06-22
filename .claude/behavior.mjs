import { chromium } from 'playwright';
const URL = 'http://localhost:5173/SHC-trade-visualization/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 820 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await sleep(1000);

// start
await page.click('#story-btn');
await sleep(2200);
const inStory = await page.evaluate(() => document.body.classList.contains('story-mode'));

// tick count rendered?
const tickCount = await page.$$eval('.story-tl-tick', els => els.length);

// loop wrap: seek near end, play ~1.6s, expect fill% to wrap small
const track = await page.$('#story-tl-track');
const box = await track.boundingBox();
await page.mouse.click(box.x + box.width * 0.995, box.y + box.height / 2);
await sleep(1800);
const fillPct = await page.$eval('#story-tl-fill', el => parseFloat(el.style.width));

// chapter label populated?
const chapter = await page.$eval('#story-tl-title', el => el.textContent);
const counter = await page.$eval('#story-tl-count', el => el.textContent);

// Esc stops
await page.keyboard.press('Escape');
await sleep(1500);
const afterEsc = await page.evaluate(() => document.body.classList.contains('story-mode'));
const arcsRestored = await page.$$eval('.trade-arc', els => els.length);

console.log(JSON.stringify({
  inStory, tickCount, fillPctAfterWrap: fillPct, chapter, counter,
  storyModeAfterEsc: afterEsc, arcsRestored, pageErrors: errs,
}, null, 2));
await browser.close();
