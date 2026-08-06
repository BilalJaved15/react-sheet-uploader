/**
 * Number parsing and presentation for the `number` field type.
 *
 * Spreadsheet cells arrive as display text — `$1,234.56`, `(89.00)`, `1.234,56`,
 * `45%` — so parsing has to undo formatting before it can produce a JS number.
 */

import type { NumberPreset } from '../types';

export interface ParsedNumber {
  value: number;
  /** True when the source carried a `%`, so the value was divided by 100. */
  wasPercent: boolean;
}

const CURRENCY_SYMBOLS = /[$€£¥₹₽₩฿₪₦₱₴₸¤]/g;

/**
 * Decides which of `.` and `,` is the decimal separator.
 *
 * When both appear, the last one wins — `1.234,56` is European and `1,234.56`
 * is Anglo. When only one appears it is a thousands separator if it splits the
 * number into clean groups of three (`1,234`), and a decimal point otherwise
 * (`1,23`).
 */
function normalizeSeparators(input: string): string {
  const lastDot = input.lastIndexOf('.');
  const lastComma = input.lastIndexOf(',');

  if (lastDot !== -1 && lastComma !== -1) {
    const decimalSep = lastDot > lastComma ? '.' : ',';
    const groupSep = decimalSep === '.' ? ',' : '.';
    return input.split(groupSep).join('').replace(decimalSep, '.');
  }

  const sep = lastDot !== -1 ? '.' : lastComma !== -1 ? ',' : null;
  if (sep === null) return input;

  const parts = input.split(sep);
  if (parts.length > 2) {
    // Repeated separator can only be grouping: 1.234.567
    return parts.join('');
  }

  const tail = parts[1] ?? '';
  const head = parts[0] ?? '';
  if (tail.length === 3 && head.length > 0 && head.length <= 3 && /^\d+$/.test(tail)) {
    // Ambiguous (1,234 / 1.234) — grouping is the far more common intent.
    return head + tail;
  }

  return `${head}.${tail}`;
}

/** Parses a formatted number string, or returns null if it is not numeric. */
export function parseNumber(input: unknown): ParsedNumber | null {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? { value: input, wasPercent: false } : null;
  }
  if (input == null) return null;

  let text = String(input).trim();
  if (text === '') return null;

  // Accounting notation: (1,234.56) means -1234.56
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1).trim();
  }

  const wasPercent = text.includes('%');
  text = text
    .replace(CURRENCY_SYMBOLS, '')
    .replace(/%/g, '')
    .replace(/\s| |_/g, '')
    .replace(/^\+/, '');

  if (text.startsWith('-')) {
    negative = !negative;
    text = text.slice(1);
  }

  if (text === '' || !/^[\d.,]+(?:[eE][+-]?\d+)?$/.test(text)) return null;

  const normalized = normalizeSeparators(text);
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;

  const signed = negative ? -value : value;
  return { value: wasPercent ? signed / 100 : signed, wasPercent };
}

/* -------------------------------------------------------------------------- */
/* Presentation                                                                */
/* -------------------------------------------------------------------------- */

interface PresetSpec {
  decimals?: number;
  /** Fixed number of decimals, versus a maximum. */
  fixed?: boolean;
  currency?: string;
  percent?: boolean;
  grouping?: boolean;
  accounting?: boolean;
}

const PRESETS: Record<NumberPreset, PresetSpec> = {
  default: { grouping: true },
  plain: { grouping: false },
  percent: { percent: true, grouping: true },
  usd: { currency: '$', decimals: 2, fixed: true, grouping: true },
  usd_accounting: { currency: '$', decimals: 2, fixed: true, grouping: true, accounting: true },
  eur: { currency: '€', decimals: 2, fixed: true, grouping: true },
  gbp: { currency: '£', decimals: 2, fixed: true, grouping: true },
  decimal_0: { decimals: 0, fixed: true, grouping: true },
  integer: { decimals: 0, fixed: true, grouping: true },
  decimal_1: { decimals: 1, fixed: true, grouping: true },
  decimal_2: { decimals: 2, fixed: true, grouping: true },
  decimal_3: { decimals: 3, fixed: true, grouping: true },
  decimal_4: { decimals: 4, fixed: true, grouping: true },
  percent_0: { percent: true, decimals: 0, fixed: true, grouping: true },
  percent_1: { percent: true, decimals: 1, fixed: true, grouping: true },
  percent_2: { percent: true, decimals: 2, fixed: true, grouping: true },
  percent_3: { percent: true, decimals: 3, fixed: true, grouping: true },
  percent_4: { percent: true, decimals: 4, fixed: true, grouping: true },
};

function addGrouping(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Renders a number using a preset, e.g. `usd` -> `$1,234.56`. */
export function formatNumber(value: number, preset: NumberPreset = 'default'): string {
  const spec = PRESETS[preset] ?? PRESETS.default;

  const scaled = spec.percent ? value * 100 : value;
  const negative = scaled < 0;
  const magnitude = Math.abs(scaled);

  let body: string;
  if (spec.decimals !== undefined && spec.fixed) {
    body = magnitude.toFixed(spec.decimals);
  } else {
    // Trim float noise (0.1 + 0.2) without truncating genuinely long decimals.
    body = String(Number(magnitude.toPrecision(15)));
  }

  const [intPart = '0', decPart] = body.split('.');
  const grouped = spec.grouping ? addGrouping(intPart) : intPart;
  body = decPart ? `${grouped}.${decPart}` : grouped;

  if (spec.currency) body = `${spec.currency}${body}`;
  if (spec.percent) body = `${body}%`;

  if (!negative) return body;
  return spec.accounting ? `(${body})` : `-${body}`;
}

/** Rounds to `decimals` places, correcting for binary representation error. */
export function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** decimals;
  // The epsilon nudge makes 1.005 round to 1.01 rather than 1.00.
  return Math.round((value + Number.EPSILON * Math.sign(value) * Math.abs(value)) * factor) / factor;
}
