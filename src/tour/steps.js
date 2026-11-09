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
//   onEnter(ctx, alive): alive() turns false once the user has ended the tour
//              (or moved on). An async onEnter must check it after every await
//              and stop, so it never acts on the view the tour handed back.
//
// When the tour ends (Finish, × or Esc) the dashboard is returned to the view the
// user had when the tour started (Tour._handBack), so chapters may change any
// setting freely.
// ─────────────────────────────────────────────────────────────────────────────

const name = (ctx, iso) => (iso && (ctx.STATE.countryNames[iso] || iso)) || '—';
const always = () => true;

// First of the selectors whose element is on screen. The filter bar is hidden
// on phones, where the same controls sit behind the Filters button.
const visible = (...selectors) => () =>
    selectors.find(sel => document.querySelector(sel)?.getClientRects().length) || null;

// Restore all four flow filters (used by several onExit hooks)
function allFlows(ctx) {
    ctx.STATE.flowFilters = new Set(['north-south', 'south-north', 'south-south', 'north-north']);
    document.querySelectorAll('.flow-checkbox').forEach(cb => { cb.checked = true; });
    ctx.app.updateDashboard(false);
}

async function setMetric(ctx, metric, alive = always) {
    if (ctx.STATE.metric === metric) return;
    await ctx.DataLoader.switchMetric(metric);
    // Ended meanwhile, or superseded by a later switch (e.g. the hand-back):
    // the switch did not commit, so the controls must not claim it did.
    if (!alive() || ctx.STATE.metric !== metric) return;
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
        body: `This map shows the worldwide flow of second-hand clothing&nbsp;(SHC).
               <br><br>We'll walk through its filters and analytics in 10 short chapters,
               driving the map live as we go. Click <b>Next</b> (or press the &rarr; key)
               to advance at your own pace.`,
        placement: 'center',
        async onEnter(ctx, alive) { await ctx.resetView(alive); },
    },

    // 02 ─ Reading the map ────────────────────────────────────────────────────
    {
        id: 'legend',
        title: 'Reading the map',
        body: `Line colour shows the direction of trade:
               <i class="tour-key" style="background:#009EDB"></i>North→South,
               <i class="tour-key" style="background:#72BF44"></i>South→North,
               <i class="tour-key" style="background:#FBAF17"></i>South→South and
               <i class="tour-key" style="background:#A066AA"></i>North→North.
               <br><br>Circles are economies: <i class="tour-key tour-key--node" style="background:#009EDB"></i>blue circles are net exporters and
               <i class="tour-key tour-key--node" style="background:#ED1847"></i>red circles net importers. The larger the circle, the more of its trade is drawn on the map.
               <br><br>The <b>Legend</b> card keeps this key on the map; click its title to fold it away.`,
        target: '#legend-panel',
        placement: 'auto',
        dock: 'br',
        dwell: 8000,
    },

    // 03 ─ Who leads ───────────────────────────────────────────────────────────
    {
        id: 'kpi',
        title: 'Who leads the trade',
        body: `The key figures summarize the current view: the <b>top net exporter / importer</b>,
               the number of <b>Lines</b> on the map, and the <b>On map</b> total of those lines with its share
               of all flows in the view. They refresh instantly whenever you change the year or any filter.`,
        target: visible('#kpi-bar'),
        placement: 'top',
        dock: 'br',
        dwell: 8000,
    },

    // 04 ─ North–South story ───────────────────────────────────────────────────
    {
        id: 'flows',
        title: 'The North–South story',
        body: `The largest share of second-hand clothing trade runs from developed (North) to developing (South) economies.
               Here only <i class="tour-key" style="background:#009EDB"></i>N→S flows are shown. Tick or untick these boxes to show or
               hide any direction of trade; their colours are the line colours on the map.`,
        target: visible('#flow-filter-group', '#mobile-filter-btn'),
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
        body: `Switch between <b>Value (USD)</b> and <b>Weight (tonnes)</b>. We have switched to weight:
               figures are now in Mt / kt, which brings out flows that are cheap
               by value but large by mass. The minimum-flow options under <b>Lines</b> relabel to match automatically.`,
        target: visible('#metric-group', '#mobile-filter-btn'),
        placement: 'bottom',
        dock: 'br',
        async onEnter(ctx, alive) { await setMetric(ctx, 'weight', alive); },
        async onExit(ctx) { await setMetric(ctx, 'value'); },
        dwell: 9000,
    },

    // 06 ─ Country deep-dive ───────────────────────────────────────────────────
    {
        id: 'deepdive',
        title: (ctx) => `Country deep-dive — ${name(ctx, ctx.deepIso)}`,
        body: (ctx) => `Click any country to open its detail panel. We've focused on
               ${name(ctx, ctx.deepIso)}, a major East African importer of second-hand clothing —
               the map now shows only its inbound corridors.
               <br><br>The panel reports its net trade balance, the year-by-year trend, and
               partner concentration (HHI). The buttons on each partner row open that
               relationship's history or compare two countries side by side.`,
        target: '#insight-panel',
        placement: 'left',
        dock: 'bl',
        async onEnter(ctx, alive = () => true) {
            const iso = ctx.pickImporter();
            ctx.deepIso = iso;
            if (iso) {
                ctx.app.importerSelector?.setCountries([iso]);
                ctx.app.updateDashboard();
                await ctx.wait(250);
                if (!alive()) return;
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
            const pair = f ? `${name(ctx, f.exporter)} → ${name(ctx, f.importer)}` : 'a corridor';
            return `The <b>Connect</b> tab lets you link two countries on the map and isolate just that
               relationship. Here we've drawn the largest corridor, ${pair}.
               <br><br>The panel shows the two-way annual flows. You can also click an arc
               directly to open its full bilateral history. <b>Explore</b> brings the full map back.`;
        },
        target: visible('#linefilter-btn', '#m-connect-btn'),
        placement: 'bottom',
        dock: 'bl',
        async onEnter(ctx) {
            const f = ctx.topFlow();
            ctx.pairFlow = f;
            if (f) { ctx.app.addBilateralPair(f.exporter, f.importer); await ctx.wait(450); }
        },
        onExit(ctx) { ctx.app.clearBilateralFilter(); ctx.app.setMode?.('explore'); },
        dwell: 9000,
    },

    // 08 ─ Regional focus ──────────────────────────────────────────────────────
    {
        id: 'region',
        title: 'Focus by region',
        body: `The <b>Region</b> menu reframes the whole view. We have zoomed into Africa: only
               trade between African economies is shown. These flows are small, so only the few above the
               automatic $1M minimum are drawn; choose a lower minimum under <b>Lines</b> to see more.
               Combine this with the <b>From / To</b> country pickers to analyse any set of countries.`,
        target: visible('#region-group', '#mobile-filter-btn'),
        placement: 'bottom',
        dock: 'br',
        onEnter(ctx) {
            ctx.STATE.region = 'Africa';
            ctx.app.syncControlsFromState();
            ctx.app.exporterSelector?.setCountries([]);
            ctx.app.importerSelector?.setCountries([]);
            ctx.app.updateDashboard();
        },
        onExit(ctx) {
            ctx.STATE.region = 'Global';
            ctx.app.syncControlsFromState();
            ctx.app.updateDashboard();
        },
        dwell: 8500,
    },

    // 09 ─ Time travel (animation) ─────────────────────────────────────────────
    {
        id: 'animate',
        title: 'Travel through time',
        body: `The <b>Animate</b> tab plays 2015→2024 as a bar-chart race, so you can watch the rankings
               change and the trade grow year by year.
               <br><br>It is playing now; moving to the next chapter stops it.`,
        placement: 'center',
        dim: false,            // keep the bar-chart race fully visible
        cardAnchor: 'bottom',
        async onEnter(ctx, alive = () => true) {
            if (!alive()) return;
            // A tour that ends during the year preload stops the animation,
            // which cancels this start (see animationMode.startAnimation).
            try { await ctx.startAnimation(); } catch { /* ignore */ }
        },
        // Awaited, so the next chapter starts from the restored dashboard.
        async onExit(ctx) { try { await ctx.stopAnimation(); } catch { /* ignore */ } },
        dwell: 11000,
    },

    // 10 ─ Your turn ───────────────────────────────────────────────────────────
    {
        id: 'finish',
        title: "Now it's your turn",
        body: `That completes the tour. Closing it returns the map to the view you had before it started.
               <br><br>Mix year, region, value / weight, flow direction and the <b>Lines</b> settings freely,
               and click any country to dig deeper. You can replay this walkthrough anytime from the
               <b>Guided tour</b> button (?) at the top right.`,
        placement: 'center',
        advance: 'manual',
        async onEnter(ctx, alive) { await ctx.resetView(alive); },
    },
];
