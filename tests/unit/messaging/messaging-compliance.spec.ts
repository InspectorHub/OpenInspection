import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { MessagingComplianceService } from '../../../server/services/messaging-compliance.service';
import {
    TwilioComplianceProvider,
    type TwilioComplianceClient,
} from '../../../server/lib/messaging/providers/twilio-compliance';
import { resolveComplianceProvider } from '../../../server/lib/sms/resolve-compliance-provider';
import type { ComplianceProvider, ComplianceProviderId } from '../../../server/lib/messaging/compliance-provider';
import type { ComplianceStateStore } from '../../../server/lib/messaging/compliance-state-store';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

// ---------------------------------------------------------------------------
// Fake twilio-node-shaped client (mirrors twilio-compliance-provider.spec.ts).
// The coordinator now delegates provisioning/sync to an injected
// ComplianceProvider; these tests inject a real TwilioComplianceProvider wrapping
// this structural fake so every behaviour assertion still flows end-to-end through
// the coordinator → provider → D1 state store.
// ---------------------------------------------------------------------------

interface FakeOpts {
    brands?: Array<{ sid: string; status: string }>;
    tfvs?: Array<{ sid: string; status: string }>;
    campThrows?: boolean;
    tfvThrows?: boolean;
    attachThrows?: boolean;
    onBuy?: () => void;
    onAttach?: () => void;
    capturedProfile?: { data?: Record<string, string> };
}

function fakeTwilio(calls: string[], opts: FakeOpts = {}): TwilioComplianceClient {
    const client = {
        request: async ({ uri, data }: { method: string; uri: string; data?: Record<string, string> }) => {
            if (uri.includes('/CustomerProfiles')) {
                calls.push('cp');
                if (opts.capturedProfile) opts.capturedProfile.data = data;
                return { statusCode: 201, body: { sid: 'BUx', status: 'PENDING' } };
            }
            if (uri.includes('/Compliance/Usa2p')) {
                calls.push('camp');
                if (opts.campThrows) throw new Error('TCR error');
                return { statusCode: 201, body: { sid: 'CMx', status: 'PENDING' } };
            }
            if (uri.includes('/Tollfree/Verifications')) {
                calls.push('tfv');
                if (opts.tfvThrows) throw new Error('crash');
                return { statusCode: 201, body: { sid: 'HVx', status: 'PENDING_REVIEW' } };
            }
            throw new Error(`unexpected generic uri: ${uri}`);
        },
        messaging: {
            v1: {
                brandRegistrations: {
                    create: async () => { calls.push('brand'); return { sid: 'BNx', status: 'PENDING' }; },
                    list: async () => opts.brands ?? [],
                },
                services: Object.assign(
                    (_sid: string) => ({
                        phoneNumbers: {
                            create: async () => {
                                calls.push('attach');
                                opts.onAttach?.();
                                if (opts.attachThrows) throw new Error('attach failed');
                                return { sid: 'ASx' };
                            },
                        },
                    }),
                    { create: async () => { calls.push('ms'); return { sid: 'MGx' }; } },
                ),
                tollfreeVerifications: { list: async () => opts.tfvs ?? [] },
            },
        },
        availablePhoneNumbers: (_country: string) => ({
            local: { list: async () => { calls.push('search-local'); return [{ phoneNumber: '+15551110000' }]; } },
            tollFree: { list: async () => { calls.push('search-tf'); return [{ phoneNumber: '+15551110000' }]; } },
        }),
        incomingPhoneNumbers: {
            create: async (p: { phoneNumber: string }) => {
                calls.push('buy');
                opts.onBuy?.();
                return { sid: 'PNx', phoneNumber: p.phoneNumber };
            },
        },
    };
    return client as unknown as TwilioComplianceClient;
}

/** Build a real TwilioComplianceProvider over the structural fake. */
function fakeProvider(calls: string[] = [], opts: FakeOpts = {}): TwilioComplianceProvider {
    return new TwilioComplianceProvider(fakeTwilio(calls, opts));
}

// ---------------------------------------------------------------------------
// resolveComplianceProvider — managed-ISV provider construction seam.
// ---------------------------------------------------------------------------

describe('resolveComplianceProvider', () => {
    it('resolves twilio provider with ISV env; throws managed_not_configured without', () => {
        const env = { TWILIO_ACCOUNT_SID: 'AC1', TWILIO_API_KEY_SID: 'SK1', TWILIO_API_KEY_SECRET: 's' } as never;
        expect(resolveComplianceProvider(env, 'twilio').id).toBe('twilio');
        expect(() => resolveComplianceProvider({} as never, 'twilio')).toThrow('managed_not_configured');
    });

    it('throws managed_not_configured when any single key is missing', () => {
        expect(() => resolveComplianceProvider(
            { TWILIO_ACCOUNT_SID: 'AC1', TWILIO_API_KEY_SID: 'SK1' } as never, 'twilio',
        )).toThrow('managed_not_configured');
    });

    it('resolves telnyx provider with TELNYX_API_KEY; throws managed_not_configured without (Plan 2)', () => {
        // Twilio creds present but TELNYX_API_KEY absent → telnyx still fails closed.
        const twilioOnly = { TWILIO_ACCOUNT_SID: 'AC1', TWILIO_API_KEY_SID: 'SK1', TWILIO_API_KEY_SECRET: 's' } as never;
        expect(() => resolveComplianceProvider(twilioOnly, 'telnyx')).toThrow('managed_not_configured');
        // With TELNYX_API_KEY the resolver builds a TelnyxComplianceProvider (id 'telnyx').
        const telnyxEnv = { TELNYX_API_KEY: 'KEY_telnyx_test' } as never;
        expect(resolveComplianceProvider(telnyxEnv, 'telnyx').id).toBe('telnyx');
    });
});

it('syncOwnStatus upserts the latest toll-free status', async () => {
    const fx = createTestDb(); await setupSchema(fx.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(fx.db);
    const svc = new MessagingComplianceService({} as D1Database);
    const fakeClient = { tollfree: { list: async () => [{ sid: 'HH1', status: 'TWILIO_APPROVED', phoneNumber: 'PN1' }] }, brands: { list: async () => [] } };
    await svc.syncOwnStatus('t1', { sid: 'AC1', token: 't' }, fakeClient as never);
    const got = await svc.getStatus('t1');
    expect(got?.complianceStatus).toBe('approved');
    fx.sqlite.close();
});

describe('MessagingComplianceService', () => {
    it('returns null when tenant has no row', async () => {
        const fx = createTestDb(); await setupSchema(fx.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(fx.db);
        const svc = new MessagingComplianceService({} as D1Database);
        const got = await svc.getStatus('no-such-tenant');
        expect(got).toBeNull();
        fx.sqlite.close();
    });

    it('maps TWILIO_REJECTED to rejected', async () => {
        const fx = createTestDb(); await setupSchema(fx.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(fx.db);
        const svc = new MessagingComplianceService({} as D1Database);
        const fakeClient = { tollfree: { list: async () => [{ sid: 'HH2', status: 'TWILIO_REJECTED', phoneNumber: 'PN2' }] }, brands: { list: async () => [] } };
        await svc.syncOwnStatus('t2', { sid: 'AC2', token: 't' }, fakeClient as never);
        const got = await svc.getStatus('t2');
        expect(got?.complianceStatus).toBe('rejected');
        fx.sqlite.close();
    });

    it('maps unknown Twilio status to tfv_pending', async () => {
        const fx = createTestDb(); await setupSchema(fx.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(fx.db);
        const svc = new MessagingComplianceService({} as D1Database);
        const fakeClient = { tollfree: { list: async () => [{ sid: 'HH3', status: 'IN_REVIEW', phoneNumber: 'PN3' }] }, brands: { list: async () => [] } };
        await svc.syncOwnStatus('t3', { sid: 'AC3', token: 't' }, fakeClient as never);
        const got = await svc.getStatus('t3');
        expect(got?.complianceStatus).toBe('tfv_pending');
        fx.sqlite.close();
    });

    it('returns not_started when tollfree list is empty', async () => {
        const fx = createTestDb(); await setupSchema(fx.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(fx.db);
        const svc = new MessagingComplianceService({} as D1Database);
        const fakeClient = { tollfree: { list: async () => [] }, brands: { list: async () => [] } };
        await svc.syncOwnStatus('t4', { sid: 'AC4', token: 't' }, fakeClient as never);
        const got = await svc.getStatus('t4');
        expect(got?.complianceStatus).toBe('not_started');
        fx.sqlite.close();
    });

    it('upsert is idempotent — second sync overwrites status', async () => {
        const fx = createTestDb(); await setupSchema(fx.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(fx.db);
        const svc = new MessagingComplianceService({} as D1Database);
        const clientPending = { tollfree: { list: async () => [{ sid: 'HH5', status: 'IN_REVIEW', phoneNumber: 'PN5' }] }, brands: { list: async () => [] } };
        const clientApproved = { tollfree: { list: async () => [{ sid: 'HH5', status: 'TWILIO_APPROVED', phoneNumber: 'PN5' }] }, brands: { list: async () => [] } };
        await svc.syncOwnStatus('t5', { sid: 'AC5', token: 't' }, clientPending as never);
        await svc.syncOwnStatus('t5', { sid: 'AC5', token: 't' }, clientApproved as never);
        const got = await svc.getStatus('t5');
        expect(got?.complianceStatus).toBe('approved');
        fx.sqlite.close();
    });

    it('degrades gracefully when Twilio throws — returns not_started', async () => {
        const fx = createTestDb(); await setupSchema(fx.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(fx.db);
        const svc = new MessagingComplianceService({} as D1Database);
        const errorClient = { tollfree: { list: async () => { throw new Error('network'); } }, brands: { list: async () => [] } };
        await svc.syncOwnStatus('t6', { sid: 'AC6', token: 't' }, errorClient as never);
        const got = await svc.getStatus('t6');
        expect(got?.complianceStatus).toBe('not_started');
        fx.sqlite.close();
    });
});

// ---------------------------------------------------------------------------
// provision() — coordinator delegates to the injected ComplianceProvider and
// persists its result. The orchestration itself (guarded resumable chain,
// crash-resume, mid-chain throw, statusCallback threading, attach resume) is
// the PROVIDER's responsibility and is exhaustively covered against the real
// TwilioComplianceProvider in twilio-compliance-provider.spec.ts — re-testing
// the full chain here through the coordinator would be a pure duplicate.
// This is a single smoke: the coordinator calls provider.provision and writes
// whatever it returns to D1.
// ---------------------------------------------------------------------------

describe('MessagingComplianceService.provision — delegates + persists (smoke)', () => {
    it('sp10dlc: delegates to the injected provider and persists its returned SIDs/status', async () => {
        const fx = createTestDb(); await setupSchema(fx.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(fx.db);
        const calls: string[] = [];
        const provider = fakeProvider(calls);
        const svc = new MessagingComplianceService({} as D1Database);
        const result = await svc.provision(
            'p1',
            { legalName: 'Acme Inspections', address: '1 Main, TX', repName: 'Bob' },
            'sp10dlc',
            provider,
        );
        const row = await fx.db
            .select()
            .from(schema.messagingCompliance)
            .where(eq(schema.messagingCompliance.tenantId, 'p1'))
            .get();
        expect(result.complianceStatus).toBe('campaign_pending');
        expect(row?.brandSid).toBe('BNx');
        expect(row?.campaignSid).toBe('CMx');
        expect(row?.messagingResourceSid).toBe('MGx');
        expect(row?.complianceStatus).toBe('campaign_pending');
        expect(calls).toContain('brand');
        expect(calls).toContain('camp');
        fx.sqlite.close();
    });
});

// ---------------------------------------------------------------------------
// applyComplianceCallback — change-detection return value (Task 11)
// ---------------------------------------------------------------------------

describe('applyComplianceCallback — change detection', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: { close: () => void };

    beforeEach(async () => {
        const fx = createTestDb();
        db = fx.db as BetterSQLite3Database<typeof schema>;
        sqlite = fx.sqlite;
        await setupSchema(fx.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    });

    afterEach(() => sqlite.close());

    async function seedRow(tenantId: string, complianceStatus: string) {
        const now = new Date();
        await db.insert(schema.messagingCompliance).values({
            tenantId,
            mode: 'managed_dedicated',
            complianceStatus,
            createdAt: now,
            updatedAt: now,
        } as never);
    }

    it('returns changed=true + new status when campaign TWILIO_APPROVED transitions from campaign_pending', async () => {
        await seedRow('t-chg-1', 'campaign_pending');
        const svc = new MessagingComplianceService({} as D1Database);
        const result = await svc.applyComplianceCallback('t-chg-1', {
            entity: 'campaign',
            rawStatus: 'TWILIO_APPROVED',
            rejectionReason: null,
            entitySid: 'CR123',
        });
        expect(result.changed).toBe(true);
        expect(result.complianceStatus).toBe('approved');
        expect(result.rejectionReason).toBeNull();
    });

    it('returns changed=false when inbound status results in the same complianceStatus', async () => {
        // If the row is already campaign_pending and a brand intermediate callback
        // comes in that does not change complianceStatus, changed must be false.
        await seedRow('t-chg-2', 'brand_pending');
        const svc = new MessagingComplianceService({} as D1Database);
        // brand TWILIO_APPROVED from brand_pending → stays brand_pending
        const result = await svc.applyComplianceCallback('t-chg-2', {
            entity: 'brand',
            rawStatus: 'TWILIO_APPROVED',
            rejectionReason: null,
            entitySid: 'BN123',
        });
        // brand_pending → brand_pending = no change
        expect(result.changed).toBe(false);
        expect(result.complianceStatus).toBe('brand_pending');
    });

    it('returns changed=true + rejectionReason when campaign REJECTED transitions from campaign_pending', async () => {
        await seedRow('t-chg-3', 'campaign_pending');
        const svc = new MessagingComplianceService({} as D1Database);
        const result = await svc.applyComplianceCallback('t-chg-3', {
            entity: 'campaign',
            rawStatus: 'REJECTED',
            rejectionReason: 'code=30034: Use case not approved',
            entitySid: 'CR456',
        });
        expect(result.changed).toBe(true);
        expect(result.complianceStatus).toBe('rejected');
        expect(result.rejectionReason).toBe('code=30034: Use case not approved');
    });

    it('returns changed=false + sentinel status when no row exists for tenant', async () => {
        const svc = new MessagingComplianceService({} as D1Database);
        const result = await svc.applyComplianceCallback('no-such-tenant', {
            entity: 'campaign',
            rawStatus: 'TWILIO_APPROVED',
            rejectionReason: null,
            entitySid: 'CR000',
        });
        expect(result.changed).toBe(false);
    });

    it('no-regress: a non-terminal campaign callback never downgrades an approved row', async () => {
        // Callbacks are re-delivered and unordered; a non-terminal campaign status
        // arriving after approval must NOT roll the row back to campaign_pending
        // (that would disable an approved tenant's SMS at the send gate). This also
        // guards the Telnyx path, whose raw statuses are non-terminal under the
        // current callback vocabulary.
        await seedRow('t-nr-1', 'approved');
        const svc = new MessagingComplianceService({} as D1Database);
        const result = await svc.applyComplianceCallback('t-nr-1', {
            entity: 'campaign',
            rawStatus: 'IN_PROGRESS',
            rejectionReason: null,
            entitySid: 'CR789',
        });
        expect(result.complianceStatus).toBe('approved');
        expect(result.changed).toBe(false);
    });

    it('no-regress: a non-terminal TFV callback never downgrades an approved row', async () => {
        await seedRow('t-nr-2', 'approved');
        const svc = new MessagingComplianceService({} as D1Database);
        const result = await svc.applyComplianceCallback('t-nr-2', {
            entity: 'tfv',
            rawStatus: 'In Progress',
            rejectionReason: null,
            entitySid: 'HV789',
        });
        expect(result.complianceStatus).toBe('approved');
        expect(result.changed).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// syncManagedStatus — change-detection return value (Task 11)
// ---------------------------------------------------------------------------

describe('syncManagedStatus — change detection', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: { close: () => void };

    beforeEach(async () => {
        const fx = createTestDb();
        db = fx.db as BetterSQLite3Database<typeof schema>;
        sqlite = fx.sqlite;
        await setupSchema(fx.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    });

    afterEach(() => sqlite.close());

    async function seedRow(tenantId: string, complianceStatus: string, tfvStatus?: string) {
        const now = new Date();
        await db.insert(schema.messagingCompliance).values({
            tenantId,
            mode: 'managed_dedicated',
            complianceStatus,
            tfvStatus: tfvStatus ?? null,
            createdAt: now,
            updatedAt: now,
        } as never);
    }

    const approvedTfvProvider = () => fakeProvider([], { tfvs: [{ sid: 'HV1', status: 'TWILIO_APPROVED' }] });
    const noChangeTfvProvider = () => fakeProvider([], { tfvs: [] });

    it('returns changed=true when TFV poll transitions status from tfv_pending to approved', async () => {
        await seedRow('t-sc-1', 'tfv_pending', 'PENDING_REVIEW');
        const svc = new MessagingComplianceService({} as D1Database);
        const result = await svc.syncManagedStatus('t-sc-1', approvedTfvProvider());
        expect(result.changed).toBe(true);
        expect(result.complianceStatus).toBe('approved');
    });

    it('returns changed=false when TFV poll finds no entries (no status change)', async () => {
        await seedRow('t-sc-2', 'tfv_pending', 'PENDING_REVIEW');
        const svc = new MessagingComplianceService({} as D1Database);
        const result = await svc.syncManagedStatus('t-sc-2', noChangeTfvProvider());
        expect(result.changed).toBe(false);
        expect(result.complianceStatus).toBe('tfv_pending');
    });

    it('returns changed=false when no row exists for tenant', async () => {
        const svc = new MessagingComplianceService({} as D1Database);
        const result = await svc.syncManagedStatus('no-row', approvedTfvProvider());
        expect(result.changed).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// compliance-status webhook → outbox emit (Task 11)
// Tests drive the webhook handler directly to verify the outbox is called
// with the correct event type and payload when the status changes.
// ---------------------------------------------------------------------------

import { OpenAPIHono } from '@hono/zod-openapi';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig, AppServices } from '../../../server/types/hono';
import { smsPublicRoutes } from '../../../server/api/sms';
import { signParams } from '../../../server/lib/messaging/twilio';

const APP_BASE_URL_WH = 'https://app.example.test';
const COMPLIANCE_TOKEN_WH = 'compliance-webhook-token-11';
const TENANT_WH = '00000000-0000-0000-0000-000000000099';

function makeExecCtx() {
    return { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
}

async function buildWebhookApp(
    database: BetterSQLite3Database<typeof schema>,
    opts: { appendSpy?: ReturnType<typeof vi.fn>; hasSyncQueue?: boolean } = {},
) {
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });

    // Inject a minimal services stub into context so the compliance-webhook handler
    // can read c.var.services.outbox (the UserSyncOutbox seam) without needing
    // the full diMiddleware stack. The outbox is populated only when hasSyncQueue
    // is true (mirrors the SaaS gate in di.ts).
    app.use('*', async (c, next) => {
        const outbox = (opts.hasSyncQueue && opts.appendSpy)
            ? { append: opts.appendSpy }
            : undefined;
        c.set('services', { outbox } as unknown as AppServices);
        await next();
    });

    app.route('/api/public', smsPublicRoutes);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(database);

    const env: HonoConfig['Bindings'] = {
        DB: {},
        APP_BASE_URL: APP_BASE_URL_WH,
        JWT_SECRET: 'test-secret',
        TWILIO_COMPLIANCE_WEBHOOK_TOKEN: COMPLIANCE_TOKEN_WH,
        TENANT_CACHE: { get: async () => null, put: async () => {} },
        ...(opts.hasSyncQueue ? { SYNC_QUEUE: {} } : {}),
    } as unknown as HonoConfig['Bindings'];

    return { app, env };
}

async function postWebhook(
    app: OpenAPIHono<HonoConfig>,
    env: HonoConfig['Bindings'],
    tenantSlug: string,
    params: Record<string, string>,
) {
    const url = `${APP_BASE_URL_WH}/api/public/twilio/compliance-status/${tenantSlug}`;
    const sig = await signParams(COMPLIANCE_TOKEN_WH, url, params);
    return app.request(
        `/api/public/twilio/compliance-status/${tenantSlug}`,
        {
            method: 'POST',
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
                'x-twilio-signature': sig,
            },
            body: new URLSearchParams(params).toString(),
        },
        env,
        makeExecCtx(),
    );
}

describe('compliance-status webhook → outbox emit (Task 11)', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: { close: () => void };

    beforeEach(async () => {
        const fx = createTestDb();
        db = fx.db as BetterSQLite3Database<typeof schema>;
        sqlite = fx.sqlite;
        await setupSchema(fx.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

        // Seed the tenant used by webhook tests.
        await db.insert(schema.tenants).values({
            id: TENANT_WH, name: 'Webhook Co', slug: 'webhookco', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        } as never);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        sqlite.close();
    });

    it('emits outbox event with correct type and payload on status-changing callback (SYNC_QUEUE present)', async () => {
        // Seed a compliance row at campaign_pending so the APPROVED callback changes status.
        const now = new Date();
        await db.insert(schema.messagingCompliance).values({
            tenantId: TENANT_WH, mode: 'managed_dedicated',
            complianceStatus: 'campaign_pending', createdAt: now, updatedAt: now,
        } as never);

        const appendSpy = vi.fn().mockResolvedValue('outbox-id-1');
        const { app, env } = await buildWebhookApp(db, { appendSpy, hasSyncQueue: true });

        const res = await postWebhook(app, env, 'webhookco', {
            CampaignSid: 'CR_APPROVED', CampaignStatus: 'TWILIO_APPROVED',
        });

        expect(res.status).toBe(200);
        expect(appendSpy).toHaveBeenCalledOnce();
        const [calledWith] = appendSpy.mock.calls[0] as [{ type: string; payload: Record<string, unknown> }];
        expect(calledWith.type).toBe('io.inspectorhub.tenant.compliance_status_updated');
        expect(calledWith.payload.tenantId).toBe(TENANT_WH);
        expect(calledWith.payload.complianceStatus).toBe('approved');
        expect(calledWith.payload.rejectionReason).toBeNull();
        expect(typeof calledWith.payload.updatedAt).toBe('number');
    });

    it('does NOT emit outbox event when status is unchanged (brand-only sub-status update)', async () => {
        // brand_pending → brand TWILIO_APPROVED keeps complianceStatus=brand_pending (no change).
        const now = new Date();
        await db.insert(schema.messagingCompliance).values({
            tenantId: TENANT_WH, mode: 'managed_dedicated',
            complianceStatus: 'brand_pending', createdAt: now, updatedAt: now,
        } as never);

        const appendSpy = vi.fn().mockResolvedValue('outbox-id-2');
        const { app, env } = await buildWebhookApp(db, { appendSpy, hasSyncQueue: true });

        const res = await postWebhook(app, env, 'webhookco', {
            BrandSid: 'BN_NOCHANGE', BrandStatus: 'TWILIO_APPROVED',
        });

        expect(res.status).toBe(200);
        expect(appendSpy).not.toHaveBeenCalled();
    });

    it('does NOT emit outbox event when SYNC_QUEUE is absent (standalone mode)', async () => {
        const now = new Date();
        await db.insert(schema.messagingCompliance).values({
            tenantId: TENANT_WH, mode: 'managed_dedicated',
            complianceStatus: 'campaign_pending', createdAt: now, updatedAt: now,
        } as never);

        const appendSpy = vi.fn().mockResolvedValue('outbox-id-3');
        // hasSyncQueue=false (default) → no SYNC_QUEUE in env
        const { app, env } = await buildWebhookApp(db, { appendSpy, hasSyncQueue: false });

        const res = await postWebhook(app, env, 'webhookco', {
            CampaignSid: 'CR_NO_QUEUE', CampaignStatus: 'TWILIO_APPROVED',
        });

        expect(res.status).toBe(200);
        expect(appendSpy).not.toHaveBeenCalled();
    });

    it('still returns 200 even when outbox append throws (fail-soft)', async () => {
        const now = new Date();
        await db.insert(schema.messagingCompliance).values({
            tenantId: TENANT_WH, mode: 'managed_dedicated',
            complianceStatus: 'campaign_pending', createdAt: now, updatedAt: now,
        } as never);

        const appendSpy = vi.fn().mockRejectedValue(new Error('queue unavailable'));
        const { app, env } = await buildWebhookApp(db, { appendSpy, hasSyncQueue: true });

        const res = await postWebhook(app, env, 'webhookco', {
            CampaignSid: 'CR_FAILSOFT', CampaignStatus: 'TWILIO_APPROVED',
        });

        // Despite outbox throwing, the route must return 200 so Twilio does not retry.
        expect(res.status).toBe(200);
    });
});

// ---------------------------------------------------------------------------
// applyComplianceCallback — brand callback must NEVER regress a more-advanced
// status. Twilio re-delivers callbacks and does not guarantee brand-before-
// campaign ordering; a late brand-approved must not roll campaign_pending /
// approved back to brand_pending (which would silently disable an approved
// tenant's SMS at the send gate).
// ---------------------------------------------------------------------------

describe('applyComplianceCallback — brand approval never regresses status', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: { close: () => void };

    beforeEach(async () => {
        const fx = createTestDb();
        db = fx.db as BetterSQLite3Database<typeof schema>;
        sqlite = fx.sqlite;
        await setupSchema(fx.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    });

    afterEach(() => sqlite.close());

    async function seedRow(tenantId: string, complianceStatus: string) {
        const now = new Date();
        await db.insert(schema.messagingCompliance).values({
            tenantId, mode: 'managed_dedicated', complianceStatus,
            createdAt: now, updatedAt: now,
        } as never);
    }

    it('does NOT regress campaign_pending → brand_pending on a late brand TWILIO_APPROVED', async () => {
        await seedRow('t-reg-1', 'campaign_pending');
        const svc = new MessagingComplianceService({} as D1Database);
        const result = await svc.applyComplianceCallback('t-reg-1', {
            entity: 'brand', rawStatus: 'TWILIO_APPROVED', rejectionReason: null, entitySid: 'BN_LATE',
        });
        expect(result.changed).toBe(false);
        expect(result.complianceStatus).toBe('campaign_pending');
        // brandStatus sub-field still records the approval.
        const row = await db.select().from(schema.messagingCompliance)
            .where(eq(schema.messagingCompliance.tenantId, 't-reg-1')).get();
        expect(row?.brandStatus).toBe('TWILIO_APPROVED');
    });

    it('does NOT regress approved → brand_pending on a redelivered brand TWILIO_APPROVED', async () => {
        await seedRow('t-reg-2', 'approved');
        const svc = new MessagingComplianceService({} as D1Database);
        const result = await svc.applyComplianceCallback('t-reg-2', {
            entity: 'brand', rawStatus: 'TWILIO_APPROVED', rejectionReason: null, entitySid: 'BN_DUP',
        });
        expect(result.changed).toBe(false);
        expect(result.complianceStatus).toBe('approved');
    });

    it('still advances brand_pending on first brand approval (no false guard)', async () => {
        await seedRow('t-reg-3', 'profile_pending');
        const svc = new MessagingComplianceService({} as D1Database);
        const result = await svc.applyComplianceCallback('t-reg-3', {
            entity: 'brand', rawStatus: 'TWILIO_APPROVED', rejectionReason: null, entitySid: 'BN_FIRST',
        });
        expect(result.changed).toBe(true);
        expect(result.complianceStatus).toBe('brand_pending');
    });
});

// ---------------------------------------------------------------------------
// syncManagedStatus (cron twin) — brand poll must hold the same no-regress
// invariant as the webhook: a brand-approved poll must not roll campaign_pending
// backward to brand_pending.
// ---------------------------------------------------------------------------

describe('syncManagedStatus — brand poll never regresses campaign_pending', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: { close: () => void };

    beforeEach(async () => {
        const fx = createTestDb();
        db = fx.db as BetterSQLite3Database<typeof schema>;
        sqlite = fx.sqlite;
        await setupSchema(fx.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    });

    afterEach(() => sqlite.close());

    it('keeps campaign_pending when the brand poll reports approved', async () => {
        const now = new Date();
        // sp10dlc row: brandSid set (brand poll path), already advanced to campaign_pending.
        await db.insert(schema.messagingCompliance).values({
            tenantId: 't-cron-reg', mode: 'managed_dedicated', complianceStatus: 'campaign_pending',
            brandSid: 'BN_X', brandStatus: 'PENDING', createdAt: now, updatedAt: now,
        } as never);
        const approvedBrandProvider = fakeProvider([], { brands: [{ sid: 'BN_X', status: 'TWILIO_APPROVED' }] });
        const svc = new MessagingComplianceService({} as D1Database);
        const result = await svc.syncManagedStatus('t-cron-reg', approvedBrandProvider);
        expect(result.changed).toBe(false);
        expect(result.complianceStatus).toBe('campaign_pending');
    });
});

// ---------------------------------------------------------------------------
// sweepManagedStatuses — must scope to managed modes only. An 'own'-mode tenant
// (BYO Twilio) must NEVER be polled against the managed ISV account, or its
// compliance state would be overwritten with an unrelated account's data (C1).
// ---------------------------------------------------------------------------

// A minimal recording ComplianceProvider that advances any swept row to
// 'approved' and records every (provider id, tenant) it was asked to sync — so
// the per-row provider routing can be asserted without any network/SDK.
function recordingProvider(id: ComplianceProviderId, seen: string[]): ComplianceProvider {
    return {
        id,
        provision: async () => ({ complianceStatus: 'approved', rejectionReason: null }),
        verifyWebhookSignature: async () => true,
        parseCallback: () => null,
        webhookUrl: () => '',
        async syncStatus({ tenantId }: { tenantId: string }, store: ComplianceStateStore) {
            seen.push(`${id}:${tenantId}`);
            await store.persist(tenantId, { complianceStatus: 'approved' });
            return { complianceStatus: 'approved', rejectionReason: null };
        },
    };
}

describe('sweepManagedStatuses — excludes own-mode tenants (C1)', () => {
    it('does not touch an own-mode row while sweeping managed rows', async () => {
        const fx = createTestDb(); await setupSchema(fx.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(fx.db);
        const now = new Date();
        // own-mode tenant: BYO Twilio, non-terminal, tfvStatus set (TFV poll path).
        await fx.db.insert(schema.messagingCompliance).values({
            tenantId: 'own-1', mode: 'own', provider: 'twilio', complianceStatus: 'tfv_pending',
            tfvStatus: 'PENDING_REVIEW', createdAt: now, updatedAt: now,
        } as never);
        // managed_dedicated tenant: should be swept and advanced.
        await fx.db.insert(schema.messagingCompliance).values({
            tenantId: 'mgd-1', mode: 'managed_dedicated', provider: 'twilio', complianceStatus: 'tfv_pending',
            tfvStatus: 'PENDING_REVIEW', createdAt: now, updatedAt: now,
        } as never);

        // Fake ISV provider via the injectable providerFactory: every TFV poll
        // returns approved. If the own row were (incorrectly) included, it would
        // flip to approved too.
        const isvProvider = fakeProvider([], { tfvs: [{ sid: 'HV_ISV', status: 'TWILIO_APPROVED' }] });
        const svc = new MessagingComplianceService({} as D1Database);
        await svc.sweepManagedStatuses(
            { TWILIO_ACCOUNT_SID: 'AC_ISV', TWILIO_API_KEY_SID: 'SK_ISV', TWILIO_API_KEY_SECRET: 'secret' },
            undefined,
            () => isvProvider,
        );

        const own = await fx.db.select().from(schema.messagingCompliance)
            .where(eq(schema.messagingCompliance.tenantId, 'own-1')).get();
        const mgd = await fx.db.select().from(schema.messagingCompliance)
            .where(eq(schema.messagingCompliance.tenantId, 'mgd-1')).get();
        expect(own?.complianceStatus).toBe('tfv_pending'); // untouched — excluded by mode filter
        expect(mgd?.complianceStatus).toBe('approved');     // swept and advanced
        fx.sqlite.close();
    });

    it('builds the provider PER ROW by row.provider (mixed twilio + telnyx fleet)', async () => {
        const fx = createTestDb(); await setupSchema(fx.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(fx.db);
        const now = new Date();
        // One managed row per carrier — both non-terminal.
        await fx.db.insert(schema.messagingCompliance).values({
            tenantId: 'tw-1', mode: 'managed_dedicated', provider: 'twilio',
            complianceStatus: 'campaign_pending', createdAt: now, updatedAt: now,
        } as never);
        await fx.db.insert(schema.messagingCompliance).values({
            tenantId: 'tx-1', mode: 'managed_dedicated', provider: 'telnyx',
            complianceStatus: 'campaign_pending', createdAt: now, updatedAt: now,
        } as never);

        const seen: string[] = [];
        const builtFor: ComplianceProviderId[] = [];
        const svc = new MessagingComplianceService({} as D1Database);
        await svc.sweepManagedStatuses(
            { TWILIO_ACCOUNT_SID: 'AC', TWILIO_API_KEY_SID: 'SK', TWILIO_API_KEY_SECRET: 's', TELNYX_API_KEY: 'KEY' },
            undefined,
            (id) => { builtFor.push(id); return recordingProvider(id, seen); },
        );

        // Each row was synced with a provider matching its own carrier.
        expect(seen.sort()).toEqual(['telnyx:tx-1', 'twilio:tw-1']);
        // The factory was invoked once per distinct provider id (memoized).
        expect(builtFor.sort()).toEqual(['telnyx', 'twilio']);

        const tw = await fx.db.select().from(schema.messagingCompliance)
            .where(eq(schema.messagingCompliance.tenantId, 'tw-1')).get();
        const tx = await fx.db.select().from(schema.messagingCompliance)
            .where(eq(schema.messagingCompliance.tenantId, 'tx-1')).get();
        expect(tw?.complianceStatus).toBe('approved');
        expect(tx?.complianceStatus).toBe('approved');
        fx.sqlite.close();
    });
});
