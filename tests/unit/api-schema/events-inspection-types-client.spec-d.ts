import { describe, it, expectTypeOf } from 'vitest';
import { hc } from 'hono/client';
import type { Hono } from 'hono';
import type { InferRequestType, InferResponseType } from 'hono/client';
import type { z } from '@hono/zod-openapi';
import type { EventsApi } from '../../../server/api/events';
import type { InspectionTypesApi } from '../../../server/api/inspection-types';
import type { EventTypeListResponseSchema, InspectionEventListResponseSchema } from '../../../server/lib/validations/event.schema';
import type {
    CreateInspectionTypeSchema,
    CreatedInspectionTypeSchema,
    InspectionTypeSchema,
    UpdateInspectionTypeSchema,
} from '../../../server/lib/validations/inspection-type.schema';

type EventsClient = ReturnType<typeof hc<EventsApi>>;
type TypesClient = ReturnType<typeof hc<InspectionTypesApi>>;
type SchemaOf<A> = A extends Hono<infer _E, infer S, infer _B> ? S : never;
// hc adds $url and $path helpers next to the methods; they are not routes.
type Keys<T> = Exclude<keyof T, '$url' | '$path'>;

// Compile-time only (run by `npm run test:types`). `InspectionTypesApi` is derived from `inspectionTypesRouteConfigs`.
// `EventsApi` stays the type of its chain: the two reads and the delete are OpenAPI routes, and the two creates and the
// status change are plain handlers that the chain keeps typed from their own handlers. Path keys were read from the
// declarations the chains produced before the conversion.
describe('EventsApi client', () => {
    it('serves exactly the paths the chain served', () => {
        expectTypeOf<keyof SchemaOf<EventsApi>>().toEqualTypeOf<'/event-types' | '/events/:id' | '/inspections/:inspectionId/events'>();
        expectTypeOf<Keys<EventsClient>>().toEqualTypeOf<'event-types' | 'events' | 'inspections'>();
        expectTypeOf<Keys<EventsClient['event-types']>>().toEqualTypeOf<'$get' | '$post'>();
        expectTypeOf<Keys<EventsClient['events'][':id']>>().toEqualTypeOf<'$put' | '$delete'>();
        expectTypeOf<Keys<EventsClient['inspections'][':inspectionId']['events']>>().toEqualTypeOf<'$get' | '$post'>();
    });

    it('types the converted routes from their declared schemas', () => {
        expectTypeOf<InferResponseType<EventsClient['event-types']['$get'], 200>>().toEqualTypeOf<z.output<typeof EventTypeListResponseSchema>>();
        expectTypeOf<InferResponseType<EventsClient['inspections'][':inspectionId']['events']['$get'], 200>>().toEqualTypeOf<z.output<typeof InspectionEventListResponseSchema>>();
        expectTypeOf<keyof InferRequestType<EventsClient['inspections'][':inspectionId']['events']['$get']>['param']>().toEqualTypeOf<'inspectionId'>();
        expectTypeOf<keyof InferRequestType<EventsClient['events'][':id']['$delete']>['param']>().toEqualTypeOf<'id'>();
        expectTypeOf<InferResponseType<EventsClient['events'][':id']['$delete'], 200>>().toEqualTypeOf<{ success: true }>();
    });

    it('does not expose methods that nothing registered', () => {
        // @ts-expect-error an event type is created with POST, deleted nowhere on this path
        type NoDelete = EventsClient['event-types']['$delete'];
        expectTypeOf<NoDelete>().toBeAny();
    });
});

describe('InspectionTypesApi client', () => {
    it('serves exactly the paths the chain served', () => {
        expectTypeOf<keyof SchemaOf<InspectionTypesApi>>().toEqualTypeOf<'/inspection-types' | '/inspection-types/:id'>();
        expectTypeOf<Keys<TypesClient>>().toEqualTypeOf<'inspection-types'>();
        expectTypeOf<Keys<TypesClient['inspection-types']>>().toEqualTypeOf<'$get' | '$post' | ':id'>();
        expectTypeOf<Keys<TypesClient['inspection-types'][':id']>>().toEqualTypeOf<'$put' | '$delete'>();
    });

    it('types the routes from their declared schemas', () => {
        type Listed = InferResponseType<TypesClient['inspection-types']['$get'], 200>;
        expectTypeOf<Listed['data']>().toEqualTypeOf<z.output<typeof InspectionTypeSchema>[]>();
        type Created = InferResponseType<TypesClient['inspection-types']['$post'], 201>;
        expectTypeOf<Created['data']>().toEqualTypeOf<z.output<typeof CreatedInspectionTypeSchema>>();
        type Create = InferRequestType<TypesClient['inspection-types']['$post']>;
        expectTypeOf<Create['json']>().toEqualTypeOf<z.input<typeof CreateInspectionTypeSchema>>();
        type Update = InferRequestType<TypesClient['inspection-types'][':id']['$put']>;
        expectTypeOf<Update['json']>().toEqualTypeOf<z.input<typeof UpdateInspectionTypeSchema>>();
        expectTypeOf<keyof Update['param']>().toEqualTypeOf<'id'>();
        expectTypeOf<InferResponseType<TypesClient['inspection-types'][':id']['$delete'], 200>>().toEqualTypeOf<{ success: true }>();
    });

    it('does not expose methods that nothing registered', () => {
        // @ts-expect-error a subtype is read through the list, never on its own path
        type NoGetOne = TypesClient['inspection-types'][':id']['$get'];
        expectTypeOf<NoGetOne>().toBeAny();
    });
});
