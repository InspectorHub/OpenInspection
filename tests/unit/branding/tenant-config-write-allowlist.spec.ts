/**
 * Which COLUMNS a tenant-config write may touch.
 *
 * `POST /api/admin/branding` spreads its whole validated body into
 * `BrandingService.updateBranding`, which spread it on into `writeConfig`, which
 * wrote whatever key it was handed. `showEstimates` got a refusal of its own
 * when someone noticed it could be flipped in one owner/manager call; the
 * TRANSITIVITY was never fixed, so the next sensitive column would inherit the
 * same reachability for free.
 *
 * The discriminating spec here is "refuses a column no request schema declares".
 * A spec that only asserts the legitimate fields still save passes just as
 * greenly with no allowlist at all — it measures nothing.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq, getTableColumns } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { BrandingService } from '../../../server/services/branding.service';
import { AgreementService } from '../../../server/services/agreement.service';
import {
    WRITABLE_TENANT_CONFIG_COLUMNS,
} from '../../../server/lib/tenant-config-write-policy';
import { UpdateBrandingSchema } from '../../../server/lib/validations/admin.schema';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const TENANT = '00000000-0000-0000-0000-000000000001';

describe('BrandingService — tenant-config write allowlist', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let branding: BrandingService;
    let r2Put: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        const { drizzle } = await import('drizzle-orm/d1');
        (drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        r2Put = vi.fn().mockResolvedValue(undefined);
        branding = new BrandingService(
            {} as D1Database,
            undefined,
            { put: r2Put } as unknown as R2Bucket,
        );
        await testDb.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
    });

    async function row() {
        return testDb.select().from(schema.tenantConfigs)
            .where(eq(schema.tenantConfigs.tenantId, TENANT)).get();
    }

    // ─── Refusals: the only assertions that can tell the allowlist exists ────

    it('refuses a column no request schema declares, and names it', async () => {
        // `secrets_enc` holds the tenant's encrypted provider credentials. It is
        // a column on the same row as `companyName` and was, before the
        // allowlist, exactly as writable.
        await expect(
            branding.updateBranding(TENANT, { secretsEnc: 'attacker-supplied' }),
        ).rejects.toThrow(/secretsEnc/);
        expect(await row()).toBeUndefined();
    });

    it('names EVERY rejected key, not just the first', async () => {
        await expect(
            branding.updateBranding(TENANT, { icsToken: 'x', managedEligible: true }),
        ).rejects.toThrow(/icsToken.*managedEligible/);
    });

    it('refuses the whole write when one key is unlisted, saving none of it', async () => {
        // Partial application would be worse than refusing: the caller gets an
        // error AND a half-applied row, and no one can tell which half.
        await expect(
            branding.updateBranding(TENANT, { companyName: 'Acme', dekEnc: 'x' }),
        ).rejects.toThrow(/dekEnc/);
        expect(await row()).toBeUndefined();
    });

    it('refuses with a 422, so the caller learns which key was wrong', async () => {
        // Not a silent drop: "I saved it and it did not take" is a question with
        // no evidence anywhere, while this answers itself at the call site.
        const err = await branding.updateBranding(TENANT, { secretsEnc: 'x' })
            .then(() => null, (e: unknown) => e as { status?: number; details?: unknown });
        expect(err?.status).toBe(422);
        expect(err?.details).toEqual({ fields: ['secretsEnc'] });
    });

    // ─── The listed fields still write, from all four request schemas ───────

    it('writes fields declared by UpdateBrandingSchema', async () => {
        await branding.updateBranding(TENANT, { companyName: 'Acme Inspections', primaryColor: '#4f46e5' });
        expect((await row())?.companyName).toBe('Acme Inspections');
    });

    it('writes fields declared by TenantConfigPatchSchema', async () => {
        await branding.updateBranding(TENANT, { legalMode: 'custom', agreementRetentionYears: 7 });
        expect((await row())?.agreementRetentionYears).toBe(7);
    });

    it('writes fields declared by CommunicationPatchSchema', async () => {
        await branding.updateBranding(TENANT, { senderEmail: 'noreply@acme.com', pointOfContact: 'company' });
        expect((await row())?.senderEmail).toBe('noreply@acme.com');
    });

    it('writes fields declared by TeamDefaultsSchema', async () => {
        await branding.updateBranding(TENANT, { teamModeDefault: true });
        expect((await row())?.teamModeDefault).toBe(true);
    });

    // ─── Non-route callers: the service computes these, no schema declares them ─

    it('does not block uploadLogo, which writes a URL the request never sent', async () => {
        const file = new File([new Uint8Array([1, 2, 3])], 'logo.png', { type: 'image/png' });
        const logoUrl = await branding.uploadLogo(TENANT, file);
        expect(r2Put).toHaveBeenCalled();
        expect((await row())?.logoUrl).toBe(logoUrl);
    });

    it('does not block updateIntegrationConfig, which writes the merged JSON blob', async () => {
        await branding.updateIntegrationConfig(TENANT, { appBaseUrl: 'https://acme.test' });
        expect((await row())?.integrationConfig).toContain('acme.test');
    });

    it('does not block the cancellation attestation triple', async () => {
        const agreementSvc = new AgreementService({} as D1Database);
        const created = await agreementSvc.createAgreement(TENANT, 'Residential', '<p>Cancel 24h ahead.</p>');
        await branding.attestCancellationClause(TENANT, created.id);
        expect((await row())?.cancellationClauseAgreementId).toBe(created.id);
        // …and withdrawing it, which writes the same three columns as nulls.
        await branding.attestCancellationClause(TENANT, null);
        expect((await row())?.cancellationClauseAgreementId).toBeNull();
    });

    // ─── The list stays derived from the schemas ────────────────────────────

    it('covers every UpdateBrandingSchema field that is a real column', () => {
        // The guard against someone later replacing the derivation with a typed
        // -out copy: a hand-maintained list drifts on the day a schema grows a
        // field, and nothing else in the suite would notice.
        const columns = new Set(Object.keys(getTableColumns(schema.tenantConfigs)));
        const declared = Object.keys(UpdateBrandingSchema.shape).filter((k) => columns.has(k));
        expect(declared.length).toBeGreaterThan(20);
        expect(declared.filter((k) => !WRITABLE_TENANT_CONFIG_COLUMNS.has(k))).toEqual([]);
    });

    it('leaves the transient schema fields out, because they are not columns', () => {
        // The branding handler strips these before calling the service. The
        // allowlist does not depend on it having remembered: they are not
        // columns of `tenant_configs`, so they can never be writable ones.
        expect(WRITABLE_TENANT_CONFIG_COLUMNS.has('confirmCurrencyChange')).toBe(false);
        expect(WRITABLE_TENANT_CONFIG_COLUMNS.has('attestCancellationClause')).toBe(false);
        expect(WRITABLE_TENANT_CONFIG_COLUMNS.has('googleOAuthMode')).toBe(false);
    });

    it('leaves the sensitive unsurfaced columns out', () => {
        for (const column of ['secretsEnc', 'dekEnc', 'icsToken', 'managedEligible', 'widgetAllowedOrigins']) {
            expect(WRITABLE_TENANT_CONFIG_COLUMNS.has(column)).toBe(false);
        }
    });
});
