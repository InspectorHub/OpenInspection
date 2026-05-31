/**
 * Design System 0520 subsystem E P1.2 — pre-flight aggregator tests.
 *
 * Pure helper signature lets us assert each gate independently without
 * any DB plumbing. The service wrapper in inspection.service.ts loads
 * the inspection + parses inspection_results.data and delegates here.
 */
import { describe, it, expect } from 'vitest';
import { computePreflightFromData } from '../../server/lib/preflight';

const baseInspection = {
    coverPhotoId:     null,
    propertyFacts:    null,
    agreementSignedAt: null,
};

describe('computePreflightFromData (subsystem E P1.2)', () => {
    it('allRated false when any item lacks rating AND value', () => {
        const out = computePreflightFromData(
            { ...baseInspection },
            { 'i-1': { rating: 'sat' }, 'i-2': { rating: null, value: null } },
            0,
        );
        expect(out.allRated).toBe(false);
        expect(out.unratedCount).toBe(1);
    });

    it('allRated true when every item has rating or value', () => {
        const out = computePreflightFromData(
            { ...baseInspection },
            { 'i-1': { rating: 'sat' }, 'i-2': { value: true } },
            0,
        );
        expect(out.allRated).toBe(true);
        expect(out.unratedCount).toBe(0);
    });

    it('allRated false when no items exist at all (empty inspection blocks publish)', () => {
        const out = computePreflightFromData({ ...baseInspection }, {}, 0);
        expect(out.allRated).toBe(false);
    });

    it('propertyFactsComplete requires all 5 keys present', () => {
        const out = computePreflightFromData(
            { ...baseInspection, propertyFacts: { year_built: 1973, sqft: 1840 } },
            { 'i-1': { rating: 'sat' } },
            0,
        );
        expect(out.propertyFactsComplete).toBe(false);
        expect(out.missingFacts).toEqual(['foundation', 'bedrooms', 'bathrooms']);
    });

    it('propertyFactsComplete true with all 5 keys', () => {
        const out = computePreflightFromData(
            { ...baseInspection, propertyFacts: {
                year_built: 1973, sqft: 1840, foundation: 'slab',
                bedrooms: 3, bathrooms: 2,
            } },
            { 'i-1': { rating: 'sat' } },
            0,
        );
        expect(out.propertyFactsComplete).toBe(true);
        expect(out.missingFacts).toEqual([]);
    });

    it('coverPhotoSet reflects the column presence', () => {
        const a = computePreflightFromData({ ...baseInspection, coverPhotoId: 'p-1' }, { 'i-1': { rating: 'sat' } }, 0);
        const b = computePreflightFromData({ ...baseInspection, coverPhotoId: null }, { 'i-1': { rating: 'sat' } }, 0);
        expect(a.coverPhotoSet).toBe(true);
        expect(b.coverPhotoSet).toBe(false);
    });

    it('apprenticeReviewed false when pendingCount > 0', () => {
        const out = computePreflightFromData({ ...baseInspection }, { 'i-1': { rating: 'sat' } }, 2);
        expect(out.apprenticeReviewed).toBe(false);
        expect(out.apprenticePending).toBe(2);
    });

    it('apprenticeReviewed true when pendingCount is undefined (subsystem C absent — graceful no-op)', () => {
        const out = computePreflightFromData({ ...baseInspection }, { 'i-1': { rating: 'sat' } }, undefined);
        expect(out.apprenticeReviewed).toBe(true);
        expect(out.apprenticePending).toBe(0);
    });

    it('agreementSigned reflects the timestamp column', () => {
        const a = computePreflightFromData({ ...baseInspection, agreementSignedAt: 1_700_000_000 }, { 'i-1': { rating: 'sat' } }, 0);
        const b = computePreflightFromData({ ...baseInspection, agreementSignedAt: null }, { 'i-1': { rating: 'sat' } }, 0);
        expect(a.agreementSigned).toBe(true);
        expect(b.agreementSigned).toBe(false);
    });
});
