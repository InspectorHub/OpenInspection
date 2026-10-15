/**
 * The overview reads ONE company's data. Run against a real schema and the
 * product's own secret envelope: a second company's settings, keys and
 * QuickBooks sign-in must never show up in the first company's overview.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { toD1Binding } from '../helpers/d1-binding';
import { sealSecrets } from '../../../server/lib/config-crypto';
import { getDeploymentProfile } from '../../../server/lib/deployment-profile';
import { buildIntegrationOverview } from '../../../server/lib/integrations/overview';
import { loadOverviewInputs } from '../../../server/lib/integrations/overview-data';

const JWT_SECRET = 'j'.repeat(40);
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const HOSTED = getDeploymentProfile({ APP_MODE: 'saas' });
const now = new Date();

let DB: D1Database;

async function seed() {
    const fixture = createTestDb();
    await setupSchema(fixture.sqlite);
    const { db } = fixture;
    for (const [id, slug] of [[A, 'aaa'], [B, 'bbb']] as const) {
        await db.insert(schema.tenants).values({ id, slug, status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: now });
    }
    const aSecrets = await sealSecrets({ STRIPE_SECRET_KEY: 'sk_a', STRIPE_PUBLISHABLE_KEY: 'pk_a', STRIPE_WEBHOOK_SECRET: 'wh_a' }, A, JWT_SECRET);
    const bSecrets = await sealSecrets({ GOOGLE_PLACES_API_KEY: 'places_b', RESEND_API_KEY: 're_b' }, B, JWT_SECRET);
    await db.insert(schema.tenantConfigs).values({
        tenantId: A, secretsEnc: aSecrets.blob, dekEnc: aSecrets.dekEnc, senderEmail: 'a@a.test', updatedAt: now,
        integrationConfig: JSON.stringify({ integrationSources: { email: 'own' } }),
    } as never);
    await db.insert(schema.tenantConfigs).values({
        tenantId: B, secretsEnc: bSecrets.blob, dekEnc: bSecrets.dekEnc, senderEmail: 'b@b.test', updatedAt: now,
    } as never);
    await db.insert(schema.qboConnections).values({
        tenantId: B, realmId: 'realm-b', accessToken: 'x', refreshToken: 'y',
        tokenExpiresAt: new Date(Date.now() + 1e6), refreshTokenExpiresAt: new Date(Date.now() + 1e6), createdAt: now,
    });
    DB = toD1Binding(fixture.sqlite);
}

const load = (tenantId: string, tenantSecretKeys: string[] = []) => loadOverviewInputs({
    env: { DB, JWT_SECRET, SENDER_EMAIL: 'dep@x.test', RESEND_API_KEY: 're_dep', QBO_CLIENT_ID: 'qid', QBO_CLIENT_SECRET: 'qs' },
    profile: HOSTED, tenantId, userId: null, tenantSecretKeys,
});
const card = (cards: ReturnType<typeof buildIntegrationOverview>, id: string) => cards.find((c) => c.id === id)!;

beforeEach(seed);

describe('loadOverviewInputs', () => {
    it('shows only this company\'s keys, choices and QuickBooks sign-in', async () => {
        const a = buildIntegrationOverview(await load(A));
        expect(card(a, 'stripe')).toMatchObject({ status: 'connected', source: 'own' });
        expect(card(a, 'quickbooks').status).toBe('not_connected');
        // A chose its own email but stored no email key: not borrowed from B or the deployment
        expect(card(a, 'email')).toMatchObject({ source: 'unavailable', status: 'not_connected' });
        expect(card(a, 'places').source).not.toBe('own');
        // control: the same reads for B see B's data
        const b = buildIntegrationOverview(await load(B));
        expect(card(b, 'stripe').status).toBe('not_connected');
        expect(card(b, 'quickbooks')).toMatchObject({ source: 'provided', status: 'connected' });
        expect(card(b, 'places')).toMatchObject({ source: 'own', status: 'connected' });
    });

    it('does not count a key the secrets middleware took from the company as the deployment\'s', async () => {
        const inputs = await loadOverviewInputs({
            env: { DB, JWT_SECRET, RESEND_API_KEY: 're_b', SENDER_EMAIL: 'dep@x.test' },
            profile: HOSTED, tenantId: A, userId: null, tenantSecretKeys: ['RESEND_API_KEY'],
        });
        expect(inputs.env.RESEND_API_KEY).toBeUndefined();
        expect(inputs.env.SENDER_EMAIL).toBe('dep@x.test');
    });

    it('reads an unreadable company as nothing set up, never as connected', async () => {
        const cards = buildIntegrationOverview(await load('00000000-0000-4000-8000-0000000000ff'));
        expect(card(cards, 'stripe').status).toBe('not_connected');
        expect(card(cards, 'quickbooks').status).not.toBe('connected');
    });
});
