/**
 * JSON parsing.
 *
 * Accepts either an array of objects (keys become headers) or an array of
 * arrays (already tabular). Nested values are serialized back to JSON rather
 * than flattened, so nothing is silently lost.
 */

import { FileParseError, squareOff, trimTrailingEmptyRows } from './index';

function cellToString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/** Converts parsed JSON into a header row plus data rows. */
export function jsonToRows(parsed: unknown): string[][] {
  if (!Array.isArray(parsed)) {
    throw new FileParseError(
      'JSON imports must be an array of objects or an array of arrays.',
    );
  }
  if (parsed.length === 0) return [];

  if (Array.isArray(parsed[0])) {
    const rows = (parsed as unknown[][]).map((row) => row.map(cellToString));
    return squareOff(trimTrailingEmptyRows(rows));
  }

  // Union of keys across all objects, in first-seen order, so rows with extra
  // or missing keys still line up into one table.
  const headers: string[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    if (item === null || typeof item !== 'object') {
      throw new FileParseError('JSON imports must contain objects of the same shape.');
    }
    for (const key of Object.keys(item as Record<string, unknown>)) {
      if (!seen.has(key)) {
        seen.add(key);
        headers.push(key);
      }
    }
  }

  const rows = (parsed as Array<Record<string, unknown>>).map((item) =>
    headers.map((key) => cellToString(item[key])),
  );

  return squareOff(trimTrailingEmptyRows([headers, ...rows]));
}

export function parseJsonFile(text: string): string[][] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new FileParseError(
      `The file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return jsonToRows(parsed);
}
