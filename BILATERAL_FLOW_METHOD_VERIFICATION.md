# Bilateral Flow Method Verification

## 1. What each input BACI.csv row represents
Each row in the `BACI.csv` input represents a **reconciled, harmonized, directed bilateral trade flow** of HS 6309 (second-hand clothing) from a specific exporter to a specific importer for a given year.

## 2. Exact input columns used
In `scripts/process_data.py` (lines 267-296), the script maps the following exact CSV headers:
- **year**: `Year`
- **exporter**: `reporterDesc`
- **importer**: `partnerDesc`
- **trade value**: `Reporter Export To Trade Partner BACI-harmonized trade value (FOB basis, robust)`
- **weight**: ` Reporter Export to Trade partner Harmonized BACI Weight ` (Note the leading/trailing spaces in the raw header).

## 3. Input content type
The input contains **harmonized BACI estimates**. BACI is a dataset published by CEPII that has already reconciled mirror records from UN Comtrade into a single, unified estimate for each directed flow. It does not contain raw, conflicting exporter-reported vs importer-reported mirror records.

## 4. Distinguishing A to B vs B to A
For a country pair A and B, the BACI dataset treats **A exports to B** and **B exports to A** as distinct rows.
- When A exports to B: `reporterDesc` is A and `partnerDesc` is B.
- When B exports to A: `reporterDesc` is B and `partnerDesc` is A.
Because BACI is already harmonized, these represent distinct physical flows in opposite directions, not differing reports of the same flow.

## 5. Exact formula implemented
The application implements **a. true directional netting: `abs(A_to_B - B_to_A)`**.

## 6. Relevant code section in concise pseudocode
From `scripts/process_data.py` (lines 430-440):

```python
for pair in pairs:
    # A_to_B and B_to_A are summed from the BACI rows
    net = A_to_B - B_to_A
    
    if net == 0:
        continue # flow is entirely cancelled out or doesn't exist
        
    exporter = A if net > 0 else B
    importer = B if net > 0 else A
    
    netValue = round(abs(net), 2)
```

## 7. How the displayed exporter and importer are selected
The displayed exporter is always the country that exported *more* in absolute terms within the pair. The displayed importer is the country that exported *less*. The direction of the arc points from the net-positive exporter to the net-negative importer.

## 8. What happens under specific conditions
- **A_to_B > B_to_A**: `net` is positive. A is the exporter, B is the importer, value is `A_to_B - B_to_A`.
- **A_to_B < B_to_A**: `net` is negative. B is the exporter, A is the importer, value is `B_to_A - A_to_B`.
- **A_to_B == B_to_A**: `net` is exactly 0. The code executes `if net == 0: continue`, meaning the corridor is completely dropped from the yearly JSON and will not appear on the map.
- **one direction is missing**: The missing direction defaults to `0.0`. The existing direction becomes the `netValue` and dictates the flow direction.
- **one value is zero**: Same as missing. The non-zero value dictates the result.
- **a value is negative**: Handled algebraically (e.g., if `A_to_B` is 10 and `B_to_A` is -5, `net` is 15). However, BACI data does not contain negative trade values.
- **a value is missing or invalid**: The `parse_num` helper function catches parsing errors and empty strings, returning `0.0`.

## 9. Real Country Pairs (2024 BACI.csv)

### Pair 1: Afghanistan (AFG) and Japan (JPN)
- **Raw AFG to JPN**: Value = 11,543.0, Weight = 0.0
- **Raw JPN to AFG**: Value = 12,235.0, Weight = 206,192.0
- **Expected under true netting**: JPN to AFG (Value: 692.0)
- **Expected under max-direction**: JPN to AFG (Value: 12,235.0)
- **Expected under gross bilateral**: 23,778.0
- **Actual JSON result**: `{"exporter": "JPN", "importer": "AFG", "netValue": 692.0}`
- **Conclusion**: The application uses **true netting**.

### Pair 2: Afghanistan (AFG) and United Kingdom (GBR)
- **Raw AFG to GBR**: Value = 12,171.0, Weight = 634.0
- **Raw GBR to AFG**: Value = 104.0, Weight = 0.0
- **Expected under true netting**: AFG to GBR (Value: 12,067.0)
- **Expected under max-direction**: AFG to GBR (Value: 12,171.0)
- **Expected under gross bilateral**: 12,275.0
- **Actual JSON result**: `{"exporter": "AFG", "importer": "GBR", "netValue": 12067.0}`
- **Conclusion**: The application uses **true netting**.

### Pair 3: Albania (ALB) and Austria (AUT)
- **Raw ALB to AUT**: Value = 752.0, Weight = 120.0
- **Raw AUT to ALB**: Value = 14,440.0, Weight = 13,274.0
- **Expected under true netting**: AUT to ALB (Value: 13,688.0)
- **Expected under max-direction**: AUT to ALB (Value: 14,440.0)
- **Expected under gross bilateral**: 15,192.0
- **Actual JSON result**: `{"exporter": "AUT", "importer": "ALB", "netValue": 13688.0}`
- **Conclusion**: The application uses **true netting**.

## 10. Repeat for Trade Weight
Because `scripts/process_data.py` iterates over metrics independently, weight is netted identically to value. 
Using Pair 1 (AFG/JPN) from above:
- **Raw AFG to JPN Weight**: 0.0
- **Raw JPN to AFG Weight**: 206,192.0
- **Actual JSON result (`weight/2024.json`)**: `{"exporter": "JPN", "importer": "AFG", "netValue": 206192.0}`
The logic holds entirely separate for weight, meaning a corridor could theoretically flow A→B in value but B→A in weight if the balances flip.

## 11. Data usage across application features
- **`trend_summary.json`**: Uses **raw directed flows** (sum of `A_to_B` + `B_to_A` per country).
- **`bilateral_history.json`**: Uses **raw directed flows** (preserves `aToB` and `bToA` separately).
- **Yearly JSON files (`[YYYY].json`)**: Uses **netted flows**.
- **KPIs (Global Volume, #1 Exporter)**: Uses **netted flows** (sums of netted imbalances).
- **Rankings**: `#1 Exporter` and `#1 Importer` use sums of **netted flows**.
- **HHI**: Computed using **netted flows** (`src/main.js` accesses `STATE.yearCache`).
- **Country panels ("Gross Volume")**: Uses **netted flows** (highly misleading, as it sums the net balances, not true gross trade).
- **CSV exports**: `exportCountry` and `exportCorridor` use **raw directed flows** (via `bilateralHistory`). `exportFlows` and `exportSummary` use **netted flows** (via yearly JSON).

## 12. UI Labels meaning
- **Global Volume**: The sum of all *netted imbalances* for the current filter scope. It drastically undercounts true global gross volume.
- **Shown**: The sum of *netted imbalances* for only the arcs currently visible above the display threshold.
- **Bilateral**: Synonymous with Global Volume here; the total sum of *netted imbalances* before the map threshold cuts off smaller flows.
- **Export**: The dominant direction of trade after netting A and B.
- **Import**: The recessive direction of trade after netting A and B.
- **Net flow**: The mathematical difference `abs(A_to_B - B_to_A)`.
- **Corridor**: A single, netted relationship representing the trade balance between two countries.

## 13. Public methodology vs Actual code
The public methodology text in `index.html` states: 
*"For each country pair (A, B), the net flow equals the larger reported value between A→B and B→A exports."*

This is **false**. The actual code implements true mathematical netting (`abs(A_to_B - B_to_A)`), not a maximum-direction selection.

## 14. Implementation vs Documentation
The documentation explicitly claims the method is `max(A_to_B, B_to_A)`. The Python implementation is unequivocally `abs(A_to_B - B_to_A)`. 

## 15. Reconciling mirror reporting vs Subtracting distinct flows
The methodology claims this technique "reduces double-counting from mirror reporting in UN Comtrade". However, the application uses **BACI** data, which is already a harmonized dataset containing exactly one reconciled value per directed physical flow. Therefore, `A_to_B` and `B_to_A` represent economically distinct physical flows of clothing in opposite directions. 
By subtracting them, the implementation is calculating a **trade balance** (subtracting distinct flows), completely unrelated to reconciling conflicting mirror reports.

## 16. "Double counting" statistical accuracy
The term "double counting" is **statistically inaccurate** in this context. Counting both A→B and B→A is the correct way to calculate gross bilateral trade, because ships carry goods in both directions. Subtracting the recessive flow from the dominant flow erases real economic activity from the global total, rather than correcting a statistical anomaly.

## 17. Material analytical risks
1. **Severe Understatement of Global Trade**: KPIs like "Global Volume" sum trade balances instead of actual gross shipments, resulting in artificially lowered global metrics.
2. **Distorted Partner Concentration (HHI)**: The HHI is calculated using netted imbalances. A country with perfectly balanced $1 Billion bilateral trade in both directions with a partner will net to $0, completely erasing that major partner from its concentration index.
3. **Misleading "Gross Volume" Label**: The country panel labels the sum of a country's net bilateral imbalances as "Gross Volume", which is mathematically false and heavily misleading for analysts.
4. **Erased Corridors**: If `A_to_B` exactly equals `B_to_A`, the code drops the corridor entirely, deleting perfectly balanced trade from the map.

## Conclusion

The application implements **true directional netting (subtracting economically distinct opposite flows: `abs(A_to_B - B_to_A)`)**.

PROJECT_TECHNICAL_OVERVIEW.md section 10.2 is **partially correct**. (It correctly identified the mathematical netting formula `net = aToB - bToA` in the Python code, but incorrectly echoed the application's documentation that this avoids "double counting" of mirror flows, failing to identify that the input data was already harmonized distinct flows).
