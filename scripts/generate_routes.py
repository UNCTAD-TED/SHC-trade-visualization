"""
generate_routes.py
------------------
data/ports.json と全年次貿易データから国ペアを収集し、
searoute で海上ルートを計算して data/routes.json に出力する。

出力: data/routes.json
  {
    "JPN|DEU": {
      "type": "Feature",
      "geometry": { "type": "LineString", "coordinates": [[lon,lat], ...] },
      "properties": { "length_km": 21504, "traversed_passages": ["suez","malacca"] }
    }, ...
  }

実行:
  pip install searoute
  python scripts/generate_routes.py
"""

import io
import json
import os
import sys
import time
from copy import copy
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

try:
    import searoute as sr
    from searoute.searoute import setup_M, setup_P
except ImportError:
    sys.exit("searoute が必要です: pip install searoute")

ROOT       = Path(__file__).parent.parent
PORTS_FILE = ROOT / "data" / "ports.json"
DATA_DIR   = ROOT / "data"
OUT_FILE   = ROOT / "data" / "routes.json"

YEAR_FILES = sorted(DATA_DIR.glob("[0-9][0-9][0-9][0-9].json"))


def get_port_coords(iso: str, ports: dict, partner_iso: str | None = None) -> list | None:
    """
    各国の代表港座標を返す。
    方向別ポート（USA/AUS/CAN）はパートナー経度で自動選択する。
    """
    entry = ports.get(iso)
    if not entry:
        return None

    if "directional" in entry and partner_iso:
        partner = ports.get(partner_iso)
        if partner:
            p_lon = partner["coords"][0]
            # パートナーが経度60°以東（アジア・大洋州）→ 太平洋岸港
            # それ以外（欧州・アフリカ・中東・アメリカ大陸）→ 大西洋岸港
            if p_lon > 60:
                return entry["directional"].get("pacific", entry["coords"])
            else:
                return entry["directional"].get("atlantic", entry["coords"])

    return entry["coords"]


def collect_pairs(ports: dict) -> set[tuple[str, str]]:
    """全年次データから実際に取引のある国ペアを収集する（方向あり）。"""
    pairs: set[tuple[str, str]] = set()
    for yfile in YEAR_FILES:
        flows = json.loads(yfile.read_text(encoding="utf-8"))
        for flow in flows:
            exp = flow.get("exporter")
            imp = flow.get("importer")
            if exp and imp and exp in ports and imp in ports:
                pairs.add((exp, imp))
    return pairs


def compute_route(origin: list, dest: list, M, P) -> dict | None:
    """searoute でルートを計算する。失敗時は None を返す。"""
    try:
        result = sr.searoute(
            origin, dest,
            M=copy(M), P=copy(P),
            units="km",
            return_passages=True,
            append_orig_dest=True,   # 出発港・到着港を端点に含める
        )
        return result
    except Exception as e:
        print(f"    [ERROR] {origin} -> {dest}: {e}")
        return None


def round_coords(routes: dict, precision: int = 3) -> dict:
    """座標を指定精度に丸めてファイルサイズを削減する（小数3桁≒約100m精度）。"""
    for feature in routes.values():
        coords = feature.get("geometry", {}).get("coordinates", [])
        feature["geometry"]["coordinates"] = [
            [round(lon, precision), round(lat, precision)]
            for lon, lat in coords
        ]
    return routes


def save(routes: dict):
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(round_coords(routes), f, ensure_ascii=False, separators=(",", ":"))


def main():
    if not PORTS_FILE.exists():
        sys.exit(f"ports.json が見つかりません。先に build_port_db.py を実行してください。")

    print("ports.json を読み込み中...")
    ports = json.loads(PORTS_FILE.read_text(encoding="utf-8"))

    print("海上ネットワークグラフをロード中...")
    t0 = time.time()
    M = setup_M()
    P = setup_P()
    print(f"  完了 ({time.time()-t0:.2f}s)")

    print("貿易データから国ペアを収集中...")
    pairs = collect_pairs(ports)
    print(f"  {len(pairs)} ペアを検出")

    # 既存の routes.json があれば読み込み（差分更新）
    routes: dict = {}
    if OUT_FILE.exists():
        routes = json.loads(OUT_FILE.read_text(encoding="utf-8"))
        print(f"  既存ルート {len(routes)} 件を読み込み（差分更新モード）")

    total   = len(pairs)
    done    = skipped = failed = 0
    t_start = time.time()

    for i, (exp, imp) in enumerate(sorted(pairs), 1):
        # 向き非依存キー（A|B と B|A を同一視）
        key = f"{min(exp,imp)}|{max(exp,imp)}"

        if key in routes:
            skipped += 1
            continue

        origin = get_port_coords(exp, ports, partner_iso=imp)
        dest   = get_port_coords(imp, ports, partner_iso=exp)

        if not origin or not dest:
            failed += 1
            continue

        # 同一座標（近隣国で港が同じになるケース）
        if abs(origin[0] - dest[0]) < 0.05 and abs(origin[1] - dest[1]) < 0.05:
            failed += 1
            continue

        route = compute_route(origin, dest, M, P)
        if route is None:
            failed += 1
            continue

        # properties を整形して保存
        props = route.get("properties", {})
        route["properties"] = {
            "length_km":          round(props.get("length", 0)),
            "traversed_passages": props.get("traversed_passages", []),
        }
        routes[key] = route
        done += 1

        # 進捗表示（50件ごと）
        if done % 50 == 0:
            elapsed  = time.time() - t_start
            remain   = (total - i) * (elapsed / i)
            passages = props.get("traversed_passages", [])
            print(f"  [{i:5d}/{total}] {exp}-{imp} | {props.get('length',0):.0f}km"
                  f" via {passages} | ETA {remain/60:.1f}min")

        # 500件ごとに中間保存
        if done % 500 == 0:
            save(routes)
            print(f"  >>> 中間保存 ({done} 件完了)")

    save(routes)

    elapsed = time.time() - t_start
    print(f"\n完了: {done} 件計算, {skipped} 件スキップ, {failed} 件失敗")
    print(f"所要時間: {elapsed/60:.1f} 分")
    print(f"出力: {OUT_FILE}")
    print(f"ファイルサイズ: {OUT_FILE.stat().st_size / 1024 / 1024:.1f} MB")


if __name__ == "__main__":
    main()
