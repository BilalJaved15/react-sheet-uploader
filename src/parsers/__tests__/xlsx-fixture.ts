/**
 * Builds minimal but valid .xlsx files in memory, so the spreadsheet parser can
 * be tested against real OOXML rather than a mock of it.
 *
 * Test-only: not reachable from the package entry point and never bundled.
 */

import { zipSync, strToU8 } from 'fflate';

export type FixtureCell = string | number | boolean | Date | null;

export interface FixtureSheet {
  name: string;
  rows: FixtureCell[][];
}

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL_PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
const NS_REL_DOC = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Converts a 0-based column index to a spreadsheet column name (0 -> A). */
function columnName(index: number): string {
  let name = '';
  let n = index;
  while (n >= 0) {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  }
  return name;
}

/** Days since the 1899-12-30 epoch Excel uses for date serials. */
function toExcelSerial(date: Date): number {
  const epoch = Date.UTC(1899, 11, 30);
  return (date.getTime() - epoch) / 86400000;
}

function renderCell(value: FixtureCell, reference: string): string {
  if (value === null || value === '') return '';

  if (value instanceof Date) {
    // Style index 1 carries a date number format, which is how a reader knows
    // the numeric serial is a date rather than a plain number.
    return `<c r="${reference}" s="1"><v>${toExcelSerial(value)}</v></c>`;
  }
  if (typeof value === 'number') {
    return `<c r="${reference}"><v>${value}</v></c>`;
  }
  if (typeof value === 'boolean') {
    return `<c r="${reference}" t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function renderSheet(rows: FixtureCell[][]): string {
  const body = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((cell, colIndex) => renderCell(cell, `${columnName(colIndex)}${rowIndex + 1}`))
        .join('');
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS_MAIN}"><sheetData>${body}</sheetData></worksheet>`;
}

export function buildXlsx(sheets: FixtureSheet[]): ArrayBuffer {
  const sheetEntries = sheets.map((sheet, i) => ({ ...sheet, id: i + 1 }));

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    sheetEntries
      .map(
        (s) =>
          `<Override PartName="/xl/worksheets/sheet${s.id}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join('') +
    `</Types>`;

  const rootRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS_REL_PKG}">` +
    `<Relationship Id="rId1" Type="${NS_REL_DOC}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  const workbook =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL_DOC}"><sheets>` +
    sheetEntries
      .map((s) => `<sheet name="${escapeXml(s.name)}" sheetId="${s.id}" r:id="rId${s.id}"/>`)
      .join('') +
    `</sheets></workbook>`;

  const workbookRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS_REL_PKG}">` +
    sheetEntries
      .map(
        (s) =>
          `<Relationship Id="rId${s.id}" Type="${NS_REL_DOC}/worksheet" Target="worksheets/sheet${s.id}.xml"/>`,
      )
      .join('') +
    `<Relationship Id="rIdStyles" Type="${NS_REL_DOC}/styles" Target="styles.xml"/></Relationships>`;

  // cellXfs index 0 is the default; index 1 applies built-in date format 14.
  const styles =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${NS_MAIN}">` +
    `<numFmts count="0"/>` +
    `<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="1"><fill><patternFill patternType="none"/></fill></fills>` +
    `<borders count="1"><border/></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>` +
    `</styleSheet>`;

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rootRels),
    'xl/workbook.xml': strToU8(workbook),
    'xl/_rels/workbook.xml.rels': strToU8(workbookRels),
    'xl/styles.xml': strToU8(styles),
  };

  for (const sheet of sheetEntries) {
    files[`xl/worksheets/sheet${sheet.id}.xml`] = strToU8(renderSheet(sheet.rows));
  }

  const zipped = zipSync(files);
  return zipped.buffer.slice(
    zipped.byteOffset,
    zipped.byteOffset + zipped.byteLength,
  ) as ArrayBuffer;
}

/** Wraps a fixture workbook in a `File`, as the uploader would receive it. */
export function buildXlsxFile(name: string, sheets: FixtureSheet[]): File {
  return new File([buildXlsx(sheets)], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
