import { describe, it, expectTypeOf } from 'vitest';
import type { InspectionService } from '../../../server/services/inspection.service';
import type { InspectionScope } from '../../../server/lib/inspection/visibility';

/**
 * The scope is a REQUIRED parameter of every method that returns a set of inspections (or counts
 * of them). A required parameter is what turns a forgotten scope into a compile error instead of
 * a silent leak; these assertions fail if one of them is ever made optional or widened.
 *
 * Type-only on purpose: the declarations are what drift, and a runtime test cannot see an
 * optional parameter that every current caller happens to pass.
 */
describe('inspection set reads take a required InspectionScope', () => {
    it('listInspections(tenantId, params, scope)', () => {
        expectTypeOf<Parameters<InspectionService['listInspections']>[2]>().toEqualTypeOf<InspectionScope>();
    });
    it('getStats(tenantId, scope)', () => {
        expectTypeOf<Parameters<InspectionService['getStats']>[1]>().toEqualTypeOf<InspectionScope>();
    });
    it('getCounts(tenantId, scope)', () => {
        expectTypeOf<Parameters<InspectionService['getCounts']>[1]>().toEqualTypeOf<InspectionScope>();
    });
    it('getDashboardBuckets(tenantId, scope)', () => {
        expectTypeOf<Parameters<InspectionService['getDashboardBuckets']>[1]>().toEqualTypeOf<InspectionScope>();
    });
    it('createFromWizard(tenantId, creatorUserId, input, scope)', () => {
        expectTypeOf<Parameters<InspectionService['createFromWizard']>[3]>().toEqualTypeOf<InspectionScope>();
    });
    it('calling without the scope does not compile', () => {
        type Call = (svc: InspectionService) => unknown;
        const ok: Call = (svc) => svc.getCounts('t', { kind: 'all' });
        // @ts-expect-error the scope argument is required
        const missing: Call = (svc) => svc.getCounts('t');
        void ok; void missing;
    });
});
