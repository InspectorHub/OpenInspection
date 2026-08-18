/**
 * Spec §3, evidence-pack half — `audit-trail.json` names the contracting entity.
 *
 * The Certificate of Completion already prints the entity, but the certificate
 * is a rasterized PDF. `audit-trail.json` is the machine-readable artefact in
 * the same zip, and it carried the envelope id, the key and the event chain
 * while saying nothing about WHICH COMPANY the client contracted with.
 *
 * As with the certificate, the name is read from the envelope's FROZEN columns.
 * A rename must not reach an evidence pack that was already assembled, and it
 * must not reach one assembled afterwards either.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { tenantConfigs, agreementRequests } from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { buildAuditTrailPayload } from '../../../server/workflows/sign-completion-workflow';

// No `drizzle-orm/d1` mock here, deliberately: `buildAuditTrailPayload` takes
// the handle as an argument and never calls `drizzle()` itself, so mocking it
// would only hide whether that is still true.
const TENANT = '00000000-0000-0000-0000-000000000001';
const OTHER_TENANT = '00000000-0000-0000-0000-0000000000ff';
const INSP_ID = '550e8400-e29b-41d4-a716-446655440000';
const AGR_ID = '00000000-0000-0000-0000-000000000020';
const ENVELOPE = '00000000-0000-0000-0000-000000000030';
const PUB_KEY = { pem: '-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----', fingerprint: 'fp-1' };

describe('evidence pack audit-trail identity', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    // The extracted builder takes the drizzle handle directly, so no D1 shim is
    // involved; the better-sqlite3 handle is passed as-is.
    const build = (tenantId: string, requestId: string) =>
        buildAuditTrailPayload(testDb as never, tenantId, requestId, PUB_KEY);

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);

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
            content: 'The parties agree to the following terms.', version: 1, createdAt: new Date(),
        });
        await testDb.insert(schema.inspections).values({
            id: INSP_ID, tenantId: TENANT, propertyAddress: '1 Main St',
            date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid', price: 50000,
            agreementRequired: true, paymentRequired: false, createdAt: new Date(),
        });
        await testDb.insert(agreementRequests).values({
            id: ENVELOPE, tenantId: TENANT, inspectionId: INSP_ID, agreementId: AGR_ID,
            clientEmail: 'jane@example.com', token: 'tok-1', status: 'signed',
            signerLegalName: 'Acme Holdings LLC', signerCompanyName: 'Acme Home Inspections',
            createdAt: new Date(),
        } as typeof agreementRequests.$inferInsert);
    });

    it('names the contracting entity, both the legal name and the trading name', async () => {
        const payload = await build(TENANT, ENVELOPE);
        expect(payload.contractingEntity).toEqual({
            legalName: 'Acme Holdings LLC',
            companyName: 'Acme Home Inspections',
            capturedAt: 'envelope-creation',
        });
    });

    it('a rename AFTER signing does not reach a pack assembled afterwards', async () => {
        await testDb.update(tenantConfigs)
            .set({ legalName: 'Beta Holdings LLC', companyName: 'Beta Inspections' })
            .where(eq(tenantConfigs.tenantId, TENANT));

        // POSITIVE CONTROL: the rename really landed, so the assertions below
        // are about the payload rather than about an UPDATE that matched no row.
        const cfg = await testDb.select().from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, TENANT)).get();
        expect(cfg?.legalName).toBe('Beta Holdings LLC');

        const payload = await build(TENANT, ENVELOPE);
        expect(payload.contractingEntity.legalName).toBe('Acme Holdings LLC');
        expect(payload.contractingEntity.companyName).toBe('Acme Home Inspections');
    });

    it('reports NULL for an envelope that predates identity capture, never today\'s name', async () => {
        await testDb.update(agreementRequests)
            .set({ signerLegalName: null, signerCompanyName: null })
            .where(eq(agreementRequests.id, ENVELOPE));

        const payload = await build(TENANT, ENVELOPE);
        expect(payload.contractingEntity.legalName).toBeNull();
        expect(payload.contractingEntity.companyName).toBeNull();
        // POSITIVE CONTROL for the two nulls above: a name IS resolvable from
        // tenant_configs, so null is the builder declining to use it rather than
        // there being nothing to find.
        const cfg = await testDb.select().from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, TENANT)).get();
        expect(cfg?.legalName).toBe('Acme Holdings LLC');
    });

    it('does not read another tenant\'s envelope', async () => {
        const payload = await build(OTHER_TENANT, ENVELOPE);
        expect(payload.contractingEntity.legalName).toBeNull();
        // POSITIVE CONTROL: the same envelope id under its OWN tenant resolves,
        // so the null above is the tenant filter and not a bad id.
        expect((await build(TENANT, ENVELOPE)).contractingEntity.legalName).toBe('Acme Holdings LLC');
    });

    it('still carries the key material and the event chain it always did', async () => {
        await testDb.insert(schema.esignAuditLogs).values({
            id: 'evt-1', tenantId: TENANT, requestId: ENVELOPE,
            event: 'agreement.signed', payloadJson: '{}', prevHash: null,
            hash: 'h1', signature: 'sig1', keyFingerprint: 'fp-1', createdAt: new Date(),
        } as typeof schema.esignAuditLogs.$inferInsert);

        const payload = await build(TENANT, ENVELOPE);
        expect(payload.envelopeId).toBe(ENVELOPE);
        expect(payload.algorithm).toBe('Ed25519');
        expect(payload.publicKeyPem).toBe(PUB_KEY.pem);
        expect(payload.keyFingerprint).toBe('fp-1');
        expect(payload.events).toHaveLength(1);
        expect(payload.events[0]).toMatchObject({ id: 'evt-1', event: 'agreement.signed', hash: 'h1' });
    });
});
