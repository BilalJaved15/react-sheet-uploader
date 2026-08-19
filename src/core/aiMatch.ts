/**
 * Optional AI-assisted column matching.
 *
 * The heuristic in `matching.ts` handles abbreviations and value shapes, but it
 * cannot read domain meaning: that `Ship To Ctry` belongs to `deliveryCountry`
 * rather than `billingCountry`, or that a client's internal `WBS Code` is their
 * project reference. A language model can.
 *
 * This package deliberately does not call one. It runs in the browser, and
 * every provider with a free tier still needs an API key — a key shipped to the
 * browser is a public key. So the model call is the host application's, made
 * from its own server, and this module supplies the two hard parts either side
 * of it: a prompt that constrains the model to a checkable answer, and a parser
 * that refuses anything the schema does not support.
 *
 * Nothing here is trusted. A suggestion naming an unknown field, claiming a
 * column that does not exist, or double-claiming a single-use field is dropped,
 * and every surviving suggestion still arrives at the user unconfirmed.
 */

import type { NormalizedField } from './fieldTypes';
import type { ColumnMapping, SourceColumn } from './matching';

/** What the host's matcher receives. Sample values are already truncated. */
export interface AiMatchInput {
  columns: Array<{
    index: number;
    header: string;
    samples: string[];
  }>;
  fields: Array<{
    key: string;
    label: string;
    description?: string;
    type: string;
    required: boolean;
    /** Option labels, when the field is a select. Truncated to a readable few. */
    options?: string[];
  }>;
  /** What the heuristic already decided, so the model can focus on the gaps. */
  currentMappings: Array<{ columnIndex: number; fieldKey: string | null }>;
}

export interface AiMatchSuggestion {
  columnIndex: number;
  /** Target field key, or null to leave the column unimported. */
  fieldKey: string | null;
  /** Model's confidence in [0, 1]. Missing is treated as 0.8. */
  confidence?: number;
  /** Shown to the user as the reason for the suggestion. */
  reason?: string;
}

/**
 * Implemented by the host application. Usually a `fetch` to its own endpoint,
 * which holds the API key and calls whichever provider it likes.
 *
 * Rejecting, timing out, or returning an empty array all leave the heuristic
 * result in place — AI matching is never load-bearing.
 */
export type AiMatchFn = (
  input: AiMatchInput,
  signal: AbortSignal,
) => Promise<AiMatchSuggestion[]>;

/** How many sample values per column are worth sending. */
const MAX_SAMPLES = 3;
/** Sample values are truncated: a long cell is noise, not signal. */
const MAX_SAMPLE_LENGTH = 60;
const MAX_OPTIONS = 12;

/** Packs columns and schema into the shape the host matcher receives. */
export function buildMatchInput(
  columns: SourceColumn[],
  fields: NormalizedField[],
  mappings: ColumnMapping[],
): AiMatchInput {
  return {
    columns: columns.map((column) => ({
      index: column.index,
      header: column.header,
      samples: column.samples
        .slice(0, MAX_SAMPLES)
        .map((sample) =>
          sample.length > MAX_SAMPLE_LENGTH ? `${sample.slice(0, MAX_SAMPLE_LENGTH)}…` : sample,
        ),
    })),
    fields: fields
      .filter((field) => !field.hidden)
      .map((field) => ({
        key: field.key,
        label: field.label,
        description: field.description,
        type: field.typeName,
        required: field.requireMapping,
        options:
          field.selectOptions.length > 0
            ? field.selectOptions.slice(0, MAX_OPTIONS).map((option) => option.label)
            : undefined,
      })),
    currentMappings: mappings.map((mapping) => ({
      columnIndex: mapping.columnIndex,
      fieldKey: mapping.fieldKey,
    })),
  };
}

/**
 * A prompt that asks for JSON and nothing else.
 *
 * Provided so hosts do not each invent their own; `parseMatchResponse` expects
 * the shape this asks for. Any model good enough to follow it will do — this is
 * an easy task, so the cheapest tier of any provider is the right choice.
 */
export function buildMatchPrompt(input: AiMatchInput): string {
  const columns = input.columns
    .map((column) => {
      const samples = column.samples.length > 0 ? column.samples.join(' | ') : '(empty)';
      return `  ${column.index}: "${column.header}" — samples: ${samples}`;
    })
    .join('\n');

  const fields = input.fields
    .map((field) => {
      const parts = [`type=${field.type}`];
      if (field.required) parts.push('required');
      if (field.description) parts.push(`description="${field.description}"`);
      if (field.options) parts.push(`options=[${field.options.join(', ')}]`);
      return `  ${field.key}: "${field.label}" (${parts.join(', ')})`;
    })
    .join('\n');

  const current = input.currentMappings
    .map((mapping) => `  ${mapping.columnIndex} -> ${mapping.fieldKey ?? '(none)'}`)
    .join('\n');

  return `You are mapping spreadsheet columns onto a target schema.

SPREADSHEET COLUMNS (index: header — sample values):
${columns}

TARGET SCHEMA FIELDS (key: label):
${fields}

MAPPINGS ALREADY CHOSEN BY A HEURISTIC MATCHER:
${current}

Decide the correct field for every column. Rules:
- Use the sample values, not just the header. A header can be wrong or missing.
- Each field key may be used at most once.
- Use null for columns that fit no field. Do not invent field keys.
- Keep a heuristic mapping when it is right; correct it when it is wrong.
- confidence is your certainty from 0 to 1. Be honest: below 0.6 means unsure.
- reason is a short phrase a non-technical user would understand.

Reply with JSON only, no prose and no code fence:
{"mappings":[{"columnIndex":0,"fieldKey":"firstName","confidence":0.95,"reason":"Values are given names"}]}`;
}

/**
 * Extracts suggestions from raw model output.
 *
 * Tolerates the wrappers models add — code fences, a leading sentence, an
 * object wrapping the array — because the alternative is discarding a good
 * answer over formatting. It does not tolerate a wrong *shape*: entries that
 * are not well-formed are skipped individually rather than failing the batch.
 */
export function parseMatchResponse(raw: string): AiMatchSuggestion[] {
  const json = extractJson(raw);
  if (json === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }

  const list = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.mappings)
      ? parsed.mappings
      : null;
  if (list === null) return [];

  const suggestions: AiMatchSuggestion[] = [];
  for (const entry of list) {
    if (!isRecord(entry)) continue;

    const columnIndex = entry.columnIndex;
    if (typeof columnIndex !== 'number' || !Number.isInteger(columnIndex) || columnIndex < 0) {
      continue;
    }

    const fieldKey =
      typeof entry.fieldKey === 'string' && entry.fieldKey !== '' ? entry.fieldKey : null;

    const confidence =
      typeof entry.confidence === 'number' && Number.isFinite(entry.confidence)
        ? Math.min(1, Math.max(0, entry.confidence))
        : undefined;

    suggestions.push({
      columnIndex,
      fieldKey,
      confidence,
      reason: typeof entry.reason === 'string' ? entry.reason : undefined,
    });
  }

  return suggestions;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Finds the JSON body inside whatever the model wrapped it in. */
function extractJson(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const body = fenced?.[1] !== undefined ? fenced[1].trim() : trimmed;

  if (body.startsWith('{') || body.startsWith('[')) return body;

  // A leading sentence before the JSON: take from the first bracket to its last
  // partner. Slicing to the outermost pair keeps trailing prose out.
  const firstBrace = body.indexOf('{');
  const firstBracket = body.indexOf('[');
  const start =
    firstBrace === -1
      ? firstBracket
      : firstBracket === -1
        ? firstBrace
        : Math.min(firstBrace, firstBracket);
  if (start === -1) return null;

  const closer = body[start] === '{' ? '}' : ']';
  const end = body.lastIndexOf(closer);
  if (end <= start) return null;

  return body.slice(start, end + 1);
}

/** The default confidence for a suggestion that does not state one. */
export const ASSUMED_CONFIDENCE = 0.8;

/**
 * Suggestions below this are dropped rather than shown. A model that says it is
 * unsure is more useful as a blank the user fills in than as a wrong guess they
 * have to notice and undo.
 */
export const MIN_AI_CONFIDENCE = 0.5;

export interface AppliedAiMatch {
  mappings: ColumnMapping[];
  /** Column indexes the AI changed, for the review banner. */
  changedColumns: number[];
  /** Reasons by column index, shown as a hint next to the row. */
  reasons: Map<number, string>;
}

/**
 * Merges suggestions onto the heuristic mappings.
 *
 * Applied strongest-confidence-first for the same reason the heuristic assigns
 * globally: a field must not be claimed by a weak suggestion when a stronger one
 * wants it. Mappings the user already confirmed are never touched — their choice
 * outranks the model's.
 */
export function applyAiSuggestions(
  base: ColumnMapping[],
  suggestions: AiMatchSuggestion[],
  fields: NormalizedField[],
  columns: SourceColumn[],
): AppliedAiMatch {
  const fieldsByKey = new Map(fields.filter((f) => !f.hidden).map((field) => [field.key, field]));
  const validColumns = new Set(columns.map((column) => column.index));

  const result = new Map(base.map((mapping) => [mapping.columnIndex, { ...mapping }]));
  const reasons = new Map<number, string>();
  const changedColumns: number[] = [];

  const usable = suggestions
    .filter((suggestion) => validColumns.has(suggestion.columnIndex))
    .filter((suggestion) => suggestion.fieldKey === null || fieldsByKey.has(suggestion.fieldKey))
    .filter((suggestion) => (suggestion.confidence ?? ASSUMED_CONFIDENCE) >= MIN_AI_CONFIDENCE)
    .sort(
      (a, b) => (b.confidence ?? ASSUMED_CONFIDENCE) - (a.confidence ?? ASSUMED_CONFIDENCE) ||
        a.columnIndex - b.columnIndex,
    );

  // Fields already spoken for by a mapping the AI is not allowed to move.
  const claimed = new Set<string>();
  for (const mapping of result.values()) {
    if (mapping.confirmed && mapping.fieldKey) claimed.add(mapping.fieldKey);
  }

  const seenColumns = new Set<number>();

  for (const suggestion of usable) {
    if (seenColumns.has(suggestion.columnIndex)) continue;
    const current = result.get(suggestion.columnIndex);
    if (!current || current.confirmed) continue;

    if (suggestion.fieldKey !== null) {
      const field = fieldsByKey.get(suggestion.fieldKey);
      if (!field) continue;
      if (claimed.has(suggestion.fieldKey) && !field.manyToOne) continue;
      claimed.add(suggestion.fieldKey);
    }

    seenColumns.add(suggestion.columnIndex);

    // Free the field this column used to hold, so a later suggestion can take it.
    if (current.fieldKey && current.fieldKey !== suggestion.fieldKey) {
      claimed.delete(current.fieldKey);
    }

    const changed = current.fieldKey !== suggestion.fieldKey;
    result.set(suggestion.columnIndex, {
      columnIndex: suggestion.columnIndex,
      fieldKey: suggestion.fieldKey,
      confirmed: false,
      score: suggestion.confidence ?? ASSUMED_CONFIDENCE,
      source: 'ai',
    });
    if (changed) changedColumns.push(suggestion.columnIndex);
    if (suggestion.reason) reasons.set(suggestion.columnIndex, suggestion.reason);
  }

  // A field the AI claimed may still be held by an untouched heuristic mapping.
  // Two passes: register the authoritative claims, then clear the stragglers.
  const merged = base.map((original) => result.get(original.columnIndex) ?? original);

  const authoritative = new Set<string>();
  for (const mapping of merged) {
    if (mapping.fieldKey && (mapping.confirmed || mapping.source === 'ai')) {
      authoritative.add(mapping.fieldKey);
    }
  }

  const mappings = merged.map((mapping) => {
    if (mapping.fieldKey === null) return mapping;
    if (mapping.confirmed || mapping.source === 'ai') return mapping;

    const field = fieldsByKey.get(mapping.fieldKey);
    if (authoritative.has(mapping.fieldKey) && field && !field.manyToOne) {
      return { columnIndex: mapping.columnIndex, fieldKey: null, confirmed: false };
    }
    return mapping;
  });

  return { mappings, changedColumns, reasons };
}
