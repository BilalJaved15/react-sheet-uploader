/**
 * The data pipeline: raw rows in, validated records out.
 *
 * Order of operations, matching Dromo's:
 *   1. type coercion       — raw text becomes typed values
 *   2. column hooks        — whole-column rewrites
 *   3. row hooks           — per-row rewrites and messages
 *   4. bulk row hooks      — whole-table rewrites
 *   5. validators          — required/unique/regex/… over the final values
 *
 * Validation runs last so it judges what the hooks produced, not what the file
 * contained. Hooks that set `info` messages keep them: only `issues` is cleared
 * and rebuilt on each pass.
 */

import { coerceValue, type NormalizedField } from './fieldTypes';
import {
  emptyCell,
  nextRecordId,
  type Cell,
  type InternalRecord,
} from './model';
import { validateRecords } from './validators';
import type {
  BulkRowHook,
  ColumnHook,
  ColumnHookRegistration,
  ColumnHookValue,
  HookCell,
  HookMode,
  HookRecord,
  InfoMessage,
  RowHook,
} from '../types';

export interface HookRegistry {
  rowHooks?: RowHook[];
  bulkRowHooks?: BulkRowHook[];
  columnHooks?: ColumnHookRegistration[];
}

/** Splits a `manyToOne` cell's display text back into its parts. */
const MANY_TO_ONE_DELIMITER = ', ';

function splitManyToOne(display: string): string[] {
  return display
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

/**
 * Applies a field's type to a raw value and writes the result into a cell.
 *
 * `manyToOne` fields coerce each part independently and output an array, which
 * is what the results contract promises for them.
 */
export function setCellValue(cell: Cell, field: NormalizedField, raw: unknown): void {
  if (field.manyToOne) {
    const parts = Array.isArray(raw) ? raw.map(String) : splitManyToOne(raw == null ? '' : String(raw));
    const displays: string[] = [];
    const outputs: string[] = [];
    let firstError: InfoMessage | undefined;
    let autofixed = false;

    for (const part of parts) {
      const result = coerceValue(part, field);
      displays.push(result.display);
      outputs.push(result.output == null ? '' : String(result.output));
      autofixed ||= result.autofixed;
      if (result.error && !firstError) firstError = { message: result.error, level: 'error' };
    }

    cell.value = displays.join(MANY_TO_ONE_DELIMITER);
    cell.manyToOneValues = outputs;
    cell.output = outputs;
    cell.autofixed = autofixed;
    cell.typeError = firstError;
    return;
  }

  const result = coerceValue(raw, field);
  cell.value = result.display;
  cell.output = result.output;
  cell.autofixed = result.autofixed;
  cell.typeError = result.error ? { message: result.error, level: 'error' } : undefined;
  cell.manyToOneValues = undefined;
}

export interface BuildRecordsOptions {
  /** Source column index -> field key. Columns absent from the map are unmapped. */
  columnToField: Map<number, string>;
  fields: NormalizedField[];
  /** Keep unmapped column values for the `$unmapped` result key. */
  passThroughUnmappedColumns?: boolean;
  /** File row number of the first data row, for "row N" labels. */
  firstSourceRow?: number;
}

/** Turns raw data rows into records, applying the column mapping. */
export function buildRecords(
  dataRows: string[][],
  options: BuildRecordsOptions,
): InternalRecord[] {
  const { columnToField, fields, passThroughUnmappedColumns = false, firstSourceRow = 2 } = options;

  // A manyToOne field draws from several columns, so invert the map once.
  const columnsByField = new Map<string, number[]>();
  for (const [columnIndex, fieldKey] of columnToField) {
    const existing = columnsByField.get(fieldKey);
    if (existing) existing.push(columnIndex);
    else columnsByField.set(fieldKey, [columnIndex]);
  }
  for (const indexes of columnsByField.values()) indexes.sort((a, b) => a - b);

  return dataRows.map((row, rowIndex) => {
    const record: InternalRecord = {
      id: nextRecordId(),
      cells: {},
      sourceRow: firstSourceRow + rowIndex,
      unmapped: {},
    };

    for (const field of fields) {
      const cell = emptyCell();
      const columns = columnsByField.get(field.key);

      if (columns && columns.length > 0) {
        if (field.manyToOne) {
          const values = columns.map((index) => row[index] ?? '').filter((v) => v.trim() !== '');
          setCellValue(cell, field, values);
        } else {
          setCellValue(cell, field, row[columns[0] as number] ?? '');
        }
      } else {
        // Unmapped fields still exist, so hooks can populate them.
        setCellValue(cell, field, '');
      }

      record.cells[field.key] = cell;
    }

    if (passThroughUnmappedColumns) {
      for (let index = 0; index < row.length; index += 1) {
        if (columnToField.has(index)) continue;
        const value = row[index] ?? '';
        if (value !== '') record.unmapped[String(index)] = value;
      }
    }

    return record;
  });
}

/* -------------------------------------------------------------------------- */
/* Hook bridging                                                               */
/* -------------------------------------------------------------------------- */

/** Projects internal records into the shape hooks expect. */
export function toHookRecords(records: InternalRecord[], fields: NormalizedField[]): HookRecord[] {
  return records.map((record, index) => {
    const row: Record<string, HookCell> = {};
    for (const field of fields) {
      const cell = record.cells[field.key];
      if (!cell) continue;
      const hookCell: HookCell = { value: cell.value, info: cell.info.slice() };
      if (cell.resultValue !== undefined) hookCell.resultValue = cell.resultValue;
      if (cell.selectOptions) hookCell.selectOptions = cell.selectOptions;
      row[field.key] = hookCell;
    }
    return { index, row };
  });
}

/**
 * Writes a hook's returned record back into internal state.
 *
 * A changed `value` is re-coerced, so a hook that writes `"1/5/24"` into a date
 * field still yields a properly formatted, validated cell.
 */
export function applyHookRecord(
  record: InternalRecord,
  hookRecord: HookRecord | { row: Record<string, HookCell> },
  fieldsByKey: Map<string, NormalizedField>,
): void {
  const row = hookRecord.row;
  if (!row) return;

  for (const [fieldKey, hookCell] of Object.entries(row)) {
    if (!hookCell) continue;
    const field = fieldsByKey.get(fieldKey);
    if (!field) continue;

    // A field added part-way through a pass — a step hook's computed column —
    // has no cell on records that were built before it existed. Give it one
    // instead of dropping the write, so the hook that fills the column does not
    // depend on having run after the records were rebuilt.
    let cell = record.cells[fieldKey];
    if (!cell) {
      cell = emptyCell();
      setCellValue(cell, field, '');
      record.cells[fieldKey] = cell;
    }

    if (hookCell.value !== undefined && hookCell.value !== cell.value) {
      setCellValue(cell, field, hookCell.value);
    }
    if (hookCell.info !== undefined) {
      cell.info = normalizeMessages(hookCell.info);
    }
    if (hookCell.resultValue !== undefined) {
      cell.resultValue = hookCell.resultValue;
    }
    if (hookCell.selectOptions !== undefined) {
      cell.selectOptions = hookCell.selectOptions;
    }
  }
}

function normalizeMessages(messages: InfoMessage[]): InfoMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((message) => message && typeof message.message === 'string')
    .map((message) => ({ message: message.message, level: message.level ?? 'error' }));
}

/* -------------------------------------------------------------------------- */
/* Hook execution                                                              */
/* -------------------------------------------------------------------------- */

async function runColumnHooks(
  records: InternalRecord[],
  fieldsByKey: Map<string, NormalizedField>,
  registrations: ColumnHookRegistration[],
  mode: HookMode,
): Promise<void> {
  for (const { fieldKey, callback } of registrations) {
    const field = fieldsByKey.get(fieldKey);
    if (!field || typeof callback !== 'function') continue;

    const values: ColumnHookValue[] = records.map((record, index) => ({
      index,
      value: record.cells[fieldKey]?.value ?? '',
      info: record.cells[fieldKey]?.info.slice() ?? [],
    }));

    const returned = await (callback as ColumnHook)(values, mode);
    if (!Array.isArray(returned)) continue;

    for (const entry of returned) {
      if (!entry || typeof entry.index !== 'number') continue;
      const record = records[entry.index];
      const cell = record?.cells[fieldKey];
      if (!record || !cell) continue;

      if (entry.value !== undefined && entry.value !== cell.value) {
        setCellValue(cell, field, entry.value);
      }
      if (entry.info !== undefined) cell.info = normalizeMessages(entry.info);
    }
  }
}

async function runRowHooks(
  records: InternalRecord[],
  fields: NormalizedField[],
  fieldsByKey: Map<string, NormalizedField>,
  hooks: RowHook[],
  mode: HookMode,
): Promise<void> {
  for (const hook of hooks) {
    if (typeof hook !== 'function') continue;

    for (let i = 0; i < records.length; i += 1) {
      const record = records[i];
      if (!record) continue;

      const [hookRecord] = toHookRecords([record], fields);
      if (!hookRecord) continue;
      hookRecord.index = i;

      const returned = await hook(hookRecord, mode);
      // Mutating the argument is the documented style, so fall back to it when
      // the hook returns nothing.
      applyHookRecord(record, (returned as HookRecord) ?? hookRecord, fieldsByKey);
    }
  }
}

async function runBulkRowHooks(
  records: InternalRecord[],
  fields: NormalizedField[],
  fieldsByKey: Map<string, NormalizedField>,
  hooks: BulkRowHook[],
  mode: HookMode,
): Promise<void> {
  for (const hook of hooks) {
    if (typeof hook !== 'function') continue;

    const hookRecords = toHookRecords(records, fields);
    const returned = await hook(hookRecords, mode);
    const applied = Array.isArray(returned) ? returned : hookRecords;

    for (const hookRecord of applied) {
      if (!hookRecord || typeof hookRecord.index !== 'number') continue;
      const record = records[hookRecord.index];
      if (record) applyHookRecord(record, hookRecord, fieldsByKey);
    }
  }
}

export interface RunPipelineOptions {
  /** `init` on first load, `update` after user edits. */
  mode: HookMode;
  /**
   * Records the hooks should see. Defaults to all of them; on `update` this is
   * narrowed to the rows that actually changed, so hooks stay cheap while
   * typing. Validation always runs over the full set, since `unique` is global.
   */
  hookScope?: InternalRecord[];
}

/**
 * Runs hooks over `hookScope` and validators over every record.
 *
 * Mutates in place — callers clone first when they need the previous state.
 */
export async function runPipeline(
  records: InternalRecord[],
  fields: NormalizedField[],
  hooks: HookRegistry,
  options: RunPipelineOptions,
): Promise<void> {
  const { mode, hookScope = records } = options;
  const fieldsByKey = new Map(fields.map((field) => [field.key, field]));

  if (hooks.columnHooks?.length) {
    await runColumnHooks(hookScope, fieldsByKey, hooks.columnHooks, mode);
  }
  if (hooks.rowHooks?.length) {
    await runRowHooks(hookScope, fields, fieldsByKey, hooks.rowHooks, mode);
  }
  if (hooks.bulkRowHooks?.length) {
    await runBulkRowHooks(hookScope, fields, fieldsByKey, hooks.bulkRowHooks, mode);
  }

  validateRecords(records, fields);
}

/** Adds blank records for a schema, used by "add row" and `instance.addRows`. */
export function createBlankRecords(
  fields: NormalizedField[],
  count: number,
  seed?: Array<Record<string, unknown>>,
): InternalRecord[] {
  return Array.from({ length: count }, (_, i) => {
    const record: InternalRecord = {
      id: nextRecordId(),
      cells: {},
      sourceRow: null,
      unmapped: {},
    };
    for (const field of fields) {
      const cell = emptyCell();
      setCellValue(cell, field, seed?.[i]?.[field.key] ?? '');
      record.cells[field.key] = cell;
    }
    return record;
  });
}
