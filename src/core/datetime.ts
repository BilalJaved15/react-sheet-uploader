/**
 * Date/time parsing and formatting.
 *
 * Spreadsheet imports see a wide spread of date spellings, so this parses
 * defensively rather than delegating to `Date.parse`, whose behaviour on
 * non-ISO input is implementation-defined. Everything is handled as a wall
 * clock — no time zone conversion is ever applied, because a date typed into
 * a spreadsheet means the same calendar day regardless of the reader's zone.
 */

export interface WallClock {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
  /** True when the source carried a time component. */
  hasTime: boolean;
  /** True when the source carried a date component. */
  hasDate: boolean;
}

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

const MONTH_ABBR = MONTH_NAMES.map((m) => m.slice(0, 3));

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LONG_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function emptyClock(): WallClock {
  return {
    year: 1970,
    month: 1,
    day: 1,
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0,
    hasTime: false,
    hasDate: false,
  };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isValidDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  if (day < 1) return false;
  return day <= daysInMonth(year, month);
}

/** Two-digit years follow the POSIX convention: 69-99 -> 19xx, 00-68 -> 20xx. */
function expandYear(year: number): number {
  if (year >= 100) return year;
  return year >= 69 ? 1900 + year : 2000 + year;
}

function monthFromName(name: string): number | null {
  const lower = name.toLowerCase();
  const full = MONTH_NAMES.indexOf(lower);
  if (full !== -1) return full + 1;
  const abbr = MONTH_ABBR.indexOf(lower.slice(0, 3));
  if (abbr !== -1 && lower.length <= 4) return abbr + 1;
  return null;
}

/**
 * Excel stores dates as days since 1899-12-30 (the offset absorbs Excel's
 * fictional 1900 leap day). Values below 60 predate that bug and are exact.
 */
export function fromExcelSerial(serial: number): WallClock {
  const wholeDays = Math.floor(serial);
  const fraction = serial - wholeDays;
  const ms = Date.UTC(1899, 11, 30) + wholeDays * 86400000;
  const d = new Date(ms);

  // Round to the nearest second: Excel fractions are binary approximations and
  // land on values like 11:59:59.9999 that should read as 12:00:00.
  const totalSeconds = Math.round(fraction * 86400);
  const hour = Math.floor(totalSeconds / 3600) % 24;
  const minute = Math.floor(totalSeconds / 60) % 60;
  const second = totalSeconds % 60;

  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour,
    minute,
    second,
    millisecond: 0,
    hasTime: fraction > 0,
    hasDate: true,
  };
}

export function fromJsDate(date: Date): WallClock {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds(),
    millisecond: date.getMilliseconds(),
    hasTime:
      date.getHours() !== 0 ||
      date.getMinutes() !== 0 ||
      date.getSeconds() !== 0 ||
      date.getMilliseconds() !== 0,
    hasDate: true,
  };
}

interface ParseOptions {
  /** Read ambiguous `x/y/z` as day-first rather than month-first. */
  dayFirst?: boolean;
}

const ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i;

const NUMERIC_DATE_RE = /^(\d{1,4})[/.\-](\d{1,2})[/.\-](\d{1,4})$/;

const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?\s*(am|pm|a\.m\.|p\.m\.)?$/i;

const TEXTUAL_RE =
  /^(?:(?:sun|mon|tue|wed|thu|fri|sat)[a-z]*,?\s+)?(?:(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})|([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?)[,]?\s+(\d{2,4})$/i;

/** Splits "2024-01-05 14:30" into its date and time halves. */
function splitDateTime(input: string): { datePart: string; timePart: string | null } {
  const match = /^(.*?)[\sT]+(\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(?:am|pm|a\.m\.|p\.m\.)?)$/i.exec(
    input,
  );
  if (match && match[1] && match[2]) {
    return { datePart: match[1].trim(), timePart: match[2].trim() };
  }
  return { datePart: input, timePart: null };
}

function parseTimeInto(clock: WallClock, raw: string): boolean {
  const m = TIME_RE.exec(raw.trim());
  if (!m) return false;

  let hour = Number(m[1]);
  const minute = Number(m[2]);
  const second = m[3] ? Number(m[3]) : 0;
  const fraction = m[4] ? Number(m[4].padEnd(3, '0').slice(0, 3)) : 0;
  const meridiem = m[5]?.toLowerCase().replace(/\./g, '');

  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;

  if (hour > 23 || minute > 59 || second > 59) return false;

  clock.hour = hour;
  clock.minute = minute;
  clock.second = second;
  clock.millisecond = fraction;
  clock.hasTime = true;
  return true;
}

const DAY_FIRST_BY_LOCALE = new Map<string, boolean>();

/**
 * Whether a locale writes the day before the month.
 *
 * Field configs ported from other importers describe a column as
 * `['date', { locale: 'de-DE' }]` rather than setting `dayFirst`, and a German
 * `05.01.2024` means 5 January, not 1 May. The order is read off `Intl` rather
 * than a hand-kept list so every locale the platform knows about is covered.
 *
 * Returns `undefined` for an unknown tag or a locale whose format exposes no
 * day/month parts, leaving `parseDateValue`'s own ambiguity handling in charge.
 */
export function localeIsDayFirst(locale: string | undefined): boolean | undefined {
  if (!locale) return undefined;

  const cached = DAY_FIRST_BY_LOCALE.get(locale);
  if (cached !== undefined) return cached;

  let dayFirst: boolean | undefined;
  try {
    // A day that cannot be read as a month, so the two parts stay tellable apart.
    const parts = new Intl.DateTimeFormat(locale).formatToParts(new Date(2000, 0, 22));
    const dayIndex = parts.findIndex((part) => part.type === 'day');
    const monthIndex = parts.findIndex((part) => part.type === 'month');
    dayFirst = dayIndex !== -1 && monthIndex !== -1 ? dayIndex < monthIndex : undefined;
  } catch {
    dayFirst = undefined;
  }

  if (dayFirst !== undefined) DAY_FIRST_BY_LOCALE.set(locale, dayFirst);
  return dayFirst;
}

/**
 * Parses a value into a wall clock, or returns null when it is not a date.
 * Accepts ISO-8601, common numeric orders, textual months, Excel serials,
 * and bare times.
 */
export function parseDateValue(
  input: unknown,
  options: ParseOptions = {},
): WallClock | null {
  if (input == null || input === '') return null;

  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : fromJsDate(input);
  }

  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    return fromExcelSerial(input);
  }

  const raw = String(input).trim();
  if (raw === '') return null;

  // ISO-8601, the only format where we trust the ordering completely.
  const iso = ISO_RE.exec(raw);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    if (!isValidDate(year, month, day)) return null;

    const clock: WallClock = { ...emptyClock(), year, month, day, hasDate: true };
    if (iso[4] !== undefined) {
      clock.hour = Number(iso[4]);
      clock.minute = Number(iso[5]);
      clock.second = iso[6] ? Number(iso[6]) : 0;
      clock.millisecond = iso[7] ? Number(iso[7].padEnd(3, '0').slice(0, 3)) : 0;
      clock.hasTime = true;
      if (clock.hour > 23 || clock.minute > 59 || clock.second > 59) return null;
    }
    return clock;
  }

  // A bare time with no date.
  const bareTime = { ...emptyClock() };
  if (parseTimeInto(bareTime, raw)) return bareTime;

  const { datePart, timePart } = splitDateTime(raw);
  const clock = { ...emptyClock() };

  const numeric = NUMERIC_DATE_RE.exec(datePart);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    const c = Number(numeric[3]);

    let year: number;
    let month: number;
    let day: number;

    if (String(numeric[1]).length === 4) {
      // 2024/01/05 — unambiguously year-first.
      year = a;
      month = b;
      day = c;
    } else if (options.dayFirst) {
      day = a;
      month = b;
      year = expandYear(c);
    } else if (a > 12 && b <= 12) {
      // 31/01/2024 can only be day-first regardless of the setting.
      day = a;
      month = b;
      year = expandYear(c);
    } else {
      month = a;
      day = b;
      year = expandYear(c);
    }

    if (!isValidDate(year, month, day)) return null;
    clock.year = year;
    clock.month = month;
    clock.day = day;
    clock.hasDate = true;
  } else {
    const textual = TEXTUAL_RE.exec(datePart);
    if (!textual) return null;

    const dayStr = textual[1] ?? textual[4];
    const monthStr = textual[2] ?? textual[3];
    if (!dayStr || !monthStr) return null;

    const month = monthFromName(monthStr);
    if (month === null) return null;

    const day = Number(dayStr);
    const year = expandYear(Number(textual[5]));
    if (!isValidDate(year, month, day)) return null;

    clock.year = year;
    clock.month = month;
    clock.day = day;
    clock.hasDate = true;
  }

  if (timePart && !parseTimeInto(clock, timePart)) return null;
  return clock;
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

function pad(n: number, width = 2): string {
  return String(Math.abs(n)).padStart(width, '0');
}

function dayOfWeek(clock: WallClock): number {
  return new Date(Date.UTC(clock.year, clock.month - 1, clock.day)).getUTCDay();
}

// Longest tokens first so that YYYY is not consumed as YY + YY.
const TOKEN_RE = /YYYY|YY|MMMM|MMM|MM|M|DDDD|DDD|DD|D|dddd|ddd|HH|H|hh|h|mm|m|ss|s|SSS|A|a|ZZ/g;

/**
 * Formats a wall clock with moment-style tokens. Text inside square brackets
 * is emitted literally, e.g. `[on] YYYY-MM-DD`.
 */
export function formatDateValue(clock: WallClock, format: string): string {
  const literals: string[] = [];
  const withPlaceholders = format.replace(/\[([^\]]*)\]/g, (_, text: string) => {
    literals.push(text);
    return ` ${literals.length - 1} `;
  });

  const hour12 = clock.hour % 12 === 0 ? 12 : clock.hour % 12;

  const rendered = withPlaceholders.replace(TOKEN_RE, (token) => {
    switch (token) {
      case 'YYYY':
        return pad(clock.year, 4);
      case 'YY':
        return pad(clock.year % 100);
      case 'MMMM':
        return LONG_MONTHS[clock.month - 1] ?? '';
      case 'MMM':
        return SHORT_MONTHS[clock.month - 1] ?? '';
      case 'MM':
        return pad(clock.month);
      case 'M':
        return String(clock.month);
      case 'DDDD':
      case 'dddd':
        return LONG_DAYS[dayOfWeek(clock)] ?? '';
      case 'DDD':
      case 'ddd':
        return SHORT_DAYS[dayOfWeek(clock)] ?? '';
      case 'DD':
        return pad(clock.day);
      case 'D':
        return String(clock.day);
      case 'HH':
        return pad(clock.hour);
      case 'H':
        return String(clock.hour);
      case 'hh':
        return pad(hour12);
      case 'h':
        return String(hour12);
      case 'mm':
        return pad(clock.minute);
      case 'm':
        return String(clock.minute);
      case 'ss':
        return pad(clock.second);
      case 's':
        return String(clock.second);
      case 'SSS':
        return pad(clock.millisecond, 3);
      case 'A':
        return clock.hour < 12 ? 'AM' : 'PM';
      case 'a':
        return clock.hour < 12 ? 'am' : 'pm';
      case 'ZZ':
        return '';
      default:
        return token;
    }
  });

  return rendered.replace(/ (\d+) /g, (_, i: string) => literals[Number(i)] ?? '');
}

export const ISO_DATE_FORMAT = 'YYYY-MM-DD';
export const ISO_DATETIME_FORMAT = 'YYYY-MM-DDTHH:mm:ss';
export const ISO_DATETIME_NO_SECONDS = 'YYYY-MM-DDTHH:mm';
export const ISO_TIME_FORMAT = 'HH:mm';
export const ISO_TIME_WITH_SECONDS = 'HH:mm:ss';
