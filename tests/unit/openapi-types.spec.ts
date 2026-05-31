import { describe, it, expectTypeOf } from 'vitest';
import type {
    CoreAuthApi,
    MarketplaceApi,
    AdminApi,
    InspectionsApi,
    BookingsApi,
    TeamApi,
    InspectionPrefsApi,
} from '../../../packages/api-types';
import { hc } from 'hono/client';

/**
 * Smoke test: if any sub-router silently regresses to void `.openapi()` calls
 * (separate statements instead of a single chain), the per-module type
 * collapses to the bare `OpenAPIHono` instance and the route schemas
 * disappear. We assert each per-module type has SOME route info by
 * checking `keyof hc<T>()` is not `never`.
 */
describe('per-module API types carry route info', () => {
    it('CoreAuthApi exposes routes via hc client', () => {
        type C = ReturnType<typeof hc<CoreAuthApi>>;
        expectTypeOf<keyof C>().not.toEqualTypeOf<never>();
    });
    it('MarketplaceApi exposes routes', () => {
        type C = ReturnType<typeof hc<MarketplaceApi>>;
        expectTypeOf<keyof C>().not.toEqualTypeOf<never>();
    });
    it('AdminApi exposes routes', () => {
        type C = ReturnType<typeof hc<AdminApi>>;
        expectTypeOf<keyof C>().not.toEqualTypeOf<never>();
    });
    it('InspectionsApi exposes routes', () => {
        type C = ReturnType<typeof hc<InspectionsApi>>;
        expectTypeOf<keyof C>().not.toEqualTypeOf<never>();
    });
    it('BookingsApi exposes routes', () => {
        type C = ReturnType<typeof hc<BookingsApi>>;
        expectTypeOf<keyof C>().not.toEqualTypeOf<never>();
    });
    it('TeamApi exposes routes', () => {
        type C = ReturnType<typeof hc<TeamApi>>;
        expectTypeOf<keyof C>().not.toEqualTypeOf<never>();
    });
    it('InspectionPrefsApi exposes routes', () => {
        type C = ReturnType<typeof hc<InspectionPrefsApi>>;
        expectTypeOf<keyof C>().not.toEqualTypeOf<never>();
    });
});
