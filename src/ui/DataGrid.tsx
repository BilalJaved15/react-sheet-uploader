/**
 * The review grid.
 *
 * Windowed rather than fully rendered: imports of 50k rows are ordinary, and
 * only the ~20 rows in view are mounted at a time. Row height and column width
 * are fixed constants so a row's position is arithmetic rather than measurement.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { NormalizedField } from '../core/fieldTypes';
import { cellMessages, cellSeverity, type InternalRecord } from '../core/model';
import type { InfoMessage } from '../types';
import { ChevronDownIcon, TrashIcon } from './components/Icons';
import { SelectPopover } from './components/SelectPopover';

export const ROW_HEIGHT = 34;
export const COL_WIDTH = 190;
export const GUTTER_WIDTH = 76;
const HEADER_HEIGHT = 46;
const OVERSCAN = 6;

export interface CellAddress {
  recordId: string;
  fieldKey: string;
}

export interface CellEdit {
  recordId: string;
  fieldKey: string;
  value: string;
}

interface DataGridProps {
  records: InternalRecord[];
  fields: NormalizedField[];
  /** Bumped whenever records mutate in place, to force a re-render. */
  dataVersion: number;
  onEdit: (edits: CellEdit[]) => void;
  /** Asks the parent to confirm and then delete. */
  onRequestDelete: (recordIds: string[]) => void;
  /** Appends a blank row, returning its id. Enables Enter-to-grow. */
  onAppendRow?: () => string | undefined;
  allowRemovingRows: boolean;
  showSourceRowNumbers: boolean;
  highlightAutoFixes: boolean;

  selectedIds: ReadonlySet<string>;
  onSelectionChange: (ids: Set<string>) => void;

  /** Error count per field key, used by the column filter chips. */
  columnErrorCounts: ReadonlyMap<string, number>;
  columnFilter: string | null;
  onColumnFilterChange: (fieldKey: string | null) => void;

  /** Scrolls this cell into view and selects it when it changes. */
  focusTarget?: CellAddress | null;
  emptyMessage?: string;
}

interface TooltipState {
  x: number;
  y: number;
  messages: InfoMessage[];
}

/** Splits pasted clipboard text into a grid. Excel and Sheets both emit TSV. */
function parseClipboardGrid(text: string): string[][] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const trimmed = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;
  if (trimmed === '') return [];
  const delimiter = trimmed.includes('\t') ? '\t' : ',';
  return trimmed.split('\n').map((line) => line.split(delimiter));
}

/** Quotes a value for the TSV placed on the clipboard. */
function tsvEscape(value: string): string {
  return /[\t\n"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function DataGrid({
  records,
  fields,
  dataVersion,
  onEdit,
  onRequestDelete,
  onAppendRow,
  allowRemovingRows,
  showSourceRowNumbers,
  highlightAutoFixes,
  selectedIds,
  onSelectionChange,
  columnErrorCounts,
  columnFilter,
  onColumnFilterChange,
  focusTarget,
  emptyMessage = 'No rows to review.',
}: DataGridProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(480);

  const [active, setActive] = useState<CellAddress | null>(null);
  const [editing, setEditing] = useState<CellAddress | null>(null);
  const [draft, setDraft] = useState('');
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  /** The select/multi-select cell whose dropdown is open, and its anchor rect. */
  const [picker, setPicker] = useState<{ address: CellAddress; rect: DOMRect } | null>(null);
  /** Anchor for shift-click range selection. */
  const anchorIndex = useRef<number | null>(null);

  // A tooltip captures its messages on hover. Once the data changes those
  // messages may no longer apply, so drop it rather than show a stale error for
  // a cell the user has just fixed.
  useEffect(() => setTooltip(null), [dataVersion]);

  const visibleFields = useMemo(() => fields.filter((field) => !field.hidden), [fields]);

  const recordIndexById = useMemo(() => {
    const map = new Map<string, number>();
    records.forEach((record, index) => map.set(record.id, index));
    return map;
  }, [records]);

  const fieldByKey = useMemo(
    () => new Map(visibleFields.map((field) => [field.key, field])),
    [visibleFields],
  );

  /* ---------------------------------------------------------------------- */
  /* Virtualization                                                          */
  /* ---------------------------------------------------------------------- */

  useLayoutEffect(() => {
    const element = scrollerRef.current;
    if (!element) return;

    const measure = () => setViewportHeight(element.clientHeight);
    measure();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
    setTooltip(null);
  }, []);

  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(
    records.length,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN,
  );
  const windowed = records.slice(startIndex, endIndex);

  const scrollCellIntoView = useCallback(
    (address: CellAddress) => {
      const element = scrollerRef.current;
      const rowIndex = recordIndexById.get(address.recordId);
      if (!element || rowIndex === undefined) return;

      const top = rowIndex * ROW_HEIGHT;
      const bottom = top + ROW_HEIGHT;

      // The sticky header covers the top of the scroll box.
      if (top < element.scrollTop + HEADER_HEIGHT) {
        element.scrollTop = Math.max(0, top - HEADER_HEIGHT);
      } else if (bottom > element.scrollTop + element.clientHeight) {
        element.scrollTop = bottom - element.clientHeight;
      }

      const columnIndex = visibleFields.findIndex((field) => field.key === address.fieldKey);
      if (columnIndex >= 0) {
        const left = GUTTER_WIDTH + columnIndex * COL_WIDTH;
        if (left < element.scrollLeft + GUTTER_WIDTH) {
          element.scrollLeft = Math.max(0, left - GUTTER_WIDTH);
        } else if (left + COL_WIDTH > element.scrollLeft + element.clientWidth) {
          element.scrollLeft = left + COL_WIDTH - element.clientWidth;
        }
      }
    },
    [recordIndexById, visibleFields],
  );

  useEffect(() => {
    if (!focusTarget) return;
    setActive(focusTarget);
    setEditing(null);
    scrollCellIntoView(focusTarget);
    // Jumping here from the problems panel should hand the keyboard over too,
    // otherwise the arrows would still be driving the panel behind us.
    scrollerRef.current?.focus({ preventScroll: true });
  }, [focusTarget, scrollCellIntoView]);

  /* ---------------------------------------------------------------------- */
  /* Selection                                                               */
  /* ---------------------------------------------------------------------- */

  const toggleRow = useCallback(
    (recordId: string, index: number, shiftKey: boolean) => {
      const next = new Set(selectedIds);

      if (shiftKey && anchorIndex.current !== null) {
        const from = Math.min(anchorIndex.current, index);
        const to = Math.max(anchorIndex.current, index);
        for (let i = from; i <= to; i += 1) {
          const record = records[i];
          if (record) next.add(record.id);
        }
      } else {
        if (next.has(recordId)) next.delete(recordId);
        else next.add(recordId);
        anchorIndex.current = index;
      }

      onSelectionChange(next);
    },
    [onSelectionChange, records, selectedIds],
  );

  /**
   * Clicking the row number selects that row on its own — the spreadsheet
   * convention. Shift extends from the anchor, and Cmd/Ctrl adds to the
   * selection without clearing it.
   */
  const selectRow = useCallback(
    (recordId: string, index: number, event: React.MouseEvent) => {
      // Copy and paste are keyboard-driven, so the grid has to hold focus.
      scrollerRef.current?.focus();

      if (event.shiftKey && anchorIndex.current !== null) {
        const next = new Set(selectedIds);
        const from = Math.min(anchorIndex.current, index);
        const to = Math.max(anchorIndex.current, index);
        for (let i = from; i <= to; i += 1) {
          const record = records[i];
          if (record) next.add(record.id);
        }
        onSelectionChange(next);
        return;
      }

      if (event.metaKey || event.ctrlKey) {
        const next = new Set(selectedIds);
        if (next.has(recordId)) next.delete(recordId);
        else next.add(recordId);
        anchorIndex.current = index;
        onSelectionChange(next);
        return;
      }

      const onlyThisRow = selectedIds.size === 1 && selectedIds.has(recordId);
      anchorIndex.current = index;
      onSelectionChange(onlyThisRow ? new Set() : new Set([recordId]));

      // Anchor the active cell in the row so a paste knows where to land.
      const firstField = visibleFields[0];
      if (firstField && !onlyThisRow) {
        setActive({ recordId, fieldKey: firstField.key });
      }
    },
    [onSelectionChange, records, selectedIds, visibleFields],
  );

  const allSelected = records.length > 0 && records.every((record) => selectedIds.has(record.id));

  const toggleAll = useCallback(() => {
    onSelectionChange(allSelected ? new Set() : new Set(records.map((record) => record.id)));
    anchorIndex.current = null;
  }, [allSelected, onSelectionChange, records]);

  /* ---------------------------------------------------------------------- */
  /* Clipboard                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Copies whole rows when any are selected, otherwise the active cell.
   *
   * Rows are copied without a header line so that copy-then-paste inside the
   * grid round-trips: a header row would be pasted in as data.
   */
  const copySelection = useCallback(() => {
    if (selectedIds.size > 0) {
      const text = records
        .filter((record) => selectedIds.has(record.id))
        .map((record) =>
          visibleFields.map((field) => tsvEscape(record.cells[field.key]?.value ?? '')).join('\t'),
        )
        .join('\n');
      void navigator.clipboard?.writeText(text);
      return;
    }

    if (!active) return;
    const record = records[recordIndexById.get(active.recordId) ?? -1];
    void navigator.clipboard?.writeText(record?.cells[active.fieldKey]?.value ?? '');
  }, [active, recordIndexById, records, selectedIds, visibleFields]);

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      if (editing) return;

      const text = event.clipboardData.getData('text/plain');
      const grid = parseClipboardGrid(text);
      if (grid.length === 0) return;

      event.preventDefault();

      // A clipboard as wide as the table is a whole-row copy, so it lands at
      // the start of the row rather than under the cursor.
      const isFullRow = (grid[0]?.length ?? 0) === visibleFields.length;

      // Prefer the selection's first row as the target, then the active cell.
      const selectedRowIndexes = records
        .map((record, index) => (selectedIds.has(record.id) ? index : -1))
        .filter((index) => index >= 0);

      const startRow = isFullRow && selectedRowIndexes.length > 0
        ? (selectedRowIndexes[0] as number)
        : active
          ? recordIndexById.get(active.recordId)
          : undefined;

      if (startRow === undefined) return;

      const startColumn = isFullRow
        ? 0
        : active
          ? visibleFields.findIndex((field) => field.key === active.fieldKey)
          : 0;
      if (startColumn < 0) return;

      const edits: CellEdit[] = [];
      grid.forEach((row, rowOffset) => {
        const record = records[startRow + rowOffset];
        if (!record) return;
        row.forEach((value, columnOffset) => {
          const field = visibleFields[startColumn + columnOffset];
          if (!field || field.readOnly) return;
          edits.push({ recordId: record.id, fieldKey: field.key, value });
        });
      });

      onEdit(edits);
    },
    [active, editing, onEdit, recordIndexById, records, selectedIds, visibleFields],
  );

  /* ---------------------------------------------------------------------- */
  /* Editing                                                                 */
  /* ---------------------------------------------------------------------- */

  /** True when the field is edited through the dropdown rather than a text box. */
  const usesPicker = useCallback((field: NormalizedField) => {
    return (
      (field.typeName === 'select' || field.typeName === 'multi-select') &&
      field.selectOptions.length > 0
    );
  }, []);

  const openPicker = useCallback((address: CellAddress, element: HTMLElement) => {
    setActive(address);
    setEditing(null);
    setPicker({ address, rect: element.getBoundingClientRect() });
  }, []);

  const beginEdit = useCallback(
    (address: CellAddress, initialValue?: string) => {
      const field = fieldByKey.get(address.fieldKey);
      if (!field || field.readOnly) return;

      const record = records[recordIndexById.get(address.recordId) ?? -1];
      const cell = record?.cells[address.fieldKey];
      if (!cell) return;

      // Checkbox has no text form worth editing; clicking flips it instead.
      if (field.typeName === 'checkbox') {
        onEdit([
          {
            recordId: address.recordId,
            fieldKey: address.fieldKey,
            value: cell.value === 'true' ? 'false' : 'true',
          },
        ]);
        return;
      }

      if (usesPicker(field)) {
        const element = document.querySelector<HTMLElement>(
          `[data-rsu-cell="${address.recordId}:${address.fieldKey}"]`,
        );
        if (element) openPicker(address, element);
        return;
      }

      setActive(address);
      setEditing(address);
      setDraft(initialValue ?? cell.value);
    },
    [fieldByKey, onEdit, openPicker, recordIndexById, records, usesPicker],
  );

  /**
   * Returns focus to the grid.
   *
   * Whenever an editor or dropdown unmounts, focus would otherwise fall back to
   * the document body and the arrow keys would scroll the grid instead of
   * moving between cells.
   */
  const refocusGrid = useCallback(() => {
    scrollerRef.current?.focus({ preventScroll: true });
  }, []);

  const commitEdit = useCallback(() => {
    if (!editing) return;
    const record = records[recordIndexById.get(editing.recordId) ?? -1];
    const cell = record?.cells[editing.fieldKey];
    if (cell && draft !== cell.value) {
      onEdit([{ recordId: editing.recordId, fieldKey: editing.fieldKey, value: draft }]);
    }
    setEditing(null);
    refocusGrid();
  }, [draft, editing, onEdit, recordIndexById, records, refocusGrid]);

  const cancelEdit = useCallback(() => {
    setEditing(null);
    refocusGrid();
  }, [refocusGrid]);

  /**
   * The active cell, falling back to the first one.
   *
   * Keyboard navigation must never be a no-op just because nothing has been
   * clicked yet: without an anchor the browser would scroll the grid on the
   * arrow keys instead of moving the selection.
   */
  const resolveActive = useCallback((): CellAddress | null => {
    if (active) return active;
    const record = records[0];
    const field = visibleFields[0];
    if (!record || !field) return null;
    return { recordId: record.id, fieldKey: field.key };
  }, [active, records, visibleFields]);

  const focusCell = useCallback(
    (next: CellAddress) => {
      setActive(next);
      scrollCellIntoView(next);
    },
    [scrollCellIntoView],
  );

  /** Appends a row and moves onto it. Returns false when rows cannot be added. */
  const appendAndFocus = useCallback(
    (fieldKey: string): boolean => {
      if (!onAppendRow) return false;
      const newId = onAppendRow();
      if (!newId) return false;

      const next = { recordId: newId, fieldKey };
      setActive(next);
      // The row does not exist in the DOM until the parent re-renders.
      requestAnimationFrame(() => scrollCellIntoView(next));
      return true;
    },
    [onAppendRow, scrollCellIntoView],
  );

  /**
   * Moves the active cell by a row/column delta, clamped at the edges.
   *
   * Stepping down off the last row appends a new one, so a manual entry grows
   * as the user types rather than starting as a wall of blank rows.
   */
  const moveActive = useCallback(
    (from: CellAddress, rowDelta: number, columnDelta: number) => {
      const rowIndex = recordIndexById.get(from.recordId);
      const columnIndex = visibleFields.findIndex((field) => field.key === from.fieldKey);
      if (rowIndex === undefined || columnIndex < 0) return;

      if (rowDelta > 0 && rowIndex === records.length - 1) {
        if (appendAndFocus(from.fieldKey)) return;
      }

      const nextRow = Math.min(records.length - 1, Math.max(0, rowIndex + rowDelta));
      const nextColumn = Math.min(visibleFields.length - 1, Math.max(0, columnIndex + columnDelta));

      const record = records[nextRow];
      const field = visibleFields[nextColumn];
      if (!record || !field) return;

      focusCell({ recordId: record.id, fieldKey: field.key });
    },
    [appendAndFocus, focusCell, recordIndexById, records, visibleFields],
  );

  /**
   * Moves one cell forwards or backwards in reading order, wrapping rows.
   *
   * This is what Tab does in a spreadsheet: at the end of a row it continues on
   * the next one rather than stopping dead at the last column.
   */
  const stepCell = useCallback(
    (from: CellAddress, direction: 1 | -1) => {
      const rowIndex = recordIndexById.get(from.recordId);
      const columnIndex = visibleFields.findIndex((field) => field.key === from.fieldKey);
      if (rowIndex === undefined || columnIndex < 0) return;

      const width = visibleFields.length;
      if (width === 0) return;

      const target = rowIndex * width + columnIndex + direction;
      if (target < 0) return;

      // Tabbing past the very last cell continues onto a fresh row.
      if (target >= records.length * width) {
        appendAndFocus(visibleFields[0]?.key ?? from.fieldKey);
        return;
      }

      const record = records[Math.floor(target / width)];
      const field = visibleFields[target % width];
      if (!record || !field) return;

      focusCell({ recordId: record.id, fieldKey: field.key });
    },
    [appendAndFocus, focusCell, recordIndexById, records, visibleFields],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const modifier = event.metaKey || event.ctrlKey;

      if (modifier && event.key.toLowerCase() === 'c' && !editing) {
        event.preventDefault();
        copySelection();
        return;
      }
      if (modifier && event.key.toLowerCase() === 'a' && !editing) {
        event.preventDefault();
        onSelectionChange(new Set(records.map((record) => record.id)));
        return;
      }

      if (editing) {
        if (event.key === 'Escape') {
          event.preventDefault();
          cancelEdit();
        } else if (event.key === 'Enter') {
          event.preventDefault();
          commitEdit();
          moveActive(editing, 1, 0);
        } else if (event.key === 'Tab') {
          event.preventDefault();
          commitEdit();
          stepCell(editing, event.shiftKey ? -1 : 1);
        }
        return;
      }

      // Falls back to the first cell, so the keys work before anything is
      // clicked rather than letting the browser scroll the grid instead.
      const current = resolveActive();
      if (!current) return;

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          moveActive(current, 1, 0);
          break;
        case 'ArrowUp':
          event.preventDefault();
          moveActive(current, -1, 0);
          break;
        case 'ArrowLeft':
          event.preventDefault();
          moveActive(current, 0, -1);
          break;
        case 'ArrowRight':
          event.preventDefault();
          moveActive(current, 0, 1);
          break;
        case 'Home':
          event.preventDefault();
          moveActive(current, 0, -visibleFields.length);
          break;
        case 'End':
          event.preventDefault();
          moveActive(current, 0, visibleFields.length);
          break;
        case 'Tab':
          event.preventDefault();
          stepCell(current, event.shiftKey ? -1 : 1);
          break;
        case ' ': {
          // Space toggles the row's checkbox, as it does in most data grids.
          event.preventDefault();
          const index = recordIndexById.get(current.recordId);
          if (index !== undefined) toggleRow(current.recordId, index, event.shiftKey);
          break;
        }
        case 'Enter':
        case 'F2':
          event.preventDefault();
          beginEdit(current);
          break;
        case 'Backspace':
        case 'Delete': {
          event.preventDefault();
          const field = fieldByKey.get(current.fieldKey);
          if (field && !field.readOnly) {
            onEdit([{ recordId: current.recordId, fieldKey: current.fieldKey, value: '' }]);
          }
          break;
        }
        default:
          // A printable character starts editing and becomes the first keystroke.
          if (event.key.length === 1 && !modifier && !event.altKey) {
            event.preventDefault();
            beginEdit(current, event.key);
          }
      }
    },
    [
      beginEdit,
      cancelEdit,
      commitEdit,
      copySelection,
      editing,
      fieldByKey,
      resolveActive,
      stepCell,
      visibleFields,
      moveActive,
      onEdit,
      onSelectionChange,
      recordIndexById,
      records,
      toggleRow,
    ],
  );

  const showTooltip = useCallback((event: React.MouseEvent, messages: InfoMessage[]) => {
    if (messages.length === 0) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setTooltip({ x: rect.left, y: rect.bottom + 6, messages });
  }, []);

  const gridWidth = GUTTER_WIDTH + visibleFields.length * COL_WIDTH;

  if (records.length === 0) {
    return (
      <div className="rsu-grid">
        <div className="rsu-grid-empty">
          <strong>{emptyMessage}</strong>
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        ref={scrollerRef}
        className="rsu-grid"
        role="grid"
        aria-rowcount={records.length + 1}
        aria-colcount={visibleFields.length}
        aria-multiselectable="true"
        tabIndex={0}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onFocus={(event) => {
          // Tabbing in from the toolbar should land on a cell, not leave the
          // grid focused with nothing selected. Ignore focus bubbling up from
          // an editor or checkbox inside the grid.
          if (event.target !== event.currentTarget || active) return;
          const first = resolveActive();
          if (first) setActive(first);
        }}
        onMouseLeave={() => setTooltip(null)}
      >
        <div className="rsu-grid-inner" style={{ width: gridWidth }}>
          <div className="rsu-grid-header" role="row">
            <div
              className="rsu-grid-headcell rsu-grid-headcell--gutter"
              style={{ width: GUTTER_WIDTH, height: HEADER_HEIGHT }}
              role="columnheader"
            >
              <input
                type="checkbox"
                className="rsu-checkbox"
                checked={allSelected}
                aria-label={allSelected ? 'Deselect all rows' : 'Select all rows'}
                onChange={toggleAll}
              />
            </div>

            {visibleFields.map((field) => {
              const errors = columnErrorCounts.get(field.key) ?? 0;
              const filtered = columnFilter === field.key;

              return (
                <div
                  key={field.key}
                  className={`rsu-grid-headcell${
                    active?.fieldKey === field.key ? ' rsu-grid-headcell--active' : ''
                  }`}
                  style={{ width: COL_WIDTH, height: HEADER_HEIGHT }}
                  role="columnheader"
                  title={field.description ?? field.label}
                >
                  <div className="rsu-grid-head-top">
                    <span className="rsu-grid-head-label">{field.label}</span>
                    {errors > 0 && (
                      <button
                        type="button"
                        className={`rsu-col-filter${filtered ? ' rsu-col-filter--active' : ''}`}
                        aria-pressed={filtered}
                        title={
                          filtered
                            ? `Showing only rows with errors in ${field.label}. Click to clear.`
                            : `Show only the ${errors} row${errors === 1 ? '' : 's'} with errors in ${field.label}`
                        }
                        onClick={() => onColumnFilterChange(filtered ? null : field.key)}
                      >
                        {errors}
                      </button>
                    )}
                  </div>
                  <span className="rsu-grid-head-type">
                    {field.typeName === 'string' ? '' : field.typeName}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="rsu-grid-rows" style={{ height: records.length * ROW_HEIGHT }}>
            {windowed.map((record, offset) => {
              const rowIndex = startIndex + offset;
              const isActiveRow = active?.recordId === record.id;
              const isSelected = selectedIds.has(record.id);

              return (
                <div
                  key={record.id}
                  className={`rsu-grid-row${isSelected ? ' rsu-grid-row--selected' : ''}${
                    isActiveRow ? ' rsu-grid-row--active' : ''
                  }`}
                  style={{ top: rowIndex * ROW_HEIGHT, height: ROW_HEIGHT }}
                  role="row"
                  aria-rowindex={rowIndex + 2}
                  aria-selected={isSelected}
                >
                  <div className="rsu-grid-gutter" style={{ width: GUTTER_WIDTH }}>
                    <input
                      type="checkbox"
                      className="rsu-checkbox"
                      checked={isSelected}
                      aria-label={`Select row ${rowIndex + 1}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleRow(record.id, rowIndex, event.shiftKey);
                      }}
                      onChange={() => {
                        /* handled in onClick, which carries the shift key */
                      }}
                    />
                    <button
                      type="button"
                      className="rsu-grid-rownum"
                      title="Select this row"
                      aria-label={`Select row ${rowIndex + 1}`}
                      onClick={(event) => selectRow(record.id, rowIndex, event)}
                    >
                      {showSourceRowNumbers ? (record.sourceRow ?? '–') : rowIndex + 1}
                    </button>
                    {allowRemovingRows && (
                      <button
                        type="button"
                        className="rsu-grid-delete"
                        aria-label={`Delete row ${rowIndex + 1}`}
                        onClick={() => onRequestDelete([record.id])}
                      >
                        <TrashIcon size={13} />
                      </button>
                    )}
                  </div>

                  {visibleFields.map((field) => {
                    const cell = record.cells[field.key];
                    if (!cell) return null;

                    const severity = cellSeverity(cell);
                    const messages = cellMessages(cell);
                    const isActive = isActiveRow && active?.fieldKey === field.key;
                    const isEditing =
                      editing?.recordId === record.id && editing.fieldKey === field.key;

                    const isPicker = usesPicker(field) && !field.readOnly;

                    const classes = [
                      'rsu-grid-cell',
                      severity ? `rsu-grid-cell--${severity}` : '',
                      isActive ? 'rsu-grid-cell--active' : '',
                      field.readOnly ? 'rsu-grid-cell--readonly' : '',
                      isPicker ? 'rsu-grid-cell--picker' : '',
                      highlightAutoFixes && cell.autofixed ? 'rsu-grid-cell--autofixed' : '',
                    ]
                      .filter(Boolean)
                      .join(' ');

                    const address = { recordId: record.id, fieldKey: field.key };

                    return (
                      <div
                        key={field.key}
                        className={classes}
                        style={{ width: COL_WIDTH, height: ROW_HEIGHT }}
                        role="gridcell"
                        aria-invalid={severity === 'error'}
                        data-rsu-cell={`${record.id}:${field.key}`}
                        onMouseEnter={(event) => showTooltip(event, messages)}
                        onMouseLeave={() => setTooltip(null)}
                        onMouseDown={() => {
                          if (isEditing) return;
                          // Without this the keyboard handler never fires: the
                          // cell is not focusable, so focus would stay on
                          // whatever was clicked last (a toolbar button, the
                          // body) and the arrow keys would scroll the grid.
                          scrollerRef.current?.focus({ preventScroll: true });
                          setActive(address);
                          if (editing) commitEdit();
                        }}
                        onClick={(event) => {
                          // Dropdowns open on a single click; text cells keep
                          // the spreadsheet convention of select-then-edit.
                          if (isPicker) openPicker(address, event.currentTarget);
                        }}
                        onDoubleClick={() => beginEdit(address)}
                      >
                        {isEditing ? (
                          <CellEditor
                            field={field}
                            value={draft}
                            onChange={setDraft}
                            onCommit={commitEdit}
                          />
                        ) : (
                          <>
                            <span className="rsu-grid-cell-text">{cell.value}</span>
                            {isPicker && (
                              <ChevronDownIcon size={13} className="rsu-grid-cell-caret" />
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {picker && (() => {
        const field = fieldByKey.get(picker.address.fieldKey);
        const record = records[recordIndexById.get(picker.address.recordId) ?? -1];
        const cell = record?.cells[picker.address.fieldKey];
        if (!field || !cell) return null;

        const multiple = field.typeName === 'multi-select';
        const delimiter = multiple ? (field.typeOptions.delimiter ?? ',') : ',';
        const options = cell.selectOptions ?? field.selectOptions;

        const chosen =
          cell.value.trim() === ''
            ? []
            : multiple
              ? cell.value.split(delimiter).map((part) => part.trim()).filter(Boolean)
              : [cell.value];

        return (
          <SelectPopover
            options={options}
            selected={chosen}
            multiple={multiple}
            anchor={picker.rect}
            allowCustom={field.typeOptions.allowCustom ?? false}
            onClose={() => {
              setPicker(null);
              refocusGrid();
            }}
            onChange={(labels) => {
              onEdit([
                {
                  recordId: picker.address.recordId,
                  fieldKey: picker.address.fieldKey,
                  value: labels.join(multiple ? `${delimiter} ` : ''),
                },
              ]);
            }}
          />
        );
      })()}

      {tooltip && (
        <div className="rsu-tooltip" style={{ left: tooltip.x, top: tooltip.y }} role="tooltip">
          {tooltip.messages.map((message, index) => (
            <div key={index} className="rsu-tooltip-item">
              <span className={`rsu-tooltip-level rsu-tooltip-level--${message.level ?? 'error'}`}>
                {(message.level ?? 'error') === 'error'
                  ? 'Error'
                  : message.level === 'warning'
                    ? 'Warning'
                    : 'Info'}
              </span>{' '}
              {message.message}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

interface CellEditorProps {
  field: NormalizedField;
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
}

/**
 * The text editor for a cell. Select-like fields never reach here — they are
 * edited through `SelectPopover`, which opens on a single click.
 */
function CellEditor({ field, value, onChange, onCommit }: CellEditorProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <input
      ref={inputRef}
      className="rsu-grid-editor"
      // A number field still takes text: the coercion layer accepts "$1,234.56",
      // which a native number input would refuse to hold.
      inputMode={field.typeName === 'number' ? 'decimal' : undefined}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onCommit}
    />
  );
}
