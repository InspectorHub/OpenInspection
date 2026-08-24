import { describe, expectTypeOf, it } from 'vitest';
import type { OutboxEvent } from '../../../server/portal/outbox.service';
import type { CmdReplyType } from '../../../server/portal/cmd-reply';
import type { UserSyncOutbox } from '../../../server/lib/integration/user-sync';
import type {
    CmdReplyEventType,
    SyncEventType,
    TenantSyncEventType,
    UserSyncEventType,
} from '../../../server/lib/sync-events/envelope';

// Type-only. Under plain `vitest run` a type assignment is stripped before it
// executes, so this file protects nothing outside `npm run test:types`.
//
// ── What is actually being held down here ──────────────────────────────────
// The seam used to carry FOUR hand-written lists of one fact: the reply names in
// `outbox.service.ts`, the same names again in `cmd-reply.ts`, the user names in
// `user-sync.ts`, and the wire registry in `sync-events/envelope.ts`. A comment
// asked the next reader to keep the first two in step. It did not mention the
// fourth, and that is the one that drifted: `tenant.compliance_status_updated`
// was declared in the outbox service, fully prefixed, and never registered on
// the wire at all — so it serialized as `io.inspectorhub.io.inspectorhub.…` and
// portal parked every event of that type for the feature's whole life.
//
// All four now derive from `SCHEMAS`. These assertions are what stops them being
// pulled apart again, and each positive claim below is paired with a rejection —
// a `toMatchTypeOf` that nothing can fail is a description, not a test.

describe('the sync event type is closed over the wire registry', () => {
    it('accepts a type that is registered', () => {
        expectTypeOf<'user.invited'>().toMatchTypeOf<SyncEventType>();
        expectTypeOf<'tenant.compliance_status_updated'>().toMatchTypeOf<SyncEventType>();
    });

    it('rejects a type nobody registered — the control that makes the above mean something', () => {
        // @ts-expect-error 'tenant.not_a_real_event' has no SCHEMAS entry
        const bad: SyncEventType = 'tenant.not_a_real_event';
        void bad;
    });

    it('rejects the ALREADY-PREFIXED spelling: registry keys are suffixes only', () => {
        // This is the exact literal that used to compile, in the outbox service's
        // own union. `toCloudEvent` prepends the prefix, so a member carrying one
        // produces a doubled wire type. It must not be nameable.
        // @ts-expect-error registry keys never carry `io.inspectorhub.`
        const doubled: SyncEventType = 'io.inspectorhub.tenant.compliance_status_updated';
        void doubled;
    });
});

describe('the group aliases partition the registry rather than restating it', () => {
    it('each group is a subset of the whole', () => {
        expectTypeOf<UserSyncEventType>().toMatchTypeOf<SyncEventType>();
        expectTypeOf<CmdReplyEventType>().toMatchTypeOf<SyncEventType>();
        expectTypeOf<TenantSyncEventType>().toMatchTypeOf<SyncEventType>();
    });

    it('the groups do not overlap: a reply is not a user event and not a tenant event', () => {
        // @ts-expect-error 'reply.tenant.updated' is in the reply group, not the user group
        const notUser: UserSyncEventType = 'reply.tenant.updated';
        void notUser;
        // @ts-expect-error `reply.tenant.updated` starts with `reply.`, not `tenant.`
        const notTenant: TenantSyncEventType = 'reply.tenant.updated';
        void notTenant;
    });

    it('cmd-reply.ts no longer keeps its own copy of the reply list', () => {
        // The assertion the old warning comment asked a human to perform on every
        // change. If either side ever stops deriving, this stops being equal.
        expectTypeOf<CmdReplyType>().toEqualTypeOf<CmdReplyEventType>();
    });
});

describe('append() cannot be handed an unregistered event', () => {
    type Appended = Parameters<UserSyncOutbox['append']>[0];

    it('accepts the tenant compliance event through the seam interface', () => {
        expectTypeOf<{
            type: 'tenant.compliance_status_updated';
            payload: {
                tenantId: string;
                complianceStatus: string;
                rejectionReason: string | null;
                updatedAt: number;
            };
        }>().toMatchTypeOf<Appended>();
    });

    it('rejects the prefixed spelling at the call site', () => {
        const bad: Appended = {
            // @ts-expect-error the emitters wrote this literal for the whole life of the feature
            type: 'io.inspectorhub.tenant.compliance_status_updated',
            payload: {
                tenantId: 't1',
                complianceStatus: 'approved',
                rejectionReason: null,
                updatedAt: 1751000000,
            },
        };
        void bad;
    });

    it('the concrete OutboxEvent is closed the same way', () => {
        // @ts-expect-error no such reply is registered
        const bad: OutboxEvent = { type: 'reply.tenant.invented', payload: {} };
        void bad;
    });

    it('positive control: a registered reply is assignable to OutboxEvent', () => {
        const ok: OutboxEvent = { type: 'reply.report.corrected', payload: {} };
        void ok;
    });
});
