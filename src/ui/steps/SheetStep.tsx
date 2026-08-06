import type { ParsedSheet } from '../../parsers';

interface SheetStepProps {
  sheets: ParsedSheet[];
  selected: string | null;
  onSelect: (name: string) => void;
}

export function SheetStep({ sheets, selected, onSelect }: SheetStepProps) {
  return (
    <>
      <h3 className="rsu-section-title">Which sheet holds your data?</h3>
      <p className="rsu-section-hint">This workbook has more than one sheet.</p>

      <div className="rsu-choice-list">
        {sheets.map((sheet) => {
          const dataRows = Math.max(0, sheet.rows.length - 1);
          return (
            <button
              key={sheet.name}
              type="button"
              className={`rsu-choice${selected === sheet.name ? ' rsu-choice--selected' : ''}`}
              onClick={() => onSelect(sheet.name)}
            >
              <span className="rsu-choice-name">{sheet.name}</span>
              <span className="rsu-choice-meta">
                {dataRows.toLocaleString()} row{dataRows === 1 ? '' : 's'} ·{' '}
                {(sheet.rows[0]?.length ?? 0).toLocaleString()} columns
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}
