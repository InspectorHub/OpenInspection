/**
 * IA-36 ②⑤⑥⑪ — report-link lifecycle on the portal access token.
 *
 *   ② Reset is an in-place rotation: `idx_iat_recipient` is UNIQUE on
 *     (inspection, recipient), so "issue a second row" is not available — the
 *     same row must swap its secret.
 *   ⑤ The tenant's `reportLinkTtl` policy stamps `expires_at` when a link is
 *     minted.
 *   ⑥ Changing the policy never reaches back to links already in a customer's
 *     inbox.
 *   ⑪ The People card needs per-recipient state, so the service has to be able
 *     to report it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { PortalAccessService } from '../../../server/services/portal-access.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { createTestDb, setupSchema } from '../db';
import { asD1Db } from '../helpers/test-db';
import * as schema from '../../../server/lib/db/schema';
import { hashToken } from '../../../server/lib/token-hash';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-0000000000d1';
const OTHER_TENANT = '00000000-0000-0000-0000-0000000000d2';
const INSPECTION = '11111111-1111-1111-1111-1111111111d1';
const JWT = 'unit-test-jwt-secret';
const RECIPIENT = 'buyer@example.com';

let testDb: BetterSQLite3Database<typeof schema>;
let svc: PortalAccessService;

async function setPolicy(tenantId: string, reportLinkTtl: unknown) {
    const existing = await testDb.select().from(schema.tenantConfigs)
        .where(eq(schema.tenantConfigs.tenantId, tenantId)).get();
    if (existing) {
        await testDb.update(schema.tenantConfigs)
            .set({ inspectionPrefs: { reportLinkTtl } as never })
            .where(eq(schema.tenantConfigs.tenantId, tenantId));
        return;
    }
    await testDb.insert(schema.tenantConfigs).values({
        tenantId, inspectionPrefs: { reportLinkTtl } as never, updatedAt: new Date(),
    } as never);
}

function row() {
    return testDb.select().from(schema.inspectionAccessTokens)
        .where(eq(schema.inspectionAccessTokens.recipientEmail, RECIPIENT)).get();
}

beforeEach(async () => {
    const fix = createTestDb();
    testDb = fix.db;
    await setupSchema(fix.sqlite);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockDrizzle as any).mockReturnValue(testDb);
    for (const id of [TENANT, OTHER_TENANT]) {
        await testDb.insert(schema.tenants).values({
            id, slug: `acme-${id.slice(-2)}`, status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await seedRoleProfiles(asD1Db(testDb), id);
    }
    svc = new PortalAccessService({} as D1Database, { jwtSecret: JWT });
});

describe('⑤ reportLinkTtl stamps expires_at when a link is minted', () => {
    // Until 2026-08-14 an unset policy meant NULL — an open-ended link. The
    // default is now two years, so NULL is reachable only by choosing `never`.
    it('no policy configured → the two-year default is stamped', async () => {
        const before = Date.now();
        await svc.issueToken({ tenantId: TENANT, inspectionId: INSPECTION, recipientEmail: RECIPIENT });
        const at = (await row())?.expiresAt?.getTime() ?? 0;
        expect(at).toBeGreaterThanOrEqual(before + 729 * 86_400_000);
        expect(at).toBeLessThan(before + 732 * 86_400_000);
    });

    it('an explicit never → open-ended link (expires_at NULL)', async () => {
        await setPolicy(TENANT, 'never');
        await svc.issueToken({ tenantId: TENANT, inspectionId: INSPECTION, recipientEmail: RECIPIENT });
        expect((await row())?.expiresAt).toBeNull();
    });

    it('a 90-day policy stamps a date 90 days out', async () => {
        await setPolicy(TENANT, { count: 90, unit: 'days' });
        const before = Date.now();
        await svc.issueToken({ tenantId: TENANT, inspectionId: INSPECTION, recipientEmail: RECIPIENT });
        const at = (await row())?.expiresAt?.getTime() ?? 0;
        expect(at).toBeGreaterThanOrEqual(before + 90 * 86_400_000);
        expect(at).toBeLessThan(before + 91 * 86_400_000);
    });
});

describe('⑥ the policy applies to FUTURE links only', () => {
    it('re-issuing an existing live link neither rotates it nor re-dates it', async () => {
        const first = await svc.issueToken({ tenantId: TENANT, inspectionId: INSPECTION, recipientEmail: RECIPIENT });
        const stampedFirst = (await row())?.expiresAt?.getTime();
        await setPolicy(TENANT, { count: 90, unit: 'days' });
        const again = await svc.issueToken({ tenantId: TENANT, inspectionId: INSPECTION, recipientEmail: RECIPIENT });
        // The stable-link contract other code depends on (copy-pay-link,
        // automation emails): the same plaintext comes back.
        expect(again).toBe(first);
        // Stronger than the old `toBeNull()`: the date must be the one stamped
        // at FIRST issue, not merely absent. NULL used to double as the
        // sentinel for "no policy ran"; with a real default it cannot, and
        // asserting the value is unchanged is what ⑥ actually claims.
        expect((await row())?.expiresAt?.getTime()).toBe(stampedFirst);
    });
});

describe('② rotateForRecipient — in-place rotation', () => {
    it('keeps ONE row (the unique index forbids a second) and swaps the secret', async () => {
        const original = await svc.issueToken({ tenantId: TENANT, inspectionId: INSPECTION, recipientEmail: RECIPIENT });
        const before = await row();

        const result = await svc.rotateForRecipient(TENANT, INSPECTION, RECIPIENT);
        expect(result).not.toBeNull();

        const rows = await testDb.select().from(schema.inspectionAccessTokens).all();
        expect(rows).toHaveLength(1);
        expect(rows[0].id).toBe(before!.id);
        expect(rows[0].tokenHash).not.toBe(before!.tokenHash);
        expect(result!.token).not.toBe(original);
    });

    it('the OLD link stops resolving and the NEW one resolves', async () => {
        const original = await svc.issueToken({ tenantId: TENANT, inspectionId: INSPECTION, recipientEmail: RECIPIENT });
        const result = await svc.rotateForRecipient(TENANT, INSPECTION, RECIPIENT);
        expect(await svc.resolveToken(original)).toBeNull();
        const grant = await svc.resolveToken(result!.token);
        expect(grant?.recipientEmail).toBe(RECIPIENT);
        expect(grant?.tenantId).toBe(TENANT);
    });

    it('returns the PREVIOUS token hash so the audit trail can reference it (never the plaintext)', async () => {
        const original = await svc.issueToken({ tenantId: TENANT, inspectionId: INSPECTION, recipientEmail: RECIPIENT });
        const result = await svc.rotateForRecipient(TENANT, INSPECTION, RECIPIENT);
        expect(result!.previousTokenHash).toBe(await hashToken(original));
        expect(result!.previousTokenHash).not.toBe(original);
    });

    it('re-arms a REVOKED row (clears revoked_at) — Reset is the recovery verb', async () => {
        await svc.issueToken({ tenantId: TENANT, inspectionId: INSPECTION, recipientEmail: RECIPIENT });
        await svc.revokeForRecipient(TENANT, INSPECTION, RECIPIENT);
        expect((await row())?.revokedAt).not.toBeNull();

        const result = await svc.rotateForRecipient(TENANT, INSPECTION, RECIPIENT);
        expect((await row())?.revokedAt).toBeNull();
        expect(await svc.resolveToken(result!.token)).not.toBeNull();
    });

    it('re-dates the rotated link from the CURRENT policy', async () => {
        await svc.issueToken({ tenantId: TENANT, inspectionId: INSPECTION, recipientEmail: RECIPIENT });
        const atIssue = (await row())?.expiresAt?.getTime() ?? 0;
        await setPolicy(TENANT, { count: 90, unit: 'days' });
        const before = Date.now();
        await svc.rotateForRecipient(TENANT, INSPECTION, RECIPIENT);
        const atRotate = (await row())?.expiresAt?.getTime() ?? 0;
        // Both dates are now non-null, so "not null" no longer distinguishes
        // anything — the claim is that the rotation MOVED the date onto the
        // current policy, which needs the value, not its presence.
        expect(atRotate).not.toBe(atIssue);
        expect(atRotate).toBeGreaterThanOrEqual(before + 89 * 86_400_000);
        expect(atRotate).toBeLessThan(before + 91 * 86_400_000);
    });

    it('null when the recipient has no link at all (nothing to reset)', async () => {
        expect(await svc.rotateForRecipient(TENANT, INSPECTION, 'nobody@example.com')).toBeNull();
    });

    it('is tenant-scoped — another tenant cannot rotate this link', async () => {
        const original = await svc.issueToken({ tenantId: TENANT, inspectionId: INSPECTION, recipientEmail: RECIPIENT });
        expect(await svc.rotateForRecipient(OTHER_TENANT, INSPECTION, RECIPIENT)).toBeNull();
        expect(await svc.resolveToken(original)).not.toBeNull();
    });
});

describe('setExpiryForInspection accepts null (lift the expiry again)', () => {
    it('sets then clears', async () => {
        await svc.issueToken({ tenantId: TENANT, inspectionId: INSPECTION, recipientEmail: RECIPIENT });
        await svc.setExpiryForInspection(TENANT, INSPECTION, Date.now() + 1000);
        expect((await row())?.expiresAt).not.toBeNull();
        await svc.setExpiryForInspection(TENANT, INSPECTION, null);
        expect((await row())?.expiresAt).toBeNull();
    });
});

describe('⑪ listAccessForInspection — per-recipient state for the People card', () => {
    it('reports sent / revoked / expired without ever exposing a token', async () => {
        await svc.issueToken({ tenantId: TENANT, inspectionId: INSPECTION, recipientEmail: RECIPIENT });
        await svc.issueToken({ tenantId: TENANT, inspectionId: INSPECTION, recipientEmail: 'agent@example.com' });
        await svc.revokeForRecipient(TENANT, INSPECTION, 'agent@example.com');

        const list = await svc.listAccessForInspection(TENANT, INSPECTION);
        const byEmail = new Map(list.map((r) => [r.recipientEmail, r]));
        expect(byEmail.get(RECIPIENT)?.status).toBe('active');
        expect(byEmail.get('agent@example.com')?.status).toBe('revoked');
        expect(JSON.stringify(list)).not.toContain('token');
    });

    it('an elapsed expiry reads as expired, and revoked outranks expired (③)', async () => {
        await svc.issueToken({ tenantId: TENANT, inspectionId: INSPECTION, recipientEmail: RECIPIENT });
        await svc.setExpiryForInspection(TENANT, INSPECTION, Date.now() - 1000);
        expect((await svc.listAccessForInspection(TENANT, INSPECTION))[0].status).toBe('expired');
        await svc.revokeForRecipient(TENANT, INSPECTION, RECIPIENT);
        expect((await svc.listAccessForInspection(TENANT, INSPECTION))[0].status).toBe('revoked');
    });

    it('is empty for an inspection nobody was sent a link for', async () => {
        expect(await svc.listAccessForInspection(TENANT, INSPECTION)).toEqual([]);
    });
});
