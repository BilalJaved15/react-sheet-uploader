import { describe, expect, it } from 'vitest';
import { buildExport } from '../export';
import { normalizeField } from '../fieldTypes';
import { buildRecords } from '../pipeline';
import type { Field } from '../../types';

const FIELDS: Field[] = [
  { label: 'Name', key: 'name' },
  { label: 'Count', key: 'count', type: 'number' },
  { label: 'Internal', key: 'internal', hidden: true },
];

function records() {
  const fields = FIELDS.map((field) => normalizeField(field));
  const columnToField = new Map(fields.map((field, index) => [index, field.key]));

  return {
    fields,
    records: buildRecords(
      [
        ['Ada, Lovelace', '3', 'x'],
        ['Alan "Turing"', '7', 'y'],
      ],
      { columnToField, fields },
    ),
  };
}

describe('buildExport', () => {
  it('writes a CSV with a header row, quoting only what needs it', () => {
    const { fields, records: rows } = records();

    const csv = buildExport(rows, fields, 'csv');

    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.trimEnd().split('\r\n')).toEqual([
      '﻿Name,Count',
      '"Ada, Lovelace",3',
      '"Alan ""Turing""",7',
    ]);
  });

  it('writes TSV with the same rows', () => {
    const { fields, records: rows } = records();

    expect(buildExport(rows, fields, 'tsv').trimEnd().split('\r\n')).toEqual([
      '﻿Name\tCount',
      'Ada, Lovelace\t3',
      // A value holding a quote is quoted even without a tab in it, so that
      // pasting the file back into a spreadsheet reads it as one cell.
      '"Alan ""Turing"""\t7',
    ]);
  });

  it('writes JSON keyed by field key, with typed values', () => {
    const { fields, records: rows } = records();

    expect(JSON.parse(buildExport(rows, fields, 'json'))).toEqual([
      { name: 'Ada, Lovelace', count: 3 },
      { name: 'Alan "Turing"', count: 7 },
    ]);
  });

  it('leaves hidden fields out of every format', () => {
    const { fields, records: rows } = records();

    for (const format of ['csv', 'tsv', 'json'] as const) {
      expect(buildExport(rows, fields, format)).not.toContain('Internal');
      expect(buildExport(rows, fields, format)).not.toContain('internal');
    }
  });
});
