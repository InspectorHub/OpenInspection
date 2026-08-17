/**
 * The two deployment shapes a QuickBooks credential can arrive in, as a
 * `ScheduledEnv` a cron test can drive.
 *
 * This exists because the QBO suite had exactly one env shape — the
 * platform-supplied one, hardcoded in `qbo-oauth-callback.spec.ts` — so the
 * tenant-credential fallback was false on every run and dead in the whole
 * suite. A defect lived in that gap for the life of the feature: the cron read
 * `env.QBO_CLIENT_ID` directly and could never see a self-hosted operator's
 * credentials, which under `qboAppManaged: false` are the only ones there are.
 *
 * The shapes are named after the deployment, not after the test, so a spec that
 * needs "the self-hosted case" asks for it by name instead of assembling an env
 * and hoping it resembles one.
 *
 * The tenant row carries a REAL `secrets_enc`, sealed by the product's own
 * `sealSecrets`. Hand-built ciphertext would only prove the test agrees with
 * itself; sealing for real means the decryption path, the DEK envelope and the
 * rotation fallback are all exercised by anything that reads this fixture.
 */
import { vi } from 'vitest';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { sealSecrets } from '../../../server/lib/config-crypto';
import { createTestDb, setupSchema } from '../db';

export const TENANT = '00000000-0000-0000-0000-000000000001';

/** The KDF input the envelope is sealed and opened under. */
export const JWT_SECRET = 'secret32chars_aaaaaaaaaaaaaaaaaa';

/** What the platform supplies on a saas deployment's Worker env. */
export const PLATFORM_CLIENT_ID = 'platform-client-id';

export interface QboEnvFixture {
    env: Record<string, unknown>;
    db: BetterSQLite3Database<typeof schema>;
    /** What this tenant's `secrets_enc` decrypts to — the spec installs it into its `loadTenantSecrets` stub. */
    tenantSecrets: Record<string, string> | null;
    spy: {
        runCDCSync: ReturnType<typeof vi.fn>;
        warn: ReturnType<typeof vi.fn>;
        info: ReturnType<typeof vi.fn>;
        /** The credentials the QBOService was constructed with, per tenant. */
        constructedWith: { clientId?: string; clientSecret?: string; qboEnv?: string };
    };
}

interface BuildOpts {
    /** What `secrets_enc` decrypts to for this tenant. `null` = the tenant stored none. */
    tenantSecrets: Record<string, string> | null;
    /** Whether the deployment's own env carries QuickBooks credentials. */
    platformEnv: boolean;
    /** A connection row is seeded with sync enabled unless this says otherwise. */
    syncEnabled?: boolean;
}

async function build(opts: BuildOpts): Promise<QboEnvFixture> {
    const fix = createTestDb();
    const db = fix.db;
    await setupSchema(fix.sqlite);

    const now = new Date();
    await db.insert(schema.tenants).values({
        id: TENANT, slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: now,
    });
    await db.insert(schema.qboConnections).values({
        tenantId: TENANT, realmId: 'realm-1',
        accessToken: 'enc:access', refreshToken: 'enc:refresh',
        tokenExpiresAt: new Date(Date.now() + 86_400_000),
        refreshTokenExpiresAt: new Date(Date.now() + 86_400_000),
        syncEnabled: opts.syncEnabled ?? true,
        defaultItemId: '1', createdAt: now,
    });

    // Sealed with the product's own envelope, not a hand-built blob. A test
    // that writes ciphertext it invented can only prove the reader agrees with
    // the writer — which is the exact pattern that let nine QuickBooks paths
    // ship without ever working.
    if (opts.tenantSecrets) {
        const sealed = await sealSecrets(opts.tenantSecrets, TENANT, JWT_SECRET);
        await db.insert(schema.tenantConfigs).values({
            tenantId: TENANT,
            secretsEnc: sealed.blob,
            dekEnc: sealed.dekEnc,
            createdAt: now,
            updatedAt: now,
        } as never);
    }

    const spy: QboEnvFixture['spy'] = {
        runCDCSync: vi.fn(async () => ({ processed: 0 })),
        warn: vi.fn(),
        info: vi.fn(),
        constructedWith: {},
    };

    const env: Record<string, unknown> = {
        DB: {} as D1Database,
        JWT_SECRET,
        // No KV: `loadTenantSecrets` tolerates its absence and reads D1 directly,
        // which is what a test wants — a cache hit would skip the decryption the
        // fixture exists to exercise.
        TENANT_CACHE: undefined,
    };
    if (opts.platformEnv) {
        env.QBO_CLIENT_ID = PLATFORM_CLIENT_ID;
        env.QBO_CLIENT_SECRET = 'platform-client-secret';
        env.QBO_ENV = 'production';
    }

    return { env, db, spy, tenantSecrets: opts.tenantSecrets };
}

/**
 * A self-hosted deploy: NOTHING on the Worker env, everything on the tenant row.
 * This is the shape `qboAppManaged: false` produces, and the shape no QBO spec
 * had ever been written against.
 */
export function standaloneQboEnv(opts: { tenantSecrets: Record<string, string> | null }) {
    return build({ ...opts, platformEnv: false });
}

/** A platform deploy: credentials on the Worker env, serving every tenant. */
export function saasQboEnv(opts: { tenantSecrets: Record<string, string> | null }) {
    return build({ ...opts, platformEnv: true });
}
