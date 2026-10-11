/**
 * The sign-completion workflow's evidence email goes out whenever SOME email
 * provider is usable — the deployment's key OR the tenant's own provider.
 *
 * It used to return early whenever the deployment had no platform key, so a
 * deployment whose companies all send through their own provider never
 * delivered the signed agreement and evidence pack at all. Nothing is sent —
 * and nothing is read from storage — only when neither is available.
 */
import { describe, it, expect, afterEach, vi, type Mock } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '../../../server/lib/db/schema';
import { encryptSecrets } from '../../../server/lib/config-crypto';
import { AgreementService } from '../../../server/services/agreement.service';
import { sendSignedEvidenceEmail } from '../../../server/workflows/sign-completion-email';
import type { HonoConfig } from '../../../server/types/hono';
import {
    createHarness, INSPECTOR_ID, PLATFORM_IDENTITY, TENANT_ID, TENANT_IDENTITY, type Harness,
} from '../helpers/tenant-email-harness';

const INSPECTION_ID = '66666666-0000-4000-8000-000000000001';
const AGREEMENT_ID = '66666666-0000-4000-8000-000000000002';
const TENANT_SENDER = 'mail@harbor-light.test';
const TENANT_KEY = 're_tenant_own_key';

type Env = HonoConfig['Bindings'];

/** An R2 double holding the two artifacts; `get` is a spy so reads can be counted. */
type R2Get = (key: string) => Promise<{ body: Uint8Array }>;
function photos(): { bucket: R2Bucket; get: Mock<R2Get> } {
    const get = vi.fn<R2Get>(async () => ({ body: new Uint8Array([37, 80, 68, 70]) }));
    return { bucket: { get } as unknown as R2Bucket, get };
}

async function seedEnvelope(h: Harness): Promise<string> {
    await h.db.insert(schema.inspections).values({
        id: INSPECTION_ID, tenantId: TENANT_ID, inspectorId: INSPECTOR_ID, propertyAddress: '12 Lighthouse Road',
        date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid', price: 0,
        agreementRequired: true, paymentRequired: false, createdAt: new Date(),
    });
    await h.db.insert(schema.agreements).values({
        id: AGREEMENT_ID, tenantId: TENANT_ID, name: 'Standard Agreement', content: 'Text', version: 1, createdAt: new Date(),
    });
    const envelope = await new AgreementService(h.env.DB, { jwtSecret: h.env.JWT_SECRET }).findOrCreate(TENANT_ID, INSPECTION_ID, {
        signers: [{ name: 'Casey Client', email: 'casey@client.test', role: 'client' }],
        completionPolicy: 'one',
    });
    return envelope.requestId;
}

/** The tenant sends through its OWN provider account. */
async function useOwnProvider(h: Harness): Promise<void> {
    await h.db.update(schema.tenantConfigs).set({
        emailMode: 'own',
        senderEmail: TENANT_SENDER,
        secretsEnc: await encryptSecrets({ RESEND_API_KEY: TENANT_KEY }, h.env.JWT_SECRET),
    }).where(eq(schema.tenantConfigs.tenantId, TENANT_ID));
}

function withoutPlatformKey(env: Env, bucket: R2Bucket): Env {
    return { ...env, RESEND_API_KEY: undefined, PHOTOS: bucket } as unknown as Env;
}

const input = (requestId: string) => ({
    requestId, signedPdfR2Key: 'signed.pdf', evidenceZipR2Key: 'evidence.zip', baseUrl: 'https://app.platform.test',
});

describe('sendSignedEvidenceEmail', () => {
    let h: Harness;
    afterEach(() => h.close());

    it('no platform key, tenant has its own provider: sends through the tenant provider', { timeout: 60_000 }, async () => {
        h = await createHarness('standalone');
        const requestId = await seedEnvelope(h);
        await useOwnProvider(h);
        const r2 = photos();

        const outcome = await sendSignedEvidenceEmail(withoutPlatformKey(h.env, r2.bucket), input(requestId));

        expect(outcome).toBe('sent');
        expect(h.sent).toHaveLength(1);
        expect(h.sent[0]?.to).toEqual(['casey@client.test']);
        expect(h.sent[0]?.from).toBe(`${TENANT_IDENTITY.senderDisplayName} <${TENANT_SENDER}>`);
        expect(h.sent[0]?.authorization).toBe(`Bearer ${TENANT_KEY}`);
    });

    it('no platform key and no tenant provider: skips, and reads nothing from storage', { timeout: 60_000 }, async () => {
        h = await createHarness('standalone');
        const requestId = await seedEnvelope(h);
        const r2 = photos();

        const outcome = await sendSignedEvidenceEmail(withoutPlatformKey(h.env, r2.bucket), input(requestId));

        expect(outcome).toBe('skipped');
        expect(h.sent).toHaveLength(0);
        expect(r2.get).not.toHaveBeenCalled();
    });

    it('platform key present: sends through the platform provider, as before', { timeout: 60_000 }, async () => {
        h = await createHarness('standalone');
        const requestId = await seedEnvelope(h);
        const r2 = photos();

        const outcome = await sendSignedEvidenceEmail({ ...h.env, PHOTOS: r2.bucket } as Env, input(requestId));

        expect(outcome).toBe('sent');
        expect(h.sent).toHaveLength(1);
        expect(h.sent[0]?.authorization).toBe(`Bearer ${PLATFORM_IDENTITY.resendKey}`);
    });
});
