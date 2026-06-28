import { z } from '@hono/zod-openapi';

export const SmsOptinConfirmSchema = z.object({
    token: z.string().min(1).describe('Opaque SMS opt-in link token encoding (tenant, contact).'),
}).openapi('SmsOptinConfirm');

export const SmsOptinResolveSchema = z.object({
    token: z.string().min(1).describe('Opaque SMS opt-in link token encoding (tenant, contact).'),
}).openapi('SmsOptinResolve');

export const SmsAttestSchema = z.object({
    inspectionId: z.string().min(1).describe('Inspection whose client contact is being attested.'),
}).openapi('SmsAttest');

export const SmsTestSendSchema = z.object({
    to: z.string().min(3).describe('Destination phone (any format; normalized server-side).'),
}).openapi('SmsTestSend');

export const SmsConsentQuerySchema = z.object({
    inspectionId: z.string().min(1).describe('Inspection whose client consent status is requested.'),
}).openapi('SmsConsentQuery');

// Twilio inbound webhook is application/x-www-form-urlencoded; validated by signature, not zod-body.

// GET /api/manager/sms/compliance — response schema.
// `tollfree` is the raw list of TFV records from the tenant's Twilio account;
// `complianceStatus` is our rolled-up gate value stored in messaging_compliance.
// The managed sub-status fields are only populated for managed_shared / managed_dedicated tenants.
export const SmsComplianceResponseSchema = z.object({
    success: z.literal(true),
    data: z.object({
        mode: z.enum(['platform', 'own', 'managed_shared', 'managed_dedicated']),
        complianceStatus: z.string().nullable(),
        rejectionReason: z.string().nullable(),
        tollfree: z.array(z.object({
            sid: z.string(),
            status: z.string(),
            phoneNumber: z.string(),
        })),
        // Managed sub-statuses (null when tenant is not in managed mode or provisioning not started).
        customerProfileStatus: z.string().nullable(),
        brandStatus: z.string().nullable(),
        campaignStatus: z.string().nullable(),
        tfvStatus: z.string().nullable(),
        messagingServiceSid: z.string().nullable(),
        provisionedNumber: z.string().nullable(),
    }),
}).openapi('SmsComplianceResponse');

// POST /api/manager/sms/compliance/provision — request body schema.
// `tenantId` is ALWAYS read from JWT context; NEVER accepted from the body.
export const SmsComplianceProvisionSchema = z.object({
    businessInfo: z.object({
        legalName: z.string().min(1).describe('Legal business name for TCR/TFV registration.'),
        address: z.string().min(1).describe('Business address (street, city, state, ZIP).'),
        repName: z.string().min(1).describe('Authorized representative name.'),
        areaCode: z.string().optional().describe('Preferred area code for number search (optional).'),
        email: z.string().email().optional().describe('Contact email for Twilio notifications (optional).'),
    }),
    channel: z.enum(['sp10dlc', 'tollfree']).describe('Registration channel: sp10dlc or tollfree.'),
}).openapi('SmsComplianceProvision');

// POST /api/manager/sms/compliance/resubmit — same body as provision (businessInfo + channel).
// Resubmit resumes from the first missing SID; any already-persisted step is skipped via the
// idempotent guard in provision(). A REJECTED entity retains its SID, so provision() skips
// it — re-creating a rejected brand/campaign is a follow-up and not in scope here.
// Reusing SmsComplianceProvisionSchema ensures real businessInfo is supplied for any step
// whose SID is missing, preventing empty-string data being submitted to Twilio.
export const SmsComplianceResubmitSchema = SmsComplianceProvisionSchema.openapi('SmsComplianceResubmit');
