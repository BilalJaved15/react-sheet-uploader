/**
 * Field type normalization and value coercion.
 *
 * Every cell goes through `coerceValue` exactly once per edit. It produces both
 * what the user sees in the grid (`display`) and what lands in the results
 * (`output`), which differ whenever a type reformats — `1/5/24` displays as
 * `01/05/2024` but outputs `2024-01-05`.
 */

import {
  ISO_DATETIME_FORMAT,
  ISO_DATETIME_NO_SECONDS,
  ISO_DATE_FORMAT,
  ISO_TIME_FORMAT,
  ISO_TIME_WITH_SECONDS,
  formatDateValue,
  localeIsDayFirst,
  parseDateValue,
  type WallClock,
} from './datetime';
import { CALLING_CODES, CALLING_CODE_BY_COUNTRY, lookupCountry, lookupUsState } from './data/regions';
import { formatNumber, parseNumber, roundTo } from './numbers';
import { bestMatch, normalizeForMatch } from './similarity';
import type {
  AnyFieldTypeOptions,
  Field,
  FieldType,
  FieldTypeName,
  ResultValue,
  SelectOption,
  Validator,
} from '../types';

export interface NormalizedField {
  key: string;
  label: string;
  description?: string;
  typeName: FieldTypeName;
  typeOptions: AnyFieldTypeOptions;
  selectOptions: SelectOption[];
  validators: Validator[];
  alternateMatches: string[];
  hidden: boolean;
  readOnly: boolean;
  requireMapping: boolean;
  manyToOne: boolean;
  /** True for fields the user invented via `allowCustomFields`. */
  isCustom: boolean;
  /** The field as the developer wrote it. */
  source: Field;
}

export interface CoercionResult {
  /** Text shown in the review grid and handed to hooks as `cell.value`. */
  display: string;
  /** Value placed in the results object. */
  output: ResultValue;
  /** Set when the value does not fit the field type. */
  error?: string;
  /** True when coercion rewrote the input, e.g. `usa` -> `US`. */
  autofixed: boolean;
}

const VALID_TYPE_NAMES = new Set<FieldTypeName>([
  'string',
  'number',
  'date',
  'datetime',
  'time',
  'select',
  'multi-select',
  'checkbox',
  'email',
  'country',
  'phone-number',
  'ssn',
  'domain',
  'url',
  'us-state-territory',
  'us-zip-code',
  'uuid',
]);

/** Splits `"number"` or `["number", { round: 2 }]` into name and options. */
export function parseFieldType(type: FieldType | undefined): {
  typeName: FieldTypeName;
  typeOptions: AnyFieldTypeOptions;
} {
  if (type === undefined) return { typeName: 'string', typeOptions: {} };

  if (typeof type === 'string') {
    return VALID_TYPE_NAMES.has(type)
      ? { typeName: type, typeOptions: {} }
      : { typeName: 'string', typeOptions: {} };
  }

  if (Array.isArray(type)) {
    const [name, options] = type as [FieldTypeName, AnyFieldTypeOptions | undefined];
    return VALID_TYPE_NAMES.has(name)
      ? { typeName: name, typeOptions: options ?? {} }
      : { typeName: 'string', typeOptions: {} };
  }

  return { typeName: 'string', typeOptions: {} };
}

export function normalizeField(field: Field, isCustom = false): NormalizedField {
  const { typeName, typeOptions } = parseFieldType(field.type);

  // `selectOptions` may sit on the field or inside the type options; the field
  // is the documented home, so it wins.
  const selectOptions =
    field.selectOptions ?? (typeOptions as { selectOptions?: SelectOption[] }).selectOptions ?? [];

  return {
    key: field.key,
    label: field.label ?? field.key,
    description: field.description,
    typeName,
    typeOptions,
    selectOptions,
    validators: field.validators ?? [],
    alternateMatches: field.alternateMatches ?? [],
    hidden: field.hidden ?? false,
    readOnly: field.readOnly ?? false,
    requireMapping: field.requireMapping ?? false,
    manyToOne: field.manyToOne ?? false,
    isCustom,
    source: field,
  };
}

/* -------------------------------------------------------------------------- */
/* Type-specific coercion                                                      */
/* -------------------------------------------------------------------------- */

const CHECKBOX_FALSE = new Set(['', '0', 'off', 'n', 'no', 'false', 'disabled', 'f']);

// HTML5 email spec, minus the single-label domains and IP literals it permits.
const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

const DOMAIN_LABEL_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-([0-9a-f])[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ok(display: string, output: ResultValue, autofixed: boolean): CoercionResult {
  return { display, output, autofixed };
}

function fail(display: string, error: string): CoercionResult {
  return { display, output: display === '' ? null : display, error, autofixed: false };
}

function coerceNumber(raw: string, options: AnyFieldTypeOptions): CoercionResult {
  const parsed = parseNumber(raw);
  if (parsed === null) return fail(raw, 'Not a valid number');

  let value = parsed.value;
  if (options.round !== undefined) value = roundTo(value, options.round);

  if (options.min !== undefined && value < options.min) {
    return fail(raw, `Must be at least ${options.min}`);
  }
  if (options.max !== undefined && value > options.max) {
    return fail(raw, `Must be at most ${options.max}`);
  }

  const preset = options.preset ?? 'default';
  const display = options.displayFormat
    ? formatNumber(value, options.displayFormat as never)
    : formatNumber(value, preset);

  // `outputFormat` asks for a formatted string; otherwise results get a number.
  const output: ResultValue = options.outputFormat
    ? formatNumber(value, options.outputFormat as never)
    : value;

  return ok(display, output, display !== raw);
}

function coerceDateLike(
  raw: string,
  typeName: 'date' | 'datetime' | 'time',
  options: AnyFieldTypeOptions,
): CoercionResult {
  // An explicit `dayFirst` wins; otherwise a declared `locale` decides the
  // reading of ambiguous numeric dates like `05.01.2024`.
  const dayFirst = options.dayFirst ?? localeIsDayFirst(options.locale);
  const clock = parseDateValue(raw, { dayFirst });
  if (clock === null) {
    const label = typeName === 'time' ? 'time' : typeName === 'date' ? 'date' : 'date and time';
    return fail(raw, `Not a valid ${label}`);
  }

  if (typeName === 'time' && !clock.hasTime && clock.hasDate) {
    return fail(raw, 'Not a valid time');
  }
  if (typeName !== 'time' && !clock.hasDate) {
    return fail(raw, `Not a valid ${typeName === 'date' ? 'date' : 'date and time'}`);
  }

  const withSeconds = options.withSeconds ?? false;
  const defaultFormat = defaultFormatFor(typeName, withSeconds, clock);

  const display = formatDateValue(clock, options.displayFormat ?? defaultFormat);
  const output = formatDateValue(clock, options.outputFormat ?? defaultFormat);

  return ok(display, output, display !== raw);
}

function defaultFormatFor(
  typeName: 'date' | 'datetime' | 'time',
  withSeconds: boolean,
  clock: WallClock,
): string {
  if (typeName === 'date') return ISO_DATE_FORMAT;
  if (typeName === 'time') return withSeconds ? ISO_TIME_WITH_SECONDS : ISO_TIME_FORMAT;
  // A datetime with no time component still needs a time in ISO output.
  void clock;
  return withSeconds ? ISO_DATETIME_FORMAT : ISO_DATETIME_NO_SECONDS;
}

/** Resolves one source string against a select field's options. */
export function resolveSelectOption(
  raw: string,
  selectOptions: SelectOption[],
  options: AnyFieldTypeOptions,
): SelectOption | null {
  const normalized = normalizeForMatch(raw);
  if (normalized === '') return null;

  // Exact match on value, then label, then declared alternates.
  for (const option of selectOptions) {
    if (option.value === raw || option.label === raw) return option;
  }
  for (const option of selectOptions) {
    if (
      normalizeForMatch(option.value) === normalized ||
      normalizeForMatch(option.label) === normalized
    ) {
      return option;
    }
  }
  for (const option of selectOptions) {
    if (option.alternateMatches?.some((alt) => normalizeForMatch(alt) === normalized)) {
      return option;
    }
  }

  if (options.exactMatchOnly) return null;

  const fuzzyCandidates = selectOptions.filter((option) => !option.exactMatchOnly);
  const match = bestMatch(
    raw,
    fuzzyCandidates,
    (option) => [option.label, option.value, ...(option.alternateMatches ?? [])],
    0.85,
  );
  return match?.candidate ?? null;
}

function coerceSelect(
  raw: string,
  selectOptions: SelectOption[],
  options: AnyFieldTypeOptions,
): CoercionResult {
  const option = resolveSelectOption(raw, selectOptions, options);
  if (option) return ok(option.label, option.value, option.label !== raw);
  if (options.allowCustom) return ok(raw, raw, false);
  return fail(raw, `"${raw}" is not one of the allowed options`);
}

function coerceMultiSelect(
  raw: string,
  selectOptions: SelectOption[],
  options: AnyFieldTypeOptions,
): CoercionResult {
  const delimiter = options.delimiter ?? ',';
  const trimValues = options.trimValues ?? true;

  const parts = raw
    .split(delimiter)
    .map((part) => (trimValues ? part.trim() : part))
    .filter((part) => part !== '');

  const labels: string[] = [];
  const values: string[] = [];
  const unmatched: string[] = [];
  let duplicated = false;

  for (const part of parts) {
    const option = resolveSelectOption(part, selectOptions, options);
    const value = option ? option.value : part;
    const label = option ? option.label : part;

    if (!option && !options.allowCustom) {
      unmatched.push(part);
      continue;
    }
    if (values.includes(value)) {
      duplicated = true;
      continue;
    }
    values.push(value);
    labels.push(label);
  }

  const display = labels.join(`${delimiter} `);

  if (unmatched.length > 0) {
    return {
      display,
      output: values,
      error: `${unmatched.map((v) => `"${v}"`).join(', ')} ${
        unmatched.length === 1 ? 'is' : 'are'
      } not among the allowed options`,
      autofixed: false,
    };
  }

  return ok(display, values, duplicated || display !== raw);
}

function coerceEmail(raw: string): CoercionResult {
  const trimmed = raw.trim();
  if (!EMAIL_RE.test(trimmed)) return fail(raw, 'Not a valid email address');

  const domain = trimmed.slice(trimmed.lastIndexOf('@') + 1);
  const tld = domain.slice(domain.lastIndexOf('.') + 1);
  // Reject IP-literal domains, which the HTML5 pattern would otherwise allow.
  if (/^\d+$/.test(tld)) return fail(raw, 'Not a valid email address');

  const normalized = trimmed.toLowerCase();
  return ok(normalized, normalized, normalized !== raw);
}

function coerceCountry(raw: string, options: AnyFieldTypeOptions): CoercionResult {
  const country = lookupCountry(raw);
  if (!country) return fail(raw, 'Not a recognized country');

  const value = options.format === '3-letter' ? country.alpha3 : country.alpha2;
  return ok(value, value, value !== raw);
}

function coerceUsState(raw: string): CoercionResult {
  const state = lookupUsState(raw);
  if (!state) return fail(raw, 'Not a recognized US state or territory');
  return ok(state.code, state.code, state.code !== raw);
}

/**
 * Countries whose national numbers keep a leading zero, so it must not be
 * stripped as a trunk prefix. Italy is the notable case: `06` is genuinely part
 * of a Rome landline.
 */
const KEEPS_LEADING_ZERO = new Set(['IT']);

function coercePhone(raw: string, options: AnyFieldTypeOptions): CoercionResult {
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');

  if (digits.length === 0) return fail(raw, 'Not a valid phone number');

  let e164: string;
  if (hasPlus) {
    e164 = digits;
  } else if (options.country) {
    const country = options.country.toUpperCase();
    const callingCode = CALLING_CODE_BY_COUNTRY.get(country);
    if (!callingCode) return fail(raw, `Unknown country code "${options.country}"`);

    // Most countries prefix national dialling with a trunk `0` that is dropped
    // in international form: UK `020 7946 0958` is `+44 20 7946 0958`.
    const national =
      digits.startsWith('0') && !KEEPS_LEADING_ZERO.has(country) ? digits.slice(1) : digits;

    // Only treat a leading country code as already-international when enough
    // digits remain to be a real subscriber number.
    const alreadyPrefixed =
      national.startsWith(callingCode) && national.length - callingCode.length >= 6;

    e164 = alreadyPrefixed ? national : callingCode + national;
  } else if (options.format === 'national') {
    // No country to resolve against — accept the national digits as given.
    return ok(digits, digits, digits !== raw);
  } else {
    e164 = digits;
  }

  // E.164 allows 15 digits total; the shortest real numbers are 8 with a code.
  if (e164.length < 7 || e164.length > 15) return fail(raw, 'Not a valid phone number');

  const callingCode = CALLING_CODES.find((code) => e164.startsWith(code));
  if (!callingCode && !options.country) {
    return fail(raw, 'Not a valid phone number');
  }

  const national = callingCode ? e164.slice(callingCode.length) : e164;
  if (national.length < 4) return fail(raw, 'Not a valid phone number');

  const formatted = callingCode ? `+${callingCode} ${national}` : `+${e164}`;
  const canonical = `+${e164}`;

  if (options.format === 'national') {
    return ok(national, national, national !== raw);
  }

  const display = options.outputFormatted ? formatted : canonical;
  const output = options.outputFormatted ? formatted : canonical;
  return ok(display, output, display !== raw);
}

function coerceSsn(raw: string, options: AnyFieldTypeOptions): CoercionResult {
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 9) return fail(raw, 'Not a valid SSN');

  const area = digits.slice(0, 3);
  const group = digits.slice(3, 5);
  const serial = digits.slice(5);

  // Ranges the SSA has never issued.
  if (area === '000' || area === '666' || Number(area) >= 900) return fail(raw, 'Not a valid SSN');
  if (group === '00' || serial === '0000') return fail(raw, 'Not a valid SSN');

  const value = options.outputDash ? `${area}-${group}-${serial}` : digits;
  return ok(value, value, value !== raw);
}

function coerceDomain(raw: string, options: AnyFieldTypeOptions): CoercionResult {
  let text = raw.trim().toLowerCase();
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
  if (text === '') return fail(raw, 'Not a valid domain');

  const labels = text.split('.');
  if (labels.length < 2) return fail(raw, 'Not a valid domain');
  if (!labels.every((label) => DOMAIN_LABEL_RE.test(label))) return fail(raw, 'Not a valid domain');

  const tld = labels[labels.length - 1] ?? '';
  if (tld.length < 2 || /\d/.test(tld)) return fail(raw, 'Not a valid domain');

  if (options.allowSubdomains === false && labels.length > 2) {
    return fail(raw, 'Subdomains are not allowed');
  }

  return ok(text, text, text !== raw);
}

function coerceUrl(raw: string, options: AnyFieldTypeOptions): CoercionResult {
  const trimmed = raw.trim();
  if (trimmed === '') return fail(raw, 'Not a valid URL');

  // Bare domains are common in spreadsheets; assume https rather than rejecting.
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return fail(raw, 'Not a valid URL');
  }

  if (!url.hostname.includes('.')) return fail(raw, 'Not a valid URL');

  const protocol = url.protocol.replace(':', '');
  if (options.acceptedProtocols && !options.acceptedProtocols.includes(protocol)) {
    return fail(raw, `Protocol must be one of: ${options.acceptedProtocols.join(', ')}`);
  }

  if (options.acceptedDomains && options.acceptedDomains.length > 0) {
    const host = url.hostname.toLowerCase();
    const allowed = options.acceptedDomains.some((domain) => {
      const target = domain.toLowerCase().replace(/^\./, '');
      return host === target || host.endsWith(`.${target}`);
    });
    if (!allowed) return fail(raw, `Domain must be one of: ${options.acceptedDomains.join(', ')}`);
  }

  const normalized = url.toString();
  return ok(normalized, normalized, normalized !== raw);
}

function coerceZip(raw: string, options: AnyFieldTypeOptions): CoercionResult {
  const digits = raw.replace(/\D/g, '');

  if (options.format === '9-digit') {
    if (digits.length !== 9) return fail(raw, 'Not a valid 9-digit ZIP code');
    const value = options.outputDash ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
    return ok(value, value, value !== raw);
  }

  // 5-digit mode still accepts ZIP+4 input, truncating to the base code.
  if (digits.length !== 5 && digits.length !== 9) return fail(raw, 'Not a valid ZIP code');
  const value = digits.slice(0, 5);
  return ok(value, value, value !== raw);
}

function coerceUuid(raw: string, options: AnyFieldTypeOptions): CoercionResult {
  const trimmed = raw.trim();
  const match = UUID_RE.exec(trimmed);
  if (!match) return fail(raw, 'Not a valid UUID');

  if (options.version !== undefined) {
    const version = parseInt(match[1] ?? '', 16);
    if (version !== options.version) {
      return fail(raw, `Not a valid version ${options.version} UUID`);
    }
  }

  const normalized = trimmed.toLowerCase();
  return ok(normalized, normalized, normalized !== raw);
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Coerces a raw cell value to its field type.
 *
 * Empty cells are always allowed here — emptiness is the `required` validator's
 * business, not the type's, so that an optional `number` column with blanks
 * does not light up red.
 */
export function coerceValue(raw: unknown, field: NormalizedField): CoercionResult {
  const text = raw == null ? '' : String(raw);
  const options = field.typeOptions;

  if (text.trim() === '' && field.typeName !== 'checkbox') {
    return ok(text, field.typeName === 'multi-select' ? [] : null, false);
  }

  switch (field.typeName) {
    case 'string':
      // Documented to pass through exactly as entered.
      return ok(text, text, false);
    case 'number':
      return coerceNumber(text, options);
    case 'date':
    case 'datetime':
    case 'time':
      return coerceDateLike(text, field.typeName, options);
    case 'select':
      return coerceSelect(text, field.selectOptions, options);
    case 'multi-select':
      return coerceMultiSelect(text, field.selectOptions, options);
    case 'checkbox': {
      // An untouched checkbox reads as false but must still *look* empty, so a
      // blank row stays blank rather than filling with the word "false".
      if (text.trim() === '') return ok('', false, false);
      const value = !CHECKBOX_FALSE.has(text.trim().toLowerCase());
      return ok(value ? 'true' : 'false', value, String(value) !== text);
    }
    case 'email':
      return coerceEmail(text);
    case 'country':
      return coerceCountry(text, options);
    case 'phone-number':
      return coercePhone(text, options);
    case 'ssn':
      return coerceSsn(text, options);
    case 'domain':
      return coerceDomain(text, options);
    case 'url':
      return coerceUrl(text, options);
    case 'us-state-territory':
      return coerceUsState(text);
    case 'us-zip-code':
      return coerceZip(text, options);
    case 'uuid':
      return coerceUuid(text, options);
    default:
      return ok(text, text, false);
  }
}

/** True when a field renders as a dropdown in the review grid. */
export function isSelectLike(field: NormalizedField): boolean {
  return field.typeName === 'select' || field.typeName === 'multi-select';
}
