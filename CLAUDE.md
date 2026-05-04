# SHC Trade Visualization — CLAUDE.md

## プロジェクト概要

UNCTAD主導の中古衣料品（HS 6309）貿易フロー可視化ダッシュボード。
UN COMTRADEデータを元に、国家間の貿易フローをアーク（弧線）付き地図で表示する。

- **本番URL**: Azure Static Web Apps（GitHub Actions経由でデプロイ）
- **開発開始**: 2026年
- **メンテナー**: UNCTAD シニアエンジニア（複数名）

---

## 現在の移行ステータス

```
Phase 1: Vite移行                      ✅ 完了
Phase 2: UNCTADブランディング + LESS化  ✅ 完了
Phase 3: ドキュメント化                  ← 次のステップ
```

### Phase 1 完了内容
- CDN依存（D3, TopoJSON, Tailwind）→ npm パッケージ化
- 全JSファイルをESモジュール化（import/export）
- `npm run build` → エラーなし、170KB JS / 28KB CSS
- `npm run dev` → HTTP 200 確認済み
- `public/` ディレクトリ作成（assets/, data/ を配置）
- CLAUDE.md 作成

---

## 技術的決定事項（変更しないこと）

| 項目 | 決定 | 理由 |
|------|------|------|
| 可視化エンジン | **D3.js v7を維持** | Highchartsはアーク描画不可 |
| バンドラー | **Vite**（webpackではない） | 設定がシンプル、DX優秀 |
| CSS | **LESSで管理（`src/styles/`）** | UNCTAD準拠 |
| Reactへの移行 | **しない** | 不要な複雑化 |
| UNCTADテンプレート | `docs/unctad-template/` を参照 | ブランディングの正式参照 |

---

## ファイル構成と責務

```
index.html              — UIレイアウト全体
src/
  config.js             — CONFIG（定数）、STATE（グローバル状態）、METRIC_FORMAT
  regions.js            — RegionConfig（地域マッピング、ISO-3コード）
  countrySelector.js    — CountrySelector クラス（輸出入国のドロップダウン）
  dataLoader.js         — DataLoader（JSON/fetch、データ加工）
  map.js                — TradeMap（D3地図描画、アーク、ズーム）
  main.js               — App（UIイベント、パネル、モーダル）エントリーポイント
  styles/
    styles.less         — エントリーポイント（他のLESSをimport）
    variables.less      — UNCTAD変数定義
    colors.less         — カラーパレット
    header.less         — ヘッダー
    kpi.less            — KPIバー
    panels.less         — サイドパネル
    insight.less        — インサイトパネル
    modals.less         — モーダル
    mobile.less         — モバイル対応
```

### 静的アセット（`public/` — Viteが配信、唯一の正源）

```
public/
  assets/
    worldmap-economies-4326.topo.json   — 地図ポリゴン（Robinson投影）
    worldmap-economies-54030.topo.json  — 地図ポリゴン（WGS84）
    unctad-icon.svg                     — UNCTADロゴ
    smep-logo.png                       — SMEPロゴ
  data/
    meta.json             — 国名・ISO・座標のマスター
    trend_summary.json    — KPI集計データ
    routes.json           — 海上輸送ルート
    bilateral_history.json — 国別二国間貿易履歴
    {2015..2024}.json     — 年別貿易フローデータ
    ports.json            — 主要港データ
    country_classification.json — 国分類（North/South）
```

### データパイプライン（`scripts/`）

```
scripts/
  process_data.py       — BACI CSVからJSONへの変換
  build_port_db.py      — 港データ構築
  generate_routes.py    — 海上ルート生成
  input/                — 生データ（.gitignore対象）
```

### ドキュメント・参照（`docs/`）

```
docs/
  Data visual branding.pdf  — UNCTADビジュアルブランディングガイドライン
  unctad-template/          — UNCTADテンプレートLESSファイル（参照用）
    colors.less, variables.less, header.less, footer.less
    templates/ header.html, footer.html
```

---

## モジュール依存関係

```
config.js (CONFIG, STATE, METRIC_FORMAT)
    └── regions.js (RegionConfig)
            └── countrySelector.js (CountrySelector)
            └── dataLoader.js (DataLoader)
                    └── map.js (TradeMap)  ← isoMapを参照
                            └── main.js (App)
```

**重要**: `dataLoader.js` は `TradeMap.isoMap` を参照する循環に近い依存あり。
Vite移行時は `state.js` に STATE/CONFIG を分離して解消する。

---

## 政治的・地理的設定（慎重に扱うこと）

以下の国・地域の扱いはUNCTAD方針に従う：

- **台湾**: 地図上に境界線を表示するが、独立国としての扱いには注意
- **パレスチナ**: UNCTAD公式スタンスに準拠
- **その他紛争地域**: `react-webpack-un-map/src/helpers/GetColor.js` の処理を参照

設定変更は必ずシニアエンジニアまたは政策担当に確認すること。

---

## 開発コマンド

```bash
# 開発サーバー起動（Vite移行後）
npm run dev

# プロダクションビルド
npm run build

# ビルド結果のプレビュー
npm run preview
```

---

## UNCTADブランディング参照（Phase 2用）

**カラーパレット**（`react-webpack-un-map/src/styles/colors.less` を参照）:
```
@unblue:   #009edb  ← メインアクセント、ボーダー
@unred:    #eb1f48
@ungreen:  #72bf44
@unyellow: #ffcb05
背景:      #f2f8fc  （現在は #F3F8FD — ほぼ同等）
```

**ヘッダー**: max-width 1200px、下部6pxボーダー `#009edb`
**フォント**: Inter（現在も使用中、変更不要）
**ロゴ**: `assets/unctad-icon.svg`（ローカル保持）

---

## 新規セッション開始時のチェックリスト

1. このファイルを読む
2. `git log --oneline -10` で直近の変更を確認
3. 現在のPhaseを確認して作業を再開する
