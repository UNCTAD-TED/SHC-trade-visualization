// ─────────────────────────────────────────────────────────────────────────────
// Guided Story tour engine
//
// A lightweight, dependency-free walkthrough that *drives the real app* (it calls
// the same App / DataLoader / TradeMap APIs the UI uses) while a moving spotlight
// and a UNCTAD-styled narration card explain each feature. Every chapter performs
// its action live; the user advances manually (Next / Back / dots / arrow keys).
// ─────────────────────────────────────────────────────────────────────────────

import { STATE } from '../config.js';
import { DataLoader } from '../dataLoader.js';
import { TradeMap } from '../map.js';
import { startAnimation, stopAnimation, isAnimating } from '../sns/animationMode.js';
import { TOUR_STEPS } from './steps.js';

const SEEN_KEY = 'shc_tour_seen_v1';
const SPOT_PAD = 8;

export const Tour = {
    app: null,
    steps: [],
    index: 0,
    active: false,
    _reposTimer: null,
    _settleTimers: [],
    _els: null,            // { spot, card, bar }
    _ctx: null,
    _busy: false,
    // Generation: bumped by start() and end(). Every async step of goTo()/onEnter
    // re-checks it, so work begun by a tour that has since ended stops there
    // instead of opening panels or drawing pairs over the restored view.
    _gen: 0,
    _snapshot: null,       // the user's view when the tour started (App.captureViewState)
    _ending: null,         // promise of the hand-back in progress, if any
    _starting: false,

    // Wire the header button + first-visit auto-launch. Call once from App.init().
    // opts.autoLaunch = false suppresses the first-visit auto-open. App passes
    // false when the URL carries a deep link: the tour resets every filter to its
    // default, which would silently discard the view the link was meant to show.
    // The Tour button in the header still works.
    init(app, opts = {}) {
        this.app = app;
        this.steps = TOUR_STEPS;
        this._ctx = this._buildContext();

        document.getElementById('tour-btn')?.addEventListener('click', () => this.start());

        // First visit → auto-open once (the user then advances manually)
        let seen = false;
        try { seen = !!localStorage.getItem(SEEN_KEY); } catch { /* private mode */ }
        if (!seen && opts.autoLaunch !== false) {
            setTimeout(() => { if (!this.active) this.start(); }, 900);
        }
    },

    _buildContext() {
        const tour = this;
        return {
            app: this.app,
            STATE, DataLoader, TradeMap, startAnimation, stopAnimation,
            q: (sel) => document.querySelector(sel),
            wait: (ms) => new Promise(r => setTimeout(r, ms)),
            waitFor: (sel, timeout) => tour._waitFor(sel, timeout),
            // Pick the largest net importer currently visible (for the deep-dive).
            topNetImporter: () => tour._extreme('importer'),
            topNetExporter: () => tour._extreme('exporter'),
            // Preferred importer to spotlight in the deep-dive: a recognisable East
            // African used-clothing importer, falling back to the largest net importer.
            pickImporter: () => {
                const flows = STATE.yearCache?.[STATE.year] || [];
                const asImporter = (iso) => flows.some(f => f.importer === iso);
                const present = (iso) => flows.some(f => f.importer === iso || f.exporter === iso);
                for (const iso of ['TZA', 'UGA']) if (asImporter(iso)) return iso;
                for (const iso of ['TZA', 'UGA']) if (present(iso)) return iso;
                return tour._extreme('importer');
            },
            // The single biggest net flow this year (for the bilateral demo).
            topFlow: () => {
                const flows = STATE.yearCache?.[STATE.year] || [];
                let best = null;
                for (const f of flows) if (!best || f.netValue > best.netValue) best = f;
                return best;
            },
            // alive (optional): the step's "still current?" check — see goTo().
            resetView: (alive) => tour._resetView(alive),
        };
    },

    // Biggest net exporter / importer among the visible node stats.
    _extreme(role) {
        const stats = (STATE.nodeStats && Object.keys(STATE.nodeStats).length)
            ? STATE.nodeStats : STATE.rawNodeStats || {};
        let pick = null;
        for (const [iso, s] of Object.entries(stats)) {
            const v = s.netBalance;
            if (role === 'importer') { if (!pick || v < pick.v) pick = { iso, v }; }
            else                     { if (!pick || v > pick.v) pick = { iso, v }; }
        }
        return pick?.iso || null;
    },

    // ── Lifecycle ───────────────────────────────────────────────────────────
    async start() {
        if (this.active || this._starting) return;
        this._starting = true;
        try {
            // A previous tour may still be handing the dashboard back; the
            // snapshot below must be of the user's view, not a half-restored one.
            if (this._ending) { try { await this._ending; } catch { /* ignore */ } }
            // Likewise, a running bar-chart race is not the user's view: end it
            // (it restores the view it found) before taking the snapshot.
            if (isAnimating()) { try { await stopAnimation(); } catch { /* ignore */ } }
            if (this.active) return;

            this._snapshot = this._captureView();
            this.active = true;
            this._gen++;
            this._busy = false;
            this.index = 0;
        } finally {
            this._starting = false;
        }
        try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }

        this._mount();
        window.addEventListener('resize', this._onResize);
        document.addEventListener('keydown', this._onKey, true);
        await this.goTo(0);
    },

    // Ends the tour (Done, ×, Esc) and hands the dashboard back exactly as the
    // user left it when the tour started: metric, year, region, filters,
    // selections, drawn connections, and the country panel if one was open.
    end() {
        if (!this.active) return this._ending || Promise.resolve();
        this.active = false;
        this._gen++;            // invalidates every goTo()/onEnter still in flight
        this._busy = false;     // ...so a fresh start() is never blocked by them
        this._clearSettle();
        clearTimeout(this._reposTimer);
        window.removeEventListener('resize', this._onResize);
        document.removeEventListener('keydown', this._onKey, true);

        // Take the card down straight away — the hand-back below may await data.
        if (this._els) {
            const els = this._els; this._els = null;
            els.card.style.opacity = '0';
            els.spot.style.opacity = '0';
            setTimeout(() => { els.spot.remove(); els.card.remove(); els.bar.remove(); }, 260);
        }

        const step = this.steps[this.index];
        const snap = this._snapshot;
        this._snapshot = null;
        const done = this._handBack(step, snap).finally(() => {
            if (this._ending === done) this._ending = null;
        });
        this._ending = done;
        return done;
    },

    async _handBack(step, snap) {
        const app = this.app;
        // The current chapter's own cleanup first (e.g. the animation chapter
        // stops the race), then end anything a chapter may have left running.
        try { await step?.onExit?.(this._ctx); } catch (e) { console.warn('tour onExit', e); }
        try { await stopAnimation(); } catch { /* ignore */ }
        try {
            TradeMap.cancelLineDraw?.();
            app.closeInsightPanel?.();      // also closes the connections panel
            TradeMap.clearFocus?.();
        } catch (e) { console.warn('tour cleanup', e); }

        if (snap?.view && app.restoreViewState) {
            try {
                await app.restoreViewState(snap.view);
                if (snap.panelIso && !STATE.bilateralPairs?.length && !TradeMap.lineFilterMode) {
                    app.openInsightPanel?.(snap.panelIso);
                }
                setTimeout(() => TradeMap.zoomToRegion(STATE.region || 'Global'), 60);
                return;
            } catch (e) { console.warn('tour restore', e); }
        }
        // No snapshot API (older controller): fall back to the default view.
        await this._resetView();
    },

    _captureView() {
        const app = this.app;
        const view = app?.captureViewState?.();
        if (!view) return null;
        const panelOpen = document.getElementById('insight-panel')?.classList.contains('open');
        return { view, panelIso: panelOpen ? (app._currentPanelIso || null) : null };
    },

    async next() { if (this.index < this.steps.length - 1) await this.goTo(this.index + 1); else await this.end(); },
    async prev() { if (this.index > 0) await this.goTo(this.index - 1); },

    async goTo(i) {
        if (this._busy || !this.active) return;
        const step = this.steps[i];
        if (!step) return;
        this._busy = true;
        this._clearSettle();

        // alive(): is this navigation still the current one? False once the
        // tour has ended (or ended and restarted) — every await re-checks it,
        // and chapters receive it as onEnter's second argument for theirs.
        const gen = this._gen;
        const alive = () => this.active && this._gen === gen;

        try {
            const prev = this.steps[this.index];
            if (prev && prev !== step) { try { await prev.onExit?.(this._ctx); } catch (e) { console.warn('tour onExit', e); } }
            if (!alive()) return;

            this.index = i;
            try { await step.onEnter?.(this._ctx, alive); } catch (e) { console.warn('tour onEnter', e); }
            if (!alive()) return;

            // Resolve the target after the action has run (panels may have just opened)
            const sel = typeof step.target === 'function' ? step.target(this._ctx) : step.target;
            let targetEl = null;
            if (sel) targetEl = await this._waitFor(sel, step.targetTimeout ?? 2500);
            if (!alive()) return;

            this._renderCard(step);
            this._place(targetEl, step.placement || 'auto');
            this._updateProgress();

            // Re-measure shortly after, so spotlights on elements that slide/zoom in
            // (e.g. the insight side-panel) settle onto their final position.
            this._scheduleSettle();
        } finally {
            // end() already released the lock for a newer tour; leave it alone.
            if (this._gen === gen) this._busy = false;
        }
    },

    // Re-anchor a few times after a step renders to catch CSS transitions
    // (panel slide ~300ms, map zoom) without any auto-advance.
    _scheduleSettle() {
        this._clearSettle();
        [140, 360, 680].forEach(d =>
            this._settleTimers.push(setTimeout(() => { if (this.active) this._reanchor(); }, d)));
    },
    _clearSettle() {
        this._settleTimers.forEach(clearTimeout);
        this._settleTimers = [];
    },

    // ── DOM ─────────────────────────────────────────────────────────────────
    _mount() {
        const spot = document.createElement('div'); spot.className = 'tour-spot';
        const bar  = document.createElement('div'); bar.className = 'tour-progressbar';
        const card = document.createElement('div'); card.className = 'tour-card';
        document.body.append(spot, bar, card);
        this._els = { spot, card, bar };
    },

    _renderCard(step) {
        if (!this._els) return;
        const card = this._els.card;
        const n = String(this.index + 1).padStart(2, '0');
        const total = String(this.steps.length).padStart(2, '0');
        const isLast = this.index === this.steps.length - 1;

        const dots = this.steps.map((_, i) =>
            `<span class="tour-card__dot ${i === this.index ? 'is-active' : i < this.index ? 'is-done' : ''}" data-i="${i}"></span>`
        ).join('');

        const title = typeof step.title === 'function' ? step.title(this._ctx) : step.title;
        const body  = typeof step.body  === 'function' ? step.body(this._ctx)  : step.body;

        card.innerHTML = `
            <div class="tour-card__top">
                <span class="tour-card__chapter">${n} / ${total}</span>
                <span class="tour-card__title">${title}</span>
                <button class="tour-card__close" title="End tour (Esc)" data-act="end">×</button>
            </div>
            <div class="tour-card__body">${body}</div>
            <div class="tour-card__foot">
                <div class="tour-card__dots">${dots}</div>
                <button class="tour-card__btn tour-card__btn--ghost" data-act="prev" ${this.index === 0 ? 'disabled' : ''}>Back</button>
                <button class="tour-card__btn tour-card__btn--primary" data-act="next">${isLast ? 'Done' : 'Next →'}</button>
            </div>`;

        card.querySelectorAll('[data-act]').forEach(el => {
            el.addEventListener('click', () => {
                const act = el.dataset.act;
                if (act === 'end') this.end();
                else if (act === 'next') this.next();
                else if (act === 'prev') this.prev();
            });
        });
        card.querySelectorAll('.tour-card__dot').forEach(d =>
            d.addEventListener('click', () => this.goTo(+d.dataset.i)));
    },

    _updateProgress() {
        const pct = ((this.index + 1) / this.steps.length) * 100;
        if (this._els) this._els.bar.style.width = pct + '%';
    },

    // Position the spotlight over the target (or full-dim center if none)
    _place(targetEl, placement) {
        if (!this._els) return;
        const spot = this._els.spot;
        const card = this._els.card;
        const step = this.steps[this.index];
        const clear = step?.dim === false;   // e.g. the animation chapter — keep the view visible

        if (!targetEl || placement === 'center') {
            spot.classList.toggle('is-clear', clear);
            spot.classList.toggle('is-center', !clear);
            spot.style.top = '50%'; spot.style.left = '50%';
            spot.style.width = '0px'; spot.style.height = '0px';

            const cw = card.offsetWidth, ch = card.offsetHeight;
            const anchor = step?.cardAnchor || 'center';
            const top = anchor === 'bottom' ? window.innerHeight - ch - 24
                      : anchor === 'top'    ? 24
                      : (window.innerHeight - ch) / 2;
            card.style.left = Math.round((window.innerWidth - cw) / 2) + 'px';
            card.style.top = Math.round(top) + 'px';
            return;
        }

        spot.classList.remove('is-center', 'is-clear');
        const r = targetEl.getBoundingClientRect();
        const pad = SPOT_PAD;
        spot.style.top = (r.top - pad) + 'px';
        spot.style.left = (r.left - pad) + 'px';
        spot.style.width = (r.width + pad * 2) + 'px';
        spot.style.height = (r.height + pad * 2) + 'px';

        // Prefer docking the card to a fixed corner (keeps the map visible);
        // fall back to placing it adjacent to the target.
        if (step?.dock) this._dockCard(step.dock);
        else this._placeCard(card, r, placement);
    },

    // Dock the card into a screen corner, clearing the header and KPI bar so it
    // never floats over the centre of the map.
    _dockCard(dock) {
        if (!this._els) return;
        const card = this._els.card;
        const m = 16;
        const vw = window.innerWidth, vh = window.innerHeight;
        const cw = card.offsetWidth, ch = card.offsetHeight;
        const headerH = document.querySelector('header')?.getBoundingClientRect().height || 56;
        const kpiH = document.getElementById('kpi-bar')?.getBoundingClientRect().height || 0;
        const topY = headerH + m;
        const botY = vh - kpiH - m - ch;
        const leftX = m;
        const rightX = vw - cw - m;

        let top, left;
        switch (dock) {
            case 'tl': top = topY; left = leftX; break;
            case 'tr': top = topY; left = rightX; break;
            case 'bl': top = botY; left = leftX; break;
            case 'br': default: top = botY; left = rightX; break;
        }
        card.style.left = Math.round(Math.max(m, Math.min(left, rightX))) + 'px';
        card.style.top  = Math.round(Math.max(topY, Math.min(top, vh - ch - m))) + 'px';
    },

    _placeCard(card, r, placement) {
        const gap = 16, vw = window.innerWidth, vh = window.innerHeight;
        const cw = card.offsetWidth, ch = card.offsetHeight;
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;

        // Auto: pick the side with the most room
        let place = placement;
        if (place === 'auto') {
            const room = { bottom: vh - r.bottom, top: r.top, right: vw - r.right, left: r.left };
            place = Object.entries(room).sort((a, b) => b[1] - a[1])[0][0];
        }

        let top, left;
        switch (place) {
            case 'top':    top = r.top - ch - gap;  left = cx - cw / 2; break;
            case 'left':   top = cy - ch / 2;       left = r.left - cw - gap; break;
            case 'right':  top = cy - ch / 2;       left = r.right + gap; break;
            case 'bottom':
            default:       top = r.bottom + gap;    left = cx - cw / 2; break;
        }
        // Clamp into the viewport
        left = Math.max(12, Math.min(left, vw - cw - 12));
        top  = Math.max(12, Math.min(top,  vh - ch - 12));
        card.style.left = Math.round(left) + 'px';
        card.style.top = Math.round(top) + 'px';
    },

    // ── Helpers ───────────────────────────────────────────────────────────────
    _waitFor(selector, timeout = 2500) {
        return new Promise(resolve => {
            const found = document.querySelector(selector);
            if (found) return resolve(found);
            const t0 = performance.now();
            const tick = () => {
                const el = document.querySelector(selector);
                if (el) return resolve(el);
                if (performance.now() - t0 > timeout) return resolve(null);
                requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        });
    },

    // Return the app to a clean, predictable global/value view.
    // alive (optional): when it turns false during the metric load, the tour has
    // ended and its hand-back owns the view — stop instead of overwriting it.
    async _resetView(alive = () => true) {
        const app = this.app;
        try {
            STATE.bilateralPairs = [];
            TradeMap.cancelLineDraw?.();
            // Draw mode shows only drawn pairs (none now) — i.e. a blank map.
            // The hand-back at the end turns it on again if the user had it on.
            if (TradeMap.lineFilterMode) TradeMap.disableLineFilter?.();
            app.closeConnectionsPanel?.();
            app.closeInsightPanel?.();
            TradeMap.clearFocus?.();

            // Flows: all on
            STATE.flowFilters = new Set(['north-south', 'south-north', 'south-south', 'north-north']);
            document.querySelectorAll('.flow-checkbox').forEach(cb => { cb.checked = true; });

            // Threshold: auto
            STATE.thresholdMode = 'auto';

            // Top-N line limit: off
            STATE.topNMode = null;
            app._setActiveTopNButtons?.('all');

            // Region: Global
            STATE.region = 'Global';
            app.syncControlsFromState?.();   // desktop bar + mobile sheet

            // Selections: none
            app.exporterSelector?.setCountries([]);
            app.importerSelector?.setCountries([]);

            // Metric: value
            if (STATE.metric !== 'value') {
                await DataLoader.switchMetric('value');
                if (!alive()) return;
                // Only relabel when the switch actually committed (a later
                // request may have superseded it while the files loaded).
                if (STATE.metric === 'value') {
                    app._globalRankCache = {};
                    TradeMap._lastLegendKey = null;
                }
                app._setActiveMetricButtons(STATE.metric);
                app.updateThresholdLabels(STATE.metric);
            }

            app.updateDashboard(false);
            setTimeout(() => { if (alive()) TradeMap.zoomToRegion('Global'); }, 60);
        } catch (e) { console.warn('tour resetView', e); }
    },

    // Reposition spotlight/card on resize (debounced)
    _onResize: null,
    _onKey: null,

    // Re-anchor on the current step's target without re-running its action
    async _reanchor() {
        const step = this.steps[this.index];
        if (!step || !this._els) return;
        const sel = typeof step.target === 'function' ? step.target(this._ctx) : step.target;
        const el = sel ? document.querySelector(sel) : null;
        this._place(el, step.placement || 'auto');
    },
};

// Bind event handlers (need stable references for add/removeEventListener)
Tour._onResize = () => {
    clearTimeout(Tour._reposTimer);
    Tour._reposTimer = setTimeout(() => { if (Tour.active) Tour._reanchor(); }, 120);
};
Tour._onKey = (e) => {
    if (!Tour.active) return;
    if (e.key === 'Escape') { e.preventDefault(); Tour.end(); }
    else if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); Tour.next(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); Tour.prev(); }
};
