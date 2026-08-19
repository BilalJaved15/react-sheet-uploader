import { describe, expect, it } from 'vitest';
import { applyAiSuggestions, buildMatchInput, buildMatchPrompt, parseMatchResponse } from '../aiMatch';
import { normalizeField } from '../fieldTypes';
import { autoMatchColumns, buildSourceColumns, type ColumnMapping } from '../matching';
import { similarity } from '../similarity';
import { valueTypeScore } from '../valueSignals';
import type { Field } from '../../types';

const FIELDS: Field[] = [
  { label: 'First Name', key: 'firstName' },
  { label: 'Last Name', key: 'lastName' },
  { label: 'Email Address', key: 'email', type: 'email' },
  { label: 'Date of Birth', key: 'dateOfBirth', type: 'date' },
  { label: 'Phone Number', key: 'phone', type: 'phone-number' },
];

const fields = FIELDS.map((f) => normalizeField(f));

describe('similarity: spreadsheet shorthand', () => {
  const matches: Array<[string, string]> = [
    ['DOB', 'Date of Birth'],
    ['Qty', 'Quantity'],
    ['Zip', 'Postal Code'],
    ['fname', 'First Name'],
    ['Amt', 'Amount'],
    ['Cust Ref', 'customerReference'],
    ['E-Mail', 'Email Address'],
    ['Mobile', 'Phone Number'],
    ['Address Email', 'Email Address'],
    ['Customer Email Address', 'Email'],
    ['Email Adress', 'Email Address'],
  ];

  it.each(matches)('scores %s against %s above the match threshold', (a, b) => {
    expect(similarity(a, b)).toBeGreaterThanOrEqual(0.7);
  });

  const nonMatches: Array<[string, string]> = [
    ['Country', 'Company'],
    ['Total', 'Tel'],
    ['Status', 'State'],
    ['Notes', 'Nationality'],
  ];

  it.each(nonMatches)('keeps %s and %s below the threshold', (a, b) => {
    expect(similarity(a, b)).toBeLessThan(0.7);
  });

  it('does not match a substring across a word boundary', () => {
    // "state" is a suffix of "estate"; containment must not fire on it.
    expect(similarity('Real Estate', 'State')).toBeLessThan(0.7);
  });

  it('still confuses a one-syllable prefix, which is what aiMatch is for', () => {
    // Documents a known limit rather than asserting it away. "Estate"/"State"
    // is indistinguishable from a typo to any character-level metric, and the
    // metric has to score typos highly to catch "Adress"/"Address". Telling the
    // two apart needs word knowledge — the job of the optional AI matcher.
    expect(similarity('Estate', 'State')).toBeGreaterThan(0.7);
  });
});

describe('valueTypeScore', () => {
  it('recognises a column of emails', () => {
    expect(valueTypeScore(['a@b.com', 'c@d.org'], 'email')).toBe(1);
  });

  it('rejects non-emails for an email field', () => {
    expect(valueTypeScore(['Ada', 'Alan'], 'email')).toBe(0);
  });

  it('recognises ISO and slash-separated dates', () => {
    expect(valueTypeScore(['2024-01-05', '05/11/2023'], 'date')).toBe(1);
  });

  it('recognises phone numbers but not short digit strings', () => {
    expect(valueTypeScore(['+44 7700 900123', '(555) 010-9999'], 'phone-number')).toBe(1);
    expect(valueTypeScore(['12', '7'], 'phone-number')).toBe(0);
  });

  it('scores select columns against their options', () => {
    const options = [
      { label: 'Active', value: 'active' },
      { label: 'Churned', value: 'churned' },
    ];
    expect(valueTypeScore(['Active', 'churned'], 'select', options)).toBe(1);
    expect(valueTypeScore(['Banana'], 'select', options)).toBe(0);
  });

  it('gives plain strings no signal either way', () => {
    expect(valueTypeScore(['anything'], 'string')).toBe(0);
  });
});

describe('autoMatchColumns with value signals', () => {
  it('rejects a plausible header whose values contradict the field type', () => {
    // "E-Mail Sent" is close to "Email Address", but the column holds dates.
    const columns = buildSourceColumns(
      ['E-Mail Sent'],
      [['2024-01-05'], ['2024-02-11'], ['2024-03-02']],
    );
    const mappings = autoMatchColumns(columns, fields);
    expect(mappings[0]?.fieldKey).not.toBe('email');
  });

  it('keeps a matching header when the values agree', () => {
    const columns = buildSourceColumns(
      ['E-Mail'],
      [['ada@example.com'], ['alan@example.com']],
    );
    const mappings = autoMatchColumns(columns, fields);
    expect(mappings[0]?.fieldKey).toBe('email');
  });

  it('matches abbreviated headers the old bigram score missed', () => {
    const columns = buildSourceColumns(['DOB'], [['1815-12-10']]);
    const mappings = autoMatchColumns(columns, fields);
    expect(mappings[0]?.fieldKey).toBe('dateOfBirth');
  });
});

describe('parseMatchResponse', () => {
  it('parses the documented shape', () => {
    const parsed = parseMatchResponse(
      '{"mappings":[{"columnIndex":0,"fieldKey":"firstName","confidence":0.9,"reason":"Given names"}]}',
    );
    expect(parsed).toEqual([
      { columnIndex: 0, fieldKey: 'firstName', confidence: 0.9, reason: 'Given names' },
    ]);
  });

  it('parses a bare array', () => {
    const parsed = parseMatchResponse('[{"columnIndex":1,"fieldKey":"email"}]');
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.fieldKey).toBe('email');
  });

  it('unwraps a code fence', () => {
    const parsed = parseMatchResponse(
      '```json\n{"mappings":[{"columnIndex":2,"fieldKey":"lastName"}]}\n```',
    );
    expect(parsed[0]?.columnIndex).toBe(2);
  });

  it('ignores prose around the JSON', () => {
    const parsed = parseMatchResponse(
      'Here are the mappings:\n{"mappings":[{"columnIndex":0,"fieldKey":"email"}]}\nHope that helps!',
    );
    expect(parsed[0]?.fieldKey).toBe('email');
  });

  it('returns nothing for unparseable output', () => {
    expect(parseMatchResponse('I could not determine the mappings.')).toEqual([]);
    expect(parseMatchResponse('')).toEqual([]);
    expect(parseMatchResponse('{ broken json')).toEqual([]);
  });

  it('drops malformed entries but keeps good ones', () => {
    const parsed = parseMatchResponse(
      '{"mappings":[{"fieldKey":"email"},{"columnIndex":1,"fieldKey":"lastName"},{"columnIndex":-3,"fieldKey":"x"}]}',
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.columnIndex).toBe(1);
  });

  it('clamps confidence into range and treats an empty key as null', () => {
    const parsed = parseMatchResponse(
      '{"mappings":[{"columnIndex":0,"fieldKey":"","confidence":5}]}',
    );
    expect(parsed[0]?.fieldKey).toBeNull();
    expect(parsed[0]?.confidence).toBe(1);
  });
});

describe('applyAiSuggestions', () => {
  const columns = buildSourceColumns(
    ['A', 'B', 'C'],
    [['Ada', 'Lovelace', 'ada@example.com']],
  );

  const base: ColumnMapping[] = [
    { columnIndex: 0, fieldKey: null, confirmed: false },
    { columnIndex: 1, fieldKey: null, confirmed: false },
    { columnIndex: 2, fieldKey: null, confirmed: false },
  ];

  it('applies suggestions and reports what changed', () => {
    const result = applyAiSuggestions(
      base,
      [
        { columnIndex: 0, fieldKey: 'firstName', confidence: 0.95, reason: 'Given names' },
        { columnIndex: 2, fieldKey: 'email', confidence: 0.99 },
      ],
      fields,
      columns,
    );

    expect(result.mappings[0]?.fieldKey).toBe('firstName');
    expect(result.mappings[2]?.fieldKey).toBe('email');
    expect(result.changedColumns).toEqual([2, 0]);
    expect(result.reasons.get(0)).toBe('Given names');
  });

  it('leaves every applied mapping unconfirmed for the user to review', () => {
    const result = applyAiSuggestions(
      base,
      [{ columnIndex: 0, fieldKey: 'firstName', confidence: 1 }],
      fields,
      columns,
    );
    expect(result.mappings[0]?.confirmed).toBe(false);
    expect(result.mappings[0]?.source).toBe('ai');
  });

  it('drops suggestions naming a field that does not exist', () => {
    const result = applyAiSuggestions(
      base,
      [{ columnIndex: 0, fieldKey: 'notARealField', confidence: 1 }],
      fields,
      columns,
    );
    expect(result.mappings[0]?.fieldKey).toBeNull();
  });

  it('drops suggestions for a column that does not exist', () => {
    const result = applyAiSuggestions(
      base,
      [{ columnIndex: 99, fieldKey: 'email', confidence: 1 }],
      fields,
      columns,
    );
    expect(result.mappings.every((m) => m.fieldKey === null)).toBe(true);
  });

  it('drops low-confidence suggestions rather than guessing', () => {
    const result = applyAiSuggestions(
      base,
      [{ columnIndex: 0, fieldKey: 'firstName', confidence: 0.2 }],
      fields,
      columns,
    );
    expect(result.mappings[0]?.fieldKey).toBeNull();
  });

  it('gives a double-claimed field to the more confident suggestion', () => {
    const result = applyAiSuggestions(
      base,
      [
        { columnIndex: 0, fieldKey: 'email', confidence: 0.6 },
        { columnIndex: 2, fieldKey: 'email', confidence: 0.99 },
      ],
      fields,
      columns,
    );
    expect(result.mappings[2]?.fieldKey).toBe('email');
    expect(result.mappings[0]?.fieldKey).toBeNull();
  });

  it('never overrides a mapping the user already confirmed', () => {
    const confirmed: ColumnMapping[] = [
      { columnIndex: 0, fieldKey: 'lastName', confirmed: true },
      { columnIndex: 1, fieldKey: null, confirmed: false },
      { columnIndex: 2, fieldKey: null, confirmed: false },
    ];
    const result = applyAiSuggestions(
      confirmed,
      [
        { columnIndex: 0, fieldKey: 'firstName', confidence: 1 },
        { columnIndex: 1, fieldKey: 'lastName', confidence: 1 },
      ],
      fields,
      columns,
    );
    expect(result.mappings[0]?.fieldKey).toBe('lastName');
    expect(result.mappings[0]?.confirmed).toBe(true);
    // The confirmed column keeps lastName, so the suggestion for it is refused.
    expect(result.mappings[1]?.fieldKey).toBeNull();
  });

  it('clears a heuristic mapping whose field the AI moved elsewhere', () => {
    const heuristic: ColumnMapping[] = [
      { columnIndex: 0, fieldKey: 'email', confirmed: false, score: 0.72 },
      { columnIndex: 1, fieldKey: null, confirmed: false },
      { columnIndex: 2, fieldKey: null, confirmed: false },
    ];
    const result = applyAiSuggestions(
      heuristic,
      [{ columnIndex: 2, fieldKey: 'email', confidence: 0.98 }],
      fields,
      columns,
    );
    expect(result.mappings[2]?.fieldKey).toBe('email');
    expect(result.mappings[0]?.fieldKey).toBeNull();
  });

  it('returns the base mappings unchanged for an empty suggestion list', () => {
    const result = applyAiSuggestions(base, [], fields, columns);
    expect(result.mappings).toEqual(base);
    expect(result.changedColumns).toEqual([]);
  });
});

describe('buildMatchInput and buildMatchPrompt', () => {
  const columns = buildSourceColumns(
    ['Full Name', 'Contact'],
    [['Ada Lovelace', 'ada@example.com']],
  );
  const mappings = autoMatchColumns(columns, fields);

  it('packs columns, fields and current mappings', () => {
    const input = buildMatchInput(columns, fields, mappings);
    expect(input.columns).toHaveLength(2);
    expect(input.columns[0]?.samples).toEqual(['Ada Lovelace']);
    expect(input.fields.map((f) => f.key)).toContain('email');
    expect(input.currentMappings).toHaveLength(2);
  });

  it('omits hidden fields, which the user cannot map anyway', () => {
    const withHidden = [...FIELDS, { label: 'Internal', key: 'internal', hidden: true }].map((f) =>
      normalizeField(f),
    );
    const input = buildMatchInput(columns, withHidden, mappings);
    expect(input.fields.map((f) => f.key)).not.toContain('internal');
  });

  it('truncates long sample values', () => {
    const long = buildSourceColumns(['Notes'], [['x'.repeat(500)]]);
    const input = buildMatchInput(long, fields, autoMatchColumns(long, fields));
    expect(input.columns[0]?.samples[0]?.length).toBeLessThan(70);
  });

  it('produces a prompt naming every column and field', () => {
    const prompt = buildMatchPrompt(buildMatchInput(columns, fields, mappings));
    expect(prompt).toContain('Full Name');
    expect(prompt).toContain('Contact');
    expect(prompt).toContain('dateOfBirth');
    expect(prompt).toContain('JSON only');
  });
});
