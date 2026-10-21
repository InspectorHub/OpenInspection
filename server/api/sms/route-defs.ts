/**
 * Route definitions of the admin SMS router in ./sms.ts. Moved out of that file unchanged so it stays under its
 * size cap; the handlers and the registration order are in sms.ts. The public opt-in pair stays in sms.ts: it is
 * not guarded by a principal, and the mutating-route allow-list keys that exemption by file.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { requireRole } from '../../lib/middleware/rbac';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import {
    SmsAttestSchema, SmsTestSendSchema, SmsConsentQuerySchema,
    SmsComplianceResponseSchema, SmsComplianceProvisionSchema, SmsComplianceResubmitSchema,
} from '../../lib/validations/sms.schema';

// ─── Admin routes ─────────────────────────────────────────────────────────────

export const attestRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/sms/attest',
    tags: ['admin', 'sms'],
    summary: 'Inspector attestation — confirm the client agreed to receive texts',
    middleware: [requireRole('owner', 'manager')],
    request: { body: { content: { 'application/json': { schema: SmsAttestSchema } } } },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true) }) } }, description: 'Consent recorded' },
    },
    operationId: 'attestSmsConsent',
    description: 'Records a granted SMS consent event (captured_via=admin) for the inspection client contact, auto-creating + linking a contact when the client was free-typed (D6b). The deliberate, accountable basis for phone/in-person bookings.',
}, { scopes: ['admin'], tier: 'extended' }));

export const testSendRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/sms/test',
    tags: ['admin', 'sms'],
    summary: 'Send a one-off test SMS using the resolved Twilio creds',
    middleware: [requireRole('owner', 'manager')],
    request: { body: { content: { 'application/json': { schema: SmsTestSendSchema } } } },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.boolean(), error: z.string().optional() }) } }, description: 'Send result' },
    },
    operationId: 'testSmsSend',
    description: 'Sends a one-off test SMS to the supplied number using the tenant-resolved Twilio credentials (platform env or tenant own). Fail-closed: returns success=false when no creds resolve or the number is unparseable.',
}, { scopes: ['admin'], tier: 'extended' }));

export const smsConfigRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/sms/config',
    tags: ['admin', 'sms'],
    summary: 'Effective SMS sender configuration (mode + source, no secrets)',
    middleware: [requireRole('owner', 'manager')],
    responses: {
        200: { content: { 'application/json': { schema: z.object({
            success: z.literal(true),
            data: z.object({
                mode: z.enum(['platform', 'own', 'managed_shared', 'managed_dedicated']),
                effectiveSource: z.enum(['platform', 'own', 'managed', 'none']),
            }),
        }) } }, description: 'Effective SMS configuration' },
    },
    operationId: 'getSmsConfig',
    description: 'Returns the tenant SMS sender mode and the effective credential source (platform env, tenant own, the platform-managed pool, or none) WITHOUT leaking any secret values. Drives the "Using platform SMS" / "Using your Twilio" / managed-unavailable line in Settings; "managed" is resolved from the API-key triple + Messaging Service SID the managed send path uses, not from the account/token/from bag (see resolveTwilioSourceForTenant).',
}, { scopes: ['read'], tier: 'extended' }));

export const consentStatusRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/sms/consent',
    tags: ['admin', 'sms'],
    summary: 'Latest SMS consent status for an inspection client',
    middleware: [requireRole('owner', 'manager', 'inspector')],
    request: { query: SmsConsentQuerySchema },
    responses: {
        200: { content: { 'application/json': { schema: z.object({
            success: z.literal(true),
            data: z.object({ consent: z.enum(['granted', 'revoked', 'none']) }),
        }) } }, description: 'Consent status' },
    },
    operationId: 'getSmsConsentStatus',
    description: 'Returns the latest SMS consent action for the inspection client contact (granted/revoked/none) for the inspection-view status display. For a caller whose access is limited to the inspections assigned to them, an item tied to an inspection outside that set is answered as not found.',
}, { scopes: ['admin'], tier: 'extended' }));

export const complianceRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/sms/compliance',
    tags: ['admin', 'sms'],
    summary: 'SMS compliance status — BYO toll-free verification + managed sub-statuses',
    middleware: [requireRole('owner', 'manager')],
    responses: {
        200: { content: { 'application/json': { schema: SmsComplianceResponseSchema } }, description: 'Compliance status snapshot' },
    },
    operationId: 'getSmsCompliance',
    description: 'Returns the rolled-up compliance gate plus managed sub-statuses (customerProfileStatus, brandStatus, campaignStatus, tfvStatus, messagingServiceSid, provisionedNumber). For own-mode tenants also reads the live Twilio account. Degrades gracefully (returns stored status or not_started) when credentials are absent or Twilio is unreachable.',
}, { scopes: ['read'], tier: 'extended' }));

// POST /api/manager/sms/compliance/provision — SaaS-only, owner/manager.
export const complianceProvisionRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/sms/compliance/provision',
    tags: ['admin', 'sms'],
    summary: 'Kick off managed SMS compliance provisioning for this tenant',
    middleware: [requireRole('owner', 'manager')],
    request: { body: { content: { 'application/json': { schema: SmsComplianceProvisionSchema } }, required: true } },
    responses: {
        200: { content: { 'application/json': { schema: SmsComplianceResponseSchema } }, description: 'Current compliance status (provision runs in background)' },
        403: { description: 'Not available in standalone mode' },
        409: { description: 'Managed Twilio credentials not configured on this deployment' },
    },
    operationId: 'provisionSmsCompliance',
    description: 'Kicks off the managed TCR/TFV provisioning chain (waitUntil background). Returns the CURRENT stored status immediately — provisioning completes asynchronously. SaaS-only; requires TWILIO_ACCOUNT_SID / TWILIO_API_KEY_SID / TWILIO_API_KEY_SECRET env vars.',
}, { scopes: ['admin'], tier: 'extended' }));

// POST /api/manager/sms/compliance/resubmit — SaaS-only, owner/manager.
export const complianceResubmitRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/sms/compliance/resubmit',
    tags: ['admin', 'sms'],
    summary: 'Resume managed SMS compliance provisioning from the first missing step',
    middleware: [requireRole('owner', 'manager')],
    request: { body: { content: { 'application/json': { schema: SmsComplianceResubmitSchema } }, required: true } },
    responses: {
        200: { content: { 'application/json': { schema: SmsComplianceResponseSchema } }, description: 'Current compliance status after resuming provisioning in background' },
        403: { description: 'Not available in standalone mode' },
        409: { description: 'Managed Twilio credentials not configured on this deployment' },
    },
    operationId: 'resubmitSmsCompliance',
    description: 'Idempotent re-run of the managed provisioning chain (waitUntil background). Skips any step whose SID is already persisted, resuming from the first missing step. SaaS-only; requires TWILIO_ACCOUNT_SID / TWILIO_API_KEY_SID / TWILIO_API_KEY_SECRET env vars.',
}, { scopes: ['admin'], tier: 'extended' }));
