/**
 * Public API types.
 *
 * These mirror the shapes accepted by Dromo's React uploader (`dromo-uploader-react`)
 * so an existing `<DromoUploader fields={...} settings={...} />` call site can be
 * swapped over without rewriting the schema. Props that only mean something against
 * Dromo's backend (license keys, Schema Studio, backend sync, webhooks) are accepted
 * and ignored, so migrating does not require deleting code.
 *
 * Schema reference: https://developer.dromo.io/reference/fields/fields
 */

/* -------------------------------------------------------------------------- */
/* Messages                                                                    */
/* -------------------------------------------------------------------------- */

/** `error` blocks submission, `warning` is yellow, `info` is blue. */
export type MessageLevel = 'error' | 'warning' | 'info';

export interface InfoMessage {
  message: string;
  /** Defaults to `error`. */
  level?: MessageLevel;
}

/* -------------------------------------------------------------------------- */
/* Field types                                                                 */
/* -------------------------------------------------------------------------- */

export type FieldTypeName =
  | 'string'
  | 'number'
  | 'date'
  | 'datetime'
  | 'time'
  | 'select'
  | 'multi-select'
  | 'checkbox'
  | 'email'
  | 'country'
  | 'phone-number'
  | 'ssn'
  | 'domain'
  | 'url'
  | 'us-state-territory'
  | 'us-zip-code'
  | 'uuid';

export interface SelectOption {
  label: string;
  value: string;
  /** Extra source strings that should map onto this option. */
  alternateMatches?: string[];
  /** Only accept the exact `value`/`label`, never a fuzzy match. */
  exactMatchOnly?: boolean;
}

export type NumberPreset =
  | 'default'
  | 'percent'
  | 'plain'
  | 'usd'
  | 'usd_accounting'
  | 'eur'
  | 'gbp'
  | 'decimal_0'
  | 'integer'
  | 'decimal_1'
  | 'decimal_2'
  | 'decimal_3'
  | 'decimal_4'
  | 'percent_0'
  | 'percent_1'
  | 'percent_2'
  | 'percent_3'
  | 'percent_4';

export interface NumberTypeOptions {
  preset?: NumberPreset;
  /** Decimal places to round to. */
  round?: number;
  /** Format shown in the review grid. */
  displayFormat?: string;
  /** Format used in the results. Omit for a plain JS number. */
  outputFormat?: string;
  min?: number;
  max?: number;
}

export interface DateTypeOptions {
  locale?: string;
  displayFormat?: string;
  outputFormat?: string;
  /** Attempt to repair malformed dates. Defaults to true. */
  autofix?: boolean;
  /** Read ambiguous numeric dates as day-first (31/01/2024). */
  dayFirst?: boolean;
}

export interface DatetimeTypeOptions extends DateTypeOptions {
  withSeconds?: boolean;
}

export interface TimeTypeOptions {
  locale?: string;
  displayFormat?: string;
  outputFormat?: string;
  withSeconds?: boolean;
}

export interface SelectTypeOptions {
  /** Keep values matching no option instead of flagging them. Defaults to false. */
  allowCustom?: boolean;
  /** Disable fuzzy matching of source values to options. Defaults to false. */
  exactMatchOnly?: boolean;
}

export interface MultiSelectTypeOptions extends SelectTypeOptions {
  /** Splits a source cell into multiple values. Defaults to ",". */
  delimiter?: string;
  /** Defaults to true. */
  trimValues?: boolean;
}

export interface CountryTypeOptions {
  /** Defaults to "2-letter". */
  format?: '2-letter' | '3-letter';
}

export interface PhoneNumberTypeOptions {
  /** 2-letter ISO country code used to resolve national numbers. */
  country?: string;
  /** Defaults to "international". */
  format?: 'international' | 'national' | 'both';
  /** Output the pretty-printed form rather than E.164. */
  outputFormatted?: boolean;
}

export interface SsnTypeOptions {
  /** Output as `123-45-6789` rather than `123456789`. */
  outputDash?: boolean;
}

export interface DomainTypeOptions {
  /** Defaults to true. */
  allowSubdomains?: boolean;
}

export interface UrlTypeOptions {
  acceptedProtocols?: string[];
  acceptedDomains?: string[];
}

export interface UsZipCodeTypeOptions {
  outputDash?: boolean;
  format?: '5-digit' | '9-digit';
}

export interface UuidTypeOptions {
  version?: number;
}

export interface FieldTypeOptionsMap {
  string: Record<string, never>;
  number: NumberTypeOptions;
  date: DateTypeOptions;
  datetime: DatetimeTypeOptions;
  time: TimeTypeOptions;
  select: SelectTypeOptions;
  'multi-select': MultiSelectTypeOptions;
  checkbox: Record<string, never>;
  email: Record<string, never>;
  country: CountryTypeOptions;
  'phone-number': PhoneNumberTypeOptions;
  ssn: SsnTypeOptions;
  domain: DomainTypeOptions;
  url: UrlTypeOptions;
  'us-state-territory': Record<string, never>;
  'us-zip-code': UsZipCodeTypeOptions;
  uuid: UuidTypeOptions;
}

/**
 * Either a bare type name, or a two-element tuple of the name and its options —
 * e.g. `"number"` or `["number", { round: 2 }]`.
 */
export type FieldType =
  | FieldTypeName
  | { [K in FieldTypeName]: [K, FieldTypeOptionsMap[K]] }[FieldTypeName];

/** Any type options object, useful when writing generic code over field types. */
export type AnyFieldTypeOptions = Partial<
  NumberTypeOptions &
    DatetimeTypeOptions &
    TimeTypeOptions &
    MultiSelectTypeOptions &
    CountryTypeOptions &
    PhoneNumberTypeOptions &
    SsnTypeOptions &
    DomainTypeOptions &
    UrlTypeOptions &
    UsZipCodeTypeOptions &
    UuidTypeOptions
>;

/* -------------------------------------------------------------------------- */
/* Validators                                                                  */
/* -------------------------------------------------------------------------- */

export type ValidatorType =
  | 'required'
  | 'unique'
  | 'unique_case_insensitive'
  | 'unique_with'
  | 'regex_match'
  | 'regex_exclude'
  | 'require_with'
  | 'require_without'
  | 'require_with_all'
  | 'require_without_all'
  | 'require_with_values'
  | 'require_without_values'
  | 'require_with_all_values'
  | 'require_without_all_values'
  | 'length'
  | 'alphabetical';

export interface BaseValidator {
  validate: ValidatorType;
  /** Replaces the generated failure message. */
  errorMessage?: string;
  /** Severity of a failure. Defaults to `error`. */
  level?: MessageLevel;
}

export interface RequiredValidator extends BaseValidator {
  validate: 'required';
}

export interface UniqueValidator extends BaseValidator {
  validate: 'unique' | 'unique_case_insensitive';
}

/** Uniqueness enforced over the tuple of every field sharing a `uniqueKey`. */
export interface UniqueWithValidator extends BaseValidator {
  validate: 'unique_with';
  uniqueKey: string;
}

export interface RegexValidatorOptions {
  ignoreCase?: boolean;
  dotAll?: boolean;
  multiline?: boolean;
  unicode?: boolean;
}

export interface RegexValidator extends BaseValidator {
  validate: 'regex_match' | 'regex_exclude';
  regex: string | RegExp;
  regexOptions?: RegexValidatorOptions;
}

/** Conditional requirement driven by whether sibling fields are filled in. */
export interface RequireWithValidator extends BaseValidator {
  validate: 'require_with' | 'require_without' | 'require_with_all' | 'require_without_all';
  fields: string[];
}

/** Conditional requirement driven by the *values* of sibling fields. */
export interface RequireWithValuesValidator extends BaseValidator {
  validate:
    | 'require_with_values'
    | 'require_without_values'
    | 'require_with_all_values'
    | 'require_without_all_values';
  fieldValues: Record<string, unknown>;
}

export interface LengthValidator extends BaseValidator {
  validate: 'length';
  min?: number;
  max?: number;
}

export interface AlphabeticalValidator extends BaseValidator {
  validate: 'alphabetical';
}

export type Validator =
  | RequiredValidator
  | UniqueValidator
  | UniqueWithValidator
  | RegexValidator
  | RequireWithValidator
  | RequireWithValuesValidator
  | LengthValidator
  | AlphabeticalValidator;

/* -------------------------------------------------------------------------- */
/* Fields                                                                      */
/* -------------------------------------------------------------------------- */

export interface Field {
  /** Human-friendly name shown in the uploader interface. */
  label: string;
  /** Unique identifier, used as the key in the JSON results. */
  key: string;
  /** Defaults to `string`. */
  type?: FieldType;
  /** Shown to the user as help text for this field. */
  description?: string;
  /** Alternate header names that should map to this field. */
  alternateMatches?: string[];
  validators?: Validator[];
  /** Picklist values for `select` / `multi-select` fields. */
  selectOptions?: SelectOption[];
  /** Defaults to false. */
  readOnly?: boolean;
  /** Hidden from the user at all times; still present in results. */
  hidden?: boolean;
  /** The field must be mapped during column matching. Defaults to false. */
  requireMapping?: boolean;
  /** Several data columns may map to this field; its value becomes an array. */
  manyToOne?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                    */
/* -------------------------------------------------------------------------- */

export type InvalidDataBehavior = 'BLOCK_SUBMIT' | 'REMOVE_INVALID_ROWS' | 'INCLUDE_INVALID_ROWS';

export type BackendSyncMode = 'FULL_DATA' | 'MAPPINGS_ONLY' | 'DISABLED';

export interface UploadStepSettings {
  /** Guidance shown on the upload step. */
  helpText?: string;
  /** Auto-select this sheet in a workbook, skipping the sheet picker. */
  sheetOverride?: string;
  /** Download this URL instead of a generated template. */
  templateDownloadOverrideURL?: string;
}

export interface MatchingStepSettings {
  /** Match schema fields to columns rather than the other way round. Defaults to false. */
  matchToSchema?: boolean;
  /** Fuzzy header suggestions. Defaults to true. */
  fuzzyMatchHeaders?: boolean;
  helpText?: string;
  /** 0-indexed header row; earlier rows are discarded and the header step is skipped. */
  headerRowOverride?: number;
  /** Put "Add custom field" at the top of the dropdown. Defaults to false. */
  suggestCustomFirst?: boolean;
}

export interface MatchValuesStepSettings {
  helpText?: string;
  /** Maximum unique values mappable per field. Defaults to 50, capped at 1000. */
  maxMappableSelectValues?: number;
}

export interface ReviewStepSettings {
  /** Shown while hooks run. */
  processingText?: string;
  helpText?: string;
  /** Defaults to true. */
  allowAddingRows?: boolean;
  /** Defaults to true. */
  allowRemovingRows?: boolean;
  /** Highlight cells changed by automatic type fixes. Defaults to false. */
  highlightAutoFixes?: boolean;
  /** Show the error navigation panel. Defaults to false. */
  enableNavigatingErrors?: boolean;
  /** Accepted for parity; only `en` ships with this package. */
  locale?: string;
}

export interface Settings {
  /** Identifies the kind of data being imported; drives the default modal title. */
  importIdentifier?: string;
  /** Modal title. Defaults to `Add ${importIdentifier}`. */
  title?: string;
  /** Defaults to `REMOVE_INVALID_ROWS`. */
  invalidDataBehavior?: InvalidDataBehavior;
  /** Defaults to true. */
  allowEmptySubmit?: boolean;
  /** Hide the manual entry table. Defaults to false. */
  manualInputDisabled?: boolean;
  /** Hide the file dropzone. Cannot be combined with `manualInputDisabled`. */
  manualInputOnly?: boolean;
  /** Let users invent field names during matching. Defaults to false. */
  allowCustomFields?: boolean;
  /** Include unmapped columns in results under `$unmapped`. Defaults to false. */
  passThroughUnmappedColumns?: boolean;
  /** Preload data and skip the upload step. */
  initialData?: Array<Record<string, unknown>> | string[][];
  /** Start from this file, skipping the file picker. */
  initialFile?: File;
  /** Maximum data rows, headers excluded. */
  maxRecords?: number;
  /** Maximum file size in bytes. Defaults to 1 GiB. */
  maxFileSize?: number;
  /** Explicit delimiter, e.g. "|". Auto-detected when omitted. */
  delimiter?: string;
  /** Enables the "Download template" button and names the file. */
  templateDownloadFilename?: string;
  styleOverrides?: StyleOverrides;

  uploadStep?: UploadStepSettings;
  matchingStep?: MatchingStepSettings;
  matchValuesStep?: MatchValuesStepSettings;
  reviewStep?: ReviewStepSettings;

  /* -- Accepted for Dromo parity; no effect in this package ---------------- */

  /** No effect: this package has no backend. */
  backendSyncMode?: BackendSyncMode;
  /** No effect: this package has no backend. */
  webhookUrl?: string;
  /** No effect: there is no usage metering to exclude imports from. */
  developmentMode?: boolean;
  /** No effect: header auto-mapping needs upload history from a backend. */
  autoMapHeaders?: boolean;
  /** No effect: Excel is always parsed in the browser here. */
  browserExcelParsing?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Style overrides                                                             */
/* -------------------------------------------------------------------------- */

export interface GlobalStyleOverrides {
  primaryTextColor?: string;
  secondaryTextColor?: string;
  customFontURL?: string;
  customFontFamily?: string;
  backgroundColor?: string;
  borderRadius?: string;
  borderStyle?: string;
  borderWidth?: string;
  borderColor?: string;
  textColor?: string;
  successColor?: string;
  warningColor?: string;
  errorColor?: string;
  backdropBlur?: string;
}

export interface ButtonStyleOverrides {
  borderRadius?: string;
  backgroundColor?: string;
  textColor?: string;
  border?: string;
  hoverBackgroundColor?: string;
  hoverTextColor?: string;
  hoverBorder?: string;
  disabledBackgroundColor?: string;
  disabledTextColor?: string;
  padding?: string;
}

export interface DropzoneStyleOverrides {
  borderWidth?: string;
  borderRadius?: string;
  borderColor?: string;
  borderStyle?: string;
  backgroundColor?: string;
  outline?: string;
}

export interface DataTableStyleOverrides {
  headerFontWeight?: string;
  headerBackgroundColor?: string;
  headerTextColor?: string;
  rowHeaderBackgroundColor?: string;
  rowHeaderTextColor?: string;
  cornerHeaderBackgroundColor?: string;
  cellSelectionBorderColor?: string;
  cellSelectionBackgroundColor?: string;
  accentColor?: string;
  headerActiveBackgroundColor?: string;
  headerActiveTextColor?: string;
  headerHighlightedBackgroundColor?: string;
  headerHighlightedTextColor?: string;
}

export interface StepperBarStyleOverrides {
  completeColor?: string;
  incompleteColor?: string;
  currentColor?: string;
  fontSize?: string;
  completeFontWeight?: string;
  incompleteFontWeight?: string;
  currentFontWeight?: string;
  backgroundColor?: string;
  borderBottom?: string;
}

export interface HelpTextStyleOverrides {
  backgroundColor?: string;
  textColor?: string;
  borderRadius?: string;
  border?: string;
}

export interface ModalOverlayStyleOverrides {
  backgroundColor?: string;
  opacity?: string;
}

export interface ErrorNavigatorStyleOverrides {
  errorColor?: string;
  warningColor?: string;
  accentColor?: string;
  errorIconUrl?: string;
  warningIconUrl?: string;
}

export interface StyleOverrides {
  global?: GlobalStyleOverrides;
  primaryButton?: ButtonStyleOverrides;
  secondaryButton?: ButtonStyleOverrides;
  tertiaryButton?: ButtonStyleOverrides;
  dropzone?: DropzoneStyleOverrides;
  helpText?: HelpTextStyleOverrides;
  stepperBar?: StepperBarStyleOverrides;
  dataTable?: DataTableStyleOverrides;
  modalOverlay?: ModalOverlayStyleOverrides;
  errorNavigator?: ErrorNavigatorStyleOverrides;
}

/* -------------------------------------------------------------------------- */
/* User                                                                        */
/* -------------------------------------------------------------------------- */

export interface User {
  id: string;
  name?: string;
  email?: string;
  companyId?: string;
  companyName?: string;
  [key: string]: unknown;
}

/* -------------------------------------------------------------------------- */
/* Hooks                                                                       */
/* -------------------------------------------------------------------------- */

export type HookMode = 'init' | 'update';

/** A single cell as seen by row and bulk row hooks. */
export interface HookCell {
  /** The displayed value. Assign to it to change the cell. */
  value: string;
  /** Overrides what lands in the results without changing what the user sees. */
  resultValue?: unknown;
  /** Messages attached to this cell. Replacing the array replaces the messages. */
  info?: InfoMessage[];
  /** For `select` fields: overrides the options offered for this cell. */
  selectOptions?: SelectOption[];
}

export type HookRow = Record<string, HookCell>;

export interface HookRecord {
  /** Position of the record in the current data set, 0-based. */
  index: number;
  row: HookRow;
}

export type RowHookResult = HookRecord | { row: HookRow } | void;

export type RowHook = (
  record: HookRecord,
  mode: HookMode,
) => RowHookResult | Promise<RowHookResult>;

export type BulkRowHook = (
  records: HookRecord[],
  mode: HookMode,
) => HookRecord[] | void | Promise<HookRecord[] | void>;

export interface ColumnHookValue {
  index: number;
  value: string;
  info?: InfoMessage[];
}

export type ColumnHook = (
  values: ColumnHookValue[],
  mode: HookMode,
) => ColumnHookValue[] | void | Promise<ColumnHookValue[] | void>;

export type RowDeleteHook = (record: HookRecord) => void | Promise<void>;

export type StepHookType =
  | 'UPLOAD_STEP'
  | 'REVIEW_STEP'
  | 'REVIEW_STEP_POST_HOOKS'
  | 'REVIEW_STEP_PRE_SUBMIT';

export interface UploadStepData {
  /** Up to the first 20 rows of the file, as raw strings. */
  preview: string[][];
  headers: string[];
  filename: string | null;
}

export interface ReviewStepData {
  records: HookRecord[];
}

export type StepData = UploadStepData | ReviewStepData;

export type StepHook = (instance: UploaderInstance, data: StepData) => void | Promise<void>;

export interface BeforeFinishResult {
  /** Keeps the user on the review screen and suppresses `onResults`. */
  cancel: boolean;
  message?: string;
}

export type BeforeFinishHook = (
  data: ResultRow[],
  metadata: ResultMetadata,
  instance: UploaderInstance,
) => BeforeFinishResult | void | Promise<BeforeFinishResult | void>;

/* -------------------------------------------------------------------------- */
/* Results                                                                     */
/* -------------------------------------------------------------------------- */

export type ResultValue = string | number | boolean | string[] | null;

export type ResultRow = Record<string, ResultValue | Record<string, string>>;

export interface ResultError {
  rowIndex: number;
  fieldKey: string;
  message: string;
  value: unknown;
  level: MessageLevel;
}

export interface ResultFieldMetadata {
  key: string;
  label: string;
  /** Header text of the source column, or null when unmapped. */
  fileHeader: string | null;
  /** Index of the source column in the original file, or null. */
  fileHeaderIndex: number | null;
  /** True when the user invented this field via `allowCustomFields`. */
  isCustom: boolean;
  manyToOne: boolean;
  /** All source columns feeding a `manyToOne` field. */
  mappedHeaders?: string[];
}

export interface ResultMetadata {
  /** Always null here — there is no backend to assign an import id. */
  id: string | null;
  filename: string | null;
  /**
   * The file exactly as the user chose it, for archiving to your own storage.
   * Null for manual entry and for `initialData`.
   *
   * Note this is a live `File`, not JSON: `JSON.stringify(metadata)` will
   * render it as `{}`. Upload it as a body, do not serialize it.
   */
  originalFile: File | null;
  importIdentifier?: string;
  user?: User;
  /** Original file headers, in file order. */
  rawHeaders: string[];
  fields: ResultFieldMetadata[];
  rowsWithError: number[];
  errors: ResultError[];
  totalRows: number;
  validRows: number;
  invalidRows: number;
}

/* -------------------------------------------------------------------------- */
/* Imperative instance                                                         */
/* -------------------------------------------------------------------------- */

export interface InfoMessageUpdate {
  rowIndex: number;
  fieldKey: string;
  messages: InfoMessage[];
}

export interface UploaderInstance {
  open: () => void;
  close: () => void;
  /** Add a field to the schema mid-import. */
  addField: (field: Field, position?: number) => void;
  removeField: (fieldKey: string) => void;
  /** Replace the messages on specific cells. */
  updateInfoMessages: (updates: InfoMessageUpdate[]) => void;
  /** Append rows to the review grid. */
  addRows: (rows: Array<Record<string, unknown>>) => void;
  /** Remove rows by their current index. */
  removeRows: (rowIndexes: number[]) => void;
  /** Read the current review data. */
  getRecords: () => HookRecord[];
  /** Replace the current review data. */
  setRecords: (records: HookRecord[]) => void;
  /** Text shown on the final confirmation dialog. */
  setConfirmationMessage: (message: string | null) => void;
  /** Show a banner at the top of the modal. */
  setMessage: (message: string | null, level?: MessageLevel) => void;
  /** Jump to a step. */
  goToStep: (step: StepId) => void;
}

/** Steps in the import flow, in order. */
export type StepId =
  | 'upload'
  | 'sheet'
  | 'header'
  | 'match'
  | 'matchValues'
  | 'review';

/* -------------------------------------------------------------------------- */
/* Component props                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Adds support for a file format the package does not handle natively.
 * `parseFile` must resolve to a rectangular 2-D array of strings, the first
 * row being the headers.
 */
export interface CustomFileParser {
  /** Extensions to claim, without the dot, e.g. `["xml", "xls"]`. */
  extensions: string[];
  parseFile: (buffer: ArrayBuffer, fileName: string) => string[][] | Promise<string[][]>;
}

export interface ColumnHookRegistration {
  fieldKey: string;
  callback: ColumnHook;
}

export interface StepHookRegistration {
  type: StepHookType;
  callback: StepHook;
}

export interface SheetUploaderProps {
  /** The import schema. */
  fields: Field[];
  settings?: Settings;
  /** User metadata echoed back in `onResults` metadata. */
  user?: User;

  /** Controlled visibility. Omit to let `children` drive it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;

  /** Trigger element; clicking it opens the uploader. */
  children?: React.ReactNode;

  rowHooks?: RowHook[];
  bulkRowHooks?: BulkRowHook[];
  columnHooks?: ColumnHookRegistration[];
  stepHooks?: StepHookRegistration[];
  rowDeleteHooks?: RowDeleteHook[];
  beforeFinish?: BeforeFinishHook;

  /** Handlers for file formats beyond csv/tsv/xlsx/json. */
  fileParsers?: CustomFileParser[];

  onResults?: (data: ResultRow[], metadata: ResultMetadata) => void | Promise<void>;
  onCancel?: () => void;
  /** Called when a file fails to parse or a hook throws. */
  onError?: (error: Error) => void;

  className?: string;

  /* -- Accepted for Dromo parity; no effect in this package ---------------- */

  /** No effect: this package needs no license. */
  licenseKey?: string;
  /** No effect: overrides `settings.developmentMode`, which is itself inert. */
  developmentMode?: boolean;
  /** Overrides `settings.importIdentifier`. */
  importIdentifier?: string;
  /** No effect: Schema Studio is a Dromo backend feature. */
  schemaId?: string;
}
