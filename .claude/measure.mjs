import { chromium } from 'playwright';
const URL = 'http://localhost:5173/SHC-trade-visualization/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 820 } });
await page.goto(URL, { waitUntil: 'networkidle' });
await sleep(1200);
await page.click('#story-btn');
await sleep(3000);
const track = await page.$('#story-tl-track');
const box = await track.boundingBox();
await page.mouse.click(box.x + box.width * (11500/99000), box.y + box.height/2);
await sleep(3000); // fully settle

const r = await page.evaluate(() => {
  const TM = window.__TM;
  const proj = TM.projection;
  const codeOf = { TZA:'834', UGA:'800', KEN:'404', CHN:'156' };
  const lands = [...document.querySelectorAll('path.land')];
  const landByCode = new Map();
  for (const l of lands) { const d=l.__data__; if(d?.properties) landByCode.set(String(d.properties.code), l); }
  const nodes = [...document.querySelectorAll('.country-node')];
  const out = { scale: Math.round(proj.scale()), nodes: [] };
  for (const n of nodes) {
    const iso = n.__data__;
    if (!codeOf[iso]) continue;
    const cx = +n.getAttribute('cx'), cy = +n.getAttribute('cy');
    const live = TM.getProjectedPoint(iso);                 // projection(countryCoords[iso])
    const land = landByCode.get(codeOf[iso]);
    const pathCentroid = land ? TM.path.centroid(land.__data__) : null; // projected land centroid
    out.nodes.push({ iso,
      nodeAttr: [Math.round(cx), Math.round(cy)],
      liveProjected: [Math.round(live[0]), Math.round(live[1])],
      nodeVsLive: [Math.round(cx-live[0]), Math.round(cy-live[1])],
      landCentroid: pathCentroid ? [Math.round(pathCentroid[0]), Math.round(pathCentroid[1])] : null,
      coordVsLand: pathCentroid ? [Math.round(live[0]-pathCentroid[0]), Math.round(live[1]-pathCentroid[1])] : null,
    });
  }
  return out;
});
console.log(JSON.stringify(r, null, 2));
await browser.close();
