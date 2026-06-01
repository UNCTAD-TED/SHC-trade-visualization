# SNS Animation Feature — 設計書

> ブランチ: `sns-feature` / 作成日: 2026-06-01

---

## 1. 概要

既存のダッシュボードとは**独立した新規ページ**として、SNS投稿用のアニメーション動画を生成する。
UIコントロール（フィルター・ボタン類）を排除し、2015〜2024年の貿易フローをマップとバーチャートレースで自動再生する。

**想定用途**: OBS等でブラウザを画面録画 → SNS（LinkedIn / Twitter-X / YouTube Shorts）に投稿

---

## 2. レイアウト

### 2.1 全体構成（16:9 横型）

```
┌──────────────────────────────────────────────────────────────┐
│  [UNCTAD ロゴ]   Second-Hand Clothes Trade Monitor           │
│                                                              │
│                                                              │
│                    世界地図（メイン）                         │
│              アーク: 1M USD以上の貿易フローのみ               │
│                                                    ┌───────┐ │
│                                                    │ ▲ TOP │ │
│                                                    │EXPORT │ │
│                                                    │🇨🇳CHN│ │
│                                                    │ ████  │ │
│                                                    ├───────┤ │
│                                                    │ ▼ TOP │ │
│                                                    │IMPORT │ │
│                                                    │🇮🇳IND│ │
│                                                    │ ████  │ │
│                                                    └───────┘ │
│  2015 ━━━━━━━━━━━━━━━━━━━━━━━●━━━━━━━━━━━━━━━━━━ 2024      │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 面積比率（目安）

| エリア | 幅 | 高さ |
|--------|-----|------|
| 地図 | 100% | 約85% |
| バーチャートパネル（右下オーバーレイ） | 約25% | 約50% |
| ヘッダー | 100% | 約7% |
| タイムラインバー | 100% | 約8% |

### 2.3 バーチャートパネル詳細

- 半透明の背景（`rgba(0,0,0,0.65)`）でマップに重ねる
- 輸出 TOP 5〜10 / 輸入 TOP 5〜10（画面サイズで調整）
- 各行: `[国旗絵文字] [ISO3] [バー] [$値]`
- バーの色: 輸出は青系 `#009EDB`、輸入は緑系 `#72BF44`

---

## 3. データアーキテクチャ

### 3.1 利用するデータファイル

| ファイル | 用途 |
|----------|------|
| `public/data/2015.json` 〜 `2024.json` | マップアーク描画（フロー別） |
| `public/data/trend_summary.json` | バーチャートレース（国別年次総量） |
| `public/data/meta.json` | 国名・座標（ISO3→名前変換） |
| `public/assets/worldmap-economies-54030.topo.json` | 地図ポリゴン |

### 3.2 起動時一括ロード（シームレスアニメーションの核心）

```
現状ダッシュボード: 年切り替え → fetch → ローディング画面 → 描画
SNS版:             起動時に全10年分を一括fetch → メモリに保持
                   年切り替え → データはすでにメモリにある → 即トランジション
```

```js
// 疑似コード
const allYearData = {};
await Promise.all(
  YEARS.map(y => fetch(`/data/${y}.json`).then(r => r.json())
    .then(d => allYearData[y] = d))
);
```

### 3.3 データフィルター

- **閾値**: 1,000,000 USD以上のフローのみ（`netValue >= 1000`、単位はUSD千）
- **フロー種別**: 全4種類（N→S / S→N / S→S / N→N）をすべて表示

---

## 4. アニメーション設計

### 4.1 タイムライン

```
[起動・ロード中]  スプラッシュ画面（UNCTADロゴ + プログレスバー）
[ロード完了]      2015年の状態を表示し、0.5秒後に自動再生開始
[各年]            表示 2.5秒 + トランジション 0.5秒 = 1年あたり 3秒
[2024完了]        3秒静止後、2015に戻りループ（またはフェードアウトで停止）
```

**合計尺**: 約30秒（10年 × 3秒）

### 4.2 マップトランジション（D3 key-based join）

```js
// exporter|importer をキーとして D3 がどのアークが同一か判断できる
const arcs = svg.selectAll('.arc')
  .data(filteredFlows, d => `${d.exporter}|${d.importer}`);

arcs.enter()  // 新しいアーク → フェードイン
  .attr('opacity', 0).transition().duration(500).attr('opacity', 0.7);

arcs           // 継続するアーク → 太さ変化
  .transition().duration(500).attr('stroke-width', d => widthScale(d.netValue));

arcs.exit()   // 消えるアーク → フェードアウト
  .transition().duration(500).attr('opacity', 0).remove();
```

### 4.3 バーチャートレーストランジション

- 値の変化: バー幅を `transition().duration(500)` でアニメーション
- ランク変化: `transform: translateY()` で縦位置を滑らかに移動
- 値ラベル: カウントアップアニメーション（d3-interpolate）

---

## 5. 国旗絵文字の実装

### 5.1 仕組み

Unicode の国旗絵文字は **ISO 3166-1 alpha-2（2文字コード）** から生成。
`meta.json` は ISO3 コードのみのため、ISO3→ISO2 の変換テーブルが必要。

### 5.2 変換方法

```js
const ISO3_TO_ISO2 = {
  'CHN': 'CN', 'USA': 'US', 'IND': 'IN', 'DEU': 'DE',
  'GBR': 'GB', 'KOR': 'KR', 'JPN': 'JP', 'FRA': 'FR',
  // ... 主要貿易国約50カ国をカバー
};

function getFlag(iso3) {
  const iso2 = ISO3_TO_ISO2[iso3];
  if (!iso2) return '🏳';
  return iso2.split('').map(c =>
    String.fromCodePoint(c.charCodeAt(0) + 127397)
  ).join('');
}
```

---

## 6. ファイル構成

```
SHC-trade-visualization/
├── sns.html                    ← 新規: SNS専用エントリポイント
├── src/
│   └── sns/
│       ├── sns.js              ← 新規: メイン（ローダー・アニメーションループ）
│       ├── snsMap.js           ← 新規: マップ描画（map.jsからD3ロジックを参照）
│       ├── snsChart.js         ← 新規: バーチャートレース
│       └── iso3toIso2.js       ← 新規: 変換テーブル
├── vite.config.js              ← 変更: マルチエントリポイント追加
└── docs/
    ├── sns-animation-design.md （本ファイル）
    └── sns-animation-checklist.md
```

**既存ファイルへの変更は `vite.config.js` のみ。`src/main.js` `src/map.js` 等は無変更。**

### 6.1 vite.config.js 変更内容

```js
import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  server: { port: 5173, open: true },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: 'index.html',   // 既存
        sns:  'sns.html',     // 追加
      }
    }
  },
});
```

---

## 7. スタイリング方針

- **フォント**: 既存ダッシュボードと同じ（Tailwindのデフォルト）
- **配色**: UNCTADパレット準拠
  - 背景: `#0a1628`（ダークネイビー）
  - テキスト: `#ffffff`
  - 輸出バー: `#009EDB`（ブルー）
  - 輸入バー: `#72BF44`（グリーン）
  - マップ陸地: `#1e3a5f`
  - マップ海洋: `#0d2137`
- **年表示**: 大きくセンターまたは右上に（フォントサイズ 4〜6rem）

---

## 8. 画面録画手順（実装後）

1. ブラウザで `http://localhost:5173/sns.html` を開く
2. ウィンドウサイズを **1920×1080** に設定
3. OBS / Windows ゲームバー（Win+G）で録画開始
4. アニメーション1ループ録画
5. 動画編集ツールで不要部分をトリム

---

## 9. 未決定事項・オープンクエスチョン

| # | 質問 | 現在の想定 |
|---|------|----------|
| 1 | ループ再生 or 1回で停止？ | ループ（録画者が止める） |
| 2 | 年ごとのアーク本数上限 | なし（1M以上全表示） |
| 3 | バーチャートに表示する国数 | TOP 10（縦スペースで調整） |
| 4 | 音楽・BGMの追加 | スコープ外 |
| 5 | マップ上の国ラベル表示 | なし（アーク優先） |
