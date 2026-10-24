import { describe, it, expectTypeOf } from 'vitest';
import { hc } from 'hono/client';
import type { Hono } from 'hono';
import type { InferRequestType, InferResponseType } from 'hono/client';
import type { z } from '@hono/zod-openapi';
import type { TeamApi } from '../../../server/api/team';
import type { PayrollExportSchema, PayrollRunResponseSchema } from '../../../server/lib/validations/pay-split.schema';
import type {
    InviteMemberSchema,
    InviteResponseSchema,
    TeamDefaultsSchema,
    TeamMembersResponseSchema,
} from '../../../server/lib/validations/admin.schema';

type Client = ReturnType<typeof hc<TeamApi>>;
type SchemaOf<A> = A extends Hono<infer _E, infer S, infer _B> ? S : never;
// hc adds $url and $path helpers next to the methods; they are not routes.
type Keys<T> = Exclude<keyof T, '$url' | '$path'>;

/** Every path the team router served when it was one chain, read from the declaration that chain produced. */
type ChainPaths =
    | '/defaults'
    | '/invite'
    | '/invites/:token'
    | '/invites/:token/resend'
    | '/members'
    | '/members/:id'
    | '/members/:id/two-factor/reset'
    | '/payroll-export'
    | '/permission-templates'
    | '/permission-templates/:id';

// Compile-time only. `TeamApi` is derived from `teamRouteParts`: three converted children mounted at the root
// ahead of the router's own routes. A mount or route left out of the list, or one that moves a path, fails here.
describe('TeamApi client', () => {
    it('serves exactly the paths the chained router served', () => {
        expectTypeOf<keyof SchemaOf<TeamApi>>().toEqualTypeOf<ChainPaths>();
    });

    it('has the same top-level segments, so a dropped mount shows up', () => {
        expectTypeOf<Keys<Client>>().toEqualTypeOf<
            'defaults' | 'invite' | 'invites' | 'members' | 'payroll-export' | 'permission-templates'
        >();
        expectTypeOf<Keys<Client['members']>>().toEqualTypeOf<'$get' | ':id'>();
        expectTypeOf<Keys<Client['members'][':id']>>().toEqualTypeOf<'$patch' | '$delete' | 'two-factor'>();
    });

    it('types the own routes from their declared schemas', () => {
        type Invite = InferRequestType<Client['invite']['$post']>;
        expectTypeOf<Invite['json']>().toEqualTypeOf<z.input<typeof InviteMemberSchema>>();
        type Invited = InferResponseType<Client['invite']['$post'], 201>;
        expectTypeOf<Invited>().toEqualTypeOf<z.output<typeof InviteResponseSchema>>();
        type Members = InferResponseType<Client['members']['$get'], 200>;
        expectTypeOf<Members>().toEqualTypeOf<z.output<typeof TeamMembersResponseSchema>>();
        type Payroll = InferRequestType<Client['payroll-export']['$post']>;
        expectTypeOf<Payroll['json']>().toEqualTypeOf<z.input<typeof PayrollExportSchema>>();
        type Ran = InferResponseType<Client['payroll-export']['$post'], 200>;
        expectTypeOf<Ran>().toEqualTypeOf<z.output<typeof PayrollRunResponseSchema>>();
    });

    it('types the mounted children', () => {
        type Defaults = InferRequestType<Client['defaults']['$put']>;
        expectTypeOf<Defaults['json']>().toEqualTypeOf<z.input<typeof TeamDefaultsSchema>>();
        expectTypeOf<Client['defaults']>().toHaveProperty('$get');
        expectTypeOf<Client['permission-templates']>().toHaveProperty('$get');
        expectTypeOf<Client['permission-templates']>().toHaveProperty('$post');
        expectTypeOf<Client['permission-templates'][':id']>().toHaveProperty('$put');
        expectTypeOf<Client['members'][':id']['two-factor']['reset']>().toHaveProperty('$post');
        expectTypeOf<keyof InferRequestType<Client['members'][':id']['two-factor']['reset']['$post']>['param']>().toEqualTypeOf<'id'>();
    });

    it('does not expose methods or paths that nothing registered', () => {
        // @ts-expect-error no such path
        type Missing = Client['seats'];
        expectTypeOf<Missing>().toBeAny();
        // @ts-expect-error invite is POST only
        type NoGet = Client['invite']['$get'];
        expectTypeOf<NoGet>().toBeAny();
        // @ts-expect-error resetting a second factor is POST only
        type NoPut = Client['members'][':id']['two-factor']['reset']['$put'];
        expectTypeOf<NoPut>().toBeAny();
    });
});
