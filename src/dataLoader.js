import { geoCentroid, json, sum } from 'd3';
import * as topojson from 'topojson-client';
import { CONFIG, STATE } from './config.js';
import { RegionConfig } from './regions.js';
import { TradeMap } from './map.js';

// Fetch JSON, throwing on HTTP errors instead of parsing an error page.
async function getJSON(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.json();
}

export const DataLoader = {
    // Cache key for pre-threshold stats (metric|year|region|exporters|importers).
    // Threshold and flow-category changes must not trigger a recompute.
    _preThresholdKey: null,

    // Incremented on every metric request; only the latest request may commit.
    _metricSeq: 0,

    // Data folder for a metric's JSON files.
    _prefix(metric = STATE.metric) {
        return metric === 'weight' ? 'data/weight/' : 'data/';
    },

    async loadAll() {
        try {
            const metric = STATE.metric;
            const prefix = this._prefix(metric);
            const [world, meta, trendSummary, yearFlows] = await Promise.all([
                json(CONFIG.geoJsonUrl),
                getJSON('data/meta.json'),
                getJSON(`${prefix}trend_summary.json`),
                getJSON(`${prefix}${STATE.year}.json`),
            ]);

            // Correct the ~11.314° westward longitude shift in the UNCTAD TopoJSON transform
            if (world.transform) {
                world.transform.translate[0] += 11.314;
            }
            STATE.geoData = topojson.feature(world, world.objects.economies);

            // Convert border and point layers to GeoJSON for rendering
            STATE.borderLayers = {
                plain:      topojson.feature(world, world.objects['plain-borders']),
                dashed:     topojson.feature(world, world.objects['dashed-borders']),
                dotted:     topojson.feature(world, world.objects['dotted-borders']),
                dashDotted: topojson.feature(world, world.objects['dash-dotted-borders']),
            };
            STATE.countryPoints = world.objects['economies-point']
                ? topojson.feature(world, world.objects['economies-point'])
                : null;

            // Populate coords/names from TopoJSON centroids first
            this.processGeoData(STATE.geoData);

            // meta.json takes precedence: coords always override, names only fill gaps
            Object.entries(meta).forEach(([iso, entry]) => {
                STATE.countryCoords[iso] = entry.coords;
                if (!STATE.countryNames[iso]) STATE.countryNames[iso] = entry.name;
            });

            // Seed the active-metric store and repoint the active views into it
            const store = STATE.metricStore[metric];
            store.years[STATE.year] = yearFlows;
            store.trendSummary      = trendSummary;
            STATE.yearCache    = store.years;
            STATE.trendSummary = store.trendSummary;

            // Load routes.json in the background — not needed until a country is clicked.
            STATE._routesPromise = getJSON('data/routes.json')
                .then(data => { STATE.routes = data; })
                .catch(err => console.warn('routes.json load failed:', err));

            // Start loading bilateral history for the active metric in the background
            this._loadBilateral(metric);

            return true;
        } catch (error) {
            console.error('DataLoader.loadAll error:', error);
            return false;
        }
    },

    // Fetch a metric's bilateral history once; point STATE at it if still active.
    _loadBilateral(metric = STATE.metric) {
        const store = STATE.metricStore[metric];
        if (store.bilateralHistory) {
            if (STATE.metric === metric) STATE.bilateralHistory = store.bilateralHistory;
            return store._bilateralPromise || Promise.resolve(store.bilateralHistory);
        }
        if (!store._bilateralPromise) {
            store._bilateralPromise = getJSON(`${this._prefix(metric)}bilateral_history.json`)
                .then(data => {
                    store.bilateralHistory = data;
                    if (STATE.metric === metric) STATE.bilateralHistory = data;
                    // Lets views drawn before the file arrived re-render.
                    document.dispatchEvent(new CustomEvent('shc:bilateral-loaded', { detail: { metric } }));
                    return data;
                })
                .catch(err => {
                    console.warn('bilateral_history.json load failed:', err);
                    store._bilateralPromise = null;   // allow a retry on the next request
                });
        }
        return store._bilateralPromise;
    },

    // Switch the active metric ('value' | 'weight'). Files load first and the switch
    // commits only if this is still the latest request, so units and data never disagree.
    // Resolves false if the metric was already active or a later request won.
    async switchMetric(metric) {
        const seq = ++this._metricSeq;
        if (metric === STATE.metric || !STATE.metricStore[metric]) return false;

        const store  = STATE.metricStore[metric];
        const prefix = this._prefix(metric);
        const year   = STATE.year;

        if (!store.trendSummary) {
            const ts = await getJSON(`${prefix}trend_summary.json`);
            store.trendSummary = ts;
        }
        await this.loadYear(year, metric);
        if (seq !== this._metricSeq) return false;
        if (year !== STATE.year) await this.loadYear(STATE.year, metric);
        if (seq !== this._metricSeq) return false;

        STATE.metric           = metric;
        STATE.yearCache        = store.years;
        STATE.trendSummary     = store.trendSummary;
        STATE.bilateralHistory = store.bilateralHistory; // may be null until loaded
        this._loadBilateral(metric);

        this._preThresholdKey = null;
        return true;
    },

    processGeoData(geoData) {
        geoData.features.forEach(feature => {
            const numericId = parseInt(feature.properties.code, 10);
            const alpha3 = TradeMap.isoMap[numericId];
            if (alpha3) {
                STATE.countryCoords[alpha3] = geoCentroid(feature);
                STATE.countryNames[alpha3] = feature.properties.labelen;
            }
        });
    },

    async loadYear(year, metric = STATE.metric) {
        const store = STATE.metricStore[metric];
        if (store.years[year]) return store.years[year];
        const data = await getJSON(`${this._prefix(metric)}${year}.json`);
        store.years[year] = data;
        return data;
    },

    filterData() {
        // 1. Use pre-computed net flows for the current year
        let netFlows = STATE.yearCache[STATE.year] || [];

        // 1b. Connect mode: only the drawn pairs (matched undirected), bypassing
        // every filter except flow category.
        if (TradeMap.lineFilterMode || (STATE.bilateralPairs && STATE.bilateralPairs.length > 0)) {
            const pairKeys = new Set(
                STATE.bilateralPairs.map(p => [p.exporter, p.importer].sort().join('|'))
            );
            const pairFlows = netFlows.filter(d =>
                pairKeys.has([d.exporter, d.importer].sort().join('|'))
            );

            STATE.effectiveThreshold  = 0;
            STATE.totalBilateral      = sum(pairFlows, d => d.netValue);
            STATE.totalBilateralCount = pairFlows.length;
            STATE.rawNodeStats        = this.computeStatsFromNetFlows(pairFlows);
            // Force a recompute of the pre-threshold totals once the pairs are gone.
            this._preThresholdKey     = null;

            const finalFlows   = pairFlows.filter(d => STATE.flowFilters.has(d.flowCategory));
            STATE.nodeStats    = this.computeStatsFromNetFlows(finalFlows);
            STATE.filteredData = finalFlows;
            return finalFlows;
        }

        // 2. Region filter – both exporter and importer must be in the same region
        if (STATE.region && STATE.region !== 'Global') {
            netFlows = netFlows.filter(d => {
                return RegionConfig.getRegion(d.exporter) === STATE.region &&
                       RegionConfig.getRegion(d.importer) === STATE.region;
            });
        }

        // 3. Country selector filters
        if (STATE.selectedExporters.size > 0) {
            netFlows = netFlows.filter(d => STATE.selectedExporters.has(d.exporter));
        }
        if (STATE.selectedImporters.size > 0) {
            netFlows = netFlows.filter(d => STATE.selectedImporters.has(d.importer));
        }

        // 4. Semantic Zoom Thresholding
        // Explicit threshold + Top-N: both apply. 'auto' + Top-N: Top-N only, since
        // the ~40-arc auto cap would otherwise override a larger N.
        let dynamicThreshold;
        if (STATE.thresholdMode !== 'auto') {
            dynamicThreshold = STATE.thresholdMode;
        } else if (STATE.topNMode) {
            dynamicThreshold = 0;
        } else {
            dynamicThreshold = this.computeAutoThreshold(netFlows);
        }
        STATE.effectiveThreshold = dynamicThreshold;

        // Save pre-threshold totals for legend coverage display.
        // These only depend on year/region/selection, not on threshold or flow-category filters,
        // so skip the recompute when only those UI controls changed.
        const preKey = `${STATE.metric}|${STATE.year}|${STATE.region}|${[...STATE.selectedExporters].sort()}|${[...STATE.selectedImporters].sort()}`;
        if (this._preThresholdKey !== preKey) {
            this._preThresholdKey     = preKey;
            STATE.totalBilateral      = sum(netFlows, d => d.netValue);
            STATE.totalBilateralCount = netFlows.length;
            STATE.rawNodeStats        = this.computeStatsFromNetFlows(netFlows);
        }

        const thresholded = netFlows.filter(d => d.netValue >= dynamicThreshold);

        // 4b. Top-N line limit, before the category filter so hiding a category
        // shrinks the N rather than back-filling it with smaller flows.
        const limited = STATE.topNMode
            ? thresholded.slice().sort((a, b) => b.netValue - a.netValue).slice(0, STATE.topNMode)
            : thresholded;

        // 5. Flow category filter
        const finalFlows = limited.filter(d => STATE.flowFilters.has(d.flowCategory));

        // 6. Compute node statistics from visible flows
        STATE.nodeStats    = this.computeStatsFromNetFlows(finalFlows);
        STATE.filteredData = finalFlows;

        return finalFlows;
    },

    // Adaptive threshold: at most targetMax arcs, above a floor that scales with selection size.
    // Replaces the Top-20 auto mode; the "Lines" menu adds a manual Top-N.
    computeAutoThreshold(flows, targetMax = 40) {
        const n = STATE.selectedExporters.size + STATE.selectedImporters.size;
        const isRegional = STATE.region && STATE.region !== 'Global';

        let floor;
        if (n === 0 && !isRegional) {
            floor = 10000000;
        } else if (n <= 3) {
            floor = 10000;
        } else if (n <= 10) {
            floor = 100000;
        } else if (n <= 30) {
            floor = 500000;
        } else {
            floor = 1000000;
        }
        if (isRegional && n === 0) floor = 1000000;

        const aboveFloor = flows.filter(d => d.netValue >= floor);
        if (aboveFloor.length <= targetMax) return floor;

        const sorted = aboveFloor.slice().sort((a, b) => b.netValue - a.netValue);
        return sorted[targetMax - 1].netValue;
    },

    // A country's totals for the year, ignoring display filters: gross from trend_summary,
    // net from its signed net bilateral flows. Null if it has no trade that year.
    countryTotals(iso, year = STATE.year) {
        const gross = STATE.trendSummary?.[iso]?.[String(year)] || 0;
        let net = 0, any = false;
        (STATE.yearCache[year] || []).forEach(d => {
            if (d.exporter === d.importer) return;          // self-trade nets to zero
            if (d.exporter === iso)      { net += d.netValue; any = true; }
            else if (d.importer === iso) { net -= d.netValue; any = true; }
        });
        return (gross > 0 || any) ? { gross, net } : null;
    },

    computeStatsFromNetFlows(netFlows) {
        const stats = {};
        netFlows.forEach(d => {
            if (!stats[d.exporter]) stats[d.exporter] = { grossVolume: 0, netBalance: 0 };
            if (!stats[d.importer]) stats[d.importer] = { grossVolume: 0, netBalance: 0 };
            stats[d.exporter].grossVolume += d.netValue;
            stats[d.exporter].netBalance  += d.netValue;
            stats[d.importer].grossVolume += d.netValue;
            stats[d.importer].netBalance  -= d.netValue;
        });
        return stats;
    },

    getExporters() {
        const flows = STATE.yearCache[STATE.year] || [];
        let relevant = flows;
        if (STATE.region && STATE.region !== 'Global') {
            relevant = flows.filter(d => RegionConfig.getRegion(d.exporter) === STATE.region);
        }
        return [...new Set(relevant.map(d => d.exporter))].sort();
    },

    getImporters() {
        const flows = STATE.yearCache[STATE.year] || [];
        let relevant = flows;
        if (STATE.region && STATE.region !== 'Global') {
            relevant = flows.filter(d => RegionConfig.getRegion(d.importer) === STATE.region);
        }
        return [...new Set(relevant.map(d => d.importer))].sort();
    },

    getTopExporters(count = 5) {
        const yearStr = String(STATE.year);
        const ts = STATE.trendSummary;
        return Object.entries(ts)
            .map(([iso, years]) => [iso, years[yearStr] || 0])
            .filter(([, v]) => v > 0)
            .sort((a, b) => b[1] - a[1])
            .slice(0, count)
            .map(([iso]) => iso);
    },
};
