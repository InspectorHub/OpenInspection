import { describe, it, expectTypeOf } from 'vitest';
import { hc } from 'hono/client';
import type { InferRequestType, InferResponseType } from 'hono/client';
import type { z } from '@hono/zod-openapi';
import type { SecretsApi, SecretsInputSchema, SecretsResponseSchema } from '../../../server/api/secrets';

type Client = ReturnType<typeof hc<SecretsApi>>;
// hc adds $url and $path helpers next to the methods; they are not routes.
type Keys<T> = Exclude<keyof T, '$url' | '$path'>;

// Compile-time only (run by `npm run test:types`). `SecretsApi` is derived from `secretsRouteConfigs`: three routes
// on one path, one per method. A route left out of the list fails here.
describe('SecretsApi client (one path, three methods)', () => {
    it('has the single path segment and all three methods', () => {
        expectTypeOf<keyof Client>().toEqualTypeOf<'secrets'>();
        expectTypeOf<Keys<Client['secrets']>>().toEqualTypeOf<'$get' | '$put' | '$post'>();
    });

    it('does not expose a method that nothing registered', () => {
        // @ts-expect-error secrets cannot be deleted through this router
        type NoDelete = Client['secrets']['$delete'];
        expectTypeOf<NoDelete>().toBeAny();
    });

    it('types the routes from their declared schemas', () => {
        type Read = InferResponseType<Client['secrets']['$get'], 200>;
        expectTypeOf<Read>().toEqualTypeOf<z.output<typeof SecretsResponseSchema>>();
        type Put = InferRequestType<Client['secrets']['$put']>;
        expectTypeOf<Put['json']>().toEqualTypeOf<z.input<typeof SecretsInputSchema>>();
        type Post = InferRequestType<Client['secrets']['$post']>;
        expectTypeOf<Post['json']>().toEqualTypeOf<z.input<typeof SecretsInputSchema>>();
    });
});
