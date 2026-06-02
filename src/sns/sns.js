import { initSNSMap, updateSNSMap, updateTimelineProgress } from './snsMap.js';
import { updateSNSChart } from './snsChart.js';

const YEARS     = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];
const YEAR_MS   = 3000;  // each year is displayed for this long
const TRANS_MS  = 750;   // arc + chart transition (matches original dashboard)
const MIN_VALUE = 1_000_000; // $1M USD arc display threshold

const state = {
  allFlows:    {},  // year → [{exporter, importer, netValue, flowCategory}] filtered ≥ $1M
  exportRanks: {},  // year → [{iso, value}] top 10 by export total
  importRanks: {},  // year → [{iso, value}] top 10 by import total
  meta:        {},
  geoData:     null,
  currentIndex: 0,
};

function setProgress(pct) {
  const el = document.getElementById('splash-bar');
  if (el) el.style.width = `${pct}%`;
}

// ── Load all 10 years in parallel (enables seamless transitions)
async function loadAllData() {
  setProgress(5);

  const [world, meta, ...yearFlows] = await Promise.all([
    fetch('/assets/worldmap-economies-4326.topo.json').then(r => r.json()),
    fetch('/data/meta.json').then(r => r.json()),
    ...YEARS.map(y => fetch(`/data/${y}.json`).then(r => r.json())),
  ]);

  setProgress(70);

  // Apply UNCTAD longitude correction (11.314° westward shift in TopoJSON transform)
  if (world.transform) world.transform.translate[0] += 11.314;

  state.geoData = world;
  state.meta    = meta;

  YEARS.forEach((year, i) => {
    const flows = yearFlows[i];

    // Map arcs: only flows ≥ $1M
    state.allFlows[year] = flows.filter(d => d.netValue >= MIN_VALUE);

    // Bar chart ranks: aggregate ALL flows (no threshold) for accurate totals
    const exports = {}, imports = {};
    flows.forEach(d => {
      exports[d.exporter] = (exports[d.exporter] || 0) + d.netValue;
      imports[d.importer] = (imports[d.importer] || 0) + d.netValue;
    });

    state.exportRanks[year] = Object.entries(exports)
      .map(([iso, value]) => ({ iso, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

    state.importRanks[year] = Object.entries(imports)
      .map(([iso, value]) => ({ iso, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  });

  setProgress(100);
}

// ── Advance to a given year index
function updateYear(index, animate) {
  state.currentIndex = index;
  const year = YEARS[index];
  const dur  = animate ? TRANS_MS : 0;

  updateSNSMap(
    state.allFlows[year],
    state.meta,
    dur,
    state.exportRanks[year].slice(0, 3).map(d => d.iso),
    state.importRanks[year].slice(0, 3).map(d => d.iso),
  );
  updateSNSChart(state.exportRanks[year], state.importRanks[year], dur);
  updateTimelineProgress(index, YEARS.length);

  // Update year text (SVG elements)
  const bigYear   = document.getElementById('sns-year');
  const labelYear = document.getElementById('sns-year-label');
  if (bigYear)   bigYear.textContent   = year;
  if (labelYear) labelYear.textContent = year;
}

// ── Bootstrap
async function init() {
  await loadAllData();

  initSNSMap(state);
  updateYear(0, false);   // show year 2015 immediately

  // Fade out splash
  const splash = document.getElementById('splash');
  if (splash) {
    splash.style.opacity = '0';
    setTimeout(() => splash.remove(), 800);
  }

  // Start animation loop after splash fades
  setTimeout(() => {
    setInterval(() => {
      updateYear((state.currentIndex + 1) % YEARS.length, true);
    }, YEAR_MS);
  }, 1200);
}

init().catch(err => console.error('SNS init error:', err));
