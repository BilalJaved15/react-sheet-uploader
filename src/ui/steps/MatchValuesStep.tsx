import type { ValueMappingGroup } from '../../state/useUploader';
import type { MatchValuesStepSettings } from '../../types';

const SKIP_VALUE = '__rsu_skip__';

interface MatchValuesStepProps {
  groups: ValueMappingGroup[];
  /** field key -> source value -> chosen option value, or null to clear the cell. */
  mappings: Record<string, Record<string, string | null>>;
  settings: MatchValuesStepSettings;
  onChange: (mappings: Record<string, Record<string, string | null>>) => void;
}

export function MatchValuesStep({ groups, mappings, settings, onChange }: MatchValuesStepProps) {
  const update = (fieldKey: string, sourceValue: string, choice: string) => {
    onChange({
      ...mappings,
      [fieldKey]: {
        ...(mappings[fieldKey] ?? {}),
        [sourceValue]: choice === SKIP_VALUE ? null : choice,
      },
    });
  };

  return (
    <>
      {settings.helpText && <div className="rsu-help">{settings.helpText}</div>}

      <h3 className="rsu-section-title">Match your values</h3>
      <p className="rsu-section-hint">
        These values do not match any option in your schema. Pick what each should become, or
        clear it.
      </p>

      {groups.map((group) => (
        <div key={group.field.key} className="rsu-values-group">
          <h4 className="rsu-values-group-title">
            {group.field.label}
            <span className="rsu-values-group-count">
              {group.values.length} unmatched value{group.values.length === 1 ? '' : 's'}
            </span>
          </h4>

          {group.values.map((entry) => {
            const chosen = mappings[group.field.key]?.[entry.value];
            const value = chosen === null ? SKIP_VALUE : (chosen ?? SKIP_VALUE);

            return (
              <div key={entry.value} className="rsu-values-row">
                <div className="rsu-values-source">
                  <span className="rsu-values-value" title={entry.value}>
                    {entry.value}
                  </span>
                  <span className="rsu-values-count">
                    {entry.count} row{entry.count === 1 ? '' : 's'}
                  </span>
                </div>

                <div className="rsu-match-arrow" aria-hidden="true">
                  →
                </div>

                <select
                  className={`rsu-select${value === SKIP_VALUE ? ' rsu-select--unmatched' : ''}`}
                  value={value}
                  aria-label={`Map the value ${entry.value} for ${group.field.label}`}
                  onChange={(event) => update(group.field.key, entry.value, event.target.value)}
                >
                  <option value={SKIP_VALUE}>Leave empty</option>
                  {group.field.selectOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}
