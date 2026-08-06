/**
 * Column matching: deciding which uploaded column feeds which schema field.
 *
 * Matching is global rather than per-column. Scoring every (column, field) pair
 * and assigning the strongest first stops an early mediocre match from stealing
 * a field that a later column matches exactly — the failure mode of a simple
 * left-to-right pass over "Name" then "First Name" against a `firstName` field.
 */

import type { NormalizedField } from './fieldTypes';
import { normalizeForMatch, similarity } from './similarity';

export interface SourceColumn {
  /** Position in the uploaded file. */
  index: number;
  header: string;
  /** A few non-empty values, for the preview shown during matching. */
  samples: string[];
}

export interface ColumnMapping {
  columnIndex: number;
  /** Target field key, or null when the column is ignored. */
  fieldKey: string | null;
  /** True once the user has explicitly confirmed or changed the mapping. */
  confirmed: boolean;
  /** Similarity that produced an automatic match, if any. */
  score?: number;
}

export const DEFAULT_MATCH_THRESHOLD = 0.7;

/** Builds the column list from a header row and the data beneath it. */
export function buildSourceColumns(
  headerRow: string[],
  dataRows: string[][],
  sampleCount = 3,
): SourceColumn[] {
  return headerRow.map((header, index) => {
    const samples: string[] = [];
    for (const row of dataRows) {
      const value = row[index];
      if (value !== undefined && value.trim() !== '') {
        samples.push(value);
        if (samples.length >= sampleCount) break;
      }
    }
    return { index, header, samples };
  });
}

/** Every string that should resolve to a field, strongest signal first. */
function fieldAliases(field: NormalizedField): string[] {
  return [field.label, field.key, ...field.alternateMatches];
}

/**
 * Exact match on any alias, ignoring case, spacing and punctuation.
 * Always applied, even when fuzzy matching is off.
 */
function exactScore(header: string, field: NormalizedField): number {
  const normalized = normalizeForMatch(header);
  if (normalized === '') return 0;
  return fieldAliases(field).some((alias) => normalizeForMatch(alias) === normalized) ? 1 : 0;
}

function fuzzyScore(header: string, field: NormalizedField): number {
  let best = 0;
  for (const alias of fieldAliases(field)) {
    best = Math.max(best, similarity(header, alias));
    if (best === 1) break;
  }
  return best;
}

export interface AutoMatchOptions {
  /** Defaults to true. When false, only exact alias matches are made. */
  fuzzyMatchHeaders?: boolean;
  /** Minimum score for a fuzzy match. Defaults to 0.7. */
  threshold?: number;
}

/**
 * Assigns columns to fields, strongest match first.
 *
 * A field is claimed by at most one column unless it is `manyToOne`; a column
 * is never assigned twice.
 */
export function autoMatchColumns(
  columns: SourceColumn[],
  fields: NormalizedField[],
  options: AutoMatchOptions = {},
): ColumnMapping[] {
  const fuzzy = options.fuzzyMatchHeaders ?? true;
  const threshold = options.threshold ?? DEFAULT_MATCH_THRESHOLD;

  const matchable = fields.filter((field) => !field.hidden);

  const candidates: Array<{ columnIndex: number; fieldKey: string; score: number }> = [];
  for (const column of columns) {
    if (column.header.trim() === '') continue;
    for (const field of matchable) {
      const exact = exactScore(column.header, field);
      const score = exact === 1 ? 1 : fuzzy ? fuzzyScore(column.header, field) : 0;
      if (score >= threshold) {
        candidates.push({ columnIndex: column.index, fieldKey: field.key, score });
      }
    }
  }

  // Highest score wins; ties break on column order so results are deterministic.
  candidates.sort((a, b) => b.score - a.score || a.columnIndex - b.columnIndex);

  const fieldsByKey = new Map(matchable.map((field) => [field.key, field]));
  const takenColumns = new Set<number>();
  const takenFields = new Set<string>();
  const assigned = new Map<number, { fieldKey: string; score: number }>();

  for (const candidate of candidates) {
    if (takenColumns.has(candidate.columnIndex)) continue;

    const field = fieldsByKey.get(candidate.fieldKey);
    if (!field) continue;
    if (takenFields.has(candidate.fieldKey) && !field.manyToOne) continue;

    takenColumns.add(candidate.columnIndex);
    takenFields.add(candidate.fieldKey);
    assigned.set(candidate.columnIndex, { fieldKey: candidate.fieldKey, score: candidate.score });
  }

  return columns.map((column) => {
    const match = assigned.get(column.index);
    return match
      ? { columnIndex: column.index, fieldKey: match.fieldKey, confirmed: false, score: match.score }
      : { columnIndex: column.index, fieldKey: null, confirmed: false };
  });
}

/**
 * Guesses which row holds the headers.
 *
 * Scores each of the first few rows on how header-like it is — full, textual,
 * distinct, and unlike the rows beneath it — then takes the best.
 */
export function detectHeaderRow(rows: string[][], maxScan = 10): number {
  const limit = Math.min(rows.length, maxScan);
  let bestIndex = 0;
  let bestScore = -Infinity;

  for (let i = 0; i < limit; i += 1) {
    const row = rows[i];
    if (!row) continue;

    const cells = row.map((cell) => cell.trim());
    const filled = cells.filter((cell) => cell !== '');
    if (filled.length === 0) continue;

    // Density: headers rarely have gaps.
    const density = filled.length / cells.length;

    // Textual: headers are words, not numbers or dates.
    const textual = filled.filter((cell) => Number.isNaN(Number(cell)) && cell.length < 64).length /
      filled.length;

    // Distinct: headers are unique; data rows repeat values.
    const distinct = new Set(filled.map((c) => c.toLowerCase())).size / filled.length;

    // Contrast: the row below should look different from this one.
    const next = rows[i + 1];
    let contrast = 0;
    if (next) {
      const nextFilled = next.map((c) => c.trim()).filter((c) => c !== '');
      const nextNumeric =
        nextFilled.length === 0
          ? 0
          : nextFilled.filter((c) => !Number.isNaN(Number(c))).length / nextFilled.length;
      contrast = nextNumeric;
    }

    // Prefer earlier rows, all else equal.
    const score = density * 2 + textual * 2 + distinct + contrast - i * 0.15;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestIndex;
}

/** Fields that must be mapped but are not, blocking the matching step. */
export function unmappedRequiredFields(
  mappings: ColumnMapping[],
  fields: NormalizedField[],
): NormalizedField[] {
  const mapped = new Set(
    mappings.map((mapping) => mapping.fieldKey).filter((key): key is string => key !== null),
  );
  return fields.filter((field) => field.requireMapping && !field.hidden && !mapped.has(field.key));
}

/** Column indexes that ended up feeding a given field, in file order. */
export function columnsForField(mappings: ColumnMapping[], fieldKey: string): number[] {
  return mappings
    .filter((mapping) => mapping.fieldKey === fieldKey)
    .map((mapping) => mapping.columnIndex)
    .sort((a, b) => a - b);
}
