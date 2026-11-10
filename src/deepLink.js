// ─────────────────────────────────────────────────────────────────────────────
// Deep linking — the visible view, serialised into the URL hash.
//
//   #m=weight&y=2022&r=Africa&t=1000000&n=100&f=ns,sn&x=USA,DEU&i=KEN,TZA
//   #m=value&y=2024&p=USA-KEN,GBR-GHA
//
// m metric, y year, r region, t threshold, n top-N limit, f flow categories
// (ns,sn,ss,nn or none), x / i exporters / importers, p drawn EXPORTER-IMPORTER pairs.
// m and y are always written; other keys only when not at their default.
// With pairs present, x / i are omitted: they would read back as every exporter × importer pair.
// Values are checked against the controls in index.html; invalid ones fall back to the default.
// ─────────────────────────────────────────────────────────────────────────────
import { STATE } from './config.js';
import { NO_DATA_CODES } from './countrySelector.js';

const FLOW_CODES = {
    'north-south': 'ns',
    'south-north': 'sn',
    'south-south': 'ss',
    'north-north': 'nn',
};
const FLOW_BY_CODE = Object.fromEntries(Object.entries(FLOW_CODES).map(([k, v]) => [v, k]));
const ALL_FLOWS = Object.keys(FLOW_CODES);
const FLOWS_NONE = 'none';

// Caps for hand-edited links
const MAX_CODES = 250;
const MAX_PAIRS = 100;

const optionsOf = (selector, attr) =>
    new Set([...document.querySelectorAll(selector)].map(el => el.dataset[attr]));
const years = () =>
    new Set([...document.querySelectorAll('#year-select option')].map(o => o.value));

const isIso3 = (s) => /^[A-Z]{3}$/.test(s);
const rawHash = () => (location.hash || '').replace(/^#/, '');
const pairKey = (a, b) => [a, b].sort().join('|');

export const DeepLink = {
    // Last hash the app read or wrote; any other value came from outside
    _lastHash: null,
    _watching: false,

    // ── Parse ────────────────────────────────────────────────────────────
    // Returns only the keys that are present and valid; anything else is dropped.
    read() {
        this._watch();
        const out = {};
        const raw = rawHash();
        this._lastHash = raw;
        if (!raw) return out;

        const params = new URLSearchParams(raw);
        const get = (k) => params.get(k)?.trim() || '';

        const m = get('m');
        if (m === 'value' || m === 'weight') out.metric = m;

        const y = get('y');
        if (years().has(y)) out.year = +y;

        const r = get('r');
        if (optionsOf('.region-btn', 'region').has(r)) out.region = r;

        const t = get('t');
        if (optionsOf('.threshold-btn', 'threshold').has(t)) out.thresholdMode = t === 'auto' ? 'auto' : +t;

        const n = get('n');
        if (optionsOf('.topn-btn', 'topn').has(n)) out.topNMode = n === 'all' ? null : +n;

        if (params.has('f')) {
            const f = get('f');
            if (f === '' || f.toLowerCase() === FLOWS_NONE) {
                // All categories off (a bare f= from older links means the same)
                out.flowFilters = new Set();
            } else {
                const cats = f.split(',').map(c => FLOW_BY_CODE[c.trim()]).filter(Boolean);
                // An invalid list falls back to all categories
                if (cats.length) out.flowFilters = new Set(cats);
            }
        }

        const parseIsos = (v) => [...new Set(
            v.split(',').map(s => s.trim().toUpperCase()).filter(isIso3)
        )].slice(0, MAX_CODES);
        const x = get('x'); if (x) out.exporters = parseIsos(x);
        const i = get('i'); if (i) out.importers = parseIsos(i);

        const p = get('p');
        if (p) {
            const seen = new Set();
            const pairs = [];
            for (const tok of p.split(',')) {
                const [a, b, extra] = tok.trim().toUpperCase().split('-');
                if (extra !== undefined || !isIso3(a) || !isIso3(b) || a === b) continue;
                const k = pairKey(a, b);           // undirected, as App.addBilateralPair
                if (seen.has(k)) continue;
                seen.add(k);
                pairs.push({ exporter: a, importer: b });
                if (pairs.length >= MAX_PAIRS) break;
            }
            if (pairs.length) out.bilateralPairs = pairs;
        }

        return out;
    },

    // ── Restore, phase 1 ─────────────────────────────────────────────────
    // Runs before DataLoader.loadAll(), which reads STATE.metric and STATE.year.
    // The buttons are synced later by App.syncMobileFilterState().
    applyPreLoad(link) {
        if (link.metric) STATE.metric = link.metric;
        if (link.year) STATE.year = link.year;
        if (link.region) STATE.region = link.region;
        if (link.thresholdMode !== undefined) STATE.thresholdMode = link.thresholdMode;
        if (link.topNMode !== undefined) STATE.topNMode = link.topNMode;
        if (link.flowFilters) STATE.flowFilters = link.flowFilters;

        ['year-select', 'm-year-select'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = String(STATE.year);
        });
        document.querySelectorAll('.flow-checkbox').forEach(cb => {
            cb.checked = STATE.flowFilters.has(cb.value);
        });
    },

    // ── Restore, phase 2 ─────────────────────────────────────────────────
    // Runs after the data and country selectors are ready. The selection goes
    // into the selectors, since updateDashboard() copies STATE.selected* from them.
    applyPostLoad(link, app) {
        // Drop codes that are not a known economy or have no data at all
        const known = (c) => !NO_DATA_CODES.has(c) && (!!STATE.countryNames[c] ||
            !!app.exporterSelector?.hasCountry?.(c) || !!app.importerSelector?.hasCountry?.(c));

        if (link.exporters) link.exporters = link.exporters.filter(known);
        if (link.importers) link.importers = link.importers.filter(known);
        if (link.bilateralPairs) link.bilateralPairs = link.bilateralPairs.filter(p => known(p.exporter) && known(p.importer));
        ['exporters', 'importers', 'bilateralPairs'].forEach(k => { if (link[k] && !link[k].length) delete link[k]; });

        if (link.bilateralPairs) {
            // Drawn pairs: updateDashboard() switches to the Connect tab
            STATE.bilateralPairs = link.bilateralPairs.map(p => ({ ...p }));
            Promise.resolve(app.openConnectionsPanel?.())
                .catch(err => console.warn('DeepLink: could not open the connections panel', err));
            return;
        }
        if (link.exporters?.length) app.exporterSelector?.setCountries(link.exporters);
        if (link.importers?.length) app.importerSelector?.setCountries(link.importers);
    },

    // ── Serialise ────────────────────────────────────────────────────────
    serialize() {
        const parts = [`m=${STATE.metric}`, `y=${STATE.year}`];

        if (STATE.region && STATE.region !== 'Global') parts.push(`r=${encodeURIComponent(STATE.region)}`);
        if (STATE.thresholdMode !== 'auto') parts.push(`t=${STATE.thresholdMode}`);
        if (STATE.topNMode) parts.push(`n=${STATE.topNMode}`);

        const flows = STATE.flowFilters || new Set();
        if (flows.size === 0) {
            parts.push(`f=${FLOWS_NONE}`);
        } else if (flows.size !== ALL_FLOWS.length) {
            const codes = ALL_FLOWS.filter(c => flows.has(c)).map(c => FLOW_CODES[c]);
            parts.push(`f=${codes.join(',')}`);
        }

        const pairs = STATE.bilateralPairs || [];
        if (pairs.length) {
            parts.push(`p=${pairs.map(p => `${p.exporter}-${p.importer}`).join(',')}`);
        } else {
            const exp = [...(STATE.selectedExporters || [])].sort();
            const imp = [...(STATE.selectedImporters || [])].sort();
            if (exp.length) parts.push(`x=${exp.join(',')}`);
            if (imp.length) parts.push(`i=${imp.join(',')}`);
        }

        return parts.join('&');
    },

    // ── Write ────────────────────────────────────────────────────────────
    // replaceState, so filter clicks do not fill the Back button history
    write() {
        // Animation mode uses its own temporary filters; keep them out of the link
        if (document.body.classList.contains('anim-mode')) return;

        const hash = this.serialize();
        this._lastHash = hash;
        const url = `${location.pathname}${location.search}#${hash}`;
        if (url === `${location.pathname}${location.search}${location.hash}`) return;
        try {
            history.replaceState(null, '', url);
        } catch {
            // Sandboxed iframes may forbid replaceState; not fatal
        }
    },

    // ── Follow hash changes made outside the app ─────────────────────────
    // A pasted link or Back / Forward changes only the hash; reload to restore it
    _watch() {
        if (this._watching) return;
        this._watching = true;
        window.addEventListener('hashchange', () => {
            const raw = rawHash();
            if (raw === this._lastHash) return;          // the app's own state
            // Only follow view links (key=value), not e.g. an href="#" on the host page
            if (!raw?.includes('=')) return;
            this._lastHash = raw;
            location.reload();
        });
    },
};
