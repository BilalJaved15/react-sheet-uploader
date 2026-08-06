/**
 * String similarity used for header auto-matching and fuzzy select-option
 * resolution.
 *
 * Sørensen–Dice over character bigrams, which handles the transpositions and
 * word-order differences typical of spreadsheet headers ("Email Address" vs
 * "Address Email") better than edit distance, and is cheap enough to run over
 * every header/field pair.
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

function bigrams(input: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i < input.length - 1; i += 1) {
    const pair = input.slice(i, i + 2);
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }
  return counts;
}

/** Returns a score in [0, 1]; 1 means the normalized strings are identical. */
export function similarity(a: string, b: string): number {
  const left = normalizeForMatch(a);
  const right = normalizeForMatch(b);

  if (left === right) return left === '' ? 0 : 1;
  if (left.length === 0 || right.length === 0) return 0;

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
