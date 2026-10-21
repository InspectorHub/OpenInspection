import { describe, it, expectTypeOf } from 'vitest';
import { hc } from 'hono/client';
import type { Hono } from 'hono';
import type { InferRequestType, InferResponseType } from 'hono/client';
import type { z } from '@hono/zod-openapi';
import type { CalendarApi } from '../../../server/api/calendar';
import type { DisconnectQuerySchema } from '../../../server/lib/calendar/disconnect';
import type {
    CalendarBlockListResponseSchema,
    CalendarBlockResponseSchema,
    ConflictsQuerySchema,
    CreateCalendarBlockSchema,
    UpdateCalendarBlockSchema,
} from '../../../server/lib/validations/calendar-blocks.schema';
import type {
    CalendarItemsResponseSchema,
    DispatchBoardResponseSchema,
    ListCalendarItemsQuerySchema,
} from '../../../server/lib/validations/calendar-items.schema';
import type { CalendarSyncResponseSchema } from '../../../server/lib/validations/calendar.schema';
import type { SuccessResponseSchema } from '../../../server/lib/validations/shared.schema';

type Client = ReturnType<typeof hc<CalendarApi>>;
type SchemaOf<A> = A extends Hono<infer _E, infer S, infer _B> ? S : never;
// hc adds $url and $path helpers next to the methods; they are not routes. Routes at the root path sit under 'index'.
type Keys<T> = Exclude<keyof T, '$url' | '$path'>;

// Compile-time only (run by `npm run test:types`). `CalendarApi` (mounted at /api/calendar) is derived from
// `calendarRouteParts`: the blocks and items sub-routers are listed with their route configs (`mounted`), the ICS link
// router, the plain-handler router and the OAuth router with `legacyMounted` (they register plain Hono handlers, which a
// route list cannot express). A mount left out of the list, or one that moves a path, fails here. The path keys were read
// from the declaration the chained router produced before the conversion (13 distinct paths).
describe('CalendarApi client', () => {
    it('serves exactly the paths the chained router served', () => {
        expectTypeOf<keyof SchemaOf<CalendarApi>>().toEqualTypeOf<
            | '/blocks'
            | '/blocks/conflicts'
            | '/blocks/:id'
            | '/callback'
            | '/connect'
            | '/connections/:id/calendars'
            | '/dispatch'
            | '/disconnect'
            | '/ics-links'
            | '/items'
            | '/read-set'
            | '/status'
            | '/sync'
        >();
        expectTypeOf<Keys<Client>>().toEqualTypeOf<
            'blocks' | 'callback' | 'connect' | 'connections' | 'dispatch' | 'disconnect' | 'ics-links' | 'items' | 'read-set' | 'status' | 'sync'
        >();
        expectTypeOf<Keys<Client['blocks']>>().toEqualTypeOf<'$get' | '$post' | 'conflicts' | ':id'>();
        expectTypeOf<Keys<Client['blocks'][':id']>>().toEqualTypeOf<'$patch' | '$delete'>();
    });

    it('types the routes of a converted sub-router from their declared schemas', () => {
        type Create = InferRequestType<Client['blocks']['$post']>;
        expectTypeOf<Create['json']>().toEqualTypeOf<z.input<typeof CreateCalendarBlockSchema>>();
        type Created = InferResponseType<Client['blocks']['$post'], 201>;
        expectTypeOf<Created>().toEqualTypeOf<z.output<typeof CalendarBlockResponseSchema>>();
        type Listed = InferResponseType<Client['blocks']['$get'], 200>;
        expectTypeOf<Listed>().toEqualTypeOf<z.output<typeof CalendarBlockListResponseSchema>>();
        type Conflicts = InferRequestType<Client['blocks']['conflicts']['$get']>;
        expectTypeOf<Conflicts['query']>().toEqualTypeOf<z.input<typeof ConflictsQuerySchema>>();
        type Update = InferRequestType<Client['blocks'][':id']['$patch']>;
        expectTypeOf<Update['json']>().toEqualTypeOf<z.input<typeof UpdateCalendarBlockSchema>>();
        expectTypeOf<keyof Update['param']>().toEqualTypeOf<'id'>();
        type Items = InferRequestType<Client['items']['$get']>;
        expectTypeOf<Items['query']>().toEqualTypeOf<z.input<typeof ListCalendarItemsQuerySchema>>();
        type Fed = InferResponseType<Client['items']['$get'], 200>;
        // The item `meta` record is JSON-converted by the client, so compare the parts that survive that unchanged.
        expectTypeOf<Fed['success']>().toEqualTypeOf<true>();
        expectTypeOf<Fed['data']['items'][number]['kind']>().toEqualTypeOf<z.output<typeof CalendarItemsResponseSchema>['data']['items'][number]['kind']>();
        type Board = InferResponseType<Client['dispatch']['$get'], 200>;
        expectTypeOf<Board['data']['conflictPolicy']>().toEqualTypeOf<z.output<typeof DispatchBoardResponseSchema>['data']['conflictPolicy']>();
        expectTypeOf<Board['data']['inspectors']>().toEqualTypeOf<z.output<typeof DispatchBoardResponseSchema>['data']['inspectors']>();
    });

    it('types the routes of the parent itself from their declared schemas', () => {
        type Disconnect = InferRequestType<Client['disconnect']['$delete']>;
        expectTypeOf<Disconnect['query']>().toEqualTypeOf<z.input<typeof DisconnectQuerySchema>>();
        type Disconnected = InferResponseType<Client['disconnect']['$delete'], 200>;
        expectTypeOf<Disconnected>().toEqualTypeOf<z.output<typeof SuccessResponseSchema>>();
        type Synced = InferResponseType<Client['sync']['$post'], 200>;
        expectTypeOf<Synced>().toEqualTypeOf<z.output<typeof CalendarSyncResponseSchema>>();
    });

    it('exposes the plain handlers, typed from their own inferred schema', () => {
        // The ICS links, the status/read-set/save-set handlers and the OAuth pair are mounted with legacyMounted.
        expectTypeOf<Client['ics-links']>().toHaveProperty('$get');
        expectTypeOf<Client['status']>().toHaveProperty('$get');
        expectTypeOf<Client['read-set']>().toHaveProperty('$get');
        expectTypeOf<Client['connect']>().toHaveProperty('$get');
        expectTypeOf<Client['callback']>().toHaveProperty('$get');
        expectTypeOf<Keys<Client['connections'][':id']['calendars']>>().toEqualTypeOf<'$put'>();
        type NotSignedIn = InferResponseType<Client['read-set']['$get'], 401>;
        expectTypeOf<NotSignedIn>().toEqualTypeOf<{ success: false; error: { message: string } }>();
        type Save = InferRequestType<Client['connections'][':id']['calendars']['$put']>;
        expectTypeOf<keyof Save['param']>().toEqualTypeOf<'id'>();
    });

    it('does not expose methods or paths that nothing registered', () => {
        // @ts-expect-error no such path
        type Missing = Client['accounts'];
        expectTypeOf<Missing>().toBeAny();
        // @ts-expect-error sync is POST only
        type NoSyncGet = Client['sync']['$get'];
        expectTypeOf<NoSyncGet>().toBeAny();
        // @ts-expect-error the read set is saved with PUT, never read on the connection path
        type NoSaveGet = Client['connections'][':id']['calendars']['$get'];
        expectTypeOf<NoSaveGet>().toBeAny();
        // @ts-expect-error a block is updated or removed, never read on its own
        type NoBlockGet = Client['blocks'][':id']['$get'];
        expectTypeOf<NoBlockGet>().toBeAny();
        // @ts-expect-error the ICS links are read only
        type NoLinksPost = Client['ics-links']['$post'];
        expectTypeOf<NoLinksPost>().toBeAny();
    });
});
