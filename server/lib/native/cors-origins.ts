import { cors } from 'hono/cors';
import type { MiddlewareHandler } from 'hono';

/**
 * Page origins of the native app's WebView: iOS serves from capacitor://localhost,
 * Android from https://localhost. A fetch from either to this API is cross-origin.
 */
export const NATIVE_APP_ORIGINS: readonly string[] = ['capacitor://localhost', 'https://localhost'];

/**
 * What the native app needs on top of the baseline API CORS policy: it sends the
 * idempotency and version-handshake headers, and reads the upgrade verdict back.
 */
export const nativeCorsHeaders = {
    allowHeaders: ['Idempotency-Key', 'X-Client-Version', 'X-Client-Platform'],
    exposeHeaders: ['X-Client-Upgrade'],
} as const;

const API_ALLOW_HEADERS = ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Token-Relay'];
const API_ALLOW_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

// The baseline policy, unchanged: it reflects the caller's origin, which local
// development relies on (Vite on :5173 calling the Worker on :8787).
const baselineCors = cors({
    origin: (origin) => origin,
    credentials: true,
    allowHeaders: API_ALLOW_HEADERS,
    allowMethods: API_ALLOW_METHODS,
    exposeHeaders: ['Set-Cookie'],
});

const nativeCors = cors({
    origin: (origin) => (NATIVE_APP_ORIGINS.includes(origin) ? origin : ''),
    credentials: true,
    allowHeaders: [...API_ALLOW_HEADERS, ...nativeCorsHeaders.allowHeaders],
    allowMethods: API_ALLOW_METHODS,
    exposeHeaders: ['Set-Cookie', ...nativeCorsHeaders.exposeHeaders],
});

/** CORS for /api/*: the native app origins get the extra headers, every other origin the baseline. */
export const apiCors: MiddlewareHandler = (c, next) => {
    const origin = c.req.header('Origin') ?? '';
    return (NATIVE_APP_ORIGINS.includes(origin) ? nativeCors : baselineCors)(c, next);
};
