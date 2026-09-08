/**
 * Generates the downloadable import template.
 *
 * A CSV, matching what Dromo's `templateDownloadFilename` produces: it opens in
 * every spreadsheet program and carries no formatting for a user to fight with.
 */

import type { Field } from '../types';
import { triggerDownload } from './export';
import { normalizeField } from './fieldTypes';

/** Quotes a value only when it would otherwise break the row. */
function csvEscape(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Header row, plus one example row where a field type suggests its shape. */
export function buildTemplateCsv(fields: Field[]): string {
  const normalized = fields.map((field) => normalizeField(field)).filter((field) => !field.hidden);

  const headers = normalized.map((field) => csvEscape(field.label));
  const examples = normalized.map((field) => csvEscape(exampleFor(field)));

  const hasExamples = examples.some((example) => example !== '');
  const rows = hasExamples ? [headers.join(','), examples.join(',')] : [headers.join(',')];

  // A BOM makes Excel read the file as UTF-8 rather than the system codepage.
  return `﻿${rows.join('\r\n')}\r\n`;
}

function exampleFor(field: ReturnType<typeof normalizeField>): string {
  switch (field.typeName) {
    case 'email':
      return 'name@example.com';
    case 'date':
      return '2024-01-31';
    case 'datetime':
      return '2024-01-31 14:30';
    case 'time':
      return '14:30';
    case 'number':
      return '1234.56';
    case 'checkbox':
      return 'true';
    case 'phone-number':
      return '+1 415 555 2671';
    case 'country':
      return 'US';
    case 'us-state-territory':
      return 'CA';
    case 'us-zip-code':
      return '94103';
    case 'url':
      return 'https://example.com';
    case 'domain':
      return 'example.com';
    case 'uuid':
      return '0b7f3c9e-4f5a-4a3d-9c2b-7e1f6a8d5c40';
    case 'ssn':
      return '123-45-6789';
    case 'select':
    case 'multi-select':
      return field.selectOptions[0]?.label ?? '';
    default:
      return '';
  }
}

/** Triggers a browser download of the generated template. */
export function downloadTemplate(fields: Field[], filename: string): void {
  const name = filename.toLowerCase().endsWith('.csv') ? filename : `${filename}.csv`;
  triggerDownload(buildTemplateCsv(fields), name, 'text/csv;charset=utf-8');
}
