import { drizzle } from 'drizzle-orm/d1';
import { auditLogs } from './db/schema/tenant';

export type AuditAction =
    | 'inspection.create'
    | 'inspection.delete'
    | 'inspection.status_change'
    | 'inspection.complete'
    | 'inspection.bulk_assign'
    | 'inspection.bulk_status'
    | 'template.create'
    | 'template.update'
    | 'template.delete'
    | 'user.invite'
    | 'user.join'
    | 'user.password_change'
    | 'agreement.create'
    | 'agreement.update'
    | 'agreement.delete'
    | 'data.export'
    | 'data.delete'
    | 'config.integration.update'
    | 'config.secrets.update';

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
    }).then(() => {}).catch((e) => console.error('[audit] write failed:', e));

    if (executionCtx) {
        try { executionCtx.waitUntil(write); } catch { /* swallow if ctx unavailable */ }
    }
}
