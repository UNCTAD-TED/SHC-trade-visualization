// countrySelector.js - Hierarchical country selection with collapsible groups
import { STATE } from './config.js';

let _classificationCache = null;

// Economies listed in country_classification.json that are NOT offered in the
// pickers because the dataset holds no trade for them in any year, so picking
// one could only produce an empty map. This is a data-coverage rule, not a
// cartographic or political one:
//   TWN — the source (BACI / UN Comtrade) records this trade under
//         "Other Asia, nes", which the dataset excludes.
//   PRI — no flow in any year or metric of the dataset.
export const NO_DATA_CODES = new Set(['TWN', 'PRI']);

class CountrySelector {
    constructor(elementId, labelId, type) {
        this.elementId = elementId;
        this.labelId = labelId;
        this.type = type;
        this.classificationData = null;
        this.selectedCountries = new Set();
        this.allCountries = [];
        // A country can sit in several groups (e.g. Kenya under "Eastern Africa"
        // AND "Developing economies"), so each code maps to ALL of its checkboxes.
        this._checkboxesByCode = {};
    }

    async init() {
        await this.loadClassificationData();
        this.buildDropdown();
    }

    async loadClassificationData() {
        try {
            if (!_classificationCache) {
                const response = await fetch('data/country_classification.json');
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                _classificationCache = await response.json();
            }
            this.classificationData = _classificationCache;
            this.allCountries = this._codes()
                .map(code => ({ code, name: this.classificationData.countries[code].name }))
                .sort((a, b) => a.name.localeCompare(b.name));
        } catch (error) {
            console.error('Failed to load country classification:', error);
        }
    }

    // Codes the pickers offer (classification minus the no-data economies).
    _codes() {
        return Object.keys(this.classificationData.countries).filter(code => !NO_DATA_CODES.has(code));
    }

    // True when `code` is an economy this picker lists.
    hasCountry(code) {
        return !!this.classificationData?.countries[code] && !NO_DATA_CODES.has(code);
    }

    getCountriesInRegion(regionCode) {
        return this._codes().filter(code =>
            this.classificationData.countries[code].regions.includes(regionCode)
        );
    }

    buildDropdown() {
        if (!this.classificationData) return;
        const list = document.getElementById(`${this.elementId}-list`);
        if (!list) return;
        list.innerHTML = '';
        this._checkboxesByCode = {};
        this._installSearchDedup();

        // ── Geographic Regions ────────────────────────────────────
        this._addSectionHeader(list, 'Geographic regions');
        const regionOrder = ['5100', '5200', '5300', '5400', '5500'];
        regionOrder.forEach(contCode => {
            const cont = this.classificationData.regions[contCode];
            if (!cont) return;
            const continentCountries = this.getCountriesInRegion(contCode);
            const { childContainer } = this._addGroupRow(list, {
                label: `${cont.name} (All)`,
                countries: continentCountries,
                indent: 0,
                icon: '',
            });
            (cont.subregions || []).forEach(sub => {
                const subCountries = this.getCountriesInRegion(sub.code);
                const { childContainer: subChild } = this._addGroupRow(childContainer, {
                    label: sub.name,
                    countries: subCountries,
                    indent: 1,
                    icon: '└',
                });
                if ((sub.subsubregions || []).length > 0) {
                    sub.subsubregions.forEach(subsub => {
                        const subsubCountries = this.getCountriesInRegion(subsub.code);
                        const { childContainer: subsubChild } = this._addGroupRow(subChild, {
                            label: subsub.name,
                            countries: subsubCountries,
                            indent: 2,
                            icon: '  └',
                        });
                        this._addSortedCountries(subsubChild, subsubCountries, 3);
                    });
                } else {
                    this._addSortedCountries(subChild, subCountries, 2);
                }
            });
        });

        // ── Development Status ────────────────────────────────────
        this._addSectionHeader(list, 'Development status');
        ['1500', '1400', '1610'].forEach(devCode => {
            const devGroup = this.classificationData.development[devCode];
            if (!devGroup) return;
            const devCountries = devGroup.countries.filter(code => !NO_DATA_CODES.has(code));
            const { childContainer } = this._addGroupRow(list, {
                label: devGroup.name,
                countries: devCountries,
                indent: 0,
                icon: '',
            });
            this._addSortedCountries(childContainer, devCountries, 1);
        });
    }

    // While the search box holds a term, App's search handler (main.js) shows
    // every matching .country-option — so a country listed in several groups
    // would appear two or three times. Every occurrence after the first carries
    // data-dup="1"; this listener sits on the menu (bubble phase, i.e. AFTER the
    // handler on the input itself) and hides those repeats. The kept row shares
    // its checked state with the hidden ones, so nothing is lost.
    _installSearchDedup() {
        if (this._searchDedupInstalled) return;
        const menu = document.getElementById(`${this.elementId}-menu`);
        const search = document.getElementById(`${this.elementId}-search`);
        if (!menu || !search) return;
        this._searchDedupInstalled = true;
        menu.addEventListener('input', (e) => {
            if (e.target !== search || !search.value.trim()) return;
            menu.querySelectorAll('.country-option[data-dup="1"]').forEach(el => { el.style.display = 'none'; });
        });
    }

    _addSectionHeader(parent, title) {
        const div = document.createElement('div');
        div.className = 'picker-section-header';
        div.textContent = title;
        parent.appendChild(div);
    }

    // Builds a group row with expand toggle. Returns { wrapper, childContainer }.
    _addGroupRow(parent, { label, countries, indent, icon }) {
        const wrapper = document.createElement('div');
        wrapper.className = 'group-wrapper';

        const row = document.createElement('div');
        row.className = 'group-option';
        row.style.paddingLeft = `${8 + indent * 14}px`;

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'group-toggle';
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', 'Show the economies in this group');
        toggle.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'custom-checkbox group-checkbox';
        checkbox.dataset.groupCountries = countries.join(',');

        const iconSpan = document.createElement('span');
        iconSpan.className = 'group-icon';
        iconSpan.textContent = icon;

        const labelSpan = document.createElement('span');
        labelSpan.className = 'group-label';
        labelSpan.textContent = label;

        const countSpan = document.createElement('span');
        countSpan.className = 'group-count';
        countSpan.textContent = countries.length;

        row.appendChild(toggle);
        row.appendChild(checkbox);
        row.appendChild(iconSpan);
        row.appendChild(labelSpan);
        row.appendChild(countSpan);

        const childContainer = document.createElement('div');
        childContainer.className = 'group-children hidden';

        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const expanded = toggle.getAttribute('aria-expanded') === 'true';
            toggle.setAttribute('aria-expanded', String(!expanded));
            childContainer.classList.toggle('hidden');
        });

        checkbox.addEventListener('change', (e) => {
            e.stopPropagation();
            if (e.target.checked) {
                countries.forEach(code => { this.selectedCountries.add(code); });
            } else {
                countries.forEach(code => { this.selectedCountries.delete(code); });
            }
            this.updateSelection();
        });

        row.addEventListener('click', (e) => {
            if (e.target === checkbox || e.target === toggle) return;
            checkbox.checked = !checkbox.checked;
            checkbox.dispatchEvent(new Event('change'));
        });

        wrapper.appendChild(row);
        wrapper.appendChild(childContainer);
        parent.appendChild(wrapper);

        return { wrapper, childContainer };
    }

    _addSortedCountries(container, codes, indentLevel) {
        const sorted = codes
            .map(code => ({ code, name: this.classificationData.countries[code]?.name || code }))
            .sort((a, b) => a.name.localeCompare(b.name));
        sorted.forEach(c => { this._addCountryItem(container, c.code, c.name, indentLevel); });
    }

    _addCountryItem(parent, code, name, indentLevel = 0) {
        const item = document.createElement('div');
        item.className = 'country-option';
        item.style.paddingLeft = `${8 + indentLevel * 14}px`;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'custom-checkbox';
        checkbox.dataset.country = code;
        checkbox.checked = this.selectedCountries.has(code);
        checkbox.addEventListener('change', (e) => {
            e.stopPropagation();
            if (e.target.checked) this.selectedCountries.add(code);
            else this.selectedCountries.delete(code);
            // updateSelection → _syncUI mirrors the new state onto this country's
            // checkboxes in every other group it appears in.
            this.updateSelection();
        });
        if (!this._checkboxesByCode[code]) this._checkboxesByCode[code] = [];
        const boxes = this._checkboxesByCode[code];
        // Repeat occurrences are hidden while searching (see _installSearchDedup)
        if (boxes.length) item.dataset.dup = '1';
        boxes.push(checkbox);

        const span = document.createElement('span');
        span.textContent = name;

        item.appendChild(checkbox);
        item.appendChild(span);

        item.addEventListener('click', (e) => {
            if (e.target === checkbox) return;
            checkbox.checked = !checkbox.checked;
            checkbox.dispatchEvent(new Event('change'));
        });

        parent.appendChild(item);
    }

    _syncUI() {
        const labelEl = document.getElementById(this.labelId);
        const count = this.selectedCountries.size;
        if (count === 0) {
            labelEl.textContent = this.type === 'exporter' ? 'All Exporters' : 'All Importers';
        } else if (count === 1) {
            const code = Array.from(this.selectedCountries)[0];
            const country = this.classificationData?.countries[code];
            // Drawn connections can end in economies the classification does
            // not list (e.g. MAC, NRU): fall back to the map's name for them.
            labelEl.textContent = country ? country.name : (STATE.countryNames[code] || code);
        } else {
            labelEl.textContent = `${count} economies`;
        }
        for (const [code, boxes] of Object.entries(this._checkboxesByCode)) {
            const should = this.selectedCountries.has(code);
            boxes.forEach(cb => { if (cb.checked !== should) cb.checked = should; });
        }
        this.syncGroupCheckboxes();
        const badge = document.getElementById(`${this.elementId}-count`);
        const btn   = document.getElementById(`${this.elementId}-btn`);
        if (badge) {
            badge.textContent = count;
            badge.classList.toggle('hidden', count === 0);
        }
        if (btn) {
            btn.classList.toggle('has-selection', count > 0);
        }
        const mLabel = document.getElementById(`m-${this.elementId}-label`);
        if (mLabel) mLabel.textContent = labelEl.textContent;
        const mBadge = document.getElementById(`m-${this.elementId}-count`);
        if (mBadge) {
            mBadge.textContent = count;
            mBadge.classList.toggle('hidden', count === 0);
        }
        const mBtn = document.getElementById(`m-${this.elementId}-btn`);
        if (mBtn) mBtn.classList.toggle('has-selection', count > 0);
    }

    updateSelection() {
        this._syncUI();
        document.dispatchEvent(new CustomEvent('shc:selection-change'));
    }

    setCountries(codes) {
        this.selectedCountries = new Set(codes);
        this._syncUI();
    }

    syncGroupCheckboxes() {
        document.querySelectorAll(`#${this.elementId}-list .group-checkbox`).forEach(cb => {
            const codes = cb.dataset.groupCountries.split(',');
            const selectedCount = codes.filter(c => this.selectedCountries.has(c)).length;
            cb.checked = selectedCount === codes.length;
            cb.indeterminate = selectedCount > 0 && selectedCount < codes.length;
        });
    }

    getSelectedCountries() { return Array.from(this.selectedCountries); }
    clearAll() { this.selectedCountries.clear(); this.updateSelection(); }
}

export { CountrySelector };
