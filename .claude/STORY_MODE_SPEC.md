# 実装指示書: Story Animation Mode（自動ループ + スクラブ可能タイムライン）

UNCTAD SHC Trade Visualization に、報告書「Trade in secondhand clothing」のキーメッセージを
語る **ストーリーアニメーションモード** を追加する。本書は VS Code 上の Claude Code が
そのまま着手できる粒度の実装指示である。

---

## 0. 最重要制約（必読・違反禁止）

### 0.1 スタイルは UNCTAD Branding に準拠済み。既存スタイルを変更しない

- **既存の `.less` ファイルを一切編集しない。** 唯一の例外は `src/styles/styles.less` の末尾に
  `@import 'story.less';` を1行追加することのみ。
- 新規 `src/styles/story.less` は **既存変数のみ** を使用する。色は必ず
  `src/styles/colors.less` の変数（`@unblue`, `@unblue-dark`, `@ungreen`, `@unyellow`,
  `@ungrey`, `@ungrey-border`, `@ungrey-bg`, `@unblue-bg` 等）を参照する。
  **新しい色値（hex直書き）・新しいフォント・新しい角丸/影トークンを定義しない。**
  半径・影・余白は `variables.less` の `@radius-*`, `@shadow-*`, `@space-*` を使う。
- 既存 UI（ヘッダ、KPIバー、凡例、地図、モーダル）の見た目を変えない。Story モードは
  `body.story-mode` クラスでこれらを隠すだけにとどめ、既存要素の CSS プロパティを上書きしない。
- タイムラインバーの配色は、既存 `#anim-panel` のタイムライン（トラック `@ungrey-bg`、
  フィル `@unblue` 相当）と同じ語彙にそろえる。新しいビジュアル言語を発明しない。
- フラグアイコンが必要なら既存の `flag-icons` CSS（`index.html` で読込済み）と
  `src/sns/iso3toIso2.js` の `iso2Lower()` を再利用する。

### 0.2 データ誠実性（演出で数値を捏造しない）

- 報告書由来の数値（96% 再着用可、コンテナコスト、1.56日分 等）は **貿易フローJSONには無い**。
  これらは `src/sns/storyData.js` に出典付きで定義し、カードからのみ参照する。
  **マップの集計値で上書きしたり、マップが報告書数値を「証明している」かのような演出をしない。**
- 中国シフトのマップ演出に、報告書 Table 8/9 の正確な % をオーバーレイしない。
  マップは BACI ミラーデータ、報告書表は国歳入当局＋Full Cycle Resource 由来で出典が異なる。
  カードで % を出す場合は `caveat` テキストを併記する。
- 各カードに出典フッターを必須表示する。

---

## 1. 全体方針

1. **自動ループが主モード。** 起動したら最初のシーンから自動再生し、最終シーンの後は先頭へループする。
2. **タイムラインバーで任意位置へ移動できる。** 再生ヘッドのドラッグ／クリックでシーク。
   再生/一時停止ボタンを持つ。
3. **既存ダッシュボードのレンダリングパイプラインを再利用する。** Story モードは独自のアーク
   描画レイヤーを作らない。`STATE` を書き換えて
   `DataLoader.filterData()` → `TradeMap.renderFlows()` → カメラ/フォーカスを呼ぶだけ。
   既存の halo / particle / partner highlight をそのまま活かす。
4. **既存 `animationMode.js`（バーチャートレース）とは排他。** 同時起動禁止。
5. **マスタークロック方式。** `setTimeout` の入れ子ではなく、`requestAnimationFrame` ベースの
   単一クロックで経過時間 `elapsed` を進める。これによりタイムラインのシークと
   シーン内の年送りが正確かつ滑らかになる。

---

## 2. 追加・変更するファイル

```
新規:
  src/sns/storyMode.js      … クロック + シーンエンジン + start/stop + タイムライン制御
  src/sns/storyScenes.js    … シーン定義配列
  src/sns/storyData.js      … 報告書由来の固定数値（出典付き）
  src/sns/storyCards.js     … カードの HTML/SVG 生成関数
  src/styles/story.less     … story-mode 専用スタイル（既存変数のみ使用）

変更（最小限）:
  index.html                … #story-btn / #story-stage / #story-header-right を追加
  src/main.js               … 起動・停止・復元イベントの配線を追加
  src/map.js                … zoomToCountry() ヘルパーを追加
  src/styles/styles.less    … 末尾に @import 'story.less'; を1行追加
```

既存の `animationMode.js`, `config.js`, `dataLoader.js`, `regions.js`, その他 `.less` は変更しない。

---

## 3. `index.html` への追加

### 3.1 起動ボタン（既存 `#anim-btn` の隣）

`.header-controls` 内、`#anim-btn` の直後に追加:

```html
<button id="story-btn" title="Play guided story (auto-loop)">&#9654; Story</button>
```

`#story-btn` の見た目は `#anim-btn` と同一にする（`story.less` で `#anim-btn` のセレクタを
複製せず、`#story-btn` に同じ宣言を新規記述。色は `@unblue` 系変数を使用）。

### 3.2 Story モード時の右側ヘッダ

`#anim-header-right` の直後に追加（通常は非表示、`body.story-mode` で表示）:

```html
<div id="story-header-right">
  <img id="story-smep-logo" src="/assets/smep-logo.png" alt="SMEP / UNCTAD / UK Aid" />
  <button id="story-playpause-btn" title="Play / Pause">&#10073;&#10073;</button>
  <button id="story-stop-btn" title="Exit story">&#9632; Stop</button>
</div>
```

### 3.3 ストーリーステージ（カード・ナレーション・タイムラインの描画先）

`.map-area` 内、`#map-container` の直後に追加:

```html
<div id="story-stage">
  <div id="story-card-layer"></div>     <!-- カード（report数値）をここに描画 -->
  <div id="story-caption"></div>        <!-- 下部ナレーション帯 -->
  <div id="story-timeline">             <!-- タイムラインバー -->
    <div id="story-tl-track">
      <div id="story-tl-fill"></div>
      <div id="story-tl-playhead"></div>
      <div id="story-tl-ticks"></div>   <!-- シーン境界の目盛り + ラベルを JS で描画 -->
    </div>
  </div>
</div>
```

`#story-stage` は通常 `display:none`。`body.story-mode` のときだけ表示する。
`pointer-events` はステージ全体では `none`、操作要素（タイムライン、再生ボタン）だけ `auto` にして
地図のパン/ズームを妨げないこと。

---

## 4. `src/styles/story.less`（既存変数のみ・新トークン禁止）

要件:

- `@import 'variables.less';` で始める（`variables.less` は `colors.less` を取り込む）。
- **`body.story-mode` のとき、既存の `.header-controls`, `#legend-panel`, `#kpi-bar`,
  `#map-footer`, `#insight-panel`, `#arc-modal`, `#compare-modal`, `#mobile-legend-btn`,
  `#fit-screen-btn`, `#mobile-filter-btn` を `display:none`** にする。
  （`animationMode` の `body.anim-mode` ブロックと同じ対象。既存ブロックはコピーせず、
  story.less に新規でセレクタを書く。）
- `#story-header-right` は `body.story-mode` で `display:flex`。中身の余白・ボタンは
  `#anim-header-right` / `#anim-stop-btn` と同じ語彙（`@radius-sm`, `@unred` 等）。
- `#story-btn` は `#anim-btn` と同一の見た目（`@unblue` ボーダー、hover で `@unblue` 背景）。
- カード（`#story-card-layer` 内）:
  - 背景 `#fff`、ボーダー `@ungrey-border`、角丸 `@radius-lg`、影 `@shadow-md`。
  - 見出しは `@unblue-dark`、本文 `@ungrey-dark`、補助 `@ungrey-text`、出典 `@ungrey`（斜体・極小）。
  - 既存 `.si-*`（insight.less）のトーンに合わせるが、insight.less は編集しない。
- タイムライン:
  - `#story-tl-track`: 背景 `@ungrey-bg`、高さ 4px、角丸 2px（既存 `.ap-tl-track` と同じ）。
  - `#story-tl-fill`: 背景 `@unblue`（既存 `#ap-tl-fill` と同じ）。
  - `#story-tl-playhead`: 直径 12px の円、`@unblue-dark`、白フチ。`cursor:grab`。
  - シーン境界 tick: `@ungrey-border` の縦線。ラベルは `@ungrey-text` の極小フォント。
  - hover/active で `@unblue-dark`。新色は使わない。
- カードのフェードイン等のアニメは `modals.less` の `@keyframes modal-fade-in` と同等の
  控えめなもの（story.less に新規 keyframes を書いてよいが transform/opacity のみ）。
- レスポンシブ: `@bp-md` を使用。モバイルではカードを下部全幅、タイムラインを太めに。

---

## 5. `src/map.js` への追加（1メソッドのみ）

`zoomToRegion` と同じ変換ロジックを国重心に適用するヘルパーを追加する。既存メソッドは変更しない。

```javascript
// 特定国へズーム。scale は RegionConfig.scale と同じ意味の倍率。
zoomToCountry(iso, scale = 3.5, duration = 1200) {
    if (!this.zoomBehavior) return;
    const coords = STATE.countryCoords[iso];
    if (!coords) return;
    const p = this.projection(coords);
    if (!p) return;
    const k = Math.max(0.2, scale);
    const tx = (this.width / 2) - (p[0] * k);
    const ty = (this.height / 2) - (p[1] * k);
    this.svg.transition()
        .duration(duration)
        .call(this.zoomBehavior.transform, d3.zoomIdentity.translate(tx, ty).scale(k));
}
```

---

## 6. `src/sns/storyData.js`（報告書由来の固定値・出典付き）

報告書 PDF の数値を集約する。**ここ以外に報告書数値をハードコードしない。**

```javascript
export const STORY_DATA = {
  report: {
    title: 'Trade in secondhand clothing: Analysis of markets in Uganda, the United Republic of Tanzania and the United States of America',
    publisher: 'SMEP Programme · UNCTAD · funded by UK FCDO',
    date: 'April 2026',
    url: 'https://unctad.org/system/files/non-official-document/trade-in-secondhand-clothing-smep-2026.pdf'
  },

  baleComposition: {
    sampleSize: 244500,
    rewearablePct: 96,
    ragsPct: [2.9, 3.2],
    wastePct: [1.1, 1.3],
    source: 'SMEP/UNCTAD field research, Uganda & Tanzania, 2024 (report Executive Summary, §3.1)',
    note: 'Field-sampled bale contents — NOT derived from the trade-flow data shown on the map.'
  },

  chinaShift: {
    tanzania: { from: { year: 2018, pct: 26.4 }, to: { year: 2023, pct: 55.5 } },
    uganda:   { from: { year: 2018, pct: 29.9 }, to: { year: 2023, pct: 47.3 } },
    usTanzania: { from: { year: 2018, pct: 13.9 }, to: { year: 2023, pct: 9.1 } },
    usUganda:   { from: { year: 2018, pct: 8.2 },  to: { year: 2023, pct: 2.5 } },
    source: 'UN Comtrade analysed by Full Cycle Resource (report Tables 8–9)',
    caveat: 'Map arcs use BACI/UN Comtrade mirror data and may differ slightly from these national-revenue-authority figures.'
  },

  containerCost: {
    tanzania2023: 47954,
    uganda2023: 57080,
    unit: 'USD',
    paymentNote: 'Some Chinese suppliers accept 50% upfront, balance on receipt.',
    source: 'TRA / URA, analysed by Full Cycle Resource (report §4.1)'
  },

  affordability: {
    dailyDisposableIncomeUSD: 1.73,
    shcItemUSD: 2.70,
    daysPerShcItem: 1.56,
    region: 'Uganda',
    source: 'report §4.6'
  },

  livelihoods: {
    femaleOwnershipPct: 34,
    source: 'report §4.5 (Uganda & Tanzania)'
  },

  policy: {
    points: [
      'Base regulatory design on country-specific empirical evidence.',
      'Avoid redundant sorting that undermines affordability and reuse.',
      'Address synthetic-fibre pollution upstream at production, not via Basel B3030.',
      'Sequence circular-economy interventions: strengthen reuse first.'
    ],
    source: 'report §5.2–5.3'
  }
};
```

---

## 7. `src/sns/storyScenes.js`（シーン定義）

各シーンは宣言的に「マップ状態」「年送り」「カード」を持つ。`durationMs` は自動再生での尺。

```javascript
import { STORY_DATA } from './storyData.js';

export const STORY_SCENES = [
  {
    id: 'intro', title: 'Trade in Secondhand Clothing',
    durationMs: 6000,
    map: { year: 2023, region: 'Global',
           selectedExporters: [], selectedImporters: [],
           flowFilters: ['north-south','south-north','south-south','north-north'],
           thresholdMode: 'auto', focusIso: null,
           camera: { type: 'region', value: 'Global' } },
    card: { kind: 'intro', position: 'center' }
  },
  {
    id: 'global-scale', title: 'A truly global trade',
    durationMs: 9000,
    map: { year: 2023, region: 'Global',
           selectedExporters: [], selectedImporters: [],
           flowFilters: ['north-south','south-north','south-south','north-north'],
           thresholdMode: 'auto', focusIso: null,
           camera: { type: 'region', value: 'Global' } },
    caption: 'Under HS 6309, nearly every country participates in the secondhand clothing trade.'
  },
  {
    id: 'flow-structure', title: 'Not just North to South',
    durationMs: 10000,
    map: { year: 2023, region: 'Global',
           selectedExporters: [], selectedImporters: [],
           flowFilters: ['north-south','south-south'],
           thresholdMode: 10000000, focusIso: null,
           camera: { type: 'region', value: 'Global' } },
    card: { kind: 'flow-structure', position: 'lower-left' }
  },
  {
    id: 'dumping-myth', title: 'The "dumping" narrative, tested',
    durationMs: 11000,
    map: { year: 2023, region: 'Global',
           selectedExporters: [], selectedImporters: [],
           flowFilters: ['north-south','south-north','south-south','north-north'],
           thresholdMode: 10000000, focusIso: null,
           camera: { type: 'region', value: 'Global' }, dim: true },
    card: { kind: 'bale-composition', position: 'center' }   // report数値（waffle）
  },
  {
    id: 'east-africa', title: 'Where it lands: East Africa',
    durationMs: 10000,
    map: { year: 2023, region: 'Global',
           selectedExporters: [], selectedImporters: ['TZA','UGA'],
           flowFilters: ['north-south','south-north','south-south','north-north'],
           thresholdMode: 100000, focusIso: 'TZA',
           camera: { type: 'country', value: 'TZA', scale: 3.2 } },
    caption: 'Uganda and Tanzania together imported ≈166 million kg in 2023 (UN Comtrade).'
  },
  {
    id: 'china-shift', title: 'The China shift (2015–2023)',
    durationMs: 12000,
    map: { year: 2015, region: 'Global',
           selectedExporters: [], selectedImporters: ['TZA','UGA'],
           flowFilters: ['north-south','south-north','south-south','north-north'],
           thresholdMode: 100000, focusIso: null,
           camera: { type: 'country', value: 'TZA', scale: 3.0 } },
    animateYears: { from: 2015, to: 2023 },   // intra-scene 進行に同期して年送り
    card: { kind: 'china-shift', position: 'lower-left' }   // %はcaveat併記
  },
  {
    id: 'why-china', title: 'Why China wins: liquidity, not just price',
    durationMs: 10000,
    map: { year: 2023, region: 'Global',
           selectedExporters: ['CHN'], selectedImporters: ['TZA','UGA'],
           flowFilters: ['north-south','south-north','south-south','north-north'],
           thresholdMode: 100000, focusIso: 'CHN',
           camera: { type: 'region', value: 'Asia' } },
    card: { kind: 'why-china', position: 'lower-left' }
  },
  {
    id: 'livelihoods', title: 'A livelihood, not just a flow',
    durationMs: 10000,
    map: { year: 2023, region: 'Global',
           selectedExporters: [], selectedImporters: ['TZA','UGA'],
           flowFilters: ['north-south','south-north','south-south','north-north'],
           thresholdMode: 100000, focusIso: 'UGA',
           camera: { type: 'country', value: 'UGA', scale: 3.2 }, dim: true },
    card: { kind: 'livelihoods', position: 'center' }
  },
  {
    id: 'policy', title: 'Implications for Basel & trade policy',
    durationMs: 12000,
    map: { year: 2023, region: 'Global',
           selectedExporters: [], selectedImporters: [],
           flowFilters: ['north-south','south-north','south-south','north-north'],
           thresholdMode: 'auto', focusIso: null,
           camera: { type: 'region', value: 'Global' }, dim: true },
    card: { kind: 'policy', position: 'center' }
  },
  {
    id: 'outro', title: 'Report launch',
    durationMs: 8000,
    map: { year: 2023, region: 'Global',
           selectedExporters: [], selectedImporters: [],
           flowFilters: ['north-south','south-north','south-south','north-north'],
           thresholdMode: 'auto', focusIso: null,
           camera: { type: 'region', value: 'Global' }, dim: true },
    card: { kind: 'outro', position: 'center' }   // 報告書URL/QR・ロゴ
  }
];
```

> 数値や尺は後で調整する前提。`durationMs` の合計がストーリー総尺になる。

---

## 8. `src/sns/storyMode.js`（クロック + エンジン + タイムライン）

### 8.1 公開 API

```javascript
export async function startStory();   // 常に自動再生で開始（先頭シーンから）
export function stopStory();
```

### 8.2 内部状態

```javascript
let _active = false;
let _playing = true;            // 再生中フラグ（一時停止対応）
let _elapsed = 0;               // ストーリー先頭からの経過ms
let _rafId = null;
let _lastT = 0;                 // 前フレームの timestamp
let _sceneIndex = -1;           // 現在シーン（変化検出用）
let _saved = null;              // 開始前の STATE を退避
let _sceneOffsets = [];         // 各シーン開始の累積ms
let _totalMs = 0;
```

### 8.3 起動 `startStory()`

1. `animationMode` が起動中なら return（排他）。`_active=true`。
2. **STATE退避:** `year, region, selectedExporters, selectedImporters, thresholdMode, flowFilters`
   を `_saved` にコピー。
3. 全年プリロード: `await Promise.all(YEARS.map(y => DataLoader.loadYear(y)))`
   （`animationMode.js` と同じ `YEARS = [2015..2024]`）。ローダー表示は既存 `#loader` を流用。
4. `_sceneOffsets` / `_totalMs` を `STORY_SCENES[].durationMs` から計算。
5. `document.body.classList.add('story-mode')`。`#story-btn` を disabled、`#anim-btn` を disabled。
6. タイムラインの目盛り（シーン境界 + ラベル）を `#story-tl-ticks` に描画。
7. 2フレーム待って `TradeMap.init()`（`animationMode` と同様、flex レイアウト確定後に投影再計算）。
   ※ Story モードはパネルで地図を分割しないため、`anim-mode` のような幅変更は不要。
   ただしコントロールが消えて地図高さが変わるので `TradeMap.init()` は呼ぶ。
8. `_elapsed=0; _playing=true; _sceneIndex=-1;` クロック開始 `_rafId = requestAnimationFrame(_tick)`。

### 8.4 マスタークロック `_tick(t)`

```text
_tick(t):
  if not _active: return
  dt = _playing ? (t - _lastT) : 0
  _lastT = t
  if _playing:
    _elapsed += dt
    if _elapsed >= _totalMs: _elapsed = _elapsed % _totalMs   // ループ
  idx = シーン索引(_elapsed)            // _sceneOffsets から二分/線形探索
  if idx !== _sceneIndex:
    _sceneIndex = idx
    _applyScene(STORY_SCENES[idx])      // マップ状態 + カード切替
  _updateIntraScene(idx, _elapsed)      // animateYears のある場合のみ年を更新
  _updateTimelineUI(_elapsed)           // fill 幅 + playhead 位置
  _rafId = requestAnimationFrame(_tick)
```

- **シーン内年送り `animateYears`:** シーン内進捗 `p = (_elapsed - offset[idx]) / durationMs[idx]`
  を `[from..to]` の年インデックスにマップ。年が変わったときだけ
  `STATE.year = y; DataLoader.filterData(); TradeMap.renderFlows();` を呼ぶ（毎フレーム呼ばない）。
- `_applyScene` は後述。シーンが変わった瞬間のみ実行。

### 8.5 `_applyScene(scene)`（既存パイプライン再利用）

```text
_applyScene(scene):
  m = scene.map
  STATE.year             = m.year
  STATE.region           = m.region
  STATE.selectedExporters = new Set(m.selectedExporters)
  STATE.selectedImporters = new Set(m.selectedImporters)
  STATE.flowFilters      = new Set(m.flowFilters)
  STATE.thresholdMode    = m.thresholdMode
  DataLoader.filterData()
  TradeMap.renderFlows()
  // カメラ
  if m.camera.type === 'region':  TradeMap.zoomToRegion(m.camera.value)
  else:                           TradeMap.zoomToCountry(m.camera.value, m.camera.scale)
  // フォーカス（spotlight）
  if m.focusIso:  TradeMap.setFocus(m.focusIso)
  else:           TradeMap.clearFocus()
  // 地図ディム（カード主役シーン）
  _setStageDim(!!m.dim)
  // オーバーレイ
  if scene.card:    showCard(scene.card)      // storyCards.js
  else:             clearCard()
  if scene.caption: showCaption(scene.caption)
  else:             clearCaption()
```

> 重要: `setFocus` は `STATE.filteredData` に対象国を含む必要がある。先に `filterData()` を
> 呼んでから `setFocus` すること（上記順序を厳守）。

### 8.6 タイムライン UI とシーク

- `_updateTimelineUI(elapsed)`: `#story-tl-fill` の幅 = `elapsed / _totalMs * 100%`、
  `#story-tl-playhead` の left も同様。
- **クリックシーク:** `#story-tl-track` の `pointerdown` で、クリック x 比率 → `targetMs`、
  `_seekTo(targetMs)`。
- **ドラッグシーク:** playhead の `pointerdown` → `pointermove` で追従 → `pointerup` で確定。
  ドラッグ中は `_playing=false` 相当で扱い、確定後に元の再生状態へ戻す。
- `_seekTo(ms)`:
  ```text
  _elapsed = clamp(ms, 0, _totalMs - 1)
  idx = シーン索引(_elapsed)
  _sceneIndex = -1            // 強制再適用
  _applyScene(STORY_SCENES[idx])
  _sceneIndex = idx
  _updateIntraScene(idx, _elapsed)
  _updateTimelineUI(_elapsed)
  ```

### 8.7 再生/一時停止

- `#story-playpause-btn` クリックで `_playing = !_playing`。
  一時停止中はクロックの `_elapsed` を進めない（`dt=0`）。ボタンの記号を ▮▮ / ▶ で切替。

### 8.8 停止 `stopStory()` と復元

1. `_active=false; _playing=false; cancelAnimationFrame(_rafId)`。
2. カード/キャプション/ディムをクリア。`TradeMap.clearFocus()`。
3. `document.body.classList.remove('story-mode')`。`#story-btn`/`#anim-btn` の disabled 解除。
4. `_saved` から STATE を復元。
5. `animationMode.js` と同じく、レイアウト復帰後に投影再計算 → イベント発火:
   ```javascript
   requestAnimationFrame(() => requestAnimationFrame(() => {
     TradeMap.init();
     document.dispatchEvent(new CustomEvent('shc:story-stopped'));
   }));
   ```

---

## 9. `src/sns/storyCards.js`（カード生成）

`scene.card.kind` ごとに `#story-card-layer` へ挿入する HTML を返す関数群を実装する。
すべて `STORY_DATA` を参照し、**出典フッターを必須**にする。

- `intro`: 報告書タイトル・主催・ローンチ告知。
- `flow-structure`: N→S と S→S の構成比を簡潔に（マップの現在フィルタと整合する説明文）。
- `bale-composition`: **100アイコンの SVG waffle**（96 緑 `@ungreen` / 3 黄 `@unyellow` /
  1 赤 `@unred`）。`STORY_DATA.baleComposition` の値で生成し、`note` と `source` を表示。
  D3/SVG のみで生成（新規依存なし）。
- `china-shift`: TZA/UGA の 2018→2023 シェア変化を矢印付きで。**`caveat` を必ず併記。**
- `why-china`: コンテナコスト（TZA $47,954 / UGA $57,080）+ 50%前払いの note。
- `livelihoods`: 1.56日分・女性所有34%。
- `policy`: `STORY_DATA.policy.points` を箇条書き。
- `outro`: ロゴ（既存 `assets/smep-logo.png` 等）+ 報告書 URL。QR を出す場合は
  ビルド時生成画像を `assets/` に置く前提（ランタイムで外部CDNを呼ばない）。

カードの配色・角丸・影は §4 の制約に従い、`story.less` のクラスで与える（インラインstyleで
新色を入れない）。

---

## 10. `src/main.js` への配線（追加のみ）

```javascript
import { startStory, stopStory } from './sns/storyMode.js';

// setupEventListeners 内に追加
document.getElementById('story-btn')?.addEventListener('click', startStory);
document.getElementById('story-stop-btn')?.addEventListener('click', stopStory);
document.getElementById('story-playpause-btn')?.addEventListener('click', () => {
  document.dispatchEvent(new CustomEvent('shc:story-toggle-play'));
});

// 停止後の復元（animation-stopped と同じ思想）
document.addEventListener('shc:story-stopped', () => {
  const t = STATE.thresholdMode === 'auto' ? 'auto' : String(STATE.thresholdMode);
  const b = document.querySelector(`.threshold-btn[data-threshold="${t}"]`);
  if (b) App.updateUIClasses('.threshold-btn', b);
  App.updateDashboard();
});

// Esc で停止（既存 keydown ハンドラに1行追加でも可）
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('story-mode')) stopStory();
});
```

`shc:story-toggle-play` は `storyMode.js` 側で購読して `_playing` をトグルする。

---

## 11. 排他制御（必須）

- `animationMode.js` の `startAnimation()` 冒頭に
  「`document.body.classList.contains('story-mode')` なら return」を追加してよい（最小変更）。
- `storyMode.js` の `startStory()` 冒頭に
  「`document.body.classList.contains('anim-mode')` なら return」を入れる。
- 起動中は相手ボタンを `disabled`。

---

## 12. 完了条件（受け入れテスト）

1. `npm run dev` で起動し、`▶ Story` を押すと自動再生が始まる。
2. 最終シーン後に先頭へループする。
3. タイムラインバーをクリック／ドラッグすると該当時点のシーンへ即移動し、マップ状態と
   カードが一致する。
4. 再生/一時停止ボタンが機能する。
5. `Stop` または `Esc` で元のダッシュボード（フィルタ・年・しきい値）が復元される。
6. Story 起動中は `animationMode` を起動できない（その逆も）。
7. **既存 UI の見た目が変わっていない**（ヘッダ、KPI、凡例、地図、モーダル）。
8. 既存 `.less` ファイルの差分は `styles.less` の `@import` 1行のみ。
9. カードの数値が `storyData.js` と一致し、出典フッターが全カードに出る。
   中国シフトカードに `caveat` が表示される。
10. Playwright（既存 devDependency）で「起動→各シーン適用→シーク→停止」のスモークテストが通る。

---

## 13. 実装順序（コミット単位の推奨）

1. 足場: `index.html` の DOM 追加 + `story.less` 雛形 + `styles.less` の `@import` +
   `body.story-mode` の非表示CSS。`#story-btn` 押下で空ステージ表示・`Stop` で復帰まで。
2. `map.js` に `zoomToCountry` 追加。
3. `storyMode.js`: クロック + `_applyScene` + STATE退避/復元 + 排他。マップシーンのみ（カード無し）動作。
4. タイムライン UI（fill/playhead/ticks）+ クリック/ドラッグシーク + 再生/一時停止。
5. `animateYears`（china-shift シーン）。
6. `storyData.js` + `storyCards.js`: `bale-composition`（waffle）から実装、順次他カード。
7. 自動ループ尺・トランジション・ロゴ/QR の仕上げ。Playwright スモークテスト。

---

## 14. 確認が必要な未確定事項（着手前に Sushi へ確認）

1. `meta.json` / `country_classification.json` に `TZA` `UGA` `CHN` の `coords` が
   揃っているか（`zoomToCountry` と `setFocus` の前提）。
2. 中国シフトのマップ年送りは 2015–2023 でよいか（報告書表は 2018–2023。マップは 2015 から
   データがあるため 2015 起点を推奨）。
3. `outro` の QR を使うか。使う場合はビルド時生成の静的画像を `assets/` に置く
   （ランタイムで外部CDNを呼ばない方針）。
4. 自動ループ総尺の目標（現状の `durationMs` 合計は約 98 秒）。ロビー上映なら現状程度、
   登壇の背景上映ならより長く/ゆっくりにする調整余地。
5. カードの主役シーン（dumping-myth, livelihoods, policy, outro）で地図を `dim` する強さ。
