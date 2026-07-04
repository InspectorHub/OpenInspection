/**
 * Final-review Fix 3 — POST /api/message-templates/test-send (SMS channel)
 * must mirror server/api/sms.ts POST /sms/test exactly: managed-compliance
 * gate, free-tier pre-flight cap, and source-tagged metering. Before this fix
 * the SMS branch called `loadProviderForTenant` directly with none of the
 * three, unlike its own email-branch sibling in the same route.
 *
 * Pattern mirrors tests/unit/sms-api.spec.ts's "Task 5" / "Task 8" suites:
 * in-process Hono harness, mock drizzle-orm/d1 → in-memory sqlite, spy
 * `loadProviderForTenant` to bypass the real Twilio HTTP path.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';
import { AppError } from '../../../server/lib/errors';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { SAAS_PROFILE, STANDALONE_PROFILE } from '../../../server/lib/deployment-profile';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// Imported AFTER the mock is registered.
// eslint-disable-next-line import/order
import messageTemplateRoutes from '../../../server/api/message-templates';
import * as resolveTwilioModule from '../../../server/lib/sms/resolve-twilio';
import { MeteringService } from '../../../server/services/metering.service';

const TENANT = '00000000-0000-0000-0000-0000000000f3';
const FAKE_ENV = {
    DB: {},
    JWT_SECRET: 'test-secret',
    TWILIO_AUTH_TOKEN: 'platform-auth-token',
} as unknown as HonoConfig['Bindings'];

function makeExecCtx() {
    return { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
}

function buildApp(db: BetterSQLite3Database<typeof schema>, profile: typeof SAAS_PROFILE | typeof STANDALONE_PROFILE = STANDALONE_PROFILE) {
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });
    app.use('*', async (c, next) => {
        c.set('tenantId', TENANT);
        c.set('userRole', 'owner');
        c.set('user', { sub: 'user-1', role: 'owner', tenantId: TENANT } as never);
        c.set('profile', profile);
        await next();
    });
    app.route('/api/message-templates', messageTemplateRoutes);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    return app;
}

async function seedTenant(db: BetterSQLite3Database<typeof schema>, id: string) {
    await db.insert(schema.tenants).values({
        id, name: 'Acme', slug: id, status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    } as never);
}

function stubResolvedProvider(id = 'SM_1') {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, id });
    const loadProviderSpy = vi.spyOn(resolveTwilioModule, 'loadProviderForTenant').mockResolvedValue({
        provider: { sendMessage, validateInboundSignature: vi.fn().mockResolvedValue(false) },
        from: '+15550009999',
    });
    return { sendMessage, loadProviderSpy };
}

function sendReq(app: OpenAPIHono<HonoConfig>, env: HonoConfig['Bindings']) {
    return app.request('/api/message-templates/test-send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channel: 'sms', body: 'Hello {{name}}', to: '+15559991234' }),
    }, env, makeExecCtx());
}

let db: BetterSQLite3Database<typeof schema>;
let sqlite: { close: () => void };

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db as BetterSQLite3Database<typeof schema>;
    sqlite = fx.sqlite;
    await setupSchema(fx.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    await seedTenant(db, TENANT);
});

afterEach(() => {
    sqlite.close();
    vi.restoreAllMocks();
});

describe('POST /api/message-templates/test-send (SMS) — managed-send gate (Fix 3)', () => {
    it('managed_dedicated, not approved → success=false managed_not_approved, provider never called', async () => {
        await db.insert(schema.tenantConfigs).values({
            tenantId: TENANT, smsMode: 'managed_dedicated', updatedAt: new Date(),
        } as never);
        const { sendMessage } = stubResolvedProvider();

        const app = buildApp(db, SAAS_PROFILE);
        const res = await sendReq(app, FAKE_ENV);
        const body = await res.json() as { success: boolean; error?: string };

        expect(body.success).toBe(false);
        expect(body.error).toBe('managed_not_approved');
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('own/platform mode → gate does not block', async () => {
        const { sendMessage } = stubResolvedProvider();
        const app = buildApp(db, SAAS_PROFILE);
        const res = await sendReq(app, FAKE_ENV);
        const body = await res.json() as { success: boolean; error?: string };

        expect(body.error).not.toBe('managed_not_approved');
        expect(sendMessage).toHaveBeenCalledTimes(1);
    });
});

describe('POST /api/message-templates/test-send (SMS) — free-tier pre-flight + metering (Fix 3)', () => {
    it('free tenant at 50/50 lifetime sms (platform mode) → 402 QUOTA_EXHAUSTED, provider never called', async () => {
        await new MeteringService(db as unknown as D1Database).record(TENANT, 'sms', '2026-06', 50);
        const { sendMessage } = stubResolvedProvider();

        const app = buildApp(db, SAAS_PROFILE);
        const res = await sendReq(app, FAKE_ENV);

        expect(res.status).toBe(402);
        const body = await res.json() as { error: { code: string } };
        expect(body.error.code).toBe('QUOTA_EXHAUSTED');
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it("'own' mode tenant at 50 seeded platform sms → send proceeds and records 'sms_byo'", async () => {
        await db.insert(schema.tenantConfigs).values({
            tenantId: TENANT, smsMode: 'own', updatedAt: new Date(),
        } as never);
        await new MeteringService(db as unknown as D1Database).record(TENANT, 'sms', '2026-06', 50);
        const record = vi.spyOn(MeteringService.prototype, 'record');
        const { sendMessage } = stubResolvedProvider('SM_own_1');

        const app = buildApp(db, SAAS_PROFILE);
        const res = await sendReq(app, FAKE_ENV);
        const body = await res.json() as { success: boolean };

        expect(body.success).toBe(true);
        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(record).toHaveBeenCalledWith(TENANT, 'sms_byo', expect.stringMatching(/^\d{4}-\d{2}$/));
    });

    it('platform-mode send under the cap → records plain \'sms\'', async () => {
        const record = vi.spyOn(MeteringService.prototype, 'record');
        const { sendMessage } = stubResolvedProvider('SM_plat_1');

        const app = buildApp(db, SAAS_PROFILE);
        const res = await sendReq(app, FAKE_ENV);
        const body = await res.json() as { success: boolean };

        expect(body.success).toBe(true);
        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(record).toHaveBeenCalledWith(TENANT, 'sms', expect.stringMatching(/^\d{4}-\d{2}$/));
    });

    it('standalone profile (hasUsageQuota=false) → cap never enforced even at 50', async () => {
        await new MeteringService(db as unknown as D1Database).record(TENANT, 'sms', '2026-06', 50);
        const { sendMessage } = stubResolvedProvider('SM_standalone_1');

        const app = buildApp(db, STANDALONE_PROFILE);
        const res = await sendReq(app, FAKE_ENV);

        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean };
        expect(body.success).toBe(true);
        expect(sendMessage).toHaveBeenCalledTimes(1);
    });
});
