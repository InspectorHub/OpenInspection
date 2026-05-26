import { drizzle } from 'drizzle-orm/d1';
import { eq, and, desc, isNull, inArray, sql } from 'drizzle-orm';
import { notifications, users } from '../lib/db/schema';
import { nanoid } from 'nanoid';

export type NotificationType =
    | 'inspection.created'
    | 'inspection.confirmed'
    | 'booking.received'
    | 'report.published'
    | 'agreement.signed'
    | 'payment.received'
    | 'message.received';

export interface NotificationCreate {
    tenantId: string;
    userId: string | null;
    type: NotificationType | string;
    title: string;
    body?: string | null;
    entityType?: string | null;
    entityId?: string | null;
    metadata?: Record<string, unknown> | null;
}

export interface ListOptions {
    unread?: boolean;
    includeArchived?: boolean;
    limit?: number;
    /** ISO timestamp string for cursor-based pagination (created_at < cursor) */
    cursor?: string;
}

export interface ListResult {
    items: Array<typeof notifications.$inferSelect>;
    nextCursor: string | null;
}

/**
 * In-app notifications inbox. Companion to email automation:
 * the same triggers that send email also write a row here so users
 * have a durable feed they can review later without searching their inbox.
 */
export class NotificationService {
    constructor(private db: D1Database) {}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private getDrizzle() { return drizzle(this.db as any); }

    async create(payload: NotificationCreate): Promise<string> {
        const id = nanoid();
        await this.getDrizzle().insert(notifications).values({
            id,
            tenantId:   payload.tenantId,
            userId:     payload.userId ?? null,
            type:       payload.type,
            title:      payload.title,
            body:       payload.body ?? null,
            entityType: payload.entityType ?? null,
            entityId:   payload.entityId ?? null,
            metadata:   payload.metadata ?? null,
            readAt:     null,
            archivedAt: null,
            createdAt:  new Date(),
        });
        return id;
    }

    /**
     * Fan-out helper: writes one notification per owner/admin user in the tenant.
     * Used for events that concern the workspace at large rather than one user.
     */
    async createForAllAdmins(
        tenantId: string,
        payload: Omit<NotificationCreate, 'tenantId' | 'userId'>,
    ): Promise<number> {
        const db = this.getDrizzle();
        const admins = await db.select({ id: users.id })
            .from(users)
            .where(and(
                eq(users.tenantId, tenantId),
                inArray(users.role, ['owner', 'admin']),
            ));
        if (admins.length === 0) return 0;
        const now = new Date();
        await db.insert(notifications).values(admins.map(a => ({
            id:         nanoid(),
            tenantId,
            userId:     a.id,
            type:       payload.type,
            title:      payload.title,
            body:       payload.body ?? null,
            entityType: payload.entityType ?? null,
            entityId:   payload.entityId ?? null,
            metadata:   payload.metadata ?? null,
            readAt:     null,
            archivedAt: null,
            createdAt:  now,
        })));
        return admins.length;
    }

    async list(tenantId: string, userId: string, opts: ListOptions = {}): Promise<ListResult> {
        const limit = Math.min(opts.limit ?? 50, 100);
        const db = this.getDrizzle();
        const conds = [eq(notifications.tenantId, tenantId), eq(notifications.userId, userId)];
        if (opts.unread) conds.push(isNull(notifications.readAt));
        if (!opts.includeArchived) conds.push(isNull(notifications.archivedAt));
        if (opts.cursor) {
            const cursorDate = new Date(opts.cursor);
            conds.push(sql`${notifications.createdAt} < ${cursorDate}`);
        }
        const rows = await db.select().from(notifications)
            .where(and(...conds))
            .orderBy(desc(notifications.createdAt))
            .limit(limit + 1);
        const hasMore = rows.length > limit;
        const items = hasMore ? rows.slice(0, limit) : rows;
        const nextCursor = hasMore && items.length > 0
            ? items[items.length - 1]!.createdAt.toISOString()
            : null;
        return { items, nextCursor };
    }

    async unreadCount(tenantId: string, userId: string): Promise<number> {
        const db = this.getDrizzle();
        const row = await db.select({ c: sql<number>`count(*)` })
            .from(notifications)
            .where(and(
                eq(notifications.tenantId, tenantId),
                eq(notifications.userId, userId),
                isNull(notifications.readAt),
                isNull(notifications.archivedAt),
            ))
            .get();
        return row?.c ?? 0;
    }

    async markRead(tenantId: string, userId: string, ids: string[]): Promise<void> {
        if (ids.length === 0) return;
        await this.getDrizzle().update(notifications)
            .set({ readAt: new Date() })
            .where(and(
                eq(notifications.tenantId, tenantId),
                eq(notifications.userId, userId),
                inArray(notifications.id, ids),
                isNull(notifications.readAt),
            ));
    }

    async markAllRead(tenantId: string, userId: string): Promise<void> {
        await this.getDrizzle().update(notifications)
            .set({ readAt: new Date() })
            .where(and(
                eq(notifications.tenantId, tenantId),
                eq(notifications.userId, userId),
                isNull(notifications.readAt),
            ));
    }

    async archive(tenantId: string, userId: string, id: string): Promise<void> {
        await this.getDrizzle().update(notifications)
            .set({ archivedAt: new Date() })
            .where(and(
                eq(notifications.tenantId, tenantId),
                eq(notifications.userId, userId),
                eq(notifications.id, id),
            ));
    }
}
