import { describe, it, expect } from 'vitest';
import { computePublishReadinessFromState, resolveRequireDefectFields } from '../../server/services/inspection.service';

// Track H (IA-7) — two-level inheritance: override (NULL = inherit) beats
// the tenant default; both unset → loose.
describe('resolveRequireDefectFields', () => {
    it('override wins over tenant default', () => {
        expect(resolveRequireDefectFields('both', 'none')).toBe('both');
        expect(resolveRequireDefectFields('none', 'both')).toBe('none');
    });
    it('null/undefined override inherits the tenant default', () => {
        expect(resolveRequireDefectFields(null, 'location')).toBe('location');
        expect(resolveRequireDefectFields(undefined, 'trade')).toBe('trade');
    });
    it('both unset → none (loose)', () => {
        expect(resolveRequireDefectFields(null, null)).toBe('none');
        expect(resolveRequireDefectFields(undefined, undefined)).toBe('none');
    });
});

describe('computePublishReadinessFromState', () => {
    const schema = {
        sections: [{
            id: 'sec1', title: 'Roof', items: [{
                id: 'item1', label: 'Roof Covering', type: 'rich',
                tabs: { information: [], limitations: [], defects: [
                    { id: 'rd1', title: 'Missing shingles', category: 'safety', location: '', comment: 'Repair at {{location}} by {{trade}}.', photos: [], default: false },
                ] },
            }],
        }],
    } as any;

    it('returns ready=true when all included defects have location + trade', () => {
        const results = {
            item1: { tabs: { defects: [{
                cannedId: 'rd1', included: true,
                location: 'SE corner', trade: 'licensed-roofer',
            }] } },
        };
        const r = computePublishReadinessFromState(schema, results);
        expect(r.ready).toBe(true);
        expect(r.blockingDefects).toHaveLength(0);
    });

    it('blocks when location is missing on an included defect', () => {
        const results = {
            item1: { tabs: { defects: [{
                cannedId: 'rd1', included: true, trade: 'licensed-roofer',
            }] } },
        };
        const r = computePublishReadinessFromState(schema, results);
        expect(r.ready).toBe(false);
        expect(r.blockingDefects).toHaveLength(1);
        expect(r.blockingDefects[0].missing).toEqual(['location']);
    });

    it('blocks when trade is missing', () => {
        const results = {
            item1: { tabs: { defects: [{
                cannedId: 'rd1', included: true, location: 'SE corner',
            }] } },
        };
        const r = computePublishReadinessFromState(schema, results);
        expect(r.ready).toBe(false);
        expect(r.blockingDefects[0].missing).toEqual(['trade']);
    });

    it('ignores non-included defects', () => {
        const results = {
            item1: { tabs: { defects: [{
                cannedId: 'rd1', included: false,
            }] } },
        };
        const r = computePublishReadinessFromState(schema, results);
        expect(r.ready).toBe(true);
    });

    // Track H (IA-7) — configurable requirement matrix. Token-free comment so
    // only the FIELD policy is exercised (unresolved tokens always block and
    // would mask the requirement behavior).
    describe('requirement matrix (IA-7)', () => {
        const tokenFreeSchema = {
            sections: [{
                id: 'sec1', title: 'Roof', items: [{
                    id: 'item1', label: 'Roof Covering', type: 'rich',
                    tabs: { information: [], limitations: [], defects: [
                        { id: 'rd1', title: 'Missing shingles', category: 'safety', location: '', comment: 'Repair promptly.', photos: [], default: false },
                    ] },
                }],
            }],
        } as any;
        // Included defect with BOTH fields empty.
        const bothMissing = {
            item1: { tabs: { defects: [{ cannedId: 'rd1', included: true }] } },
        };

        it("'none' — gaps warn, never block", () => {
            const r = computePublishReadinessFromState(tokenFreeSchema, bothMissing, 'none');
            expect(r.ready).toBe(true);
            expect(r.blockingDefects).toHaveLength(0);
            expect(r.warningDefects).toHaveLength(1);
            expect(r.warningDefects[0].missing).toEqual(['location', 'trade']);
        });

        it("'location' — missing location blocks; trade-only gap warns", () => {
            const r1 = computePublishReadinessFromState(tokenFreeSchema, bothMissing, 'location');
            expect(r1.ready).toBe(false);
            expect(r1.blockingDefects).toHaveLength(1);

            const tradeOnlyGap = {
                item1: { tabs: { defects: [{ cannedId: 'rd1', included: true, location: 'attic' }] } },
            };
            const r2 = computePublishReadinessFromState(tokenFreeSchema, tradeOnlyGap, 'location');
            expect(r2.ready).toBe(true);
            expect(r2.warningDefects).toHaveLength(1);
            expect(r2.warningDefects[0].missing).toEqual(['trade']);
        });

        it("'trade' — missing trade blocks; location-only gap warns", () => {
            const tradeGap = {
                item1: { tabs: { defects: [{ cannedId: 'rd1', included: true, location: 'attic' }] } },
            };
            const r1 = computePublishReadinessFromState(tokenFreeSchema, tradeGap, 'trade');
            expect(r1.ready).toBe(false);
            expect(r1.blockingDefects[0].missing).toEqual(['trade']);

            const locationGap = {
                item1: { tabs: { defects: [{ cannedId: 'rd1', included: true, trade: 'licensed-roofer' }] } },
            };
            const r2 = computePublishReadinessFromState(tokenFreeSchema, locationGap, 'trade');
            expect(r2.ready).toBe(true);
            expect(r2.warningDefects[0].missing).toEqual(['location']);
        });

        it("'both' (default) — any gap blocks, warnings stay empty", () => {
            const r = computePublishReadinessFromState(tokenFreeSchema, bothMissing);
            expect(r.ready).toBe(false);
            expect(r.blockingDefects).toHaveLength(1);
            expect(r.warningDefects).toHaveLength(0);
        });

        it("unresolved tokens block even under 'none'", () => {
            const r = computePublishReadinessFromState(schema, bothMissing, 'none');
            expect(r.ready).toBe(false);
            expect(r.blockingDefects).toHaveLength(1);
            expect(r.blockingDefects[0].unresolvedTokens).toEqual(['location', 'trade']);
        });

        it('complete defect produces neither blocks nor warnings under any requirement', () => {
            const complete = {
                item1: { tabs: { defects: [{ cannedId: 'rd1', included: true, location: 'attic', trade: 'licensed-roofer' }] } },
            };
            for (const req of ['none', 'location', 'trade', 'both'] as const) {
                const r = computePublishReadinessFromState(tokenFreeSchema, complete, req);
                expect(r.ready).toBe(true);
                expect(r.blockingDefects).toHaveLength(0);
                expect(r.warningDefects).toHaveLength(0);
            }
        });
    });

    it('accepts template default location as a fallback when state.location is empty', () => {
        const schemaWithDefault = {
            sections: [{
                id: 'sec1', title: 'Roof', items: [{
                    id: 'item1', label: 'Roof Covering', type: 'rich',
                    tabs: { information: [], limitations: [], defects: [
                        { id: 'rd1', title: 'X', category: 'safety', location: 'pre-filled', comment: 'X', photos: [], default: false },
                    ] },
                }],
            }],
        } as any;
        const results = {
            item1: { tabs: { defects: [{
                cannedId: 'rd1', included: true, trade: 'licensed-roofer',
            }] } },
        };
        const r = computePublishReadinessFromState(schemaWithDefault, results);
        expect(r.ready).toBe(true);
    });
});
