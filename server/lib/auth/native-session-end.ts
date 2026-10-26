/**
 * Why a native session ended, for the client that tries to refresh it.
 *
 * Removing a member revokes their grants first, so the next refresh stops in the
 * OAuth provider at "grant not found" and answers a plain 400 invalid_grant, the
 * same answer as a grant that never existed. The provider cannot add a field to
 * that answer, so the reason is written to KV under the grant id before the
 * revoke and the token endpoint's answer is extended here.
 *
 * The marker holds one value from SESSION_END_REASONS and nothing else, is keyed
 * by the grant id (random, and only ever read by a caller holding a refresh token
 * that names it), and is written only by server code.
 */
import { logger } from '../logger';
import { NATIVE_REFRESH_MAX_TTL_S } from './native-token';

/** The closed set of values the client can receive as `session_end_reason`. */
const SESSION_END_REASONS = ['member_removed'] as const;
export type SessionEndReason = (typeof SESSION_END_REASONS)[number];

const MARKER_PREFIX = 'native-end:';
const TOKEN_PATH = '/oauth/token';
const GRANT_ID = /^[A-Za-z0-9_-]{1,64}$/;

type FetchFn = (req: Request, env: unknown, ctx: ExecutionContext) => Response | Promise<Response>;

/** Best effort: a failed write is logged and never stops the revoke that follows. */
export async function markNativeSessionEnd(kv: KVNamespace | undefined, grantId: string, reason: SessionEndReason): Promise<void> {
    if (!kv) return;
    try {
        await kv.put(MARKER_PREFIX + grantId, reason, { expirationTtl: NATIVE_REFRESH_MAX_TTL_S });
    } catch (err) {
        logger.warn('Failed to record why a native session ended; the client will see a plain invalid_grant', {
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

/** The grant id of a refresh request, or null when the request is anything else. */
async function refreshGrantId(req: Request): Promise<string | null> {
    if (req.method !== 'POST' || new URL(req.url).pathname !== TOKEN_PATH) return null;
    if (!(req.headers.get('content-type') ?? '').includes('application/x-www-form-urlencoded')) return null;
    const form = new URLSearchParams(await req.clone().text());
    if (form.get('grant_type') !== 'refresh_token') return null;
    const parts = (form.get('refresh_token') ?? '').split(':');
    const grantId = parts[1];
    return parts.length === 3 && grantId !== undefined && GRANT_ID.test(grantId) ? grantId : null;
}

/**
 * Wraps the provider's fetch. A refused refresh (400 invalid_grant) whose grant has
 * a marker gets `session_end_reason` added to the body; every other request and
 * response, and any failure while looking, passes through unchanged.
 */
export function withSessionEndReason(inner: FetchFn, kv: KVNamespace | undefined): FetchFn {
    return async (req, env, ctx) => {
        let grantId: string | null;
        try {
            grantId = kv ? await refreshGrantId(req) : null;
        } catch {
            grantId = null;
        }
        const res = await inner(req, env, ctx);
        if (!kv || !grantId || res.status !== 400) return res;
        try {
            const body: unknown = await res.clone().json();
            if (typeof body !== 'object' || body === null || !('error' in body) || body.error !== 'invalid_grant') return res;
            const marker = await kv.get(MARKER_PREFIX + grantId);
            const reason = SESSION_END_REASONS.find((r) => r === marker);
            if (!reason) return res;
            const headers = new Headers(res.headers);
            headers.delete('content-length');
            return new Response(JSON.stringify({ ...body, session_end_reason: reason }), { status: res.status, headers });
        } catch {
            return res;
        }
    };
}
