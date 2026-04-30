const CONFIG = {
    geoJsonUrl: 'assets/worldmap-economies-4326.topo.json',

    thresholds: {
        value: { large: 5000000, medium: 500000 },
    },

    colors: {
        value: { label: "Export Value ($)", discrete: { large: "#0ea5e9", medium: "#6366f1", small: "#334155" } },
    },

    // Flow category base colors (North = Developed, South = Developing/LDC)
    flowColors: {
        'north-south': '#009EDB',  // UNCTAD Blue
        'south-north': '#ED1847',  // UNCTAD Red
        'south-south': '#FBAF17',  // UNCTAD Yellow
        'north-north': '#AEA29A',  // UNCTAD Warm Grey
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
const METRIC_FORMAT = {
    value: {
        grossLabel: 'Gross Volume:', netLabel: 'Net Balance:',
        fmt: (v) => {
            const a = Math.abs(v);
            const s = v < 0 ? '-' : '';
            if (a >= 1e9) return s + '$' + d3.format('.2f')(a / 1e9) + 'B';
            if (a >= 1e6) return s + '$' + d3.format('.2f')(a / 1e6) + 'M';
            if (a >= 1e3) return s + '$' + d3.format('.2f')(a / 1e3) + 'K';
            return s + '$' + d3.format(',.0f')(a);
        }
    },
};

const STATE = {
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
};
