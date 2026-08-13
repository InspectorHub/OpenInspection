/**
 * Bring-your-own AI key — the attestation gate on the save path.
 *
 * `PUT/POST /api/admin/secrets` is the ONLY route that writes a tenant's own
 * Gemini key into `tenant_configs.secrets_enc`, so it is the only place the gate
 * can live. These specs drive `saveSecretsImpl` directly, which is the shared
 * body behind both verbs.
 *
 * What is being protected: the provider's terms turn on the SERVICE TIER of the
 * billing project behind the key, and that tier is not carried on the key nor
 * reported by anything this client calls. The tenant's confirmation is the whole
 * signal — so it has to be refused when absent, and recorded, with the terms
 * revision, when present. A record without the revision is unreadable a year on,
 * which is why `terms_version` is asserted against the exported constant rather
 * than merely "is a string".
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { saveSecretsImpl } from '../../../server/api/secrets';
import { openSecrets } from '../../../server/lib/config-crypto';
import {
    AI_PROVIDER_TERMS_VERSION,
    AI_KEY_ATTESTATION_POLICY_VERSION,
    isAiKeyAttestationOnFile,
    type StoredAiKeyAttestation,
} from '../../../server/lib/ai/byo-attestation';
import type { HonoConfig } from '../../../server/types/hono';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const TENANT = '00000000-0000-0000-0000-000000000001';
const JWT_SECRET = 'test-secret';
const KEY = 'AIzaSyExampleTenantOwnedKey';

const FULL_ATTESTATION = {
    reviewedProviderTerms: true,
    tierPermitsIntendedUse: true,
    understandsProviderProcessing: true,
};

describe('BYO AI key attestation — POST/PUT /api/admin/secrets', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let probe: ReturnType<typeof vi.fn>;

    /**
     * The narrow slice of the Hono context `saveSecretsImpl` touches. Built by
     * hand rather than through `createRoutesStub`, which does not run middleware
     * — the tenant id here stands in for the one the JWT middleware sets.
     */
    function ctx() {
        const responses: Array<{ body: unknown; status: number }> = [];
        const c = {
            get: (k: string) => (k === 'tenantId' ? TENANT : undefined),
            env: { DB: {} as D1Database, JWT_SECRET, TENANT_CACHE: undefined },
            req: { header: () => undefined },
            executionCtx: undefined,
            json: (body: unknown, status: number) => {
                responses.push({ body, status });
                return { body, status };
            },
        } as unknown as Context<HonoConfig>;
        return { c, responses };
    }

    async function save(body: Record<string, unknown>) {
        const { c, responses } = ctx();
        await saveSecretsImpl(c, body as Parameters<typeof saveSecretsImpl>[1]);
        return responses[0];
    }

    async function config() {
        return testDb.select().from(schema.tenantConfigs)
            .where(eq(schema.tenantConfigs.tenantId, TENANT)).get();
    }

    async function storedSecrets(): Promise<Record<string, string>> {
        const row = await config();
        if (!row?.secretsEnc) return {};
        return openSecrets(row.secretsEnc, row.dekEnc ?? null, TENANT, JWT_SECRET, undefined);
    }

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        const { drizzle } = await import('drizzle-orm/d1');
        (drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        await testDb.insert(schema.tenants).values({
            id: TENANT, slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        // The route live-verifies a new Gemini key against Google before storing
        // it. Stub the probe as "accepted" so these specs measure the gate, not
        // the network.
        probe = vi.fn(async () => new Response('{}', { status: 200 }));
        vi.stubGlobal('fetch', probe);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('refuses to save the key when the statements are not confirmed', async () => {
        const res = await save({ GEMINI_API_KEY: KEY });

        expect(res.status).toBe(422);
        expect(res.body).toMatchObject({ error: { code: 'AI_ATTESTATION_REQUIRED', field: 'GEMINI_API_KEY' } });
        expect(await storedSecrets()).toEqual({});
        // Refused BEFORE the vendor round trip: a save that will not be stored
        // must not spend a call proving the key works.
        expect(probe).not.toHaveBeenCalled();
    });

    it('refuses a partial confirmation', async () => {
        // Two of three is not a weaker attestation; each statement covers ground
        // the others do not, so anything short of all three is none.
        for (const missing of ['reviewedProviderTerms', 'tierPermitsIntendedUse', 'understandsProviderProcessing'] as const) {
            const res = await save({
                GEMINI_API_KEY: KEY,
                aiKeyAttestation: { ...FULL_ATTESTATION, [missing]: false },
            });
            expect(res.status, `missing ${missing}`).toBe(422);
        }
        expect(await storedSecrets()).toEqual({});
        expect(await config()).toBeUndefined();
    });

    it('stores the key and all six evidence fields once confirmed', async () => {
        const before = Date.now();
        const res = await save({ GEMINI_API_KEY: KEY, aiKeyAttestation: FULL_ATTESTATION });
        expect(res.status).toBe(200);

        expect((await storedSecrets()).GEMINI_API_KEY).toBe(KEY);

        const row = await config();
        // Field by field: a row-exists assertion would pass with five of six
        // columns null, which is exactly the failure this record guards against.
        expect(row?.aiKeyAttestationProvider).toBe('gemini');
        expect(row?.aiKeyAttestationMode).toBe('tenant_key');
        expect(row?.aiKeyAttestationAccountOwner).toBe('tenant');
        expect(row?.aiKeyAttestationTermsVersion).toBe(AI_PROVIDER_TERMS_VERSION);
        expect(row?.aiKeyAttestationPolicyVersion).toBe(AI_KEY_ATTESTATION_POLICY_VERSION);
        expect(row?.aiKeyAttestationAttestedAt).toBeInstanceOf(Date);
        expect(row!.aiKeyAttestationAttestedAt!.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('records terms and policy revisions as addressable constants, not free text', async () => {
        // The whole point of the field: "confirmed in 2026" is unauditable in
        // 2027 unless it says WHICH revision of the terms was confirmed against.
        // A timestamp or a run-time string here would be indistinguishable from
        // no answer, so the stored value must be the constant that moves in a
        // commit.
        await save({ GEMINI_API_KEY: KEY, aiKeyAttestation: FULL_ATTESTATION });
        const row = await config();
        expect(AI_PROVIDER_TERMS_VERSION).toMatch(/^\d{4}-\d{2}$/);
        expect(AI_KEY_ATTESTATION_POLICY_VERSION).toMatch(/^\d{4}-\d{2}$/);
        expect(row?.aiKeyAttestationTermsVersion).toBe(AI_PROVIDER_TERMS_VERSION);
    });

    it('never stores the confirmation in the shape it arrived in', async () => {
        // Transient, like the branding attestations: it is converted into the
        // record above, not sealed alongside the credentials.
        await save({ GEMINI_API_KEY: KEY, aiKeyAttestation: FULL_ATTESTATION });
        expect(Object.keys(await storedSecrets())).toEqual(['GEMINI_API_KEY']);
    });

    it('leaves the attestation alone when an unrelated secret is saved', async () => {
        await save({ GEMINI_API_KEY: KEY, aiKeyAttestation: FULL_ATTESTATION });
        const attestedAt = (await config())?.aiKeyAttestationAttestedAt;

        const res = await save({ GOOGLE_PLACES_API_KEY: 'places-key' });

        expect(res.status).toBe(200);
        const row = await config();
        expect(row?.aiKeyAttestationTermsVersion).toBe(AI_PROVIDER_TERMS_VERSION);
        expect(row?.aiKeyAttestationAttestedAt).toEqual(attestedAt);
        expect((await storedSecrets()).GOOGLE_PLACES_API_KEY).toBe('places-key');
    });

    it('does not demand re-confirmation for a save that resubmits the masked key', async () => {
        // The settings form round-trips the MASKED value for fields the admin did
        // not touch. Treating that as a new key would make every unrelated save
        // fail, and would stamp a fresh attestation nobody made.
        await save({ GEMINI_API_KEY: KEY, aiKeyAttestation: FULL_ATTESTATION });
        const attestedAt = (await config())?.aiKeyAttestationAttestedAt;

        const res = await save({ GEMINI_API_KEY: 'AIza••••••••dKey' });

        expect(res.status).toBe(200);
        expect((await storedSecrets()).GEMINI_API_KEY).toBe(KEY);
        expect((await config())?.aiKeyAttestationAttestedAt).toEqual(attestedAt);
    });

    it('records a confirmation for a key that is ALREADY stored, without re-entry', async () => {
        // The upgrade path. A workspace whose key predates the confirmation
        // requirement has a valid credential and nothing on file, and the
        // runtime gate now refuses it. If the only way to confirm were to save a
        // NEW key, the refusal would be asking them to re-paste a credential
        // they already have — so a body carrying only the confirmation records
        // it against the stored key.
        const seeded = await save({ GEMINI_API_KEY: KEY, aiKeyAttestation: FULL_ATTESTATION });
        expect(seeded.status).toBe(200);
        // Wipe the record to reproduce a key stored before the rule existed.
        await testDb.update(schema.tenantConfigs).set({
            aiKeyAttestationProvider: null, aiKeyAttestationMode: null,
            aiKeyAttestationAccountOwner: null, aiKeyAttestationTermsVersion: null,
            aiKeyAttestationAttestedAt: null, aiKeyAttestationPolicyVersion: null,
        }).where(eq(schema.tenantConfigs.tenantId, TENANT));
        expect(await config()).toMatchObject({ aiKeyAttestationTermsVersion: null });
        probe.mockClear(); // the seeding save verified the key; measure only what follows

        const res = await save({ aiKeyAttestation: FULL_ATTESTATION });

        expect(res.status).toBe(200);
        const row = await config();
        expect(row?.aiKeyAttestationProvider).toBe('gemini');
        expect(row?.aiKeyAttestationTermsVersion).toBe(AI_PROVIDER_TERMS_VERSION);
        expect(row?.aiKeyAttestationAttestedAt).toBeInstanceOf(Date);
        // The stored credential is untouched — this path confirms, it does not
        // re-key, and it must not have needed the plaintext to do so.
        expect((await storedSecrets()).GEMINI_API_KEY).toBe(KEY);
        // And no provider round trip: there is no new key to verify.
        expect(probe).not.toHaveBeenCalled();
    });

    it('confirms nothing when there is no key to confirm', async () => {
        const res = await save({ aiKeyAttestation: FULL_ATTESTATION });
        expect(res.status).toBe(200);
        expect((await config())?.aiKeyAttestationProvider ?? null).toBeNull();
    });

    it('re-stamps the record when a different key is saved', async () => {
        await save({ GEMINI_API_KEY: KEY, aiKeyAttestation: FULL_ATTESTATION });
        const first = (await config())?.aiKeyAttestationAttestedAt;
        vi.useFakeTimers({ shouldAdvanceTime: true });
        vi.setSystemTime(new Date(Date.now() + 60_000));

        await save({ GEMINI_API_KEY: 'AIzaSyADifferentKeyEntirely', aiKeyAttestation: FULL_ATTESTATION });

        const row = await config();
        expect((await storedSecrets()).GEMINI_API_KEY).toBe('AIzaSyADifferentKeyEntirely');
        expect(row!.aiKeyAttestationAttestedAt!.getTime()).toBeGreaterThan(first!.getTime());
        vi.useRealTimers();
    });
});

/**
 * The read side. `isAiKeyAttestationOnFile` is what the runtime gate consults on
 * every AI call, so "a record exists" has to mean all six columns and not the
 * first one somebody thought to check.
 */
describe('isAiKeyAttestationOnFile', () => {
    const COMPLETE: StoredAiKeyAttestation = {
        provider: 'gemini',
        mode: 'tenant_key',
        accountOwner: 'tenant',
        termsVersion: AI_PROVIDER_TERMS_VERSION,
        attestedAt: new Date(),
        policyVersion: AI_KEY_ATTESTATION_POLICY_VERSION,
    };

    it('accepts a complete record', () => {
        expect(isAiKeyAttestationOnFile(COMPLETE)).toBe(true);
    });

    it('rejects a record missing ANY single column', () => {
        // Every column, not a sample. A gate that reads five of six reports
        // green about a field it never looked at.
        for (const column of Object.keys(COMPLETE) as Array<keyof StoredAiKeyAttestation>) {
            expect(isAiKeyAttestationOnFile({ ...COMPLETE, [column]: null }), column).toBe(false);
        }
    });

    it('rejects the never-confirmed row and the absent row alike', () => {
        // A workspace with no config row and one whose columns are all NULL are
        // the same answer: nothing has been confirmed.
        expect(isAiKeyAttestationOnFile(null)).toBe(false);
        expect(isAiKeyAttestationOnFile(undefined)).toBe(false);
        expect(isAiKeyAttestationOnFile({
            provider: null, mode: null, accountOwner: null,
            termsVersion: null, attestedAt: null, policyVersion: null,
        })).toBe(false);
    });

    it('does not invalidate a record stamped against an older terms revision', () => {
        // Deliberate: bumping AI_PROVIDER_TERMS_VERSION must be a decision to
        // run a re-confirmation pass, not an instant outage caused by editing a
        // constant. The stale revision stays readable in the row.
        expect(isAiKeyAttestationOnFile({ ...COMPLETE, termsVersion: '2019-01' })).toBe(true);
    });
});
