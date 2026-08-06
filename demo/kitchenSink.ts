/**
 * A schema that exercises every field type, every type option permutation, and
 * every validator — so the demo doubles as a manual test surface.
 */

import type { Field } from '../src';

export const kitchenSinkFields: Field[] = [
  /* -- string ------------------------------------------------------------- */
  {
    label: 'Plain String',
    key: 'plainString',
    description: 'Passed through exactly as entered, including whitespace.',
  },
  {
    label: 'Bounded String',
    key: 'boundedString',
    description: 'length: min 2, max 8',
    validators: [{ validate: 'length', min: 2, max: 8 }],
  },
  {
    label: 'Letters Only',
    key: 'lettersOnly',
    description: 'alphabetical',
    validators: [{ validate: 'alphabetical' }],
  },
  {
    label: 'SKU',
    key: 'sku',
    description: 'regex_match ^[A-Z]{3}-\\d{4}$, and must be unique',
    validators: [
      { validate: 'regex_match', regex: '^[A-Z]{3}-\\d{4}$', errorMessage: 'Use the form ABC-1234.' },
      { validate: 'unique' },
    ],
  },
  {
    label: 'Public Note',
    key: 'publicNote',
    description: 'regex_exclude "confidential", case-insensitive',
    validators: [
      {
        validate: 'regex_exclude',
        regex: 'confidential',
        regexOptions: { ignoreCase: true },
        errorMessage: 'This note is shown publicly, so it cannot mention confidential material.',
        level: 'warning',
      },
    ],
  },

  /* -- number ------------------------------------------------------------- */
  {
    label: 'Number (default)',
    key: 'numberDefault',
    type: 'number',
    description: 'Understands 1,234.56 · 1.234,56 · $1,234 · (89) · 45%',
  },
  {
    label: 'Currency (USD)',
    key: 'numberUsd',
    type: ['number', { preset: 'usd' }],
  },
  {
    label: 'Accounting (USD)',
    key: 'numberUsdAccounting',
    type: ['number', { preset: 'usd_accounting' }],
  },
  {
    label: 'Percent',
    key: 'numberPercent',
    type: ['number', { preset: 'percent_1' }],
  },
  {
    label: 'Rounded (2dp)',
    key: 'numberRounded',
    type: ['number', { round: 2 }],
  },
  {
    label: 'Seats (1–5000)',
    key: 'numberBounded',
    type: ['number', { round: 0, min: 1, max: 5000 }],
  },

  /* -- date / time -------------------------------------------------------- */
  {
    label: 'Date',
    key: 'dateDefault',
    type: 'date',
    description: 'ISO, slashed, and textual dates all parse.',
  },
  {
    label: 'Date (day first)',
    key: 'dateDayFirst',
    type: ['date', { dayFirst: true }],
    description: '01/05/2024 reads as 1 May.',
  },
  {
    label: 'Date (UK output)',
    key: 'dateFormatted',
    type: ['date', { outputFormat: 'DD/MM/YYYY', displayFormat: 'DD MMM YYYY' }],
  },
  {
    label: 'Datetime',
    key: 'datetime',
    type: 'datetime',
  },
  {
    label: 'Datetime (seconds)',
    key: 'datetimeSeconds',
    type: ['datetime', { withSeconds: true }],
  },
  {
    label: 'Time',
    key: 'time',
    type: 'time',
    description: '12- and 24-hour clocks both parse.',
  },

  /* -- select ------------------------------------------------------------- */
  {
    label: 'Plan',
    key: 'planSelect',
    type: 'select',
    selectOptions: [
      { label: 'Free', value: 'free', alternateMatches: ['starter', 'trial'] },
      { label: 'Pro', value: 'pro' },
      { label: 'Enterprise', value: 'enterprise', alternateMatches: ['ent'] },
    ],
    description: 'Fuzzy matching plus alternateMatches.',
  },
  {
    label: 'Region (exact only)',
    key: 'regionExact',
    type: ['select', { exactMatchOnly: true }],
    selectOptions: [
      { label: 'EMEA', value: 'emea' },
      { label: 'AMER', value: 'amer' },
      { label: 'APAC', value: 'apac' },
    ],
    description: 'No fuzzy matching: the value must match exactly.',
  },
  {
    label: 'Source (custom ok)',
    key: 'sourceCustom',
    type: ['select', { allowCustom: true }],
    selectOptions: [
      { label: 'Referral', value: 'referral' },
      { label: 'Search', value: 'search' },
    ],
    description: 'Unrecognised values are kept rather than flagged.',
  },
  {
    label: 'Tags',
    key: 'tagsMulti',
    type: 'multi-select',
    selectOptions: [
      { label: 'Design', value: 'design' },
      { label: 'Engineering', value: 'engineering' },
      { label: 'Sales', value: 'sales' },
    ],
    description: 'Comma-separated; outputs an array.',
  },
  {
    label: 'Skills (semicolons)',
    key: 'skillsMulti',
    type: ['multi-select', { delimiter: ';', allowCustom: true }],
    selectOptions: [
      { label: 'React', value: 'react' },
      { label: 'TypeScript', value: 'typescript' },
    ],
  },

  /* -- booleans ----------------------------------------------------------- */
  {
    label: 'Active',
    key: 'active',
    type: 'checkbox',
    description: 'Empty, 0, off, n, no, false and disabled are false.',
  },

  /* -- identifiers and contacts ------------------------------------------- */
  {
    label: 'Email',
    key: 'email',
    type: 'email',
    requireMapping: true,
    validators: [{ validate: 'required' }, { validate: 'unique_case_insensitive' }],
    description: 'requireMapping: matching cannot be skipped for this field.',
  },
  {
    label: 'Phone (intl)',
    key: 'phoneIntl',
    type: 'phone-number',
  },
  {
    label: 'Phone (US default)',
    key: 'phoneUs',
    type: ['phone-number', { country: 'US', outputFormatted: true }],
  },
  {
    label: 'Phone (GB national)',
    key: 'phoneGb',
    type: ['phone-number', { country: 'GB', format: 'national' }],
  },
  {
    label: 'SSN',
    key: 'ssn',
    type: ['ssn', { outputDash: true }],
  },
  {
    label: 'UUID',
    key: 'uuidAny',
    type: 'uuid',
  },
  {
    label: 'UUID v4',
    key: 'uuidV4',
    type: ['uuid', { version: 4 }],
  },

  /* -- web ---------------------------------------------------------------- */
  {
    label: 'Website',
    key: 'url',
    type: ['url', { acceptedProtocols: ['https'] }],
    description: 'Bare domains get https://; http is rejected.',
  },
  {
    label: 'Apex Domain',
    key: 'domain',
    type: ['domain', { allowSubdomains: false }],
  },

  /* -- geography ---------------------------------------------------------- */
  {
    label: 'Country',
    key: 'country2',
    type: 'country',
    description: 'Names, alpha-2 and alpha-3 all resolve.',
  },
  {
    label: 'Country (alpha-3)',
    key: 'country3',
    type: ['country', { format: '3-letter' }],
  },
  {
    label: 'US State',
    key: 'usState',
    type: 'us-state-territory',
  },
  {
    label: 'ZIP',
    key: 'zip5',
    type: 'us-zip-code',
    description: 'Leading zeros survive; ZIP+4 truncates.',
  },
  {
    label: 'ZIP+4',
    key: 'zip9',
    type: ['us-zip-code', { format: '9-digit', outputDash: true }],
  },

  /* -- conditional validators --------------------------------------------- */
  {
    label: 'Company',
    key: 'company',
  },
  {
    label: 'Tax ID',
    key: 'taxId',
    validators: [
      {
        validate: 'require_with',
        fields: ['company'],
        errorMessage: 'Required whenever a company is given.',
      },
    ],
  },
  {
    label: 'Personal Email',
    key: 'personalEmail',
    validators: [
      {
        validate: 'require_without',
        fields: ['company'],
        errorMessage: 'Required when there is no company.',
        level: 'warning',
      },
    ],
  },
  {
    label: 'Contract Ref',
    key: 'contractRef',
    validators: [
      {
        validate: 'require_with_values',
        fieldValues: { planSelect: 'Enterprise' },
        errorMessage: 'Enterprise plans need a contract reference.',
      },
    ],
  },
  {
    label: 'Billing Contact',
    key: 'billingContact',
    validators: [
      {
        validate: 'require_with_all',
        fields: ['company', 'taxId'],
        errorMessage: 'Required once both a company and a tax ID are present.',
        level: 'warning',
      },
    ],
  },

  /* -- composite uniqueness ----------------------------------------------- */
  {
    label: 'First Name',
    key: 'firstName',
    validators: [{ validate: 'unique_with', uniqueKey: 'fullName' }],
  },
  {
    label: 'Last Name',
    key: 'lastName',
    validators: [{ validate: 'unique_with', uniqueKey: 'fullName' }],
  },

  /* -- structural flags --------------------------------------------------- */
  {
    label: 'Aliases',
    key: 'aliases',
    manyToOne: true,
    description: 'Several columns can map here; the result is an array.',
  },
  {
    label: 'Email Domain',
    key: 'emailDomain',
    readOnly: true,
    description: 'readOnly: filled by a row hook, not editable by hand.',
  },
  {
    label: 'Imported At',
    key: 'importedAt',
    hidden: true,
    description: 'hidden: never shown, still present in the results.',
  },
];

/** A file that lands on every interesting branch of the schema above. */
export const KITCHEN_SINK_CSV = `Plain String,Bounded String,Letters Only,SKU,Public Note,Number (default),Currency (USD),Accounting (USD),Percent,Rounded (2dp),Seats (1-5000),Date,Date (day first),Date (UK output),Datetime,Datetime (seconds),Time,Plan,Region (exact only),Source (custom ok),Tags,Skills (semicolons),Active,Email,Phone (intl),Phone (US default),Phone (GB national),SSN,UUID,UUID v4,Website,Apex Domain,Country,Country (alpha-3),US State,ZIP,ZIP+4,Company,Tax ID,Personal Email,Contract Ref,Billing Contact,First Name,Last Name,Alias,Nickname
  padded  ,ok,Alpha,ABC-1234,All clear,"1,234.56","$1,234.56","(89.00)",45%,3.14159,120,2024-01-05,01/05/2024,2024-01-05,2024-01-05 14:30,2024-01-05 14:30:59,2:30 PM,Enterprise,EMEA,Referral,"Engineering, Design",React;TypeScript,yes,ada@example.com,+1 415 555 2671,415-555-2671,020 7946 0958,123-45-6789,0b7f3c9e-4f5a-4a3d-9c2b-7e1f6a8d5c40,9f8b7c6d-1234-4abc-89ef-0123456789ab,example.com,example.com,United Kingdom,Germany,California,02134,02134-1234,Analytical Engines,GB-1234,ada@home.com,CTR-1,Ada Lovelace,Ada,Lovelace,Countess,AAL
x,waytoolongvalue,Alpha1,abc-1234,This is CONFIDENTIAL,"1.234,56",99.5,1200.5,0.5,2.005,0,Jan 5 2024,31/01/2024,15 March 1959,not a datetime,2024-02-31 10:00,25:99,starter,emea,Newsletter,"Engineering, Nope",Rust;React,no,ADA@EXAMPLE.COM,12,(650) 555-0143,07911 123456,000-45-6789,not-a-uuid,0b7f3c9e-4f5a-4a3d-9c2b-7e1f6a8d5c40,http://example.com,sub.example.com,Atlantis,USA,Puerto Rico,2134,021341234,,,, ,,Ada,Lovelace,,
Grace,fine,Beta,XYZ-9999,Fine,42,0,0,1,1,5000,03/15/1959,1/2/2024,1959-03-15,1959-03-15 09:00,1959-03-15 09:00:00,09:00,ent,APAC,Search,Sales,TypeScript,1,grace@example.com,+44 20 7946 0958,2025550188,0161 496 0000,987-65-4320,9f8b7c6d-1234-4abc-89ef-0123456789ab,0b7f3c9e-4f5a-4a3d-9c2b-7e1f6a8d5c40,https://navy.mil/grace,navy.mil,US,United States,DC,20301,20301-0001,US Navy,US-9981,,CTR-2,,Grace,Hopper,Amazing Grace,
Grace,fine,Gamma,XYZ-9999,Fine,1e3,-15,-15,0.125,9.999,4999,2024-12-31,12/11/2024,2024-12-31,2024-12-31 23:59,2024-12-31 23:59:59,11:59 pm,Pro,AMER,Referral,Design,React,true,grace@example.com,+81 3 1234 5678,4155552671,020 7946 0958,111-22-3333,0b7f3c9e-4f5a-4a3d-9c2b-7e1f6a8d5c40,9f8b7c6d-1234-4abc-89ef-0123456789ab,https://example.org,example.org,JPN,Japan,NY,10001,10001-1234,Acme,AC-1,,,,Grace,Hopper,,
`;
