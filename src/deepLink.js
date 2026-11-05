// ─────────────────────────────────────────────────────────────────────────────
// Deep linking — the visible view, serialised into the URL hash.
//
// Purpose: a screen shown in a meeting can be sent to someone as a link, and a
// reload returns to the same view instead of the default global 2024 map.
//
// Format (order is fixed so the same view always produces the same string):
//
//   #m=weight&y=2022&r=Africa&t=1000000&n=100&f=ns,sn&x=USA,DEU&i=KEN,TZA
//   #m=value&y=2024&p=USA-KEN,GBR-GHA
//
//     m  metric              value | weight
//     y  year                2015–2024
//     r  region              Global | Africa | Americas | Asia | Europe | Oceania
//     t  threshold           auto | 10000000 | 1000000 | 500000 | 100000 | 10000
//     n  top-N line limit    all | 50 | 100 | 200 | 500
//     f  flow categories     comma list of ns / sn / ss / nn, or `none` when
//                            every category is switched off
//     x  exporters           comma list of ISO3
//     i  importers           comma list of ISO3
//     p  drawn connections   comma list of EXPORTER-IMPORTER pairs (ISO3-ISO3),
//                            in the order they were drawn
//
// `m` and `y` are always written — they are the context a reader needs most.
// Everything else is omitted while it holds its default, so an untouched
// dashboard produces a short link.
//
// Drawn connections are written as pairs, never as x / i: the pickers mirror
// the pairs' endpoints, but x=USA,GBR&i=KEN,GHA would be read back as every
// exporter × importer combination (4 corridors instead of the 2 drawn). While
// any pair exists, x / i are therefore left out.
//
// Every value is validated against the controls that actually exist in
// index.html (the region / threshold / top-N buttons, the year <select>), so
// there is no second copy of the allowed values to drift out of step, and a
// hand-edited or stale link degrades to the default rather than breaking.
// Country codes are validated once the economies are known (applyPostLoad):
// codes that are not a known economy are dropped.
//
// NOT carried in the link: the open insight panel, the line-draw mode itself
// and the map's zoom/pan. Those are transient interaction state rather than a
// filter setting.
//
// Hash changes in the same tab (a new link pasted into the address bar,
// Back / Forward) re-apply the link by reloading the page; the app's own writes
// use history.replaceState, which does not fire `hashchange`.
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

// Hand-edited links cannot make the app build an unbounded list.
const MAX_CODES = 250;
const MAX_PAIRS = 100;

// Allowed-value sets, read from the DOM so the link can never offer a setting
// the UI does not have.
const optionsOf = (selector, attr) =>
    new Set([...document.querySelectorAll(selector)].map(el => el.dataset[attr]));
const years = () =>
    new Set([...document.querySelectorAll('#year-select option')].map(o => o.value));

const isIso3 = (s) => /^[A-Z]{3}$/.test(s);
const rawHash = () => (location.hash || '').replace(/^#/, '');
const pairKey = (a, b) => [a, b].sort().join('|');

export const DeepLink = {
    // The hash as the app itself last read or wrote it. A `hashchange` to any
    // other value came from outside the app (address bar, Back / Forward).
    _lastHash: null,
    _watching: false,

    // ── Parse ────────────────────────────────────────────────────────────
    // Returns a plain object holding only the keys that were present AND valid.
    // Anything unrecognised is dropped silently — a shared link should degrade,
    // not throw. Country codes are only checked for shape here; whether they
    // are known economies is checked in applyPostLoad, once the data is in.
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
                // Every category switched off. `f=none` is what serialize() writes;
                // a bare `f=` is how earlier versions wrote the same state.
                out.flowFilters = new Set();
            } else {
                const cats = f.split(',').map(c => FLOW_BY_CODE[c.trim()]).filter(Boolean);
                // A fully bogus list falls back to the default (all categories).
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
    // Must run AFTER the data (country names) and the country selectors are
    // ready. STATE.selected* is overwritten from the selectors on every
    // updateDashboard(), so the selection has to be restored into the
    // selectors, not into STATE.
    applyPostLoad(link, app) {
        // Validate country codes now that the economies are known: an economy
        // on the map (STATE.countryNames, from the TopoJSON + meta.json) or in
        // the pickers' classification. Economies with no data at all (see
        // NO_DATA_CODES) are dropped too — they could only show an empty map.
        // Map-only economies stay accepted for x / i because links written
        // before `p` existed carried drawn pairs (e.g. USA→NRU) as x / i.
        const known = (c) => !NO_DATA_CODES.has(c) && (!!STATE.countryNames[c] ||
            !!app.exporterSelector?.hasCountry?.(c) || !!app.importerSelector?.hasCountry?.(c));

        if (link.exporters) link.exporters = link.exporters.filter(known);
        if (link.importers) link.importers = link.importers.filter(known);
        if (link.bilateralPairs) link.bilateralPairs = link.bilateralPairs.filter(p => known(p.exporter) && known(p.importer));
        ['exporters', 'importers', 'bilateralPairs'].forEach(k => { if (link[k] && !link[k].length) delete link[k]; });

        if (link.bilateralPairs) {
            // Drawn connections take precedence over x / i, exactly as in the
            // sender's view (the pickers there mirror the pairs' endpoints).
            STATE.bilateralPairs = link.bilateralPairs.map(p => ({ ...p }));
            if (app._syncBilateralSelectors) app._syncBilateralSelectors();
            app._updateLineFilterUI?.({ active: false, stage: 'export' });
            // The connections panel lists the pairs with their history; it
            // refreshes itself on every later updateDashboard().
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
    // replaceState, not pushState: every filter click would otherwise add a
    // history entry and the browser Back button would walk the user backwards
    // through their own filtering instead of leaving the page.
    write() {
        // Animation mode overwrites the filters with its own settings and
        // restores them on stop — writing those to the URL would hand out a
        // link to a view the user never chose.
        if (document.body.classList.contains('anim-mode')) return;

        const hash = this.serialize();
        this._lastHash = hash;
        const url = `${location.pathname}${location.search}#${hash}`;
        if (url === `${location.pathname}${location.search}${location.hash}`) return;
        try {
            history.replaceState(null, '', url);
        } catch {
            // Some embedding contexts (sandboxed iframes) forbid replaceState.
            // The dashboard works fine without deep links, so this is not fatal.
        }
    },

    // ── Follow hash changes made outside the app ─────────────────────────
    // A link pasted into the address bar of an open tab, or Back / Forward
    // between two links, changes only the hash: the page is not reloaded, so
    // without this the old view would stay on screen and the next filter click
    // would overwrite the new link. Re-applying through a reload goes through
    // exactly the same restore path as opening the link fresh.
    _watch() {
        if (this._watching) return;
        this._watching = true;
        window.addEventListener('hashchange', () => {
            const raw = rawHash();
            if (raw === this._lastHash) return;          // the app's own state
            // Only a view link (key=value…) or a cleared hash is ours to follow.
            if (raw && !raw.includes('=')) return;
            this._lastHash = raw;
            location.reload();
        });
    },
};
