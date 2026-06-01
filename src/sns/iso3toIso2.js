const ISO3_TO_ISO2 = {
  AFG:'AF', ALB:'AL', DZA:'DZ', AGO:'AO', ARG:'AR', ARM:'AM', AUS:'AU', AUT:'AT',
  AZE:'AZ', BHS:'BS', BHR:'BH', BGD:'BD', BRB:'BB', BLR:'BY', BEL:'BE', BLZ:'BZ',
  BEN:'BJ', BTN:'BT', BOL:'BO', BIH:'BA', BWA:'BW', BRA:'BR', BRN:'BN', BGR:'BG',
  BFA:'BF', BDI:'BI', KHM:'KH', CMR:'CM', CAN:'CA', CAF:'CF', TCD:'TD', CHL:'CL',
  CHN:'CN', COL:'CO', COM:'KM', COG:'CG', COD:'CD', CRI:'CR', CIV:'CI', HRV:'HR',
  CUB:'CU', CYP:'CY', CZE:'CZ', DNK:'DK', DJI:'DJ', DOM:'DO', ECU:'EC', EGY:'EG',
  SLV:'SV', GNQ:'GQ', ERI:'ER', EST:'EE', ETH:'ET', FJI:'FJ', FIN:'FI', FRA:'FR',
  GAB:'GA', GMB:'GM', GEO:'GE', DEU:'DE', GHA:'GH', GRC:'GR', GTM:'GT', GIN:'GN',
  GNB:'GW', GUY:'GY', HTI:'HT', HND:'HN', HKG:'HK', HUN:'HU', ISL:'IS', IND:'IN',
  IDN:'ID', IRN:'IR', IRQ:'IQ', IRL:'IE', ISR:'IL', ITA:'IT', JAM:'JM', JPN:'JP',
  JOR:'JO', KAZ:'KZ', KEN:'KE', PRK:'KP', KOR:'KR', KWT:'KW', KGZ:'KG', LAO:'LA',
  LVA:'LV', LBN:'LB', LSO:'LS', LBR:'LR', LBY:'LY', LTU:'LT', LUX:'LU', MAC:'MO',
  MDG:'MG', MWI:'MW', MYS:'MY', MDV:'MV', MLI:'ML', MLT:'MT', MRT:'MR', MUS:'MU',
  MEX:'MX', MDA:'MD', MNG:'MN', MNE:'ME', MAR:'MA', MOZ:'MZ', MMR:'MM', NAM:'NA',
  NPL:'NP', NLD:'NL', NZL:'NZ', NIC:'NI', NER:'NE', NGA:'NG', NOR:'NO', OMN:'OM',
  PAK:'PK', PAN:'PA', PNG:'PG', PRY:'PY', PER:'PE', PHL:'PH', POL:'PL', PRT:'PT',
  QAT:'QA', ROU:'RO', RUS:'RU', RWA:'RW', SAU:'SA', SEN:'SN', SRB:'RS', SLE:'SL',
  SGP:'SG', SVK:'SK', SVN:'SI', SLB:'SB', SOM:'SO', ZAF:'ZA', SSD:'SS', ESP:'ES',
  LKA:'LK', SDN:'SD', SUR:'SR', SWZ:'SZ', SWE:'SE', CHE:'CH', SYR:'SY', TJK:'TJ',
  TZA:'TZ', THA:'TH', TLS:'TL', TGO:'TG', TTO:'TT', TUN:'TN', TUR:'TR', TKM:'TM',
  UGA:'UG', UKR:'UA', ARE:'AE', GBR:'GB', USA:'US', URY:'UY', UZB:'UZ', VUT:'VU',
  VEN:'VE', VNM:'VN', YEM:'YE', ZMB:'ZM', ZWE:'ZW',
};

export function getFlag(iso3) {
  const iso2 = ISO3_TO_ISO2[iso3];
  if (!iso2) return '🏳';
  return iso2.split('').map(c =>
    String.fromCodePoint(c.charCodeAt(0) + 127397)
  ).join('');
}

// Returns lowercase ISO2 for use with flag-icons CSS (e.g. "us", "de")
export function iso2Lower(iso3) {
  const v = ISO3_TO_ISO2[iso3];
  return v ? v.toLowerCase() : null;
}
