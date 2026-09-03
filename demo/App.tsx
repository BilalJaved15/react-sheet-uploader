import { useRef, useState } from 'react';
import {
  SheetUploader,
  type BeforeFinishHook,
  type BulkRowHook,
  type ColumnHook,
  type Field,
  type ResultMetadata,
  type ResultRow,
  type RowHook,
  type Settings,
  type StepHook,
  type UploaderInstance,
} from '../src';
import {
  AI_DEMO_CSV,
  REAL_MATCHER_SNIPPET,
  aiDemoFields,
  simulatedAiMatch,
} from './aiMatchDemo';
import { DATE_LAB_CSV, DATE_LAB_ROWS, dateLabFields } from './dateLab';
import { KITCHEN_SINK_CSV, kitchenSinkFields } from './kitchenSink';
import '../src/styles.css';

/* -------------------------------------------------------------------------- */
/* Schema                                                                      */
/* -------------------------------------------------------------------------- */

const fields: Field[] = [
  {
    label: 'First Name',
    key: 'firstName',
    alternateMatches: ['fname', 'given name'],
    validators: [{ validate: 'required' }],
  },
  {
    label: 'Last Name',
    key: 'lastName',
    alternateMatches: ['surname', 'family name'],
  },
  {
    label: 'Email',
    key: 'email',
    type: 'email',
    validators: [{ validate: 'required' }, { validate: 'unique_case_insensitive' }],
    description: 'Used as the account login, so it has to be unique.',
  },
  {
    label: 'Phone',
    key: 'phone',
    type: ['phone-number', { country: 'US' }],
  },
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
        errorMessage: 'A tax ID is required whenever a company is given.',
      },
    ],
  },
  {
    label: 'Plan',
    key: 'plan',
    type: 'select',
    selectOptions: [
      { label: 'Free', value: 'free', alternateMatches: ['starter', 'trial'] },
      { label: 'Pro', value: 'pro' },
      { label: 'Enterprise', value: 'enterprise', alternateMatches: ['ent'] },
    ],
    validators: [{ validate: 'required' }],
  },
  {
    label: 'Seats',
    key: 'seats',
    type: ['number', { round: 0, min: 1, max: 5000 }],
  },
  {
    label: 'MRR',
    key: 'mrr',
    type: ['number', { preset: 'usd' }],
  },
  {
    label: 'Signed Up',
    key: 'signedUp',
    type: 'date',
  },
  {
    label: 'Country',
    key: 'country',
    type: 'country',
  },
  {
    label: 'Active',
    key: 'active',
    type: 'checkbox',
  },
  {
    label: 'Tags',
    key: 'tags',
    type: ['multi-select', { allowCustom: true }],
    selectOptions: [
      { label: 'Design', value: 'design' },
      { label: 'Engineering', value: 'engineering' },
      { label: 'Sales', value: 'sales' },
    ],
  },
  {
    label: 'Domain',
    key: 'domain',
    type: 'domain',
    readOnly: true,
    description: 'Derived from the email address by a row hook.',
  },
];

/* -------------------------------------------------------------------------- */
/* Hooks                                                                       */
/* -------------------------------------------------------------------------- */

/** Fills the read-only Domain column from whatever is in Email. */
const deriveDomain: RowHook = (record) => {
  const email = record.row.email?.value ?? '';
  const at = email.lastIndexOf('@');
  if (record.row.domain) {
    record.row.domain.value = at === -1 ? '' : email.slice(at + 1);
  }
  return record;
};

/** Flags rows where a paid plan has no seats, without blocking the import. */
const warnOnMissingSeats: RowHook = (record) => {
  const plan = record.row.plan?.value;
  const seats = record.row.seats?.value ?? '';

  if ((plan === 'Pro' || plan === 'Enterprise') && seats.trim() === '') {
    if (record.row.seats) {
      record.row.seats.info = [
        { message: 'Paid plans usually specify a seat count.', level: 'warning' },
      ];
    }
  } else if (record.row.seats) {
    record.row.seats.info = [];
  }
  return record;
};

/** Title-cases every company name in one pass over the column. */
const titleCaseCompany: ColumnHook = (values) =>
  values.map((entry) => ({
    ...entry,
    value: entry.value.replace(/\S+/g, (word) => word[0]!.toUpperCase() + word.slice(1).toLowerCase()),
  }));

/**
 * Stands in for a real duplicate check against your own API: one request for
 * the whole table rather than one per row.
 */
const checkExistingAccounts: BulkRowHook = async (records) => {
  await new Promise((resolve) => setTimeout(resolve, 120));
  const alreadyRegistered = new Set(['ada@example.com']);

  return records.map((record) => {
    const email = record.row.email?.value?.toLowerCase() ?? '';
    if (record.row.email && alreadyRegistered.has(email)) {
      record.row.email.info = [
        { message: 'This account already exists.', level: 'error' },
      ];
    }
    return record;
  });
};

const announceUpload: StepHook = (_instance, data) => {
  if ('preview' in data) {
    console.log('[demo] upload step — headers:', data.headers);
  }
};

const requireMinimumRows: BeforeFinishHook = (data) => {
  if (data.length === 0) {
    return { cancel: true, message: 'Import at least one row.' };
  }
  return undefined;
};

/** Builds a row hook that copies the domain half of one field into another. */
function deriveDomainFrom(sourceKey: string, targetKey: string): RowHook {
  return (record) => {
    const value = record.row[sourceKey]?.value ?? '';
    const at = value.lastIndexOf('@');
    if (record.row[targetKey]) {
      record.row[targetKey].value = at === -1 ? '' : value.slice(at + 1);
    }
    return record;
  };
}

/** Fills a hidden field, showing that hidden data still reaches the results. */
const stampImportedAt: RowHook = (record) => {
  if (record.row.importedAt) {
    record.row.importedAt.value = new Date().toISOString();
  }
  return record;
};

function downloadCsv(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/* -------------------------------------------------------------------------- */
/* Demo shell                                                                  */
/* -------------------------------------------------------------------------- */

const SAMPLE_CSV = `First Name,surname,Email,Phone,Company,Tax ID,Plan,Seats,MRR,Signed Up,Country,Active,Tags
Ada,Lovelace,ada@example.com,415-555-2671,analytical engines,GB-1234,Enterprise,120,"$12,000.00",1852-11-27,United Kingdom,yes,"Engineering, Design"
Alan,Turing,ALAN@example.com,(650) 555-0143,,,pro,,4500,1954-06-07,uk,1,Engineering
Grace,Hopper,grace@example.com,202-555-0188,us navy,US-9981,ent,4000,"$99,500.00",03/15/1959,USA,true,Engineering
Katherine,Johnson,not-an-email,,NASA,,starter,,0,08/26/1918,United States,no,
Ada,Lovelace,ada@example.com,415-555-2671,analytical engines,GB-1234,free,1,0,1852-11-27,GB,y,Design
`;

export function App() {
  const [results, setResults] = useState<{ data: ResultRow[]; metadata: ResultMetadata } | null>(
    null,
  );
  const [controlledOpen, setControlledOpen] = useState(false);
  const uploaderRef = useRef<UploaderInstance>(null);

  const settings: Settings = {
    importIdentifier: 'Customers',
    allowCustomFields: true,
    passThroughUnmappedColumns: true,
    invalidDataBehavior: 'BLOCK_SUBMIT',
    templateDownloadFilename: 'customers-template.csv',
    uploadStep: {
      helpText: 'CSV, TSV, XLSX and JSON all work. Try the sample file below.',
    },
    reviewStep: {
      enableNavigatingErrors: true,
      highlightAutoFixes: true,
      helpText: 'Click any cell to edit it. Errors block submission in this demo.',
    },
  };

  const shared = {
    fields,
    settings,
    user: { id: 'user_123', name: 'Jane Doe', email: 'jane@example.com' },
    rowHooks: [deriveDomain, warnOnMissingSeats] as RowHook[],
    bulkRowHooks: [checkExistingAccounts],
    columnHooks: [{ fieldKey: 'company', callback: titleCaseCompany }],
    stepHooks: [{ type: 'UPLOAD_STEP' as const, callback: announceUpload }],
    beforeFinish: requireMinimumRows,
    onResults: (data: ResultRow[], metadata: ResultMetadata) => setResults({ data, metadata }),
    onCancel: () => console.log('[demo] cancelled'),
  };

  const downloadSample = () => {
    const blob = new Blob([SAMPLE_CSV], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'sample-customers.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <h1>react-sheet-uploader</h1>
      <p className="lede">
        An open-source spreadsheet importer for React, API-compatible with Dromo.
      </p>

      <div className="panel">
        <h2>Open with a trigger</h2>
        <p>
          Pass any element as <code>children</code>; clicking it opens the importer.
        </p>
        <div className="row">
          <SheetUploader {...shared}>
            <button className="demo-btn">Import customers</button>
          </SheetUploader>

          <button className="demo-btn demo-btn--ghost" onClick={downloadSample}>
            Download a sample CSV
          </button>
        </div>
      </div>

      <div className="panel">
        <h2>AI-assisted column matching</h2>
        <p>
          The built-in matcher handles abbreviations (<code>DOB</code> &rarr; Date of Birth),
          word order, and value shapes — no network, no key. When headers need domain
          knowledge instead, <code>matchingStep.aiMatch</code> hands the problem to a model
          you control. Suggestions always arrive unconfirmed for the user to review.
        </p>
        <p className="hint">
          The sample below uses headers like <code>Rev/Mo</code> and <code>Lic Ct</code> that
          no string metric can reach. This page has nowhere safe to keep an API key, so the
          matcher here is a canned response on a 1.4s timer — the review flow it drives is
          the real one.
        </p>
        <div className="row">
          <SheetUploader
            fields={aiDemoFields}
            settings={{
              importIdentifier: 'Accounts',
              title: 'Import accounts',
              invalidDataBehavior: 'INCLUDE_INVALID_ROWS',
              matchingStep: {
                aiMatch: simulatedAiMatch,
                helpText: 'Watch the matches refine once the suggestions come back.',
              },
            }}
            onResults={(data, metadata) => setResults({ data, metadata })}
          >
            <button className="demo-btn">Import with AI matching</button>
          </SheetUploader>

          <SheetUploader
            fields={aiDemoFields}
            settings={{
              importIdentifier: 'Accounts',
              title: 'Import accounts (heuristic only)',
              invalidDataBehavior: 'INCLUDE_INVALID_ROWS',
            }}
            onResults={(data, metadata) => setResults({ data, metadata })}
          >
            <button className="demo-btn demo-btn--ghost">Compare without AI</button>
          </SheetUploader>

          <button
            className="demo-btn demo-btn--ghost"
            onClick={() => downloadCsv('messy-accounts.csv', AI_DEMO_CSV)}
          >
            Download the messy CSV
          </button>
        </div>

        <p className="hint" style={{ marginTop: 14 }}>
          Wired to a real endpoint it looks like this:
        </p>
        <pre>{REAL_MATCHER_SNIPPET}</pre>
      </div>

      <div className="panel">
        <h2>Control it from your own state</h2>
        <p>
          Drive the <code>open</code> prop, or hold a ref and call{' '}
          <code>uploader.open()</code>.
        </p>
        <div className="row">
          <button className="demo-btn demo-btn--ghost" onClick={() => setControlledOpen(true)}>
            Open via the open prop
          </button>
          <button className="demo-btn demo-btn--ghost" onClick={() => uploaderRef.current?.open()}>
            Open via a ref
          </button>
        </div>

        <SheetUploader
          {...shared}
          open={controlledOpen}
          onOpenChange={setControlledOpen}
          settings={{ ...settings, title: 'Import from your own button' }}
        />
        <SheetUploader ref={uploaderRef} {...shared} />
      </div>

      <div className="panel">
        <h2>Skip the file picker</h2>
        <p>
          Pass <code>settings.initialData</code> to start straight at column matching.
        </p>
        <SheetUploader
          {...shared}
          settings={{
            ...settings,
            title: 'Import preloaded data',
            initialData: [
              { 'First Name': 'Radia', surname: 'Perlman', Email: 'radia@example.com', Plan: 'Pro' },
              { 'First Name': 'Barbara', surname: 'Liskov', Email: 'barbara@example.com', Plan: 'free' },
            ],
          }}
        >
          <button className="demo-btn demo-btn--ghost">Import preloaded rows</button>
        </SheetUploader>
      </div>

      <div className="panel">
        <h2>Restyled</h2>
        <p>
          Everything is a CSS variable, driven by <code>settings.styleOverrides</code>.
        </p>
        <SheetUploader
          {...shared}
          settings={{
            ...settings,
            title: 'Import customers',
            styleOverrides: {
              global: {
                primaryTextColor: '#1a1523',
                secondaryTextColor: '#6f6e77',
                borderRadius: '2px',
                successColor: '#0f7b6c',
              },
              primaryButton: {
                backgroundColor: '#1a1523',
                textColor: '#fdfcfd',
                hoverBackgroundColor: '#000',
                borderRadius: '2px',
              },
              secondaryButton: { borderRadius: '2px' },
              stepperBar: { completeColor: '#0f7b6c', currentColor: '#1a1523' },
              dropzone: { borderColor: '#1a1523', borderStyle: 'solid', borderRadius: '2px' },
              modalOverlay: { backgroundColor: 'rgba(26, 21, 35, 0.6)' },
            },
          }}
        >
          <button className="demo-btn demo-btn--ghost">Open the restyled importer</button>
        </SheetUploader>
      </div>

      <div className="panel">
        <h2>Every field type</h2>
        <p>
          A schema covering all 17 field types, their option permutations, every validator,
          and the <code>manyToOne</code>, <code>hidden</code>, <code>readOnly</code> and{' '}
          <code>requireMapping</code> flags. The sample file is built to trip each one.
        </p>
        <div className="row">
          <SheetUploader
            fields={kitchenSinkFields}
            settings={{
              importIdentifier: 'Records',
              title: 'Every field type',
              allowCustomFields: true,
              invalidDataBehavior: 'INCLUDE_INVALID_ROWS',
              templateDownloadFilename: 'kitchen-sink-template.csv',
              reviewStep: { enableNavigatingErrors: true, highlightAutoFixes: true },
            }}
            rowHooks={[deriveDomainFrom('email', 'emailDomain'), stampImportedAt]}
            onResults={(data, metadata) => setResults({ data, metadata })}
          >
            <button className="demo-btn">Open the kitchen sink</button>
          </SheetUploader>

          <button
            className="demo-btn demo-btn--ghost"
            onClick={() => downloadCsv('kitchen-sink.csv', KITCHEN_SINK_CSV)}
          >
            Download its sample CSV
          </button>
        </div>
      </div>

      <div className="panel">
        <h2>Date, datetime and time</h2>
        <p>
          One column per parsing or validation rule, one row per case. The <code>Case</code>{' '}
          column says what each row is probing, so the review grid reads as a test report —
          turn on <code>highlightAutoFixes</code> and every cell the parser rewrote is marked.
        </p>
        <p className="hint">
          Covers month-first vs <code>dayFirst</code>, custom display and output formats,{' '}
          <code>withSeconds</code>, impossible dates, Excel serials, and the{' '}
          <code>required</code>, <code>unique</code>, <code>require_with</code> and{' '}
          <code>regex_match</code> validators on date fields. All 8 failures are deliberate:{' '}
          <em>Impossible calendar date</em>, <em>Excel serial number</em> and{' '}
          <em>Compact and free text</em> cannot be parsed at all; <em>Two-digit year</em>,{' '}
          <em>Blank required cell</em> and <em>Start with no end</em> each trip one validator;
          and <em>Repeated unique value</em> flags <em>Canonical ISO</em> along with itself.
        </p>
        <div className="row">
          <SheetUploader
            fields={dateLabFields}
            settings={{
              importIdentifier: 'Dates',
              title: 'Date field tester',
              invalidDataBehavior: 'INCLUDE_INVALID_ROWS',
              templateDownloadFilename: 'date-lab-template.csv',
              // Straight to matching with the cases already loaded, so checking
              // a parsing change is one click rather than a file round-trip.
              // The rows carry their own header, so there is nothing to pick.
              initialData: DATE_LAB_ROWS,
              matchingStep: { headerRowOverride: 0 },
              reviewStep: { enableNavigatingErrors: true, highlightAutoFixes: true },
            }}
            onResults={(data, metadata) => setResults({ data, metadata })}
          >
            <button className="demo-btn">Open the date tester</button>
          </SheetUploader>

          <button
            className="demo-btn demo-btn--ghost"
            onClick={() => downloadCsv('date-lab.csv', DATE_LAB_CSV)}
          >
            Download its sample CSV
          </button>
        </div>
      </div>

      <div className="panel">
        <h2>Type it in instead</h2>
        <p>
          With <code>manualInputOnly</code> the file picker is skipped entirely and the user
          lands on an empty grid. Paste from Excel works here.
        </p>
        <SheetUploader
          {...shared}
          settings={{ ...settings, title: 'Add customers by hand', manualInputOnly: true }}
        >
          <button className="demo-btn demo-btn--ghost">Enter data by hand</button>
        </SheetUploader>
      </div>

      {results && (
        <div className="panel">
          <h2>Results</h2>
          <p className="hint">
            {results.data.length} row{results.data.length === 1 ? '' : 's'} imported ·{' '}
            {results.metadata.invalidRows} invalid · {results.metadata.errors.length} remaining
            error{results.metadata.errors.length === 1 ? '' : 's'}
          </p>
          <pre>{JSON.stringify(results.data, null, 2)}</pre>
          <h2 style={{ marginTop: 18 }}>Metadata</h2>
          <pre>{JSON.stringify(results.metadata, null, 2)}</pre>
        </div>
      )}
    </>
  );
}
