// ─────────────────────────────────────────────────────────────────────────────
// SMEP Fact Sheet — scrollytelling controller
// Renders each section from factsheetData.js, then wires scroll-driven reveals,
// count-ups, waffle/donut drawing and the navigation rail.
// ─────────────────────────────────────────────────────────────────────────────
import '../styles/factsheet.less';
import {
  META, KEY_FINDING, QUALITY, SUPPLY_CHAIN, CHINA_SHIFT, AFRICA_CONTEXT,
  SOCIOECONOMIC, AFFORDABILITY, SECTOR, POLICY,
} from './factsheetData.js';
import { renderSupplyMap } from './factsheetMap.js';

let supplyMapPromise = null;

const $  = (sel, root = document) => root.querySelector(sel);
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const shirt = (cls = '') => `<svg class="${cls}" viewBox="0 0 64 64" aria-hidden="true"><use href="#fs-shirt"/></svg>`;
const icon = (name, cls = '') => `<svg class="fs-i ${cls}" viewBox="0 0 24 24" aria-hidden="true"><use href="#fs-i-${name}"/></svg>`;

// ── Number formatting ────────────────────────────────────────────────────────
function fmt(value, decimals = 0) {
  return Number(value).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// ═══════════════════════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════════════════════
function render() {
  // 01 — Key finding
  $('#fs-key-lead').textContent = KEY_FINDING.lead;

  // 02 — Quality
  $('#fs-quality-intro').textContent = QUALITY.gradeIntro;
  buildWaffle();
  buildGradeBars();
  buildNonRewearable();
  buildWastePerBale();

  // 03 — Supply chain
  buildSupplyChain();

  // 04 — China shift
  $('#fs-china-intro').textContent = CHINA_SHIFT.intro;
  buildChinaShift();

  // 05 — Africa context
  buildAfrica();

  // 06 — Socioeconomic
  buildSocial();

  // 07 — Affordability
  buildAffordability();

  // 08 — Sector
  buildSector();

  // 09 — Policy
  buildPolicy();

  // 10 — Outro
  buildOutro();
}

// ── 02 Waffle (100 shirts) ───────────────────────────────────────────────────
function buildWaffle() {
  const wrap = $('#fs-waffle');
  const rewear = 100 - QUALITY.nonRewearablePct; // 96 rewearable cells
  const ragsCells = Math.round((QUALITY.nonRewearable[0].pct / QUALITY.nonRewearablePct) * (100 - rewear));
  const counts = { rewear, rags: ragsCells, waste: 100 - rewear - ragsCells };
  const order = [
    ...Array(counts.rewear).fill('rewear'),
    ...Array(counts.rags).fill('rags'),
    ...Array(counts.waste).fill('waste'),
  ];
  order.forEach((cat, i) => {
    const cell = el(`<div class="fs-waffle-cell cat-${cat}" style="transition-delay:${i * 9}ms">${shirt()}</div>`);
    wrap.appendChild(cell);
  });
  $('#fs-waffle-legend').append(
    el(`<div class="fs-wleg-item"><span class="fs-wleg-dot" style="background:#5f7d3f"></span><strong>${counts.rewear}%</strong>&nbsp;Rewearable</div>`),
    el(`<div class="fs-wleg-item"><span class="fs-wleg-dot" style="background:#c2a05c"></span><strong>${QUALITY.nonRewearable[0].pct}%</strong>&nbsp;Rags</div>`),
    el(`<div class="fs-wleg-item"><span class="fs-wleg-dot" style="background:#b4501f"></span><strong>${QUALITY.nonRewearable[1].pct}%</strong>&nbsp;Waste</div>`),
  );
}

function buildGradeBars() {
  const host = $('#fs-grade-bars');
  QUALITY.grades.forEach((g) => {
    host.appendChild(el(`
      <div class="fs-grade-row">
        <div class="fs-grade-top">
          <span class="fs-grade-tag">${g.grade}</span>
          <span class="fs-grade-pct"><span class="fs-count" data-to="${g.pct}">0</span>%</span>
          <span class="fs-grade-name">${g.label}</span>
        </div>
        <div class="fs-grade-track"><div class="fs-bar-fill" style="--pct:${g.pct}%"></div></div>
      </div>`));
  });
}

function buildNonRewearable() {
  const host = $('#fs-nonrewear');
  const rows = QUALITY.nonRewearable.map((r) => `
    <div class="fs-nr-row is-${r.key}">
      <span class="fs-nr-label">${r.label}</span>
      <span class="fs-nr-track"><span class="fs-nr-fill" style="--pct:${(r.pct / QUALITY.nonRewearablePct) * 100}%"></span></span>
      <span class="fs-nr-val">${r.pct}%</span>
    </div>`).join('');
  host.innerHTML = `
    <div class="fs-nonrewear-head">
      <span class="fs-nonrewear-pct"><span class="fs-count" data-to="${QUALITY.nonRewearablePct}">0</span>%</span>
      <span class="fs-nonrewear-title">non-rewearable items</span>
    </div>
    ${rows}
    <p class="fs-nonrewear-note">${QUALITY.nonRewearableNote}</p>`;
}

function buildWastePerBale() {
  const host = $('#fs-wastebale');
  const rows = QUALITY.wastePerBale.map((w) => `
    <div class="fs-wb-row">
      <span class="fs-wb-country">${w.country}</span>
      <span class="fs-wb-val">${w.range[0]}–${w.range[1]}%</span>
    </div>`).join('');
  host.innerHTML = `
    <div class="fs-wastebale-head">${QUALITY.wastePerBaleNote}</div>
    ${rows}`;
}

// ── 03 Supply chain (pinned scrollytelling) ──────────────────────────────────
function buildSupplyChain() {
  const s = SUPPLY_CHAIN;
  supplyMapPromise = renderSupplyMap($('#fs-supply-map'),
    s.destinations.map((d) => ({ iso2: d.iso2, totalKg: d.totalKg, usKg: d.usKg })));
}

// ── 04 China shift ───────────────────────────────────────────────────────────
function twoBar(origin, data, cls) {
  const DOMAIN = 60; // % share domain so the longest bar (~55%) nearly fills the track
  const w = (v) => `${(v / DOMAIN) * 100}%`;
  const up = data.delta >= 0;
  return `
    <div class="fs-origin is-${cls}">
      <div class="fs-origin-head">
        <span class="fs-origin-name"><span class="fi fi-${cls === 'china' ? 'cn' : 'us'}"></span>${origin}</span>
        <span class="fs-delta ${up ? 'up' : 'down'}">${up ? '+' : ''}${data.delta.toFixed(1)} pts</span>
      </div>
      <div class="fs-twobar">
        <div class="fs-tb-row r-2018">
          <span class="fs-tb-year">'18</span>
          <span class="fs-tb-track"><span class="fs-tb-fill" style="--pct:${w(data.from)}"></span></span>
          <span class="fs-tb-val">${data.from}%</span>
        </div>
        <div class="fs-tb-row r-2023">
          <span class="fs-tb-year">'23</span>
          <span class="fs-tb-track"><span class="fs-tb-fill" style="--pct:${w(data.to)}"></span></span>
          <span class="fs-tb-val">${data.to}%</span>
        </div>
      </div>
    </div>`;
}
function buildChinaShift() {
  const host = $('#fs-china-grid');
  const iso = { 'Uganda': 'ug', 'United Republic of Tanzania': 'tz' };
  CHINA_SHIFT.markets.forEach((m) => {
    host.appendChild(el(`
      <div class="fs-china-card fs-reveal">
        <div class="fs-china-country"><span class="fi fi-${iso[m.country]}"></span>${m.country}</div>
        ${twoBar('China', m.china, 'china')}
        ${twoBar('United States', m.us, 'us')}
        <div class="fs-china-legend">
          <span><span class="fs-cl-bar y18"></span>2018 share</span>
          <span><span class="fs-cl-bar y23"></span>2023 share</span>
        </div>
      </div>`));
  });
}

// ── 05 Africa context ────────────────────────────────────────────────────────
function buildAfrica() {
  const a = AFRICA_CONTEXT;
  $('#fs-africa').innerHTML = `
    <div class="fs-africa-big fs-reveal">
      <div class="fs-africa-num"><span class="fs-count" data-to="${a.totalMillionKg}">0</span></div>
      <div class="fs-africa-unit">million kg of secondhand clothing</div>
      <div class="fs-africa-sub">imported into Africa in ${a.year}</div>
    </div>
    <div class="fs-africa-right fs-reveal" data-reveal-delay="1">
      <div class="fs-africa-share"><span class="fs-count" data-to="${a.ugTzSharePct}" data-decimals="1">0</span><span class="fs-pct">%</span></div>
      <div class="fs-africa-label">${a.label}, equal to <strong style="color:#fff">${a.ugTzMillionKg} million kg</strong>.</div>
      <div class="fs-africa-bar"><span class="fs-africa-bar-fill" style="--pct:${a.ugTzSharePct}%"></span></div>
      <div class="fs-africa-bar-cap"><span><span class="fi fi-ug"></span><span class="fi fi-tz"></span> Uganda + Tanzania</span><span>Rest of Africa</span></div>
    </div>`;
}

// ── 06 Socioeconomic ─────────────────────────────────────────────────────────
function buildSocial() {
  const s = SOCIOECONOMIC;
  $('#fs-traders').innerHTML = `
    <span class="fs-stat-ico">${icon('people')}</span>
    <div class="fs-stat-num"><span class="fs-count" data-to="${s.tradersSurveyed}">0</span></div>
    <div class="fs-stat-label">traders surveyed across Uganda &amp; the United Republic of Tanzania</div>`;
  $('#fs-family').innerHTML = `
    <span class="fs-stat-ico is-green">${icon('coin')}</span>
    <div class="fs-stat-num is-green"><span class="fs-count" data-to="${s.familyBenefitPct}">0</span>%</div>
    <div class="fs-stat-label">${s.familyBenefitLabel}</div>`;
  $('#fs-gender').innerHTML = `
    <div class="fs-stat-label" style="margin:0 0 4px;font-weight:700;color:#251f1b">Business ownership by gender</div>
    <div class="fs-gender-bar">
      <span class="fs-gender-seg male" style="--pct:${s.ownership.male}%"></span>
      <span class="fs-gender-seg female" style="--pct:${s.ownership.female}%"></span>
    </div>
    <div class="fs-gender-legend">
      <span class="male">Male <b>${s.ownership.male}%</b></span>
      <span class="female">Female <b>${s.ownership.female}%</b></span>
    </div>`;

  // Ascending staircase: each role sits one step higher up the value chain,
  // with rising height and deepening colour encoding increasing value.
  const stageIcons = ['bale', 'person', 'store', 'container'];
  const stepColors = ['#9bb578', '#c2a05c', '#9a7c40', '#b4501f'];
  $('#fs-mobility-chain').innerHTML = `
    <div class="fs-stair-axis"><span>Value</span>${icon('arrow-up', 'fs-stair-axis-ico')}</div>
    <div class="fs-stair">
      ${s.mobility.stages.map((stage, i) => `
        <div class="fs-step" style="--lvl:${i + 1};--c:${stepColors[i] || '#b4501f'}">
          <div class="fs-step-head">
            <div class="fs-step-node">${icon(stageIcons[i] || 'person', 'fs-step-ico')}<span class="fs-step-num">${i + 1}</span></div>
            <div class="fs-step-label">${stage}</div>
          </div>
          <div class="fs-step-riser"></div>
        </div>`).join('')}
    </div>`;
  $('#fs-mobility-stats').innerHTML = s.mobility.stats.map((st) => `
    <div class="fs-mstat">
      <div class="fs-mstat-num">${icon('arrow-up', 'fs-mstat-arrow')}<span class="fs-count" data-to="${st.pct}">0</span>%</div>
      <div class="fs-mstat-label">${st.label}</div>
    </div>`).join('');
}

// ── 07 Affordability ─────────────────────────────────────────────────────────
function buildAffordability() {
  const a = AFFORDABILITY;
  $('#fs-afford-income').innerHTML = `
    <span class="fs-income-ico">${icon('coin')}</span>
    <div class="fs-income-cap">Household income context · Uganda</div>
    <div class="fs-income-num">$<span class="fs-count" data-to="${a.dailyIncomeUSD}" data-decimals="2">0</span></div>
    <div class="fs-income-cap" style="margin-top:6px">estimated daily income</div>
    <div class="fs-income-note">${a.dailyIncomeNote}</div>`;

  // Pictogram: one coin = one day's household income. Cost of an item is shown
  // as the number of days' income it takes to buy.
  const coinSVG = () => `<svg class="fs-coin-svg" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="10.5" fill="currentColor"/>
    <path d="M12 6.3v11.4M9.6 9h4.2a1.75 1.75 0 0 1 0 3.5h-3.6a1.75 1.75 0 0 0 0 3.5h4.4" fill="none" stroke="#f7f3ea" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const daysOf = (usd) => Math.round((usd / a.dailyIncomeUSD) * 10) / 10; // 1-decimal, matches label
  const coins = (days) => {
    const full = Math.floor(days + 1e-9);
    const frac = +(days - full).toFixed(2);
    const ops = [];
    for (let i = 0; i < full; i++) ops.push(1);
    if (frac >= 0.05) ops.push(frac);
    if (ops.length === 0) ops.push(1);
    return ops.map((op, i) => `<span class="fs-coin" style="--op:${op};--d:${i * 90}ms">${coinSVG()}</span>`).join('');
  };
  const rows = a.items.map((it) => {
    const days = daysOf(it.usd);
    return `
      <div class="fs-ab-row is-${it.key}">
        <div class="fs-ab-top">
          <span class="fs-ab-name">${icon('shirt', 'fs-ab-ico')}${it.label}</span>
          <span class="fs-ab-price">$${it.usd.toFixed(2)}</span>
        </div>
        <div class="fs-ab-coins">${coins(days)}</div>
        <div class="fs-ab-days"><strong>${days.toFixed(1)}</strong> days’ income</div>
      </div>`;
  }).join('');
  $('#fs-afford-bars').innerHTML = `
    <div class="fs-ab-head">Cost of one clothing item, in days of household income</div>
    ${rows}
    <div class="fs-ab-legend"><span class="fs-coin is-key">${coinSVG()}</span> one coin = one day’s income ($${a.dailyIncomeUSD.toFixed(2)})</div>`;

  const iso = { 'Uganda': 'ug', 'United Republic of Tanzania': 'tz' };
  $('#fs-container').innerHTML = a.containerCosts.map((c) => donutCard(c, iso[c.country])).join('');
}

function donutCard(c, iso2) {
  const R = 40, CIRC = 2 * Math.PI * R;
  const off = CIRC * (1 - c.dutyPct / 100);
  return `
    <div class="fs-cont-card">
      <div class="fs-cont-info">
        <div class="fs-cont-country"><span class="fi fi-${iso2}"></span>${c.country}</div>
        <div class="fs-cont-cost">$<span class="fs-count" data-to="${c.usd}">0</span></div>
      </div>
      <div class="fs-donut">
        <svg viewBox="0 0 96 96" width="96" height="96">
          <circle class="fs-donut-ring" cx="48" cy="48" r="${R}" stroke-width="9"></circle>
          <circle class="fs-donut-val" cx="48" cy="48" r="${R}" stroke-width="9" style="--circ:${CIRC.toFixed(1)};--off:${off.toFixed(1)}"></circle>
        </svg>
        <div class="fs-donut-center">
          <div class="fs-donut-pct">${c.dutyPct}%</div>
          <div class="fs-donut-cap">duty/levy</div>
        </div>
      </div>
    </div>`;
}

// ── 08 Sector ────────────────────────────────────────────────────────────────
function buildSector() {
  const g = SECTOR.global, u = SECTOR.us;
  const metric = (ic, num, label, mini = '') => `
    <div class="fs-metric">
      <span class="fs-metric-ico">${icon(ic)}</span>
      <span class="fs-metric-num">${num}</span>
      <span class="fs-metric-label">${label}${mini ? `<span class="fs-metric-mini">${mini}</span>` : ''}</span>
    </div>`;
  $('#fs-sector-global').innerHTML = `
    <div class="fs-sector-title">Global textile &amp; apparel sector</div>
    ${metric('globe', `$<span class="fs-count" data-to="${g.marketUSDTrillion}" data-decimals="1">0</span>T`, 'estimated market size')}
    ${metric('people', `<span class="fs-count" data-to="${g.employedMillion}">0</span>M`, 'people employed worldwide')}
    ${metric('factory', `+${g.fiber.growthPct}%`, `projected fibre-production growth over ${g.fiber.years} years`, `${g.fiber.from.mt}M&nbsp;MT (${g.fiber.from.year}) → ${g.fiber.to.mt}M&nbsp;MT (${g.fiber.to.year})`)}
    ${metric('check', `<span class="fs-count" data-to="${g.qualityGainPct}">0</span>%`, g.qualityGainNote)}`;
  $('#fs-sector-us').classList.add('is-us');
  $('#fs-sector-us').innerHTML = `
    <div class="fs-sector-title">United States textile &amp; apparel sector</div>
    ${metric('shirt', `<span class="fs-count" data-to="${u.garmentsPerPersonNow}">0</span>`, `garments per person a year (${u.consumptionYear})`, `in the 1960s, each person averaged ${u.garmentsPerPerson1960s} a year`)}
    ${metric('ship', `+${u.imports.growthPct}%`, 'growth in apparel imports over 23 years', `${u.imports.from.bn}bn (${u.imports.from.year}) → ${u.imports.to.bn}bn sq.m (${u.imports.to.year})`)}
    ${metric('trash', `<span class="fs-count" data-to="${u.textileWasteMT}">0</span>M`, 'metric tonnes of textile waste a year')}`;

  const fateIcon = { landfill: 'trash', incinerated: 'flame', recovered: 'recycle' };
  $('#fs-waste').innerHTML = `
    <div class="fs-waste-head">
      <span class="fs-waste-num"><span class="fs-count" data-to="${u.textileWasteMT}">0</span>M</span>
      <span class="fs-waste-title">metric tonnes of US textile waste a year, by where it ends up</span>
    </div>
    <div class="fs-waste-bars">
      ${u.wasteFate.map((f) => `
        <div class="fs-wfate is-${f.key}">
          <div class="fs-wfate-top">
            <span class="fs-wfate-ico">${icon(fateIcon[f.key] || 'trash')}</span>
            <span class="fs-wfate-pct"><span class="fs-count" data-to="${f.pct}" data-decimals="${Number.isInteger(f.pct) ? 0 : 1}">0</span>%</span>
            <span class="fs-wfate-label">${f.label}</span>
          </div>
          <div class="fs-wfate-track"><div class="fs-wfate-fill" style="--pct:${f.pct}%"></div></div>
        </div>`).join('')}
    </div>`;
}

// ── 09 Policy ────────────────────────────────────────────────────────────────
function buildPolicy() {
  $('#fs-policy').innerHTML = POLICY.groups.map((grp) => `
    <div class="fs-policy-group">
      <div class="fs-policy-heading">${grp.heading}</div>
      ${grp.items.map((it) => `
        <div class="fs-policy-row">
          <div class="fs-policy-tag">${it.tag}</div>
          <p class="fs-policy-text">${it.text}</p>
        </div>`).join('')}
    </div>`).join('');
}

// ── 10 Outro ─────────────────────────────────────────────────────────────────
function buildOutro() {
  $('#fs-outro-meta').innerHTML = `
    <div class="fs-meta-block"><strong>Citation</strong><p>${META.citation}</p></div>
    <div class="fs-meta-block"><strong>Data sources</strong><p>${META.dataSources}</p></div>
    <div class="fs-meta-block"><strong>Fieldwork</strong><p>${META.fieldwork}</p></div>`;
  const partners = $('#fs-outro-partners');
  partners.appendChild(el(`<div class="fs-partner is-smep"><img src="assets/smep-logo.png" alt="SMEP"></div>`));
  META.partners.forEach((p) => partners.appendChild(el(`<div class="fs-partner">${p}</div>`)));
}

// ═══════════════════════════════════════════════════════════════════════════
// BEHAVIOURS
// ═══════════════════════════════════════════════════════════════════════════
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function animateCount(node) {
  const to = parseFloat(node.dataset.to);
  const decimals = parseInt(node.dataset.decimals || '0', 10);
  if (reduceMotion) { node.textContent = fmt(to, decimals); return; }
  const dur = 1500;
  const start = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  function step(now) {
    const p = Math.min(1, (now - start) / dur);
    node.textContent = fmt(to * ease(p), decimals);
    if (p < 1) requestAnimationFrame(step);
    else node.textContent = fmt(to, decimals);
  }
  requestAnimationFrame(step);
}

function setupObservers() {
  // Reveal blocks (one-shot)
  const revealObs = new IntersectionObserver((entries, obs) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add('is-visible');
      obs.unobserve(e.target);
      // stagger-fill the waffle when its block reveals
      if (e.target.querySelector?.('#fs-waffle') || e.target.id === 'fs-waffle') {
        e.target.querySelectorAll('.fs-waffle-cell').forEach((c) => c.classList.add('is-on'));
      }
    });
  }, { threshold: 0.18, rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('.fs-reveal').forEach((n) => revealObs.observe(n));

  // Waffle block may not be a .fs-reveal itself — observe it directly too
  const waffleBlock = document.querySelector('.fs-waffle-block');
  if (waffleBlock) {
    const wObs = new IntersectionObserver((entries, obs) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.querySelectorAll('.fs-waffle-cell').forEach((c) => c.classList.add('is-on'));
        obs.unobserve(e.target);
      });
    }, { threshold: 0.25 });
    wObs.observe(waffleBlock);
  }

  // Fact 03 scrollytelling — the centred step card drives the map's stage
  const steps = [...document.querySelectorAll('#fs-supply-steps .fs-step-card')];
  if (steps.length) {
    const dots = [...document.querySelectorAll('#fs-scrolly-progress span')];
    const setActive = (stepEl) => {
      const stage = +stepEl.dataset.stage;
      steps.forEach((st) => st.classList.toggle('is-active', st === stepEl));
      dots.forEach((d, i) => d.classList.toggle('is-on', i <= stage));
      supplyMapPromise?.then((m) => m.setStage(stage));
    };
    const stepObs = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) setActive(e.target); });
    }, { rootMargin: '-45% 0px -45% 0px', threshold: 0 });
    steps.forEach((st) => stepObs.observe(st));
    setActive(steps[0]); // prime stage 0
  }

  // Count-ups (one-shot)
  const countObs = new IntersectionObserver((entries, obs) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      animateCount(e.target);
      obs.unobserve(e.target);
    });
  }, { threshold: 0.6 });
  document.querySelectorAll('.fs-count').forEach((n) => countObs.observe(n));
}

// ── Navigation rail + active section ─────────────────────────────────────────
function setupRail() {
  const rail = $('#fs-rail');
  const sections = [...document.querySelectorAll('[data-nav]')];
  const dots = sections.map((sec) => {
    const dot = el(`<button class="fs-rail-dot" data-label="${sec.dataset.nav}" aria-label="${sec.dataset.nav}"></button>`);
    dot.addEventListener('click', () => sec.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' }));
    rail.appendChild(dot);
    return dot;
  });
  const activeObs = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const idx = sections.indexOf(e.target);
      dots.forEach((d, i) => d.classList.toggle('is-active', i === idx));
    });
  }, { threshold: 0.5, rootMargin: '-20% 0px -40% 0px' });
  sections.forEach((s) => activeObs.observe(s));
}

// ── Scroll progress + sticky topbar ──────────────────────────────────────────
function setupScrollChrome() {
  const fill = $('#fs-progress-fill');
  const topbar = $('#fs-topbar');
  const heroPattern = $('#fs-hero-pattern');
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? (y / max) * 100 : 0;
      fill.style.width = `${p}%`;
      topbar.classList.toggle('is-stuck', y > 16);
      if (heroPattern && !reduceMotion && y < window.innerHeight * 1.2) {
        heroPattern.style.transform = `translateY(${y * 0.3}px)`;
      }
      ticking = false;
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

// ═══════════════════════════════════════════════════════════════════════════
function init() {
  render();
  setupObservers();
  setupRail();
  setupScrollChrome();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
