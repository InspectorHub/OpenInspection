import { describe, it, expectTypeOf } from 'vitest';
import { hc } from 'hono/client';
import type { Hono } from 'hono';
import type { InferRequestType } from 'hono/client';
import type { z } from '@hono/zod-openapi';
import type { AgentApi } from '../../../server/api/agent';
import type { AgentSignupApi } from '../../../server/api/agent-signup';
import type { IdentityApi } from '../../../server/api/identity';
import type { AgentLoginApi } from '../../../server/api/agent/login';
import type { AgentMagicLoginRedeemApi, AgentMagicLoginRequestApi } from '../../../server/api/agent/magic-login';
import type { AgentNoticesApi } from '../../../server/api/agent/notices';
import type { AgentNotificationPreferencesApi } from '../../../server/api/agent/notification-preferences';
import type { AgentTermsApi } from '../../../server/api/agent/terms';
import type { AgentLoginLinkSchema, AgentLoginSchema } from '../../../server/lib/validations/agent-login.schema';
import type { MagicLoginRequestSchema } from '../../../server/lib/validations/agent-magic-login.schema';
import type {
    AgentProfilePatchSchema,
    AgentReportsQuerySchema,
    ConciergeBookSchema,
} from '../../../server/lib/validations/agent.schema';
import type { AccountDeleteRequestSchema } from '../../../server/lib/validations/identity.schema';
import type { NoticeMarkReadSchema } from '../../../server/lib/validations/notice-inbox.schema';

type SchemaOf<A> = A extends Hono<infer _E, infer S, infer _B> ? S : never;
// hc adds $url and $path helpers next to the methods; they are not routes.
type Keys<T> = Exclude<keyof T, '$url' | '$path'>;

// Compile-time only (run by `npm run test:types`). The agent routers are derived from their route lists:
// `AgentApi` mounts the photo and notification-preference routers with `mounted`, the rest are single lists.
// The path keys were read from the declarations the chained routers produced before the conversion.
describe('AgentApi client (mounted photo and notification-preference routers)', () => {
    type Client = ReturnType<typeof hc<AgentApi>>;

    it('serves exactly the paths the chained router served', () => {
        expectTypeOf<keyof SchemaOf<AgentApi>>().toEqualTypeOf<
            | '/concierge-book'
            | '/inspections/:id/photo'
            | '/inspectors'
            | '/leaderboard'
            | '/my-repair-items'
            | '/my-reports'
            | '/notification-preferences'
            | '/notification-preferences/bulk'
            | '/notification-preferences/sms-consent'
            | '/profile'
            | '/referrals'
        >();
        expectTypeOf<Keys<Client>>().toEqualTypeOf<
            'concierge-book' | 'inspections' | 'inspectors' | 'leaderboard' | 'my-repair-items' | 'my-reports'
            | 'notification-preferences' | 'profile' | 'referrals'
        >();
        expectTypeOf<Keys<Client['notification-preferences']>>().toEqualTypeOf<'$get' | '$put' | 'bulk' | 'sms-consent'>();
        expectTypeOf<Keys<Client['profile']>>().toEqualTypeOf<'$get' | '$post'>();
    });

    it('types the routes from their declared schemas', () => {
        type Reports = InferRequestType<Client['my-reports']['$get']>;
        expectTypeOf<Reports['query']>().toEqualTypeOf<z.input<typeof AgentReportsQuerySchema>>();
        type Patch = InferRequestType<Client['profile']['$post']>;
        expectTypeOf<Patch['json']>().toEqualTypeOf<z.input<typeof AgentProfilePatchSchema>>();
        type Book = InferRequestType<Client['concierge-book']['$post']>;
        expectTypeOf<Book['json']>().toEqualTypeOf<z.input<typeof ConciergeBookSchema>>();
        type Photo = InferRequestType<Client['inspections'][':id']['photo']['$get']>;
        expectTypeOf<keyof Photo['param']>().toEqualTypeOf<'id'>();
        expectTypeOf<keyof Photo['query']>().toEqualTypeOf<'key' | 'w' | 'download'>();
    });

    it('does not expose a method or a path that nothing registered', () => {
        // @ts-expect-error referrals are read-only
        type NoPost = Client['referrals']['$post'];
        expectTypeOf<NoPost>().toBeAny();
        // @ts-expect-error the notices inbox is a separate router, not part of AgentApi
        type NoNotices = Client['notices'];
        expectTypeOf<NoNotices>().toBeAny();
    });
});

describe('AgentSignupApi client', () => {
    type Client = ReturnType<typeof hc<AgentSignupApi>>;

    it('serves exactly the paths the chained router served', () => {
        expectTypeOf<keyof SchemaOf<AgentSignupApi>>().toEqualTypeOf<'/' | '/terms'>();
        // The route at the root path sits under 'index'.
        expectTypeOf<Keys<Client>>().toEqualTypeOf<'index' | 'terms'>();
        expectTypeOf<Keys<Client['index']>>().toEqualTypeOf<'$post'>();
        expectTypeOf<Keys<Client['terms']>>().toEqualTypeOf<'$get'>();
    });

    it('does not expose a method that nothing registered', () => {
        // @ts-expect-error the terms are read-only
        type NoPost = Client['terms']['$post'];
        expectTypeOf<NoPost>().toBeAny();
    });
});

describe('IdentityApi client', () => {
    type Client = ReturnType<typeof hc<IdentityApi>>;

    it('serves exactly the paths the chained router served', () => {
        expectTypeOf<keyof SchemaOf<IdentityApi>>().toEqualTypeOf<'/account/delete' | '/account/export'>();
        expectTypeOf<Keys<Client>>().toEqualTypeOf<'account'>();
        expectTypeOf<Keys<Client['account']>>().toEqualTypeOf<'delete' | 'export'>();
    });

    it('types the routes from their declared schemas', () => {
        type Delete = InferRequestType<Client['account']['delete']['$post']>;
        expectTypeOf<Delete['json']>().toEqualTypeOf<z.input<typeof AccountDeleteRequestSchema>>();
    });

    it('does not expose a method that nothing registered', () => {
        // @ts-expect-error the export is a POST only
        type NoGet = Client['account']['export']['$get'];
        expectTypeOf<NoGet>().toBeAny();
    });
});

describe('agent sign-in routers', () => {
    it('AgentLoginApi serves login and login-link', () => {
        type Client = ReturnType<typeof hc<AgentLoginApi>>;
        expectTypeOf<keyof SchemaOf<AgentLoginApi>>().toEqualTypeOf<'/login' | '/login-link'>();
        expectTypeOf<Keys<Client>>().toEqualTypeOf<'login' | 'login-link'>();
        expectTypeOf<InferRequestType<Client['login']['$post']>['json']>().toEqualTypeOf<z.input<typeof AgentLoginSchema>>();
        expectTypeOf<InferRequestType<Client['login-link']['$post']>['json']>().toEqualTypeOf<z.input<typeof AgentLoginLinkSchema>>();
        // @ts-expect-error login is a POST only
        type NoGet = Client['login']['$get'];
        expectTypeOf<NoGet>().toBeAny();
    });

    it('AgentMagicLoginRequestApi and AgentMagicLoginRedeemApi serve one path each', () => {
        type Request = ReturnType<typeof hc<AgentMagicLoginRequestApi>>;
        type Redeem = ReturnType<typeof hc<AgentMagicLoginRedeemApi>>;
        expectTypeOf<keyof SchemaOf<AgentMagicLoginRequestApi>>().toEqualTypeOf<'/magic-login/request'>();
        expectTypeOf<keyof SchemaOf<AgentMagicLoginRedeemApi>>().toEqualTypeOf<'/agent/magic-login'>();
        expectTypeOf<InferRequestType<Request['magic-login']['request']['$post']>['json']>().toEqualTypeOf<z.input<typeof MagicLoginRequestSchema>>();
        expectTypeOf<keyof InferRequestType<Redeem['agent']['magic-login']['$get']>['query']>().toEqualTypeOf<'code'>();
    });

    it('AgentTermsApi serves accept-terms and the history', () => {
        type Client = ReturnType<typeof hc<AgentTermsApi>>;
        expectTypeOf<keyof SchemaOf<AgentTermsApi>>().toEqualTypeOf<'/accept-terms' | '/terms/history'>();
        expectTypeOf<Keys<Client>>().toEqualTypeOf<'accept-terms' | 'terms'>();
        expectTypeOf<Keys<Client['terms']>>().toEqualTypeOf<'history'>();
    });
});

describe('agent inbox and preference routers', () => {
    it('AgentNoticesApi serves the inbox', () => {
        type Client = ReturnType<typeof hc<AgentNoticesApi>>;
        expectTypeOf<keyof SchemaOf<AgentNoticesApi>>().toEqualTypeOf<
            '/notices' | '/notices/:id' | '/notices/:id/optin-link' | '/notices/mark-read'
        >();
        expectTypeOf<Keys<Client['notices']>>().toEqualTypeOf<'$get' | 'mark-read' | ':id'>();
        expectTypeOf<Keys<Client['notices'][':id']>>().toEqualTypeOf<'$delete' | 'optin-link'>();
        expectTypeOf<InferRequestType<Client['notices']['mark-read']['$post']>['json']>().toEqualTypeOf<z.input<typeof NoticeMarkReadSchema>>();
    });

    it('AgentNotificationPreferencesApi serves the three preference paths', () => {
        type Client = ReturnType<typeof hc<AgentNotificationPreferencesApi>>;
        expectTypeOf<keyof SchemaOf<AgentNotificationPreferencesApi>>().toEqualTypeOf<
            '/notification-preferences' | '/notification-preferences/bulk' | '/notification-preferences/sms-consent'
        >();
        expectTypeOf<Keys<Client['notification-preferences']>>().toEqualTypeOf<'$get' | '$put' | 'bulk' | 'sms-consent'>();
    });
});
