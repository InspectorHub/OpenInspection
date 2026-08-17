/**
 * session-context capabilities — the chrome's copy of the server's answer.
 *
 * The sidebar decides whether to offer Dispatch from this payload. If it
 * shipped the raw `permission_overrides` instead of the resolved set, every
 * consumer would have to re-apply the role defaults and the owner pinning, and
 * a second implementation of an authorization rule is a second place for it to
 * be wrong. So what travels is the answer `getCapabilities` gave.
 *
 * The two cases worth pinning are the ones a role check gets backwards: an
 * INSPECTOR granted `scheduleOthers` (may dispatch) and an owner, who cannot be
 * reduced by an override at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { HonoConfig } from '../../../server/types/hono';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// eslint-disable-next-line import/order
import sessionContextRoutes, { deploymentPayload } from '../../../server/api/session-context';
import { STANDALONE_PROFILE, SAAS_PROFILE } from '../../../server/lib/deployment-profile';

const TENANT_ID = '00000000-0000-0000-0000-0000000000aa';
const USER_ID = 'u-caps';

let testDb: BetterSQLite3Database<typeof schema>;

beforeEach(async () => {
    const fixture = createTestDb();
    testDb = fixture.db;
    await setupSchema(fixture.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
    await testDb.insert(schema.tenants).values({
        id: TENANT_ID,
        slug: 'caps-co',
        tier: 'free',
        status: 'active',
        deploymentMode: 'shared',
        createdAt: new Date(),
    });
});

async function seedUser(role: 'owner' | 'manager' | 'inspector', overrides: unknown) {
    await testDb.insert(schema.users).values({
        id: USER_ID,
        tenantId: TENANT_ID,
        email: 'u@caps.com',
        name: 'Caps User',
        passwordHash: 'h',
        role,
        permissionOverrides: overrides as never,
        createdAt: new Date(),
    });
}

function buildApp(role: 'owner' | 'manager' | 'inspector') {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('user', { sub: USER_ID, role } as never);
        c.set('tenantId', TENANT_ID);
        c.set('branding', {
            companyName: 'Test',
            primaryColor: '#000',
            logoUrl: null,
            defaultProfileId: 'signature',
            isSaas: false,
            portalBaseUrl: null,
            tenantSlug: 'caps-co',
            tenantStatus: 'active',
            currentUserSlug: null,
            bookingHost: null,
        } as never);
        c.set('profile', { mode: 'standalone', hasBilling: false, hasSeatQuota: false } as never);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c as any).env = { APP_MODE: 'standalone', DB: {} as D1Database };
        await next();
    });
    app.route('/api/session', sessionContextRoutes);
    return app;
}

type Body = { data: { user: { capabilities: Record<string, boolean> } } };

async function capabilities(role: 'owner' | 'manager' | 'inspector') {
    const res = await buildApp(role).request('/api/session/context');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;
    return body.data.user.capabilities;
}

describe('session-context capabilities', () => {
    it('an inspector has no scheduleOthers by default', async () => {
        await seedUser('inspector', null);
        expect((await capabilities('inspector')).scheduleOthers).toBe(false);
    });

    it('an inspector WITH the override has it — the user this gate exists for', async () => {
        await seedUser('inspector', { scheduleOthers: true });
        expect((await capabilities('inspector')).scheduleOthers).toBe(true);
    });

    it('a manager whose override was revoked loses it', async () => {
        await seedUser('manager', { scheduleOthers: false });
        expect((await capabilities('manager')).scheduleOthers).toBe(false);
    });

    it('an owner cannot be reduced by an override', async () => {
        await seedUser('owner', { scheduleOthers: false });
        expect((await capabilities('owner')).scheduleOthers).toBe(true);
    });
});

describe('the deployment payload carries every capability the chrome gates on', () => {
    it('ships each capability that an app/ surface reads, for both profiles', () => {
        // A client component cannot read a capability it was never sent, and the
        // failure is silent: `ctx?.deployment?.whatever` is simply `undefined`,
        // which reads as `false` and looks like a deliberate decision.
        //
        // That is not hypothetical. `library-hub.tsx` and `CommandPalette.tsx`
        // both gated the marketplace on `branding.isSaas` while
        // `marketplace.tsx` enforced `hasContentMarketplace` — one question with
        // two answers — because the capability was not on this payload at all.
        // The wrong answer was the only reachable one.
        //
        // Keep this list in step with what `app/` actually reads. A capability
        // added here that nothing consumes is the OTHER failure this repo has
        // recorded ten times over, so do not pad it.
        const GATED_IN_APP = [
            'hasContentMarketplace',
            'videoBackendManaged',
            'hasManagedCompliance',
        ] as const;

        for (const profile of [STANDALONE_PROFILE, SAAS_PROFILE]) {
            const shipped = deploymentPayload(profile, {});
            for (const capability of GATED_IN_APP) {
                expect(
                    Object.keys(shipped),
                    `${capability} is gated on in app/ but absent from the ${profile.mode} payload`,
                ).toContain(capability);
                // Present AND a boolean: `undefined` on the wire is
                // indistinguishable from absent once it reaches the client.
                expect(typeof shipped[capability]).toBe('boolean');
            }
        }
    });

    it('does NOT ship the server-only fields of the profile', () => {
        // The positive control for the assertion above. Without it, "ship
        // everything" passes — and that would put `fixedTenantId` and the portal
        // URLs in a payload the browser can read.
        const shipped = Object.keys(deploymentPayload(SAAS_PROFILE, {}));
        for (const serverOnly of ['fixedTenantId', 'billingPortalUrl', 'loginRedirectBase']) {
            expect(shipped, `${serverOnly} must not reach the browser`).not.toContain(serverOnly);
        }
    });
});
