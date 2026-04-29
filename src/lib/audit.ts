import type { Context } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { auditLogs } from './db/schema/tenant';
import { logger } from './logger';
import type { HonoConfig } from '../types/hono';

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
    | 'agreement.send'
    | 'data.export'
    | 'data.import'
    | 'data.delete'
    | 'audit.view'
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
