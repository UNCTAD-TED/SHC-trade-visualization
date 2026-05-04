import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { CONFIG, STATE, METRIC_FORMAT } from './config.js';
import { RegionConfig } from './regions.js';

export const TradeMap = {
    isoMap: {
        "4": "AFG", "8": "ALB", "12": "DZA", "24": "AGO", "32": "ARG", "51": "ARM", "36": "AUS",
        "40": "AUT", "31": "AZE", "44": "BHS", "48": "BHR", "50": "BGD", "52": "BRB", "112": "BLR",
        "56": "BEL", "84": "BLZ", "204": "BEN", "64": "BTN", "68": "BOL", "70": "BIH", "72": "BWA",
        "76": "BRA", "96": "BRN", "100": "BGR", "854": "BFA", "108": "BDI", "116": "KHM", "120": "CMR",
        "124": "CAN", "140": "CAF", "148": "TCD", "152": "CHL", "156": "CHN", "170": "COL", "174": "COM",
        "178": "COG", "180": "COD", "188": "CRI", "384": "CIV", "191": "HRV", "192": "CUB", "196": "CYP",
        "203": "CZE", "208": "DNK", "262": "DJI", "214": "DOM", "218": "ECU", "818": "EGY", "222": "SLV",
        "226": "GNQ", "232": "ERI", "233": "EST", "231": "ETH", "242": "FJI", "246": "FIN", "250": "FRA",
        "266": "GAB", "270": "GMB", "268": "GEO", "276": "DEU", "288": "GHA", "300": "GRC", "304": "GRL",
        "308": "GRD", "320": "GTM", "324": "GIN", "624": "GNB", "328": "GUY", "332": "HTI", "340": "HND",
        "344": "HKG", "348": "HUN", "352": "ISL", "356": "IND", "360": "IDN", "364": "IRN", "368": "IRQ",
        "372": "IRL", "376": "ISR", "380": "ITA", "388": "JAM", "392": "JPN", "400": "JOR", "398": "KAZ",
        "404": "KEN", "408": "PRK", "410": "KOR", "414": "KWT", "417": "KGZ", "418": "LAO", "428": "LVA",
        "422": "LBN", "426": "LSO", "430": "LBR", "434": "LBY", "440": "LTU", "442": "LUX", "807": "MKD",
        "450": "MDG", "454": "MWI", "458": "MYS", "462": "MDV", "466": "MLI", "470": "MLT", "478": "MRT",
        "480": "MUS", "484": "MEX", "498": "MDA", "496": "MNG", "499": "MNE", "504": "MAR", "508": "MOZ",
        "104": "MMR", "516": "NAM", "524": "NPL", "528": "NLD", "540": "NCL", "554": "NZL", "558": "NIC",
        "562": "NER", "566": "NGA", "578": "NOR", "512": "OMN", "586": "PAK", "591": "PAN", "598": "PNG",
        "600": "PRY", "604": "PER", "608": "PHL", "616": "POL", "620": "PRT", "630": "PRI", "634": "QAT",
        "642": "ROU", "643": "RUS", "646": "RWA", "682": "SAU", "686": "SEN", "688": "SRB", "694": "SLE",
        "702": "SGP", "703": "SVK", "705": "SVN", "90": "SLB", "706": "SOM", "710": "ZAF", "728": "SSD",
        "724": "ESP", "144": "LKA", "729": "SDN", "740": "SUR", "748": "SWZ", "752": "SWE", "756": "CHE",
        "760": "SYR", "158": "TWN", "762": "TJK", "834": "TZA", "764": "THA", "626": "TLS", "768": "TGO",
        "780": "TTO", "788": "TUN", "792": "TUR", "795": "TKM", "800": "UGA", "804": "UKR", "784": "ARE",
        "826": "GBR", "840": "USA", "858": "URY", "860": "UZB", "548": "VUT", "862": "VEN", "704": "VNM",
        "732": "ESH", "887": "YEM", "894": "ZMB", "716": "ZWE"
    },

    // ── 2D (D3.js) state
    svg: null,
    g: null,
    projection: null,
    path: null,
    zoomBehavior: null,

    width: 0,
    height: 0,

    // ── Focus mode state (insight panel spotlight)
    focusedIso: null,
    searouteMode: false,

    // When a country is focused/hovered, also highlight these additional territory codes (numeric).
    // UNCTAD treats HKG (344), MAC (446), TWN (158) as part of China (156).
    _territoryAliases: { 'CHN': ['158', '344', '446'] },

    // Lazy-computed reverse of isoMap: iso3 → numeric string
    _reverseIsoMap: null,

    // ── Route path cache: "exp|imp" → SVG path string (invalidated on resize)
    _routePathCache: null,

    // ── Legend dirty-check: skip full DOM rebuild when inputs haven't changed
    _lastLegendKey: null,

    // ── Zoom rAF batching: pending transform so expensive selectAll runs once per frame
    _zoomRaf: null,
    _pendingZoomK: 1,

    // Returns the fill for a land polygon, applying special fills for disputed territories.
    _specialFill(d, defaultFill) {
        if (d?.properties?.code === 'C00002') return 'url(#aksai-chin-hatch)';
        return defaultFill;
    },

    // Returns the set of numeric code strings that should be co-highlighted with the given code.
    // Covers forward (CHN → HKG/MAC/TWN) and reverse (HKG → CHN/MAC/TWN) lookups.
    _getHoverGroup(codeStr) {
        if (!this._reverseIsoMap) {
            this._reverseIsoMap = {};
            Object.entries(this.isoMap).forEach(([num, iso3]) => { this._reverseIsoMap[iso3] = num; });
        }
        const group = new Set([codeStr]);
        const iso3 = this.isoMap[codeStr];
        if (iso3) {
            (this._territoryAliases[iso3] || []).forEach(c => group.add(String(c)));
        }
        for (const [mainIso, aliasList] of Object.entries(this._territoryAliases)) {
            if (aliasList.includes(codeStr)) {
                const mainCode = this._reverseIsoMap[mainIso];
                if (mainCode) group.add(String(mainCode));
                aliasList.forEach(c => group.add(String(c)));
            }
        }
        return group;
    },

    // ── Shared compact number formatter (no currency symbol) used in renderLegend
    _fmtShort(v) {
        const a = Math.abs(v);
        const s = v < 0 ? '-' : '';
        if (a >= 1e9) return s + d3.format('.2f')(a / 1e9) + 'B';
        if (a >= 1e6) return s + d3.format('.2f')(a / 1e6) + 'M';
        if (a >= 1e3) return s + d3.format('.2f')(a / 1e3) + 'K';
        return s + d3.format(',.0f')(a);
    },

    // ── 1. Initialization
    init() {
        const container = document.getElementById("map-container");
        this.width  = container.getBoundingClientRect().width;
        this.height = container.getBoundingClientRect().height;

        if (!this.svg) this.init2D(container);

        this.updateDimensions();
        this.updateProjection();
        this.renderStaticMap();
    },

    init2D(container) {
        this.svg = d3.select(container).append("svg")
            .attr("class", "map-2d-layer")
            .style("position", "absolute")
            .style("top", "0").style("left", "0")
            .style("z-index", "1")
            .style("touch-action", "none"); // スマホでのブラウザスクロールを無効化し、地図のパン操作を可能にする

        const defs = this.svg.append("defs");
        const hatch = defs.append("pattern")
            .attr("id", "aksai-chin-hatch")
            .attr("patternUnits", "userSpaceOnUse")
            .attr("width", 2).attr("height", 2)
            .attr("patternTransform", "rotate(45)");
        hatch.append("rect").attr("width", 2).attr("height", 2).attr("fill", "#F0EDE8");
        hatch.append("line").attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 2)
            .attr("stroke", "#AEA29A").attr("stroke-width", 0.8);

        this.g = this.svg.append("g");
        this._graticuleGeo = d3.geoGraticule()(); // GeoJSONは不変なので一度だけ生成

        this.zoomBehavior = d3.zoom()
            .scaleExtent([0.2, 8])
            .on("zoom", (event) => {
                // Apply the transform immediately so panning feels instant.
                this.g.attr("transform", event.transform);
                this._pendingZoomK = event.transform.k;

                // Batch the expensive per-element selectAll updates to one rAF per frame.
                if (this._zoomRaf) return;
                this._zoomRaf = requestAnimationFrame(() => {
                    this._zoomRaf = null;
                    const k = this._pendingZoomK;
                    this.g.selectAll(".land, .graticule, .border").attr("stroke-width", 0.5 / k);
                    this.g.selectAll(".trade-arc").attr("stroke-width", function() {
                        return (+this.getAttribute("data-original-width") || 1) / k;
                    });
                    this.g.selectAll(".country-node").attr("r", function() {
                        return (+this.getAttribute("data-original-radius") || 3) / k;
                    }).attr("stroke-width", 1.5 / k);
                    this.g.selectAll(".map-label")
                        .attr("font-size", (8.5 / Math.sqrt(k)) + "px")
                        .attr("stroke-width", 2.5 / k);
                });
            });
        this.svg.call(this.zoomBehavior);
    },

    updateDimensions() {
        this.svg
            .attr("width", "100%")
            .attr("height", "100%")
            .attr("viewBox", `0 0 ${this.width} ${this.height}`)
            .style("background", "#F3F8FD");
    },

    updateProjection() {
        this._routePathCache = null; // projection changes → cached SVG paths are stale

        const isPortrait = this.height > this.width;

        // fitExtent automatically calculates scale and translate for any projection.
        // Leave vertical margin at top/bottom so the map doesn't overlap UI panels.
        const yTop = this.height * (isPortrait ? 0.02 : 0.06);
        const yBot = this.height * (isPortrait ? 0.02 : 0.12);

        this.projection = d3.geoNaturalEarth1()
            .fitExtent([[0, yTop], [this.width, this.height - yBot]], { type: 'Sphere' });

        this.path = d3.geoPath().projection(this.projection);
    },

    zoomToRegion(regionName) {
        if (!this.zoomBehavior) return;

        const config = RegionConfig.regions[regionName];
        if (!config) return;

        const [targetLon, targetLat] = config.center;
        let targetScale = config.scale;

        // Global表示かつスマホ（縦長画面）の場合、地図が横幅にすっぽり収まるまで縮小(k < 1)する
        if (regionName === "Global" && this.height > this.width) {
            const baseScaleX = this.width / 6.28;
            const currentBaseScale = this.projection.scale();
            targetScale = baseScaleX / currentBaseScale;
        }

        const projectedPoint = this.projection([targetLon, targetLat]);
        if (!projectedPoint) return;

        const k = Math.max(0.2, targetScale); // 下限を0.2に制限
        const tx = (this.width / 2) - (projectedPoint[0] * k);
        const ty = (this.height / 2) - (projectedPoint[1] * k);

        const transform = d3.zoomIdentity.translate(tx, ty).scale(k);

        this.svg.transition()
            .duration(1200)
            .call(this.zoomBehavior.transform, transform);
    },

    // ── Static map (land polygons) with D3 Data Join
    renderStaticMap() {
        if (!STATE.geoData || !this.g) return;

        let landLayer = this.g.select(".land-layer");
        if (landLayer.empty()) {
            landLayer = this.g.insert("g", ":first-child")
                .attr("class", "land-layer");
        }

        const graticulePath = landLayer.selectAll(".graticule")
            .data([this._graticuleGeo || d3.geoGraticule()()]);

        graticulePath.enter().append("path")
            .attr("class", "graticule")
            .attr("fill", "none")
            .attr("stroke", "#EBEAE6")
            .attr("stroke-width", 0.5)
            .attr("stroke-opacity", 0.8)
            .merge(graticulePath)
            .attr("d", this.path);

        const lands = landLayer.selectAll("path.land")
            .data(STATE.geoData.features, d => d.properties.id || d.id);

        lands.exit().remove();

        const landsEnter = lands.enter().append("path")
            .attr("class", "land")
            .attr("stroke", "#DED9D5")
            .attr("stroke-width", 0.5)
            .style("transition", "fill 0.2s ease")
            .on("mouseover", (event, d) => {
                if (!d || !d.properties) return;
                const group = this._getHoverGroup(String(d.properties.code));
                this.g.selectAll("path.land")
                    .filter(ld => ld && ld.properties && group.has(String(ld.properties.code)))
                    .attr("fill", ld => this._specialFill(ld, "#EBEAE6"));
            })
            .on("mouseout", (event, d) => {
                if (!d || !d.properties) return;
                const group = this._getHoverGroup(String(d.properties.code));
                const focusCode = this.focusedIso && this._reverseIsoMap && this._reverseIsoMap[this.focusedIso];
                const focusAliases = this.focusedIso ? (this._territoryAliases[this.focusedIso] || []) : [];
                const focusGroup = new Set([focusCode, ...focusAliases].filter(Boolean));
                this.g.selectAll("path.land")
                    .filter(ld => ld && ld.properties && group.has(String(ld.properties.code)))
                    .attr("fill", ld => this._specialFill(ld, focusGroup.has(String(ld.properties.code)) ? "#EAF4FB" : "#FAFAFA"));
            });

        landsEnter.merge(lands)
            .attr("fill", d => this._specialFill(d, "#FAFAFA"))
            .attr("d", this.path);

        this._renderBorderLayers(landLayer);
    },

    // Render border lines and small-island point features from TopoJSON layers
    _renderBorderLayers(landLayer) {
        if (!STATE.borderLayers) return;

        const specs = [
            { key: 'plain',      cls: 'border-plain',       dasharray: null,          stroke: '#C8C2BB', width: 0.4 },
            { key: 'dashed',     cls: 'border-dashed',      dasharray: '4,3',         stroke: '#9B9189', width: 0.5 },
            { key: 'dotted',     cls: 'border-dotted',      dasharray: '1.5,2.5',     stroke: '#9B9189', width: 0.5 },
            { key: 'dashDotted', cls: 'border-dash-dotted', dasharray: '5,2,1.5,2',  stroke: '#9B9189', width: 0.5 },
        ];

        specs.forEach(({ key, cls, dasharray, stroke, width }) => {
            const features = STATE.borderLayers[key];
            if (!features) return;

            const paths = landLayer.selectAll(`path.${cls}`)
                .data(features.features, d => d.properties && d.properties.code);

            paths.exit().remove();

            const entered = paths.enter().append("path")
                .attr("class", `border ${cls}`)
                .attr("fill", "none")
                .attr("stroke", stroke)
                .attr("stroke-width", width)
                .attr("stroke-linecap", "round")
                .style("pointer-events", "none");

            if (dasharray) entered.attr("stroke-dasharray", dasharray);

            entered.merge(paths).attr("d", this.path);
        });

        // Render tiny-island-nation dots (economies-point layer).
        // Only draw a dot if the economy has no polygon counterpart — the 4326 file
        // includes points for every economy, so we must exclude those already drawn as polygons.
        if (STATE.countryPoints && STATE.geoData) {
            const polygonCodes = new Set(
                STATE.geoData.features.map(f => String(f.properties.code))
            );
            const pointOnlyFeatures = STATE.countryPoints.features.filter(
                f => !polygonCodes.has(String(f.properties && f.properties.code))
            );

            const dots = landLayer.selectAll("circle.economy-point")
                .data(pointOnlyFeatures, d => d.properties && d.properties.code);

            dots.exit().remove();

            dots.enter().append("circle")
                .attr("class", "economy-point")
                .attr("r", 2)
                .attr("fill", "#FAFAFA")
                .attr("stroke", "#DED9D5")
                .attr("stroke-width", 0.5)
                .style("pointer-events", "none")
                .merge(dots)
                .attr("cx", d => (this.projection(d.geometry.coordinates) || [])[0])
                .attr("cy", d => (this.projection(d.geometry.coordinates) || [])[1]);
        }
    },

    // ── Flow rendering (Export Value / 2D only)
    // Normalize a GeoJSON LineString for equirectangular rendering.
    // searoute uses extended longitudes (e.g. -220° for Japan on Pacific routes).
    // This wraps all coords to [-180, 180] and splits at the antimeridian into a MultiLineString.
    normalizeRoute(geometry) {
        if (!geometry || geometry.type !== 'LineString') return geometry;
        const wrap = lon => ((lon % 360) + 540) % 360 - 180;
        const normalized = geometry.coordinates.map(([lon, lat]) => [wrap(lon), lat]);
        const segments = [];
        let seg = [normalized[0]];
        for (let i = 1; i < normalized.length; i++) {
            const prevLon = seg[seg.length - 1][0];
            const [lon, lat] = normalized[i];
            if (Math.abs(lon - prevLon) > 180) {
                segments.push(seg);
                seg = [[lon, lat]];
            } else {
                seg.push([lon, lat]);
            }
        }
        segments.push(seg);
        return { type: 'MultiLineString', coordinates: segments };
    },

    // Build the full SVG path for a focused flow:
    // exporter centroid → sea route (direction-corrected) → importer centroid.
    // Sea routes are only shown for inter-continental flows (different UNCTAD regions).
    // Results are memoized per (exporter, importer) pair; cache is invalidated on resize.
    _buildRoutePath(d) {
        const expRegion = RegionConfig.getRegion(d.exporter);
        const impRegion = RegionConfig.getRegion(d.importer);
        if (expRegion === impRegion || expRegion === 'Other' || impRegion === 'Other') return null;

        if (!this._routePathCache) this._routePathCache = new Map();
        const cacheKey = `${d.exporter}|${d.importer}`;
        if (this._routePathCache.has(cacheKey)) return this._routePathCache.get(cacheKey);

        const routeKey = [d.exporter, d.importer].sort().join("|");
        const route = STATE.routes && STATE.routes[routeKey];
        if (!route) return null;

        const expCoord = STATE.countryCoords[d.exporter];
        const impCoord = STATE.countryCoords[d.importer];

        const normalized = this.normalizeRoute(route.geometry);
        let segs = normalized.coordinates;

        // Use the origin_iso property written by generate_routes.py (or the
        // routes.json patch script) to determine direction reliably.
        // Centroid-based heuristics break for countries like CAN or USA whose
        // representative port lies far from the country's geographic centroid.
        const originIso = route.properties && route.properties.origin_iso;
        if (originIso && originIso !== d.exporter) {
            segs = segs.map(s => [...s].reverse()).reverse();
        }

        // Extend: prepend exporter centroid to first segment, append importer centroid to last.
        if (expCoord && impCoord) {
            if (segs.length === 1) {
                segs = [[expCoord, ...segs[0], impCoord]];
            } else {
                segs = [
                    [expCoord, ...segs[0]],
                    ...segs.slice(1, -1),
                    [...segs[segs.length - 1], impCoord],
                ];
            }
        }

        const result = this.path({ type: 'MultiLineString', coordinates: segs });
        this._routePathCache.set(cacheKey, result);
        return result;
    },

    renderFlows() {
        if (!this.svg) return;

        const overlay = document.getElementById('hit-overlay-svg');
        if (overlay) overlay.style.display = 'none';

        this.svg.style("display", "block");
        if (this.render2DFlows) this.render2DFlows();
    },

    // ── 2D D3 Data Join architecture
    render2DFlows() {
        if (!this.g) return;

        if (STATE.metric !== 'value') {
            this.g.selectAll(".trade-arc, .country-node, .map-label-unified")
                .transition().duration(500).style("opacity", 0).remove();
            return;
        }

        const netFlows  = STATE.filteredData;
        const nodeStats = STATE.nodeStats;

        if (!netFlows || netFlows.length === 0) {
            this.g.selectAll(".trade-arc, .country-node, .map-label-unified")
                .transition().duration(500).style("opacity", 0).remove();
            if (this.renderLegend) this.renderLegend();
            return;
        }

        let currentK = 1;
        if (this.svg) {
            currentK = d3.zoomTransform(this.svg.node()).k;
        }

        // Projection cache: each ISO is projected at most once per render call
        const _projCache = {};
        const projOf = (iso) => _projCache[iso] || (_projCache[iso] = this.getProjectedPoint(iso));

        const nodeStatsArr  = Object.values(nodeStats);
        const isFocused = STATE.selectedExporters.size > 0 || STATE.selectedImporters.size > 0;

        if (nodeStatsArr.length === 0 || netFlows.length === 0) return;

        const sortedGross   = nodeStatsArr.map(d => d.grossVolume).sort(d3.ascending);
        const sortedNetBal  = nodeStatsArr.map(d => Math.abs(d.netBalance)).sort(d3.ascending);
        const sortedNetFlows= netFlows.map(d => d.netValue).sort(d3.ascending);

        const p98Gross      = d3.quantile(sortedGross, 0.98) || d3.max(sortedGross) || 1;
        const p98NetBal     = d3.quantile(sortedNetBal, 0.98) || d3.max(sortedNetBal) || 1;
        const p98NetFlows   = d3.quantile(sortedNetFlows, 0.98) || d3.max(sortedNetFlows) || 1;

        //need to adjust the size
        const maxRadius    = Math.max(Math.min(this.width * 0.010, 20), 1);
        const maxEdgeWidth = Math.max(Math.min(this.width * 0.008, 12), 1);

        const radiusScale = d3.scaleSqrt()
            .domain([0, p98Gross])
            .range(isFocused ? [3, maxRadius] : [1.5, maxRadius * 0.7])
            .clamp(true);

        const edgeWidthScale = d3.scaleSqrt()
            .domain([0, p98NetFlows])
            .range(isFocused ? [1.5, maxEdgeWidth] : [0.5, maxEdgeWidth * 0.7])
            .clamp(true);

        const opacityScale = d3.scaleLinear()
            .domain([0, p98NetFlows])
            .range(isFocused ? [0.3, 0.95] : [0.15, 0.85])
            .clamp(true);

        const maxTransformed = Math.sqrt(p98NetBal);
        const _colorScaleFn = d3.scaleLinear()
            .domain([-maxTransformed, -maxTransformed * 0.15, 0, maxTransformed * 0.15, maxTransformed])
            .range(["#ED1847", "#F9C0C5", "#ffffff", "#C5DFEF", "#009EDB"])
            .interpolate(d3.interpolateHcl)
            .clamp(true);
        const colorScale = (val) => _colorScaleFn(Math.sign(val) * Math.sqrt(Math.abs(val)));

        let flowLayer = this.g.select(".flow-layer");
        if (flowLayer.empty()) flowLayer = this.g.append("g").attr("class", "flow-layer");

        let nodeLayer = this.g.select(".node-layer");
        if (nodeLayer.empty()) nodeLayer = this.g.append("g").attr("class", "node-layer");

        let labelLayer = this.g.select(".label-layer");
        if (labelLayer.empty()) labelLayer = this.g.append("g").attr("class", "label-layer");

        // --- 1. Arcs (edges) ---
        const visibleFlows = netFlows.filter(d =>
            STATE.countryCoords[d.exporter] && STATE.countryCoords[d.importer]);

        const arcs = flowLayer.selectAll(".trade-arc")
            .data(visibleFlows, d => `${d.exporter}|${d.importer}`);

        arcs.exit()
            .transition().duration(500)
            .style("opacity", 0)
            .remove();

        const focusedIso = this.focusedIso;

        // パートナーセットを一度だけ構築してO(n×m)→O(n+m)にする
        const focusedPartnerSet = new Set();
        if (focusedIso) {
            visibleFlows.forEach(f => {
                if (f.exporter === focusedIso) focusedPartnerSet.add(f.importer);
                else if (f.importer === focusedIso) focusedPartnerSet.add(f.exporter);
            });
        }

        const arcOpacity = (d) => {
            const base = opacityScale(d.netValue);
            if (focusedIso && d.exporter !== focusedIso && d.importer !== focusedIso) return 0;
            return base;
        };

        const arcsEnter = arcs.enter()
            .append("path")
            .attr("class", "trade-arc")
            .attr("id", d => `arc-${d.exporter}-${d.importer}`)
            .style("fill", "none")
            .style("mix-blend-mode", "multiply")
            .style("opacity", 0)
            .attr("stroke", d => CONFIG.flowColors[d.flowCategory])
            .on("click", (event, d) => { event.stopPropagation(); document.dispatchEvent(new CustomEvent('shc:arc-click', { detail: { exporter: d.exporter, importer: d.importer } })); });

        const buildArcD = (d) => {
            if (focusedIso && this.searouteMode) {
                const rp = this._buildRoutePath(d);
                if (rp) return rp;
            }
            const s = STATE.countryCoords[d.exporter];
            const t = STATE.countryCoords[d.importer];
            if (!s || !t) return null;
            const p1 = this.projection(s);
            const p2 = this.projection(t);
            if (!p1 || !p2) return null;
            const dx = p2[0] - p1[0];
            const dy = p2[1] - p1[1];
            const dr = Math.sqrt(dx * dx + dy * dy) * 1.3;
            return `M${p1[0]},${p1[1]}A${dr},${dr} 0 0,1 ${p2[0]},${p2[1]}`;
        };

        arcsEnter.merge(arcs)
            .attr("id", d => `arc-${d.exporter}-${d.importer}`)
            .attr("data-original-width", d => edgeWidthScale(d.netValue))
            .attr("data-base-opacity", d => opacityScale(d.netValue))
            .attr("d", buildArcD)  // set shape immediately — no interpolation glitch
            .transition().duration(750).ease(d3.easeCubicOut)
            .attr("stroke", d => CONFIG.flowColors[d.flowCategory])
            .attr("stroke-width", d => edgeWidthScale(d.netValue) / currentK)
            .style("opacity", arcOpacity);

        // --- 2. Nodes (circles) ---
        const activeNodes = Object.keys(nodeStats).filter(d => this.isVisible(d));

        const nodes = nodeLayer.selectAll(".country-node")
            .data(activeNodes, d => d);

        nodes.exit()
            .transition().duration(500)
            .attr("r", 0)
            .style("opacity", 0)
            .remove();

        const nodesEnter = nodes.enter()
            .append("circle")
            .attr("class", "country-node")
            .attr("stroke", "#DED9D5")
            .style("opacity", 0)
            .on("mouseover", (event, d) => document.dispatchEvent(new CustomEvent('shc:country-hover', { detail: { event, country: d } })))
            .on("mouseout",  () => document.dispatchEvent(new CustomEvent('shc:country-hoverend')))
            .on("click",     (event, d) => { event.stopPropagation(); document.dispatchEvent(new CustomEvent('shc:country-click', { detail: d })); });

        const nodeOpacity = (d) => {
            if (!focusedIso) return 1;
            if (d === focusedIso) return 1;
            return focusedPartnerSet.has(d) ? 0.95 : 0.18;
        };

        nodesEnter.merge(nodes)
            .attr("data-original-radius", d => radiusScale(nodeStats[d].grossVolume))
            .transition().duration(750).ease(d3.easeElasticOut)
            .attr("cx", d => projOf(d)[0])
            .attr("cy", d => projOf(d)[1])
            .attr("r", d => radiusScale(nodeStats[d].grossVolume) / currentK)
            .attr("fill", d => colorScale(nodeStats[d].netBalance))
            .attr("stroke-width", 1.5 / currentK)
            .style("opacity", nodeOpacity);

        // --- 3. Labels ---
        const sortedNodes = activeNodes.slice().sort((a, b) => nodeStats[b].grossVolume - nodeStats[a].grossVolume);
        const volumeThreshold = sortedNodes.length > 15 ? nodeStats[sortedNodes[14]].grossVolume : 0;

        const isLabelVisible = (d) => {
            const isNetExporter = nodeStats[d].netBalance >= 0;
            if (isNetExporter  && !STATE.showExporterLabels) return false;
            if (!isNetExporter && !STATE.showImporterLabels) return false;
            if (currentK >= 2.5) return true;
            return nodeStats[d].grossVolume >= volumeThreshold;
        };

        const visibleLabels = activeNodes.filter(d => isLabelVisible(d));

        const labels = labelLayer.selectAll(".map-label-unified")
            .data(visibleLabels, d => d);

        labels.exit()
            .transition().duration(300)
            .style("opacity", 0)
            .remove();

        const labelsEnter = labels.enter()
            .append("text")
            .attr("class", "map-label map-label-unified")
            .attr("font-family", "Inter, sans-serif")
            .attr("font-weight", "600") // 少し太字にして視認性を高める
            .style("pointer-events", "none")
            .style("paint-order", "stroke fill") // フチを文字の外側にだけ描画するモダンなCSS
            .style("opacity", 0);

        const labelOpacity = (d) => {
            if (!focusedIso) return 1;
            if (d === focusedIso) return 1;
            return focusedPartnerSet.has(d) ? 0.85 : 0.2;
        };

        labelsEnter.merge(labels)
            .text(d => STATE.countryNames[d] || d)
            .attr("fill", "#6E6259")
            .attr("stroke", "#FAFAFA") // 背景や陸地と同じ色で白フチ（Halo）をつける
            .attr("stroke-linejoin", "round")
            .transition().duration(750)
            .attr("x", d => projOf(d)[0] + (radiusScale(nodeStats[d].grossVolume) / currentK) + 4)
            .attr("y", d => projOf(d)[1] + 4)
            .attr("font-size", (8.5 / Math.sqrt(currentK)) + "px") // 10pxから8.5pxへ少し縮小
            .attr("stroke-width", 2.5 / currentK)
            .style("opacity", labelOpacity);

        if (this.renderLegend) this.renderLegend();

        // Re-apply focus visuals (halo + particles) after data join refresh
        if (this.focusedIso) {
            this._renderHalo(this.focusedIso);
            this._renderParticles(this.focusedIso, visibleFlows);
        }
    },

    getProjectedPoint(iso) {
        const coords = STATE.countryCoords[iso];
        if (!coords) return [-999, -999];
        return this.projection(coords) || [-999, -999];
    },

    isVisible(iso) {
        return !!STATE.countryCoords[iso];
    },

    // ── Focus mode (insight panel spotlight) ───────────────────────
    setFocus(iso) {
        if (!this.g) return;
        this.focusedIso = iso;

        const visibleFlows = (STATE.filteredData || []).filter(d =>
            STATE.countryCoords[d.exporter] && STATE.countryCoords[d.importer]);

        const partners = new Set();
        visibleFlows.forEach(d => {
            if (d.exporter === iso) partners.add(d.importer);
            else if (d.importer === iso) partners.add(d.exporter);
        });

        const focusedIso = iso;
        const self = this;

        // Update path shapes immediately (before opacity fade) to avoid D3 path interpolation glitch.
        // Cache the selection to avoid traversing the DOM twice.
        const focusArcs = this.g.selectAll(".trade-arc");
        focusArcs.attr("d", function(d) {
                if (d.exporter !== focusedIso && d.importer !== focusedIso) return this.getAttribute("d");
                if (self.searouteMode) {
                    const rp = self._buildRoutePath(d);
                    if (rp) return rp;
                }
                const s = STATE.countryCoords[d.exporter];
                const t = STATE.countryCoords[d.importer];
                if (!s || !t) return this.getAttribute("d");
                const p1 = self.projection(s);
                const p2 = self.projection(t);
                if (!p1 || !p2) return this.getAttribute("d");
                const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
                const dr = Math.sqrt(dx * dx + dy * dy) * 1.3;
                return `M${p1[0]},${p1[1]}A${dr},${dr} 0 0,1 ${p2[0]},${p2[1]}`;
            });

        // Then animate only opacity (same selection object, no second DOM traversal)
        focusArcs.transition().duration(450)
            .style("opacity", function(d) {
                const base = +this.getAttribute("data-base-opacity") || 0.5;
                if (d.exporter === focusedIso || d.importer === focusedIso) return base;
                return 0;
            });

        this.g.selectAll(".country-node")
            .transition().duration(450)
            .style("opacity", function(d) {
                if (d === focusedIso) return 1;
                return partners.has(d) ? 0.95 : 0.18;
            });

        this.g.selectAll(".map-label-unified")
            .transition().duration(450)
            .style("opacity", function(d) {
                if (d === focusedIso) return 1;
                return partners.has(d) ? 0.85 : 0.2;
            });

        // Lazy-build reverse isoMap (iso3 → numeric code string)
        if (!this._reverseIsoMap) {
            this._reverseIsoMap = {};
            Object.entries(this.isoMap).forEach(([num, iso3]) => { this._reverseIsoMap[iso3] = num; });
        }
        const focusedCode = this._reverseIsoMap[iso];
        const aliasCodes  = this._territoryAliases[iso] || [];
        const highlightCodes = new Set([focusedCode, ...aliasCodes].filter(Boolean));

        this.g.selectAll(".land")
            .transition().duration(450)
            .style("opacity", function(d) {
                return (d && highlightCodes.has(String(d.properties.code))) ? 1 : 0.35;
            })
            .attr("fill", function(d) {
                const base = (d && highlightCodes.has(String(d.properties.code))) ? "#EAF4FB" : "#FAFAFA";
                return self._specialFill(d, base);
            });

        this._renderHalo(iso);
        this._renderParticles(iso, visibleFlows);
    },

    toggleSeaRoute() {
        this.searouteMode = !this.searouteMode;
        document.dispatchEvent(new CustomEvent('shc:searoute-toggled', { detail: { active: this.searouteMode } }));
        if (!this.focusedIso || !this.g) return;
        const focusedIso = this.focusedIso;
        const self = this;
        this.g.selectAll(".trade-arc")
            .attr("d", function(d) {
                if (d.exporter !== focusedIso && d.importer !== focusedIso) return d3.select(this).attr("d");
                if (self.searouteMode) {
                    const rp = self._buildRoutePath(d);
                    if (rp) return rp;
                }
                const s = STATE.countryCoords[d.exporter];
                const t = STATE.countryCoords[d.importer];
                if (!s || !t) return d3.select(this).attr("d");
                const p1 = self.projection(s);
                const p2 = self.projection(t);
                if (!p1 || !p2) return d3.select(this).attr("d");
                const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
                const dr = Math.sqrt(dx * dx + dy * dy) * 1.3;
                return `M${p1[0]},${p1[1]}A${dr},${dr} 0 0,1 ${p2[0]},${p2[1]}`;
            });
    },

    clearFocus() {
        if (!this.g) return;
        this.focusedIso = null;
        this.searouteMode = false;

        const self = this;

        // Snap path shapes back to circular arcs immediately, before opacity animates in.
        // Cache selection to avoid traversing the DOM twice.
        const clearArcs = this.g.selectAll(".trade-arc");
        clearArcs.attr("d", function(d) {
                const s = STATE.countryCoords[d.exporter];
                const t = STATE.countryCoords[d.importer];
                if (!s || !t) return this.getAttribute("d");
                const p1 = self.projection(s);
                const p2 = self.projection(t);
                if (!p1 || !p2) return this.getAttribute("d");
                const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
                const dr = Math.sqrt(dx * dx + dy * dy) * 1.3;
                return `M${p1[0]},${p1[1]}A${dr},${dr} 0 0,1 ${p2[0]},${p2[1]}`;
            });

        // Then fade opacity back in (same selection, no second DOM traversal)
        clearArcs.transition().duration(400)
            .style("opacity", function() {
                return +this.getAttribute("data-base-opacity") || 0.5;
            });

        this.g.selectAll(".country-node")
            .transition().duration(400).style("opacity", 1);

        this.g.selectAll(".map-label-unified")
            .transition().duration(400).style("opacity", 1);

        this.g.selectAll(".land")
            .transition().duration(400)
            .style("opacity", 1)
            .attr("fill", d => this._specialFill(d, "#FAFAFA"));

        this._clearHalo();
        this._clearParticles();
    },

    _renderHalo(iso) {
        const coords = STATE.countryCoords[iso];
        if (!coords) return;
        const projected = this.projection(coords);
        if (!projected) return;

        let currentK = 1;
        if (this.svg) currentK = d3.zoomTransform(this.svg.node()).k;

        let halo = this.g.select(".focus-halo");
        if (halo.empty()) {
            halo = this.g.append("g").attr("class", "focus-halo");
            halo.append("circle").attr("class", "halo-pulse halo-pulse-1");
            halo.append("circle").attr("class", "halo-pulse halo-pulse-2");
            halo.append("circle").attr("class", "halo-core");
        }
        const baseR = 14 / currentK;
        halo.select(".halo-pulse-1").attr("cx", projected[0]).attr("cy", projected[1]).attr("r", baseR);
        halo.select(".halo-pulse-2").attr("cx", projected[0]).attr("cy", projected[1]).attr("r", baseR);
        halo.select(".halo-core").attr("cx", projected[0]).attr("cy", projected[1]).attr("r", 4 / currentK);
        halo.raise();
    },

    _clearHalo() {
        if (this.g) this.g.selectAll(".focus-halo").remove();
    },

    _renderParticles(iso, visibleFlows) {
        this._clearParticles();
        if (!this.g) return;

        const focusedFlows = (visibleFlows || [])
            .filter(d => d.exporter === iso || d.importer === iso)
            .sort((a, b) => b.netValue - a.netValue)
            .slice(0, 25);

        if (focusedFlows.length === 0) return;
        const maxVal = focusedFlows[0].netValue || 1;

        const layer = this.g.append("g").attr("class", "particle-layer").style("pointer-events", "none");

        focusedFlows.forEach(d => {
            const arcId = `arc-${d.exporter}-${d.importer}`;
            const intensity = Math.min(1, d.netValue / maxVal);
            const count = 1 + Math.round(intensity * 2);
            const dur = (4.5 - intensity * 2.3).toFixed(2) + "s";
            const color = CONFIG.flowColors[d.flowCategory] || "#0284c7";

            for (let i = 0; i < count; i++) {
                const offset = i / count;
                const particle = layer.append("circle")
                    .attr("class", "trade-particle")
                    .attr("r", 1.6).attr("fill", color)
                    .attr("stroke", "#ffffff").attr("stroke-width", 0.4).attr("opacity", 0.95);

                const motion = particle.append("animateMotion")
                    .attr("dur", dur).attr("repeatCount", "indefinite")
                    .attr("rotate", "auto")
                    .attr("begin", (offset * parseFloat(dur)).toFixed(2) + "s");

                motion.append("mpath")
                    .attr("href", `#${arcId}`)
                    .attr("xlink:href", `#${arcId}`);
            }
        });
    },

    _clearParticles() {
        if (this.g) this.g.selectAll(".particle-layer").remove();
    },

    renderLegend() {
        const container = document.getElementById('legend-content');
        if (!container) return;

        const netFlows = STATE.filteredData || [];

        const _legendKey = `${netFlows.length}_${STATE.totalBilateral}_${STATE.thresholdMode}_${STATE.effectiveThreshold}_${[...STATE.flowFilters].sort().join(',')}`;
        if (this._lastLegendKey === _legendKey) return;
        this._lastLegendKey = _legendKey;

        const fmtShort = this._fmtShort.bind(this);

        // Flow categories
        const categories = [
            { key: 'north-south', label: 'N→S' },
            { key: 'south-north', label: 'S→N' },
            { key: 'south-south', label: 'S→S' },
            { key: 'north-north', label: 'N→N' },
        ];

        const catStats = {};
        categories.forEach(c => { catStats[c.key] = { count: 0, total: 0 }; });
        netFlows.forEach(d => {
            if (catStats[d.flowCategory]) {
                catStats[d.flowCategory].count++;
                catStats[d.flowCategory].total += d.netValue;
            }
        });

        const flowItems = categories.map(c => {
            const active   = STATE.flowFilters.has(c.key);
            const stat     = catStats[c.key];
            const valStr   = stat.count > 0 ? `$${fmtShort(stat.total)}` : '—';
            const cntStr   = stat.count > 0 ? `${stat.count}` : '0';
            return `<div class="legend-flow-item" style="opacity:${active ? 1 : 0.3}">
                <span class="legend-flow-dot" style="background:${CONFIG.flowColors[c.key]}"></span>
                <span class="legend-flow-label">${c.label}</span>
                <span class="legend-flow-stat">${cntStr} · ${valStr}</span>
            </div>`;
        }).join('');

        // Threshold
        const isManual = STATE.thresholdMode !== 'auto';
        const currentThreshold = STATE.effectiveThreshold ?? (isManual ? STATE.thresholdMode : 10000000);
        const arcCount = netFlows.length;

        container.innerHTML = `
            <div class="legend-section">
                <span class="legend-section-label">Flows</span>
                <div class="legend-flows">${flowItems}</div>
            </div>
            <span class="legend-bar-divider"></span>
            <div class="legend-section">
                <span class="legend-section-label">Nodes</span>
                <div class="legend-nodes">
                    <span class="legend-nodes-hint">← Imp</span>
                    <span class="legend-node" style="width:14px;height:14px;background:#ED1847" title="Strong net importer"></span>
                    <span class="legend-node" style="width:10px;height:10px;background:#F9C0C5" title="Net importer"></span>
                    <span class="legend-node" style="width:7px;height:7px;background:#F7DFDF"  title="Slight net importer"></span>
                    <span class="legend-node" style="width:4px;height:4px;background:#DED9D5;border:1px solid #AEA29A" title="Balanced"></span>
                    <span class="legend-node" style="width:7px;height:7px;background:#E3EDF6"  title="Slight net exporter"></span>
                    <span class="legend-node" style="width:10px;height:10px;background:#C5DFEF" title="Net exporter"></span>
                    <span class="legend-node" style="width:14px;height:14px;background:#009EDB" title="Strong net exporter"></span>
                    <span class="legend-nodes-hint">Exp →</span>
                </div>
            </div>
            <span class="legend-bar-divider"></span>
            <div class="legend-section">
                <span class="legend-section-label">Threshold</span>
                <span class="legend-threshold-badge${isManual ? ' manual' : ''}">${isManual ? 'MANUAL' : 'AUTO'}</span>
                <span class="legend-threshold-val">$${fmtShort(currentThreshold)}</span>
                <span class="legend-arc-count">${arcCount} arcs</span>
            </div>
        `;

        // Update stats
        const shownTotal     = d3.sum(netFlows, d => d.netValue);
        const bilateralTotal = STATE.totalBilateral || 0;
        const coverage       = bilateralTotal > 0 ? (shownTotal / bilateralTotal * 100) : 0;

        const statEl    = document.getElementById('stat-value');
        const bilatEl   = document.getElementById('stat-bilateral');
        const coverageEl = document.getElementById('stat-coverage');
        if (statEl)    statEl.innerText    = '$' + fmtShort(shownTotal);
        if (bilatEl)   bilatEl.innerText   = '$' + fmtShort(bilateralTotal);
        if (coverageEl) coverageEl.innerText = `${coverage.toFixed(1)}% shown`;
    }
};
