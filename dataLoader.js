import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { CONFIG, STATE } from './config.js';
import { RegionConfig } from './regions.js';
import { TradeMap } from './map.js';

export const DataLoader = {

    async loadAll() {
        try {
            const [world, meta, trendSummary, yearFlows] = await Promise.all([
                d3.json(CONFIG.geoJsonUrl),
                fetch('data/meta.json').then(r => r.json()),
                fetch('data/trend_summary.json').then(r => r.json()),
                fetch(`data/${STATE.year}.json`).then(r => r.json()),
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

            STATE.trendSummary = trendSummary;
            STATE.yearCache[STATE.year] = yearFlows;

            // Load routes.json in the background — not needed until a country is clicked
            STATE._routesPromise = fetch('data/routes.json')
                .then(r => r.json())
                .then(data => { STATE.routes = data; })
                .catch(err => console.warn('routes.json load failed:', err));

            // Start loading bilateral history in the background
            STATE._bilateralPromise = fetch('data/bilateral_history.json')
                .then(r => r.json())
                .then(data => { STATE.bilateralHistory = data; })
                .catch(err => console.warn('bilateral_history.json load failed:', err));

            return true;
        } catch (error) {
            console.error('DataLoader.loadAll error:', error);
            return false;
        }
    },

    processGeoData(geoData) {
        geoData.features.forEach(feature => {
            const numericId = parseInt(feature.properties.code, 10);
            const alpha3 = TradeMap.isoMap[numericId];
            if (alpha3) {
                STATE.countryCoords[alpha3] = d3.geoCentroid(feature);
                STATE.countryNames[alpha3] = feature.properties.labelen;
            }
        });
    },

    async loadYear(year) {
        if (STATE.yearCache[year]) return STATE.yearCache[year];
        const data = await fetch(`data/${year}.json`).then(r => r.json());
        STATE.yearCache[year] = data;
        return data;
    },

    filterData() {
        // 1. Use pre-computed net flows for the current year
        let netFlows = STATE.yearCache[STATE.year] || [];

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
        let dynamicThreshold;
        if (STATE.thresholdMode !== 'auto') {
            dynamicThreshold = STATE.thresholdMode;
        } else {
            const totalSelected    = STATE.selectedExporters.size + STATE.selectedImporters.size;
            const isCountryFocused = totalSelected > 0 && totalSelected <= 5;
            const isGroupFocused   = totalSelected > 5;
            const isRegionFocused  = STATE.region && STATE.region !== 'Global';

            dynamicThreshold = 10000000;
            if (isCountryFocused) {
                dynamicThreshold = 10000;
            } else if (isGroupFocused || isRegionFocused) {
                dynamicThreshold = 100000;
            }
        }

        // Save pre-threshold totals for legend coverage display
        STATE.totalBilateral      = d3.sum(netFlows, d => d.netValue);
        STATE.totalBilateralCount = netFlows.length;

        const thresholded = netFlows.filter(d => d.netValue >= dynamicThreshold);

        // 5. Flow category filter
        const finalFlows = thresholded.filter(d => STATE.flowFilters.has(d.flowCategory));

        // 6. Compute node statistics from visible flows
        STATE.nodeStats    = this.computeStatsFromNetFlows(finalFlows);
        STATE.filteredData = finalFlows;

        return finalFlows;
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
