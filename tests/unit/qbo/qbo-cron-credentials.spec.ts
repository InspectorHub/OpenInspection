/**
 * The QuickBooks CDC cron, on both deployment shapes.
 *
 * `runQBOCDC` had never been imported by a test — it was a module-private
 * function, which is the mechanical reason it had zero coverage. Inside that
 * gap it resolved credentials ONCE from `env`, before its per-tenant loop, and
 * cron has no Hono middleware to merge a tenant's encrypted secrets. So on a
 * `qboAppManaged: false` deployment — where the settings form is the ONLY place
 * an operator can put a credential — the sweep read nothing, logged
 * `QBO not configured`, and returned. The browser flow worked, Settings read
 * "Active", and inbound reconciliation had never run once.
 *
 * `loadTenantSecrets` is stubbed because decryption has its own tests.
 * `applyIntegrationSecrets` is REAL, because the precedence rule is the thing
 * the last spec here exists to pin: QuickBooks keys are not in
 * `TENANT_OWNED_KEYS`, so env must keep winning over the tenant row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Installed per test; read by the `loadTenantSecrets` stub below. */
let tenantSecrets: Record<string, string> | null = null;
/** Credentials the QBOService was last constructed with. */
let constructedWith: { clientId?: string; clientSecret?: string; qboEnv?: string } = {};
const runCDCSync = vi.fn(async () => ({ processed: 0 }));
const warn = vi.fn();
const info = vi.fn();

vi.mock('../../../server/lib/secrets-cache', () => ({
    loadTenantSecrets: vi.fn(async () => tenantSecrets),
}));
vi.mock('../../../server/lib/logger', () => ({
    logger: {
        warn:  (...a: unknown[]) => warn(...a),
        info:  (...a: unknown[]) => info(...a),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));
vi.mock('../../../server/services/qbo.service', () => ({
    QBOService: class {
        constructor(
            _db: unknown, clientId: string, clientSecret: string,
            _webhookSecret: string, _jwt: string, qboEnv?: string,
        ) {
            constructedWith = { clientId, clientSecret, qboEnv };
        }
        runCDCSync = runCDCSync;
    },
}));
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { runQBOCDC } from '../../../server/services/qbo/cron-cdc';
import { standaloneQboEnv, saasQboEnv, TENANT, PLATFORM_CLIENT_ID } from '../helpers/qbo-deployment-envs';

async function install(fixture: Awaited<ReturnType<typeof standaloneQboEnv>>) {
    tenantSecrets = fixture.tenantSecrets;
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(fixture.db);
    return fixture;
}

beforeEach(() => {
    tenantSecrets = null;
    constructedWith = {};
    runCDCSync.mockClear();
    warn.mockClear();
    info.mockClear();
});

describe('the QBO cron resolves credentials per tenant', () => {
    it('runs CDC for a standalone tenant whose ONLY credentials are in secrets_enc', async () => {
        // The self-hosted shape. Under `qboAppManaged: false` this is the only
        // place an operator can put them, so a sweep that cannot read here can
        // never sweep a self-hosted deployment at all.
        const fx = await install(await standaloneQboEnv({
            tenantSecrets: {
                QBO_CLIENT_ID: 'tenant-id',
                QBO_CLIENT_SECRET: 'tenant-secret',
                QBO_ENV: 'production',
            },
        }));

        await runQBOCDC(fx.env as never);

        expect(runCDCSync).toHaveBeenCalledTimes(1);
        // `runCDCSync`'s declared signature takes no arguments (the stub returns
        // a count), so index the recorded call through `unknown[]` rather than
        // the inferred empty tuple. The tenant id IS the first argument at
        // runtime and is the thing worth asserting: a sweep that runs for the
        // wrong tenant is not a sweep that ran.
        const firstCall = runCDCSync.mock.calls[0] as unknown as unknown[];
        expect(firstCall[0]).toBe(TENANT);
        expect(constructedWith.clientId).toBe('tenant-id');
    });

    it('names the tenant and the missing keys when it skips, instead of blaming configuration', async () => {
        const fx = await install(await standaloneQboEnv({
            tenantSecrets: { QBO_CLIENT_ID: 'only-half' },
        }));

        await runQBOCDC(fx.env as never);

        expect(runCDCSync).not.toHaveBeenCalled();
        const [msg, data] = warn.mock.calls[0] as [string, Record<string, unknown>];
        expect(data).toMatchObject({ tenantId: TENANT, missing: ['QBO_CLIENT_SECRET'] });
        // The old log said "QBO not configured", which was false: they HAD
        // configured it. A skip reason that names the wrong cause is how a
        // whole feature never running goes unnoticed.
        expect(msg).not.toMatch(/not configured/i);
    });

    it('still uses the platform credentials for a saas tenant that stored none', async () => {
        const fx = await install(await saasQboEnv({ tenantSecrets: null }));

        await runQBOCDC(fx.env as never);

        expect(runCDCSync).toHaveBeenCalledTimes(1);
        expect(constructedWith.clientId).toBe(PLATFORM_CLIENT_ID);
    });

    it('lets a tenant secret NOT override the platform env — env wins, the row is the fallback', async () => {
        // The positive control. The three above only prove the tenant row can
        // be READ; an implementation with the precedence inverted passes all of
        // them. This pins `applyIntegrationSecrets`' existing rule — QuickBooks
        // keys are absent from TENANT_OWNED_KEYS, unlike Stripe's, where a
        // stray platform key would misroute an inspector's homebuyer payments.
        const fx = await install(await saasQboEnv({
            tenantSecrets: { QBO_CLIENT_ID: 'tenant-would-hijack' },
        }));

        await runQBOCDC(fx.env as never);

        expect(constructedWith.clientId).toBe(PLATFORM_CLIENT_ID);
    });

    it('skips the whole sweep when JWT_SECRET is unset, and says why', async () => {
        // Genuinely deployment-wide: without the KDF input no tenant's envelope
        // opens. This is the ONLY thing that may still be checked up front, and
        // its message must not claim QuickBooks is unconfigured.
        const fx = await install(await standaloneQboEnv({ tenantSecrets: null }));
        delete (fx.env as Record<string, unknown>).JWT_SECRET;

        await runQBOCDC(fx.env as never);

        expect(runCDCSync).not.toHaveBeenCalled();
        expect(String(info.mock.calls[0]![0])).toMatch(/JWT_SECRET/);
    });
});
