// Abstract sink for core->portal user-lifecycle sync. The concrete
// implementation (OutboxService under server/portal/) is constructed in the
// DI container (server/lib/middleware/di.ts); appended events are drained to
// portal only when the portal service binding is present (SaaS). Core services
// depend on this interface so they never import a concrete portal symbol.

export type UserSyncEventType =
    | 'user.invited'
    | 'user.password_changed'
    | 'user.deleted';

export interface UserSyncEvent {
    type: UserSyncEventType;
    /** Event-specific JSON; the schema per event lives at the portal receiver. */
    payload: Record<string, unknown>;
}

/** Minimal surface core services use. The concrete OutboxService adds
 *  listPending/publishRow/markFailedFromDlq for the queue transport — not
 *  needed here. */
export interface UserSyncOutbox {
    append(event: UserSyncEvent): Promise<string>;
}
