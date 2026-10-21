import { describe, it, expectTypeOf } from 'vitest';
import { hc } from 'hono/client';
import type { InferRequestType, InferResponseType } from 'hono/client';
import type { z } from '@hono/zod-openapi';
import type { ContactsApi } from '../../../server/api/contacts';
import type {
    ContactListQuerySchema,
    ContactResponseSchema,
    CreateContactSchema,
    UpdateContactSchema,
} from '../../../server/lib/validations/contact.schema';

type Client = ReturnType<typeof hc<ContactsApi>>;

// Compile-time only (run by `npm run test:types`). Expected shapes come from the zod schemas the
// routes declare, not from literals: a route missing from `contactRouteConfigs`, or an input/output
// that stops following its schema, fails here.
describe('ContactsApi client (derived from the route configs)', () => {
    it('exposes every route as a client method', () => {
        expectTypeOf<Client['index']>().toHaveProperty('$get');
        expectTypeOf<Client['index']>().toHaveProperty('$post');
        expectTypeOf<Client[':id']>().toHaveProperty('$get');
        expectTypeOf<Client[':id']>().toHaveProperty('$put');
        expectTypeOf<Client[':id']>().toHaveProperty('$delete');
        expectTypeOf<Client[':id']['restore']>().toHaveProperty('$post');
        expectTypeOf<Client[':id']['access']>().toHaveProperty('$get');
        expectTypeOf<Client[':id']['access']['revoke']>().toHaveProperty('$post');
    });

    it('types request inputs from the declared request schemas', () => {
        expectTypeOf<InferRequestType<Client['index']['$post']>['json']>().toEqualTypeOf<z.input<typeof CreateContactSchema>>();
        expectTypeOf<InferRequestType<Client[':id']['$put']>['json']>().toEqualTypeOf<z.input<typeof UpdateContactSchema>>();
        expectTypeOf<InferRequestType<Client[':id']['$put']>['param']>().toEqualTypeOf<{ id: string }>();
        expectTypeOf<InferRequestType<Client['index']['$get']>['query']>().toEqualTypeOf<z.input<typeof ContactListQuerySchema>>();
    });

    it('types responses from the declared response schemas', () => {
        type List = InferResponseType<Client['index']['$get'], 200>;
        type Created = InferResponseType<Client['index']['$post'], 201>;
        expectTypeOf<List['data']>().toEqualTypeOf<z.output<typeof ContactResponseSchema>[]>();
        expectTypeOf<List['meta']>().toEqualTypeOf<{ total: number }>();
        expectTypeOf<Created['data']['contact']>().toEqualTypeOf<z.output<typeof ContactResponseSchema>>();
    });
});
