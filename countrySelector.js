// countrySelector.js - Hierarchical country selection with collapsible groups

let _classificationCache = null;

class CountrySelector {
    constructor(elementId, labelId, type) {
        this.elementId = elementId;
        this.labelId = labelId;
        this.type = type;
        this.classificationData = null;
        this.selectedCountries = new Set();
        this.allCountries = [];
        this._checkboxByCode = {};
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
            this.allCountries = Object.keys(this.classificationData.countries)
                .map(code => ({ code, name: this.classificationData.countries[code].name }))
                .sort((a, b) => a.name.localeCompare(b.name));
        } catch (error) {
            console.error('Failed to load country classification:', error);
        }
    }

    getCountriesInRegion(regionCode) {
        return Object.keys(this.classificationData.countries).filter(code =>
            this.classificationData.countries[code].regions.includes(regionCode)
        );
    }

    buildDropdown() {
        if (!this.classificationData) return;
        const list = document.getElementById(`${this.elementId}-list`);
        if (!list) return;
        list.innerHTML = '';

        // ── Geographic Regions ────────────────────────────────────
        this._addSectionHeader(list, '🌍 Geographic Regions');
        const regionOrder = ['5100', '5200', '5300', '5400', '5500'];
        regionOrder.forEach(contCode => {
            const cont = this.classificationData.regions[contCode];
            if (!cont) return;
            const continentCountries = this.getCountriesInRegion(contCode);
            const { childContainer } = this._addGroupRow(list, {
                label: `${cont.name} (All)`,
                countries: continentCountries,
                indent: 0,
                icon: '▶',
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
        this._addSectionHeader(list, '📊 Development Status');
        ['1500', '1400', '1610'].forEach(devCode => {
            const devGroup = this.classificationData.development[devCode];
            if (!devGroup) return;
            const { childContainer } = this._addGroupRow(list, {
                label: devGroup.name,
                countries: devGroup.countries,
                indent: 0,
                icon: '▶',
            });
            this._addSortedCountries(childContainer, devGroup.countries, 1);
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
        toggle.textContent = '▶';

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
                countries.forEach(code => this.selectedCountries.add(code));
            } else {
                countries.forEach(code => this.selectedCountries.delete(code));
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
        sorted.forEach(c => this._addCountryItem(container, c.code, c.name, indentLevel));
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
            this.updateSelection();
        });
        this._checkboxByCode[code] = checkbox;

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
            labelEl.textContent = country ? country.name : code;
        } else {
            labelEl.textContent = `${count} Countries`;
        }
        for (const [code, cb] of Object.entries(this._checkboxByCode)) {
            const should = this.selectedCountries.has(code);
            if (cb.checked !== should) cb.checked = should;
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
