import type { ComplianceStateStore } from './compliance-state-store';

export type ComplianceProviderId = 'twilio' | 'telnyx';
export type ComplianceChannel = 'sp10dlc' | 'tollfree';

export const COMPLIANCE_STATUSES = [
  'not_started', 'profile_pending', 'brand_pending', 'campaign_pending', 'tfv_pending', 'approved', 'rejected',
] as const;

export function isComplianceChannel(v: string): v is ComplianceChannel {
  return v === 'sp10dlc' || v === 'tollfree';
}

export interface ProvisionInput {
  tenantId: string;
  channel: ComplianceChannel;
  businessInfo: { legalName: string; address: string; repName: string; areaCode?: string | undefined; email?: string | undefined };
  statusCallbackUrl?: string | undefined;
}

export interface ComplianceSnapshot { complianceStatus: string; rejectionReason: string | null; }

/** Normalized webhook event (identical shape to compliance-webhook's ComplianceEvent). */
export interface ComplianceEvent {
  entity: 'brand' | 'campaign' | 'tfv';
  rawStatus: string;
  rejectionReason: string | null;
  entitySid: string;
}

export interface WebhookVerifyCtx {
  url: string; headers: Record<string, string>; rawBody: string; params: Record<string, string>; secret: string; nowMs?: number;
}

export interface ComplianceProvider {
  readonly id: ComplianceProviderId;
  provision(input: ProvisionInput, store: ComplianceStateStore): Promise<ComplianceSnapshot>;
  verifyWebhookSignature(ctx: WebhookVerifyCtx): Promise<boolean>;
  parseCallback(headers: Record<string, string>, rawBody: string): ComplianceEvent | null;
  syncStatus(input: { tenantId: string }, store: ComplianceStateStore): Promise<ComplianceSnapshot>;
  webhookUrl(baseUrl: string, tenantSlug: string): string;
}
