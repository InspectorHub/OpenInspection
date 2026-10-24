import { describe, it, expectTypeOf } from 'vitest';
import { hc } from 'hono/client';
import type { Hono } from 'hono';
import type { InferRequestType, InferResponseType } from 'hono/client';
import type { z } from '@hono/zod-openapi';
import type { CoreAuthApi } from '../../../server/api/auth';
import type {
    ChangePasswordSchema,
    Login2faResponseSchema,
    LoginResponseSchema,
    LoginSchema,
    TotpLoginSchema,
    TotpSetupResponseSchema,
    TotpVerifySchema,
} from '../../../server/lib/validations/auth.schema';
import type { SuccessResponseSchema } from '../../../server/lib/validations/shared.schema';

type Client = ReturnType<typeof hc<CoreAuthApi>>;
type SchemaOf<A> = A extends Hono<infer _E, infer S, infer _B> ? S : never;
// hc adds $url and $path helpers next to the methods; they are not routes.
type Keys<T> = Exclude<keyof T, '$url' | '$path'>;

/** Every path the auth router served when it was one chain, read from the declaration that chain produced. */
type ChainPaths =
    | '/2fa/disable'
    | '/2fa/recovery-codes/regenerate'
    | '/2fa/setup'
    | '/2fa/verify'
    | '/change-password'
    | '/checklist/dismiss'
    | '/forgot-password'
    | '/invite-info'
    | '/join'
    | '/login'
    | '/login/2fa'
    | '/logout'
    | '/me'
    | '/profile'
    | '/reset-password'
    | '/setup'
    | '/setup-status'
    | '/sso';

// Compile-time only. `CoreAuthApi` is derived from `coreAuthRouteParts`: the SSO consume route and the profile and
// two-factor routers are mounted at the root among the router's own routes. A mount or route left out of the list,
// or one that moves a path, fails here.
describe('CoreAuthApi client', () => {
    it('serves exactly the paths the chained router served', () => {
        expectTypeOf<keyof SchemaOf<CoreAuthApi>>().toEqualTypeOf<ChainPaths>();
    });

    it('has the same top-level segments, so a dropped mount shows up', () => {
        expectTypeOf<Keys<Client>>().toEqualTypeOf<
            '2fa' | 'change-password' | 'checklist' | 'forgot-password' | 'invite-info' | 'join' | 'login' | 'logout'
            | 'me' | 'profile' | 'reset-password' | 'setup' | 'setup-status' | 'sso'
        >();
        expectTypeOf<Keys<Client['login']>>().toEqualTypeOf<'$post' | '2fa'>();
        expectTypeOf<Keys<Client['2fa']>>().toEqualTypeOf<'setup' | 'verify' | 'disable' | 'recovery-codes'>();
    });

    it('types the own routes from their declared schemas', () => {
        type Login = InferRequestType<Client['login']['$post']>;
        expectTypeOf<Login['json']>().toEqualTypeOf<z.input<typeof LoginSchema>>();
        type LoggedIn = InferResponseType<Client['login']['$post'], 200>;
        expectTypeOf<LoggedIn>().toEqualTypeOf<z.output<typeof LoginResponseSchema>>();
        type Change = InferRequestType<Client['change-password']['$post']>;
        expectTypeOf<Change['json']>().toEqualTypeOf<z.input<typeof ChangePasswordSchema>>();
        expectTypeOf<Client['setup-status']>().toHaveProperty('$get');
        expectTypeOf<Client['invite-info']>().toHaveProperty('$get');
    });

    it('types the mounted children', () => {
        type Verify = InferRequestType<Client['2fa']['verify']['$post']>;
        expectTypeOf<Verify['json']>().toEqualTypeOf<z.input<typeof TotpVerifySchema>>();
        type Setup = InferResponseType<Client['2fa']['setup']['$post'], 200>;
        expectTypeOf<Setup>().toEqualTypeOf<z.output<typeof TotpSetupResponseSchema>>();
        type SecondFactor = InferRequestType<Client['login']['2fa']['$post']>;
        expectTypeOf<SecondFactor['json']>().toEqualTypeOf<z.input<typeof TotpLoginSchema>>();
        type SignedIn = InferResponseType<Client['login']['2fa']['$post'], 200>;
        expectTypeOf<SignedIn>().toEqualTypeOf<z.output<typeof Login2faResponseSchema>>();
        type LoggedOut = InferResponseType<Client['logout']['$post'], 200>;
        expectTypeOf<LoggedOut>().toEqualTypeOf<z.output<typeof SuccessResponseSchema>>();
        expectTypeOf<Client['me']>().toHaveProperty('$get');
        expectTypeOf<Client['profile']>().toHaveProperty('$patch');
        expectTypeOf<Client['sso']>().toHaveProperty('$get');
    });

    it('does not expose methods or paths that nothing registered', () => {
        // @ts-expect-error no such path
        type Missing = Client['refresh'];
        expectTypeOf<Missing>().toBeAny();
        // @ts-expect-error login is POST only
        type NoGet = Client['login']['$get'];
        expectTypeOf<NoGet>().toBeAny();
        // @ts-expect-error the second factor is verified, never read back
        type NoVerifyGet = Client['2fa']['verify']['$get'];
        expectTypeOf<NoVerifyGet>().toBeAny();
    });
});
