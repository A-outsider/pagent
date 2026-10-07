/** Reused by direct MCP contexts for one application; elapsed thinking time counts too. */
type Args = Record<string, unknown>;
type Field = { elementId?: string; sourcePath?: string; intent?: string; value?: unknown; text?: unknown };
type Expectation = { sourcePath?: string; intent?: string; valueFingerprint?: string };
type Recovery = { milliseconds: number; noProgress: number; expectation?: Expectation; deferred: boolean };

export type ResumeBudgetMetadata = { diagnostic?: boolean; fieldIds?: string[] };
export type ResumeBudgetDeferral = {
  allowed: false;
  ok: false;
  status: 'deferred';
  action: 'continue_other_pages' | 'fill_known_fields';
  reason: 'main_time_limit' | 'review_time_limit' | 'review_already_entered' | 'diagnostic_time_limit' | 'diagnostic_call_limit' | 'field_recovery_time_limit' | 'field_recovery_attempt_limit';
  fields?: string[];
  elementIds?: string[];
};
export type ResumeBudgetDecision = { allowed: true } | ResumeBudgetDeferral;
export type ResumeBudgetSnapshot = {
  phase: 'main' | 'review';
  phaseLimitReached: boolean;
  activeMilliseconds: number;
  mainMilliseconds: number;
  reviewMilliseconds: number;
  diagnostics: { milliseconds: number; calls: number };
  diagnosticsByPhase: Record<'main' | 'review', { milliseconds: number; calls: number }>;
  deferred: Array<{ field: string; phase: 'main' | 'review'; noProgress: number; milliseconds: number }>;
  lastDeferral?: ResumeBudgetDeferral;
};

const LIMIT = { main: 300_000, review: 180_000, diagnostic: 90_000, diagnosticCalls: 6, recovery: 45_000, recoveryAttempts: 3 };
const OBSERVATIONS = new Set(['observe_page', 'observe_page_changes', 'search_page_text', 'capture_screenshot', 'scan_resume_form',
  'extract_interactions', 'inspect_element_tree', 'find_common_ancestor', 'execute_named_script', 'get_source',
  'get_network_log', 'get_console_log', 'get_network_request', 'wait_for']);
const RAW = new Set(['execute_cdp_script', 'execute_cdp_command', 'cdp_click_xy']);
const EDITS = new Set(['interact_elements', 'type_text', 'clear_field', 'select_option', 'click_element', 'dblclick_element',
  'hover_element', 'press_key', 'drag_element', 'upload_attachment']);
const UNLIMITED = new Set(['get_resume_progress', 'record_resume_progress', 'resume_execution_phase', 'browser_end_task', 'end_task',
  'list_tabs', 'page_info', 'navigate', 'go_back', 'go_forward', 'switch_tab', 'open_tab', 'close_tab']);
const sourceRead = (name: string) => /(?:^|_)(?:get_resume|lookup_resume_fields)$/.test(name);
const object = (value: unknown): Args | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Args : undefined;

/** Read actual tool receipts, including ToolMessage and MCP text content. */
function receipt(result: unknown): unknown {
  if (typeof result === 'string') {
    const wrapped = /```untrusted-page\n([\s\S]*?)\n```/.exec(result);
    const text = (wrapped?.[1] ?? result).trim();
    try { return receipt(JSON.parse(text)); } catch { /* A tool may append guidance after its JSON. */ }
    const start = text.search(/[\[{]/);
    let depth = 0, quoted = false, escaped = false;
    for (let i = start; start >= 0 && i < text.length; i++) {
      const char = text[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === '{' || char === '[') depth++;
      else if ((char === '}' || char === ']') && --depth === 0) {
        try { return receipt(JSON.parse(text.slice(start, i + 1))); } catch { return undefined; }
      }
    }
    return undefined;
  }
  const value = object(result);
  if (value?.structuredContent !== undefined) return receipt(value.structuredContent);
  if (value?.content !== undefined) {
    if (Array.isArray(value.content)) {
      for (const part of value.content) {
        const item = object(part);
        if (item?.type === 'text') { const parsed = receipt(item.text); if (parsed !== undefined) return parsed; }
      }
      return undefined;
    }
    return receipt(value.content);
  }
  return result;
}

function requestedFields(name: string, args: Args): Field[] {
  const entries = name === 'interact_elements' ? args.steps : name === 'verify_form_fields' ? args.fields : [args];
  return (Array.isArray(entries) ? entries : []).flatMap(item => {
    const field = object(item);
    return field && (typeof field.elementId === 'string' || typeof field.sourcePath === 'string') ? [field as Field] : [];
  });
}

// The per-application budget outlives source contexts. Keep no original personal values.
function expectation(name: string, field: Field): Expectation {
  const value = field.value ?? field.text ?? (name === 'clear_field' ? '' : undefined);
  if (value === undefined) return { sourcePath: field.sourcePath, intent: field.intent };
  let hash = 0xcbf29ce484222325n;
  for (const character of `${typeof value}:${String(value)}`) {
    hash ^= BigInt(character.codePointAt(0)!);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return { sourcePath: field.sourcePath, intent: field.intent, valueFingerprint: hash.toString(16) };
}

export class ResumeExecutionBudget {
  private readonly now: () => number;
  private phase: 'main' | 'review' = 'main';
  private active = false;
  private lastTime: number;
  private mainMilliseconds = 0;
  private reviewMilliseconds = 0;
  private readonly diagnosticBudgets = { main: { milliseconds: 0, calls: 0 }, review: { milliseconds: 0, calls: 0 } };
  private diagnosing = false;
  private aliases = new Map<string, string>();
  private readonly phaseRecoveries = { main: new Map<string, Recovery>(), review: new Map<string, Recovery>() };
  private currentRecoveryKeys: string[] = [];
  private expectations = new Map<string, Expectation>();
  private verifiedOnce = new Set<string>();
  private pending?: { name: string; recoveryKeys: string[] };
  private lastDeferral?: ResumeBudgetDeferral;

  constructor(options: { now?: () => number } = {}) { this.now = options.now ?? Date.now; this.lastTime = this.now(); }

  activate(): void { this.accrue(); this.active = true; }
  pause(): void { this.accrue(); this.active = false; }

  enterReview(): ResumeBudgetDecision {
    this.accrue();
    if (this.phase === 'review') return this.defer('review_already_entered', 'continue_other_pages');
    // Deferred main-pass fields get a separate concentrated recovery window.
    for (const [key, recovery] of this.recoveries) this.phaseRecoveries.review.set(key,
      { milliseconds: 0, noProgress: 0, expectation: recovery.expectation, deferred: false });
    this.phase = 'review';
    this.diagnosing = false;
    this.currentRecoveryKeys = [];
    this.pending = undefined;
    return { allowed: true };
  }

  before(name: string, args: Args, metadata: ResumeBudgetMetadata = {}): ResumeBudgetDecision {
    this.accrue();
    this.pending = undefined;
    if (sourceRead(name) || UNLIMITED.has(name)) return { allowed: true };
    this.diagnosing = false;
    this.currentRecoveryKeys = [];
    const fields = requestedFields(name, args);
    const keys = this.keys(fields, metadata);
    // The first independent check reads the outcome; it is not another recovery attempt.
    // Exclude it from both local rejection and the invocation's inherited deadline.
    const recoveryKeys = keys.filter(key => this.recoveries.has(key)
      && (name !== 'verify_form_fields' || this.verifiedOnce.has(key)));
    const diagnostic = metadata.diagnostic === true || RAW.has(name)
      || (name === 'verify_form_fields' && recoveryKeys.some(key => this.verifiedOnce.has(key)))
      || (OBSERVATIONS.has(name) && recoveryKeys.length > 0)
      || (EDITS.has(name) && !fields.some(field => this.isFieldWrite(name, field)) && recoveryKeys.length > 0);
    const blockedKeys: string[] = [];
    let blockedReason: ResumeBudgetDeferral['reason'] | undefined;
    for (const key of recoveryKeys) {
      const recovery = this.recoveries.get(key)!;
      if (recovery.milliseconds >= LIMIT.recovery) {
        recovery.deferred = true;
        blockedKeys.push(key);
        blockedReason ??= 'field_recovery_time_limit';
      } else if (recovery.noProgress >= LIMIT.recoveryAttempts) {
        recovery.deferred = true;
        blockedKeys.push(key);
        blockedReason ??= 'field_recovery_attempt_limit';
      }
    }
    if (blockedReason) return this.defer(blockedReason, 'fill_known_fields', blockedKeys,
      fields.flatMap(field => field.elementId && blockedKeys.includes(this.key(field) ?? '') ? [field.elementId] : []));
    if (diagnostic) {
      const diagnostics = this.diagnosticBudgets[this.phase];
      if (diagnostics.milliseconds >= LIMIT.diagnostic) return this.defer('diagnostic_time_limit', 'fill_known_fields');
      if (diagnostics.calls >= LIMIT.diagnosticCalls) return this.defer('diagnostic_call_limit', 'fill_known_fields');
      diagnostics.calls++;
      this.diagnosing = true;
    }
    this.currentRecoveryKeys = recoveryKeys;
    for (const field of fields) {
      const key = this.key(field);
      if (key && this.isFieldWrite(name, field) && !this.recoveries.has(key)) this.expectations.set(key, expectation(name, field));
    }
    this.pending = { name, recoveryKeys };
    return { allowed: true };
  }

  after(name: string, args: Args, result: unknown, metadata: ResumeBudgetMetadata = {}): void {
    this.accrue();
    if (name === 'record_resume_progress' && Array.isArray(args.records)) for (const item of args.records) {
      const record = object(item);
      if (typeof record?.sourcePath === 'string' && Array.isArray(record.elementIds)) {
        for (const id of record.elementIds) if (typeof id === 'string') this.key({ sourcePath: record.sourcePath, elementId: id });
      }
    }
    if (sourceRead(name) || UNLIMITED.has(name)) return;
    const fields = requestedFields(name, args);
    const recovering = this.pending?.name === name ? this.pending.recoveryKeys : this.keys(fields, metadata).filter(key => this.recoveries.has(key));
    this.pending = undefined;
    const parsed = receipt(result);
    const values = (Array.isArray(parsed) ? parsed : [parsed]).map(object).filter((item): item is Args => !!item);
    const outer = object(result);
    const failedReceipt = outer?.status === 'error' || outer?.isError === true || (values.length === 1 && values[0]?.ok === false);
    const progressed = new Set<string>();
    for (const field of fields) {
      const key = this.key(field);
      if (!key) continue;
      const item = values.find(value => value.elementId === field.elementId) ?? (fields.length === 1 ? values[0] : undefined);
      if (name === 'verify_form_fields') this.verifiedOnce.add(key);
      const expected = this.recoveries.get(key)?.expectation ?? this.expectations.get(key) ?? expectation(name, field);
      if (item && this.progress(name, field, expected, item)) {
        progressed.add(key);
        this.recoveries.delete(key);
        continue;
      }
      const attemptedWrite = this.isFieldWrite(name, field);
      const canRecover = attemptedWrite || (name === 'verify_form_fields' && (this.expectations.has(key) || this.recoveries.has(key)));
      if (canRecover && (failedReceipt || item?.ok === false
        || (field.intent !== 'activate' && this.isFieldWrite(name, field) && item?.satisfied === false)
        || (name === 'verify_form_fields' && item?.satisfied === false))) {
        if (!this.recoveries.has(key)) this.recoveries.set(key, { milliseconds: 0, noProgress: 0, expectation: expected, deferred: false });
      }
    }
    for (const key of new Set(recovering)) {
      const recovery = this.recoveries.get(key);
      if (recovery && !progressed.has(key)) recovery.noProgress++;
    }
  }

  failure(name: string, args: Args, metadata: ResumeBudgetMetadata = {}): void { this.after(name, args, { ok: false }, metadata); }

  /** Only diagnostics and field recovery impose invocation deadlines; phase time schedules work. */
  remainingMilliseconds(): number | undefined {
    this.accrue();
    if (!this.pending) return undefined;
    const remaining: number[] = [];
    if (this.diagnosing) remaining.push(LIMIT.diagnostic - this.diagnosticBudgets[this.phase].milliseconds);
    for (const key of this.pending.recoveryKeys) {
      const recovery = this.recoveries.get(key);
      if (recovery) remaining.push(LIMIT.recovery - recovery.milliseconds);
    }
    return remaining.length ? Math.max(0, Math.min(...remaining)) : undefined;
  }

  snapshot(): ResumeBudgetSnapshot {
    this.accrue();
    return { phase: this.phase,
      phaseLimitReached: (this.phase === 'main' ? this.mainMilliseconds : this.reviewMilliseconds) >= LIMIT[this.phase],
      activeMilliseconds: this.activeMilliseconds,
      mainMilliseconds: this.mainMilliseconds, reviewMilliseconds: this.reviewMilliseconds,
      diagnostics: { milliseconds: this.diagnosticBudgets.main.milliseconds + this.diagnosticBudgets.review.milliseconds,
        calls: this.diagnosticBudgets.main.calls + this.diagnosticBudgets.review.calls },
      diagnosticsByPhase: { main: { ...this.diagnosticBudgets.main }, review: { ...this.diagnosticBudgets.review } },
      deferred: (['main', 'review'] as const).flatMap(phase => [...this.phaseRecoveries[phase]]
        .filter(([, field]) => field.deferred || field.noProgress >= LIMIT.recoveryAttempts || field.milliseconds >= LIMIT.recovery)
        .map(([field, recovery]) => ({ field, phase, noProgress: recovery.noProgress, milliseconds: recovery.milliseconds }))),
      ...(this.lastDeferral ? { lastDeferral: this.lastDeferral } : {}) };
  }

  private get activeMilliseconds(): number { return this.mainMilliseconds + this.reviewMilliseconds; }
  private get recoveries(): Map<string, Recovery> { return this.phaseRecoveries[this.phase]; }
  private accrue(): void {
    const time = this.now();
    const elapsed = Math.max(0, time - this.lastTime);
    this.lastTime = time;
    if (!this.active) return;
    if (this.phase === 'main') this.mainMilliseconds += elapsed;
    else this.reviewMilliseconds += elapsed;
    if (this.diagnosing) this.diagnosticBudgets[this.phase].milliseconds += elapsed;
    for (const key of this.currentRecoveryKeys) {
      const recovery = this.recoveries.get(key);
      if (recovery) recovery.milliseconds += elapsed;
    }
  }

  private key(field: Field): string | undefined {
    if (field.sourcePath) {
      const key = `source:${field.sourcePath}`;
      if (field.elementId) {
        const old = this.aliases.get(field.elementId) ?? `id:${field.elementId}`;
        if (old.startsWith('id:') && old !== key) {
          for (const recoveries of Object.values(this.phaseRecoveries)) {
            const recovery = recoveries.get(old);
            if (recovery && !recoveries.has(key)) {
              if (recovery.expectation) recovery.expectation = { ...recovery.expectation, sourcePath: field.sourcePath };
              recoveries.set(key, recovery);
            }
            recoveries.delete(old);
          }
          this.currentRecoveryKeys = [...new Set(this.currentRecoveryKeys.map(current => current === old ? key : current))];
          if (this.verifiedOnce.delete(old)) this.verifiedOnce.add(key);
          const expectation = this.expectations.get(old);
          if (expectation) { this.expectations.set(key, { ...expectation, sourcePath: field.sourcePath }); this.expectations.delete(old); }
        }
        this.aliases.set(field.elementId, key);
      }
      return key;
    }
    return field.elementId ? this.aliases.get(field.elementId) ?? `id:${field.elementId}` : undefined;
  }

  private keys(fields: Field[], metadata: ResumeBudgetMetadata): string[] {
    return [...new Set([...fields, ...(metadata.fieldIds ?? []).map(elementId => ({ elementId }))].flatMap(field => {
      const key = this.key(field); return key ? [key] : [];
    }))];
  }
  private isFieldWrite(name: string, field: Field): boolean {
    return (name === 'interact_elements' && field.intent !== 'activate') || ['type_text', 'clear_field', 'select_option'].includes(name);
  }
  private progress(name: string, field: Field, expected: Expectation, item: Args): boolean {
    if (name !== 'verify_form_fields' && !this.isFieldWrite(name, field)) return false;
    if (item.ok !== true || item.satisfied !== true) return false;
    if (name === 'verify_form_fields' && (item.stable !== true || item.status !== 'verified')) return false;
    if (item.verificationStatus && item.verificationStatus !== 'verified') return false;
    if (item.expectedSourcePath !== undefined && item.expectedSourcePath !== (field.sourcePath ?? expected.sourcePath)) return false;
    if (expected.intent && field.intent && expected.intent !== field.intent) return false;
    if (expected.sourcePath && field.sourcePath === expected.sourcePath) return true;
    const actual = expectation(name, field);
    return expected.valueFingerprint !== undefined && expected.valueFingerprint === actual.valueFingerprint;
  }
  private defer(reason: ResumeBudgetDeferral['reason'], action: ResumeBudgetDeferral['action'], fields?: string[], elementIds?: string[]): ResumeBudgetDeferral {
    this.lastDeferral = { allowed: false, ok: false, status: 'deferred', action, reason, ...(fields ? { fields } : {}),
      ...(elementIds?.length ? { elementIds: [...new Set(elementIds)] } : {}) };
    return this.lastDeferral;
  }
}
