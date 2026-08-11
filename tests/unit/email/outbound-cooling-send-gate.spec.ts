/**
 * Portal #98 items 1 + 2 — the send-path gate and its NAMED refusal.
 *
 * Asserted at the same boundary the free-tier quota gate is asserted at:
 * through `assembleTenantEmailService`, so the wiring is under test and not
 * just the predicate.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestDb, setupSchema, toRawD1 } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import {
    assembleTenantEmailService,
    type LoadedEmailConfig,
    type EmailServiceEnv,
} from '../../../server/lib/email/build-email-service';
import { MeteringService } from '../../../server/services/metering.service';
import { COOLING_WINDOW_MS } from '../../../server/lib/email/outbound-cooling-window';

const platformCfg: LoadedEmailConfig = {
    emailIdentity: {
        mode: 'platform', senderEmail: null, replyTo: null,
        senderDisplayName: null, pointOfContact: 'company', companyName: null,
    },
    emailBrand: undefined,
    dbSecrets: {},
};

const ownCfg: LoadedEmailConfig = {
    emailIdentity: {
        mode: 'own', senderEmail: 'hello@company.com', replyTo: null,
        senderDisplayName: null, pointOfContact: 'company', companyName: null,
    },
    emailBrand: undefined,
    dbSecrets: { resendApiKey: 'own_re_key' },
};

describe('24-hour outbound cooling window', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sqlite: any;
    let testD1: D1Database;
    let saasEnv: EmailServiceEnv;

    /** Insert a tenant whose row was written `ageMs` ago. */
    async function seedTenant(id: string, ageMs: number) {
        await testDb.insert(schema.tenants).values({
            id, slug: id, name: id, createdAt: new Date(Date.now() - ageMs),
        });
    }

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        testD1 = toRawD1(sqlite);
        saasEnv = {
            DB: testD1, TENANT_CACHE: {} as never, JWT_SECRET: 'x'.repeat(32),
            APP_MODE: 'saas', RESEND_API_KEY: 're_platform',
            SENDER_EMAIL: 'platform@example.com',
        };
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 })));
    });
    afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

    it('refuses a platform-funded external send from a 1-hour-old company, with a NAMED code', async () => {
        await seedTenant('tenant-new', 60 * 60 * 1000);
        const record = vi.spyOn(MeteringService.prototype, 'record');
        const svc = assembleTenantEmailService(saasEnv, platformCfg, 'tenant-new');

        await expect(
            svc.sendEmail(['client@example.com'], 'Your report', '<p>hi</p>', undefined, { classId: 'report-ready' }),
        ).rejects.toMatchObject({ status: 403, code: 'OUTBOUND_COOLING_WINDOW' });

        expect(vi.mocked(fetch)).not.toHaveBeenCalled();
        expect(record).not.toHaveBeenCalled();
    });

    it('carries the actual unlock instant so the UI never computes it', async () => {
        const ageMs = 60 * 60 * 1000;
        await seedTenant('tenant-detail', ageMs);
        const svc = assembleTenantEmailService(saasEnv, platformCfg, 'tenant-detail');
        // `.catch()` alone would type `err` as the success shape OR the error
        // shape, and every assertion below would then read `undefined` if the
        // send ever stopped refusing — a green test about a gate that had
        // silently opened. Reject the resolved path explicitly.
        const err = await svc
            .sendEmail(['client@example.com'], 'Your report', '<p>hi</p>', undefined, { classId: 'report-ready' })
            .then(
                () => { throw new Error('expected the cooling window to refuse this send, but it resolved'); },
                (e: unknown) => e as { details?: { unlockAtMs?: number; windowHours?: number } },
            );
        expect(err.details?.windowHours).toBe(24);
        expect(err.details?.unlockAtMs).toBeGreaterThan(Date.now());
        expect(err.details?.unlockAtMs).toBeLessThanOrEqual(Date.now() + COOLING_WINDOW_MS - ageMs + 5_000);
    });

    it('never blocks account email from the same new company', async () => {
        await seedTenant('tenant-account', 60 * 60 * 1000);
        const svc = assembleTenantEmailService(saasEnv, platformCfg, 'tenant-account');
        await expect(
            svc.sendEmail(['owner@example.com'], 'Reset', '<p>x</p>', undefined, { classId: 'password-reset' }),
        ).resolves.toEqual({ delivered: true });
    });

    it("never blocks a tenant's own provider — not our reputation, not our money", async () => {
        await seedTenant('tenant-byo', 60 * 60 * 1000);
        const svc = assembleTenantEmailService(saasEnv, ownCfg, 'tenant-byo');
        await expect(
            svc.sendEmail(['client@example.com'], 'Your report', '<p>hi</p>', undefined, { classId: 'report-ready' }),
        ).resolves.toEqual({ delivered: true });
    });

    it('never applies to a self-hosted deployment', async () => {
        await seedTenant('tenant-standalone', 60 * 60 * 1000);
        const standaloneEnv: EmailServiceEnv = { ...saasEnv, APP_MODE: 'standalone' };
        const svc = assembleTenantEmailService(standaloneEnv, platformCfg, 'tenant-standalone');
        await expect(
            svc.sendEmail(['client@example.com'], 'Your report', '<p>hi</p>', undefined, { classId: 'report-ready' }),
        ).resolves.toEqual({ delivered: true });
    });

    it('allows the same send once the window has elapsed', async () => {
        await seedTenant('tenant-old', COOLING_WINDOW_MS + 60_000);
        const svc = assembleTenantEmailService(saasEnv, platformCfg, 'tenant-old');
        await expect(
            svc.sendEmail(['client@example.com'], 'Your report', '<p>hi</p>', undefined, { classId: 'report-ready' }),
        ).resolves.toEqual({ delivered: true });
    });

    it('gates a send that never named itself (a tenant-written automation rule)', async () => {
        await seedTenant('tenant-automation', 60 * 60 * 1000);
        const svc = assembleTenantEmailService(saasEnv, platformCfg, 'tenant-automation');
        await expect(
            svc.sendEmail(['client@example.com'], 'Reminder', '<p>hi</p>'),
        ).rejects.toMatchObject({ code: 'OUTBOUND_COOLING_WINDOW' });
    });

    it('lets the send out when the anchor cannot be read — a blip is not a block', async () => {
        // No tenant row at all: the anchor is unreadable, so the gate opens and warns.
        const svc = assembleTenantEmailService(saasEnv, platformCfg, 'tenant-missing');
        await expect(
            svc.sendEmail(['client@example.com'], 'Your report', '<p>hi</p>', undefined, { classId: 'report-ready' }),
        ).resolves.toEqual({ delivered: true });
    });
});
