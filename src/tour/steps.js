// ─────────────────────────────────────────────────────────────────────────────
// Guided Story — chapter definitions.
//
// Each chapter drives the *real* app through its onEnter/onExit hooks (using the
// same App / DataLoader / TradeMap APIs the UI uses) and explains what just
// happened in the narration card. The story follows the global second-hand
// clothing (SHC) trade so every feature appears in a meaningful context.
//
// Shape: { id, title, body, target, placement, onEnter?, onExit?, advance?, dwell? }
//   target   : CSS selector or (ctx) => selector  (resolved AFTER onEnter runs)
//   placement: 'auto' | 'top' | 'bottom' | 'left' | 'right' | 'center'
//   body/title may be strings or (ctx) => string
// ─────────────────────────────────────────────────────────────────────────────

const name = (ctx, iso) => (iso && (ctx.STATE.countryNames[iso] || iso)) || '—';

// Restore all four flow filters (used by several onExit hooks)
function allFlows(ctx) {
    ctx.STATE.flowFilters = new Set(['north-south', 'south-north', 'south-south', 'north-north']);
    document.querySelectorAll('.flow-checkbox').forEach(cb => { cb.checked = true; });
    ctx.app.updateDashboard(false);
}

async function setMetric(ctx, metric) {
    if (ctx.STATE.metric === metric) return;
    await ctx.DataLoader.switchMetric(metric);
    ctx.app._setActiveMetricButtons(metric);
    ctx.app.updateThresholdLabels(metric);
    ctx.app._globalRankCache = {};
    ctx.TradeMap._lastLegendKey = null;
    ctx.app.updateDashboard(false);
}

export const TOUR_STEPS = [
    // 01 ─ Welcome ───────────────────────────────────────────────────────────
    {
        id: 'welcome',
        title: 'The global second-hand clothing trade',
        body: `This map visualises the worldwide flow of <b>second-hand clothing&nbsp;(SHC)</b>.
               <br><br>We'll walk through its filters and analytics in <b>10 short chapters</b>,
               driving the map live as we go. Press <b>Play</b> to advance hands-free, or use the
               <b>&larr;&nbsp;&rarr;</b> keys to move at your own pace.`,
        placement: 'center',
        async onEnter(ctx) { await ctx.resetView(); },
        dwell: 7000,
    },

    // 02 ─ Reading the map ────────────────────────────────────────────────────
    {
        id: 'legend',
        title: 'Reading the map',
        body: `<b>Arc</b> colour encodes the direction of trade —
               <span style="color:#009EDB">■</span> North→South,
               <span style="color:#72BF44">■</span> South→North,
               <span style="color:#FBAF17">■</span> South→South,
               <span style="color:#AEA29A">■</span> North→North.
               <br><br><b>Circles (nodes)</b> are countries:
               <span style="color:#009EDB">blue</span> = net exporter,
               <span style="color:#ED1847">red</span> = net importer. The larger the circle, the larger the trade.`,
        target: '#legend-content',
        placement: 'auto',
        dock: 'br',
        dwell: 8000,
    },

    // 03 ─ Who leads ───────────────────────────────────────────────────────────
    {
        id: 'kpi',
        title: 'Who leads the trade',
        body: `The bar below summarises the current view: the <b>#1&nbsp;Exporter / #1&nbsp;Importer</b>
               (largest net traders), the number of <b>Corridors</b> on screen, and the total <b>Volume</b>.
               It refreshes instantly whenever you change the year or any filter.`,
        target: '#kpi-bar',
        placement: 'top',
        dock: 'tr',
        dwell: 8000,
    },

    // 04 ─ North–South story ───────────────────────────────────────────────────
    {
        id: 'flows',
        title: 'The North–South story',
        body: `Most used clothing flows from <b>developed (North) to developing (South)</b> economies.
               We've isolated <span class="tour-chip">N→S</span> flows only. Toggle these boxes to extract
               any single direction of trade.`,
        target: '#flow-filter-group',
        placement: 'bottom',
        dock: 'br',
        onEnter(ctx) {
            ctx.STATE.flowFilters = new Set(['north-south']);
            document.querySelectorAll('.flow-checkbox').forEach(cb => { cb.checked = (cb.value === 'north-south'); });
            ctx.app.updateDashboard(false);
        },
        onExit(ctx) { allFlows(ctx); },
        dwell: 8000,
    },

    // 05 ─ Value vs Weight (new feature) ───────────────────────────────────────
    {
        id: 'metric',
        title: 'Value or weight?',
        body: `Switch between <b>Value (USD)</b> and <b>Weight (tonnes)</b>. We've switched to weight —
               units become <span class="tour-chip">Mt / kt</span>, revealing the heavy textile streams that
               are cheap by value but huge by mass. The threshold buttons relabel to match automatically.`,
        target: '#metric-group',
        placement: 'bottom',
        dock: 'br',
        async onEnter(ctx) { await setMetric(ctx, 'weight'); },
        async onExit(ctx) { await setMetric(ctx, 'value'); },
        dwell: 9000,
    },

    // 06 ─ Country deep-dive ───────────────────────────────────────────────────
    {
        id: 'deepdive',
        title: (ctx) => `Country deep-dive — ${name(ctx, ctx.deepIso)}`,
        body: (ctx) => `Click any country to open its detail panel. We've focused on
               <b>${name(ctx, ctx.deepIso)}</b>, a major East African importer of used clothing —
               the map now shows only its inbound corridors.
               <br><br>The panel reports its net trade balance, the year-by-year trend, and
               <b>partner concentration (HHI)</b>. The buttons on each partner row open that
               relationship's history or compare two countries side by side.`,
        target: '#insight-panel',
        placement: 'left',
        dock: 'bl',
        async onEnter(ctx) {
            const iso = ctx.pickImporter();
            ctx.deepIso = iso;
            if (iso) {
                ctx.app.importerSelector?.setCountries([iso]);
                ctx.app.updateDashboard();
                await ctx.wait(250);
                ctx.app.openInsightPanel(iso);
                ctx.TradeMap.zoomToCountry?.(iso, 3, 1100);
                await ctx.wait(350);
            }
        },
        onExit(ctx) {
            ctx.app.closeInsightPanel();
            ctx.app.importerSelector?.setCountries([]);
            ctx.app.updateDashboard();
            ctx.TradeMap.zoomToRegion('Global');
        },
        dwell: 9500,
    },

    // 07 ─ Bilateral relationship ──────────────────────────────────────────────
    {
        id: 'bilateral',
        title: 'Draw a bilateral link',
        body: (ctx) => {
            const f = ctx.pairFlow;
            const pair = f ? `<b>${name(ctx, f.exporter)} → ${name(ctx, f.importer)}</b>` : 'a corridor';
            return `<b>Connect</b> mode lets you link two countries on the map and isolate just that
               relationship. Here we've drawn the largest corridor, ${pair}.
               <br><br>The panel below shows the <b>two-way annual flows</b>. You can also click an arc
               directly to open its full bilateral history.`;
        },
        target: '#linefilter-btn',
        placement: 'bottom',
        dock: 'bl',
        async onEnter(ctx) {
            const f = ctx.topFlow();
            ctx.pairFlow = f;
            if (f) { ctx.app.addBilateralPair(f.exporter, f.importer); await ctx.wait(450); }
        },
        onExit(ctx) { ctx.app.clearBilateralFilter(); },
        dwell: 9000,
    },

    // 08 ─ Regional focus ──────────────────────────────────────────────────────
    {
        id: 'region',
        title: 'Focus by region',
        body: `The region buttons reframe the whole view. We've zoomed into <b>Africa</b> — only
               intra-regional SHC trade is shown. Combine this with the <b>Exporter / Importer</b>
               pickers to analyse any custom set of countries.`,
        target: '#region-group',
        placement: 'bottom',
        dock: 'br',
        onEnter(ctx) {
            ctx.STATE.region = 'Africa';
            const b = document.querySelector('.region-btn[data-region="Africa"]');
            if (b) ctx.app.updateUIClasses('.region-btn', b);
            ctx.app.exporterSelector?.setCountries([]);
            ctx.app.importerSelector?.setCountries([]);
            ctx.app.updateDashboard();
        },
        onExit(ctx) {
            ctx.STATE.region = 'Global';
            const b = document.querySelector('.region-btn[data-region="Global"]');
            if (b) ctx.app.updateUIClasses('.region-btn', b);
            ctx.app.updateDashboard();
        },
        dwell: 8500,
    },

    // 09 ─ Time travel (animation) ─────────────────────────────────────────────
    {
        id: 'animate',
        title: 'Travel through time',
        body: `<b>Animate</b> auto-plays 2015→2024 as a <b>bar-chart race</b>. Watch the rankings shuffle
               and volumes grow as motion rather than numbers.
               <br><br>It's playing now — moving to the next chapter will stop it automatically.`,
        placement: 'center',
        dim: false,            // keep the bar-chart race fully visible
        cardAnchor: 'bottom',
        async onEnter(ctx) { try { await ctx.startAnimation(); } catch { /* ignore */ } },
        onExit(ctx) { try { ctx.stopAnimation(); } catch { /* ignore */ } },
        dwell: 11000,
    },

    // 10 ─ Your turn ───────────────────────────────────────────────────────────
    {
        id: 'finish',
        title: "Now it's your turn",
        body: `That completes the tour.
               <br><br>Mix year, region, <b>value / weight</b>, flow direction and thresholds freely,
               and click any country to dig deeper. You can replay this walkthrough anytime from the
               <b>Tour</b> button in the header.`,
        placement: 'center',
        advance: 'manual',
        async onEnter(ctx) { await ctx.resetView(); },
    },
];
