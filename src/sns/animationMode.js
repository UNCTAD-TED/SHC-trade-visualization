import { ascending, easeCubicOut, interpolateHcl, interpolateNumber, max, quantile, scaleLinear, scalePow, select, zoomTransform } from 'd3';
import { CONFIG, METRIC_FORMAT, STATE } from '../config.js';
import { DataLoader } from '../dataLoader.js';
import { TradeMap } from '../map.js';
import { iso2Lower } from './iso3toIso2.js';
// md() sets transition durations to 0 under prefers-reduced-motion
import { motionDuration as md, prefersReducedMotion } from '../motion.js';

const YEARS   = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];
const YEAR_MS = 3000;
const ROW_H   = 27;          // px, must match .ap-chart CSS

// ── Active metric ─────────────────────────────────────────────────
const fmtMetric = (v) => (METRIC_FORMAT[STATE.metric] || METRIC_FORMAT.value).fmt(v);

const METRIC_BADGE = { value: 'Value (USD)', weight: 'Weight (tonnes)' };
const metricBadge = () => METRIC_BADGE[STATE.metric] || METRIC_BADGE.value;

// Smallest corridor drawn: $1M for value, 1 kt for weight (weight is in kg)
const MIN_VALUE_BY_METRIC = { value: 1_000_000, weight: 1_000_000 };
const minValue = () => MIN_VALUE_BY_METRIC[STATE.metric] ?? MIN_VALUE_BY_METRIC.value;

// ── Arc encoding ─────────────────────────────────────────────────
const ARC_DUR   = 750;       // matches map.js
const LABEL_N   = 0;         // corridor labels on the map (0 = off)
const WIDTH_EXP = 1.6;       // >1: small flows stay thin, large flows stand out
const MIN_W     = 0.1;
const MAX_W     = 8;
const MIN_OP    = 0.13;
const MAX_OP    = 0.6;
const ARC_TOP_Q = 0.97;      // upper anchor quantile, so one huge flow doesn't flatten the scale

// ── Node encoding ─────────────────────────────────────────────────
const NODE_MIN_R = 1;
const NODE_MAX_R = 8;
const NODE_EXP   = 0.9;
const NODE_TOP_Q = 0.98;

// ── Bar chart encoding ────────────────────────────────────────────
const BAR_MAX = 300;         // px, fallback when container width is unknown
const BAR_H   = 20;          // px, overrides .ap-bar CSS height

// ── Role colours ──────────────────────────────────────────────────
// Blue = net exporter, red = net importer (green is reserved for S→N arcs)
const EXPORTER_COLOR = '#009EDB';
const IMPORTER_COLOR = '#ED1847';

const ALL_FLOW_CATEGORIES = ['north-south', 'south-north', 'south-south', 'north-north'];

let _interval      = null;
let _index         = 0;
let _exportRanks   = {};
let _importRanks   = {};
let _startMetric    = 'value';

// _active: from pressing Animate (incl. preload) until stop; _onScreen: anim-mode applied.
// _runToken is bumped on every start and stop so a stale start bails.
let _active   = false;
let _onScreen = false;
let _runToken = 0;
let _saved    = null;            // user's view before anim-mode
let _timers   = [];
let _stopDone = Promise.resolve();

// Animation layers inside TradeMap.g
let _arcLayer = null, _particleLayer = null, _haloLayer = null, _nodeLayer = null, _labelLayer = null;

const nextFrames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
const loaderEl   = () => document.getElementById('loader');

function _onKey(e) {
  if (e.key !== 'Escape' || !_active) return;
  stopAnimation();
}

// Snapshot of what the animation overrides (falls back to STATE without App)
function _captureView() {
  const snap = window.App?.captureViewState?.();
  if (snap) return snap;
  return {
    year:          STATE.year,
    region:        STATE.region || 'Global',
    flowFilters:   [...(STATE.flowFilters || ALL_FLOW_CATEGORIES)],
    thresholdMode: STATE.thresholdMode,
    topNMode:      STATE.topNMode ?? null,
    exporters:     [...(STATE.selectedExporters || [])],
    importers:     [...(STATE.selectedImporters || [])],
  };
}

function _restoreView(s) {
  if (!s) return;
  STATE.year              = s.year;
  STATE.region            = s.region || 'Global';
  STATE.flowFilters       = new Set(s.flowFilters);
  STATE.thresholdMode     = s.thresholdMode;
  STATE.topNMode          = s.topNMode ?? null;
  // Don't leave the run's empty selection in STATE
  STATE.selectedExporters = new Set(s.exporters || []);
  STATE.selectedImporters = new Set(s.importers || []);
}

// ── Public API ────────────────────────────────────────────────

export async function startAnimation() {
  if (document.body.classList.contains('story-mode')) return;
  if (_active) return;
  _active = true;
  const token = ++_runToken;
  const live  = () => token === _runToken;
  _startMetric = STATE.metric;
  document.addEventListener('keydown', _onKey);

  // Rank tables are keyed by year only, so rebuild them for the current metric
  _exportRanks = {};
  _importRanks = {};

  // A previous run may still be handing the dashboard back
  await _stopDone;
  if (!live()) return;

  // Pre-load all years (DataLoader caches them)
  const loader = loaderEl();
  loader?.classList.remove('hidden');
  try {
    await Promise.all(YEARS.map(y => DataLoader.loadYear(y, _startMetric)));
  } catch (err) {
    if (live()) {
      console.error('Animation: could not load every year — not starting.', err);
      _abortStart();
    }
    return;
  } finally {
    // If stopped meanwhile, the loader may already belong to a newer run
    if (live()) loader?.classList.add('hidden');
  }
  if (!live()) return;
  // Metric changed during the preload: the loaded years are in the wrong units
  if (STATE.metric !== _startMetric) { _abortStart(); return; }

  // Rank per year from all flows. Records are net bilateral flows, so a bar sums the
  // pairs where the country is the net exporter (importer); it can appear in both lists.
  YEARS.forEach(year => {
    const flows = STATE.yearCache[year] || [];
    const exp = {}, imp = {};
    flows.forEach(d => {
      exp[d.exporter] = (exp[d.exporter] || 0) + d.netValue;
      imp[d.importer] = (imp[d.importer] || 0) + d.netValue;
    });
    _exportRanks[year] = Object.entries(exp)
      .map(([iso, value]) => ({ iso, value }))
      .sort((a, b) => b.value - a.value).slice(0, 10);
    _importRanks[year] = Object.entries(imp)
      .map(([iso, value]) => ({ iso, value }))
      .sort((a, b) => b.value - a.value).slice(0, 10);
  });

  // Save the user's view, then set STATE for the animation: floor only, no filters, global
  _saved = _captureView();
  STATE.thresholdMode      = minValue();
  STATE.topNMode           = null;
  STATE.selectedExporters  = new Set();
  STATE.selectedImporters  = new Set();
  STATE.region             = 'Global';
  STATE.flowFilters        = new Set(ALL_FLOW_CATEGORIES);

  // Show animation UI
  _onScreen = true;
  document.body.classList.add('anim-mode');
  document.dispatchEvent(new CustomEvent('shc:animation-started'));
  const head = document.getElementById('main-header');
  const top = head?.getBoundingClientRect().top ?? 0;
  if (head && (top < -4 || top > window.innerHeight * 0.5)) head.scrollIntoView({ block: 'start', behavior: 'instant' });
  _injectOverlays();

  // Wait two frames for the panel layout to apply, then recalculate the projection
  await nextFrames();
  if (!live()) return;
  TradeMap.init();

  // Hide the dashboard's own layers; the animation draws its own
  if (TradeMap.g) {
    TradeMap.g.selectAll('.flow-layer, .node-layer, .label-layer')
      .style('display', 'none');

    // Animation layers, in paint order
    _arcLayer      = TradeMap.g.append('g').attr('class', 'anim-arc-layer');
    _particleLayer = TradeMap.g.append('g').attr('class', 'anim-particle-layer');
    _haloLayer     = TradeMap.g.append('g').attr('class', 'anim-halo-layer');
    _nodeLayer     = TradeMap.g.append('g').attr('class', 'anim-node-layer');
    _labelLayer    = TradeMap.g.append('g').attr('class', 'anim-label-layer');
  }

  _timers.push(setTimeout(() => { if (live()) TradeMap.zoomToRegion('Global'); }, 80));

  // Short delay so the global zoom settles before the first draw
  _index = 0;
  _timers.push(setTimeout(() => { if (live()) _playYear(_index); }, 120));

  _interval = setInterval(() => {
    if (!live()) return;
    _index = (_index + 1) % YEARS.length;
    _playYear(_index);
  }, YEAR_MS);
}

// Cancel a start before anything is on screen; STATE is untouched
function _abortStart() {
  _runToken++;
  _active = false;
  document.removeEventListener('keydown', _onKey);
  loaderEl()?.classList.add('hidden');
}

// Ends or cancels the run and restores the user's view. The returned promise
// settles once `shc:animation-stopped` has been dispatched.
export function stopAnimation() {
  if (!_active) return _stopDone;
  _active = false;
  _runToken++;
  document.removeEventListener('keydown', _onKey);
  clearInterval(_interval);
  _interval = null;
  _timers.forEach(clearTimeout);
  _timers = [];

  if (!_onScreen) {
    // Stopped during the preload: nothing was changed yet.
    loaderEl()?.classList.add('hidden');
    return _stopDone;
  }
  _onScreen = false;

  document.body.classList.remove('anim-mode');
  document.getElementById('anim-panel')?.remove();
  document.getElementById('anim-legend')?.remove();

  _arcLayer?.remove();      _arcLayer = null;
  _particleLayer?.remove(); _particleLayer = null;
  _haloLayer?.remove();     _haloLayer = null;
  _nodeLayer?.remove();     _nodeLayer = null;
  _labelLayer?.remove();    _labelLayer = null;
  if (TradeMap.g) {
    TradeMap.g.selectAll('.flow-layer, .node-layer, .label-layer')
      .style('display', null);
  }

  // Restore synchronously so code reading STATE right after stop sees the user's view.
  // The metric needs no restore: the animation never writes STATE.metric.
  const saved = _saved;
  _saved = null;
  _restoreView(saved);

  // Wait for the full-width layout and the restored year's data, then re-init the map
  const year = STATE.year;
  _stopDone = Promise.all([
    DataLoader.loadYear(year).catch(err => console.error('Animation: could not reload year', year, err)),
    nextFrames(),
  ]).then(() => {
    if (_onScreen) return;        // a newer run is already on screen
    TradeMap.init();
    document.dispatchEvent(new CustomEvent('shc:animation-stopped'));
  });
  return _stopDone;
}

// True while a run is on screen or loading
export function isAnimating() {
  return _active;
}

// Called by the metric toggle before it switches STATE.metric.
// A metric change ends the run so the units never change mid-race.
export function stopAnimationForMetricChange() {
  return stopAnimation();
}

// ── Internal helpers ──────────────────────────────────────────

function _playYear(index) {
  if (!_onScreen) return;
  // Metric changed without the toggle: the ranks no longer match, so stop
  if (STATE.metric !== _startMetric) { stopAnimation(); return; }
  const year = YEARS[index];
  STATE.year = year;

  // Sync year select
  const sel = document.getElementById('year-select');
  if (sel) sel.value = year;

  _drawArcs(year);

  _updateOverlays(year, index);
}

// ── Build a circular SVG arc between two ISO countries (matches map.js formula)
function _arcPath(exp, imp) {
  const s = STATE.countryCoords[exp];
  const t = STATE.countryCoords[imp];
  if (!s || !t) return null;
  const p1 = TradeMap.projection(s);
  const p2 = TradeMap.projection(t);
  if (!p1 || !p2) return null;
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const dr = Math.sqrt(dx * dx + dy * dy) * 1.3;
  return `M${p1[0]},${p1[1]}A${dr},${dr} 0 0,1 ${p2[0]},${p2[1]}`;
}

// ── Arcs: all corridors, with width and opacity scaled so large flows stand out
function _drawArcs(year) {
  if (!_arcLayer) return;

  // Zoom scale, to keep stroke widths constant under the g transform
  const k = TradeMap.svg ? zoomTransform(TradeMap.svg.node()).k : 1;

  const floor = minValue();
  const flows = (STATE.yearCache[year] || [])
    .filter(d => d.netValue >= floor &&
                 STATE.countryCoords[d.exporter] &&
                 STATE.countryCoords[d.importer])
    .sort((a, b) => b.netValue - a.netValue);

  const key = d => `${d.exporter}|${d.importer}`;

  const values   = flows.map(d => d.netValue).sort(ascending);
  const topAnchor = quantile(values, ARC_TOP_Q) || max(values) || floor;

  const widthScale = scalePow().exponent(WIDTH_EXP)
    .domain([floor, topAnchor]).range([MIN_W, MAX_W]).clamp(true);
  const opacityScale = scalePow().exponent(WIDTH_EXP)
    .domain([floor, topAnchor]).range([MIN_OP, MAX_OP]).clamp(true);

  // ── All arcs in one layer (flow colours, thin→thick by value) ──
  const arcs = _arcLayer.selectAll('.anim-arc').data(flows, key);

  arcs.exit().transition().duration(md(ARC_DUR)).style('opacity', 0).remove();

  const arcsEnter = arcs.enter().append('path')
      .attr('class', 'anim-arc')
      .style('fill', 'none')
      .style('stroke-linecap', 'round')
      .style('stroke', d => CONFIG.flowColors[d.flowCategory] || '#009EDB')
      .attr('stroke-width', 0)
      .style('opacity', 0)
      .attr('d', d => _arcPath(d.exporter, d.importer));

  // stroke-width via .attr, not .style: D3 can't interpolate the computed "1px" value
  arcsEnter.merge(arcs)
      .attr('d', d => _arcPath(d.exporter, d.importer))
      .transition().duration(md(ARC_DUR)).ease(easeCubicOut)
      .style('stroke', d => CONFIG.flowColors[d.flowCategory] || '#009EDB')
      .attr('stroke-width', d => widthScale(d.netValue) / k)
      .style('opacity', d => opacityScale(d.netValue));

  // ── Country nodes (same encoding as the dashboard) ──
  _drawNodes(flows, k);

  // ── Halo rings + particle arcs for top-3 countries ──
  const top3expSet = new Set((_exportRanks[year] || []).slice(0, 3).map(d => d.iso));
  const top3impSet = new Set((_importRanks[year] || []).slice(0, 3).map(d => d.iso));
  _drawHalos(top3expSet, top3impSet, k);
  _drawParticles(flows, k, new Set([...top3expSet, ...top3impSet]), widthScale);

  // ── Labels for the largest corridors ──
  const labelFlows = flows.slice(0, LABEL_N);
  const labels = _labelLayer.selectAll('.anim-arc-label').data(labelFlows, key);
  labels.exit().remove();

  const labelEnter = labels.enter().append('text')
      .attr('class', 'anim-arc-label')
      .attr('text-anchor', 'middle')
      .style('font-family', 'Inter, Arial, sans-serif')
      .style('font-weight', '600')
      .style('fill', '#231f20')
      .style('paint-order', 'stroke')
      .style('stroke', '#ffffff')
      .style('stroke-linejoin', 'round')
      .style('pointer-events', 'none')
      .style('opacity', 0);

  labelEnter.merge(labels)
      .style('font-size', `${10 / k}px`)
      .style('stroke-width', `${2.5 / k}px`)
      .attr('x', d => _labelPos(d)[0])
      .attr('y', d => _labelPos(d)[1])
      .text(d => `${d.exporter} → ${d.importer}`)
      .transition().duration(md(ARC_DUR))
      .style('opacity', 0.92);
}

// ── Country nodes: size = gross volume, colour = net balance (blue exporter / red importer)
function _drawNodes(flows, k) {
  if (!_nodeLayer) return;

  const stats = {};
  flows.forEach(d => {
    if (!stats[d.exporter]) stats[d.exporter] = { gross: 0, net: 0 };
    if (!stats[d.importer]) stats[d.importer] = { gross: 0, net: 0 };
    stats[d.exporter].gross += d.netValue; stats[d.exporter].net += d.netValue;
    stats[d.importer].gross += d.netValue; stats[d.importer].net -= d.netValue;
  });

  const isos = Object.keys(stats).filter(iso => STATE.countryCoords[iso]);
  if (!isos.length) return;

  // Colour uses the full-year net balance (as on the dashboard); size only the drawn corridors
  const fullNet = {};
  (STATE.yearCache[STATE.year] || flows).forEach(d => {
    if (d.exporter === d.importer) return;
    fullNet[d.exporter] = (fullNet[d.exporter] || 0) + d.netValue;
    fullNet[d.importer] = (fullNet[d.importer] || 0) - d.netValue;
  });
  const netOf = iso => (iso in fullNet ? fullNet[iso] : stats[iso].net);

  const grossSorted = isos.map(i => stats[i].gross).sort(ascending);
  const netSorted   = isos.map(i => Math.abs(netOf(i))).sort(ascending);
  const p98Gross = quantile(grossSorted, NODE_TOP_Q) || max(grossSorted) || 1;
  const p98Net   = quantile(netSorted,   NODE_TOP_Q) || max(netSorted)   || 1;

  const radiusScale = scalePow().exponent(NODE_EXP)
    .domain([0, p98Gross]).range([NODE_MIN_R, NODE_MAX_R]).clamp(true);

  const maxT = Math.sqrt(p98Net);
  const colorFn = scaleLinear()
    .domain([-maxT, -maxT * 0.15, 0, maxT * 0.15, maxT])
    .range(['#ED1847', '#F9C0C5', '#ffffff', '#C5DFEF', '#009EDB'])
    .interpolate(interpolateHcl).clamp(true);
  const colorOf = v => colorFn(Math.sign(v) * Math.sqrt(Math.abs(v)));

  const proj = iso => TradeMap.projection(STATE.countryCoords[iso]) || [-999, -999];

  const nodes = _nodeLayer.selectAll('.anim-node').data(isos, d => d);

  nodes.exit().transition().duration(md(ARC_DUR))
    .attr('r', 0).style('opacity', 0).remove();

  const enter = nodes.enter().append('circle')
    .attr('class', 'anim-node')
    .attr('stroke', '#DED9D5')
    .style('pointer-events', 'none')
    .style('opacity', 0)
    .attr('r', 0)
    .attr('cx', d => proj(d)[0])
    .attr('cy', d => proj(d)[1]);

  enter.merge(nodes)
    .attr('cx', d => proj(d)[0])
    .attr('cy', d => proj(d)[1])
    .transition().duration(md(ARC_DUR))
    .attr('r', d => radiusScale(stats[d].gross) / k)
    .attr('fill', d => colorOf(netOf(d)))
    .attr('stroke-width', 1.5 / k)
    .style('opacity', 1);
}

// ── Pulsing halo rings for top-3 export (blue) and import (red) countries ──
function _drawHalos(top3expSet, top3impSet, k) {
  if (!_haloLayer) return;
  const baseR = 10 / k;

  const haloData = [
    ...[...top3expSet].map(iso => ({ iso, color: EXPORTER_COLOR })),
    ...[...top3impSet].map(iso => ({ iso, color: IMPORTER_COLOR })),
  ].filter(d => STATE.countryCoords[d.iso]);

  // Two rings per country with staggered animation-delay via CSS class
  const ringData = haloData.flatMap(d => [
    { iso: d.iso, color: d.color, ring: 1 },
    { iso: d.iso, color: d.color, ring: 2 },
  ]);

  const proj = iso => TradeMap.projection(STATE.countryCoords[iso]) || [-999, -999];

  const rings = _haloLayer.selectAll('.anim-halo-ring')
    .data(ringData, d => `${d.iso}-${d.ring}`);

  rings.exit().remove();

  rings.enter().append('circle')
    .attr('class', d => `anim-halo-ring anim-halo-ring-${d.ring}`)
    .attr('stroke', d => d.color)
    .attr('r', baseR)
    .attr('cx', d => proj(d.iso)[0])
    .attr('cy', d => proj(d.iso)[1])
    .merge(rings)
    .attr('r', baseR)
    .attr('cx', d => proj(d.iso)[0])
    .attr('cy', d => proj(d.iso)[1])
    .attr('stroke', d => d.color);
}

// ── White flowing particle overlay on arcs connected to top-3 countries ──
function _drawParticles(flows, k, topSet, widthScale) {
  if (!_particleLayer) return;
  // Decoration only: dropped under reduced motion
  if (prefersReducedMotion()) { _particleLayer.selectAll('*').remove(); return; }
  const key = d => `${d.exporter}|${d.importer}`;

  // Major corridors: at least 10% of the year's largest flow (flows are sorted desc)
  const maxVal = flows[0]?.netValue || 1;
  const topFlows = flows
    .filter(d => (topSet.has(d.exporter) || topSet.has(d.importer))
                 && d.netValue >= maxVal * 0.10)
    .slice(0, 25);

  const particles = _particleLayer.selectAll('.anim-particle-arc')
    .data(topFlows, key);

  particles.exit().remove();

  particles.enter().append('path')
    .attr('class', 'anim-particle-arc')
    .merge(particles)
    .attr('d', d => _arcPath(d.exporter, d.importer))
    .attr('stroke-width', d => Math.max(widthScale(d.netValue) / k, 0.5));
}

// Midpoint of the arc (offset toward the bulge) for label placement
function _labelPos(d) {
  const s = STATE.countryCoords[d.exporter];
  const t = STATE.countryCoords[d.importer];
  if (!s || !t) return [-999, -999];
  const p1 = TradeMap.projection(s);
  const p2 = TradeMap.projection(t);
  if (!p1 || !p2) return [-999, -999];
  return [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2 - 6];
}

function _injectOverlays() {
  const area = document.querySelector('.map-area');
  if (!area) return;

  // Bar chart race panel (ranking basis: see startAnimation)
  const basisTip = (role) =>
    `Each country pair is netted first (exports minus imports between the two). The bar adds up the pairs in which the country is the net ${role}. This is neither gross ${role === 'exporter' ? 'exports' : 'imports'} nor the overall net trade balance, so a country can appear in both lists.`;
  const panel = document.createElement('div');
  panel.id = 'anim-panel';
  panel.innerHTML = `
    <div class="ap-header">
      <span id="ap-year">2015</span>
      <span class="ap-range">2015–2024</span>
      <span id="ap-metric-badge" class="ap-metric">${metricBadge()}</span>
    </div>
    <div class="ap-section">
      <div class="ap-label ap-export" title="${basisTip('exporter')}"><i class="ap-key" style="background:${EXPORTER_COLOR}"></i>Top exporters
        <span class="ap-basis">Sum of net bilateral flows out</span>
      </div>
      <div id="ap-export" class="ap-chart"></div>
    </div>
    <div class="ap-sep"></div>
    <div class="ap-section">
      <div class="ap-label ap-import" title="${basisTip('importer')}"><i class="ap-key" style="background:${IMPORTER_COLOR}"></i>Top importers
        <span class="ap-basis">Sum of net bilateral flows in</span>
      </div>
      <div id="ap-import" class="ap-chart"></div>
    </div>
    <div class="ap-timeline-wrap">
      <div class="ap-tl-track"><div id="ap-tl-fill"></div></div>
    </div>`;
  area.appendChild(panel);

  // Map legend (#map-container is position: relative in anim-mode)
  const mapContainer = document.getElementById('map-container');
  if (mapContainer) {
    const legend = document.createElement('div');
    legend.id = 'anim-legend';
    legend.innerHTML = `
      <div class="al-section">
        <div class="al-section-title">Showing</div>
        <div class="al-row"><span class="al-metric">${metricBadge()}</span></div>
      </div>
      <div class="al-divider"></div>
      <div class="al-section al-keep">
        <div class="al-section-title">Line colours</div>
        <div class="al-row">
          <span class="al-item"><span class="al-swatch" style="background:${CONFIG.flowColors['north-south']}"></span>N→S</span>
          <span class="al-item"><span class="al-swatch" style="background:${CONFIG.flowColors['south-north']}"></span>S→N</span>
          <span class="al-item"><span class="al-swatch" style="background:${CONFIG.flowColors['south-south']}"></span>S→S</span>
          <span class="al-item"><span class="al-swatch" style="background:${CONFIG.flowColors['north-north']}"></span>N→N</span>
        </div>
      </div>
      <div class="al-divider"></div>
      <div class="al-section">
        <div class="al-section-title">Country nodes</div>
        <div class="al-row">
          <span class="al-item"><span class="al-dot" style="background:${EXPORTER_COLOR}"></span>Net exporter</span>
          <span class="al-item"><span class="al-dot" style="background:${IMPORTER_COLOR}"></span>Net importer</span>
          <span class="al-muted">· size = ${STATE.metric === 'weight' ? 'weight' : 'value'} of drawn corridors</span>
        </div>
      </div>
      <div class="al-divider"></div>
      <div class="al-section">
        <div class="al-section-title">Highlights</div>
        <div class="al-row">
          <span class="al-item"><span class="al-dot is-ring" style="background:${EXPORTER_COLOR};color:${EXPORTER_COLOR}"></span>Top 3 exporters</span>
          <span class="al-item"><span class="al-dot is-ring" style="background:${IMPORTER_COLOR};color:${IMPORTER_COLOR}"></span>Top 3 importers</span>
          <span class="al-item"><span class="al-dash"></span>Their major corridors (≥ 10% of the year's largest)</span>
        </div>
      </div>
      <div class="al-divider"></div>
      <div class="al-section">
        <div class="al-row"><span class="al-muted">Corridors below ${fmtMetric(minValue())} are not drawn</span></div>
      </div>`;
    mapContainer.appendChild(legend);
  }
}

function _updateOverlays(year, index) {
  const apYear = document.getElementById('ap-year');
  if (apYear) apYear.textContent = year;

  const fill = document.getElementById('ap-tl-fill');
  if (fill) fill.style.width = `${(index / (YEARS.length - 1)) * 100}%`;

  _renderRace('ap-export', _exportRanks[year], EXPORTER_COLOR);
  _renderRace('ap-import', _importRanks[year], IMPORTER_COLOR);
}

function _renderRace(containerId, ranks, color) {
  const g = select(`#${containerId}`);
  if (g.empty() || !ranks) return;

  // Max bar width = container width - flag (66) - value text (56) - gaps and padding (33)
  const containerEl = document.getElementById(containerId);
  const barMax = containerEl?.offsetWidth > 0
    ? Math.max(containerEl.offsetWidth - 66 - 56 - 33, 40)
    : BAR_MAX;

  // Rows shrink to fit (27 down to 15 px, at least 3 rows) so they never overflow
  const chartH = containerEl?.clientHeight || 0;
  const nRows  = chartH > 0 ? Math.max(3, Math.min(10, Math.floor(chartH / 15))) : 10;
  const rowH   = chartH > 0 ? Math.max(15, Math.min(ROW_H, Math.floor(chartH / nRows))) : ROW_H;
  const barH   = Math.min(BAR_H, rowH - 5);   // keep a gap between bars when rows shrink

  const top     = ranks.slice(0, nRows);
  const maxVal  = max(top, d => d.value) || 1;
  const bw      = v => Math.max((v / maxVal) * barMax, 2);
  const rankMap = new Map(top.map((d, i) => [d.iso, i]));

  const rows = g.selectAll('.ap-row').data(top, d => d.iso);

  // EXIT
  rows.exit().transition().duration(md(480))
    .style('opacity', '0').remove();

  // ENTER — created at final rank position to avoid wrong-position flash
  const entered = rows.enter().append('div').attr('class', 'ap-row')
    .style('opacity', '0')
    .style('transform', d => `translateY(${rankMap.get(d.iso) * rowH}px)`);

  // Use flag-icons CSS (works on Windows Chrome, unlike Unicode flag emoji)
  entered.append('span').attr('class', 'ap-flag')
    .html(d => {
      const code = iso2Lower(d.iso);
      return code
        ? `<span class="fi fi-${code}"></span>${d.iso}`
        : d.iso;
    });

  const bwrap = entered.append('div').attr('class', 'ap-bar-wrap');
  bwrap.append('div').attr('class', 'ap-bar')
    .style('background', color)
    .style('height', `${barH}px`)
    .style('width', d => `${bw(d.value)}px`);
  bwrap.append('span').attr('class', 'ap-val')
    .property('_prev', d => d.value)
    .text(d => fmtMetric(d.value));

  // UPDATE + ENTER — one transition so D3 doesn't cancel the enter opacity tween
  const all = entered.merge(rows);
  all.style('height', `${rowH}px`).select('.ap-flag').style('line-height', `${rowH}px`);
  all.select('.ap-bar').style('height', `${barH}px`);

  all.transition().duration(md(750))
    .style('opacity', '1')
    .style('transform', d => `translateY(${rankMap.get(d.iso) * rowH}px)`);

  all.select('.ap-bar').transition().duration(md(750))
    .style('width', d => `${bw(d.value)}px`);

  all.select('.ap-val').transition().duration(md(750))
    .tween('text', function(d) {
      const prev = (this._prev != null) ? this._prev : d.value;
      this._prev  = d.value;
      const interp = interpolateNumber(prev, d.value);
      return t => { this.textContent = fmtMetric(interp(t)); };
    });
}

