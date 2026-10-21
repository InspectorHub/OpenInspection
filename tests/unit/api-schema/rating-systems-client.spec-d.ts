import { describe, it, expectTypeOf } from 'vitest';
import { hc } from 'hono/client';
import type { InferRequestType, InferResponseType } from 'hono/client';
import type { z } from '@hono/zod-openapi';
import type { RatingSystemsApi } from '../../../server/api/rating-systems';
import type {
    CreateRatingSystemSchema,
    RatingSystemListResponseSchema,
    RatingSystemSingleResponseSchema,
} from '../../../server/lib/validations/rating-system.schema';

type Client = ReturnType<typeof hc<RatingSystemsApi>>;

// Compile-time only (run by `npm run test:types`). The expected shapes come from
// the zod schemas the routes declare, not from literals, so a route missing from
// `ratingSystemsRouteConfigs` or an input/output that stops following its schema
// fails here.
describe('RatingSystemsApi client (derived from the route configs)', () => {
    it('exposes every route as a client method', () => {
        expectTypeOf<Client>().toHaveProperty('index');
        expectTypeOf<Client['index']>().toHaveProperty('$get');
        expectTypeOf<Client['index']>().toHaveProperty('$post');
        expectTypeOf<Client[':id']>().toHaveProperty('$get');
        expectTypeOf<Client[':id']>().toHaveProperty('$put');
        expectTypeOf<Client[':id']>().toHaveProperty('$delete');
        expectTypeOf<Client[':id']['clone']>().toHaveProperty('$post');
    });

    it('types request bodies from the declared request schemas', () => {
        type Req = InferRequestType<Client['index']['$post']>;
        expectTypeOf<Req['json']>().toEqualTypeOf<z.input<typeof CreateRatingSystemSchema>>();
    });

    it('types responses from the declared response schemas', () => {
        type List = InferResponseType<Client['index']['$get']>;
        type One = InferResponseType<Client['index']['$post']>;
        expectTypeOf<List['success']>().toEqualTypeOf<z.output<typeof RatingSystemListResponseSchema>['success']>();
        expectTypeOf<One['success']>().toEqualTypeOf<z.output<typeof RatingSystemSingleResponseSchema>['success']>();
        expectTypeOf<List['data'][number]['id']>().toEqualTypeOf<string>();
        expectTypeOf<One['data']['slug']>().toEqualTypeOf<string>();
    });
});
