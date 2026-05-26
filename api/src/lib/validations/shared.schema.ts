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
        success: z.boolean().openapi({ example: true }).describe('TODO describe success field for the OpenInspection MCP integration'),
        data: dataSchema.openapi({ description: 'Response payload' }),
        error: z.object({
            message: z.string().openapi({ example: 'Error message' }).describe('TODO describe message field for the OpenInspection MCP integration'),
            code: z.string().openapi({ example: 'ERROR_CODE' }).describe('TODO describe code field for the OpenInspection MCP integration'),
            details: z.any().optional().describe('TODO describe details field for the OpenInspection MCP integration'),
        }).optional().describe('TODO describe error field for the OpenInspection MCP integration'),
        meta: z.any().optional().describe('TODO describe meta field for the OpenInspection MCP integration'),
    });
}

/**
 * Standard Success Response Schema (when no specific data is returned)
 */
export const SuccessResponseSchema = z.object({
    success: z.boolean().openapi({ example: true }).describe('TODO describe success field for the OpenInspection MCP integration'),
    data: z.object({
        success: z.boolean().openapi({ example: true }).describe('TODO describe success field for the OpenInspection MCP integration'),
    }).optional().describe('TODO describe data field for the OpenInspection MCP integration'),
    error: z.any().optional().describe('TODO describe error field for the OpenInspection MCP integration'),
    meta: z.any().optional().describe('TODO describe meta field for the OpenInspection MCP integration'),
}).openapi('SuccessResponse');
