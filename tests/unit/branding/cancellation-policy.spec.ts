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
 *
 * The last block covers the OTHER refusal in that same writer — embedded report
 * estimates — for the same reason: the writer is the single chokepoint every
 * caller (dashboard, MCP, API client) goes through.
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

    it('revokes the attestation even when the save changed nothing', async () => {
        // #83, and the reason the editor has to WARN rather than reason about
        // whether an edit was material. `updateAgreement` compares nothing: it
        // writes `version + 1` unconditionally, so re-saving byte-identical
        // text revokes the attestation exactly like a rewritten clause would.
        // Characterization — this is today's behaviour, pinned so that anyone
        // who later "optimises" the bump away has to do it on purpose. Skipping
        // it is NOT the fix for the silent revocation: the version bump is what
        // makes the attestation mean anything.
        const agreementId = await seedAgreement();
        const before = await testDb.select({ v: schema.agreements.version })
            .from(schema.agreements).where(eq(schema.agreements.id, agreementId)).get();
        await branding.attestCancellationClause(TENANT, agreementId);

        const original = await testDb.select({ name: schema.agreements.name, content: schema.agreements.content })
            .from(schema.agreements).where(eq(schema.agreements.id, agreementId)).get();
        await agreementSvc.updateAgreement(agreementId, TENANT, original!.name, original!.content);

        const after = await testDb.select({ v: schema.agreements.version })
            .from(schema.agreements).where(eq(schema.agreements.id, agreementId)).get();
        // The attested version and the current one, side by side: the gap IS
        // the defect the editor now has to announce.
        expect(after!.v).toBe(before!.v + 1);
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

    // ─── Embedded repair estimates ───────────────────────────────────────────
    // The other refusal in the same writer. `showEstimates` stays open in the
    // Zod schema (it is a real column with a real off-switch), so the service
    // is the only place that can be asymmetric about which value it accepts.

    async function storedShowEstimates(): Promise<boolean | null> {
        const row = await testDb.select({ v: schema.tenantConfigs.showEstimates })
            .from(schema.tenantConfigs).where(eq(schema.tenantConfigs.tenantId, TENANT)).get();
        return row?.v ?? null;
    }

    it('refuses to turn embedded report estimates on', async () => {
        await expect(branding.updateBranding(TENANT, { showEstimates: true }))
            .rejects.toThrow(/estimates cannot be shown inside the inspection report/i);
        expect(await storedShowEstimates()).toBeNull();
    });

    it('still lets a tenant turn embedded report estimates off', async () => {
        // Asymmetric on purpose: a blanket refusal would strand any tenant the
        // column is already true for, with no supported way back to false.
        await branding.updateBranding(TENANT, { showEstimates: false });
        expect(await storedShowEstimates()).toBe(false);
    });
});
