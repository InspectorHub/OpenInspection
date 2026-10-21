import { describe, it, expectTypeOf } from 'vitest';
import { hc } from 'hono/client';
import type { InferRequestType } from 'hono/client';
import type { z } from '@hono/zod-openapi';
import type { MigrationIntakeApi } from '../../../server/api/migration-intake';
import type {
    ApplyRequestSchema,
    RemapRequestSchema,
    RepairRowRequestSchema,
} from '../../../server/lib/validations/migration-intake.schema';

type Client = ReturnType<typeof hc<MigrationIntakeApi>>;
// hc adds $url and $path helpers next to the methods; they are not routes. Routes at the root path sit under 'index'.
type Keys<T> = Exclude<keyof T, '$url' | '$path'>;

// Compile-time only (run by `npm run test:types`). `MigrationIntakeApi` is derived from `migrationIntakeRouteConfigs`,
// whose routes are defined in `migration-intake/route-definitions.ts`. A route left out of the list fails here.
describe('MigrationIntakeApi client (routes defined in a sibling file)', () => {
    it('has exactly the collection and the batch segments', () => {
        expectTypeOf<Keys<Client>>().toEqualTypeOf<'index' | ':batchId'>();
        expectTypeOf<Keys<Client['index']>>().toEqualTypeOf<'$get' | '$post'>();
        expectTypeOf<Keys<Client[':batchId']>>().toEqualTypeOf<
            '$get' | '$delete' | 'mapping' | 'rows' | 'apply' | 'revert'
        >();
    });

    it('exposes every route', () => {
        expectTypeOf<Client['index']>().toHaveProperty('$post');
        expectTypeOf<Client['index']>().toHaveProperty('$get');
        expectTypeOf<Client[':batchId']>().toHaveProperty('$get');
        expectTypeOf<Client[':batchId']>().toHaveProperty('$delete');
        expectTypeOf<Client[':batchId']['mapping']>().toHaveProperty('$patch');
        expectTypeOf<Client[':batchId']['rows'][':rowId']>().toHaveProperty('$patch');
        expectTypeOf<Client[':batchId']['apply']>().toHaveProperty('$post');
        expectTypeOf<Client[':batchId']['revert']>().toHaveProperty('$post');
    });

    it('does not expose methods that nothing registered', () => {
        // @ts-expect-error a batch cannot be replaced wholesale
        type NoPut = Client[':batchId']['$put'];
        expectTypeOf<NoPut>().toBeAny();
        // @ts-expect-error apply is POST only
        type NoGet = Client[':batchId']['apply']['$get'];
        expectTypeOf<NoGet>().toBeAny();
    });

    it('types request bodies from the declared schemas', () => {
        type Remap = InferRequestType<Client[':batchId']['mapping']['$patch']>;
        expectTypeOf<Remap['json']>().toEqualTypeOf<z.input<typeof RemapRequestSchema>>();
        type Repair = InferRequestType<Client[':batchId']['rows'][':rowId']['$patch']>;
        expectTypeOf<Repair['json']>().toEqualTypeOf<z.input<typeof RepairRowRequestSchema>>();
        type Apply = InferRequestType<Client[':batchId']['apply']['$post']>;
        expectTypeOf<Apply['json']>().toEqualTypeOf<z.input<typeof ApplyRequestSchema>>();
    });
});
