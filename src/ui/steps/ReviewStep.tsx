import { useCallback, useMemo, useState } from 'react';
import type { NormalizedField } from '../../core/fieldTypes';
import { cellMessages, messageLevel, recordHasError, type InternalRecord } from '../../core/model';
import type { ReviewStepSettings } from '../../types';
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  PlusIcon,
  TrashIcon,
} from '../components/Icons';
import { DataGrid, type CellAddress, type CellEdit } from '../DataGrid';

type Filter = 'all' | 'errors';

interface ReviewStepProps {
  records: InternalRecord[];
  fields: NormalizedField[];
  dataVersion: number;
  settings: ReviewStepSettings;
  manualEntry: boolean;
  onEdit: (edits: CellEdit[]) => void;
  onDeleteRows: (recordIds: string[]) => void;
  /** Returns the new row's id so the grid can focus it. */
  onAddRow: () => string | undefined;
}

interface Problem {
  recordId: string;
  rowNumber: number;
  fieldKey: string;
  fieldLabel: string;
  message: string;
  level: 'error' | 'warning';
}

export function ReviewStep({
  records,
  fields,
  dataVersion,
  settings,
  manualEntry,
  onEdit,
  onDeleteRows,
  onAddRow,
}: ReviewStepProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [columnFilter, setColumnFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [focusTarget, setFocusTarget] = useState<CellAddress | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [navigatorOpen, setNavigatorOpen] = useState(true);

  const allowAddingRows = settings.allowAddingRows ?? true;
  const allowRemovingRows = settings.allowRemovingRows ?? true;

  const { errorRows, warningRows, columnErrorCounts } = useMemo(() => {
    let errors = 0;
    let warnings = 0;
    const counts = new Map<string, number>();

    for (const record of records) {
      let hasError = false;
      let hasWarning = false;

      for (const field of fields) {
        const cell = record.cells[field.key];
        if (!cell) continue;
        let cellHasError = false;
        for (const message of cellMessages(cell)) {
          const level = messageLevel(message);
          if (level === 'error') cellHasError = true;
          else if (level === 'warning') hasWarning = true;
        }
        if (cellHasError) {
          hasError = true;
          counts.set(field.key, (counts.get(field.key) ?? 0) + 1);
        }
      }

      if (hasError) errors += 1;
      if (hasWarning) warnings += 1;
    }

    return { errorRows: errors, warningRows: warnings, columnErrorCounts: counts };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, fields, dataVersion]);

  /** True when the record has an error specifically in `fieldKey`. */
  const hasErrorIn = useCallback((record: InternalRecord, fieldKey: string) => {
    const cell = record.cells[fieldKey];
    if (!cell) return false;
    return cellMessages(cell).some((message) => messageLevel(message) === 'error');
  }, []);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();

    return records.filter((record) => {
      if (columnFilter && !hasErrorIn(record, columnFilter)) return false;
      if (filter === 'errors' && !recordHasError(record)) return false;
      if (query === '') return true;
      return Object.values(record.cells).some((cell) => cell.value.toLowerCase().includes(query));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, filter, columnFilter, search, dataVersion, hasErrorIn]);

  const problems = useMemo<Problem[]>(() => {
    if (!settings.enableNavigatingErrors) return [];

    const list: Problem[] = [];
    records.forEach((record, index) => {
      for (const field of fields) {
        const cell = record.cells[field.key];
        if (!cell) continue;
        for (const message of cellMessages(cell)) {
          const level = messageLevel(message);
          if (level === 'info') continue;
          list.push({
            recordId: record.id,
            rowNumber: record.sourceRow ?? index + 1,
            fieldKey: field.key,
            fieldLabel: field.label,
            message: message.message,
            level,
          });
        }
      }
    });
    // Errors before warnings, so the blocking problems are reachable first.
    return list.sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, fields, dataVersion, settings.enableNavigatingErrors]);

  const copySelected = useCallback(() => {
    const chosen = records.filter((record) => selectedIds.has(record.id));
    if (chosen.length === 0) return;

    const visibleFields = fields.filter((field) => !field.hidden);
    const escape = (value: string) =>
      /[\t\n"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

    const text = [
      visibleFields.map((field) => escape(field.label)).join('\t'),
      ...chosen.map((record) =>
        visibleFields.map((field) => escape(record.cells[field.key]?.value ?? '')).join('\t'),
      ),
    ].join('\n');

    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }, [fields, records, selectedIds]);

  const confirmDelete = useCallback(() => {
    if (pendingDelete) {
      onDeleteRows(pendingDelete);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of pendingDelete) next.delete(id);
        return next;
      });
    }
    setPendingDelete(null);
  }, [onDeleteRows, pendingDelete]);

  const selectedCount = selectedIds.size;

  return (
    <div className="rsu-review">
      <div className="rsu-review-main">
        {settings.helpText && (
          <div className="rsu-help" style={{ margin: 14, marginBottom: 0 }}>
            {settings.helpText}
          </div>
        )}

        <div className="rsu-toolbar">
          <input
            className="rsu-search"
            type="search"
            placeholder="Search rows"
            aria-label="Search rows"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />

          <div className="rsu-filter-group" role="group" aria-label="Filter rows">
            <button
              type="button"
              className={`rsu-filter${filter === 'all' && !columnFilter ? ' rsu-filter--active' : ''}`}
              aria-pressed={filter === 'all' && !columnFilter}
              onClick={() => {
                setFilter('all');
                setColumnFilter(null);
              }}
            >
              All
              <span className="rsu-filter-count">{records.length.toLocaleString()}</span>
            </button>
            <button
              type="button"
              className={`rsu-filter${filter === 'errors' ? ' rsu-filter--active' : ''}`}
              aria-pressed={filter === 'errors'}
              disabled={errorRows === 0}
              onClick={() => setFilter('errors')}
            >
              Errors
              <span className="rsu-filter-count">{errorRows.toLocaleString()}</span>
            </button>
          </div>

          {columnFilter && (
            <button
              type="button"
              className="rsu-chip-filter"
              onClick={() => setColumnFilter(null)}
              title="Clear the column filter"
            >
              {fields.find((field) => field.key === columnFilter)?.label ?? columnFilter} errors
              <span aria-hidden="true">×</span>
            </button>
          )}

          {allowAddingRows && (
            <Button variant="tertiary" onClick={onAddRow}>
              <PlusIcon size={14} />
              Add row
            </Button>
          )}

          <div className="rsu-toolbar-spacer" />

          {selectedCount > 0 ? (
            <div className="rsu-selection-actions">
              <span className="rsu-selection-count">
                {selectedCount.toLocaleString()} selected
              </span>
              <Button variant="tertiary" onClick={copySelected}>
                <CopyIcon size={14} />
                {copied ? 'Copied' : 'Copy'}
              </Button>
              {allowRemovingRows && (
                <Button
                  variant="tertiary"
                  className="rsu-btn--danger-ghost"
                  onClick={() => setPendingDelete([...selectedIds])}
                >
                  <TrashIcon size={14} />
                  Delete
                </Button>
              )}
              <Button variant="tertiary" onClick={() => setSelectedIds(new Set())}>
                Clear
              </Button>
            </div>
          ) : (
            <div className="rsu-counts">
              {errorRows > 0 && (
                <span>
                  <span className="rsu-count-dot rsu-count-dot--error" />
                  {errorRows.toLocaleString()} with errors
                </span>
              )}
              {warningRows > 0 && (
                <span>
                  <span className="rsu-count-dot rsu-count-dot--warning" />
                  {warningRows.toLocaleString()} with warnings
                </span>
              )}
            </div>
          )}
        </div>

        <DataGrid
          records={visible}
          fields={fields}
          dataVersion={dataVersion}
          onEdit={onEdit}
          onRequestDelete={setPendingDelete}
          onAppendRow={allowAddingRows ? onAddRow : undefined}
          allowRemovingRows={allowRemovingRows}
          showSourceRowNumbers={!manualEntry}
          highlightAutoFixes={settings.highlightAutoFixes ?? false}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          columnErrorCounts={columnErrorCounts}
          columnFilter={columnFilter}
          onColumnFilterChange={setColumnFilter}
          focusTarget={focusTarget}
          emptyMessage={
            columnFilter
              ? 'No rows have errors in that column.'
              : filter === 'errors'
                ? 'No rows have errors.'
                : search
                  ? 'No rows match your search.'
                  : 'No rows to review.'
          }
        />
      </div>

      {settings.enableNavigatingErrors && !navigatorOpen && (
        <aside className="rsu-navigator rsu-navigator--collapsed" aria-label="Problems">
          <button
            type="button"
            className="rsu-navigator-reopen"
            aria-expanded="false"
            title="Show problems"
            onClick={() => setNavigatorOpen(true)}
          >
            <ChevronLeftIcon size={15} />
            <span className="rsu-navigator-reopen-label">
              {problems.length === 0
                ? 'No problems'
                : `${problems.length} problem${problems.length === 1 ? '' : 's'}`}
            </span>
          </button>
        </aside>
      )}

      {settings.enableNavigatingErrors && navigatorOpen && (
        <aside className="rsu-navigator" aria-label="Problems">
          <div className="rsu-navigator-head">
            <span>
              {problems.length === 0
                ? 'No problems'
                : `${problems.length} problem${problems.length === 1 ? '' : 's'}`}
            </span>
            <button
              type="button"
              className="rsu-navigator-collapse"
              aria-expanded="true"
              aria-label="Hide problems"
              title="Hide problems"
              onClick={() => setNavigatorOpen(false)}
            >
              <ChevronRightIcon size={15} />
            </button>
          </div>

          <div className="rsu-navigator-list">
            {problems.length === 0 ? (
              <div className="rsu-navigator-empty">Everything checks out.</div>
            ) : (
              problems.map((problem, index) => (
                <button
                  key={`${problem.recordId}-${problem.fieldKey}-${index}`}
                  type="button"
                  className={`rsu-navigator-item rsu-navigator-item--${problem.level}`}
                  onClick={() => {
                    // Clear anything that could be hiding the target row.
                    setColumnFilter(null);
                    if (filter === 'errors' && problem.level === 'warning') setFilter('all');
                    setSearch('');
                    setFocusTarget({ recordId: problem.recordId, fieldKey: problem.fieldKey });
                  }}
                >
                  <div className="rsu-navigator-item-where">
                    Row {problem.rowNumber} · {problem.fieldLabel}
                  </div>
                  <div className="rsu-navigator-item-message">{problem.message}</div>
                </button>
              ))
            )}
          </div>
        </aside>
      )}

      {pendingDelete && (
        <ConfirmDialog
          destructive
          title={
            pendingDelete.length === 1
              ? 'Delete this row?'
              : `Delete ${pendingDelete.length.toLocaleString()} rows?`
          }
          body="Deleted rows are not included in the import. This cannot be undone."
          confirmLabel={pendingDelete.length === 1 ? 'Delete row' : 'Delete rows'}
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
