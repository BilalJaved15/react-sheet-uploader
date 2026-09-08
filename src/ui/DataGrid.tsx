/**
 * The review grid.
 *
 * Windowed rather than fully rendered: imports of 50k rows are ordinary, and
 * only the ~20 rows in view are mounted at a time. Row height and column width
 * are fixed constants so a row's position is arithmetic rather than measurement.
 */

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
/** How many edit batches Cmd+Z can walk back through. */
const HISTORY_LIMIT = 200;

/** Row and column step for each arrow key. */
const ARROW_DELTAS: Record<string, readonly [number, number] | undefined> = {
  ArrowDown: [1, 0],
  ArrowUp: [-1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

export interface CellAddress {
  recordId: string;
  fieldKey: string;
}

/** A block of cells, as inclusive row and column index bounds. */
interface CellRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
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

/**
 * Splits pasted clipboard text into a grid. Excel and Sheets both emit TSV,
 * quoting any field that holds a delimiter, a quote or a line break, so quoted
 * runs are honoured here: splitting on every newline would turn one cell that
 * contains a break into two rows carrying stray quote characters.
 */
function parseClipboardGrid(text: string): string[][] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (normalized === '') return [];
  const delimiter = normalized.includes('\t') ? '\t' : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];

    if (quoted) {
      if (char !== '"') {
        field += char;
      } else if (normalized[i + 1] === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        field += '"';
        i += 1;
      } else {
        quoted = false;
      }
      continue;
    }

    // Only a quote that opens the field quotes it; one in the middle of bare
    // text is data, as in `5" pipe`.
    if (char === '"' && field === '') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  row.push(field);
  rows.push(row);

  // A trailing newline closes the last row rather than opening an empty one.
  const last = rows[rows.length - 1];
  if (rows.length > 1 && last && last.length === 1 && last[0] === '') rows.pop();

  return rows;
}

/**
 * Renders a cell's text on the grid's single line.
 *
 * A line break in the value would otherwise collapse into a space and read as
 * one continuous string, so it is drawn as a return marker instead: rows are a
 * fixed height, so the following line cannot be shown in place.
 */
function renderCellText(value: string): React.ReactNode {
  if (!/[\n\r]/.test(value)) return value;
  return value.split(/\r\n|[\n\r]/).map((line, index) => (
    <Fragment key={index}>
      {index > 0 && <span className="rsu-grid-cell-break">↵</span>}
      {line}
    </Fragment>
  ));
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
  /** True when the open editor was started by typing a character into the cell. */
  const [seeded, setSeeded] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  /** The select/multi-select cell whose dropdown is open, and its anchor rect. */
  const [picker, setPicker] = useState<{ address: CellAddress; rect: DOMRect } | null>(null);
  /**
   * The cell a multi-cell range was started from. Null when the selection is
   * the active cell on its own.
   */
  const [rangeAnchor, setRangeAnchor] = useState<CellAddress | null>(null);
  /** True while the pointer is dragging a block of cells out. */
  const [dragSelecting, setDragSelecting] = useState(false);
  /** Anchor for shift-click row selection. */
  const anchorIndex = useRef<number | null>(null);

  // A drag can end anywhere, including outside the grid or the window, so the
  // release is caught globally rather than on a cell.
  useEffect(() => {
    if (!dragSelecting) return;
    const stop = () => setDragSelecting(false);
    window.addEventListener('mouseup', stop);
    return () => window.removeEventListener('mouseup', stop);
  }, [dragSelecting]);

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

  const columnIndexByKey = useMemo(
    () => new Map(visibleFields.map((field, index) => [field.key, index])),
    [visibleFields],
  );

  const toIndices = useCallback(
    (address: CellAddress): { row: number; column: number } | null => {
      const row = recordIndexById.get(address.recordId);
      const column = columnIndexByKey.get(address.fieldKey);
      if (row === undefined || column === undefined) return null;
      return { row, column };
    },
    [columnIndexByKey, recordIndexById],
  );

  /** The one-cell rect at an address. */
  const rectOf = useCallback(
    (address: CellAddress): CellRect | null => {
      const indices = toIndices(address);
      if (!indices) return null;
      return {
        top: indices.row,
        bottom: indices.row,
        left: indices.column,
        right: indices.column,
      };
    },
    [toIndices],
  );

  /**
   * The selected block of cells.
   *
   * The anchor and the active cell are held as addresses rather than indices so
   * that filtering or deleting rows underneath cannot silently re-point the
   * selection at whatever now sits in those positions.
   */
  const range = useMemo<CellRect | null>(() => {
    if (!active) return null;
    const focus = rectOf(active);
    if (!focus) return null;

    const start = rangeAnchor ? toIndices(rangeAnchor) : null;
    if (!start) return focus;

    return {
      top: Math.min(start.row, focus.top),
      bottom: Math.max(start.row, focus.bottom),
      left: Math.min(start.column, focus.left),
      right: Math.max(start.column, focus.right),
    };
  }, [active, rangeAnchor, rectOf, toIndices]);

  /** True when the selection covers more than the active cell. */
  const rangeSpansCells =
    range !== null && (range.top !== range.bottom || range.left !== range.right);

  /** Every address inside a rect, row-major. */
  const addressesIn = useCallback(
    (rect: CellRect): CellAddress[] => {
      const list: CellAddress[] = [];
      for (let row = rect.top; row <= rect.bottom; row += 1) {
        const record = records[row];
        if (!record) continue;
        for (let column = rect.left; column <= rect.right; column += 1) {
          const field = visibleFields[column];
          if (field) list.push({ recordId: record.id, fieldKey: field.key });
        }
      }
      return list;
    },
    [records, visibleFields],
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
    setRangeAnchor(null);
    setEditing(null);
    scrollCellIntoView(focusTarget);
    // Jumping here from the problems panel should hand the keyboard over too,
    // otherwise the arrows would still be driving the panel behind us.
    scrollerRef.current?.focus({ preventScroll: true });
  }, [focusTarget, scrollCellIntoView]);

  /* ---------------------------------------------------------------------- */
  /* Edit history                                                            */
  /* ---------------------------------------------------------------------- */

  const undoStack = useRef<CellEdit[][]>([]);
  const redoStack = useRef<CellEdit[][]>([]);

  const valueAt = useCallback(
    (recordId: string, fieldKey: string): string | undefined =>
      records[recordIndexById.get(recordId) ?? -1]?.cells[fieldKey]?.value,
    [recordIndexById, records],
  );

  /** Drops edits that cannot land: read-only fields, and rows since deleted. */
  const applicableEdits = useCallback(
    (edits: CellEdit[]): CellEdit[] =>
      edits.filter((edit) => {
        const field = fieldByKey.get(edit.fieldKey);
        if (!field || field.readOnly) return false;
        return valueAt(edit.recordId, edit.fieldKey) !== undefined;
      }),
    [fieldByKey, valueAt],
  );

  /**
   * Applies edits and records how to reverse them.
   *
   * Every edit the grid makes goes through here so Cmd+Z has a single history
   * to walk. Cell values only: adding and removing rows is not undoable, which
   * is what the delete confirmation warns about. A row hook that rewrites a
   * value afterwards is not captured either, so an undo restores what was
   * typed rather than what the pipeline made of it.
   */
  const commitEdits = useCallback(
    (edits: CellEdit[]) => {
      const applicable = applicableEdits(edits).filter(
        (edit) => valueAt(edit.recordId, edit.fieldKey) !== edit.value,
      );
      if (applicable.length === 0) return;

      undoStack.current.push(
        applicable.map((edit) => ({
          recordId: edit.recordId,
          fieldKey: edit.fieldKey,
          value: valueAt(edit.recordId, edit.fieldKey) ?? '',
        })),
      );
      if (undoStack.current.length > HISTORY_LIMIT) undoStack.current.shift();
      redoStack.current = [];

      onEdit(applicable);
    },
    [applicableEdits, onEdit, valueAt],
  );

  /** Replays one history entry, pushing its own inverse onto the other stack. */
  const stepHistory = useCallback(
    (direction: 'undo' | 'redo') => {
      const from = direction === 'undo' ? undoStack : redoStack;
      const to = direction === 'undo' ? redoStack : undoStack;

      const batch = from.current.pop();
      if (!batch) return;

      const applicable = applicableEdits(batch);
      if (applicable.length === 0) return;

      to.current.push(
        applicable.map((edit) => ({
          recordId: edit.recordId,
          fieldKey: edit.fieldKey,
          value: valueAt(edit.recordId, edit.fieldKey) ?? '',
        })),
      );

      onEdit(applicable);

      // Move to what changed: an undo the user cannot see reads as a dead key.
      const first = applicable[0];
      if (first) {
        const target = { recordId: first.recordId, fieldKey: first.fieldKey };
        setRangeAnchor(null);
        setActive(target);
        scrollCellIntoView(target);
      }
    },
    [applicableEdits, onEdit, scrollCellIntoView, valueAt],
  );

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

      // Select the row's cells as well, the way a spreadsheet does. The active
      // cell stays on the first column so a paste knows where to land; the
      // anchor sits on the last, which is what widens the range across the row.
      const firstField = visibleFields[0];
      const lastField = visibleFields[visibleFields.length - 1];
      if (firstField && lastField && !onlyThisRow) {
        setActive({ recordId, fieldKey: firstField.key });
        setRangeAnchor({ recordId, fieldKey: lastField.key });
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

  /** Copies a block of cells as TSV, which is what Excel and Sheets read. */
  const copyRange = useCallback(
    (rect: CellRect) => {
      const lines: string[] = [];
      for (let row = rect.top; row <= rect.bottom; row += 1) {
        const record = records[row];
        if (!record) continue;
        const cells: string[] = [];
        for (let column = rect.left; column <= rect.right; column += 1) {
          const field = visibleFields[column];
          if (field) cells.push(tsvEscape(record.cells[field.key]?.value ?? ''));
        }
        lines.push(cells.join('\t'));
      }
      void navigator.clipboard?.writeText(lines.join('\n'));
    },
    [records, visibleFields],
  );

  /**
   * Copies the selected block of cells, else whole rows when any are checked,
   * else the active cell — most specific selection first.
   *
   * Rows are copied without a header line so that copy-then-paste inside the
   * grid round-trips: a header row would be pasted in as data.
   */
  const copySelection = useCallback(() => {
    if (range && rangeSpansCells) {
      copyRange(range);
      return;
    }

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
  }, [active, copyRange, range, rangeSpansCells, recordIndexById, records, selectedIds, visibleFields]);

  /** Blanks every editable cell in a rect, as Delete does in a spreadsheet. */
  const clearRange = useCallback(
    (rect: CellRect) => {
      commitEdits(addressesIn(rect).map((address) => ({ ...address, value: '' })));
    },
    [addressesIn, commitEdits],
  );

  /** Writes one value across a rect — what pasting a single cell into a block does. */
  const fillRange = useCallback(
    (rect: CellRect, value: string) => {
      commitEdits(addressesIn(rect).map((address) => ({ ...address, value })));
    },
    [addressesIn, commitEdits],
  );

  /**
   * Copies the rect's first row down, or its first column right.
   *
   * Cmd+D and Cmd+R in Sheets. Both keys are taken by the browser, so they are
   * only intercepted when the selection is actually a block to fill — a stray
   * Cmd+R on a single cell still reloads the page.
   */
  const fillFromEdge = useCallback(
    (rect: CellRect, direction: 'down' | 'right') => {
      const edits: CellEdit[] = [];

      if (direction === 'down') {
        for (let column = rect.left; column <= rect.right; column += 1) {
          const field = visibleFields[column];
          if (!field) continue;
          const source = records[rect.top]?.cells[field.key]?.value ?? '';
          for (let row = rect.top + 1; row <= rect.bottom; row += 1) {
            const record = records[row];
            if (record) edits.push({ recordId: record.id, fieldKey: field.key, value: source });
          }
        }
      } else {
        for (let row = rect.top; row <= rect.bottom; row += 1) {
          const record = records[row];
          if (!record) continue;
          const sourceField = visibleFields[rect.left];
          const source = sourceField ? (record.cells[sourceField.key]?.value ?? '') : '';
          for (let column = rect.left + 1; column <= rect.right; column += 1) {
            const field = visibleFields[column];
            if (field) edits.push({ recordId: record.id, fieldKey: field.key, value: source });
          }
        }
      }

      commitEdits(edits);
    },
    [commitEdits, records, visibleFields],
  );

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      if (editing) return;

      const text = event.clipboardData.getData('text/plain');
      const grid = parseClipboardGrid(text);
      if (grid.length === 0) return;

      event.preventDefault();

      // One cell pasted into a block fills the block, as in Excel: it is the
      // fastest way to set a column of rows to the same value.
      if (grid.length === 1 && grid[0]?.length === 1 && range && rangeSpansCells) {
        fillRange(range, grid[0][0] ?? '');
        return;
      }

      // A clipboard as wide as the table is a whole-row copy, so it lands at
      // the start of the row rather than under the cursor.
      const isFullRow = (grid[0]?.length ?? 0) === visibleFields.length;

      // Prefer the selection's first row as the target, then the active cell.
      const selectedRowIndexes = records
        .map((record, index) => (selectedIds.has(record.id) ? index : -1))
        .filter((index) => index >= 0);

      const startRow = isFullRow && selectedRowIndexes.length > 0
        ? (selectedRowIndexes[0] as number)
        : range
          ? range.top
          : undefined;

      if (startRow === undefined) return;

      // A block is pasted from its top-left corner, wherever the drag ended.
      const startColumn = isFullRow ? 0 : (range?.left ?? 0);
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

      commitEdits(edits);
    },
    [commitEdits, editing, fillRange, range, rangeSpansCells, records, selectedIds, visibleFields],
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
    setRangeAnchor(null);
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
        commitEdits([
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

      // Typing into a block edits the one cell under the cursor, so the
      // selection collapses rather than leaving a range highlighted that the
      // keystrokes are not going to.
      setActive(address);
      setRangeAnchor(null);
      setEditing(address);
      setSeeded(initialValue !== undefined);
      setDraft(initialValue ?? cell.value);
    },
    [commitEdits, fieldByKey, openPicker, recordIndexById, records, usesPicker],
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
      commitEdits([{ recordId: editing.recordId, fieldKey: editing.fieldKey, value: draft }]);
    }
    setEditing(null);
    refocusGrid();
  }, [commitEdits, draft, editing, recordIndexById, records, refocusGrid]);

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
      setRangeAnchor(null);
      scrollCellIntoView(next);
    },
    [scrollCellIntoView],
  );

  /**
   * Moves the active cell while keeping the anchor, growing the selection.
   *
   * This is Shift+arrow. Unlike `moveActive` it never appends a row: extending
   * a selection past the last row should stop at the edge, not create data.
   */
  const extendActive = useCallback(
    (from: CellAddress, rowDelta: number, columnDelta: number) => {
      const indices = toIndices(from);
      if (!indices) return;

      const nextRow = Math.min(records.length - 1, Math.max(0, indices.row + rowDelta));
      const nextColumn = Math.min(
        visibleFields.length - 1,
        Math.max(0, indices.column + columnDelta),
      );

      const record = records[nextRow];
      const field = visibleFields[nextColumn];
      if (!record || !field) return;

      const next = { recordId: record.id, fieldKey: field.key };
      setRangeAnchor((previous) => previous ?? from);
      setActive(next);
      scrollCellIntoView(next);
    },
    [records, scrollCellIntoView, toIndices, visibleFields],
  );

  /** Widens the block to reach `target`, keeping whatever anchor is in place. */
  const extendTo = useCallback(
    (target: CellAddress) => {
      setRangeAnchor((previous) => previous ?? active ?? target);
      setActive(target);
    },
    [active],
  );

  /** Selects a whole row's cells, or a whole column's. */
  const selectWholeLine = useCallback(
    (from: CellAddress, axis: 'row' | 'column') => {
      if (axis === 'row') {
        const first = visibleFields[0];
        const last = visibleFields[visibleFields.length - 1];
        if (!first || !last) return;
        setActive({ recordId: from.recordId, fieldKey: first.key });
        setRangeAnchor({ recordId: from.recordId, fieldKey: last.key });
        return;
      }

      const first = records[0];
      const last = records[records.length - 1];
      if (!first || !last) return;
      setActive({ recordId: first.id, fieldKey: from.fieldKey });
      setRangeAnchor({ recordId: last.id, fieldKey: from.fieldKey });
    },
    [records, visibleFields],
  );

  /** Appends a row and moves onto it. Returns false when rows cannot be added. */
  const appendAndFocus = useCallback(
    (fieldKey: string): boolean => {
      if (!onAppendRow) return false;
      const newId = onAppendRow();
      if (!newId) return false;

      const next = { recordId: newId, fieldKey };
      setActive(next);
      setRangeAnchor(null);
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
      const key = event.key;

      // An open editor owns the keyboard apart from the keys that close it —
      // Cmd+Z included, so undo inside a cell undoes the typing, which the
      // browser already does for a textarea.
      if (editing) {
        if (key === 'Escape') {
          event.preventDefault();
          cancelEdit();
        } else if (key === 'Enter') {
          // A modified Enter inserts a line break instead of committing, and
          // `CellEditor` stops that keystroke before it reaches here — so an
          // Enter that arrives is the bare one that closes the cell.
          event.preventDefault();
          commitEdit();
          moveActive(editing, 1, 0);
        } else if (key === 'Tab') {
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

      // Everything below acts on the selected block, which is the active cell
      // alone until a shift or a drag widens it.
      const rect = range ?? rectOf(current);
      if (!rect) return;

      const indices = toIndices(current) ?? { row: 0, column: 0 };
      const toTop = indices.row;
      const toBottom = Math.max(0, records.length - 1 - indices.row);
      const toLeft = indices.column;
      const toRight = Math.max(0, visibleFields.length - 1 - indices.column);

      if (modifier) {
        const lower = key.toLowerCase();

        if (lower === 'c') {
          event.preventDefault();
          copySelection();
          return;
        }
        if (lower === 'x') {
          event.preventDefault();
          copySelection();
          clearRange(rect);
          return;
        }
        if (lower === 'a') {
          event.preventDefault();
          const firstRecord = records[0];
          const lastRecord = records[records.length - 1];
          const firstField = visibleFields[0];
          const lastField = visibleFields[visibleFields.length - 1];
          if (firstRecord && lastRecord && firstField && lastField) {
            setActive({ recordId: firstRecord.id, fieldKey: firstField.key });
            setRangeAnchor({ recordId: lastRecord.id, fieldKey: lastField.key });
          }
          // Check the rows as well: the row checkboxes are what drive the
          // toolbar's copy and delete buttons.
          onSelectionChange(new Set(records.map((record) => record.id)));
          return;
        }
        if (lower === 'z') {
          event.preventDefault();
          stepHistory(event.shiftKey ? 'redo' : 'undo');
          return;
        }
        if (lower === 'y') {
          event.preventDefault();
          stepHistory('redo');
          return;
        }
        // Fill down and fill right, as in Sheets. Both keys belong to the
        // browser, so they are only taken when there is a block to fill: a
        // stray Cmd+R on one cell still reloads the page.
        if (lower === 'd' && rect.bottom > rect.top) {
          event.preventDefault();
          fillFromEdge(rect, 'down');
          return;
        }
        if (lower === 'r' && rect.right > rect.left) {
          event.preventDefault();
          fillFromEdge(rect, 'right');
          return;
        }
        if (key === ' ') {
          event.preventDefault();
          selectWholeLine(current, 'column');
          return;
        }
      }

      // Shift+Space selects the row, the spreadsheet convention, and checks it
      // so the toolbar actions apply to it too.
      if (event.shiftKey && key === ' ') {
        event.preventDefault();
        selectWholeLine(current, 'row');
        const index = recordIndexById.get(current.recordId);
        if (index !== undefined && !selectedIds.has(current.recordId)) {
          toggleRow(current.recordId, index, false);
        }
        return;
      }

      const delta = ARROW_DELTAS[key];
      if (delta) {
        event.preventDefault();
        const [rowStep, columnStep] = delta;
        // Cmd/Ctrl jumps to the far edge. The delta is clamped to that edge
        // rather than being an arbitrarily large number, so jumping to the
        // bottom does not read as "stepped off the last row" and append one.
        const rowDelta =
          modifier && rowStep !== 0 ? (rowStep > 0 ? toBottom : -toTop) : rowStep;
        const columnDelta =
          modifier && columnStep !== 0 ? (columnStep > 0 ? toRight : -toLeft) : columnStep;

        if (event.shiftKey) extendActive(current, rowDelta, columnDelta);
        else moveActive(current, rowDelta, columnDelta);
        return;
      }

      switch (key) {
        case 'PageDown':
        case 'PageUp': {
          event.preventDefault();
          const page = Math.max(1, Math.floor(viewportHeight / ROW_HEIGHT) - 1);
          const rowDelta =
            key === 'PageDown' ? Math.min(page, toBottom) : -Math.min(page, toTop);
          if (event.shiftKey) extendActive(current, rowDelta, 0);
          else moveActive(current, rowDelta, 0);
          break;
        }
        case 'Home':
        case 'End': {
          event.preventDefault();
          const columnDelta = key === 'Home' ? -toLeft : toRight;
          // Cmd/Ctrl takes it to the first or last cell of the whole table.
          const rowDelta = modifier ? (key === 'Home' ? -toTop : toBottom) : 0;
          if (event.shiftKey) extendActive(current, rowDelta, columnDelta);
          else moveActive(current, rowDelta, columnDelta);
          break;
        }
        case 'Tab':
          event.preventDefault();
          stepCell(current, event.shiftKey ? -1 : 1);
          break;
        case ' ': {
          // Space toggles the row's checkbox, as it does in most data grids.
          event.preventDefault();
          const index = recordIndexById.get(current.recordId);
          if (index !== undefined) toggleRow(current.recordId, index, false);
          break;
        }
        case 'Escape':
          event.preventDefault();
          // Give back the most recently built-up selection first: the block,
          // then the checked rows.
          if (rangeSpansCells) setRangeAnchor(null);
          else if (selectedIds.size > 0) onSelectionChange(new Set());
          break;
        case 'Enter':
        case 'F2':
          event.preventDefault();
          beginEdit(current);
          break;
        case 'Backspace':
        case 'Delete':
          event.preventDefault();
          clearRange(rect);
          break;
        default:
          // A printable character starts editing and becomes the first keystroke.
          if (key.length === 1 && !modifier && !event.altKey) {
            event.preventDefault();
            beginEdit(current, key);
          }
      }
    },
    [
      beginEdit,
      cancelEdit,
      clearRange,
      commitEdit,
      copySelection,
      editing,
      extendActive,
      fillFromEdge,
      moveActive,
      onSelectionChange,
      range,
      rangeSpansCells,
      recordIndexById,
      records,
      rectOf,
      resolveActive,
      selectWholeLine,
      selectedIds,
      stepCell,
      stepHistory,
      toIndices,
      toggleRow,
      viewportHeight,
      visibleFields,
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
        className={`rsu-grid${dragSelecting ? ' rsu-grid--dragging' : ''}`}
        role="grid"
        // Tells the modal to leave Escape alone: it has an editor to close or
        // a selection to give back. See `UploaderModal`.
        data-rsu-escape={
          editing || rangeSpansCells || selectedIds.size > 0 ? 'true' : undefined
        }
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

                  {visibleFields.map((field, columnIndex) => {
                    const cell = record.cells[field.key];
                    if (!cell) return null;

                    const inRange =
                      rangeSpansCells &&
                      range !== null &&
                      rowIndex >= range.top &&
                      rowIndex <= range.bottom &&
                      columnIndex >= range.left &&
                      columnIndex <= range.right;

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
                      isEditing ? 'rsu-grid-cell--editing' : '',
                      field.readOnly ? 'rsu-grid-cell--readonly' : '',
                      isPicker ? 'rsu-grid-cell--picker' : '',
                      highlightAutoFixes && cell.autofixed ? 'rsu-grid-cell--autofixed' : '',
                      // The block is drawn as one outlined region, so each cell
                      // carries only the edges that sit on its border.
                      inRange ? 'rsu-grid-cell--range' : '',
                      inRange && rowIndex === range?.top ? 'rsu-grid-cell--range-top' : '',
                      inRange && rowIndex === range?.bottom ? 'rsu-grid-cell--range-bottom' : '',
                      inRange && columnIndex === range?.left ? 'rsu-grid-cell--range-left' : '',
                      inRange && columnIndex === range?.right ? 'rsu-grid-cell--range-right' : '',
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
                        aria-selected={inRange || isActive}
                        aria-invalid={severity === 'error'}
                        data-rsu-cell={`${record.id}:${field.key}`}
                        onMouseEnter={(event) => {
                          // Dragging across cells widens the block. `buttons`
                          // guards a mouseup that landed on another window from
                          // leaving the drag latched on.
                          if (dragSelecting) {
                            if (event.buttons === 1) extendTo(address);
                            return;
                          }
                          showTooltip(event, messages);
                        }}
                        onMouseLeave={() => setTooltip(null)}
                        onMouseDown={(event) => {
                          if (isEditing) return;
                          // Without this the keyboard handler never fires: the
                          // cell is not focusable, so focus would stay on
                          // whatever was clicked last (a toolbar button, the
                          // body) and the arrow keys would scroll the grid.
                          scrollerRef.current?.focus({ preventScroll: true });
                          if (editing) commitEdit();

                          if (event.shiftKey) {
                            // Shift+click extends the block from the anchor.
                            // Prevented so the browser does not also drag a
                            // text selection across the rows.
                            event.preventDefault();
                            extendTo(address);
                            return;
                          }

                          setActive(address);
                          setRangeAnchor(null);
                          setDragSelecting(true);
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
                            seeded={seeded}
                            onChange={setDraft}
                            onCommit={commitEdit}
                          />
                        ) : (
                          <>
                            <span className="rsu-grid-cell-text">
                              {renderCellText(cell.value)}
                            </span>
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
  /** True when `value` is a character the user just typed into the cell. */
  seeded: boolean;
  onChange: (value: string) => void;
  onCommit: () => void;
}

/**
 * The text editor for a cell. Select-like fields never reach here — they are
 * edited through `SelectPopover`, which opens on a single click.
 */
function CellEditor({ field, value, seeded, onChange, onCommit }: CellEditorProps) {
  // A textarea rather than an input: a cell may legitimately hold a line break
  // (an address, a note), and an input silently drops one.
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  /** Where to put the caret once a programmatic edit has been rendered. */
  const pendingCaret = useRef<number | null>(null);
  /** Set by Escape, so the blur that follows cannot commit the abandoned draft. */
  const abandoned = useRef(false);

  useEffect(() => {
    const node = inputRef.current;
    if (!node) return;

    node.focus();
    // Opening a cell selects its value, so the first keystroke replaces it.
    // A cell opened *by* a keystroke already holds that character, and
    // selecting it would let the second keystroke eat the first.
    if (seeded) node.setSelectionRange(node.value.length, node.value.length);
    else node.select();
    // Mount only: `seeded` cannot change while one editor is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    const node = inputRef.current;
    if (!node) return;

    // Rows are a fixed height, so a multi-line value cannot be shown in place.
    // The editor instead grows downward over the rows beneath it, which is what
    // makes the second line reachable at all.
    node.style.height = 'auto';
    node.style.height = `${Math.max(node.scrollHeight, ROW_HEIGHT)}px`;

    // Re-rendering a controlled textarea leaves the caret at the end of the
    // text, so an inserted break has to put it back. This has to happen in a
    // layout effect: deferred to a frame, the next keystroke lands first and
    // the restore then drops the caret behind it, scrambling the typing.
    if (pendingCaret.current !== null) {
      node.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [value]);

  const insertBreak = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Excel uses Alt+Enter, Sheets uses Ctrl+Enter and Shift+Enter is the web
    // convention, so all of them insert a break. Note that Ctrl/Cmd+Enter puts
    // no character in a textarea on its own, hence the manual splice.
    event.preventDefault();
    // The grid's key handler treats any Enter as "commit and move down"; this
    // keystroke must not reach it.
    event.stopPropagation();

    const node = event.currentTarget;
    const start = node.selectionStart ?? node.value.length;
    const end = node.selectionEnd ?? start;
    pendingCaret.current = start + 1;
    onChange(`${node.value.slice(0, start)}\n${node.value.slice(end)}`);
  };

  return (
    <textarea
      ref={inputRef}
      className="rsu-grid-editor"
      rows={1}
      // A number field still takes text: the coercion layer accepts "$1,234.56",
      // which a native number input would refuse to hold.
      inputMode={field.typeName === 'number' ? 'decimal' : undefined}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          // The grid closes the editor from its own handler; this only has to
          // remember that the value was thrown away, because removing a focused
          // textarea fires a blur that would otherwise commit it.
          abandoned.current = true;
          return;
        }
        if (event.key !== 'Enter') return;
        if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) insertBreak(event);
      }}
      onBlur={() => {
        if (!abandoned.current) onCommit();
      }}
    />
  );
}
