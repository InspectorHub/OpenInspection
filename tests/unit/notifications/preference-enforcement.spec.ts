/**
 * Preferences, enforced where the send happens.
 *
 * Two halves, and the split matters: the PORT decides whether a class may be
 * withheld from an address, and the BOUNDARY decides what to do about it. A
 * screen that lets someone switch a notification off is a lie until both work,
 * and the failure is invisible — nobody reports mail they did not receive, and
 * nobody reports mail they DID receive after muting it either.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, setupSchema, toRawD1 } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// eslint-disable-next-line import/order
import { buildNotificationPreferences, isPreferenceMuted } from '../../../server/lib/notifications/preference-port';
// eslint-disable-next-line import/order
import { EmailBaseService } from '../../../server/services/email/base';
// eslint-disable-next-line import/order
import { assembleTenantEmailService, type EmailServiceEnv } from '../../../server/lib/email/build-email-service';
import { recordingEmailProvider } from '../helpers/email-provider';

const TENANT = 't-pref';
const ADDR = 'jo@example.com';

let db: BetterSQLite3Database<typeof schema>;
let sqlite: { close: () => void };
let rawDb: D1Database;

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db as BetterSQLite3Database<typeof schema>;
    sqlite = fx.sqlite;
    await setupSchema(fx.sqlite);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockDrizzle as any).mockReturnValue(db);
    rawDb = toRawD1(fx.sqlite);
    await db.insert(schema.tenants).values({
        id: TENANT, slug: TENANT, status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    } as never);
});
afterEach(() => sqlite.close());

async function seedContact(id = 'c1', email = ADDR) {
    await db.insert(schema.contacts).values({
        id, tenantId: TENANT, type: 'client', name: 'Jo', email, createdAt: new Date(),
    } as never);
}
async function mute(classId: string, subjectId = 'c1', subjectKind: 'contact' | 'user' = 'contact') {
    await db.insert(schema.notificationPreferences).values({
        id: `np-${subjectKind}-${subjectId}-${classId}`, tenantId: TENANT,
        subjectKind, subjectId, classId, channel: 'email', enabled: false,
        createdAt: new Date(), updatedAt: new Date(),
    } as never);
}
const port = () => buildNotificationPreferences(rawDb, TENANT);

describe('preference port', () => {
    it('withholds a class the recipient switched off', async () => {
        await seedContact();
        await mute('booking-confirmation');
        expect(await port().isMuted('booking-confirmation', ADDR)).toBe(true);
    });

    it('REFUSES to withhold a required class, even with a row that says to', async () => {
        // The row exists and says enabled=false. It must not be honoured: the
        // screen tells this recipient password-reset is always sent, and the
        // send path has to agree with the screen or one of them is lying.
        await seedContact();
        await mute('password-reset');
        expect(await port().isMuted('password-reset', ADDR)).toBe(false);
    });

    it('refuses to withhold a class it has never heard of — fail closed', async () => {
        await seedContact();
        await mute('some.future.notification');
        expect(await port().isMuted('some.future.notification', ADDR)).toBe(false);
    });

    it('sends when there is no row at all — absence is not "off"', async () => {
        await seedContact();
        expect(await port().isMuted('booking-confirmation', ADDR)).toBe(false);
    });

    it('honours a mute held in the OTHER id space — one person, one choice', async () => {
        // An agent with an account who is also a contact on an inspection is
        // the same human. Making them switch the same thing off twice is the
        // kind of half-working control that is worse than none.
        await seedContact();
        await db.insert(schema.users).values({
            id: 'u1', tenantId: TENANT, email: ADDR, passwordHash: 'x', role: 'owner', createdAt: new Date(),
        } as never);
        await mute('booking-confirmation', 'u1', 'user');
        expect(await port().isMuted('booking-confirmation', ADDR)).toBe(true);
    });

    it('crosses the id spaces in BOTH directions, and that is deliberate', async () => {
        // Deviation D3 in the spec. `autoLinkSameEmail` exists specifically so
        // one email is both a `users` row and several `contacts` rows, so the
        // boundary honours a mute held on either side. The consequence worth
        // pinning: if a tenant also keeps a STAFF address in `contacts`, that
        // person's mute crosses both identities. That is the intent — they are
        // one human with one inbox — and a later change that narrows the lookup
        // to a single space must fail here rather than quietly halve the control.
        await seedContact();
        await db.insert(schema.users).values({
            id: 'u1', tenantId: TENANT, email: ADDR, passwordHash: 'x', role: 'inspector', createdAt: new Date(),
        } as never);

        // Muted on the CONTACT side; the address is also a user.
        await mute('booking-confirmation', 'c1', 'contact');
        expect(await port().isMuted('booking-confirmation', ADDR)).toBe(true);
    });

    it('does not cross identities ACROSS tenants', async () => {
        // The cross-identity rule is inside one tenant. The same address being
        // a user here and a contact somewhere else is two relationships, not one.
        await seedContact();
        // `users.tenant_id` carries a legacy FK, so the other tenant has to
        // exist before a user can live in it.
        await db.insert(schema.tenants).values({
            id: 't-other', slug: 't-other', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        } as never);
        await db.insert(schema.users).values({
            id: 'u-other', tenantId: 't-other', email: ADDR, passwordHash: 'x', role: 'owner', createdAt: new Date(),
        } as never);
        await db.insert(schema.notificationPreferences).values({
            id: 'np-x', tenantId: 't-other', subjectKind: 'user', subjectId: 'u-other',
            classId: 'booking-confirmation', channel: 'email', enabled: false,
            createdAt: new Date(), updatedAt: new Date(),
        } as never);
        expect(await port().isMuted('booking-confirmation', ADDR)).toBe(false);
    });

    it('is tenant-scoped — another tenant’s mute does not reach here', async () => {
        await seedContact();
        await db.insert(schema.notificationPreferences).values({
            id: 'np-other', tenantId: 't-other', subjectKind: 'contact', subjectId: 'c1',
            classId: 'booking-confirmation', channel: 'email', enabled: false,
            createdAt: new Date(), updatedAt: new Date(),
        } as never);
        expect(await port().isMuted('booking-confirmation', ADDR)).toBe(false);
    });

    it('does not withhold from an address it cannot resolve to anyone', async () => {
        expect(await port().isMuted('booking-confirmation', 'stranger@example.com')).toBe(false);
    });
});

describe('send boundary honours the port', () => {
    /**
     * Observes what reached the PROVIDER, not what the caller passed. An
     * earlier version of this recorded the argument and passed while the
     * filtered list never actually shrank — the assertion has to sit on the
     * far side of the thing under test.
     */
    class Probe extends EmailBaseService {
        sent: string[][] = [];
        constructor(prefs?: { isMuted(c: string, e: string): Promise<boolean> }) {
            const sent: string[][] = [];
            super('re_test', 'from@x.com', 'Acme', undefined, undefined, undefined,
                recordingEmailProvider(sent),
                undefined, undefined, prefs);
            this.sent = sent;
        }
    }

    const prefs = (muted: Record<string, string[]>) => ({
        isMuted: async (c: string, e: string) => (muted[c] ?? []).includes(e),
    });

    it('drops a muted recipient and keeps the others', async () => {
        const p = new Probe(prefs({ 'booking-confirmation': ['muted@x.com'] }));
        await p.sendEmail(['muted@x.com', 'keep@x.com'], 'S', 'H', undefined, { classId: 'booking-confirmation' });
        expect(p.sent[0]).toEqual(['keep@x.com']);
    });

    it('does not send at all when every recipient muted it', async () => {
        const p = new Probe(prefs({ 'booking-confirmation': ['a@x.com'] }));
        const r = await p.sendEmail(['a@x.com'], 'S', 'H', undefined, { classId: 'booking-confirmation' });
        expect(r.delivered).toBe(false);
    });

    it('never consults the port for an UNCLASSIFIED send', async () => {
        // No classId means the boundary cannot know what it is sending, and a
        // preference it cannot name must never be applied by guesswork.
        const isMuted = vi.fn();
        const p = new Probe({ isMuted });
        await p.sendEmail(['a@x.com'], 'S', 'H');
        expect(isMuted).not.toHaveBeenCalled();
        expect(p.sent[0]).toEqual(['a@x.com']);
    });

    it('sends when the lookup throws — a failed query must not silence mail', async () => {
        const p = new Probe({ isMuted: async () => { throw new Error('db down'); } });
        await p.sendEmail(['a@x.com'], 'S', 'H', undefined, { classId: 'booking-confirmation' });
        expect(p.sent[0]).toEqual(['a@x.com']);
    });

    it('has no gate at all when no port is injected', async () => {
        const p = new Probe();
        await p.sendEmail(['a@x.com'], 'S', 'H', undefined, { classId: 'booking-confirmation' });
        expect(p.sent[0]).toEqual(['a@x.com']);
    });
});

describe('the seam is actually connected', () => {
    /**
     * The port and the boundary can both be right while nothing joins them —
     * a gate wired to nothing looks identical to a gate that passes. This
     * assembles the service the production call sites assemble and asserts a
     * real row in the real table stops a real provider call.
     */
    const env = () => ({
        DB: rawDb, TENANT_CACHE: {} as never, JWT_SECRET: 'x'.repeat(32),
        RESEND_API_KEY: 're_platform', SENDER_EMAIL: 'platform@example.com',
    } as unknown as EmailServiceEnv);

    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'm1' }), { status: 200 })));
    });
    afterEach(() => vi.unstubAllGlobals());

    it('a muted class does not reach the provider', async () => {
        await seedContact();
        await mute('booking-confirmation');
        const svc = assembleTenantEmailService(env(), { dbSecrets: {} }, TENANT);

        const r = await svc.sendEmail([ADDR], 'S', 'H', undefined, { classId: 'booking-confirmation' });

        expect(r.delivered).toBe(false);
        expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });

    it('the same recipient still gets a REQUIRED class', async () => {
        await seedContact();
        await mute('password-reset');
        const svc = assembleTenantEmailService(env(), { dbSecrets: {} }, TENANT);

        await svc.sendEmail([ADDR], 'S', 'H', undefined, { classId: 'password-reset' });

        expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    });
});

describe('in-app honours the same decision', () => {
    /**
     * A notice header is `user_id XOR contact_id` by construction, so the in-app
     * path already knows its subject and needs none of the address resolution
     * the email path exists to do. What it must NOT have is its own copy of the
     * decision — particularly the required check, which is the thing keeping the
     * screen's promise and the send path's behaviour in agreement.
     */
    it('withholds an in-app notice the recipient switched off', async () => {
        await db.insert(schema.notificationPreferences).values({
            id: 'np-inapp', tenantId: TENANT, subjectKind: 'contact', subjectId: 'c1',
            classId: 'message-notification', channel: 'in_app', enabled: false,
            createdAt: new Date(), updatedAt: new Date(),
        } as never);
        expect(await isPreferenceMuted(db, TENANT, 'message-notification', 'in_app',
            [{ kind: 'contact', id: 'c1' }])).toBe(true);
    });

    it('does not confuse the two channels — muting email leaves in-app alone', async () => {
        await db.insert(schema.notificationPreferences).values({
            id: 'np-email-only', tenantId: TENANT, subjectKind: 'contact', subjectId: 'c1',
            classId: 'message-notification', channel: 'email', enabled: false,
            createdAt: new Date(), updatedAt: new Date(),
        } as never);
        expect(await isPreferenceMuted(db, TENANT, 'message-notification', 'in_app',
            [{ kind: 'contact', id: 'c1' }])).toBe(false);
    });

    it('refuses to withhold a required in-app notice — office alerts are dispatch', async () => {
        // §2.5: an individual cannot mute their own dispatch. The operator's
        // control is the rule's active flag, not this row.
        await db.insert(schema.notificationPreferences).values({
            id: 'np-office', tenantId: TENANT, subjectKind: 'user', subjectId: 'u1',
            classId: 'office-alert-new-booking', channel: 'in_app', enabled: false,
            createdAt: new Date(), updatedAt: new Date(),
        } as never);
        expect(await isPreferenceMuted(db, TENANT, 'office-alert-new-booking', 'in_app',
            [{ kind: 'user', id: 'u1' }])).toBe(false);
    });

    it('sends when the subject holds no row at all', async () => {
        expect(await isPreferenceMuted(db, TENANT, 'message-notification', 'in_app',
            [{ kind: 'contact', id: 'c1' }])).toBe(false);
    });
});
