// ─────────────────────────────────────────────────────────────────────────────
// Fact 03 — geographic flow infographic
// Renders the secondhand-clothing supply chain on the project's own world
// TopoJSON: United States → 2-stage sorting (Pakistan & India) → East Africa.
// Great-circle arcs are projected through geoNaturalEarth1, sized by trade
// volume, and animated (draw-on + flowing particles) when the section reveals.
// ─────────────────────────────────────────────────────────────────────────────
import {
  geoNaturalEarth1, geoPath, geoInterpolate, geoGraticule,
  line as d3line, curveBasis, scaleSqrt, select,
} from 'd3';
import * as topojson from 'topojson-client';

const SVGNS = 'http://www.w3.org/2000/svg';

// Geographic anchors (lon, lat). Sorting hub sits between Karachi and Mumbai.
const NODES = {
  us:      { lon: -97, lat: 39.5, name: 'United States', iso2: 'us', kind: 'origin' },
  sorting: { lon: 70,  lat: 25.5, name: '2-stage sorting', sub: 'Pakistan & India', kind: 'hub' },
  ug:      { lon: 32.3, lat: 1.4,  name: 'Uganda', iso2: 'ug', kind: 'dest' },
  tz:      { lon: 34.9, lat: -6.2, name: 'United Rep. of Tanzania', iso2: 'tz', kind: 'dest' },
};

// Frame the relevant band: US west coast → South Asia, with Africa fully visible.
const FRAME = { type: 'Polygon', coordinates: [[[-126, 56], [99, 56], [99, -24], [-126, -24], [-126, 56]]] };

let geoCache = null;
async function loadGeo() {
  if (geoCache) return geoCache;
  const world = await fetch('assets/worldmap-economies-4326.topo.json').then((r) => r.json());
  // Same longitude correction the main app applies to the UNCTAD TopoJSON transform.
  if (world.transform) world.transform.translate[0] += 11.314;
  geoCache = topojson.feature(world, world.objects.economies);
  return geoCache;
}

export async function renderSupplyMap(container, dests) {
  const land = await loadGeo();
  let resizeRAF = null;
  let played = false;

  const widthOf = (n) => scaleSqrt().domain([0, 90]).range([3, 10])(n);

  function build() {
    const W = container.clientWidth || 900;
    const H = Math.max(300, Math.min(560, W * 0.5));
    const projection = geoNaturalEarth1().fitExtent([[18, 14], [W - 18, H - 14]], FRAME);
    const path = geoPath(projection);
    const proj = (k) => projection([NODES[k].lon, NODES[k].lat]);

    // Great-circle arc, projected and smoothed.
    const arcPath = (a, b) => {
      const interp = geoInterpolate([NODES[a].lon, NODES[a].lat], [NODES[b].lon, NODES[b].lat]);
      const pts = [];
      for (let i = 0; i <= 70; i++) { const p = projection(interp(i / 70)); if (p) pts.push(p); }
      return d3line().curve(curveBasis)(pts);
    };

    const svg = select(container).selectAll('svg').data([0]);
    const svgEnter = svg.enter().append('svg').attr('class', 'fs-map-svg');
    const root = svgEnter.merge(svg)
      .attr('width', W).attr('height', H)
      .attr('viewBox', `0 0 ${W} ${H}`);
    root.selectAll('*').remove();

    // ── defs: arrowheads + soft glow ──
    const defs = root.append('defs');
    defs.html(`
      <marker id="fs-arrow-rust" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="11" markerHeight="11" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
        <path d="M0,1.5 L9,5 L0,8.5 z" fill="#b4501f"></path>
      </marker>`);

    // ── land ──
    const gLand = root.append('g').attr('class', 'fs-map-land-layer');
    gLand.append('path').datum(geoGraticule().step([20, 20])())
      .attr('class', 'fs-map-grat').attr('d', path);
    gLand.selectAll('path.fs-map-land')
      .data(land.features).enter().append('path')
      .attr('class', 'fs-map-land').attr('d', path);

    // ── arcs (trunk gold, branches rust) ──
    const flows = [
      { a: 'us', b: 'sorting', w: 10, cls: 'trunk' },
      { a: 'sorting', b: 'ug', w: widthOf(dests.find((d) => d.iso2 === 'ug')?.totalKg || 80), cls: 'branch' },
      { a: 'sorting', b: 'tz', w: widthOf(dests.find((d) => d.iso2 === 'tz')?.totalKg || 86), cls: 'branch' },
    ];
    const gArc = root.append('g').attr('class', 'fs-map-arc-layer');
    flows.forEach((f) => {
      const d = arcPath(f.a, f.b);
      gArc.append('path')
        .attr('class', `fs-map-arc is-${f.cls}`)
        .attr('d', d).attr('stroke-width', f.w)
        .attr('marker-end', f.cls === 'branch' ? 'url(#fs-arrow-rust)' : null);
      gArc.append('path')
        .attr('class', `fs-map-particle is-${f.cls}`)
        .attr('d', d).attr('stroke-width', Math.max(1.4, f.w * 0.22));
    });

    // ── nodes ──
    const gNode = root.append('g').attr('class', 'fs-map-node-layer');
    Object.entries(NODES).forEach(([key, n]) => {
      const [x, y] = proj(key);
      const g = gNode.append('g').attr('class', `fs-map-node is-${n.kind}`).attr('transform', `translate(${x},${y})`);
      if (n.kind === 'hub') {
        g.append('circle').attr('r', 17).attr('class', 'fs-map-hub-halo');
        g.append('circle').attr('r', 12).attr('class', 'fs-map-hub-dot');
        g.append('path').attr('class', 'fs-map-hub-ico')
          .attr('d', 'M-6,-4 H6 M-4,0 H4 M-2,4 H2').attr('transform', 'scale(0.9)');
      } else {
        g.append('circle').attr('r', 6).attr('class', 'fs-map-pin');
        // flag chip via foreignObject
        const fo = g.append('foreignObject').attr('x', -16).attr('y', -34).attr('width', 32).attr('height', 22);
        fo.append('xhtml:span').attr('class', `fi fi-${n.iso2}`)
          .attr('style', 'display:block;width:100%;height:100%;border-radius:3px;box-shadow:0 1px 3px rgba(0,0,0,.25)');
      }
    });

    // ── labels (HTML overlay so type stays crisp at every width) ──
    let overlay = container.querySelector('.fs-map-labels');
    if (overlay) overlay.remove();
    overlay = document.createElement('div');
    overlay.className = 'fs-map-labels';
    // dx/dy in projected px; align = anchor side relative to the point.
    const label = (key, html, { dx = 0, dy = 18, align = 'center' } = {}) => {
      const [x, y] = proj(key);
      const el = document.createElement('div');
      el.className = `fs-map-label align-${align}`;
      el.style.left = `${((x + dx) / W) * 100}%`;
      el.style.top = `${((y + dy) / H) * 100}%`;
      el.innerHTML = html;
      overlay.appendChild(el);
    };
    label('us', `<span class="fs-ml-name">United States</span><span class="fs-ml-sub">Export origin</span>`, { dx: -16, dy: -8, align: 'right' });
    label('sorting', `<span class="fs-ml-name">2-stage sorting</span><span class="fs-ml-sub">Pakistan &amp; India</span>`, { dx: 22, dy: -8, align: 'left' });
    const ug = dests.find((d) => d.iso2 === 'ug') || {};
    const tz = dests.find((d) => d.iso2 === 'tz') || {};
    label('ug', `<span class="fs-ml-name">Uganda</span><span class="fs-ml-fig">${(ug.totalKg ?? 80).toFixed(1)}M kg</span>`, { dx: -18, dy: -26, align: 'right' });
    label('tz', `<span class="fs-ml-name">Tanzania</span><span class="fs-ml-fig">${(tz.totalKg ?? 86.3).toFixed(1)}M kg</span>`, { dx: 16, dy: 14, align: 'left' });
    container.appendChild(overlay);

    // Prime draw-on state
    const arcs = container.querySelectorAll('.fs-map-arc');
    arcs.forEach((p) => { const len = p.getTotalLength(); p.style.strokeDasharray = len; p.style.strokeDashoffset = played ? 0 : len; });
    if (played) container.classList.add('is-played');
  }

  function play() {
    if (played) return;
    played = true;
    const arcs = container.querySelectorAll('.fs-map-arc');
    arcs.forEach((p, i) => {
      const len = p.getTotalLength();
      p.style.transition = `stroke-dashoffset 1.25s cubic-bezier(0.65,0,0.35,1) ${i * 0.32}s`;
      requestAnimationFrame(() => { p.style.strokeDashoffset = 0; });
      void len;
    });
    setTimeout(() => container.classList.add('is-played'), 700);
  }

  build();
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeRAF);
    resizeRAF = requestAnimationFrame(build);
  });

  return { play };
}
