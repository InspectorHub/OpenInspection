import { z } from '@hono/zod-openapi';
import { STEP_UP_ACTIONS } from '../auth/step-up';

/** Body of POST /api/auth/step-up: which action to elevate for, plus the credentials re-entered. */
export const StepUpRequestSchema = z.object({
    action: z.enum(STEP_UP_ACTIONS).openapi({
        example: 'data-export-start',
        description: 'The single sensitive action the elevation is for. The token that comes back is accepted for this action only.',
    }),
    password: z.string().min(1).max(1024).optional().openapi({
        example: 'currentPassword',
        description: 'The signed-in account current password, entered again. Required for an account that has a password.',
    }),
    emailCode: z.string().max(20).optional().openapi({
        example: '482913',
        description: 'The code emailed to the account, for an owner who has no password (federated sign-up only). Ignored for an account that has a password.',
    }),
    code: z.string().min(6).max(20).optional().openapi({
        example: '123456',
        description: 'Current TOTP code or a recovery code. Required when the account has two-factor authentication on; ignored otherwise.',
    }),
});

/** What the caller learns from a successful step-up. The token itself travels only in an HttpOnly cookie. */
export const StepUpResponseSchema = z.object({
    success: z.boolean().openapi({ example: true }).describe('True when the elevation was granted.'),
    data: z.object({
        action: z.enum(STEP_UP_ACTIONS).describe('The action the elevation is good for.'),
        expiresAt: z.string().openapi({ example: '2026-01-01T00:05:00.000Z' }).describe('When the elevation lapses if it is not used (ISO 8601).'),
    }).describe('The granted elevation.'),
}).openapi('StepUpResponse');

/** Body of POST /api/auth/step-up/email-code: which action the code is for. */
export const StepUpEmailCodeRequestSchema = z.object({
    action: z.enum(STEP_UP_ACTIONS).openapi({
        example: 'data-export-start',
        description: 'The single sensitive action the emailed code is for.',
    }),
});

/** The reply says only that a code was sent; the address is never echoed. */
export const StepUpEmailCodeResponseSchema = z.object({
    success: z.boolean().openapi({ example: true }).describe('True when a code was emailed.'),
    data: z.object({
        action: z.enum(STEP_UP_ACTIONS).describe('The action the code is for.'),
        expiresInSeconds: z.number().int().openapi({ example: 600 }).describe('How long the code stays valid.'),
    }).describe('The issued code scope and lifetime.'),
}).openapi('StepUpEmailCodeResponse');
