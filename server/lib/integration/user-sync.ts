// Abstract sink for core->portal user-lifecycle sync. The concrete
// implementation (OutboxService under server/portal/) is constructed in the
// DI container (server/lib/middleware/di.ts); appended events are drained to
// portal only when the portal service binding is present (SaaS). Core services
// depend on this interface so they never import a concrete portal symbol.

import type { AuthorityBasis } from '../auth/authority-basis';
import type { TenantSyncEventType, UserSyncEventType } from '../sync-events/envelope';

// The event-type unions used here are DERIVED from the seam registry in
// lib/sync-events/envelope (`Extract<SyncEventType, 'user.…'>` and `'tenant.…'`),
// not restated. This file used to keep its own list, and the list had drifted:
// it carried `io.inspectorhub.tenant.compliance_status_updated` — a fully
// prefixed wire name in a slot that holds unprefixed suffixes — which is how
// that event reached the queue double-prefixed. Importing a type from the
// contract module costs nothing at runtime (erased) and does not breach the
// portal-isolation invariant: sync-events lives outside server/portal precisely
// so seam modules may depend on it.

/**
 * The acceptance that was recorded HERE, travelling outward with the account it
 * belongs to.
 *
 * ── Which side is authoritative, and why both directions exist ──────────────
 * For an account born in the PORTAL the acceptance was captured over there and
 * arrives on `cmd.tenant.update`; this side records it and the portal ledger is
 * the original. For an account born HERE — `joinTeam`, the invite door — the
 * reverse: `account_acceptances` is the record and the portal's `user_consents`
 * would be the projection. Whoever captured it is authoritative and the other
 * side projects; confusing the two is how a reader concludes one direction does
 * not exist.
 *
 * ⚠️ NOTHING CONSUMES THIS YET. The task that added it was written believing the
 * portal already had a projector (`projectAcceptance`, in a
 * `server/lib/legal/acceptance-command.ts`) waiting for a block to project.
 * Neither exists — checked 2026-08-18, zero occurrences in that repository —
 * and the portal's `applyUserInvited` reads named keys off the payload and
 * ignores everything else. So this block is carried, arrives, and is currently
 * dropped on the floor.
 *
 * It is emitted anyway, and the alternative is worse: the acceptance is the
 * evidence that the account the SAME event creates was validly created, and an
 * event that carries the account without it teaches the receiving side that the
 * two are separable. Emitting it costs nothing (the sync envelope is a tolerant
 * reader — unknown fields inside `data` are not parsed, so no `dataschema` bump
 * is needed and no existing consumer can park on it) and it means the portal
 * side is a projector away from being complete rather than a protocol change
 * away.
 *
 * FIELD NAMES MIRROR THE INBOUND BLOCK (`cmdAcceptanceSchema` in
 * `lib/sync-events/cmd-envelope.ts`) deliberately. One acceptance vocabulary
 * crossing the seam in both directions is the whole reason `AUTHORITY_BASES` is
 * duplicated byte-for-byte on each side; a second, outbound-only spelling would
 * make that duplication pointless.
 */
export interface UserSyncAcceptance {
    authorityBasis: AuthorityBasis;
    documents: Array<{
        doc: string;
        version: string;
        contentHash: string;
        /** Epoch ms — when the HUMAN accepted. */
        acceptedAt: number;
    }>;
}

export interface UserSyncEvent {
    type: UserSyncEventType;
    /** Event-specific JSON; the schema per event lives at the portal receiver. */
    payload: Record<string, unknown>;
}

/**
 * A tenant-lifecycle fact — no user SID involved, so not a `UserSyncEvent`
 * however much it travels the same queue.
 *
 * The payload is spelled out rather than left as `Record<string, unknown>`
 * because there is exactly one shape and two emitters (the compliance webhook
 * and the managed-status sweeper), and an open record is how the two would drift
 * apart. It mirrors `tenantComplianceStatusUpdatedDataSchema` in
 * lib/sync-events/envelope, which is what validates it on the way out.
 */
export interface TenantSyncEvent {
    type: TenantSyncEventType;
    payload: {
        tenantId: string;
        complianceStatus: string;
        rejectionReason: string | null;
        /** Epoch SECONDS. */
        updatedAt: number;
    };
}

/** Minimal surface core services use. The concrete OutboxService adds
 *  listPending/publishRow/markFailedFromDlq for the queue transport — not
 *  needed here.
 *
 *  ⚠️ The name says User because user-lifecycle events came first, but the sink
 *  is the whole outbound seam: tenant facts ride it too. Widening the parameter
 *  is what lets `UserSyncEventType` stay honestly user-only — before this, the
 *  tenant event was smuggled into that union just to make `append` typecheck. */
export interface UserSyncOutbox {
    append(event: UserSyncEvent | TenantSyncEvent): Promise<string>;
}
