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
