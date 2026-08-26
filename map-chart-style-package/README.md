# Map Chart Style & Classification Package

This package contains all the core files needed to build map visualizations using the UNCTAD-styled map design, color palette, TopoJSON geographic data, UNCTAD country classifications, and D3 map engine.

---

## 📁 Package Directory Structure

```
map-chart-style-package/
├── data/
│   ├── worldmap-economies-4326.topo.json    # EPSG:4326 map topojson geometry
│   ├── worldmap-economies-54030.topo.json   # EPSG:54030 map topojson geometry
│   ├── country_classification.json          # UNCTAD regional classification & grouping hierarchy
│   └── meta.json                            # ISO-3 country names & geographic coordinates [lon, lat]
├── src/
│   ├── config.js                            # Map thresholds, UNCTAD flow colors, North/South dev groups
│   ├── map.js                               # D3 map engine, UN/COMTRADE numeric ISO-3 code translation map (isoMap)
│   └── regions.js                           # Geographic region bounding boxes & groupings
└── styles/
    ├── colors.less                          # UNCTAD brand color palette variables
    ├── styles.less                          # CSS rules for land, arcs, nodes, tooltips, and halos
    └── variables.less                       # Typography, spacing, and UI layout variables
```

---

## 🌐 Country Classification & Code Mapping Summary

1. **COMTRADE / UN Numeric Code ↔ ISO-3 Alpha Code**:
   - Located in [`src/map.js`](file:///C:/Users/seitaro.taketani/OneDrive%20-%20United%20Nations/Documents/GitHub/SHC-trade-visualization%20-%20UNCTADstyled/map-chart-style-package/src/map.js) under `TradeMap.isoMap` (maps UN numeric codes like `"840"`, `"156"` to `"USA"`, `"CHN"`).

2. **UNCTAD Regional Classification**:
   - Located in [`data/country_classification.json`](file:///C:/Users/seitaro.taketani/OneDrive%20-%20United%20Nations/Documents/GitHub/SHC-trade-visualization%20-%20UNCTADstyled/map-chart-style-package/data/country_classification.json) (defines standard UNCTAD region codes e.g. Africa `5100`, Americas `5200`, Asia `5300`, Europe `5400`, Oceania `5500` and subregions).

3. **Development Classification (North / South)**:
   - Located in [`src/config.js`](file:///C:/Users/seitaro.taketani/OneDrive%20-%20United%20Nations/Documents/GitHub/SHC-trade-visualization%20-%20UNCTADstyled/map-chart-style-package/src/config.js) under `CONFIG.development` (lists Developed economies `north`, with all remaining economies defaulting to Developing/LDC `south`).
