/**
 * Durable Object jurisdiction pinning.
 *
 * A Durable Object's storage location follows its first request unless the id is minted inside a jurisdiction
 * (`namespace.jurisdiction('us').idFromName(...)`). Jurisdiction ids differ from unpinned ids for the same name, so this is
 * applied at ONE place, the worker entry, by narrowing every namespace on the env once. No call site changes.
 *
 * Driven by the `DO_JURISDICTION` variable. Unset means "do nothing", which keeps standalone deployments exactly as they
 * were; a value that is not a Cloudflare jurisdiction throws, so a typo can never leave the objects silently unpinned.
 */

const JURISDICTIONS = ['eu', 'us', 'fedramp'] as const;
export type DoJurisdiction = (typeof JURISDICTIONS)[number];

/** The namespaces that hold personal data and so must follow the jurisdiction. */
const PINNED_BINDINGS = ['INSPECTION_DOC', 'INSPECTION_PRESENCE', 'TENANT_PRESENCE', 'INSPECTOR_MCP'] as const;

export function readDoJurisdiction(env: Pick<JurisdictionEnv, 'DO_JURISDICTION'>): DoJurisdiction | null {
    const raw = env.DO_JURISDICTION?.trim().toLowerCase();
    if (!raw) return null;
    if ((JURISDICTIONS as readonly string[]).includes(raw)) return raw as DoJurisdiction;
    throw new Error(`DO_JURISDICTION must be one of ${JURISDICTIONS.join(', ')}; got "${env.DO_JURISDICTION}"`);
}

/** What pinning needs from a namespace. A real `DurableObjectNamespace` satisfies it, and so does a test double. */
export interface PinnableNamespace {
    jurisdiction(jurisdiction: DoJurisdiction): PinnableNamespace;
}

/** The bindings pinning reads. All optional: a deployment binds only the classes it uses. */
export interface JurisdictionEnv {
    DO_JURISDICTION?: string;
    INSPECTION_DOC?: PinnableNamespace;
    INSPECTION_PRESENCE?: PinnableNamespace;
    TENANT_PRESENCE?: PinnableNamespace;
    INSPECTOR_MCP?: PinnableNamespace;
}

/** The pinned env also carries the namespaces that hold stored state as they were before pinning. */
export interface PinnedExtras {
    INSPECTION_DOC_UNPINNED?: PinnableNamespace;
    TENANT_PRESENCE_UNPINNED?: PinnableNamespace;
}

const cache = new WeakMap<object, object>();

export function pinDurableObjects<E extends JurisdictionEnv>(env: E): E & PinnedExtras {
    const jurisdiction = readDoJurisdiction(env);
    if (!jurisdiction) return env;
    const hit = cache.get(env);
    if (hit) return hit as E & PinnedExtras;

    const pinned: JurisdictionEnv & PinnedExtras = { ...env };
    for (const name of PINNED_BINDINGS) {
        const ns = env[name];
        // A binding that is absent, or is not a namespace, is left alone rather than trusted.
        if (!ns || typeof ns.jurisdiction !== 'function') continue;
        if (name === 'INSPECTION_DOC') pinned.INSPECTION_DOC_UNPINNED = ns;
        if (name === 'TENANT_PRESENCE') pinned.TENANT_PRESENCE_UNPINNED = ns;
        pinned[name] = ns.jurisdiction(jurisdiction);
    }
    cache.set(env, pinned);
    return pinned as E & PinnedExtras;
}
