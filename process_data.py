"""
Pre-process BACI.csv into static JSON files consumed by the frontend.

Outputs (in data/):
  [YYYY].json          — pre-computed net flows for each year
  trend_summary.json   — per-country gross trade volume per year
  bilateral_history.json — raw bilateral (directional) flows per pair per year
  meta.json            — country coordinates and display names
"""

import csv
import json
import os
from collections import defaultdict

# ---------------------------------------------------------------------------
# CONFIG: mirrors CONFIG.development from config.js
# ---------------------------------------------------------------------------
DEVELOPMENT = {
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
    'AUS': 'north', 'NZL': 'north', 'JPN': 'north', 'KOR': 'north',
}

# ---------------------------------------------------------------------------
# NAME → ISO mapping: mirrors DataLoader.nameToISO from dataLoader.js
# ---------------------------------------------------------------------------
NAME_TO_ISO = {
    "Afghanistan": "AFG", "Albania": "ALB", "Algeria": "DZA",
    "American Samoa": "ASM", "Andorra": "AND", "Angola": "AGO",
    "Anguilla": "AIA", "Antarctica": "ATA", "Antigua and Barbuda": "ATG",
    "Argentina": "ARG", "Armenia": "ARM", "Aruba": "ABW",
    "Australia": "AUS", "Austria": "AUT", "Azerbaijan": "AZE",
    "Bahamas": "BHS", "Bahrain": "BHR", "Bangladesh": "BGD",
    "Barbados": "BRB", "Belarus": "BLR", "Belgium": "BEL",
    "Belize": "BLZ", "Benin": "BEN", "Bermuda": "BMU",
    "Bhutan": "BTN", "Bolivia (Plurinational State of)": "BOL",
    "Bonaire": "BES", "Bosnia Herzegovina": "BIH", "Botswana": "BWA",
    "Bouvet Island": "BVT", "Br. Indian Ocean Terr.": "IOT",
    "Br. Virgin Isds": "VGB", "Brazil": "BRA", "Brunei Darussalam": "BRN",
    "Bulgaria": "BGR", "Burkina Faso": "BFA", "Burundi": "BDI",
    "Cabo Verde": "CPV", "Cambodia": "KHM", "Cameroon": "CMR",
    "Canada": "CAN", "Cayman Isds": "CYM", "Central African Rep.": "CAF",
    "Chad": "TCD", "Chile": "CHL", "China": "CHN",
    "China, Hong Kong SAR": "HKG", "China, Macao SAR": "MAC",
    "Christmas Isds": "CXR", "Cocos Isds": "CCK", "Colombia": "COL",
    "Comoros": "COM", "Congo": "COG", "Cook Isds": "COK",
    "Costa Rica": "CRI", "Croatia": "HRV", "Cuba": "CUB",
    "Cyprus": "CYP", "Czechia": "CZE",
    "Dem. People's Rep. of Korea": "PRK",
    "Dem. Rep. of the Congo": "COD",
    "Denmark": "DNK", "Djibouti": "DJI", "Dominica": "DMA",
    "Dominican Rep.": "DOM", "Ecuador": "ECU", "Egypt": "EGY",
    "El Salvador": "SLV", "Equatorial Guinea": "GNQ", "Eritrea": "ERI",
    "Estonia": "EST", "Eswatini": "SWZ", "Ethiopia": "ETH",
    "FS Micronesia": "FSM", "Falkland Isds (Malvinas)": "FLK",
    "Faroe Isds": "FRO", "Fiji": "FJI", "Finland": "FIN",
    "Fr. South Antarctic Terr.": "ATF", "France": "FRA",
    "French Polynesia": "PYF", "Gabon": "GAB", "Gambia": "GMB",
    "Georgia": "GEO", "Germany": "DEU", "Ghana": "GHA",
    "Gibraltar": "GIB", "Greece": "GRC", "Greenland": "GRL",
    "Grenada": "GRD", "Guam": "GUM", "Guatemala": "GTM",
    "Guinea": "GIN", "Guinea-Bissau": "GNB", "Guyana": "GUY",
    "Haiti": "HTI", "Holy See (Vatican City State)": "VAT",
    "Honduras": "HND", "Hungary": "HUN", "Iceland": "ISL",
    "India": "IND", "Indonesia": "IDN", "Iran": "IRN",
    "Iraq": "IRQ", "Ireland": "IRL", "Israel": "ISR",
    "Italy": "ITA", "Jamaica": "JAM", "Japan": "JPN",
    "Jordan": "JOR", "Kazakhstan": "KAZ", "Kenya": "KEN",
    "Kiribati": "KIR", "Kuwait": "KWT", "Kyrgyzstan": "KGZ",
    "Lao People's Dem. Rep.": "LAO",
    "Latvia": "LVA", "Lebanon": "LBN", "Lesotho": "LSO",
    "Liberia": "LBR", "Libya": "LBY", "Lithuania": "LTU",
    "Luxembourg": "LUX", "Madagascar": "MDG", "Malawi": "MWI",
    "Malaysia": "MYS", "Maldives": "MDV", "Mali": "MLI",
    "Malta": "MLT", "Marshall Isds": "MHL", "Mauritania": "MRT",
    "Mauritius": "MUS", "Mexico": "MEX", "Mongolia": "MNG",
    "Montenegro": "MNE", "Montserrat": "MSR", "Morocco": "MAR",
    "Mozambique": "MOZ", "Myanmar": "MMR", "N. Mariana Isds": "MNP",
    "Namibia": "NAM", "Nauru": "NRU", "Nepal": "NPL",
    "Netherlands": "NLD", "New Caledonia": "NCL", "New Zealand": "NZL",
    "Nicaragua": "NIC", "Niger": "NER", "Nigeria": "NGA",
    "Niue": "NIU", "Norfolk Isds": "NFK", "North Macedonia": "MKD",
    "Norway": "NOR", "Oman": "OMN", "Pakistan": "PAK",
    "Palau": "PLW", "Panama": "PAN", "Papua New Guinea": "PNG",
    "Paraguay": "PRY", "Peru": "PER", "Philippines": "PHL",
    "Pitcairn": "PCN", "Poland": "POL", "Portugal": "PRT",
    "Qatar": "QAT", "Rep. of Korea": "KOR", "Rep. of Moldova": "MDA",
    "Romania": "ROU", "Russian Federation": "RUS", "Rwanda": "RWA",
    "Saint Helena": "SHN", "Saint Kitts and Nevis": "KNA",
    "Saint Lucia": "LCA", "Saint Pierre and Miquelon": "SPM",
    "Saint Vincent and the Grenadines": "VCT", "Samoa": "WSM",
    "San Marino": "SMR", "Sao Tome and Principe": "STP",
    "Saudi Arabia": "SAU", "Senegal": "SEN", "Serbia": "SRB",
    "Seychelles": "SYC", "Sierra Leone": "SLE", "Singapore": "SGP",
    "Sint Maarten": "SXM", "Slovakia": "SVK", "Slovenia": "SVN",
    "Solomon Isds": "SLB", "Somalia": "SOM", "South Africa": "ZAF",
    "South Georgia and the South Sandwich Islands": "SGS",
    "South Sudan": "SSD", "Spain": "ESP", "Sri Lanka": "LKA",
    "State of Palestine": "PSE", "Sudan": "SDN", "Suriname": "SUR",
    "Sweden": "SWE", "Switzerland": "CHE", "Syria": "SYR",
    "Tajikistan": "TJK", "Thailand": "THA", "Timor-Leste": "TLS",
    "Togo": "TGO", "Tokelau": "TKL", "Tonga": "TON",
    "Trinidad and Tobago": "TTO", "Tunisia": "TUN",
    "Turkmenistan": "TKM", "Turks and Caicos Isds": "TCA",
    "Tuvalu": "TUV", "USA": "USA", "Uganda": "UGA",
    "Ukraine": "UKR", "United Arab Emirates": "ARE",
    "United Kingdom": "GBR", "United Rep. of Tanzania": "TZA",
    "United States Minor Outlying Islands": "UMI",
    "Uruguay": "URY", "Uzbekistan": "UZB", "Vanuatu": "VUT",
    "Venezuela": "VEN", "Viet Nam": "VNM",
    "Wallis and Futuna Isds": "WLF", "Western Sahara": "ESH",
    "Yemen": "YEM", "Zambia": "ZMB", "Zimbabwe": "ZWE",
    # Encoding-mangled forms (as may appear in the CSV)
    "T¸rkiye": "TUR", "CuraÁao": "CUW",
    "CÙte d'Ivoire": "CIV", "Saint BarthÈlemy": "BLM",
    # Clean Unicode fallbacks
    "Türkiye": "TUR", "Curaçao": "CUW",
    "Côte d'Ivoire": "CIV", "Saint Barthélemy": "BLM",
}

# Fallback coordinates: mirrors DataLoader.fallbackData from dataLoader.js
# These always override CSV-derived coords (same behaviour as JS).
FALLBACK = {
    "AGO": {"name": "Angola",                   "coords": [17.87, -11.20]},
    "ARM": {"name": "Armenia",                  "coords": [45.03, 40.06]},
    "ATG": {"name": "Antigua and Barbuda",       "coords": [-61.79, 17.06]},
    "AUS": {"name": "Australia",                "coords": [133.77, -25.27]},
    "AUT": {"name": "Austria",                  "coords": [14.55, 47.51]},
    "AZE": {"name": "Azerbaijan",               "coords": [47.57, 40.14]},
    "BEL": {"name": "Belgium",                  "coords": [4.46, 50.50]},
    "BHR": {"name": "Bahrain",                  "coords": [50.55, 26.06]},
    "BHS": {"name": "Bahamas",                  "coords": [-77.39, 25.03]},
    "BIH": {"name": "Bosnia and Herzegovina",   "coords": [17.67, 43.91]},
    "BMU": {"name": "Bermuda",                  "coords": [-64.75, 32.30]},
    "BOL": {"name": "Bolivia",                  "coords": [-63.58, -16.29]},
    "BRA": {"name": "Brazil",                   "coords": [-51.92, -14.23]},
    "GRD": {"name": "Grenada",                  "coords": [-61.60, 12.11]},
    "HKG": {"name": "Hong Kong",                "coords": [114.16, 22.31]},
    "MAC": {"name": "Macau",                    "coords": [113.54, 22.19]},
    "MDV": {"name": "Maldives",                 "coords": [73.22, 3.20]},
    "MLT": {"name": "Malta",                    "coords": [14.37, 35.93]},
    "MUS": {"name": "Mauritius",                "coords": [57.55, -20.34]},
    "SGP": {"name": "Singapore",                "coords": [103.81, 1.35]},
    "ALB": {"name": "Albania",                  "coords": [20.17, 41.15]},
    "BLZ": {"name": "Belize",                   "coords": [-88.49, 17.18]},
    "CYM": {"name": "Cayman Islands",           "coords": [-81.26, 19.32]},
    "MSR": {"name": "Montserrat",               "coords": [-62.18, 16.74]},
    "SYC": {"name": "Seychelles",               "coords": [55.49, -4.68]},
    "WSM": {"name": "Samoa",                    "coords": [-172.10, -13.75]},
    "ABW": {"name": "Aruba",                    "coords": [-69.97, 12.52]},
    "AFG": {"name": "Afghanistan",              "coords": [67.71, 33.94]},
    "AND": {"name": "Andorra",                  "coords": [1.52, 42.51]},
    "ARG": {"name": "Argentina",                "coords": [-63.62, -38.42]},
    "ASM": {"name": "American Samoa",           "coords": [-170.13, -14.27]},
    "ATA": {"name": "Antarctica",               "coords": [0.00, -82.86]},
    "BES": {"name": "Bonaire, Sint Eustatius and Saba", "coords": [-68.27, 12.14]},
    "BGD": {"name": "Bangladesh",               "coords": [90.36, 23.68]},
    "BLM": {"name": "Saint Barthélemy",   "coords": [-62.83, 17.90]},
    "BRB": {"name": "Barbados",                 "coords": [-59.54, 13.19]},
    "BRN": {"name": "Brunei Darussalam",        "coords": [114.73, 4.53]},
    "BTN": {"name": "Bhutan",                   "coords": [90.43, 27.51]},
    "BWA": {"name": "Botswana",                 "coords": [24.68, -22.33]},
    "COK": {"name": "Cook Islands",             "coords": [-159.78, -21.24]},
    "CPV": {"name": "Cabo Verde",               "coords": [-24.01, 16.00]},
    "CUW": {"name": "Curaçao",            "coords": [-68.99, 12.17]},
    "DMA": {"name": "Dominica",                 "coords": [-61.37, 15.41]},
    "DZA": {"name": "Algeria",                  "coords": [1.66, 28.03]},
    "FRO": {"name": "Faroe Islands",            "coords": [-6.91, 61.89]},
    "FSM": {"name": "Micronesia (Federated States of)", "coords": [150.55, 7.42]},
    "GIB": {"name": "Gibraltar",               "coords": [-5.35, 36.14]},
    "GUM": {"name": "Guam",                    "coords": [144.79, 13.44]},
    "IOT": {"name": "British Indian Ocean Territory", "coords": [71.88, -6.34]},
    "KIR": {"name": "Kiribati",                "coords": [-168.73, -3.37]},
    "KNA": {"name": "Saint Kitts and Nevis",   "coords": [-62.78, 17.36]},
    "LCA": {"name": "Saint Lucia",             "coords": [-60.98, 13.91]},
    "MHL": {"name": "Marshall Islands",        "coords": [171.18, 7.13]},
    "MNP": {"name": "Northern Mariana Islands","coords": [145.67, 15.09]},
    "NIU": {"name": "Niue",                    "coords": [-169.87, -19.05]},
    "NRU": {"name": "Nauru",                   "coords": [166.93, -0.52]},
    "PLW": {"name": "Palau",                   "coords": [134.58, 7.51]},
    "PYF": {"name": "French Polynesia",        "coords": [-149.41, -17.68]},
    "SLB": {"name": "Solomon Islands",         "coords": [160.16, -9.65]},
    "STP": {"name": "Sao Tome and Principe",   "coords": [6.61, 0.19]},
    "SXM": {"name": "Sint Maarten",            "coords": [-63.06, 18.04]},
    "TCA": {"name": "Turks and Caicos Islands","coords": [-71.79, 21.69]},
    "TON": {"name": "Tonga",                   "coords": [-175.20, -21.18]},
    "TUV": {"name": "Tuvalu",                  "coords": [179.14, -7.11]},
    "VCT": {"name": "Saint Vincent and the Grenadines", "coords": [-61.29, 12.98]},
    "VGB": {"name": "British Virgin Islands",  "coords": [-64.64, 18.42]},
    "WLF": {"name": "Wallis and Futuna",       "coords": [-177.16, -13.76]},
    "AIA": {"name": "Anguilla",                "coords": [-63.06, 18.22]},
    "ATF": {"name": "French Southern Territories", "coords": [69.35, -49.28]},
    "CXR": {"name": "Christmas Island",        "coords": [105.69, -10.44]},
    "FLK": {"name": "Falkland Islands",        "coords": [-59.52, -51.79]},
    "PSE": {"name": "Palestine",               "coords": [35.23, 31.95]},
    "SHN": {"name": "Saint Helena",            "coords": [-5.70, -15.96]},
    "FRA": {"name": "France",                  "coords": [2.21, 46.22]},
    "SPM": {"name": "Saint Pierre and Miquelon", "coords": [-56.37, 46.88]},
}

SPECIAL = frozenset([
    'Bunkers', 'Free Zones', 'LAIA, nes',
    'Oceania, nes', 'Other Asia, nes', 'Special Categories',
])

EXPORT_VALUE_COL = 'Reporter Export To Trade Partner BACI-harmonized trade value (FOB basis, robust)'

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def parse_num(s):
    if not s:
        return 0.0
    s = s.strip()
    if not s or set(s) <= {'-', ' '}:
        return 0.0
    try:
        return float(s.replace(',', ''))
    except ValueError:
        return 0.0


def flow_category(exp_iso, imp_iso):
    exp_dev = DEVELOPMENT.get(exp_iso, 'south')
    imp_dev = DEVELOPMENT.get(imp_iso, 'south')
    if exp_dev == 'north' and imp_dev == 'south':
        return 'north-south'
    if exp_dev == 'south' and imp_dev == 'north':
        return 'south-north'
    if exp_dev == 'south' and imp_dev == 'south':
        return 'south-south'
    return 'north-north'


# ---------------------------------------------------------------------------
# Read CSV
# ---------------------------------------------------------------------------
print("Reading BACI.csv …")
records = []     # [{year, exporter, importer, value}]
csv_coords = {}  # iso -> [lon, lat]  (first occurrence wins)
csv_names = {}   # iso -> display name

csv_path = os.path.join('data', 'BACI.csv')

with open(csv_path, newline='', encoding='utf-8-sig') as f:
    raw = csv.reader(f)
    raw_headers = next(raw)
    headers = [h.strip() for h in raw_headers]
    # Find the index of the export value column
    try:
        val_idx = headers.index(EXPORT_VALUE_COL)
    except ValueError:
        # Case-insensitive fallback
        val_idx = next(
            i for i, h in enumerate(headers)
            if 'baci-harmonized trade value' in h.lower() and 'fob basis' in h.lower()
        )

    year_idx      = headers.index('Year')
    reporter_idx  = headers.index('reporterDesc')
    partner_idx   = headers.index('partnerDesc')
    r_lat_idx     = headers.index('Reporter Latitude')
    r_lon_idx     = headers.index('Reporter Longitude')
    p_lat_idx     = headers.index('Partner Latitude')
    p_lon_idx     = headers.index('Partner Longitude')

    for row in raw:
        if len(row) < len(headers):
            continue
        partner = row[partner_idx].strip()
        if not partner or partner in SPECIAL:
            continue
        reporter = row[reporter_idx].strip()

        exp_iso = NAME_TO_ISO.get(reporter, '_X')
        imp_iso = NAME_TO_ISO.get(partner,  '_X')
        if exp_iso == '_X' or imp_iso == '_X':
            continue

        # Collect coordinates (first non-zero occurrence wins)
        try:
            r_lat = float(row[r_lat_idx])
            r_lon = float(row[r_lon_idx])
            if r_lat != 0 and r_lon != 0 and exp_iso not in csv_coords:
                csv_coords[exp_iso] = [round(r_lon, 6), round(r_lat, 6)]
        except (ValueError, IndexError):
            pass
        try:
            p_lat = float(row[p_lat_idx])
            p_lon = float(row[p_lon_idx])
            if p_lat != 0 and p_lon != 0 and imp_iso not in csv_coords:
                csv_coords[imp_iso] = [round(p_lon, 6), round(p_lat, 6)]
        except (ValueError, IndexError):
            pass

        if exp_iso not in csv_names:
            csv_names[exp_iso] = reporter
        if imp_iso not in csv_names:
            csv_names[imp_iso] = partner

        value = parse_num(row[val_idx])
        if value <= 0:
            continue

        try:
            year = int(row[year_idx])
        except ValueError:
            continue

        records.append({'year': year, 'exporter': exp_iso, 'importer': imp_iso, 'value': value})

print(f"  {len(records):,} valid records loaded")

# ---------------------------------------------------------------------------
# Build meta.json
# ---------------------------------------------------------------------------
print("Building meta.json …")

# Start with CSV-derived coords/names, then let fallback always override coords
merged_coords = dict(csv_coords)
merged_names  = dict(csv_names)

for iso, fb in FALLBACK.items():
    merged_coords[iso] = fb['coords']          # always override (matches JS)
    if iso not in merged_names:
        merged_names[iso] = fb['name']

# Combine into meta: only export entries that have both coords and name
meta = {}
all_isos = set(merged_coords.keys()) | set(merged_names.keys())
for iso in all_isos:
    if iso in merged_coords and iso in merged_names:
        meta[iso] = {'name': merged_names[iso], 'coords': merged_coords[iso]}

with open(os.path.join('data', 'meta.json'), 'w', encoding='utf-8') as f:
    json.dump(meta, f, ensure_ascii=False, separators=(',', ':'))
print(f"  meta.json: {len(meta)} countries")

# ---------------------------------------------------------------------------
# Build trend_summary.json
# ---------------------------------------------------------------------------
print("Building trend_summary.json …")

# For each record, add the export value to BOTH sides (exporter and importer),
# mirroring the JS pattern:  if (d.exporter===iso || d.importer===iso) total += d.value
trend = defaultdict(lambda: defaultdict(float))
for r in records:
    y = str(r['year'])
    trend[r['exporter']][y] += r['value']
    trend[r['importer']][y] += r['value']

trend_out = {iso: dict(years) for iso, years in trend.items()}
with open(os.path.join('data', 'trend_summary.json'), 'w', encoding='utf-8') as f:
    json.dump(trend_out, f, ensure_ascii=False, separators=(',', ':'))
print(f"  trend_summary.json: {len(trend_out)} countries")

# ---------------------------------------------------------------------------
# Build per-year net flow JSONs + bilateral_history.json
# ---------------------------------------------------------------------------
print("Building per-year net flow JSONs and bilateral_history.json …")

# Group records by year
by_year = defaultdict(list)
for r in records:
    by_year[r['year']].append(r)

# bilateral_history: { "A|B" (A <= B lex): { "YYYY": { "aToB": ..., "bToA": ... } } }
bilateral = defaultdict(lambda: defaultdict(lambda: {'aToB': 0.0, 'bToA': 0.0}))

for year, yr_records in sorted(by_year.items()):
    # Accumulate into pair map for net flow, and into bilateral for history
    pair_map = {}  # key -> {a, b, aToB, bToA}

    for r in yr_records:
        exp, imp, val = r['exporter'], r['importer'], r['value']
        a, b = sorted([exp, imp])
        key = f"{a}|{b}"

        # Net flow pair map
        if key not in pair_map:
            pair_map[key] = {'a': a, 'b': b, 'aToB': 0.0, 'bToA': 0.0}
        if exp == a:
            pair_map[key]['aToB'] += val
        else:
            pair_map[key]['bToA'] += val

        # Bilateral history
        y_str = str(year)
        if exp == a:
            bilateral[key][y_str]['aToB'] += val
        else:
            bilateral[key][y_str]['bToA'] += val

    # Compute net flows for this year
    flows = []
    for key, p in pair_map.items():
        net = p['aToB'] - p['bToA']
        if net == 0:
            continue
        exporter = p['a'] if net > 0 else p['b']
        importer = p['b'] if net > 0 else p['a']
        net_value = abs(net)
        flows.append({
            'exporter':     exporter,
            'importer':     importer,
            'netValue':     round(net_value, 2),
            'flowCategory': flow_category(exporter, importer),
        })

    out_path = os.path.join('data', f'{year}.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(flows, f, ensure_ascii=False, separators=(',', ':'))
    print(f"  {year}.json: {len(flows)} net flows")

# Write bilateral_history.json
bilateral_out = {k: dict(v) for k, v in bilateral.items()}
with open(os.path.join('data', 'bilateral_history.json'), 'w', encoding='utf-8') as f:
    json.dump(bilateral_out, f, ensure_ascii=False, separators=(',', ':'))
print(f"  bilateral_history.json: {len(bilateral_out)} country pairs")

print("\nDone. All JSON files written to data/")
