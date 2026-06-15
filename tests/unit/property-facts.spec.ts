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
import { InspectionService } from '../../server/services/inspection.service';
import { PropertyFactsSchema, UpdateInspectionSchema } from '../../server/lib/validations/inspection.schema';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
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
});

describe('UpdateInspectionSchema — G2 closingDate / G3 orderId / G3 referralSource', () => {
    it('accepts all three new fields', () => {
        const parsed = UpdateInspectionSchema.parse({
            closingDate:    '2026-07-15',
            orderId:        'ORD-2026-0142',
            referralSource: 'Realtor',
        });
        expect(parsed.closingDate).toBe('2026-07-15');
        expect(parsed.orderId).toBe('ORD-2026-0142');
        expect(parsed.referralSource).toBe('Realtor');
    });

    it('null clears each new field', () => {
        const parsed = UpdateInspectionSchema.parse({
            closingDate:    null,
            orderId:        null,
            referralSource: null,
        });
        expect(parsed.closingDate).toBeNull();
        expect(parsed.orderId).toBeNull();
        expect(parsed.referralSource).toBeNull();
    });

    it('rejects malformed closingDate', () => {
        expect(() => UpdateInspectionSchema.parse({ closingDate: '07/15/2026' })).toThrow();
        expect(() => UpdateInspectionSchema.parse({ closingDate: '2026-7-15' })).toThrow();
    });

    it('rejects orderId longer than 64 chars', () => {
        expect(() => UpdateInspectionSchema.parse({ orderId: 'X'.repeat(65) })).toThrow();
    });
});
