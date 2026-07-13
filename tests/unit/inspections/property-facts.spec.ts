/**
 * Round-2 backlog G1 (Spectora §E.2) — InspectionService.updatePropertyFacts
 * + getPropertyFacts unit coverage.
 *
 * Asserts:
 *   - Six dedicated columns round-trip in/out.
 *   - Partial patches leave un-named fields untouched.
 *   - Null clears a field.
 *   - Cross-tenant calls are rejected.
 *   - Zod parse on the new PATCH payload.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { InspectionService } from '../../../server/services/inspection.service';
import { PropertyFactsSchema, UpdateInspectionSchema } from '../../../server/lib/validations/inspection.schema';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const TENANT_B = '00000000-0000-0000-0000-000000000002';

describe('InspectionService.updatePropertyFacts (G1)', () => {
    let svc: InspectionService;
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        svc = new InspectionService({} as D1Database);

        await testDb.insert(schema.tenants).values([
            { id: TENANT_A, name: 'Acme',   slug: 'acme',   status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
            { id: TENANT_B, name: 'Globex', slug: 'globex', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
        await testDb.insert(schema.inspections).values([
            { id: 'insp-A', tenantId: TENANT_A, propertyAddress: '1 Main St', clientName: 'A', date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid', price: 0, paymentRequired: false, agreementRequired: false, createdAt: new Date() },
            { id: 'insp-B', tenantId: TENANT_B, propertyAddress: '2 Elm Rd',  clientName: 'B', date: '2026-06-02', status: 'requested', paymentStatus: 'unpaid', price: 0, paymentRequired: false, agreementRequired: false, createdAt: new Date() },
        ]);
    });

    it('round-trips all six fields', async () => {
        const out = await svc.updatePropertyFacts('insp-A', TENANT_A, {
            yearBuilt:      1990,
            sqft:           1800,
            foundationType: 'basement',
            lotSize:        '0.25 acres',
            bedrooms:       3,
            bathrooms:      2.5,
        });
        expect(out).toEqual({
            yearBuilt:      1990,
            sqft:           1800,
            foundationType: 'basement',
            lotSize:        '0.25 acres',
            bedrooms:       3,
            bathrooms:      2.5,
        });
    });

    it('partial patch keeps unrelated columns intact', async () => {
        await svc.updatePropertyFacts('insp-A', TENANT_A, {
            yearBuilt: 1990,
            sqft: 1800,
        });
        const after = await svc.updatePropertyFacts('insp-A', TENANT_A, {
            // Only bathrooms — yearBuilt + sqft must survive.
            bathrooms: 2,
        });
        expect(after.yearBuilt).toBe(1990);
        expect(after.sqft).toBe(1800);
        expect(after.bathrooms).toBe(2);
        expect(after.bedrooms).toBeNull();
    });

    it('null clears a previously set value', async () => {
        await svc.updatePropertyFacts('insp-A', TENANT_A, {
            lotSize: '0.5 acres',
            yearBuilt: 1985,
        });
        const cleared = await svc.updatePropertyFacts('insp-A', TENANT_A, {
            lotSize: null,
        });
        expect(cleared.lotSize).toBeNull();
        // yearBuilt untouched.
        expect(cleared.yearBuilt).toBe(1985);
    });

    it('rejects cross-tenant access', async () => {
        await expect(
            svc.updatePropertyFacts('insp-B', TENANT_A, { yearBuilt: 2000 })
        ).rejects.toThrow(/not found/i);
    });

    // Commercial PCA Phase T — commercial_subtype capture, mirroring the
    // reportTier write path exactly. Not part of the six-field PropertyFacts
    // return type (same treatment as reportTier — write-only through this
    // endpoint; read back via the inspection row / report payload), so we
    // assert directly against the stored column.
    it('persists commercialSubtype to the inspections row', async () => {
        await svc.updatePropertyFacts('insp-A', TENANT_A, { commercialSubtype: 'office' });
        const row = await testDb.select({ commercialSubtype: schema.inspections.commercialSubtype })
            .from(schema.inspections)
            .where(eq(schema.inspections.id, 'insp-A'))
            .get();
        expect(row?.commercialSubtype).toBe('office');
    });

    it('a commercialSubtype-only patch leaves other columns untouched', async () => {
        await svc.updatePropertyFacts('insp-A', TENANT_A, { yearBuilt: 1990 });
        await svc.updatePropertyFacts('insp-A', TENANT_A, { commercialSubtype: 'retail' });
        const after = await svc.getPropertyFacts('insp-A', TENANT_A);
        expect(after.yearBuilt).toBe(1990);
    });

    it('null clears a previously set commercialSubtype', async () => {
        await svc.updatePropertyFacts('insp-A', TENANT_A, { commercialSubtype: 'industrial' });
        await svc.updatePropertyFacts('insp-A', TENANT_A, { commercialSubtype: null });
        const row = await testDb.select({ commercialSubtype: schema.inspections.commercialSubtype })
            .from(schema.inspections)
            .where(eq(schema.inspections.id, 'insp-A'))
            .get();
        expect(row?.commercialSubtype).toBeNull();
    });

    it('accepts an org-custom commercialSubtype string (not one of the 6 platform ids)', async () => {
        await svc.updatePropertyFacts('insp-A', TENANT_A, { commercialSubtype: 'custom-boutique-hotel' });
        const row = await testDb.select({ commercialSubtype: schema.inspections.commercialSubtype })
            .from(schema.inspections)
            .where(eq(schema.inspections.id, 'insp-A'))
            .get();
        expect(row?.commercialSubtype).toBe('custom-boutique-hotel');
    });

    it('getPropertyFacts returns nulls when never set', async () => {
        const facts = await svc.getPropertyFacts('insp-A', TENANT_A);
        expect(facts).toEqual({
            yearBuilt:      null,
            sqft:           null,
            foundationType: null,
            lotSize:        null,
            bedrooms:       null,
            bathrooms:      null,
        });
    });

    // Commercial subtype-preset persist (design 2026-07-13). Non-dedicated
    // preset fields (nra, floorCount, ...) ride the property_facts JSON
    // envelope. Asserted directly against the stored column — same treatment
    // as commercialSubtype (write-only through this endpoint; read back via the
    // inspection row / report payload, NOT the 6-field PropertyFacts return).
    async function readEnvelope(id: string): Promise<Record<string, unknown> | null> {
        const row = await testDb.select({ propertyFacts: schema.inspections.propertyFacts })
            .from(schema.inspections)
            .where(eq(schema.inspections.id, id))
            .get();
        return (row?.propertyFacts as Record<string, unknown> | null) ?? null;
    }

    it('persists metadata into the property_facts envelope', async () => {
        await svc.updatePropertyFacts('insp-A', TENANT_A, {
            yearBuilt: 1998,
            metadata: { nra: 42000, sprinklered: 'Full', floorCount: 4 },
        });
        expect(await readEnvelope('insp-A')).toMatchObject({ nra: 42000, sprinklered: 'Full', floorCount: 4 });
    });

    it('null in metadata clears a key without touching siblings', async () => {
        await svc.updatePropertyFacts('insp-A', TENANT_A, { metadata: { nra: 42000, floorCount: 4 } });
        await svc.updatePropertyFacts('insp-A', TENANT_A, { metadata: { nra: null } });
        const env = await readEnvelope('insp-A');
        expect(env).not.toHaveProperty('nra');
        expect(env).toMatchObject({ floorCount: 4 });
    });

    it('a dedicated key never leaks into the envelope', async () => {
        await svc.updatePropertyFacts('insp-A', TENANT_A, { yearBuilt: 2001, metadata: { nra: 100 } });
        const env = await readEnvelope('insp-A');
        expect(env).not.toHaveProperty('yearBuilt');
        expect(env).toMatchObject({ nra: 100 });
    });

    it('a strip-only patch (no metadata) leaves the envelope untouched', async () => {
        await svc.updatePropertyFacts('insp-A', TENANT_A, { metadata: { nra: 999 } });
        await svc.updatePropertyFacts('insp-A', TENANT_A, { yearBuilt: 1970 });
        expect(await readEnvelope('insp-A')).toMatchObject({ nra: 999 });
    });
});

describe('PropertyFactsSchema (Zod)', () => {
    it('accepts a complete payload', () => {
        const parsed = PropertyFactsSchema.parse({
            yearBuilt: 1990, sqft: 1800, foundationType: 'slab',
            lotSize: '0.5 acres', bedrooms: 3, bathrooms: 2.5,
        });
        expect(parsed.yearBuilt).toBe(1990);
        expect(parsed.foundationType).toBe('slab');
    });

    it('accepts an empty payload (partial patch)', () => {
        const parsed = PropertyFactsSchema.parse({});
        expect(parsed).toEqual({});
    });

    it('accepts null to clear a field', () => {
        const parsed = PropertyFactsSchema.parse({ lotSize: null, yearBuilt: null });
        expect(parsed.lotSize).toBeNull();
        expect(parsed.yearBuilt).toBeNull();
    });

    it('rejects out-of-range yearBuilt', () => {
        expect(() => PropertyFactsSchema.parse({ yearBuilt: 1500 })).toThrow();
        expect(() => PropertyFactsSchema.parse({ yearBuilt: 3000 })).toThrow();
    });

    it('rejects unknown foundationType', () => {
        expect(() => PropertyFactsSchema.parse({ foundationType: 'pier' })).toThrow();
    });

    it('rejects negative sqft', () => {
        expect(() => PropertyFactsSchema.parse({ sqft: -1 })).toThrow();
    });

    // Commercial PCA Phase T — commercial_subtype capture. commercial_subtype
    // is plain text (not an enum): org-custom subtypes live in the
    // commercial_subtypes table alongside the 6 locked platform ids, so the
    // schema is deliberately permissive and must NOT hard-reject unknown
    // strings.
    it('accepts a platform commercialSubtype id', () => {
        const parsed = PropertyFactsSchema.parse({ commercialSubtype: 'office' });
        expect(parsed.commercialSubtype).toBe('office');
    });

    it('accepts an org-custom commercialSubtype string', () => {
        const parsed = PropertyFactsSchema.parse({ commercialSubtype: 'custom-boutique-hotel' });
        expect(parsed.commercialSubtype).toBe('custom-boutique-hotel');
    });

    it('accepts null to clear commercialSubtype', () => {
        const parsed = PropertyFactsSchema.parse({ commercialSubtype: null });
        expect(parsed.commercialSubtype).toBeNull();
    });

    it('rejects a commercialSubtype longer than 64 chars', () => {
        expect(() => PropertyFactsSchema.parse({ commercialSubtype: 'x'.repeat(65) })).toThrow();
    });
});

describe('UpdateInspectionSchema — G2 closingDate / G3 referenceNumber / G3 referralSource', () => {
    it('accepts all three new fields', () => {
        const parsed = UpdateInspectionSchema.parse({
            closingDate:    '2026-07-15',
            referenceNumber:        'REF-2026-0142',
            referralSource: 'Realtor',
        });
        expect(parsed.closingDate).toBe('2026-07-15');
        expect(parsed.referenceNumber).toBe('REF-2026-0142');
        expect(parsed.referralSource).toBe('Realtor');
    });

    it('null clears each new field', () => {
        const parsed = UpdateInspectionSchema.parse({
            closingDate:    null,
            referenceNumber:        null,
            referralSource: null,
        });
        expect(parsed.closingDate).toBeNull();
        expect(parsed.referenceNumber).toBeNull();
        expect(parsed.referralSource).toBeNull();
    });

    it('rejects malformed closingDate', () => {
        expect(() => UpdateInspectionSchema.parse({ closingDate: '07/15/2026' })).toThrow();
        expect(() => UpdateInspectionSchema.parse({ closingDate: '2026-7-15' })).toThrow();
    });

    it('rejects referenceNumber longer than 64 chars', () => {
        expect(() => UpdateInspectionSchema.parse({ referenceNumber: 'X'.repeat(65) })).toThrow();
    });
});
