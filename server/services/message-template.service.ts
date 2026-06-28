import { drizzle } from 'drizzle-orm/d1';
import { eq, and, or } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { messageTemplates, automations } from '../lib/db/schema';
import { Errors } from '../lib/errors';

export interface MessageTemplateRow {
    id: string; tenantId: string; name: string; channel: 'email' | 'sms';
    subject: string | null; body: string; variables: string[];
    isSeeded: boolean; createdAt: number; updatedAt: number;
}

function parseVars(raw: string | null): string[] {
    if (!raw) return [];
    try { const a = JSON.parse(raw); return Array.isArray(a) ? a.filter((v) => typeof v === 'string') : []; }
    catch { return []; }
}

function serialize(r: typeof messageTemplates.$inferSelect): MessageTemplateRow {
    return {
        id: r.id, tenantId: r.tenantId, name: r.name, channel: r.channel,
        subject: r.subject, body: r.body, variables: parseVars(r.variables),
        isSeeded: r.isSeeded,
        createdAt: r.createdAt instanceof Date ? r.createdAt.getTime() : Number(r.createdAt),
        updatedAt: r.updatedAt instanceof Date ? r.updatedAt.getTime() : Number(r.updatedAt),
    };
}

/**
 * SP2 — tenant-scoped CRUD for the reusable message-template library. Every
 * query is filtered by tenantId (fail-closed isolation). channel is immutable
 * after create. delete() is referential-guarded: an automation referencing the
 * template (via email_template_id or sms_template_id) blocks the delete with a
 * Conflict that lists the referencing rules.
 */
export class MessageTemplateService {
    constructor(private db: D1Database) {}
    private get drizzle() { return drizzle(this.db); }

    async list(tenantId: string, channel?: 'email' | 'sms'): Promise<MessageTemplateRow[]> {
        const where = channel
            ? and(eq(messageTemplates.tenantId, tenantId), eq(messageTemplates.channel, channel))
            : eq(messageTemplates.tenantId, tenantId);
        const rows = await this.drizzle.select().from(messageTemplates).where(where);
        return rows.map(serialize);
    }

    async get(tenantId: string, id: string): Promise<MessageTemplateRow | null> {
        const row = await this.drizzle.select().from(messageTemplates)
            .where(and(eq(messageTemplates.id, id), eq(messageTemplates.tenantId, tenantId))).get();
        return row ? serialize(row) : null;
    }

    async create(tenantId: string, data: { name: string; channel: 'email' | 'sms'; subject?: string | null; body: string; variables?: string[] }): Promise<MessageTemplateRow> {
        const id = nanoid();
        const now = new Date();
        await this.drizzle.insert(messageTemplates).values({
            id, tenantId, name: data.name, channel: data.channel,
            subject: data.channel === 'email' ? (data.subject ?? null) : null,
            body: data.body, variables: JSON.stringify(data.variables ?? []),
            isSeeded: false, createdAt: now, updatedAt: now,
        });
        return (await this.get(tenantId, id))!;
    }

    async update(tenantId: string, id: string, data: Partial<{ name: string; subject: string | null; body: string; variables: string[] }>): Promise<MessageTemplateRow> {
        const existing = await this.get(tenantId, id);
        if (!existing) throw Errors.NotFound('Template not found');
        const patch: Record<string, unknown> = { updatedAt: new Date() };
        if ('name' in data) patch.name = data.name;
        if ('body' in data) patch.body = data.body;
        if ('variables' in data) patch.variables = JSON.stringify(data.variables ?? []);
        // subject only meaningful for email; ignore on sms.
        if ('subject' in data && existing.channel === 'email') patch.subject = data.subject ?? null;
        await this.drizzle.update(messageTemplates).set(patch)
            .where(and(eq(messageTemplates.id, id), eq(messageTemplates.tenantId, tenantId)));
        return (await this.get(tenantId, id))!;
    }

    async duplicate(tenantId: string, id: string): Promise<MessageTemplateRow> {
        const src = await this.get(tenantId, id);
        if (!src) throw Errors.NotFound('Template not found');
        return this.create(tenantId, {
            name: `${src.name} (Copy)`, channel: src.channel,
            subject: src.subject, body: src.body, variables: src.variables,
        });
    }

    async referencingAutomations(tenantId: string, id: string): Promise<Array<{ id: string; name: string }>> {
        return this.drizzle.select({ id: automations.id, name: automations.name }).from(automations)
            .where(and(eq(automations.tenantId, tenantId),
                or(eq(automations.emailTemplateId, id), eq(automations.smsTemplateId, id))));
    }

    async delete(tenantId: string, id: string): Promise<void> {
        const existing = await this.get(tenantId, id);
        if (!existing) throw Errors.NotFound('Template not found');
        const refs = await this.referencingAutomations(tenantId, id);
        if (refs.length > 0) {
            throw Errors.Conflict(`Template is in use by ${refs.length} automation(s): ${refs.map((r) => r.name).join(', ')}`);
        }
        await this.drizzle.delete(messageTemplates)
            .where(and(eq(messageTemplates.id, id), eq(messageTemplates.tenantId, tenantId)));
    }
}
