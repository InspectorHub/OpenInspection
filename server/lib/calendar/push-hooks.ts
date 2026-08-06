/**
 * The one-liners route handlers call to keep somebody's Google Calendar in step
 * with what just changed in OI.
 *
 * All three run DETACHED. The user's answer is already sent by the time Google
 * is contacted, so a slow or broken calendar can never make saving an
 * inspection feel slow or fail — and nothing here is allowed to reject.
 *
 * The Hono seam lives here rather than in `google-export.ts` so the export
 * logic stays callable from the cron sweep, which has no request context.
 */
import type { Context } from 'hono';
import type { HonoConfig } from '../../types/hono';
import { logger } from '../logger';
import {
    pushInspectionToGoogle,
    pushBlockToGoogle,
    deleteExternalForEntity,
    type CalendarExportEnv,
    type CalendarLinkEntityTypeAlias,
} from './google-export';

/**
 * The bindings the export path needs, or null when this deployment cannot do a
 * calendar write at all (no KV to read tenant secrets from, or no JWT_SECRET to
 * unseal them with). Returning null rather than throwing keeps an unconfigured
 * standalone deploy silent instead of noisy.
 */
function exportEnv(c: Context<HonoConfig>): CalendarExportEnv | null {
    const env = c.env;
    if (!env.TENANT_CACHE || !env.JWT_SECRET) return null;
    return {
        DB: env.DB,
        TENANT_CACHE: env.TENANT_CACHE,
        JWT_SECRET: env.JWT_SECRET,
        ...(env.JWT_SECRET_PREVIOUS ? { JWT_SECRET_PREVIOUS: env.JWT_SECRET_PREVIOUS } : {}),
        ...(env.GOOGLE_CLIENT_ID ? { GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID } : {}),
        ...(env.GOOGLE_CLIENT_SECRET ? { GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET } : {}),
    };
}

function detach(c: Context<HonoConfig>, label: string, work: () => Promise<unknown>): void {
    try {
        c.executionCtx.waitUntil(work().catch((e) => {
            logger.warn(`[calendar] ${label} failed`, { error: e instanceof Error ? e.message : String(e) });
        }));
    } catch {
        // No executionCtx (some test harnesses). The calendar is a mirror, not
        // a source of truth — losing one refresh is recoverable by the sweep.
    }
}

/** Create/move/remove the inspection's entry on its lead inspector's calendar. */
export function pushInspectionAfterResponse(
    c: Context<HonoConfig>,
    tenantId: string,
    inspectionId: string,
): void {
    const env = exportEnv(c);
    if (!env) return;
    detach(c, 'inspection push', () => pushInspectionToGoogle(env, tenantId, inspectionId));
}

/** Create/move the blocked-time entry on its owner's calendar. */
export function pushBlockAfterResponse(
    c: Context<HonoConfig>,
    tenantId: string,
    blockId: string,
): void {
    const env = exportEnv(c);
    if (!env) return;
    detach(c, 'block push', () => pushBlockToGoogle(env, tenantId, blockId));
}

/** Take the entry back off the calendar and forget the link. */
export function dropExternalAfterResponse(
    c: Context<HonoConfig>,
    tenantId: string,
    entityType: CalendarLinkEntityTypeAlias,
    entityId: string,
): void {
    const env = exportEnv(c);
    if (!env) return;
    detach(c, 'external delete', () => deleteExternalForEntity(env, tenantId, entityType, entityId));
}
