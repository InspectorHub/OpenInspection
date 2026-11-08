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

/** The collab namespace as it was before pinning, kept only so objects created without a jurisdiction can be read once and copied. */
export const UNPINNED_COLLAB_BINDING = 'INSPECTION_DOC_UNPINNED';

export function readDoJurisdiction(env: { DO_JURISDICTION?: string }): DoJurisdiction | null {
    const raw = env.DO_JURISDICTION?.trim().toLowerCase();
    if (!raw) return null;
    if ((JURISDICTIONS as readonly string[]).includes(raw)) return raw as DoJurisdiction;
    throw new Error(`DO_JURISDICTION must be one of ${JURISDICTIONS.join(', ')}; got "${env.DO_JURISDICTION}"`);
}

function isNamespace(v: unknown): v is { jurisdiction: (j: string) => unknown } {
    return typeof v === 'object' && v !== null && typeof (v as { jurisdiction?: unknown }).jurisdiction === 'function';
}

const cache = new WeakMap<object, object>();

export function pinDurableObjects<E extends object>(env: E): E {
    const jurisdiction = readDoJurisdiction(env as { DO_JURISDICTION?: string });
    if (!jurisdiction) return env;
    const hit = cache.get(env);
    if (hit) return hit as E;

    const pinned: Record<string, unknown> = { ...(env as Record<string, unknown>) };
    for (const name of PINNED_BINDINGS) {
        const ns = (env as Record<string, unknown>)[name];
        if (!isNamespace(ns)) continue;
        if (name === 'INSPECTION_DOC') pinned[UNPINNED_COLLAB_BINDING] = ns;
        pinned[name] = ns.jurisdiction(jurisdiction);
    }
    cache.set(env, pinned);
    return pinned as E;
}
