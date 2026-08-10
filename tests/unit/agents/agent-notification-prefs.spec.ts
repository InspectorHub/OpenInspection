/**
 * The agent's three notifications, gated where every notification is gated.
 *
 * This file used to assert that `sendNewReferral` read `agent.notifyOnReferral`
 * and returned early. That guarantee still holds — an agent who switches
 * referral mail off does not get referral mail — but it is no longer the send
 * METHOD's job, and pinning it there was pinning the wrong thing: three methods
 * each carried their own copy of the check, and the ~45 notifications with no
 * column simply had no off switch at all.
 *
 * So the assertions below sit on the far side of the boundary: a real row in
 * `notification_preferences`, the real port, and what actually reached the
 * PROVIDER. That also covers the part the old flags could not express — the
 * class id the boundary gates on is derived from the same trigger that rendered
 * the body, so a method cannot render one notification and be gated as another.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, setupSchema, toRawD1 } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// eslint-disable-next-line import/order
import { EmailService } from '../../../server/services/email.service';
// eslint-disable-next-line import/order
import { buildNotificationPreferences } from '../../../server/lib/notifications/preference-port';
import { recordingEmailProvider } from '../helpers/email-provider';

const TENANT = 't-agent-prefs';
const AGENT_EMAIL = 'jane@realty.com';
const AGENT_ID = 'ag1';
/** The agent's `contacts` row in this tenant — see `seedAgent`. */
const CONTACT_ID = 'c-agent';

let db: BetterSQLite3Database<typeof schema>;
let sqlite: { close: () => void };
let rawDb: D1Database;
let sent: string[][];

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db as BetterSQLite3Database<typeof schema>;
    sqlite = fx.sqlite;
    await setupSchema(fx.sqlite);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockDrizzle as any).mockReturnValue(db);
    rawDb = toRawD1(fx.sqlite);
    sent = [];

    await db.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', slug: TENANT, status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    } as never);
});
afterEach(() => sqlite.close());

/**
 * A partner agent as they actually exist: a GLOBAL `users` row (`tenant_id IS
 * NULL` — one account across every company they refer to) plus a per-tenant
 * `contacts` row bound to it by `autoLinkSameEmail`. The send happens inside one
 * tenant, so the contact is the identity the port can resolve there.
 */
async function seedAgent() {
    await db.insert(schema.users).values({
        id: AGENT_ID, tenantId: null, email: AGENT_EMAIL, name: 'Jane',
        role: 'agent', passwordHash: 'H', createdAt: new Date(),
    } as never);
    await db.insert(schema.contacts).values({
        id: CONTACT_ID, tenantId: TENANT, type: 'agent', name: 'Jane',
        email: AGENT_EMAIL, agentUserId: AGENT_ID, createdAt: new Date(),
    } as never);
}

async function choose(classId: string, enabled: boolean) {
    await db.insert(schema.notificationPreferences).values({
        id: `np-${classId}`, tenantId: TENANT, subjectKind: 'contact', subjectId: CONTACT_ID,
        classId, channel: 'email', enabled, createdAt: new Date(), updatedAt: new Date(),
    } as never);
}

/**
 * No renderer is injected, so `renderOr` returns each method's fallback body
 * with `enabled: true` and `sendRendered` still stamps the class from the
 * trigger. That is the path under test — nothing here depends on a template row
 * existing, which would otherwise let a send be skipped for the wrong reason.
 */
function service() {
    return new EmailService(
        're_test', 'from@acme.com', 'Acme',
        undefined, undefined, undefined,
        recordingEmailProvider(sent),
        undefined, undefined,
        buildNotificationPreferences(rawDb, TENANT),
    );
}

const referral = { propertyAddress: '1 Main', clientName: 'Sarah', dashboardUrl: 'https://example.com/agent-dashboard' };
const report = { propertyAddress: '1 Main', reportUrl: 'https://example.com/report/i-1?view=agent' };
const paid = { propertyAddress: '1 Main', amountCents: 47500 };
const agentArg = { id: AGENT_ID, email: AGENT_EMAIL, name: 'Jane' };

describe('agent notifications the agent chose to keep', () => {
    it('sends a new referral when nothing says otherwise', async () => {
        await seedAgent();
        await service().sendNewReferral(agentArg, referral);
        expect(sent).toEqual([[AGENT_EMAIL]]);
    });

    it('sends a report-ready notice when nothing says otherwise', async () => {
        await seedAgent();
        await service().sendAgentReportReady(agentArg, report);
        expect(sent).toEqual([[AGENT_EMAIL]]);
    });
});

describe('agent notifications the agent switched off', () => {
    it('withholds a new referral', async () => {
        await seedAgent();
        await choose('agent-new-referral', false);
        await service().sendNewReferral(agentArg, referral);
        expect(sent).toEqual([]);
    });

    it('withholds a report-ready notice', async () => {
        await seedAgent();
        await choose('agent-report-ready', false);
        await service().sendAgentReportReady(agentArg, report);
        expect(sent).toEqual([]);
    });

    it('does not confuse the two — muting referrals leaves report-ready alone', async () => {
        // The class comes from the trigger that rendered the body, so this is
        // the assertion that a method cannot be gated as its neighbour.
        await seedAgent();
        await choose('agent-new-referral', false);
        await service().sendAgentReportReady(agentArg, report);
        expect(sent).toEqual([[AGENT_EMAIL]]);
    });
});

describe('invoice-paid is the one that defaults to OFF', () => {
    /**
     * `is_paid_notification_enabled` defaulted to FALSE, and the new model reads
     * absence as "send". Migrating naively would have started mailing every
     * partner agent about every payment. `defaultEnabled: false` on the class
     * moved the default across with the data, so absence here means silence and
     * the stored row is what says "yes, send me this".
     */
    it('withholds invoice-paid with no row at all', async () => {
        await seedAgent();
        await service().sendInvoicePaid(agentArg, paid);
        expect(sent).toEqual([]);
    });

    it('sends invoice-paid once the agent asks for it', async () => {
        await seedAgent();
        await choose('agent-invoice-paid', true);
        await service().sendInvoicePaid(agentArg, paid);
        expect(sent).toEqual([[AGENT_EMAIL]]);
    });

    it('stays off for an address the tenant cannot resolve to anyone', async () => {
        // Nothing seeded: no user, no contact. The class default is the only
        // answer available, and for this one it is "do not send" — an
        // unresolvable address must not become a way around an off-by-default.
        await service().sendInvoicePaid(agentArg, paid);
        expect(sent).toEqual([]);
    });
});
