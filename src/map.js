import { ascending, easeCubicOut, easeElasticOut, format, geoGraticule, geoNaturalEarth1, geoPath, interpolateHcl, interpolateNumber, max, pointer, quantile, scaleLinear, scaleSqrt, select, sum, zoom, zoomIdentity, zoomTransform } from 'd3';
import { CONFIG, STATE, METRIC_FORMAT, isCompact, isCompactTall } from './config.js';
import { RegionConfig } from './regions.js';
// md() returns 0 ms under reduced motion; transition end callbacks still fire.
import { motionDuration as md, prefersReducedMotion } from './motion.js';

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

    // ── Interactive line filter (draw bilateral connections on the map)
    lineFilterMode: false,
    _pendingExporter: null,

    // Territories highlighted with China: UNCTAD treats HKG, MAC and TWN as part of China.
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

    // Numeric codes to highlight together with the given code (CHN ↔ HKG/MAC/TWN).
    _getHoverGroup(codeStr) {
        if (!this._reverseIsoMap) {
            this._reverseIsoMap = {};
            Object.entries(this.isoMap).forEach(([num, iso3]) => { this._reverseIsoMap[iso3] = num; });
        }
        const group = new Set([codeStr]);
        const iso3 = this.isoMap[codeStr];
        if (iso3) {
            (this._territoryAliases[iso3] || []).forEach(c => { group.add(String(c)); });
        }
        for (const [mainIso, aliasList] of Object.entries(this._territoryAliases)) {
            if (aliasList.includes(codeStr)) {
                const mainCode = this._reverseIsoMap[mainIso];
                if (mainCode) group.add(String(mainCode));
                aliasList.forEach(c => { group.add(String(c)); });
            }
        }
        return group;
    },

    // ── Shared compact number formatter (no currency symbol) used in renderLegend
    _fmtShort(v) {
        const a = Math.abs(v);
        const s = v < 0 ? '-' : '';
        if (a >= 1e9) return `${s + format('.2f')(a / 1e9)}B`;
        if (a >= 1e6) return `${s + format('.2f')(a / 1e6)}M`;
        if (a >= 1e3) return `${s + format('.2f')(a / 1e3)}K`;
        return s + format(',.0f')(a);
    },

    // ── 1. Initialization
    init() {
        const container = document.getElementById("map-container");
        this.width  = container.getBoundingClientRect().width;
        this.height = container.getBoundingClientRect().height;

        if (!this.svg) this.init2D(container);
        const pageScrolls = document.documentElement.scrollHeight > window.innerHeight + 4;
        this._twoFingerPan = !!window.matchMedia?.('(pointer: coarse)').matches && (isCompactTall() || pageScrolls);
        this.svg.style('touch-action', this._twoFingerPan ? 'pan-y' : 'none');

        this.updateDimensions();
        this.updateProjection();
        this.renderStaticMap();
    },

    init2D(container) {
        this.svg = select(container).append("svg")
            .attr("class", "map-2d-layer")
            .style("position", "absolute")
            .style("top", "0").style("left", "0")
            .style("z-index", "1")
            .style("touch-action", "none");

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
        this._graticuleGeo = geoGraticule()(); // static GeoJSON: build once

        this.zoomBehavior = zoom()
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
                    this.g.selectAll(".border-dashed").attr("stroke-width", 1 / k).attr("stroke-dasharray", `${4/k},${3/k}`);
                    this.g.selectAll(".border-dotted").attr("stroke-width", 1 / k).attr("stroke-dasharray", `${1.5/k},${2.5/k}`);
                    this.g.selectAll(".border-dash-dotted").attr("stroke-width", 1 / k).attr("stroke-dasharray", `${5/k},${2/k},${1.5/k},${2/k}`);
                    this.g.selectAll(".border-plain").attr("stroke-width", 0.8 / k); // was 0.5 / k like the land outlines
                    this.g.selectAll(".trade-arc").attr("stroke-width", function() {
                        return (+this.getAttribute("data-original-width") || 1) / k;
                    });
                    this.g.selectAll(".country-node").attr("r", function() {
                        return (+this.getAttribute("data-original-radius") || 3) / k;
                    }).attr("stroke-width", 1.5 / k);
                    this.g.selectAll(".map-label")
                        .attr("font-size", `${8.5 / Math.sqrt(k)}px`)
                        .attr("stroke-width", 2.5 / k);
                    this.g.selectAll(".line-filter-temp")
                        .attr("stroke-width", 2 / k)
                        .attr("stroke-dasharray", `${6/k},${5/k}`);
                    this.g.selectAll(".line-filter-tip").attr("r", 3 / k);
                    this.g.selectAll(".lf-start-pulse").attr("r", 10 / k);
                    this.g.selectAll(".lf-start-core").attr("r", 4 / k);
                });
            });
        this.zoomBehavior.filter(event => this._zoomFilter(event));
        this.svg.call(this.zoomBehavior);

        // Portrait phones: one finger scrolls the page, two fingers move the map
        this.svg.on('touchmove.hint', (event) => {
            if (this._twoFingerPan && event.touches && event.touches.length === 1) this._showMapHint('Use two fingers to move the map');
        }, { passive: true });
    },

    wheelZoom: true,
    _zoomFilter(event) {
        if (event.type === 'wheel') return this.wheelZoom !== false;
        if (event.type.startsWith('touch')) return !this._twoFingerPan || (event.touches && event.touches.length >= 2);
        return !event.ctrlKey && !event.button;
    },

    _showMapHint(text) {
        const area = document.querySelector('.map-area');
        if (!area) return;
        let hint = document.getElementById('map-hint');
        if (!hint) {
            hint = document.createElement('div');
            hint.id = 'map-hint';
            hint.setAttribute('role', 'status');
            area.appendChild(hint);
        }
        hint.textContent = text;
        hint.classList.add('show');
        clearTimeout(this._hintTimer);
        this._hintTimer = setTimeout(() => hint.classList.remove('show'), 1400);
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

        // Vertical margins keep the map clear of the UI panels.
        const yTop = this.height * (isPortrait ? 0.02 : 0.06);
        const yBot = this.height * (isPortrait ? 0.02 : 0.12);

        this.projection = geoNaturalEarth1()
            .fitExtent([[0, yTop], [this.width, this.height - yBot]], { type: 'Sphere' });

        this.path = geoPath().projection(this.projection);
    },

    zoomToRegion(regionName) {
        if (!this.zoomBehavior) return;

        const config = RegionConfig.regions[regionName];
        if (!config) return;

        // World: fit the inhabited land (no Antarctica) to the map area
        if (regionName === 'Global') {
            const fit = this._worldFitTransform();
            if (fit) {
                this.svg.transition().duration(md(1200)).call(this.zoomBehavior.transform, fit);
                return;
            }
        }

        const [targetLon, targetLat] = config.center;
        let targetScale = config.scale;

        // Portrait world view: zoom out until the map fits the width
        if (regionName === "Global" && this.height > this.width) {
            const baseScaleX = this.width / 6.28;
            const currentBaseScale = this.projection.scale();
            targetScale = baseScaleX / currentBaseScale;
        }

        const projectedPoint = this.projection([targetLon, targetLat]);
        if (!projectedPoint) return;

        const k = Math.max(0.2, targetScale);
        const tx = (this.width / 2) - (projectedPoint[0] * k);
        const ty = (this.height / 2) - (projectedPoint[1] * k);

        const transform = zoomIdentity.translate(tx, ty).scale(k);

        this.svg.transition()
            .duration(md(1200))
            .call(this.zoomBehavior.transform, transform);
    },

    _worldFitTransform() {
        if (!STATE.geoData?.features || !this.path) return null;
        if (!this._worldLand) {
            this._worldLand = {
                type: 'FeatureCollection',
                features: STATE.geoData.features.filter(f => !['10', '010', 'ATA'].includes(String(f.properties?.code))),
            };
        }
        const [[x0, y0], [x1, y1]] = this.path.bounds(this._worldLand);
        const bw = x1 - x0, bh = y1 - y0;
        if (!(bw > 0 && bh > 0)) return null;
        const k = Math.max(0.2, Math.min(8, Math.min(this.width * 0.97 / bw, this.height * 0.92 / bh)));
        // "Zoom out" must never zoom in: let the minimum zoom reach the world view
        const [lo, hi] = this.zoomBehavior.scaleExtent();
        if (k < lo) this.zoomBehavior.scaleExtent([k, hi]);
        return zoomIdentity
            .translate(this.width / 2 - (x0 + bw / 2) * k, this.height / 2 - (y0 + bh / 2) * k)
            .scale(k);
    },

    // Zoom in or out around the centre of the map (+ / − buttons).
    zoomBy(factor) {
        if (!this.svg || !this.zoomBehavior) return;
        this.svg.transition().duration(md(350)).call(this.zoomBehavior.scaleBy, factor);
    },

    // Zoom to a single country's centroid. `scale` plays the same role as RegionConfig.scale.
    zoomToCountry(iso, scale = 3.5, duration = 1200) {
        if (!this.zoomBehavior) return;
        const coords = STATE.countryCoords[iso];
        if (!coords) return;
        const p = this.projection(coords);
        if (!p) return;
        const k = Math.max(0.2, scale);
        const panel = document.getElementById('insight-panel');
        const offset = panel?.classList.contains('open') && !isCompact() ? panel.getBoundingClientRect().width / 2 : 0;
        const tx = (this.width / 2 - offset) - (p[0] * k);
        const ty = (this.height / 2) - (p[1] * k);
        this.svg.transition()
            .duration(md(duration))
            .call(this.zoomBehavior.transform, zoomIdentity.translate(tx, ty).scale(k));
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
            .data([this._graticuleGeo || geoGraticule()()]);

        graticulePath.enter().append("path")
            .attr("class", "graticule")
            .attr("fill", "none")
            .attr("stroke", "#EBEAE6")
            .attr("stroke-width", 0.5)
            .attr("stroke-opacity", 0.8)
            .merge(graticulePath)
            .attr("d", this.path);

        const lands = landLayer.selectAll("path.land")
            .data(STATE.geoData.features, d => d.properties?.code);

        lands.exit().remove();

        const landsEnter = lands.enter().append("path")
            .attr("class", "land")
            .attr("stroke", "#C8C2BB")
            .attr("stroke-width", 0.5)
            .style("transition", "fill 0.2s ease")
            .on("mouseover", (_event, d) => {
                if (!d?.properties) return;
                const group = this._getHoverGroup(String(d.properties.code));
                this.g.selectAll("path.land")
                    .filter(ld => ld?.properties && group.has(String(ld.properties.code)))
                    .attr("fill", ld => this._specialFill(ld, "#BDB5AE"));
            })
            .on("mouseout", (_event, d) => {
                if (!d?.properties) return;
                const group = this._getHoverGroup(String(d.properties.code));
                const focusCode = this.focusedIso && this._reverseIsoMap?.[this.focusedIso];
                const focusAliases = this.focusedIso ? (this._territoryAliases[this.focusedIso] || []) : [];
                const focusGroup = new Set([focusCode, ...focusAliases].filter(Boolean));
                this.g.selectAll("path.land")
                    .filter(ld => ld?.properties && group.has(String(ld.properties.code)))
                    .attr("fill", ld => {
                        if (focusGroup.has(String(ld.properties.code))) return this._specialFill(ld, "#C5DFEF");
                        return this._specialFill(ld, this.focusedIso ? "#D8D3D0" : "#D0C9C3");
                    });
            })
            .on("click", (event, d) => {
                if (!d?.properties) return;
                const iso = this._codeToIso(d.properties.code);
                if (this.lineFilterMode) {
                    event.stopPropagation();
                    this._handleCountryPick(iso);
                    return;
                }
                // A country shape opens its panel, like its circle
                if (iso && STATE.trendSummary?.[iso]) {
                    event.stopPropagation();
                    document.dispatchEvent(new CustomEvent('shc:country-click', { detail: iso }));
                }
            });

        landsEnter.merge(lands)
            .attr("fill", d => this._specialFill(d, "#D0C9C3"))
            .attr("d", this.path);

        this._renderBorderLayers(landLayer);
    },

    // Border lines and small-island dots. Borders are white per UN cartographic standard (colour set in CSS).
    _renderBorderLayers(landLayer) {
        if (!STATE.borderLayers) return;

        const specs = [
            { key: 'plain',      cls: 'border-plain',       dasharray: null,          width: 0.6 },
            { key: 'dashed',     cls: 'border-dashed',      dasharray: '4,3',         width: 0.75 },
            { key: 'dotted',     cls: 'border-dotted',      dasharray: '1.5,2.5',     width: 0.75 },
            { key: 'dashDotted', cls: 'border-dash-dotted', dasharray: '5,2,1.5,2',   width: 0.75 },
        ];

        specs.forEach(({ key, cls, dasharray, width }) => {
            const features = STATE.borderLayers[key];
            if (!features) return;

            const paths = landLayer.selectAll(`path.${cls}`)
                .data(features.features, d => d.properties?.code);

            paths.exit().remove();

            const entered = paths.enter().append("path")
                .attr("class", `border ${cls}`)
                .attr("stroke-width", width);

            if (dasharray) entered.attr("stroke-dasharray", dasharray);

            entered.merge(paths).attr("d", this.path);
        });

        // Island dots only for economies with no polygon (the point layer covers every economy)
        if (STATE.countryPoints && STATE.geoData) {
            const polygonCodes = new Set(
                STATE.geoData.features.map(f => String(f.properties.code))
            );
            const pointOnlyFeatures = STATE.countryPoints.features.filter(
                f => !polygonCodes.has(String(f.properties?.code))
            );

            const dots = landLayer.selectAll("circle.economy-point")
                .data(pointOnlyFeatures, d => d.properties?.code);

            dots.exit().remove();

            dots.enter().append("circle")
                .attr("class", "economy-point")
                .attr("r", 2)
                .attr("fill", "#D0C9C3")
                .attr("stroke", "#C8C2BB")
                .attr("stroke-width", 0.5)
                .style("pointer-events", this.lineFilterMode ? "all" : "none")
                .on("click", (event, d) => {
                    if (!this.lineFilterMode || !d?.properties) return;
                    event.stopPropagation();
                    this._handleCountryPick(this._codeToIso(d.properties.code));
                })
                .merge(dots)
                .attr("cx", d => (this.projection(d.geometry.coordinates) || [])[0])
                .attr("cy", d => (this.projection(d.geometry.coordinates) || [])[1]);
        }
    },

    // ── Flow rendering (Export Value / 2D only)
    // Wrap searoute's extended longitudes to [-180, 180] and split at the antimeridian.
    normalizeRoute(geometry) {
        if (geometry?.type !== 'LineString') return geometry;
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

    // Sea-route path for a focused inter-regional flow, memoized per pair.
    _buildRoutePath(d) {
        const expRegion = RegionConfig.getRegion(d.exporter);
        const impRegion = RegionConfig.getRegion(d.importer);
        if (expRegion === impRegion || expRegion === 'Other' || impRegion === 'Other') return null;

        if (!this._routePathCache) this._routePathCache = new Map();
        const cacheKey = `${d.exporter}|${d.importer}`;
        if (this._routePathCache.has(cacheKey)) return this._routePathCache.get(cacheKey);

        const routeKey = [d.exporter, d.importer].sort().join("|");
        const route = STATE.routes?.[routeKey];
        if (!route) return null;

        const expCoord = STATE.countryCoords[d.exporter];
        const impCoord = STATE.countryCoords[d.importer];

        const normalized = this.normalizeRoute(route.geometry);
        let segs = normalized.coordinates;

        // Direction from origin_iso; centroids mislead when the port is far away (CAN, USA).
        const originIso = route.properties?.origin_iso;
        if (originIso && originIso !== d.exporter) {
            segs = segs.map(s => [...s].reverse()).reverse();
        }

        // Join the route to both centroids
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

        const netFlows  = STATE.filteredData;
        const nodeStats = STATE.nodeStats;

        if (!netFlows || netFlows.length === 0) {
            this.g.selectAll(".trade-arc, .country-node, .map-label-unified")
                .classed("is-exiting", true)
                .transition().duration(md(500)).style("opacity", 0).remove();
            if (this.renderLegend) this.renderLegend();
            return;
        }

        let currentK = 1;
        if (this.svg) {
            currentK = zoomTransform(this.svg.node()).k;
        }

        // Projection cache: each ISO is projected at most once per render call
        const _projCache = {};
        const projOf = (iso) => {
            if (!_projCache[iso]) _projCache[iso] = this.getProjectedPoint(iso);
            return _projCache[iso];
        };

        const nodeStatsArr  = Object.values(nodeStats);
        const isFocused = STATE.selectedExporters.size > 0 || STATE.selectedImporters.size > 0;

        // Circle colour = net balance before display cut-offs; size = total of the lines drawn.
        const rawStats = STATE.rawNodeStats || nodeStats;
        const netOf = (iso) => (rawStats[iso] || nodeStats[iso]).netBalance;

        if (nodeStatsArr.length === 0 || netFlows.length === 0) return;

        const sortedGross   = nodeStatsArr.map(d => d.grossVolume).sort(ascending);
        const sortedNetBal  = Object.keys(nodeStats).map(iso => Math.abs(netOf(iso))).sort(ascending);
        const sortedNetFlows= netFlows.map(d => d.netValue).sort(ascending);

        const p98Gross      = quantile(sortedGross, 0.98) || max(sortedGross) || 1;
        const p98NetBal     = quantile(sortedNetBal, 0.98) || max(sortedNetBal) || 1;
        const p98NetFlows   = quantile(sortedNetFlows, 0.98) || max(sortedNetFlows) || 1;

        //need to adjust the size
        const maxRadius    = Math.max(Math.min(this.width * 0.010, 20), 1);
        const maxEdgeWidth = Math.max(Math.min(this.width * 0.008, 12), 1);

        const radiusScale = scaleSqrt()
            .domain([0, p98Gross])
            .range(isFocused ? [3, maxRadius] : [1.5, maxRadius * 0.7])
            .clamp(true);

        const edgeWidthScale = scaleSqrt()
            .domain([0, p98NetFlows])
            .range(isFocused ? [1.5, maxEdgeWidth] : [0.5, maxEdgeWidth * 0.7])
            .clamp(true);

        const opacityScale = scaleLinear()
            .domain([0, p98NetFlows])
            .range(isFocused ? [0.3, 0.95] : [0.15, 0.85])
            .clamp(true);

        const maxTransformed = Math.sqrt(p98NetBal);
        // Circle colours: the official --un-color-* values, written out (replaces initColors() of 6073616)
        const _colorScaleFn = scaleLinear()
            .domain([-maxTransformed, -maxTransformed * 0.15, 0, maxTransformed * 0.15, maxTransformed])
            .range(["#ED1847", "#F9C0C5", "#ffffff", "#C5DFEF", "#009EDB"])
            .interpolate(interpolateHcl)
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

        // Mark leaving elements so a focus transition can't cancel their removal.
        arcs.exit()
            .classed("is-exiting", true)
            .transition().duration(md(500))
            .style("opacity", 0)
            .remove();
        arcs.classed("is-exiting", false);

        const focusedIso = this.focusedIso;

        // Build the partner set once: O(n+m) instead of O(n×m)
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
            .transition().duration(md(750)).ease(easeCubicOut)
            .attr("stroke", d => CONFIG.flowColors[d.flowCategory])
            .attr("stroke-width", d => edgeWidthScale(d.netValue) / currentK)
            .style("opacity", arcOpacity);

        // --- 2. Nodes (circles) ---
        const activeNodes = Object.keys(nodeStats).filter(d => this.isVisible(d));

        const nodes = nodeLayer.selectAll(".country-node")
            .data(activeNodes, d => d);

        nodes.exit()
            .classed("is-exiting", true)
            .transition().duration(md(500))
            .attr("r", 0)
            .style("opacity", 0)
            .remove();
        nodes.classed("is-exiting", false);

        const nodesEnter = nodes.enter()
            .append("circle")
            .attr("class", "country-node")
            .attr("stroke", "#DED9D5")
            .style("opacity", 0)
            .on("mouseover", (event, d) => document.dispatchEvent(new CustomEvent('shc:country-hover', { detail: { event, country: d } })))
            .on("mouseout",  () => document.dispatchEvent(new CustomEvent('shc:country-hoverend')))
            .on("click",     (event, d) => {
                event.stopPropagation();
                if (this.lineFilterMode) { this._handleCountryPick(d); return; }
                document.dispatchEvent(new CustomEvent('shc:country-click', { detail: d }));
            });

        const nodeOpacity = (d) => {
            if (!focusedIso) return 1;
            if (d === focusedIso) return 1;
            return focusedPartnerSet.has(d) ? 0.95 : 0.18;
        };

        nodesEnter.merge(nodes)
            .attr("data-original-radius", d => radiusScale(nodeStats[d].grossVolume))
            // Set cx/cy outside the transition: a later focus transition would cancel it.
            .attr("cx", d => projOf(d)[0])
            .attr("cy", d => projOf(d)[1])
            .transition().duration(md(750)).ease(easeElasticOut)
            // Clamp: the elastic ease can overshoot to a negative radius.
            .attrTween("r", function (d) {
                const i = interpolateNumber(+this.getAttribute("r") || 0, radiusScale(nodeStats[d].grossVolume) / currentK);
                return t => Math.max(0, i(t));
            })
            .attr("fill", d => colorScale(netOf(d)))
            .attr("stroke-width", 1.5 / currentK)
            .style("opacity", nodeOpacity);

        // --- 3. Labels ---
        // Countries placed above their node to avoid overlapping adjacent labels.
        const LABEL_ABOVE = new Set(['GTM', 'KOR']);

        const sortedNodes = activeNodes.slice().sort((a, b) => nodeStats[b].grossVolume - nodeStats[a].grossVolume);
        const volumeThreshold = sortedNodes.length > 15 ? nodeStats[sortedNodes[14]].grossVolume : 0;

        const isLabelVisible = (d) => {
            const isNetExporter = netOf(d) >= 0;
            if (isNetExporter  && !STATE.showExporterLabels) return false;
            if (!isNetExporter && !STATE.showImporterLabels) return false;
            if (currentK >= 2.5) return true;
            return nodeStats[d].grossVolume >= volumeThreshold;
        };

        const visibleLabels = activeNodes.filter(d => isLabelVisible(d));

        const labels = labelLayer.selectAll(".map-label-unified")
            .data(visibleLabels, d => d);

        labels.exit()
            .classed("is-exiting", true)
            .transition().duration(md(300))
            .style("opacity", 0)
            .remove();
        labels.classed("is-exiting", false);

        const labelsEnter = labels.enter()
            .append("text")
            .attr("class", "map-label map-label-unified")
            .attr("font-family", "Inter, sans-serif")
            .attr("font-weight", "600") // slightly bold for legibility
            .style("pointer-events", "none")
            .style("paint-order", "stroke fill") // draw the halo outside the glyphs only
            .style("opacity", 0);

        const labelOpacity = (d) => {
            if (!focusedIso) return 1;
            if (d === focusedIso) return 1;
            return focusedPartnerSet.has(d) ? 0.85 : 0.2;
        };

        labelsEnter.merge(labels)
            .text(d => STATE.countryNames[d] || d)
            .attr("fill", "#6E6259")
            .attr("stroke", "#DED9D5") // light halo for legibility
            .attr("stroke-linejoin", "round")
            // Position set outside the transition, as for nodes.
            .attr("text-anchor", d => LABEL_ABOVE.has(d) ? "middle" : "start")
            .attr("x", d => LABEL_ABOVE.has(d)
                ? projOf(d)[0]
                : projOf(d)[0] + (radiusScale(nodeStats[d].grossVolume) / currentK) + 4)
            .attr("y", d => LABEL_ABOVE.has(d)
                ? projOf(d)[1] - (radiusScale(nodeStats[d].grossVolume) / currentK) - 3
                : projOf(d)[1] + 4)
            .attr("font-size", `${8.5 / Math.sqrt(currentK)}px`) // slightly smaller than 10px
            .attr("stroke-width", 2.5 / currentK)
            .transition().duration(md(750))
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

        // Set path shapes before the opacity fade to avoid a D3 path interpolation glitch.
        const focusArcs = this.g.selectAll(".trade-arc:not(.is-exiting)");
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

        focusArcs.transition().duration(md(450))
            .style("opacity", function(d) {
                const base = +this.getAttribute("data-base-opacity") || 0.5;
                if (d.exporter === focusedIso || d.importer === focusedIso) return base;
                return 0;
            });

        this.g.selectAll(".country-node:not(.is-exiting)")
            .transition().duration(md(450))
            .style("opacity", (d) => {
                if (d === focusedIso) return 1;
                return partners.has(d) ? 0.95 : 0.18;
            });

        this.g.selectAll(".map-label-unified:not(.is-exiting)")
            .transition().duration(md(450))
            .style("opacity", (d) => {
                if (d === focusedIso) return 1;
                return partners.has(d) ? 0.85 : 0.2;
            });

        if (!this._reverseIsoMap) {
            this._reverseIsoMap = {};
            Object.entries(this.isoMap).forEach(([num, iso3]) => { this._reverseIsoMap[iso3] = num; });
        }
        const focusedCode = this._reverseIsoMap[iso];
        const aliasCodes  = this._territoryAliases[iso] || [];
        const highlightCodes = new Set([focusedCode, ...aliasCodes].filter(Boolean));

        // Selected country light blue (--map-focus-fill); the rest a lighter grey that still reads as land.
        // Dim with a flat colour, not opacity (costly repaints); only the hatched polygon fades.
        this.g.selectAll(".land")
            .transition().duration(md(450))
            .style("opacity", (d) => {
                const on = d && highlightCodes.has(String(d.properties.code));
                return (on || self._specialFill(d, null) === null) ? 1 : 0.8;
            })
            .attr("stroke", (d) => (d && highlightCodes.has(String(d.properties.code))) ? "#C8C2BB" : "#D6D1CD")
            .attr("fill", (d) => {
                const base = (d && highlightCodes.has(String(d.properties.code))) ? "#C5DFEF" : "#D8D3D0";
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
                if (d.exporter !== focusedIso && d.importer !== focusedIso) return select(this).attr("d");
                if (self.searouteMode) {
                    const rp = self._buildRoutePath(d);
                    if (rp) return rp;
                }
                const s = STATE.countryCoords[d.exporter];
                const t = STATE.countryCoords[d.importer];
                if (!s || !t) return select(this).attr("d");
                const p1 = self.projection(s);
                const p2 = self.projection(t);
                if (!p1 || !p2) return select(this).attr("d");
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

        // Snap paths back to arcs before the opacity fade.
        const clearArcs = this.g.selectAll(".trade-arc:not(.is-exiting)");
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

        clearArcs.transition().duration(md(400))
            .style("opacity", function() {
                return +this.getAttribute("data-base-opacity") || 0.5;
            });

        this.g.selectAll(".country-node:not(.is-exiting)")
            .transition().duration(md(400)).style("opacity", 1);

        this.g.selectAll(".map-label-unified:not(.is-exiting)")
            .transition().duration(md(400)).style("opacity", 1);

        this.g.selectAll(".land").transition("land-stroke").duration(md(400)).attr("stroke", "#C8C2BB");
        this.g.selectAll(".land")
            .transition().duration(md(400))
            .style("opacity", 1)
            .attr("fill", d => this._specialFill(d, "#D0C9C3"));

        this._clearHalo();
        this._clearParticles();
    },

    _renderHalo(iso) {
        const coords = STATE.countryCoords[iso];
        if (!coords) return;
        const projected = this.projection(coords);
        if (!projected) return;

        let currentK = 1;
        if (this.svg) currentK = zoomTransform(this.svg.node()).k;

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
        // Particles are decoration only; skip them under reduced motion.
        if (prefersReducedMotion()) return;

        const focusedFlows = (visibleFlows || [])
            .filter(d => d.exporter === iso || d.importer === iso)
            .sort((a, b) => b.netValue - a.netValue)
            .slice(0, 25);

        if (focusedFlows.length === 0) return;
        const maxVal = focusedFlows[0].netValue || 1;

        const layer = this.g.append("g").attr("class", "particle-layer").style("pointer-events", "none");

        // Glow is a radial gradient, not a CSS filter: filters repaint the whole map every frame.
        let defs = this.svg.select("defs");
        if (defs.empty()) defs = this.svg.insert("defs", ":first-child");
        if (defs.select("#particle-glow").empty()) {
            const grad = defs.append("radialGradient").attr("id", "particle-glow");
            grad.append("stop").attr("offset", "0.45").attr("stop-color", "#fff").attr("stop-opacity", 0.9);
            grad.append("stop").attr("offset", "0.75").attr("stop-color", "#fff").attr("stop-opacity", 0.35);
            grad.append("stop").attr("offset", "1").attr("stop-color", "#fff").attr("stop-opacity", 0);
        }

        focusedFlows.forEach(d => {
            const arcId = `arc-${d.exporter}-${d.importer}`;
            const intensity = Math.min(1, d.netValue / maxVal);
            const count = 1 + Math.round(intensity * 2);
            const dur = `${(4.5 - intensity * 2.3).toFixed(2)}s`;
            const color = CONFIG.flowColors[d.flowCategory] || "#0284c7";

            for (let i = 0; i < count; i++) {
                const offset = i / count;
                const particle = layer.append("g").attr("class", "trade-particle");
                particle.append("circle").attr("class", "trade-particle-glow")
                    .attr("r", 3.4).attr("fill", "url(#particle-glow)");
                particle.append("circle").attr("class", "trade-particle-dot")
                    .attr("r", 1.6).attr("fill", color)
                    .attr("stroke", "#ffffff").attr("stroke-width", 0.4).attr("opacity", 0.95);

                const motion = particle.append("animateMotion")
                    .attr("dur", dur).attr("repeatCount", "indefinite")
                    .attr("rotate", "auto")
                    .attr("begin", `${(offset * parseFloat(dur)).toFixed(2)}s`);

                motion.append("mpath")
                    .attr("href", `#${arcId}`)
                    .attr("xlink:href", `#${arcId}`);
            }
        });
    },

    _clearParticles() {
        if (this.g) this.g.selectAll(".particle-layer").remove();
    },

    // ── Interactive line filter ───────────────────────────────────────────
    // Click exporter, then importer to add a pair. Esc cancels the line in progress.

    toggleLineFilter() {
        if (this.lineFilterMode) this.disableLineFilter();
        else this.enableLineFilter();
        return this.lineFilterMode;
    },

    enableLineFilter() {
        if (!this.svg) return;
        this.lineFilterMode = true;
        this._pendingExporter = null;
        this.svg.classed("line-filter-mode", true);
        if (this.g) this.g.selectAll(".economy-point").style("pointer-events", "all");
        // Namespaced so it doesn't replace the d3.zoom handler
        this.svg.on("mousemove.linefilter", (event) => this._onLineFilterMove(event));
        this._emitLineFilterStage("export");
    },

    disableLineFilter() {
        this.lineFilterMode = false;
        this._pendingExporter = null;
        this._clearPendingVisuals();
        if (this.svg) {
            this.svg.classed("line-filter-mode", false);
            this.svg.on("mousemove.linefilter", null);
        }
        if (this.g) this.g.selectAll(".economy-point").style("pointer-events", "none");
        document.dispatchEvent(new CustomEvent("shc:linefilter-toggled", { detail: { active: false } }));
    },

    // Cancel the half-drawn line; keep the mode and committed pairs.
    cancelLineDraw() {
        if (!this._pendingExporter) return;
        this._pendingExporter = null;
        this._clearPendingVisuals();
        if (this.lineFilterMode) this._emitLineFilterStage("export");
    },

    _emitLineFilterStage(stage) {
        document.dispatchEvent(new CustomEvent("shc:linefilter-toggled", {
            detail: { active: this.lineFilterMode, stage, exporter: this._pendingExporter }
        }));
    },

    _codeToIso(code) {
        return this.isoMap[parseInt(code, 10)] || null;
    },

    // Click handler shared by land polygons, country nodes and island-nation dots.
    _handleCountryPick(iso) {
        if (!iso || !STATE.countryCoords[iso]) return; // need a centroid to anchor the line
        if (!this._pendingExporter) {
            this._pendingExporter = iso;          // 1st click → exporter (start)
            this._setStartHighlight(iso);
            this._emitLineFilterStage("import");
            return;
        }
        if (iso === this._pendingExporter) return;

        const exporter = this._pendingExporter;    // 2nd click → importer (end): commit
        this._pendingExporter = null;
        this._clearPendingVisuals();
        document.dispatchEvent(new CustomEvent("shc:bilateral-pair-added", {
            detail: { exporter, importer: iso }
        }));
        this._emitLineFilterStage("export");
    },

    _onLineFilterMove(event) {
        if (!this.lineFilterMode || !this._pendingExporter) return;
        const s = STATE.countryCoords[this._pendingExporter];
        if (!s) return;
        const p1 = this.projection(s);
        if (!p1) return;
        const p2 = pointer(event, this.g.node()); // g-space matches projection output
        this._drawTempLine(p1, p2);
    },

    _lineFilterLayer() {
        let layer = this.g.select(".line-filter-layer");
        if (layer.empty()) {
            layer = this.g.append("g")
                .attr("class", "line-filter-layer")
                .style("pointer-events", "none");
        }
        layer.raise();
        return layer;
    },

    _drawTempLine(p1, p2) {
        const layer = this._lineFilterLayer();
        const k = this._pendingZoomK || 1;
        const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
        const dr = Math.sqrt(dx * dx + dy * dy) * 1.3;
        const d = `M${p1[0]},${p1[1]}A${dr},${dr} 0 0,1 ${p2[0]},${p2[1]}`;

        let line = layer.select(".line-filter-temp");
        if (line.empty()) line = layer.append("path").attr("class", "line-filter-temp");
        line.attr("d", d)
            .attr("stroke-width", 2 / k)
            .attr("stroke-dasharray", `${6/k},${5/k}`);

        let tip = layer.select(".line-filter-tip");
        if (tip.empty()) tip = layer.append("circle").attr("class", "line-filter-tip");
        tip.attr("cx", p2[0]).attr("cy", p2[1]).attr("r", 3 / k);
    },

    _setStartHighlight(iso) {
        const coords = STATE.countryCoords[iso];
        if (!coords || !this.g) return;
        const p = this.projection(coords);
        if (!p) return;
        const k = this._pendingZoomK || 1;
        const layer = this._lineFilterLayer();
        layer.selectAll(".line-filter-start").remove();
        const g = layer.append("g").attr("class", "line-filter-start");
        g.append("circle").attr("class", "lf-start-pulse")
            .attr("cx", p[0]).attr("cy", p[1]).attr("r", 10 / k);
        g.append("circle").attr("class", "lf-start-core")
            .attr("cx", p[0]).attr("cy", p[1]).attr("r", 4 / k);
    },

    _clearPendingVisuals() {
        if (this.g) this.g.selectAll(".line-filter-temp, .line-filter-tip, .line-filter-start").remove();
    },

    renderLegend() {
        const container = document.getElementById('legend-content');
        if (!container) return;

        const netFlows = STATE.filteredData || [];

        const _legendKey = `${isCompact() ? 'c' : 'w'}_${STATE.metric}_${netFlows.length}_${STATE.totalBilateral}_${STATE.thresholdMode}_${STATE.topNMode}_${STATE.effectiveThreshold}_${[...STATE.flowFilters].sort().join(',')}_${this.lineFilterMode}_${(STATE.bilateralPairs || []).length}`;
        if (this._lastLegendKey === _legendKey) return;
        this._lastLegendKey = _legendKey;

        const mf = METRIC_FORMAT[STATE.metric] || METRIC_FORMAT.value;

        // Short labels on phones (two narrow legend columns)
        const short = isCompact();
        const categories = [
            { key: 'north-south', label: short ? 'N → S' : 'North → South' },
            { key: 'south-north', label: short ? 'S → N' : 'South → North' },
            { key: 'south-south', label: short ? 'S → S' : 'South → South' },
            { key: 'north-north', label: short ? 'N → N' : 'North → North' },
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
            const active = STATE.flowFilters.has(c.key);
            const stat   = catStats[c.key];
            const valStr = stat.count > 0 ? mf.fmt(stat.total) : '—';
            const title  = active ? `${stat.count} line${stat.count === 1 ? '' : 's'} drawn` : 'Hidden by the flow-direction filter';
            return `<div class="lg-flow${active ? '' : ' is-off'}" title="${title}">
                <span class="lg-swatch" style="background:${CONFIG.flowColors[c.key]}"></span>
                <span class="lg-name">${c.label}</span>
                <span class="lg-stat">${active ? `${stat.count} · ${valStr}` : 'off'}</span>
            </div>`;
        }).join('');

        // What limits the lines on the map
        const isManual   = STATE.thresholdMode !== 'auto';
        const isConnect  = this.lineFilterMode || (STATE.bilateralPairs && STATE.bilateralPairs.length > 0);
        const topN       = STATE.topNMode;
        const arcCount   = netFlows.length;
        const linesLabel = `${arcCount.toLocaleString('en-US')} line${arcCount === 1 ? '' : 's'}`;
        let badge, badgeCls, valText;
        if (isConnect) {
            badge = 'CONNECT'; badgeCls = ' manual'; valText = 'drawn connections only';
        } else if (!isManual && topN) {
            badge = `TOP ${topN}`; badgeCls = ' manual'; valText = `largest ${topN}`;
        } else if (!isManual) {
            badge = 'AUTO'; badgeCls = ''; valText = `≥ ${mf.fmt(STATE.effectiveThreshold ?? 10000000)}`;
        } else {
            badge = topN ? `FIXED · TOP ${topN}` : 'FIXED'; badgeCls = ' manual';
            valText = `≥ ${mf.fmt(STATE.thresholdMode)}`;
        }

        const swatch = (bg, title, extra = '') =>
            `<span class="lg-node" style="background:${bg};${extra}" title="${title}"></span>`;

        // Wording "Lines" / "Circles" with Auto / Top N / Manual (replaces "Trade Flows" / "Countries" / "TOP 20")
        container.innerHTML = `
            <div class="lg-sec">
                <div class="lg-title">Lines · net flows${STATE.metric === 'weight' ? ' (weight)' : ' (value)'}</div>
                <div class="lg-flows">${flowItems}</div>
                <div class="lg-note">North (N) = developed, South (S) = developing economies. Line width = size of the net flow.</div>
            </div>
            <div class="lg-sec" title="Circle colour: net balance (exports minus imports) over all flows in the current region or selection. Circle size: total of the lines drawn for the economy.">
                <div class="lg-title">Circles · economies</div>
                <div class="lg-nodes">
                    <span class="lg-nodes-end">Net importer</span>
                    ${swatch('#ED1847', 'Large net importer')}
                    ${swatch('#F9C0C5', 'Net importer')}
                    ${swatch('#ffffff', 'Balanced', 'border:1px solid #AEA29A')}
                    ${swatch('#C5DFEF', 'Net exporter')}
                    ${swatch('#009EDB', 'Large net exporter')}
                    <span class="lg-nodes-end">Net exporter</span>
                </div>
                <div class="lg-note">Colour = net balance in this view; size = total of the lines drawn.</div>
            </div>
            <div class="lg-sec">
                <div class="lg-title">Drawn</div>
                <div class="lg-shown">
                    <span class="legend-threshold-badge${badgeCls}">${badge}</span>
                    <span class="legend-threshold-val">${valText}</span>
                    <span class="legend-arc-count">${linesLabel}</span>
                </div>
            </div>
        `;

        // Update stats
        const shownTotal     = sum(netFlows, d => d.netValue);
        const bilateralTotal = STATE.totalBilateral || 0;
        const coverage       = bilateralTotal > 0 ? (shownTotal / bilateralTotal * 100) : 0;

        const statEl    = document.getElementById('stat-value');
        const bilatEl   = document.getElementById('stat-bilateral');
        const coverageEl = document.getElementById('stat-coverage');
        if (statEl)    statEl.textContent    = mf.fmt(shownTotal);
        if (bilatEl)   bilatEl.textContent   = bilateralTotal > 0 ? mf.fmt(bilateralTotal) : '—';
        if (coverageEl) coverageEl.textContent = bilateralTotal > 0 ? `${coverage.toFixed(1)}%` : '—';
    }
};
