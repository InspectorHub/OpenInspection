/**
 * Zod schemas for /api/integrations routes.
 * Schemas live here per project validation rules — not inline in route handlers.
 */
import { z } from '@hono/zod-openapi';

/** Providers supported by the generic validate-credentials endpoint. */
const EmailProviderEnum = z.enum(['resend', 'sendgrid', 'postmark', 'mailgun']);

/** Request body for POST /email/validate. */
export const EmailValidateBodySchema = z
    .object({
        provider: EmailProviderEnum.describe('The email provider whose stored credentials should be validated.'),
    })
    .openapi('EmailValidateBody');

/** 200 success response for POST /email/validate. */
export const EmailValidateOkSchema = z
    .object({
        success: z.literal(true),
        data: z.object({ ok: z.literal(true) }),
    })
    .openapi('EmailValidateOk');

/**
 * Request body for POST /ai/test.
 *
 * The whole configuration, not a reference to a stored one. The probe exists
 * to answer "will what I am about to save actually work", and a body carrying
 * only an id would send it back to reading the same row the workspace is in
 * the middle of changing.
 *
 * `baseUrl` is `.url()` so an unparseable address is refused by validation
 * rather than surfacing later as an unreachable-host result that blames the
 * network. `apiKey` is accepted here and never echoed back — see
 * `lib/ai/connection-test.ts`.
 */
/**
 * What a workspace saves as its AI provider configuration.
 *
 * Blank is allowed and MEANS UNSET — the endpoint boxes are how a workspace
 * clears a destination, so refusing an empty string here would leave them with
 * no way to undo one. `saveAiConfig` turns blank into null; this schema only
 * decides what the client may send.
 */
export const AiConfigBodySchema = z.object({
    aiEnabled: z.boolean().describe('Whether this workspace may be offered AI at all.'),
    aiBaseUrl: z.string().max(300).describe('OpenAI-compatible base URL. Blank means unset.'),
    aiModel: z.string().max(200).describe('Model id to send. Blank means unset.'),
    courtesyTranslationEnabled: z.boolean()
        .describe('Whether this workspace may PRODUCE a courtesy translation of a report. Gates production only — switching it off stops new translations being made and never removes one already delivered, because reader paths answer from stored rows and never consult this. Defaults false, unlike aiEnabled beside it: this is a decision to spend on every publish, and off is the absence of a choice.'),
}).openapi('AiConfigBody');

export const AiConnectionTestBodySchema = z
    .object({
        baseUrl: z.string().url().describe('Root of an OpenAI-compatible API, e.g. https://host/v1.'),
        model: z.string().min(1).describe('Model id as the chosen backend names it.'),
        apiKey: z.string().describe('The key to probe with. BLANK means the key this workspace already stored — never a deployment default. Never stored by this endpoint and never returned.'),
    })
    .openapi('AiConnectionTestBody');

/** Response for POST /ai/test. `field` names the input to render the message
 *  against, so the workspace is pointed at the control that was wrong. */
export const AiConnectionTestResultSchema = z
    .object({
        ok: z.boolean(),
        field: z.enum(['baseUrl', 'model', 'apiKey']).optional()
            .describe('Which submitted field to blame. Absent when ok is true.'),
        message: z.string().optional().describe('What to show. Never contains the provider response body.'),
    })
    .openapi('AiConnectionTestResult');
