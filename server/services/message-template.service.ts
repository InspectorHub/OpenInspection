import { drizzle } from 'drizzle-orm/d1';
import { eq, and, or } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { messageTemplates, automations, tenantConfigs } from '../lib/db/schema';
import { Errors } from '../lib/errors';
import { normalizeLocale, type ContactLocale } from '../lib/i18n/contact-locale';

/** Derived from the column's enum so widening the schema propagates here. */
export type TemplateChannel = typeof messageTemplates.$inferSelect['channel'];

export interface MessageTemplateRow {
    id: string; tenantId: string; name: string; channel: TemplateChannel;
    subject: string | null; body: string; variables: string[];
    /** Which language variant this row IS. See the schema comment. */
    locale: string;
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
        // Rows written before the column existed read back as the default; a
        // NULL here would still mean "the English one", so say so rather than
        // letting `undefined` reach the resolver's comparisons.
        locale: r.locale ?? 'en',
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

    async list(tenantId: string, channel?: TemplateChannel): Promise<MessageTemplateRow[]> {
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

    /**
     * Every variant of one template — same `(tenant, name, channel)`, one row
     * per language. Ordered oldest-first so the authoring surface and the
     * resolver agree on which row is "the original" when a tenant holds
     * duplicates (nothing stops them; see the schema comment).
     */
    async variantsOf(tenantId: string, id: string): Promise<MessageTemplateRow[]> {
        const base = await this.get(tenantId, id);
        if (!base) return [];
        return this.siblings(tenantId, base.name, base.channel);
    }

    /** Tenant filter FIRST and unconditional — the locale chain walks locales,
     *  never tenants. */
    private async siblings(tenantId: string, name: string, channel: TemplateChannel): Promise<MessageTemplateRow[]> {
        const rows = await this.drizzle.select().from(messageTemplates)
            .where(and(
                eq(messageTemplates.tenantId, tenantId),
                eq(messageTemplates.name, name),
                eq(messageTemplates.channel, channel),
            ));
        return rows.map(serialize).sort((a, b) =>
            (a.createdAt - b.createdAt) || a.id.localeCompare(b.id));
    }

    /**
     * The variant of `id` to send to a recipient who reads `locale`.
     *
     * Chain: the requested locale → the tenant's configured default → `'en'` →
     * the referenced row itself. The last step is the point of the function: a
     * tenant who has authored no Spanish variant keeps sending English, because
     * silence is the one unacceptable outcome for a notification. This NEVER
     * returns null for a template that exists.
     *
     * `tenant_configs.default_locale` is a full BCP-47 tag (`en-US`) while this
     * column holds catalogue locales (`en`, `es-419`), so it is reduced through
     * `normalizeLocale` — comparing the two raw would never match.
     */
    async resolveForLocale(tenantId: string, id: string, locale: ContactLocale | string | null | undefined): Promise<MessageTemplateRow | null> {
        const base = await this.get(tenantId, id);
        if (!base) return null;
        const wanted = normalizeLocale(locale);
        // The overwhelmingly common case — an English recipient on an English
        // template — must not pay for a second query.
        if (wanted && base.locale === wanted) return base;

        const rows = await this.siblings(tenantId, base.name, base.channel);
        const tenantDefault = normalizeLocale(await this.tenantDefaultLocale(tenantId));
        const chain: Array<ContactLocale> = [];
        for (const candidate of [wanted, tenantDefault, 'en' as const]) {
            if (candidate && !chain.includes(candidate)) chain.push(candidate);
        }
        for (const want of chain) {
            const hit = rows.find((r) => r.locale === want);
            if (hit) return hit;
        }
        return base;
    }

    private async tenantDefaultLocale(tenantId: string): Promise<string | null> {
        try {
            const cfg = await this.drizzle.select({ defaultLocale: tenantConfigs.defaultLocale })
                .from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();
            return cfg?.defaultLocale ?? null;
        } catch {
            // A config read that fails must not stop a send; the chain simply
            // loses one rung and lands on 'en' or the referenced row.
            return null;
        }
    }

    async create(tenantId: string, data: { name: string; channel: TemplateChannel; subject?: string | null; body: string; variables?: string[]; locale?: string }): Promise<MessageTemplateRow> {
        const id = nanoid();
        const now = new Date();
        await this.drizzle.insert(messageTemplates).values({
            id, tenantId, name: data.name, channel: data.channel,
            // A variant's language is what the row IS, like its channel — set
            // at create and never patched, so an edit can never silently
            // reassign copy to a language it was not written in. An unsupported
            // tag lands on 'en' rather than becoming a variant nothing resolves.
            locale: normalizeLocale(data.locale) ?? 'en',
            // `subject` is the email subject AND the in-app notice title
            // (see the schema comment); only SMS has nowhere to put one.
            subject: data.channel === 'sms' ? null : (data.subject ?? null),
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
        if ('subject' in data && existing.channel !== 'sms') patch.subject = data.subject ?? null;
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
            locale: src.locale,
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
