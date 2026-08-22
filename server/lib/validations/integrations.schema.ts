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
export const AiConnectionTestBodySchema = z
    .object({
        baseUrl: z.string().url().describe('Root of an OpenAI-compatible API, e.g. https://host/v1.'),
        model: z.string().min(1).describe('Model id as the chosen backend names it.'),
        apiKey: z.string().min(1).describe('The API key to probe with. Never stored by this endpoint and never returned.'),
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
