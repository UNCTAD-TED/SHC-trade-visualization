# SNS Animation Feature — 実装チェックリスト

> ブランチ: `sns-feature` / 設計書: [sns-animation-design.md](./sns-animation-design.md)
> 
> 凡例: `[ ]` 未着手 / `[x]` 完了 / `[~]` 進行中 / `[!]` ブロック中

---

## Phase 0: 準備

- [ ] `sns-feature` ブランチで作業していることを確認（`git branch` で確認）
- [ ] `npm run dev` が正常に起動することを確認
- [ ] `docs/sns-animation-design.md` を読み設計を把握

---

## Phase 1: プロジェクト設定

### 1-1. Vite マルチエントリ設定
- [ ] `vite.config.js` を開く
- [ ] `build.rollupOptions.input` に `sns: 'sns.html'` を追加（既存の `main: 'index.html'` は残す）
- [ ] `npm run dev` 再起動して `http://localhost:5173/sns.html` が404にならないことを確認

### 1-2. エントリポイント HTML 作成
- [ ] `sns.html` を新規作成（`index.html` を参考にシンプルな骨格のみ）
  - `<div id="sns-app">` をルート要素とする
  - `<script type="module" src="/src/sns/sns.js">` を追加
  - viewport は `1920x1080` 前提、スクロールなし（`overflow: hidden`）

### 1-3. ディレクトリ作成
- [ ] `src/sns/` フォルダを作成
- [ ] 以下の空ファイルを作成:
  - `src/sns/sns.js`
  - `src/sns/snsMap.js`
  - `src/sns/snsChart.js`
  - `src/sns/iso3toIso2.js`

---

## Phase 2: データローダー実装（`src/sns/sns.js`）

### 2-1. 全年データ一括ロード
- [ ] `YEARS = [2015, 2016, ..., 2024]` の配列を定義
- [ ] `Promise.all` で全10年の JSON を並列 fetch
- [ ] `trend_summary.json` と `meta.json` も fetch
- [ ] TopoJSON（`worldmap-economies-54030.topo.json`）を fetch
- [ ] ロード中はスプラッシュ画面（UNCTADロゴ + "Loading..."）を表示
- [ ] 全ロード完了後にスプラッシュをフェードアウト

### 2-2. データフィルター
- [ ] 各年のデータから `netValue >= 1000` のフローのみ抽出（1M USD = 1000 USD千）
- [ ] フィルター済みデータを `filteredData[year]` に格納

---

## Phase 3: ISO3→国旗変換テーブル（`src/sns/iso3toIso2.js`）

- [ ] 主要貿易国（TOP20程度）の ISO3→ISO2 マッピングを作成
  - 例: `CHN→CN`, `USA→US`, `IND→IN`, `DEU→DE`, `GBR→GB` etc.
- [ ] `getFlag(iso3)` 関数を実装（ISO2が不明な場合は `'🏳'` を返す）
- [ ] `getFlag('CHN')` → `'🇨🇳'` になることをコンソールで確認

---

## Phase 4: マップ実装（`src/sns/snsMap.js`）

### 4-1. 地図ポリゴン描画
- [ ] D3 + TopoJSON で世界地図ポリゴンを描画
- [ ] 投影法: `geoNaturalEarth1`（既存と同じ）
- [ ] 陸地色: `#1e3a5f`、海洋（背景）: `#0d2137`
- [ ] 国境線: `#0a2040`（細い）

### 4-2. アーク（フロー線）描画
- [ ] `meta.json` の座標を使って国間の曲線アークを SVG path で描画
- [ ] アークの色: 既存のフローカテゴリ別配色を踏襲
  - N→S: `#009EDB` / S→N: `#72BF44` / S→S: `#FBAF17` / N→N: `#AEA29A`
- [ ] アークの太さ: `netValue` に比例（min 0.5px、max 4px）
- [ ] アークは半透明（`opacity: 0.6`）

### 4-3. トランジション（シームレス切り替え）
- [ ] D3 の key-based join を `exporter|importer` で実装
- [ ] enter（新しいアーク）: 500ms でフェードイン
- [ ] update（継続アーク）: 500ms で太さ変化
- [ ] exit（消えるアーク）: 500ms でフェードアウト
- [ ] 年切り替え時にローディング画面なしで即トランジションすることを確認

---

## Phase 5: バーチャートレース実装（`src/sns/snsChart.js`）

### 5-1. パネルレイアウト
- [ ] 右下オーバーレイのパネル（半透明背景）を作成
- [ ] 上半分: TOP 10 輸出国、下半分: TOP 10 輸入国
- [ ] パネル幅: 全体の約25%、高さ: 全体の約50%

### 5-2. バー描画
- [ ] `trend_summary.json` から当該年の輸出・輸入金額を取得
  - **注意**: `trend_summary.json` は総貿易量（輸出+輸入混在の可能性あり）。
    年次フローデータ（`2015.json` 等）を集計して輸出/輸入を分けることも検討。
- [ ] 各国のバーを DESC ソートして TOP 10 を表示
- [ ] 各行のフォーマット: `[国旗] [ISO3] [バー] [$値]`

### 5-3. バーチャートレーストランジション
- [ ] バー幅: 500ms でアニメーション変化
- [ ] ランク変化: `transform: translateY` で縦位置をアニメーション
- [ ] 値ラベル: カウントアップ（`d3.interpolateNumber`）

---

## Phase 6: アニメーションコントローラー（`src/sns/sns.js`）

- [ ] `playYear(year)` 関数を実装（マップとチャートを同時更新）
- [ ] 年インジケーター（大きな数字）を更新
- [ ] タイムラインバーの進捗点を更新
- [ ] 3秒ごとに次の年へ自動進行（`setInterval` または `requestAnimationFrame`）
- [ ] 2024年の次は 2015年に戻るループ処理
- [ ] アニメーション開始前に 0.5秒のウォームアップ（静止状態で 2015年表示）

---

## Phase 7: ヘッダーとフッター

- [ ] ヘッダー: UNCTADロゴ（左）+ タイトル "Second-Hand Clothes Trade Monitor"
- [ ] 年表示: 右上または中央に大きく（例: `[2 0 2 1]`）
- [ ] タイムラインバー: 下部に 2015〜2024 の進捗を表示
- [ ] フッター: データソース表記（"Source: BACI, CEPII"）

---

## Phase 8: スタイリング

- [ ] 全体背景: `#0a1628`（ダークネイビー）
- [ ] テキスト: `#ffffff`
- [ ] バーチャートパネル: `rgba(0, 10, 30, 0.75)` + `border: 1px solid rgba(255,255,255,0.1)`
- [ ] フォント: `font-family: 'Roboto', sans-serif` または既存と同じ
- [ ] `overflow: hidden` で 1920x1080 に収める

---

## Phase 9: 動作確認

- [ ] `npm run dev` で `http://localhost:5173/sns.html` を開く
- [ ] スプラッシュ画面が表示されロードが完了する
- [ ] 2015年の地図とバーチャートが正しく表示される
- [ ] 3秒後に 2016年へ自動遷移し、アークがスムーズに変化する
- [ ] バーチャートのランク順位変化がアニメーションで表示される
- [ ] 2024年から 2015年にループして戻る
- [ ] 既存の `http://localhost:5173/` が正常に動作することを確認（リグレッション）

---

## Phase 10: ビルドと録画

- [ ] `npm run build` でエラーなくビルド完了
- [ ] ブラウザウィンドウを 1920×1080 に設定
- [ ] OBS または Windows ゲームバー（Win+G）で録画テスト
- [ ] 30秒の動画として書き出し確認

---

## メモ・注意事項

- `trend_summary.json` のデータ構造を確認すること。輸出のみ/輸入のみ/合計のどれかによって Phase 5-2 の集計方法が変わる。
- `meta.json` に ISO2 コードは含まれていないため、`iso3toIso2.js` の変換テーブルは手動で作成が必要。
- 既存の `src/main.js` `src/map.js` 等は**一切変更しない**。
- `vite.config.js` の変更のみ既存コードへの影響がある（ビルドテストで確認）。
