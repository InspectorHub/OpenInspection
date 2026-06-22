import { drizzle } from 'drizzle-orm/d1';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { inspectionMessages, inspections } from '../lib/db/schema';
import type { MessageAttachment } from '../lib/db/schema';
import { Errors } from '../lib/errors';
import type { NotificationService } from './notification.service';

interface CreateMessageInput {
    tenantId: string;
    inspectionId: string;
    fromRole: 'client' | 'inspector';
    fromName?: string | null;
    body: string;
    attachments: MessageAttachment[];
}

export class MessageService {
    constructor(private d1: D1Database, private notification?: NotificationService) {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private db() { return drizzle(this.d1 as any); }

    async createMessage(input: CreateMessageInput) {
        const id = crypto.randomUUID();
        const now = Date.now();
        await this.db().insert(inspectionMessages).values({
            id,
            tenantId: input.tenantId,
            inspectionId: input.inspectionId,
            fromRole: input.fromRole,
            fromName: input.fromName ?? null,
            body: input.body,
            attachments: input.attachments,
            readAt: null,
            createdAt: now,
        });
        const [row] = await this.db().select().from(inspectionMessages).where(eq(inspectionMessages.id, id)).limit(1);
        if (!row) throw Errors.Internal('Failed to create message');

        // B3: in-app notification — when a client posts, alert the inspector
        // who owns this inspection. Inspector-originated messages don't fire
        // (the client receives them via email separately).
        if (this.notification && input.fromRole === 'client') {
            const insp = await this.db().select({ inspectorId: inspections.inspectorId, address: inspections.propertyAddress })
                .from(inspections)
                .where(and(eq(inspections.id, input.inspectionId), eq(inspections.tenantId, input.tenantId)))
                .get();
            if (insp?.inspectorId) {
                await this.notification.create({
                    tenantId: input.tenantId,
                    userId: insp.inspectorId,
                    type: 'message.received',
                    title: `New message from ${input.fromName ?? 'client'}`,
                    body: input.body.length > 120 ? input.body.slice(0, 117) + '...' : input.body,
                    entityType: 'inspection',
                    entityId: input.inspectionId,
                    metadata: { address: insp.address ?? null },
                });
            }
        }

        return row;
    }

    async listForInspection(inspectionId: string, tenantId: string) {
        return this.db().select().from(inspectionMessages)
            .where(and(eq(inspectionMessages.inspectionId, inspectionId), eq(inspectionMessages.tenantId, tenantId)))
            .orderBy(inspectionMessages.createdAt);
    }

    async markAllReadForRole(inspectionId: string, tenantId: string, fromRole: 'client' | 'inspector') {
        await this.db().update(inspectionMessages)
            .set({ readAt: Date.now() })
            .where(and(
                eq(inspectionMessages.inspectionId, inspectionId),
                eq(inspectionMessages.tenantId, tenantId),
                eq(inspectionMessages.fromRole, fromRole),
                isNull(inspectionMessages.readAt),
            ));
    }

    async unreadCountForTenant(tenantId: string): Promise<number> {
        const [row] = await this.db().select({ c: sql<number>`count(*)` })
            .from(inspectionMessages)
            .where(and(
                eq(inspectionMessages.tenantId, tenantId),
                eq(inspectionMessages.fromRole, 'client'),
                isNull(inspectionMessages.readAt),
            ));
        return Number(row?.c ?? 0);
    }

    /**
     * Resolves the inspection's stored client display name (for attribution on
     * client-authored messages). Null when the inspection is missing or has no
     * recorded client name. Tenant-scoped.
     */
    async clientNameForInspection(inspectionId: string, tenantId: string): Promise<string | null> {
        const [insp] = await this.db().select({ clientName: inspections.clientName }).from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
            .limit(1);
        return insp?.clientName ?? null;
    }

    /**
     * Resolves the inspection's stored client email (for building the portal
     * message-notification deep-link). Null when missing. Tenant-scoped.
     */
    async clientEmailForInspection(inspectionId: string, tenantId: string): Promise<string | null> {
        const [insp] = await this.db().select({ clientEmail: inspections.clientEmail }).from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
            .limit(1);
        return insp?.clientEmail ?? null;
    }

    /**
     * Resolves a single message attachment scoped by INSPECTION (tenant + id),
     * keyed by the inspection id the caller is already authorized for (JWT
     * inspector or resolveClientActor client). Returns the stored attachment
     * metadata only when the attachment belongs to a message on this inspection
     * — never exposing arbitrary R2 keys. Returns null when no such attachment
     * exists.
     */
    async resolveAttachmentForInspection(
        inspectionId: string,
        tenantId: string,
        attachmentId: string,
    ): Promise<{ key: string; name: string; type: string } | null> {
        if (!attachmentId) return null;
        const rows = await this.listForInspection(inspectionId, tenantId);
        for (const row of rows) {
            for (const att of row.attachments ?? []) {
                if (att.id === attachmentId) {
                    return { key: att.key, name: att.name, type: att.type };
                }
            }
        }
        return null;
    }
}
