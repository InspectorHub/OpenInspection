import { describe, it, expectTypeOf } from 'vitest';
import { hc } from 'hono/client';
import type { InferRequestType, InferResponseType } from 'hono/client';
import type { z } from '@hono/zod-openapi';
import type { AdminApi } from '../../../server/api/admin';
import type {
    CreateCustomHolidaySchema,
    CustomHolidayListResponseSchema,
    CustomHolidayResponseSchema,
    HolidayCheckQuerySchema,
} from '../../../server/lib/validations/tenant-holidays.schema';

type Client = ReturnType<typeof hc<AdminApi>>;

// Compile-time only (run by `npm run test:types`). `AdminApi` is derived from `adminRouteParts`, a list of
// sixteen mounted child routers, so a mount left out of that list, or mounted at the wrong prefix, fails
// here. The expected shapes come from the zod schemas the routes declare, not from literals.
describe('AdminApi client (derived from the mounted child routers)', () => {
    it('exposes routes of different mounted children', () => {
        // admin-holidays
        expectTypeOf<Client['custom-holidays']>().toHaveProperty('$get');
        expectTypeOf<Client['custom-holidays']>().toHaveProperty('$post');
        expectTypeOf<Client['custom-holidays'][':id']>().toHaveProperty('$delete');
        expectTypeOf<Client['holidays']['preview']>().toHaveProperty('$get');
        expectTypeOf<Client['holidays']['check']>().toHaveProperty('$get');
        // admin-signing-key
        expectTypeOf<Client['agreements']['signing-key']['rotate']>().toHaveProperty('$post');
    });

    it('leaves out a router that is mounted somewhere else', () => {
        // admin/branding.ts is mounted directly at /api/admin by server/index.ts, not through this router.
        expectTypeOf<Client>().not.toHaveProperty('branding');
    });

    it('types request bodies and queries from the declared request schemas', () => {
        type Create = InferRequestType<Client['custom-holidays']['$post']>;
        expectTypeOf<Create['json']>().toEqualTypeOf<z.input<typeof CreateCustomHolidaySchema>>();
        type Check = InferRequestType<Client['holidays']['check']['$get']>;
        expectTypeOf<Check['query']>().toEqualTypeOf<z.input<typeof HolidayCheckQuerySchema>>();
    });

    it('types responses from the declared response schemas', () => {
        type List = InferResponseType<Client['custom-holidays']['$get']>;
        type Created = InferResponseType<Client['custom-holidays']['$post'], 201>;
        expectTypeOf<List['success']>().toEqualTypeOf<z.output<typeof CustomHolidayListResponseSchema>['success']>();
        expectTypeOf<List['data']['holidays'][number]['id']>().toEqualTypeOf<string>();
        expectTypeOf<Created['data']['holiday']['name']>().toEqualTypeOf<z.output<typeof CustomHolidayResponseSchema>['data']['holiday']['name']>();
    });
});
