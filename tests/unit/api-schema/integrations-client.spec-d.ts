import { describe, it, expectTypeOf } from 'vitest';
import { hc } from 'hono/client';
import type { InferRequestType, InferResponseType } from 'hono/client';
import type { z } from '@hono/zod-openapi';
import type { IntegrationsApi } from '../../../server/api/integrations';
import type { EmailValidateBodySchema, EmailValidateOkSchema } from '../../../server/lib/validations/integrations.schema';
import type { IntegrationOverviewResponseSchema } from '../../../server/lib/validations/integrations-overview.schema';

type Client = ReturnType<typeof hc<IntegrationsApi>>;

// Compile-time only (run by `npm run test:types`). `IntegrationsApi` mixes routes the router registers itself with one
// child router mounted at a non-root prefix, so this fails if the mount is dropped or lands at the wrong path.
describe('IntegrationsApi client (routes plus a child mounted at /overview)', () => {
    it('exposes the router own routes and the mounted child', () => {
        expectTypeOf<Client['status']>().toHaveProperty('$get');
        expectTypeOf<Client['test-results']>().toHaveProperty('$get');
        expectTypeOf<Client['stripe']['test']>().toHaveProperty('$post');
        expectTypeOf<Client['email']['validate']>().toHaveProperty('$post');
        // integrations-overview.ts registers GET '/', mounted at '/overview'.
        expectTypeOf<Client['overview']>().toHaveProperty('$get');
        expectTypeOf<Client>().not.toHaveProperty('index');
    });

    it('types the mounted child from its own response schema', () => {
        type Overview = InferResponseType<Client['overview']['$get']>;
        expectTypeOf<Overview['success']>().toEqualTypeOf<z.output<typeof IntegrationOverviewResponseSchema>['success']>();
    });

    it('types the router own routes from their declared schemas', () => {
        type Validate = InferRequestType<Client['email']['validate']['$post']>;
        expectTypeOf<Validate['json']>().toEqualTypeOf<z.input<typeof EmailValidateBodySchema>>();
        type Ok = InferResponseType<Client['email']['validate']['$post'], 200>;
        expectTypeOf<Ok['success']>().toEqualTypeOf<z.output<typeof EmailValidateOkSchema>['success']>();
    });
});
