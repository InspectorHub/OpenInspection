/**
 * The cancellation-fee attestation gate.
 *
 * The platform enforces NUMBERS while the client agreed to WORDS, and the words
 * are what govern. Since free-form agreement HTML cannot be parsed for a notice
 * window, the only honest gate is the tenant confirming the clause exists — and
 * the only way that confirmation stays meaningful is by recording WHICH
 * agreement, at WHICH version, so an edit to the clause cannot leave a live
 * attestation behind it.
 *
 * The gate compares DB state, so it is not expressible in the Zod schema and
 * lives in `BrandingService.updateBranding`. These specs exercise that method,
 * which is what `POST /api/admin/branding` funnels into.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { BrandingService } from '../../../server/services/branding.service';
import { AgreementService } from '../../../server/services/agreement.service';
import { UpdateBrandingSchema } from '../../../server/lib/validations/admin.schema';
import * as schema from '../../../server/lib/db/schema';
import type { CancellationPolicy } from '../../../server/lib/billing/cancellation-policy';
import { createTestDb, setupSchema } from '../db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const TENANT = '00000000-0000-0000-0000-000000000001';

const FEE_POLICY: CancellationPolicy = {
    noticeHours: 24,
    lateFee: { type: 'percent', percent: 50 },
    noShowFee: { type: 'percent', percent: 100 },
    remedy: 'refund',
};

const FREE_POLICY: CancellationPolicy = {
    noticeHours: 24,
    lateFee: { type: 'percent', percent: 0 },
    noShowFee: { type: 'fixed', amountCents: 0 },
    remedy: 'refund',
};

describe('BrandingService — cancellation policy attestation gate', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let branding: BrandingService;
    let agreementSvc: AgreementService;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        const { drizzle } = await import('drizzle-orm/d1');
        (drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        branding = new BrandingService({} as D1Database);
        agreementSvc = new AgreementService({} as D1Database);
        await testDb.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
    });

    async function seedAgreement(id = 'agr-1') {
        return agreementSvc.createAgreement(TENANT, 'Residential', '<p>Cancel 24h ahead or pay 50%.</p>')
            .then(async (created) => {
                // createAgreement mints its own uuid; rename it so the specs can
                // name it without depending on crypto.randomUUID.
                await testDb.update(schema.agreements).set({ id })
                    .where(eq(schema.agreements.id, created.id));
                return id;
            });
    }

    async function storedPolicy(): Promise<CancellationPolicy | null> {
        const row = await testDb.select({ p: schema.tenantConfigs.cancellationPolicy })
            .from(schema.tenantConfigs).where(eq(schema.tenantConfigs.tenantId, TENANT)).get();
        return row?.p ?? null;
    }

    it('refuses to save a policy with fees when the clause is not attested', async () => {
        await expect(branding.updateBranding(TENANT, { cancellationPolicy: FEE_POLICY }))
            .rejects.toThrow(/agreement contains a cancellation clause/i);
        expect(await storedPolicy()).toBeNull();
    });

    it('accepts the policy once attested', async () => {
        const agreementId = await seedAgreement();
        await branding.attestCancellationClause(TENANT, agreementId);
        await branding.updateBranding(TENANT, { cancellationPolicy: FEE_POLICY });
        expect(await storedPolicy()).toEqual(FEE_POLICY);
    });

    it('stops honouring the attestation once the agreement is edited', async () => {
        // The attestation is about a specific VERSION of the text. Editing the
        // agreement invalidates it, or a tenant can attest once and then delete
        // the clause while the platform keeps charging.
        const agreementId = await seedAgreement();
        await branding.attestCancellationClause(TENANT, agreementId);
        expect(await branding.getCancellationAttestation(TENANT)).not.toBeNull();

        await agreementSvc.updateAgreement(agreementId, TENANT, undefined, '<p>No cancellation terms.</p>');

        expect(await branding.getCancellationAttestation(TENANT)).toBeNull();
        await expect(branding.updateBranding(TENANT, { cancellationPolicy: FEE_POLICY }))
            .rejects.toThrow(/agreement contains a cancellation clause/i);
    });

    it('does not honour an attestation against a DIFFERENT tenant agreement being edited', async () => {
        // `agreements` is multi-row per tenant: a commercial template's edit must
        // not void the residential attestation, which a bare timestamp would do.
        const residential = await seedAgreement('agr-residential');
        const commercial = await agreementSvc.createAgreement(TENANT, 'Commercial', '<p>Other terms.</p>');
        await branding.attestCancellationClause(TENANT, residential);

        await agreementSvc.updateAgreement(commercial.id, TENANT, undefined, '<p>Edited.</p>');

        expect(await branding.getCancellationAttestation(TENANT)).not.toBeNull();
        await expect(branding.updateBranding(TENANT, { cancellationPolicy: FEE_POLICY })).resolves.toBeDefined();
    });

    it('deleting the attested agreement withdraws the attestation', async () => {
        const agreementId = await seedAgreement();
        await branding.attestCancellationClause(TENANT, agreementId);
        await agreementSvc.deleteAgreement(agreementId, TENANT);
        expect(await branding.getCancellationAttestation(TENANT)).toBeNull();
    });

    it('needs no attestation for a policy that never charges', async () => {
        await branding.updateBranding(TENANT, { cancellationPolicy: FREE_POLICY });
        expect(await storedPolicy()).toEqual(FREE_POLICY);
    });

    it('rejects a percent fee above 100', () => {
        const parsed = UpdateBrandingSchema.safeParse({
            cancellationPolicy: { ...FEE_POLICY, noShowFee: { type: 'percent', percent: 150 } },
        });
        expect(parsed.success).toBe(false);
    });

    it('rejects a fixed fee expressed in fractional cents', () => {
        const parsed = UpdateBrandingSchema.safeParse({
            cancellationPolicy: { ...FEE_POLICY, lateFee: { type: 'fixed', amountCents: 300.5 } },
        });
        expect(parsed.success).toBe(false);
    });

    it('omits the key entirely when a save does not mention the policy', () => {
        // Assert the ABSENCE OF THE KEY, not the resulting value: a `.default()`
        // on this field would make an unrelated Workspace save silently overwrite
        // a configured ladder, and a value assertion cannot tell the two apart.
        const parsed = UpdateBrandingSchema.parse({ companyName: 'Acme' });
        expect('cancellationPolicy' in parsed).toBe(false);
        expect('attestCancellationClause' in parsed).toBe(false);
    });

    it('leaves a configured policy alone when a later save does not mention it', async () => {
        const agreementId = await seedAgreement();
        await branding.attestCancellationClause(TENANT, agreementId);
        await branding.updateBranding(TENANT, { cancellationPolicy: FEE_POLICY });
        await branding.updateBranding(TENANT, { companyName: 'Acme Inspections' });
        expect(await storedPolicy()).toEqual(FEE_POLICY);
    });

    it('clears the policy when the caller explicitly sends null', async () => {
        const agreementId = await seedAgreement();
        await branding.attestCancellationClause(TENANT, agreementId);
        await branding.updateBranding(TENANT, { cancellationPolicy: FEE_POLICY });
        await branding.updateBranding(TENANT, { cancellationPolicy: null });
        expect(await storedPolicy()).toBeNull();
    });

    it('refuses to attest an agreement belonging to another tenant', async () => {
        await testDb.insert(schema.tenants).values({
            id: 'other', name: 'Other', slug: 'other', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        const foreign = await agreementSvc.createAgreement('other', 'Theirs', '<p>x</p>');
        await expect(branding.attestCancellationClause(TENANT, foreign.id)).rejects.toThrow(/not found/i);
    });
});
