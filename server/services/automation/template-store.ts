import { MessageTemplateService } from '../message-template.service';

/**
 * SP2 — OI's adapter for the SP-ENG `TemplateStore` port. Resolves a
 * message_templates row to the port shape `{ channel, subject?, body, variables }`.
 * Tenant-scoped (fail-closed): a wrong tenant or unknown id resolves to null.
 */
export interface ResolvedTemplate {
    channel: 'email' | 'sms';
    subject?: string;
    body: string;
    variables: string[];
}
export interface TemplateStore {
    resolve(tenantId: string, templateId: string): Promise<ResolvedTemplate | null>;
}

export function createOiTemplateStore(db: D1Database): TemplateStore {
    const svc = new MessageTemplateService(db);
    return {
        async resolve(tenantId, templateId) {
            const t = await svc.get(tenantId, templateId);
            if (!t) return null;
            const out: ResolvedTemplate = { channel: t.channel, body: t.body, variables: t.variables };
            if (t.subject != null) out.subject = t.subject;
            return out;
        },
    };
}
