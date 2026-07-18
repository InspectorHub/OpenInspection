// automation-core/ports.ts — the entire public port surface.

/** Resolves a rule's template by id. OI returns the rule's own subject/body; portal returns its library row. */
export interface ResolvedTemplate {
  channel: 'email' | 'sms';
  subject?: string;
  body: string;
  variables: string[]; // declared template variables (used by requiredVars)
}
export interface TemplateStore {
  resolve(tenantId: string, templateId: string): Promise<ResolvedTemplate | null>;
}

/** The vendored transport: send one message on a channel. Mirrors EmailProvider/MessagingProvider result shape. */
type TransportResult = { ok: true; id?: string } | { ok: false; error: string };
export interface Transport {
  sendEmail(args: { tenantId: string; to: string; subject: string; html: string }): Promise<TransportResult>;
  sendSms(args: { tenantId: string; to: string; body: string }): Promise<TransportResult>;
}

/** Each side owns its own log table; the core only records an outcome. */
type LogStatus = 'sent' | 'failed' | 'skipped';
interface AutomationLogRow {
  logId: string;
  status: LogStatus;
  error?: string;
  deliveredAtMs?: number;
}
export interface AutomationLogger {
  record(row: AutomationLogRow): Promise<void>;
}

/** Injected clock — the ONLY source of current time inside the core. */
export interface Clock {
  nowMs(): number;
}

/** Domain-neutral rule + action models. triggerKey/recipientKey are opaque strings. */
export interface CoreAction {
  channel: 'email' | 'sms';
  templateId: string;
}
export interface CoreCondition {
  requirePaid?: boolean;
  requireSigned?: boolean;
  serviceIds?: string[];
}

export interface ConditionContext {
  triggerKey: string;
  isStale: boolean;
  conditionsJson: string | null;
  paid: boolean;
  signed: boolean;
  bookedServiceIds: string[];
  onMalformedConditions?: (info: { ruleId: string }) => void;
  ruleId: string;
}

export type Verdict = { ok: true } | { ok: false; reason: string };
export type DeliveryOutcome = { status: LogStatus; error?: string };
