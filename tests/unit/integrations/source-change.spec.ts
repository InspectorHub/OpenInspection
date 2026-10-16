/**
 * Choosing a source: what the settings page may offer, what the server accepts,
 * and what the write touches. Run against the real schema and the product's own
 * secret envelope, so "the keys are still there after switching" is a fact about
 * stored rows, not about a mock.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { toD1Binding } from '../helpers/d1-binding';
import { sealSecrets } from '../../../server/lib/config-crypto';
import { getDeploymentProfile } from '../../../server/lib/deployment-profile';
import { loadOverviewInputs } from '../../../server/lib/integrations/overview-data';
import {
    checkSourceChange,
    describeSwitchableSources,
    writeIntegrationSource,
} from '../../../server/lib/integrations/source-change';

const JWT_SECRET = 'j'.repeat(40);
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const HOSTED = getDeploymentProfile({ APP_MODE: 'saas' });
const SELF_HOSTED = getDeploymentProfile({});
const DEPLOYMENT_ENV = { SENDER_EMAIL: 'dep@x.test', RESEND_API_KEY: 're_dep' };
const now = new Date();

let DB: D1Database;
let secretsBlobA: string;

async function seed(opts: { aKeys?: Record<string, string>; aConfig?: string } = {}) {
    const fixture = createTestDb();
    await setupSchema(fixture.sqlite);
    const { db } = fixture;
    for (const [id, slug] of [[A, 'aaa'], [B, 'bbb']] as const) {
        await db.insert(schema.tenants).values({ id, slug, status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: now });
    }
    const a = await sealSecrets(opts.aKeys ?? { RESEND_API_KEY: 're_a' }, A, JWT_SECRET);
    secretsBlobA = a.blob;
    await db.insert(schema.tenantConfigs).values({
        tenantId: A, secretsEnc: a.blob, dekEnc: a.dekEnc, senderEmail: 'a@a.test', updatedAt: now,
        ...(opts.aConfig ? { integrationConfig: opts.aConfig } : {}),
    } as never);
    const b = await sealSecrets({ RESEND_API_KEY: 're_b' }, B, JWT_SECRET);
    await db.insert(schema.tenantConfigs).values({
        tenantId: B, secretsEnc: b.blob, dekEnc: b.dekEnc, senderEmail: 'b@b.test', updatedAt: now,
        integrationConfig: JSON.stringify({ integrationSources: { email: 'provided' }, appBaseUrl: 'https://b.test' }),
    } as never);
    DB = toD1Binding(fixture.sqlite);
}

const inputsFor = (tenantId: string, profile = HOSTED) => loadOverviewInputs({
    env: { DB, JWT_SECRET, ...DEPLOYMENT_ENV },
    profile, tenantId, userId: null, tenantSecretKeys: [],
});
const rowOf = async (service: 'email' | 'sms' | 'ai', tenantId = A, profile = HOSTED) =>
    describeSwitchableSources(await inputsFor(tenantId, profile)).find((r) => r.service === service)!;
const configRow = (tenantId: string) =>
    drizzle(DB).select().from(schema.tenantConfigs).where(eq(schema.tenantConfigs.tenantId, tenantId)).get();

beforeEach(() => seed());

describe('describeSwitchableSources', () => {
    it('lists exactly the services whose choice is honoured, and nothing else', async () => {
        const rows = describeSwitchableSources(await inputsFor(A));
        expect(rows.map((r) => r.service)).toEqual(['email', 'sms', 'ai']);
    });

    it('shows the choice on a hosted deployment that supplies the service, with both sources open for email', async () => {
        const email = await rowOf('email');
        expect(email).toMatchObject({ choiceShown: true, available: ['provided', 'own'], stored: null });
    });

    it('shows no choice for SMS: only Your own is open', async () => {
        const sms = await rowOf('sms');
        expect(sms.choiceShown).toBe(false);
        expect(sms.available).toEqual(['own']);
        // control: the same row for email offers Built-in, so the line above is about SMS, not about the helper
        expect((await rowOf('email')).available).toContain('provided');
    });

    it('shows no choice on a self-hosted deployment', async () => {
        const email = await rowOf('email', A, SELF_HOSTED);
        expect(email).toMatchObject({ choiceShown: false, available: ['own'] });
        expect((await rowOf('sms', A, SELF_HOSTED)).choiceShown).toBe(false);
    });

    it('reports the stored choice and whether the company\'s own keys are complete', async () => {
        await seed({ aConfig: JSON.stringify({ integrationSources: { email: 'own' } }) });
        const email = await rowOf('email');
        expect(email).toMatchObject({ stored: 'own', current: 'own', ownReady: true, state: 'connected' });
        // control: a company with no keys is not ready
        await seed({ aKeys: {} });
        expect((await rowOf('email')).ownReady).toBe(false);
    });

    it('never carries a key value', async () => {
        const rows = describeSwitchableSources(await inputsFor(A));
        expect(JSON.stringify(rows)).not.toContain('re_a');
        expect(JSON.stringify(rows)).not.toContain('re_dep');
    });
});

describe('checkSourceChange', () => {
    it('accepts Your own when the company\'s keys are complete', async () => {
        expect(checkSourceChange(await inputsFor(A), 'email', 'own')).toEqual({ ok: true });
    });

    it('refuses Your own with a reason when the keys are not complete, and never falls back to the deployment\'s', async () => {
        await seed({ aKeys: {} });
        expect(checkSourceChange(await inputsFor(A), 'email', 'own')).toEqual({ ok: false, error: 'own_credentials_incomplete' });
        // control: the deployment does hold a key, so the refusal is about the company's own
        expect(DEPLOYMENT_ENV.RESEND_API_KEY).toBeTruthy();
    });

    it('accepts Built-in for email on a deployment that supplies it', async () => {
        expect(checkSourceChange(await inputsFor(A), 'email', 'provided')).toEqual({ ok: true });
    });

    it('refuses Built-in SMS: there is no shared number', async () => {
        expect(checkSourceChange(await inputsFor(A), 'sms', 'provided')).toEqual({ ok: false, error: 'not_offered' });
    });

    it('refuses Built-in on a self-hosted deployment', async () => {
        expect(checkSourceChange(await inputsFor(A, SELF_HOSTED), 'email', 'provided')).toEqual({ ok: false, error: 'not_offered' });
    });

    it('accepts Your own on a self-hosted deployment without asking for stored keys (the operator\'s environment counts)', async () => {
        await seed({ aKeys: {} });
        expect(checkSourceChange(await inputsFor(A, SELF_HOSTED), 'email', 'own')).toEqual({ ok: true });
    });
});

describe('writeIntegrationSource', () => {
    it('stores the choice and keeps every other setting in the same JSON', async () => {
        await writeIntegrationSource(DB, B, 'email', 'own');
        const row = await configRow(B);
        expect(JSON.parse(row!.integrationConfig!)).toEqual({ integrationSources: { email: 'own' }, appBaseUrl: 'https://b.test' });
    });

    it('creates the settings row when the company has none', async () => {
        const fixture = createTestDb();
        await setupSchema(fixture.sqlite);
        await fixture.db.insert(schema.tenants).values({ id: A, slug: 'aaa', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: now });
        const d1 = toD1Binding(fixture.sqlite);
        await writeIntegrationSource(d1, A, 'sms', 'own');
        const row = await drizzle(d1).select().from(schema.tenantConfigs).where(eq(schema.tenantConfigs.tenantId, A)).get();
        expect(JSON.parse(row!.integrationConfig!)).toEqual({ integrationSources: { sms: 'own' } });
    });

    it('keeps the company\'s own keys when it switches to Built-in and back', async () => {
        await writeIntegrationSource(DB, A, 'email', 'provided');
        await writeIntegrationSource(DB, A, 'email', 'own');
        await writeIntegrationSource(DB, A, 'email', 'provided');
        const row = await configRow(A);
        expect(row!.secretsEnc).toBe(secretsBlobA);
        expect((await rowOf('email')).ownReady).toBe(true);
    });

    it('records choices for two services without losing the first', async () => {
        await writeIntegrationSource(DB, A, 'email', 'own');
        await writeIntegrationSource(DB, A, 'sms', 'own');
        expect(JSON.parse((await configRow(A))!.integrationConfig!).integrationSources).toEqual({ email: 'own', sms: 'own' });
    });

    it('mirrors the choice into the older per-service column the send paths still read', async () => {
        await writeIntegrationSource(DB, A, 'email', 'own');
        await writeIntegrationSource(DB, A, 'sms', 'own');
        expect(await configRow(A)).toMatchObject({ emailMode: 'own', smsMode: 'own' });
        await writeIntegrationSource(DB, A, 'email', 'provided');
        expect((await configRow(A))!.emailMode).toBe('platform');
    });

    it('touches only the named company', async () => {
        const before = await configRow(B);
        await writeIntegrationSource(DB, A, 'email', 'own');
        expect(await configRow(B)).toEqual(before);
    });

    it('writes no secret: the stored blob is byte-for-byte unchanged', async () => {
        await writeIntegrationSource(DB, A, 'ai', 'own');
        expect((await configRow(A))!.secretsEnc).toBe(secretsBlobA);
    });
});
