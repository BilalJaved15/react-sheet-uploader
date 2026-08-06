import { describe, expect, it } from 'vitest';
import { parseWorkbook } from '../excel';
import { parseDelimited } from '../delimited';
import { jsonToRows } from '../json';
import { parseFile } from '../index';
import { buildXlsx, buildXlsxFile } from './xlsx-fixture';

describe('parseWorkbook', () => {
  it('reads strings, numbers, booleans and dates from every sheet', async () => {
    const buffer = buildXlsx([
      {
        name: 'People',
        rows: [
          ['Name', 'Age', 'Active', 'Joined'],
          ['Ada Lovelace', 36, true, new Date(Date.UTC(1852, 10, 27))],
        ],
      },
      { name: 'Notes', rows: [['Heading'], ['Body']] },
    ]);

    const sheets = await parseWorkbook(buffer);

    expect(sheets.map((s) => s.name)).toEqual(['People', 'Notes']);
    expect(sheets[0]?.rows[0]).toEqual(['Name', 'Age', 'Active', 'Joined']);
    expect(sheets[0]?.rows[1]).toEqual(['Ada Lovelace', '36', 'TRUE', '1852-11-27']);
  });

  it('keeps leading zeros and long ids intact', async () => {
    const buffer = buildXlsx([
      { name: 'Sheet1', rows: [['Zip', 'Id'], ['02134', 12345678901234]] },
    ]);

    const sheets = await parseWorkbook(buffer);

    expect(sheets[0]?.rows[1]).toEqual(['02134', '12345678901234']);
  });

  it('pads short rows so the grid is rectangular', async () => {
    const buffer = buildXlsx([
      { name: 'Sheet1', rows: [['A', 'B', 'C'], ['1'], ['1', '2']] },
    ]);

    const sheets = await parseWorkbook(buffer);

    expect(sheets[0]?.rows).toEqual([
      ['A', 'B', 'C'],
      ['1', '', ''],
      ['1', '2', ''],
    ]);
  });
});

describe('parseFile', () => {
  it('routes .xlsx files to the spreadsheet parser', async () => {
    const file = buildXlsxFile('contacts.xlsx', [
      { name: 'Sheet1', rows: [['Email'], ['ada@example.com']] },
    ]);

    const parsed = await parseFile(file);

    expect(parsed.filename).toBe('contacts.xlsx');
    expect(parsed.sheets[0]?.rows).toEqual([['Email'], ['ada@example.com']]);
  });

  it('rejects legacy .xls with an actionable message', async () => {
    // The OLE2 compound-document signature every .xls file starts with.
    const ole2 = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    const file = new File([ole2], 'legacy.xls');

    await expect(parseFile(file)).rejects.toThrow(/legacy Excel/i);
  });

  it('prefers a custom parser over the built-in handler', async () => {
    const file = new File(['ignored'], 'data.custom');

    const parsed = await parseFile(file, {
      fileParsers: [
        { extensions: ['custom'], parseFile: () => [['A'], ['1']] },
      ],
    });

    expect(parsed.sheets[0]?.rows).toEqual([['A'], ['1']]);
  });

  it('enforces maxFileSize', async () => {
    const file = new File(['x'.repeat(100)], 'big.csv');

    await expect(parseFile(file, { settings: { maxFileSize: 10 } })).rejects.toThrow(/exceeds/);
  });
});

describe('parseDelimited', () => {
  it('auto-detects the delimiter and keeps values as strings', () => {
    const rows = parseDelimited('a;b\n1;002');
    expect(rows).toEqual([
      ['a', 'b'],
      ['1', '002'],
    ]);
  });

  it('honours quoted fields containing the delimiter', () => {
    const rows = parseDelimited('name,note\n"Doe, Jane",hi');
    expect(rows[1]).toEqual(['Doe, Jane', 'hi']);
  });

  it('defaults to tab for .tsv', () => {
    const rows = parseDelimited('a\tb\n1\t2', { extension: 'tsv' });
    expect(rows[0]).toEqual(['a', 'b']);
  });
});

describe('jsonToRows', () => {
  it('unions keys across objects', () => {
    const rows = jsonToRows([
      { a: 1, b: 2 },
      { b: 3, c: 4 },
    ]);

    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', ''],
      ['', '3', '4'],
    ]);
  });

  it('passes arrays of arrays straight through', () => {
    expect(jsonToRows([['a'], ['1']])).toEqual([['a'], ['1']]);
  });
});
