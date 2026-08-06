/**
 * CSV / TSV / delimited text parsing, via Papa Parse.
 *
 * Parsed with `header: false` so the header row stays addressable as data —
 * the header step lets the user pick which row it actually is, which is not
 * always the first.
 */

import Papa from 'papaparse';
import { FileParseError, squareOff, trimTrailingEmptyRows } from './index';

export interface DelimitedOptions {
  /** Explicit delimiter; auto-detected when omitted. */
  delimiter?: string;
  /** Used to pick a sensible default delimiter for known extensions. */
  extension?: string;
}

function defaultDelimiter(extension: string | undefined): string | undefined {
  if (extension === 'tsv') return '\t';
  if (extension === 'psv') return '|';
  return undefined;
}

export function parseDelimited(text: string, options: DelimitedOptions = {}): string[][] {
  const delimiter = options.delimiter ?? defaultDelimiter(options.extension);

  const result = Papa.parse<string[]>(text, {
    header: false,
    // Values are coerced by the field types later; keeping them as strings here
    // preserves things Papa would otherwise mangle, like leading-zero ZIP codes.
    dynamicTyping: false,
    skipEmptyLines: 'greedy',
    delimiter: delimiter ?? '',
    newline: undefined,
  });

  // Papa reports per-row errors (ragged rows, unclosed quotes) but still
  // returns the data, so only a total failure should stop the import.
  if (result.data.length === 0) {
    const first = result.errors[0];
    throw new FileParseError(
      first ? `Could not parse the file: ${first.message}` : 'The file appears to be empty.',
    );
  }

  const rows = result.data.map((row) =>
    (Array.isArray(row) ? row : [row]).map((cell) => (cell == null ? '' : String(cell))),
  );

  return squareOff(trimTrailingEmptyRows(rows));
}
