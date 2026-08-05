import { MessageTemplateService, type TemplateChannel } from '../message-template.service';

/**
 * SP2 — OI's adapter for the SP-ENG `TemplateStore` port. Resolves a
 * message_templates row to the port shape `{ channel, subject?, body, variables }`.
 * Tenant-scoped (fail-closed): a wrong tenant or unknown id resolves to null.
 */
interface ResolvedTemplate {
    // Widened with the column (B1). The transport core stays email/sms-only on
    // purpose — an in_app "delivery" never reaches it (delivery.ts settles the
    // ledger row directly), so this type is the only one that has to know.
    channel: TemplateChannel;
    subject?: string;
    body: string;
    variables: string[];
}
export interface TemplateStore {
    /**
     * `locale` names the RECIPIENT's language, and supplying it switches the
     * lookup from "this row" to "this row's variant for that reader", with the
     * fallback chain in `MessageTemplateService#resolveForLocale`. Omitting it
     * is not a shorthand for English — it means the caller is inspecting the
     * referenced row itself (the agreement-URL content gate in trigger.ts),
     * where walking to a translation would answer a different question.
     */
    resolve(tenantId: string, templateId: string, locale?: string | null): Promise<ResolvedTemplate | null>;
}

export function createOiTemplateStore(db: D1Database): TemplateStore {
    const svc = new MessageTemplateService(db);
    return {
        async resolve(tenantId, templateId, locale) {
            const t = locale === undefined
                ? await svc.get(tenantId, templateId)
                : await svc.resolveForLocale(tenantId, templateId, locale);
            if (!t) return null;
            const out: ResolvedTemplate = { channel: t.channel, body: t.body, variables: t.variables };
            if (t.subject != null) out.subject = t.subject;
            return out;
        },
    };
}
