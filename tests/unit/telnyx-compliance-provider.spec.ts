import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import { D1ComplianceStateStore } from '../../server/lib/messaging/compliance-state-store';
import {
    TelnyxComplianceProvider,
    type TelnyxComplianceClient,
} from '../../server/lib/messaging/providers/telnyx-compliance';

// ---------------------------------------------------------------------------
// Fake telnyx-SDK-shaped client. Mirrors ONLY the resource methods the provider
// actually calls (pinned against node_modules/telnyx/resources):
//   - messaging10dlc.brand.create                  → POST /10dlc/brand        → TelnyxBrand
//   - messaging10dlc.brand.externalVetting.order   → POST /10dlc/brand/{id}/externalVetting
//   - messaging10dlc.campaignBuilder.submit        → POST /10dlc/campaignBuilder → TelnyxCampaignCsp
//   - messagingProfiles.create                     → POST /messaging_profiles
//   - availablePhoneNumbers.list                   → GET  /available_phone_numbers
//   - numberOrders.create                          → POST /number_orders
//   - messaging10dlc.phoneNumberCampaigns.create   → POST /10dlc/phoneNumberCampaigns
// Each call records a tag into `calls` for assertions.
// ---------------------------------------------------------------------------

interface FakeOpts {
    campThrows?: boolean;
    assignThrows?: boolean;
    onBuy?: () => void;
    onAssign?: () => void;
    capturedBrand?: { body?: Record<string, unknown> };
    capturedCampaign?: { body?: Record<string, unknown> };
    capturedAssign?: { body?: Record<string, unknown> };
    capturedTfv?: { body?: Record<string, unknown> };
}

function fakeTelnyx(calls: string[], opts: FakeOpts = {}): TelnyxComplianceClient {
    const client = {
        messaging10dlc: {
            brand: {
                create: async (body: Record<string, unknown>) => {
                    calls.push('brand');
                    if (opts.capturedBrand) opts.capturedBrand.body = body;
                    return { brandId: 'BR1', identityStatus: 'UNVERIFIED' };
                },
                externalVetting: {
                    order: async () => {
                        calls.push('vetting');
                        return { vettingId: 'VET1', evpId: 'AEGIS', vettingClass: 'STANDARD' };
                    },
                },
            },
            campaignBuilder: {
                submit: async (body: Record<string, unknown>) => {
                    calls.push('campaign');
                    if (opts.capturedCampaign) opts.capturedCampaign.body = body;
                    if (opts.campThrows) throw new Error('TCR campaign error');
                    return { campaignId: 'CAMP1', campaignStatus: 'TCR_PENDING' };
                },
            },
            phoneNumberCampaigns: {
                create: async (body: { campaignId: string; phoneNumber: string }) => {
                    calls.push('assign');
                    if (opts.capturedAssign) opts.capturedAssign.body = body;
                    opts.onAssign?.();
                    if (opts.assignThrows) throw new Error('assign failed');
                    return { phoneNumber: body.phoneNumber, assignmentStatus: 'PENDING_ASSIGNMENT' };
                },
            },
        },
        messagingProfiles: {
            create: async () => { calls.push('msgProfile'); return { data: { id: 'MP1' } }; },
        },
        availablePhoneNumbers: {
            list: async () => { calls.push('search'); return { data: [{ phone_number: '+15551110000' }] }; },
        },
        numberOrders: {
            create: async () => {
                calls.push('buy');
                opts.onBuy?.();
                return { data: { id: 'ORD1', phone_numbers: [{ id: 'PNUM1', phone_number: '+15551110000' }] } };
            },
        },
        messagingTollfree: {
            verification: {
                requests: {
                    create: async (body: Record<string, unknown>) => {
                        calls.push('tfvCreate');
                        if (opts.capturedTfv) opts.capturedTfv.body = body;
                        // Mirror the REAL VerificationRequestEgress shape (flat, not wrapped in .data).
                        // Both id and verificationRequestId are required on the real response; the
                        // provider persists `id` as the tfvSid (the key requests.retrieve(id) uses).
                        return {
                            id: 'TFV_DB_ID',
                            verificationRequestId: 'TFV_REQ1',
                            verificationStatus: 'In Progress',
                        };
                    },
                },
            },
        },
    };
    return client as unknown as TelnyxComplianceClient;
}

const INFO = { legalName: 'Acme Inspections', address: '1 Main, Austin, TX', repName: 'Bob', email: 'a@b.test' };

async function freshDb() {
    const fx = createTestDb();
    await setupSchema(fx.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(fx.db);
    return fx;
}

function readRow(fx: Awaited<ReturnType<typeof freshDb>>, tenantId: string) {
    return fx.db.select().from(schema.messagingCompliance)
        .where(eq(schema.messagingCompliance.tenantId, tenantId)).get();
}

describe('TelnyxComplianceProvider.provision (sp10dlc)', () => {
    it('full run persists all entity IDs and ends campaign_pending', async () => {
        const fx = await freshDb();
        const calls: string[] = [];
        const provider = new TelnyxComplianceProvider(fakeTelnyx(calls));
        const store = new D1ComplianceStateStore({} as D1Database);
        const snap = await provider.provision(
            { tenantId: 'p1', channel: 'sp10dlc', businessInfo: INFO }, store,
        );
        expect(snap.complianceStatus).toBe('campaign_pending');
        const row = await readRow(fx, 'p1');
        expect(row?.brandSid).toBe('BR1');
        expect(row?.campaignSid).toBe('CAMP1');
        expect(row?.messagingResourceSid).toBe('MP1');
        expect(row?.provisionedNumber).toBe('+15551110000');
        expect(row?.provisionedNumberSid).toBe('PNUM1');
        expect(row?.senderAttached).toBe(true);
        expect(row?.complianceStatus).toBe('campaign_pending');
        // Vetting id lands in providerMeta (no Twilio-shaped SID column for it).
        expect(JSON.parse(row?.providerMeta ?? '{}').vettingId).toBe('VET1');
        // No Trust Hub profile step — first persisted status is brand_pending.
        expect(row?.customerProfileSid).toBeNull();
        expect(calls).toEqual(
            expect.arrayContaining(['brand', 'vetting', 'campaign', 'msgProfile', 'buy', 'assign']),
        );
        fx.sqlite.close();
    });

    it('resume: second call recreates nothing (no re-buy, no re-assign)', async () => {
        const fx = await freshDb();
        const calls: string[] = [];
        const provider = new TelnyxComplianceProvider(fakeTelnyx(calls));
        const store = new D1ComplianceStateStore({} as D1Database);
        await provider.provision({ tenantId: 'p2', channel: 'sp10dlc', businessInfo: INFO }, store);
        calls.length = 0;
        await provider.provision({ tenantId: 'p2', channel: 'sp10dlc', businessInfo: INFO }, store);
        expect(calls).toEqual([]); // every step guarded by its persisted id
        fx.sqlite.close();
    });

    it('threads statusCallbackUrl onto the brand create as webhookURL', async () => {
        const fx = await freshDb();
        const capturedBrand: { body?: Record<string, unknown> } = {};
        const provider = new TelnyxComplianceProvider(fakeTelnyx([], { capturedBrand }));
        const store = new D1ComplianceStateStore({} as D1Database);
        const url = 'https://app.example.test/api/public/telnyx/compliance-status/acme';
        await provider.provision(
            { tenantId: 'cb1', channel: 'sp10dlc', businessInfo: INFO, statusCallbackUrl: url }, store,
        );
        expect(capturedBrand.body?.webhookURL).toBe(url);
        expect(capturedBrand.body?.country).toBe('US');
        expect(capturedBrand.body?.entityType).toBe('PRIVATE_PROFIT');
        fx.sqlite.close();
    });

    it('omits webhookURL on brand create when statusCallbackUrl not provided', async () => {
        const fx = await freshDb();
        const capturedBrand: { body?: Record<string, unknown> } = {};
        const provider = new TelnyxComplianceProvider(fakeTelnyx([], { capturedBrand }));
        const store = new D1ComplianceStateStore({} as D1Database);
        await provider.provision({ tenantId: 'cb2', channel: 'sp10dlc', businessInfo: INFO }, store);
        expect('webhookURL' in (capturedBrand.body ?? {})).toBe(false);
        fx.sqlite.close();
    });

    it('locks the campaign-submit usecase + brandId wire params', async () => {
        const fx = await freshDb();
        const capturedCampaign: { body?: Record<string, unknown> } = {};
        const provider = new TelnyxComplianceProvider(fakeTelnyx([], { capturedCampaign }));
        const store = new D1ComplianceStateStore({} as D1Database);
        await provider.provision({ tenantId: 'cw', channel: 'sp10dlc', businessInfo: INFO }, store);
        expect(capturedCampaign.body?.usecase).toBe('AGENTS_FRANCHISES');
        expect(capturedCampaign.body?.brandId).toBe('BR1');
        fx.sqlite.close();
    });

    it('mid-chain throw leaves prior ids persisted and propagates', async () => {
        const fx = await freshDb();
        const calls: string[] = [];
        const provider = new TelnyxComplianceProvider(fakeTelnyx(calls, { campThrows: true }));
        const store = new D1ComplianceStateStore({} as D1Database);
        await expect(
            provider.provision({ tenantId: 'p4', channel: 'sp10dlc', businessInfo: INFO }, store),
        ).rejects.toThrow('TCR campaign error');
        const row = await readRow(fx, 'p4');
        expect(row?.brandSid).toBe('BR1');
        expect(JSON.parse(row?.providerMeta ?? '{}').vettingId).toBe('VET1');
        expect(row?.campaignSid).toBeNull();
        expect(row?.complianceStatus).toBe('brand_pending');
        fx.sqlite.close();
    });

    it('assign resume: crash during assign re-assigns without re-buying', async () => {
        const fx = await freshDb();
        let buys = 0; let assigns = 0; let assignThrows = true;
        const store = new D1ComplianceStateStore({} as D1Database);
        const opts: FakeOpts = {
            get assignThrows() { return assignThrows; },
            onBuy: () => { buys++; },
            onAssign: () => { assigns++; },
        };
        const provider1 = new TelnyxComplianceProvider(fakeTelnyx([], opts));
        await expect(
            provider1.provision({ tenantId: 'pa', channel: 'sp10dlc', businessInfo: INFO }, store),
        ).rejects.toThrow('assign failed');
        const mid = await readRow(fx, 'pa');
        expect(mid?.provisionedNumberSid).toBe('PNUM1');
        expect(mid?.senderAttached).toBe(false);

        assignThrows = false;
        const provider2 = new TelnyxComplianceProvider(fakeTelnyx([], opts));
        const snap = await provider2.provision({ tenantId: 'pa', channel: 'sp10dlc', businessInfo: INFO }, store);
        expect(buys).toBe(1);       // bought exactly once
        expect(assigns).toBe(2);    // assign retried (1 fail + 1 success)
        expect(snap.complianceStatus).toBe('campaign_pending');
        expect((await readRow(fx, 'pa'))?.senderAttached).toBe(true);
        fx.sqlite.close();
    });
});

describe('TelnyxComplianceProvider.provision (tollfree)', () => {
    it('full tollfree run persists messagingResourceSid + provisionedNumber + tfvSid and ends tfv_pending', async () => {
        const fx = await freshDb();
        const calls: string[] = [];
        const provider = new TelnyxComplianceProvider(fakeTelnyx(calls));
        const store = new D1ComplianceStateStore({} as D1Database);
        const snap = await provider.provision(
            { tenantId: 'tf1', channel: 'tollfree', businessInfo: INFO }, store,
        );
        expect(snap.complianceStatus).toBe('tfv_pending');
        const row = await readRow(fx, 'tf1');
        expect(row?.messagingResourceSid).toBe('MP1');
        expect(row?.provisionedNumber).toBe('+15551110000');
        expect(row?.provisionedNumberSid).toBe('PNUM1');
        // tfvSid stores the create response's `id` — the key requests.retrieve(id)
        // consumes and the only id present on the VerificationRequestStatus shape.
        expect(row?.tfvSid).toBe('TFV_DB_ID');
        expect(row?.complianceStatus).toBe('tfv_pending');
        // 10DLC-only steps must NOT run on the tollfree path.
        expect(calls).not.toContain('brand');
        expect(calls).not.toContain('vetting');
        expect(calls).not.toContain('campaign');
        expect(calls).not.toContain('assign');
        // Tollfree path steps MUST run.
        expect(calls).toContain('msgProfile');
        expect(calls).toContain('search');
        expect(calls).toContain('buy');
        expect(calls).toContain('tfvCreate');
        fx.sqlite.close();
    });

    it('resume: second tollfree call recreates nothing (all steps guarded by persisted ids)', async () => {
        const fx = await freshDb();
        const calls: string[] = [];
        const provider = new TelnyxComplianceProvider(fakeTelnyx(calls));
        const store = new D1ComplianceStateStore({} as D1Database);
        await provider.provision({ tenantId: 'tf2', channel: 'tollfree', businessInfo: INFO }, store);
        calls.length = 0;
        await provider.provision({ tenantId: 'tf2', channel: 'tollfree', businessInfo: INFO }, store);
        expect(calls).toEqual([]);
        fx.sqlite.close();
    });

    it('threads statusCallbackUrl as webhookUrl on TFV submission', async () => {
        const fx = await freshDb();
        const capturedTfv: { body?: Record<string, unknown> } = {};
        const provider = new TelnyxComplianceProvider(fakeTelnyx([], { capturedTfv }));
        const store = new D1ComplianceStateStore({} as D1Database);
        const url = 'https://app.example.test/api/public/telnyx/compliance-status/acme';
        await provider.provision(
            { tenantId: 'tf3', channel: 'tollfree', businessInfo: INFO, statusCallbackUrl: url }, store,
        );
        expect(capturedTfv.body?.webhookUrl).toBe(url);
        fx.sqlite.close();
    });

    it('omits webhookUrl from TFV body when statusCallbackUrl not provided', async () => {
        const fx = await freshDb();
        const capturedTfv: { body?: Record<string, unknown> } = {};
        const provider = new TelnyxComplianceProvider(fakeTelnyx([], { capturedTfv }));
        const store = new D1ComplianceStateStore({} as D1Database);
        await provider.provision({ tenantId: 'tf4', channel: 'tollfree', businessInfo: INFO }, store);
        expect('webhookUrl' in (capturedTfv.body ?? {})).toBe(false);
        fx.sqlite.close();
    });

    it('TFV body wires businessName, phoneNumbers, and useCase correctly', async () => {
        const fx = await freshDb();
        const capturedTfv: { body?: Record<string, unknown> } = {};
        const provider = new TelnyxComplianceProvider(fakeTelnyx([], { capturedTfv }));
        const store = new D1ComplianceStateStore({} as D1Database);
        await provider.provision({ tenantId: 'tf5', channel: 'tollfree', businessInfo: INFO }, store);
        expect(capturedTfv.body?.businessName).toBe('Acme Inspections');
        expect(capturedTfv.body?.useCase).toBe('Real Estate Services');
        // phoneNumbers carries the bought toll-free E.164
        expect(capturedTfv.body?.phoneNumbers).toEqual([{ phoneNumber: '+15551110000' }]);
        fx.sqlite.close();
    });
});

// ---------------------------------------------------------------------------
// Ed25519 keypair helper (mirrors tests/unit/messaging/validate-inbound.spec.ts):
// generate a keypair, expose the base64 public key + a signer over `${ts}|${body}`.
// ---------------------------------------------------------------------------
function bytesToBase64(bytes: Uint8Array): string {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
}
async function makeKeypair() {
    const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    const publicKeyB64 = bytesToBase64(rawPub);
    const sign = async (ts: string, rawBody: string): Promise<string> => {
        const data = new TextEncoder().encode(`${ts}|${rawBody}`);
        const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, data));
        return bytesToBase64(sig);
    };
    return { publicKeyB64, sign };
}

function fixture(name: string): string {
    return readFileSync(fileURLToPath(new URL(`../fixtures/telnyx/${name}`, import.meta.url)), 'utf8');
}

describe('TelnyxComplianceProvider.verifyWebhookSignature (Ed25519)', () => {
    const body = '{"data":{"event_type":"brand.status.updated","payload":{}}}';

    it('accepts a correctly-signed body against the matching public key', async () => {
        const { publicKeyB64, sign } = await makeKeypair();
        const ts = String(Math.floor(Date.now() / 1000));
        const sig = await sign(ts, body);
        const provider = new TelnyxComplianceProvider(fakeTelnyx([]));
        const ok = await provider.verifyWebhookSignature({
            url: 'u', params: {}, rawBody: body, secret: publicKeyB64,
            headers: { 'telnyx-timestamp': ts, 'telnyx-signature-ed25519': sig },
            nowMs: Number(ts) * 1000,
        });
        expect(ok).toBe(true);
    });

    it('fails closed on a tampered signature', async () => {
        const { publicKeyB64, sign } = await makeKeypair();
        const ts = String(Math.floor(Date.now() / 1000));
        await sign(ts, body);
        const provider = new TelnyxComplianceProvider(fakeTelnyx([]));
        const ok = await provider.verifyWebhookSignature({
            url: 'u', params: {}, rawBody: body, secret: publicKeyB64,
            headers: { 'telnyx-timestamp': ts, 'telnyx-signature-ed25519': 'AAAA' },
            nowMs: Number(ts) * 1000,
        });
        expect(ok).toBe(false);
    });

    it('fails closed when the signature header is missing', async () => {
        const { publicKeyB64, sign } = await makeKeypair();
        const ts = String(Math.floor(Date.now() / 1000));
        await sign(ts, body);
        const provider = new TelnyxComplianceProvider(fakeTelnyx([]));
        const ok = await provider.verifyWebhookSignature({
            url: 'u', params: {}, rawBody: body, secret: publicKeyB64,
            headers: { 'telnyx-timestamp': ts }, // no telnyx-signature-ed25519
            nowMs: Number(ts) * 1000,
        });
        expect(ok).toBe(false);
    });

    it('fails closed when the timestamp header is missing', async () => {
        const { publicKeyB64, sign } = await makeKeypair();
        const ts = String(Math.floor(Date.now() / 1000));
        const sig = await sign(ts, body);
        const provider = new TelnyxComplianceProvider(fakeTelnyx([]));
        const ok = await provider.verifyWebhookSignature({
            url: 'u', params: {}, rawBody: body, secret: publicKeyB64,
            headers: { 'telnyx-signature-ed25519': sig }, // no telnyx-timestamp
            nowMs: Number(ts) * 1000,
        });
        expect(ok).toBe(false);
    });
});

describe('TelnyxComplianceProvider.parseCallback', () => {
    const provider = new TelnyxComplianceProvider(fakeTelnyx([]));

    it('parses a brand-verified event', () => {
        expect(provider.parseCallback({}, fixture('brand-verified.json'))).toEqual({
            entity: 'brand',
            rawStatus: 'VERIFIED',
            rejectionReason: null,
            entitySid: 'BR1',
        });
    });

    it('parses a campaign-approved event', () => {
        expect(provider.parseCallback({}, fixture('campaign-approved.json'))).toEqual({
            entity: 'campaign',
            rawStatus: 'MNO_PROVISIONED',
            rejectionReason: null,
            entitySid: 'CAMP1',
        });
    });

    it('parses a tfv-rejected event with its rejection reason', () => {
        expect(provider.parseCallback({}, fixture('tfv-rejected.json'))).toEqual({
            entity: 'tfv',
            rawStatus: 'Rejected',
            rejectionReason: 'Business could not be verified',
            entitySid: 'TFV_DB_ID',
        });
    });

    it('returns null for an unrecognized event type', () => {
        expect(provider.parseCallback({}, fixture('unknown-event.json'))).toBeNull();
    });

    it('returns null for an unparseable body', () => {
        expect(provider.parseCallback({}, 'not json')).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Fake telnyx client exposing ONLY the retrieve methods syncStatus polls.
// ---------------------------------------------------------------------------
interface SyncOpts {
    tfvStatus?: string;
    tfvReason?: string | null;
    campaignStatus?: string;
    campaignFailureReasons?: string | null;
    brandIdentityStatus?: string;
    onTfvRetrieve?: () => void;
    onCampaignRetrieve?: () => void;
    onBrandRetrieve?: () => void;
}
function fakeTelnyxSync(opts: SyncOpts = {}): TelnyxComplianceClient {
    const client = {
        messaging10dlc: {
            brand: {
                retrieve: async (brandID: string) => {
                    opts.onBrandRetrieve?.();
                    return { brandId: brandID, identityStatus: opts.brandIdentityStatus };
                },
            },
            campaign: {
                retrieve: async (campaignID: string) => {
                    opts.onCampaignRetrieve?.();
                    return {
                        campaignId: campaignID,
                        campaignStatus: opts.campaignStatus,
                        failureReasons: opts.campaignFailureReasons ?? null,
                    };
                },
            },
        },
        messagingTollfree: {
            verification: {
                requests: {
                    retrieve: async (id: string) => {
                        opts.onTfvRetrieve?.();
                        return { id, verificationStatus: opts.tfvStatus, reason: opts.tfvReason ?? null };
                    },
                },
            },
        },
    };
    return client as unknown as TelnyxComplianceClient;
}

describe('TelnyxComplianceProvider.syncStatus', () => {
    it('flips a tfv_pending row to approved when TFV retrieve returns Verified', async () => {
        const fx = await freshDb();
        const store = new D1ComplianceStateStore({} as D1Database);
        await store.init('s1', 'telnyx');
        await store.persist('s1', { tfvSid: 'TFV1', tfvStatus: 'In Progress', complianceStatus: 'tfv_pending' });

        const provider = new TelnyxComplianceProvider(fakeTelnyxSync({ tfvStatus: 'Verified' }));
        const snap = await provider.syncStatus({ tenantId: 's1' }, store);
        expect(snap.complianceStatus).toBe('approved');
        expect(snap.rejectionReason).toBeNull();
        const row = await readRow(fx, 's1');
        expect(row?.complianceStatus).toBe('approved');
        expect(row?.tfvStatus).toBe('Verified');
        fx.sqlite.close();
    });

    it('flips a tfv_pending row to rejected with the reason when TFV retrieve returns Rejected', async () => {
        const fx = await freshDb();
        const store = new D1ComplianceStateStore({} as D1Database);
        await store.init('s2', 'telnyx');
        await store.persist('s2', { tfvSid: 'TFV2', complianceStatus: 'tfv_pending' });

        const provider = new TelnyxComplianceProvider(
            fakeTelnyxSync({ tfvStatus: 'Rejected', tfvReason: 'Could not verify business' }),
        );
        const snap = await provider.syncStatus({ tenantId: 's2' }, store);
        expect(snap.complianceStatus).toBe('rejected');
        expect(snap.rejectionReason).toBe('Could not verify business');
        fx.sqlite.close();
    });

    it('advances a campaign_pending row to approved when campaign retrieve is MNO_PROVISIONED', async () => {
        const fx = await freshDb();
        const store = new D1ComplianceStateStore({} as D1Database);
        await store.init('s3', 'telnyx');
        await store.persist('s3', { brandSid: 'BR1', campaignSid: 'CAMP1', complianceStatus: 'campaign_pending' });

        const provider = new TelnyxComplianceProvider(fakeTelnyxSync({ campaignStatus: 'MNO_PROVISIONED' }));
        const snap = await provider.syncStatus({ tenantId: 's3' }, store);
        expect(snap.complianceStatus).toBe('approved');
        fx.sqlite.close();
    });

    it('keeps a campaign_pending row pending when campaign retrieve is still MNO_PENDING', async () => {
        const fx = await freshDb();
        const store = new D1ComplianceStateStore({} as D1Database);
        await store.init('s4', 'telnyx');
        await store.persist('s4', { brandSid: 'BR1', campaignSid: 'CAMP1', complianceStatus: 'campaign_pending' });

        const provider = new TelnyxComplianceProvider(fakeTelnyxSync({ campaignStatus: 'MNO_PENDING' }));
        const snap = await provider.syncStatus({ tenantId: 's4' }, store);
        expect(snap.complianceStatus).toBe('campaign_pending');
        fx.sqlite.close();
    });

    it('no-regress: a brand VERIFIED never rolls back a row already at campaign_pending', async () => {
        const fx = await freshDb();
        const store = new D1ComplianceStateStore({} as D1Database);
        await store.init('s5', 'telnyx');
        // Brand-only row artificially pinned at campaign_pending — the brand branch
        // must NOT regress it to brand_pending.
        await store.persist('s5', { brandSid: 'BR1', complianceStatus: 'campaign_pending' });

        let brandPolled = false;
        const provider = new TelnyxComplianceProvider(
            fakeTelnyxSync({ brandIdentityStatus: 'VERIFIED', onBrandRetrieve: () => { brandPolled = true; } }),
        );
        const snap = await provider.syncStatus({ tenantId: 's5' }, store);
        expect(brandPolled).toBe(true);          // the brand branch did run
        expect(snap.complianceStatus).toBe('campaign_pending'); // and did not regress
        fx.sqlite.close();
    });

    it('returns not_started for a missing row', async () => {
        const fx = await freshDb();
        const store = new D1ComplianceStateStore({} as D1Database);
        const provider = new TelnyxComplianceProvider(fakeTelnyxSync());
        const snap = await provider.syncStatus({ tenantId: 'nope' }, store);
        expect(snap.complianceStatus).toBe('not_started');
        fx.sqlite.close();
    });
});

describe('TelnyxComplianceProvider.webhookUrl / id', () => {
    it('builds the telnyx-prefixed compliance-status URL', () => {
        const provider = new TelnyxComplianceProvider(fakeTelnyx([]));
        expect(provider.webhookUrl('https://app.example.test', 'acme'))
            .toBe('https://app.example.test/api/public/telnyx/compliance-status/acme');
    });

    it('exposes id = telnyx', () => {
        const provider = new TelnyxComplianceProvider(fakeTelnyx([]));
        expect(provider.id).toBe('telnyx');
    });
});
