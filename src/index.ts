/**
 * react-sheet-uploader
 *
 * An embeddable spreadsheet importer for React, API-compatible with Dromo's
 * uploader: the same field schema, settings, hooks and results shape.
 *
 * Remember to import the stylesheet once in your app:
 *   import 'react-sheet-uploader/styles.css';
 */

import './styles.css';

export { SheetUploader, DromoUploader } from './SheetUploader';
export { SheetUploader as default } from './SheetUploader';

/* Types --------------------------------------------------------------------- */

export type {
  // Fields
  Field,
  FieldType,
  FieldTypeName,
  FieldTypeOptionsMap,
  AnyFieldTypeOptions,
  SelectOption,
  NumberPreset,
  NumberTypeOptions,
  DateTypeOptions,
  DatetimeTypeOptions,
  TimeTypeOptions,
  SelectTypeOptions,
  MultiSelectTypeOptions,
  CountryTypeOptions,
  PhoneNumberTypeOptions,
  SsnTypeOptions,
  DomainTypeOptions,
  UrlTypeOptions,
  UsZipCodeTypeOptions,
  UuidTypeOptions,

  // Validators
  Validator,
  ValidatorType,
  BaseValidator,
  RequiredValidator,
  UniqueValidator,
  UniqueWithValidator,
  RegexValidator,
  RegexValidatorOptions,
  RequireWithValidator,
  RequireWithValuesValidator,
  LengthValidator,
  AlphabeticalValidator,

  // Settings
  Settings,
  UploadStepSettings,
  MatchingStepSettings,
  MatchValuesStepSettings,
  ReviewStepSettings,
  InvalidDataBehavior,
  BackendSyncMode,
  User,

  // Styling
  StyleOverrides,
  GlobalStyleOverrides,
  ButtonStyleOverrides,
  DropzoneStyleOverrides,
  DataTableStyleOverrides,
  StepperBarStyleOverrides,
  HelpTextStyleOverrides,
  ModalOverlayStyleOverrides,
  ErrorNavigatorStyleOverrides,

  // Hooks
  HookMode,
  HookCell,
  HookRow,
  HookRecord,
  RowHook,
  RowHookResult,
  BulkRowHook,
  ColumnHook,
  ColumnHookValue,
  ColumnHookRegistration,
  RowDeleteHook,
  StepHook,
  StepHookType,
  StepHookRegistration,
  StepData,
  UploadStepData,
  ReviewStepData,
  BeforeFinishHook,
  BeforeFinishResult,

  // Messages and results
  InfoMessage,
  InfoMessageUpdate,
  MessageLevel,
  ResultRow,
  ResultValue,
  ResultError,
  ResultMetadata,
  ResultFieldMetadata,

  // Component
  SheetUploaderProps,
  UploaderInstance,
  StepId,
  CustomFileParser,
} from './types';

/* Escape hatches ------------------------------------------------------------ */

/**
 * The lower-level pieces, exported for tests, custom UIs and headless use.
 * These are not part of the Dromo compatibility surface and may change more
 * freely than the component API.
 */
export { coerceValue, normalizeField, parseFieldType } from './core/fieldTypes';
export type { NormalizedField, CoercionResult } from './core/fieldTypes';
export { validateRecords } from './core/validators';
export { autoMatchColumns, detectHeaderRow, buildSourceColumns } from './core/matching';
export type { ColumnMapping, SourceColumn } from './core/matching';
export {
  buildMatchInput,
  buildMatchPrompt,
  parseMatchResponse,
  applyAiSuggestions,
} from './core/aiMatch';
export type { AiMatchFn, AiMatchInput, AiMatchSuggestion } from './core/aiMatch';
export { valueTypeScore } from './core/valueSignals';
export { buildRecords, runPipeline } from './core/pipeline';
export { buildResults, canSubmit } from './core/results';
export { buildTemplateCsv, downloadTemplate } from './core/template';
export { parseFile, FileParseError } from './parsers';
export type { ParsedFile, ParsedSheet } from './parsers';
