// ─────────────────────────────────────────────────────────────────────────────
// Deep linking — the visible view, serialised into the URL hash.
//
// Purpose: a screen shown in a meeting can be sent to someone as a link, and a
// reload returns to the same view instead of the default global 2024 map.
//
// Format (order is fixed so the same view always produces the same string):
//
//   #m=weight&y=2022&r=Africa&t=1000000&n=100&f=ns,sn&x=USA,DEU&i=KEN,TZA
//
//     m  metric              value | weight
//     y  year                2015–2024
//     r  region              Global | Africa | Americas | Asia | Europe | Oceania
//     t  threshold           auto | 10000000 | 1000000 | 500000 | 100000 | 10000
//     n  top-N line limit    all | 50 | 100 | 200 | 500
//     f  flow categories     comma list of ns / sn / ss / nn
//     x  exporters           comma list of ISO3
//     i  importers           comma list of ISO3
//
// `m` and `y` are always written — they are the context a reader needs most.
// Everything else is omitted while it holds its default, so an untouched
// dashboard produces a short link.
//
// Every value is validated against the controls that actually exist in
// index.html (the region / threshold / top-N buttons, the year <select>), so
// there is no second copy of the allowed values to drift out of step, and a
// hand-edited or stale link degrades to the default rather than breaking.
//
// NOT carried in the link: drawn connections (STATE.bilateralPairs), the open
// insight panel, and the map's zoom/pan. Those are transient interaction state
// rather than a filter setting.
// ─────────────────────────────────────────────────────────────────────────────
import { STATE } from './config.js';

const FLOW_CODES = {
    'north-south': 'ns',
    'south-north': 'sn',
    'south-south': 'ss',
    'north-north': 'nn',
};
const FLOW_BY_CODE = Object.fromEntries(Object.entries(FLOW_CODES).map(([k, v]) => [v, k]));
const ALL_FLOWS = Object.keys(FLOW_CODES);

// Allowed-value sets, read from the DOM so the link can never offer a setting
// the UI does not have.
const optionsOf = (selector, attr) =>
    new Set([...document.querySelectorAll(selector)].map(el => el.dataset[attr]));
const years = () =>
    new Set([...document.querySelectorAll('#year-select option')].map(o => o.value));

const isIso3 = (s) => /^[A-Z]{3}$/.test(s);

export const DeepLink = {
    // ── Parse ────────────────────────────────────────────────────────────
    // Returns a plain object holding only the keys that were present AND valid.
    // Anything unrecognised is dropped silently — a shared link should degrade,
    // not throw.
    read() {
        const out = {};
        const raw = (location.hash || '').replace(/^#/, '');
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

        const f = get('f');
        if (f) {
            const cats = f.split(',').map(c => FLOW_BY_CODE[c.trim()]).filter(Boolean);
            // An empty or fully bogus list would blank the map with no way back
            // from the UI, so only accept a list that resolved to something.
            if (cats.length) out.flowFilters = new Set(cats);
        }

        const parseIsos = (v) => v.split(',').map(s => s.trim().toUpperCase()).filter(isIso3);
        const x = get('x'); if (x) out.exporters = parseIsos(x);
        const i = get('i'); if (i) out.importers = parseIsos(i);

        return out;
    },

    // True when the URL actually carried a usable view (as opposed to no hash,
    // or a hash that validated down to nothing).
    isLink(link) {
        return !!link && Object.keys(link).length > 0;
    },

    // ── Restore, phase 1 ─────────────────────────────────────────────────
    // Must run BEFORE DataLoader.loadAll(), which reads STATE.metric and
    // STATE.year to decide which files to fetch. Also syncs the controls that
    // App.syncMobileFilterState() does not cover (year selects, flow checkboxes);
    // the region / threshold / top-N / metric buttons are synced from STATE by
    // syncMobileFilterState() later in App.init().
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
    // Must run AFTER the country selectors have been built. STATE.selected*
    // is overwritten from the selectors on every updateDashboard(), so the
    // selection has to be restored into the selectors, not into STATE.
    applyPostLoad(link, app) {
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
        if (flows.size !== ALL_FLOWS.length) {
            const codes = ALL_FLOWS.filter(c => flows.has(c)).map(c => FLOW_CODES[c]);
            parts.push(`f=${codes.join(',')}`);
        }

        const exp = [...(STATE.selectedExporters || [])].sort();
        const imp = [...(STATE.selectedImporters || [])].sort();
        if (exp.length) parts.push(`x=${exp.join(',')}`);
        if (imp.length) parts.push(`i=${imp.join(',')}`);

        return parts.join('&');
    },

    // ── Write ────────────────────────────────────────────────────────────
    // replaceState, not pushState: every filter click would otherwise add a
    // history entry and the browser Back button would walk the user backwards
    // through their own filtering instead of leaving the page.
    write() {
        // Animation mode overwrites the filters with its own settings and
        // restores them on stop — writing those to the URL would hand out a
        // link to a view the user never chose.
        if (document.body.classList.contains('anim-mode')) return;

        const url = `${location.pathname}${location.search}#${this.serialize()}`;
        if (url === `${location.pathname}${location.search}${location.hash}`) return;
        try {
            history.replaceState(null, '', url);
        } catch {
            // Some embedding contexts (sandboxed iframes) forbid replaceState.
            // The dashboard works fine without deep links, so this is not fatal.
        }
    },
};
