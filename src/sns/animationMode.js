import * as d3 from 'd3';
import { CONFIG, METRIC_FORMAT, STATE } from '../config.js';
import { DataLoader } from '../dataLoader.js';
import { TradeMap } from '../map.js';
import { iso2Lower } from './iso3toIso2.js';
// md() = motionDuration: collapses every D3 transition to 0 ms under
// prefers-reduced-motion. The year still advances and the bars still land on
// the right values and ranks — they just stop sliding.
import { motionDuration as md, prefersReducedMotion } from '../motion.js';

const YEARS   = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];
const YEAR_MS = 3000;
const ROW_H   = 27;          // px — row height in the bar chart (must match CSS .ap-chart)

// ── Active metric ─────────────────────────────────────────────────
// Everything the panel, the map and the legend print goes through these, so the
// animation always speaks in the units the header metric toggle selected.

// Display formatter for the active metric — bar labels, count-up tween and
// legend all use it, so the panel never shows '$' while Weight is selected.
const fmtMetric = (v) => (METRIC_FORMAT[STATE.metric] || METRIC_FORMAT.value).fmt(v);

// Badge copy, matching the header metric toggle's own vocabulary
// (#metric-group title: "trade value (USD) ... trade weight (tonnes)").
const METRIC_BADGE = { value: 'Value (USD)', weight: 'Weight (tonnes)' };
const metricBadge = () => METRIC_BADGE[STATE.metric] || METRIC_BADGE.value;

// Minimum corridor magnitude drawn at all, per metric. Kept in step with
// App.THRESHOLD_LABELS (src/main.js), which maps the same raw number to '$1M'
// for value and '1kt' for weight: weight arrives in kilograms, so
// 1,000,000 kg = 1,000 t = 1 kt is the weight counterpart of the $1M floor.
// The two are the same number because that is the label table's mapping, not a
// copy-paste — and it keeps the drawn corridor count in the same band for both
// metrics (2015–2024: ~320–490 value, ~450–470 weight).
const MIN_VALUE_BY_METRIC = { value: 1_000_000, weight: 1_000_000 };
const minValue = () => MIN_VALUE_BY_METRIC[STATE.metric] ?? MIN_VALUE_BY_METRIC.value;

// ── Arc encoding ─────────────────────────────────────────────────
// WIDTH_EXP > 1 steepens the gradient: small flows stay thin, large flows shoot up.
const ARC_DUR   = 750;       // arc transition duration (matches map.js)
const LABEL_N   = 0;         // map text labels (0 = off; set >0 to label the largest corridors)
const WIDTH_EXP = 1.6;       // power-scale exponent (0.5 = sqrt, 1 = linear, >1 = steeper)
const MIN_W     = 0.1;       // px — stroke width for the smallest ($1M / 1kt) corridor
const MAX_W     = 8;         // px — stroke width for the largest corridor
const MIN_OP    = 0.13;      // opacity for the smallest corridor
const MAX_OP    = 0.6;       // opacity for the largest corridor
const ARC_TOP_Q = 0.97;      // quantile used as the upper anchor (prevents one mega-flow blowing out the scale)

// ── Node encoding ─────────────────────────────────────────────────
const NODE_MIN_R = 1;        // px — radius for the smallest active country
const NODE_MAX_R = 8;        // px — radius for the largest active country
const NODE_EXP   = 0.9;      // scale exponent (0.5 = sqrt, like the original dashboard)
const NODE_TOP_Q = 0.98;     // quantile used as the upper anchor for node radius

// ── Bar chart encoding ────────────────────────────────────────────
const BAR_MAX = 300;         // px — fallback max bar width (used when container width is unknown)
const BAR_H   = 20;          // px — bar height (overrides .ap-bar CSS height)

// ── Role colours ──────────────────────────────────────────────────
// Same semantics as the dashboard's node legend: blue = (net) exporter,
// red = (net) importer. Green is reserved for South→North arcs
// (CONFIG.flowColors['south-north']), so it is never used for a role here.
const EXPORTER_COLOR = '#009EDB';
const IMPORTER_COLOR = '#ED1847';

const ALL_FLOW_CATEGORIES = ['north-south', 'south-north', 'south-south', 'north-north'];

let _interval      = null;
let _index         = 0;
let _exportRanks   = {};
let _importRanks   = {};
let _startMetric    = 'value';   // metric this run was started with

// Run lifecycle
//   _active    true from the moment Animate is pressed (including the year
//              preload) until stopAnimation(). isAnimating() reports it.
//   _onScreen  true while anim-mode is applied (STATE overridden, overlays in
//              the DOM). Only then does a stop have anything to restore.
//   _runToken  bumped by every start AND every stop. Each await in
//              startAnimation re-checks it, so a start that was stopped (or
//              superseded) while it was loading never enters anim-mode.
let _active   = false;
let _onScreen = false;
let _runToken = 0;
let _saved    = null;            // the user's view, captured just before anim-mode
let _timers   = [];              // one-shot timeouts of the current run
let _stopDone = Promise.resolve();

// Layer refs (created in TradeMap.g during animation, removed on stop)
let _arcLayer = null, _particleLayer = null, _haloLayer = null, _nodeLayer = null, _labelLayer = null;

const nextFrames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
const loaderEl   = () => document.getElementById('loader');

// Escape ends a run (while the bar race is on screen the header — and with it
// the Stop button — is the only way out otherwise).
function _onKey(e) {
  if (e.key !== 'Escape' || !_active) return;
  stopAnimation();
}

// Everything the animation overrides, so stop can hand the view back as found.
// App.captureViewState() (main.js) is preferred; the STATE fallback keeps this
// module usable on pages without the dashboard controller.
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
  // The pickers were never touched (updateDashboard rebuilds these from them),
  // but STATE must not keep the run's empty selection in the meantime.
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

  // Rank tables are keyed by year only, so a run under a different metric would
  // otherwise reuse the previous metric's numbers. Rebuild them every start.
  _exportRanks = {};
  _importRanks = {};

  // A previous run may still be handing the dashboard back (2 frames).
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
    // A stop during the preload has already hidden the loader — and the loader
    // may by now belong to whatever replaced this run (e.g. a metric switch).
    if (live()) loader?.classList.add('hidden');
  }
  if (!live()) return;
  // A metric switch that was already in flight when Animate was pressed may
  // have committed meanwhile: the preloaded years would be in the wrong units.
  if (STATE.metric !== _startMetric) { _abortStart(); return; }

  // Rank countries per year from ALL flows (not just those above the drawing
  // floor). Each record is a NET bilateral flow (one per country pair, from
  // the net exporter to the net importer), so a country's bar is the sum of
  // the pairs in which it is the net exporter (resp. importer). That is neither
  // its gross exports nor its overall net balance — a country can appear in
  // both lists — and the panel labels say so.
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

  // Snapshot the user's view, then modify STATE for animation: metric-
  // appropriate floor ($1M / 1kt), no country filter, no Top-N cap (the
  // animation draws every corridor above the floor), global view.
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
  _injectOverlays();

  // Wait two rAF frames so the browser applies the flex layout (panel takes --anim-panel-w,
  // map-container gets the remaining width), then recalculate the map projection.
  await nextFrames();
  if (!live()) return;            // stopped meanwhile — stopAnimation cleaned up
  TradeMap.init();

  // Hide the dashboard's own flow/node/label layers — animation draws its own arcs
  if (TradeMap.g) {
    TradeMap.g.selectAll('.flow-layer, .node-layer, .label-layer')
      .style('display', 'none');

    // Create dedicated animation layers (paint order: arcs → particles → halos → nodes → labels)
    _arcLayer      = TradeMap.g.append('g').attr('class', 'anim-arc-layer');
    _particleLayer = TradeMap.g.append('g').attr('class', 'anim-particle-layer');
    _haloLayer     = TradeMap.g.append('g').attr('class', 'anim-halo-layer');
    _nodeLayer     = TradeMap.g.append('g').attr('class', 'anim-node-layer');
    _labelLayer    = TradeMap.g.append('g').attr('class', 'anim-label-layer');
  }

  // Reset map zoom to global
  _timers.push(setTimeout(() => { if (live()) TradeMap.zoomToRegion('Global'); }, 80));

  // Start at year 2015 (slight delay so the global zoom settles before first draw)
  _index = 0;
  _timers.push(setTimeout(() => { if (live()) _playYear(_index); }, 120));

  _interval = setInterval(() => {
    if (!live()) return;
    _index = (_index + 1) % YEARS.length;
    _playYear(_index);
  }, YEAR_MS);
}

// A start that cannot go ahead (load failure, metric changed under it) before
// anything was put on screen: release the run without touching STATE.
function _abortStart() {
  _runToken++;
  _active = false;
  document.removeEventListener('keydown', _onKey);
  loaderEl()?.classList.add('hidden');
}

// Ends the run (or cancels one still loading) and hands the dashboard back:
// STATE gets the user's pre-animation year, region, flow categories, threshold,
// Top-N and selection back synchronously, then — once the full-width layout is
// applied and that year's data is in the cache — `shc:animation-stopped` lets
// App re-sync every control and re-render. Returns a promise that settles when
// that hand-back is complete.
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

  // Remove animation layers and restore the dashboard's own flow layers
  _arcLayer?.remove();      _arcLayer = null;
  _particleLayer?.remove(); _particleLayer = null;
  _haloLayer?.remove();     _haloLayer = null;
  _nodeLayer?.remove();     _nodeLayer = null;
  _labelLayer?.remove();    _labelLayer = null;
  if (TradeMap.g) {
    TradeMap.g.selectAll('.flow-layer, .node-layer, .label-layer')
      .style('display', null);
  }

  // Restore synchronously, so anything that reads STATE right after stopping
  // (e.g. the metric toggle, which loads the new metric for STATE.year) already
  // sees the user's view rather than the race's last frame.
  // The metric needs no restore: startAnimation never writes STATE.metric, and a
  // metric change requested mid-run stops the animation first (see
  // stopAnimationForMetricChange), so whatever metric is active on stop is the
  // one the user chose.
  const saved = _saved;
  _saved = null;
  _restoreView(saved);

  // Wait for the browser to restore the full-width map layout and make sure
  // the restored year is loaded, then recalculate the projection before the
  // dashboard re-renders flows.
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

// True while a bar-chart-race run is on screen (or loading).
export function isAnimating() {
  return _active;
}

// Called by the metric toggle before it switches STATE.metric.
// Policy: a metric change ends the animation and returns to the normal
// dashboard. Restarting mid-run would have to re-derive every year's rank table
// and reset the timeline anyway, and a bar race whose units change halfway is
// easy to misread — stopping makes the unit change unambiguous.
export function stopAnimationForMetricChange() {
  return stopAnimation();
}

// ── Internal helpers ──────────────────────────────────────────

function _playYear(index) {
  if (!_onScreen) return;
  // A metric switch committed under the run (it bypassed the toggle) — the
  // ranks and units no longer match the data: end the run.
  if (STATE.metric !== _startMetric) { stopAnimation(); return; }
  const year = YEARS[index];
  STATE.year = year;

  // Sync year select
  const sel = document.getElementById('year-select');
  if (sel) sel.value = year;

  // Draw the two-tier focus+context arcs
  _drawArcs(year);

  // Update overlays
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

// ── Single-tier arc rendering: ALL corridors, with a steep width+opacity gradient
//    so large flows dominate visually while small ones recede (no information loss).
function _drawArcs(year) {
  if (!_arcLayer) return;

  // Current zoom scale — keep stroke widths visually constant under the g transform
  const k = TradeMap.svg ? d3.zoomTransform(TradeMap.svg.node()).k : 1;

  // Flows ≥ the metric's floor ($1M / 1kt) with known coordinates, sorted descending
  const floor = minValue();
  const flows = (STATE.yearCache[year] || [])
    .filter(d => d.netValue >= floor &&
                 STATE.countryCoords[d.exporter] &&
                 STATE.countryCoords[d.importer])
    .sort((a, b) => b.netValue - a.netValue);

  const key = d => `${d.exporter}|${d.importer}`;

  // Upper anchor = high quantile (not the single max) so one mega-corridor
  // doesn't compress everything else.
  const values   = flows.map(d => d.netValue).sort(d3.ascending);
  const topAnchor = d3.quantile(values, ARC_TOP_Q) || d3.max(values) || floor;

  // Power scale: exponent > 1 → small flows stay thin, large flows shoot up.
  const widthScale = d3.scalePow().exponent(WIDTH_EXP)
    .domain([floor, topAnchor]).range([MIN_W, MAX_W]).clamp(true);
  const opacityScale = d3.scalePow().exponent(WIDTH_EXP)
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

  // NOTE: stroke-width must be set via .attr (not .style). With .style, D3 tries to
  // number-interpolate the current computed value "1px" → +"1px" = NaN, so width never applies.
  arcsEnter.merge(arcs)
      .attr('d', d => _arcPath(d.exporter, d.importer))
      .transition().duration(md(ARC_DUR)).ease(d3.easeCubicOut)
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
//    Mirrors the dashboard's node encoding in map.js.
function _drawNodes(flows, k) {
  if (!_nodeLayer) return;

  // Aggregate per-country gross volume and net balance from the visible flows
  const stats = {};
  flows.forEach(d => {
    if (!stats[d.exporter]) stats[d.exporter] = { gross: 0, net: 0 };
    if (!stats[d.importer]) stats[d.importer] = { gross: 0, net: 0 };
    stats[d.exporter].gross += d.netValue; stats[d.exporter].net += d.netValue;
    stats[d.importer].gross += d.netValue; stats[d.importer].net -= d.netValue;
  });

  const isos = Object.keys(stats).filter(iso => STATE.countryCoords[iso]);
  if (!isos.length) return;

  // Colour = the economy's net balance over ALL its flows that year (the same
  // basis as the dashboard circles and the country panel), so a net exporter is
  // never painted red because only its import corridors clear the race's cut-off.
  // Size stays the total of the corridors drawn.
  const fullNet = {};
  (STATE.yearCache[STATE.year] || flows).forEach(d => {
    if (d.exporter === d.importer) return;
    fullNet[d.exporter] = (fullNet[d.exporter] || 0) + d.netValue;
    fullNet[d.importer] = (fullNet[d.importer] || 0) - d.netValue;
  });
  const netOf = iso => (iso in fullNet ? fullNet[iso] : stats[iso].net);

  const grossSorted = isos.map(i => stats[i].gross).sort(d3.ascending);
  const netSorted   = isos.map(i => Math.abs(netOf(i))).sort(d3.ascending);
  const p98Gross = d3.quantile(grossSorted, NODE_TOP_Q) || d3.max(grossSorted) || 1;
  const p98Net   = d3.quantile(netSorted,   NODE_TOP_Q) || d3.max(netSorted)   || 1;

  const radiusScale = d3.scalePow().exponent(NODE_EXP)
    .domain([0, p98Gross]).range([NODE_MIN_R, NODE_MAX_R]).clamp(true);

  const maxT = Math.sqrt(p98Net);
  const colorFn = d3.scaleLinear()
    .domain([-maxT, -maxT * 0.15, 0, maxT * 0.15, maxT])
    .range(['#ED1847', '#F9C0C5', '#ffffff', '#C5DFEF', '#009EDB'])
    .interpolate(d3.interpolateHcl).clamp(true);
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
  // Flowing dashes are decoration on top of arcs that are already drawn;
  // under reduced motion they are dropped rather than frozen mid-corridor.
  if (prefersReducedMotion()) { _particleLayer.selectAll('*').remove(); return; }
  const key = d => `${d.exporter}|${d.importer}`;

  // flows is already sorted descending by netValue.
  // Use a value-based threshold (≥10% of the top flow) rather than a fixed count,
  // so the selection reflects genuinely major corridors regardless of the year.
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

  // Bar chart race panel.
  // Ranking basis (see startAnimation): each country pair is netted first, and a
  // bar sums the pairs in which the country is the net exporter (importer). The
  // sub-labels and tooltips state that, since it is neither gross trade nor the
  // overall net balance. Role colours are set inline: index.html's .ap-import
  // rule still carries the old green.
  const subStyle = 'display:block;margin-top:1px;font-size:9px;font-weight:400;letter-spacing:0;color:#6e6259;';
  const basisTip = (role) =>
    `Each country pair is netted first (exports minus imports between the two). ` +
    `The bar adds up the pairs in which the country is the net ${role}. ` +
    `This is neither gross ${role === 'exporter' ? 'exports' : 'imports'} nor the overall net trade balance, ` +
    `so a country can appear in both lists.`;
  const panel = document.createElement('div');
  panel.id = 'anim-panel';
  panel.innerHTML = `
    <div class="ap-header">
      <span id="ap-year">2015</span>
      <span class="ap-range">2015 – 2024</span>
      <span id="ap-metric-badge" class="ap-metric">${metricBadge()}</span>
    </div>
    <div class="ap-section">
      <div class="ap-label ap-export" style="color:${EXPORTER_COLOR}" title="${basisTip('exporter')}">▲&nbsp;TOP EXPORTERS
        <span class="ap-basis" style="${subStyle}">Sum of net bilateral flows out</span>
      </div>
      <div id="ap-export" class="ap-chart"></div>
    </div>
    <div class="ap-sep"></div>
    <div class="ap-section">
      <div class="ap-label ap-import" style="color:${IMPORTER_COLOR}" title="${basisTip('importer')}">▼&nbsp;TOP IMPORTERS
        <span class="ap-basis" style="${subStyle}">Sum of net bilateral flows in</span>
      </div>
      <div id="ap-import" class="ap-chart"></div>
    </div>
    <div class="ap-timeline-wrap">
      <div class="ap-tl-track"><div id="ap-tl-fill"></div></div>
    </div>`;
  area.appendChild(panel);

  // Map annotation legend — appended to #map-container (position: relative in anim-mode)
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
      <div class="al-section">
        <div class="al-section-title">Arc colours</div>
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
          <span class="al-item"><span class="al-dot" style="background:${EXPORTER_COLOR};box-shadow:0 0 4px ${EXPORTER_COLOR}"></span>Top 3 exporters</span>
          <span class="al-item"><span class="al-dot" style="background:${IMPORTER_COLOR};box-shadow:0 0 4px ${IMPORTER_COLOR}"></span>Top 3 importers</span>
          <span class="al-item"><span class="al-dash"></span>Their major corridors (≥10% of max)</span>
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
  const g = d3.select(`#${containerId}`);
  if (g.empty() || !ranks) return;

  // Compute max bar width from the actual container width at render time so bars
  // always fill the available space regardless of --anim-panel-w.
  // Subtract: flag label (66px) + value text (~56px, e.g. "$1.23B" / "1.23 Mt")
  // + gaps (5px + 4px) + section padding (24px).
  const containerEl = document.getElementById(containerId);
  const barMax = containerEl?.offsetWidth > 0
    ? Math.max(containerEl.offsetWidth - 66 - 56 - 33, 40)
    : BAR_MAX;

  const top     = ranks.slice(0, 10);
  const maxVal  = d3.max(top, d => d.value) || 1;
  const bw      = v => Math.max((v / maxVal) * barMax, 2);
  const rankMap = new Map(top.map((d, i) => [d.iso, i]));

  const rows = g.selectAll('.ap-row').data(top, d => d.iso);

  // EXIT
  rows.exit().transition().duration(md(480))
    .style('opacity', '0').remove();

  // ENTER — created at final rank position to avoid wrong-position flash
  const entered = rows.enter().append('div').attr('class', 'ap-row')
    .style('opacity', '0')
    .style('transform', d => `translateY(${rankMap.get(d.iso) * ROW_H}px)`);

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
    .style('height', `${BAR_H}px`)
    .style('width', d => `${bw(d.value)}px`);
  bwrap.append('span').attr('class', 'ap-val')
    .property('_prev', d => d.value)
    .text(d => fmtMetric(d.value));

  // UPDATE + ENTER — opacity + rank position animate together.
  // Single transition on `all` prevents D3 preempting the enter opacity tween.
  const all = entered.merge(rows);

  all.transition().duration(md(750))
    .style('opacity', '1')
    .style('transform', d => `translateY(${rankMap.get(d.iso) * ROW_H}px)`);

  all.select('.ap-bar').transition().duration(md(750))
    .style('width', d => `${bw(d.value)}px`);

  all.select('.ap-val').transition().duration(md(750))
    .tween('text', function(d) {
      const el  = this;
      const prev = (el._prev != null) ? el._prev : d.value;
      el._prev  = d.value;
      const interp = d3.interpolateNumber(prev, d.value);
      return t => { el.textContent = fmtMetric(interp(t)); };
    });
}

