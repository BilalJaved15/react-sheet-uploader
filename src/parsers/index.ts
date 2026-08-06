/**
 * File parsing.
 *
 * Every format collapses to the same shape — a list of sheets, each a
 * rectangular grid of strings — so the rest of the pipeline never has to know
 * where the data came from. Header detection happens later, in the header step.
 */

import type { CustomFileParser, Settings } from '../types';
import { parseDelimited } from './delimited';
import { parseJsonFile } from './json';

export interface ParsedSheet {
  name: string;
  /** Rectangular: every row padded to the widest row. */
  rows: string[][];
}

export interface ParsedFile {
  filename: string;
  sheets: ParsedSheet[];
}

export class FileParseError extends Error {
  override name = 'FileParseError';
}

const DELIMITED_EXTENSIONS = new Set(['csv', 'tsv', 'txt', 'psv']);
const EXCEL_EXTENSIONS = new Set(['xlsx', 'xlsm', 'xltx', 'xltm']);
const LEGACY_EXCEL_EXTENSIONS = new Set(['xls', 'xlt']);

export const DEFAULT_ACCEPTED_EXTENSIONS = [
  'csv',
  'tsv',
  'txt',
  'xlsx',
  'xlsm',
  'json',
];

export function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase();
}

/** Pads every row to the width of the widest, so the grid is rectangular. */
export function squareOff(rows: string[][]): string[][] {
  let width = 0;
  for (const row of rows) width = Math.max(width, row.length);
  return rows.map((row) => {
    if (row.length === width) return row;
    const padded = row.slice();
    while (padded.length < width) padded.push('');
    return padded;
  });
}

/** Drops trailing rows that are entirely empty, which spreadsheets accumulate. */
export function trimTrailingEmptyRows(rows: string[][]): string[][] {
  let end = rows.length;
  while (end > 0) {
    const row = rows[end - 1];
    if (row && row.some((cell) => cell.trim() !== '')) break;
    end -= 1;
  }
  return end === rows.length ? rows : rows.slice(0, end);
}

/** The OLE2 compound-document signature that starts every legacy .xls file. */
function isLegacyExcel(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 8) return false;
  const bytes = new Uint8Array(buffer, 0, 8);
  const signature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  return signature.every((byte, i) => bytes[i] === byte);
}

async function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new FileParseError(`Could not read ${file.name}`));
    reader.readAsArrayBuffer(file);
  });
}

/** Decodes as UTF-8, falling back to latin1 for files with invalid sequences. */
export function decodeText(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

export interface ParseFileOptions {
  settings?: Pick<Settings, 'delimiter' | 'maxFileSize' | 'maxRecords'>;
  fileParsers?: CustomFileParser[];
}

export async function parseFile(file: File, options: ParseFileOptions = {}): Promise<ParsedFile> {
  const { settings = {}, fileParsers = [] } = options;
  const maxFileSize = settings.maxFileSize ?? 1024 * 1024 * 1024;

  if (file.size > maxFileSize) {
    throw new FileParseError(
      `${file.name} is ${formatBytes(file.size)}, which exceeds the ${formatBytes(maxFileSize)} limit.`,
    );
  }

  const extension = fileExtension(file.name);

  // Developer-supplied parsers win, so `.txt` can be reclaimed from the CSV path.
  const custom = fileParsers.find((parser) =>
    parser.extensions.some((ext) => ext.replace(/^\./, '').toLowerCase() === extension),
  );
  if (custom) {
    const buffer = await readAsArrayBuffer(file);
    const rows = await custom.parseFile(buffer, file.name);
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new FileParseError(`The custom parser for .${extension} returned no rows.`);
    }
    return {
      filename: file.name,
      sheets: [{ name: file.name, rows: squareOff(trimTrailingEmptyRows(rows.map(toStringRow))) }],
    };
  }

  if (extension === 'json') {
    const text = decodeText(await readAsArrayBuffer(file));
    return { filename: file.name, sheets: [{ name: file.name, rows: parseJsonFile(text) }] };
  }

  if (EXCEL_EXTENSIONS.has(extension) || LEGACY_EXCEL_EXTENSIONS.has(extension)) {
    const buffer = await readAsArrayBuffer(file);
    if (isLegacyExcel(buffer)) {
      throw new FileParseError(
        `${file.name} is in the legacy Excel (.xls) format, which this uploader cannot read. ` +
          'Re-save it as .xlsx or .csv, or supply a custom parser via the `fileParsers` prop.',
      );
    }
    const { parseWorkbook } = await import('./excel');
    return { filename: file.name, sheets: await parseWorkbook(buffer) };
  }

  if (DELIMITED_EXTENSIONS.has(extension) || extension === '') {
    const text = decodeText(await readAsArrayBuffer(file));
    const rows = parseDelimited(text, { delimiter: settings.delimiter, extension });
    return { filename: file.name, sheets: [{ name: file.name, rows }] };
  }

  throw new FileParseError(
    `.${extension} files are not supported. Upload a CSV, TSV, XLSX or JSON file instead.`,
  );
}

function toStringRow(row: unknown): string[] {
  if (!Array.isArray(row)) return [String(row ?? '')];
  return row.map((cell) => (cell == null ? '' : String(cell)));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}
