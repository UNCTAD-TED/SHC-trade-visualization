const TradeMap = {
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
            .style("z-index", "1");

        this.svg.append("defs");
        this.g = this.svg.append("g");

        this.zoomBehavior = d3.zoom()
            .scaleExtent([1, 8])
            .on("zoom", (event) => {
                this.g.attr("transform", event.transform);
                const k = event.transform.k;
                this.g.selectAll(".land, .graticule").attr("stroke-width", 0.5 / k);
                this.g.selectAll(".trade-arc").attr("stroke-width", function() {
                    return (+d3.select(this).attr("data-original-width") || 1) / k;
                });
                this.g.selectAll(".country-node").attr("r", function() {
                    return (+d3.select(this).attr("data-original-radius") || 3) / k;
                }).attr("stroke-width", 1.5 / k);
                this.g.selectAll(".map-label").attr("font-size", (10 / Math.sqrt(k)) + "px");
            });
        this.svg.call(this.zoomBehavior);
    },

    updateDimensions() {
        this.svg
            .attr("width", "100%")
            .attr("height", "100%")
            .attr("viewBox", `0 0 ${this.width} ${this.height}`)
            .style("background", "#F0F4F8");
    },

    updateProjection() {
        this.projection = d3.geoEquirectangular()
            .scale(this.width / 6.5)
            .translate([this.width / 2, this.height / 1.8]);

        this.path = d3.geoPath().projection(this.projection);
    },

    zoomToRegion(regionName) {
        if (!this.zoomBehavior) return;

        const config = RegionConfig.regions[regionName];
        if (!config) return;

        const [targetLon, targetLat] = config.center;
        const targetScale = config.scale;

        const projectedPoint = this.projection([targetLon, targetLat]);
        if (!projectedPoint) return;

        const k = targetScale;
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

        const graticule = d3.geoGraticule();

        const graticulePath = landLayer.selectAll(".graticule")
            .data([graticule()]);

        graticulePath.enter().append("path")
            .attr("class", "graticule")
            .attr("fill", "none")
            .attr("stroke", "#E2E8F0")
            .attr("stroke-width", 0.5)
            .attr("stroke-opacity", 0.8)
            .merge(graticulePath)
            .attr("d", this.path);

        const lands = landLayer.selectAll("path.land")
            .data(STATE.geoData.features, d => d.properties.id || d.id);

        lands.exit().remove();

        const landsEnter = lands.enter().append("path")
            .attr("class", "land")
            .attr("stroke", "#CBD5E0")
            .attr("stroke-width", 0.5)
            .style("transition", "fill 0.2s ease")
            .on("mouseover", function() { d3.select(this).attr("fill", "#E2E8F0"); })
            .on("mouseout",  function() { d3.select(this).attr("fill", "#FAFAFA"); });

        landsEnter.merge(lands)
            .attr("fill", "#FAFAFA")
            .attr("d", this.path);
    },

    // ── Flow rendering (Export Value / 2D only)
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

        const nodeStatsArr  = Object.values(nodeStats);
        const isFocused = STATE.selectedExporters.size > 0 || STATE.selectedImporters.size > 0;

        if (nodeStatsArr.length === 0 || netFlows.length === 0) return;

        const sortedGross   = nodeStatsArr.map(d => d.grossVolume).sort(d3.ascending);
        const sortedNetBal  = nodeStatsArr.map(d => Math.abs(d.netBalance)).sort(d3.ascending);
        const sortedNetFlows= netFlows.map(d => d.netValue).sort(d3.ascending);

        const p98Gross      = d3.quantile(sortedGross, 0.98) || d3.max(sortedGross) || 1;
        const p98NetBal     = d3.quantile(sortedNetBal, 0.98) || d3.max(sortedNetBal) || 1;
        const p98NetFlows   = d3.quantile(sortedNetFlows, 0.98) || d3.max(sortedNetFlows) || 1;

        const radiusScale = d3.scaleSqrt()
            .domain([0, p98Gross])
            .range(isFocused ? [3, 30] : [1.5, 20])
            .clamp(true);

        const edgeWidthScale = d3.scaleSqrt()
            .domain([0, p98NetFlows])
            .range(isFocused ? [1.5, 18.0] : [0.5, 12.0])
            .clamp(true);

        const opacityScale = d3.scaleLinear()
            .domain([0, p98NetFlows])
            .range(isFocused ? [0.3, 0.95] : [0.15, 0.85])
            .clamp(true);

        const colorScale = (val) => {
            const transformed    = Math.sign(val) * Math.sqrt(Math.abs(val));
            const maxTransformed = Math.sqrt(p98NetBal);
            return d3.scaleLinear()
                .domain([-maxTransformed, -maxTransformed * 0.15, 0, maxTransformed * 0.15, maxTransformed])
                .range(["#e11d48", "#fb7185", "#ffffff", "#38bdf8", "#0284c7"])
                .interpolate(d3.interpolateHcl)
                .clamp(true)(transformed);
        };

        let flowLayer = this.g.select(".flow-layer");
        if (flowLayer.empty()) flowLayer = this.g.append("g").attr("class", "flow-layer");

        let nodeLayer = this.g.select(".node-layer");
        if (nodeLayer.empty()) nodeLayer = this.g.append("g").attr("class", "node-layer");

        let labelLayer = this.g.select(".label-layer");
        if (labelLayer.empty()) labelLayer = this.g.append("g").attr("class", "label-layer");

        // --- 1. Arcs (edges) ---
        const visibleFlows = netFlows.filter(d => {
            const s = STATE.countryCoords[d.exporter];
            const t = STATE.countryCoords[d.importer];
            if (!s || !t) return false;
            return true;
        });

        const arcs = flowLayer.selectAll(".trade-arc")
            .data(visibleFlows, d => `${d.exporter}|${d.importer}`);

        arcs.exit()
            .transition().duration(500)
            .style("opacity", 0)
            .remove();

        const arcsEnter = arcs.enter()
            .append("path")
            .attr("class", "trade-arc")
            .style("fill", "none")
            .style("mix-blend-mode", "multiply")
            .style("opacity", 0)
            .attr("stroke", d => CONFIG.flowColors[d.flowCategory])
            .on("click", (event, d) => { event.stopPropagation(); App.openArcModal(d.exporter, d.importer); });

        arcsEnter.merge(arcs)
            .attr("data-original-width", d => edgeWidthScale(d.netValue))
            .transition().duration(750).ease(d3.easeCubicOut)
            .attr("d", d => {
                const s = STATE.countryCoords[d.exporter];
                const t = STATE.countryCoords[d.importer];
                if (!s || !t) return null;

                const p1 = this.projection(s);
                const p2 = this.projection(t);
                if (!p1 || !p2) return null;

                const dx = p2[0] - p1[0];
                const dy = p2[1] - p1[1];
                const dr = Math.sqrt(dx * dx + dy * dy) * 1.3;
                const sweep = 1;

                return `M${p1[0]},${p1[1]}A${dr},${dr} 0 0,${sweep} ${p2[0]},${p2[1]}`;
            })
            .attr("stroke", d => CONFIG.flowColors[d.flowCategory])
            .attr("stroke-width", d => edgeWidthScale(d.netValue) / currentK)
            .style("opacity", d => opacityScale(d.netValue));

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
            .attr("stroke", "#CBD5E0")
            .style("opacity", 0)
            .on("mouseover", (event, d) => App.showTooltip(event, d))
            .on("mouseout",  () => App.hideTooltip())
            .on("click",     (event, d) => { event.stopPropagation(); App.openInsightPanel(d); });

        nodesEnter.merge(nodes)
            .attr("data-original-radius", d => radiusScale(nodeStats[d].grossVolume))
            .transition().duration(750).ease(d3.easeElasticOut)
            .attr("cx", d => this.getProjectedPoint(d)[0])
            .attr("cy", d => this.getProjectedPoint(d)[1])
            .attr("r", d => radiusScale(nodeStats[d].grossVolume) / currentK)
            .attr("fill", d => colorScale(nodeStats[d].netBalance))
            .attr("stroke-width", 1.5 / currentK)
            .style("opacity", 1);

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
            .style("pointer-events", "none")
            .style("opacity", 0);

        labelsEnter.merge(labels)
            .text(d => STATE.countryNames[d] || d)
            .attr("fill", d => nodeStats[d].netBalance >= 0 ? "#e2e8f0" : "#f59e0b")
            .transition().duration(750)
            .attr("x", d => this.getProjectedPoint(d)[0] + (radiusScale(nodeStats[d].grossVolume) / currentK) + 4)
            .attr("y", d => this.getProjectedPoint(d)[1] + 4)
            .attr("font-size", (10 / Math.sqrt(currentK)) + "px")
            .style("opacity", 1);

        if (this.renderLegend) this.renderLegend();
    },

    getProjectedPoint(iso) {
        const coords = STATE.countryCoords[iso];
        if (!coords) return [-999, -999];
        return this.projection(coords) || [-999, -999];
    },

    isVisible(iso) {
        return !!STATE.countryCoords[iso];
    },

    renderLegend() {
        const container = document.getElementById('legend-content');
        if (!container) return;

        const titleEl = document.getElementById('legend-title');
        if (titleEl) titleEl.innerText = 'Export Value ($)';

        const netFlows  = STATE.filteredData || [];
        const nodeStats = STATE.nodeStats || {};
        const fmt       = d3.format(",.0f");
        const fmtShort  = (v) => { const a = Math.abs(v); const s = v < 0 ? '-' : ''; if (a >= 1e9) return s + d3.format('.2f')(a / 1e9) + 'B'; if (a >= 1e6) return s + d3.format('.2f')(a / 1e6) + 'M'; if (a >= 1e3) return s + d3.format('.2f')(a / 1e3) + 'K'; return s + d3.format(',.0f')(a); };

        // --- 1. Flow Categories ---
        const categories = [
            { key: 'north-south', label: 'North → South', abbr: 'N→S' },
            { key: 'south-north', label: 'South → North', abbr: 'S→N' },
            { key: 'south-south', label: 'South → South', abbr: 'S→S' },
            { key: 'north-north', label: 'North → North', abbr: 'N→N' },
        ];

        const catStats = {};
        categories.forEach(c => { catStats[c.key] = { count: 0, total: 0 }; });
        netFlows.forEach(d => {
            if (catStats[d.flowCategory]) {
                catStats[d.flowCategory].count++;
                catStats[d.flowCategory].total += d.netValue;
            }
        });

        const catHtml = categories.map(c => {
            const active = STATE.flowFilters.has(c.key);
            const stat   = catStats[c.key];
            const opacity = active ? '1' : '0.25';
            const valueStr = stat.count > 0 ? `$${fmtShort(stat.total)}` : '—';
            const countStr = stat.count > 0 ? `${stat.count}` : '0';
            return `
                <div class="flex items-center gap-2" style="opacity:${opacity}">
                    <span class="w-3 h-1 rounded-full flex-shrink-0" style="background:${CONFIG.flowColors[c.key]}"></span>
                    <span class="flex-1 text-[10px] text-[#374151]">${c.label}</span>
                    <span class="text-[9px] text-[#718096] font-mono">${countStr}</span>
                    <span class="text-[9px] text-[#718096] font-mono w-12 text-right">${valueStr}</span>
                </div>`;
        }).join('');

        const widthHtml = `
            <div class="text-[9px] text-[#718096] italic mt-1">Arc width = net trade value</div>`;

        const nodeHtml = `
            <div class="mt-3 pt-2 border-t border-[#E2E8F0]">
                <div class="text-[10px] text-[#718096] font-bold uppercase mb-1.5 tracking-wider">Nodes</div>
                <div class="flex items-center justify-center gap-0.5 my-2" style="height:28px">
                    <div style="width:22px;height:22px;border-radius:50%;background:#e11d48" title="Strong net importer"></div>
                    <div style="width:16px;height:16px;border-radius:50%;background:#fb7185" title="Net importer"></div>
                    <div style="width:10px;height:10px;border-radius:50%;background:#f9a8d4" title="Slight net importer"></div>
                    <div style="width:5px;height:5px;border-radius:50%;background:#9CA3AF;border:1px solid #CBD5E0" title="Balanced"></div>
                    <div style="width:10px;height:10px;border-radius:50%;background:#7dd3fc" title="Slight net exporter"></div>
                    <div style="width:16px;height:16px;border-radius:50%;background:#38bdf8" title="Net exporter"></div>
                    <div style="width:22px;height:22px;border-radius:50%;background:#0284c7" title="Strong net exporter"></div>
                </div>
                <div class="flex justify-between text-[9px] text-[#718096] font-mono">
                    <span>← Net importer</span>
                    <span>Net exporter →</span>
                </div>
                <div class="text-[9px] text-[#718096] italic mt-1">Color = net balance · Size = gross volume</div>
            </div>`;

        // --- 4. Visibility Threshold ---
        const isManualThreshold = STATE.thresholdMode !== 'auto';
        let currentThreshold, autoZoomLevel;

        if (isManualThreshold) {
            currentThreshold = STATE.thresholdMode;
            autoZoomLevel = null;
        } else {
            const totalSelected    = STATE.selectedExporters.size + STATE.selectedImporters.size;
            const isCountryFocused = totalSelected > 0 && totalSelected <= 5;
            const isGroupFocused   = totalSelected > 5;
            const isRegionFocused  = STATE.region && STATE.region !== 'Global';
            if (isCountryFocused) {
                currentThreshold = 10000;  autoZoomLevel = 'Country';
            } else if (isGroupFocused || isRegionFocused) {
                currentThreshold = 100000; autoZoomLevel = 'Group';
            } else {
                currentThreshold = 500000; autoZoomLevel = 'Global';
            }
        }

        const modeBadge = isManualThreshold
            ? '<span class="text-[8px] bg-amber-100 text-amber-700 border border-amber-200 px-1 rounded font-bold">MANUAL</span>'
            : '<span class="text-[8px] bg-[#E0F2FE] text-[#0284C7] border border-[#BAE6FD] px-1 rounded font-bold">AUTO</span>';

        const autoTiersHtml = isManualThreshold ? '' : `
                <div class="space-y-0.5 mt-1.5">
                    <div class="flex items-center gap-1.5 text-[9px] ${autoZoomLevel === 'Global'  ? 'text-[#004990] font-bold' : 'text-[#718096]'}">
                        <span class="w-1.5 h-1.5 rounded-full flex-shrink-0 ${autoZoomLevel === 'Global'  ? 'bg-[#004990]' : 'bg-[#CBD5E0]'}"></span>
                        <span class="flex-1">Global</span><span class="font-mono">$500k</span>
                    </div>
                    <div class="flex items-center gap-1.5 text-[9px] ${autoZoomLevel === 'Group'   ? 'text-[#004990] font-bold' : 'text-[#718096]'}">
                        <span class="w-1.5 h-1.5 rounded-full flex-shrink-0 ${autoZoomLevel === 'Group'   ? 'bg-[#004990]' : 'bg-[#CBD5E0]'}"></span>
                        <span class="flex-1">Region / Group (6+)</span><span class="font-mono">$100k</span>
                    </div>
                    <div class="flex items-center gap-1.5 text-[9px] ${autoZoomLevel === 'Country' ? 'text-[#004990] font-bold' : 'text-[#718096]'}">
                        <span class="w-1.5 h-1.5 rounded-full flex-shrink-0 ${autoZoomLevel === 'Country' ? 'bg-[#004990]' : 'bg-[#CBD5E0]'}"></span>
                        <span class="flex-1">Country (1–5)</span><span class="font-mono">$10k</span>
                    </div>
                </div>`;

        const thresholdHtml = `
            <div class="mt-2 pt-2 border-t border-[#E2E8F0]">
                <div class="flex items-center justify-between mb-1.5">
                    <div class="text-[10px] text-[#718096] font-bold uppercase tracking-wider">Threshold</div>
                    ${modeBadge}
                </div>
                <div class="flex items-center justify-between text-[10px]">
                    <span class="text-[#374151]">Min. flow</span>
                    <span class="text-[#1a2332] font-bold font-mono">$${fmtShort(currentThreshold)}</span>
                </div>
                ${autoTiersHtml}
            </div>`;

        // --- 5. Active filter context ---
        const countryCount = Object.keys(nodeStats).length;
        const flowCount    = netFlows.length;
        const regionLabel  = STATE.region && STATE.region !== 'Global' ? STATE.region : 'Global';
        const focusLabel   = STATE.selectedExporters.size > 0 || STATE.selectedImporters.size > 0
            ? `${STATE.selectedExporters.size} exp / ${STATE.selectedImporters.size} imp`
            : 'All';

        const contextHtml = `
            <div class="mt-2 pt-2 border-t border-[#E2E8F0]">
                <div class="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[9px]">
                    <span class="text-[#718096]">Region</span><span class="text-[#374151] font-mono text-right">${regionLabel}</span>
                    <span class="text-[#718096]">Selection</span><span class="text-[#374151] font-mono text-right">${focusLabel}</span>
                    <span class="text-[#718096]">Countries</span><span class="text-[#374151] font-mono text-right">${countryCount}</span>
                    <span class="text-[#718096]">Trade flows</span><span class="text-[#374151] font-mono text-right">${fmt(flowCount)}</span>
                </div>
            </div>`;

        // --- Distribution Histogram ---
        const histHtml = (() => {
            if (netFlows.length === 0) return '';

            const LOG_MIN = 3, LOG_MAX = 10, BINS = 14;
            const counts = new Array(BINS).fill(0);
            const catPrimary = new Array(BINS).fill(null);
            const catCounts  = Array.from({ length: BINS }, () => ({}));

            netFlows.forEach(d => {
                const v = d.netValue;
                if (v <= 0) return;
                const log = Math.log10(v);
                let b = Math.floor((log - LOG_MIN) / (LOG_MAX - LOG_MIN) * BINS);
                b = Math.max(0, Math.min(BINS - 1, b));
                counts[b]++;
                catCounts[b][d.flowCategory] = (catCounts[b][d.flowCategory] || 0) + 1;
            });
            counts.forEach((_, b) => {
                const best = Object.entries(catCounts[b]).sort((a, b2) => b2[1] - a[1])[0];
                catPrimary[b] = best ? best[0] : 'north-north';
            });

            const maxCount = Math.max(...counts, 1);
            const W = 220, H = 36, gap = 1;
            const bw = (W - gap * (BINS - 1)) / BINS;

            const threshLog = Math.log10(Math.max(currentThreshold, 1));
            const threshX   = Math.max(0, Math.min(W, (threshLog - LOG_MIN) / (LOG_MAX - LOG_MIN) * W));

            const bars = counts.map((c, i) => {
                const h  = Math.max(1, (c / maxCount) * H);
                const x  = i * (bw + gap);
                const col = c > 0 ? (CONFIG.flowColors[catPrimary[i]] || '#CBD5E0') : '#E5E7EB';
                return `<rect x="${x.toFixed(1)}" y="${(H - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="1" fill="${col}" opacity="0.75"/>`;
            }).join('');

            const xLabels = [4, 6, 8, 10].map(exp => {
                const x = (exp - LOG_MIN) / (LOG_MAX - LOG_MIN) * W;
                return `<text x="${x.toFixed(1)}" y="${H + 11}" text-anchor="middle" font-size="6.5" fill="#9CA3AF" font-family="Inter,monospace">${['$10k','$100k','$1M','$10M'][exp - 4] || ''}</text>`;
            }).join('');

            return `
            <div class="mt-3 pt-2 border-t border-[#E2E8F0]">
                <div class="flex items-center justify-between mb-1">
                    <div class="text-[10px] text-[#718096] font-bold uppercase tracking-wider">Flow Distribution</div>
                    <div class="text-[9px] text-[#9CA3AF] font-mono">${netFlows.length} flows</div>
                </div>
                <svg width="${W}" height="${H + 14}" class="w-full overflow-visible">
                    ${bars}
                    <line x1="${threshX.toFixed(1)}" y1="0" x2="${threshX.toFixed(1)}" y2="${H}" stroke="#D97706" stroke-width="1.5" stroke-dasharray="2,2" opacity="0.9"/>
                    <text x="${(threshX + 2).toFixed(1)}" y="8" font-size="6.5" fill="#D97706" font-family="Inter,monospace">min</text>
                    ${xLabels}
                </svg>
                <div class="text-[8.5px] text-[#9CA3AF] italic mt-0.5">Bar color = dominant flow type · dashed = threshold</div>
            </div>`;
        })();

        container.innerHTML = `
            <div class="space-y-1.5 mt-1">${catHtml}</div>
            ${widthHtml}
            ${nodeHtml}
            ${histHtml}
            ${thresholdHtml}
            ${contextHtml}
        `;

        // Total stats
        const shownTotal     = d3.sum(netFlows, d => d.netValue);
        const bilateralTotal = STATE.totalBilateral || 0;
        const coverage       = bilateralTotal > 0 ? (shownTotal / bilateralTotal * 100) : 0;

        const statEl       = document.getElementById('stat-value');
        const bilatEl      = document.getElementById('stat-bilateral');
        const coverageEl   = document.getElementById('stat-coverage');
        if (statEl)     statEl.innerText     = '$' + fmtShort(shownTotal);
        if (bilatEl)    bilatEl.innerText    = '$' + fmtShort(bilateralTotal);
        if (coverageEl) coverageEl.innerText = `${coverage.toFixed(1)}% of bilateral trade shown`;
    }
};
window.TradeMap = TradeMap;
