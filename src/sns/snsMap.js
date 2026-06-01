import * as d3 from 'd3';
import * as topojson from 'topojson-client';

// ── Layout constants (1920×1080 canvas)
const W = 1920, H = 1080;
const HEADER_H   = 64;
const TIMELINE_H = 44;

// UNCTAD flow colors — must match config.js exactly
const FLOW_COLORS = {
  'north-south': '#009EDB',
  'south-north': '#72BF44',
  'south-south': '#FBAF17',
  'north-north': '#AEA29A',
};

let svg, mapG, projection, path, meta;

// ── 1. Initialise map SVG (called once)
export function initSNSMap(state) {
  meta = state.meta;
  const world = state.geoData;
  const container = document.getElementById('map-container');

  svg = d3.select(container).append('svg')
    .attr('width', W).attr('height', H)
    .style('display', 'block')
    .style('background', '#050f23');

  // Natural Earth projection fitted between header and timeline
  projection = d3.geoNaturalEarth1()
    .fitExtent([[0, HEADER_H + 4], [W, H - TIMELINE_H - 8]], { type: 'Sphere' });
  path = d3.geoPath().projection(projection);

  mapG = svg.append('g').attr('class', 'map-g');

  // Ocean sphere
  mapG.append('path')
    .datum({ type: 'Sphere' })
    .attr('d', path)
    .attr('fill', '#081828')
    .attr('stroke', 'none');

  // Graticule
  mapG.append('path')
    .datum(d3.geoGraticule()())
    .attr('d', path)
    .attr('fill', 'none')
    .attr('stroke', '#0c2040')
    .attr('stroke-width', 0.4);

  // Country polygons (economies layer)
  if (world.objects && world.objects.economies) {
    const countries = topojson.feature(world, world.objects.economies);
    mapG.selectAll('.country')
      .data(countries.features)
      .enter().append('path')
      .attr('class', 'country')
      .attr('d', path)
      .attr('fill', '#1a3255')
      .attr('stroke', '#0c1e36')
      .attr('stroke-width', 0.3);
  }

  // Plain border lines
  if (world.objects && world.objects['plain-borders']) {
    mapG.append('path')
      .datum(topojson.feature(world, world.objects['plain-borders']))
      .attr('d', path)
      .attr('fill', 'none')
      .attr('stroke', '#0f2848')
      .attr('stroke-width', 0.5);
  }

  // Arc layer — populated by updateSNSMap()
  mapG.append('g').attr('class', 'arc-layer');

  // UI overlays (drawn above map)
  renderHeader();
  renderYearDisplay();
  renderTimeline();
}

// ── Header bar
function renderHeader() {
  const g = svg.append('g');

  g.append('rect')
    .attr('width', W).attr('height', HEADER_H)
    .attr('fill', 'rgba(4, 12, 28, 0.90)');

  g.append('text')
    .attr('x', 28).attr('y', 41)
    .attr('fill', '#009EDB')
    .attr('font-size', '21px').attr('font-weight', '700')
    .attr('font-family', 'Inter, Arial, sans-serif')
    .attr('letter-spacing', '2px')
    .text('UNCTAD');

  g.append('line')
    .attr('x1', 112).attr('y1', 18).attr('x2', 112).attr('y2', 48)
    .attr('stroke', '#1e3558').attr('stroke-width', 1);

  g.append('text')
    .attr('x', 124).attr('y', 41)
    .attr('fill', '#8ab0cc')
    .attr('font-size', '17px')
    .attr('font-family', 'Inter, Arial, sans-serif')
    .text('Second-Hand Clothes Trade Monitor  ·  2015 – 2024');

  // Year label — sits left of the HTML panel (right: 20+320+20 = 360 from right)
  svg.append('text')
    .attr('id', 'sns-year-label')
    .attr('x', W - 360).attr('y', 43)
    .attr('text-anchor', 'end')
    .attr('fill', '#d8eaf8')
    .attr('font-size', '30px').attr('font-weight', '700')
    .attr('font-family', 'Inter, Arial, sans-serif')
    .text('2015');

  g.append('text')
    .attr('x', W - 26).attr('y', 43)
    .attr('text-anchor', 'end')
    .attr('fill', '#284060')
    .attr('font-size', '12px')
    .attr('font-family', 'Inter, Arial, sans-serif')
    .text('Flows ≥ $1M  |  Source: BACI, CEPII');
}

// ── Large watermark year (semi-transparent, center-left of map)
function renderYearDisplay() {
  svg.append('text')
    .attr('id', 'sns-year')
    .attr('x', (W - 340) / 2)
    .attr('y', H - TIMELINE_H - 20)
    .attr('text-anchor', 'middle')
    .attr('fill', 'rgba(0, 100, 200, 0.055)')
    .attr('font-size', '300px').attr('font-weight', '700')
    .attr('font-family', 'Inter, Arial, sans-serif')
    .text('2015');
}

// ── Timeline bar at the bottom
function renderTimeline() {
  const trackX = 60, trackW = W - 120, y = H - 20;
  const g = svg.append('g');

  g.append('rect')
    .attr('x', trackX).attr('y', y - 2)
    .attr('width', trackW).attr('height', 3)
    .attr('fill', '#152840').attr('rx', 1.5);

  g.append('rect')
    .attr('id', 'sns-timeline-progress')
    .attr('x', trackX).attr('y', y - 2)
    .attr('width', 0).attr('height', 3)
    .attr('fill', '#009EDB').attr('rx', 1.5);

  const years = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];
  years.forEach((yr, i) => {
    const x = trackX + (i / 9) * trackW;
    g.append('circle')
      .attr('class', 'timeline-tick')
      .attr('cx', x).attr('cy', y - 0.5)
      .attr('r', 3.5)
      .attr('fill', '#152840');

    if (i % 2 === 0 || yr === 2024) {
      g.append('text')
        .attr('x', x).attr('y', y + 16)
        .attr('text-anchor', 'middle')
        .attr('fill', '#2c4a68')
        .attr('font-size', '11px')
        .attr('font-family', 'Inter, Arial, sans-serif')
        .text(yr);
    }
  });
}

// ── Arc path: circular arc matching the original dashboard formula exactly
function buildArcPath(d) {
  const exp = meta[d.exporter]?.coords;
  const imp = meta[d.importer]?.coords;
  if (!exp || !imp) return '';
  const p1 = projection(exp);
  const p2 = projection(imp);
  if (!p1 || !p2) return '';
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const dr = Math.sqrt(dx * dx + dy * dy) * 1.3;
  return `M${p1[0]},${p1[1]}A${dr},${dr} 0 0,1 ${p2[0]},${p2[1]}`;
}

// ── 2. Update arcs for a given year (called each animation tick)
export function updateSNSMap(flows, metaData, duration) {
  if (!svg) return;
  meta = metaData;

  const arcLayer = mapG.select('.arc-layer');

  // Compute quantile-based scales from the current year's data (mirrors original logic)
  const values = flows.map(d => d.netValue).sort(d3.ascending);
  const p98 = d3.quantile(values, 0.98) || d3.max(values) || 1;

  const maxEdgeW = Math.max(Math.min(W * 0.008, 12), 1); // 12px cap at 1920px width

  const widthScale = d3.scaleSqrt()
    .domain([0, p98])
    .range([0.5, maxEdgeW * 0.7])  // non-focused range from original
    .clamp(true);

  const opacityScale = d3.scaleLinear()
    .domain([0, p98])
    .range([0.28, 0.88])           // slightly boosted from original [0.15,0.85] for dark bg
    .clamp(true);

  // D3 key-based join: arcs that persist between years get smooth transitions
  const arcs = arcLayer.selectAll('.trade-arc')
    .data(flows, d => `${d.exporter}|${d.importer}`);

  // Exit: old arcs fade out
  arcs.exit()
    .transition().duration(500)
    .style('opacity', 0)
    .remove();

  // Enter: new arcs start invisible
  const entered = arcs.enter().append('path')
    .attr('class', 'trade-arc')
    .style('fill', 'none')
    .style('opacity', 0)
    .attr('stroke', d => FLOW_COLORS[d.flowCategory] || '#009EDB')
    .attr('stroke-linecap', 'round')
    .attr('d', d => buildArcPath(d));

  // Enter + update: set path immediately, then transition width/opacity
  entered.merge(arcs)
    .attr('stroke', d => FLOW_COLORS[d.flowCategory] || '#009EDB')
    .attr('d', d => buildArcPath(d))
    .transition().duration(duration || 750).ease(d3.easeCubicOut)
    .attr('stroke-width', d => widthScale(d.netValue))
    .style('opacity', d => opacityScale(d.netValue));
}

// ── 3. Update timeline progress indicator
export function updateTimelineProgress(index, total) {
  const trackW = W - 120;
  const prog = document.getElementById('sns-timeline-progress');
  if (prog) prog.setAttribute('width', (index / (total - 1)) * trackW);

  document.querySelectorAll('.timeline-tick').forEach((el, i) => {
    el.setAttribute('fill', i <= index ? '#009EDB' : '#152840');
  });
}
