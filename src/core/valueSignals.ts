/**
 * Evidence from a column's values about which field type it holds.
 *
 * Headers lie or go missing — "Column3", "Field 1", blank, or a name that means
 * something only inside the source system. The values underneath do not: a
 * column of `a@b.com` is an email column whatever it is called. This module
 * turns the sample values already collected for the matching preview into a
 * signal that can confirm a weak header match or break a tie between two
 * plausible fields.
 *
 * Scores are advisory. They shift a header score rather than replacing it,
 * because value shape identifies a *type*, not a *field* — every one of
 * `firstName`, `lastName` and `city` is a short string.
 */

import type { FieldTypeName, SelectOption } from '../types';
import { normalizeForMatch } from './similarity';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const URL_LIKE = /^(https?:\/\/|www\.)\S+$/i;
const DOMAIN = /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const SSN = /^\d{3}-?\d{2}-?\d{4}$/;
/** Digits with the punctuation phone numbers actually carry, 7–15 digits. */
const PHONE = /^\+?[\d\s().-]{7,20}$/;
const DATE_LIKE =
  /^(\d{1,4}[/\-.]\d{1,2}[/\-.]\d{1,4}|\d{1,2}\s+\p{L}{3,}\s+\d{2,4}|\p{L}{3,}\s+\d{1,2},?\s+\d{2,4})$/u;
const TIME_LIKE = /^\d{1,2}:\d{2}(:\d{2})?\s*([ap]\.?m\.?)?$/i;
const NUMERIC = /^[-+]?[\d,\s]*\.?\d+%?$/;
const CURRENCY = /^[-+]?[$€£¥₹]\s?[\d,]*\.?\d+$/;

const TRUTHY = new Set(['true', 'false', 'yes', 'no', 'y', 'n', '1', '0', 't', 'f']);
const US_STATE = /^([A-Z]{2}|\p{Lu}\p{L}+(\s\p{L}+)*)$/u;

/** Fraction of samples matching a predicate, ignoring blanks. */
function fraction(samples: string[], test: (value: string) => boolean): number {
  let considered = 0;
  let hits = 0;
  for (const sample of samples) {
    const value = sample.trim();
    if (value === '') continue;
    considered += 1;
    if (test(value)) hits += 1;
  }
  return considered === 0 ? 0 : hits / considered;
}

function digitCount(value: string): number {
  let count = 0;
  for (const char of value) {
    if (char >= '0' && char <= '9') count += 1;
  }
  return count;
}

function isPhone(value: string): boolean {
  if (!PHONE.test(value)) return false;
  const digits = digitCount(value);
  return digits >= 7 && digits <= 15;
}

function isDateLike(value: string): boolean {
  if (DATE_LIKE.test(value)) return true;
  // ISO 8601, with or without a time part.
  if (/^\d{4}-\d{2}-\d{2}([T\s]\d{2}:\d{2})?/.test(value)) return true;
  // Month-and-year only, as monthly report exports write it: "Jan 2024".
  return /^\p{L}{3,}\s+\d{4}$/u.test(value);
}

/**
 * How well a column's values fit a field type, in [0, 1].
 *
 * Returns 0 for types whose values have no distinguishing shape — `string` and
 * anything unrecognised — so that a shapeless column never gains a bonus it has
 * not earned.
 */
export function valueTypeScore(
  samples: string[],
  typeName: FieldTypeName,
  selectOptions: SelectOption[] = [],
): number {
  if (samples.length === 0) return 0;

  switch (typeName) {
    case 'email':
      return fraction(samples, (value) => EMAIL.test(value));

    case 'url':
      return fraction(samples, (value) => URL_LIKE.test(value));

    case 'domain':
      return fraction(samples, (value) => DOMAIN.test(value) && !EMAIL.test(value));

    case 'ssn':
      return fraction(samples, (value) => SSN.test(value));

    case 'phone-number':
      return fraction(samples, isPhone);

    case 'date':
      return fraction(samples, isDateLike);

    case 'datetime':
      return fraction(samples, (value) => isDateLike(value) && /\d{1,2}:\d{2}/.test(value));

    case 'time':
      return fraction(samples, (value) => TIME_LIKE.test(value));

    case 'number':
      return fraction(
        samples,
        (value) => (NUMERIC.test(value) || CURRENCY.test(value)) && digitCount(value) > 0,
      );

    case 'checkbox':
      return fraction(samples, (value) => TRUTHY.has(value.toLowerCase()));

    case 'country':
      // Two-letter codes or capitalised names; weak on its own, so it is capped
      // below the rate an email or date column can reach.
      return 0.8 * fraction(samples, (value) => /^[A-Za-z]{2}$/.test(value) || US_STATE.test(value));

    case 'us-state-territory':
      return 0.8 * fraction(samples, (value) => US_STATE.test(value));

    case 'select':
    case 'multi-select': {
      if (selectOptions.length === 0) return 0;
      const allowed = new Set<string>();
      for (const option of selectOptions) {
        allowed.add(normalizeForMatch(option.value));
        allowed.add(normalizeForMatch(option.label));
        for (const alternate of option.alternateMatches ?? []) {
          allowed.add(normalizeForMatch(alternate));
        }
      }
      allowed.delete('');
      if (allowed.size === 0) return 0;
      return fraction(samples, (value) => allowed.has(normalizeForMatch(value)));
    }

    case 'string':
    default:
      return 0;
  }
}

/**
 * Types whose values are distinctive enough that a mismatch is real evidence
 * against the field, not merely an absence of evidence for it.
 *
 * A column of `2024-01-05` values is positively *not* an email column. A column
 * of arbitrary text, by contrast, tells us nothing — `string` is absent here for
 * that reason, as are the loosely-shaped geographic types.
 */
const STRICT_TYPES = new Set<FieldTypeName>([
  'email',
  'url',
  'ssn',
  'date',
  'datetime',
  'time',
  'number',
  'checkbox',
  'phone-number',
]);

export function isStrictlyShapedType(typeName: FieldTypeName): boolean {
  return STRICT_TYPES.has(typeName);
}
