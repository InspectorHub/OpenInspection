import { describe, it, expectTypeOf } from 'vitest';
import { hc } from 'hono/client';
import type { InferRequestType } from 'hono/client';
import type { z } from '@hono/zod-openapi';
import type { RepairBuilderApi } from '../../../server/api/repair-builder';
import type { ItemBodySchema, ItemPatchSchema } from '../../../server/lib/validations/repair-builder.schema';

type Client = ReturnType<typeof hc<RepairBuilderApi>>;
type List = Client['repair-builder'][':tenant'][':id'];

// Compile-time only (run by `npm run test:types`). `RepairBuilderApi` is derived from `repairBuilderRouteConfigs`,
// which gathers one route from this file and the rest from two sibling definition files (crud-routes, share).
// A route left out of the list, from any of the three, fails here.
describe('RepairBuilderApi client (routes defined across three files)', () => {
    it('has exactly the two top-level segments', () => {
        expectTypeOf<keyof Client>().toEqualTypeOf<'repair-builder' | 'repair-request'>();
    });

    it('exposes the route defined in the router file', () => {
        expectTypeOf<List['source']>().toHaveProperty('$get');
    });

    it('exposes the routes defined in crud-routes', () => {
        expectTypeOf<List>().toHaveProperty('$post');
        expectTypeOf<List['lists'][':rrId']>().toHaveProperty('$get');
        expectTypeOf<List['lists'][':rrId']>().toHaveProperty('$patch');
        expectTypeOf<List['lists'][':rrId']['items']>().toHaveProperty('$post');
        expectTypeOf<List['lists'][':rrId']['items'][':itemId']>().toHaveProperty('$patch');
        expectTypeOf<List['lists'][':rrId']['items'][':itemId']>().toHaveProperty('$delete');
    });

    it('exposes the routes defined in share', () => {
        expectTypeOf<Client['repair-request']['share'][':shareToken']>().toHaveProperty('$get');
        expectTypeOf<Client['repair-request']['share'][':shareToken']['pdf']>().toHaveProperty('$get');
        expectTypeOf<Client['repair-request']['share'][':shareToken']['email']>().toHaveProperty('$post');
    });

    it('does not expose methods that nothing registered', () => {
        // @ts-expect-error the source listing is read-only
        type NoPost = List['source']['$post'];
        expectTypeOf<NoPost>().toBeAny();
    });

    it('types request bodies from the declared schemas', () => {
        type Add = InferRequestType<List['lists'][':rrId']['items']['$post']>;
        expectTypeOf<Add['json']>().toEqualTypeOf<z.input<typeof ItemBodySchema>>();
        type Patch = InferRequestType<List['lists'][':rrId']['items'][':itemId']['$patch']>;
        expectTypeOf<Patch['json']>().toEqualTypeOf<z.input<typeof ItemPatchSchema>>();
    });
});
