// ─────────────────────────────────────────────────────────────────────────────
// SMEP Fact Sheet — source data (日本語版)
//
// factsheetData.js の日本語版。数値はすべて原文（英語版）と完全に一致させており、
// 日本語にしているのはラベル・注記等の文字列のみ。SMEP / UNCTADのファクトシート
// "Trade in secondhand clothing — Uganda, the United Republic of Tanzania &
// the United States of America" (SMEP, 2026) にもとづく。
//
// 重量は原文どおり「百万kg」単位のまま持ち、日本語で自然な「万トン」への換算は
// 描画側（factsheet.ja.js）で行う。こうしておけば、この表の数値を英語版と1対1で
// 突き合わせて検証できる。
//
// これらはレポート由来の数値（現地調査＋各国歳入庁＋Full Cycle Resourceの分析）であり、
// ライブ貿易マップの元になっているBACI/UN Comtradeミラーデータとは異なる証拠にもとづく。
// マップの集計値をこれらの数値の「裏付け」として提示しないこと。
// ─────────────────────────────────────────────────────────────────────────────

export const META = {
  brand: 'SMEP',
  brandFull: '持続可能な製造と環境汚染',
  title: '古着の貿易',
  countries: ['ウガンダ', 'タンザニア連合共和国', 'アメリカ合衆国'],
  citation:
    'SMEP, 2026. Trade in secondhand clothing: analysis of markets in Uganda, ' +
    'the United Republic of Tanzania and the United States of America.',
  dataSources:
    'UN Comtrade · ウガンダ歳入庁 · タンザニア歳入庁 · WasteAid · Full Cycle Resource',
  fieldwork:
    'ウガンダ・カンパラのオウィノ市場（2024年5〜6月） · タンザニア・ダルエスサラームのカリアコ、イララ、カルメ各市場（2024年7〜8月）',
  partners: ['UN Trade and Development', 'UK International Development', 'South South North', 'Pegasys'],
  reportUrl: 'https://unctad.org/topic/trade-analysis/trade-and-environment/SMEP',
};

// 01 — 最も重要な発見
export const KEY_FINDING = {
  itemsAnalysed: 244500,
  rewearablePct: 96,
  lead:
    'ウガンダとタンザニア連合共和国の主要市場で古着を調べたところ、もう着られないと判定されたものは' +
    'ごくわずかだった。輸入される古着は質が低く「ごみ」同然だ——そう語られがちだが、' +
    '市場に届いている中身はその見方とは違っていた。',
  source: '2024年、ウガンダとタンザニア連合共和国でのSMEP現地調査',
};

// 02 — 品質と構成
export const QUALITY = {
  grades: [
    { grade: 'A', pct: 83, label: '高品質。価格は高めで、ほぼ新品の品も多い' },
    { grade: 'B', pct: 15, label: '良品質。価格は手頃で、使用感はわずか' },
    { grade: 'C', pct: 2,  label: '低品質。価格は安く、使用感がはっきり残る' },
  ],
  gradeIntro:
    'ウガンダとタンザニア連合共和国の輸入業者53社が仕入れたベールを、品質グレード（A・B・C）別に集計した。',
  nonRewearablePct: 4,
  nonRewearable: [
    { key: 'rags',  label: 'ウエス',  pct: 2.9 },
    { key: 'waste', label: '廃棄物', pct: 1.1 },
  ],
  nonRewearableNote:
    'ウエスはもう着られないが、繊維廃棄物とは違って価値が残る。工業用・業務用の清掃資材として' +
    '広く使われている。',
  wastePerBale: [
    { country: 'ウガンダ', range: [0.9, 1.0] },
    { country: 'タンザニア連合共和国', range: [1.3, 1.5] },
  ],
  wastePerBaleNote: 'ベール1個に含まれる繊維廃棄物の推定比率。衣類の種類とグレードごとに中身を分析して算出した。',
  source: '輸入業者53社のベール構成分析（レポート第3章）',
};

// 03 — サプライチェーンと貿易の流れ（パキスタン・インドを介した二段階仕分け）
export const SUPPLY_CHAIN = {
  origin: { name: 'アメリカ合衆国', iso2: 'us' },
  sorting: { label: '二段階仕分け', note: 'パキスタン、マレーシア、UAEに集中' },
  destinations: [
    { name: 'ウガンダ', iso2: 'ug', totalKg: 80.0, usKg: 2.0 },
    { name: 'タンザニア連合共和国', iso2: 'tz', totalKg: 86.3, usKg: 8.0 },
  ],
  unit: '百万kg',
  source: 'UN Comtrade／Full Cycle Resource（レポート第2章）',
};

// 04 — 中国シフト：原産地別の輸入シェア、2018年 → 2023年
export const CHINA_SHIFT = {
  intro:
    '2018年からの5年間で、古着の輸入元は大きく変わった。両市場とも中国のシェアが伸び、' +
    '入れ替わるようにアメリカのシェアが縮んだ。',
  markets: [
    {
      country: 'ウガンダ',
      china: { from: 29.9, to: 47.3, delta: +17.4 },
      us:    { from: 8.2,  to: 2.5,  delta: -5.7 },
    },
    {
      country: 'タンザニア連合共和国',
      china: { from: 26.4, to: 55.5, delta: +29.1 },
      us:    { from: 13.9, to: 9.1,  delta: -4.8 },
    },
  ],
  fromYear: 2018,
  toYear: 2023,
  source: 'UN Comtrade（Full Cycle Resourceによる分析、レポート表8〜9）',
  caveat:
    'この原産地シェアは、Full Cycle Resourceが分析した各国歳入庁の記録にもとづく。ライブマップは' +
    'BACI/UN Comtradeのミラーデータを使っているため、数値が多少ずれることがある。',
};

// 05 — アフリカ全体のなかでの位置づけ（2023年）
export const AFRICA_CONTEXT = {
  totalMillionKg: 1266,
  ugTzSharePct: 13.1,
  ugTzMillionKg: 166.3,
  year: 2023,
  label: 'アフリカ全体の古着輸入のうち、ウガンダとタンザニア連合共和国が占める割合',
  source: 'UN Comtrade（レポート第2章）',
};

// 06 — 社会経済的インパクト
export const SOCIOECONOMIC = {
  tradersSurveyed: 2147,
  familyBenefitPct: 98,
  familyBenefitLabel: 'が「家計の支えになっている」と回答',
  ownership: { male: 66, female: 34 },
  mobility: {
    stages: ['ベール運搬人', '露店商', '小売業者', '輸入業者'],
    stats: [
      { pct: 89, label: 'の小売業者が、より上の段階へ進んだと回答' },
      { pct: 61, label: 'の高等教育を受けた業者が、より上の段階へ進んだ' },
      { pct: 77, label: 'の古着ビジネスのオーナーが、より上の段階へ進んだ' },
    ],
  },
  source: '業者への聞き取り調査、ウガンダとタンザニア連合共和国（レポート第4章）',
};

// 07 — 買いやすさとコスト構造（ウガンダ）＋コンテナのコスト
export const AFFORDABILITY = {
  dailyIncomeUSD: 2.68,
  dailyIncomeNote: 'ウガンダの人口のおよそ半分が、1日あたりこの水準の所得で暮らしている（世界銀行 貧困・公平指数による推計）。',
  items: [
    { key: 'new', label: '新品の服1着', usd: 6.36 },
    { key: 'shc', label: '古着1着',     usd: 2.69 },
  ],
  affordabilityNote: 'ウガンダの平均的な世帯にとって、何日分の所得にあたるかで表した価格。',
  containerCosts: [
    { country: 'ウガンダ', usd: 57080, dutyPct: 77 },
    { country: 'タンザニア連合共和国', usd: 47954, dutyPct: 38 },
  ],
  containerNote: '40フィートコンテナ1本にかかる費用の合計（税・関税・賦課金を含む）。リングは、そのうち関税・賦課金が占める割合を示す。',
  source: 'TRA・URAのデータをFull Cycle Resourceが分析／世界銀行（レポート第4章）',
};

// 08 — 業界全体の状況：世界とアメリカ
export const SECTOR = {
  global: {
    marketUSDTrillion: 1.7,
    employedMillion: 300,
    fiber: { from: { year: 2023, mt: 124 }, to: { year: 2030, mt: 160 }, growthPct: 29, years: 7 },
    qualityGainPct: 90,
    qualityGainNote: 'の輸入業者が、仕分け業者とやり取りを重ねれば届く古着の品質は大きく上がると回答',
    source: '世界の繊維・アパレル産業（レポート第1章）',
  },
  us: {
    consumptionYear: 2024,
    garmentsPerPersonNow: 68,
    garmentsPerPerson1960s: 25,
    imports: { from: { year: 2000, bn: 33 }, to: { year: 2023, bn: 93 }, growthPct: 182 },
    importsNote: 'アメリカは繊維・アパレルの輸入量を平方メートルで数えている。',
    textileWasteMT: 17,
    wasteFate: [
      { key: 'landfill',    label: '埋め立てられる', pct: 66 },
      { key: 'incinerated', label: '焼却される',     pct: 19 },
      { key: 'recovered',   label: '再生利用に回る', pct: 14.7 },
    ],
    source: 'アメリカの繊維・アパレル産業／WasteAid（レポート第1章）',
  },
};

// 09 — 政策の優先課題
export const POLICY = {
  groups: [
    {
      heading: '規制をそろえる',
      items: [
        {
          tag: 'HS 6309 · バーゼル条約 B3030',
          text: 'HS 6309とバーゼル条約B3030の定義をそろえ、規制のずれと貿易摩擦を減らす。',
        },
        {
          tag: 'EAS 356:2024',
          text: '第三者による船積み前検査と、統一した報告様式。この2つを柱にした地域基準をつくり、信頼性と追跡可能性を高める。',
        },
      ],
    },
    {
      heading: '市場と仕組みを設計する',
      items: [
        {
          tag: '事前仕分け',
          text: '廃棄物を減らしながら価格も手頃に保てるよう、事前仕分けのルールを設計する。',
        },
        {
          tag: 'リサイクル',
          text: 'もう着られない繊維を処理するリサイクル設備に投資する。',
        },
      ],
    },
  ],
  source: 'レポート第5章',
};
