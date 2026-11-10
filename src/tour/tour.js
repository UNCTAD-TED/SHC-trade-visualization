// ─────────────────────────────────────────────────────────────────────────────
// Guided Story tour engine
//
// Drives the real app while a spotlight and a card explain each feature.
// ─────────────────────────────────────────────────────────────────────────────

import { STATE, isCompact } from '../config.js';
import { DataLoader } from '../dataLoader.js';
import { TradeMap } from '../map.js';
import { startAnimation, stopAnimation, isAnimating } from '../sns/animationMode.js';
import { TOUR_STEPS } from './steps.js';

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
    // Bumped by start() and end(); async steps check it so an ended tour's work stops
    _gen: 0,
    _snapshot: null,       // the user's view at tour start
    _ending: null,         // hand-back in progress, if any
    _starting: false,

    // Wire the header button. Call once from App.init().
    // The tour only starts from the button, never by itself.
    init(app) {
        this.app = app;
        this.steps = TOUR_STEPS;
        this._ctx = this._buildContext();

        document.getElementById('tour-btn')?.addEventListener('click', () => this.start());
    },

    _buildContext() {
        return {
            app: this.app,
            STATE, DataLoader, TradeMap, startAnimation, stopAnimation,
            q: (sel) => document.querySelector(sel),
            wait: (ms) => new Promise(r => setTimeout(r, ms)),
            waitFor: (sel, timeout) => this._waitFor(sel, timeout),
            topNetImporter: () => this._extreme('importer'),
            topNetExporter: () => this._extreme('exporter'),
            // Deep-dive importer: an East African SHC importer, else the largest net importer
            pickImporter: () => {
                const flows = STATE.yearCache?.[STATE.year] || [];
                const asImporter = (iso) => flows.some(f => f.importer === iso);
                const present = (iso) => flows.some(f => f.importer === iso || f.exporter === iso);
                for (const iso of ['TZA', 'UGA']) if (asImporter(iso)) return iso;
                for (const iso of ['TZA', 'UGA']) if (present(iso)) return iso;
                return this._extreme('importer');
            },
            topFlow: () => {
                const flows = STATE.yearCache?.[STATE.year] || [];
                let best = null;
                for (const f of flows) if (!best || f.netValue > best.netValue) best = f;
                return best;
            },
            // alive: optional "still current?" check, see goTo()
            resetView: (alive) => this._resetView(alive),
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
            // Let a previous hand-back finish so the snapshot is the user's view
            if (this._ending) { try { await this._ending; } catch { /* ignore */ } }
            // Same for a running bar-chart race, which restores its view on stop
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

        this._mount();
        window.addEventListener('resize', this._onResize);
        document.addEventListener('keydown', this._onKey, true);
        await this.goTo(0);
    },

    // Ends the tour and restores the view the user had when it started
    end() {
        if (!this.active) return this._ending || Promise.resolve();
        this.active = false;
        this._gen++;            // cancels any goTo()/onEnter in flight
        this._busy = false;     // so a new start() is not blocked by them
        this._clearSettle();
        clearTimeout(this._reposTimer);
        window.removeEventListener('resize', this._onResize);
        document.removeEventListener('keydown', this._onKey, true);

        // Remove the card now; the hand-back may await data
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
        // Chapter cleanup first, then stop anything left running
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

        // False once the tour has ended or restarted; also passed to onEnter
        const gen = this._gen;
        const alive = () => this.active && this._gen === gen;

        try {
            const prev = this.steps[this.index];
            if (prev && prev !== step) { try { await prev.onExit?.(this._ctx); } catch (e) { console.warn('tour onExit', e); } }
            if (!alive()) return;

            this.index = i;
            try { await step.onEnter?.(this._ctx, alive); } catch (e) { console.warn('tour onEnter', e); }
            if (!alive()) return;

            // Resolve the target after onEnter (panels may have just opened)
            const sel = typeof step.target === 'function' ? step.target(this._ctx) : step.target;
            let targetEl = null;
            if (sel) targetEl = await this._waitFor(sel, step.targetTimeout ?? 2500);
            if (!alive()) return;

            this._renderCard(step);
            this._place(targetEl, step.placement || 'auto');
            this._updateProgress();
            this._scheduleSettle();
        } finally {
            // Leave the lock alone if a newer tour owns it
            if (this._gen === gen) this._busy = false;
        }
    },

    // Re-anchor a few times to follow CSS transitions (panel slide, map zoom)
    _scheduleSettle() {
        this._clearSettle();
        [140, 360, 680].forEach(d => {
            this._settleTimers.push(setTimeout(() => { if (this.active) this._reanchor(); }, d));
        });
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
        const total = this.steps.length;
        const isLast = this.index === total - 1;

        // One clickable segment per chapter
        const segs = this.steps.map((_, i) =>
            `<button type="button" class="tour-card__dot ${i === this.index ? 'is-active' : i < this.index ? 'is-done' : ''}" data-i="${i}" aria-label="Chapter ${i + 1} of ${total}"></button>`
        ).join('');

        const title = typeof step.title === 'function' ? step.title(this._ctx) : step.title;
        const body  = typeof step.body  === 'function' ? step.body(this._ctx)  : step.body;

        card.innerHTML = `
            <div class="tour-card__progress">${segs}</div>
            <div class="tour-card__top">
                <div class="tour-card__heading">
                    <span class="tour-card__chapter">Guided tour · ${this.index + 1} of ${total}</span>
                    <span class="tour-card__title">${title}</span>
                </div>
                <button class="tour-card__close" title="End tour (Esc)" aria-label="End tour" data-act="end">×</button>
            </div>
            <div class="tour-card__body">${body}</div>
            <div class="tour-card__foot">
                <button class="tour-card__btn tour-card__btn--ghost" data-act="prev" ${this.index === 0 ? 'disabled' : ''}>Back</button>
                <button class="tour-card__btn tour-card__btn--primary" data-act="next">${isLast ? 'Finish' : 'Next'}</button>
            </div>`;

        card.querySelectorAll('[data-act]').forEach(el => {
            el.addEventListener('click', () => {
                const act = el.dataset.act;
                if (act === 'end') this.end();
                else if (act === 'next') this.next();
                else if (act === 'prev') this.prev();
            });
        });
        card.querySelectorAll('.tour-card__dot').forEach(d => {
            d.addEventListener('click', () => this.goTo(+d.dataset.i));
        });
    },

    _updateProgress() {
        const pct = ((this.index + 1) / this.steps.length) * 100;
        if (this._els) this._els.bar.style.width = `${pct}%`;
    },

    // Position the spotlight over the target (or dim the whole screen if none)
    _place(targetEl, placement) {
        if (!this._els) return;
        const spot = this._els.spot;
        const card = this._els.card;
        const step = this.steps[this.index];
        const clear = step?.dim === false;

        if (!targetEl || placement === 'center') {
            spot.classList.toggle('is-clear', clear);
            spot.classList.toggle('is-center', !clear);
            spot.style.top = '50%'; spot.style.left = '50%';
            spot.style.width = '0px'; spot.style.height = '0px';

            // Phones: tour.css places the card
            if (isCompact()) {
                card.style.left = '';
                card.style.top = '';
                return;
            }
            const cw = card.offsetWidth, ch = card.offsetHeight;
            const anchor = step?.cardAnchor || 'center';
            const top = anchor === 'bottom' ? window.innerHeight - ch - 24
                      : anchor === 'top'    ? 24
                      : (window.innerHeight - ch) / 2;
            card.style.left = `${Math.round((window.innerWidth - cw) / 2)}px`;
            card.style.top = `${Math.round(top)}px`;
            return;
        }

        spot.classList.remove('is-center', 'is-clear');
        {
            const r0 = targetEl.getBoundingClientRect();
            const margin = isCompact() ? 60 : 8;
            if (r0.top < margin || r0.bottom > window.innerHeight - margin) targetEl.scrollIntoView({ block: 'center', behavior: 'instant' });
        }
        const r = targetEl.getBoundingClientRect();
        const pad = SPOT_PAD;
        spot.style.top = `${r.top - pad}px`;
        spot.style.left = `${r.left - pad}px`;
        spot.style.width = `${r.width + pad * 2}px`;
        spot.style.height = `${r.height + pad * 2}px`;

        // Phones: move the card clear of the target
        if (isCompact()) {
            const landscape = window.innerWidth > window.innerHeight;
            const cx = r.left + r.width / 2;
            // Landscape: left or right of the target; portrait: top or bottom
            card.classList.toggle('is-left', landscape && cx > window.innerWidth / 2);
            card.classList.toggle('is-right', landscape && cx <= window.innerWidth / 2);
            card.classList.toggle('is-top', !landscape && r.top + r.height / 2 > window.innerHeight / 2);
            card.style.left = '';
            card.style.top = '';
            return;
        }

        // Dock to a corner if the step asks, else place next to the target
        if (step?.dock) this._dockCard(step.dock);
        else this._placeCard(card, r, placement);
    },

    _dockCard(dock) {
        if (!this._els) return;
        const card = this._els.card;
        const m = 16;
        const vw = window.innerWidth, vh = window.innerHeight;
        const cw = card.offsetWidth, ch = card.offsetHeight;
        const headerH = document.querySelector('header')?.getBoundingClientRect().height || 56;
        // Clear the phone bottom bar when shown
        const nav = document.getElementById('mobile-nav');
        const navH = nav?.getClientRects().length ? nav.getBoundingClientRect().height : 0;
        const topY = headerH + m;
        const botY = vh - navH - m - ch;
        const leftX = m;
        const rightX = vw - cw - m;

        let top, left;
        switch (dock) {
            case 'tl': top = topY; left = leftX; break;
            case 'tr': top = topY; left = rightX; break;
            case 'bl': top = botY; left = leftX; break;
            default:   top = botY; left = rightX; break;
        }
        card.style.left = `${Math.round(Math.max(m, Math.min(left, rightX)))}px`;
        card.style.top  = `${Math.round(Math.max(topY, Math.min(top, vh - ch - m)))}px`;
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
            default:       top = r.bottom + gap;    left = cx - cw / 2; break;
        }
        left = Math.max(12, Math.min(left, vw - cw - 12));
        top  = Math.max(12, Math.min(top,  vh - ch - 12));
        card.style.left = `${Math.round(left)}px`;
        card.style.top = `${Math.round(top)}px`;
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

    // Return the app to the default global/value view.
    // Stops if alive() turns false during the metric load (the hand-back owns the view).
    async _resetView(alive = () => true) {
        const app = this.app;
        try {
            STATE.bilateralPairs = [];
            TradeMap.cancelLineDraw?.();
            // Draw mode with no pairs is a blank map, so turn it off
            if (TradeMap.lineFilterMode) TradeMap.disableLineFilter?.();
            app.closeConnectionsPanel?.();
            app._setDisplayMenu?.(false);
            app.closeInsightPanel?.();
            TradeMap.clearFocus?.();

            STATE.flowFilters = new Set(['north-south', 'south-north', 'south-south', 'north-north']);
            document.querySelectorAll('.flow-checkbox').forEach(cb => { cb.checked = true; });

            STATE.thresholdMode = 'auto';

            STATE.topNMode = null;
            app._setActiveTopNButtons?.('all');

            STATE.region = 'Global';
            app.syncControlsFromState?.();   // desktop bar + mobile sheet

            app.exporterSelector?.setCountries([]);
            app.importerSelector?.setCountries([]);

            if (STATE.metric !== 'value') {
                await DataLoader.switchMetric('value');
                if (!alive()) return;
                // Relabel only if the switch committed (a later request may have superseded it)
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

// Stable handler references for add/removeEventListener
Tour._onResize = () => {
    clearTimeout(Tour._reposTimer);
    Tour._reposTimer = setTimeout(() => { if (Tour.active) Tour._reanchor(); }, 120);
};
Tour._onKey = (e) => {
    if (!Tour.active) return;
    if (e.key === 'Escape') { e.preventDefault(); Tour.end(); }
    else if (e.key === 'ArrowRight' || (e.key === ' ' && !e.target?.closest?.('button, a, input, select, textarea, summary'))) { e.preventDefault(); Tour.next(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); Tour.prev(); }
};
