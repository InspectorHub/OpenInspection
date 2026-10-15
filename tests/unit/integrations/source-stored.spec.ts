/**
 * The stored per-company source choice (inside the existing integration_config
 * JSON) and the overview derived from it.
 */
import { describe, it, expect } from 'vitest';
import { getDeploymentProfile } from '../../../server/lib/deployment-profile';
import {
    parseStoredIntegrationSources,
    parseIntegrationSourceInput,
    mergeStoredIntegrationSources,
} from '../../../server/lib/integrations/stored-sources';
import { integrationSources } from '../../../server/lib/integrations/source-overview';

const HOSTED = getDeploymentProfile({ APP_MODE: 'saas' });
const SELF = getDeploymentProfile({});

describe('parseStoredIntegrationSources', () => {
    it('reads valid choices and nothing else from integration_config', () => {
        const json = JSON.stringify({ appBaseUrl: 'https://x.test', integrationSources: { email: 'own', ai: 'provided' } });
        expect(parseStoredIntegrationSources(json)).toEqual({ email: 'own', ai: 'provided' });
        // control: the same JSON without the key yields no choices
        expect(parseStoredIntegrationSources(JSON.stringify({ appBaseUrl: 'https://x.test' }))).toEqual({});
    });

    it('treats absent, empty and corrupt JSON as no choice', () => {
        for (const raw of [null, undefined, '', '{', 'null', '[]', '{"integrationSources":"own"}']) {
            expect(parseStoredIntegrationSources(raw)).toEqual({});
        }
    });

    it('drops unknown services and values, and the retired platform value, instead of honouring them', () => {
        const json = JSON.stringify({ integrationSources: { sms: 'platform', email: 'managed', fax: 'own', video: 'provided' } });
        expect(parseStoredIntegrationSources(json)).toEqual({ video: 'provided' });
    });
});

describe('parseIntegrationSourceInput (the write side)', () => {
    it('accepts a known service with provided or own', () => {
        expect(parseIntegrationSourceInput({ service: 'sms', source: 'own' })).toEqual({ ok: true, service: 'sms', source: 'own' });
    });

    it('rejects platform everywhere, and anything unknown (control: own is accepted above)', () => {
        for (const service of ['sms', 'email', 'ai', 'video', 'quickbooks']) {
            expect(parseIntegrationSourceInput({ service, source: 'platform' })).toMatchObject({ ok: false });
        }
        expect(parseIntegrationSourceInput({ service: 'sms', source: 'managed_shared' })).toMatchObject({ ok: false });
        expect(parseIntegrationSourceInput({ service: 'fax', source: 'own' })).toMatchObject({ ok: false });
        expect(parseIntegrationSourceInput(null)).toMatchObject({ ok: false });
    });
});

describe('mergeStoredIntegrationSources', () => {
    it('changes one service and keeps the rest of the JSON, including other choices', () => {
        const before = JSON.stringify({ appBaseUrl: 'https://x.test', integrationSources: { ai: 'own' } });
        const after = JSON.parse(mergeStoredIntegrationSources(before, 'email', 'provided')) as Record<string, unknown>;
        expect(after).toEqual({ appBaseUrl: 'https://x.test', integrationSources: { ai: 'own', email: 'provided' } });
    });

    it('starts from nothing when the JSON is empty or corrupt', () => {
        expect(JSON.parse(mergeStoredIntegrationSources(null, 'ai', 'own'))).toEqual({ integrationSources: { ai: 'own' } });
        expect(JSON.parse(mergeStoredIntegrationSources('{', 'ai', 'own'))).toEqual({ integrationSources: { ai: 'own' } });
    });
});

describe('integrationSources overview', () => {
    const dep = { RESEND_API_KEY: 're', SENDER_EMAIL: 'a@b.test', AI_MANAGED_API_KEY: 'k', QBO_CLIENT_ID: 'i', QBO_CLIENT_SECRET: 's' };
    const row = (rows: ReturnType<typeof integrationSources>, service: string) => rows.find((r) => r.service === service)!;

    it('lists every service with available sources, the current one and a state', () => {
        const rows = integrationSources(HOSTED, {}, dep);
        expect(rows.map((r) => r.service)).toEqual(['email', 'sms', 'ai', 'video', 'quickbooks']);
        expect(row(rows, 'email')).toMatchObject({ available: ['provided', 'own'], current: 'provided', state: 'connected' });
        expect(row(rows, 'video')).toMatchObject({ available: ['provided'], current: 'provided', state: 'connected' });
    });

    it('hosted sms with the flag off is not connected and offers only own', () => {
        expect(row(integrationSources(HOSTED, {}, dep), 'sms'))
            .toMatchObject({ available: ['own'], current: 'unavailable', reason: 'provider_confirmation_pending', state: 'not_connected' });
    });

    it('a half-filled own choice needs attention; an empty one is not connected', () => {
        const half = { sources: { email: 'own' as const }, ownSecrets: { RESEND_API_KEY: 're_own' } };
        expect(row(integrationSources(HOSTED, half, dep), 'email')).toMatchObject({ current: 'unavailable', state: 'attention' });
        const empty = { sources: { email: 'own' as const } };
        expect(row(integrationSources(HOSTED, empty, dep), 'email')).toMatchObject({ current: 'unavailable', state: 'not_connected' });
        // control: a complete own choice is connected
        const full = { ...half, senderEmail: 'me@co.test' };
        expect(row(integrationSources(HOSTED, full, dep), 'email')).toMatchObject({ current: 'own', state: 'connected' });
    });

    it('a deployment that lacks its own credential reads as needing attention, not as connected', () => {
        expect(row(integrationSources(HOSTED, {}, {}), 'ai')).toMatchObject({ current: 'unavailable', reason: 'provided_not_configured', state: 'attention' });
    });

    it('standalone offers own only and makes no network call (pure inputs)', () => {
        const rows = integrationSources(SELF, {}, {});
        for (const r of rows) expect(r.available).toEqual(['own']);
        expect(row(rows, 'video')).toMatchObject({ current: 'own', state: 'connected' });
        expect(row(rows, 'email')).toMatchObject({ state: 'not_connected' });
    });
});
