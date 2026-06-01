import * as d3 from 'd3';
import { getFlag } from './iso3toIso2.js';

const ROW_H  = 28;   // must match CSS .race-row height
const MAX_N  = 10;
const BAR_MAX = 185; // max bar width in px (panel 320px - label 72px - padding - val text)

function fmtUSD(v) {
  if (v >= 1e9) return '$' + d3.format('.1f')(v / 1e9) + 'B';
  if (v >= 1e6) return '$' + d3.format('.0f')(v / 1e6) + 'M';
  if (v >= 1e3) return '$' + d3.format('.0f')(v / 1e3) + 'K';
  return '$' + Math.round(v);
}

// Public entry point called by sns.js on every year change
export function updateSNSChart(exportRanks, importRanks, duration) {
  renderRace('#export-chart', exportRanks, '#009EDB', duration);
  renderRace('#import-chart', importRanks, '#72BF44', duration);
}

function renderRace(selector, ranks, color, duration) {
  const container = d3.select(selector);
  if (container.empty()) return;

  const top = ranks.slice(0, MAX_N);
  const maxVal = d3.max(top, d => d.value) || 1;
  const barW = v => Math.max((v / maxVal) * BAR_MAX, 2);

  // rankMap: iso → final rank index (used for correct positioning)
  const rankMap = new Map(top.map((d, i) => [d.iso, i]));

  const rows = container.selectAll('.race-row')
    .data(top, d => d.iso);

  // ── EXIT: country dropped out of top N — fade it out
  rows.exit()
    .style('pointer-events', 'none')
    .transition().duration(duration * 0.4)
    .style('opacity', '0')
    .remove();

  // ── ENTER: new country — create at its target rank position immediately
  const entered = rows.enter().append('div')
    .attr('class', 'race-row')
    .style('opacity', '0')
    .style('transform', d => `translateY(${rankMap.get(d.iso) * ROW_H}px)`);

  // Flag + ISO3 label (HTML span → emoji renders correctly)
  entered.append('span')
    .attr('class', 'row-flag')
    .text(d => `${getFlag(d.iso)} ${d.iso}`);

  // Bar + value wrapper
  const barWrap = entered.append('div').attr('class', 'row-bar-wrap');

  barWrap.append('div')
    .attr('class', 'row-bar')
    .style('background-color', color)
    .style('width', d => `${barW(d.value)}px`);

  barWrap.append('span')
    .attr('class', 'row-val')
    .property('_prev', d => d.value)   // store initial value for tween start
    .text(d => fmtUSD(d.value));

  // Fade the new row in
  entered.transition().duration(duration * 0.55)
    .style('opacity', '1');

  // ── UPDATE + ENTER merged: animate rank position, bar width, and value counter
  const all = entered.merge(rows);

  // Move each row to its new rank position (using iso key via rankMap, NOT index i)
  all.transition().duration(duration)
    .style('transform', d => `translateY(${rankMap.get(d.iso) * ROW_H}px)`);

  // Animate bar width
  all.select('.row-bar').transition().duration(duration)
    .style('width', d => `${barW(d.value)}px`);

  // Animate value counter (number tween)
  all.select('.row-val').transition().duration(duration)
    .tween('text', function(d) {
      const el = this;
      // Read previous value stored directly on the DOM element
      const prev = (el._prev != null) ? el._prev : d.value;
      el._prev = d.value;
      const interp = d3.interpolateNumber(prev, d.value);
      return t => { el.textContent = fmtUSD(interp(t)); };
    });
}
