# アニメーション演出の強化：上位国ハロー効果とフロー粒子エフェクト — 設計書

> 作成日: 2026-06-02

---

## 1. 概要

本ドキュメントは、古着貿易モニターの「アニメーションモード」（メインダッシュボード内およびSNS専用画面）におけるビジュアル演出の強化に関する設計書です。

貿易のダイナミズムと主要な交易ハブをより直感的に伝えるため、以下の2つのアニメーション効果を追加します。
1. **上位3ヶ国への波紋（パルシング・ハロー）エフェクト (Idea 1)**
2. **上位国と接続するアーク上を走る光の粒子（パーティクル）エフェクト (Idea 4)**

---

## 2. 視覚演出の設計

### 2.1 上位3ヶ国への波紋（パルシング・ハロー）エフェクト
各年の輸出総額および輸入総額のそれぞれ上位3ヶ国（計最大6ヶ国）の地理座標を中心に、同心円が外側に広がって消えていくアニメーション効果を描画します。

* **カラーエンコーディング**:
  * 輸出上位3ヶ国: **UNブルー（`#009EDB`）** の波紋
  * 輸入上位3ヶ国: **グリーン（`#72BF44`）** の波紋
* **アニメーション仕様**:
  * ハードウェアアクセラレーション（GPU）を利用したCSSの `@keyframes` により、スケール拡大（`scale(0.5)` から `scale(3.2)`）と不透明度（`opacity`）のフェードアウトをループ実行します。
  * 2枚の同心円を1.2秒の遅延（`animation-delay`）を持って重ねることで、絶え間なく波紋が広がり続けるプレミアムなエフェクトを実現します。
* **表示レイヤー位置**:
  * 世界地図のアークレイヤーより上で、国ノードレイヤーより下のレイヤー（`anim-halo-layer`）に配置し、ノードの文字や本体の視認性を邪魔しないようにします。

### 2.2 アーク上を走る光の粒子（パーティクル）エフェクト
上位3ヶ国のいずれか（輸出または輸入）に接続する主要な貿易アーク上に、白色の光の点線が流れ落ちるオーバーレイを描画します。

* **ビジュアル**:
  * 既存のアークの軌道に重なるように、白色（`#ffffff`）の破線（`stroke-dasharray: 6 18`）を重ねて配置します。
  * `stroke-dashoffset` をマイナス方向にアニメーションさせることで、**「輸出国（供給側）から輸入国（需要側）に向けて流れる」** 物理的な動きを表現します。
  * 取引量に応じた太さのスケールを適用し、主要ルートほど流れる光の帯が太くなり、ダイナミックな印象を与えます。
* **表示レイヤー位置**:
  * 通常のアーク（色付きの半透明アーク）の直上に重ねて描画します（`anim-particle-layer`）。

---

## 3. 実装対象ファイル一覧

| ファイルパス | 変更内容 |
|--------------|----------|
| [src/styles/styles.less](file:///C:/Users/seitaro.taketani/OneDrive%20-%20United%20Nations/Documents/GitHub/SHC-trade-visualization%20-%20UNCTADstyled/src/styles/styles.less) | 波紋エフェクトとフローパーティクル用のCSSクラス（キーフレーム定義含む）を追加。 |
| [sns.html](file:///C:/Users/seitaro.taketani/OneDrive%20-%20United%20Nations/Documents/GitHub/SHC-trade-visualization%20-%20UNCTADstyled/sns.html) | スタンドアロンSNS画面用のインライン `<style>` に、LESSと同じCSS定義を移植。 |
| [src/sns/animationMode.js](file:///C:/Users/seitaro.taketani/OneDrive%20-%20United%20Nations/Documents/GitHub/SHC-trade-visualization%20-%20UNCTADstyled/src/sns/animationMode.js) | メイン画面のアニメーション描画ロジック。レイヤー追加、上位3国の計算、波紋の描画、粒子アークのバインド処理を実装。 |
| [src/sns/sns.js](file:///C:/Users/seitaro.taketani/OneDrive%20-%20United%20Nations/Documents/GitHub/SHC-trade-visualization%20-%20UNCTADstyled/src/sns/sns.js) | スタンドアロンSNS画面のコントローラー。年次アップデート時に上位国ランキングデータを `snsMap.js` に転送する処理を追加。 |
| [src/sns/snsMap.js](file:///C:/Users/seitaro.taketani/OneDrive%20-%20United%20Nations/Documents/GitHub/SHC-trade-visualization%20-%20UNCTADstyled/src/sns/snsMap.js) | スタンドアロンSNS画面のマップ描画ロジック。粒子レイヤーとハローレイヤーを追加し、メイン画面と同様のD3描画を追加。 |

---

## 4. 期待されるビジュアル効果

1. **時間の経過に伴う「ハブの移動」の明確化**:
   * 年が進むにつれて、波紋が発生する国（アジア、ヨーロッパ、アメリカからアフリカの各国へなど）が入れ替わるため、古着貿易における需要と供給の中心地がダイナミックに移り変わる様子が直感的に視認できるようになります。
2. **「物流の流れ」の体感**:
   * 単なる静的な線の表示から、流れる粒子アークに変わることで、動画として再生した際の見栄えが格段にアップし、プレゼンテーションやSNS投稿において目を引くリッチなコンテンツに仕上がります。
