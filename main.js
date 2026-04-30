import './style.css';
import * as d3 from 'd3';
import { CONFIG, STATE, METRIC_FORMAT } from './config.js';
import { RegionConfig } from './regions.js';
import { CountrySelector } from './countrySelector.js';
import { DataLoader } from './dataLoader.js';
import { TradeMap } from './map.js';

const App = {
    exporterSelector: null,
    importerSelector: null,
    _lastRenderedRegion: null,
    _globalRankCache: {},
    _resizeTimer: null,
    _prevSelectionCount: 0,

    async init() {
        STATE.selectedExporters = new Set();
        STATE.selectedImporters = new Set();
        if (!STATE.flowFilters) STATE.flowFilters = new Set(['north-south', 'south-north', 'south-south', 'north-north']);

        STATE.region = "Global";

        const success = await DataLoader.loadAll();
        if (!success) return;

        console.log('Initializing country selectors...');
        this.exporterSelector = new CountrySelector('exp', 'exp-label', 'exporter');
        this.importerSelector = new CountrySelector('imp', 'imp-label', 'importer');

        try {
            await this.exporterSelector.init();
            await this.importerSelector.init();
            console.log('Country selectors initialized successfully');
        } catch (error) {
            console.error('Failed to initialize country selectors:', error);
            alert('国選択機能の初期化に失敗しました。詳細はコンソールを確認してください。');
            return;
        }

        TradeMap.init();
        this.setupEventListeners();

        this.exporterSelector.updateSelection();
        this.updateDashboard();
        document.getElementById('loader').classList.add('hidden');
    },

    setupEventListeners() {
        // Region Buttons
        document.querySelectorAll('.region-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const region = e.target.dataset.region;
                STATE.region = region;

                this.updateUIClasses('.region-btn', e.target);

                this.exporterSelector.setCountries([]);
                this.importerSelector.setCountries([]);

                this.updateDashboard();
            });
        });

        // Year
        const yearSelect = document.getElementById('year-select');
        if (yearSelect) {
            yearSelect.addEventListener('change', async (e) => {
                const year = +e.target.value;
                const loader = document.getElementById('loader');
                loader.classList.remove('hidden');
                try {
                    await DataLoader.loadYear(year);
                    STATE.year = year;
                    this.exporterSelector.setCountries([]);
                    this.importerSelector.setCountries([]);
                    this.updateDashboard();
                } catch (err) {
                    console.error('Failed to load year data:', err);
                } finally {
                    loader.classList.add('hidden');
                }
            });
        }

        // Threshold toggle
        document.querySelectorAll('.threshold-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const val = e.target.dataset.threshold;
                STATE.thresholdMode = val === 'auto' ? 'auto' : +val;
                this.updateUIClasses('.threshold-btn', e.target);
                this.updateDashboard(false);
            });
        });

        // Flow category checkboxes
        document.querySelectorAll('.flow-checkbox').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const val = e.target.value;
                if (e.target.checked) STATE.flowFilters.add(val);
                else STATE.flowFilters.delete(val);
                this.updateDashboard(false);
            });
        });

        // Dropdown Logic (Exporter & Importer)
        this.setupHierarchicalDropdown('exp', this.exporterSelector);
        this.setupHierarchicalDropdown('imp', this.importerSelector);

        // Insight panel close button
        const panelCloseBtn = document.getElementById('panel-close-btn');
        if (panelCloseBtn) panelCloseBtn.addEventListener('click', () => this.closeInsightPanel());

        // Mobile legend toggle
        const mobileLegendBtn = document.getElementById('mobile-legend-btn');
        if (mobileLegendBtn) mobileLegendBtn.addEventListener('click', () => this.toggleMobileLegend());
        const mobileBackdrop = document.getElementById('mobile-legend-backdrop');
        if (mobileBackdrop) mobileBackdrop.addEventListener('click', () => this.toggleMobileLegend());
        const mobileLegendClose = document.getElementById('mobile-legend-close');
        if (mobileLegendClose) mobileLegendClose.addEventListener('click', () => this.toggleMobileLegend());

        // Arc detail modal
        document.getElementById('arc-modal-close').addEventListener('click', () => this.closeArcModal());
        document.getElementById('arc-modal-backdrop').addEventListener('click', () => this.closeArcModal());

        // Compare modal
        document.getElementById('compare-modal-close').addEventListener('click', () => this.closeCompareModal());
        document.getElementById('compare-modal-backdrop').addEventListener('click', () => this.closeCompareModal());

        // モバイルブラウザのUIバーによる高さのズレを修正するためのCSS変数をセット
        const setMobileHeight = () => {
            const vh = window.innerHeight * 0.01;
            document.documentElement.style.setProperty('--vh', `${vh}px`);
        };
        setMobileHeight();

        window.addEventListener('resize', () => {
            setMobileHeight();
            clearTimeout(this._resizeTimer);
            this._resizeTimer = setTimeout(() => {
                TradeMap.init();
                TradeMap.renderFlows();
            }, 200);
        });

        // ── Mobile Filter Panel ───────────────────────────────
        document.getElementById('mobile-filter-btn')?.addEventListener('click', () => this.toggleMobileFilter());
        document.getElementById('mobile-filter-close')?.addEventListener('click', () => this.toggleMobileFilter());
        document.getElementById('mobile-filter-backdrop')?.addEventListener('click', () => this.toggleMobileFilter());

        // Mobile fit to screen button
        document.getElementById('fit-screen-btn')?.addEventListener('click', () => {
            TradeMap.zoomToRegion("Global");
        });

        // Mobile country backdrop closes any open country menu
        document.getElementById('mobile-country-backdrop')?.addEventListener('click', () => {
            ['exp', 'imp'].forEach(p => {
                const menu = document.getElementById(`${p}-menu`);
                const btn = document.getElementById(`${p}-btn`);
                menu.classList.add('hidden');
                menu.classList.remove('mobile-menu-fixed');
                if (menu.parentElement !== btn.parentElement) {
                    btn.parentElement.appendChild(menu);
                }
                btn.parentElement.style.zIndex = '50'; // リセット
            });
            document.getElementById('mobile-country-backdrop').classList.add('hidden');
        });

        // Mobile year select syncs to desktop handler
        document.getElementById('m-year-select')?.addEventListener('change', async (e) => {
            const desktopSelect = document.getElementById('year-select');
            desktopSelect.value = e.target.value;
            desktopSelect.dispatchEvent(new Event('change'));
        });

        // Sync initial active state to mobile panel buttons
        this.syncMobileFilterState();
    },

    setupHierarchicalDropdown(prefix, selector) {
        const btn  = document.getElementById(`${prefix}-btn`);
        const mBtn = document.getElementById(`m-${prefix}-btn`);
        const menu = document.getElementById(`${prefix}-menu`);
        const search   = document.getElementById(`${prefix}-search`);
        const clearAll = document.getElementById(`${prefix}-clear-all`);

        const originalParent = btn.parentElement;

        const closeOtherMenu = () => {
            const otherPrefix = prefix === 'exp' ? 'imp' : 'exp';
            const otherMenu = document.getElementById(`${otherPrefix}-menu`);
            const otherBtn = document.getElementById(`${otherPrefix}-btn`);
            otherMenu.classList.add('hidden');
            otherMenu.classList.remove('mobile-menu-fixed');
            if (otherMenu.parentElement !== otherBtn.parentElement) {
                otherBtn.parentElement.appendChild(otherMenu);
            }
            otherBtn.parentElement.style.zIndex = '50'; // 閉じた方はリセット
        };

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeOtherMenu();
            
            // PC版（横長）で開くときは、必ずモバイル用の固定設定を外す
            menu.classList.remove('mobile-menu-fixed');
            if (menu.parentElement !== originalParent) {
                originalParent.appendChild(menu);
            }
            menu.classList.toggle('hidden');
            
            // 開いたメニューが他のボタン（下の要素）に隠れないように z-index を高くする
            originalParent.style.zIndex = menu.classList.contains('hidden') ? '50' : '60';
        });

        if (mBtn) {
            mBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                closeOtherMenu();
                
                // モバイル表示用に body 直下に移動 (親要素の hidden の影響を避ける)
                document.body.appendChild(menu);
                
                menu.classList.remove('hidden');
                menu.classList.add('mobile-menu-fixed');
                document.getElementById('mobile-country-backdrop')?.classList.remove('hidden');
            });
        }

        document.addEventListener('click', (e) => {
            const isOutside = !menu.contains(e.target) && !btn.contains(e.target) && (!mBtn || !mBtn.contains(e.target));
            if (isOutside) {
                menu.classList.add('hidden');
                menu.classList.remove('mobile-menu-fixed');
                if (menu.parentElement !== originalParent) {
                    originalParent.appendChild(menu);
                }
                originalParent.style.zIndex = '50'; // 画面外クリックで閉じた時にリセット
            }
        });

        search.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            menu.querySelectorAll('.country-option').forEach(item => {
                const text = item.innerText.toLowerCase();
                item.style.display = text.includes(term) ? 'flex' : 'none';
            });
            menu.querySelectorAll('.group-option').forEach(item => {
                item.style.display = term ? 'none' : 'flex';
            });
        });

        clearAll.addEventListener('click', () => {
            selector.clearAll();
        });
    },

    updateUIClasses(selector, activeEl) {
        document.querySelectorAll(selector).forEach(b => {
            b.classList.remove('bg-[#004990]', 'text-white');
            b.classList.add('text-[#6E6259]');
            if (b.closest('#mobile-filter-panel')) {
                b.style.backgroundColor = '';
                b.style.color = '';
            }
        });
        activeEl.classList.remove('text-[#6E6259]');
        activeEl.classList.add('bg-[#004990]', 'text-white');
        if (activeEl.closest('#mobile-filter-panel')) {
            activeEl.style.backgroundColor = '#004990';
            activeEl.style.color = 'white';
        }
    },

    updateKPIBar() {
        const flows = STATE.filteredData || [];
        const stats = STATE.nodeStats || {};
        const mf = METRIC_FORMAT[STATE.metric] || METRIC_FORMAT.value;

        const total = d3.sum(flows, d => d.netValue);
        const totalEl = document.getElementById('kpi-total');
        if (totalEl) totalEl.textContent = mf.fmt(total);

        const flowsEl = document.getElementById('kpi-flows');
        if (flowsEl) flowsEl.textContent = d3.format(',')(flows.length);

        const countriesEl = document.getElementById('kpi-countries');
        if (countriesEl) countriesEl.textContent = Object.keys(stats).length;

        const topExpEl = document.getElementById('kpi-top-exp');
        const topImpEl = document.getElementById('kpi-top-imp');
        if (topExpEl || topImpEl) {
            const sortedByBalance = Object.entries(stats).sort((a, b) => b[1].netBalance - a[1].netBalance);
            if (topExpEl) {
                if (sortedByBalance.length > 0 && sortedByBalance[0][1].netBalance > 0) {
                    const name = STATE.countryNames[sortedByBalance[0][0]] || sortedByBalance[0][0];
                    topExpEl.textContent = name.length > 16 ? name.slice(0, 15) + '…' : name;
                } else {
                    topExpEl.textContent = '—';
                }
            }
            if (topImpEl) {
                const last = sortedByBalance[sortedByBalance.length - 1];
                if (last && last[1].netBalance < 0) {
                    const name = STATE.countryNames[last[0]] || last[0];
                    topImpEl.textContent = name.length > 16 ? name.slice(0, 15) + '…' : name;
                } else {
                    topImpEl.textContent = '—';
                }
            }
        }

        let nsTotal = 0, ssTotal = 0;
        flows.forEach(d => {
            if (d.flowCategory === 'north-south') nsTotal += d.netValue;
            else if (d.flowCategory === 'south-south') ssTotal += d.netValue;
        });
        const nsPctEl = document.getElementById('kpi-ns-pct');
        if (nsPctEl) nsPctEl.textContent = total > 0 ? Math.round(nsTotal / total * 100) + '%' : '—';

        const ssPctEl = document.getElementById('kpi-ss-pct');
        if (ssPctEl) ssPctEl.textContent = total > 0 ? Math.round(ssTotal / total * 100) + '%' : '—';
    },

    // ── P1: Insight Side Panel ──────────────────────────────────────

    openInsightPanel(iso) {
        if (document.getElementById('mobile-filter-panel')?.classList.contains('open')) {
            this.toggleMobileFilter();
        }
        const name = STATE.countryNames[iso] || iso;
        const stats = STATE.nodeStats[iso];
        const mf = METRIC_FORMAT[STATE.metric] || METRIC_FORMAT.value;
        const region = RegionConfig.getRegion(iso) || 'Unknown';
        const devStatus = CONFIG.development[iso] === 'north' ? 'Developed' : 'Developing';

        document.getElementById('panel-country-name').textContent = name;
        document.getElementById('panel-country-meta').textContent = `${region} · ${devStatus} · ${STATE.year}`;
        document.getElementById('panel-body').innerHTML = this._buildPanelContent(iso, stats, mf);

        document.getElementById('insight-panel').classList.add('open');
        document.body.classList.add('insight-open');

        // モバイルでヘッダーが消えて地図が広がるため、D3マップのサイズ再計算をトリガー
        if (window.innerWidth <= 767) {
            setTimeout(() => window.dispatchEvent(new Event('resize')), 10);
        }

        this._currentPanelIso = iso;
        this.hideTooltip();
        if (TradeMap && TradeMap.setFocus) {
            // Ensure routes.json is loaded before switching to sea-route rendering
            const doFocus = () => TradeMap.setFocus(iso);
            STATE._routesPromise ? STATE._routesPromise.then(doFocus) : doFocus();
        }
    },

    closeInsightPanel() {
        document.getElementById('insight-panel').classList.remove('open');
        document.body.classList.remove('insight-open');

        // モバイルでヘッダーが再表示されて地図が縮むため、D3マップのサイズ再計算をトリガー
        if (window.innerWidth <= 767) {
            setTimeout(() => window.dispatchEvent(new Event('resize')), 10);
        }

        this._currentPanelIso = null;
        if (TradeMap && TradeMap.clearFocus) TradeMap.clearFocus();
    },

    // ── P2-A: Arc Detail Modal ──────────────────────────────────────

    async openArcModal(expIso, impIso) {
        if (!STATE.bilateralHistory) {
            await STATE._bilateralPromise;
        }
        const expName = STATE.countryNames[expIso] || expIso;
        const impName = STATE.countryNames[impIso] || impIso;
        const mf = METRIC_FORMAT[STATE.metric] || METRIC_FORMAT.value;

        document.getElementById('arc-modal-title').textContent = `${expName}  →  ${impName}`;
        document.getElementById('arc-modal-meta').textContent = `Net exporter: ${expName} · ${STATE.year}`;
        document.getElementById('arc-modal-body').innerHTML = this._buildArcDetailContent(expIso, impIso, mf);

        const modal = document.getElementById('arc-modal');
        modal.classList.remove('hidden');
        this.hideTooltip();
    },

    closeArcModal() {
        document.getElementById('arc-modal').classList.add('hidden');
    },

    _buildArcDetailContent(expIso, impIso, mf) {
        const expName = STATE.countryNames[expIso] || expIso;
        const impName = STATE.countryNames[impIso] || impIso;

        const yearData = {};
        for (let y = 2015; y <= 2024; y++) yearData[y] = { aToB: 0, bToA: 0 };

        // Resolve bilateral history from pre-computed JSON
        const [a, b] = [expIso, impIso].sort();
        const pairKey = `${a}|${b}`;
        const expIsA = expIso === a;
        const hist = STATE.bilateralHistory ? STATE.bilateralHistory[pairKey] : null;
        if (hist) {
            Object.entries(hist).forEach(([yStr, entry]) => {
                const y = +yStr;
                if (yearData[y]) {
                    yearData[y].aToB = expIsA ? entry.aToB : entry.bToA;
                    yearData[y].bToA = expIsA ? entry.bToA : entry.aToB;
                }
            });
        }

        const years = Object.keys(yearData).map(Number).sort();
        const nets  = years.map(y => yearData[y].aToB - yearData[y].bToA);
        const atoBs = years.map(y => yearData[y].aToB);
        const bToAs = years.map(y => yearData[y].bToA);
        const maxAbs = Math.max(...atoBs, ...bToAs, 1);

        const cy = STATE.year;
        const curAtoB = yearData[cy] ? yearData[cy].aToB : 0;
        const curBtoA = yearData[cy] ? yearData[cy].bToA : 0;
        const curNet  = curAtoB - curBtoA;
        const netCol  = curNet >= 0 ? '#009EDB' : '#ED1847';
        const netSign = curNet >= 0 ? '+' : '';
        const fc = STATE.filteredData.find(d =>
            (d.exporter === expIso && d.importer === impIso) ||
            (d.exporter === impIso && d.importer === expIso)
        );
        const flowCat = fc ? fc.flowCategory : null;
        const catLabels = { 'north-south': 'North→South', 'south-north': 'South→North', 'south-south': 'South→South', 'north-north': 'North→North' };
        const catBadge = flowCat
            ? `<span class="text-[9px] font-bold px-2 py-0.5 rounded-full border" style="color:${CONFIG.flowColors[flowCat]};border-color:${CONFIG.flowColors[flowCat]}40">${catLabels[flowCat]}</span>`
            : '';

        let html = `
        <div class="grid grid-cols-3 gap-2 mb-1">
            <div class="bg-[#E3EDF6] border border-[#C5DFEF] rounded-lg px-3 py-2 text-center">
                <div class="text-[9px] text-[#0077B8] uppercase font-bold mb-0.5">${expName} →</div>
                <div class="text-sm font-bold text-[#231F20] font-mono">${mf.fmt(curAtoB)}</div>
            </div>
            <div class="bg-[#F5F7FA] border border-[#E2E8F0] rounded-lg px-3 py-2 text-center">
                <div class="text-[9px] text-[#6E6259] uppercase font-bold mb-0.5">Net (${cy})</div>
                <div class="text-sm font-bold font-mono" style="color:${netCol}">${netSign}${mf.fmt(Math.abs(curNet))}</div>
            </div>
            <div class="bg-[#F7DFDF] border border-[#F9C0C5] rounded-lg px-3 py-2 text-center">
                <div class="text-[9px] text-[#ED1847] uppercase font-bold mb-0.5">← ${impName}</div>
                <div class="text-sm font-bold text-[#231F20] font-mono">${mf.fmt(curBtoA)}</div>
            </div>
        </div>
        <div class="flex justify-center mb-3">${catBadge}</div>`;

        const W = 440, H = 36, barH = 14, gap = 3;
        const bw = (W - gap * (years.length - 1)) / years.length;
        const bars = years.map((y, i) => {
            const aH = Math.max(0, (atoBs[i] / maxAbs) * barH);
            const bH = Math.max(0, (bToAs[i] / maxAbs) * barH);
            const x  = i * (bw + gap);
            const isCur = y === cy;
            const yr = String(y).slice(2);
            return `
                <rect x="${x}" y="${H/2 - aH}" width="${bw}" height="${aH}" rx="1" fill="#009EDB" opacity="${isCur ? 1 : 0.45}"/>
                <rect x="${x}" y="${H/2}" width="${bw}" height="${bH}" rx="1" fill="#ED1847" opacity="${isCur ? 1 : 0.45}"/>
                ${isCur ? `<rect x="${x - 0.5}" y="2" width="${bw + 1}" height="${H - 4}" rx="2" fill="none" stroke="#0077B8" stroke-width="1"/>` : ''}
                <text x="${x + bw/2}" y="${H + 11}" text-anchor="middle" font-size="7" fill="${isCur ? '#0077B8' : '#AEA29A'}" font-family="Inter,monospace">${yr}</text>`;
        }).join('');

        html += `
        <div>
            <div class="text-[9px] text-[#6E6259] font-bold uppercase tracking-wider mb-1.5">Bilateral Trade History</div>
            <div class="flex items-center gap-3 mb-1">
                <div class="flex items-center gap-1"><div class="w-3 h-2 rounded-sm bg-[#009EDB] opacity-80"></div><span class="text-[9px] text-[#6E6259]">${expName} exports</span></div>
                <div class="flex items-center gap-1"><div class="w-3 h-2 rounded-sm bg-[#ED1847] opacity-80"></div><span class="text-[9px] text-[#6E6259]">${impName} exports</span></div>
            </div>
            <svg width="${W}" height="${H + 14}" class="w-full overflow-visible">
                <line x1="0" y1="${H/2}" x2="${W}" y2="${H/2}" stroke="#AAA096" stroke-width="0.5"/>
                ${bars}
            </svg>
        </div>`;

        const tableRows = years.filter(y => atoBs[years.indexOf(y)] > 0 || bToAs[years.indexOf(y)] > 0).map(y => {
            const idx = years.indexOf(y);
            const net = nets[idx];
            const nCol = net >= 0 ? '#009EDB' : '#ED1847';
            const isCur = y === cy;
            return `<tr class="${isCur ? 'bg-[#E3EDF6]' : 'hover:bg-[#F3F8FD]'}">
                <td class="py-1 px-2 text-[10px] font-mono ${isCur ? 'text-[#004990] font-bold' : 'text-[#6E6259]'}">${y}</td>
                <td class="py-1 px-2 text-[10px] font-mono text-sky-600 text-right">${mf.fmt(atoBs[idx])}</td>
                <td class="py-1 px-2 text-[10px] font-mono text-red-500 text-right">${mf.fmt(bToAs[idx])}</td>
                <td class="py-1 px-2 text-[10px] font-mono text-right font-bold" style="color:${nCol}">${net >= 0 ? '+' : ''}${mf.fmt(Math.abs(net))}</td>
            </tr>`;
        }).join('');

        html += `
        <div>
            <div class="text-[9px] text-[#6E6259] font-bold uppercase tracking-wider mb-1.5">Year-by-Year Table</div>
            <table class="w-full border-collapse">
                <thead>
                    <tr class="border-b border-[#E2E8F0]">
                        <th class="py-1 px-2 text-[9px] text-[#6E6259] text-left font-bold">Year</th>
                        <th class="py-1 px-2 text-[9px] text-sky-600 text-right font-bold">${expName} →</th>
                        <th class="py-1 px-2 text-[9px] text-red-500 text-right font-bold">← ${impName}</th>
                        <th class="py-1 px-2 text-[9px] text-[#6E6259] text-right font-bold">Net</th>
                    </tr>
                </thead>
                <tbody>${tableRows}</tbody>
            </table>
        </div>`;

        return html;
    },

    // ── P2-B: Compare Modal ─────────────────────────────────────────

    openCompareModal(isoA, isoB) {
        const nameA = STATE.countryNames[isoA] || isoA;
        const nameB = STATE.countryNames[isoB] || isoB;
        const mf = METRIC_FORMAT[STATE.metric] || METRIC_FORMAT.value;

        document.getElementById('compare-modal-title').textContent = `${nameA}  vs  ${nameB}`;
        document.getElementById('compare-modal-body').innerHTML = this._buildCompareContent(isoA, isoB, mf);

        document.getElementById('compare-modal').classList.remove('hidden');
        this.hideTooltip();
    },

    closeCompareModal() {
        document.getElementById('compare-modal').classList.add('hidden');
        this._compareIso = null;
    },

    _buildCompareContent(isoA, isoB, mf) {
        const nameA = STATE.countryNames[isoA] || isoA;
        const nameB = STATE.countryNames[isoB] || isoB;
        const statsA = STATE.nodeStats[isoA];
        const statsB = STATE.nodeStats[isoB];

        const devA = CONFIG.development[isoA] === 'north' ? 'Developed' : 'Developing';
        const devB = CONFIG.development[isoB] === 'north' ? 'Developed' : 'Developing';
        const regA = RegionConfig.getRegion(isoA) || '—';
        const regB = RegionConfig.getRegion(isoB) || '—';

        const getYearlyTotals = (iso) => {
            const isoData = STATE.trendSummary[iso] || {};
            const t = {};
            for (let y = 2015; y <= 2024; y++) t[y] = isoData[String(y)] || 0;
            return t;
        };
        const totA = getYearlyTotals(isoA);
        const totB = getYearlyTotals(isoB);
        const years = Object.keys(totA).map(Number).sort();
        const maxV  = Math.max(...years.map(y => Math.max(totA[y], totB[y])), 1);

        const metricRows = [
            { label: 'Region', vA: regA, vB: regB, raw: false },
            { label: 'Status', vA: devA, vB: devB, raw: false },
            { label: 'Gross Volume', vA: statsA ? mf.fmt(statsA.grossVolume) : '—', vB: statsB ? mf.fmt(statsB.grossVolume) : '—', raw: false,
              winA: statsA && statsB ? statsA.grossVolume > statsB.grossVolume : null },
            { label: 'Net Balance', vA: statsA ? mf.fmt(Math.abs(statsA.netBalance)) : '—', vB: statsB ? mf.fmt(Math.abs(statsB.netBalance)) : '—', raw: false },
            { label: 'Role', vA: statsA ? (statsA.netBalance >= 0 ? 'Net Exporter' : 'Net Importer') : '—',
                           vB: statsB ? (statsB.netBalance >= 0 ? 'Net Exporter' : 'Net Importer') : '—', raw: false },
        ];

        const headerRows = metricRows.map(r => {
            const hlA = r.winA === true  ? 'color:#72BF44' : r.winA === false ? 'color:#ED1847' : '';
            const hlB = r.winA === false ? 'color:#72BF44' : r.winA === true  ? 'color:#ED1847' : '';
            return `<tr class="border-b border-[#F0F0F0]">
                <td class="py-1.5 px-3 text-[10px] font-mono text-right" style="${hlA}">${r.vA}</td>
                <td class="py-1.5 px-3 text-[9px] text-[#6E6259] text-center font-bold uppercase">${r.label}</td>
                <td class="py-1.5 px-3 text-[10px] font-mono" style="${hlB}">${r.vB}</td>
            </tr>`;
        }).join('');

        let html = `
        <div class="grid grid-cols-3 gap-0 mb-4 text-center">
            <div class="py-2 bg-[#E3EDF6] rounded-l-lg border border-[#C5DFEF] border-r-0">
                <div class="text-xs font-bold text-[#0077B8]">${nameA}</div>
            </div>
            <div class="py-2 bg-[#F5F7FA] border-y border-[#E2E8F0] flex items-center justify-center">
                <span class="text-[#AEA29A] font-bold text-sm">vs</span>
            </div>
            <div class="py-2 bg-[#FFF4BF] rounded-r-lg border border-[#FFD48E] border-l-0">
                <div class="text-xs font-bold text-[#D97706]">${nameB}</div>
            </div>
        </div>
        <table class="w-full mb-4">${headerRows}</table>`;

        const W = 580, H = 60, gap = 4;
        const bw = (W - gap * (years.length - 1)) / years.length;
        const points = (arr) => years.map((y, i) => {
            const x = i * (bw + gap) + bw / 2;
            const yp = H - (arr[y] / maxV) * H;
            return `${x},${yp}`;
        }).join(' ');

        const dotsA = years.map((y, i) => {
            const x = i * (bw + gap) + bw / 2;
            const yp = H - (totA[y] / maxV) * H;
            const isCur = y === STATE.year;
            return `<circle cx="${x}" cy="${yp}" r="${isCur ? 4 : 2}" fill="${isCur ? '#009EDB' : '#009EDB'}" opacity="${isCur ? 1 : 0.7}"/>`;
        }).join('');
        const dotsB = years.map((y, i) => {
            const x = i * (bw + gap) + bw / 2;
            const yp = H - (totB[y] / maxV) * H;
            const isCur = y === STATE.year;
            return `<circle cx="${x}" cy="${yp}" r="${isCur ? 4 : 2}" fill="${isCur ? '#FBAF17' : '#B06E2A'}" opacity="${isCur ? 1 : 0.7}"/>`;
        }).join('');
        const xLabels = years.filter((_, i) => i % 2 === 0).map(y => {
            const idx = years.indexOf(y);
            const x = idx * (bw + gap) + bw / 2;
            return `<text x="${x}" y="${H + 12}" text-anchor="middle" font-size="7" fill="#6E6259" font-family="Inter,monospace">${String(y).slice(2)}</text>`;
        }).join('');

        html += `
        <div class="mb-4">
            <div class="text-[9px] text-[#6E6259] font-bold uppercase tracking-wider mb-2">Trade Volume Trend</div>
            <div class="flex items-center gap-4 mb-1.5">
                <div class="flex items-center gap-1"><div class="w-6 h-[2px] bg-[#009EDB]"></div><span class="text-[9px] text-[#6E6259]">${nameA}</span></div>
                <div class="flex items-center gap-1"><div class="w-6 h-[2px] bg-[#FBAF17]"></div><span class="text-[9px] text-[#6E6259]">${nameB}</span></div>
            </div>
            <svg width="${W}" height="${H + 16}" class="w-full overflow-visible">
                <polyline points="${points(totA)}" fill="none" stroke="#009EDB" stroke-width="1.5" opacity="0.8"/>
                <polyline points="${points(totB)}" fill="none" stroke="#B06E2A" stroke-width="1.5" opacity="0.8"/>
                ${dotsA}${dotsB}${xLabels}
            </svg>
        </div>`;

        const tableRows = years.filter(y => totA[y] > 0 || totB[y] > 0).reverse().map(y => {
            const isCur = y === STATE.year;
            const winA = totA[y] > totB[y];
            return `<tr class="${isCur ? 'bg-[#E3EDF6]' : 'hover:bg-[#F3F8FD]'}">
                <td class="py-1 px-3 text-[10px] font-mono text-right" style="color:${winA ? '#72BF44' : '#AEA29A'}">${mf.fmt(totA[y])}</td>
                <td class="py-1 px-3 text-[9px] text-center font-mono ${isCur ? 'text-[#004990] font-bold' : 'text-[#6E6259]'}">${y}</td>
                <td class="py-1 px-3 text-[10px] font-mono" style="color:${!winA ? '#72BF44' : '#AEA29A'}">${mf.fmt(totB[y])}</td>
            </tr>`;
        }).join('');

        html += `
        <div>
            <div class="text-[9px] text-[#6E6259] font-bold uppercase tracking-wider mb-1.5">Year-by-Year Comparison</div>
            <table class="w-full border-collapse">
                <thead>
                    <tr class="border-b border-[#E2E8F0]">
                        <th class="py-1 px-3 text-[9px] text-sky-600 text-right font-bold">${nameA}</th>
                        <th class="py-1 px-3 text-[9px] text-[#6E6259] text-center font-bold">Year</th>
                        <th class="py-1 px-3 text-[9px] text-[#B06E2A] font-bold">${nameB}</th>
                    </tr>
                </thead>
                <tbody>${tableRows}</tbody>
            </table>
        </div>`;

        return html;
    },

    _buildPanelContent(iso, stats, mf) {
        const partnerExports = {}, partnerImports = {};
        STATE.filteredData.forEach(d => {
            if (d.exporter === iso) partnerExports[d.importer] = (partnerExports[d.importer] || 0) + d.netValue;
            else if (d.importer === iso) partnerImports[d.exporter] = (partnerImports[d.exporter] || 0) + d.netValue;
        });

        const yearlyTotals = {};
        const isoTrend = STATE.trendSummary[iso] || {};
        for (let y = 2015; y <= 2024; y++) yearlyTotals[y] = isoTrend[String(y)] || 0;

        let html = '';

        html += `<div class="bg-[#E3EDF6] border border-[#C5DFEF] rounded-lg p-3 space-y-1.5">
            <div class="text-[9px] text-[#004990] font-bold uppercase tracking-wider mb-1.5">Auto Insights</div>
            ${this._generateNarrative(iso, stats, partnerExports, partnerImports, yearlyTotals, mf)}
        </div>`;

        if (!stats) return html;

        const isExp = stats.netBalance >= 0;
        const balColor = isExp ? '#009EDB' : '#ED1847';
        const roleBg = isExp ? 'background:rgba(0,158,219,0.15);color:#009EDB' : 'background:rgba(237,24,71,0.15);color:#ED1847';
        html += `<div>
            <div class="text-[9px] text-[#6E6259] font-bold uppercase tracking-wider mb-2">Key Metrics (${STATE.year})</div>
            <div class="grid grid-cols-2 gap-2">
                <div class="bg-[#F5F7FA] border border-[#E2E8F0] rounded-lg px-3 py-2">
                    <div class="text-[9px] text-[#6E6259] uppercase">${mf.grossLabel.replace(':','')}</div>
                    <div class="text-sm font-bold text-[#231F20] font-mono">${mf.fmt(stats.grossVolume)}</div>
                </div>
                <div class="bg-[#F5F7FA] border border-[#E2E8F0] rounded-lg px-3 py-2">
                    <div class="text-[9px] text-[#6E6259] uppercase">${mf.netLabel.replace(':','')}</div>
                    <div class="text-sm font-bold font-mono" style="color:${balColor}">${isExp ? '+' : ''}${mf.fmt(Math.abs(stats.netBalance))}</div>
                </div>
            </div>
            <div class="flex justify-center mt-2">
                <span class="text-[10px] font-bold px-3 py-1 rounded-full" style="${roleBg}">${isExp ? 'Net Exporter' : 'Net Importer'}</span>
            </div>
        </div>`;

        html += this._buildConcentrationGauge(iso, mf);

        const allPartners = {};
        Object.entries(partnerExports).forEach(([p, v]) => { allPartners[p] = (allPartners[p] || 0) + v; });
        Object.entries(partnerImports).forEach(([p, v]) => { allPartners[p] = (allPartners[p] || 0) + v; });
        const sortedPartners = Object.entries(allPartners).sort((a, b) => b[1] - a[1]).slice(0, 10);

        if (sortedPartners.length > 0) {
            const maxPVal = sortedPartners[0][1];

            // Build bilateral totals from yearCache (pre-threshold) once for rank lookups.
            const bilatRaw = STATE.yearCache[STATE.year] || [];
            const bilatTotals = {};
            bilatRaw.forEach(d => {
                if (!bilatTotals[d.exporter]) bilatTotals[d.exporter] = {};
                bilatTotals[d.exporter][d.importer] = (bilatTotals[d.exporter][d.importer] || 0) + d.netValue;
                if (!bilatTotals[d.importer]) bilatTotals[d.importer] = {};
                bilatTotals[d.importer][d.exporter] = (bilatTotals[d.importer][d.exporter] || 0) + d.netValue;
            });
            // Returns 1-based rank of targetIso in forIso's partner list; 0 if not found.
            const getPartnerRank = (targetIso, forIso) => {
                const map = bilatTotals[forIso];
                if (!map || !(targetIso in map)) return 0;
                const targetVal = map[targetIso];
                let rank = 1;
                for (const k in map) { if (k !== targetIso && map[k] > targetVal) rank++; }
                return rank;
            };

            const rows = sortedPartners.map(([pIso, val], idx) => {
                const pName = STATE.countryNames[pIso] || pIso;
                const isoName = STATE.countryNames[iso] || iso;
                const barPct = Math.round((val / maxPVal) * 100);
                const isExportTo = !!partnerExports[pIso];
                const arrow = isExportTo ? '→' : '←';
                const aColor = isExportTo ? '#009EDB' : '#ED1847';
                const arcExpIso = isExportTo ? iso : pIso;
                const arcImpIso = isExportTo ? pIso : iso;

                // Rank asymmetry: where does iso rank in pIso's own partner list? (pre-threshold)
                const theirRank = getPartnerRank(iso, pIso);
                const rankCol = theirRank <= 3 ? '#72BF44' : theirRank <= 10 ? '#FBAF17' : '#AEA29A';
                const rankTip = theirRank > 0 ? `${pName} ranks ${isoName} as their #${theirRank} trading partner (pre-threshold)` : '';
                const rankDisplay = theirRank > 0
                    ? `<div class="flex items-baseline gap-0.5 flex-shrink-0" title="${rankTip}">
                            <span class="text-[#C0C8D4] text-[8px] font-mono leading-none">${idx + 1}</span>
                            <span class="text-[#D1D5DB] text-[7px] leading-none">·</span>
                            <span class="text-[9px] font-mono font-bold leading-none" style="color:${rankCol}">#${theirRank}</span>
                        </div>`
                    : `<span class="text-[#AEA29A] text-[9px] font-mono flex-shrink-0">${idx + 1}</span>`;

                // Bilateral flow split: share flowing in the dominant direction. (pre-threshold gross flows)
                let splitBadge = '';
                if (STATE.bilateralHistory) {
                    const [a, b] = [iso, pIso].sort();
                    const hist = STATE.bilateralHistory[a + '|' + b];
                    const entry = hist ? hist[String(STATE.year)] : null;
                    if (entry) {
                        const isoIsA = iso === a;
                        const isoOut = isoIsA ? entry.aToB : entry.bToA;
                        const isoIn  = isoIsA ? entry.bToA : entry.aToB;
                        const tot = isoOut + isoIn;
                        if (tot > 0) {
                            const domPct = Math.round(Math.max(isoOut, isoIn) / tot * 100);
                            const expDom = isoOut >= isoIn;
                            const badgeCol = domPct >= 75 ? (expDom ? '#009EDB' : '#ED1847') : '#AEA29A';
                            const tip = expDom
                                ? `${domPct}% of gross bilateral trade flows from ${isoName}`
                                : `${domPct}% of gross bilateral trade flows from ${pName}`;
                            splitBadge = `<span class="text-[9px] font-mono font-bold flex-shrink-0 w-10 text-right" style="color:${badgeCol}" title="${tip}">${expDom ? '→' : '←'}${domPct}%</span>`;
                        }
                    }
                }

                return `<div class="flex items-center gap-2 text-[11px] group">
                    ${rankDisplay}
                    <span style="color:${aColor}" class="flex-shrink-0 font-bold text-xs">${arrow}</span>
                    <span class="text-[#231F20] flex-1 truncate">${pName}</span>
                    <div class="w-10 h-[5px] bg-[#EBEAE6] rounded-full overflow-hidden flex-shrink-0">
                        <div class="h-full rounded-full" style="width:${barPct}%;background:${aColor};opacity:0.7"></div>
                    </div>
                    ${splitBadge}
                    <span class="text-[#6E6259] font-mono text-[10px] w-12 text-right flex-shrink-0">${mf.fmt(val)}</span>
                    <div class="flex gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onclick="App.openArcModal('${arcExpIso}','${arcImpIso}')" class="text-[8px] px-1.5 py-0.5 rounded bg-[#EBEAE6] hover:bg-[#004990] text-[#4B5563] hover:text-white transition" title="Bilateral history">↗</button>
                        <button onclick="App.openCompareModal('${iso}','${pIso}')" class="text-[8px] px-1.5 py-0.5 rounded bg-[#EBEAE6] hover:bg-[#B06E2A] text-[#4B5563] hover:text-white transition" title="Compare countries">⇄</button>
                    </div>
                </div>`;
            }).join('');
            html += `<div>
                <div class="flex items-center justify-between mb-2">
                    <div class="text-[9px] text-[#6E6259] font-bold uppercase tracking-wider">Trading Partners</div>
                    <div class="text-[8px] text-[#AEA29A] italic">you·them rank · split</div>
                </div>
                <div class="space-y-1.5">${rows}</div>
            </div>`;
        }

        html += this._buildButterflyChart(iso);

        html += this._buildPolarFingerprint(iso);

        const years = Object.keys(yearlyTotals).map(Number).sort();
        const yVals = years.map(y => yearlyTotals[y]);
        const maxYV = Math.max(...yVals);
        if (maxYV > 0) {
            const W = 284, H = 48, gap = 2;
            const barW = (W - gap * (years.length - 1)) / years.length;
            const bars = yVals.map((v, i) => {
                const h = Math.max(2, (v / maxYV) * H);
                const x = i * (barW + gap);
                const isCur = years[i] === STATE.year;
                const yLabel = String(years[i]).slice(2);
                return `<rect x="${x}" y="${H - h}" width="${barW}" height="${h}" rx="2" fill="${isCur ? '#004990' : '#DED9D5'}" ${isCur ? 'stroke="#0077B8" stroke-width="1"' : ''}/><text x="${x + barW / 2}" y="${H + 11}" text-anchor="middle" font-size="7" fill="${isCur ? '#0077B8' : '#AEA29A'}" font-family="Inter,monospace">${yLabel}</text>`;
            }).join('');
            html += `<div>
                <div class="text-[9px] text-[#6E6259] font-bold uppercase tracking-wider mb-2">Trade Trend (2015–${STATE.year})</div>
                <svg width="${W}" height="${H + 14}" class="overflow-visible w-full">${bars}</svg>
            </div>`;
        }

        const catTotals = {};
        let countryTotal = 0;
        STATE.filteredData.forEach(d => {
            if (d.exporter === iso || d.importer === iso) {
                catTotals[d.flowCategory] = (catTotals[d.flowCategory] || 0) + d.netValue;
                countryTotal += d.netValue;
            }
        });
        if (countryTotal > 0) {
            const catFull = { 'north-south': 'North → South', 'south-north': 'South → North', 'south-south': 'South → South', 'north-north': 'North → North' };
            const segments = Object.entries(catTotals).sort((a, b) => b[1] - a[1]).map(([cat, val]) => ({ cat, pct: (val / countryTotal) * 100 }));
            const barSegs = segments.map(s => `<div class="h-full" style="width:${s.pct}%;background:${CONFIG.flowColors[s.cat]}"></div>`).join('');
            const rows = segments.map(s => `<div class="flex items-center gap-2">
                <div class="w-2.5 h-2.5 rounded-sm flex-shrink-0" style="background:${CONFIG.flowColors[s.cat]}"></div>
                <span class="text-[10px] text-[#231F20] flex-1">${catFull[s.cat]}</span>
                <span class="text-[10px] font-bold font-mono" style="color:${CONFIG.flowColors[s.cat]}">${Math.round(s.pct)}%</span>
            </div>`).join('');
            html += `<div>
                <div class="text-[9px] text-[#6E6259] font-bold uppercase tracking-wider mb-2">Flow Composition</div>
                <div class="flex h-[6px] rounded-full overflow-hidden gap-px mb-2">${barSegs}</div>
                <div class="space-y-1">${rows}</div>
            </div>`;
        }

        return html;
    },

    // HHI computed from pre-threshold raw data to avoid zoom-level distortion.
    _buildConcentrationGauge(iso, mf) {
        const rawFlows = STATE.yearCache[STATE.year] || [];
        const isRegional = STATE.region && STATE.region !== 'Global';
        const combined = {};
        rawFlows.forEach(d => {
            if (!isRegional ||
                (RegionConfig.getRegion(d.exporter) === STATE.region && RegionConfig.getRegion(d.importer) === STATE.region)) {
                if (d.exporter === iso) combined[d.importer] = (combined[d.importer] || 0) + d.netValue;
                else if (d.importer === iso) combined[d.exporter] = (combined[d.exporter] || 0) + d.netValue;
            }
        });
        const total = Object.values(combined).reduce((s, v) => s + v, 0);
        if (total === 0) return '';
        const scopeNote = isRegional ? `${STATE.region} intra-regional · pre-threshold` : 'All net bilateral flows · pre-threshold';

        const shares = Object.values(combined).map(v => v / total);
        const hhi = shares.reduce((s, sh) => s + sh * sh, 0);

        const sorted = Object.entries(combined).sort((a, b) => b[1] - a[1]);
        const top1Pct = sorted[0] ? (sorted[0][1] / total * 100) : 0;
        const top3Pct = sorted.slice(0, 3).reduce((s, e) => s + e[1], 0) / total * 100;
        const top5Pct = sorted.slice(0, 5).reduce((s, e) => s + e[1], 0) / total * 100;
        const top1Name = sorted[0] ? (STATE.countryNames[sorted[0][0]] || sorted[0][0]) : '—';

        // Thresholds calibrated for trade (not market-competition DOJ levels).
        let label, badge;
        if (hhi < 0.20)      { label = 'Diversified';        badge = '#72BF44'; }
        else if (hhi < 0.40) { label = 'Moderate';           badge = '#FBAF17'; }
        else                  { label = 'Highly concentrated'; badge = '#ef4444'; }

        const W = 240, H = 110, cx = W / 2, cy = H - 12, r = 84;
        const startA = Math.PI, endA = 2 * Math.PI;
        const valA = startA + (endA - startA) * Math.min(hhi, 1);

        const arcPath = (a1, a2) => {
            const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
            const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
            return `M${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${a2 - a1 > Math.PI ? 1 : 0},1 ${x2.toFixed(2)},${y2.toFixed(2)}`;
        };
        const tick = (v) => {
            const a = startA + (endA - startA) * v;
            const x1 = cx + (r + 3) * Math.cos(a), y1 = cy + (r + 3) * Math.sin(a);
            const x2 = cx + (r - 7) * Math.cos(a), y2 = cy + (r - 7) * Math.sin(a);
            return `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="#AEA29A" stroke-width="1"/>`;
        };
        const mx1 = cx + (r - 14) * Math.cos(valA), my1 = cy + (r - 14) * Math.sin(valA);
        const mx2 = cx + (r + 6)  * Math.cos(valA), my2 = cy + (r + 6)  * Math.sin(valA);

        return `<div>
            <div class="text-[9px] text-[#6E6259] font-bold uppercase tracking-wider mb-1">Partner Concentration (HHI)</div>
            <div class="text-[8px] text-[#AEA29A] italic mb-2">${scopeNote}</div>
            <div class="bg-[#F5F7FA] border border-[#E2E8F0] rounded-lg p-3">
                <svg viewBox="0 0 ${W} ${H}" class="w-full" style="max-height:130px" preserveAspectRatio="xMidYMid meet">
                    <path d="${arcPath(startA, endA)}" stroke="#E2E8F0" stroke-width="9" fill="none" stroke-linecap="round"/>
                    <path d="${arcPath(startA, valA)}" stroke="${badge}" stroke-width="9" fill="none" stroke-linecap="round"/>
                    ${tick(0.20)}${tick(0.40)}
                    <line x1="${mx1.toFixed(2)}" y1="${my1.toFixed(2)}" x2="${mx2.toFixed(2)}" y2="${my2.toFixed(2)}" stroke="#231F20" stroke-width="2.5" stroke-linecap="round"/>
                    <text x="${cx}" y="${cy - 36}" text-anchor="middle" font-size="22" font-weight="700" fill="#231F20" font-family="Inter,monospace">${(hhi * 10000).toFixed(0)}</text>
                    <text x="${cx}" y="${cy - 20}" text-anchor="middle" font-size="9" fill="#6E6259" font-family="Inter,sans-serif">HHI score (0–10000)</text>
                </svg>
                <div class="flex justify-center -mt-1">
                    <span class="text-[10px] font-bold px-3 py-1 rounded-full" style="background:${badge}22;color:${badge}">${label}</span>
                </div>
                <div class="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-[#E2E8F0]">
                    <div class="text-center">
                        <div class="text-[8px] text-[#6E6259] uppercase font-bold">Top 1</div>
                        <div class="text-xs font-bold font-mono text-[#231F20]">${top1Pct.toFixed(0)}%</div>
                        <div class="text-[8px] text-[#6E6259] truncate" title="${top1Name}">${top1Name}</div>
                    </div>
                    <div class="text-center">
                        <div class="text-[8px] text-[#6E6259] uppercase font-bold">Top 3</div>
                        <div class="text-xs font-bold font-mono text-[#231F20]">${top3Pct.toFixed(0)}%</div>
                        <div class="text-[8px] text-[#6E6259]">share</div>
                    </div>
                    <div class="text-center">
                        <div class="text-[8px] text-[#6E6259] uppercase font-bold">Top 5</div>
                        <div class="text-xs font-bold font-mono text-[#231F20]">${top5Pct.toFixed(0)}%</div>
                        <div class="text-[8px] text-[#6E6259]">share</div>
                    </div>
                </div>
            </div>
        </div>`;
    },

    // Polar Fingerprint: geographic bearing computed via great-circle formula.
    // Uses pre-threshold raw data so small-country partners are included.
    _buildPolarFingerprint(iso) {
        const myCoords = STATE.countryCoords[iso];
        if (!myCoords) return '';
        const [lon1, lat1] = myCoords;

        const bearingTo = (lon2, lat2) => {
            const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
            const Δλ = (lon2 - lon1) * Math.PI / 180;
            const y = Math.sin(Δλ) * Math.cos(φ2);
            const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
            return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
        };

        const SECTORS = 8, SECTOR_WIDTH = 45;
        const sectorExp = new Array(SECTORS).fill(0);
        const sectorImp = new Array(SECTORS).fill(0);
        let anyData = false;

        const rawFlows = STATE.yearCache[STATE.year] || [];
        const isRegional = STATE.region && STATE.region !== 'Global';
        rawFlows.forEach(d => {
            if (!isRegional ||
                (RegionConfig.getRegion(d.exporter) === STATE.region && RegionConfig.getRegion(d.importer) === STATE.region)) {
                const isExport = d.exporter === iso, isImport = d.importer === iso;
                if (!isExport && !isImport) return;
                const partnerIso = isExport ? d.importer : d.exporter;
                const c = STATE.countryCoords[partnerIso];
                if (!c) return;
                const idx = Math.floor((bearingTo(c[0], c[1]) + SECTOR_WIDTH / 2) / SECTOR_WIDTH) % SECTORS;
                if (isExport) sectorExp[idx] += d.netValue;
                else          sectorImp[idx] += d.netValue;
                anyData = true;
            }
        });
        if (!anyData) return '';

        const maxVal = Math.max(...sectorExp, ...sectorImp, 1);
        const W = 220, H = 220, cx = W / 2, cy = H / 2, innerR = 16, maxBarLen = 78;
        const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        const parts = [];

        [0.25, 0.5, 1].forEach(p => {
            const rr = innerR + maxBarLen * p;
            parts.push(`<circle cx="${cx}" cy="${cy}" r="${rr}" fill="none" stroke="#E2E8F0" stroke-width="0.6" ${p < 1 ? 'stroke-dasharray="2 3"' : ''}/>`);
        });
        parts.push(`<line x1="${cx}" y1="${cy - innerR - maxBarLen}" x2="${cx}" y2="${cy + innerR + maxBarLen}" stroke="#E2E8F0" stroke-width="0.5"/>`);
        parts.push(`<line x1="${cx - innerR - maxBarLen}" y1="${cy}" x2="${cx + innerR + maxBarLen}" y2="${cy}" stroke="#E2E8F0" stroke-width="0.5"/>`);

        for (let i = 0; i < SECTORS; i++) {
            const centerRad = (i * SECTOR_WIDTH - 90) * Math.PI / 180;
            const offsetRad = 9 * Math.PI / 180;
            const expLen = (sectorExp[i] / maxVal) * maxBarLen;
            const impLen = (sectorImp[i] / maxVal) * maxBarLen;
            const drawBar = (len, angleRad, color) => {
                if (len < 0.5) return;
                const x1 = cx + innerR * Math.cos(angleRad), y1 = cy + innerR * Math.sin(angleRad);
                const x2 = cx + (innerR + len) * Math.cos(angleRad), y2 = cy + (innerR + len) * Math.sin(angleRad);
                parts.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${color}" stroke-width="6" stroke-linecap="round" opacity="0.88"/>`);
            };
            drawBar(expLen, centerRad + offsetRad, '#009EDB');
            drawBar(impLen, centerRad - offsetRad, '#ED1847');

            const labelR = innerR + maxBarLen + 14;
            parts.push(`<text x="${(cx + labelR * Math.cos(centerRad)).toFixed(2)}" y="${(cy + labelR * Math.sin(centerRad) + 3).toFixed(2)}" text-anchor="middle" font-size="10" font-weight="700" fill="#AEA29A" font-family="Inter,sans-serif">${labels[i]}</text>`);
        }
        parts.push(`<circle cx="${cx}" cy="${cy}" r="3.2" fill="#231F20"/>`);

        const scopeNote = isRegional ? `${STATE.region} intra-regional · pre-threshold` : 'All net bilateral flows · pre-threshold';
        return `<div>
            <div class="text-[9px] text-[#6E6259] font-bold uppercase tracking-wider mb-1">Trade Fingerprint</div>
            <div class="text-[8px] text-[#AEA29A] italic mb-2">${scopeNote}</div>
            <div class="bg-[#F5F7FA] border border-[#E2E8F0] rounded-lg p-3 flex flex-col items-center">
                <svg viewBox="0 0 ${W} ${H}" class="w-full" style="max-width:220px" preserveAspectRatio="xMidYMid meet">
                    ${parts.join('')}
                </svg>
                <div class="flex items-center gap-3 mt-1 text-[9px]">
                    <div class="flex items-center gap-1"><div style="width:10px;height:3px;background:#009EDB;border-radius:2px"></div><span class="text-[#231F20]">Exports</span></div>
                    <div class="flex items-center gap-1"><div style="width:10px;height:3px;background:#ED1847;border-radius:2px"></div><span class="text-[#231F20]">Imports</span></div>
                </div>
                <div class="text-[9px] text-[#6E6259] italic mt-1 text-center">Bar direction = geographic bearing from this country</div>
            </div>
        </div>`;
    },

    // Butterfly chart: for each of the top 7 partners, show export bar (right, blue)
    // and import bar (left, red). Lengths are scaled to the maximum single-direction value.
    // Source: bilateralHistory (gross flows, both directions). Falls back to yearCache net direction.
    _buildButterflyChart(iso) {
        const rawFlows = STATE.yearCache[STATE.year] || [];
        const isRegional = STATE.region && STATE.region !== 'Global';
        const combined = {};
        rawFlows.forEach(d => {
            if (isRegional &&
                !(RegionConfig.getRegion(d.exporter) === STATE.region && RegionConfig.getRegion(d.importer) === STATE.region)) return;
            if (d.exporter === iso) combined[d.importer] = (combined[d.importer] || 0) + d.netValue;
            else if (d.importer === iso) combined[d.exporter] = (combined[d.exporter] || 0) + d.netValue;
        });

        const topPartners = Object.entries(combined)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 7)
            .map(([p]) => p);

        if (topPartners.length === 0) return '';

        const partnerData = topPartners.map(pIso => {
            let expVal = 0, impVal = 0;
            if (STATE.bilateralHistory) {
                const [a, b] = [iso, pIso].sort();
                const hist = STATE.bilateralHistory[a + '|' + b];
                const entry = hist ? hist[String(STATE.year)] : null;
                if (entry) {
                    const isoIsA = iso === a;
                    expVal = isoIsA ? (entry.aToB || 0) : (entry.bToA || 0);
                    impVal = isoIsA ? (entry.bToA || 0) : (entry.aToB || 0);
                } else {
                    // Fallback: place net value on the dominant side
                    const flow = rawFlows.find(d =>
                        (d.exporter === iso && d.importer === pIso) ||
                        (d.exporter === pIso && d.importer === iso));
                    if (flow) { if (flow.exporter === iso) expVal = flow.netValue; else impVal = flow.netValue; }
                }
            } else {
                const flow = rawFlows.find(d =>
                    (d.exporter === iso && d.importer === pIso) ||
                    (d.exporter === pIso && d.importer === iso));
                if (flow) { if (flow.exporter === iso) expVal = flow.netValue; else impVal = flow.netValue; }
            }
            return { pIso, expVal, impVal };
        });

        const maxVal = Math.max(...partnerData.map(d => Math.max(d.expVal, d.impVal)), 1);

        // Layout: name zone in center, bars diverge left (imports) and right (exports)
        const W = 280, nameW = 72;
        const cx = W / 2, leftEdge = cx - nameW / 2, rightEdge = cx + nameW / 2;
        const barMaxLen = 92, barH = 9, rowGap = 16;

        const rows = partnerData.map((d, i) => {
            const y = i * rowGap;
            const expLen = d.expVal > 0 ? Math.max(1.5, (d.expVal / maxVal) * barMaxLen) : 0;
            const impLen = d.impVal > 0 ? Math.max(1.5, (d.impVal / maxVal) * barMaxLen) : 0;
            const name = STATE.countryNames[d.pIso] || d.pIso;
            const shortName = name.length > 12 ? name.slice(0, 11) + '…' : name;

            const impBar = impLen > 0
                ? `<rect x="${(leftEdge - impLen).toFixed(1)}" y="${y}" width="${impLen.toFixed(1)}" height="${barH}" rx="2" fill="#ED1847" opacity="0.78"/>`
                : '';
            const expBar = expLen > 0
                ? `<rect x="${rightEdge}" y="${y}" width="${expLen.toFixed(1)}" height="${barH}" rx="2" fill="#009EDB" opacity="0.78"/>`
                : '';
            const nameEl = `<text x="${cx}" y="${y + barH - 1}" text-anchor="middle" font-size="7.5" fill="#231F20" font-family="Inter,sans-serif">${shortName}</text>`;

            return `${impBar}${expBar}${nameEl}`;
        }).join('');

        const totalH = topPartners.length * rowGap + barH;

        const grid = `
            <text x="${(leftEdge - barMaxLen / 2).toFixed(0)}" y="-4" text-anchor="middle" font-size="7" font-weight="700" fill="#ED1847" font-family="Inter,sans-serif">← Imports</text>
            <text x="${(rightEdge + barMaxLen / 2).toFixed(0)}" y="-4" text-anchor="middle" font-size="7" font-weight="700" fill="#009EDB" font-family="Inter,sans-serif">Exports →</text>
            <line x1="${leftEdge}" y1="0" x2="${leftEdge}" y2="${totalH}" stroke="#E2E8F0" stroke-width="0.6" stroke-dasharray="2,2"/>
            <line x1="${rightEdge}" y1="0" x2="${rightEdge}" y2="${totalH}" stroke="#E2E8F0" stroke-width="0.6" stroke-dasharray="2,2"/>`;

        const scopeNote = isRegional
            ? `${STATE.region} · top 7 · pre-threshold`
            : 'Top 7 partners · gross bilateral · pre-threshold';

        return `<div>
            <div class="text-[9px] text-[#6E6259] font-bold uppercase tracking-wider mb-1">Bilateral Trade Split</div>
            <div class="text-[8px] text-[#AEA29A] italic mb-2">${scopeNote}</div>
            <div class="bg-[#F5F7FA] border border-[#E2E8F0] rounded-lg p-3">
                <svg viewBox="0 -10 ${W} ${totalH + 12}" class="w-full overflow-visible" preserveAspectRatio="xMidYMid meet">
                    ${grid}
                    ${rows}
                </svg>
            </div>
        </div>`;
    },

    _generateNarrative(iso, stats, partnerExports, partnerImports, yearlyTotals, mf) {
        const name = STATE.countryNames[iso] || iso;
        const sentences = [];

        if (stats) {
            const isExp = stats.netBalance >= 0;
            const role = isExp ? 'net exporter' : 'net importer';

            const _yearStr = String(STATE.year);
            if (!this._globalRankCache[_yearStr]) {
                const globalVols = {};
                Object.entries(STATE.trendSummary).forEach(([isoKey, yearData]) => {
                    const val = yearData[_yearStr];
                    if (val > 0) globalVols[isoKey] = val;
                });
                this._globalRankCache[_yearStr] = Object.entries(globalVols).sort((a, b) => b[1] - a[1]);
            }
            const sortedGlobal = this._globalRankCache[_yearStr];
            const globalRank = sortedGlobal.findIndex(([k]) => k === iso) + 1;
            const totalCountries = sortedGlobal.length;
            const rankStr = globalRank > 0 ? `ranked <strong>#${globalRank} of ${totalCountries}</strong> globally` : 'active';
            sentences.push(`<strong>${name}</strong> is a <strong>${role}</strong> of used clothing, ${rankStr} by gross trade volume in ${STATE.year} (${mf.fmt(stats.grossVolume)}).`);
        }

        const years = Object.keys(yearlyTotals).map(Number).sort();
        const curIdx = years.indexOf(STATE.year);
        if (curIdx > 0) {
            const curVal = yearlyTotals[STATE.year];
            const prevVal = yearlyTotals[years[curIdx - 1]];
            if (prevVal > 0 && curVal > 0) {
                const yoy = ((curVal - prevVal) / prevVal) * 100;
                const dir = yoy >= 0 ? 'grew' : 'declined';
                const col = yoy >= 0 ? '#72BF44' : '#ED1847';
                const firstNZ = years.findIndex(y => yearlyTotals[y] > 0);
                let cagrStr = '';
                if (firstNZ >= 0 && curIdx > firstNZ && yearlyTotals[years[firstNZ]] > 0) {
                    const n = curIdx - firstNZ;
                    const cagr = (Math.pow(curVal / yearlyTotals[years[firstNZ]], 1 / n) - 1) * 100;
                    if (isFinite(cagr)) cagrStr = ` (CAGR ${cagr >= 0 ? '+' : ''}${cagr.toFixed(1)}% since ${years[firstNZ]})`;
                }
                sentences.push(`Trade volumes <strong style="color:${col}">${dir} ${Math.abs(yoy).toFixed(1)}%</strong> from ${years[curIdx - 1]} to ${STATE.year}${cagrStr}.`);
            }
        }

        const allPartners = {};
        Object.entries(partnerExports).forEach(([p, v]) => { allPartners[p] = (allPartners[p] || 0) + v; });
        Object.entries(partnerImports).forEach(([p, v]) => { allPartners[p] = (allPartners[p] || 0) + v; });
        const topEntry = Object.entries(allPartners).sort((a, b) => b[1] - a[1])[0];

        const catTotals = {};
        let countryTotal = 0;
        STATE.filteredData.forEach(d => {
            if (d.exporter === iso || d.importer === iso) {
                catTotals[d.flowCategory] = (catTotals[d.flowCategory] || 0) + d.netValue;
                countryTotal += d.netValue;
            }
        });
        const domCat = Object.entries(catTotals).sort((a, b) => b[1] - a[1])[0];
        const catFull = { 'north-south': 'North→South', 'south-north': 'South→North', 'south-south': 'South→South', 'north-north': 'North→North' };

        if (topEntry || domCat) {
            let s = '';
            if (topEntry) {
                const tpName = STATE.countryNames[topEntry[0]] || topEntry[0];
                s += `Top trading partner is <strong>${tpName}</strong>.`;
            }
            if (domCat && countryTotal > 0) {
                const domPct = Math.round((domCat[1] / countryTotal) * 100);
                const catCol = CONFIG.flowColors[domCat[0]];
                s += ` <strong style="color:${catCol}">${catFull[domCat[0]]}</strong> flows dominate at ${domPct}%.`;
            }
            if (s) sentences.push(s);
        }

        if (sentences.length === 0) return `<p class="text-[11px] text-[#AEA29A] italic">No trade data available for this country in the current view.</p>`;
        return sentences.map(s => `<p class="text-[11px] text-[#231F20] leading-relaxed">${s}</p>`).join('');
    },

    updateDashboard(rebuildMenus = true) {
        STATE.selectedExporters = new Set(this.exporterSelector.getSelectedCountries());
        STATE.selectedImporters = new Set(this.importerSelector.getSelectedCountries());

        // Auto-reset threshold only when transitioning from "some selected" → "none selected"
        const currentSelectionCount = STATE.selectedExporters.size + STATE.selectedImporters.size;
        if (currentSelectionCount === 0 && this._prevSelectionCount > 0 && STATE.thresholdMode !== 'auto') {
            STATE.thresholdMode = 'auto';
            const autoBtn = document.querySelector('.threshold-btn[data-threshold="auto"]');
            if (autoBtn) this.updateUIClasses('.threshold-btn', autoBtn);
        }
        this._prevSelectionCount = currentSelectionCount;

        DataLoader.filterData();
        TradeMap.renderFlows();
        this.updateKPIBar();

        if (this._lastRenderedRegion !== STATE.region) {
            this._lastRenderedRegion = STATE.region;
            setTimeout(() => TradeMap.zoomToRegion(STATE.region), 50);
        }
    },

    showTooltip(event, iso) {
        const tooltip = document.getElementById('tooltip');
        const name = STATE.countryNames[iso] || iso;
        const stats = STATE.nodeStats[iso];
        const mf = METRIC_FORMAT[STATE.metric] || METRIC_FORMAT.value;

        const region = RegionConfig.getRegion(iso);
        const devStatus = CONFIG.development[iso] === 'north' ? 'Developed' : 'Developing';
        const regionTag = region && region !== 'Other'
            ? `<span class="text-[9px] text-[#6E6259]">${region} · ${devStatus}</span>` : '';

        let content = `
        <div class="flex items-center justify-between gap-3 mb-1.5">
            <div class="font-bold text-[#004990] text-sm leading-tight">${name}</div>
            ${regionTag}
        </div>`;

        if (!stats) {
            tooltip.innerHTML = content;
            this._positionTooltip(tooltip, event);
            return;
        }

        const isNetExporter = stats.netBalance >= 0;
        const balanceColor = isNetExporter ? '#009EDB' : '#ED1847';
        const balanceSign  = isNetExporter ? '+' : '';
        const roleLabel    = isNetExporter ? 'Net Exporter' : 'Net Importer';
        const roleBg       = isNetExporter ? 'background:rgba(0,158,219,0.15);color:#009EDB' : 'background:rgba(237,24,71,0.15);color:#ED1847';

        content += `
        <div class="grid grid-cols-2 gap-2 mb-1.5">
            <div class="bg-[#F5F7FA] border border-[#E2E8F0] rounded-md px-2 py-1.5">
                <div class="text-[9px] text-[#6E6259] uppercase">${mf.grossLabel.replace(':','')}</div>
                <div class="text-xs font-bold text-[#231F20] font-mono">${mf.fmt(stats.grossVolume)}</div>
            </div>
            <div class="bg-[#F5F7FA] border border-[#E2E8F0] rounded-md px-2 py-1.5">
                <div class="text-[9px] text-[#6E6259] uppercase">${mf.netLabel.replace(':','')}</div>
                <div class="text-xs font-bold font-mono" style="color:${balanceColor}">${balanceSign}${mf.fmt(Math.abs(stats.netBalance))}</div>
            </div>
        </div>
        <div class="flex justify-center mb-2">
            <span class="text-[9px] font-bold px-2 py-0.5 rounded-full" style="${roleBg}">${roleLabel}</span>
        </div>`;

        const partnerExports = {};
        const partnerImports = {};
        STATE.filteredData.forEach(d => {
            if (d.exporter === iso) {
                partnerExports[d.importer] = (partnerExports[d.importer] || 0) + d.netValue;
            } else if (d.importer === iso) {
                partnerImports[d.exporter] = (partnerImports[d.exporter] || 0) + d.netValue;
            }
        });

        const allPartners = {};
        Object.entries(partnerExports).forEach(([p, v]) => { allPartners[p] = (allPartners[p] || 0) + v; });
        Object.entries(partnerImports).forEach(([p, v]) => { allPartners[p] = (allPartners[p] || 0) + v; });

        const topPartners = Object.entries(allPartners)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3);

        if (topPartners.length > 0) {
            const maxPVal = topPartners[0][1];
            const partnerRows = topPartners.map(([pIso, val]) => {
                const pName = (STATE.countryNames[pIso] || pIso);
                const shortName = pName.length > 14 ? pName.slice(0, 13) + '…' : pName;
                const barPct = Math.round((val / maxPVal) * 100);
                const isExportTo = !!partnerExports[pIso];
                const arrow = isExportTo ? '→' : '←';
                const arrowColor = isExportTo ? '#009EDB' : '#ED1847';
                return `
                <div class="flex items-center gap-1.5 text-[10px] leading-relaxed">
                    <span style="color:${arrowColor}" class="flex-shrink-0 font-bold">${arrow}</span>
                    <span class="text-[#231F20] w-[72px] truncate">${shortName}</span>
                    <div class="flex-1 h-[5px] bg-[#EBEAE6] rounded-full overflow-hidden">
                        <div class="h-full rounded-full" style="width:${barPct}%;background:${arrowColor};opacity:0.7"></div>
                    </div>
                    <span class="text-[#6E6259] font-mono text-[9px] w-[52px] text-right">${mf.fmt(val)}</span>
                </div>`;
            }).join('');

            content += `
            <div class="pt-1.5 border-t border-[#E2E8F0]">
                <div class="text-[9px] text-[#6E6259] font-bold uppercase mb-1 tracking-wider">Top Partners</div>
                ${partnerRows}
            </div>`;
        }

        const catTotals = {};
        let countryTotal = 0;
        STATE.filteredData.forEach(d => {
            if (d.exporter === iso || d.importer === iso) {
                catTotals[d.flowCategory] = (catTotals[d.flowCategory] || 0) + d.netValue;
                countryTotal += d.netValue;
            }
        });

        if (countryTotal > 0) {
            const catLabels = { 'north-south': 'N→S', 'south-north': 'S→N', 'south-south': 'S→S', 'north-north': 'N→N' };
            const segments = Object.entries(catTotals)
                .sort((a, b) => b[1] - a[1])
                .map(([cat, val]) => ({ cat, pct: (val / countryTotal) * 100 }));

            const barSegments = segments.map(s =>
                `<div class="h-full" style="width:${s.pct}%;background:${CONFIG.flowColors[s.cat]}"></div>`
            ).join('');
            const labelSpans = segments.map(s =>
                `<span style="color:${CONFIG.flowColors[s.cat]}" class="text-[9px] font-bold">${catLabels[s.cat]} ${Math.round(s.pct)}%</span>`
            ).join('<span class="text-[#D1D5DB] text-[9px]">·</span>');

            content += `
            <div class="mt-1.5 pt-1.5 border-t border-[#E2E8F0]">
                <div class="text-[9px] text-[#6E6259] font-bold uppercase mb-1 tracking-wider">Flow Composition</div>
                <div class="flex h-[4px] rounded-full overflow-hidden gap-px">${barSegments}</div>
                <div class="flex items-center justify-center gap-1 mt-1 flex-wrap">${labelSpans}</div>
            </div>`;
        }

        const yearlyTotals = {};
        const _isoTrend = STATE.trendSummary[iso] || {};
        for (let y = 2015; y <= 2024; y++) yearlyTotals[y] = _isoTrend[String(y)] || 0;

        const years = Object.keys(yearlyTotals).map(Number).sort();
        const yVals = years.map(y => yearlyTotals[y]);
        const maxYV = Math.max(...yVals);

        if (maxYV > 0) {
            const W = 140, H = 28, gap = 1;
            const barW = (W - gap * (years.length - 1)) / years.length;
            const bars = yVals.map((v, i) => {
                const h = Math.max(1, (v / maxYV) * H);
                const x = i * (barW + gap);
                const isCur = years[i] === STATE.year;
                return `<rect x="${x}" y="${H - h}" width="${barW}" height="${h}" rx="1.5" fill="${isCur ? '#004990' : '#DED9D5'}" ${isCur ? 'stroke="#0077B8" stroke-width="0.5"' : ''}/>`;
            }).join('');

            const curIdx = years.indexOf(STATE.year);
            let yoyHtml = '';
            if (curIdx > 0 && yVals[curIdx - 1] > 0) {
                const yoy = ((yVals[curIdx] - yVals[curIdx - 1]) / yVals[curIdx - 1]) * 100;
                const yoyCol = yoy >= 0 ? '#72BF44' : '#ED1847';
                const yoySign = yoy >= 0 ? '+' : '';
                yoyHtml = `<span class="text-[9px] font-mono font-bold" style="color:${yoyCol}">${yoySign}${yoy.toFixed(0)}% YoY</span>`;
            }
            let cagrHtml = '';
            const firstNonZeroIdx = yVals.findIndex(v => v > 0);
            if (firstNonZeroIdx >= 0 && curIdx > firstNonZeroIdx && yVals[firstNonZeroIdx] > 0 && yVals[curIdx] > 0) {
                const n = curIdx - firstNonZeroIdx;
                const cagr = (Math.pow(yVals[curIdx] / yVals[firstNonZeroIdx], 1 / n) - 1) * 100;
                if (isFinite(cagr)) {
                    const cagrCol = cagr >= 0 ? '#72BF44' : '#ED1847';
                    cagrHtml = `<span class="text-[8px] font-mono" style="color:${cagrCol}">CAGR ${cagr >= 0 ? '+' : ''}${cagr.toFixed(1)}%</span>`;
                }
            }

            content += `
            <div class="mt-1.5 pt-1.5 border-t border-[#E2E8F0]">
                <div class="flex items-center justify-between mb-1">
                    <span class="text-[9px] text-[#6E6259] font-bold uppercase tracking-wider">Trend</span>
                    <div class="flex items-center gap-2">${yoyHtml}${cagrHtml}</div>
                </div>
                <svg width="${W}" height="${H}" class="w-full">${bars}</svg>
                <div class="flex justify-between text-[8px] text-[#AEA29A] font-mono mt-0.5">
                    <span>${years[0]}</span><span>${years[years.length - 1]}</span>
                </div>
            </div>`;
        }

        if (region && region !== 'Other') {
            const regionCountries = Object.entries(STATE.nodeStats)
                .filter(([code]) => RegionConfig.getRegion(code) === region)
                .sort((a, b) => b[1].grossVolume - a[1].grossVolume);
            const rank = regionCountries.findIndex(([code]) => code === iso) + 1;
            const total = regionCountries.length;
            if (rank > 0) {
                content += `
                <div class="mt-1.5 pt-1.5 border-t border-[#E2E8F0] text-[9px] text-[#6E6259] flex items-center gap-1">
                    <span class="text-[#004990] font-bold text-[10px]">#${rank}</span>
                    <span>of ${total} in ${region}</span>
                    <span class="ml-auto px-1.5 py-0.5 rounded text-[8px] font-bold" style="${roleBg}">${roleLabel}</span>
                </div>`;
            }
        }

        tooltip.innerHTML = content;
        this._positionTooltip(tooltip, event);
    },

    _positionTooltip(tooltip, event) {
        tooltip.style.display = 'block';
        const pad = 15;
        
        // ツールチップの親コンテナ（マップの枠）のサイズと位置を取得
        const container = tooltip.parentElement;
        const rect = container.getBoundingClientRect();
        
        // コンテナ内でのマウスの相対座標を計算
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;

        const tw = tooltip.offsetWidth;
        const th = tooltip.offsetHeight;
        
        // 基本はマウスカーソルの右下に配置
        let x = mouseX + pad;
        let y = mouseY + pad;

        // 右にはみ出る場合はマウスの左側に反転
        if (x + tw > rect.width - pad) x = mouseX - tw - pad;
        
        // 下にはみ出る場合はマウスの上側に反転
        if (y + th > rect.height - pad) y = mouseY - th - pad;
        
        // コンテナの左や上にはみ出さないための最終安全措置
        if (x < pad) x = pad;
        if (y < pad) y = pad;

        tooltip.style.left = x + 'px';
        tooltip.style.top = y + 'px';
    },

    hideTooltip() {
        document.getElementById('tooltip').style.display = 'none';
    },

    toggleMobileLegend() {
        const panel = document.getElementById('legend-panel');
        const backdrop = document.getElementById('mobile-legend-backdrop');
        const isOpen = panel.classList.contains('mobile-open');
        if (isOpen) {
            panel.classList.remove('mobile-open');
            backdrop.classList.add('hidden');
        } else {
            panel.classList.add('mobile-open');
            backdrop.classList.remove('hidden');
        }
    },

    toggleMobileFilter() {
        const panel = document.getElementById('mobile-filter-panel');
        const backdrop = document.getElementById('mobile-filter-backdrop');
        if (!panel) return;
        const isOpen = panel.classList.contains('open');
        if (isOpen) {
            panel.classList.remove('open');
            backdrop.classList.add('hidden');
        } else {
            panel.classList.add('open');
            backdrop.classList.remove('hidden');
        }
    },

    syncMobileFilterState() {
        const activeRegion = document.querySelector(`.region-btn[data-region="${STATE.region || 'Global'}"]`);
        if (activeRegion) this.updateUIClasses('.region-btn', activeRegion);
        const threshVal = (STATE.thresholdMode === 'auto' || STATE.thresholdMode === undefined) ? 'auto' : String(STATE.thresholdMode);
        const activeThreshold = document.querySelector(`.threshold-btn[data-threshold="${threshVal}"]`);
        if (activeThreshold) this.updateUIClasses('.threshold-btn', activeThreshold);
    }
};

// Inline onclick handlers in dynamically generated HTML require global access
window.App = App;

document.addEventListener('shc:selection-change',  () => App.updateDashboard(false));
document.addEventListener('shc:arc-click',         e  => App.openArcModal(e.detail.exporter, e.detail.importer));
document.addEventListener('shc:country-click',     e  => App.openInsightPanel(e.detail));
document.addEventListener('shc:country-hover',     e  => App.showTooltip(e.detail.event, e.detail.country));
document.addEventListener('shc:country-hoverend',  () => App.hideTooltip());

document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
