import { describe, it, expectTypeOf } from 'vitest';
import { hc } from 'hono/client';
import type { Hono } from 'hono';
import type { InferRequestType, InferResponseType } from 'hono/client';
import type { QboApi } from '../../../server/api/qbo';

type SchemaOf<A> = A extends Hono<infer _E, infer S, infer _B> ? S : never;
// hc adds $url and $path helpers next to the methods; they are not routes.
type Keys<T> = Exclude<keyof T, '$url' | '$path'>;
type Client = ReturnType<typeof hc<QboApi>>;

// Compile-time only (run by `npm run test:types`). The QuickBooks router was a plain `Hono` instance with an empty
// schema; every key below is new.
describe('QuickBooks admin typed client', () => {
    it('serves the eight paths of the ten routes', () => {
        expectTypeOf<keyof SchemaOf<QboApi>>().toEqualTypeOf<
            '/status' | '/disconnect' | '/pause' | '/sync' | '/errors/:id/dismiss' | '/customers' | '/credentials/check' | '/contacts/:contactId/link'
        >();
        expectTypeOf<Keys<Client['contacts'][':contactId']['link']>>().toEqualTypeOf<'$get' | '$post' | '$delete'>();
        expectTypeOf<keyof InferRequestType<Client['contacts'][':contactId']['link']['$get']>['param']>().toEqualTypeOf<'contactId'>();
    });

    it('types the status body, including a null connection', () => {
        type Body = InferResponseType<Client['status']['$get'], 200>;
        expectTypeOf<Body['success']>().toEqualTypeOf<true>();
        expectTypeOf<NonNullable<Body['data']>['credentialSource']['clientId']>().toEqualTypeOf<'env' | 'tenant' | 'missing'>();
        expectTypeOf<Body['data']>().toEqualTypeOf<NonNullable<Body['data']> | null>();
    });

    it('types the refusals the handlers return', () => {
        expectTypeOf<InferResponseType<Client['pause']['$post'], 404>['error']['code']>().toEqualTypeOf<string>();
        expectTypeOf<InferResponseType<Client['credentials']['check']['$post'], 400>['success']>().toEqualTypeOf<false>();
    });
});
