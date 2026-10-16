import type { Context } from 'hono';
import { AppError, ErrorCode } from '../lib/errors';
import { auditFromContext } from '../lib/audit';
import type { HonoConfig } from '../types/hono';

const CEILING_CODES: ReadonlySet<string> = new Set([
    ErrorCode.CAPABILITY_CEILING,
    ErrorCode.ROLE_CEILING,
    ErrorCode.SELF_PERMISSION_CHANGE,
]);

/**
 * Runs a team write and, when the grant ceiling refuses it, records the refusal
 * before the error goes on to the caller. A refused attempt to hand out more than
 * you hold is exactly the event an owner would want to find later, and it leaves
 * no other trace: nothing was written.
 *
 * Metadata is the refusal code and the role asked for. The capability names are
 * not copied in; the code says which rule fired and the request is the rest.
 */
export async function auditRefusedGrant<T>(
    c: Context<HonoConfig>,
    action: 'invite' | 'update',
    requestedRole: string | null,
    run: () => Promise<T>,
): Promise<T> {
    try {
        return await run();
    } catch (err) {
        if (err instanceof AppError && CEILING_CODES.has(err.code)) {
            auditFromContext(c, 'user.grant_refused', 'user', {
                metadata: { reason: err.code, role: requestedRole ?? 'unchanged', during: action },
            });
        }
        throw err;
    }
}
