import { describe, it, expectTypeOf } from 'vitest';
import { hc } from 'hono/client';
import type { InferRequestType, InferResponseType } from 'hono/client';
import type { z } from '@hono/zod-openapi';
import type { PublicReportApi, PayIntentSchema, ReportGateResponseSchema } from '../../../server/api/public-report';
import type { PublicReportResponseSchema } from '../../../server/lib/validations/courtesy-translation.schema';
import type { PublicInvoiceBodySchema } from '../../../server/lib/validations/invoice.schema';
import type { PublicBrandSchema } from '../../../server/lib/validations/public-brand.schema';
import type { ViewTrackingObjectionBodySchema, ViewTrackingStateSchema } from '../../../server/lib/validations/view-tracking.schema';

type Client = ReturnType<typeof hc<PublicReportApi>>;

// Compile-time only (run by `npm run test:types`). `PublicReportApi` is derived from `publicReportRouteParts`, which
// interleaves mounted children (verify, view tracking, inspector profile) with the router's own routes, in that order.
// A mount dropped from the list, or a route left out of it, fails here. Expected shapes come from the zod schemas.
describe('PublicReportApi client (own routes interleaved with mounted children)', () => {
    it('has exactly the top-level segments of the routes and mounts, so a dropped mount shows up', () => {
        expectTypeOf<keyof Client>().toEqualTypeOf<'verify' | 'inspections' | 'report' | 'report-gate' | 'brand' | 'legal' | 'brand-asset'>();
    });

    it('exposes the child mounted before the own routes (verify)', () => {
        expectTypeOf<Client['verify'][':envelopeId']>().toHaveProperty('$get');
        expectTypeOf<Client['verify']['report'][':token']>().toHaveProperty('$get');
        expectTypeOf<Client['verify']['report'][':token']['pdf']>().toHaveProperty('$get');
    });

    it('exposes the second child mounted before the own routes (view tracking)', () => {
        expectTypeOf<Client['inspections'][':id']['view-tracking']>().toHaveProperty('$get');
        expectTypeOf<Client['inspections'][':id']['view-tracking-objection']>().toHaveProperty('$post');
    });

    it('exposes the own routes registered between the mounts', () => {
        expectTypeOf<Client['report'][':tenant'][':id']>().toHaveProperty('$get');
        expectTypeOf<Client['report'][':tenant'][':id']['photo']>().toHaveProperty('$get');
        expectTypeOf<Client['report'][':tenant'][':id']['pdf']>().toHaveProperty('$get');
        expectTypeOf<Client['report-gate'][':tenant'][':id']>().toHaveProperty('$get');
    });

    it('exposes the child mounted between own routes (inspector profile)', () => {
        expectTypeOf<Client['brand'][':tenant']>().toHaveProperty('$get');
        expectTypeOf<Client['legal'][':tenant'][':doc']>().toHaveProperty('$get');
        expectTypeOf<Client['brand-asset']>().toHaveProperty('$get');
    });

    it('exposes the own routes registered after the last mount', () => {
        expectTypeOf<Client['inspections'][':id']['invoice']>().toHaveProperty('$get');
        expectTypeOf<Client['inspections'][':id']['pay-intent']>().toHaveProperty('$post');
    });

    it('merges routes of different registrations that share a path prefix', () => {
        // /inspections/{id}/... comes from view tracking (mount), the invoice route and the pay-intent route.
        expectTypeOf<keyof Client['inspections'][':id']>().toEqualTypeOf<'view-tracking' | 'view-tracking-objection' | 'invoice' | 'pay-intent'>();
    });

    it('does not expose methods or paths that nothing registered', () => {
        // @ts-expect-error no such path
        type Missing = Client['nothing'];
        expectTypeOf<Missing>().toBeAny();
        // @ts-expect-error the report route is GET only
        type NoPost = Client['report'][':tenant'][':id']['$post'];
        expectTypeOf<NoPost>().toBeAny();
        // @ts-expect-error pay-intent is POST only
        type NoGet = Client['inspections'][':id']['pay-intent']['$get'];
        expectTypeOf<NoGet>().toBeAny();
        expectTypeOf<Client['report'][':tenant'][':id']>().not.toHaveProperty('$delete');
    });

    it('types the own routes from their declared schemas', () => {
        type Report = InferResponseType<Client['report'][':tenant'][':id']['$get'], 200>;
        expectTypeOf<Report>().toEqualTypeOf<z.output<typeof PublicReportResponseSchema>>();
        type Invoice = InferResponseType<Client['inspections'][':id']['invoice']['$get'], 200>;
        expectTypeOf<Invoice['data']>().toEqualTypeOf<z.output<typeof PublicInvoiceBodySchema> | null>();
        type Pay = InferResponseType<Client['inspections'][':id']['pay-intent']['$post'], 200>;
        expectTypeOf<Pay['data']>().toEqualTypeOf<z.output<typeof PayIntentSchema>>();
        type Gate = InferResponseType<Client['report-gate'][':tenant'][':id']['$get'], 200>;
        expectTypeOf<Gate['data']>().toEqualTypeOf<z.output<typeof ReportGateResponseSchema>>();
    });

    it('types request params of the own routes', () => {
        type Report = InferRequestType<Client['report'][':tenant'][':id']['$get']>;
        expectTypeOf<keyof Report['param']>().toEqualTypeOf<'tenant' | 'id'>();
        expectTypeOf<keyof NonNullable<Report['query']>>().toEqualTypeOf<'token' | 'render'>();
        type Pay = InferRequestType<Client['inspections'][':id']['pay-intent']['$post']>;
        expectTypeOf<keyof Pay['param']>().toEqualTypeOf<'id'>();
    });

    it('types the mounted children from their own schemas', () => {
        type State = InferResponseType<Client['inspections'][':id']['view-tracking']['$get'], 200>;
        expectTypeOf<State['data']>().toEqualTypeOf<z.output<typeof ViewTrackingStateSchema>>();
        type Objection = InferRequestType<Client['inspections'][':id']['view-tracking-objection']['$post']>;
        expectTypeOf<Objection['json']>().toEqualTypeOf<z.input<typeof ViewTrackingObjectionBodySchema>>();
        type Brand = InferResponseType<Client['brand'][':tenant']['$get'], 200>;
        expectTypeOf<Brand['data']>().toEqualTypeOf<z.output<typeof PublicBrandSchema>>();
    });
});
