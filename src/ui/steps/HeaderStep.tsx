interface HeaderStepProps {
  rows: string[][];
  headerRowIndex: number;
  onSelect: (index: number) => void;
}

/** How many rows to show before the picker becomes unwieldy. */
const PREVIEW_ROWS = 25;

export function HeaderStep({ rows, headerRowIndex, onSelect }: HeaderStepProps) {
  const preview = rows.slice(0, PREVIEW_ROWS);

  return (
    <>
      <h3 className="rsu-section-title">Which row has your column names?</h3>
      <p className="rsu-section-hint">
        Click the row that holds the headers. Anything above it is ignored.
      </p>

      <div className="rsu-preview-wrap">
        <table className="rsu-preview">
          <tbody>
            {preview.map((row, index) => {
              const isHeader = index === headerRowIndex;
              const isSkipped = index < headerRowIndex;

              return (
                <tr
                  key={index}
                  className={`rsu-preview-row${isHeader ? ' rsu-preview-row--header' : ''}${
                    isSkipped ? ' rsu-preview-row--skipped' : ''
                  }`}
                  onClick={() => onSelect(index)}
                >
                  <td className="rsu-preview-gutter">{index + 1}</td>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} title={cell}>
                      {cell}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
