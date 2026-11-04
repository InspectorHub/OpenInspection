import type { Context, MiddlewareHandler } from 'hono';
import { CSP_REPORT_PATH } from '../page-security-headers';

/**
 * Page origins of the native app's WebView: iOS serves from capacitor://localhost,
 * Android from https://localhost. A fetch from either to this API is cross-origin.
 */
export const NATIVE_APP_ORIGINS: readonly string[] = ['capacitor://localhost', 'https://localhost'];

/**
 * What the native app needs on top of the baseline API CORS policy: it sends the
 * idempotency and version-handshake headers, and reads the upgrade verdict and the
 * response Date back (Date is not a CORS-safelisted header, so a WebView cannot read it otherwise).
 */
export const nativeCorsHeaders = {
    allowHeaders: ['Idempotency-Key', 'X-Client-Version', 'X-Client-Platform'],
    exposeHeaders: ['X-Client-Upgrade', 'Date'],
} as const;

const API_ALLOW_HEADERS = ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Token-Relay'];
const API_ALLOW_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

// The WebView authenticates with a Bearer header, which does not depend on the CORS
// credentials mode, so these origins get no Allow-Credentials and no Set-Cookie exposure.
const NATIVE_ALLOW_HEADERS = [...API_ALLOW_HEADERS, ...nativeCorsHeaders.allowHeaders];
const NATIVE_EXPOSE_HEADERS = [...nativeCorsHeaders.exposeHeaders];

/**
 * Public routes that an embedding page may call from any origin: the booking widget beacon and the booking
 * routes the embedded form uses. They answer `Access-Control-Allow-Origin: *` and NEVER carry credentials,
 * so a wildcard can not be combined with a cookie.
 */
const WIDGET_PATH_PREFIXES = ['/api/public/widget', '/api/public/book', '/api/public/inspectors', '/api/public/services', '/api/public/availability', '/api/public/slots'];
const WIDGET_ALLOW_HEADERS = ['Content-Type'];
const WIDGET_ALLOW_METHODS = ['GET', 'POST', 'OPTIONS'];

function isWidgetPath(path: string): boolean {
    return WIDGET_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** Parse one origin; returns its normalised `scheme://host[:port]` or null for anything that is not an http(s) origin. */
function normalizeOrigin(value: string): string | null {
    try {
        const url = new URL(value.trim());
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
        return url.origin;
    } catch {
        return null;
    }
}

/** The explicit allow-list from `CORS_ALLOWED_ORIGINS` (comma-separated origins). Invalid entries are ignored. */
function parseAllowedOrigins(raw: string | undefined): string[] {
    if (!raw) return [];
    const out: string[] = [];
    for (const part of raw.split(',')) {
        const origin = normalizeOrigin(part);
        if (origin && !out.includes(origin)) out.push(origin);
    }
    return out;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
/** Vite dev server origins, honoured only when the Worker itself is being served from a loopback host. */
const LOCAL_DEV_ORIGINS: readonly string[] = ['http://localhost:5173', 'http://127.0.0.1:5173'];

/**
 * Origins that may call the API WITH credentials (cookies): this deployment's own origin, its configured public
 * base URL, the operator's `CORS_ALLOWED_ORIGINS` list, and (loopback hosts only) the Vite dev server.
 */
function credentialedOrigins(requestUrl: string, env: { APP_BASE_URL?: string; CORS_ALLOWED_ORIGINS?: string }): string[] {
    const own = new URL(requestUrl);
    const list = [own.origin];
    const base = env.APP_BASE_URL ? normalizeOrigin(env.APP_BASE_URL) : null;
    if (base) list.push(base);
    list.push(...parseAllowedOrigins(env.CORS_ALLOWED_ORIGINS));
    if (LOCAL_HOSTS.has(own.hostname)) list.push(...LOCAL_DEV_ORIGINS);
    return list;
}

/**
 * Set a response header through `c.res`. `c.header()` before the route runs is dropped when the route returns a
 * fresh Response (a Durable Object or R2 answer), because Hono only merges headers already written to `c.res`.
 */
function putHeader(c: Context, name: string, value: string, append = false): void {
    if (append) c.res.headers.append(name, value);
    else c.res.headers.set(name, value);
}

type CorsEnv = { APP_BASE_URL?: string; CORS_ALLOWED_ORIGINS?: string };

/** Answer a preflight: 204 with the given policy. A disallowed origin gets no Allow-Origin, which makes the browser refuse. */
function preflight(c: Context, allowOrigin: string | null, opts: { credentials: boolean; methods: readonly string[]; headers: readonly string[] }): Response {
    const headers: Record<string, string> = {};
    if (allowOrigin) {
        headers['Access-Control-Allow-Origin'] = allowOrigin;
        if (opts.credentials) headers['Access-Control-Allow-Credentials'] = 'true';
        headers['Access-Control-Allow-Methods'] = opts.methods.join(',');
        headers['Access-Control-Allow-Headers'] = opts.headers.join(',');
        headers['Access-Control-Max-Age'] = '600';
    }
    return c.body(null, 204, headers);
}

/**
 * CORS for /api/*.
 *  - widget routes: any origin, `*`, never credentials;
 *  - the native app origins: that origin, extra headers, no credentials;
 *  - this deployment's own origin and the operator allow-list: that origin WITH credentials;
 *  - every other origin: no CORS headers at all (the browser refuses to expose the answer). The origin is never reflected.
 * `Vary: Origin` is set on every answer that depends on the Origin header.
 */
export const apiCors: MiddlewareHandler = async (c, next) => {
    // The CSP report receiver is posted to by the browser itself, same origin, and answers
    // with no CORS headers at all: reflecting an origin back would only invite cross-site callers.
    if (c.req.path === CSP_REPORT_PATH) return next();
    const origin = c.req.header('Origin') ?? '';
    const isPreflight = c.req.method === 'OPTIONS';

    // Every answer here depends on the Origin header, widget routes included.
    putHeader(c, 'Vary', 'Origin', true);

    if (isWidgetPath(c.req.path)) {
        if (!origin) return next();
        if (isPreflight) return preflight(c, '*', { credentials: false, methods: WIDGET_ALLOW_METHODS, headers: WIDGET_ALLOW_HEADERS });
        putHeader(c, 'Access-Control-Allow-Origin', '*');
        return next();
    }

    if (!origin) return next();

    if (NATIVE_APP_ORIGINS.includes(origin)) {
        if (isPreflight) return preflight(c, origin, { credentials: false, methods: API_ALLOW_METHODS, headers: NATIVE_ALLOW_HEADERS });
        putHeader(c, 'Access-Control-Allow-Origin', origin);
        putHeader(c, 'Access-Control-Expose-Headers', NATIVE_EXPOSE_HEADERS.join(','));
        return next();
    }

    const allowed = credentialedOrigins(c.req.url, c.env as CorsEnv).includes(origin);
    if (isPreflight) return preflight(c, allowed ? origin : null, { credentials: true, methods: API_ALLOW_METHODS, headers: API_ALLOW_HEADERS });
    if (allowed) {
        putHeader(c, 'Access-Control-Allow-Origin', origin);
        putHeader(c, 'Access-Control-Allow-Credentials', 'true');
        putHeader(c, 'Access-Control-Expose-Headers', 'Set-Cookie');
    }
    return next();
};
