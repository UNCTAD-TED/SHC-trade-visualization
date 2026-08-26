# Custom Data Integration Guide for Trade Visualization

This document outlines the exact CSV schema and data preparation rules required to replace the default dataset (e.g., Second-Hand Clothes) with a custom product dataset (e.g., Seaweed) sourced from UN Comtrade or other databases.

## 1. Target File
Your generated CSV must be saved as: `public/data/BACI.csv` (overwriting the existing file).

## 2. Required CSV Schema (Headers)
The first line of the CSV must contain the following exact column headers (case-sensitive). Do not alter these headers, as the Python processing scripts (`scripts/process_data.py`) depend on them to parse the data correctly.

| Exact CSV Header | Meaning & Expected Data | Comtrade Equivalent |
| :--- | :--- | :--- |
| `Year` | The year of the trade flow (Integer). e.g., `2024` | `Year` (or `Period`) |
| `reporterDesc` | Exporter country name (String). **Must match internal dictionary** (see Note 1). | `Reporter` |
| `partnerDesc` | Importer country name (String). **Must match internal dictionary** (see Note 1). | `Partner` |
| `Reporter Export To Trade Partner BACI-harmonized trade value (FOB basis, robust)` | Trade value in **actual USD** (Float). Do not use thousands. e.g., `12500.50` | `Trade Value (US$)` |
| ` Reporter Export to Trade partner Harmonized BACI Weight ` | Trade weight in **Kilograms** (Float). *(Note: keep the leading/trailing spaces in the header)* | `NetWeight (kg)` |
| `Reporter Latitude` | Exporter coordinate. Can safely be `0`. | (Fill with `0`) |
| `Reporter Longitude` | Exporter coordinate. Can safely be `0`. | (Fill with `0`) |
| `Partner Latitude` | Importer coordinate. Can safely be `0`. | (Fill with `0`) |
| `Partner Longitude` | Importer coordinate. Can safely be `0`. | (Fill with `0`) |

---

## 3. Critical Data Preparation Rules

### Rule 1: Country Naming Convention (Strict Match)
The script contains a hardcoded mapping dictionary (`NAME_TO_ISO`) in `scripts/process_data.py`. The country names you provide in `reporterDesc` and `partnerDesc` **must exactly match** the spelling expected by this dictionary. 
- **Correct:** `"USA"`, `"United Kingdom"`, `"Rep. of Korea"`, `"China, Hong Kong SAR"`
- **Incorrect:** `"United States of America"`, `"UK"`, `"South Korea"`, `"Hong Kong"`
*(If a country name does not match, the row will be silently ignored. You must either rename the countries in your CSV or add the new spellings to the dictionary in `process_data.py`.)*

### Rule 2: Use "Export" Flows Only
The visualization system calculates net bilateral trade by subtracting opposite flows (A→B minus B→A). If pulling data from UN Comtrade, you must filter your dataset to **only include Export flows** (`FlowCode = X` or `Flow = Export`). Do not include Import flows, otherwise the trade volume will be double-counted during the calculation.

### Rule 3: Coordinates are Required but Overridden
The 4 Latitude/Longitude columns **must exist** in the CSV to prevent the script from crashing. However, you can fill all of them with `0`. The system automatically overrides these with a hardcoded internal fallback coordinate dictionary for mapping.

---

## 4. Sample CSV Format
```csv
Year,reporterDesc,Reporter Latitude,Reporter Longitude,partnerDesc,Partner Latitude,Partner Longitude, Reporter Export to Trade partner Harmonized BACI Weight ,Reporter Export To Trade Partner BACI-harmonized trade value (FOB basis, robust)
2024,Japan,0,0,USA,0,0,15000.5,45000.0
2024,USA,0,0,Japan,0,0,2000.0,6000.0
2024,France,0,0,Germany,0,0,8500.0,20000.0
```

## 5. Next Steps
Once you have generated the `public/data/BACI.csv` file conforming to this exact structure:
1. Run `python scripts/process_data.py`
2. Run `python scripts/generate_routes.py`
3. Update the text/titles in `index.html` to reflect your new product.
