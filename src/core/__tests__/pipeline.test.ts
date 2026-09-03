import { describe, expect, it, vi } from 'vitest';
import { normalizeField } from '../fieldTypes';
import { autoMatchColumns, buildSourceColumns, detectHeaderRow } from '../matching';
import { cellMessages, recordHasError } from '../model';
import { buildRecords, runPipeline } from '../pipeline';
import { buildResults, canSubmit } from '../results';
import { validateRecords } from '../validators';
import type { Field } from '../../types';

const FIELDS: Field[] = [
  { label: 'First Name', key: 'firstName' },
  { label: 'Last Name', key: 'lastName' },
  { label: 'Email', key: 'email', type: 'email', validators: [{ validate: 'required' }] },
];

function normalize(fields: Field[]) {
  return fields.map((f) => normalizeField(f));
}

function makeRecords(fields: Field[], rows: string[][], headers: string[]) {
  const normalized = normalize(fields);
  const columnToField = new Map<number, string>();
  headers.forEach((header, index) => {
    const match = normalized.find((f) => f.key === header);
    if (match) columnToField.set(index, match.key);
  });
  return { normalized, records: buildRecords(rows, { columnToField, fields: normalized }) };
}

describe('detectHeaderRow', () => {
  it('finds the header beneath preamble rows', () => {
    const rows = [
      ['Quarterly export', '', ''],
      ['', '', ''],
      ['Name', 'Email', 'Age'],
      ['Ada', 'ada@example.com', '36'],
      ['Alan', 'alan@example.com', '41'],
    ];
    expect(detectHeaderRow(rows)).toBe(2);
  });

  it('picks the first row for an ordinary file', () => {
    const rows = [
      ['Name', 'Email'],
      ['Ada', 'ada@example.com'],
    ];
    expect(detectHeaderRow(rows)).toBe(0);
  });
});

describe('autoMatchColumns', () => {
  const fields = normalize([
    { label: 'First Name', key: 'firstName', alternateMatches: ['fname', 'given name'] },
    { label: 'Last Name', key: 'lastName' },
    { label: 'Email Address', key: 'email' },
  ]);

  function columns(headers: string[]) {
    return buildSourceColumns(headers, []);
  }

  it('matches exact labels, keys and alternates', () => {
    const mappings = autoMatchColumns(columns(['First Name', 'lastName', 'given name']), fields);
    expect(mappings.map((m) => m.fieldKey)).toEqual(['firstName', 'lastName', null]);
  });

  it('matches case- and separator-insensitively', () => {
    const mappings = autoMatchColumns(columns(['first_name', 'LAST NAME']), fields);
    expect(mappings.map((m) => m.fieldKey)).toEqual(['firstName', 'lastName']);
  });

  it('fuzzy-matches near misses', () => {
    const mappings = autoMatchColumns(columns(['Email Adress']), fields);
    expect(mappings[0]?.fieldKey).toBe('email');
  });

  it('gives a field to its strongest column, not the first one seen', () => {
    // "Name" is a mediocre match for First Name; the exact match must win it.
    const mappings = autoMatchColumns(columns(['Name', 'First Name']), fields);
    expect(mappings[1]?.fieldKey).toBe('firstName');
    expect(mappings[0]?.fieldKey).not.toBe('firstName');
  });

  it('never assigns one field to two columns unless manyToOne', () => {
    const mappings = autoMatchColumns(columns(['Email Address', 'Email Address']), fields);
    expect(mappings.filter((m) => m.fieldKey === 'email')).toHaveLength(1);
  });

  it('allows several columns into a manyToOne field', () => {
    const manyFields = normalize([{ label: 'Tag', key: 'tag', manyToOne: true }]);
    const mappings = autoMatchColumns(columns(['Tag', 'Tag']), manyFields);
    expect(mappings.filter((m) => m.fieldKey === 'tag')).toHaveLength(2);
  });

  it('makes no fuzzy matches when fuzzyMatchHeaders is off', () => {
    const mappings = autoMatchColumns(columns(['Email Adress']), fields, {
      fuzzyMatchHeaders: false,
    });
    expect(mappings[0]?.fieldKey).toBeNull();
  });
});

describe('validators', () => {
  function validate(fields: Field[], rows: string[][], headers: string[]) {
    const { normalized, records } = makeRecords(fields, rows, headers);
    validateRecords(records, normalized);
    return records;
  }

  it('flags empty required cells', () => {
    const records = validate(FIELDS, [['Ada', 'Lovelace', '']], ['firstName', 'lastName', 'email']);
    expect(cellMessages(records[0]!.cells.email!)[0]?.message).toMatch(/required/);
  });

  it('flags duplicates for unique', () => {
    const fields: Field[] = [{ label: 'Email', key: 'email', validators: [{ validate: 'unique' }] }];
    const records = validate(fields, [['a@x.com'], ['a@x.com'], ['b@x.com']], ['email']);
    expect(recordHasError(records[0]!)).toBe(true);
    expect(recordHasError(records[1]!)).toBe(true);
    expect(recordHasError(records[2]!)).toBe(false);
  });

  it('ignores case for unique_case_insensitive', () => {
    const fields: Field[] = [
      { label: 'Code', key: 'code', validators: [{ validate: 'unique_case_insensitive' }] },
    ];
    const records = validate(fields, [['abc'], ['ABC']], ['code']);
    expect(recordHasError(records[0]!)).toBe(true);
  });

  it('treats unique_with as a composite key', () => {
    const fields: Field[] = [
      { label: 'First', key: 'first', validators: [{ validate: 'unique_with', uniqueKey: 'name' }] },
      { label: 'Last', key: 'last', validators: [{ validate: 'unique_with', uniqueKey: 'name' }] },
    ];
    const records = validate(
      fields,
      [
        ['Ada', 'Lovelace'],
        ['Ada', 'Byron'],
        ['Ada', 'Lovelace'],
      ],
      ['first', 'last'],
    );
    expect(recordHasError(records[0]!)).toBe(true);
    expect(recordHasError(records[1]!)).toBe(false);
    expect(recordHasError(records[2]!)).toBe(true);
  });

  it('applies regex_match and regex_exclude', () => {
    const fields: Field[] = [
      { label: 'Code', key: 'code', validators: [{ validate: 'regex_match', regex: '^[A-Z]{3}$' }] },
      { label: 'Note', key: 'note', validators: [{ validate: 'regex_exclude', regex: 'secret' }] },
    ];
    const records = validate(fields, [['ABC', 'fine'], ['abc', 'secret stuff']], ['code', 'note']);
    expect(recordHasError(records[0]!)).toBe(false);
    expect(recordHasError(records[1]!)).toBe(true);
  });

  it('honours regexOptions.ignoreCase', () => {
    const fields: Field[] = [
      {
        label: 'Code',
        key: 'code',
        validators: [
          { validate: 'regex_match', regex: '^[a-z]+$', regexOptions: { ignoreCase: true } },
        ],
      },
    ];
    expect(recordHasError(validate(fields, [['ABC']], ['code'])[0]!)).toBe(false);
  });

  it('requires conditionally with require_with', () => {
    const fields: Field[] = [
      { label: 'Company', key: 'company' },
      { label: 'Tax ID', key: 'taxId', validators: [{ validate: 'require_with', fields: ['company'] }] },
    ];
    const records = validate(fields, [['Acme', ''], ['', '']], ['company', 'taxId']);
    expect(recordHasError(records[0]!)).toBe(true);
    expect(recordHasError(records[1]!)).toBe(false);
  });

  it('requires conditionally on values with require_with_values', () => {
    const fields: Field[] = [
      { label: 'Type', key: 'type' },
      {
        label: 'Detail',
        key: 'detail',
        validators: [{ validate: 'require_with_values', fieldValues: { type: 'other' } }],
      },
    ];
    const records = validate(fields, [['other', ''], ['standard', '']], ['type', 'detail']);
    expect(recordHasError(records[0]!)).toBe(true);
    expect(recordHasError(records[1]!)).toBe(false);
  });

  it('checks length bounds', () => {
    const fields: Field[] = [
      { label: 'Code', key: 'code', validators: [{ validate: 'length', min: 2, max: 4 }] },
    ];
    const records = validate(fields, [['a'], ['abc'], ['abcde']], ['code']);
    expect(records.map((r) => recordHasError(r))).toEqual([true, false, true]);
  });

  it('uses a custom errorMessage and level', () => {
    const fields: Field[] = [
      { label: 'Name', key: 'name' },
      {
        label: 'Email',
        key: 'email',
        validators: [{ validate: 'required', errorMessage: 'We need this', level: 'warning' }],
      },
    ];
    const records = validate(fields, [['Ada', '']], ['name', 'email']);
    const message = cellMessages(records[0]!.cells.email!)[0];
    expect(message?.message).toBe('We need this');
    expect(message?.level).toBe('warning');
    // A warning must not block submission.
    expect(recordHasError(records[0]!)).toBe(false);
  });

  it('leaves entirely blank rows unvalidated', () => {
    // A fresh manual-entry grid must not open covered in required-field errors.
    const records = validate(FIELDS, [['', '', '']], ['firstName', 'lastName', 'email']);

    expect(cellMessages(records[0]!.cells.email!)).toEqual([]);
    expect(recordHasError(records[0]!)).toBe(false);
  });

  it('still flags a partially filled row', () => {
    const records = validate(FIELDS, [['Ada', '', '']], ['firstName', 'lastName', 'email']);

    expect(recordHasError(records[0]!)).toBe(true);
  });

  it('does not let blank rows collide under unique', () => {
    const fields: Field[] = [
      { label: 'Email', key: 'email', validators: [{ validate: 'unique' }] },
    ];
    const records = validate(fields, [[''], ['']], ['email']);

    expect(records.every((record) => !recordHasError(record))).toBe(true);
  });
});

describe('runPipeline', () => {
  it('runs column, row and bulk hooks then validates the result', async () => {
    const order: string[] = [];
    const { normalized, records } = makeRecords(
      FIELDS,
      [['ada', 'lovelace', 'ADA@EXAMPLE.COM']],
      ['firstName', 'lastName', 'email'],
    );

    await runPipeline(
      records,
      normalized,
      {
        columnHooks: [
          {
            fieldKey: 'firstName',
            callback: (values) => {
              order.push('column');
              return values.map((v) => ({ ...v, value: v.value.toUpperCase() }));
            },
          },
        ],
        rowHooks: [
          (record) => {
            order.push('row');
            record.row.lastName!.value = 'Lovelace';
            return record;
          },
        ],
        bulkRowHooks: [
          (rows) => {
            order.push('bulk');
            return rows;
          },
        ],
      },
      { mode: 'init' },
    );

    expect(order).toEqual(['column', 'row', 'bulk']);
    expect(records[0]?.cells.firstName?.value).toBe('ADA');
    expect(records[0]?.cells.lastName?.value).toBe('Lovelace');
    // The email type coerced the value on the way in.
    expect(records[0]?.cells.email?.value).toBe('ada@example.com');
  });

  it('re-coerces values a hook writes', async () => {
    const fields: Field[] = [{ label: 'Joined', key: 'joined', type: 'date' }];
    const { normalized, records } = makeRecords(fields, [['']], ['joined']);

    await runPipeline(
      records,
      normalized,
      { rowHooks: [(record) => { record.row.joined!.value = 'Jan 5, 2024'; return record; }] },
      { mode: 'init' },
    );

    expect(records[0]?.cells.joined?.output).toBe('2024-01-05');
  });

  it('shows hooks the coerced value as resultValue', async () => {
    const fields: Field[] = [{ label: 'Joined', key: 'joined', type: 'date' }];
    const { normalized, records } = makeRecords(fields, [['Jan 5, 2024']], ['joined']);
    const seen: unknown[] = [];

    await runPipeline(
      records,
      normalized,
      {
        rowHooks: [
          (record) => {
            seen.push(record.row.joined!.resultValue);
            return record;
          },
        ],
      },
      { mode: 'init' },
    );

    expect(seen).toEqual(['2024-01-05']);
  });

  it('does not pin a cell when a hook echoes the resultValue it was given', async () => {
    const fields: Field[] = [{ label: 'Joined', key: 'joined', type: 'date' }];
    const { normalized, records } = makeRecords(fields, [['Jan 5, 2024']], ['joined']);

    // The hook rewrites the value without touching resultValue, exactly as a
    // record it merely read and handed back would.
    await runPipeline(
      records,
      normalized,
      { rowHooks: [(record) => { record.row.joined!.value = 'Mar 4, 2025'; return record; }] },
      { mode: 'init' },
    );

    expect(records[0]?.cells.joined?.resultValue).toBeUndefined();
    expect(buildResults(records, {
      fields: normalized,
      mappings: [],
      rawHeaders: [],
      filename: null,
      invalidDataBehavior: 'INCLUDE_INVALID_ROWS',
    }).data[0]?.joined).toBe('2025-03-04');
  });

  it('still lets a hook override the result value', async () => {
    const fields: Field[] = [{ label: 'Joined', key: 'joined', type: 'date' }];
    const { normalized, records } = makeRecords(fields, [['Jan 5, 2024']], ['joined']);

    await runPipeline(
      records,
      normalized,
      { rowHooks: [(record) => { record.row.joined!.resultValue = 1704412800000; return record; }] },
      { mode: 'init' },
    );

    expect(records[0]?.cells.joined?.value).toBe('2024-01-05');
    expect(records[0]?.cells.joined?.resultValue).toBe(1704412800000);
  });

  it('keeps hook info messages through validation', async () => {
    const { normalized, records } = makeRecords(
      FIELDS,
      [['Ada', 'Lovelace', 'ada@example.com']],
      ['firstName', 'lastName', 'email'],
    );

    await runPipeline(
      records,
      normalized,
      {
        rowHooks: [
          (record) => {
            record.row.email!.info = [{ message: 'Checked against CRM', level: 'info' }];
            return record;
          },
        ],
      },
      { mode: 'init' },
    );

    expect(cellMessages(records[0]!.cells.email!)).toEqual([
      { message: 'Checked against CRM', level: 'info' },
    ]);
  });

  it('lets a hook block a row with an error message', async () => {
    const { normalized, records } = makeRecords(
      FIELDS,
      [['Ada', 'Lovelace', 'ada@example.com']],
      ['firstName', 'lastName', 'email'],
    );

    await runPipeline(
      records,
      normalized,
      {
        rowHooks: [
          (record) => {
            record.row.email!.info = [{ message: 'Already registered', level: 'error' }];
            return record;
          },
        ],
      },
      { mode: 'init' },
    );

    expect(recordHasError(records[0]!)).toBe(true);
  });

  it('awaits async hooks', async () => {
    const { normalized, records } = makeRecords(FIELDS, [['a', 'b', 'c@d.com']], ['firstName', 'lastName', 'email']);

    await runPipeline(
      records,
      normalized,
      {
        rowHooks: [
          async (record) => {
            await Promise.resolve();
            record.row.firstName!.value = 'async';
            return record;
          },
        ],
      },
      { mode: 'init' },
    );

    expect(records[0]?.cells.firstName?.value).toBe('async');
  });

  it('passes the mode through to hooks', async () => {
    const hook = vi.fn();
    const { normalized, records } = makeRecords(FIELDS, [['a', 'b', 'c@d.com']], ['firstName', 'lastName', 'email']);

    await runPipeline(records, normalized, { rowHooks: [hook] }, { mode: 'update' });

    expect(hook).toHaveBeenCalledWith(expect.anything(), 'update');
  });
});

describe('buildRecords', () => {
  it('joins several columns into a manyToOne field', () => {
    const fields = normalize([{ label: 'Tag', key: 'tag', manyToOne: true }]);
    const records = buildRecords(
      [['red', 'blue']],
      { columnToField: new Map([[0, 'tag'], [1, 'tag']]), fields },
    );

    expect(records[0]?.cells.tag?.value).toBe('red, blue');
    expect(records[0]?.cells.tag?.output).toEqual(['red', 'blue']);
  });

  it('collects unmapped columns when asked', () => {
    const fields = normalize([{ label: 'Name', key: 'name' }]);
    const records = buildRecords([['Ada', '555-1234']], {
      columnToField: new Map([[0, 'name']]),
      fields,
      passThroughUnmappedColumns: true,
    });

    expect(records[0]?.unmapped).toEqual({ '1': '555-1234' });
  });
});

describe('buildResults', () => {
  const options = {
    mappings: [],
    rawHeaders: ['First Name', 'Last Name', 'Email'],
    filename: 'contacts.csv',
    invalidDataBehavior: 'INCLUDE_INVALID_ROWS' as const,
  };

  it('emits one object per row keyed by field key', () => {
    const { normalized, records } = makeRecords(
      FIELDS,
      [['Ada', 'Lovelace', 'ada@example.com']],
      ['firstName', 'lastName', 'email'],
    );
    validateRecords(records, normalized);

    const { data } = buildResults(records, { ...options, fields: normalized });

    expect(data).toEqual([
      { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
    ]);
  });

  it('drops erroring rows under REMOVE_INVALID_ROWS', () => {
    const { normalized, records } = makeRecords(
      FIELDS,
      [
        ['Ada', 'Lovelace', 'ada@example.com'],
        ['Alan', 'Turing', ''],
      ],
      ['firstName', 'lastName', 'email'],
    );
    validateRecords(records, normalized);

    const { data, metadata } = buildResults(records, {
      ...options,
      fields: normalized,
      invalidDataBehavior: 'REMOVE_INVALID_ROWS',
    });

    expect(data).toHaveLength(1);
    expect(metadata.totalRows).toBe(2);
    expect(metadata.validRows).toBe(1);
    expect(metadata.invalidRows).toBe(1);
  });

  it('reports remaining errors under INCLUDE_INVALID_ROWS', () => {
    const { normalized, records } = makeRecords(
      FIELDS,
      [['Alan', 'Turing', '']],
      ['firstName', 'lastName', 'email'],
    );
    validateRecords(records, normalized);

    const { metadata } = buildResults(records, { ...options, fields: normalized });

    expect(metadata.rowsWithError).toEqual([0]);
    expect(metadata.errors[0]).toMatchObject({ rowIndex: 0, fieldKey: 'email', level: 'error' });
  });

  it('drops entirely blank rows from the results', () => {
    const { normalized, records } = makeRecords(
      FIELDS,
      [
        ['Ada', 'Lovelace', 'ada@example.com'],
        ['', '', ''],
      ],
      ['firstName', 'lastName', 'email'],
    );
    validateRecords(records, normalized);

    const { data, metadata } = buildResults(records, { ...options, fields: normalized });

    expect(data).toHaveLength(1);
    expect(metadata.totalRows).toBe(1);
  });

  it('includes $unmapped when passthrough is on', () => {
    const fields = normalize([{ label: 'Name', key: 'name' }]);
    const records = buildRecords([['Ada', 'extra']], {
      columnToField: new Map([[0, 'name']]),
      fields,
      passThroughUnmappedColumns: true,
    });

    const { data } = buildResults(records, {
      ...options,
      fields,
      passThroughUnmappedColumns: true,
    });

    expect(data[0]?.$unmapped).toEqual({ '1': 'extra' });
  });
});

describe('canSubmit', () => {
  const { normalized, records } = makeRecords(FIELDS, [['Alan', 'Turing', '']], ['firstName', 'lastName', 'email']);
  validateRecords(records, normalized);

  it('blocks on errors under BLOCK_SUBMIT', () => {
    expect(canSubmit(records, normalized, 'BLOCK_SUBMIT', true).allowed).toBe(false);
  });

  it('allows submission under INCLUDE_INVALID_ROWS', () => {
    expect(canSubmit(records, normalized, 'INCLUDE_INVALID_ROWS', true).allowed).toBe(true);
  });

  it('blocks an empty submit when allowEmptySubmit is false', () => {
    expect(canSubmit(records, normalized, 'REMOVE_INVALID_ROWS', false).allowed).toBe(false);
  });
});
