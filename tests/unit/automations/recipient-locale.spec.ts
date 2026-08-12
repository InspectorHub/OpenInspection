/**
 * One trigger firing, two languages.
 *
 * The recipient's locale is NOT the request's locale. A trigger fires from
 * another user's request, from cron, or from a queue consumer — and in the last
 * two there is no request at all, so `getLocale()` answers `baseLocale` for
 * everyone. Every assertion here is written so that an implementation which
 * read the ambient locale, or which hardcoded English, would produce a
 * DIFFERENT, observable string.
 *
 * The mixed-locale inspection is the subject: an English-reading agent and a
 * Spanish-reading client on the same property, notified by one rule.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { asD1Db } from '../helpers/test-db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { AutomationService } from '../../../server/services/automation.service';
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
// eslint-disable-next-line no-restricted-imports -- the ambient locale is the thing under test; a spec that cannot set it cannot prove rendering ignores it.
import { overwriteGetLocale, baseLocale } from '~/paraglide/runtime';

const T = '00000000-0000-0000-0000-00000000c0de';
const OTHER_T = '00000000-0000-0000-0000-00000000c0df';
const INSP = '00000000-0000-0000-0000-00000000cafe';
const roleProfileId = (key: string) => `crp_${T}_${key}`;

let db: BetterSQLite3Database<typeof schema>;
let svc: AutomationService;

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

    for (const [id, slug] of [[T, 'acme-c0de'], [OTHER_T, 'other-c0df']] as const) {
        await db.insert(schema.tenants).values({
            id, slug, status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        } as never);
    }
    // The tenant reads English. Every Spanish string below therefore has to
    // come from the RECIPIENT, not from the company's own default.
    await db.insert(schema.tenantConfigs).values({
        tenantId: T, defaultLocale: 'en-US', updatedAt: new Date(),
    } as never);
    await seedRoleProfiles(asD1Db(db), T, new Date(1));
    await db.insert(schema.inspections).values({
        id: INSP, tenantId: T, propertyAddress: '12 Oak Lane', date: '2026-06-01',
        status: 'completed', reportStatus: 'published', paymentStatus: 'unpaid',
        price: 0, agreementRequired: false, paymentRequired: false, createdAt: new Date(),
    } as never);

    svc = new AutomationService({} as D1Database);
    vi.spyOn(svc, 'ensureSeeds').mockResolvedValue();
});

afterEach(() => {
    overwriteGetLocale(() => baseLocale);
});

async function addPerson(id: string, opts: { role: string; email: string; locale: string | null; type?: 'client' | 'agent' }) {
    await db.insert(schema.contacts).values({
        id, tenantId: T, type: opts.type ?? 'client', name: id, email: opts.email,
        locale: opts.locale, createdAt: new Date(),
    } as never);
    await new PeopleService({ DB: {} as D1Database }).addPerson(T, INSP, id, roleProfileId(opts.role));
}

/** Seeds the Spanish variant FIRST so no assertion can be satisfied by a row
 *  that merely happens to come back earlier. */
async function seedInAppTemplate(opts: { spanish: boolean; tenantId?: string }) {
    const tenantId = opts.tenantId ?? T;
    if (opts.spanish) {
        await db.insert(schema.messageTemplates).values({
            id: `tpl-es-${tenantId}`, tenantId, name: 'Report ready (in-app)', channel: 'in_app',
            subject: 'Informe listo — {{property_address}}', body: 'Publicado por {{company_name}}.',
            variables: null, isSeeded: true, locale: 'es-419',
            createdAt: new Date(1), updatedAt: new Date(1),
        } as never);
    }
    await db.insert(schema.messageTemplates).values({
        id: `tpl-en-${tenantId}`, tenantId, name: 'Report ready (in-app)', channel: 'in_app',
        subject: 'Report ready — {{property_address}}', body: 'Published by {{company_name}}.',
        variables: null, isSeeded: true, locale: 'en',
        createdAt: new Date(2), updatedAt: new Date(2),
    } as never);
}

/**
 * The rule dispatches by EMAIL and carries an in-app template for the notice
 * header's wording — the header is written for every inserted log whatever the
 * channel. Deliberately not `channels: ["in_app"]`: `resolveRuleRecipients`
 * resolves any non-`email` channel through the PHONE column, so an `in_app` rule
 * aimed at contacts resolves nobody at all. That is a pre-existing defect on a
 * path unrelated to language, and fixing it inside a locale change would hide it.
 */
async function seedRule(opts: { inAppTemplateId: string | null }) {
    await db.insert(schema.automations).values({
        id: 'auto-locale', tenantId: T, name: 'Tell everyone', trigger: 'report.published',
        recipientKind: 'all', recipientRoleProfileId: null, delayMinutes: 0,
        channels: '["email"]',
        inAppTemplateId: opts.inAppTemplateId,
        active: true, isDefault: false, createdAt: new Date(),
    } as never);
}

const fire = () => svc.trigger({
    tenantId: T, inspectionId: INSP, triggerEvent: 'report.published',
    companyName: 'Acme', reportBaseUrl: 'https://app.example.com',
});

const titleFor = async (contactId: string) => {
    const rows = await db.select().from(schema.notifications);
    return rows.find((r) => r.contactId === contactId)?.title ?? null;
};

describe('recipient-locale notifications', () => {
    it('renders one trigger firing in two languages', async () => {
        await addPerson('client-1', { role: 'client', email: 'c@example.com', locale: 'es-419' });
        await addPerson('agent-1', { role: 'buyer_agent', email: 'a@example.com', locale: 'en', type: 'agent' });
        await seedInAppTemplate({ spanish: true });
        await seedRule({ inAppTemplateId: `tpl-en-${T}` });

        await fire();

        expect(await titleFor('agent-1')).toBe('Report ready — 12 Oak Lane');
        expect(await titleFor('client-1')).toBe('Informe listo — 12 Oak Lane');
    });

    it('does not read the ambient locale', async () => {
        // Set the ambient locale to Spanish and notify an English reader. If
        // rendering leaks ambient state this returns Spanish — which is exactly
        // what happens in a cron context today, only inverted and invisible.
        // The rule carries no in-app template, so this exercises `titleFor`,
        // the one place server code reads the message catalogue.
        overwriteGetLocale(() => 'es-419');
        await addPerson('agent-1', { role: 'buyer_agent', email: 'a@example.com', locale: 'en', type: 'agent' });
        await seedRule({ inAppTemplateId: null });

        await fire();

        expect(await titleFor('agent-1')).toBe('Report published — 12 Oak Lane');
    });

    it('renders the built-in title in the recipient\'s language, not the base locale', async () => {
        // The mirror of the test above, and the reason it is not enough on its
        // own: a `titleFor` that ignored its argument entirely would pass an
        // English-only assertion.
        await addPerson('client-1', { role: 'client', email: 'c@example.com', locale: 'es-419' });
        await seedRule({ inAppTemplateId: null });

        await fire();

        expect(await titleFor('client-1')).toBe('Informe publicado — 12 Oak Lane');
    });

    it('keeps sending English to a Spanish reader when no Spanish variant exists', async () => {
        // Degrade, never block. A tenant who has authored nothing in Spanish
        // must still deliver something — silence is the one unacceptable
        // outcome for a notification.
        await addPerson('client-1', { role: 'client', email: 'c@example.com', locale: 'es-419' });
        await seedInAppTemplate({ spanish: false });
        await seedRule({ inAppTemplateId: `tpl-en-${T}` });

        await fire();

        expect(await titleFor('client-1')).toBe('Report ready — 12 Oak Lane');
    });

    it('treats a null contact locale as absence, falling through to the tenant default', async () => {
        // The booking form deliberately does not ask for a language on the
        // agent-on-behalf branch, so NULL is the common case. It must mean
        // "fall back", never "fail" — and never "Spanish because the last
        // recipient was".
        await addPerson('client-1', { role: 'client', email: 'c@example.com', locale: 'es-419' });
        await addPerson('other-1', { role: 'buyer_agent', email: 'o@example.com', locale: null, type: 'agent' });
        await seedInAppTemplate({ spanish: true });
        await seedRule({ inAppTemplateId: `tpl-en-${T}` });

        await fire();

        expect(await titleFor('client-1')).toBe('Informe listo — 12 Oak Lane');
        expect(await titleFor('other-1')).toBe('Report ready — 12 Oak Lane');
    });

    it('never picks another tenant\'s variant', async () => {
        // The only es-419 row in the table belongs to someone else, under the
        // same name and channel. A fallback chain that walked locales without
        // pinning the tenant would put another company's copy in this client's
        // inbox.
        await db.insert(schema.messageTemplates).values({
            id: 'tpl-leak', tenantId: OTHER_T, name: 'Report ready (in-app)', channel: 'in_app',
            subject: 'FILTRADO — {{property_address}}', body: 'x',
            variables: null, isSeeded: true, locale: 'es-419',
            createdAt: new Date(1), updatedAt: new Date(1),
        } as never);
        await addPerson('client-1', { role: 'client', email: 'c@example.com', locale: 'es-419' });
        await seedInAppTemplate({ spanish: false });
        await seedRule({ inAppTemplateId: `tpl-en-${T}` });

        await fire();

        expect(await titleFor('client-1')).toBe('Report ready — 12 Oak Lane');
    });
});
