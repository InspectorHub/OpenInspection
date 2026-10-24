import { describe, it, expectTypeOf } from 'vitest';
import { hc } from 'hono/client';
import type { Hono } from 'hono';
import type { InferRequestType, InferResponseType } from 'hono/client';
import type { z } from '@hono/zod-openapi';
import type { BookingsApi } from '../../../server/api/bookings';
import type {
    AvailabilityResponseSchema,
    BookingResponseSchema,
    InspectorsResponseSchema,
    PublicBookingSchema,
} from '../../../server/lib/validations/booking.schema';
import type {
    BookingProfileNotFoundSchema,
    CompanyBookingProfileResponseSchema,
    InspectorBookingProfileResponseSchema,
} from '../../../server/lib/validations/booking-profile.schema';

type Client = ReturnType<typeof hc<BookingsApi>>;
type SchemaOf<A> = A extends Hono<infer _E, infer S, infer _B> ? S : never;
// hc adds $url and $path helpers next to the methods; they are not routes.
type Keys<T> = Exclude<keyof T, '$url' | '$path'>;

/** Every path the bookings router served when it was one chain, read from the declaration that chain produced. */
type ChainPaths =
    | '/agreements/:token'
    | '/agreements/:token/decline'
    | '/agreements/:token/sign'
    | '/availability/:inspectorId'
    | '/book'
    | '/book/:tenant'
    | '/book/:tenant/:slug'
    | '/checkout/:token'
    | '/geocode'
    | '/inspections/:id/deposit-intent'
    | '/inspectors'
    | '/services'
    | '/slots';

// Compile-time only. `BookingsApi` is derived from `bookingsRouteParts`: converted children (booking, geocode, deposit
// intent, the company and inspector profiles) are listed with `mounted`, the one still written as a chain (agreements)
// with `legacyMounted`.
describe('BookingsApi client', () => {
    it('serves exactly the paths the chained router served', () => {
        expectTypeOf<keyof SchemaOf<BookingsApi>>().toEqualTypeOf<ChainPaths>();
    });

    it('has the same top-level segments, so a dropped mount shows up', () => {
        expectTypeOf<Keys<Client>>().toEqualTypeOf<
            'agreements' | 'availability' | 'book' | 'checkout' | 'geocode' | 'inspections' | 'inspectors' | 'services' | 'slots'
        >();
        expectTypeOf<Keys<Client['book']>>().toEqualTypeOf<'$post' | ':tenant'>();
    });

    it('types the own routes from their declared schemas', () => {
        type Inspectors = InferResponseType<Client['inspectors']['$get'], 200>;
        expectTypeOf<Inspectors>().toEqualTypeOf<z.output<typeof InspectorsResponseSchema>>();
        type Availability = InferResponseType<Client['availability'][':inspectorId']['$get'], 200>;
        expectTypeOf<Availability>().toEqualTypeOf<z.output<typeof AvailabilityResponseSchema>>();
        expectTypeOf<keyof InferRequestType<Client['availability'][':inspectorId']['$get']>['param']>().toEqualTypeOf<'inspectorId'>();
        expectTypeOf<Client['services']>().toHaveProperty('$get');
        expectTypeOf<Client['slots']>().toHaveProperty('$get');
    });

    it('types the converted children', () => {
        type Book = InferRequestType<Client['book']['$post']>;
        expectTypeOf<Book['json']>().toEqualTypeOf<z.input<typeof PublicBookingSchema>>();
        type Booked = InferResponseType<Client['book']['$post'], 200>;
        expectTypeOf<Booked>().toEqualTypeOf<z.output<typeof BookingResponseSchema>>();
        expectTypeOf<Client['geocode']>().toHaveProperty('$get');
        expectTypeOf<Client['inspections'][':id']['deposit-intent']>().toHaveProperty('$post');
        expectTypeOf<keyof InferRequestType<Client['inspections'][':id']['deposit-intent']['$post']>['param']>().toEqualTypeOf<'id'>();
    });

    it('types the booking profile reads from their declared schemas', () => {
        expectTypeOf<InferResponseType<Client['book'][':tenant']['$get'], 200>>().toEqualTypeOf<z.output<typeof CompanyBookingProfileResponseSchema>>();
        expectTypeOf<InferResponseType<Client['book'][':tenant']['$get'], 404>>().toEqualTypeOf<z.output<typeof BookingProfileNotFoundSchema>>();
        expectTypeOf<keyof InferRequestType<Client['book'][':tenant']['$get']>['param']>().toEqualTypeOf<'tenant'>();
        expectTypeOf<InferResponseType<Client['book'][':tenant'][':slug']['$get'], 200>>().toEqualTypeOf<z.output<typeof InspectorBookingProfileResponseSchema>>();
        expectTypeOf<keyof InferRequestType<Client['book'][':tenant'][':slug']['$get']>['param']>().toEqualTypeOf<'tenant' | 'slug'>();
    });

    it('types the children that are still chains', () => {
        expectTypeOf<Client['agreements'][':token']>().toHaveProperty('$get');
        expectTypeOf<Client['agreements'][':token']['sign']>().toHaveProperty('$post');
        expectTypeOf<Client['agreements'][':token']['decline']>().toHaveProperty('$post');
        expectTypeOf<Client['checkout'][':token']>().toHaveProperty('$get');
    });

    it('does not expose methods or paths that nothing registered', () => {
        // @ts-expect-error no such path
        type Missing = Client['refunds'];
        expectTypeOf<Missing>().toBeAny();
        // @ts-expect-error a booking is submitted, never read back at the root
        type NoGet = Client['book']['$get'];
        expectTypeOf<NoGet>().toBeAny();
        // @ts-expect-error signing is POST only
        type NoSignGet = Client['agreements'][':token']['sign']['$get'];
        expectTypeOf<NoSignGet>().toBeAny();
    });
});
