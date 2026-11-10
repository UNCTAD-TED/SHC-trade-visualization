import { format } from 'd3';

export const CONFIG = {
    geoJsonUrl: 'assets/worldmap-economies-4326.topo.json',

    thresholds: {
        value: { large: 5000000, medium: 500000 },
    },

    colors: {
        value:  { label: "Export Value ($)",   discrete: { large: "#0ea5e9", medium: "#6366f1", small: "#334155" } },
        weight: { label: "Export Weight (t)",   discrete: { large: "#0ea5e9", medium: "#6366f1", small: "#334155" } },
    },

    // Flow category base colors (North = Developed, South = Developing/LDC); match --flow-* in colors.css
    flowColors: {
        'north-south': '#009EDB',  // UNCTAD Blue
        'south-north': '#72BF44',  // UNCTAD Green
        'south-south': '#FBAF17',  // UNCTAD Yellow
        'north-north': '#A066AA',  // UNCTAD Purple
    },

    // Development status: 'north' = Developed economies
    // All unlisted countries default to 'south' (Developing/LDC)
    development: {
        'USA': 'north', 'CAN': 'north', 'GRL': 'north',
        'GBR': 'north', 'FRA': 'north', 'DEU': 'north', 'ITA': 'north', 'ESP': 'north',
        'NLD': 'north', 'BEL': 'north', 'AUT': 'north', 'SWE': 'north', 'NOR': 'north',
        'DNK': 'north', 'FIN': 'north', 'CHE': 'north', 'PRT': 'north', 'GRC': 'north',
        'IRL': 'north', 'POL': 'north', 'CZE': 'north', 'HUN': 'north', 'ROU': 'north',
        'BGR': 'north', 'SVK': 'north', 'SVN': 'north', 'HRV': 'north', 'EST': 'north',
        'LVA': 'north', 'LTU': 'north', 'LUX': 'north', 'MLT': 'north', 'CYP': 'north',
        'ISL': 'north', 'AND': 'north', 'SMR': 'north', 'MCO': 'north', 'LIE': 'north',
        'MNE': 'north', 'SRB': 'north', 'BIH': 'north', 'MKD': 'north', 'ALB': 'north',
        'RUS': 'north', 'UKR': 'north', 'BLR': 'north', 'MDA': 'north',
        'ISR': 'north',
        'AUS': 'north', 'NZL': 'north', 'JPN': 'north', 'KOR': 'north'
    }
};

// Metric display formatting (used by tooltips and legends)
// Units switch on the rounded figure (999,999 → "$1.00M"); negatives use a true minus (U+2212).
const MINUS = '−';
export const METRIC_FORMAT = {
    value: {
        grossLabel: 'Gross trade:', netLabel: 'Net balance:',
        fmt: (v) => {
            const a = Math.abs(v);
            const s = v < 0 ? MINUS : '';
            if (a >= 999.995e6) return `${s}$${format('.2f')(a / 1e9)}B`;
            if (a >= 999.995e3) return `${s}$${format('.2f')(a / 1e6)}M`;
            if (a >= 999.995)   return `${s}$${format('.2f')(a / 1e3)}K`;
            return `${s}$${format(',.0f')(a)}`;
        }
    },
    // Weight arrives in kilograms and is shown in tonnes (t / kt / Mt).
    weight: {
        grossLabel: 'Gross trade:', netLabel: 'Net balance:',
        fmt: (v) => {
            const a = Math.abs(v);
            const s = v < 0 ? MINUS : '';
            const t = a / 1000;
            if (t >= 999.995e3) return `${s + format('.2f')(t / 1e6)} Mt`;
            if (t >= 999.995)   return `${s + format('.2f')(t / 1e3)} kt`;
            if (t >= 0.995)     return `${s + format('.2f')(t)} t`;
            return `${s + format(',.0f')(a)} kg`;
        }
    },
};

// Phone layout; keep in sync with the compact media query in variables.css.
export const COMPACT_MQ = '(max-width: 767px), (max-height: 500px) and (max-width: 1024px)';
export const isCompact = () =>
    typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(COMPACT_MQ).matches;
export const isCompactTall = () =>
    typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(max-width: 767px) and (min-height: 501px)').matches;
export const isCompactShort = () =>
    typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(max-height: 500px) and (max-width: 1024px)').matches;

export function fmtSigned(v, metric = STATE.metric) {
    const mf = METRIC_FORMAT[metric] || METRIC_FORMAT.value;
    return (v > 0 ? '+' : '') + mf.fmt(v);
}

export const STATE = {
    // Per-metric data stores: value (USD) from data/, weight (kg) from data/weight/
    metricStore: {
        value:  { years: {}, trendSummary: null, bilateralHistory: null, _bilateralPromise: null },
        weight: { years: {}, trendSummary: null, bilateralHistory: null, _bilateralPromise: null },
    },

    // Active-metric views (point into metricStore[metric]) ----------------------
    // Per-year pre-computed net flows, keyed by year number
    yearCache: {},

    // Gross trade volume per country per year: { iso: { "YYYY": value } }
    trendSummary: {},

    // Raw bilateral flows per country pair across all years (lazy-loaded)
    bilateralHistory: null,
    _bilateralPromise: null,

    geoData: null,
    filteredData: [],
    nodeStats: {},
    totalBilateral: 0,
    totalBilateralCount: 0,

    year: 2024,
    metric: "value",

    selectedExporters: new Set(),
    selectedImporters: new Set(),

    // Pairs drawn with the line filter: { exporter, importer } (ISO3).
    // When non-empty they override the exporter/importer selectors.
    bilateralPairs: [],

    // Flow category visibility filters
    flowFilters: new Set(['north-south', 'south-north', 'south-south', 'north-north']),

    countryCoords: {},
    countryNames: {},
    routes: {},

    // Border line layers from TopoJSON (dashed/dotted/dash-dotted for disputed borders)
    borderLayers: null,

    // Label visibility toggles
    showExporterLabels: true,
    showImporterLabels: true,

    // Threshold mode: 'auto' | 500000 | 100000 | 10000
    thresholdMode: 'auto',

    // Top-N line limit: null (no limit) | 50 | 100 | 200 | 500
    // Keeps the N largest corridors by netValue; unlike thresholdMode it is metric-independent.
    topNMode: null,
};
