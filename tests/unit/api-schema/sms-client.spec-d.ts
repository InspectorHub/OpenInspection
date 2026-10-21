import { describe, it, expectTypeOf } from 'vitest';
import { hc } from 'hono/client';
import type { Hono } from 'hono';
import type { InferRequestType, InferResponseType } from 'hono/client';
import type { SmsAdminApi, SmsPublicApi } from '../../../server/api/sms';

type PublicClient = ReturnType<typeof hc<SmsPublicApi>>;
type AdminClient = ReturnType<typeof hc<SmsAdminApi>>;
type SchemaOf<A> = A extends Hono<infer _E, infer S, infer _B> ? S : never;
// hc adds $url and $path helpers next to the methods; they are not routes.
type Keys<T> = Exclude<keyof T, '$url' | '$path'>;

// Compile-time only. `SmsPublicApi` (mounted at /api/public) and `SmsAdminApi` (mounted at the manager prefix) are
// derived from `smsPublicRouteConfigs` / `smsAdminRouteConfigs`; a route left out of a list, or one that moves a
// path, fails here. The path keys were read from the declarations the chained routers produced before conversion.
describe('SmsPublicApi client', () => {
    it('serves exactly the paths the chained router served', () => {
        expectTypeOf<keyof SchemaOf<SmsPublicApi>>().toEqualTypeOf<'/sms/optin-resolve' | '/sms/optin-confirm'>();
        expectTypeOf<Keys<PublicClient>>().toEqualTypeOf<'sms'>();
        expectTypeOf<Keys<PublicClient['sms']>>().toEqualTypeOf<'optin-resolve' | 'optin-confirm'>();
        expectTypeOf<Keys<PublicClient['sms']['optin-resolve']>>().toEqualTypeOf<'$get'>();
        expectTypeOf<Keys<PublicClient['sms']['optin-confirm']>>().toEqualTypeOf<'$post'>();
    });

    it('types the routes from their declared schemas', () => {
        type Resolve = InferRequestType<PublicClient['sms']['optin-resolve']['$get']>;
        expectTypeOf<Resolve['query']>().toEqualTypeOf<{ token: string }>();
        type Resolved = InferResponseType<PublicClient['sms']['optin-resolve']['$get'], 200>;
        expectTypeOf<Resolved['data']['companyName']>().toEqualTypeOf<string>();
        expectTypeOf<Resolved['data']['privacyUrl']>().toEqualTypeOf<string | null>();
        type Confirm = InferRequestType<PublicClient['sms']['optin-confirm']['$post']>;
        expectTypeOf<Confirm['json']>().toEqualTypeOf<{ token: string }>();
        type Confirmed = InferResponseType<PublicClient['sms']['optin-confirm']['$post'], 200>;
        expectTypeOf<Confirmed>().toEqualTypeOf<{ success: true }>();
    });

    it('does not expose methods or paths that nothing registered', () => {
        // @ts-expect-error the inbound webhook is a plain Hono router, not part of the typed client
        type NoInbound = PublicClient['sms']['inbound'];
        expectTypeOf<NoInbound>().toBeAny();
        // @ts-expect-error resolving a token is a read
        type NoPost = PublicClient['sms']['optin-resolve']['$post'];
        expectTypeOf<NoPost>().toBeAny();
    });
});

describe('SmsAdminApi client', () => {
    it('serves exactly the paths the chained router served', () => {
        expectTypeOf<keyof SchemaOf<SmsAdminApi>>().toEqualTypeOf<
            | '/sms/attest'
            | '/sms/test'
            | '/sms/consent'
            | '/sms/config'
            | '/sms/compliance'
            | '/sms/compliance/provision'
            | '/sms/compliance/resubmit'
        >();
        expectTypeOf<Keys<AdminClient>>().toEqualTypeOf<'sms'>();
        expectTypeOf<Keys<AdminClient['sms']>>().toEqualTypeOf<'attest' | 'test' | 'consent' | 'config' | 'compliance'>();
        expectTypeOf<Keys<AdminClient['sms']['compliance']>>().toEqualTypeOf<'$get' | 'provision' | 'resubmit'>();
        expectTypeOf<Keys<AdminClient['sms']['compliance']['provision']>>().toEqualTypeOf<'$post'>();
        expectTypeOf<Keys<AdminClient['sms']['compliance']['resubmit']>>().toEqualTypeOf<'$post'>();
        expectTypeOf<Keys<AdminClient['sms']['attest']>>().toEqualTypeOf<'$post'>();
        expectTypeOf<Keys<AdminClient['sms']['test']>>().toEqualTypeOf<'$post'>();
        expectTypeOf<Keys<AdminClient['sms']['consent']>>().toEqualTypeOf<'$get'>();
        expectTypeOf<Keys<AdminClient['sms']['config']>>().toEqualTypeOf<'$get'>();
    });

    it('types the routes from their declared schemas', () => {
        type Provision = InferRequestType<AdminClient['sms']['compliance']['provision']['$post']>;
        expectTypeOf<Provision['json']['channel']>().toEqualTypeOf<'sp10dlc' | 'tollfree'>();
        type Provisioned = InferResponseType<AdminClient['sms']['compliance']['provision']['$post'], 200>;
        expectTypeOf<Provisioned['data']['mode']>().toEqualTypeOf<'managed_dedicated' | 'managed_shared' | 'own' | 'platform'>();
        expectTypeOf<Provisioned['data']['provisionedNumber']>().toEqualTypeOf<string | null>();
        type Consent = InferResponseType<AdminClient['sms']['consent']['$get'], 200>;
        expectTypeOf<Consent['data']['consent']>().toEqualTypeOf<'granted' | 'revoked' | 'none'>();
        type TestSend = InferResponseType<AdminClient['sms']['test']['$post'], 200>;
        expectTypeOf<TestSend['success']>().toEqualTypeOf<boolean>();
        type Attested = InferResponseType<AdminClient['sms']['attest']['$post'], 200>;
        expectTypeOf<Attested>().toEqualTypeOf<{ success: true }>();
    });

    it('does not expose methods or paths that nothing registered', () => {
        // @ts-expect-error the compliance status is read, and provisioning and resubmitting are separate posts
        type NoPostStatus = AdminClient['sms']['compliance']['$post'];
        expectTypeOf<NoPostStatus>().toBeAny();
        // @ts-expect-error the sender configuration is read only
        type NoPutConfig = AdminClient['sms']['config']['$put'];
        expectTypeOf<NoPutConfig>().toBeAny();
    });
});
