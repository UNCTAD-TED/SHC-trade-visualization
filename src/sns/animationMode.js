import * as d3 from 'd3';
import { CONFIG, STATE } from '../config.js';
import { DataLoader } from '../dataLoader.js';
import { TradeMap } from '../map.js';
import { iso2Lower } from './iso3toIso2.js';

const YEARS   = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];
const YEAR_MS = 3000;
const ROW_H   = 27;          // px — row height in the bar chart (must match CSS .ap-chart)

// ── Arc encoding ─────────────────────────────────────────────────
// WIDTH_EXP > 1 steepens the gradient: small flows stay thin, large flows shoot up.
const MIN_VALUE = 1_000_000; // $1M — minimum corridor value drawn at all
const ARC_DUR   = 750;       // arc transition duration (matches map.js)
const LABEL_N   = 0;         // map text labels (0 = off; set >0 to label the largest corridors)
const WIDTH_EXP = 1.6;       // power-scale exponent (0.5 = sqrt, 1 = linear, >1 = steeper)
const MIN_W     = 0.1;       // px — stroke width for the smallest ($1M) corridor
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

let _interval      = null;
let _index         = 0;
let _exportRanks   = {};
let _importRanks   = {};
let _active        = false;
let _savedThreshold = 'auto';

// Layer refs (created in TradeMap.g during animation, removed on stop)
let _arcLayer = null, _particleLayer = null, _haloLayer = null, _nodeLayer = null, _labelLayer = null;

// ── Public API ────────────────────────────────────────────────

export async function startAnimation() {
  if (_active) return;
  _active = true;
  _savedThreshold = STATE.thresholdMode;

  // Pre-load all years (DataLoader caches them)
  const loader = document.getElementById('loader');
  if (loader) loader.classList.remove('hidden');
  await Promise.all(YEARS.map(y => DataLoader.loadYear(y)));

  // Compute top-10 exporters and importers per year from ALL flows
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

  if (loader) loader.classList.add('hidden');

  // Modify STATE for animation: $1M threshold, no country filter, global view
  STATE.thresholdMode      = 1_000_000;
  STATE.selectedExporters  = new Set();
  STATE.selectedImporters  = new Set();
  STATE.region             = 'Global';
  STATE.flowFilters        = new Set(['north-south', 'south-north', 'south-south', 'north-north']);

  // Show animation UI
  document.body.classList.add('anim-mode');
  _injectOverlays();

  // Wait two rAF frames so the browser applies the flex layout (panel takes --anim-panel-w,
  // map-container gets the remaining width), then recalculate the map projection.
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
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
  setTimeout(() => TradeMap.zoomToRegion('Global'), 80);

  // Start at year 2015 (slight delay so the global zoom settles before first draw)
  _index = 0;
  setTimeout(() => _playYear(_index), 120);

  _interval = setInterval(() => {
    _index = (_index + 1) % YEARS.length;
    _playYear(_index);
  }, YEAR_MS);
}

export function stopAnimation() {
  if (!_active) return;
  _active = false;
  clearInterval(_interval);
  _interval = null;

  document.body.classList.remove('anim-mode');
  document.getElementById('anim-panel')?.remove();

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

  STATE.thresholdMode = _savedThreshold;

  // Wait for the browser to restore the full-width map layout, then
  // recalculate the projection before the dashboard re-renders flows.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    TradeMap.init();
    document.dispatchEvent(new CustomEvent('shc:animation-stopped'));
  }));
}

// ── Internal helpers ──────────────────────────────────────────

function _playYear(index) {
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

  // Flows ≥ $1M with known coordinates, sorted by value descending
  const flows = (STATE.yearCache[year] || [])
    .filter(d => d.netValue >= MIN_VALUE &&
                 STATE.countryCoords[d.exporter] &&
                 STATE.countryCoords[d.importer])
    .sort((a, b) => b.netValue - a.netValue);

  const key = d => `${d.exporter}|${d.importer}`;

  // Upper anchor = high quantile (not the single max) so one mega-corridor
  // doesn't compress everything else.
  const values   = flows.map(d => d.netValue).sort(d3.ascending);
  const topAnchor = d3.quantile(values, ARC_TOP_Q) || d3.max(values) || MIN_VALUE;

  // Power scale: exponent > 1 → small flows stay thin, large flows shoot up.
  const widthScale = d3.scalePow().exponent(WIDTH_EXP)
    .domain([MIN_VALUE, topAnchor]).range([MIN_W, MAX_W]).clamp(true);
  const opacityScale = d3.scalePow().exponent(WIDTH_EXP)
    .domain([MIN_VALUE, topAnchor]).range([MIN_OP, MAX_OP]).clamp(true);

  // ── All arcs in one layer (flow colours, thin→thick by value) ──
  const arcs = _arcLayer.selectAll('.anim-arc').data(flows, key);

  arcs.exit().transition().duration(ARC_DUR).style('opacity', 0).remove();

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
      .transition().duration(ARC_DUR).ease(d3.easeCubicOut)
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
      .transition().duration(ARC_DUR)
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

  const grossSorted = isos.map(i => stats[i].gross).sort(d3.ascending);
  const netSorted   = isos.map(i => Math.abs(stats[i].net)).sort(d3.ascending);
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

  nodes.exit().transition().duration(ARC_DUR)
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
    .transition().duration(ARC_DUR)
    .attr('r', d => radiusScale(stats[d].gross) / k)
    .attr('fill', d => colorOf(stats[d].net))
    .attr('stroke-width', 1.5 / k)
    .style('opacity', 1);
}

// ── Pulsing halo rings for top-3 export (blue) and import (green) countries ──
function _drawHalos(top3expSet, top3impSet, k) {
  if (!_haloLayer) return;
  const baseR = 10 / k;

  const haloData = [
    ...[...top3expSet].map(iso => ({ iso, color: '#009EDB' })),
    ...[...top3impSet].map(iso => ({ iso, color: '#72BF44' })),
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
  const key = d => `${d.exporter}|${d.importer}`;

  // flows is already sorted descending by netValue; take top 15 that touch top-3
  const topFlows = flows
    .filter(d => topSet.has(d.exporter) || topSet.has(d.importer))
    .slice(0, 15);

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

  // Bar chart race panel
  const panel = document.createElement('div');
  panel.id = 'anim-panel';
  panel.innerHTML = `
    <div class="ap-header">
      <span id="ap-year">2015</span>
      <span class="ap-range">2015 – 2024</span>
    </div>
    <div class="ap-section">
      <div class="ap-label ap-export">▲&nbsp;TOP EXPORTERS</div>
      <div id="ap-export" class="ap-chart"></div>
    </div>
    <div class="ap-sep"></div>
    <div class="ap-section">
      <div class="ap-label ap-import">▼&nbsp;TOP IMPORTERS</div>
      <div id="ap-import" class="ap-chart"></div>
    </div>
    <div class="ap-timeline-wrap">
      <div class="ap-tl-track"><div id="ap-tl-fill"></div></div>
    </div>`;
  area.appendChild(panel);
}

function _updateOverlays(year, index) {
  const apYear = document.getElementById('ap-year');
  if (apYear) apYear.textContent = year;

  const fill = document.getElementById('ap-tl-fill');
  if (fill) fill.style.width = `${(index / (YEARS.length - 1)) * 100}%`;

  _renderRace('ap-export', _exportRanks[year], '#009EDB');
  _renderRace('ap-import', _importRanks[year], '#72BF44');
}

function _renderRace(containerId, ranks, color) {
  const g = d3.select(`#${containerId}`);
  if (g.empty() || !ranks) return;

  // Compute max bar width from the actual container width at render time so bars
  // always fill the available space regardless of --anim-panel-w.
  // Subtract: flag label (66px) + value text (~44px) + gaps (5px + 4px) + section padding (24px).
  const containerEl = document.getElementById(containerId);
  const barMax = containerEl?.offsetWidth > 0
    ? Math.max(containerEl.offsetWidth - 66 - 44 - 33, 40)
    : BAR_MAX;

  const top     = ranks.slice(0, 10);
  const maxVal  = d3.max(top, d => d.value) || 1;
  const bw      = v => Math.max((v / maxVal) * barMax, 2);
  const rankMap = new Map(top.map((d, i) => [d.iso, i]));

  const rows = g.selectAll('.ap-row').data(top, d => d.iso);

  // EXIT
  rows.exit().transition().duration(480)
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
    .text(d => _fmt(d.value));

  // UPDATE + ENTER — opacity + rank position animate together.
  // Single transition on `all` prevents D3 preempting the enter opacity tween.
  const all = entered.merge(rows);

  all.transition().duration(750)
    .style('opacity', '1')
    .style('transform', d => `translateY(${rankMap.get(d.iso) * ROW_H}px)`);

  all.select('.ap-bar').transition().duration(750)
    .style('width', d => `${bw(d.value)}px`);

  all.select('.ap-val').transition().duration(750)
    .tween('text', function(d) {
      const el  = this;
      const prev = (el._prev != null) ? el._prev : d.value;
      el._prev  = d.value;
      const interp = d3.interpolateNumber(prev, d.value);
      return t => { el.textContent = _fmt(interp(t)); };
    });
}

function _fmt(v) {
  if (v >= 1e9) return '$' + d3.format('.1f')(v / 1e9) + 'B';
  if (v >= 1e6) return '$' + d3.format('.0f')(v / 1e6) + 'M';
  return '$' + d3.format('.0f')(v / 1e3) + 'K';
}
