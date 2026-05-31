import { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { HonoConfig } from '../types/hono';

/**
 * Factory for OpenAPIHono sub-routers that formats Zod validation failures
 * into the canonical `{ success, error: { code, message, fields } }` envelope.
 *
 * Without this, OpenAPIHono's default behavior leaks a serialized ZodError
 * (`{ name: "ZodError", message: "[ ... issues JSON ... ]" }`) to the client,
 * which the frontend cannot render usefully.
 */
export function createApiRouter() {
    return new OpenAPIHono<HonoConfig>({
        defaultHook: (result, c: Context) => {
            if (result.success) return;
            const issues = result.error.issues;
            const fields: Record<string, string> = {};
            for (const i of issues) {
                const key = i.path.length ? i.path.join('.') : '_';
                if (!fields[key]) fields[key] = i.message;
            }
            const summary = issues
                .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
                .join('; ');
            return c.json(
                {
                    success: false,
                    error: {
                        code: 'VALIDATION_ERROR',
                        message: summary || 'Validation failed',
                        fields,
                    },
                },
                400,
            );
        },
    });
}
