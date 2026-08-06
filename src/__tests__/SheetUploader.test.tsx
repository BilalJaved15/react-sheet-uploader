/**
 * End-to-end tests through the real component: open, upload, match, edit,
 * submit. These are the tests that would catch a regression a user would
 * actually notice, so they drive the UI rather than the engines underneath.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SheetUploader } from '../SheetUploader';
import type { Field, ResultMetadata, ResultRow } from '../types';

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
});
