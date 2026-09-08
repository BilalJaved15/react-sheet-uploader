/**
 * Downloads the review grid's current contents.
 *
 * This is deliberately not `buildResults`: it is a snapshot of the table as the
 * user sees it — invalid rows included, no `invalidDataBehavior` filtering, the
 * displayed text for text formats — because its job is to save work in
 * progress, not to produce the import payload.
 */

import type { NormalizedField } from './fieldTypes';
import type { InternalRecord } from './model';

export type ExportFormat = 'csv' | 'tsv' | 'json';

interface FormatSpec {
  extension: string;
  mimeType: string;
  label: string;
}

export const EXPORT_FORMATS: Record<ExportFormat, FormatSpec> = {
  csv: { extension: 'csv', mimeType: 'text/csv;charset=utf-8', label: 'CSV' },
  tsv: { extension: 'tsv', mimeType: 'text/tab-separated-values;charset=utf-8', label: 'TSV' },
  json: { extension: 'json', mimeType: 'application/json;charset=utf-8', label: 'JSON' },
};

/** Quotes a value only when the delimiter, a quote or a line break would break the row. */
function escapeDelimited(value: string, delimiter: string): string {
  const needsQuotes = value.includes(delimiter) || /["\n\r]/.test(value);
  return needsQuotes ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Serializes the records for the given format.
 *
 * Hidden fields are left out: they are not part of what the user reviewed, and
 * a column nobody can see re-imports as a surprise.
 */
export function buildExport(
  records: InternalRecord[],
  fields: NormalizedField[],
  format: ExportFormat,
): string {
  const visible = fields.filter((field) => !field.hidden);

  if (format === 'json') {
    const rows = records.map((record) => {
      const row: Record<string, unknown> = {};
      for (const field of visible) {
        const cell = record.cells[field.key];
        // The typed output rather than the displayed text, so numbers and dates
        // survive as numbers and dates — this is the format that will be read
        // by a program rather than a spreadsheet.
        row[field.key] = cell ? (cell.resultValue ?? cell.output) : null;
      }
      return row;
    });
    return `${JSON.stringify(rows, null, 2)}\n`;
  }

  const delimiter = format === 'tsv' ? '\t' : ',';
  const lines = [
    visible.map((field) => escapeDelimited(field.label, delimiter)).join(delimiter),
    ...records.map((record) =>
      visible
        .map((field) => escapeDelimited(record.cells[field.key]?.value ?? '', delimiter))
        .join(delimiter),
    ),
  ];

  // A BOM makes Excel read the file as UTF-8 rather than the system codepage.
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** Triggers a browser download of `text`, appending the extension if missing. */
export function triggerDownload(text: string, filename: string, mimeType: string): void {
  if (typeof document === 'undefined') return;

  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Strips any of the export extensions so a base name can be re-suffixed. */
function baseName(filename: string): string {
  return filename.replace(/\.(csv|tsv|json|xlsx|xls)$/i, '');
}

export function downloadExport(
  records: InternalRecord[],
  fields: NormalizedField[],
  format: ExportFormat,
  filename: string,
): void {
  const spec = EXPORT_FORMATS[format];
  triggerDownload(
    buildExport(records, fields, format),
    `${baseName(filename)}.${spec.extension}`,
    spec.mimeType,
  );
}
