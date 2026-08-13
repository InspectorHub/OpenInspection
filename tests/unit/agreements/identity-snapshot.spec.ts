/**
 * Spec §3 — the contracting identity is FROZEN onto the envelope at creation.
 *
 * Without this, renaming the company retroactively rewrites which entity every
 * past agreement was signed with, and the Certificate of Completion names no
 * entity at all — the evidence pack cannot attest who the client contracted
 * with.
 *
 * The identity lives in its OWN columns, never folded into `contentSnapshot`:
 * `contentHash` is SHA-256 over the stored snapshot STRING, so adding a field
 * there would invalidate every signature ever collected.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { tenantConfigs, agreementRequests } from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { asD1Db } from '../helpers/test-db';
import { AgreementService } from '../../../server/services/agreement.service';
// The SAME hashing function production uses. A hand-rolled SHA-256 in the test
// would pass while production diverged.
import { sha256Hex } from '../../../server/services/agreement/base';
import { certRenderHandler } from '../../../server/api/agreements-render';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

// certRenderHandler takes a RAW D1Database and calls drizzle() on it itself —
// which the mock above intercepts and points at the test db. asD1Db returns a
// DrizzleD1Database, i.e. the wrapped shape, so it is the wrong tool here: the
// handler would be wrapping an already-wrapped handle.
const RAW_D1 = {} as D1Database;

const TENANT = '00000000-0000-0000-0000-000000000001';
const INSP_ID = '550e8400-e29b-41d4-a716-446655440000';
const AGR_ID = '00000000-0000-0000-0000-000000000020';
const AGREEMENT_TEXT = 'The parties agree to the following terms.';

describe('agreement identity snapshot', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let svc: AgreementService;

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
        await testDb.insert(tenantConfigs).values({
            tenantId: TENANT,
            companyName: 'Acme Home Inspections',
            legalName: 'Acme Holdings LLC',
            updatedAt: new Date(),
        } as typeof tenantConfigs.$inferInsert);
        await testDb.insert(schema.agreements).values({
            id: AGR_ID, tenantId: TENANT, name: 'Standard Agreement',
            content: AGREEMENT_TEXT, version: 1, createdAt: new Date(),
        });
        await testDb.insert(schema.inspections).values({
            id: INSP_ID, tenantId: TENANT, propertyAddress: '1 Main St',
            date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid', price: 50000,
            agreementRequired: true, paymentRequired: false, createdAt: new Date(),
        });

        svc = new AgreementService({} as D1Database, { jwtSecret: 'test-secret' });
    });

    const readEnvelope = (id: string) =>
        testDb.select().from(agreementRequests).where(eq(agreementRequests.id, id)).get();

    it('freezes the legal and company names at envelope creation', async () => {
        const env = await svc.findOrCreate(TENANT, INSP_ID);
        const row = await readEnvelope(env.requestId);
        expect(row?.signerLegalName).toBe('Acme Holdings LLC');
        expect(row?.signerCompanyName).toBe('Acme Home Inspections');
    });

    it('a later rename does not alter an existing envelope', async () => {
        const env = await svc.findOrCreate(TENANT, INSP_ID);
        await testDb.update(tenantConfigs)
            .set({ legalName: 'Beta Holdings LLC', companyName: 'Beta Inspections' })
            .where(eq(tenantConfigs.tenantId, TENANT));
        expect((await readEnvelope(env.requestId))?.signerLegalName).toBe('Acme Holdings LLC');
    });

    // Guards spec §3.1. The identity lives in its OWN columns; contentHash is
    // SHA-256 over the stored snapshot STRING, so folding a name into
    // contentSnapshot would invalidate every signature ever collected.
    it('does not change contentHash for a given contentSnapshot', async () => {
        const env = await svc.findOrCreate(TENANT, INSP_ID);
        const row = await readEnvelope(env.requestId);
        expect(row?.contentSnapshot).toBe(AGREEMENT_TEXT);
        expect(row?.contentHash).toBe(await sha256Hex(row!.contentSnapshot!));
    });

    // Enforces spec §3.3 — backfilling a legacy envelope with today's name
    // asserts something untrue about what was signed.
    it('renders a NULL identity as "not recorded", never as today\'s name', async () => {
        await testDb.insert(agreementRequests).values({
            id: 'legacy-1', tenantId: TENANT, inspectionId: INSP_ID, agreementId: AGR_ID,
            clientEmail: 'jane@example.com', token: 'legacy-token-1', status: 'signed',
            signerLegalName: null, signerCompanyName: null, createdAt: new Date(),
        } as typeof agreementRequests.$inferInsert);
        const res = await certRenderHandler(RAW_D1, 'legacy-1', 'https://example.test');
        const html = await res.text();
        expect(html).not.toContain('Acme Holdings LLC');
        expect(html).toContain('not recorded');
    });

    it('the certificate names the frozen contracting entity when one was recorded', async () => {
        const env = await svc.findOrCreate(TENANT, INSP_ID);
        // The certificate only renders for a signed envelope.
        await testDb.update(agreementRequests).set({ status: 'signed', signedAt: new Date() })
            .where(eq(agreementRequests.id, env.requestId));
        const res = await certRenderHandler(RAW_D1, env.requestId, 'https://example.test');
        const html = await res.text();
        expect(html).toContain('Acme Holdings LLC');
    });
});
