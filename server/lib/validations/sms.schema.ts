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
