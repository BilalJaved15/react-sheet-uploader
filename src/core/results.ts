/**
 * Assembling the final payload handed to `beforeFinish` and `onResults`.
 */

import type { NormalizedField } from './fieldTypes';
import type { ColumnMapping } from './matching';
import {
  cellMessages,
  hiddenKeysOf,
  isRecordEmpty,
  messageLevel,
  recordHasError,
  type InternalRecord,
} from './model';
import type {
  InvalidDataBehavior,
  ResultError,
  ResultFieldMetadata,
  ResultMetadata,
  ResultRow,
  ResultValue,
  User,
} from '../types';

export interface BuildResultsOptions {
  fields: NormalizedField[];
  mappings: ColumnMapping[];
  rawHeaders: string[];
  filename: string | null;
  /** The uploaded file, passed straight through for archiving. */
  originalFile?: File | null;
  importIdentifier?: string;
  user?: User;
  invalidDataBehavior: InvalidDataBehavior;
  passThroughUnmappedColumns?: boolean;
}

export interface BuiltResults {
  data: ResultRow[];
  metadata: ResultMetadata;
}

function cellOutput(record: InternalRecord, fieldKey: string): ResultValue | undefined {
  const cell = record.cells[fieldKey];
  if (!cell) return undefined;
  // A hook's `resultValue` deliberately overrides what coercion produced.
  if (cell.resultValue !== undefined) return cell.resultValue as ResultValue;
  return cell.output;
}

function buildFieldMetadata(
  fields: NormalizedField[],
  mappings: ColumnMapping[],
  rawHeaders: string[],
): ResultFieldMetadata[] {
  return fields.map((field) => {
    const matched = mappings.filter((mapping) => mapping.fieldKey === field.key);
    const first = matched[0];

    const entry: ResultFieldMetadata = {
      key: field.key,
      label: field.label,
      fileHeader: first ? (rawHeaders[first.columnIndex] ?? null) : null,
      fileHeaderIndex: first ? first.columnIndex : null,
      isCustom: field.isCustom,
      manyToOne: field.manyToOne,
    };

    if (field.manyToOne) {
      entry.mappedHeaders = matched.map((m) => rawHeaders[m.columnIndex] ?? '');
    }

    return entry;
  });
}

/**
 * Builds the results array and its metadata.
 *
 * `REMOVE_INVALID_ROWS` drops erroring rows here rather than earlier, so the
 * metadata can still report how many were dropped and why.
 */
export function buildResults(
  records: InternalRecord[],
  options: BuildResultsOptions,
): BuiltResults {
  const {
    fields,
    mappings,
    rawHeaders,
    filename,
    originalFile = null,
    importIdentifier,
    user,
    invalidDataBehavior,
    passThroughUnmappedColumns = false,
  } = options;

  // Blank rows are pending input, never data: trailing lines in a file and
  // untouched manual-entry rows should not become empty result objects.
  const hidden = hiddenKeysOf(fields);
  const present = records.filter((record) => !isRecordEmpty(record, hidden));

  const totalRows = present.length;
  const invalidRows = present.filter(recordHasError).length;

  const included =
    invalidDataBehavior === 'REMOVE_INVALID_ROWS'
      ? present.filter((record) => !recordHasError(record))
      : present;

  const data: ResultRow[] = [];
  const errors: ResultError[] = [];
  const rowsWithError: number[] = [];

  included.forEach((record, rowIndex) => {
    const row: ResultRow = {};

    for (const field of fields) {
      const value = cellOutput(record, field.key);
      row[field.key] = value === undefined ? null : value;
    }

    if (passThroughUnmappedColumns && Object.keys(record.unmapped).length > 0) {
      row.$unmapped = record.unmapped;
    }

    data.push(row);

    let rowHasError = false;
    for (const field of fields) {
      const cell = record.cells[field.key];
      if (!cell) continue;
      for (const message of cellMessages(cell)) {
        const level = messageLevel(message);
        if (level !== 'error') continue;
        rowHasError = true;
        errors.push({
          rowIndex,
          fieldKey: field.key,
          message: message.message,
          value: cell.value,
          level,
        });
      }
    }
    if (rowHasError) rowsWithError.push(rowIndex);
  });

  const metadata: ResultMetadata = {
    // There is no backend here to mint an import id.
    id: null,
    filename,
    originalFile,
    importIdentifier,
    user,
    rawHeaders,
    fields: buildFieldMetadata(fields, mappings, rawHeaders),
    rowsWithError,
    errors,
    totalRows,
    validRows: totalRows - invalidRows,
    invalidRows,
  };

  return { data, metadata };
}

/** Whether the Finish button should be enabled given the current data. */
export function canSubmit(
  allRecords: InternalRecord[],
  fields: NormalizedField[],
  invalidDataBehavior: InvalidDataBehavior,
  allowEmptySubmit: boolean,
): { allowed: boolean; reason?: string } {
  // Matches what `buildResults` will actually submit.
  const hidden = hiddenKeysOf(fields);
  const records = allRecords.filter((record) => !isRecordEmpty(record, hidden));
  const errorCount = records.filter(recordHasError).length;

  if (invalidDataBehavior === 'BLOCK_SUBMIT' && errorCount > 0) {
    return {
      allowed: false,
      reason: `Fix ${errorCount} row${errorCount === 1 ? '' : 's'} with errors before continuing.`,
    };
  }

  const submittable =
    invalidDataBehavior === 'REMOVE_INVALID_ROWS' ? records.length - errorCount : records.length;

  if (submittable === 0 && !allowEmptySubmit) {
    return {
      allowed: false,
      reason:
        errorCount > 0
          ? 'Every row has an error, so there is nothing to submit.'
          : 'There is no data to submit.',
    };
  }

  return { allowed: true };
}
