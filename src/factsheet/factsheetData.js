// ─────────────────────────────────────────────────────────────────────────────
// SMEP Fact Sheet — source data
//
// Every figure below is transcribed faithfully from the SMEP / UNCTAD fact sheet
// "Trade in secondhand clothing — Uganda, the United Republic of Tanzania &
// the United States of America" (SMEP, 2026).
//
// These are REPORT-derived figures (field research + national revenue authority +
// Full Cycle Resource analysis). They are a different evidence base than the
// BACI/UN Comtrade mirror data that drives the live trade map, and must always be
// shown with their source. Do not present map aggregates as "proof" of these.
// ─────────────────────────────────────────────────────────────────────────────

export const META = {
  brand: 'SMEP',
  brandFull: 'Sustainable Manufacturing and Environmental Pollution',
  title: 'Trade in Secondhand Clothing',
  countries: ['Uganda', 'The United Republic of Tanzania', 'The United States of America'],
  citation:
    'SMEP, 2026. Trade in secondhand clothing: analysis of markets in Uganda, ' +
    'the United Republic of Tanzania and the United States of America.',
  dataSources:
    'UN Comtrade · Revenue Authority (Uganda) · Revenue Authority (United Republic of Tanzania) · WasteAid · Full Cycle Resource',
  fieldwork:
    'Owino Market, Kampala, Uganda (May–Jun 2024) · Kariakoo, Ilala & Karume, Dar es Salaam (Jul–Aug 2024)',
  partners: ['UN Trade and Development', 'UK International Development', 'South South North', 'Pegasys'],
  reportUrl: 'https://unctad.org/topic/trade-analysis/trade-and-environment/SMEP',
};

// 01 — Headline finding
export const KEY_FINDING = {
  itemsAnalysed: 244500,
  rewearablePct: 96,
  lead:
    'Across major markets in Uganda and the United Republic of Tanzania, only a small share of ' +
    'analysed secondhand clothing items were deemed non-rewearable. That finding challenges common ' +
    'narratives of low-quality or “waste” imports.',
  source: 'SMEP field research, Uganda & the United Republic of Tanzania, 2024',
};

// 02 — Quality & composition
export const QUALITY = {
  grades: [
    { grade: 'A', pct: 83, label: 'High quality, higher priced, often nearly new items' },
    { grade: 'B', pct: 15, label: 'Good quality, more affordable, minor signs of wear' },
    { grade: 'C', pct: 2,  label: 'Lower quality, lower priced, visible signs of wear' },
  ],
  gradeIntro:
    'Distribution of bale quality grades (Grade A, B and C) purchased by 53 importers ' +
    'in Uganda and the United Republic of Tanzania.',
  nonRewearablePct: 4,
  nonRewearable: [
    { key: 'rags',  label: 'Rags',  pct: 2.9 },
    { key: 'waste', label: 'Waste', pct: 1.1 },
  ],
  nonRewearableNote:
    'Rags, though non-rewearable, retain value unlike textile waste and are commonly used ' +
    'in industrial and commercial cleaning.',
  wastePerBale: [
    { country: 'Uganda', range: [0.9, 1.0] },
    { country: 'United Republic of Tanzania', range: [1.3, 1.5] },
  ],
  wastePerBaleNote: 'Estimated textile-waste share per bale, based on bale composition analysis of clothing subcategories by grade.',
  source: 'Bale composition analysis, 53 importers (report §3)',
};

// 03 — Supply chain & trade flows (2-stage sorting via Pakistan & India)
export const SUPPLY_CHAIN = {
  origin: { name: 'United States of America', iso2: 'us' },
  sorting: { label: '2-stage sorting', note: 'Concentrated in Pakistan, Malaysia & UAE' },
  destinations: [
    { name: 'Uganda', iso2: 'ug', totalKg: 80.0, usKg: 2.0 },
    { name: 'United Republic of Tanzania', iso2: 'tz', totalKg: 86.3, usKg: 8.0 },
  ],
  unit: 'million kg',
  source: 'UN Comtrade; Full Cycle Resource (report §2)',
};

// 04 — The China shift: import market share by origin, 2018 → 2023
export const CHINA_SHIFT = {
  intro:
    'Between 2018 and 2023 the origin of secondhand clothing imports shifted sharply: ' +
    'China’s share rose while the United States’ share fell in both markets.',
  markets: [
    {
      country: 'Uganda',
      china: { from: 29.9, to: 47.3, delta: +17.4 },
      us:    { from: 8.2,  to: 2.5,  delta: -5.7 },
    },
    {
      country: 'United Republic of Tanzania',
      china: { from: 26.4, to: 55.5, delta: +29.1 },
      us:    { from: 13.9, to: 9.1,  delta: -4.8 },
    },
  ],
  fromYear: 2018,
  toYear: 2023,
  source: 'UN Comtrade, analysed by Full Cycle Resource (report Tables 8–9)',
  caveat:
    'These origin shares come from national-revenue-authority records analysed by Full Cycle Resource; ' +
    'the live map uses BACI/UN Comtrade mirror data and may differ slightly.',
};

// 05 — Africa context (2023)
export const AFRICA_CONTEXT = {
  totalMillionKg: 1266,
  ugTzSharePct: 13.1,
  ugTzMillionKg: 166.3,
  year: 2023,
  label: 'Uganda + the United Republic of Tanzania share of Africa’s SHC imports',
  source: 'UN Comtrade (report §2)',
};

// 06 — Socioeconomic impact
export const SOCIOECONOMIC = {
  tradersSurveyed: 2147,
  familyBenefitPct: 98,
  familyBenefitLabel: 'report family financial benefits',
  ownership: { male: 66, female: 34 },
  mobility: {
    stages: ['Bale carrier', 'Vendors', 'Retailers', 'Importer'],
    stats: [
      { pct: 89, label: 'of retailers reported advancing up the value chain' },
      { pct: 61, label: 'of tertiary-educated traders advanced up the value chain' },
      { pct: 77, label: 'of SHC business owners advanced up the value chain' },
    ],
  },
  source: 'Trader survey, Uganda & the United Republic of Tanzania (report §4)',
};

// 07 — Affordability & cost structure (Uganda) + container costs
export const AFFORDABILITY = {
  dailyIncomeUSD: 2.68,
  dailyIncomeNote: 'Estimated daily income for approximately 50% of Ugandans (World Bank Poverty and Equity Index).',
  items: [
    { key: 'new', label: 'New clothing item', usd: 6.36 },
    { key: 'shc', label: 'Secondhand item',   usd: 2.69 },
  ],
  affordabilityNote: 'Cost expressed in days of income for an average Ugandan household.',
  containerCosts: [
    { country: 'Uganda', usd: 57080, dutyPct: 77 },
    { country: 'United Republic of Tanzania', usd: 47954, dutyPct: 38 },
  ],
  containerNote: 'Total cost of a 40-ft container, inclusive of taxes, duties and levies; the ring shows the duty/levy share of total cost.',
  source: 'TRA / URA, analysed by Full Cycle Resource; World Bank (report §4)',
};

// 08 — Sector context: global + United States
export const SECTOR = {
  global: {
    marketUSDTrillion: 1.7,
    employedMillion: 300,
    fiber: { from: { year: 2023, mt: 124 }, to: { year: 2030, mt: 160 }, growthPct: 29, years: 7 },
    qualityGainPct: 90,
    qualityGainNote: 'Communication with sorters leads to substantial quality improvements in imported SHC, according to importers.',
    source: 'Global textile & apparel sector (report §1)',
  },
  us: {
    consumptionYear: 2024,
    garmentsPerPersonNow: 68,
    garmentsPerPerson1960s: 25,
    imports: { from: { year: 2000, bn: 33 }, to: { year: 2023, bn: 93 }, growthPct: 182 },
    importsNote: 'The United States measures textile and apparel imports in square metres.',
    textileWasteMT: 17,
    wasteFate: [
      { key: 'landfill',    label: 'end up in landfills', pct: 66 },
      { key: 'incinerated', label: 'incinerated',         pct: 19 },
      { key: 'recovered',   label: 'diverted for recovery', pct: 14.7 },
    ],
    source: 'US textile & apparel sector; WasteAid (report §1)',
  },
};

// 09 — Policy priorities
export const POLICY = {
  groups: [
    {
      heading: 'Regulatory alignment',
      items: [
        {
          tag: 'HS 6309 · BC B3030',
          text: 'Reduce regulatory inconsistencies and trade frictions by aligning HS 6309 and Basel Convention B3030 definitions.',
        },
        {
          tag: 'EAS 356:2024',
          text: 'Strengthen trust and traceability by establishing a regional standard with third-party pre-shipment inspection and standardized reporting.',
        },
      ],
    },
    {
      heading: 'Market and system design',
      items: [
        {
          tag: 'Pre-sorting',
          text: 'Design pre-sorting regulations that balance waste reduction with affordability.',
        },
        {
          tag: 'Recycling',
          text: 'Invest in recycling infrastructure for non-rewearable textiles.',
        },
      ],
    },
  ],
  source: 'report §5',
};
