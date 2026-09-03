import { describe, expect, it } from 'vitest';
import { coerceValue, normalizeField, parseFieldType } from '../fieldTypes';
import type { Field } from '../../types';

function field(overrides: Partial<Field> & Pick<Field, 'key'>) {
  return normalizeField({ label: overrides.key, ...overrides } as Field);
}

describe('parseFieldType', () => {
  it('accepts a bare type name', () => {
    expect(parseFieldType('number')).toEqual({ typeName: 'number', typeOptions: {} });
  });

  it('accepts the two-element tuple form', () => {
    expect(parseFieldType(['number', { round: 2 }])).toEqual({
      typeName: 'number',
      typeOptions: { round: 2 },
    });
  });

  it('falls back to string for unknown types', () => {
    expect(parseFieldType('nonsense' as never).typeName).toBe('string');
  });
});

describe('coerceValue', () => {
  it('leaves empty cells alone so `required` owns emptiness', () => {
    const result = coerceValue('', field({ key: 'n', type: 'number' }));
    expect(result.error).toBeUndefined();
    expect(result.output).toBeNull();
  });

  describe('number', () => {
    const numeric = field({ key: 'n', type: 'number' });

    it.each([
      ['1234', 1234],
      ['1,234.56', 1234.56],
      ['1.234,56', 1234.56],
      ['$1,234.56', 1234.56],
      ['(89.00)', -89],
      ['-42', -42],
      ['1 234', 1234],
    ])('parses %s', (input, expected) => {
      expect(coerceValue(input, numeric).output).toBe(expected);
    });

    it('divides percentages by 100', () => {
      expect(coerceValue('45%', numeric).output).toBe(0.45);
    });

    it('rejects non-numeric text', () => {
      expect(coerceValue('abc', numeric).error).toMatch(/valid number/);
    });

    it('rounds to the requested precision', () => {
      const rounded = field({ key: 'n', type: ['number', { round: 2 }] });
      expect(coerceValue('3.14159', rounded).output).toBe(3.14);
    });

    it('enforces min and max', () => {
      const bounded = field({ key: 'n', type: ['number', { min: 1, max: 10 }] });
      expect(coerceValue('0', bounded).error).toMatch(/at least 1/);
      expect(coerceValue('11', bounded).error).toMatch(/at most 10/);
      expect(coerceValue('5', bounded).error).toBeUndefined();
    });

    it('formats with a preset', () => {
      const usd = field({ key: 'n', type: ['number', { preset: 'usd' }] });
      expect(coerceValue('1234.5', usd).display).toBe('$1,234.50');
    });
  });

  describe('date', () => {
    const date = field({ key: 'd', type: 'date' });

    it.each([
      ['2024-01-05', '2024-01-05'],
      ['01/05/2024', '2024-01-05'],
      ['Jan 5, 2024', '2024-01-05'],
      ['5 January 2024', '2024-01-05'],
      ['31/01/2024', '2024-01-31'],
    ])('parses %s to %s', (input, expected) => {
      expect(coerceValue(input, date).output).toBe(expected);
    });

    it('reads ambiguous dates day-first for a day-first locale', () => {
      const de = field({ key: 'd', type: ['date', { locale: 'de-DE' }] });
      expect(coerceValue('05.01.2024', de).output).toBe('2024-01-05');
      expect(coerceValue('05/01/2024', de).output).toBe('2024-01-05');
    });

    it('reads ambiguous dates month-first for a month-first locale', () => {
      const us = field({ key: 'd', type: ['date', { locale: 'en-US' }] });
      expect(coerceValue('05/01/2024', us).output).toBe('2024-05-01');
    });

    it('lets an explicit dayFirst win over the locale', () => {
      const mixed = field({ key: 'd', type: ['date', { locale: 'de-DE', dayFirst: false }] });
      expect(coerceValue('05/01/2024', mixed).output).toBe('2024-05-01');
    });

    it('ignores an unusable locale tag', () => {
      const bogus = field({ key: 'd', type: ['date', { locale: 'not-a-locale!' }] });
      expect(coerceValue('05/01/2024', bogus).output).toBe('2024-05-01');
    });

    it('respects dayFirst for ambiguous dates', () => {
      const dayFirst = field({ key: 'd', type: ['date', { dayFirst: true }] });
      expect(coerceValue('01/05/2024', dayFirst).output).toBe('2024-05-01');
    });

    it('rejects impossible dates', () => {
      expect(coerceValue('2024-02-31', date).error).toMatch(/valid date/);
      expect(coerceValue('not a date', date).error).toMatch(/valid date/);
    });

    it('applies a custom output format', () => {
      const custom = field({ key: 'd', type: ['date', { outputFormat: 'DD/MM/YYYY' }] });
      expect(coerceValue('2024-01-05', custom).output).toBe('05/01/2024');
    });
  });

  describe('datetime and time', () => {
    it('keeps the time component', () => {
      const dt = field({ key: 'd', type: 'datetime' });
      expect(coerceValue('2024-01-05 14:30', dt).output).toBe('2024-01-05T14:30');
    });

    it('understands 12-hour clocks', () => {
      const t = field({ key: 't', type: 'time' });
      expect(coerceValue('2:30 PM', t).output).toBe('14:30');
      expect(coerceValue('12:15 am', t).output).toBe('00:15');
    });
  });

  describe('checkbox', () => {
    const checkbox = field({ key: 'c', type: 'checkbox' });

    it.each(['', '0', 'off', 'n', 'no', 'FALSE', 'disabled'])('reads %s as false', (input) => {
      expect(coerceValue(input, checkbox).output).toBe(false);
    });

    it.each(['1', 'yes', 'TRUE', 'on', 'anything'])('reads %s as true', (input) => {
      expect(coerceValue(input, checkbox).output).toBe(true);
    });
  });

  describe('select', () => {
    const options = [
      { label: 'Active', value: 'active' },
      { label: 'Inactive', value: 'inactive', alternateMatches: ['disabled'] },
    ];
    const select = field({ key: 's', type: 'select', selectOptions: options });

    it('matches on value, label and alternates', () => {
      expect(coerceValue('active', select).output).toBe('active');
      expect(coerceValue('Inactive', select).output).toBe('inactive');
      expect(coerceValue('disabled', select).output).toBe('inactive');
    });

    it('matches case- and punctuation-insensitively', () => {
      expect(coerceValue('  ACTIVE ', select).output).toBe('active');
    });

    it('rejects values outside the option list', () => {
      expect(coerceValue('unknown', select).error).toMatch(/not one of/);
    });

    it('keeps unknown values when allowCustom is set', () => {
      const custom = field({
        key: 's',
        type: ['select', { allowCustom: true }],
        selectOptions: options,
      });
      expect(coerceValue('whatever', custom).output).toBe('whatever');
    });
  });

  describe('multi-select', () => {
    const multi = field({
      key: 'm',
      type: 'multi-select',
      selectOptions: [
        { label: 'Red', value: 'red' },
        { label: 'Blue', value: 'blue' },
      ],
    });

    it('splits on the delimiter and outputs an array', () => {
      expect(coerceValue('Red, Blue', multi).output).toEqual(['red', 'blue']);
    });

    it('drops duplicates', () => {
      expect(coerceValue('Red, Red', multi).output).toEqual(['red']);
    });

    it('reports values outside the option list', () => {
      expect(coerceValue('Red, Green', multi).error).toMatch(/not among/);
    });
  });

  describe('email', () => {
    const email = field({ key: 'e', type: 'email' });

    it('lowercases valid addresses', () => {
      expect(coerceValue('Ada@Example.COM', email).output).toBe('ada@example.com');
    });

    it.each(['no-at-sign', 'a@b', 'a@1.2.3.4', 'a b@example.com'])('rejects %s', (input) => {
      expect(coerceValue(input, email).error).toBeDefined();
    });
  });

  describe('country', () => {
    const country = field({ key: 'c', type: 'country' });

    it.each(['US', 'USA', 'United States', 'united states of america'])(
      'resolves %s to US',
      (input) => {
        expect(coerceValue(input, country).output).toBe('US');
      },
    );

    it('emits alpha-3 on request', () => {
      const three = field({ key: 'c', type: ['country', { format: '3-letter' }] });
      expect(coerceValue('Germany', three).output).toBe('DEU');
    });

    it('rejects unknown countries', () => {
      expect(coerceValue('Atlantis', country).error).toMatch(/recognized country/);
    });
  });

  describe('us-state-territory', () => {
    const state = field({ key: 's', type: 'us-state-territory' });

    it.each(['CA', 'California', 'california'])('resolves %s to CA', (input) => {
      expect(coerceValue(input, state).output).toBe('CA');
    });

    it('handles Puerto Rico and DC', () => {
      expect(coerceValue('Puerto Rico', state).output).toBe('PR');
      expect(coerceValue('Washington DC', state).output).toBe('DC');
    });
  });

  describe('phone-number', () => {
    it('normalizes to E.164', () => {
      const phone = field({ key: 'p', type: 'phone-number' });
      expect(coerceValue('+1 (415) 555-2671', phone).output).toBe('+14155552671');
    });

    it('applies a default country to national numbers', () => {
      const phone = field({ key: 'p', type: ['phone-number', { country: 'GB' }] });
      expect(coerceValue('020 7946 0958', phone).output).toBe('+442079460958');
    });

    it('rejects numbers that are too short', () => {
      const phone = field({ key: 'p', type: 'phone-number' });
      expect(coerceValue('12', phone).error).toBeDefined();
    });
  });

  describe('ssn', () => {
    const ssn = field({ key: 's', type: 'ssn' });

    it('accepts dashed and bare forms', () => {
      expect(coerceValue('123-45-6789', ssn).output).toBe('123456789');
      expect(coerceValue('123456789', ssn).output).toBe('123456789');
    });

    it('adds dashes on request', () => {
      const dashed = field({ key: 's', type: ['ssn', { outputDash: true }] });
      expect(coerceValue('123456789', dashed).output).toBe('123-45-6789');
    });

    it.each(['000-45-6789', '666-45-6789', '900-45-6789', '123-00-6789', '123-45-0000', '1234'])(
      'rejects %s',
      (input) => {
        expect(coerceValue(input, ssn).error).toBeDefined();
      },
    );
  });

  describe('url and domain', () => {
    it('adds a scheme to bare domains', () => {
      const url = field({ key: 'u', type: 'url' });
      expect(coerceValue('example.com/path', url).output).toBe('https://example.com/path');
    });

    it('enforces acceptedProtocols', () => {
      const url = field({ key: 'u', type: ['url', { acceptedProtocols: ['https'] }] });
      expect(coerceValue('http://example.com', url).error).toMatch(/Protocol/);
    });

    it('strips scheme and path from domains', () => {
      const domain = field({ key: 'd', type: 'domain' });
      expect(coerceValue('https://Sub.Example.com/page', domain).output).toBe('sub.example.com');
    });

    it('can forbid subdomains', () => {
      const domain = field({ key: 'd', type: ['domain', { allowSubdomains: false }] });
      expect(coerceValue('sub.example.com', domain).error).toMatch(/Subdomains/);
    });
  });

  describe('us-zip-code', () => {
    const zip = field({ key: 'z', type: 'us-zip-code' });

    it('keeps leading zeros', () => {
      expect(coerceValue('02134', zip).output).toBe('02134');
    });

    it('truncates ZIP+4 in 5-digit mode', () => {
      expect(coerceValue('02134-1234', zip).output).toBe('02134');
    });

    it('formats 9-digit mode with a dash', () => {
      const nine = field({ key: 'z', type: ['us-zip-code', { format: '9-digit', outputDash: true }] });
      expect(coerceValue('021341234', nine).output).toBe('02134-1234');
    });
  });

  describe('uuid', () => {
    const uuid = field({ key: 'u', type: 'uuid' });
    const v4 = '9f8b7c6d-1234-4abc-89ef-0123456789ab';

    it('lowercases valid UUIDs', () => {
      expect(coerceValue(v4.toUpperCase(), uuid).output).toBe(v4);
    });

    it('checks the version when asked', () => {
      const v5 = field({ key: 'u', type: ['uuid', { version: 5 }] });
      expect(coerceValue(v4, v5).error).toMatch(/version 5/);
    });
  });

  it('passes string values through exactly as entered', () => {
    const string = field({ key: 's', type: 'string' });
    expect(coerceValue('  padded  ', string).output).toBe('  padded  ');
  });
});
