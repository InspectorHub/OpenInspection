/**
 * TeamService.resetMemberTwoFactor.
 *
 * WHY THIS SERVICE EXISTS AT ALL. Every other two-factor endpoint is
 * self-service and requires a valid code: `/2fa/disable` and
 * `/2fa/recovery-codes/regenerate` both ask for the current password AND a
 * TOTP or recovery code. Correct for someone who still has their
 * authenticator; it leaves no path whatsoever for someone who has lost both
 * the device and the recovery codes. Before this, that person was locked out
 * of the workspace permanently and nobody in the product could help them —
 * grepping `server/api/` for an administrator reset returned nothing.
 *
 * So the assertions below are mostly about what it REFUSES, and about the
 * scoping: an action that lowers another person's authentication requirement
 * must not be reachable across a tenant boundary, on a removed member, or on
 * yourself.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { TeamService } from '../../../server/services/team.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { Role } from '../../../server/lib/auth/roles';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '11111111-1111-1111-1111-1111111111a1';
const OTHER_TENANT = '11111111-1111-1111-1111-1111111111b2';
const OWNER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
const ENROLLED = 'cccccccc-cccc-cccc-cccc-ccccccccccc1';
const PLAIN = 'cccccccc-cccc-cccc-cccc-ccccccccccc2';
const REMOVED = 'cccccccc-cccc-cccc-cccc-ccccccccccc3';
const STRANGER = 'dddddddd-dddd-dddd-dddd-ddddddddddd1';

/** What a fully enrolled account looks like, so a partial wipe is visible. */
const ENROLMENT = {
    totpSecret: 'JBSWY3DPEHPK3PXP',
    totpEnabled: true,
    totpRecoveryCodes: JSON.stringify(['h1', 'h2', 'h3']),
    totpVerifiedAt: new Date(1_700_000_000_000),
};

function userRow(id: string, role: Role, email: string, tenantId = TENANT) {
    return { id, tenantId, email, name: email, role, passwordHash: 'x', createdAt: new Date() };
}

async function seed(db: BetterSQLite3Database<typeof schema>) {
    await db.insert(schema.tenants).values([
        { id: TENANT, slug: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        { id: OTHER_TENANT, slug: 'b', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
    ]);
    await db.insert(schema.users).values([
        { ...userRow(OWNER, 'owner', 'owner@a.test'), ...ENROLMENT },
        { ...userRow(ENROLLED, 'inspector', 'locked-out@a.test'), ...ENROLMENT },
        userRow(PLAIN, 'inspector', 'plain@a.test'),
        { ...userRow(REMOVED, 'inspector', 'gone@a.test'), ...ENROLMENT, deletedAt: new Date() },
        { ...userRow(STRANGER, 'inspector', 'stranger@b.test', OTHER_TENANT), ...ENROLMENT },
    ]);
}

describe('TeamService.resetMemberTwoFactor', () => {
    let db: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(db);
    });

    const svc = () => new TeamService({} as D1Database);

    async function enrolmentOf(id: string) {
        return db.select({
            secret: schema.users.totpSecret,
            enabled: schema.users.totpEnabled,
            codes: schema.users.totpRecoveryCodes,
            verifiedAt: schema.users.totpVerifiedAt,
        }).from(schema.users).where(eq(schema.users.id, id)).get();
    }

    it('clears every part of the enrolment, not just the enabled flag', async () => {
        await seed(db);

        // Positive control: it really was enrolled before the call, so a pass
        // below cannot come from a fixture that never had 2FA.
        expect((await enrolmentOf(ENROLLED))?.enabled).toBe(true);

        const { email } = await svc().resetMemberTwoFactor(TENANT, ENROLLED, OWNER);
        expect(email).toBe('locked-out@a.test');

        const after = await enrolmentOf(ENROLLED);
        // A leftover secret or a leftover recovery-code list would let the old
        // authenticator keep working after the reset "succeeded".
        expect(after).toEqual({ secret: null, enabled: false, codes: null, verifiedAt: null });
    });

    it('leaves every other member alone', async () => {
        await seed(db);
        await svc().resetMemberTwoFactor(TENANT, ENROLLED, OWNER);
        expect((await enrolmentOf(OWNER))?.enabled).toBe(true);
    });

    it('refuses on yourself, and changes nothing', async () => {
        await seed(db);
        await expect(svc().resetMemberTwoFactor(TENANT, OWNER, OWNER))
            .rejects.toThrow(/your own two-factor/i);
        expect((await enrolmentOf(OWNER))?.enabled).toBe(true);
    });

    it('refuses a member who has no enrolment, rather than reporting success', async () => {
        await seed(db);
        // Reporting success here would tell an owner the lockout was cleared
        // and stop them looking for the real reason somebody cannot sign in.
        await expect(svc().resetMemberTwoFactor(TENANT, PLAIN, OWNER))
            .rejects.toThrow(/does not have two-factor/i);
    });

    it('cannot reach a member of another workspace', async () => {
        await seed(db);
        await expect(svc().resetMemberTwoFactor(TENANT, STRANGER, OWNER))
            .rejects.toThrow(/not found/i);
        // And the cross-tenant row is untouched, which is the assertion that
        // would fail if the where-clause dropped its tenant filter.
        expect((await enrolmentOf(STRANGER))?.enabled).toBe(true);
    });

    it('cannot reach a removed member', async () => {
        await seed(db);
        await expect(svc().resetMemberTwoFactor(TENANT, REMOVED, OWNER))
            .rejects.toThrow(/not found/i);
        expect((await enrolmentOf(REMOVED))?.enabled).toBe(true);
    });
});
