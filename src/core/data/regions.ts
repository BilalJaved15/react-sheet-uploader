/**
 * Reference data for the `country`, `us-state-territory` and `phone-number`
 * field types.
 *
 * Stored as delimited strings rather than object literals: the tables are large
 * and this keeps the bundled size down while staying readable in source. They
 * are parsed once into lookup maps at module load.
 */

/** ISO 3166-1: `alpha2|alpha3|name`. */
const ISO_3166_1 = `
AF|AFG|Afghanistan;AX|ALA|Åland Islands;AL|ALB|Albania;DZ|DZA|Algeria;AS|ASM|American Samoa;
AD|AND|Andorra;AO|AGO|Angola;AI|AIA|Anguilla;AQ|ATA|Antarctica;AG|ATG|Antigua and Barbuda;
AR|ARG|Argentina;AM|ARM|Armenia;AW|ABW|Aruba;AU|AUS|Australia;AT|AUT|Austria;AZ|AZE|Azerbaijan;
BS|BHS|Bahamas;BH|BHR|Bahrain;BD|BGD|Bangladesh;BB|BRB|Barbados;BY|BLR|Belarus;BE|BEL|Belgium;
BZ|BLZ|Belize;BJ|BEN|Benin;BM|BMU|Bermuda;BT|BTN|Bhutan;BO|BOL|Bolivia;
BQ|BES|Bonaire, Sint Eustatius and Saba;BA|BIH|Bosnia and Herzegovina;BW|BWA|Botswana;
BV|BVT|Bouvet Island;BR|BRA|Brazil;IO|IOT|British Indian Ocean Territory;BN|BRN|Brunei Darussalam;
BG|BGR|Bulgaria;BF|BFA|Burkina Faso;BI|BDI|Burundi;CV|CPV|Cabo Verde;KH|KHM|Cambodia;
CM|CMR|Cameroon;CA|CAN|Canada;KY|CYM|Cayman Islands;CF|CAF|Central African Republic;TD|TCD|Chad;
CL|CHL|Chile;CN|CHN|China;CX|CXR|Christmas Island;CC|CCK|Cocos (Keeling) Islands;CO|COL|Colombia;
KM|COM|Comoros;CG|COG|Congo;CD|COD|Congo, Democratic Republic of the;CK|COK|Cook Islands;
CR|CRI|Costa Rica;CI|CIV|Côte d'Ivoire;HR|HRV|Croatia;CU|CUB|Cuba;CW|CUW|Curaçao;CY|CYP|Cyprus;
CZ|CZE|Czechia;DK|DNK|Denmark;DJ|DJI|Djibouti;DM|DMA|Dominica;DO|DOM|Dominican Republic;
EC|ECU|Ecuador;EG|EGY|Egypt;SV|SLV|El Salvador;GQ|GNQ|Equatorial Guinea;ER|ERI|Eritrea;
EE|EST|Estonia;SZ|SWZ|Eswatini;ET|ETH|Ethiopia;FK|FLK|Falkland Islands;FO|FRO|Faroe Islands;
FJ|FJI|Fiji;FI|FIN|Finland;FR|FRA|France;GF|GUF|French Guiana;PF|PYF|French Polynesia;
TF|ATF|French Southern Territories;GA|GAB|Gabon;GM|GMB|Gambia;GE|GEO|Georgia;DE|DEU|Germany;
GH|GHA|Ghana;GI|GIB|Gibraltar;GR|GRC|Greece;GL|GRL|Greenland;GD|GRD|Grenada;GP|GLP|Guadeloupe;
GU|GUM|Guam;GT|GTM|Guatemala;GG|GGY|Guernsey;GN|GIN|Guinea;GW|GNB|Guinea-Bissau;GY|GUY|Guyana;
HT|HTI|Haiti;HM|HMD|Heard Island and McDonald Islands;VA|VAT|Holy See;HN|HND|Honduras;
HK|HKG|Hong Kong;HU|HUN|Hungary;IS|ISL|Iceland;IN|IND|India;ID|IDN|Indonesia;IR|IRN|Iran;
IQ|IRQ|Iraq;IE|IRL|Ireland;IM|IMN|Isle of Man;IL|ISR|Israel;IT|ITA|Italy;JM|JAM|Jamaica;
JP|JPN|Japan;JE|JEY|Jersey;JO|JOR|Jordan;KZ|KAZ|Kazakhstan;KE|KEN|Kenya;KI|KIR|Kiribati;
KP|PRK|Korea, Democratic People's Republic of;KR|KOR|Korea, Republic of;KW|KWT|Kuwait;
KG|KGZ|Kyrgyzstan;LA|LAO|Lao People's Democratic Republic;LV|LVA|Latvia;LB|LBN|Lebanon;
LS|LSO|Lesotho;LR|LBR|Liberia;LY|LBY|Libya;LI|LIE|Liechtenstein;LT|LTU|Lithuania;
LU|LUX|Luxembourg;MO|MAC|Macao;MG|MDG|Madagascar;MW|MWI|Malawi;MY|MYS|Malaysia;MV|MDV|Maldives;
ML|MLI|Mali;MT|MLT|Malta;MH|MHL|Marshall Islands;MQ|MTQ|Martinique;MR|MRT|Mauritania;
MU|MUS|Mauritius;YT|MYT|Mayotte;MX|MEX|Mexico;FM|FSM|Micronesia;MD|MDA|Moldova;MC|MCO|Monaco;
MN|MNG|Mongolia;ME|MNE|Montenegro;MS|MSR|Montserrat;MA|MAR|Morocco;MZ|MOZ|Mozambique;
MM|MMR|Myanmar;NA|NAM|Namibia;NR|NRU|Nauru;NP|NPL|Nepal;NL|NLD|Netherlands;NC|NCL|New Caledonia;
NZ|NZL|New Zealand;NI|NIC|Nicaragua;NE|NER|Niger;NG|NGA|Nigeria;NU|NIU|Niue;NF|NFK|Norfolk Island;
MK|MKD|North Macedonia;MP|MNP|Northern Mariana Islands;NO|NOR|Norway;OM|OMN|Oman;PK|PAK|Pakistan;
PW|PLW|Palau;PS|PSE|Palestine, State of;PA|PAN|Panama;PG|PNG|Papua New Guinea;PY|PRY|Paraguay;
PE|PER|Peru;PH|PHL|Philippines;PN|PCN|Pitcairn;PL|POL|Poland;PT|PRT|Portugal;PR|PRI|Puerto Rico;
QA|QAT|Qatar;RE|REU|Réunion;RO|ROU|Romania;RU|RUS|Russian Federation;RW|RWA|Rwanda;
BL|BLM|Saint Barthélemy;SH|SHN|Saint Helena, Ascension and Tristan da Cunha;
KN|KNA|Saint Kitts and Nevis;LC|LCA|Saint Lucia;MF|MAF|Saint Martin (French part);
PM|SPM|Saint Pierre and Miquelon;VC|VCT|Saint Vincent and the Grenadines;WS|WSM|Samoa;
SM|SMR|San Marino;ST|STP|Sao Tome and Principe;SA|SAU|Saudi Arabia;SN|SEN|Senegal;RS|SRB|Serbia;
SC|SYC|Seychelles;SL|SLE|Sierra Leone;SG|SGP|Singapore;SX|SXM|Sint Maarten (Dutch part);
SK|SVK|Slovakia;SI|SVN|Slovenia;SB|SLB|Solomon Islands;SO|SOM|Somalia;ZA|ZAF|South Africa;
GS|SGS|South Georgia and the South Sandwich Islands;SS|SSD|South Sudan;ES|ESP|Spain;
LK|LKA|Sri Lanka;SD|SDN|Sudan;SR|SUR|Suriname;SJ|SJM|Svalbard and Jan Mayen;SE|SWE|Sweden;
CH|CHE|Switzerland;SY|SYR|Syrian Arab Republic;TW|TWN|Taiwan;TJ|TJK|Tajikistan;TZ|TZA|Tanzania;
TH|THA|Thailand;TL|TLS|Timor-Leste;TG|TGO|Togo;TK|TKL|Tokelau;TO|TON|Tonga;
TT|TTO|Trinidad and Tobago;TN|TUN|Tunisia;TR|TUR|Türkiye;TM|TKM|Turkmenistan;
TC|TCA|Turks and Caicos Islands;TV|TUV|Tuvalu;UG|UGA|Uganda;UA|UKR|Ukraine;
AE|ARE|United Arab Emirates;GB|GBR|United Kingdom;US|USA|United States;
UM|UMI|United States Minor Outlying Islands;UY|URY|Uruguay;UZ|UZB|Uzbekistan;VU|VUT|Vanuatu;
VE|VEN|Venezuela;VN|VNM|Viet Nam;VG|VGB|Virgin Islands (British);VI|VIR|Virgin Islands (U.S.);
WF|WLF|Wallis and Futuna;EH|ESH|Western Sahara;YE|YEM|Yemen;ZM|ZMB|Zambia;ZW|ZWE|Zimbabwe
`;

/** Colloquial names that files use but ISO does not list. */
const COUNTRY_ALIASES: Record<string, string> = {
  'united states of america': 'US',
  usa: 'US',
  'u.s.a.': 'US',
  'u.s.': 'US',
  us: 'US',
  america: 'US',
  uk: 'GB',
  'u.k.': 'GB',
  'great britain': 'GB',
  britain: 'GB',
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
  'northern ireland': 'GB',
  russia: 'RU',
  'south korea': 'KR',
  'north korea': 'KP',
  vietnam: 'VN',
  'ivory coast': 'CI',
  'czech republic': 'CZ',
  turkey: 'TR',
  swaziland: 'SZ',
  macedonia: 'MK',
  burma: 'MM',
  'cape verde': 'CV',
  holland: 'NL',
  uae: 'AE',
  'united arab emirates': 'AE',
  'hong kong sar': 'HK',
  'vatican city': 'VA',
  laos: 'LA',
  syria: 'SY',
  brunei: 'BN',
  moldova: 'MD',
  bolivia: 'BO',
  tanzania: 'TZ',
  venezuela: 'VE',
  iran: 'IR',
  'democratic republic of the congo': 'CD',
  drc: 'CD',
  'republic of the congo': 'CG',
  'east timor': 'TL',
  palestine: 'PS',
  'south sudan': 'SS',
};

export interface Country {
  alpha2: string;
  alpha3: string;
  name: string;
}

export const COUNTRIES: Country[] = ISO_3166_1.split(';')
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => {
    const [alpha2 = '', alpha3 = '', name = ''] = entry.split('|');
    return { alpha2, alpha3, name };
  });

/** Every recognised spelling, lowercased, mapped to its alpha-2 code. */
const COUNTRY_LOOKUP = new Map<string, string>();
for (const country of COUNTRIES) {
  COUNTRY_LOOKUP.set(country.alpha2.toLowerCase(), country.alpha2);
  COUNTRY_LOOKUP.set(country.alpha3.toLowerCase(), country.alpha2);
  COUNTRY_LOOKUP.set(country.name.toLowerCase(), country.alpha2);
  // "Korea, Republic of" is also searched for as "Korea".
  const comma = country.name.indexOf(',');
  if (comma > 0) {
    const short = country.name.slice(0, comma).toLowerCase();
    if (!COUNTRY_LOOKUP.has(short)) COUNTRY_LOOKUP.set(short, country.alpha2);
  }
}
for (const [alias, code] of Object.entries(COUNTRY_ALIASES)) {
  COUNTRY_LOOKUP.set(alias, code);
}

const ALPHA2_TO_COUNTRY = new Map(COUNTRIES.map((c) => [c.alpha2, c]));

/** Resolves any recognised spelling to an ISO alpha-2 code, or null. */
export function lookupCountry(input: string): Country | null {
  const normalized = input.trim().toLowerCase().replace(/\s+/g, ' ');
  const alpha2 = COUNTRY_LOOKUP.get(normalized);
  return alpha2 ? (ALPHA2_TO_COUNTRY.get(alpha2) ?? null) : null;
}

/* -------------------------------------------------------------------------- */
/* US states and territories                                                   */
/* -------------------------------------------------------------------------- */

/** `code|name`. Includes DC, inhabited territories, and military post codes. */
const US_STATES_RAW = `
AL|Alabama;AK|Alaska;AZ|Arizona;AR|Arkansas;CA|California;CO|Colorado;CT|Connecticut;
DE|Delaware;FL|Florida;GA|Georgia;HI|Hawaii;ID|Idaho;IL|Illinois;IN|Indiana;IA|Iowa;
KS|Kansas;KY|Kentucky;LA|Louisiana;ME|Maine;MD|Maryland;MA|Massachusetts;MI|Michigan;
MN|Minnesota;MS|Mississippi;MO|Missouri;MT|Montana;NE|Nebraska;NV|Nevada;NH|New Hampshire;
NJ|New Jersey;NM|New Mexico;NY|New York;NC|North Carolina;ND|North Dakota;OH|Ohio;
OK|Oklahoma;OR|Oregon;PA|Pennsylvania;RI|Rhode Island;SC|South Carolina;SD|South Dakota;
TN|Tennessee;TX|Texas;UT|Utah;VT|Vermont;VA|Virginia;WA|Washington;WV|West Virginia;
WI|Wisconsin;WY|Wyoming;DC|District of Columbia;AS|American Samoa;GU|Guam;
MP|Northern Mariana Islands;PR|Puerto Rico;UM|United States Minor Outlying Islands;
VI|U.S. Virgin Islands;AA|Armed Forces Americas;AE|Armed Forces Europe;AP|Armed Forces Pacific
`;

export interface UsState {
  code: string;
  name: string;
}

export const US_STATES: UsState[] = US_STATES_RAW.split(';')
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => {
    const [code = '', name = ''] = entry.split('|');
    return { code, name };
  });

const US_STATE_LOOKUP = new Map<string, UsState>();
for (const state of US_STATES) {
  US_STATE_LOOKUP.set(state.code.toLowerCase(), state);
  US_STATE_LOOKUP.set(state.name.toLowerCase(), state);
}
// Four-letter postal abbreviations still in circulation on older exports.
const US_STATE_ALIASES: Record<string, string> = {
  calif: 'CA',
  mass: 'MA',
  penn: 'PA',
  penna: 'PA',
  tenn: 'TN',
  wash: 'WA',
  'washington dc': 'DC',
  'washington d.c.': 'DC',
  'virgin islands': 'VI',
};
for (const [alias, code] of Object.entries(US_STATE_ALIASES)) {
  const state = US_STATE_LOOKUP.get(code.toLowerCase());
  if (state) US_STATE_LOOKUP.set(alias, state);
}

export function lookupUsState(input: string): UsState | null {
  const normalized = input.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\.$/, '');
  return US_STATE_LOOKUP.get(normalized) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Phone calling codes                                                         */
/* -------------------------------------------------------------------------- */

/** `callingCode:alpha2,alpha2,...` — grouped because codes are shared. */
const CALLING_CODES_RAW = `
1:US,CA,BS,BB,AI,AG,VG,VI,KY,BM,GD,TC,MS,MP,GU,AS,SX,LC,DM,VC,PR,DO,JM,KN,TT,UM;
7:RU,KZ;20:EG;27:ZA;30:GR;31:NL;32:BE;33:FR;34:ES;36:HU;39:IT,VA;40:RO;41:CH;43:AT;
44:GB,GG,IM,JE;45:DK;46:SE;47:NO,SJ,BV;48:PL;49:DE;51:PE;52:MX;53:CU;54:AR;55:BR;56:CL;
57:CO;58:VE;60:MY;61:AU,CX,CC;62:ID;63:PH;64:NZ,PN;65:SG;66:TH;81:JP;82:KR;84:VN;86:CN;
90:TR;91:IN;92:PK;93:AF;94:LK;95:MM;98:IR;211:SS;212:MA,EH;213:DZ;216:TN;218:LY;220:GM;
221:SN;222:MR;223:ML;224:GN;225:CI;226:BF;227:NE;228:TG;229:BJ;230:MU;231:LR;232:SL;233:GH;
234:NG;235:TD;236:CF;237:CM;238:CV;239:ST;240:GQ;241:GA;242:CG;243:CD;244:AO;245:GW;246:IO;
248:SC;249:SD;250:RW;251:ET;252:SO;253:DJ;254:KE;255:TZ;256:UG;257:BI;258:MZ;260:ZM;261:MG;
262:RE,YT,TF;263:ZW;264:NA;265:MW;266:LS;267:BW;268:SZ;269:KM;290:SH;291:ER;297:AW;298:FO;
299:GL;350:GI;351:PT;352:LU;353:IE;354:IS;355:AL;356:MT;357:CY;358:FI,AX;359:BG;370:LT;
371:LV;372:EE;373:MD;374:AM;375:BY;376:AD;377:MC;378:SM;380:UA;381:RS;382:ME;385:HR;386:SI;
387:BA;389:MK;420:CZ;421:SK;423:LI;500:FK,GS;501:BZ;502:GT;503:SV;504:HN;505:NI;506:CR;
507:PA;508:PM;509:HT;590:GP,BL,MF;591:BO;592:GY;593:EC;594:GF;595:PY;596:MQ;597:SR;598:UY;
599:CW,BQ;670:TL;672:NF,HM,AQ;673:BN;674:NR;675:PG;676:TO;677:SB;678:VU;679:FJ;680:PW;
681:WF;682:CK;683:NU;685:WS;686:KI;687:NC;688:TV;689:PF;690:TK;691:FM;692:MH;850:KP;852:HK;
853:MO;855:KH;856:LA;880:BD;886:TW;960:MV;961:LB;962:JO;963:SY;964:IQ;965:KW;966:SA;967:YE;
968:OM;970:PS;971:AE;972:IL;973:BH;974:QA;975:BT;976:MN;977:NP;992:TJ;993:TM;994:AZ;995:GE;
996:KG;998:UZ
`;

/** ISO alpha-2 -> international calling code, without the leading `+`. */
export const CALLING_CODE_BY_COUNTRY = new Map<string, string>();
/** Calling codes, longest first, for greedy prefix matching on E.164 input. */
export const CALLING_CODES: string[] = [];

for (const group of CALLING_CODES_RAW.split(';')) {
  const trimmed = group.trim();
  if (!trimmed) continue;
  const [code, countries] = trimmed.split(':');
  if (!code || !countries) continue;
  CALLING_CODES.push(code);
  for (const alpha2 of countries.split(',')) {
    CALLING_CODE_BY_COUNTRY.set(alpha2.trim(), code);
  }
}
CALLING_CODES.sort((a, b) => b.length - a.length);
