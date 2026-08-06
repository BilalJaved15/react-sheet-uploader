/**
 * Internal record model.
 *
 * Hooks see a simplified view of this (`HookRecord`), and results see another
 * (`ResultRow`). Keeping the internal shape separate lets us track things the
 * public shapes have no room for — which messages came from hooks versus
 * validators, whether a cell was auto-corrected, and the original source row.
 */

import type { InfoMessage, ResultValue, SelectOption } from '../types';

export interface Cell {
  /** Text shown in the grid; what hooks read and write as `value`. */
  value: string;
  /** Value destined for the results object. */
  output: ResultValue;
  /** Set by a hook's `resultValue`, overriding `output`. */
  resultValue?: unknown;
  /** Set when the value does not fit the field type. Owned by coercion. */
  typeError?: InfoMessage;
  /** Messages set by hooks. Survive re-validation. */
  info: InfoMessage[];
  /** `typeError` plus validator failures. Recomputed on every validation pass. */
  issues: InfoMessage[];
  /** Per-cell dropdown options, set by a hook. */
  selectOptions?: SelectOption[];
  /** True when type coercion rewrote the user's input. */
  autofixed: boolean;
  /** Individual values for a `manyToOne` field, which outputs an array. */
  manyToOneValues?: string[];
}

export interface InternalRecord {
  /** Stable across sorting, filtering and edits. */
  id: string;
  cells: Record<string, Cell>;
  /** 1-based row number in the source file, or null for manually added rows. */
  sourceRow: number | null;
  /** Values of columns that were not mapped, keyed by source column index. */
  unmapped: Record<string, string>;
}

export function emptyCell(): Cell {
  return { value: '', output: null, info: [], issues: [], autofixed: false };
}

/** All messages on a cell, hooks first so developer intent reads before ours. */
export function cellMessages(cell: Cell): InfoMessage[] {
  if (cell.info.length === 0) return cell.issues;
  if (cell.issues.length === 0) return cell.info;
  return [...cell.info, ...cell.issues];
}

export function messageLevel(message: InfoMessage): 'error' | 'warning' | 'info' {
  return message.level ?? 'error';
}

/** The most severe level present on a cell, or null when it is clean. */
export function cellSeverity(cell: Cell): 'error' | 'warning' | 'info' | null {
  let result: 'error' | 'warning' | 'info' | null = null;
  for (const message of cellMessages(cell)) {
    const level = messageLevel(message);
    if (level === 'error') return 'error';
    if (level === 'warning') result = 'warning';
    else if (result === null) result = 'info';
  }
  return result;
}

/**
 * True when the user has put nothing into this row.
 *
 * Empty rows are treated as "not yet filled in" rather than "invalid": a fresh
 * manual-entry grid, a newly added row, and trailing blank lines in a file
 * should not light up as required-field failures. They are dropped at submit.
 *
 * Hidden fields are ignored, because they are never user-enterable — a row hook
 * that stamps every record with a timestamp must not make blank rows look
 * filled in.
 */
export function isRecordEmpty(record: InternalRecord, hiddenFieldKeys?: ReadonlySet<string>): boolean {
  for (const [fieldKey, cell] of Object.entries(record.cells)) {
    if (hiddenFieldKeys?.has(fieldKey)) continue;
    if (cell.value.trim() !== '') return false;
  }
  return true;
}

/** The hidden field keys, in the shape `isRecordEmpty` wants. */
export function hiddenKeysOf(fields: Array<{ key: string; hidden: boolean }>): Set<string> {
  return new Set(fields.filter((field) => field.hidden).map((field) => field.key));
}

export function recordHasError(record: InternalRecord): boolean {
  for (const cell of Object.values(record.cells)) {
    if (cellSeverity(cell) === 'error') return true;
  }
  return false;
}

let idCounter = 0;

export function nextRecordId(): string {
  idCounter += 1;
  return `r${idCounter}`;
}
