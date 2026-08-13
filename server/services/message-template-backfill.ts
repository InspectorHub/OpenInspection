import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { automations, messageTemplates } from '../lib/db/schema';
import { AUTOMATION_SEEDS } from '../data/automation-seeds';

/** Collect {{var}} token names from one or more template strings. */
export function extractVars(...sources: (string | null | undefined)[]): string[] {
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
 * Standing repair path, not a one-time migration aid: `AutomationCore.ensureSeeds`
 * (`server/services/automation/core.ts`) calls this unconditionally at the end
 * of every run, for every tenant, so any automation rule missing a referenced
 * template — freshly seeded, hand-edited, or otherwise incomplete — is topped
 * up on the next call. The copy comes from the matching AUTOMATION_SEEDS entry
 * (matched on name+trigger, the same key ensureSeeds uses); `automations`
 * carries no inline copy of its own (the `subject_template` / `body_template` /
 * `sms_body` columns that used to hold it are dropped), so a seed match is the
 * ONLY source. This function is also the only writer of `inAppTemplateId`
 * anywhere in the codebase — see `server/services/automation/notice-wording.ts`
 * for the sole reader. A custom (non-seed) rule that reaches this function
 * with no template id simply gets no template — there is no seed copy left to
 * fall back to. Re-running is a no-op: an automation that already has a
 * non-null ref id is skipped per channel.
 */
export async function backfillAutomationTemplates(db: D1Database, tenantId: string): Promise<{ created: number }> {
    const d = drizzle(db);
    const rules = await d.select().from(automations).where(eq(automations.tenantId, tenantId));
    let created = 0;
    const now = new Date();

    for (const a of rules) {
        const patch: Partial<typeof automations.$inferInsert> = {};

        const channels = parseChannels(a.channels);

        // Matched on (name, trigger), the same key ensureSeeds uses to decide a
        // rule already exists. The only remaining source of embedded copy for
        // any channel — see the function doc comment.
        const seed = AUTOMATION_SEEDS.find(
            (x) => x.name === a.name && x.trigger === a.trigger,
        ) as { subjectTemplate?: string; bodyTemplate?: string; smsBody?: string; inAppTitle?: string; inAppBody?: string } | undefined;

        // Only give a rule an EMAIL template when it actually has an email
        // channel. B3's staff alerts are in-app only, and creating an email
        // template for them would put a row in the operator's template library
        // that nothing can ever send.
        if (channels.includes('email') && !a.emailTemplateId) {
            const id = nanoid();
            await d.insert(messageTemplates).values({
                id, tenantId, name: `${a.name} — Email`, channel: 'email',
                subject: seed?.subjectTemplate ?? null, body: seed?.bodyTemplate ?? '',
                variables: JSON.stringify(extractVars(seed?.subjectTemplate, seed?.bodyTemplate)),
                isSeeded: true, createdAt: now, updatedAt: now,
            });
            patch.emailTemplateId = id;
            created++;
        }

        const smsText = seed?.smsBody;
        if (channels.includes('sms') && smsText?.trim() && !a.smsTemplateId) {
            const id = nanoid();
            await d.insert(messageTemplates).values({
                id, tenantId, name: `${a.name} — SMS`, channel: 'sms',
                subject: null, body: smsText,
                variables: JSON.stringify(extractVars(smsText)),
                isSeeded: true, createdAt: now, updatedAt: now,
            });
            patch.smsTemplateId = id;
            created++;
        }

        // B3 (IA-115) — the in-app wording. `subject` is the notice TITLE and
        // `body` its body (see the message_templates schema comment), so the
        // literal that used to live in `titleFor` becomes a row the operator
        // can rewrite. The wording lives in the SEED, not on the row:
        // `automations` has no title column and adding one would duplicate
        // what the template is for.
        if (channels.includes('in_app') && seed?.inAppTitle?.trim() && !a.inAppTemplateId) {
            const id = nanoid();
            await d.insert(messageTemplates).values({
                id, tenantId, name: `${a.name} — In-app`, channel: 'in_app',
                subject: seed.inAppTitle, body: seed.inAppBody ?? '',
                variables: JSON.stringify(extractVars(seed.inAppTitle, seed.inAppBody)),
                isSeeded: true, createdAt: now, updatedAt: now,
            });
            patch.inAppTemplateId = id;
            created++;
        }

        if (Object.keys(patch).length > 0) {
            await d.update(automations).set(patch).where(and(eq(automations.id, a.id), eq(automations.tenantId, tenantId)));
        }
    }
    return { created };
}
