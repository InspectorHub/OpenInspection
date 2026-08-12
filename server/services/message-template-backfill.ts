import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { automations, messageTemplates, tenants } from '../lib/db/schema';
import { AUTOMATION_SEEDS } from '../data/automation-seeds';

/** KV key latching {@link runAutomationTemplateBackfillOnce} — see its doc comment. */
const BACKFILL_MARKER_KEY = 'migration:automation-templates-backfill:done';

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

        const channels = parseChannels(a.channels);

        // Only give a rule an EMAIL template when it actually has an email
        // channel. B3's staff alerts are in-app only, and creating an email
        // template for them would put a row in the operator's template library
        // that nothing can ever send.
        if (channels.includes('email') && !a.emailTemplateId) {
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

        // Matched on (name, trigger), the same key ensureSeeds uses to decide a
        // rule already exists. Used below by both the SMS fallback and the
        // in-app wording, neither of which is guaranteed to live on the row.
        const seed = AUTOMATION_SEEDS.find(
            (x) => x.name === a.name && x.trigger === a.trigger,
        ) as { smsBody?: string; inAppTitle?: string; inAppBody?: string } | undefined;

        // The SMS copy may live on the dead `automations.sms_body` column (rows
        // seeded before ensureSeeds started inserting templates directly) or,
        // for rows seeded after that cutover, only on the seed definition —
        // ensureSeeds never writes the column for those, since a fresh seed's
        // channels default to email-only and the SMS template (with its own
        // copy) is created later, once the tenant turns the SMS channel on.
        const smsText = a.smsBody ?? seed?.smsBody;
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

/**
 * Every tenant, once. `backfillAutomationTemplates` is idempotent and lazy —
 * it runs when a tenant opens automations — so tenants that have not touched
 * the feature still hold their copy on the automations row. This is the sweep
 * that finishes the job before those columns are dropped, and it is deleted
 * together with them.
 *
 * Deliberately cross-tenant: it iterates every row in `tenants` with no
 * `tenantId` filter, unlike every other query in this file. That is the
 * point — it exists to reach tenants the lazy per-tenant path has not.
 */
export async function backfillAllTenants(db: D1Database): Promise<{ tenants: number; created: number }> {
    const d = drizzle(db);
    const rows = await d.select({ id: tenants.id }).from(tenants);
    let created = 0;
    for (const t of rows) {
        const r = await backfillAutomationTemplates(db, t.id);
        created += r.created;
    }
    return { tenants: rows.length, created };
}

/**
 * One-shot migration aid, called from the scheduled (cron) handler
 * (`server/scheduled.ts`) — NOT from an HTTP route. `backfillAllTenants` is
 * deliberately cross-tenant (it writes rows for every tenant in this D1
 * database), and cron is the only place that operation belongs: a per-tenant
 * `owner`/`manager` role has no business triggering writes across every OTHER
 * tenant, which is why the earlier version of this migration — a
 * `POST /api/admin/system/backfill-automation-templates` route guarded by
 * `requireRole('owner', 'manager')` — was wrong and was removed.
 *
 * Latched via a marker key in `TENANT_CACHE` so the sweep runs exactly ONCE
 * across all cron ticks (every 5 minutes in production), not once per tick.
 * The marker is written ONLY after `sweep` resolves — a thrown error leaves
 * it unset so the next tick retries.
 *
 * Delete this function, its call site in `server/scheduled.ts`, and
 * `backfillAllTenants` together once the migration is confirmed complete
 * everywhere and the drained `automations` copy columns are dropped. It has
 * no purpose after that point.
 *
 * @param sweep Injected for tests only; production always uses the default
 *   (real) `backfillAllTenants`.
 */
export async function runAutomationTemplateBackfillOnce(
    db: D1Database,
    kv: KVNamespace | undefined,
    sweep: (db: D1Database) => Promise<{ tenants: number; created: number }> = backfillAllTenants,
): Promise<{ ran: boolean; result?: { tenants: number; created: number } }> {
    // No KV binding → no way to latch the one-shot guarantee, so skip rather
    // than risk running the cross-tenant sweep on every single tick.
    if (!kv) return { ran: false };
    if (await kv.get(BACKFILL_MARKER_KEY)) return { ran: false };

    const result = await sweep(db);
    await kv.put(BACKFILL_MARKER_KEY, new Date().toISOString());
    return { ran: true, result };
}
