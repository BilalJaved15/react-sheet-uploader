/**
 * The review step's export control.
 *
 * A split button: the main half downloads a CSV, which is what almost everyone
 * wants, and the caret opens the other formats. Kept as its own component
 * because it owns the open/closed state and the dismiss listeners.
 */

import { useEffect, useRef, useState } from 'react';
import { EXPORT_FORMATS, type ExportFormat } from '../../core/export';
import { ChevronDownIcon, DownloadIcon } from './Icons';

const FORMATS: ExportFormat[] = ['csv', 'tsv', 'json'];

interface ExportMenuProps {
  /** Rows the download will contain, so the menu can say what it is exporting. */
  rowCount: number;
  /** True when the download is limited to the checked rows. */
  selectionOnly: boolean;
  onExport: (format: ExportFormat) => void;
}

export function ExportMenu({ rowCount, selectionOnly, onExport }: ExportMenuProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const scope = selectionOnly
    ? `${rowCount.toLocaleString()} selected row${rowCount === 1 ? '' : 's'}`
    : `${rowCount.toLocaleString()} row${rowCount === 1 ? '' : 's'}`;

  return (
    // `data-rsu-escape` tells the modal that Escape belongs to the open menu
    // rather than to closing the whole import. See `UploaderModal`.
    <div className="rsu-export" ref={containerRef} data-rsu-escape={open ? 'true' : undefined}>
      <div className="rsu-export-group">
        <button
          type="button"
          className="rsu-btn rsu-btn--tertiary rsu-export-main"
          title={`Download ${scope} as a CSV file`}
          onClick={() => {
            setOpen(false);
            onExport('csv');
          }}
        >
          <DownloadIcon size={14} />
          Export
        </button>
        <button
          type="button"
          className="rsu-btn rsu-btn--tertiary rsu-export-toggle"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Choose an export format"
          onClick={() => setOpen((previous) => !previous)}
        >
          <ChevronDownIcon size={13} />
        </button>
      </div>

      {open && (
        <div className="rsu-export-menu" role="menu">
          <div className="rsu-export-menu-head">Export {scope}</div>
          {FORMATS.map((format) => (
            <button
              key={format}
              type="button"
              className="rsu-export-menu-item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onExport(format);
              }}
            >
              {EXPORT_FORMATS[format].label}
              <span className="rsu-export-menu-ext">.{EXPORT_FORMATS[format].extension}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
