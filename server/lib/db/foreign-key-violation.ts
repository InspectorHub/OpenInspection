import type { Context } from 'hono';
import { logger } from '../logger';
import { sendError } from '../response';
import { ErrorCode } from '../errors';

/**
 * The driver error underneath whatever wrapped it. Drizzle wraps the driver error (its own message carries the SQL
 * text and the bound parameters), so only the deepest `cause` says what the database actually refused.
 */
function rootCause(err: unknown): Error | null {
    let e: unknown = err;
    for (let depth = 0; depth < 8 && e instanceof Error && e.cause instanceof Error; depth++) e = e.cause;
    return e instanceof Error ? e : null;
}

/** SQLite's own wording, optionally behind the D1 prefix. Anchored: a longer message that merely mentions it does not count. */
const FK_MESSAGE = /^(?:D1_ERROR:\s*)?(?:SQLITE_CONSTRAINT(?:_FOREIGNKEY)?:\s*)?FOREIGN KEY constraint failed/i;

/**
 * True when the database refused a statement on a FOREIGN KEY constraint. Matches the ROOT cause's code or message
 * only, never the wrapper: a wrapper's message holds the statement and its parameters, so a user-supplied string
 * that happens to contain the phrase must not be able to pose as the failure.
 */
export function isForeignKeyViolation(err: unknown): boolean {
    const root = rootCause(err) ?? (err instanceof Error ? err : null);
    if (!root) return false;
    const code = (root as { code?: unknown }).code;
    return code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || FK_MESSAGE.test(root.message);
}

/**
 * What the refused statement was doing. A child row pointing at a parent that is not there (insert, update) is the
 * caller naming a record that does not exist; deleting a parent that child rows still point at is the record being
 * in use. SQLite words both alike, so the statement says which: drizzle keeps its SQL on `query`, and the HTTP
 * method is the fallback.
 */
export type ForeignKeyKind = 'missing_reference' | 'in_use';

export function foreignKeyKind(err: unknown, method: string): ForeignKeyKind {
    for (let e: unknown = err, depth = 0; e instanceof Error && depth < 8; e = e.cause, depth++) {
        const q = (e as { query?: unknown }).query;
        if (typeof q === 'string') {
            const verb = /^\s*(insert|update|delete)\b/i.exec(q)?.[1]?.toLowerCase();
            if (verb) return verb === 'delete' ? 'in_use' : 'missing_reference';
        }
    }
    return method.toUpperCase() === 'DELETE' ? 'in_use' : 'missing_reference';
}

/**
 * Routes whose callers retry on a 5xx or act on its meaning: the portal-to-engine service surface, the internal
 * render surface, webhooks and the connector callbacks. A 4xx tells such a caller "do not retry, your request is
 * wrong"; for these the failure is ours and must keep its 500.
 */
const NOT_USER_FACING = ['/webhooks', '/m2m', '/api/platform', '/api/integrations/qbo', '/.well-known'];

export function isUserFacingPath(path: string): boolean {
    return !NOT_USER_FACING.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * The answer for a foreign-key refusal on a user-facing route, or null to let the normal 500 path handle it.
 * Routes check what they read; this is the net under the ones that forgot. It logs at error level with the cause and
 * the constraint text, because a missing check is our defect and must stay visible to alerting on 5xx-class faults,
 * even though the caller is told 400 or 409.
 */
export function foreignKeyResponse(c: Context, err: unknown): Response | null {
    if (!isForeignKeyViolation(err)) return null;
    const path = new URL(c.req.url).pathname;
    if (!isUserFacingPath(path)) return null;
    const kind = foreignKeyKind(err, c.req.method);
    logger.error('Foreign key constraint refused a statement (a route did not check its references)', {
        method: c.req.method, url: path, kind, constraint: rootCause(err)?.message ?? null,
    }, err instanceof Error ? err : undefined);
    return kind === 'in_use'
        ? sendError(c, 'This record is still in use by other records, so it cannot be removed', ErrorCode.CONFLICT, 409)
        : sendError(c, 'A referenced record does not exist', ErrorCode.BAD_REQUEST, 400);
}
