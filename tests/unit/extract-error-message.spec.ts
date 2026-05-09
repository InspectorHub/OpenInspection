import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * iter-1 production bug #2 — the New Inspection error toast displayed the
 * raw Zod issue array (regex patterns and all) instead of the human
 * `message` string. The fix added an `extractErrorMessage(payload, fallback)`
 * helper to public/js/auth.js. This spec loads the script in a sandbox
 * window and exercises every error envelope the dashboard observes:
 *
 *   1. AppError    — { success:false, error:{ message, code, details? } }
 *   2. Zod issues  — { success:false, error:{ issues: [...] } }
 *   3. Zod array   — { success:false, error: [...] }
 *   4. Plain text  — string body
 *   5. Empty/null  — must fall back to caller-provided default
 */
describe('extractErrorMessage (public/js/auth.js)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let extractErrorMessage: (payload: unknown, fallback?: string) => string = (() => '') as any;

    beforeAll(() => {
        // Load auth.js in a controlled sandbox so we can hoist the helper
        // without pulling in the rest of the page (no document, no fetch).
        const code = readFileSync(
            join(process.cwd(), 'public', 'js', 'auth.js'),
            'utf8'
        );
        const sandbox: Record<string, unknown> = {};
        const fakeWindow: Record<string, unknown> = {};
        const fakeDocument = {
            createElement: () => ({ textContent: '', innerHTML: '' }),
        };
        // Wrap the script in a function that exposes window/document refs.
        // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
        const fn = new Function('window', 'document', 'fetch', code);
        fn(fakeWindow, fakeDocument, () => Promise.resolve(new Response()));
        sandbox.extractErrorMessage = fakeWindow.extractErrorMessage;
        extractErrorMessage = sandbox.extractErrorMessage as typeof extractErrorMessage;
        if (typeof extractErrorMessage !== 'function') {
            throw new Error('extractErrorMessage was not exported on window');
        }
    });

    it('returns AppError envelope message verbatim', () => {
        const payload = {
            success: false,
            error: { message: 'Inspection not found', code: 'NOT_FOUND' },
        };
        expect(extractErrorMessage(payload, 'fallback')).toBe('Inspection not found');
    });

    it('joins Zod issues into a friendly message (error.issues shape)', () => {
        // This is the exact production bug: the previous toast displayed the
        // entire issues array including the email regex `pattern`. The helper
        // must surface ONLY the issue.message values.
        const payload = {
            success: false,
            error: {
                issues: [
                    {
                        origin: 'string',
                        code: 'invalid_format',
                        format: 'email',
                        pattern: '/^(?!\\.).+/',
                        path: ['clientEmail'],
                        message: 'Invalid email address',
                    },
                ],
            },
        };
        const msg = extractErrorMessage(payload, 'fallback');
        expect(msg).toBe('Invalid email address');
        expect(msg).not.toContain('pattern');
        expect(msg).not.toContain('regex');
    });

    it('joins Zod issues into a friendly message (error: array shape)', () => {
        const payload = {
            success: false,
            error: [
                { code: 'too_small', message: 'Property address is too short', path: ['propertyAddress'] },
                { code: 'invalid_format', message: 'Invalid email address', path: ['clientEmail'] },
            ],
        };
        expect(extractErrorMessage(payload, 'fallback')).toBe(
            'Property address is too short · Invalid email address',
        );
    });

    it('falls back when payload is empty / null / undefined', () => {
        expect(extractErrorMessage(null, 'fallback A')).toBe('fallback A');
        expect(extractErrorMessage(undefined, 'fallback B')).toBe('fallback B');
        expect(extractErrorMessage({}, 'fallback C')).toBe('fallback C');
    });

    it('uses the caller fallback when error has no usable shape', () => {
        const payload = { success: false, error: 12345 };
        expect(extractErrorMessage(payload, 'create failed')).toBe('create failed');
    });

    it('passes through plain string bodies', () => {
        expect(extractErrorMessage('Service unavailable', 'fallback')).toBe('Service unavailable');
    });

    it('does NOT leak regex patterns from a malformed Zod issue (defensive)', () => {
        const payload = {
            success: false,
            error: {
                issues: [
                    {
                        origin: 'string',
                        code: 'invalid_format',
                        format: 'email',
                        pattern: '/^(?!\\.)(?!.*\\.\\.)([A-Za-z0-9_\'+\\-\\.]*)[A-Za-z0-9_+-]@(...)+/',
                        path: ['clientEmail'],
                        message: 'Invalid email address',
                    },
                ],
            },
        };
        const msg = extractErrorMessage(payload, 'fallback');
        // The regex must never make it into the toast output.
        expect(msg).not.toMatch(/\^\(\?!/);
        expect(msg).not.toContain('A-Za-z0-9');
        expect(msg).toBe('Invalid email address');
    });
});
