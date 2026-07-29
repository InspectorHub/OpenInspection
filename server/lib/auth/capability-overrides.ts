/**
 * The override mechanic, shared by both permission axes.
 *
 * Staff capabilities (users.permission_overrides) and contact-role capabilities
 * (contact_role_profiles.capability_overrides) are the same mechanism over
 * different bit lists, so they use the same implementation rather than two
 * copies that drift. The JSON-coercion quirk below is exactly the sort of thing
 * that otherwise gets fixed on one side only.
 *
 * Bits declare their shape. An earlier version hardcoded `typeof === 'boolean'`,
 * which would silently drop a three-value bit — configuration accepted, stored,
 * then ignored, which reads to an operator as a broken product.
 */

/** A bit is either a boolean, or an enum listing its allowed values. */
export type BitSpec = 'boolean' | readonly string[];
export type BitDecl = Record<string, BitSpec>;
export type OverridesFor<D extends BitDecl> = Partial<Record<keyof D, boolean | string>>;

function accepts(spec: BitSpec, value: unknown): boolean {
    if (spec === 'boolean') return typeof value === 'boolean';
    return typeof value === 'string' && spec.includes(value);
}

/**
 * Keeps only declared keys carrying a value of their declared shape. Anything
 * else is dropped. Returns null when nothing survives, so "no overrides" and
 * "an empty object of overrides" are the same value downstream.
 */
export function whitelistOverrides<D extends BitDecl>(
    decl: D,
    parsed: Record<string, unknown>,
): OverridesFor<D> | null {
    const out: OverridesFor<D> = {};
    for (const bit of Object.keys(decl) as (keyof D & string)[]) {
        if (accepts(decl[bit], parsed[bit])) out[bit] = parsed[bit] as boolean | string;
    }
    return Object.keys(out).length ? out : null;
}

/**
 * Coerces an unknown column value into overrides. Drizzle `{ mode: 'json' }`
 * may hand back a parsed object OR a raw string depending on the driver, so
 * both are handled here rather than at each call site.
 */
export function coerceOverrides<D extends BitDecl>(decl: D, value: unknown): OverridesFor<D> | null {
    if (value == null) return null;
    if (typeof value === 'string') {
        try {
            const parsed: unknown = JSON.parse(value);
            if (typeof parsed !== 'object' || parsed === null) return null;
            return whitelistOverrides(decl, parsed as Record<string, unknown>);
        } catch { return null; }
    }
    if (typeof value === 'object') return whitelistOverrides(decl, value as Record<string, unknown>);
    return null;
}
