# react-sheet-uploader

An open-source, embeddable spreadsheet importer for React — CSV, TSV, XLSX and JSON in, clean
validated objects out.

It is a drop-in replacement for [Dromo](https://dromo.io)'s React uploader: the same `fields`
schema, the same `settings`, the same row / bulk / column / step hooks, and the same `onResults`
payload. No license key, no backend, no per-import billing. Everything runs in the browser.

```bash
npm install react-sheet-uploader
# or: yarn add react-sheet-uploader
```

```jsx
import { SheetUploader } from 'react-sheet-uploader';
import 'react-sheet-uploader/styles.css';

<SheetUploader
  fields={[
    { label: 'Name', key: 'name', validators: [{ validate: 'required' }] },
    { label: 'Email', key: 'email', type: 'email', validators: [{ validate: 'unique' }] },
  ]}
  settings={{ importIdentifier: 'Contacts' }}
  onResults={(data, metadata) => console.log(data)}
>
  <button>Import contacts</button>
</SheetUploader>
```

---

## Contents

- [What you get](#what-you-get)
- [Migrating from Dromo](#migrating-from-dromo)
- [Opening the uploader](#opening-the-uploader)
- [Fields](#fields)
  - [Field types](#field-types)
  - [Validators](#validators)
- [Settings](#settings)
- [Hooks](#hooks)
- [Results](#results)
- [Styling](#styling)
- [Custom file formats](#custom-file-formats)
- [The import flow](#the-import-flow)
- [Headless use](#headless-use)
- [Browser support and bundle size](#browser-support-and-bundle-size)

---

## What you get

- **Formats** — CSV, TSV, delimited text, XLSX/XLSM, JSON, plus your own parsers.
- **Header detection** — finds the header row under title rows and blank lines; the user can
  override it.
- **Column matching** — fuzzy header matching against labels, keys and `alternateMatches`, scored
  globally so the best column wins each field.
- **17 field types** with coercion, from `email` and `phone-number` to `us-zip-code` and `uuid`.
- **A full validator set**, including cross-row `unique` and composite `unique_with`.
- **Hooks** — row, bulk row, column, step, row-delete and `beforeFinish`, all async-aware.
- **An editable, virtualised review grid** — 50k rows scroll smoothly; keyboard navigation, row
  selection, copy/paste to and from Excel, per-column error filters, and an error navigator.
- **Manual entry** — start from an empty grid instead of a file.
- **Theming** via `styleOverrides`, driven entirely by CSS custom properties.

---

## Migrating from Dromo

Change the import, drop the stylesheet in, and delete the license key when you feel like it:

```diff
- import DromoUploader from 'dromo-uploader-react';
+ import { SheetUploader } from 'react-sheet-uploader';
+ import 'react-sheet-uploader/styles.css';

- <DromoUploader licenseKey="..." fields={fields} settings={settings} onResults={onResults}>
+ <SheetUploader fields={fields} settings={settings} onResults={onResults}>
```

A `DromoUploader` alias is exported too, so `import { DromoUploader } from 'react-sheet-uploader'`
works if you would rather not touch the JSX.

**Accepted and ignored.** These only mean something against Dromo's servers. They are typed and
accepted so your existing config keeps compiling; they simply do nothing:
`licenseKey`, `schemaId`, `settings.backendSyncMode`, `settings.webhookUrl`,
`settings.developmentMode`, `settings.autoMapHeaders`, `settings.browserExcelParsing`.

**Deliberate differences.**

| | Dromo | react-sheet-uploader |
|---|---|---|
| `metadata.id` | server-assigned id | always `null` — there is no server |
| Legacy `.xls` | supported | not built in; re-save as `.xlsx`, or pass a `fileParsers` entry |
| AI "Transform data" | available | not implemented |
| Saved schemas / Schema Studio | available | not applicable |
| Session resume | available | not applicable |
| Locales | 35+ | English only |
| `phone-number` | full libphonenumber validation | E.164 normalisation with a country calling-code table; length-checked, not carrier-checked |

---

## Opening the uploader

Three ways, matching Dromo's:

```jsx
// 1. A trigger. Anything you pass as children opens it when clicked.
<SheetUploader fields={fields}><button>Import</button></SheetUploader>

// 2. Controlled.
<SheetUploader fields={fields} open={isOpen} onOpenChange={setIsOpen} />

// 3. Imperative, via a ref.
const uploader = useRef(null);
<SheetUploader ref={uploader} fields={fields} />;
uploader.current.open();
```

---

## Fields

```ts
interface Field {
  label: string;              // shown to the user
  key: string;                // key in the results
  type?: FieldType;           // defaults to 'string'
  description?: string;       // help text during matching and review
  alternateMatches?: string[];// extra header names that map here
  validators?: Validator[];
  selectOptions?: SelectOption[];
  readOnly?: boolean;         // visible, not editable
  hidden?: boolean;           // never shown, still in the results
  requireMapping?: boolean;   // matching cannot continue until it is mapped
  manyToOne?: boolean;        // several columns feed it; the value is an array
}
```

### Field types

A type is either a name or a `[name, options]` tuple:

```js
{ label: 'Signups', key: 'signups', type: 'number' }
{ label: 'Revenue', key: 'mrr', type: ['number', { preset: 'usd', round: 2 }] }
```

| Type | Options | Notes |
|---|---|---|
| `string` | — | Passed through exactly as entered. |
| `number` | `preset`, `round`, `min`, `max`, `displayFormat`, `outputFormat` | Reads `1,234.56`, `1.234,56`, `$1,234`, `(89)` and `45%`. Presets: `default`, `plain`, `percent`, `usd`, `usd_accounting`, `eur`, `gbp`, `decimal_0`–`decimal_4`, `integer`, `percent_0`–`percent_4`. |
| `date` | `dayFirst`, `displayFormat`, `outputFormat` | ISO, slashed and textual dates, plus Excel serials. Outputs `YYYY-MM-DD`. |
| `datetime` | as `date` plus `withSeconds` | Outputs ISO-8601. |
| `time` | `withSeconds`, formats | 12- and 24-hour clocks. |
| `select` | `allowCustom`, `exactMatchOnly` | Matches value, label, `alternateMatches`, then fuzzily. |
| `multi-select` | as `select` plus `delimiter`, `trimValues` | Outputs `string[]`; drops duplicates. |
| `checkbox` | — | Empty, `0`, `off`, `n`, `no`, `false`, `disabled` are false. |
| `email` | — | HTML5 spec, minus single-label domains and IP literals. Lowercased. |
| `country` | `format: '2-letter' \| '3-letter'` | ISO 3166-1 names, alpha-2 and alpha-3, plus common aliases. |
| `phone-number` | `country`, `format`, `outputFormatted` | Normalises to E.164; strips national trunk zeros. |
| `ssn` | `outputDash` | Rejects never-issued ranges. |
| `domain` | `allowSubdomains` | Strips scheme, path and port. |
| `url` | `acceptedProtocols`, `acceptedDomains` | Bare domains get `https://`. |
| `us-state-territory` | — | Names and codes, including DC and territories. |
| `us-zip-code` | `format`, `outputDash` | Leading zeros survive. |
| `uuid` | `version` | Optional version check. |

### Validators

```js
validators: [
  { validate: 'required' },
  { validate: 'unique', errorMessage: 'Already taken', level: 'warning' },
]
```

Every validator takes an optional `errorMessage` and a `level` of `error` (default, blocks
submission), `warning` or `info`.

| Validator | Extra keys |
|---|---|
| `required` | — |
| `unique`, `unique_case_insensitive` | — |
| `unique_with` | `uniqueKey` — fields sharing a key are unique as a tuple |
| `regex_match`, `regex_exclude` | `regex`, `regexOptions` (`ignoreCase`, `dotAll`, `multiline`, `unicode`) |
| `require_with`, `require_without`, `require_with_all`, `require_without_all` | `fields` |
| `require_with_values`, `require_without_values`, `require_with_all_values`, `require_without_all_values` | `fieldValues` |
| `length` | `min`, `max` |
| `alphabetical` | — |

> Rows where every user-editable cell is blank are treated as pending input, not errors. They are
> never validated and never submitted, so a fresh manual-entry grid does not open covered in
> required-field failures.

---

## Settings

```js
settings={{
  importIdentifier: 'Contacts',      // drives the default title, "Add Contacts"
  title: 'Import your contacts',
  invalidDataBehavior: 'REMOVE_INVALID_ROWS', // | 'BLOCK_SUBMIT' | 'INCLUDE_INVALID_ROWS'
  allowEmptySubmit: true,
  allowCustomFields: false,          // let users invent fields while matching
  passThroughUnmappedColumns: false, // adds `$unmapped` to each result row
  maxRecords: 50000,
  maxFileSize: 1024 * 1024 * 100,
  delimiter: '|',                    // auto-detected when omitted
  templateDownloadFilename: 'template.csv',
  initialData: [...],                // skip the file picker
  initialFile: someFile,
  manualInputDisabled: false,        // hide "enter your data by hand"
  manualInputOnly: false,            // hide the dropzone entirely

  uploadStep:      { helpText, sheetOverride, templateDownloadOverrideURL },
  matchingStep:    { helpText, fuzzyMatchHeaders, headerRowOverride, suggestCustomFirst },
  matchValuesStep: { helpText, maxMappableSelectValues },
  reviewStep:      { helpText, processingText, allowAddingRows, allowRemovingRows,
                     enableNavigatingErrors, highlightAutoFixes },
}}
```

---

## Hooks

All hooks may be `async`; the uploader waits for them.

```jsx
<SheetUploader
  rowHooks={[(record, mode) => { ... return record; }]}
  bulkRowHooks={[async (records, mode) => records]}
  columnHooks={[{ fieldKey: 'company', callback: (values) => values }]}
  stepHooks={[{ type: 'REVIEW_STEP', callback: (instance, data) => {} }]}
  rowDeleteHooks={[(record) => {}]}
  beforeFinish={(data, metadata, instance) => {}}
/>
```

**Row hooks** run per row on load (`mode: 'init'`) and after each edit (`'update'`). Mutate the
record and return it:

```js
const deriveDomain = (record) => {
  const email = record.row.email.value;
  record.row.domain.value = email.slice(email.indexOf('@') + 1);
  return record;
};
```

Set `info` to attach messages to a cell. An `error` blocks submission:

```js
record.row.email.info = [{ message: 'Already registered', level: 'error' }];
```

Assigning to `value` re-runs coercion and validation, so writing `'Jan 5, 2024'` into a `date`
field still yields `2024-01-05`. Set `resultValue` to change the output without changing what the
user sees.

**Bulk row hooks** get the whole table in one call — the right place for a single API round-trip:

```js
const checkDuplicates = async (records) => {
  const taken = await fetch('/api/existing-emails').then((r) => r.json());
  return records.map((record) => {
    if (taken.includes(record.row.email.value)) {
      record.row.email.info = [{ message: 'Already exists', level: 'error' }];
    }
    return record;
  });
};
```

**Column hooks** rewrite one column in a single pass, before row hooks run.

**Step hooks** fire at `UPLOAD_STEP`, `REVIEW_STEP`, `REVIEW_STEP_POST_HOOKS` and
`REVIEW_STEP_PRE_SUBMIT`, receiving `(instance, data)`.

**`beforeFinish`** is where table-level rules live. Return `{ cancel: true, message }` to keep the
user on the review screen:

```js
beforeFinish={(data) =>
  data.length < 20 ? { cancel: true, message: 'Import at least 20 rows' } : undefined
}
```

**The instance** passed to step hooks and `beforeFinish` exposes `addField`, `removeField`,
`addRows`, `removeRows`, `getRecords`, `setRecords`, `updateInfoMessages`, `setMessage`,
`setConfirmationMessage`, `goToStep`, `open` and `close`.

---

## Results

```js
onResults={(data, metadata) => { ... }}
```

`data` is a plain array of objects keyed by field key. `manyToOne` and `multi-select` fields hold
arrays; with `passThroughUnmappedColumns` each row also carries `$unmapped`, keyed by source column
index.

```js
[{ name: 'Ada Lovelace', email: 'ada@example.com', tags: ['design'] }]
```

`metadata` carries `id` (always `null`), `filename`, `originalFile`, `importIdentifier`, `user`,
`rawHeaders`, `fields` (with `fileHeader`, `fileHeaderIndex`, `isCustom`, `manyToOne`),
`rowsWithError`, `errors`, `totalRows`, `validRows` and `invalidRows`.

`onCancel` fires if the user leaves without finishing. `onError` fires when a file fails to parse
or a hook throws.

### Storing the results yourself

There is no backend, so there is nothing to configure: `onResults` is the storage hook. It is
awaited, so the modal keeps its spinner up for the whole upload, and if it throws the user stays on
the review screen with an error banner and can retry without losing their work.

```jsx
onResults={async (data, metadata) => {
  const { url } = await fetch('/api/presign', { method: 'POST' }).then((r) => r.json());
  await fetch(url, { method: 'PUT', body: JSON.stringify(data) });
}}
```

`metadata.originalFile` is the `File` exactly as the user chose it, for archiving the raw upload
alongside the parsed data. It is `null` for manual entry and for `initialData`.

```js
if (metadata.originalFile) {
  await fetch(rawUrl, { method: 'PUT', body: metadata.originalFile });
}
```

It is a live `File`, not JSON — `JSON.stringify(metadata)` renders it as `{}`. Send it as a request
body rather than serializing it.

Mint presigned URLs on your server. This library runs entirely in the browser, so any storage
credential handed to it is readable by the user.

If presigning can fail and you would rather find out before the user hits Submit, do it in
`beforeFinish` and return `{ cancel: true, message }` on failure.

---

## Styling

Import the stylesheet once:

```js
import 'react-sheet-uploader/styles.css';
```

Then rebrand through `settings.styleOverrides`, which maps onto CSS custom properties:

```js
styleOverrides: {
  global: { primaryTextColor: '#1a1523', borderRadius: '2px', customFontFamily: 'Inter' },
  primaryButton: { backgroundColor: '#1a1523', textColor: '#fff' },
  stepperBar: { completeColor: '#0f7b6c' },
  dropzone: { borderColor: '#1a1523', borderStyle: 'solid' },
  modalOverlay: { backgroundColor: 'rgba(26, 21, 35, 0.6)' },
}
```

Supported groups: `global`, `primaryButton`, `secondaryButton`, `tertiaryButton`, `dropzone`,
`helpText`, `stepperBar`, `dataTable`, `modalOverlay`, `errorNavigator`.

Every rule is scoped under `.rsu-root` and every class is prefixed `rsu-`, so nothing leaks either
way. If you would rather skip `styleOverrides`, set the `--rsu-*` variables yourself.

---

## Custom file formats

```jsx
<SheetUploader
  fileParsers={[
    {
      extensions: ['xml'],
      parseFile: async (buffer, fileName) => {
        const text = new TextDecoder().decode(buffer);
        return [['Header A', 'Header B'], ['1', '2']]; // rectangular string[][]
      },
    },
  ]}
/>
```

This is also how to add legacy `.xls`, by delegating to a reader of your choice.

---

## The import flow

1. **Upload** — drop a file, or start an empty grid by hand.
2. **Sheet** — only when a workbook has more than one sheet.
3. **Header row** — skipped when `matchingStep.headerRowOverride` is set.
4. **Match columns** — auto-matched, user-confirmable.
5. **Match values** — only when `select` values in the file match no option.
6. **Review** — edit, fix, and submit.

In the review grid: click a cell to select it and type to edit; click a row number to select the
whole row; `Cmd/Ctrl+C` and `Cmd/Ctrl+V` copy and paste rows to and from Excel; arrows, `Tab` and
`Enter` navigate, and `Enter` on the last row adds another. Select-type cells open a dropdown on a
single click. Column headers show an error count that filters the grid to that column's problems.

---

## Headless use

The engines are exported if you want the pipeline without the UI:

```js
import {
  parseFile, normalizeField, coerceValue, autoMatchColumns,
  detectHeaderRow, buildRecords, runPipeline, validateRecords,
  buildResults, buildTemplateCsv,
} from 'react-sheet-uploader';
```

These sit outside the Dromo compatibility surface and may change more freely than the component
API.

---

## Browser support and bundle size

Modern evergreen browsers. The published bundles are minified, with source maps alongside so you
can still step through readable code. The main chunk is roughly 45 kB gzipped; the spreadsheet
reader is a separate ~18 kB chunk, loaded on demand the first time someone uploads an XLSX file.
The stylesheet is ~5 kB gzipped.

Runtime dependencies are just `papaparse` and `read-excel-file`. React 17, 18 and 19 are supported
as peer dependencies.

## Development

```bash
yarn install
yarn dev        # demo app at localhost:5173
yarn test
yarn build
```

## License

MIT
