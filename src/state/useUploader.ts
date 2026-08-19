/**
 * The uploader's state machine.
 *
 * Records are mutated in place by the pipeline rather than rebuilt, because a
 * 50k-row import re-cloning on every keystroke is the difference between a grid
 * that feels native and one that stutters. `dataVersion` is bumped after each
 * mutation so React still knows to re-render.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { normalizeField, type NormalizedField } from '../core/fieldTypes';
import { applyAiSuggestions, buildMatchInput } from '../core/aiMatch';
import {
  autoMatchColumns,
  buildSourceColumns,
  detectHeaderRow,
  unmappedRequiredFields,
  type ColumnMapping,
  type SourceColumn,
} from '../core/matching';
import { emptyCell, nextRecordId, recordHasError, type InternalRecord } from '../core/model';
import {
  buildRecords,
  createBlankRecords,
  runPipeline,
  setCellValue,
  toHookRecords,
} from '../core/pipeline';
import { buildResults, canSubmit } from '../core/results';
import { validateRecords } from '../core/validators';
import { FileParseError, parseFile, type ParsedSheet } from '../parsers';
import type {
  Field,
  HookRecord,
  InfoMessage,
  MessageLevel,
  SheetUploaderProps,
  StepData,
  StepHookType,
  StepId,
  UploaderInstance,
} from '../types';

export interface Banner {
  message: string;
  level: MessageLevel;
}

export interface UploaderState {
  step: StepId | 'confirm';
  filename: string | null;
  /** Kept so `onResults` can archive the file exactly as it was uploaded. */
  originalFile: File | null;
  sheets: ParsedSheet[];
  activeSheetName: string | null;
  headerRowIndex: number;
  mappings: ColumnMapping[];
  records: InternalRecord[];
  dataVersion: number;
  busy: string | null;
  banner: Banner | null;
  confirmationMessage: string | null;
  /** True when the user typed their data in rather than uploading a file. */
  manualEntry: boolean;
  aiMatch: AiMatchState;
}

export interface AiMatchState {
  /** `idle` also covers "no aiMatch configured". */
  status: 'idle' | 'running' | 'done' | 'failed';
  /** Column indexes the model changed, so the banner can count them. */
  changedColumns: number[];
  /** Column index -> the model's stated reason, shown beside the row. */
  reasons: Record<number, string>;
}

const IDLE_AI_MATCH: AiMatchState = { status: 'idle', changedColumns: [], reasons: {} };

/**
 * Manual entry starts with a single row. More appear as the user presses Enter
 * on the last one, so the grid grows with the data instead of opening onto a
 * wall of blanks.
 */
const MANUAL_ENTRY_ROWS = 1;

/** Unique values in a select column that matched no option, needing a decision. */
export interface UnmatchedValue {
  value: string;
  count: number;
}

export interface ValueMappingGroup {
  field: NormalizedField;
  values: UnmatchedValue[];
}

const STEP_ORDER: StepId[] = ['upload', 'sheet', 'header', 'match', 'matchValues', 'review'];

function initialDataToRows(initialData: NonNullable<SheetUploaderProps['settings']>['initialData']): string[][] {
  if (!initialData || initialData.length === 0) return [];

  if (Array.isArray(initialData[0])) {
    return (initialData as string[][]).map((row) => row.map((cell) => (cell == null ? '' : String(cell))));
  }

  const objects = initialData as Array<Record<string, unknown>>;
  const headers: string[] = [];
  const seen = new Set<string>();
  for (const item of objects) {
    for (const key of Object.keys(item)) {
      if (!seen.has(key)) {
        seen.add(key);
        headers.push(key);
      }
    }
  }
  return [
    headers,
    ...objects.map((item) => headers.map((key) => (item[key] == null ? '' : String(item[key])))),
  ];
}

export function useUploader(props: SheetUploaderProps, onClose: () => void) {
  const {
    fields: schemaFields,
    settings = {},
    user,
    rowHooks,
    bulkRowHooks,
    columnHooks,
    stepHooks,
    rowDeleteHooks,
    beforeFinish,
    onResults,
    onError,
    fileParsers,
  } = props;

  const invalidDataBehavior = settings.invalidDataBehavior ?? 'REMOVE_INVALID_ROWS';
  const allowEmptySubmit = settings.allowEmptySubmit ?? true;
  const importIdentifier = props.importIdentifier ?? settings.importIdentifier;

  const [state, setState] = useState<UploaderState>(() => ({
    step: 'upload',
    filename: null,
    originalFile: null,
    sheets: [],
    activeSheetName: null,
    headerRowIndex: 0,
    mappings: [],
    records: [],
    dataVersion: 0,
    busy: null,
    banner: null,
    confirmationMessage: null,
    manualEntry: false,
    aiMatch: IDLE_AI_MATCH,
  }));

  /** Fields the user or a step hook added on top of the schema. */
  const [extraFields, setExtraFields] = useState<Field[]>([]);
  const [removedFieldKeys, setRemovedFieldKeys] = useState<string[]>([]);
  /** field key -> source value -> mapped option value (null means "skip"). */
  const [valueMappings, setValueMappings] = useState<Record<string, Record<string, string | null>>>({});

  const fields = useMemo<NormalizedField[]>(() => {
    const removed = new Set(removedFieldKeys);
    const base = schemaFields.filter((field) => !removed.has(field.key)).map((f) => normalizeField(f));
    const extra = extraFields
      .filter((field) => !removed.has(field.key))
      .map((f) => normalizeField(f, true));
    return [...base, ...extra];
  }, [schemaFields, extraFields, removedFieldKeys]);

  // Callbacks and derived data the async flows need without re-creating them.
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;
  const stateRef = useRef(state);
  stateRef.current = state;
  const hooksRef = useRef({ rowHooks, bulkRowHooks, columnHooks });
  hooksRef.current = { rowHooks, bulkRowHooks, columnHooks };
  const valueMappingsRef = useRef(valueMappings);
  valueMappingsRef.current = valueMappings;
  /** In-flight AI match, cancelled when the user moves on or re-enters the step. */
  const aiMatchAbort = useRef<AbortController | null>(null);

  const patch = useCallback((changes: Partial<UploaderState>) => {
    setState((prev) => ({ ...prev, ...changes }));
  }, []);

  const bumpData = useCallback(() => {
    setState((prev) => ({ ...prev, dataVersion: prev.dataVersion + 1 }));
  }, []);

  const setBanner = useCallback(
    (message: string | null, level: MessageLevel = 'error') => {
      patch({ banner: message === null ? null : { message, level } });
    },
    [patch],
  );

  const reportError = useCallback(
    (error: unknown) => {
      const normalized = error instanceof Error ? error : new Error(String(error));
      setBanner(normalized.message, 'error');
      onError?.(normalized);
      if (!(normalized instanceof FileParseError) && typeof console !== 'undefined') {
        console.error('[react-sheet-uploader]', normalized);
      }
    },
    [onError, setBanner],
  );

  /* ---------------------------------------------------------------------- */
  /* Derived data                                                            */
  /* ---------------------------------------------------------------------- */

  const activeSheet = useMemo(
    () => state.sheets.find((sheet) => sheet.name === state.activeSheetName) ?? null,
    [state.sheets, state.activeSheetName],
  );

  const rows = activeSheet?.rows ?? [];
  const headerRow = useMemo(() => rows[state.headerRowIndex] ?? [], [rows, state.headerRowIndex]);
  const dataRows = useMemo(() => rows.slice(state.headerRowIndex + 1), [rows, state.headerRowIndex]);

  const sourceColumns = useMemo<SourceColumn[]>(
    () => buildSourceColumns(headerRow, dataRows),
    [headerRow, dataRows],
  );

  const columnToField = useMemo(() => {
    const map = new Map<number, string>();
    for (const mapping of state.mappings) {
      if (mapping.fieldKey) map.set(mapping.columnIndex, mapping.fieldKey);
    }
    return map;
  }, [state.mappings]);

  /**
   * Select values in the file that match no option, grouped by field.
   *
   * Drives the "match values" step. Fields with `allowCustom` are skipped:
   * an unrecognised value is a valid outcome there, not a decision to make.
   */
  const valueMappingGroups = useMemo<ValueMappingGroup[]>(() => {
    const maxValues = Math.min(settings.matchValuesStep?.maxMappableSelectValues ?? 50, 1000);
    const groups: ValueMappingGroup[] = [];

    for (const field of fields) {
      if (field.typeName !== 'select' && field.typeName !== 'multi-select') continue;
      if (field.typeOptions.allowCustom) continue;
      if (field.selectOptions.length === 0) continue;

      const columns = state.mappings
        .filter((mapping) => mapping.fieldKey === field.key)
        .map((mapping) => mapping.columnIndex);
      if (columns.length === 0) continue;

      const counts = new Map<string, number>();
      for (const row of dataRows) {
        for (const columnIndex of columns) {
          const raw = (row[columnIndex] ?? '').trim();
          if (raw === '') continue;

          const parts =
            field.typeName === 'multi-select'
              ? raw.split(field.typeOptions.delimiter ?? ',').map((p) => p.trim())
              : [raw];

          for (const part of parts) {
            if (part === '') continue;
            const cell = emptyCell();
            setCellValue(cell, field, part);
            if (cell.typeError) counts.set(part, (counts.get(part) ?? 0) + 1);
          }
        }
      }

      if (counts.size === 0) continue;

      const values = [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, maxValues)
        .map(([value, count]) => ({ value, count }));

      groups.push({ field, values });
    }

    return groups;
  }, [fields, state.mappings, dataRows, settings.matchValuesStep?.maxMappableSelectValues]);

  const errorCount = useMemo(
    () => state.records.filter(recordHasError).length,
    // dataVersion is the real trigger: records mutate in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.records, state.dataVersion],
  );

  const submitState = useMemo(
    () => canSubmit(state.records, fields, invalidDataBehavior, allowEmptySubmit),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.records, state.dataVersion, invalidDataBehavior, allowEmptySubmit],
  );

  /* ---------------------------------------------------------------------- */
  /* Step hooks                                                              */
  /* ---------------------------------------------------------------------- */

  const instanceRef = useRef<UploaderInstance | null>(null);

  const runStepHooks = useCallback(
    async (type: StepHookType, data: StepData) => {
      const matching = (stepHooks ?? []).filter((hook) => hook.type === type);
      for (const { callback } of matching) {
        if (typeof callback !== 'function') continue;
        await callback(instanceRef.current as UploaderInstance, data);
      }
    },
    [stepHooks],
  );

  /* ---------------------------------------------------------------------- */
  /* Pipeline                                                                */
  /* ---------------------------------------------------------------------- */

  const runPipelineOn = useCallback(
    async (records: InternalRecord[], mode: 'init' | 'update', scope?: InternalRecord[]) => {
      await runPipeline(records, fieldsRef.current, hooksRef.current, {
        mode,
        ...(scope ? { hookScope: scope } : {}),
      });
    },
    [],
  );

  /* ---------------------------------------------------------------------- */
  /* Navigation                                                              */
  /* ---------------------------------------------------------------------- */

  const enterReview = useCallback(
    async (records: InternalRecord[]) => {
      patch({ busy: settings.reviewStep?.processingText ?? 'Preparing your data…' });
      try {
        // These records are not in state until the end of this function, so
        // publish them early: a REVIEW_STEP hook calling `addField` seeds its
        // cells from `stateRef`, and would otherwise seed the previous set.
        stateRef.current = { ...stateRef.current, records };
        await runStepHooks('REVIEW_STEP', { records: toHookRecords(records, fieldsRef.current) });
        await runPipelineOn(records, 'init');
        await runStepHooks('REVIEW_STEP_POST_HOOKS', {
          records: toHookRecords(records, fieldsRef.current),
        });
        setState((prev) => ({
          ...prev,
          step: 'review',
          records,
          dataVersion: prev.dataVersion + 1,
          busy: null,
        }));
      } catch (error) {
        patch({ busy: null });
        reportError(error);
      }
    },
    [patch, reportError, runPipelineOn, runStepHooks, settings.reviewStep?.processingText],
  );

  /** Rewrites raw values using the decisions made in the match-values step. */
  const applyValueMappings = useCallback((rawRows: string[][], map: Map<number, string>) => {
    const mappings = valueMappingsRef.current;
    if (Object.keys(mappings).length === 0) return rawRows;

    return rawRows.map((row) =>
      row.map((cell, columnIndex) => {
        const fieldKey = map.get(columnIndex);
        if (!fieldKey) return cell;
        const forField = mappings[fieldKey];
        if (!forField) return cell;
        const replacement = forField[cell.trim()];
        if (replacement === undefined) return cell;
        return replacement ?? '';
      }),
    );
  }, []);

  const buildAndReview = useCallback(async () => {
    const map = columnToField;
    const mapped = applyValueMappings(dataRows, map);
    const records = buildRecords(mapped, {
      columnToField: map,
      fields: fieldsRef.current,
      passThroughUnmappedColumns: settings.passThroughUnmappedColumns ?? false,
      firstSourceRow: stateRef.current.headerRowIndex + 2,
    });
    await enterReview(records);
  }, [
    applyValueMappings,
    columnToField,
    dataRows,
    enterReview,
    settings.passThroughUnmappedColumns,
  ]);

  // The suggestion is only useful while the match step is on screen.
  useEffect(() => () => aiMatchAbort.current?.abort(), []);

  const confirmMatch = useCallback(async () => {
    aiMatchAbort.current?.abort();
    const missing = unmappedRequiredFields(stateRef.current.mappings, fieldsRef.current);
    if (missing.length > 0) {
      setBanner(
        `Map ${missing.map((f) => f.label).join(', ')} before continuing.`,
        'error',
      );
      return;
    }
    setBanner(null);

    if (valueMappingGroups.length > 0) {
      patch({ step: 'matchValues' });
      return;
    }
    await buildAndReview();
  }, [buildAndReview, patch, setBanner, valueMappingGroups.length]);

  /**
   * Asks the host's matcher to improve on the heuristic mappings.
   *
   * Runs in the background once the match step is already on screen: the user
   * sees the heuristic result immediately and watches it refine, rather than
   * waiting on a network round trip before anything appears. Every failure path
   * — no matcher configured, rejection, timeout, unusable output — leaves the
   * heuristic mappings exactly as they were.
   */
  const runAiMatch = useCallback(
    async (columns: SourceColumn[], baseMappings: ColumnMapping[]) => {
      const aiMatch = settings.matchingStep?.aiMatch;
      if (!aiMatch || columns.length === 0) return;

      aiMatchAbort.current?.abort();
      const controller = new AbortController();
      aiMatchAbort.current = controller;

      const timeoutMs = settings.matchingStep?.aiMatchTimeoutMs ?? 15000;
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      patch({ aiMatch: { status: 'running', changedColumns: [], reasons: {} } });

      try {
        const input = buildMatchInput(columns, fieldsRef.current, baseMappings);
        const suggestions = await aiMatch(input, controller.signal);
        if (controller.signal.aborted) return;

        const applied = applyAiSuggestions(
          // Re-read state: the user may have edited a row while this was in flight.
          stateRef.current.mappings,
          suggestions,
          fieldsRef.current,
          columns,
        );

        patch({
          mappings: applied.mappings,
          aiMatch: {
            status: 'done',
            changedColumns: applied.changedColumns,
            reasons: Object.fromEntries(applied.reasons),
          },
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        // A failed suggestion is not worth interrupting the user for; the
        // heuristic mappings on screen are still usable.
        if (typeof console !== 'undefined') {
          console.warn('[react-sheet-uploader] aiMatch failed', error);
        }
        patch({ aiMatch: { status: 'failed', changedColumns: [], reasons: {} } });
      } finally {
        clearTimeout(timer);
        if (aiMatchAbort.current === controller) aiMatchAbort.current = null;
      }
    },
    [patch, settings.matchingStep?.aiMatch, settings.matchingStep?.aiMatchTimeoutMs],
  );

  const confirmHeader = useCallback(
    (headerRowIndex: number) => {
      const currentRows = activeSheet?.rows ?? [];
      const nextHeader = currentRows[headerRowIndex] ?? [];
      const nextData = currentRows.slice(headerRowIndex + 1);
      const columns = buildSourceColumns(nextHeader, nextData);

      const mappings = autoMatchColumns(columns, fieldsRef.current, {
        fuzzyMatchHeaders: settings.matchingStep?.fuzzyMatchHeaders ?? true,
      });

      patch({ headerRowIndex, mappings, step: 'match', aiMatch: IDLE_AI_MATCH });
      void runAiMatch(columns, mappings);
    },
    [activeSheet, patch, runAiMatch, settings.matchingStep?.fuzzyMatchHeaders],
  );

  const selectSheet = useCallback(
    (sheetName: string) => {
      const sheet = stateRef.current.sheets.find((s) => s.name === sheetName);
      if (!sheet) return;

      const override = settings.matchingStep?.headerRowOverride;
      const headerIndex = override ?? detectHeaderRow(sheet.rows);

      patch({ activeSheetName: sheetName, headerRowIndex: headerIndex });

      if (override !== undefined || settings.matchingStep?.headerRowOverride !== undefined) {
        const columns = buildSourceColumns(
          sheet.rows[headerIndex] ?? [],
          sheet.rows.slice(headerIndex + 1),
        );
        const mappings = autoMatchColumns(columns, fieldsRef.current, {
          fuzzyMatchHeaders: settings.matchingStep?.fuzzyMatchHeaders ?? true,
        });
        patch({ mappings, step: 'match', aiMatch: IDLE_AI_MATCH });
        void runAiMatch(columns, mappings);
      } else {
        patch({ step: 'header' });
      }
    },
    [
      patch,
      runAiMatch,
      settings.matchingStep?.fuzzyMatchHeaders,
      settings.matchingStep?.headerRowOverride,
    ],
  );

  /* ---------------------------------------------------------------------- */
  /* File intake                                                             */
  /* ---------------------------------------------------------------------- */

  const loadSheets = useCallback(
    async (sheets: ParsedSheet[], filename: string | null) => {
      const usable = sheets.filter((sheet) => sheet.rows.length > 0);
      if (usable.length === 0) {
        reportError(new FileParseError('That file has no data in it.'));
        return;
      }

      // Only a finite positive number is a limit. Callers wiring this up from
      // an API or config routinely pass `null`/`0`/`NaN` for "no limit", and
      // `rows.length - 1 > null` coerces to `> 0`, rejecting every file.
      const maxRecords = settings.maxRecords;
      if (typeof maxRecords === 'number' && Number.isFinite(maxRecords) && maxRecords > 0) {
        const tooBig = usable.find((sheet) => sheet.rows.length - 1 > maxRecords);
        if (tooBig) {
          reportError(
            new FileParseError(
              `“${tooBig.name}” has ${tooBig.rows.length - 1} rows, more than the ${maxRecords}-row limit.`,
            ),
          );
          return;
        }
      }

      const preview = usable[0]?.rows.slice(0, 20) ?? [];
      await runStepHooks('UPLOAD_STEP', {
        preview,
        headers: preview[0] ?? [],
        filename,
      });

      patch({ sheets: usable, filename, banner: null });

      const override = settings.uploadStep?.sheetOverride;
      const chosen =
        (override && usable.find((sheet) => sheet.name === override)) ??
        (usable.length === 1 ? usable[0] : null);

      if (chosen) {
        // `selectSheet` reads sheets from the ref, which the patch above has
        // not flushed yet, so seed it directly.
        stateRef.current = { ...stateRef.current, sheets: usable };
        selectSheet(chosen.name);
      } else {
        patch({ step: 'sheet' });
      }
    },
    [patch, reportError, runStepHooks, selectSheet, settings.maxRecords, settings.uploadStep?.sheetOverride],
  );

  const acceptFile = useCallback(
    async (file: File) => {
      patch({ busy: `Reading ${file.name}…`, banner: null });
      try {
        const parsed = await parseFile(file, {
          settings: {
            delimiter: settings.delimiter,
            maxFileSize: settings.maxFileSize,
            maxRecords: settings.maxRecords,
          },
          fileParsers,
        });
        patch({ busy: null, originalFile: file });
        stateRef.current = { ...stateRef.current, originalFile: file };
        await loadSheets(parsed.sheets, parsed.filename);
      } catch (error) {
        patch({ busy: null });
        reportError(error);
      }
    },
    [fileParsers, loadSheets, patch, reportError, settings.delimiter, settings.maxFileSize, settings.maxRecords],
  );

  /* ---------------------------------------------------------------------- */
  /* Review-step editing                                                     */
  /* ---------------------------------------------------------------------- */

  /**
   * Applies one or more cell edits.
   *
   * Batched deliberately: a paste of 500 cells must run hooks once over the
   * touched rows, not once per cell.
   */
  const applyEdits = useCallback(
    (edits: Array<{ recordId: string; fieldKey: string; value: string }>) => {
      if (edits.length === 0) return;

      const records = stateRef.current.records;
      const byId = new Map(records.map((record) => [record.id, record]));
      const touched = new Set<InternalRecord>();

      for (const edit of edits) {
        const record = byId.get(edit.recordId);
        const field = fieldsRef.current.find((f) => f.key === edit.fieldKey);
        const cell = record?.cells[edit.fieldKey];
        if (!record || !field || !cell || field.readOnly) continue;

        setCellValue(cell, field, edit.value);
        touched.add(record);
      }

      if (touched.size === 0) return;

      // Validate synchronously so the grid updates on the same frame, then let
      // hooks (which may be async) settle afterwards.
      validateRecords(records, fieldsRef.current);
      bumpData();

      void runPipelineOn(records, 'update', [...touched])
        .then(() => bumpData())
        .catch(reportError);
    },
    [bumpData, reportError, runPipelineOn],
  );

  const editCell = useCallback(
    (recordId: string, fieldKey: string, value: string) => {
      applyEdits([{ recordId, fieldKey, value }]);
    },
    [applyEdits],
  );

  const deleteRecords = useCallback(
    (recordIds: string[]) => {
      const ids = new Set(recordIds);
      const records = stateRef.current.records;
      const removed = records.filter((record) => ids.has(record.id));
      const remaining = records.filter((record) => !ids.has(record.id));

      for (const hook of rowDeleteHooks ?? []) {
        for (const [index, record] of removed.entries()) {
          const [hookRecord] = toHookRecords([record], fieldsRef.current);
          if (hookRecord) {
            hookRecord.index = index;
            void hook(hookRecord);
          }
        }
      }

      validateRecords(remaining, fieldsRef.current);
      setState((prev) => ({ ...prev, records: remaining, dataVersion: prev.dataVersion + 1 }));
    },
    [rowDeleteHooks],
  );

  /** Appends a blank row and returns its id, so callers can focus it. */
  const addRecord = useCallback((): string | undefined => {
    const blank = createBlankRecords(fieldsRef.current, 1);
    const records = [...stateRef.current.records, ...blank];
    validateRecords(records, fieldsRef.current);
    stateRef.current = { ...stateRef.current, records };
    setState((prev) => ({ ...prev, records, dataVersion: prev.dataVersion + 1 }));
    return blank[0]?.id;
  }, []);

  /**
   * Starts an empty import the user types or pastes into.
   *
   * There is no file, so there is nothing to pick a sheet, header or column
   * mapping for: the schema *is* the table, and we go straight to review.
   */
  const startManualEntry = useCallback(async () => {
    // Typed-in data has no source file, even if one was picked and abandoned.
    setState((prev) => ({
      ...prev,
      manualEntry: true,
      filename: null,
      originalFile: null,
      banner: null,
    }));
    stateRef.current = { ...stateRef.current, manualEntry: true, originalFile: null };

    const records = createBlankRecords(fieldsRef.current, MANUAL_ENTRY_ROWS);
    await enterReview(records);
  }, [enterReview]);

  /* ---------------------------------------------------------------------- */
  /* Submission                                                              */
  /* ---------------------------------------------------------------------- */

  const submit = useCallback(async () => {
    const records = stateRef.current.records;
    const check = canSubmit(records, fieldsRef.current, invalidDataBehavior, allowEmptySubmit);
    if (!check.allowed) {
      setBanner(check.reason ?? 'This import cannot be submitted yet.', 'error');
      return;
    }

    patch({ busy: 'Finishing up…', banner: null });

    try {
      await runStepHooks('REVIEW_STEP_PRE_SUBMIT', {
        records: toHookRecords(records, fieldsRef.current),
      });

      const { data, metadata } = buildResults(records, {
        fields: fieldsRef.current,
        mappings: stateRef.current.mappings,
        // Typed-in data has no file headers, so the schema's labels stand in.
        rawHeaders: stateRef.current.manualEntry
          ? fieldsRef.current.map((field) => field.label)
          : headerRow,
        filename: stateRef.current.filename,
        originalFile: stateRef.current.originalFile,
        importIdentifier,
        user,
        invalidDataBehavior,
        passThroughUnmappedColumns: settings.passThroughUnmappedColumns ?? false,
      });

      if (beforeFinish) {
        const outcome = await beforeFinish(data, metadata, instanceRef.current as UploaderInstance);
        if (outcome && outcome.cancel) {
          patch({ busy: null });
          setBanner(outcome.message ?? 'This import was cancelled.', 'error');
          return;
        }
      }

      await onResults?.(data, metadata);

      patch({ busy: null });
      if (stateRef.current.confirmationMessage) {
        patch({ step: 'confirm' });
      } else {
        onClose();
      }
    } catch (error) {
      patch({ busy: null });
      reportError(error);
    }
  }, [
    allowEmptySubmit,
    beforeFinish,
    headerRow,
    importIdentifier,
    invalidDataBehavior,
    onClose,
    onResults,
    patch,
    reportError,
    runStepHooks,
    setBanner,
    settings.passThroughUnmappedColumns,
    user,
  ]);

  /* ---------------------------------------------------------------------- */
  /* Imperative instance                                                     */
  /* ---------------------------------------------------------------------- */

  const goToStep = useCallback(
    (step: StepId) => {
      patch({ step });
    },
    [patch],
  );

  const instance = useMemo<UploaderInstance>(
    () => ({
      open: () => {
        /* Opening is owned by the component; a no-op once already open. */
      },
      close: onClose,
      goToStep,
      setMessage: setBanner,
      setConfirmationMessage: (message) => patch({ confirmationMessage: message }),

      addField: (field, position) => {
        setExtraFields((prev) => {
          if (prev.some((f) => f.key === field.key)) return prev;
          const next = prev.slice();
          if (position === undefined || position >= next.length) next.push(field);
          else next.splice(Math.max(0, position), 0, field);
          return next;
        });
        const normalized = normalizeField(field, true);

        // `setExtraFields` only reaches `fields` on the next render, but hooks
        // running later in this same tick read `fieldsRef` — a REVIEW_STEP hook
        // adds a column and the `init` row hooks then fill it, all before React
        // re-renders. Publish it there too, ordered as the `fields` memo will
        // order it, so those writes are not dropped as unknown-field writes.
        if (!fieldsRef.current.some((f) => f.key === field.key)) {
          const base = fieldsRef.current.filter((f) => !f.isCustom);
          const extra = fieldsRef.current.filter((f) => f.isCustom);
          if (position === undefined || position >= extra.length) extra.push(normalized);
          else extra.splice(Math.max(0, position), 0, normalized);
          fieldsRef.current = [...base, ...extra];
        }

        // Existing records need a slot for the new field straight away.
        for (const record of stateRef.current.records) {
          if (record.cells[field.key]) continue;
          const cell = emptyCell();
          setCellValue(cell, normalized, '');
          record.cells[field.key] = cell;
        }
        bumpData();
      },

      removeField: (fieldKey) => {
        setRemovedFieldKeys((prev) => (prev.includes(fieldKey) ? prev : [...prev, fieldKey]));
      },

      updateInfoMessages: (updates) => {
        const records = stateRef.current.records;
        for (const update of updates) {
          const cell = records[update.rowIndex]?.cells[update.fieldKey];
          if (!cell) continue;
          cell.info = (update.messages ?? []).map((m: InfoMessage) => ({
            message: m.message,
            level: m.level ?? 'error',
          }));
        }
        bumpData();
      },

      addRows: (rows) => {
        const blank = createBlankRecords(fieldsRef.current, rows.length, rows);
        const records = [...stateRef.current.records, ...blank];
        validateRecords(records, fieldsRef.current);
        setState((prev) => ({ ...prev, records, dataVersion: prev.dataVersion + 1 }));
      },

      removeRows: (rowIndexes) => {
        const drop = new Set(rowIndexes);
        const records = stateRef.current.records.filter((_, index) => !drop.has(index));
        validateRecords(records, fieldsRef.current);
        setState((prev) => ({ ...prev, records, dataVersion: prev.dataVersion + 1 }));
      },

      getRecords: () => toHookRecords(stateRef.current.records, fieldsRef.current),

      setRecords: (hookRecords: HookRecord[]) => {
        const records = createBlankRecords(fieldsRef.current, hookRecords.length);
        hookRecords.forEach((hookRecord, index) => {
          const record = records[index];
          if (!record) return;
          record.id = nextRecordId();
          for (const [fieldKey, hookCell] of Object.entries(hookRecord.row ?? {})) {
            const field = fieldsRef.current.find((f) => f.key === fieldKey);
            const cell = record.cells[fieldKey];
            if (!field || !cell || !hookCell) continue;
            setCellValue(cell, field, hookCell.value ?? '');
            if (hookCell.info) {
              cell.info = hookCell.info.map((m) => ({ message: m.message, level: m.level ?? 'error' }));
            }
          }
        });
        validateRecords(records, fieldsRef.current);
        setState((prev) => ({ ...prev, records, dataVersion: prev.dataVersion + 1 }));
      },
    }),
    [bumpData, goToStep, onClose, patch, setBanner],
  );

  instanceRef.current = instance;

  /* ---------------------------------------------------------------------- */
  /* Preloaded data                                                          */
  /* ---------------------------------------------------------------------- */

  const bootstrapped = useRef(false);
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;

    if (settings.initialFile) {
      void acceptFile(settings.initialFile);
      return;
    }
    if (settings.initialData && settings.initialData.length > 0) {
      const rowsFromData = initialDataToRows(settings.initialData);
      if (rowsFromData.length > 0) {
        void loadSheets([{ name: 'Data', rows: rowsFromData }], null);
      }
      return;
    }
    // With no dropzone to show, the upload step would be an empty screen.
    if (settings.manualInputOnly) {
      void startManualEntry();
    }
    // Bootstrapping is deliberately once-only for the lifetime of the modal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------------------------------------------------------------- */
  /* Steps shown in the stepper                                              */
  /* ---------------------------------------------------------------------- */

  const visibleSteps = useMemo<StepId[]>(() => {
    // Typed-in data has no file to pick a sheet, header or mapping for.
    if (state.manualEntry) {
      return settings.manualInputOnly ? ['review'] : ['upload', 'review'];
    }

    const skip = new Set<StepId>();
    if (state.sheets.length <= 1) skip.add('sheet');
    if (settings.matchingStep?.headerRowOverride !== undefined) skip.add('header');
    if (valueMappingGroups.length === 0) skip.add('matchValues');
    return STEP_ORDER.filter((step) => !skip.has(step));
  }, [
    state.manualEntry,
    state.sheets.length,
    settings.manualInputOnly,
    settings.matchingStep?.headerRowOverride,
    valueMappingGroups.length,
  ]);

  return {
    state,
    fields,
    rows,
    headerRow,
    dataRows,
    sourceColumns,
    valueMappingGroups,
    valueMappings,
    setValueMappings,
    errorCount,
    submitState,
    visibleSteps,
    instance,
    actions: {
      acceptFile,
      selectSheet,
      confirmHeader,
      confirmMatch,
      buildAndReview,
      setMappings: (mappings: ColumnMapping[]) => patch({ mappings }),
      confirmAllMappings: () =>
        setState((prev) => ({
          ...prev,
          mappings: prev.mappings.map((mapping) => ({ ...mapping, confirmed: true })),
        })),
      setHeaderRowIndex: (headerRowIndex: number) => patch({ headerRowIndex }),
      editCell,
      applyEdits,
      deleteRecords,
      addRecord,
      startManualEntry,
      submit,
      goToStep,
      setBanner,
      addExtraField: (field: Field) => setExtraFields((prev) => [...prev, field]),
    },
  };
}

export type UploaderController = ReturnType<typeof useUploader>;
