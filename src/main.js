import './styles/styles.less';
import * as d3 from 'd3';
import { CONFIG, STATE, METRIC_FORMAT, fmtSigned, isCompact } from './config.js';
import { startAnimation, stopAnimation, stopAnimationForMetricChange } from './sns/animationMode.js';
import { RegionConfig } from './regions.js';
import { CountrySelector } from './countrySelector.js';
import { DataLoader } from './dataLoader.js';
import { TradeMap } from './map.js';
import { Tour } from './tour/tour.js';
import { CsvExport } from './csvExport.js';
import { DeepLink } from './deepLink.js';

// "+5.2%" / "−3.7%" with a true minus sign (U+2212), like every net figure.
const signedPct = (v, dp) => `${v >= 0 ? '+' : '\u2212'}${Math.abs(v).toFixed(dp)}%`;
// 1 → 1st, 2 → 2nd, 11 → 11th, 23 → 23rd
const ordinal = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

const App = {
    exporterSelector: null,
    importerSelector: null,
    _lastRenderedRegion: null,
    _globalRankCache: {},
    _resizeTimer: null,
    _prevSelectionCount: 0,
    _yearReq: 0,      // latest year request; older ones may not apply
    _metricReq: 0,    // latest metric request
    // Connections drawn in Connect mode, kept aside while the user is back in
    // Explore so returning to Connect shows them again.
    _stashedPairs: [],

    // Keep the loading overlay up, but say that loading failed instead of spinning forever.
    _showLoadError(message) {
        const loader = document.getElementById('loader');
        if (!loader) return;
        loader.classList.remove('hidden');
        loader.classList.add('load-error');
        const p = loader.querySelector('p');
        if (p) p.textContent = message;
        const spinner = loader.querySelector('.loader-spinner, .spinner');
        if (spinner) spinner.style.display = 'none';
    },

    async init() {
        STATE.selectedExporters = new Set();
        STATE.selectedImporters = new Set();
        if (!STATE.flowFilters) STATE.flowFilters = new Set(['north-south', 'south-north', 'south-south', 'north-north']);

        STATE.region = "Global";

        // Deep link: restore a shared/reloaded view before any data is fetched,
        // so DataLoader.loadAll() reads the right metric and year straight away.
        this._deepLink = DeepLink.read();
        DeepLink.applyPreLoad(this._deepLink);

        const success = await DataLoader.loadAll();
        if (!success) {
            this._showLoadError('The trade data could not be loaded. Please reload the page.');
            return;
        }

        console.log('Initializing country selectors...');
        this.exporterSelector = new CountrySelector('exp', 'exp-label', 'exporter');
        this.importerSelector = new CountrySelector('imp', 'imp-label', 'importer');

        try {
            await this.exporterSelector.init();
            await this.importerSelector.init();
            console.log('Country selectors initialized successfully');
            // Country selection has to be restored into the selectors, not into
            // STATE — updateDashboard() rebuilds STATE.selected* from them.
            DeepLink.applyPostLoad(this._deepLink, this);
        } catch (error) {
            console.error('Failed to initialize country selectors:', error);
            this._showLoadError('The country lists could not be loaded. Please reload the page.');
            return;
        }

        TradeMap.init();
        this.setupEventListeners();

        // Phones and portrait tablets: start with the legend folded (the map and
        // key figures come first; the legend card would cover part of the world)
        if (isCompact() || window.matchMedia?.('(orientation: portrait) and (max-width: 1023px)').matches) this.setLegendCollapsed(true);

        this.exporterSelector.updateSelection();
        this.updateDashboard();
        document.getElementById('loader').classList.add('hidden');

        // Guided Story tour: wires the header button + first-visit auto-launch
        this.tour = Tour;
        // A shared deep link must survive first contact: the tour's opening reset
        // would wipe the linked-to view before the recipient ever sees it.
        Tour.init(this, { autoLaunch: !DeepLink.isLink(this._deepLink) });
    },

    setupEventListeners() {
        // Region: a select in the filter bar, buttons in the phone sheet
        document.querySelectorAll('.region-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.setRegion(e.currentTarget.dataset.region));
        });
        document.getElementById('region-select')?.addEventListener('change', (e) => this.setRegion(e.target.value));

        // View modes: Explore / Connect / Animate (header tabs and phone bottom bar)
        document.querySelectorAll('.js-mode').forEach(btn => {
            btn.addEventListener('click', (e) => this.setMode(e.currentTarget.dataset.mode));
        });

        // "Lines" pop-over (minimum flow size + number of lines)
        const displayBtn = document.getElementById('display-btn');
        const displayMenu = document.getElementById('display-menu');
        if (displayBtn && displayMenu) {
            displayBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._setDisplayMenu(displayMenu.classList.contains('hidden'));
            });
            document.addEventListener('click', (e) => {
                if (!displayMenu.classList.contains('hidden') &&
                    !displayMenu.contains(e.target) && !displayBtn.contains(e.target)) this._setDisplayMenu(false);
            });
        }

        // Reset filters (filter bar + phone sheet)
        ['filters-reset', 'm-filters-reset'].forEach(id => {
            document.getElementById(id)?.addEventListener('click', () => this.resetFilters());
        });

        // Legend card fold / unfold
        document.getElementById('legend-toggle')?.addEventListener('click', () => {
            const panel = document.getElementById('legend-panel');
            this.setLegendCollapsed(!panel.classList.contains('collapsed'));
        });

        // Zoom buttons
        document.getElementById('zoom-in-btn')?.addEventListener('click', () => TradeMap.zoomBy?.(1.6));
        document.getElementById('zoom-out-btn')?.addEventListener('click', () => TradeMap.zoomBy?.(1 / 1.6));

        // Year. Only the latest choice may apply: a slow file for an earlier choice
        // must not overwrite the year the user picked last. The exporter/importer
        // selection is kept — the same economies are meaningful in every year.
        const yearSelect = document.getElementById('year-select');
        if (yearSelect) {
            yearSelect.addEventListener('change', async (e) => {
                const year = +e.target.value;
                const req = ++this._yearReq;
                const loader = document.getElementById('loader');
                loader.classList.remove('hidden');
                try {
                    await DataLoader.loadYear(year);
                    if (req !== this._yearReq) return;
                    // The metric may have switched while the file was loading: make
                    // sure the year is there for the metric now shown.
                    while (!STATE.yearCache[year]) {
                        await DataLoader.loadYear(year, STATE.metric);
                        if (req !== this._yearReq) return;
                    }
                    STATE.year = year;
                    this.syncControlsFromState();
                    this.updateDashboard();
                } catch (err) {
                    console.error('Failed to load year data:', err);
                    if (req === this._yearReq) this.syncControlsFromState();   // put the selects back on the shown year
                } finally {
                    if (req === this._yearReq) loader.classList.add('hidden');
                }
            });
        }

        // Threshold toggle
        document.querySelectorAll('.threshold-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const val = e.currentTarget.dataset.threshold;
                STATE.thresholdMode = val === 'auto' ? 'auto' : +val;
                this.syncControlsFromState();
                // 50ms debounce: prevents overlapping D3 transitions when buttons are clicked rapidly
                clearTimeout(this._filterDebounce);
                this._filterDebounce = setTimeout(() => this.updateDashboard(false), 50);
            });
        });

        // Top-N line limit. Buttons live in both the desktop bar and the mobile
        // sheet, so activate by value across all of them rather than by clicked node.
        document.querySelectorAll('.topn-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const val = e.currentTarget.dataset.topn;
                STATE.topNMode = val === 'all' ? null : +val;
                this._setActiveTopNButtons(val);
                // 50ms debounce: prevents overlapping D3 transitions when buttons are clicked rapidly
                clearTimeout(this._filterDebounce);
                this._filterDebounce = setTimeout(() => this.updateDashboard(false), 50);
            });
        });

        // Metric toggle (trade value ⇄ trade weight). Loads the metric's pre-computed
        // JSON on demand, relabels the unit-bearing controls and re-renders.
        // Every click goes to DataLoader.switchMetric, even a click on the active
        // metric: that cancels a switch still in flight, so the last click wins.
        // Units, labels and data change together only when the switch commits.
        document.querySelectorAll('.metric-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const metric = e.currentTarget.dataset.metric;
                if (!metric) return;
                // A metric change ends the bar-chart-race run and returns to the
                // normal dashboard — a race whose units change halfway is easy to
                // misread. (The header controls are hidden in anim-mode, so this
                // only fires for a programmatic switch.)
                if (metric !== STATE.metric) stopAnimationForMetricChange();
                const req = ++this._metricReq;
                this._setActiveMetricButtons(metric);    // show the click at once
                const loader = document.getElementById('loader');
                loader?.classList.remove('hidden');
                try {
                    const switched = await DataLoader.switchMetric(metric);
                    if (switched) {
                        this._globalRankCache = {};          // ranks are metric-specific
                        TradeMap._lastLegendKey = null;      // force legend refresh
                        this.syncControlsFromState();
                        this.updateDashboard(false);
                    }
                } catch (err) {
                    console.error('Failed to switch metric:', err);
                } finally {
                    if (req === this._metricReq) {
                        // Whatever happened, the buttons end up on the metric shown.
                        this._setActiveMetricButtons(STATE.metric);
                        loader?.classList.add('hidden');
                    }
                }
            });
        });

        // Flow category checkboxes (desktop bar and mobile sheet carry one each)
        document.querySelectorAll('.flow-checkbox').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const val = e.target.value;
                if (e.target.checked) STATE.flowFilters.add(val);
                else STATE.flowFilters.delete(val);
                document.querySelectorAll(`.flow-checkbox[value="${val}"]`).forEach(o => { o.checked = e.target.checked; });
                clearTimeout(this._filterDebounce);
                this._filterDebounce = setTimeout(() => this.updateDashboard(false), 50);
            });
        });

        // Dropdown Logic (Exporter & Importer)
        this.setupHierarchicalDropdown('exp', this.exporterSelector);
        this.setupHierarchicalDropdown('imp', this.importerSelector);

        // Insight panel close button
        const panelCloseBtn = document.getElementById('panel-close-btn');
        if (panelCloseBtn) panelCloseBtn.addEventListener('click', () => this.closeInsightPanel());

        // Sea routes toggle (on/off)
        const searouteBtn = document.getElementById('searoute-btn');
        if (searouteBtn) searouteBtn.addEventListener('click', () => {
            if (TradeMap && TradeMap.toggleSeaRoute) TradeMap.toggleSeaRoute();
        });
        document.addEventListener('shc:searoute-toggled', (e) => {
            const btn = document.getElementById('searoute-btn');
            if (btn) { btn.classList.toggle('active', e.detail.active); btn.setAttribute('aria-pressed', String(!!e.detail.active)); }
        });

        // ── Connect mode (draw bilateral connections on the map) ──
        // The Connect tab itself goes through setMode (see .js-mode above).
        document.getElementById('linefilter-clear')?.addEventListener('click', () => this.clearBilateralFilter());
        document.addEventListener('shc:linefilter-toggled', (e) => this._updateLineFilterUI(e.detail));
        document.addEventListener('shc:bilateral-pair-added', (e) => this.addBilateralPair(e.detail.exporter, e.detail.importer));

        // Arc detail modal
        document.getElementById('arc-modal-close').addEventListener('click', () => this.closeArcModal());
        document.getElementById('arc-modal-backdrop').addEventListener('click', () => this.closeArcModal());

        // Compare modal
        document.getElementById('compare-modal-close').addEventListener('click', () => this.closeCompareModal());
        document.getElementById('compare-modal-backdrop').addEventListener('click', () => this.closeCompareModal());

        // Methodology modal
        document.querySelectorAll('.js-open-methodology').forEach(el => {
            el.addEventListener('click', () => this.openMethodologyModal());
        });
        document.getElementById('methodology-modal-close')?.addEventListener('click', () => this.closeMethodologyModal());
        document.getElementById('methodology-modal-backdrop')?.addEventListener('click', () => this.closeMethodologyModal());

        // Escape key cancels an in-progress connection, then closes any open modal
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape' || e.defaultPrevented) return;
            const isOpen = id => { const el = document.getElementById(id); return !!el && !el.classList.contains('hidden'); };
            if (isOpen('display-menu')) { this._setDisplayMenu(false); document.getElementById('display-btn')?.focus(); return; }
            if (isOpen('export-menu')) { this._closeMenus(); document.getElementById('export-btn')?.focus(); return; }
            for (const p of ['exp', 'imp']) {
                if (isOpen(`${p}-menu`)) { this._closePicker(p); document.getElementById(`${p}-btn`)?.focus(); return; }
            }
            if (TradeMap.lineFilterMode && TradeMap._pendingExporter) { TradeMap.cancelLineDraw(); return; }
            if (isOpen('methodology-modal')) { this.closeMethodologyModal(); return; }
            if (isOpen('compare-modal')) { this.closeCompareModal(); return; }
            if (isOpen('arc-modal')) { this.closeArcModal(); return; }
            if (document.getElementById('mobile-filter-panel')?.classList.contains('open')) { this.toggleMobileFilter(); return; }
            if (document.getElementById('insight-panel')?.classList.contains('open')) {
                if (this._connectionsPanelOpen) this.closeConnectionsPanel();
                else this.closeInsightPanel();
            }
        });

        // Empty result: reset from the map; connections: clear from the panel
        document.getElementById('map-empty-reset')?.addEventListener('click', () => this.resetFilters());
        document.getElementById('panel-clear-btn')?.addEventListener('click', () => this.clearBilateralFilter());
        document.addEventListener('shc:animation-started', () => this._applyModeUI());

        // Phone browsers resize their toolbars: keep a --vh unit in step
        const setMobileHeight = () => {
            const vh = window.innerHeight * 0.01;
            document.documentElement.style.setProperty('--vh', `${vh}px`);
        };
        setMobileHeight();

        window.addEventListener('resize', () => {
            setMobileHeight();
            // flex-wrap may have moved the picker to a different row
            ['exp', 'imp'].forEach(pfx => { this._clampPickerMenu(document.getElementById(`${pfx}-menu`)); });
            clearTimeout(this._resizeTimer);
            this._resizeTimer = setTimeout(() => {
                TradeMap.init();
                TradeMap.renderFlows();
            }, 200);
        });

        // ── Mobile Filter Panel ───────────────────────────────
        document.getElementById('mobile-filter-btn')?.addEventListener('click', () => this.toggleMobileFilter());
        document.getElementById('mobile-filter-close')?.addEventListener('click', () => this.toggleMobileFilter());
        document.getElementById('mobile-filter-done')?.addEventListener('click', () => this.toggleMobileFilter());
        document.getElementById('mobile-filter-backdrop')?.addEventListener('click', () => this.toggleMobileFilter());

        // Reset the map view (to the selected region)
        document.getElementById('fit-screen-btn')?.addEventListener('click', () => {
            TradeMap.zoomToRegion(STATE.region || 'Global');
        });

        // Mobile country backdrop closes any open country menu
        document.getElementById('mobile-country-backdrop')?.addEventListener('click', () => {
            ['exp', 'imp'].forEach(p => {
                const menu = document.getElementById(`${p}-menu`);
                const btn = document.getElementById(`${p}-btn`);
                menu.classList.add('hidden');
                menu.classList.remove('mobile-menu-fixed');
                this._resetPickerMenu(menu);
                if (menu.parentElement !== btn.parentElement) {
                    btn.parentElement.appendChild(menu);
                }
                btn.parentElement.style.zIndex = '50';
            });
            document.getElementById('mobile-country-backdrop').classList.add('hidden');
        });

        // Mobile year select syncs to desktop handler
        document.getElementById('m-year-select')?.addEventListener('change', async (e) => {
            const desktopSelect = document.getElementById('year-select');
            desktopSelect.value = e.target.value;
            desktopSelect.dispatchEvent(new Event('change'));
        });

        // Sync initial active state to mobile panel buttons
        this.syncMobileFilterState();

        // ── CSV export (flows + country summary) ──────────────
        CsvExport.init();

        // ── Animation mode (started from the Animate tab, see .js-mode) ──
        document.getElementById('anim-stop-btn')?.addEventListener('click', stopAnimation);

        document.addEventListener('shc:bilateral-loaded', (e) => {
            if (e.detail?.metric === STATE.metric) this._refreshOpenViews();
        });

        document.addEventListener('shc:animation-stopped', () => {
            // animationMode has put STATE back to the pre-animation view; make every
            // control show it and re-render (this also refreshes an open panel).
            this.syncControlsFromState();
            this.updateDashboard();
        });
    },

    setupHierarchicalDropdown(prefix, selector) {
        const btn  = document.getElementById(`${prefix}-btn`);
        const mBtn = document.getElementById(`m-${prefix}-btn`);
        const menu = document.getElementById(`${prefix}-menu`);
        const search   = document.getElementById(`${prefix}-search`);
        const clearAll = document.getElementById(`${prefix}-clear-all`);

        const originalParent = btn.parentElement;

        const closeOtherMenu = () => {
            const otherPrefix = prefix === 'exp' ? 'imp' : 'exp';
            const otherMenu = document.getElementById(`${otherPrefix}-menu`);
            const otherBtn = document.getElementById(`${otherPrefix}-btn`);
            otherMenu.classList.add('hidden');
            otherMenu.classList.remove('mobile-menu-fixed');
            this._resetPickerMenu(otherMenu);
            if (otherMenu.parentElement !== otherBtn.parentElement) {
                otherBtn.parentElement.appendChild(otherMenu);
            }
            otherBtn.parentElement.style.zIndex = '50';
            otherBtn.setAttribute('aria-expanded', 'false');
        };

        // Phones: "Done" in the picker sheet
        menu.querySelector('.picker-done')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this._closePicker(prefix);
        });

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeOtherMenu();
            
            // Desktop: the menu drops down under its button, never as the phone sheet
            menu.classList.remove('mobile-menu-fixed');
            if (menu.parentElement !== originalParent) {
                originalParent.appendChild(menu);
            }
            menu.classList.toggle('hidden');
            btn.setAttribute('aria-expanded', String(!menu.classList.contains('hidden')));
            if (!menu.classList.contains('hidden')) this._setDisplayMenu(false);

            // Re-anchor once visible so the menu never hangs off the screen edge
            if (menu.classList.contains('hidden')) this._resetPickerMenu(menu);
            else this._clampPickerMenu(menu);

            // Lift the open menu above the neighbouring controls
            originalParent.style.zIndex = menu.classList.contains('hidden') ? '50' : '60';
        });

        if (mBtn) {
            mBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                closeOtherMenu();
                
                // Phones: move the menu to <body> so the hidden filter bar does not hide it
                document.body.appendChild(menu);
                
                menu.classList.remove('hidden');
                menu.classList.add('mobile-menu-fixed');
                this._resetPickerMenu(menu);   // mobile.less positions this one
                document.getElementById('mobile-country-backdrop')?.classList.remove('hidden');
            });
        }

        document.addEventListener('click', (e) => {
            const isOutside = !menu.contains(e.target) && !btn.contains(e.target) && (!mBtn || !mBtn.contains(e.target));
            if (isOutside) {
                menu.classList.add('hidden');
                btn.setAttribute('aria-expanded', 'false');
                menu.classList.remove('mobile-menu-fixed');
                this._resetPickerMenu(menu);
                if (menu.parentElement !== originalParent) {
                    originalParent.appendChild(menu);
                }
                originalParent.style.zIndex = '50';
            }
        });

        search.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase().trim();
            if (!term) {
                // Restore default: show group rows, collapse all children
                menu.querySelectorAll('.picker-section-header, .group-option, .country-option')
                    .forEach(el => { el.style.display = ''; });
                menu.querySelectorAll('.group-children').forEach(c => {
                    c.classList.add('hidden');
                    c.style.display = '';
                });
                menu.querySelectorAll('.group-toggle').forEach(t => {
                    t.setAttribute('aria-expanded', 'false');
                });
            } else {
                // Search mode: hide group rows/headers, expand all children, filter countries
                menu.querySelectorAll('.picker-section-header, .group-option')
                    .forEach(el => { el.style.display = 'none'; });
                menu.querySelectorAll('.group-children').forEach(c => {
                    c.classList.remove('hidden');
                    c.style.display = 'block';
                });
                menu.querySelectorAll('.country-option').forEach(item => {
                    const text = item.innerText.toLowerCase();
                    item.style.display = text.includes(term) ? 'flex' : 'none';
                });
            }
        });

        clearAll.addEventListener('click', () => {
            selector.clearAll();
        });
    },

    // ── Country picker dropdown: keep it inside the viewport ──────────
    // The menu (280px) is wider than its button and the filter bar wraps on
    // narrow screens, so depending on where the row breaks the menu can hang
    // off the right edge of the screen.
    //
    // CSS cannot fix this on its own: how far the button sits from the edge
    // depends on where flex-wrap happened to break the row. So keep the CSS
    // position as the preferred one and nudge it back on screen after opening.
    PICKER_EDGE_GAP: 8,   // px kept between the menu and the viewport edge

    _clampPickerMenu(menu) {
        if (!menu || menu.classList.contains('hidden')) return;
        // The mobile sheet is a full-width fixed panel positioned by
        // mobile.less with !important — nothing to clamp.
        if (menu.classList.contains('mobile-menu-fixed')) return;

        // Always measure from the CSS default so repeated opens and resizes
        // never accumulate an offset.
        this._resetPickerMenu(menu);

        const wrapper = menu.offsetParent;          // .picker-wrapper
        if (!wrapper) return;

        const m  = menu.getBoundingClientRect();
        const w  = wrapper.getBoundingClientRect();
        const vw = document.documentElement.clientWidth;
        const gap = this.PICKER_EDGE_GAP;

        // Clamp the CSS-preferred position into the viewport. Math.max last, so
        // on a viewport narrower than the menu the left edge still wins and the
        // search box stays reachable.
        const wanted = Math.max(gap, Math.min(m.left, vw - gap - m.width));
        if (Math.abs(wanted - m.left) < 0.5) return;   // already fits

        menu.style.right = 'auto';
        menu.style.left  = `${Math.round(wanted - w.left)}px`;
    },

    // Close one country picker (desktop drop-down or phone sheet).
    _closePicker(prefix) {
        const menu = document.getElementById(`${prefix}-menu`);
        const btn = document.getElementById(`${prefix}-btn`);
        if (!menu || !btn) return;
        menu.classList.add('hidden');
        menu.classList.remove('mobile-menu-fixed');
        this._resetPickerMenu(menu);
        if (menu.parentElement !== btn.parentElement) btn.parentElement.appendChild(menu);
        btn.parentElement.style.zIndex = '50';
        btn.setAttribute('aria-expanded', 'false');
        document.getElementById('mobile-country-backdrop')?.classList.add('hidden');
    },

    // Close every drop-down (Lines, Download, pickers) before a panel or pop-up opens.
    _closeMenus() {
        this._setDisplayMenu(false);
        ['exp', 'imp'].forEach(p => { this._closePicker(p); });
        const em = document.getElementById('export-menu');
        if (em && !em.classList.contains('hidden')) {
            em.classList.add('hidden');
            document.getElementById('export-btn')?.setAttribute('aria-expanded', 'false');
        }
    },

    _resetPickerMenu(menu) {
        if (!menu) return;
        menu.style.left  = '';
        menu.style.right = '';
    },

    // Metric buttons span the desktop bar and the mobile sheet, so toggle every
    // matching button rather than a single clicked element.
    _setActiveMetricButtons(metric) {
        document.querySelectorAll('.metric-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.metric === metric);
        });
    },

    // Top-N buttons span the Lines pop-over and the phone sheet, so toggle every
    // matching button rather than a single clicked element.
    _setActiveTopNButtons(val) {
        document.querySelectorAll('.topn-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.topn === val);
        });
    },

    // Threshold buttons keep the same numeric data-threshold across metrics; only
    // their unit-bearing labels change ($ for value, t for weight).
    THRESHOLD_LABELS: {
        value:  { auto: 'Auto', '10000000': '$10M',  '1000000': '$1M',  '500000': '$500K', '100000': '$100K', '10000': '$10K' },
        weight: { auto: 'Auto', '10000000': '10 kt', '1000000': '1 kt', '500000': '500 t', '100000': '100 t', '10000': '10 t' },
    },

    updateThresholdLabels(metric = STATE.metric) {
        const map = this.THRESHOLD_LABELS[metric] || this.THRESHOLD_LABELS.value;
        document.querySelectorAll('.threshold-btn').forEach(b => {
            const lbl = map[b.dataset.threshold];
            if (lbl !== undefined) b.textContent = lbl;
        });
    },

    updateKPIBar() {
        // Scope of each figure — deliberately mixed, matching the KPI tooltips:
        //   filteredData / nodeStats → what is actually drawn, i.e. AFTER the
        //     magnitude threshold, the Top-N line limit and the flow-category
        //     filter. Volume, Corridors, Countries and the N→S / S→S shares
        //     therefore always agree with the map and the CSV export.
        //   rawNodeStats            → pre-threshold, pre-Top-N. Used only for
        //     #1 Exporter / #1 Importer so the headline ranking does not flip
        //     when the user declutters the map (same convention as the HHI and
        //     partner-rank figures elsewhere).
        const flows = STATE.filteredData || [];
        const stats = STATE.nodeStats || {};
        const rawStats = STATE.rawNodeStats || stats;
        const mf = METRIC_FORMAT[STATE.metric] || METRIC_FORMAT.value;

        const total = d3.sum(flows, d => d.netValue);
        const totalEl = document.getElementById('kpi-total');
        // Connect mode before anything is drawn: nothing to sum yet
        const nothingDrawn = TradeMap.lineFilterMode && !STATE.bilateralPairs?.length;
        if (totalEl) totalEl.textContent = nothingDrawn ? '—' : mf.fmt(total);

        const flowsEl = document.getElementById('kpi-flows');
        if (flowsEl) flowsEl.textContent = d3.format(',')(flows.length);

        const countriesEl = document.getElementById('kpi-countries');
        if (countriesEl) countriesEl.textContent = Object.keys(stats).length;

        const topExpEl = document.getElementById('kpi-top-exp');
        const topImpEl = document.getElementById('kpi-top-imp');
        if (topExpEl || topImpEl) {
            // Single O(n) pass instead of O(n log n) sort — we only need the extremes.
            let topExp = null, topImp = null;
            for (const [iso, st] of Object.entries(rawStats)) {
                if (!topExp || st.netBalance > topExp[1].netBalance) topExp = [iso, st];
                if (!topImp || st.netBalance < topImp[1].netBalance) topImp = [iso, st];
            }
            if (topExpEl) {
                if (topExp && topExp[1].netBalance > 0) {
                    const name = STATE.countryNames[topExp[0]] || topExp[0];
                    topExpEl.textContent = name.length > 16 ? name.slice(0, 15) + '…' : name;
                } else {
                    topExpEl.textContent = '—';
                }
            }
            if (topImpEl) {
                if (topImp && topImp[1].netBalance < 0) {
                    const name = STATE.countryNames[topImp[0]] || topImp[0];
                    topImpEl.textContent = name.length > 16 ? name.slice(0, 15) + '…' : name;
                } else {
                    topImpEl.textContent = '—';
                }
            }
        }

        const scopeEl = document.getElementById('kpi-scope');
        if (scopeEl) scopeEl.textContent = this._buildScopeText();

        let nsTotal = 0, ssTotal = 0;
        flows.forEach(d => {
            if (d.flowCategory === 'north-south') nsTotal += d.netValue;
            else if (d.flowCategory === 'south-south') ssTotal += d.netValue;
        });
        const nsPctEl = document.getElementById('kpi-ns-pct');
        if (nsPctEl) nsPctEl.textContent = total > 0 ? Math.round(nsTotal / total * 100) + '%' : '—';

        const ssPctEl = document.getElementById('kpi-ss-pct');
        if (ssPctEl) ssPctEl.textContent = total > 0 ? Math.round(ssTotal / total * 100) + '%' : '—';
    },

    _buildScopeText() {
        const nPairs = STATE.bilateralPairs?.length || 0;
        if (nPairs > 0 || TradeMap.lineFilterMode) {
            return nPairs > 0 ? `${nPairs} connection${nPairs > 1 ? 's' : ''}` : 'Connect';
        }
        const region = STATE.region && STATE.region !== 'Global' ? STATE.region : null;
        const nExp = STATE.selectedExporters?.size || 0;
        const nImp = STATE.selectedImporters?.size || 0;
        if (!region && nExp === 0 && nImp === 0) return 'World';
        const parts = [];
        if (region) {
            parts.push(region);
            if (nExp === 0 && nImp === 0) { parts.pop(); parts.push(`Within ${region}`); }
        }
        const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
        if (nExp > 0 && nImp > 0) parts.push(`${plural(nExp, 'exporter')} · ${plural(nImp, 'importer')}`);
        else if (nExp > 0) parts.push(plural(nExp, 'exporter'));
        else if (nImp > 0) parts.push(plural(nImp, 'importer'));
        return parts.join(' · ');
    },

    // ── P1: Insight Side Panel ──────────────────────────────────────

    openInsightPanel(iso) {
        this._closeMenus();
        if (document.getElementById('mobile-filter-panel')?.classList.contains('open')) {
            this.toggleMobileFilter();
        }
        this._renderInsightPanel(iso);

        document.getElementById('insight-panel').classList.add('open');
        document.body.classList.add('insight-open');

        // Phones: the header steps aside while the panel is open, so the map resizes
        if (isCompact()) {
            setTimeout(() => window.dispatchEvent(new Event('resize')), 10);
        }

        this._currentPanelIso = iso;
        this._connectionsPanelOpen = false; // single-country insight now owns the panel
        this.hideTooltip();

        // Reset Sea Route to OFF for each new country — the mode as well as the
        // button, or routes keep being drawn behind a button that reads OFF.
        const searouteBtn = document.getElementById('searoute-btn');
        if (searouteBtn) {
            searouteBtn.disabled = false;
            searouteBtn.classList.remove('active');
            searouteBtn.setAttribute('aria-pressed', 'false');
            searouteBtn.style.display = '';
        }
        if (TradeMap) TradeMap.searouteMode = false;

        // Country-level CSV export belongs to single-country focus
        const exportBtn = document.getElementById('panel-export-btn');
        if (exportBtn) exportBtn.style.display = '';

        if (TradeMap && TradeMap.setFocus) {
            // Ensure routes.json is loaded before switching to sea-route rendering —
            // but only focus if this country's panel is still the one open.
            const doFocus = () => { if (this._currentPanelIso === iso) TradeMap.setFocus(iso); };
            STATE._routesPromise ? STATE._routesPromise.then(doFocus) : doFocus();
        }
    },

    // Fill the open panel for `iso` from the current year / metric / region.
    // Also used to refresh an open panel when those change.
    _renderInsightPanel(iso) {
        const name = STATE.countryNames[iso] || iso;
        const stats = DataLoader.countryTotals(iso);
        const mf = METRIC_FORMAT[STATE.metric] || METRIC_FORMAT.value;
        const region = RegionConfig.getRegion(iso) || 'Unknown';
        const devStatus = CONFIG.development[iso] === 'north' ? 'Developed' : 'Developing';

        document.getElementById('panel-clear-btn')?.classList.add('hidden');
        document.getElementById('panel-country-name').textContent = name;
        document.getElementById('panel-country-meta').textContent = `${region} · ${devStatus} · ${STATE.year}`;
        document.getElementById('panel-body').innerHTML = this._buildPanelContent(iso, stats, mf);
    },

    // Flows behind the partner-based panel sections (partners, HHI, trade split,
    // fingerprint, flow composition): every net bilateral flow of `iso` for the
    // year — never the display threshold, Lines limit or flow-direction filter —
    // restricted to intra-regional partners when a region is selected, the same
    // scope as the map. A country is never its own partner.
    _panelFlows(iso) {
        const isRegional = STATE.region && STATE.region !== 'Global';
        return (STATE.yearCache[STATE.year] || []).filter(d =>
            (d.exporter === iso || d.importer === iso) && d.exporter !== d.importer &&
            (!isRegional || (RegionConfig.getRegion(d.exporter) === STATE.region &&
                             RegionConfig.getRegion(d.importer) === STATE.region)));
    },

    _panelScopeNote() {
        return STATE.region && STATE.region !== 'Global'
            ? `${STATE.region} intra-regional · all flows, before display filters`
            : 'All partners · all flows, before display filters';
    },

    closeInsightPanel() {
        document.getElementById('insight-panel').classList.remove('open');
        document.body.classList.remove('insight-open');

        const searouteBtn = document.getElementById('searoute-btn');
        if (searouteBtn) { searouteBtn.disabled = true; searouteBtn.classList.remove('active'); }

        // Phones: the header comes back, so the map resizes
        if (isCompact()) {
            setTimeout(() => window.dispatchEvent(new Event('resize')), 10);
        }

        this._currentPanelIso = null;
        this._connectionsPanelOpen = false;
        if (TradeMap && TradeMap.clearFocus) TradeMap.clearFocus();
    },

    // ── P2-A: Arc Detail Modal ──────────────────────────────────────

    async openArcModal(expIso, impIso) {
        // The history file loads in the background; wait for it rather than
        // showing an empty "$0" history.
        if (!STATE.bilateralHistory) {
            try { await DataLoader._loadBilateral(STATE.metric); } catch (e) { /* shown as no data */ }
        }
        this._arcPair = { expIso, impIso };   // consumed by the corridor CSV export button
        this._renderArcModal();

        this._closeMenus();
        const modal = document.getElementById('arc-modal');
        if (modal.classList.contains('hidden')) this._returnFocus = document.activeElement;
        modal.classList.remove('hidden');
        document.getElementById('arc-modal-close')?.focus({ preventScroll: true });
        this.hideTooltip();
    },

    // Fill the corridor pop-up for this._arcPair from the current year / metric.
    _renderArcModal() {
        const p = this._arcPair;
        if (!p) return;
        const { expIso, impIso } = p;
        const expName = STATE.countryNames[expIso] || expIso;
        const impName = STATE.countryNames[impIso] || impIso;
        const mf = METRIC_FORMAT[STATE.metric] || METRIC_FORMAT.value;

        // The net exporter is whoever ships more this year — not simply the first
        // country of the pair (a drawn connection can run against the net flow).
        const [a, b] = [expIso, impIso].sort();
        const e = STATE.bilateralHistory?.[`${a}|${b}`]?.[String(STATE.year)];
        const out = e ? (expIso === a ? e.aToB : e.bToA) : 0;
        const inn = e ? (expIso === a ? e.bToA : e.aToB) : 0;
        const netText = out > inn ? `Net exporter: ${expName}` : inn > out ? `Net exporter: ${impName}` : 'No net flow';

        document.getElementById('arc-modal-title').textContent = `${expName}  →  ${impName}`;
        document.getElementById('arc-modal-meta').textContent = `${netText} · ${STATE.year}`;
        document.getElementById('arc-modal-body').innerHTML = this._buildArcDetailContent(expIso, impIso, mf);
    },

    closeArcModal() {
        document.getElementById('arc-modal').classList.add('hidden');
        this._restoreFocus();
    },

    // Give focus back to whatever opened a pop-up
    _restoreFocus() {
        const el = this._returnFocus;
        this._returnFocus = null;
        if (el && document.contains(el) && typeof el.focus === 'function') el.focus({ preventScroll: true });
    },

    _buildArcDetailContent(expIso, impIso, mf) {
        const expName = STATE.countryNames[expIso] || expIso;
        const impName = STATE.countryNames[impIso] || impIso;
        const EXP_C = '#009EDB', IMP_C = '#ED1847';

        const yearData = {};
        for (let y = 2015; y <= 2024; y++) yearData[y] = { aToB: 0, bToA: 0 };

        // Resolve bilateral history from pre-computed JSON
        const [a, b] = [expIso, impIso].sort();
        const pairKey = `${a}|${b}`;
        const expIsA = expIso === a;
        const hist = STATE.bilateralHistory ? STATE.bilateralHistory[pairKey] : null;
        if (hist) {
            Object.entries(hist).forEach(([yStr, entry]) => {
                const y = +yStr;
                if (yearData[y]) {
                    yearData[y].aToB = expIsA ? entry.aToB : entry.bToA;
                    yearData[y].bToA = expIsA ? entry.bToA : entry.aToB;
                }
            });
        }

        const years = Object.keys(yearData).map(Number).sort();
        const nets  = years.map(y => yearData[y].aToB - yearData[y].bToA);
        const atoBs = years.map(y => yearData[y].aToB);
        const bToAs = years.map(y => yearData[y].bToA);
        const maxAbs = Math.max(...atoBs, ...bToAs, 1);

        const cy = STATE.year;
        const curAtoB = yearData[cy] ? yearData[cy].aToB : 0;
        const curBtoA = yearData[cy] ? yearData[cy].bToA : 0;
        const curNet  = curAtoB - curBtoA;
        const fc = STATE.filteredData.find(d =>
            (d.exporter === expIso && d.importer === impIso) ||
            (d.exporter === impIso && d.importer === expIso)
        );
        const flowCat = fc ? fc.flowCategory : null;
        const catLabels = { 'north-south': 'North → South', 'south-north': 'South → North', 'south-south': 'South → South', 'north-north': 'North → North' };
        const flowType = flowCat
            ? `<div class="si-flowtype">Flow type on the map: <span class="si-badge"><i class="si-key" style="background:${CONFIG.flowColors[flowCat]}"></i>${catLabels[flowCat]}</span></div>`
            : '';

        let html = `
        <div class="si-section">
            <div class="si-kpi-grid cols-3">
                <div class="si-kpi-card">
                    <div class="si-kpi-label" title="${expName} exports to ${impName}">${expName} →</div>
                    <div class="si-kpi-value">${mf.fmt(curAtoB)}</div>
                </div>
                <div class="si-kpi-card" title="${expName} → ${impName} minus ${impName} → ${expName}">
                    <div class="si-kpi-label">Net (${cy})</div>
                    <div class="si-kpi-value">${fmtSigned(curNet)}</div>
                </div>
                <div class="si-kpi-card">
                    <div class="si-kpi-label" title="${impName} exports to ${expName}">← ${impName}</div>
                    <div class="si-kpi-value">${mf.fmt(curBtoA)}</div>
                </div>
            </div>
            ${flowType}
        </div>`;

        // Mirrored columns: exports of the first economy above the axis, of the second below
        const W = 440, H = 48, half = 22, gap = 4;
        const bw = (W - gap * (years.length - 1)) / years.length;
        const bars = years.map((y, i) => {
            const aH = Math.max(0, (atoBs[i] / maxAbs) * half);
            const bH = Math.max(0, (bToAs[i] / maxAbs) * half);
            const x  = i * (bw + gap);
            const isCur = y === cy;
            return `
                <rect x="${x}" y="${H / 2 - aH}" width="${bw}" height="${aH}" fill="${EXP_C}" opacity="${isCur ? 1 : 0.4}"/>
                <rect x="${x}" y="${H / 2}" width="${bw}" height="${bH}" fill="${IMP_C}" opacity="${isCur ? 1 : 0.4}"/>
                <text x="${x + bw / 2}" y="${H + 13}" text-anchor="middle" font-size="9.5" font-weight="${isCur ? 700 : 400}" fill="${isCur ? '#231F20' : '#6E6259'}">${y}</text>`;
        }).join('');

        html += `
        <div class="si-section">
            <div class="si-label">Bilateral trade, ${years[0]}–${years[years.length - 1]}</div>
            <div class="si-chart-legend">
                <div class="si-legend-item"><div class="si-legend-swatch" style="background:${EXP_C}"></div><span>${expName} → ${impName}</span></div>
                <div class="si-legend-item"><div class="si-legend-swatch" style="background:${IMP_C}"></div><span>${impName} → ${expName}</span></div>
            </div>
            <svg class="si-chart" viewBox="0 0 ${W} ${H + 16}" role="img" aria-label="Exports in each direction, ${years[0]} to ${years[years.length - 1]}">
                ${bars}
                <line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" stroke="#231F20" stroke-width="0.7"/>
            </svg>
        </div>`;

        const tableRows = years.filter(y => atoBs[years.indexOf(y)] > 0 || bToAs[years.indexOf(y)] > 0).map(y => {
            const idx = years.indexOf(y);
            const isCur = y === cy;
            return `<tr${isCur ? ' class="row-cur"' : ''}>
                <td class="al">${y}</td>
                <td class="ar">${mf.fmt(atoBs[idx])}</td>
                <td class="ar">${mf.fmt(bToAs[idx])}</td>
                <td class="ar bold">${fmtSigned(nets[idx])}</td>
            </tr>`;
        }).join('');

        html += `
        <div class="si-section">
            <div class="si-label">Year by year</div>
            <table class="si-table">
                <thead>
                    <tr>
                        <th class="al">Year</th>
                        <th class="ar"><i class="si-key-sq" style="background:${EXP_C}"></i>${expName} →</th>
                        <th class="ar"><i class="si-key-sq" style="background:${IMP_C}"></i>← ${impName}</th>
                        <th class="ar">Net</th>
                    </tr>
                </thead>
                <tbody>${tableRows}</tbody>
            </table>
        </div>`;

        return html;
    },

    // ── P2-B: Compare Modal ─────────────────────────────────────────

    openCompareModal(isoA, isoB) {
        const nameA = STATE.countryNames[isoA] || isoA;
        const nameB = STATE.countryNames[isoB] || isoB;
        const mf = METRIC_FORMAT[STATE.metric] || METRIC_FORMAT.value;

        document.getElementById('compare-modal-title').textContent = `${nameA}  vs  ${nameB}`;
        document.getElementById('compare-modal-body').innerHTML = this._buildCompareContent(isoA, isoB, mf);
        this._comparePair = { isoA, isoB };

        this._closeMenus();
        const modal = document.getElementById('compare-modal');
        if (modal.classList.contains('hidden')) this._returnFocus = document.activeElement;
        modal.classList.remove('hidden');
        document.getElementById('compare-modal-close')?.focus({ preventScroll: true });
        this.hideTooltip();
    },

    closeCompareModal() {
        document.getElementById('compare-modal').classList.add('hidden');
        this._compareIso = null;
        this._comparePair = null;
        this._restoreFocus();
    },

    openMethodologyModal() {
        this._closeMenus();
        this._returnFocus = document.activeElement;
        document.documentElement.style.overflow = 'hidden';
        document.getElementById('methodology-modal').classList.remove('hidden');
        document.getElementById('methodology-modal-close')?.focus({ preventScroll: true });
    },

    closeMethodologyModal() {
        document.documentElement.style.overflow = '';
        document.getElementById('methodology-modal').classList.add('hidden');
        this._restoreFocus();
    },

    _buildCompareContent(isoA, isoB, mf) {
        const nameA = STATE.countryNames[isoA] || isoA;
        const nameB = STATE.countryNames[isoB] || isoB;
        const A_C = '#009EDB', B_C = '#6E6259';
        // Same country-level figures as the insight panel: all partners, before
        // display filters — so "Gross trade" equals the table's current-year row.
        const statsA = DataLoader.countryTotals(isoA);
        const statsB = DataLoader.countryTotals(isoB);

        const devA = CONFIG.development[isoA] === 'north' ? 'Developed' : 'Developing';
        const devB = CONFIG.development[isoB] === 'north' ? 'Developed' : 'Developing';
        const regA = RegionConfig.getRegion(isoA) || '—';
        const regB = RegionConfig.getRegion(isoB) || '—';
        const role = s => s ? (s.net >= 0 ? 'Net exporter' : 'Net importer') : '—';

        const getYearlyTotals = (iso) => {
            const isoData = STATE.trendSummary[iso] || {};
            const t = {};
            for (let y = 2015; y <= 2024; y++) t[y] = isoData[String(y)] || 0;
            return t;
        };
        const totA = getYearlyTotals(isoA);
        const totB = getYearlyTotals(isoB);
        const years = Object.keys(totA).map(Number).sort();
        const maxV  = Math.max(...years.map(y => Math.max(totA[y], totB[y])), 1);

        const metricRows = [
            { label: 'Region', vA: regA, vB: regB },
            { label: 'Status', vA: devA, vB: devB },
            { label: `Gross trade ${STATE.year}`, vA: statsA ? mf.fmt(statsA.gross) : '—', vB: statsB ? mf.fmt(statsB.gross) : '—' },
            { label: `Net balance ${STATE.year}`, vA: statsA ? fmtSigned(statsA.net) : '—', vB: statsB ? fmtSigned(statsB.net) : '—' },
            { label: 'Role', vA: role(statsA), vB: role(statsB) },
        ];
        const metricTable = metricRows.map(r => `<tr>
                <td class="ar">${r.vA}</td>
                <th scope="row" class="ac si-row-label">${r.label}</th>
                <td class="al">${r.vB}</td>
            </tr>`).join('');

        let html = `
        <div class="si-section">
            <div class="si-compare-head">
                <div class="si-compare-name is-a"><i class="si-key-sq" style="background:${A_C}"></i>${nameA}</div>
                <div class="si-compare-name is-b"><i class="si-key-sq" style="background:${B_C}"></i>${nameB}</div>
            </div>
            <table class="si-table si-compare-table">${metricTable}</table>
        </div>`;

        const W = 580, H = 72, padX = 18;
        const step = (W - padX * 2) / Math.max(1, years.length - 1);
        const xAt = i => padX + i * step;
        const yAt = v => H - (v / maxV) * H;
        const line = (tot, col) => `<polyline points="${years.map((y, i) => `${xAt(i)},${yAt(tot[y])}`).join(' ')}" fill="none" stroke="${col}" stroke-width="2"/>`;
        const cur = years.indexOf(STATE.year);
        const marks = cur >= 0
            ? `<line x1="${xAt(cur)}" y1="0" x2="${xAt(cur)}" y2="${H}" stroke="#DED9D5" stroke-width="1"/>
               <rect x="${xAt(cur) - 3.5}" y="${yAt(totA[STATE.year]) - 3.5}" width="7" height="7" fill="${A_C}"/>
               <rect x="${xAt(cur) - 3.5}" y="${yAt(totB[STATE.year]) - 3.5}" width="7" height="7" fill="${B_C}"/>`
            : '';
        const xLabels = years.map((y, i) => `<text x="${xAt(i)}" y="${H + 15}" text-anchor="middle" font-size="10" font-weight="${y === STATE.year ? 700 : 400}" fill="${y === STATE.year ? '#231F20' : '#6E6259'}">${y}</text>`).join('');

        html += `
        <div class="si-section">
            <div class="si-label">Gross trade, ${years[0]}–${years[years.length - 1]} (exports + imports)</div>
            <div class="si-chart-legend">
                <div class="si-legend-item"><div class="si-legend-swatch" style="background:${A_C}"></div><span>${nameA}</span></div>
                <div class="si-legend-item"><div class="si-legend-swatch" style="background:${B_C}"></div><span>${nameB}</span></div>
            </div>
            <svg class="si-chart" viewBox="0 0 ${W} ${H + 20}" role="img" aria-label="Gross trade of ${nameA} and ${nameB}, ${years[0]} to ${years[years.length - 1]}">
                <line x1="0" y1="${H}" x2="${W}" y2="${H}" stroke="#231F20" stroke-width="0.7"/>
                ${marks}${line(totA, A_C)}${line(totB, B_C)}${xLabels}
            </svg>
        </div>`;

        const tableRows = years.filter(y => totA[y] > 0 || totB[y] > 0).reverse().map(y => {
            const isCur = y === STATE.year;
            return `<tr${isCur ? ' class="row-cur"' : ''}>
                <td class="ar">${mf.fmt(totA[y])}</td>
                <td class="ac">${y}</td>
                <td class="al">${mf.fmt(totB[y])}</td>
            </tr>`;
        }).join('');

        html += `
        <div class="si-section">
            <div class="si-label">Year by year</div>
            <table class="si-table si-compare-table">
                <thead>
                    <tr>
                        <th class="ar">${nameA}</th>
                        <th class="ac">Year</th>
                        <th class="al">${nameB}</th>
                    </tr>
                </thead>
                <tbody>${tableRows}</tbody>
            </table>
        </div>`;

        return html;
    },

    _buildPanelContent(iso, stats, mf) {
        const panelFlows = this._panelFlows(iso);
        const partnerExports = {}, partnerImports = {};
        panelFlows.forEach(d => {
            if (d.exporter === iso) partnerExports[d.importer] = (partnerExports[d.importer] || 0) + d.netValue;
            else if (d.importer === iso) partnerImports[d.exporter] = (partnerImports[d.exporter] || 0) + d.netValue;
        });

        const yearlyTotals = {};
        const isoTrend = STATE.trendSummary[iso] || {};
        for (let y = 2015; y <= 2024; y++) yearlyTotals[y] = isoTrend[String(y)] || 0;

        let html = `<div class="si-section">
            <div class="si-label">In brief</div>
            <div class="si-narrative-box">
                ${this._generateNarrative(iso, stats, partnerExports, partnerImports, yearlyTotals, mf, panelFlows)}
            </div>
        </div>`;

        if (!stats) return html;

        const isExp = stats.net >= 0;
        html += `<div class="si-section">
            <div class="si-label">Key figures, ${STATE.year}</div>
            <div class="si-sublabel">All partners · exports and imports, before display filters</div>
            <div class="si-kpi-grid cols-2">
                <div class="si-kpi-card" title="Exports plus imports with all partners">
                    <div class="si-kpi-label">${mf.grossLabel.replace(':', '')}</div>
                    <div class="si-kpi-value">${mf.fmt(stats.gross)}</div>
                    <div class="si-kpi-note">Exports + imports</div>
                </div>
                <div class="si-kpi-card" title="Exports minus imports with all partners">
                    <div class="si-kpi-label">${mf.netLabel.replace(':', '')}</div>
                    <div class="si-kpi-value">${fmtSigned(stats.net)}</div>
                    <div class="si-kpi-note"><span class="si-role-badge ${isExp ? 'exp' : 'imp'}">${isExp ? 'Net exporter' : 'Net importer'}</span></div>
                </div>
            </div>
        </div>`;

        html += this._buildConcentrationGauge(iso, mf);

        const allPartners = {};
        Object.entries(partnerExports).forEach(([p, v]) => { allPartners[p] = (allPartners[p] || 0) + v; });
        Object.entries(partnerImports).forEach(([p, v]) => { allPartners[p] = (allPartners[p] || 0) + v; });
        const sortedPartners = Object.entries(allPartners).sort((a, b) => b[1] - a[1]).slice(0, 10);

        if (sortedPartners.length > 0) {
            const maxPVal = sortedPartners[0][1];

            // Build bilateral totals from yearCache (pre-threshold) once for rank lookups.
            const isRegionalRank = STATE.region && STATE.region !== 'Global';
            const bilatRaw = (STATE.yearCache[STATE.year] || []).filter(d => !isRegionalRank ||
                (RegionConfig.getRegion(d.exporter) === STATE.region && RegionConfig.getRegion(d.importer) === STATE.region));
            const bilatTotals = {};
            bilatRaw.forEach(d => {
                if (d.exporter === d.importer) return;   // no country is its own partner
                if (!bilatTotals[d.exporter]) bilatTotals[d.exporter] = {};
                bilatTotals[d.exporter][d.importer] = (bilatTotals[d.exporter][d.importer] || 0) + d.netValue;
                if (!bilatTotals[d.importer]) bilatTotals[d.importer] = {};
                bilatTotals[d.importer][d.exporter] = (bilatTotals[d.importer][d.exporter] || 0) + d.netValue;
            });
            // Returns 1-based rank of targetIso in forIso's partner list; 0 if not found.
            const getPartnerRank = (targetIso, forIso) => {
                const map = bilatTotals[forIso];
                if (!map || !(targetIso in map)) return 0;
                const targetVal = map[targetIso];
                let rank = 1;
                for (const k in map) { if (k !== targetIso && map[k] > targetVal) rank++; }
                return rank;
            };

            const isoName = STATE.countryNames[iso] || iso;
            const rankScope = isRegionalRank ? ` within ${STATE.region}` : '';
            const rows = sortedPartners.map(([pIso, val], idx) => {
                const pName = STATE.countryNames[pIso] || pIso;
                const barPct = Math.round((val / maxPVal) * 100);
                const isExportTo = !!partnerExports[pIso];
                const arrow = isExportTo ? '→' : '←';
                const aColor = isExportTo ? '#009EDB' : '#ED1847';
                const arcExpIso = isExportTo ? iso : pIso;
                const arcImpIso = isExportTo ? pIso : iso;

                // Rank asymmetry: where does iso rank in pIso's own partner list? (pre-threshold)
                const theirRank = getPartnerRank(iso, pIso);
                const theirCell = theirRank > 0
                    ? `<span class="si-their${theirRank <= 3 ? ' is-top' : ''}" title="${pName} ranks ${isoName} as their #${theirRank} trading partner${rankScope} (all net flows, before display filters)">${theirRank}</span>`
                    : '<span class="si-their">–</span>';

                // Bilateral flow split: share flowing in the dominant direction. (pre-threshold gross flows)
                let splitBadge = '';
                if (STATE.bilateralHistory) {
                    const [a, b] = [iso, pIso].sort();
                    const hist = STATE.bilateralHistory[a + '|' + b];
                    const entry = hist ? hist[String(STATE.year)] : null;
                    if (entry) {
                        const isoIsA = iso === a;
                        const isoOut = isoIsA ? entry.aToB : entry.bToA;
                        const isoIn  = isoIsA ? entry.bToA : entry.aToB;
                        const tot = isoOut + isoIn;
                        if (tot > 0) {
                            const domPct = Math.round(Math.max(isoOut, isoIn) / tot * 100);
                            const expDom = isoOut >= isoIn;
                            const tip = expDom
                                ? `${domPct}% of gross bilateral trade flows from ${isoName}`
                                : `${domPct}% of gross bilateral trade flows from ${pName}`;
                            splitBadge = `<span class="${domPct >= 75 ? 'is-strong' : ''}" title="${tip}">${expDom ? '→' : '←'}${domPct}%</span>`;
                        }
                    }
                }

                return `<div class="si-partner-row">
                    <span class="si-rank">${idx + 1}</span>
                    <span class="si-arrow" style="color:${aColor}" title="${isExportTo ? 'Net exports to' : 'Net imports from'} ${pName}">${arrow}</span>
                    <span class="si-name" title="${pName}">${pName}</span>
                    <div class="si-bar-wrap"><div class="si-bar-fill" style="width:${barPct}%;background:${aColor}"></div></div>
                    <span class="si-val">${mf.fmt(val)}</span>
                    <span class="si-split">${splitBadge}</span>
                    ${theirCell}
                    <div class="si-actions">
                        <button onclick="App.openArcModal('${arcExpIso}','${arcImpIso}')" class="si-btn" title="Bilateral history with ${pName}" aria-label="Bilateral history with ${pName}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square" aria-hidden="true"><path d="M3 21h18M6 17V11M11 17V5M16 17v-8M21 17v-4"/></svg></button>
                        <button onclick="App.openCompareModal('${iso}','${pIso}')" class="si-btn cmp" title="Compare with ${pName}" aria-label="Compare with ${pName}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square" aria-hidden="true"><path d="M4 8h15M15 4l4 4-4 4M20 16H5M9 12l-4 4 4 4"/></svg></button>
                    </div>
                </div>`;
            }).join('');
            html += `<div class="si-section">
                <div class="si-label">Trading partners, by net flow</div>
                <div class="si-sublabel">${this._panelScopeNote()}</div>
                <div class="si-partners">
                    <div class="si-partner-head" aria-hidden="true">
                        <span class="h-rank">Rank</span>
                        <span class="h-name">Partner</span>
                        <span class="h-val">Net flow</span>
                        <span class="h-split" title="Share of the two-way trade that flows in the main direction">One-way</span>
                        <span class="h-their" title="Where this economy ranks among the partner's own partners">Their rank</span>
                    </div>
                    ${rows}
                </div>
                <div class="si-note"><b>One-way</b>: share of the two-way trade flowing in the main direction. <b>Their rank</b>: this economy's place among the partner's own partners. Point at a row for its history or a comparison.</div>
            </div>`;
        }

        html += this._buildButterflyChart(iso);

        html += this._buildPolarFingerprint(iso);

        const years = Object.keys(yearlyTotals).map(Number).sort();
        const yVals = years.map(y => yearlyTotals[y]);
        const maxYV = Math.max(...yVals);
        if (maxYV > 0) {
            const W = 300, H = 56, gap = 3, top = 14;
            const barW = (W - gap * (years.length - 1)) / years.length;
            const bars = yVals.map((v, i) => {
                const h = Math.max(1, (v / maxYV) * H);
                const x = i * (barW + gap);
                const isCur = years[i] === STATE.year;
                const valLabel = isCur
                    ? `<text x="${i === years.length - 1 ? x + barW : x + barW / 2}" y="${top + H - h - 4}" text-anchor="${i === years.length - 1 ? 'end' : 'middle'}" font-size="10" font-weight="700" fill="#231F20">${mf.fmt(v)}</text>`
                    : '';
                return `<rect x="${x}" y="${top + H - h}" width="${barW}" height="${h}" fill="${isCur ? '#004987' : '#C9C2BB'}"/>${valLabel}<text x="${x + barW / 2}" y="${top + H + 13}" text-anchor="middle" font-size="9.5" font-weight="${isCur ? 700 : 400}" fill="${isCur ? '#231F20' : '#6E6259'}">${years[i]}</text>`;
            }).join('');
            html += `<div class="si-section">
                <div class="si-label">Gross trade, ${years[0]}–${years[years.length - 1]}</div>
                <div class="si-sublabel">Exports + imports with all partners · ${STATE.year} in dark blue</div>
                <svg class="si-chart" viewBox="0 0 ${W} ${top + H + 17}" role="img" aria-label="Gross trade by year, ${years[0]} to ${years[years.length - 1]}">${bars}<line x1="0" y1="${top + H}" x2="${W}" y2="${top + H}" stroke="#231F20" stroke-width="0.7"/></svg>
            </div>`;
        }

        const catTotals = {};
        let countryTotal = 0;
        panelFlows.forEach(d => {
            catTotals[d.flowCategory] = (catTotals[d.flowCategory] || 0) + d.netValue;
            countryTotal += d.netValue;
        });
        if (countryTotal > 0) {
            const catFull = { 'north-south': 'North → South', 'south-north': 'South → North', 'south-south': 'South → South', 'north-north': 'North → North' };
            const segments = Object.entries(catTotals).sort((a, b) => b[1] - a[1]).map(([cat, val]) => ({ cat, pct: (val / countryTotal) * 100 }));
            const barSegs = segments.map(s => `<div style="width:${s.pct}%;background:${CONFIG.flowColors[s.cat]};height:100%"></div>`).join('');
            const compRows = segments.map(s => `<div class="si-comp-row">
                <div class="si-comp-dot" style="background:${CONFIG.flowColors[s.cat]}"></div>
                <span class="si-comp-label">${catFull[s.cat]}</span>
                <span class="si-comp-pct">${Math.round(s.pct)}%</span>
            </div>`).join('');
            html += `<div class="si-section">
                <div class="si-label">Flow composition</div>
                <div class="si-sublabel">Share of net flows · ${this._panelScopeNote()}</div>
                <div class="si-flow-bar">${barSegs}</div>
                <div class="si-comp-rows">${compRows}</div>
            </div>`;
        }

        return html;
    },

    // HHI computed from pre-threshold raw data to avoid zoom-level distortion.
    _buildConcentrationGauge(iso, mf) {
        const combined = {};
        this._panelFlows(iso).forEach(d => {
            if (d.exporter === iso) combined[d.importer] = (combined[d.importer] || 0) + d.netValue;
            else combined[d.exporter] = (combined[d.exporter] || 0) + d.netValue;
        });
        const total = Object.values(combined).reduce((s, v) => s + v, 0);
        if (total === 0) return '';
        const scopeNote = `Net flows with each partner (export and import partners together) · ${this._panelScopeNote()}`;

        const shares = Object.values(combined).map(v => v / total);
        const hhi = shares.reduce((s, sh) => s + sh * sh, 0);

        const sorted = Object.entries(combined).sort((a, b) => b[1] - a[1]);
        const top1Pct = sorted[0] ? (sorted[0][1] / total * 100) : 0;
        const top3Pct = sorted.slice(0, 3).reduce((s, e) => s + e[1], 0) / total * 100;
        const top5Pct = sorted.slice(0, 5).reduce((s, e) => s + e[1], 0) / total * 100;
        const top1Name = sorted[0] ? (STATE.countryNames[sorted[0][0]] || sorted[0][0]) : '—';

        // Thresholds calibrated for trade (not market-competition DOJ levels).
        const label = hhi < 0.20 ? 'Diversified' : hhi < 0.40 ? 'Moderate' : 'Highly concentrated';
        const score = (hhi * 10000).toFixed(0);
        const pos = Math.min(hhi, 1) * 100;

        return `<div class="si-section">
            <div class="si-label">Partner concentration (HHI)</div>
            <div class="si-sublabel">${scopeNote}</div>
            <div class="si-hhi">
                <div class="si-hhi-head">
                    <span class="hhi-score">${score}</span>
                    <span class="si-badge">${label}</span>
                    <span class="hhi-of">on a scale of 0 to 10,000</span>
                </div>
                <div class="si-hhi-scale" role="img" aria-label="HHI ${score} on a scale of 0 to 10,000: ${label}">
                    <span class="hhi-band hhi-band-1"></span><span class="hhi-band hhi-band-2"></span><span class="hhi-band hhi-band-3"></span>
                    <span class="hhi-marker" style="left:${pos.toFixed(2)}%"></span>
                </div>
                <div class="si-hhi-axis" aria-hidden="true"><span style="left:0">0</span><span style="left:20%">2,000</span><span style="left:40%">4,000</span><span style="left:100%">10,000</span></div>
                <div class="si-hhi-bands" aria-hidden="true"><span>Diversified</span><span>Moderate</span><span>Highly concentrated</span></div>
                <div class="si-hhi-stats">
                    <div><div class="hhi-l">Top partner</div><div class="hhi-v">${top1Pct.toFixed(0)}%</div><div class="hhi-s" title="${top1Name}">${top1Name}</div></div>
                    <div><div class="hhi-l">Top 3</div><div class="hhi-v">${top3Pct.toFixed(0)}%</div><div class="hhi-s">of net flows</div></div>
                    <div><div class="hhi-l">Top 5</div><div class="hhi-v">${top5Pct.toFixed(0)}%</div><div class="hhi-s">of net flows</div></div>
                </div>
            </div>
        </div>`;
    },

    // Partners by compass direction: geographic bearing computed via great-circle formula.
    // Uses pre-threshold raw data so small-country partners are included.
    _buildPolarFingerprint(iso) {
        const myCoords = STATE.countryCoords[iso];
        if (!myCoords) return '';
        const [lon1, lat1] = myCoords;

        const bearingTo = (lon2, lat2) => {
            const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
            const Δλ = (lon2 - lon1) * Math.PI / 180;
            const y = Math.sin(Δλ) * Math.cos(φ2);
            const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
            return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
        };

        const SECTORS = 8, SECTOR_WIDTH = 45;
        const sectorExp = new Array(SECTORS).fill(0);
        const sectorImp = new Array(SECTORS).fill(0);
        let anyData = false;

        this._panelFlows(iso).forEach(d => {
            const isExport = d.exporter === iso;
            const partnerIso = isExport ? d.importer : d.exporter;
            const c = STATE.countryCoords[partnerIso];
            if (!c) return;
            const idx = Math.floor((bearingTo(c[0], c[1]) + SECTOR_WIDTH / 2) / SECTOR_WIDTH) % SECTORS;
            if (isExport) sectorExp[idx] += d.netValue;
            else          sectorImp[idx] += d.netValue;
            anyData = true;
        });
        if (!anyData) return '';

        const maxVal = Math.max(...sectorExp, ...sectorImp, 1);
        const W = 220, H = 220, cx = W / 2, cy = H / 2, innerR = 14, maxBarLen = 80;
        const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        const parts = [];

        [0.5, 1].forEach(p => {
            parts.push(`<circle cx="${cx}" cy="${cy}" r="${innerR + maxBarLen * p}" fill="none" stroke="#DED9D5" stroke-width="0.8"/>`);
        });
        for (let i = 0; i < SECTORS; i++) {
            const a = (i * SECTOR_WIDTH - 90) * Math.PI / 180;
            parts.push(`<line x1="${(cx + innerR * Math.cos(a)).toFixed(2)}" y1="${(cy + innerR * Math.sin(a)).toFixed(2)}" x2="${(cx + (innerR + maxBarLen) * Math.cos(a)).toFixed(2)}" y2="${(cy + (innerR + maxBarLen) * Math.sin(a)).toFixed(2)}" stroke="#EBEAE6" stroke-width="0.8"/>`);
        }

        for (let i = 0; i < SECTORS; i++) {
            const centerRad = (i * SECTOR_WIDTH - 90) * Math.PI / 180;
            const offsetRad = 8 * Math.PI / 180;
            const expLen = (sectorExp[i] / maxVal) * maxBarLen;
            const impLen = (sectorImp[i] / maxVal) * maxBarLen;
            const drawBar = (len, angleRad, color) => {
                if (len < 0.5) return;
                const x1 = cx + innerR * Math.cos(angleRad), y1 = cy + innerR * Math.sin(angleRad);
                const x2 = cx + (innerR + len) * Math.cos(angleRad), y2 = cy + (innerR + len) * Math.sin(angleRad);
                parts.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${color}" stroke-width="6"/>`);
            };
            drawBar(expLen, centerRad + offsetRad, '#009EDB');
            drawBar(impLen, centerRad - offsetRad, '#ED1847');

            const labelR = innerR + maxBarLen + 13;
            parts.push(`<text x="${(cx + labelR * Math.cos(centerRad)).toFixed(2)}" y="${(cy + labelR * Math.sin(centerRad) + 3.5).toFixed(2)}" text-anchor="middle" font-size="10" font-weight="600" fill="#6E6259">${labels[i]}</text>`);
        }
        parts.push(`<rect x="${cx - 3}" y="${cy - 3}" width="6" height="6" fill="#231F20"/>`);

        const scopeNote = `Net flows by direction of the partner · ${this._panelScopeNote()}`;
        // 16px margin on every side: the compass letters sit outside the bars.
        return `<div class="si-section">
            <div class="si-label">Partners by compass direction</div>
            <div class="si-sublabel">${scopeNote}</div>
            <svg class="si-chart" viewBox="-16 -16 ${W + 32} ${H + 32}" style="max-width:250px;margin:0 auto" role="img" aria-label="Net exports and imports by compass direction of the partner">
                ${parts.join('')}
            </svg>
            <div class="si-chart-footer">
                <div class="si-legend-item"><div class="si-legend-swatch" style="background:#009EDB"></div><span>Exports</span></div>
                <div class="si-legend-item"><div class="si-legend-swatch" style="background:#ED1847"></div><span>Imports</span></div>
            </div>
            <div class="si-note">Each bar points from this economy towards its partners (great-circle bearing); its length is the net flow.</div>
        </div>`;
    },

    // Butterfly chart: for each of the top 7 partners, show export bar (right, blue)
    // and import bar (left, red). Lengths are scaled to the maximum single-direction value.
    // Source: bilateralHistory (gross flows, both directions). Falls back to yearCache net direction.
    _buildButterflyChart(iso) {
        const rawFlows = this._panelFlows(iso);
        const isRegional = STATE.region && STATE.region !== 'Global';
        const combined = {};
        rawFlows.forEach(d => {
            if (d.exporter === iso) combined[d.importer] = (combined[d.importer] || 0) + d.netValue;
            else combined[d.exporter] = (combined[d.exporter] || 0) + d.netValue;
        });

        const topPartners = Object.entries(combined)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 7)
            .map(([p]) => p);

        if (topPartners.length === 0) return '';

        const partnerData = topPartners.map(pIso => {
            let expVal = 0, impVal = 0;
            if (STATE.bilateralHistory) {
                const [a, b] = [iso, pIso].sort();
                const hist = STATE.bilateralHistory[a + '|' + b];
                const entry = hist ? hist[String(STATE.year)] : null;
                if (entry) {
                    const isoIsA = iso === a;
                    expVal = isoIsA ? (entry.aToB || 0) : (entry.bToA || 0);
                    impVal = isoIsA ? (entry.bToA || 0) : (entry.aToB || 0);
                } else {
                    // Fallback: place net value on the dominant side
                    const flow = rawFlows.find(d =>
                        (d.exporter === iso && d.importer === pIso) ||
                        (d.exporter === pIso && d.importer === iso));
                    if (flow) { if (flow.exporter === iso) expVal = flow.netValue; else impVal = flow.netValue; }
                }
            } else {
                const flow = rawFlows.find(d =>
                    (d.exporter === iso && d.importer === pIso) ||
                    (d.exporter === pIso && d.importer === iso));
                if (flow) { if (flow.exporter === iso) expVal = flow.netValue; else impVal = flow.netValue; }
            }
            return { pIso, expVal, impVal };
        });

        const maxVal = Math.max(...partnerData.map(d => Math.max(d.expVal, d.impVal)), 1);

        // Layout: name zone in the centre, bars diverge left (imports) and right (exports)
        const W = 300, nameW = 88;
        const cx = W / 2, leftEdge = cx - nameW / 2, rightEdge = cx + nameW / 2;
        const barMaxLen = 100, barH = 11, rowGap = 19;

        const rows = partnerData.map((d, i) => {
            const y = i * rowGap;
            const expLen = d.expVal > 0 ? Math.max(1.5, (d.expVal / maxVal) * barMaxLen) : 0;
            const impLen = d.impVal > 0 ? Math.max(1.5, (d.impVal / maxVal) * barMaxLen) : 0;
            const name = STATE.countryNames[d.pIso] || d.pIso;
            const shortName = name.length > 14 ? name.slice(0, 13) + '…' : name;

            const impBar = impLen > 0
                ? `<rect x="${(leftEdge - 4 - impLen).toFixed(1)}" y="${y}" width="${impLen.toFixed(1)}" height="${barH}" fill="#ED1847"/>`
                : '';
            const expBar = expLen > 0
                ? `<rect x="${rightEdge + 4}" y="${y}" width="${expLen.toFixed(1)}" height="${barH}" fill="#009EDB"/>`
                : '';
            const nameEl = `<text x="${cx}" y="${y + barH - 2}" text-anchor="middle" font-size="9.5" fill="#231F20">${shortName}</text>`;

            return `${impBar}${expBar}${nameEl}`;
        }).join('');

        const totalH = topPartners.length * rowGap - (rowGap - barH);

        const axes = `
            <text x="${leftEdge - 4}" y="-6" text-anchor="end" font-size="9.5" font-weight="600" fill="#6E6259">Imports</text>
            <text x="${rightEdge + 4}" y="-6" text-anchor="start" font-size="9.5" font-weight="600" fill="#6E6259">Exports</text>
            <line x1="${leftEdge - 4}" y1="-2" x2="${leftEdge - 4}" y2="${totalH + 2}" stroke="#231F20" stroke-width="0.7"/>
            <line x1="${rightEdge + 4}" y1="-2" x2="${rightEdge + 4}" y2="${totalH + 2}" stroke="#231F20" stroke-width="0.7"/>`;

        const scopeNote = isRegional
            ? `Top 7 partners by net flow · exports and imports in each direction · ${STATE.region} intra-regional`
            : 'Top 7 partners by net flow · exports and imports in each direction · all partners';

        return `<div class="si-section">
            <div class="si-label">Exports and imports by partner</div>
            <div class="si-sublabel">${scopeNote}</div>
            <svg class="si-chart" viewBox="0 -16 ${W} ${totalH + 20}" role="img" aria-label="Exports and imports with the top 7 partners">
                ${axes}
                ${rows}
            </svg>
        </div>`;
    },

    _generateNarrative(iso, stats, partnerExports, partnerImports, yearlyTotals, mf, panelFlows = this._panelFlows(iso)) {
        const name = STATE.countryNames[iso] || iso;
        const sentences = [];

        if (stats) {
            const isExp = stats.net >= 0;
            const role = isExp ? 'net exporter' : 'net importer';

            const _yearStr = String(STATE.year);
            if (!this._globalRankCache[_yearStr]) {
                const globalVols = {};
                Object.entries(STATE.trendSummary).forEach(([isoKey, yearData]) => {
                    const val = yearData[_yearStr];
                    if (val > 0) globalVols[isoKey] = val;
                });
                this._globalRankCache[_yearStr] = Object.entries(globalVols).sort((a, b) => b[1] - a[1]);
            }
            const sortedGlobal = this._globalRankCache[_yearStr];
            const globalRank = sortedGlobal.findIndex(([k]) => k === iso) + 1;
            const totalCountries = sortedGlobal.length;
            const rankStr = globalRank > 0 ? `ranked ${ordinal(globalRank)} of ${totalCountries} economies worldwide` : 'active';
            const measure = STATE.metric === 'weight' ? 'gross trade by weight' : 'gross trade';
            sentences.push(`${name} is a ${role} of used clothing, ${rankStr} by ${measure} (exports + imports) in ${STATE.year}: ${mf.fmt(stats.gross)}.`);
        }

        const years = Object.keys(yearlyTotals).map(Number).sort();
        const curIdx = years.indexOf(STATE.year);
        if (curIdx > 0) {
            const curVal = yearlyTotals[STATE.year];
            const prevVal = yearlyTotals[years[curIdx - 1]];
            if (prevVal > 0 && curVal > 0) {
                const yoy = ((curVal - prevVal) / prevVal) * 100;
                const dir = yoy >= 0 ? 'grew' : 'declined';
                const firstNZ = years.findIndex(y => yearlyTotals[y] > 0);
                let cagrStr = '';
                if (firstNZ >= 0 && curIdx > firstNZ && yearlyTotals[years[firstNZ]] > 0) {
                    const n = curIdx - firstNZ;
                    const cagr = (Math.pow(curVal / yearlyTotals[years[firstNZ]], 1 / n) - 1) * 100;
                    if (isFinite(cagr)) cagrStr = ` (average annual growth ${signedPct(cagr, 1)} since ${years[firstNZ]})`;
                }
                const what = STATE.metric === 'weight' ? 'Gross trade by weight' : 'Gross trade';
                sentences.push(`${what} ${dir} ${Math.abs(yoy).toFixed(1)}% from ${years[curIdx - 1]} to ${STATE.year}${cagrStr}.`);
            }
        }

        const allPartners = {};
        Object.entries(partnerExports).forEach(([p, v]) => { allPartners[p] = (allPartners[p] || 0) + v; });
        Object.entries(partnerImports).forEach(([p, v]) => { allPartners[p] = (allPartners[p] || 0) + v; });
        const topEntry = Object.entries(allPartners).sort((a, b) => b[1] - a[1])[0];

        const catTotals = {};
        let countryTotal = 0;
        panelFlows.forEach(d => {
            catTotals[d.flowCategory] = (catTotals[d.flowCategory] || 0) + d.netValue;
            countryTotal += d.netValue;
        });
        const domCat = Object.entries(catTotals).sort((a, b) => b[1] - a[1])[0];
        const catFull = { 'north-south': 'North→South', 'south-north': 'South→North', 'south-south': 'South→South', 'north-north': 'North→North' };

        const within = STATE.region && STATE.region !== 'Global' ? ` within ${STATE.region}` : '';
        if (topEntry || domCat) {
            let s = '';
            if (topEntry) {
                const tpName = STATE.countryNames[topEntry[0]] || topEntry[0];
                s += `Largest partner by net flow${within} is ${tpName}.`;
            }
            if (domCat && countryTotal > 0) {
                const domPct = Math.round((domCat[1] / countryTotal) * 100);
                s += ` ${catFull[domCat[0]]} flows are the largest share of its net flows${within} (${domPct}%).`;
            }
            if (s) sentences.push(s);
        }

        if (sentences.length === 0) return '<p class="si-empty">No trade data available for this country in the current view.</p>';
        return sentences.map(s => `<p>${s}</p>`).join('');
    },

    updateDashboard(rebuildMenus = true) {
        STATE.selectedExporters = new Set(this.exporterSelector.getSelectedCountries());
        STATE.selectedImporters = new Set(this.importerSelector.getSelectedCountries());

        // Auto-reset threshold only when transitioning from "some selected" → "none selected"
        const currentSelectionCount = STATE.selectedExporters.size + STATE.selectedImporters.size;
        if (currentSelectionCount === 0 && this._prevSelectionCount > 0 && STATE.thresholdMode !== 'auto') {
            STATE.thresholdMode = 'auto';
            this.syncControlsFromState();
        }
        this._prevSelectionCount = currentSelectionCount;

        DataLoader.filterData();
        TradeMap.renderFlows();
        this.updateKPIBar();
        this._applyModeUI();
        this._updateFilterIndicators();
        const empty = this.currentMode() === 'explore' && !!STATE.yearCache[STATE.year] && !(STATE.filteredData || []).length;
        document.getElementById('map-empty')?.classList.toggle('hidden', !empty);

        // Single choke point for the URL: every filter change routes through
        // updateDashboard(), so the hash always describes what is on screen.
        DeepLink.write();

        // Keep whatever is open in step with the year / metric / region just applied.
        this._refreshOpenViews();

        if (this._lastRenderedRegion !== STATE.region) {
            this._lastRenderedRegion = STATE.region;
            setTimeout(() => TradeMap.zoomToRegion(STATE.region), 50);
        }
    },

    // Re-render every open panel / pop-up from the current STATE.
    _refreshOpenViews() {
        if (this._connectionsPanelOpen) this.openConnectionsPanel();
        else if (this._currentPanelIso) this._renderInsightPanel(this._currentPanelIso);
        if (this._arcPair && !document.getElementById('arc-modal').classList.contains('hidden')) this._renderArcModal();
        if (this._comparePair && !document.getElementById('compare-modal').classList.contains('hidden')) {
            const { isoA, isoB } = this._comparePair;
            this.openCompareModal(isoA, isoB);
        }
    },

    // ── Interactive line filter orchestration ───────────────────────────────

    // Commit a drawn connection. Pairs accumulate (earlier lines persist) and are
    // de-duplicated undirected, matching how DataLoader.filterData resolves them.
    addBilateralPair(exporter, importer) {
        if (!exporter || !importer || exporter === importer) return;
        const key = [exporter, importer].sort().join('|');
        const exists = STATE.bilateralPairs.some(p => [p.exporter, p.importer].sort().join('|') === key);
        if (!exists) STATE.bilateralPairs.push({ exporter, importer });
        this._stashedPairs = [];
        // A connection added from outside the Connect tab (e.g. the guided tour)
        // puts the dashboard in Connect mode.
        if (TradeMap.svg && !TradeMap.lineFilterMode) TradeMap.enableLineFilter();
        this.updateDashboard(false);
        this.openConnectionsPanel();
    },

    // Remove a single drawn connection (× button on its card).
    removeBilateralPair(exporter, importer) {
        const key = [exporter, importer].sort().join('|');
        STATE.bilateralPairs = STATE.bilateralPairs.filter(p => [p.exporter, p.importer].sort().join('|') !== key);
        this.updateDashboard(false);
        this._updateLineFilterUI({ active: TradeMap.lineFilterMode, stage: TradeMap._pendingExporter ? 'import' : 'export' });
        if (STATE.bilateralPairs.length > 0 || (TradeMap.lineFilterMode && !isCompact())) this.openConnectionsPanel();
        else this.closeConnectionsPanel();
    },

    // Remove every drawn connection. The Explore filters (region, pickers…) are
    // separate and stay as they were.
    clearBilateralFilter() {
        STATE.bilateralPairs = [];
        this._stashedPairs = [];
        if (TradeMap.cancelLineDraw) TradeMap.cancelLineDraw();
        this.updateDashboard(false);
        this._updateLineFilterUI({ active: TradeMap.lineFilterMode, stage: 'export' });
        if (TradeMap.lineFilterMode && !isCompact()) this.openConnectionsPanel();
        else this.closeConnectionsPanel();
    },

    _updateLineFilterUI(detail = {}) {
        const clearBtn = document.getElementById('linefilter-clear');
        const status   = document.getElementById('linefilter-status');
        const hint     = document.getElementById('connect-hint');
        const count    = STATE.bilateralPairs.length;
        const active   = !!detail.active;

        this._applyModeUI();
        if (clearBtn) clearBtn.classList.toggle('hidden', count === 0);
        if (hint) {
            const n = count > 0 ? ` <span class="connect-count">${count} connection${count > 1 ? 's' : ''} drawn.</span>` : '';
            hint.innerHTML = (active && detail.stage === 'import')
                ? `Now click the <b>importer</b> for ${STATE.countryNames[detail.exporter] || detail.exporter || 'this exporter'}. <kbd>Esc</kbd> cancels.`
                : `Click an <b>exporter</b> on the map, then an <b>importer</b>.${n}`;
        }
        if (!status) return;

        // The on-map status only guides the live drawing; the connection list/count
        // lives in the side panel, so nothing is shown once the mode is off.
        const verb = window.matchMedia?.('(pointer: coarse)').matches ? 'Tap' : 'Click';
        let text = '';
        if (active && detail.stage === 'import') {
            const expName = STATE.countryNames[detail.exporter] || detail.exporter || '';
            text = `${expName} → ?  ·  ${verb} an importer`;
        } else if (active) {
            text = count > 0 ? `${count} connection${count > 1 ? 's' : ''} · ${verb} an exporter` : `${verb} an exporter to start`;
        }
        status.textContent = text;
        status.classList.toggle('hidden', text === '');
    },

    // ── Connections panel (reuses the Data Insight side-panel container) ──────
    // Mirrors the single-country Data Insight box, but stacks one simplified
    // bilateral-history card per drawn connection.
    async openConnectionsPanel() {
        this._closeMenus();
        // The connections panel replaces a single-country panel: drop that
        // country's focus, which would otherwise hide the drawn lines.
        if (this._currentPanelIso || TradeMap.focusedIso) {
            this._currentPanelIso = null;
            if (TradeMap.clearFocus) TradeMap.clearFocus();
        }
        // Mini history charts need the precomputed bilateral history (lazy-loaded)
        if (!STATE.bilateralHistory) {
            try { await DataLoader._loadBilateral(STATE.metric); } catch (e) { /* fall back to net-only */ }
        }
        const mf = METRIC_FORMAT[STATE.metric] || METRIC_FORMAT.value;
        const n = STATE.bilateralPairs.length;

        document.getElementById('panel-clear-btn')?.classList.toggle('hidden', n === 0);
        document.getElementById('panel-country-name').textContent = 'Drawn connections';
        document.getElementById('panel-country-meta').textContent =
            n > 0 ? `${n} connection${n > 1 ? 's' : ''} · ${STATE.year}` : `Draw mode · ${STATE.year}`;
        document.getElementById('panel-body').innerHTML = this._buildConnectionsContent(mf);

        // The Sea Route button and country CSV export belong to single-country focus.
        const searouteBtn = document.getElementById('searoute-btn');
        if (searouteBtn) { searouteBtn.disabled = true; searouteBtn.classList.remove('active'); searouteBtn.style.display = 'none'; }
        const exportBtn = document.getElementById('panel-export-btn');
        if (exportBtn) exportBtn.style.display = 'none';

        document.getElementById('insight-panel').classList.add('open');
        document.body.classList.add('insight-open');
        this._currentPanelIso = null;
        this._connectionsPanelOpen = true;
        this.hideTooltip();
        if (isCompact()) setTimeout(() => window.dispatchEvent(new Event('resize')), 10);
    },

    closeConnectionsPanel() {
        if (!this._connectionsPanelOpen) return;
        this._connectionsPanelOpen = false;
        document.getElementById('insight-panel').classList.remove('open');
        document.body.classList.remove('insight-open');
        if (isCompact()) setTimeout(() => window.dispatchEvent(new Event('resize')), 10);
    },

    _buildConnectionsContent(mf) {
        if (STATE.bilateralPairs.length === 0) {
            return `<div class="conn-empty">
                <ol class="conn-steps">
                    <li><b>Click an exporter</b> on the map.</li>
                    <li><b>Click an importer.</b> The line is drawn and listed here with its trade history.</li>
                </ol>
                <p class="conn-empty-sub">Draw as many connections as needed. Remove one with its × button, or all of them with Clear all.</p>
            </div>`;
        }
        // Newest connection on top
        return STATE.bilateralPairs.slice().reverse()
            .map(p => this._buildConnectionCard(p.exporter, p.importer, mf)).join('');
    },

    // Simplified version of the arc-click history modal: current-year split, net,
    // and a compact per-year bilateral bar chart.
    _buildConnectionCard(expIso, impIso, mf) {
        const expName = STATE.countryNames[expIso] || expIso;
        const impName = STATE.countryNames[impIso] || impIso;
        const EXP_C = '#009EDB', IMP_C = '#ED1847';

        const yearData = {};
        for (let y = 2015; y <= 2024; y++) yearData[y] = { aToB: 0, bToA: 0 };
        const [a, b] = [expIso, impIso].sort();
        const expIsA = expIso === a;
        const hist = STATE.bilateralHistory ? STATE.bilateralHistory[`${a}|${b}`] : null;
        if (hist) {
            Object.entries(hist).forEach(([yStr, entry]) => {
                const y = +yStr;
                if (yearData[y]) {
                    yearData[y].aToB = expIsA ? entry.aToB : entry.bToA;
                    yearData[y].bToA = expIsA ? entry.bToA : entry.aToB;
                }
            });
        }

        const years  = Object.keys(yearData).map(Number).sort();
        const atoBs  = years.map(y => yearData[y].aToB);
        const bToAs  = years.map(y => yearData[y].bToA);
        const maxAbs = Math.max(...atoBs, ...bToAs, 1);
        const cy     = STATE.year;
        const curAtoB = yearData[cy] ? yearData[cy].aToB : 0;
        const curBtoA = yearData[cy] ? yearData[cy].bToA : 0;
        const curNet  = curAtoB - curBtoA;
        const hasData = atoBs.some(v => v > 0) || bToAs.some(v => v > 0);

        const W = 260, H = 34, half = 15, gap = 3;
        const bw = (W - gap * (years.length - 1)) / years.length;
        const bars = years.map((y, i) => {
            const aH = Math.max(0, (atoBs[i] / maxAbs) * half);
            const bH = Math.max(0, (bToAs[i] / maxAbs) * half);
            const x  = i * (bw + gap);
            const isCur = y === cy;
            return `<rect x="${x}" y="${H / 2 - aH}" width="${bw}" height="${aH}" fill="${EXP_C}" opacity="${isCur ? 1 : 0.4}"/>
                    <rect x="${x}" y="${H / 2}" width="${bw}" height="${bH}" fill="${IMP_C}" opacity="${isCur ? 1 : 0.4}"/>
                    <text x="${x + bw / 2}" y="${H + 10}" text-anchor="middle" font-size="7.5" font-weight="${isCur ? 700 : 400}" fill="${isCur ? '#231F20' : '#6E6259'}">${y}</text>`;
        }).join('');

        const chart = hasData
            ? `<svg class="si-chart" viewBox="0 0 ${W} ${H + 12}" role="img" aria-label="Exports in each direction, ${years[0]} to ${years[years.length - 1]}">
                   ${bars}<line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" stroke="#231F20" stroke-width="0.6"/>
               </svg>`
            : `<div class="conn-nodata">No recorded bilateral trade</div>`;

        return `<div class="si-section conn-card">
            <div class="conn-card-hdr">
                <span class="conn-flow"><b>${expName}</b> <span class="conn-arrow">→</span> <b>${impName}</b></span>
                <button class="conn-remove" title="Remove this connection" aria-label="Remove ${expName} to ${impName}" onclick="App.removeBilateralPair('${expIso}','${impIso}')">×</button>
            </div>
            <div class="conn-card-stats">
                <span class="conn-stat"><span class="conn-stat-lbl"><i class="si-key-sq" style="background:${EXP_C}"></i>${expName} →</span><b>${mf.fmt(curAtoB)}</b></span>
                <span class="conn-stat"><span class="conn-stat-lbl"><i class="si-key-sq" style="background:${IMP_C}"></i>← ${impName}</span><b>${mf.fmt(curBtoA)}</b></span>
                <span class="conn-stat" title="${expName} → ${impName} minus ${impName} → ${expName}"><span class="conn-stat-lbl">Net ${cy}</span><b>${fmtSigned(curNet)}</b></span>
            </div>
            ${chart}
            <div class="conn-card-foot">
                <button class="conn-detail-btn" onclick="App.openArcModal('${expIso}','${impIso}')">Full history and table</button>
            </div>
        </div>`;
    },

    showTooltip(event, iso) {
        const tooltip = document.getElementById('tooltip');
        const name = STATE.countryNames[iso] || iso;
        const stats = DataLoader.countryTotals(iso);   // all partners, before display filters
        const mf = METRIC_FORMAT[STATE.metric] || METRIC_FORMAT.value;

        const region = RegionConfig.getRegion(iso);
        const devStatus = CONFIG.development[iso] === 'north' ? 'Developed' : 'Developing';
        const within = STATE.region && STATE.region !== 'Global' ? ` · within ${STATE.region}` : '';

        let content = `
        <div class="tt-head">
            <div class="tt-name">${name}</div>
            ${region && region !== 'Other' ? `<div class="tt-meta">${region} · ${devStatus}</div>` : ''}
        </div>`;

        if (!stats) {
            tooltip.innerHTML = content;
            this._positionTooltip(tooltip, event);
            return;
        }

        const isNetExporter = stats.net >= 0;
        content += `
        <div class="tt-figs">
            <div class="tt-fig">
                <div class="tt-fig-l">${mf.grossLabel.replace(':', '')}</div>
                <div class="tt-fig-v">${mf.fmt(stats.gross)}</div>
            </div>
            <div class="tt-fig">
                <div class="tt-fig-l">${mf.netLabel.replace(':', '')}</div>
                <div class="tt-fig-v">${fmtSigned(stats.net)}</div>
                <div class="tt-role ${isNetExporter ? 'exp' : 'imp'}">${isNetExporter ? 'Net exporter' : 'Net importer'}</div>
            </div>
        </div>`;

        const panelFlows = this._panelFlows(iso);
        const partnerExports = {};
        const partnerImports = {};
        panelFlows.forEach(d => {
            if (d.exporter === iso) {
                partnerExports[d.importer] = (partnerExports[d.importer] || 0) + d.netValue;
            } else {
                partnerImports[d.exporter] = (partnerImports[d.exporter] || 0) + d.netValue;
            }
        });

        const allPartners = {};
        Object.entries(partnerExports).forEach(([p, v]) => { allPartners[p] = (allPartners[p] || 0) + v; });
        Object.entries(partnerImports).forEach(([p, v]) => { allPartners[p] = (allPartners[p] || 0) + v; });

        const topPartners = Object.entries(allPartners)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3);

        if (topPartners.length > 0) {
            const maxPVal = topPartners[0][1];
            const partnerRows = topPartners.map(([pIso, val]) => {
                const pName = (STATE.countryNames[pIso] || pIso);
                const shortName = pName.length > 14 ? pName.slice(0, 13) + '…' : pName;
                const barPct = Math.round((val / maxPVal) * 100);
                const isExportTo = !!partnerExports[pIso];
                const color = isExportTo ? '#009EDB' : '#ED1847';
                return `
                <div class="tt-prow">
                    <span class="tt-arrow" style="color:${color}">${isExportTo ? '→' : '←'}</span>
                    <span class="tt-pname">${shortName}</span>
                    <span class="tt-pbar"><span style="width:${barPct}%;background:${color}"></span></span>
                    <span class="tt-pval">${mf.fmt(val)}</span>
                </div>`;
            }).join('');

            content += `
            <div class="tt-sec">
                <div class="tt-title">Top partners · net flow${within}</div>
                ${partnerRows}
            </div>`;
        }

        const catTotals = {};
        let countryTotal = 0;
        panelFlows.forEach(d => {
            catTotals[d.flowCategory] = (catTotals[d.flowCategory] || 0) + d.netValue;
            countryTotal += d.netValue;
        });

        if (countryTotal > 0) {
            const catLabels = { 'north-south': 'N→S', 'south-north': 'S→N', 'south-south': 'S→S', 'north-north': 'N→N' };
            const segments = Object.entries(catTotals)
                .sort((a, b) => b[1] - a[1])
                .map(([cat, val]) => ({ cat, pct: (val / countryTotal) * 100 }));

            const barSegments = segments.map(s =>
                `<span style="width:${s.pct}%;background:${CONFIG.flowColors[s.cat]}"></span>`
            ).join('');
            const labelSpans = segments.map(s =>
                `<span class="tt-comp-item"><i style="background:${CONFIG.flowColors[s.cat]}"></i>${catLabels[s.cat]} ${Math.round(s.pct)}%</span>`
            ).join('<span class="tt-sep">·</span>');

            content += `
            <div class="tt-sec">
                <div class="tt-title">Flow composition${within}</div>
                <div class="tt-compbar">${barSegments}</div>
                <div class="tt-comp">${labelSpans}</div>
            </div>`;
        }

        const yearlyTotals = {};
        const _isoTrend = STATE.trendSummary[iso] || {};
        for (let y = 2015; y <= 2024; y++) yearlyTotals[y] = _isoTrend[String(y)] || 0;

        const years = Object.keys(yearlyTotals).map(Number).sort();
        const yVals = years.map(y => yearlyTotals[y]);
        const maxYV = Math.max(...yVals);

        if (maxYV > 0) {
            const W = 140, H = 28, gap = 1.5;
            const barW = (W - gap * (years.length - 1)) / years.length;
            const bars = yVals.map((v, i) => {
                const h = Math.max(1, (v / maxYV) * H);
                const x = i * (barW + gap);
                const isCur = years[i] === STATE.year;
                return `<rect x="${x}" y="${H - h}" width="${barW}" height="${h}" fill="${isCur ? '#004987' : '#C9C2BB'}"/>`;
            }).join('');

            const curIdx = years.indexOf(STATE.year);
            let yoyHtml = '';
            if (curIdx > 0 && yVals[curIdx - 1] > 0) {
                const yoy = ((yVals[curIdx] - yVals[curIdx - 1]) / yVals[curIdx - 1]) * 100;
                yoyHtml = `<span>${signedPct(yoy, 0)} on prev. year</span>`;
            }
            let cagrHtml = '';
            const firstNonZeroIdx = yVals.findIndex(v => v > 0);
            if (firstNonZeroIdx >= 0 && curIdx > firstNonZeroIdx && yVals[firstNonZeroIdx] > 0 && yVals[curIdx] > 0) {
                const n = curIdx - firstNonZeroIdx;
                const cagr = (Math.pow(yVals[curIdx] / yVals[firstNonZeroIdx], 1 / n) - 1) * 100;
                if (isFinite(cagr)) {
                    cagrHtml = `<span title="Average annual growth since the first year with trade">${signedPct(cagr, 1)}/yr</span>`;
                }
            }

            content += `
            <div class="tt-sec">
                <div class="tt-trend-head">
                    <span class="tt-title">Gross trade trend</span>
                    <span class="tt-trend-figs">${yoyHtml}${cagrHtml}</span>
                </div>
                <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="tt-trend">${bars}</svg>
                <div class="tt-years"><span>${years[0]}</span><span>${years[years.length - 1]}</span></div>
            </div>`;
        }

        if (region && region !== 'Other') {
            // Rank by the country's own gross trade among all economies of its
            // region with trade that year — not just the ones drawn on the map.
            const yStr = String(STATE.year);
            const regionCountries = Object.entries(STATE.trendSummary || {})
                .filter(([code, ys]) => (ys[yStr] || 0) > 0 && RegionConfig.getRegion(code) === region)
                .sort((a, b) => b[1][yStr] - a[1][yStr]);
            const rank = regionCountries.findIndex(([code]) => code === iso) + 1;
            const total = regionCountries.length;
            if (rank > 0) {
                content += `
                <div class="tt-rank"><b>${ordinal(rank)}</b> <span>of ${total} in ${region} by gross trade</span></div>`;
            }
        }

        tooltip.innerHTML = content;
        this._positionTooltip(tooltip, event);
    },

    _positionTooltip(tooltip, event) {
        tooltip.style.display = 'block';
        const pad = 15;
        
        // Size and position of the tooltip's parent (the map frame)
        const container = tooltip.parentElement;
        const rect = container.getBoundingClientRect();
        
        // Mouse position relative to the container
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;

        const tw = tooltip.offsetWidth;
        const th = tooltip.offsetHeight;
        
        // Default: below and to the right of the cursor
        let x = mouseX + pad;
        let y = mouseY + pad;

        // Flip to the left of the cursor if it would overflow on the right
        if (x + tw > rect.width - pad) x = mouseX - tw - pad;
        
        // Flip above the cursor if it would overflow at the bottom
        if (y + th > rect.height - pad) y = mouseY - th - pad;
        
        // Final guard: never past the left or top edge of the container
        if (x < pad) x = pad;
        if (y < pad) y = pad;

        tooltip.style.left = x + 'px';
        tooltip.style.top = y + 'px';
    },

    hideTooltip() {
        document.getElementById('tooltip').style.display = 'none';
    },

    setLegendCollapsed(collapsed) {
        const panel = document.getElementById('legend-panel');
        const btn = document.getElementById('legend-toggle');
        if (!panel) return;
        panel.classList.toggle('collapsed', !!collapsed);
        btn?.setAttribute('aria-expanded', String(!collapsed));
    },

    toggleMobileFilter() {
        const panel = document.getElementById('mobile-filter-panel');
        const backdrop = document.getElementById('mobile-filter-backdrop');
        if (!panel) return;
        const isOpen = panel.classList.contains('open');
        if (isOpen) {
            panel.classList.remove('open');
            backdrop.classList.add('hidden');
        } else {
            panel.classList.add('open');
            backdrop.classList.remove('hidden');
        }
    },

    syncMobileFilterState() {
        this.syncControlsFromState();
    },

    // Make every filter control — the desktop bar AND the mobile sheet — show what
    // STATE holds. Controls are matched by their data value, never by the clicked
    // node, so the two surfaces cannot drift apart.
    syncControlsFromState() {
        const region = STATE.region || 'Global';
        document.querySelectorAll('.region-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.region === region);
        });
        const regionSelect = document.getElementById('region-select');
        if (regionSelect) {
            regionSelect.value = region;
            regionSelect.classList.toggle('is-set', region !== 'Global');
        }
        const thresh = (STATE.thresholdMode === 'auto' || STATE.thresholdMode == null) ? 'auto' : String(STATE.thresholdMode);
        document.querySelectorAll('.threshold-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.threshold === thresh);
        });
        this._setActiveTopNButtons(STATE.topNMode == null ? 'all' : String(STATE.topNMode));
        this._setActiveMetricButtons(STATE.metric || 'value');
        this.updateThresholdLabels(STATE.metric || 'value');
        document.querySelectorAll('.flow-checkbox').forEach(cb => { cb.checked = STATE.flowFilters.has(cb.value); });
        ['year-select', 'm-year-select'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = String(STATE.year);
        });
        this._updateFilterIndicators();
    },

    // ── Region, view mode, Lines pop-over, reset ──────────────────────────

    // Region change from the filter bar select or the phone sheet buttons. The
    // pickers list economies of every region, so a region change starts from
    // an empty selection inside the new region.
    setRegion(region) {
        STATE.region = region || 'Global';
        this.syncControlsFromState();
        this.exporterSelector.setCountries([]);
        this.importerSelector.setCountries([]);
        this.updateDashboard();
    },

    // The mode follows from the state, so every path that changes it (tabs,
    // tour, animation hand-back, deep links) shows the right tab.
    currentMode() {
        return (TradeMap.lineFilterMode || STATE.bilateralPairs?.length) ? 'connect' : 'explore';
    },

    async setMode(mode) {
        this._setDisplayMenu(false);
        if (mode === 'animate') {
            startAnimation();          // takes over the screen; Stop hands the view back
            return;
        }
        // Leaving the animation from the tabs: stop it and wait for the hand-back
        if (document.body.classList.contains('anim-mode')) await stopAnimation();
        if (mode === 'connect') {
            if (!STATE.bilateralPairs.length && this._stashedPairs.length) {
                STATE.bilateralPairs = this._stashedPairs.map(p => ({ ...p }));
            }
            this._stashedPairs = [];
            if (!TradeMap.lineFilterMode) TradeMap.enableLineFilter();
            this.updateDashboard(false);
            // Phones: the sheet would cover most of the map, so it opens with the
            // first connection; until then the on-map hint guides the user.
            if (STATE.bilateralPairs.length || !isCompact()) this.openConnectionsPanel();
            else { this.closeInsightPanel(); this.closeConnectionsPanel(); }
            return;
        }
        // Explore: drawn connections are kept aside, the Explore filters apply again
        if (STATE.bilateralPairs.length) {
            this._stashedPairs = STATE.bilateralPairs.map(p => ({ ...p }));
            STATE.bilateralPairs = [];
        }
        if (TradeMap.lineFilterMode) TradeMap.disableLineFilter();
        this.closeConnectionsPanel();
        this.updateDashboard(false);
    },

    _applyModeUI() {
        const mode = this.currentMode();
        // Connections shown with drawing off (tour, older links): drawing goes on,
        // so the Connect tab always behaves the same way.
        if (mode === 'connect' && !TradeMap.lineFilterMode && TradeMap.svg) TradeMap.enableLineFilter();
        document.body.classList.toggle('mode-connect', mode === 'connect');
        document.body.classList.toggle('mode-explore', mode === 'explore');
        const tab = document.body.classList.contains('anim-mode') ? 'animate' : mode;
        document.querySelectorAll('.js-mode').forEach(b => {
            const on = b.dataset.mode === tab;
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', String(on));
        });
    },

    _setDisplayMenu(open) {
        const menu = document.getElementById('display-menu');
        const btn = document.getElementById('display-btn');
        if (!menu) return;
        menu.classList.toggle('hidden', !open);
        btn?.setAttribute('aria-expanded', String(!!open));
        if (!open) return;
        // Right-aligned by default; if that runs off the left edge (button at the
        // start of a wrapped row), align it to the button's left instead.
        menu.classList.add('align-right');
        if (menu.getBoundingClientRect().left < 8) menu.classList.remove('align-right');
    },

    // Short text for the Lines button: what limits the lines on the map.
    _displaySummary() {
        const labels = this.THRESHOLD_LABELS[STATE.metric] || this.THRESHOLD_LABELS.value;
        const auto = STATE.thresholdMode === 'auto' || STATE.thresholdMode == null;
        const topN = STATE.topNMode;
        if (auto) return topN ? `Top ${topN}` : 'Auto';
        const floor = `≥ ${labels[String(STATE.thresholdMode)] || STATE.thresholdMode}`;
        return topN ? `${floor} · top ${topN}` : floor;
    },

    // How many Explore filters differ from the default view.
    _activeFilterCount() {
        let n = 0;
        if (STATE.region && STATE.region !== 'Global') n++;
        if (this.exporterSelector?.getSelectedCountries().length) n++;
        if (this.importerSelector?.getSelectedCountries().length) n++;
        if ((STATE.flowFilters?.size ?? 4) !== 4) n++;
        if (!(STATE.thresholdMode === 'auto' || STATE.thresholdMode == null) || STATE.topNMode) n++;
        return n;
    },

    _updateFilterIndicators() {
        const summary = this._displaySummary();
        const isDefaultLines = summary === 'Auto';
        const sumEl = document.getElementById('display-summary');
        if (sumEl) sumEl.textContent = summary;
        document.getElementById('display-btn')?.classList.toggle('is-set', !isDefaultLines);
        const mSum = document.getElementById('m-display-summary');
        if (mSum) mSum.textContent = summary;

        const n = this._activeFilterCount();
        ['filters-reset', 'm-filters-reset'].forEach(id => {
            const b = document.getElementById(id);
            if (b) b.disabled = n === 0;
        });
        const badge = document.getElementById('mobile-filter-badge');
        if (badge) {
            badge.textContent = n > 0 ? String(n) : '';
            badge.classList.toggle('visible', n > 0);
        }
    },

    // Back to the default Explore view (year and measure stay as chosen).
    resetFilters() {
        STATE.region = 'Global';
        STATE.flowFilters = new Set(['north-south', 'south-north', 'south-south', 'north-north']);
        STATE.thresholdMode = 'auto';
        STATE.topNMode = null;
        this.exporterSelector.setCountries([]);
        this.importerSelector.setCountries([]);
        this._prevSelectionCount = 0;
        this.syncControlsFromState();
        this.updateDashboard();
    },

    // Snapshot of everything the user can set, so a guided tour or the animation
    // can hand the dashboard back exactly as they found it.
    captureViewState() {
        return {
            metric:         STATE.metric,
            year:           STATE.year,
            region:         STATE.region || 'Global',
            flowFilters:    [...STATE.flowFilters],
            thresholdMode:  STATE.thresholdMode,
            topNMode:       STATE.topNMode ?? null,
            exporters:      this.exporterSelector ? this.exporterSelector.getSelectedCountries() : [],
            importers:      this.importerSelector ? this.importerSelector.getSelectedCountries() : [],
            bilateralPairs: (STATE.bilateralPairs || []).map(p => ({ exporter: p.exporter, importer: p.importer })),
            stashedPairs:   this._stashedPairs.map(p => ({ exporter: p.exporter, importer: p.importer })),
            lineFilterMode: !!TradeMap.lineFilterMode,
        };
    },

    async restoreViewState(s) {
        if (!s) return;
        if (s.metric && s.metric !== STATE.metric) {
            const switched = await DataLoader.switchMetric(s.metric);
            if (switched) { this._globalRankCache = {}; TradeMap._lastLegendKey = null; }
        }
        if (s.year !== STATE.year) {
            await DataLoader.loadYear(s.year);
            STATE.year = s.year;
        }
        STATE.region        = s.region;
        STATE.flowFilters   = new Set(s.flowFilters);
        STATE.thresholdMode = s.thresholdMode;
        STATE.topNMode      = s.topNMode;
        STATE.bilateralPairs = s.bilateralPairs.map(p => ({ ...p }));
        if (TradeMap.lineFilterMode !== s.lineFilterMode) {
            s.lineFilterMode ? TradeMap.enableLineFilter() : TradeMap.disableLineFilter();
        }
        this.exporterSelector.setCountries(s.exporters);
        this.importerSelector.setCountries(s.importers);
        // The restored selection is not a "selection was just cleared" transition,
        // so the threshold auto-reset in updateDashboard must not fire.
        this._prevSelectionCount = s.exporters.length + s.importers.length;
        if (Array.isArray(s.stashedPairs)) this._stashedPairs = s.stashedPairs.map(p => ({ ...p }));
        this.syncControlsFromState();
        this.updateDashboard(false);
        this._updateLineFilterUI({ active: TradeMap.lineFilterMode, stage: 'export' });
        if (TradeMap.lineFilterMode || STATE.bilateralPairs.length > 0) this.openConnectionsPanel();
        else this.closeConnectionsPanel();
    }
};

// Inline onclick handlers in dynamically generated HTML require global access
window.App = App;

document.addEventListener('shc:selection-change',  () => App.updateDashboard(false));
document.addEventListener('shc:arc-click',         e  => App.openArcModal(e.detail.exporter, e.detail.importer));
document.addEventListener('shc:country-click',     e  => App.openInsightPanel(e.detail));
document.addEventListener('shc:country-hover',     e  => App.showTooltip(e.detail.event, e.detail.country));
document.addEventListener('shc:country-hoverend',  () => App.hideTooltip());

document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
