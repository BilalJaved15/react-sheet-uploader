/**
 * XLSX parsing.
 *
 * Loaded on demand from `parsers/index.ts` so that consumers who only ever
 * import CSV never pay for the spreadsheet reader.
 *
 * Legacy `.xls` (OLE2) is not an XML format and is not handled here; the caller
 * detects it by signature and reports it before reaching this module.
 */

import readXlsxFile from 'read-excel-file/browser';
import type { ParsedSheet } from './index';
import { FileParseError, squareOff, trimTrailingEmptyRows } from './index';

/**
 * Renders a parsed cell as the text a user would have seen in Excel.
 *
 * Dates are emitted as ISO using UTC accessors: the reader builds them at UTC
 * midnight, so local accessors would shift the calendar day backwards for
 * anyone west of Greenwich.
 */
function cellToString(value: unknown): string {
  if (value == null) return '';

  if (value instanceof Date) {
    const iso = value.toISOString();
    const hasTime = value.getUTCHours() || value.getUTCMinutes() || value.getUTCSeconds();
    return hasTime ? iso.slice(0, 19).replace('T', ' ') : iso.slice(0, 10);
  }

  if (typeof value === 'number') {
    // Avoid exponential notation for large ids, and float noise for decimals.
    return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(15)));
  }

  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'string') return value;

  return String(value);
}

export async function parseWorkbook(buffer: ArrayBuffer): Promise<ParsedSheet[]> {
  let sheets: Array<{ sheet: string; data: unknown[][] }>;

  try {
    // `trim: false` keeps padding that may be meaningful; trimming is the
    // string field type's decision, not the reader's.
    sheets = (await readXlsxFile(buffer, { trim: false })) as unknown as Array<{
      sheet: string;
      data: unknown[][];
    }>;
  } catch (error) {
    throw new FileParseError(
      `Could not read the spreadsheet: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!Array.isArray(sheets) || sheets.length === 0) {
    throw new FileParseError('The workbook contains no sheets.');
  }

  const parsed = sheets.map((sheet, index) => ({
    name: sheet.sheet || `Sheet${index + 1}`,
    rows: squareOff(trimTrailingEmptyRows((sheet.data ?? []).map((row) => row.map(cellToString)))),
  }));

  // Blank sheets are common padding in exported workbooks; hide them from the
  // sheet picker unless that would leave the user with nothing to choose.
  const nonEmpty = parsed.filter((sheet) => sheet.rows.length > 0);
  return nonEmpty.length > 0 ? nonEmpty : parsed.slice(0, 1);
}
