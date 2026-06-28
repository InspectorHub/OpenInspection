import { describe, it, expect, vi } from 'vitest';
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import { D1ComplianceStateStore } from '../../server/lib/messaging/compliance-state-store';
import {
    TwilioComplianceProvider,
    type TwilioComplianceClient,
} from '../../server/lib/messaging/providers/twilio-compliance';
import { signParams } from '../../server/lib/messaging/twilio';

// ---------------------------------------------------------------------------
// Fake twilio-node-shaped client. Mirrors ONLY the resource methods the
// provider actually calls (pinned against node_modules/twilio/lib/rest):
//   - generic .request()                          → CustomerProfiles / Usa2p / Tollfree Verifications
//   - messaging.v1.brandRegistrations.create/list → /v1/a2p/BrandRegistrations
//   - messaging.v1.services.create                → /v1/Services
//   - messaging.v1.services(sid).phoneNumbers.create → /v1/Services/{sid}/PhoneNumbers
//   - messaging.v1.tollfreeVerifications.list     → /v1/Tollfree/Verifications
//   - availablePhoneNumbers('US').local|tollFree.list → AvailablePhoneNumbers/US/...
//   - incomingPhoneNumbers.create                 → IncomingPhoneNumbers.json
// Each call records a tag into `calls` for assertions.
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
    capturedCampaign?: { data?: Record<string, string> };
    capturedTollfree?: { data?: Record<string, string> };
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
                if (opts.capturedCampaign) opts.capturedCampaign.data = data;
                if (opts.campThrows) throw new Error('TCR error');
                return { statusCode: 201, body: { sid: 'CMx', status: 'PENDING' } };
            }
            if (uri.includes('/Tollfree/Verifications')) {
                calls.push('tfv');
                if (opts.capturedTollfree) opts.capturedTollfree.data = data;
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
            tollFree: { list: async () => { calls.push('search-tf'); return [{ phoneNumber: '+18005550000' }]; } },
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

const INFO = { legalName: 'Acme Inspections', address: '1 Main, TX', repName: 'Bob' };

async function freshDb() {
    const fx = createTestDb();
    await setupSchema(fx.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(fx.db);
    return fx;
}

async function seedRow(fx: Awaited<ReturnType<typeof freshDb>>, tenantId: string, patch: Record<string, unknown>) {
    const now = new Date();
    await fx.db.insert(schema.messagingCompliance).values({
        tenantId, provider: 'twilio', mode: 'managed_dedicated',
        complianceStatus: 'not_started', createdAt: now, updatedAt: now, ...patch,
    } as never);
}

function readRow(fx: Awaited<ReturnType<typeof freshDb>>, tenantId: string) {
    return fx.db.select().from(schema.messagingCompliance)
        .where(eq(schema.messagingCompliance.tenantId, tenantId)).get();
}

describe('TwilioComplianceProvider.provision (sp10dlc)', () => {
    it('full run persists all SIDs and ends campaign_pending', async () => {
        const fx = await freshDb();
        const calls: string[] = [];
        const capturedCampaign: { data?: Record<string, string> } = {};
        const provider = new TwilioComplianceProvider(fakeTwilio(calls, { capturedCampaign }));
        const store = new D1ComplianceStateStore({} as D1Database);
        const snap = await provider.provision(
            { tenantId: 'p1', channel: 'sp10dlc', businessInfo: INFO }, store,
        );
        expect(snap.complianceStatus).toBe('campaign_pending');
        const row = await readRow(fx, 'p1');
        expect(row?.customerProfileSid).toBe('BUx');
        expect(row?.brandSid).toBe('BNx');
        expect(row?.messagingResourceSid).toBe('MGx');
        expect(row?.campaignSid).toBe('CMx');
        expect(row?.provisionedNumber).toBe('+15551110000');
        expect(row?.provisionedNumberSid).toBe('PNx');
        expect(row?.senderAttached).toBe(true);
        expect(row?.complianceStatus).toBe('campaign_pending');
        expect(calls).toEqual(expect.arrayContaining(['cp', 'brand', 'ms', 'camp', 'buy', 'attach']));
        // Lock the Usa2p generic-post wire params (no type-check guards the
        // generic request body, so a param-name/casing regression would silently
        // drop a field at the carrier). The indexed MessageSamples[] keys are the
        // serialization-sensitive ones; BrandRegistrationSid carries the brand SID.
        const camp = capturedCampaign.data ?? {};
        expect(camp.BrandRegistrationSid).toBe('BNx');
        expect(camp.UsAppToPersonUsecase).toBe('MIXED');
        expect(camp['MessageSamples[0]']).toBeTruthy();
        expect(camp['MessageSamples[1]']).toBeTruthy();
        fx.sqlite.close();
    });

    it('resume: second call recreates nothing (no re-buy, no re-attach)', async () => {
        const fx = await freshDb();
        const calls: string[] = [];
        const provider = new TwilioComplianceProvider(fakeTwilio(calls));
        const store = new D1ComplianceStateStore({} as D1Database);
        await provider.provision({ tenantId: 'p2', channel: 'sp10dlc', businessInfo: INFO }, store);
        calls.length = 0;
        await provider.provision({ tenantId: 'p2', channel: 'sp10dlc', businessInfo: INFO }, store);
        expect(calls).toEqual([]); // every step guarded by its persisted SID
        fx.sqlite.close();
    });

    it('threads statusCallbackUrl onto the customer-profile create', async () => {
        const fx = await freshDb();
        const captured: { data?: Record<string, string> } = {};
        const provider = new TwilioComplianceProvider(fakeTwilio([], { capturedProfile: captured }));
        const store = new D1ComplianceStateStore({} as D1Database);
        const url = 'https://app.example.test/api/public/twilio/compliance-status/acme';
        await provider.provision(
            { tenantId: 'cb1', channel: 'sp10dlc', businessInfo: INFO, statusCallbackUrl: url }, store,
        );
        expect(captured.data?.StatusCallbackUrl).toBe(url);
        expect(captured.data?.IsvRegisteringForSelfOrSubaccounts).toBe('false');
        fx.sqlite.close();
    });

    it('omits statusCallbackUrl when not provided', async () => {
        const fx = await freshDb();
        const captured: { data?: Record<string, string> } = {};
        const provider = new TwilioComplianceProvider(fakeTwilio([], { capturedProfile: captured }));
        const store = new D1ComplianceStateStore({} as D1Database);
        await provider.provision({ tenantId: 'cb2', channel: 'sp10dlc', businessInfo: INFO }, store);
        expect('StatusCallbackUrl' in (captured.data ?? {})).toBe(false);
        fx.sqlite.close();
    });

    it('mid-chain throw leaves prior SIDs persisted and propagates', async () => {
        const fx = await freshDb();
        const calls: string[] = [];
        const provider = new TwilioComplianceProvider(fakeTwilio(calls, { campThrows: true }));
        const store = new D1ComplianceStateStore({} as D1Database);
        await expect(
            provider.provision({ tenantId: 'p4', channel: 'sp10dlc', businessInfo: INFO }, store),
        ).rejects.toThrow('TCR error');
        const row = await readRow(fx, 'p4');
        expect(row?.customerProfileSid).toBe('BUx');
        expect(row?.brandSid).toBe('BNx');
        expect(row?.messagingResourceSid).toBe('MGx');
        expect(row?.campaignSid).toBeNull();
        expect(row?.complianceStatus).toBe('brand_pending');
        fx.sqlite.close();
    });

    it('attach resume: crash during attach re-attaches without re-buying', async () => {
        const fx = await freshDb();
        let buys = 0; let attaches = 0; let attachThrows = true;
        const store = new D1ComplianceStateStore({} as D1Database);
        const opts: FakeOpts = {
            get attachThrows() { return attachThrows; },
            onBuy: () => { buys++; },
            onAttach: () => { attaches++; },
        };
        const provider1 = new TwilioComplianceProvider(fakeTwilio([], opts));
        await expect(
            provider1.provision({ tenantId: 'pa', channel: 'sp10dlc', businessInfo: INFO }, store),
        ).rejects.toThrow('attach failed');
        const mid = await readRow(fx, 'pa');
        expect(mid?.provisionedNumberSid).toBe('PNx');
        expect(mid?.senderAttached).toBe(false);

        attachThrows = false;
        const provider2 = new TwilioComplianceProvider(fakeTwilio([], opts));
        const snap = await provider2.provision({ tenantId: 'pa', channel: 'sp10dlc', businessInfo: INFO }, store);
        expect(buys).toBe(1);       // bought exactly once
        expect(attaches).toBe(2);   // attach retried (1 fail + 1 success)
        expect(snap.complianceStatus).toBe('campaign_pending');
        expect((await readRow(fx, 'pa'))?.senderAttached).toBe(true);
        fx.sqlite.close();
    });
});

describe('TwilioComplianceProvider.provision (tollfree)', () => {
    it('full run persists tfvSid + messagingServiceSid and ends tfv_pending', async () => {
        const fx = await freshDb();
        const calls: string[] = [];
        const capturedTollfree: { data?: Record<string, string> } = {};
        const provider = new TwilioComplianceProvider(fakeTwilio(calls, { capturedTollfree }));
        const store = new D1ComplianceStateStore({} as D1Database);
        const snap = await provider.provision(
            { tenantId: 'p3', channel: 'tollfree', businessInfo: { ...INFO, email: 'a@b.test' } }, store,
        );
        expect(snap.complianceStatus).toBe('tfv_pending');
        const row = await readRow(fx, 'p3');
        expect(row?.tfvSid).toBe('HVx');
        expect(row?.messagingResourceSid).toBe('MGx');
        expect(row?.provisionedNumber).toBe('+18005550000');
        expect(row?.complianceStatus).toBe('tfv_pending');
        // sp10dlc-only steps must NOT run on the tollfree path.
        expect(calls).not.toContain('brand');
        expect(calls).not.toContain('camp');
        expect(calls).toEqual(expect.arrayContaining(['cp', 'ms', 'search-tf', 'buy', 'attach', 'tfv']));
        // Lock the Tollfree Verifications generic-post wire params (ISV shape:
        // UseCaseDescription + MessagingServiceSid; no type-check guards the body).
        const tfv = capturedTollfree.data ?? {};
        expect(tfv.TollfreePhoneNumberSid).toBe('PNx');
        expect(tfv.MessagingServiceSid).toBe('MGx');
        expect(tfv.UseCaseDescription).toBeTruthy();
        expect(tfv.OptInType).toBe('VERBAL');
        fx.sqlite.close();
    });

    it('crash-resume: numbers.buy runs once even if tfv.create crashed after buy', async () => {
        const fx = await freshDb();
        let buys = 0;
        const store = new D1ComplianceStateStore({} as D1Database);
        const crash = new TwilioComplianceProvider(fakeTwilio([], { tfvThrows: true, onBuy: () => { buys++; } }));
        await expect(
            crash.provision({ tenantId: 'p5', channel: 'tollfree', businessInfo: INFO }, store),
        ).rejects.toThrow('crash');
        const mid = await readRow(fx, 'p5');
        expect(mid?.provisionedNumberSid).toBe('PNx');

        const resume = new TwilioComplianceProvider(fakeTwilio([], { onBuy: () => { buys++; } }));
        const snap = await resume.provision({ tenantId: 'p5', channel: 'tollfree', businessInfo: INFO }, store);
        expect(buys).toBe(1);
        expect(snap.complianceStatus).toBe('tfv_pending');
        expect((await readRow(fx, 'p5'))?.tfvSid).toBe('HVx');
        fx.sqlite.close();
    });
});

describe('TwilioComplianceProvider.syncStatus', () => {
    it('TFV poll advances tfv_pending → approved', async () => {
        const fx = await freshDb();
        await seedRow(fx, 't-sc-1', { complianceStatus: 'tfv_pending', tfvSid: 'HV1', tfvStatus: 'PENDING_REVIEW' });
        const provider = new TwilioComplianceProvider(
            fakeTwilio([], { tfvs: [{ sid: 'HV1', status: 'TWILIO_APPROVED' }] }),
        );
        const store = new D1ComplianceStateStore({} as D1Database);
        const snap = await provider.syncStatus({ tenantId: 't-sc-1' }, store);
        expect(snap.complianceStatus).toBe('approved');
        expect(snap.rejectionReason).toBeNull();
        fx.sqlite.close();
    });

    it('TFV poll maps rejection + stores reason', async () => {
        const fx = await freshDb();
        await seedRow(fx, 't-sc-r', { complianceStatus: 'tfv_pending', tfvSid: 'HV2', tfvStatus: 'PENDING_REVIEW' });
        const provider = new TwilioComplianceProvider(
            fakeTwilio([], { tfvs: [{ sid: 'HV2', status: 'TWILIO_REJECTED' }] }),
        );
        const store = new D1ComplianceStateStore({} as D1Database);
        const snap = await provider.syncStatus({ tenantId: 't-sc-r' }, store);
        expect(snap.complianceStatus).toBe('rejected');
        expect(snap.rejectionReason).toBe('TWILIO_REJECTED');
        fx.sqlite.close();
    });

    it('brand poll does NOT regress campaign_pending', async () => {
        const fx = await freshDb();
        await seedRow(fx, 't-reg', { complianceStatus: 'campaign_pending', brandSid: 'BN_X', brandStatus: 'PENDING' });
        const provider = new TwilioComplianceProvider(
            fakeTwilio([], { brands: [{ sid: 'BN_X', status: 'TWILIO_APPROVED' }] }),
        );
        const store = new D1ComplianceStateStore({} as D1Database);
        const snap = await provider.syncStatus({ tenantId: 't-reg' }, store);
        expect(snap.complianceStatus).toBe('campaign_pending');
        fx.sqlite.close();
    });

    it('brand poll advances brand_pending on first approval', async () => {
        const fx = await freshDb();
        await seedRow(fx, 't-b1', { complianceStatus: 'profile_pending', brandSid: 'BN_F', brandStatus: 'PENDING' });
        const provider = new TwilioComplianceProvider(
            fakeTwilio([], { brands: [{ sid: 'BN_F', status: 'TWILIO_APPROVED' }] }),
        );
        const store = new D1ComplianceStateStore({} as D1Database);
        const snap = await provider.syncStatus({ tenantId: 't-b1' }, store);
        expect(snap.complianceStatus).toBe('brand_pending');
        fx.sqlite.close();
    });

    it('returns not_started sentinel when no row exists', async () => {
        const fx = await freshDb();
        const provider = new TwilioComplianceProvider(fakeTwilio([]));
        const store = new D1ComplianceStateStore({} as D1Database);
        const snap = await provider.syncStatus({ tenantId: 'no-row' }, store);
        expect(snap.complianceStatus).toBe('not_started');
        fx.sqlite.close();
    });
});

describe('TwilioComplianceProvider.verifyWebhookSignature', () => {
    const SECRET = 'compliance-token';
    const URL = 'https://app.example.test/api/public/twilio/compliance-status/acme';

    it('accepts a valid signature', async () => {
        const provider = new TwilioComplianceProvider(fakeTwilio([]));
        const params = { CampaignSid: 'CM1', CampaignStatus: 'TWILIO_APPROVED' };
        const sig = await signParams(SECRET, URL, params);
        const ok = await provider.verifyWebhookSignature({
            url: URL, headers: { 'x-twilio-signature': sig }, rawBody: '', params, secret: SECRET,
        });
        expect(ok).toBe(true);
    });

    it('rejects a tampered signature', async () => {
        const provider = new TwilioComplianceProvider(fakeTwilio([]));
        const params = { CampaignSid: 'CM1', CampaignStatus: 'TWILIO_APPROVED' };
        const sig = await signParams(SECRET, URL, params);
        const ok = await provider.verifyWebhookSignature({
            url: URL, headers: { 'x-twilio-signature': `${sig}tamper` }, rawBody: '', params, secret: SECRET,
        });
        expect(ok).toBe(false);
    });

    it('rejects when signature header missing', async () => {
        const provider = new TwilioComplianceProvider(fakeTwilio([]));
        const params = { BrandSid: 'BN1', BrandStatus: 'PENDING' };
        const ok = await provider.verifyWebhookSignature({
            url: URL, headers: {}, rawBody: '', params, secret: SECRET,
        });
        expect(ok).toBe(false);
    });
});

describe('TwilioComplianceProvider.parseCallback', () => {
    const provider = new TwilioComplianceProvider(fakeTwilio([]));

    it('parses a brand callback', () => {
        const ev = provider.parseCallback({}, 'BrandSid=BN1&BrandStatus=TWILIO_APPROVED');
        expect(ev).toEqual({ entity: 'brand', rawStatus: 'TWILIO_APPROVED', rejectionReason: null, entitySid: 'BN1' });
    });

    it('parses a campaign callback with rejection reason', () => {
        const ev = provider.parseCallback({}, 'CampaignSid=CM1&CampaignStatus=REJECTED&ErrorCode=30034&ErrorMessage=Use+case+not+approved');
        expect(ev).toEqual({
            entity: 'campaign', rawStatus: 'REJECTED',
            rejectionReason: 'code=30034: Use case not approved', entitySid: 'CM1',
        });
    });

    it('parses a tfv callback (VerificationStatus)', () => {
        const ev = provider.parseCallback({}, 'TollfreePhoneNumberSid=PN1&VerificationStatus=TWILIO_APPROVED');
        expect(ev).toEqual({ entity: 'tfv', rawStatus: 'TWILIO_APPROVED', rejectionReason: null, entitySid: 'PN1' });
    });

    it('returns null for an unrecognized payload', () => {
        expect(provider.parseCallback({}, 'Foo=bar')).toBeNull();
    });
});

describe('TwilioComplianceProvider.webhookUrl', () => {
    it('builds the twilio-prefixed compliance-status URL', () => {
        const provider = new TwilioComplianceProvider(fakeTwilio([]));
        expect(provider.webhookUrl('https://app.example.test', 'acme'))
            .toBe('https://app.example.test/api/public/twilio/compliance-status/acme');
    });

    it('exposes id = twilio', () => {
        const provider = new TwilioComplianceProvider(fakeTwilio([]));
        expect(provider.id).toBe('twilio');
    });
});
