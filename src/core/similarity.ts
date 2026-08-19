/**
 * String similarity used for header auto-matching and fuzzy select-option
 * resolution.
 *
 * Header matching is not a general string-distance problem. Spreadsheet headers
 * abbreviate ("DOB", "Qty", "Cust Ref #"), reorder words ("Address Email"),
 * and pad with noise words ("Customer Email Address"). Character bigrams alone
 * score `DOB` against `Date of Birth` at roughly zero, so the score here blends
 * three views of the pair and takes the strongest:
 *
 *   1. Sørensen–Dice over character bigrams — typos and inflections.
 *   2. Token overlap after abbreviation expansion — word order and synonyms.
 *   3. Containment — a short alias fully inside a longer header.
 */

/** Lowercases and strips punctuation so `first_name` ≈ `First Name`. */
export function normalizeForMatch(input: string): string {
  return input
    .toLowerCase()
    .replace(/[_\-.]+/g, ' ')
    .replace(/[^\p{L}\p{N} ]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Splits `customerReference` and `CustomerID` into words, so camelCase field
 * keys tokenize the same way as the spaced headers they should match.
 */
function splitCamelCase(input: string): string {
  return input
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, '$1 $2');
}

/**
 * Words carrying no distinguishing signal in a header. Dropped before token
 * comparison so "Date of Birth" and "Birth Date" line up, but never dropped if
 * they are all a string has.
 */
const NOISE_WORDS = new Set(['of', 'the', 'a', 'an', 'and', 'for', 'to', 'in', 'no', 'nr']);

/**
 * Abbreviations and synonyms seen in real spreadsheet exports, mapped to the
 * canonical words a schema field is likely to use. Keys are single normalized
 * tokens; values expand to one or more tokens.
 *
 * This is deliberately a flat, boring list rather than a stemmer — spreadsheet
 * shorthand is idiomatic, not morphological, and a wrong expansion costs more
 * than a missing one.
 */
const SYNONYMS: Record<string, string[]> = {
  // Identity
  fname: ['first', 'name'],
  firstname: ['first', 'name'],
  lname: ['last', 'name'],
  lastname: ['last', 'name'],
  surname: ['last', 'name'],
  forename: ['first', 'name'],
  given: ['first'],
  family: ['last'],
  middlename: ['middle', 'name'],
  mname: ['middle', 'name'],
  fullname: ['full', 'name'],
  nm: ['name'],

  // Contact
  email: ['email'],
  eml: ['email'],
  mail: ['email'],
  emailaddress: ['email'],
  phone: ['phone'],
  phonenumber: ['phone'],
  tel: ['phone'],
  telephone: ['phone'],
  mobile: ['phone'],
  cell: ['phone'],
  cellphone: ['phone'],
  msisdn: ['phone'],
  fax: ['fax'],

  // Address
  addr: ['address'],
  add: ['address'],
  street: ['street'],
  addressline: ['address'],
  st: ['street'],
  city: ['city'],
  town: ['city'],
  province: ['state'],
  region: ['state'],
  county: ['state'],
  zip: ['postal', 'code'],
  zipcode: ['postal', 'code'],
  postcode: ['postal', 'code'],
  postal: ['postal'],
  country: ['country'],
  ctry: ['country'],
  nation: ['country'],

  // Dates
  dob: ['date', 'birth'],
  birthdate: ['date', 'birth'],
  birthday: ['date', 'birth'],
  bday: ['date', 'birth'],
  dt: ['date'],
  created: ['created', 'date'],
  createdat: ['created', 'date'],
  updated: ['updated', 'date'],
  updatedat: ['updated', 'date'],
  timestamp: ['date', 'time'],
  ts: ['date', 'time'],

  // Commerce
  qty: ['quantity'],
  quan: ['quantity'],
  amt: ['amount'],
  amount: ['amount'],
  price: ['price'],
  cost: ['price'],
  unitprice: ['unit', 'price'],
  total: ['total'],
  subtotal: ['subtotal'],
  curr: ['currency'],
  ccy: ['currency'],
  disc: ['discount'],
  sku: ['sku'],
  upc: ['barcode'],
  ean: ['barcode'],
  inv: ['invoice'],
  po: ['purchase', 'order'],
  vat: ['tax'],
  gst: ['tax'],

  // Generic
  id: ['id'],
  identifier: ['id'],
  num: ['number'],
  no: ['number'],
  nbr: ['number'],
  ref: ['reference'],
  refno: ['reference', 'number'],
  desc: ['description'],
  descr: ['description'],
  notes: ['notes'],
  note: ['notes'],
  comment: ['notes'],
  comments: ['notes'],
  remarks: ['notes'],
  cust: ['customer'],
  client: ['customer'],
  acct: ['account'],
  acc: ['account'],
  org: ['organization'],
  company: ['company'],
  co: ['company'],
  emp: ['employee'],
  dept: ['department'],
  mgr: ['manager'],
  pct: ['percent'],
  perc: ['percent'],
  wt: ['weight'],
  stat: ['status'],
  active: ['active'],
  url: ['url'],
  website: ['url'],
  link: ['url'],
};

/**
 * Normalized string to a set of canonical tokens.
 *
 * Splits camelCase, drops noise words, then expands each token through the
 * synonym table. A token that expands is replaced by its expansion; a token
 * that does not is kept as-is.
 */
export function tokenize(input: string): Set<string> {
  const normalized = normalizeForMatch(splitCamelCase(input));
  if (normalized === '') return new Set();

  const raw = normalized.split(' ');
  // Single letters are punctuation fallout ("E-Mail" -> "e mail"), not signal.
  const meaningful = raw.filter((token) => token.length > 1 && !NOISE_WORDS.has(token));
  const words = meaningful.length > 0 ? meaningful : raw;

  const tokens = new Set<string>();
  for (const word of words) {
    const expansion = SYNONYMS[word];
    if (expansion) {
      for (const part of expansion) tokens.add(part);
    } else {
      tokens.add(word);
    }
  }
  return tokens;
}

function bigrams(input: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i < input.length - 1; i += 1) {
    const pair = input.slice(i, i + 2);
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }
  return counts;
}

/** Sørensen–Dice over character bigrams. Catches typos and inflections. */
function diceScore(left: string, right: string): number {
  // Bigrams are undefined for single characters, so compare them directly.
  if (left.length === 1 || right.length === 1) return left === right ? 1 : 0;

  const leftGrams = bigrams(left);
  const rightGrams = bigrams(right);

  let intersection = 0;
  let leftTotal = 0;
  for (const [gram, count] of leftGrams) {
    leftTotal += count;
    const other = rightGrams.get(gram);
    if (other) intersection += Math.min(count, other);
  }

  let rightTotal = 0;
  for (const count of rightGrams.values()) rightTotal += count;

  return (2 * intersection) / (leftTotal + rightTotal);
}

/**
 * Token-set overlap, weighted toward the smaller set.
 *
 * Plain Jaccard punishes a long header for its extra words, so "Customer Email
 * Address" scores poorly against "Email" despite being an obvious match. This
 * uses overlap over the smaller set, damped by how much larger the other set
 * is, so extra words cost something but not everything.
 */
function tokenScore(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared += 1;
  }
  if (shared === 0) return 0;

  const smaller = Math.min(left.size, right.size);
  const larger = Math.max(left.size, right.size);

  const coverage = shared / smaller;
  // Extra words on the longer side dilute confidence, with a floor of 0.6 so a
  // full containment match stays well above the default threshold.
  const lengthPenalty = 0.6 + 0.4 * (smaller / larger);

  return coverage * lengthPenalty;
}

/**
 * Returns a score in [0, 1]; 1 means the normalized strings are identical.
 *
 * The blend takes the strongest of the three views rather than averaging them:
 * each view is a sufficient reason to believe in a match, and averaging lets a
 * view that is structurally blind to the pair (bigrams against an acronym) veto
 * one that is not.
 */
export function similarity(a: string, b: string): number {
  const left = normalizeForMatch(a);
  const right = normalizeForMatch(b);

  if (left === right) return left === '' ? 0 : 1;
  if (left.length === 0 || right.length === 0) return 0;

  const leftTokens = tokenize(a);
  const rightTokens = tokenize(b);

  // Identical after expansion — "DOB" and "Date of Birth" land here.
  if (leftTokens.size > 0 && setsEqual(leftTokens, rightTokens)) return 1;

  const dice = diceScore(left, right);
  const tokens = tokenScore(leftTokens, rightTokens);

  // Containment: a whole alias appearing as a word run inside the header.
  // Padding both sides keeps this on word boundaries — "State" must not match
  // the tail of "Estate".
  const padded = { left: ` ${left} `, right: ` ${right} ` };
  const contained =
    padded.left.includes(padded.right) || padded.right.includes(padded.left)
      ? 0.75 + 0.25 * (Math.min(left.length, right.length) / Math.max(left.length, right.length))
      : 0;

  return Math.min(1, Math.max(dice, tokens, contained));
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

/**
 * Picks the highest-scoring candidate at or above `threshold`.
 * Ties resolve to the earlier candidate, keeping results stable across runs.
 */
export function bestMatch<T>(
  query: string,
  candidates: T[],
  getText: (candidate: T) => string | string[],
  threshold: number,
): { candidate: T; score: number } | null {
  let best: { candidate: T; score: number } | null = null;

  for (const candidate of candidates) {
    const texts = getText(candidate);
    const list = Array.isArray(texts) ? texts : [texts];

    let score = 0;
    for (const text of list) {
      if (!text) continue;
      score = Math.max(score, similarity(query, text));
      if (score === 1) break;
    }

    if (score >= threshold && (best === null || score > best.score)) {
      best = { candidate, score };
    }
  }

  return best;
}
