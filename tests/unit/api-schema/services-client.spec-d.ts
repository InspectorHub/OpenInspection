import { describe, it, expectTypeOf } from 'vitest';
import { hc } from 'hono/client';
import type { Hono } from 'hono';
import type { InferRequestType, InferResponseType } from 'hono/client';
import type { z } from '@hono/zod-openapi';
import type { ServicesApi } from '../../../server/api/services';
import type {
    CreateDiscountCodeSchema,
    CreatePayRuleSchema,
    CreateServiceSchema,
    ServiceListResponseSchema,
    ServiceResponseSchema,
    SetServiceInspectorsSchema,
    UpdateServiceSchema,
    ValidateDiscountSchema,
} from '../../../server/lib/validations/service.schema';

type Client = ReturnType<typeof hc<ServicesApi>>;
type SchemaOf<A> = A extends Hono<infer _E, infer S, infer _B> ? S : never;
// hc adds $url and $path helpers next to the methods; they are not routes. Routes at the root path sit under 'index'.
type Keys<T> = Exclude<keyof T, '$url' | '$path'>;

/** Every path the services router served when it was one chain, read from the declaration that chain produced. */
type ChainPaths =
    | '/'
    | '/:id'
    | '/:id/inspectors'
    | '/:id/pay-rules'
    | '/:id/pay-rules/:ruleId'
    | '/discount-codes'
    | '/discount-codes/:id'
    | '/discount/validate'
    | '/inspectors-by-service'
    | '/pay-rules-by-service';

// Compile-time only. `ServicesApi` is derived from `servicesRouteConfigs`; a route left out of the list, or one that
// moves a path, fails here. Expected shapes come from the zod schemas.
describe('ServicesApi client', () => {
    it('serves exactly the paths the chained router served', () => {
        expectTypeOf<keyof SchemaOf<ServicesApi>>().toEqualTypeOf<ChainPaths>();
    });

    it('has the same top-level segments and methods', () => {
        expectTypeOf<Keys<Client>>().toEqualTypeOf<
            'index' | ':id' | 'discount-codes' | 'discount' | 'inspectors-by-service' | 'pay-rules-by-service'
        >();
        expectTypeOf<Keys<Client['index']>>().toEqualTypeOf<'$get' | '$post'>();
        expectTypeOf<Keys<Client[':id']>>().toEqualTypeOf<'$put' | '$delete' | 'inspectors' | 'pay-rules'>();
        expectTypeOf<Keys<Client['discount-codes']>>().toEqualTypeOf<'$get' | '$post' | ':id'>();
        expectTypeOf<Keys<Client[':id']['pay-rules']>>().toEqualTypeOf<'$get' | '$post' | ':ruleId'>();
    });

    it('types the catalog routes from their declared schemas', () => {
        type Create = InferRequestType<Client['index']['$post']>;
        expectTypeOf<Create['json']>().toEqualTypeOf<z.input<typeof CreateServiceSchema>>();
        type Created = InferResponseType<Client['index']['$post'], 201>;
        expectTypeOf<Created>().toEqualTypeOf<z.output<typeof ServiceResponseSchema>>();
        type List = InferResponseType<Client['index']['$get'], 200>;
        expectTypeOf<List>().toEqualTypeOf<z.output<typeof ServiceListResponseSchema>>();
        type Update = InferRequestType<Client[':id']['$put']>;
        expectTypeOf<Update['json']>().toEqualTypeOf<z.input<typeof UpdateServiceSchema>>();
        expectTypeOf<keyof Update['param']>().toEqualTypeOf<'id'>();
    });

    it('types the nested resources from their declared schemas', () => {
        type Restrict = InferRequestType<Client[':id']['inspectors']['$put']>;
        expectTypeOf<Restrict['json']>().toEqualTypeOf<z.input<typeof SetServiceInspectorsSchema>>();
        type Rule = InferRequestType<Client[':id']['pay-rules']['$post']>;
        expectTypeOf<Rule['json']>().toEqualTypeOf<z.input<typeof CreatePayRuleSchema>>();
        expectTypeOf<keyof InferRequestType<Client[':id']['pay-rules'][':ruleId']['$delete']>['param']>().toEqualTypeOf<'id' | 'ruleId'>();
        type Code = InferRequestType<Client['discount-codes']['$post']>;
        expectTypeOf<Code['json']>().toEqualTypeOf<z.input<typeof CreateDiscountCodeSchema>>();
        type Validate = InferRequestType<Client['discount']['validate']['$post']>;
        expectTypeOf<Validate['json']>().toEqualTypeOf<z.input<typeof ValidateDiscountSchema>>();
    });

    it('does not expose methods or paths that nothing registered', () => {
        // @ts-expect-error no such path
        type Missing = Client['packages'];
        expectTypeOf<Missing>().toBeAny();
        // @ts-expect-error a service is replaced or removed, never read on its own
        type NoGet = Client[':id']['$get'];
        expectTypeOf<NoGet>().toBeAny();
        // @ts-expect-error validating a code is POST only
        type NoValidateGet = Client['discount']['validate']['$get'];
        expectTypeOf<NoValidateGet>().toBeAny();
    });
});
