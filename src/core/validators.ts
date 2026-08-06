/**
 * Validator engine.
 *
 * Runs over the whole record set at once rather than per-row, because
 * `unique` and `unique_with` are inherently cross-row: a value only becomes
 * invalid in the presence of another row that shares it.
 */

import type { NormalizedField } from './fieldTypes';
import { hiddenKeysOf, isRecordEmpty, type InternalRecord } from './model';
import type {
  InfoMessage,
  LengthValidator,
  MessageLevel,
  RegexValidator,
  RequireWithValidator,
  RequireWithValuesValidator,
  UniqueWithValidator,
  Validator,
} from '../types';

function isEmpty(value: string | undefined): boolean {
  return value === undefined || value.trim() === '';
}

function cellText(record: InternalRecord, key: string): string {
  return record.cells[key]?.value ?? '';
}

function message(validator: Validator, fallback: string): InfoMessage {
  return {
    message: validator.errorMessage ?? fallback,
    level: (validator.level ?? 'error') as MessageLevel,
  };
}

function buildRegex(validator: RegexValidator): RegExp | null {
  const { regex, regexOptions } = validator;
  if (regex instanceof RegExp) return regex;

  let flags = '';
  if (regexOptions?.ignoreCase) flags += 'i';
  if (regexOptions?.dotAll) flags += 's';
  if (regexOptions?.multiline) flags += 'm';
  if (regexOptions?.unicode) flags += 'u';

  try {
    return new RegExp(regex, flags);
  } catch {
    // A malformed pattern is a schema bug; failing every row would be worse
    // than skipping the rule, so we skip and let the console warning surface it.
    if (typeof console !== 'undefined') {
      console.warn(`[react-sheet-uploader] Invalid regex in validator: ${String(regex)}`);
    }
    return null;
  }
}

/** True when the conditional-requirement rule says this field is required. */
function conditionIsMet(
  validator: RequireWithValidator | RequireWithValuesValidator,
  record: InternalRecord,
): boolean {
  if ('fields' in validator) {
    const filled = validator.fields.map((key) => !isEmpty(cellText(record, key)));
    switch (validator.validate) {
      case 'require_with':
        return filled.some(Boolean);
      case 'require_without':
        return filled.some((f) => !f);
      case 'require_with_all':
        return filled.length > 0 && filled.every(Boolean);
      case 'require_without_all':
        return filled.length > 0 && filled.every((f) => !f);
      default:
        return false;
    }
  }

  const entries = Object.entries(validator.fieldValues);
  const matches = entries.map(([key, expected]) => cellText(record, key) === String(expected));

  switch (validator.validate) {
    case 'require_with_values':
      return matches.some(Boolean);
    case 'require_with_all_values':
      return matches.length > 0 && matches.every(Boolean);
    case 'require_without_values':
      return matches.some((m) => !m);
    case 'require_without_all_values':
      return matches.length > 0 && matches.every((m) => !m);
    default:
      return false;
  }
}

function describeFields(fields: string[], fieldsByKey: Map<string, NormalizedField>): string {
  return fields.map((key) => fieldsByKey.get(key)?.label ?? key).join(', ');
}

function conditionDescription(
  validator: RequireWithValidator | RequireWithValuesValidator,
  fieldsByKey: Map<string, NormalizedField>,
): string {
  if ('fields' in validator) {
    const names = describeFields(validator.fields, fieldsByKey);
    switch (validator.validate) {
      case 'require_with':
        return `Required when ${names} is present`;
      case 'require_without':
        return `Required when ${names} is missing`;
      case 'require_with_all':
        return `Required when all of ${names} are present`;
      case 'require_without_all':
        return `Required when all of ${names} are missing`;
      default:
        return 'Required';
    }
  }

  const names = describeFields(Object.keys(validator.fieldValues), fieldsByKey);
  switch (validator.validate) {
    case 'require_with_values':
      return `Required based on the value of ${names}`;
    case 'require_with_all_values':
      return `Required based on the values of ${names}`;
    case 'require_without_values':
    case 'require_without_all_values':
      return `Required when ${names} does not have the expected value`;
    default:
      return 'Required';
  }
}

function lengthMessage(validator: LengthValidator): string {
  const { min, max } = validator;
  if (min !== undefined && max !== undefined) {
    return min === max
      ? `Must be exactly ${min} characters`
      : `Must be between ${min} and ${max} characters`;
  }
  if (min !== undefined) return `Must be at least ${min} characters`;
  if (max !== undefined) return `Must be at most ${max} characters`;
  return 'Invalid length';
}

/* -------------------------------------------------------------------------- */
/* Cross-row rules                                                             */
/* -------------------------------------------------------------------------- */

interface UniqueGroup {
  /** Fields participating, in schema order. */
  fields: NormalizedField[];
  validator: UniqueWithValidator;
}

/** Collects `unique_with` validators sharing a `uniqueKey` into one rule. */
function collectUniqueGroups(fields: NormalizedField[]): Map<string, UniqueGroup> {
  const groups = new Map<string, UniqueGroup>();

  for (const field of fields) {
    for (const validator of field.validators) {
      if (validator.validate !== 'unique_with') continue;
      const existing = groups.get(validator.uniqueKey);
      if (existing) {
        existing.fields.push(field);
      } else {
        groups.set(validator.uniqueKey, { fields: [field], validator });
      }
    }
  }

  return groups;
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Recomputes `cell.issues` for every record in place.
 *
 * Type coercion errors are produced upstream when the value is set, so they are
 * seeded from `cell.typeError` rather than recomputed here.
 */
export function validateRecords(records: InternalRecord[], fields: NormalizedField[]): void {
  const fieldsByKey = new Map(fields.map((field) => [field.key, field]));

  for (const record of records) {
    for (const field of fields) {
      const cell = record.cells[field.key];
      if (!cell) continue;
      cell.issues = cell.typeError ? [cell.typeError] : [];
    }
  }

  // Blank rows are pending input, not errors: a fresh manual-entry grid should
  // not open covered in "required" failures. Excluding them here also keeps
  // them out of `unique` grouping, where several blanks would collide.
  const hidden = hiddenKeysOf(fields);
  const filled = records.filter((record) => !isRecordEmpty(record, hidden));

  for (const field of fields) {
    for (const validator of field.validators) {
      switch (validator.validate) {
        case 'required':
          applyRequired(filled, field, validator);
          break;
        case 'unique':
        case 'unique_case_insensitive':
          applyUnique(filled, field, validator, validator.validate === 'unique_case_insensitive');
          break;
        case 'unique_with':
          // Handled once per group below.
          break;
        case 'regex_match':
        case 'regex_exclude':
          applyRegex(filled, field, validator);
          break;
        case 'require_with':
        case 'require_without':
        case 'require_with_all':
        case 'require_without_all':
        case 'require_with_values':
        case 'require_without_values':
        case 'require_with_all_values':
        case 'require_without_all_values':
          applyConditionalRequired(filled, field, validator, fieldsByKey);
          break;
        case 'length':
          applyLength(filled, field, validator);
          break;
        case 'alphabetical':
          applyAlphabetical(filled, field, validator);
          break;
        default:
          break;
      }
    }
  }

  for (const group of collectUniqueGroups(fields).values()) {
    applyUniqueWith(filled, group);
  }
}

function push(record: InternalRecord, key: string, msg: InfoMessage): void {
  const cell = record.cells[key];
  if (cell) cell.issues.push(msg);
}

function applyRequired(
  records: InternalRecord[],
  field: NormalizedField,
  validator: Validator,
): void {
  const msg = message(validator, `${field.label} is required`);
  for (const record of records) {
    if (isEmpty(cellText(record, field.key))) push(record, field.key, msg);
  }
}

function applyUnique(
  records: InternalRecord[],
  field: NormalizedField,
  validator: Validator,
  caseInsensitive: boolean,
): void {
  const seen = new Map<string, number>();

  for (const record of records) {
    const raw = cellText(record, field.key);
    if (isEmpty(raw)) continue;
    const key = caseInsensitive ? raw.trim().toLowerCase() : raw.trim();
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }

  const msg = message(validator, `${field.label} must be unique`);
  for (const record of records) {
    const raw = cellText(record, field.key);
    if (isEmpty(raw)) continue;
    const key = caseInsensitive ? raw.trim().toLowerCase() : raw.trim();
    if ((seen.get(key) ?? 0) > 1) push(record, field.key, msg);
  }
}

function applyUniqueWith(records: InternalRecord[], group: UniqueGroup): void {
  const { fields, validator } = group;
  // A single participating field degrades to a plain `unique`.
  const compositeOf = (record: InternalRecord): string | null => {
    const parts = fields.map((field) => cellText(record, field.key).trim());
    return parts.every(isEmpty) ? null : parts.join(' ');
  };

  const seen = new Map<string, number>();
  for (const record of records) {
    const composite = compositeOf(record);
    if (composite === null) continue;
    seen.set(composite, (seen.get(composite) ?? 0) + 1);
  }

  const labels = fields.map((f) => f.label).join(' + ');
  const msg = message(validator, `${labels} must be unique together`);

  for (const record of records) {
    const composite = compositeOf(record);
    if (composite === null) continue;
    if ((seen.get(composite) ?? 0) > 1) {
      for (const field of fields) push(record, field.key, msg);
    }
  }
}

function applyRegex(
  records: InternalRecord[],
  field: NormalizedField,
  validator: RegexValidator,
): void {
  const regex = buildRegex(validator);
  if (!regex) return;

  const shouldMatch = validator.validate === 'regex_match';
  const msg = message(
    validator,
    shouldMatch ? `${field.label} is not in the expected format` : `${field.label} has a disallowed value`,
  );

  for (const record of records) {
    const raw = cellText(record, field.key);
    if (isEmpty(raw)) continue;
    // `lastIndex` persists on global regexes and would desync across rows.
    regex.lastIndex = 0;
    if (regex.test(raw) !== shouldMatch) push(record, field.key, msg);
  }
}

function applyConditionalRequired(
  records: InternalRecord[],
  field: NormalizedField,
  validator: RequireWithValidator | RequireWithValuesValidator,
  fieldsByKey: Map<string, NormalizedField>,
): void {
  const msg = message(validator, conditionDescription(validator, fieldsByKey));

  for (const record of records) {
    if (!isEmpty(cellText(record, field.key))) continue;
    if (conditionIsMet(validator, record)) push(record, field.key, msg);
  }
}

function applyLength(
  records: InternalRecord[],
  field: NormalizedField,
  validator: LengthValidator,
): void {
  const msg = message(validator, lengthMessage(validator));

  for (const record of records) {
    const raw = cellText(record, field.key);
    if (isEmpty(raw)) continue;
    const { length } = raw;
    if (
      (validator.min !== undefined && length < validator.min) ||
      (validator.max !== undefined && length > validator.max)
    ) {
      push(record, field.key, msg);
    }
  }
}

function applyAlphabetical(
  records: InternalRecord[],
  field: NormalizedField,
  validator: Validator,
): void {
  const msg = message(validator, `${field.label} must contain only letters`);

  for (const record of records) {
    const raw = cellText(record, field.key);
    if (isEmpty(raw)) continue;
    if (!/^[a-zA-Z]+$/.test(raw.trim())) push(record, field.key, msg);
  }
}
