/**
 * `services.emailFor(tenantId)` / `services.platformEmail()` — the explicit
 * per-tenant resolution on the DI registry.
 *
 * Runs the real middlewares in the order `server/index.ts` registers them
 * (contextBootstrap -> tenantRouter -> jwtAuth -> integrationSecrets -> di)
 * in front of a probe route, so what the probe sees is what a handler sees.
 * `loadTenantEmailConfig` is wrapped (not replaced) so every D1 config load is
 * counted: the DI middleware's own eager load and every resolver load go
 * through the same function.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { HonoConfig } from '../../../server/types/hono';
import type { EmailService } from '../../../server/services/email.service';
import * as schema from '../../../server/lib/db/schema';
import { contextBootstrap } from '../../../server/lib/middleware/context-bootstrap';
import { tenantRouter } from '../../../server/features/tenant-routing';
import { jwtAuthMiddleware } from '../../../server/lib/middleware/jwt-auth';
import { integrationSecretsMiddleware } from '../../../server/lib/middleware/integration-secrets';
import { diMiddleware } from '../../../server/lib/middleware/di';
import { loadTenantEmailConfig } from '../../../server/lib/email/build-email-service';
import { makeExecutionContext } from '../helpers/exec-ctx';
import {
    createHarness, PLATFORM_IDENTITY, TENANT_ID, TENANT_IDENTITY, type Harness, type HarnessMode,
} from '../helpers/tenant-email-harness';

vi.mock('../../../server/lib/email/build-email-service', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../server/lib/email/build-email-service')>();
    return { ...actual, loadTenantEmailConfig: vi.fn(actual.loadTenantEmailConfig) };
});

const OTHER_TENANT_ID = '11111111-0000-4000-8000-000000000002';
const OTHER_REPLY_TO = 'desk@second-company.test';

async function seedOtherTenant(h: Harness): Promise<void> {
    await h.db.insert(schema.tenants).values({
        id: OTHER_TENANT_ID, slug: 'second-company', status: 'active', tier: 'free',
        maxUsers: 5, deploymentMode: 'shared', createdAt: new Date(0),
    });
    await h.db.insert(schema.tenantConfigs).values({
        tenantId: OTHER_TENANT_ID, companyName: 'Second Company', senderDisplayName: 'Second Desk',
        replyTo: OTHER_REPLY_TO, updatedAt: new Date(0),
    });
}

type Probe = (services: HonoConfig['Variables']['services']) => Promise<void>;

/** The real chain, in index.ts order, in front of one probe handler. */
async function runProbe(h: Harness, probe: Probe): Promise<void> {
    const app = new Hono<HonoConfig>();
    app.use('*', contextBootstrap);
    app.use('*', tenantRouter);
    app.use('*', jwtAuthMiddleware);
    app.use('*', integrationSecretsMiddleware);
    app.use('*', diMiddleware);
    let failure: unknown;
    app.get('/api/probe', async (c) => {
        try { await probe(c.var.services); } catch (e) { failure = e; }
        return c.text('ok');
    });
    const res = await app.request('/api/probe', {}, h.env, makeExecutionContext().ctx);
    expect(res.status).toBe(200);
    if (failure) throw failure;
}

const loads = (): string[] => vi.mocked(loadTenantEmailConfig).mock.calls.map((call) => call[1]);

describe('services.emailFor / services.platformEmail', () => {
    let h: Harness;
    afterEach(() => {
        h.close();
        vi.mocked(loadTenantEmailConfig).mockClear();
    });

    it('standalone: emailFor(the fixed tenant) IS the service DI already built — no second config load', { timeout: 60_000 }, async () => {
        h = await createHarness('standalone');
        await runProbe(h, async (services) => {
            expect(loads()).toEqual([TENANT_ID]); // DI's own eager load for /api/
            const resolved = await services.emailFor(TENANT_ID);
            expect(resolved).toBe(services.email);
            expect(resolved.identity?.replyTo).toBe(TENANT_IDENTITY.replyTo);
            expect(loads()).toEqual([TENANT_ID]);
        });
    });

    it.each<HarnessMode>(['saas', 'standalone'])('%s: a tenant DI did not load is loaded once, then memoised for the request', { timeout: 60_000 }, async (mode) => {
        h = await createHarness(mode);
        await seedOtherTenant(h);
        await runProbe(h, async (services) => {
            const before = loads().length;
            const first = await services.emailFor(OTHER_TENANT_ID);
            const again = await services.emailFor(OTHER_TENANT_ID);
            expect(again).toBe(first);
            expect(loads().slice(before)).toEqual([OTHER_TENANT_ID]);
            expect(first.identity?.replyTo).toBe(OTHER_REPLY_TO);
            expect(first.meter).toBeDefined(); // metered, to that tenant (see the route specs)
        });
    });

    it.each<HarnessMode>(['saas', 'standalone'])('%s: emailFor({ recipientInitiated }) is a separate, memoised service with no cooling window, still in the tenant voice', { timeout: 60_000 }, async (mode) => {
        h = await createHarness(mode);
        await runProbe(h, async (services) => {
            const ordinary = await services.emailFor(TENANT_ID);
            const initiated = await services.emailFor(TENANT_ID, { recipientInitiated: true });
            expect(initiated).not.toBe(ordinary);
            expect(await services.emailFor(TENANT_ID, { recipientInitiated: true })).toBe(initiated);
            expect(initiated.identity?.replyTo).toBe(TENANT_IDENTITY.replyTo);
            expect(initiated.cooling).toBeUndefined();
            // The shared service keeps its window (saas); standalone never had one.
            expect(ordinary.cooling !== undefined).toBe(mode === 'saas');
        });
    });

    it('saas: concurrent first calls share ONE load', { timeout: 60_000 }, async () => {
        h = await createHarness('saas');
        await runProbe(h, async (services) => {
            const [a, b] = await Promise.all([services.emailFor(TENANT_ID), services.emailFor(TENANT_ID)]);
            expect(a).toBe(b);
            expect(loads()).toEqual([TENANT_ID]);
        });
    });

    it('saas: platformEmail() is the platform identity — no tenant identity, no meter, no config load', { timeout: 60_000 }, async () => {
        h = await createHarness('saas');
        await runProbe(h, async (services) => {
            const platform: EmailService = services.platformEmail();
            expect(platform.senderEmail).toBe(PLATFORM_IDENTITY.senderEmail);
            expect(platform.identity).toBeUndefined();
            expect(platform.meter).toBeUndefined();
            expect(loads()).toEqual([]);
        });
    });

    it('standalone: platformEmail() is the deployment identity, which is the fixed tenant (unchanged behaviour)', { timeout: 60_000 }, async () => {
        h = await createHarness('standalone');
        await runProbe(h, async (services) => {
            expect(services.platformEmail()).toBe(services.email);
            expect(loads()).toEqual([TENANT_ID]);
        });
    });
});
