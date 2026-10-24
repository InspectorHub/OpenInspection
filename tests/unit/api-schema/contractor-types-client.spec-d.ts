import { describe, it, expectTypeOf } from 'vitest';
import { hc } from 'hono/client';
import type { InferRequestType } from 'hono/client';
import type { z } from '@hono/zod-openapi';
import type { ContractorTypesApi } from '../../../server/api/contractor-types';
import type {
    CreateContractorTypeSchema,
    ReorderContractorTypesSchema,
    UpdateContractorTypeSchema,
} from '../../../server/lib/validations/contractor-type.schema';

type Client = ReturnType<typeof hc<ContractorTypesApi>>;
// hc adds $url and $path helpers next to the methods; they are not routes.
type Keys<T> = Exclude<keyof T, '$url' | '$path'>;

// Compile-time only (run by `npm run test:types`). Expected shapes come from the zod schemas the routes
// declare, so a route missing from `contractorTypesRouteConfigs`, or an input that stops following its
// schema, fails here.
describe('ContractorTypesApi client (derived from the route configs)', () => {
    it('exposes every route as a client method and nothing else', () => {
        expectTypeOf<Keys<Client['index']>>().toEqualTypeOf<'$get' | '$post'>();
        expectTypeOf<Keys<Client[':id']>>().toEqualTypeOf<'$patch' | '$delete' | 'preflight'>();
        expectTypeOf<Keys<Client[':id']['preflight']>>().toEqualTypeOf<'$get'>();
        expectTypeOf<Keys<Client['reorder']>>().toEqualTypeOf<'$post'>();
    });

    it('types request bodies from the declared request schemas', () => {
        expectTypeOf<InferRequestType<Client['index']['$post']>['json']>().toEqualTypeOf<z.input<typeof CreateContractorTypeSchema>>();
        expectTypeOf<InferRequestType<Client[':id']['$patch']>['json']>().toEqualTypeOf<z.input<typeof UpdateContractorTypeSchema>>();
        expectTypeOf<InferRequestType<Client['reorder']['$post']>['json']>().toEqualTypeOf<z.input<typeof ReorderContractorTypesSchema>>();
    });

    it('has no write on the preflight and no unknown path', () => {
        // @ts-expect-error preflight is read-only
        type NoPost = Client[':id']['preflight']['$post'];
        expectTypeOf<NoPost>().toBeAny();
        // @ts-expect-error no such path
        type Missing = Client['archive'];
        expectTypeOf<Missing>().toBeAny();
    });
});
