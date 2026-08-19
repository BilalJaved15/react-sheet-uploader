import { useMemo } from 'react';
import type { NormalizedField } from '../../core/fieldTypes';
import { LOW_CONFIDENCE_SCORE, type ColumnMapping, type SourceColumn } from '../../core/matching';
import type { AiMatchState } from '../../state/useUploader';
import type { Field, MatchingStepSettings } from '../../types';

const CUSTOM_VALUE = '__rsu_custom__';
const IGNORE_VALUE = '__rsu_ignore__';

interface MatchStepProps {
  columns: SourceColumn[];
  fields: NormalizedField[];
  mappings: ColumnMapping[];
  settings: MatchingStepSettings;
  allowCustomFields: boolean;
  aiMatch: AiMatchState;
  onChange: (mappings: ColumnMapping[]) => void;
  onAddCustomField: (field: Field) => void;
  onConfirmAll: () => void;
}

export function MatchStep({
  columns,
  fields,
  mappings,
  settings,
  allowCustomFields,
  aiMatch,
  onChange,
  onAddCustomField,
  onConfirmAll,
}: MatchStepProps) {
  const mappingByColumn = useMemo(
    () => new Map(mappings.map((mapping) => [mapping.columnIndex, mapping])),
    [mappings],
  );

  /** Fields already claimed, so the dropdown can grey them out elsewhere. */
  const claimed = useMemo(() => {
    const counts = new Map<string, number>();
    for (const mapping of mappings) {
      if (mapping.fieldKey) counts.set(mapping.fieldKey, (counts.get(mapping.fieldKey) ?? 0) + 1);
    }
    return counts;
  }, [mappings]);

  const selectable = fields.filter((field) => !field.hidden);

  const update = (columnIndex: number, value: string) => {
    if (value === CUSTOM_VALUE) {
      const column = columns[columnIndex];
      const label = column?.header?.trim() || `Column ${columnIndex + 1}`;
      const key = uniqueKey(label, fields);
      onAddCustomField({ label, key });
      onChange(
        mappings.map((mapping) =>
          mapping.columnIndex === columnIndex
            ? { ...mapping, fieldKey: key, confirmed: true }
            : mapping,
        ),
      );
      return;
    }

    const fieldKey = value === IGNORE_VALUE ? null : value;
    onChange(
      mappings.map((mapping) =>
        mapping.columnIndex === columnIndex ? { ...mapping, fieldKey, confirmed: true } : mapping,
      ),
    );
  };

  /** Mapped but not yet confirmed by the user — the rows needing a look. */
  const unreviewed = mappings.filter(
    (mapping) => mapping.fieldKey !== null && !mapping.confirmed,
  ).length;

  const aiChanged = aiMatch.status === 'done' ? aiMatch.changedColumns.length : 0;

  return (
    <>
      {settings.helpText && <div className="rsu-help">{settings.helpText}</div>}

      <h3 className="rsu-section-title">Match your columns</h3>
      <p className="rsu-section-hint">
        We matched what we could. Check the rest, and ignore anything you do not need.
      </p>

      {aiMatch.status === 'running' && (
        <div className="rsu-match-banner rsu-match-banner--busy" role="status">
          <span className="rsu-match-banner-text">Checking these matches with AI…</span>
        </div>
      )}

      {unreviewed > 0 && aiMatch.status !== 'running' && (
        <div className="rsu-match-banner" role="status">
          <span className="rsu-match-banner-text">
            {aiChanged > 0
              ? `AI refined ${aiChanged} of ${unreviewed} suggested ${plural(unreviewed, 'match', 'matches')}. Review below.`
              : `${unreviewed} suggested ${plural(unreviewed, 'match', 'matches')} — review below.`}
          </span>
          <button type="button" className="rsu-match-banner-action" onClick={onConfirmAll}>
            Confirm all
          </button>
        </div>
      )}

      <div className="rsu-match-list">
        <div className="rsu-match-head">
          <span>Your column</span>
          <span />
          <span>Imports as</span>
          <span style={{ textAlign: 'right' }}>Status</span>
        </div>

        {columns.map((column) => {
          const mapping = mappingByColumn.get(column.index);
          const value = mapping?.fieldKey ?? IGNORE_VALUE;
          const status = !mapping?.fieldKey
            ? 'ignored'
            : mapping.confirmed
              ? 'manual'
              : 'suggested';

          const lowConfidence =
            status === 'suggested' && (mapping?.score ?? 1) < LOW_CONFIDENCE_SCORE;
          const reason = aiMatch.reasons[column.index];

          return (
            <div key={column.index} className="rsu-match-row">
              <div className="rsu-match-source">
                <div className="rsu-match-header-name" title={column.header}>
                  {column.header.trim() === '' ? (
                    <em>Column {column.index + 1}</em>
                  ) : (
                    column.header
                  )}
                </div>
                <div className="rsu-match-samples" title={column.samples.join(', ')}>
                  {column.samples.length > 0 ? column.samples.join(', ') : 'No sample data'}
                </div>
                {reason && status === 'suggested' && (
                  <div className="rsu-match-reason" title={reason}>
                    {reason}
                  </div>
                )}
              </div>

              <div className="rsu-match-arrow" aria-hidden="true">
                →
              </div>

              <select
                className={`rsu-select${value === IGNORE_VALUE ? ' rsu-select--unmatched' : ''}`}
                value={value}
                aria-label={`Map column ${column.header || column.index + 1}`}
                onChange={(event) => update(column.index, event.target.value)}
              >
                {allowCustomFields && settings.suggestCustomFirst && (
                  <option value={CUSTOM_VALUE}>+ Add as a new field</option>
                )}
                <option value={IGNORE_VALUE}>Do not import</option>
                {selectable.map((field) => {
                  const takenElsewhere =
                    (claimed.get(field.key) ?? 0) > 0 &&
                    mapping?.fieldKey !== field.key &&
                    !field.manyToOne;

                  return (
                    <option key={field.key} value={field.key} disabled={takenElsewhere}>
                      {field.label}
                      {field.requireMapping ? ' (required)' : ''}
                      {takenElsewhere ? ' — already matched' : ''}
                    </option>
                  );
                })}
                {allowCustomFields && !settings.suggestCustomFirst && (
                  <option value={CUSTOM_VALUE}>+ Add as a new field</option>
                )}
              </select>

              <div
                className={`rsu-match-status rsu-status--${status}${
                  lowConfidence ? ' rsu-status--low' : ''
                }`}
              >
                {status === 'suggested'
                  ? lowConfidence
                    ? 'Check this'
                    : 'Suggested'
                  : status === 'manual'
                    ? 'Confirmed'
                    : 'Not imported'}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** Derives a result key from a label, avoiding collisions with the schema. */
function uniqueKey(label: string, fields: NormalizedField[]): string {
  const base =
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'custom_field';

  const taken = new Set(fields.map((field) => field.key));
  if (!taken.has(base)) return base;

  let suffix = 2;
  while (taken.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}
