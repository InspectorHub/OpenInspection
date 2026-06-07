import type { Context } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { auditLogs, users } from './db/schema/tenant';
import { logger } from './logger';
import type { HonoConfig } from '../types/hono';

export type AuditAction =
    | 'inspection.create'
    | 'inspection.delete'
    | 'inspection.status_change'
    | 'inspection.status_changed'
    | 'inspection.complete'
    | 'inspection.send_pdf'
    | 'inspection.send_text_fallback'
    | 'inspection.bulk_assign'
    | 'inspection.bulk_status'
    | 'inspection.template_upgraded'
    | 'inspection.results_merged'
    | 'inspection.results_batch_patched'
    | 'inspection.sync_conflict_resolved'
    | 'inspection.conflicts_resolved'
    | 'inspection.share_agent'
    | 'inspection.property_facts.update'
    | 'inspection.media.attach'
    | 'inspection.inspector_signed'
    | 'persistence.granted'
    | 'persistence.denied'
    | 'template.create'
    | 'template.update'
    | 'template.delete'
    | 'template.marketplace.updated'
    | 'library.marketplace.updated'
    | 'user.invite'
    | 'user.join'
    | 'user.password_change'
    | 'agreement.create'
    | 'agreement.update'
    | 'agreement.delete'
    | 'agreement.send'
    | 'agreement.remind'
    | 'agreement.sent'
    | 'agreement.viewed'
    | 'agreement.declined'
    | 'agreement.expired'
    | 'agreement.inspector_signed'
    | 'recommendation.created'
    | 'recommendation.updated'
    | 'recommendation.deleted'
    | 'rating_system.created'
    | 'rating_system.updated'
    | 'rating_system.cloned'
    | 'rating_system.deleted'
    | 'data.export'
    | 'data.import'
    | 'data.delete'
    | 'audit.view'
    | 'repair_request.exported'
    | 'comment.created'
    | 'comment.updated'
    | 'comment.deleted'
    | 'config.integration.update'
    | 'config.secrets.update'
    | 'config.attention_thresholds.update'
    | 'config.dashboard_columns.update'
    | 'config.tenant_config.patch'
    | 'tag.created'
    | 'tag.updated'
    | 'tag.deleted'
    | 'tag.linked'
    | 'tag.unlinked'
    | 'inspection.property_facts.autofill'
    | 'inspection.template_snapshot.update'
    | 'inspection.rating_system.switch'
    | 'admin.migrate_finding_keys';

export interface AuditParams {
    db: D1Database;
    tenantId: string;
    userId?: string | undefined;
    action: AuditAction;
    entityType: string;
    entityId?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
    ipAddress?: string | undefined;
    executionCtx?: ExecutionContext | undefined;
}

/**
 * Write an audit log entry. Uses waitUntil when executionCtx is provided
 * so it never blocks the response path.
 */
export function writeAuditLog(params: AuditParams): void {
    const { db, executionCtx, ...rest } = params;
    const write = drizzle(db).insert(auditLogs).values({
        id: crypto.randomUUID(),
        tenantId: rest.tenantId,
        userId: rest.userId ?? null,
        action: rest.action,
        entityType: rest.entityType,
        entityId: rest.entityId ?? null,
        metadata: rest.metadata ?? null,
        ipAddress: rest.ipAddress ?? null,
        createdAt: new Date(),
    }).then(() => {}).catch((e) => logger.error('[audit] write failed', {}, e instanceof Error ? e : undefined));

    if (executionCtx) {
        try { executionCtx.waitUntil(write); } catch { /* swallow if ctx unavailable */ }
    }
}

/**
 * Context-aware wrapper around writeAuditLog that extracts common fields
 * (tenantId, userId, ipAddress, executionCtx) from the Hono context.
 */
export function auditFromContext(
    c: Context<HonoConfig>,
    action: AuditAction,
    entityType: string,
    options?: { entityId?: string; metadata?: Record<string, unknown> }
): void {
    const user = c.get('user');
    writeAuditLog({
        db: c.env.DB,
        tenantId: c.get('tenantId') as string,
        userId: user?.sub,
        action,
        entityType,
        entityId: options?.entityId,
        metadata: options?.metadata,
        ipAddress: c.req.header('CF-Connecting-IP'),
        executionCtx: c.executionCtx,
    });
}

/**
 * Sprint B-3 — actions that ought to carry inspector_slug for cross-inspection
 * grouping in audit dashboards. Other events (logins, settings tweaks, library
 * edits) intentionally leave the column NULL so the index stays signal-rich.
 *
 * The list is forward-compatible: when emitters for these events appear, they
 * should call writeAuditLogWithSlug instead of writeAuditLog so the slug is
 * resolved automatically.
 */
const INSPECTOR_SLUG_AUDIT_ALLOWLIST = new Set<string>([
    'user.slug.set',
    'inspection.created',
    'inspection.published',
    'agreement.sent',
    'invoice.sent',
    'invoice.paid',
]);

export interface AuditWithSlugParams {
    tenantId: string;
    actorUserId?: string;
    action: string;
    entityType: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
}

/**
 * Sprint B-3 — wraps writeAuditLog so callers don't have to remember to look
 * up users.slug themselves. Joins on actorUserId and writes the slug into the
 * inspector_slug column iff the action is in INSPECTOR_SLUG_AUDIT_ALLOWLIST.
 * For all other actions inspector_slug stays NULL.
 *
 * Synchronous wrt the audit insert itself (awaits the slug lookup), but the
 * insert promise still surfaces as a no-await background write — same shape
 * as writeAuditLog so callers can fire-and-forget.
 */
export async function writeAuditLogWithSlug(db: D1Database, params: AuditWithSlugParams): Promise<void> {
    let inspectorSlug: string | null = null;
    if (params.actorUserId && INSPECTOR_SLUG_AUDIT_ALLOWLIST.has(params.action)) {
        try {
            const row = await drizzle(db).select({ slug: users.slug }).from(users).where(eq(users.id, params.actorUserId)).get();
            inspectorSlug = row?.slug ?? null;
        } catch (e) {
            logger.error('[audit] slug lookup failed', { actorUserId: params.actorUserId }, e instanceof Error ? e : undefined);
        }
    }
    try {
        await drizzle(db).insert(auditLogs).values({
            id: crypto.randomUUID(),
            tenantId: params.tenantId,
            userId: params.actorUserId ?? null,
            action: params.action,
            entityType: params.entityType,
            entityId: params.entityId ?? null,
            metadata: params.metadata ?? null,
            ipAddress: params.ipAddress ?? null,
            inspectorSlug,
            createdAt: new Date(),
        });
    } catch (e) {
        logger.error('[audit] write failed', {}, e instanceof Error ? e : undefined);
    }
}
