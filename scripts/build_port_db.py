"""
build_port_db.py
----------------
UNCTAD PLSCI と World Port Index (WPI シェープファイル) を突合し、
各国の代表港座標 DB を生成する。

入力:
  scripts/input/plsci.csv
  scripts/input/world_port_index/WPI.shp

出力:
  data/ports.json

実行:
  pip install pyshp pandas
  python scripts/build_port_db.py
"""

import io
import json
import re
import sys
from difflib import get_close_matches
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

try:
    import shapefile
except ImportError:
    sys.exit("pyshp が必要です: pip install pyshp")

try:
    import pandas as pd
except ImportError:
    sys.exit("pandas が必要です: pip install pandas")

# ── パス ──────────────────────────────────────────────────────
ROOT      = Path(__file__).parent.parent
PLSCI_CSV = Path(__file__).parent / "input" / "plsci.csv"
WPI_SHP   = Path(__file__).parent / "input" / "world_port_index" / "WPI.shp"
OUT_FILE  = ROOT / "data" / "ports.json"

# ── PLSCI 国名 → ISO3 対応表 ──────────────────────────────────
# PLSCIの表記 → ISO3（ビジュアライゼーションで使うコード）
PLSCI_COUNTRY_TO_ISO3: dict[str, str] = {
    "Albania": "ALB", "Algeria": "DZA", "American Samoa": "ASM",
    "Angola": "AGO", "Antigua and Barbuda": "ATG", "Argentina": "ARG",
    "Aruba": "ABW", "Australia": "AUS", "Bahamas": "BHS",
    "Bahrain": "BHR", "Bangladesh": "BGD", "Barbados": "BRB",
    "Belgium": "BEL", "Belize": "BLZ", "Benin": "BEN",
    "Bermuda": "BMU", "Bonaire, Sint Eustatius and Saba": "BES",
    "Brazil": "BRA", "British Virgin Islands": "VGB",
    "Brunei Darussalam": "BRN", "Bulgaria": "BGR",
    "Cabo Verde": "CPV", "Cambodia": "KHM", "Cameroon": "CMR",
    "Canada": "CAN", "Cayman Islands": "CYM", "Chile": "CHL",
    "China": "CHN", "China, Hong Kong SAR": "HKG",
    "China, Taiwan Province of": "TWN", "Colombia": "COL",
    "Comoros": "COM", "Congo": "COG", "Cook Islands": "COK",
    "Costa Rica": "CRI", "Cote d'Ivoire": "CIV", "Croatia": "HRV",
    "Cuba": "CUB", "Curacao": "CUW", "Cyprus": "CYP",
    "Dem. Rep. of the Congo": "COD", "Denmark": "DNK",
    "Djibouti": "DJI", "Dominica": "DMA", "Dominican Republic": "DOM",
    "Ecuador": "ECU", "Egypt": "EGY", "El Salvador": "SLV",
    "Equatorial Guinea": "GNQ", "Eritrea": "ERI", "Estonia": "EST",
    "Faroe Islands": "FRO", "Fiji": "FJI", "Finland": "FIN",
    "France": "FRA", "French Guiana": "GUF", "French Polynesia": "PYF",
    "Gabon": "GAB", "Gambia": "GMB", "Georgia": "GEO",
    "Germany": "DEU", "Ghana": "GHA", "Gibraltar": "GIB",
    "Greece": "GRC", "Greenland": "GRL", "Grenada": "GRD",
    "Guadeloupe": "GLP", "Guam": "GUM", "Guatemala": "GTM",
    "Guinea": "GIN", "Guinea-Bissau": "GNB", "Guyana": "GUY",
    "Haiti": "HTI", "Honduras": "HND", "Iceland": "ISL",
    "India": "IND", "Indonesia": "IDN",
    "Iran (Islamic Republic of)": "IRN", "Iraq": "IRQ",
    "Ireland": "IRL", "Israel": "ISR", "Italy": "ITA",
    "Jamaica": "JAM", "Japan": "JPN", "Jordan": "JOR",
    "Kenya": "KEN", "Kiribati": "KIR", "Kuwait": "KWT",
    "Latvia": "LVA", "Lebanon": "LBN", "Liberia": "LBR",
    "Libya": "LBY", "Lithuania": "LTU", "Madagascar": "MDG",
    "Malaysia": "MYS", "Maldives": "MDV", "Malta": "MLT",
    "Marshall Islands": "MHL", "Martinique": "MTQ",
    "Mauritania": "MRT", "Mauritius": "MUS", "Mayotte": "MYT",
    "Mexico": "MEX", "Micronesia (Federated States of)": "FSM",
    "Montenegro": "MNE", "Morocco": "MAR", "Mozambique": "MOZ",
    "Myanmar": "MMR", "Namibia": "NAM",
    "Netherlands (Kingdom of the)": "NLD", "New Caledonia": "NCL",
    "New Zealand": "NZL", "Nicaragua": "NIC", "Nigeria": "NGA",
    "Niue": "NIU", "Northern Mariana Islands": "MNP", "Norway": "NOR",
    "Oman": "OMN", "Pakistan": "PAK", "Palau": "PLW",
    "Panama": "PAN", "Papua New Guinea": "PNG", "Paraguay": "PRY",
    "Peru": "PER", "Philippines": "PHL", "Poland": "POL",
    "Portugal": "PRT", "Puerto Rico": "PRI", "Qatar": "QAT",
    "Republic of Korea": "KOR", "Reunion": "REU",
    "Romania": "ROU", "Russian Federation": "RUS",
    "Saint Helena": "SHN", "Saint Kitts and Nevis": "KNA",
    "Saint Lucia": "LCA", "Saint Pierre and Miquelon": "SPM",
    "Saint Vincent and the Grenadines": "VCT", "Samoa": "WSM",
    "Sao Tome and Principe": "STP", "Saudi Arabia": "SAU",
    "Senegal": "SEN", "Seychelles": "SYC", "Sierra Leone": "SLE",
    "Singapore": "SGP", "Sint Maarten (Dutch part)": "SXM",
    "Slovenia": "SVN", "Solomon Islands": "SLB", "Somalia": "SOM",
    "South Africa": "ZAF", "Spain": "ESP", "Sri Lanka": "LKA",
    "Sudan": "SDN", "Suriname": "SUR", "Sweden": "SWE",
    "Syrian Arab Republic": "SYR", "Thailand": "THA",
    "Timor-Leste": "TLS", "Togo": "TGO", "Tonga": "TON",
    "Trinidad and Tobago": "TTO", "Tunisia": "TUN",
    "Turkiye": "TUR", "Turks and Caicos Islands": "TCA",
    "Tuvalu": "TUV", "Ukraine": "UKR",
    "United Arab Emirates": "ARE", "United Kingdom": "GBR",
    "United Republic of Tanzania": "TZA",
    "United States": "USA", "United States Virgin Islands": "VIR",
    "Uruguay": "URY", "Vanuatu": "VUT",
    "Venezuela (Bolivarian Rep. of)": "VEN", "Viet Nam": "VNM",
    "Wallis and Futuna Islands": "WLF", "Yemen": "YEM",
    "Norfolk Island": "NFK", "Christmas Island": "CXR",
}

# ── 大国の方向別代表港（東西で海岸が異なる国）────────────────
DIRECTIONAL_PORTS: dict[str, dict] = {
    "USA": {
        "atlantic": [-74.0431,  40.6892],   # New York/Newark
        "pacific":  [-118.2167, 33.7167],   # Los Angeles
    },
    "AUS": {
        "atlantic": [151.1917, -33.8731],   # Sydney
        "pacific":  [115.8614, -31.9500],   # Fremantle
    },
    "CAN": {
        "atlantic": [-63.5698, 44.6488],    # Halifax
        "pacific":  [-123.1207, 49.2849],   # Vancouver
    },
}

# ── 内陸国の主要通過港 ────────────────────────────────────────
LANDLOCKED_GATEWAY: dict[str, tuple] = {
    # アフリカ
    "MLI": (-17.4415,  14.6928, "Port of Dakar, Senegal"),
    "BFA": ( -4.0083,   5.3600, "Port of Abidjan, Cote d'Ivoire"),
    "NER": (  2.4228,   6.3536, "Port of Cotonou, Benin"),
    "TCD": (  9.7085,   4.0592, "Port of Douala, Cameroon"),
    "CAF": (  9.7085,   4.0592, "Port of Douala, Cameroon"),
    "RWA": ( 39.6682,  -4.0435, "Port of Dar es Salaam, Tanzania"),
    "BDI": ( 39.6682,  -4.0435, "Port of Dar es Salaam, Tanzania"),
    "UGA": ( 39.6682,  -4.0435, "Port of Mombasa, Kenya"),
    "ZMB": ( 32.6167, -25.9667, "Port of Maputo, Mozambique"),
    "ZWE": ( 32.6167, -25.9667, "Port of Beira, Mozambique"),
    "MWI": ( 36.8167, -17.8667, "Port of Beira, Mozambique"),
    "LSO": ( 31.0292, -29.8579, "Port of Durban, South Africa"),
    "SWZ": ( 31.0292, -29.8579, "Port of Durban, South Africa"),
    "ETH": ( 43.1456,  11.5931, "Port of Djibouti"),
    "SSD": ( 43.1456,  11.5931, "Port of Djibouti"),
    # アジア
    "MNG": (121.4737,  31.2304, "Port of Shanghai, China"),
    "AFG": ( 67.0000,  25.0000, "Port of Karachi, Pakistan"),
    "NPL": ( 88.3639,  22.5726, "Port of Kolkata, India"),
    "BTN": ( 88.3639,  22.5726, "Port of Kolkata, India"),
    "KAZ": ( 53.0000,  36.8000, "Port of Bandar Abbas, Iran"),
    "UZB": ( 53.0000,  36.8000, "Port of Bandar Abbas, Iran"),
    "TJK": ( 53.0000,  36.8000, "Port of Bandar Abbas, Iran"),
    "KGZ": ( 53.0000,  36.8000, "Port of Bandar Abbas, Iran"),
    "TKM": ( 53.0000,  36.8000, "Port of Bandar Abbas, Iran"),
    "LAO": (103.8167,  10.2167, "Port of Ho Chi Minh City, Viet Nam"),
    # 南米
    "BOL": (-77.1211, -12.0464, "Port of Callao, Peru"),
    "PRY": (-58.3731, -34.1500, "Port of Buenos Aires, Argentina"),
    # ヨーロッパ
    "LUX": (  4.3500,  51.3333, "Port of Antwerp, Belgium"),
    "CHE": (  6.1667,  49.6167, "Port of Antwerp via Rhine"),
    "AUT": ( 14.4167,  45.6167, "Port of Koper, Slovenia"),
    "CZE": ( 14.1000,  54.3833, "Port of Szczecin, Poland"),
    "SVK": ( 14.1000,  54.3833, "Port of Szczecin, Poland"),
    "HUN": ( 14.4167,  45.6167, "Port of Koper, Slovenia"),
    "SRB": ( 14.4167,  45.6167, "Port of Koper, Slovenia"),
    "MKD": ( 22.9333,  40.6333, "Port of Thessaloniki, Greece"),
    "BLR": ( 20.9667,  55.7000, "Port of Klaipeda, Lithuania"),
    "MDA": ( 29.7500,  46.0000, "Port of Constanta, Romania"),
    "ARM": ( 41.6938,  41.6559, "Port of Batumi, Georgia"),
    # 追加：内陸国・通過港なし
    "AZE": ( 49.8700,  40.4100, "Port of Baku, Caspian Sea"),   # カスピ海港
    "BWA": ( 31.0667, -29.8667, "Port of Durban, South Africa"),
    "AND": (  2.1600,  41.3800, "Port of Barcelona, Spain"),
    "SMR": ( 12.2800,  44.4200, "Port of Ravenna, Italy"),
    "VAT": ( 11.7900,  42.0900, "Port of Civitavecchia, Italy"),
}


def load_plsci(path: Path) -> pd.DataFrame:
    """PLSCI CSVを読み込み、各国トップ港の情報を返す。"""
    df = pd.read_csv(path)

    # 値カラムを数値に変換し平均スコアを計算
    val_cols = [c for c in df.columns if c != "Port_Label"]
    df[val_cols] = df[val_cols].apply(pd.to_numeric, errors="coerce")
    df["avg_score"] = df[val_cols].mean(axis=1)

    # "Country, Port Name" を分割
    split = df["Port_Label"].str.split(",", n=1, expand=True)
    df["country_name"] = split[0].str.strip()
    df["port_name"]    = split[1].str.strip() if 1 in split.columns else ""

    # 国ごとに平均スコア最大の港を選ぶ
    top = df.loc[df.groupby("country_name")["avg_score"].idxmax()].copy()
    return top[["country_name", "port_name", "avg_score"]].reset_index(drop=True)


def load_wpi(path: Path) -> dict[str, list]:
    """
    WPI シェープファイルを読み込む。
    戻り値: { "COUNTRY_CODE|PORT_NAME_UPPER": [lon, lat] }
    """
    sf = shapefile.Reader(str(path))
    fields = [f[0] for f in sf.fields[1:]]
    idx_name = fields.index("PORT_NAME")
    idx_ctry = fields.index("COUNTRY")
    idx_lat  = fields.index("LATITUDE")
    idx_lon  = fields.index("LONGITUDE")

    wpi: dict[str, list] = {}
    for rec in sf.iterRecords():
        name = str(rec[idx_name]).strip().upper()
        ctry = str(rec[idx_ctry]).strip().upper()
        lat  = float(rec[idx_lat])
        lon  = float(rec[idx_lon])
        if name and ctry:
            wpi[f"{ctry}|{name}"] = [round(lon, 4), round(lat, 4)]
            # 港名だけでも検索できるようにする（国コード不明ケース用）
            wpi.setdefault(f"*|{name}", [round(lon, 4), round(lat, 4)])
    return wpi


def normalize(s: str) -> str:
    """マッチング用に港名を正規化する。"""
    s = s.upper()
    s = re.sub(r"[^A-Z0-9 ]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


# PLSCI 国名 → WPI 2文字コード（マッチングのみに使用）
PLSCI_TO_ISO2: dict[str, str] = {
    "Albania": "AL", "Algeria": "DZ", "American Samoa": "AS",
    "Angola": "AO", "Antigua and Barbuda": "AG", "Argentina": "AR",
    "Aruba": "AW", "Australia": "AU", "Bahamas": "BS",
    "Bahrain": "BH", "Bangladesh": "BD", "Barbados": "BB",
    "Belgium": "BE", "Belize": "BZ", "Benin": "BJ",
    "Bermuda": "BM", "Bonaire, Sint Eustatius and Saba": "BQ",
    "Brazil": "BR", "British Virgin Islands": "VG",
    "Brunei Darussalam": "BN", "Bulgaria": "BG",
    "Cabo Verde": "CV", "Cambodia": "KH", "Cameroon": "CM",
    "Canada": "CA", "Cayman Islands": "KY", "Chile": "CL",
    "China": "CN", "China, Hong Kong SAR": "HK",
    "China, Taiwan Province of": "TW", "Colombia": "CO",
    "Comoros": "KM", "Congo": "CG", "Cook Islands": "CK",
    "Costa Rica": "CR", "Cote d'Ivoire": "CI", "Croatia": "HR",
    "Cuba": "CU", "Curacao": "CW", "Cyprus": "CY",
    "Dem. Rep. of the Congo": "CD", "Denmark": "DK",
    "Djibouti": "DJ", "Dominica": "DM", "Dominican Republic": "DO",
    "Ecuador": "EC", "Egypt": "EG", "El Salvador": "SV",
    "Equatorial Guinea": "GQ", "Eritrea": "ER", "Estonia": "EE",
    "Faroe Islands": "FO", "Fiji": "FJ", "Finland": "FI",
    "France": "FR", "French Guiana": "GF", "French Polynesia": "PF",
    "Gabon": "GA", "Gambia": "GM", "Georgia": "GE",
    "Germany": "DE", "Ghana": "GH", "Gibraltar": "GI",
    "Greece": "GR", "Greenland": "GL", "Grenada": "GD",
    "Guadeloupe": "GP", "Guam": "GU", "Guatemala": "GT",
    "Guinea": "GN", "Guinea-Bissau": "GW", "Guyana": "GY",
    "Haiti": "HT", "Honduras": "HN", "Iceland": "IS",
    "India": "IN", "Indonesia": "ID",
    "Iran (Islamic Republic of)": "IR", "Iraq": "IQ",
    "Ireland": "IE", "Israel": "IL", "Italy": "IT",
    "Jamaica": "JM", "Japan": "JP", "Jordan": "JO",
    "Kenya": "KE", "Kiribati": "KI", "Kuwait": "KW",
    "Latvia": "LV", "Lebanon": "LB", "Liberia": "LR",
    "Libya": "LY", "Lithuania": "LT", "Madagascar": "MG",
    "Malaysia": "MY", "Maldives": "MV", "Malta": "MT",
    "Marshall Islands": "MH", "Martinique": "MQ",
    "Mauritania": "MR", "Mauritius": "MU", "Mayotte": "YT",
    "Mexico": "MX", "Micronesia (Federated States of)": "FM",
    "Montenegro": "ME", "Morocco": "MA", "Mozambique": "MZ",
    "Myanmar": "MM", "Namibia": "NA",
    "Netherlands (Kingdom of the)": "NL", "New Caledonia": "NC",
    "New Zealand": "NZ", "Nicaragua": "NI", "Nigeria": "NG",
    "Niue": "NU", "Northern Mariana Islands": "MP", "Norway": "NO",
    "Oman": "OM", "Pakistan": "PK", "Palau": "PW",
    "Panama": "PA", "Papua New Guinea": "PG", "Paraguay": "PY",
    "Peru": "PE", "Philippines": "PH", "Poland": "PL",
    "Portugal": "PT", "Puerto Rico": "PR", "Qatar": "QA",
    "Republic of Korea": "KR", "Reunion": "RE",
    "Romania": "RO", "Russian Federation": "RU",
    "Saint Helena": "SH", "Saint Kitts and Nevis": "KN",
    "Saint Lucia": "LC", "Saint Pierre and Miquelon": "PM",
    "Saint Vincent and the Grenadines": "VC", "Samoa": "WS",
    "Sao Tome and Principe": "ST", "Saudi Arabia": "SA",
    "Senegal": "SN", "Seychelles": "SC", "Sierra Leone": "SL",
    "Singapore": "SG", "Sint Maarten (Dutch part)": "SX",
    "Slovenia": "SI", "Solomon Islands": "SB", "Somalia": "SO",
    "South Africa": "ZA", "Spain": "ES", "Sri Lanka": "LK",
    "Sudan": "SD", "Suriname": "SR", "Sweden": "SE",
    "Syrian Arab Republic": "SY", "Thailand": "TH",
    "Timor-Leste": "TL", "Togo": "TG", "Tonga": "TO",
    "Trinidad and Tobago": "TT", "Tunisia": "TN",
    "Turkiye": "TR", "Turks and Caicos Islands": "TC",
    "Tuvalu": "TV", "Ukraine": "UA",
    "United Arab Emirates": "AE", "United Kingdom": "GB",
    "United Republic of Tanzania": "TZ",
    "United States": "US", "United States Virgin Islands": "VI",
    "Uruguay": "UY", "Vanuatu": "VU",
    "Venezuela (Bolivarian Rep. of)": "VE", "Viet Nam": "VN",
    "Wallis and Futuna Islands": "WF", "Yemen": "YE",
    "Norfolk Island": "NF", "Christmas Island": "CX",
}


def find_port_coords(country_name: str, port_name: str, wpi: dict) -> tuple | None:
    """WPI から港の座標を探す。完全一致→部分一致→ fuzzy の順で試みる。"""
    iso2    = PLSCI_TO_ISO2.get(country_name, "")
    p_norm  = normalize(port_name)

    # 1. 国コード + 完全一致
    key = f"{iso2}|{p_norm}"
    if key in wpi:
        return wpi[key], port_name, "exact"

    # 2. 国コードを絞ったうえで fuzzy マッチ
    if iso2:
        candidates = {k: v for k, v in wpi.items() if k.startswith(f"{iso2}|")}
        c_names = [k.split("|", 1)[1] for k in candidates]
        matches = get_close_matches(p_norm, c_names, n=1, cutoff=0.6)
        if matches:
            matched_key = f"{iso2}|{matches[0]}"
            return wpi[matched_key], matches[0].title(), "fuzzy"

    # 3. 全 WPI から fuzzy マッチ（国コード不明の場合）
    all_names = [k.split("|", 1)[1] for k in wpi if not k.startswith("*|")]
    matches = get_close_matches(p_norm, all_names, n=1, cutoff=0.75)
    if matches:
        matched_key = f"*|{matches[0]}"
        if matched_key in wpi:
            return wpi[matched_key], matches[0].title(), "global-fuzzy"

    return None


# ── 手動座標テーブル ──────────────────────────────────────────
# WPI に存在しない港、または fuzzy マッチが明らかに誤った港を手動修正
# { ISO3: (lon, lat, port_name) }
MANUAL_OVERRIDES: dict[str, tuple] = {
    # 未マッチ（WPI にない / 新しい港）
    "SGP": ( 103.8198,   1.2655, "Port of Singapore"),
    "NGA": (   3.3664,   6.4500, "Port of Apapa, Lagos"),
    "PER": ( -77.1493, -12.0464, "Port of Callao"),
    "BHR": (  50.5900,  26.1950, "Khalifa Bin Salman Port"),
    "KWT": (  47.9456,  29.3572, "Port of Shuwaikh"),
    "DOM": ( -69.6167,  18.4333, "Port of Caucedo"),
    "FJI": ( 178.4419, -18.1416, "Port of Suva"),
    "KHM": ( 103.5000,  10.6333, "Port of Sihanoukville"),
    "CPV": ( -24.9833,  16.8833, "Port of Mindelo"),
    "COK": (-159.7833, -21.2667, "Port of Avatiu, Rarotonga"),
    "REU": (  55.3500, -20.9333, "Port de la Reunion"),
    "SPM": ( -56.1833,  46.7833, "Port of Saint-Pierre"),
    "VCT": ( -61.2667,  13.1500, "Port of Kingstown"),
    "SHN": (  -5.7167, -15.9333, "Port of Jamestown"),
    "TUV": ( 179.1981,  -8.5243, "Port of Funafuti"),
    "VIR": ( -64.9333,  18.3333, "Port of Charlotte Amalie"),
    "WLF": (-178.1667, -14.3167, "Port of Leava, Futuna"),
    "GIB": (  -5.3540,  36.1410, "Port of Gibraltar"),
    "OMN": (  56.6833,  24.3667, "Port of Sohar"),
    "BLZ": ( -88.4000,  16.5167, "Port of Big Creek"),
    "FSM": ( 158.2167,   6.9667, "Port of Pohnpei"),
    "SYR": (  35.7667,  35.5167, "Port of Latakia"),
    # fuzzy マッチの誤修正
    "GUM": ( 144.6507,  13.4443, "Port of Apra, Guam"),
    "BRN": ( 115.0306,   4.8833, "Port of Muara, Brunei"),
    "VGB": ( -64.6200,  18.4167, "Road Town, Tortola"),
    "CRI": ( -83.0333,  10.0167, "Puerto Moin, Costa Rica"),
    "ERI": (  39.4667,  15.6000, "Port of Massawa, Eritrea"),
    # trade dataに存在するが ports 未登録の国（沿岸・島嶼・特殊領土）
    # 優先度高（貿易量あり）
    "BIH": (  17.9800,  42.9300, "Port of Neum, Bosnia Herzegovina"),
    "MAC": ( 113.5500,  22.1900, "Macao Outer Harbour"),
    # 島嶼・小領土
    "AIA": ( -63.0500,  18.2200, "Road Bay, Anguilla"),
    "BES": ( -68.2700,  12.1400, "Port of Kralendijk, Bonaire"),
    "BLM": ( -62.8500,  17.9000, "Port of Gustavia, Saint Barthelemy"),
    "ESH": ( -13.5200,  27.0900, "Port of Laayoune, Western Sahara"),
    "FLK": ( -57.8500, -51.7000, "Port Stanley, Falkland Islands"),
    "MSR": ( -62.2200,  16.7100, "Port of Plymouth, Montserrat"),
    "NRU": ( 166.9200,  -0.5300, "Port of Nauru"),
    "PRK": ( 125.3300,  38.7300, "Port of Nampo, North Korea"),
    "PSE": (  34.6500,  31.8200, "Port of Ashdod (nearest), Palestine"),
    # 事実上のデータ補完（貿易量極小・領土）
    "ATA": ( -68.3000, -54.8000, "Port of Ushuaia, Argentina (nearest)"),
    "BVT": (  5.7500, -54.4200,  "Remote island, nearest: Cape Town area"),
    "IOT": (  72.4300,  -7.3100, "Diego Garcia"),
    "TKL": (-171.8300, -13.8300, "Apia, Samoa (nearest port)"),
    "UMI": ( 144.6500,  13.4400, "Apra Harbor, Guam (nearest)"),
    # 遠隔領土（貿易量極小だがデータに存在）
    "ATF": (  70.2200, -49.3500, "Kerguelen Islands (French Southern Territories)"),
    "CCK": ( 105.6900, -10.4400, "Cocos (Keeling) Islands"),
    "PCN": (-128.3200, -24.3700, "Pitcairn Islands (nearest: Papeete)"),
    "SGS": ( -57.8500, -51.7000, "Port Stanley, Falklands (nearest to South Georgia)"),
}


def main():
    for path, label in [(PLSCI_CSV, "plsci.csv"), (WPI_SHP, "WPI.shp")]:
        if not path.exists():
            sys.exit(f"ファイルが見つかりません: {path}\n({label} を scripts/input/ に配置してください)")

    print("PLSCI を読み込み中...")
    plsci = load_plsci(PLSCI_CSV)
    print(f"  {len(plsci)} カ国のトップ港を抽出")

    print("WPI シェープファイルを読み込み中...")
    wpi = load_wpi(WPI_SHP)
    print(f"  {len(wpi)} 件の港レコードを読み込み")

    result: dict[str, dict] = {}
    unmatched: list[str] = []

    print("\n港をマッチング中...")
    for _, row in plsci.iterrows():
        country = row["country_name"]
        port    = row["port_name"]
        iso3    = PLSCI_COUNTRY_TO_ISO3.get(country)

        if not iso3:
            print(f"  [SKIP] ISO3 未定義: {country}")
            continue

        hit = find_port_coords(country, port, wpi)
        if hit:
            coords, matched_name, method = hit
            entry: dict = {
                "name":   matched_name,
                "coords": coords,
                "plsci":  round(float(row["avg_score"]), 2),
                "source": "PLSCI+WPI",
            }
            if iso3 in DIRECTIONAL_PORTS:
                entry["directional"] = DIRECTIONAL_PORTS[iso3]
            result[iso3] = entry
            flag = "✓" if method == "exact" else f"~ ({method})"
            print(f"  {iso3:4s}  {flag}  {country} / {port} → {matched_name}")
        else:
            print(f"  {iso3:4s}  ✗ マッチなし: {country} / {port}")
            unmatched.append(f"{iso3}: {country} / {port}")

    # 常に上書きが必要な追加修正（fuzzy誤マッチ対策 + 欠落補完）
    MANUAL_OVERRIDES.update({
        "GBR": (  0.4833,  51.5000, "London Gateway, UK"),
        "HKG": (114.1667,  22.2833, "Port of Hong Kong"),
        "TWN": (120.3000,  22.6167, "Port of Kaohsiung, Taiwan"),
    })

    # 内陸国テーブルの座標修正
    LANDLOCKED_GATEWAY["CHE"] = (4.4000, 51.2200, "Port of Antwerp (Rhine gateway)")

    # 手動オーバーライドを適用
    print("\n手動座標オーバーライドを適用中...")
    for iso3, (lon, lat, name) in MANUAL_OVERRIDES.items():
        entry: dict = {
            "name":   name,
            "coords": [round(lon, 4), round(lat, 4)],
            "source": "manual",
        }
        if iso3 in DIRECTIONAL_PORTS:
            entry["directional"] = DIRECTIONAL_PORTS[iso3]
        if iso3 in result:
            print(f"  {iso3}  (上書き) {result[iso3]['name']} → {name}")
        else:
            print(f"  {iso3}  (追加) {name}")
        result[iso3] = entry

    # 内陸国を追加
    print("\n内陸国の通過港を追加中...")
    for iso3, (lon, lat, desc) in LANDLOCKED_GATEWAY.items():
        if iso3 not in result:
            result[iso3] = {
                "name":    desc,
                "coords":  [round(lon, 4), round(lat, 4)],
                "source":  "landlocked-gateway",
            }
            print(f"  {iso3}  → {desc}")

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"\n完了: {len(result)} カ国 → {OUT_FILE}")
    if unmatched:
        print(f"\n未マッチ ({len(unmatched)} 件):")
        for u in unmatched:
            print(f"  {u}")


if __name__ == "__main__":
    main()
