/**
 * Multilingual delivery — picking the right LANGUAGE VARIANT of a template.
 *
 * The interesting behaviour is not "the Spanish row comes back when it exists".
 * It is what happens when it does NOT: a tenant who has authored no Spanish
 * variant must keep sending English, because silence is the one unacceptable
 * outcome for a notification. Every fallback rung below is therefore seeded so
 * that a WRONG answer is a different, observable string — a resolver that
 * hardcoded English, or one that quietly widened its tenant filter, fails here
 * rather than passing on a happy path.
 *
 * Rows are inserted in an ADVERSE order (the variant that must NOT win first)
 * so no assertion can be satisfied by a row-order accident.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageTemplateService } from '../../../server/services/message-template.service';
import { eq } from 'drizzle-orm';
import { messageTemplates, tenantConfigs, tenants } from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const T = 'tenant-1';
const OTHER = 'tenant-2';

describe('template resolution by locale', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let svc: MessageTemplateService;

    beforeEach(async () => {
        const fx = createTestDb(); testDb = fx.db; await setupSchema(fx.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        svc = new MessageTemplateService({} as D1Database);
    });

    const setTenantLocale = async (tenantId: string, locale: string) => {
        await testDb.insert(tenants).values({
            id: tenantId, slug: tenantId, status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await testDb.insert(tenantConfigs)
            .values({ tenantId, defaultLocale: locale, updatedAt: new Date() });
    };

    it('returns the exact locale variant when it exists', async () => {
        // Spanish first: if the resolver walked rows in insertion order and
        // stopped at the first match, this ordering would hide the bug.
        const es = await svc.create(T, { name: 'Reminder', channel: 'email', subject: 'Recordatorio', body: 'es-body', locale: 'es-419' });
        const en = await svc.create(T, { name: 'Reminder', channel: 'email', subject: 'Reminder',    body: 'en-body', locale: 'en' });

        expect((await svc.resolveForLocale(T, en.id, 'es-419'))!.id).toBe(es.id);
        expect((await svc.resolveForLocale(T, es.id, 'en'))!.id).toBe(en.id);
    });

    it('reduces a regional tag to its catalogue variant', async () => {
        const es = await svc.create(T, { name: 'Reminder', channel: 'sms', body: 'es-body', locale: 'es-419' });
        const en = await svc.create(T, { name: 'Reminder', channel: 'sms', body: 'en-body', locale: 'en' });
        // A contact who stored es-MX is a Spanish speaker, not an English one.
        expect((await svc.resolveForLocale(T, en.id, 'es-MX'))!.id).toBe(es.id);
    });

    it('falls back to the tenant default locale before English', async () => {
        // The tenant's configured locale is a full BCP-47 tag; the column holds
        // catalogue locales. If the resolver compared them raw, this rung would
        // never fire and the English row below would win.
        await setTenantLocale(T, 'es-MX');
        const es = await svc.create(T, { name: 'Reminder', channel: 'email', subject: 'Recordatorio', body: 'es-body', locale: 'es-419' });
        const en = await svc.create(T, { name: 'Reminder', channel: 'email', subject: 'Reminder',    body: 'en-body', locale: 'en' });

        // Nothing is known about this recipient's language (a null
        // `contacts.locale` is the common case — the booking form deliberately
        // does not ask on the agent-on-behalf branch).
        const picked = await svc.resolveForLocale(T, en.id, null);
        expect(picked!.id).toBe(es.id);
        expect(picked!.body).toBe('es-body');
    });

    it('keeps sending English when the tenant authored no Spanish variant', async () => {
        const en = await svc.create(T, { name: 'Reminder', channel: 'email', subject: 'Reminder', body: 'en-body', locale: 'en' });
        const picked = await svc.resolveForLocale(T, en.id, 'es-419');
        // Degrade, never block: a null here is a notification that never goes out.
        expect(picked).not.toBeNull();
        expect(picked!.body).toBe('en-body');
    });

    it('returns the referenced row when neither the tenant default nor English exists', async () => {
        // The last rung. A tenant whose only variant is Spanish, addressing an
        // English reader, still sends something.
        const es = await svc.create(T, { name: 'Reminder', channel: 'sms', body: 'es-body', locale: 'es-419' });
        const picked = await svc.resolveForLocale(T, es.id, 'en');
        expect(picked!.id).toBe(es.id);
    });

    it('never returns a template from another tenant', async () => {
        // The other tenant's Spanish copy is created FIRST and is the only
        // es-419 row in the table. A resolver that walked locales without
        // pinning the tenant would leak this company's outbound copy.
        await setTenantLocale(T, 'es-MX');
        const leak = await svc.create(OTHER, { name: 'Reminder', channel: 'email', subject: 'Recordatorio', body: 'LEAKED', locale: 'es-419' });
        const en = await svc.create(T, { name: 'Reminder', channel: 'email', subject: 'Reminder', body: 'en-body', locale: 'en' });

        const picked = await svc.resolveForLocale(T, en.id, 'es-419');
        expect(picked!.tenantId).toBe(T);
        expect(picked!.id).not.toBe(leak.id);
        expect(picked!.body).toBe('en-body');
    });

    it('never crosses channels', async () => {
        // Same tenant, same name, different channel: an SMS variant is not a
        // translation of an email template, and rendering one as the other
        // would send a plain-text stub as an HTML body.
        const smsEs = await svc.create(T, { name: 'Reminder', channel: 'sms', body: 'sms-es', locale: 'es-419' });
        const en = await svc.create(T, { name: 'Reminder', channel: 'email', subject: 'Reminder', body: 'en-body', locale: 'en' });

        const picked = await svc.resolveForLocale(T, en.id, 'es-419');
        expect(picked!.id).not.toBe(smsEs.id);
        expect(picked!.channel).toBe('email');
    });

    it('is deterministic when a tenant holds duplicate variants', async () => {
        // Nothing enforces uniqueness on (tenant, name, channel, locale) —
        // `create` accepts any name and `update` renames freely — so duplicates
        // are reachable and the resolver must not pick at random.
        const first  = await svc.create(T, { name: 'Reminder', channel: 'email', subject: 'A', body: 'first',  locale: 'es-419' });
        const second = await svc.create(T, { name: 'Reminder', channel: 'email', subject: 'B', body: 'second', locale: 'es-419' });
        const en = await svc.create(T, { name: 'Reminder', channel: 'email', subject: 'C', body: 'en-body', locale: 'en' });

        const a = await svc.resolveForLocale(T, en.id, 'es-419');
        const b = await svc.resolveForLocale(T, en.id, 'es-419');
        expect(a!.id).toBe(b!.id);
        expect([first.id, second.id]).toContain(a!.id);
    });

    it('defaults an unknown id to null and an unsupported authored tag to en', async () => {
        expect(await svc.resolveForLocale(T, 'nope', 'en')).toBeNull();
        // A variant stored under a language we have no messages for would be
        // unreachable by the chain; it lands on 'en' at create time instead.
        const t = await svc.create(T, { name: 'Reminder', channel: 'sms', body: 'b', locale: 'fr-FR' });
        expect(t.locale).toBe('en');
    });

    it('lists every variant of one template, oldest first', async () => {
        const es = await svc.create(T, { name: 'Reminder', channel: 'email', subject: 'Recordatorio', body: 'es', locale: 'es-419' });
        const en = await svc.create(T, { name: 'Reminder', channel: 'email', subject: 'Reminder', body: 'en', locale: 'en' });
        await svc.create(T, { name: 'Other', channel: 'email', subject: 'X', body: 'x', locale: 'en' });

        // Age `es` explicitly. `createdAt` is millisecond precision and these two
        // creates routinely land in the SAME millisecond, at which point the
        // service's `|| a.id.localeCompare(b.id)` tiebreak decides — and the ids
        // are random nanoids, so the order is a coin flip. This test used to fail
        // roughly half the time under load and pass every time in isolation,
        // which reads as "flaky test" and is really "the fixture never
        // established the difference it asserts on".
        testDb.update(messageTemplates)
            .set({ createdAt: new Date(Date.now() - 60_000) })
            .where(eq(messageTemplates.id, es.id))
            .run();

        const variants = await svc.variantsOf(T, en.id);
        expect(variants.map((v) => v.id)).toEqual([es.id, en.id]);
    });
});
