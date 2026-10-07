export type PageBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export const ELEMENT_ACTIONS = [
  'activate',
  'set-value',
  'set-checked',
  'choose-option',
] as const;

export type ElementAction = (typeof ELEMENT_ACTIONS)[number];

export type ObservedOption = {
  label: string;
  value?: string;
  selected?: boolean;
  disabled?: boolean;
  elementId?: string;
};

export type ObservedElement = {
  id: string;
  tag: string;
  role: string;
  name: string;
  label?: string;
  description?: string;
  section?: string;
  /** One-based position within a repeated form section. */
  recordIndex?: number;
  recordCount?: number;
  fieldPath?: string;
  /** Hints injected by Nowcoder into this DOM only; not resume source identity. */
  nowcoderHint?: { className?: string; label?: string; group?: string };
  type?: string;
  uploadable?: boolean;
  accept?: string;
  multiple?: boolean;
  files?: { name: string; type: string; size: number }[];
  cursor?: string;
  value?: string;
  valueText?: string;
  href?: string;
  placeholder?: string;
  visible: boolean;
  visibility: 'visible' | 'offscreen';
  clickable: boolean;
  actionable: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  checked?: boolean;
  nativeChecked?: boolean;
  checkedSource?: 'native' | 'aria' | 'phoenix';
  checkedConflict?: boolean;
  selected?: boolean;
  expanded?: boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: ObservedOption[];
  actions: ElementAction[];
  box?: PageBox;
};

export type InteractionContext = {
  id: string;
  role: string;
  name: string;
};

export type ResumeScanField = {
  elementId: string;
  triggerElementId?: string;
  expanded?: boolean;
  label: string;
  section?: string;
  recordIndex?: number;
  fieldPath?: string;
  role: string;
  type?: string;
  valueText?: string;
  state: 'present' | 'empty' | 'unknown' | 'disabled' | 'file_receipt';
  required?: boolean;
  disabled?: boolean;
  visible: boolean;
  nowcoderHint?: ObservedElement['nowcoderHint'];
  upload?: import('./resume-form').ResumeUploadInfo;
};

export type ResumeScanRecord = {
  recordIndex: number;
  elementId: string;
  fieldIds: string[];
  /** Current, redacted values of identifying fields; not a source-record mapping. */
  identity: Array<{ elementId: string; label: string; valueText: string }>;
  /** Present only for one explicitly named delete action local to this record. */
  deleteElementId?: string;
};

export type ResumeFormScan = {
  url: string;
  title: string;
  revision: number;
  documentId: string;
  coverage: 'current-dom';
  summary: { fields: number; present: number; empty: number; disabled: number; invalid: number; nowcoderWarnings: number };
  sections: Array<{ name: string; elementId: string; recordCount: number; records: ResumeScanRecord[] }>;
  fields: ResumeScanField[];
  issues: Array<{ elementId: string; kind: 'site_validation' | 'empty' | 'nowcoder_warning' | 'disabled_dependency' | 'checked_conflict' | 'file_receipt_unconfirmed' | 'selection_unconfirmed'; severity: 'error' | 'warning' | 'info'; message: string }>;
  navigationHints: Array<{ elementId: string; label: string; kind: 'collapsed' | 'pagination' | 'add_record' | 'next_step' }>;
};

export type ObservationScope = 'auto' | 'page' | 'interaction';

export type ElementTreeFields = {
  text?: boolean;
  coordinates?: boolean;
  attributes?: string[];
};

export type ElementTreeOptions = {
  fields?: ElementTreeFields;
  maxDepth?: number;
  maxLength?: number;
  revision?: number;
};

export type LightweightElementTree = {
  rootElementId: string;
  totalLabels: number;
  emittedLabels: number;
  truncated: boolean;
  tree: string;
};

export type PageObservation = {
  url: string;
  title: string;
  revision: number;
  documentId: string;
  scope: 'page' | 'interaction-context';
  scopeReason: string;
  fallbackApplied: boolean;
  viewport: {
    width: number;
    height: number;
    scrollX: number;
    scrollY: number;
  };
  selection: string;
  headings: string[];
  formSections?: Array<{ name: string; recordCount: number; elementId: string }>;
  frames: Array<{
    index: number;
    sameOrigin: boolean;
    url?: string;
  }>;
  interactionContext?: InteractionContext;
  elements: ObservedElement[];
  offset?: number;
  nextOffset?: number;
  totalElements: number;
  truncated: boolean;
  textPreview: string;
};

export type InteractionStep = {
  elementId: string;
  intent: ElementAction;
  value?: string | boolean | number;
  revision?: number;
};

export type InteractionResult = {
  elementId: string;
  intent: ElementAction;
  ok: boolean;
  changed: boolean;
  satisfied: boolean;
  triggered?: boolean;
  targetRemoved?: boolean;
  stable?: boolean;
  verificationStatus?: FormFieldVerification['status'] | 'superseded';
  before?: Pick<ObservedElement, 'value' | 'valueText' | 'checked' | 'selected' | 'expanded'>;
  after?: Pick<ObservedElement, 'value' | 'valueText' | 'checked' | 'selected' | 'expanded'>;
  error?: string;
};

export type FormFieldExpectation = Omit<InteractionStep, 'intent' | 'value'> & {
  intent: Exclude<ElementAction, 'activate'>;
  value: string | boolean | number;
};

export type FormFieldVerification = {
  elementId: string;
  intent: FormFieldExpectation['intent'];
  ok: boolean;
  stable: boolean;
  satisfied: boolean;
  status: 'verified' | 'mismatch' | 'unstable' | 'invalid' | 'unavailable';
  actual?: InteractionResult['after'];
  error?: string;
};

export const NAMED_SCRIPTS = [
  'extract_links',
  'extract_headings',
  'extract_forms',
  'extract_interactions',
  'extract_meta',
  'page_stats',
  'get_selection',
] as const;

export type NamedScript = (typeof NAMED_SCRIPTS)[number];

export const SOURCE_TYPES = [
  'dom',
  'page',
  'url',
  'title',
  'text',
  'links',
  'scripts',
  'stylesheets',
] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];
