/**
 * End-to-end tests through the real component: open, upload, match, edit,
 * submit. These are the tests that would catch a regression a user would
 * actually notice, so they drive the UI rather than the engines underneath.
 */

import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SheetUploader } from '../SheetUploader';
import type {
  Field,
  HookRow,
  ResultMetadata,
  ResultRow,
  RowHook,
  StepHookRegistration,
} from '../types';

const FIELDS: Field[] = [
  { label: 'First Name', key: 'firstName', validators: [{ validate: 'required' }] },
  { label: 'Last Name', key: 'lastName', alternateMatches: ['surname'] },
  { label: 'Email', key: 'email', type: 'email', validators: [{ validate: 'unique' }] },
];

const CSV = ['First Name,surname,Email', 'Ada,Lovelace,ADA@example.com', 'Alan,Turing,alan@example.com'].join(
  '\n',
);

function csvFile(contents = CSV, name = 'contacts.csv') {
  return new File([contents], name, { type: 'text/csv' });
}

/** Opens the uploader and walks it to the review grid. */
async function openToReview(
  user: ReturnType<typeof userEvent.setup>,
  file: File = csvFile(),
) {
  await user.click(screen.getByRole('button', { name: 'Import' }));

  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(input, file);

  // Header step, then matching.
  await screen.findByText('Which row has your column names?');
  await user.click(screen.getByRole('button', { name: 'Continue' }));

  await screen.findByText('Match your columns');
  await user.click(screen.getByRole('button', { name: 'Continue' }));

  await screen.findByRole('grid');
}

interface HarnessProps {
  onResults?: (data: ResultRow[], metadata: ResultMetadata) => void;
  [key: string]: unknown;
}

function Harness({ onResults, ...rest }: HarnessProps) {
  return (
    <SheetUploader
      fields={FIELDS}
      settings={{ importIdentifier: 'Contacts', invalidDataBehavior: 'INCLUDE_INVALID_ROWS' }}
      onResults={onResults}
      {...rest}
    >
      <button>Import</button>
    </SheetUploader>
  );
}

describe('SheetUploader', () => {
  it('does not render the modal until the trigger is clicked', () => {
    render(<Harness />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import' })).toBeInTheDocument();
  });

  it('opens on trigger click and titles itself from importIdentifier', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Import' }));

    expect(await screen.findByRole('dialog', { name: 'Add Contacts' })).toBeInTheDocument();
  });

  it('walks upload → header → match → review and submits the data', async () => {
    const user = userEvent.setup();
    const onResults = vi.fn();
    render(<Harness onResults={onResults} />);

    await openToReview(user);
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(onResults).toHaveBeenCalled());

    const [data, metadata] = onResults.mock.calls[0] as [ResultRow[], ResultMetadata];

    expect(data).toEqual([
      // The email type lowercases as it coerces.
      { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
      { firstName: 'Alan', lastName: 'Turing', email: 'alan@example.com' },
    ]);
    expect(metadata.filename).toBe('contacts.csv');
    expect(metadata.rawHeaders).toEqual(['First Name', 'surname', 'Email']);
    expect(metadata.totalRows).toBe(2);
    expect(metadata.invalidRows).toBe(0);
  });

  it('auto-matches a column through alternateMatches', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Import' }));
    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, csvFile());
    await screen.findByText('Which row has your column names?');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    const select = await screen.findByLabelText('Map column surname');
    expect((select as HTMLSelectElement).value).toBe('lastName');
  });

  it('lets the user ignore a column and drops it from the results', async () => {
    const user = userEvent.setup();
    const onResults = vi.fn();
    render(<Harness onResults={onResults} />);

    await user.click(screen.getByRole('button', { name: 'Import' }));
    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, csvFile());
    await screen.findByText('Which row has your column names?');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await user.selectOptions(await screen.findByLabelText('Map column Email'), '__rsu_ignore__');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await screen.findByRole('grid');
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(onResults).toHaveBeenCalled());
    const [data] = onResults.mock.calls[0] as [ResultRow[]];
    expect(data[0]).toEqual({ firstName: 'Ada', lastName: 'Lovelace', email: null });
  });

  it('surfaces validation errors and blocks submit under BLOCK_SUBMIT', async () => {
    const user = userEvent.setup();
    const onResults = vi.fn();
    render(
      <Harness
        onResults={onResults}
        settings={{ importIdentifier: 'Contacts', invalidDataBehavior: 'BLOCK_SUBMIT' }}
      />,
    );

    // Both rows share an email, tripping `unique`, and one has no first name.
    await openToReview(
      user,
      csvFile(['First Name,surname,Email', ',Lovelace,a@x.com', 'Alan,Turing,a@x.com'].join('\n')),
    );

    expect(await screen.findByText(/Fix 2 rows with errors/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    expect(onResults).not.toHaveBeenCalled();
  });

  it('drops erroring rows under REMOVE_INVALID_ROWS', async () => {
    const user = userEvent.setup();
    const onResults = vi.fn();
    render(
      <Harness
        onResults={onResults}
        settings={{ importIdentifier: 'Contacts', invalidDataBehavior: 'REMOVE_INVALID_ROWS' }}
      />,
    );

    await openToReview(
      user,
      csvFile(['First Name,surname,Email', ',Lovelace,a@x.com', 'Alan,Turing,b@x.com'].join('\n')),
    );
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(onResults).toHaveBeenCalled());
    const [data, metadata] = onResults.mock.calls[0] as [ResultRow[], ResultMetadata];

    expect(data).toHaveLength(1);
    expect(data[0]?.firstName).toBe('Alan');
    expect(metadata.invalidRows).toBe(1);
  });

  it('runs row hooks and shows the messages they set', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        rowHooks={[
          (record: { row: Record<string, { value: string; info?: unknown[] }> }) => {
            if (record.row.email?.value === 'alan@example.com') {
              record.row.email.info = [{ message: 'Already registered', level: 'error' }];
            }
            return record;
          },
        ]}
      />,
    );

    await openToReview(user);

    expect(await screen.findByText('1 with errors')).toBeInTheDocument();
  });

  it('awaits async bulk row hooks before showing the grid', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        bulkRowHooks={[
          async (records: Array<{ row: Record<string, { value: string }> }>) => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            for (const record of records) {
              if (record.row.firstName) record.row.firstName.value = 'Hooked';
            }
            return records;
          },
        ]}
      />,
    );

    await openToReview(user);

    expect(await screen.findAllByText('Hooked')).toHaveLength(2);
  });

  it('lets beforeFinish cancel the submit and explain why', async () => {
    const user = userEvent.setup();
    const onResults = vi.fn();
    render(
      <Harness
        onResults={onResults}
        beforeFinish={() => ({ cancel: true, message: 'Import at least 20 rows' })}
      />,
    );

    await openToReview(user);
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Import at least 20 rows');
    expect(onResults).not.toHaveBeenCalled();
  });

  it('edits a cell and re-runs coercion and validation', async () => {
    const user = userEvent.setup();
    const onResults = vi.fn();
    render(<Harness onResults={onResults} />);

    await openToReview(user);

    const cell = document.querySelector('[data-rsu-cell$=":firstName"]') as HTMLElement;
    await user.dblClick(cell);
    const editor = document.querySelector('.rsu-grid-editor') as HTMLInputElement;
    await user.clear(editor);
    await user.type(editor, 'Augusta{Enter}');

    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(onResults).toHaveBeenCalled());

    const [data] = onResults.mock.calls[0] as [ResultRow[]];
    expect(data[0]?.firstName).toBe('Augusta');
  });

  it('confirms before deleting a row', async () => {
    const user = userEvent.setup();
    const onResults = vi.fn();
    render(<Harness onResults={onResults} />);

    await openToReview(user);
    await user.click(screen.getByRole('button', { name: 'Delete row 1' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Delete this row?')).toBeInTheDocument();

    // Backing out leaves the data alone.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete row 1' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete row' }),
    );

    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(onResults).toHaveBeenCalled());

    const [data] = onResults.mock.calls[0] as [ResultRow[]];
    expect(data).toHaveLength(1);
    expect(data[0]?.firstName).toBe('Alan');
  });

  it('reports a bad file without closing the uploader', async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    render(<Harness onError={onError} />);

    await user.click(screen.getByRole('button', { name: 'Import' }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['{ not json'], 'broken.json', { type: 'application/json' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/not valid JSON/i);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(onError).toHaveBeenCalled());
  });

  describe('maxRecords', () => {
    it('rejects a file over an explicit limit', async () => {
      const user = userEvent.setup();
      render(
        <SheetUploader fields={FIELDS} settings={{ importIdentifier: 'Contacts', maxRecords: 1 }}>
          <button>Import</button>
        </SheetUploader>,
      );

      await user.click(screen.getByRole('button', { name: 'Import' }));
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      await user.upload(input, csvFile());

      expect(await screen.findByRole('alert')).toHaveTextContent('has 2 rows, more than the 1-row limit');
    });

    // A caller wiring `maxRecords` from an API or config passes `null` for "no
    // limit"; `rows.length - 1 > null` used to coerce to `> 0` and reject
    // everything.
    it.each([
      ['null', null],
      ['zero', 0],
      ['NaN', Number.NaN],
    ])('treats %s as no limit', async (_label, maxRecords) => {
      const user = userEvent.setup();
      render(
        <SheetUploader
          fields={FIELDS}
          settings={{
            importIdentifier: 'Contacts',
            maxRecords: maxRecords as unknown as number | undefined,
          }}
        >
          <button>Import</button>
        </SheetUploader>,
      );

      await user.click(screen.getByRole('button', { name: 'Import' }));
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      await user.upload(input, csvFile());

      await screen.findByText('Which row has your column names?');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  it('starts manual entry with a single blank, error-free row', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Import' }));
    await user.click(screen.getByRole('button', { name: /Enter your data by hand/ }));

    await screen.findByRole('grid');

    expect(document.querySelectorAll('.rsu-grid-row')).toHaveLength(1);
    // A row nobody has touched yet is pending, not invalid.
    expect(screen.queryByText(/with errors/)).not.toBeInTheDocument();
  });

  it('calls onCancel when dismissed', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<Harness onCancel={onCancel} />);

    await user.click(screen.getByRole('button', { name: 'Import' }));
    await user.click(await screen.findByRole('button', { name: 'Close' }));

    expect(onCancel).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('honours the controlled open prop', async () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <SheetUploader fields={FIELDS} open={false} onOpenChange={onOpenChange} />,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rerender(<SheetUploader fields={FIELDS} open onOpenChange={onOpenChange} />);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('skips the file picker when initialData is supplied', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        settings={{
          importIdentifier: 'Contacts',
          initialData: [{ 'First Name': 'Radia', surname: 'Perlman', Email: 'radia@example.com' }],
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Import' }));

    // Straight to the header step; no dropzone in sight.
    expect(await screen.findByText('Which row has your column names?')).toBeInTheDocument();
  });

  describe('grid keyboard navigation', () => {
    /** The cell the grid currently treats as active. */
    const activeCell = () =>
      document.querySelector('.rsu-grid-cell--active')?.getAttribute('data-rsu-cell') ?? null;

    async function openGrid(user: ReturnType<typeof userEvent.setup>) {
      render(<Harness />);
      await openToReview(user);
    }

    it('moves with the arrow keys once a cell is clicked', async () => {
      const user = userEvent.setup();
      await openGrid(user);

      await user.click(document.querySelector('[data-rsu-cell$=":firstName"]') as HTMLElement);
      const start = activeCell();

      await user.keyboard('{ArrowDown}');
      expect(activeCell()).not.toBe(start);
      expect(activeCell()).toMatch(/:firstName$/);

      await user.keyboard('{ArrowRight}');
      expect(activeCell()).toMatch(/:lastName$/);

      await user.keyboard('{ArrowUp}{ArrowLeft}');
      expect(activeCell()).toBe(start);
    });

    it('responds to the arrow keys before anything has been clicked', async () => {
      const user = userEvent.setup();
      await openGrid(user);

      // Focus the grid without clicking a cell — previously this left the
      // browser to scroll the container instead of moving the selection.
      await act(async () => {
        (document.querySelector('.rsu-grid') as HTMLElement).focus();
      });
      await user.keyboard('{ArrowDown}');

      expect(activeCell()).not.toBeNull();
    });

    it('moves to the next cell on Tab and back on Shift+Tab', async () => {
      const user = userEvent.setup();
      await openGrid(user);

      await user.click(document.querySelector('[data-rsu-cell$=":firstName"]') as HTMLElement);

      await user.keyboard('{Tab}');
      expect(activeCell()).toMatch(/:lastName$/);

      await user.keyboard('{Tab}');
      expect(activeCell()).toMatch(/:email$/);

      await user.keyboard('{Shift>}{Tab}{/Shift}');
      expect(activeCell()).toMatch(/:lastName$/);
    });

    it('wraps to the next row when tabbing off the last column', async () => {
      const user = userEvent.setup();
      await openGrid(user);

      // Email is the last column of the first row.
      const firstRowEmail = document.querySelectorAll('[data-rsu-cell$=":email"]')[0] as HTMLElement;
      await user.click(firstRowEmail);
      const firstRowId = activeCell()?.split(':')[0];

      await user.keyboard('{Tab}');

      const wrapped = activeCell();
      expect(wrapped).toMatch(/:firstName$/);
      expect(wrapped?.split(':')[0]).not.toBe(firstRowId);
    });

    it('keeps the keyboard working after an edit is committed', async () => {
      const user = userEvent.setup();
      await openGrid(user);

      const cell = document.querySelector('[data-rsu-cell$=":firstName"]') as HTMLElement;
      await user.dblClick(cell);
      await user.keyboard('Ada{Enter}');

      // Enter commits and steps down; the grid must still own focus afterwards
      // or the arrows would scroll it instead of moving.
      await user.keyboard('{ArrowRight}');
      expect(activeCell()).toMatch(/:lastName$/);
    });
  });

  it('hands the original file back for archiving', async () => {
    const user = userEvent.setup();
    const onResults = vi.fn();
    render(<Harness onResults={onResults} />);

    const file = csvFile();
    await openToReview(user, file);
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(onResults).toHaveBeenCalled());
    const [, metadata] = onResults.mock.calls[0] as [ResultRow[], ResultMetadata];

    expect(metadata.originalFile).toBe(file);
    expect(metadata.originalFile?.name).toBe('contacts.csv');
  });

  it('reports no original file for manual entry', async () => {
    const user = userEvent.setup();
    const onResults = vi.fn();
    render(<Harness onResults={onResults} />);

    await user.click(screen.getByRole('button', { name: 'Import' }));
    await user.click(screen.getByRole('button', { name: /Enter your data by hand/ }));
    await screen.findByRole('grid');

    const cell = document.querySelector('[data-rsu-cell$=":firstName"]') as HTMLElement;
    await user.dblClick(cell);
    await user.type(document.querySelector('.rsu-grid-editor') as HTMLInputElement, 'Ada{Enter}');

    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(onResults).toHaveBeenCalled());

    const [, metadata] = onResults.mock.calls[0] as [ResultRow[], ResultMetadata];
    expect(metadata.originalFile).toBeNull();
    expect(metadata.filename).toBeNull();
  });

  it('passes user metadata through to onResults', async () => {
    const user = userEvent.setup();
    const onResults = vi.fn();
    render(<Harness onResults={onResults} user={{ id: 'u1', name: 'Jane' }} />);

    await openToReview(user);
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(onResults).toHaveBeenCalled());
    const [, metadata] = onResults.mock.calls[0] as [ResultRow[], ResultMetadata];
    expect(metadata.user).toEqual({ id: 'u1', name: 'Jane' });
  });
  /**
   * A field added by a `REVIEW_STEP` step hook and then filled in by a row hook
   * on the same pass. This is how a template builds a computed column it does
   * not want the user to see during matching — the merged-address column on the
   * companies importer works exactly this way.
   */
  describe('a field added by a step hook', () => {
    const ADDRESS_FIELDS: Field[] = [
      { label: 'Street', key: 'street' },
      { label: 'Zip Code', key: 'zipCode' },
      { label: 'City', key: 'city' },
    ];

    const ADDRESS_CSV = [
      'Street,Zip Code,City',
      '12 Baker St,11001,London',
      '9 Rue Lafayette,75009,Paris',
    ].join('\n');

    const COMBINED_KEY = 'cf___combined-address';
    const MERGED = ['street', 'zipCode', 'city'];

    const stepHooks: StepHookRegistration[] = [
      {
        type: 'REVIEW_STEP',
        callback: (instance) => {
          instance.addField({ label: 'Full Combined Address', key: COMBINED_KEY });
        },
      },
    ];

    const rowHooks: RowHook[] = [
      (data, mode) => {
        const row: HookRow = {};
        if (mode === 'init' && MERGED.some((key) => data.row[key]?.value)) {
          row[COMBINED_KEY] = {
            value: MERGED.map((key) => data.row[key]?.value)
              .filter(Boolean)
              .join(' '),
            info: [{ message: 'combined multiple fields into Address', level: 'info' }],
          };
        }
        return { row };
      },
    ];

    function AddressHarness({ onResults }: HarnessProps) {
      return (
        <SheetUploader
          fields={ADDRESS_FIELDS}
          settings={{ importIdentifier: 'Companies', invalidDataBehavior: 'INCLUDE_INVALID_ROWS' }}
          stepHooks={stepHooks}
          rowHooks={rowHooks}
          onResults={onResults}
        >
          <button>Import</button>
        </SheetUploader>
      );
    }

    it('shows the row hook\'s value in the review grid', async () => {
      const user = userEvent.setup();
      render(<AddressHarness />);

      await openToReview(user, csvFile(ADDRESS_CSV, 'companies.csv'));

      expect(await screen.findByText('Full Combined Address')).toBeInTheDocument();

      const combined = [
        ...document.querySelectorAll(`[data-rsu-cell$=":${COMBINED_KEY}"]`),
      ].map((cell) => cell.textContent);
      expect(combined).toEqual(['12 Baker St 11001 London', '9 Rue Lafayette 75009 Paris']);
    });

    it('submits the value the row hook wrote into it', async () => {
      const user = userEvent.setup();
      const onResults = vi.fn();
      render(<AddressHarness onResults={onResults} />);

      await openToReview(user, csvFile(ADDRESS_CSV, 'companies.csv'));
      await user.click(screen.getByRole('button', { name: 'Submit' }));

      await waitFor(() => expect(onResults).toHaveBeenCalled());
      const [data] = onResults.mock.calls[0] as [ResultRow[]];

      expect(data).toEqual([
        {
          street: '12 Baker St',
          zipCode: '11001',
          city: 'London',
          [COMBINED_KEY]: '12 Baker St 11001 London',
        },
        {
          street: '9 Rue Lafayette',
          zipCode: '75009',
          city: 'Paris',
          [COMBINED_KEY]: '9 Rue Lafayette 75009 Paris',
        },
      ]);
    });
  });
});
