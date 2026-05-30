import { describe, it, expectTypeOf, expect } from 'vitest';
import { hc } from 'hono/client';
import type { CoreAuthApi, MarketplaceApi, AdminApi, InspectionsApi } from '../../../packages/api-types';

/**
 * Phase C migration depended on the per-module `hc<TModule>` client carrying
 * method-level type info. The smoke test (`openapi-types.spec.ts`) only
 * checked that `keyof hc<T>` is non-never — i.e. that SOME route info
 * survived. This test goes deeper: it asserts that a specific path traversal
 * (`api.login`, `api.index`, etc.) resolves to something callable, not
 * `never`.
 *
 * If a `never` slips into one of these assertions, type safety is gone at
 * that depth and the Phase C migration loses its compile-time payoff.
 */
describe('typed client method-level shapes', () => {
    it('CoreAuthApi: api.login resolves to a non-never object with $post', () => {
        const api = hc<CoreAuthApi>('http://localhost');
        // The `login` property should exist (path: '/login' in auth.ts).
        expectTypeOf(api.login).not.toBeNever();
        // And `$post` should be present + callable.
        expectTypeOf(api.login.$post).not.toBeNever();
        expectTypeOf(api.login.$post).toBeFunction();
    });

    it('CoreAuthApi: api.me.$get exists (used by settings-account.tsx migration)', () => {
        const api = hc<CoreAuthApi>('http://localhost');
        expectTypeOf(api.me).not.toBeNever();
        expectTypeOf(api.me.$get).not.toBeNever();
        expectTypeOf(api.me.$get).toBeFunction();
    });

    it('MarketplaceApi: api.index.$get exists (used by marketplace.tsx migration)', () => {
        const api = hc<MarketplaceApi>('http://localhost');
        expectTypeOf(api.index).not.toBeNever();
        expectTypeOf(api.index.$get).not.toBeNever();
        expectTypeOf(api.index.$get).toBeFunction();
    });

    it('AdminApi: api.comments.$get + api.comments[":id"].touch.$post exist', () => {
        // AdminApi is the giant one (46 routes incl. /comments + /comments/:id/touch).
        // If anything is going to collapse to never, it's the deep nested admin paths.
        const api = hc<AdminApi>('http://localhost');
        expectTypeOf(api.comments).not.toBeNever();
        expectTypeOf(api.comments.$get).toBeFunction();
        expectTypeOf(api.comments[':id']).not.toBeNever();
        expectTypeOf(api.comments[':id'].touch).not.toBeNever();
        expectTypeOf(api.comments[':id'].touch.$post).toBeFunction();
    });

    it('InspectionsApi: api.templates.$get exists (used by templates.tsx)', () => {
        // InspectionsApi is the 2820-LOC monster. If TS depth is going to bust,
        // it'll bust here.
        const api = hc<InspectionsApi>('http://localhost');
        expectTypeOf(api.templates).not.toBeNever();
        expectTypeOf(api.templates.$get).toBeFunction();
    });

    it('runtime sanity: hc Proxy produces a function-shaped client', () => {
        // hc returns a Proxy that's typeof === 'function' at runtime. Just
        // confirm the client constructed without throwing.
        const api = hc<CoreAuthApi>('http://localhost');
        expect(api).toBeDefined();
        expect(api.login).toBeDefined();
    });
});
