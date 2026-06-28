import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { automations, messageTemplates } from '../lib/db/schema';

/** Collect {{var}} token names from one or more template strings. */
function extractVars(...sources: (string | null | undefined)[]): string[] {
    const found = new Set<string>();
    for (const s of sources) {
        if (!s) continue;
        for (const m of s.matchAll(/\{\{(\w+)\}\}/g)) found.add(m[1]);
    }
    return [...found];
}

function parseChannels(raw: string | null): string[] {
    if (!raw) return ['email'];
    try { const a = JSON.parse(raw); return Array.isArray(a) ? a : ['email']; } catch { return ['email']; }
}

/**
 * SP2 — one-time, idempotent backfill: migrate each automation's embedded
 * email subject/body and (when SMS-enabled) sms_body into seeded
 * message_templates and set email_template_id / sms_template_id. Re-running is a
 * no-op: an automation that already has a non-null ref id is skipped per channel.
 */
export async function backfillAutomationTemplates(db: D1Database, tenantId: string): Promise<{ created: number }> {
    const d = drizzle(db);
    const rules = await d.select().from(automations).where(eq(automations.tenantId, tenantId));
    let created = 0;
    const now = new Date();

    for (const a of rules) {
        const patch: Partial<typeof automations.$inferInsert> = {};

        if (!a.emailTemplateId) {
            const id = nanoid();
            await d.insert(messageTemplates).values({
                id, tenantId, name: `${a.name} — Email`, channel: 'email',
                subject: a.subjectTemplate ?? null, body: a.bodyTemplate ?? '',
                variables: JSON.stringify(extractVars(a.subjectTemplate, a.bodyTemplate)),
                isSeeded: true, createdAt: now, updatedAt: now,
            });
            patch.emailTemplateId = id;
            created++;
        }

        const channels = parseChannels(a.channels);
        if (channels.includes('sms') && a.smsBody?.trim() && !a.smsTemplateId) {
            const id = nanoid();
            await d.insert(messageTemplates).values({
                id, tenantId, name: `${a.name} — SMS`, channel: 'sms',
                subject: null, body: a.smsBody,
                variables: JSON.stringify(extractVars(a.smsBody)),
                isSeeded: true, createdAt: now, updatedAt: now,
            });
            patch.smsTemplateId = id;
            created++;
        }

        if (Object.keys(patch).length > 0) {
            await d.update(automations).set(patch).where(and(eq(automations.id, a.id), eq(automations.tenantId, tenantId)));
        }
    }
    return { created };
}
