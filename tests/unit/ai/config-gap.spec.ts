/**
 * Saving AI settings must not leave a company looking configured while its real
 * calls would fail, and the Test button must agree with what a real call sends.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { aiConfigGap, changesOnlyCourtesyTranslation, type AiConfigInput } from '../../../server/lib/ai/config-write';
import { testAiConnection } from '../../../server/lib/ai/connection-test';
import { buildTenantAiService } from '../../../server/lib/ai/build-ai-service';
import { STANDALONE_PROFILE } from '../../../server/lib/deployment-profile';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn(() => ({ insert: () => ({ values: async () => {} }) })) }));

const full: AiConfigInput = {
    aiEnabled: true, aiBaseUrl: 'https://company.example.test/v1', aiModel: 'company-model',
    courtesyTranslationEnabled: false,
};
const NO_FALLBACK = {};

describe('aiConfigGap', () => {
    it('refuses a blank model when a key is on file and the deployment has no model', () => {
        expect(aiConfigGap({ ...full, aiModel: '' }, NO_FALLBACK, true))
            .toEqual({ field: 'aiModel', message: 'Enter the model name your AI account uses.' });
    });

    it('refuses a blank endpoint the same way, naming its field', () => {
        expect(aiConfigGap({ ...full, aiBaseUrl: '  ' }, NO_FALLBACK, true))
            .toMatchObject({ field: 'aiBaseUrl' });
    });

    it('refuses a typed model with the endpoint missing even before a key exists', () => {
        expect(aiConfigGap({ ...full, aiBaseUrl: '' }, NO_FALLBACK, false)).toMatchObject({ field: 'aiBaseUrl' });
    });

    it('control: a complete configuration is accepted', () => {
        expect(aiConfigGap(full, NO_FALLBACK, true)).toBeNull();
    });

    it('control: a deployment fallback makes a blank field acceptable', () => {
        expect(aiConfigGap({ ...full, aiModel: '', aiBaseUrl: '' }, { AI_MODEL: 'm', AI_BASE_URL: 'https://x.test/v1' }, true)).toBeNull();
    });

    it('control: an untouched all-blank form with no key is not refused', () => {
        expect(aiConfigGap({ ...full, aiModel: '', aiBaseUrl: '' }, NO_FALLBACK, false)).toBeNull();
    });

    it('control: switching AI off with incomplete values is not refused', () => {
        expect(aiConfigGap({ ...full, aiEnabled: false, aiModel: '' }, NO_FALLBACK, true)).toBeNull();
    });
});

describe('changesOnlyCourtesyTranslation', () => {
    const incomplete: AiConfigInput = { ...full, aiModel: '' };

    it('is true when only the courtesy flag differs, so a pre-existing gap does not block it', () => {
        const next = { ...incomplete, courtesyTranslationEnabled: true };
        expect(aiConfigGap(next, NO_FALLBACK, true)).not.toBeNull(); // the gap exists...
        expect(changesOnlyCourtesyTranslation(next, incomplete)).toBe(true); // ...but this save did not make it
    });

    it('is false when the model, endpoint or switch changes (the check still applies)', () => {
        expect(changesOnlyCourtesyTranslation({ ...incomplete, aiModel: 'x' }, incomplete)).toBe(false);
        expect(changesOnlyCourtesyTranslation({ ...incomplete, aiBaseUrl: 'https://y.test/v1' }, incomplete)).toBe(false);
        expect(changesOnlyCourtesyTranslation({ ...incomplete, aiEnabled: false }, incomplete)).toBe(false);
    });

    it('ignores surrounding whitespace', () => {
        expect(changesOnlyCourtesyTranslation({ ...full, aiModel: ' company-model ' }, full)).toBe(true);
    });
});

describe('Test connection and a real call agree', () => {
    const fetchMock = vi.fn();
    let originalFetch: typeof globalThis.fetch;
    beforeEach(() => {
        originalFetch = globalThis.fetch;
        globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
        fetchMock.mockReset();
        fetchMock.mockImplementation(async () => new Response(
            JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 },
        ));
    });
    afterEach(() => { globalThis.fetch = originalFetch; });

    it('with the company values saved and no deployment values, both send the same model to the same address', async () => {
        await testAiConnection({ baseUrl: full.aiBaseUrl, model: full.aiModel, apiKey: 'k' });
        const svc = buildTenantAiService({
            db: {} as D1Database, profile: STANDALONE_PROFILE, tenantId: 't', tenantKey: 'k', managedKey: null,
            model: '', plan: null, tenantKeyAttested: true, quotaGuard: undefined, aiEnabled: true,
            tenantBaseUrl: full.aiBaseUrl, tenantModel: full.aiModel, baseUrl: '',
        });
        await svc.generateProfessionalComment('note');

        expect(fetchMock).toHaveBeenCalledTimes(2);
        const [probe, real] = fetchMock.mock.calls as Array<[string, RequestInit]>;
        expect(real[0]).toBe(probe[0]);
        expect(JSON.parse(real[1].body as string).model).toBe('company-model');
        expect(JSON.parse(probe[1].body as string).model).toBe('company-model');
    });
});
