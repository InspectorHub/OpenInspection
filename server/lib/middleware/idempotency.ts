/**
 * Idempotency middleware — claim, run, store, replay.
 *
 * MOUNT AFTER THE JWT MIDDLEWARE. The key is scoped to the authenticated
 * tenant: a bare key is a global namespace, and two tenants that happened to
 * mint the same key would replay each other's stored response — a cross-tenant
 * leak introduced by a correctness fix. The tenant is therefore read from
 * `c.var`, never from the request body, and a request whose tenant is unknown
 * is passed through unguarded rather than stored under a shared key.
 *
 * Wiring only: the SQL lives in `../idempotency/store`, the hashing in
 * `../idempotency/fingerprint`.
 */
import type { Context, MiddlewareHandler } from 'hono';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import type { HonoConfig } from '../../types/hono';
import { sendError } from '../response';
import { fingerprint } from '../idempotency/fingerprint';
import { claimKey, completeKey, releaseKey } from '../idempotency/store';

/** Retries happen in seconds. A day is already generous; longer is a different problem. */
const TTL_MS = 24 * 60 * 60 * 1000;

const DEFAULT_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

export interface IdempotencyOptions {
    /** Methods the guard applies to. Reads are never claimed. */
    methods?: string[];
    /** Injection seam for tests; production resolves D1 off the request env. */
    getDb?: (c: Context<HonoConfig>) => DrizzleD1Database;
}

/**
 * Only JSON bodies are fingerprinted. `c.req.json()` caches its result on the
 * request, so the downstream zod validator re-reads the cache rather than a
 * consumed stream. A non-JSON body (multipart upload) fingerprints as `null`:
 * the method + path still distinguish it, and a client that reuses one key
 * across two different uploads is a client bug the 409/replay still contains.
 */
async function readJsonBody(c: Context<HonoConfig>): Promise<unknown> {
    const contentType = c.req.header('content-type') ?? '';
    if (!contentType.includes('application/json')) return null;
    try {
        return await c.req.json();
    } catch {
        return null;
    }
}

export function idempotencyMiddleware(opts: IdempotencyOptions = {}): MiddlewareHandler<HonoConfig> {
    const methods = new Set((opts.methods ?? DEFAULT_METHODS).map(m => m.toUpperCase()));
    const getDb = opts.getDb ?? ((c: Context<HonoConfig>) => drizzle(c.env.DB));

    return async (c, next) => {
        const key = c.req.header('Idempotency-Key');
        if (!key || !methods.has(c.req.method.toUpperCase())) return next();

        const tenantId = c.get('tenantId');
        if (!tenantId) return next();

        const db = getDb(c);
        const fp = await fingerprint(c.req.method, c.req.path, await readJsonBody(c));
        const claim = await claimKey(db, { tenantId, key, fingerprint: fp, ttlMs: TTL_MS });

        if (claim !== 'claimed') {
            if (claim.state === 'fingerprint_mismatch') {
                return sendError(
                    c,
                    'This request key was already used with a different payload. Retry with a new key.',
                    'IDEMPOTENCY_KEY_REUSED',
                    422,
                );
            }
            if (claim.state === 'in_flight') {
                return sendError(
                    c,
                    'An identical request is already being processed.',
                    'IDEMPOTENCY_IN_FLIGHT',
                    409,
                );
            }
            const replay = new Response(claim.body, {
                status:  claim.status,
                headers: { 'Content-Type': 'application/json', 'Idempotency-Replayed': 'true' },
            });
            return replay;
        }

        await next();

        const status = c.res.status;
        if (status >= 200 && status < 300) {
            // Buffer through a clone: reading c.res itself would consume the
            // body the client is about to receive.
            await completeKey(db, { tenantId, key, status, body: await c.res.clone().text() });
        } else {
            await releaseKey(db, { tenantId, key });
        }
    };
}
