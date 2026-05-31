import { Context } from 'hono';
import { ContentfulStatusCode } from 'hono/utils/http-status';
import { ErrorCode } from './errors';

/**
 * Standard API response structure.
 */
export interface ApiResponse<T = unknown> {
    success: boolean;
    data?: T | undefined;
    error?: {
        message: string;
        code: ErrorCode | string;
        details?: unknown;
    } | undefined;
    meta?: Record<string, unknown> | undefined;
}

/**
 * Sends a successful JSON response.
 */
export function sendSuccess<T>(c: Context, data: T, status: ContentfulStatusCode = 200, meta?: Record<string, unknown>) {
    const response: ApiResponse<T> = {
        success: true,
        data,
        meta,
    };
    return c.json(response, status);
}

/**
 * Sends an error JSON response.
 */
export function sendError(c: Context, message: string, code: ErrorCode | string, status: ContentfulStatusCode = 400, details?: unknown) {
    const response: ApiResponse = {
        success: false,
        error: {
            message,
            code,
            details,
        },
    };
    return c.json(response, status);
}
