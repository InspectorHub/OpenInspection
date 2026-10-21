import { describe, it, expectTypeOf } from 'vitest';
import type { OpenAPIHono } from '@hono/zod-openapi';
import type { AdminApi } from '../../../server/api/admin';
import type { BillingApi } from '../../../server/api/billing';
import type { ContactsApi } from '../../../server/api/contacts';
import type { IntegrationsApi } from '../../../server/api/integrations';
import type { InvoicesApi } from '../../../server/api/invoices';
import type { MessageTemplatesApi } from '../../../server/api/message-templates';
import type { MigrationIntakeApi } from '../../../server/api/migration-intake';
import type { PublicReportApi } from '../../../server/api/public-report';
import type { RatingSystemsApi } from '../../../server/api/rating-systems';
import type { RepairBuilderApi } from '../../../server/api/repair-builder';
import type { SecretsApi } from '../../../server/api/secrets';
import type { UsageApi } from '../../../server/api/usage';

type SchemaOf<A> = A extends OpenAPIHono<infer _E, infer S, infer _B> ? S : never;
/** `[path, method]` of every endpoint that did not resolve to an object (the library would have dropped such a route). */
type Unresolved<S> = { [P in keyof S]: { [M in keyof S[P]]: [S[P][M]] extends [never] ? [P, M] : never }[keyof S[P]] }[keyof S];
/** Paths whose endpoints are all gone, which a `{}` result of the library's schema builder would have left out. */
type EmptyPaths<S> = { [P in keyof S]: [keyof S[P]] extends [never] ? P : never }[keyof S];

// Compile-time only. `RouteSchema` builds each endpoint lazily through `ToSchema`, which can answer `{}` (no endpoint)
// for a route whose responses are all empty. In the lazy form that would surface as `never`, so every converted
// router is checked for endpoints that resolve to nothing.
describe('converted routers: every route resolves to an endpoint', () => {
    it('has no endpoint that resolves to never and no path without a method', () => {
        expectTypeOf<Unresolved<SchemaOf<AdminApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<BillingApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<ContactsApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<IntegrationsApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<InvoicesApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<MessageTemplatesApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<MigrationIntakeApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<PublicReportApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<RatingSystemsApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<RepairBuilderApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<SecretsApi>>>().toEqualTypeOf<never>();
        expectTypeOf<Unresolved<SchemaOf<UsageApi>>>().toEqualTypeOf<never>();
        expectTypeOf<EmptyPaths<SchemaOf<AdminApi>>>().toEqualTypeOf<never>();
        expectTypeOf<EmptyPaths<SchemaOf<PublicReportApi>>>().toEqualTypeOf<never>();
    });

    it('can say no: the check reports an endpoint that is never (positive control)', () => {
        type Broken = { '/x': { $get: never; $post: { input: {}; output: {}; outputFormat: 'json'; status: 200 } } };
        expectTypeOf<Unresolved<Broken>>().toEqualTypeOf<['/x', '$get']>();
    });
});
