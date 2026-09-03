/**
 * A schema and sample file for exercising the date, datetime and time types.
 *
 * Every column is one parsing or validation rule, and every row is one labelled
 * case, so the review grid reads as a test report: the Case column says what the
 * row is probing and the rest of the row shows what the engine did with it.
 *
 * The expected results in the comments were taken from the coercion layer
 * itself, not from the documentation — where the two disagree, this file
 * follows the code.
 */

import type { Field } from '../src';

export const dateLabFields: Field[] = [
  {
    label: 'Case',
    key: 'caseName',
    requireMapping: true,
    description: 'What this row is testing.',
  },

  /* -- parsing ------------------------------------------------------------ */
  {
    label: 'Date',
    key: 'date',
    type: 'date',
    description:
      'Month-first for ambiguous numeric dates. Outputs YYYY-MM-DD. A time component is parsed and then dropped.',
  },
  {
    label: 'Date (day first)',
    key: 'dateDayFirst',
    type: ['date', { dayFirst: true }],
    description: 'dayFirst: true — 01/05/2024 is 1 May here and 5 January in the column before it.',
  },
  {
    label: 'Date (UK format)',
    key: 'dateUk',
    type: ['date', { displayFormat: 'DD MMM YYYY', outputFormat: 'DD/MM/YYYY' }],
    description:
      'Shown as DD MMM YYYY, submitted as DD/MM/YYYY. Formatting is independent of how the input was read.',
  },
  {
    label: 'Datetime',
    key: 'datetime',
    type: 'datetime',
    description: 'Outputs YYYY-MM-DDTHH:mm. A date with no time becomes midnight; seconds are dropped.',
  },
  {
    label: 'Datetime (seconds)',
    key: 'datetimeSeconds',
    type: ['datetime', { withSeconds: true }],
    description: 'withSeconds: true — the same inputs keep their seconds, and gain :00 when they had none.',
  },
  {
    label: 'Time',
    key: 'time',
    type: 'time',
    description: '12- and 24-hour clocks. A full datetime is accepted and reduced to its time.',
  },
  {
    label: 'Time (seconds)',
    key: 'timeSeconds',
    type: ['time', { withSeconds: true }],
    description: 'withSeconds: true — 09:15 becomes 09:15:00 rather than losing the field.',
  },

  /* -- validation --------------------------------------------------------- */
  {
    label: 'Required Date',
    key: 'requiredDate',
    type: 'date',
    validators: [{ validate: 'required' }],
    description: 'required — a blank cell is an error, an unparseable one is a coercion error instead.',
  },
  {
    label: 'Unique Date',
    key: 'uniqueDate',
    type: 'date',
    validators: [{ validate: 'unique' }],
    description: 'unique — compared after coercion, so 01/05/2024 and 2024-01-05 collide.',
  },
  {
    label: 'Start Date',
    key: 'startDate',
    type: 'date',
  },
  {
    label: 'End Date',
    key: 'endDate',
    type: 'date',
    validators: [
      {
        validate: 'require_with',
        fields: ['startDate'],
        errorMessage: 'An end date is required whenever a start date is given.',
      },
    ],
    description: 'require_with startDate — a cross-field rule, evaluated on the coerced values.',
  },
  {
    label: 'Q1 Date',
    key: 'q1Date',
    type: 'date',
    validators: [
      {
        validate: 'regex_match',
        regex: '^2024-0[123]-\\d{2}$',
        errorMessage: 'Only dates in Q1 2024 are accepted.',
      },
    ],
    description:
      'regex_match against the coerced value, not the raw text — so "15 Mar 2024" passes a rule written for ISO.',
  },
];

/**
 * One row per case. Expected outcomes, verified against the coercion layer:
 *
 *  1  canonical ISO                — everything parses untouched
 *  2  ambiguous 01/05/2024         — Jan 5 under Date, May 1 under Date (day first)
 *  3  textual months               — "Jan 5, 2024" and "5 January 2024" both land on 2024-01-05
 *  4  two-digit years and dashes   — 1/5/24 works; 05-01-2024 is read month-first, so 1 May
 *  5  seconds without withSeconds  — dropped by Datetime and Time, kept by the two seconds columns
 *  6  impossible calendar date     — 2024-02-31 is rejected by every date column
 *  7  Excel serial                 — 45296 is rejected as text, despite the README's claim
 *  8  compact and free text        — 20240105 and "today" are rejected
 *  9  blank required cell          — the only error is `required`
 * 10  repeated unique value        — 2024-01-05 collides with row 1
 * 11  start with no end            — require_with fires on End Date
 * 12  regex on a textual date      — "15 Mar 2024" coerces to 2024-03-15 and passes the Q1 rule
 */
export const DATE_LAB_ROWS: string[][] = [
  // Case                          Date                   Date (day first)  Date (UK format)  Datetime               Datetime (seconds)     Time                   Time (seconds)         Required     Unique       Start        End          Q1
  ['Case', 'Date', 'Date (day first)', 'Date (UK format)', 'Datetime', 'Datetime (seconds)', 'Time', 'Time (seconds)', 'Required Date', 'Unique Date', 'Start Date', 'End Date', 'Q1 Date'],
  ['Canonical ISO', '2024-01-05', '2024-01-05', '15 Mar 2024', '2024-01-05 09:15', '2024-01-05 09:15:30', '09:15', '09:15:30', '2024-01-05', '2024-01-05', '2024-01-01', '2024-01-31', '2024-01-05'],
  ['Ambiguous 01/05/2024', '01/05/2024', '01/05/2024', '01/05/2024', '01/05/2024 14:30', '2024-01-05 09:15', '2:30 PM', '2:30:05 PM', '01/05/2024', '2024-02-06', '2024-02-01', '2024-02-29', '2024-02-06'],
  ['Textual months', 'Jan 5, 2024', '5 January 2024', '15 Mar 2024', 'Jan 5 2024', '15 Mar 2024', '12:15 am', '09:15', '5 January 2024', '2024-03-15', '2024-03-01', '2024-03-31', '2024-03-15'],
  ['Two-digit year and dashes', '1/5/24', '1/5/24', '05-01-2024', '1/5/24', '1/5/24', '09:15:30', '09:15:30', '1/5/24', '2024-04-02', '2024-04-01', '2024-04-30', '2024-04-02'],
  ['Seconds without withSeconds', '2024-01-05 09:15:30', '2024-03-15', '2024-04-02', '2024-01-05 09:15:30', '2024-01-05 09:15:30', '2024-01-05 09:15:30', '2024-01-05 09:15:30', '2024-01-05', '2024-05-07', '2024-05-01', '2024-05-31', '2024-03-15'],
  ['Impossible calendar date', '2024-02-31', '2024-02-31', '2024-02-31', '2024-02-31', '2024-02-31', '2024-02-31', '2024-02-31', '2024-06-03', '2024-06-03', '2024-06-01', '2024-06-30', '2024-01-15'],
  ['Excel serial number', '45296', '45296', '45296', '45296', '45296', '45296', '45296', '2024-07-08', '2024-07-08', '2024-07-01', '2024-07-31', '2024-02-20'],
  ['Compact and free text', '20240105', 'today', 'today', '20240105', 'today', 'today', '20240105', '2024-08-09', '2024-08-09', '2024-08-01', '2024-08-31', '2024-03-01'],
  ['Blank required cell', '2024-09-10', '2024-09-10', '2024-09-10', '2024-09-10 08:00', '2024-09-10 08:00:00', '08:00', '08:00:00', '', '2024-09-10', '2024-09-01', '2024-09-30', '2024-01-31'],
  ['Repeated unique value', '2024-10-11', '2024-10-11', '2024-10-11', '2024-10-11 08:00', '2024-10-11 08:00:00', '08:00', '08:00:00', '2024-10-11', '2024-01-05', '2024-10-01', '2024-10-31', '2024-02-29'],
  ['Start with no end', '2024-11-12', '2024-11-12', '2024-11-12', '2024-11-12 08:00', '2024-11-12 08:00:00', '08:00', '08:00:00', '2024-11-12', '2024-11-12', '2024-11-01', '', '2024-03-31'],
  ['Regex on a textual date', '2024-12-13', '2024-12-13', '2024-12-13', '2024-12-13 08:00', '2024-12-13 08:00:00', '08:00', '08:00:00', '2024-12-13', '2024-12-13', '2024-12-01', '2024-12-31', '15 Mar 2024'],
];

/** Built from the rows above so the file and the preloaded grid cannot drift. */
export const DATE_LAB_CSV = DATE_LAB_ROWS.map((row) =>
  row.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(','),
).join('\n');
