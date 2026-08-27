// ─────────────────────────────────────────────────────────────────────────────
// CSV Export — analyst-ready, scope-anchored table extraction.
//
// Exports are anchored to whatever the user is already focused on, so they receive
// the narrowest meaningful slice rather than the whole global matrix:
//
//   • Country  — from the country Insight panel: one row per trading partner, both
//                directions (exports / imports), value + weight + unit value.
//   • Corridor — from the bilateral (arc) modal: one row per year 2015–2024 with both
//                directions of a single country pair.
//   • View     — from the header menu: the current map scope (year · region · selection ·
//                drawn connections · flow-direction), as flows or a country summary.
//
// All tables ignore the on-screen magnitude threshold and the 40-arc auto cap —
// those declutter the map, whereas a CSV has no visual-overload limit, so analysts
// get the full data for the chosen scope. The one display control that IS carried
// through is the explicit "Lines" Top-N limit (STATE.topNMode): it is a deliberate
// "give me the top N corridors" request rather than a decluttering side effect, so
// the export matches what is on screen. Value is USD, weight is kilograms, unit
// value is USD/kg.
// ─────────────────────────────────────────────────────────────────────────────
import { CONFIG, STATE } from './config.js';
import { RegionConfig } from './regions.js';
import { DataLoader } from './dataLoader.js';

const YEARS = Array.from({ length: 2024 - 2015 + 1 }, (_, i) => 2015 + i);

const nameOf   = (iso) => STATE.countryNames[iso] || iso;
const statusOf = (iso) => (CONFIG.development[iso] === 'north' ? 'Developed' : 'Developing');
const regionOf = (iso) => { const r = RegionConfig.getRegion(iso); return r === 'Other' ? '' : r; };
const pairKey  = (a, b) => [a, b].sort().join('|');

// ── Data access helpers ──────────────────────────────────────────────────────
// Ensure both metrics' year data + bilateral history are loaded (the detailed
// per-country / per-corridor tables need both directions and both units).
async function ensureLoaded() {
    await Promise.all([
        DataLoader.loadYear(STATE.year, 'value'),
        DataLoader.loadYear(STATE.year, 'weight'),
        DataLoader._loadBilateral('value'),
        DataLoader._loadBilateral('weight'),
    ]);
}

// Per-metric net-flow lookup by undirected pair (fallback when no bilateral history).
function netMap(metric, year = STATE.year) {
    const m = new Map();
    ((STATE.metricStore[metric]?.years?.[year]) || []).forEach(d => m.set(pairKey(d.exporter, d.importer), d));
    return m;
}

// Directional flow for a pair in a given metric/year, oriented as { out: iso→partner,
// in: partner→iso }. Prefers gross bilateral history; falls back to the net dataset.
function dirFlow(metric, iso, partner, year, fallback) {
    const bh = STATE.metricStore[metric]?.bilateralHistory;
    if (bh) {
        const [a, b] = [iso, partner].sort();
        const entry = bh[`${a}|${b}`]?.[String(year)];
        if (entry) {
            const isoIsA = iso === a;
            return { out: (isoIsA ? entry.aToB : entry.bToA) || 0, in: (isoIsA ? entry.bToA : entry.aToB) || 0 };
        }
    }
    const nf = fallback?.get(pairKey(iso, partner));
    if (nf) return nf.exporter === iso ? { out: nf.netValue, in: 0 } : { out: 0, in: nf.netValue };
    return { out: 0, in: 0 };
}

// ── CSV primitives ───────────────────────────────────────────────────────────
function csvCell(v) {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const toCSV = (rows) => rows.map(r => r.map(csvCell).join(',')).join('\r\n');

const BOM = String.fromCharCode(0xFEFF);   // makes Excel read the CSV as UTF-8

function download(filename, csv) {
    const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const today  = () => new Date().toISOString().slice(0, 10);
const round  = (v, dp = 0) => (v === '' || v == null || !isFinite(v)) ? '' : +(+v).toFixed(dp);
const unitVal = (usd, kg) => (usd && kg && kg > 0) ? round(usd / kg, 3) : '';

const CAT_LABEL = {
    'north-south': 'North->South', 'south-north': 'South->North',
    'south-south': 'South->South', 'north-north': 'North->North',
};

// ── In-scope flows (pre-threshold) for the header "current view" exports ─────
function scopedFlows(metric) {
    let flows = (STATE.metricStore[metric]?.years?.[STATE.year]) || [];
    if (STATE.bilateralPairs && STATE.bilateralPairs.length > 0) {
        const keys = new Set(STATE.bilateralPairs.map(p => pairKey(p.exporter, p.importer)));
        flows = flows.filter(d => keys.has(pairKey(d.exporter, d.importer)));
    } else {
        if (STATE.region && STATE.region !== 'Global') {
            flows = flows.filter(d =>
                RegionConfig.getRegion(d.exporter) === STATE.region &&
                RegionConfig.getRegion(d.importer) === STATE.region);
        }
        if (STATE.selectedExporters.size) flows = flows.filter(d => STATE.selectedExporters.has(d.exporter));
        if (STATE.selectedImporters.size) flows = flows.filter(d => STATE.selectedImporters.has(d.importer));
    }
    // Top-N limit, applied before the flow-category filter — same order as
    // DataLoader.filterData, so the export and the map agree row-for-arc.
    if (STATE.topNMode) {
        flows = flows.slice().sort((a, b) => b.netValue - a.netValue).slice(0, STATE.topNMode);
    }
    return flows.filter(d => STATE.flowFilters.has(d.flowCategory));
}

function scopeTag() {
    if (STATE.bilateralPairs?.length) return 'connections';
    const parts = [STATE.region && STATE.region !== 'Global' ? STATE.region : 'Global'];
    if (STATE.selectedExporters.size) parts.push(`${STATE.selectedExporters.size}exp`);
    if (STATE.selectedImporters.size) parts.push(`${STATE.selectedImporters.size}imp`);
    return parts.join('-');
}

// Human-readable scope label + corridor count, shown live in the header menu.
export function scopeSummary() {
    if (STATE.bilateralPairs?.length) {
        const n = STATE.bilateralPairs.length;
        return { label: `${n} drawn connection${n > 1 ? 's' : ''}`, count: scopedFlows(STATE.metric).length };
    }
    const bits = [STATE.region && STATE.region !== 'Global' ? STATE.region : 'Global'];
    if (STATE.selectedExporters.size) bits.push(`${STATE.selectedExporters.size} exporter${STATE.selectedExporters.size > 1 ? 's' : ''}`);
    if (STATE.selectedImporters.size) bits.push(`${STATE.selectedImporters.size} importer${STATE.selectedImporters.size > 1 ? 's' : ''}`);
    return { label: bits.join(' · '), count: scopedFlows(STATE.metric).length };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. COUNTRY — partner-level breakdown for the focused country (current year)
// ═══════════════════════════════════════════════════════════════════════════
export async function exportCountry(iso) {
    if (!iso) return;
    await ensureLoaded();

    // Partner set = every country sharing a flow with `iso` in either metric.
    const partners = new Set();
    ['value', 'weight'].forEach(metric => {
        ((STATE.metricStore[metric]?.years?.[STATE.year]) || []).forEach(d => {
            if (d.exporter === iso) partners.add(d.importer);
            else if (d.importer === iso) partners.add(d.exporter);
        });
    });

    const vNet = netMap('value'), wNet = netMap('weight');
    const catOf = (p) => {
        const nf = vNet.get(pairKey(iso, p));
        return nf ? (CAT_LABEL[nf.flowCategory] || nf.flowCategory) : '';
    };

    const rows = [...partners].map(p => {
        const v = dirFlow('value', iso, p, STATE.year, vNet);   // USD
        const w = dirFlow('weight', iso, p, STATE.year, wNet);  // kg
        return {
            grossV: v.out + v.in,
            row: [
                STATE.year, iso, nameOf(iso), p, nameOf(p), regionOf(p), statusOf(p), catOf(p),
                round(v.out), round(v.in), round(v.out - v.in),
                round(w.out), round(w.in), round(w.out - w.in),
                unitVal(v.out, w.out), unitVal(v.in, w.in),
            ],
        };
    }).sort((a, b) => b.grossV - a.grossV);

    const header = [
        'year', 'country_iso3', 'country', 'partner_iso3', 'partner', 'partner_region',
        'partner_status', 'net_flow_category',
        'exports_value_usd', 'imports_value_usd', 'net_value_usd',
        'exports_weight_kg', 'imports_weight_kg', 'net_weight_kg',
        'exports_unit_value_usd_per_kg', 'imports_unit_value_usd_per_kg',
    ];
    download(
        `SHC-6309_country-${iso}_${STATE.year}_${today()}.csv`,
        toCSV([header, ...rows.map(r => r.row)]),
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. CORRIDOR — year-by-year bilateral history for one country pair
// ═══════════════════════════════════════════════════════════════════════════
export async function exportCorridor(expIso, impIso) {
    if (!expIso || !impIso) return;
    await ensureLoaded();

    const header = [
        'year', 'exporter_iso3', 'exporter', 'importer_iso3', 'importer',
        'exp_to_imp_value_usd', 'imp_to_exp_value_usd', 'net_value_usd',
        'exp_to_imp_weight_kg', 'imp_to_exp_weight_kg', 'net_weight_kg',
        'exp_to_imp_unit_value_usd_per_kg', 'imp_to_exp_unit_value_usd_per_kg',
    ];
    const rows = YEARS.map(y => {
        const vNet = netMap('value', y), wNet = netMap('weight', y);
        const v = dirFlow('value', expIso, impIso, y, vNet);   // out = exp→imp
        const w = dirFlow('weight', expIso, impIso, y, wNet);
        return [
            y, expIso, nameOf(expIso), impIso, nameOf(impIso),
            round(v.out), round(v.in), round(v.out - v.in),
            round(w.out), round(w.in), round(w.out - w.in),
            unitVal(v.out, w.out), unitVal(v.in, w.in),
        ];
    });
    download(
        `SHC-6309_corridor-${expIso}-${impIso}_${today()}.csv`,
        toCSV([header, ...rows]),
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. CURRENT VIEW — flows + country summary for the active map scope
// ═══════════════════════════════════════════════════════════════════════════
export async function exportFlows() {
    await Promise.all([
        DataLoader.loadYear(STATE.year, 'value'),
        DataLoader.loadYear(STATE.year, 'weight'),
    ]);

    const spine = scopedFlows(STATE.metric).slice().sort((a, b) => b.netValue - a.netValue);
    const other = STATE.metric === 'value' ? 'weight' : 'value';
    const otherMap = new Map();
    ((STATE.metricStore[other]?.years?.[STATE.year]) || [])
        .forEach(d => otherMap.set(pairKey(d.exporter, d.importer), d.netValue));

    const header = [
        'year', 'exporter_iso3', 'exporter', 'importer_iso3', 'importer',
        'exporter_region', 'importer_region', 'exporter_status', 'importer_status',
        'flow_category', 'net_value_usd', 'net_weight_kg', 'unit_value_usd_per_kg',
    ];
    const rows = spine.map(d => {
        const k = pairKey(d.exporter, d.importer);
        const value  = STATE.metric === 'value'  ? d.netValue : otherMap.get(k) ?? '';
        const weight = STATE.metric === 'weight' ? d.netValue : otherMap.get(k) ?? '';
        return [
            STATE.year, d.exporter, nameOf(d.exporter), d.importer, nameOf(d.importer),
            regionOf(d.exporter), regionOf(d.importer), statusOf(d.exporter), statusOf(d.importer),
            CAT_LABEL[d.flowCategory] || d.flowCategory,
            round(value), round(weight), unitVal(value, weight),
        ];
    });
    download(`SHC-6309_flows_${STATE.year}_${scopeTag()}_${today()}.csv`, toCSV([header, ...rows]));
}

export function exportSummary() {
    const flows = scopedFlows(STATE.metric);
    const unit  = STATE.metric === 'value' ? 'usd' : 'kg';

    const agg = {};
    const touch = (iso) => (agg[iso] ||= { exports: 0, imports: 0, partners: {}, cat: {} });
    flows.forEach(d => {
        const v = d.netValue;
        const e = touch(d.exporter), i = touch(d.importer);
        e.exports += v; i.imports += v;
        e.partners[d.importer] = (e.partners[d.importer] || 0) + v;
        i.partners[d.exporter] = (i.partners[d.exporter] || 0) + v;
        e.cat[d.flowCategory] = (e.cat[d.flowCategory] || 0) + v;
        i.cat[d.flowCategory] = (i.cat[d.flowCategory] || 0) + v;
    });

    const rows = Object.entries(agg).map(([iso, s]) => {
        const gross = s.exports + s.imports;
        const net   = s.exports - s.imports;
        const pv    = Object.entries(s.partners).sort((a, b) => b[1] - a[1]);
        const hhi   = gross > 0 ? pv.reduce((acc, [, x]) => acc + (x / gross) ** 2, 0) * 10000 : 0;
        const catPct = (c) => gross > 0 ? (s.cat[c] || 0) / gross * 100 : 0;
        return {
            gross,
            row: [
                iso, nameOf(iso), regionOf(iso), statusOf(iso),
                net >= 0 ? 'Net Exporter' : 'Net Importer',
                round(gross), round(s.exports), round(s.imports), round(net),
                pv.length, pv[0] ? nameOf(pv[0][0]) : '',
                pv[0] && gross > 0 ? round(pv[0][1] / gross * 100, 1) : '', round(hhi),
                round(catPct('north-south'), 1), round(catPct('south-north'), 1),
                round(catPct('south-south'), 1), round(catPct('north-north'), 1),
            ],
        };
    }).sort((a, b) => b.gross - a.gross);

    const header = [
        'rank', 'iso3', 'country', 'region', 'development_status', 'role',
        `gross_${unit}`, `exports_${unit}`, `imports_${unit}`, `net_balance_${unit}`,
        'num_partners', 'top_partner', 'top_partner_share_pct', 'hhi',
        'north_south_pct', 'south_north_pct', 'south_south_pct', 'north_north_pct',
    ];
    download(
        `SHC-6309_country-summary_${STATE.year}_${scopeTag()}_${STATE.metric}_${today()}.csv`,
        toCSV([header, ...rows.map((r, i) => [i + 1, ...r.row])]),
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// Wiring
// ═══════════════════════════════════════════════════════════════════════════
export const CsvExport = {
    init() {
        this._wireHeaderMenu();
        this._wireFocusButtons();
    },

    // Header "Export view" dropdown — current-view flows / summary, with live scope.
    _wireHeaderMenu() {
        const btn  = document.getElementById('export-btn');
        const menu = document.getElementById('export-menu');
        if (!btn || !menu) return;

        const close = () => { menu.classList.add('hidden'); btn.setAttribute('aria-expanded', 'false'); };
        const open  = () => {
            const { label, count } = scopeSummary();
            const scopeEl = document.getElementById('export-scope');
            if (scopeEl) scopeEl.textContent = `${label} · ${count.toLocaleString('en-US')} corridor${count === 1 ? '' : 's'}`;
            menu.classList.remove('hidden');
            btn.setAttribute('aria-expanded', 'true');
        };

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            menu.classList.contains('hidden') ? open() : close();
        });
        document.addEventListener('click', (e) => {
            if (!menu.contains(e.target) && !btn.contains(e.target)) close();
        });
        document.querySelectorAll('[data-export]').forEach(el =>
            el.addEventListener('click', async (e) => {
                e.preventDefault();
                close();
                await this._run(() => el.dataset.export === 'summary' ? exportSummary() : exportFlows());
            }));
    },

    // Focus-anchored buttons: country panel + bilateral (arc) modal.
    _wireFocusButtons() {
        document.getElementById('panel-export-btn')?.addEventListener('click', () =>
            this._run(() => exportCountry(window.App?._currentPanelIso)));
        document.getElementById('arc-export-btn')?.addEventListener('click', () => {
            const p = window.App?._arcPair;
            if (p) this._run(() => exportCorridor(p.expIso, p.impIso));
        });
    },

    async _run(fn) {
        try { await fn(); }
        catch (err) { console.error('CSV export failed:', err); alert('CSV export failed. See console for details.'); }
    },
};
