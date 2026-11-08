/**
 * The collab Durable Object namespaces a delete must reach, derived from the env in ONE place.
 *
 * With `DO_JURISDICTION` on, `INSPECTION_DOC` is the pinned namespace and `INSPECTION_DOC_UNPINNED` is the same class as it was
 * before pinning. An object created before pinning has a different id from its pinned twin, so only the old namespace can name
 * it: a delete that addressed `INSPECTION_DOC` alone would leave that object's content behind. Every path that destroys
 * collaborative documents therefore takes this pair rather than one namespace, so forgetting the old side is not possible by
 * omission.
 */

export interface CollabNamespaces<N = DurableObjectNamespace> {
    pinned:  N;
    /** Present only when pinning is on. */
    legacy?: N;
}

export function collabNamespaces<N>(env: { INSPECTION_DOC?: N | undefined; INSPECTION_DOC_UNPINNED?: N | undefined }): CollabNamespaces<N> | undefined {
    if (!env.INSPECTION_DOC) return undefined;
    return env.INSPECTION_DOC_UNPINNED
        ? { pinned: env.INSPECTION_DOC, legacy: env.INSPECTION_DOC_UNPINNED }
        : { pinned: env.INSPECTION_DOC };
}

/** The four bindings a tenant purge reads, mapped in one place for the same reason. */
export function purgeDurableObjectsFromEnv<N>(env: {
    INSPECTION_DOC?:           N | undefined;
    TENANT_PRESENCE?:          N | undefined;
    INSPECTION_DOC_UNPINNED?:  N | undefined;
    TENANT_PRESENCE_UNPINNED?: N | undefined;
}): { INSPECTION_DOC?: N | undefined; TENANT_PRESENCE?: N | undefined; INSPECTION_DOC_UNPINNED?: N | undefined; TENANT_PRESENCE_UNPINNED?: N | undefined } {
    return {
        ...(env.INSPECTION_DOC ? { INSPECTION_DOC: env.INSPECTION_DOC } : {}),
        ...(env.TENANT_PRESENCE ? { TENANT_PRESENCE: env.TENANT_PRESENCE } : {}),
        ...(env.INSPECTION_DOC_UNPINNED ? { INSPECTION_DOC_UNPINNED: env.INSPECTION_DOC_UNPINNED } : {}),
        ...(env.TENANT_PRESENCE_UNPINNED ? { TENANT_PRESENCE_UNPINNED: env.TENANT_PRESENCE_UNPINNED } : {}),
    };
}
