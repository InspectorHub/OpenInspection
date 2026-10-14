import { z } from '@hono/zod-openapi';

/**
 * Reusable password field schema with strength requirements.
 * Used across all auth schemas that accept a new/initial password.
 */
export const passwordSchema = z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Must contain at least one special character')
    .describe('New password — min 8 chars with at least one uppercase letter, one digit, and one special character.');

/**
 * Helper to wrap a schema in the standard ApiResponse structure for OpenAPI.
 */
export function createApiResponseSchema<T extends z.ZodTypeAny>(dataSchema: T) {
    return z.object({
        success: z.boolean().openapi({ example: true }).describe('True when the request succeeded.'),
        data: dataSchema.openapi({ description: 'Response payload' }),
        error: z.object({
            message: z.string().openapi({ example: 'Error message' }).describe('Human-readable description of the error.'),
            code: z.string().openapi({ example: 'ERROR_CODE' }).describe('Stable machine-readable error code.'),
            details: z.any().optional().describe('Optional structured context for the error, such as per-field validation failures.'),
        }).optional().describe('Error detail; present only when the request failed.'),
        meta: z.any().optional().describe('Optional response metadata, such as pagination information.'),
    });
}

/**
 * Standard Success Response Schema (when no specific data is returned)
 */
export const SuccessResponseSchema = z.object({
    success: z.boolean().openapi({ example: true }).describe('True when the request succeeded.'),
    data: z.object({
        success: z.boolean().openapi({ example: true }).describe('True when the request succeeded.'),
    }).optional().describe('Present when the action reports a result.'),
    error: z.any().optional().describe('Error detail; present only when the request failed.'),
    meta: z.any().optional().describe('Optional response metadata, such as pagination information.'),
}).openapi('SuccessResponse');
