/**
 * Commercial PCA Phase U — pure finding-key rewrites for the tagged ↔ per_unit
 * switch (spec §7). No DB: the service supplies units/location_options and
 * persists the rewritten inspection_results.data. Both directions are pure
 * (they never mutate the input map or its nested entries) and idempotent, so a
 * retried switch is safe.
 */
import { parseFindingKey, findingKey, DEFAULT_UNIT } from './finding-key';

interface Defect { included?: boolean; location?: string }
interface Entry { tabs?: { defects?: Defect[] }; customComments?: { defects?: Defect[] } }

function includedDefects(entry: unknown): Defect[] {
    const e = entry as Entry;
    return [...(e.tabs?.defects ?? []), ...(e.customComments?.defects ?? [])].filter((d) => d.included !== false);
}

/** Labels present in location_options but not yet a unit. */
export function planPromotion(locationOptions: string[], existingLabels: string[]): string[] {
    const taken = new Set(existingLabels);
    const out: string[] = [];
    for (const label of locationOptions) {
        if (taken.has(label)) continue;
        taken.add(label);
        out.push(label);
    }
    return out;
}

/** tagged → per_unit: re-key a _default entry only when EVERY included defect
 *  carries a location resolving to the SAME single unit (spec §7 "unambiguous").
 *  A mixed common+unit entry (some location unresolved) or a multi-unit entry
 *  stays _default. Read-only — entries are re-referenced, never mutated. */
export function rewriteKeysForPromotion(
    data: Record<string, unknown>,
    labelToUnitId: Record<string, string>,
): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(data)) {
        const { unitId, sectionId, itemId } = parseFindingKey(key);
        if (unitId !== DEFAULT_UNIT) { out[key] = entry; continue; }
        const defects = includedDefects(entry);
        const mapped = defects.map((d) => (d.location ? labelToUnitId[d.location] : undefined));
        const distinct = new Set(mapped);
        const only = distinct.size === 1 ? [...distinct][0] : undefined;
        if (defects.length > 0 && only !== undefined) {
            out[findingKey(only, sectionId, itemId)] = entry;
        } else {
            out[key] = entry;
        }
    }
    return out;
}

/** Clone a defect, stamping `label` onto an included defect that has no location
 *  of its own. Never mutates the source defect. */
function stampDefect(d: Defect, label: string): Defect {
    return d.included !== false && !d.location ? { ...d, location: label } : { ...d };
}

/** Clone an entry. When `label` is set, its un-located included defects get the
 *  label stamped as their location; when `label` is null the entry is cloned
 *  as-is (a common-scope entry keeps no unit label). Never mutates the source. */
function cloneEntry(entry: unknown, label: string | null): Record<string, unknown> {
    const e = entry as Entry & Record<string, unknown>;
    const out: Record<string, unknown> = { ...e };
    const cloneDefects = (defects: Defect[] | undefined) =>
        (defects ?? []).map((d) => (label ? stampDefect(d, label) : { ...d }));
    if (e.tabs) out.tabs = { ...e.tabs, defects: cloneDefects(e.tabs.defects) };
    if (e.customComments) out.customComments = { ...e.customComments, defects: cloneDefects(e.customComments.defects) };
    return out;
}

/** Merge two already-cloned tagged entries that collapsed onto the same key by
 *  concatenating their defect lists. `base`'s scalar fields (e.g. rating) win —
 *  the tagged side holds one rating per item, so a differing per-unit rating is
 *  the documented lossy collapse. No finding is dropped: every included defect
 *  from both sources is preserved (fixes the prior last-write-wins overwrite). */
function mergeEntries(base: unknown, add: unknown): Record<string, unknown> {
    const b = base as Entry & Record<string, unknown>;
    const a = add as Entry & Record<string, unknown>;
    const out: Record<string, unknown> = { ...b };
    if (b.tabs || a.tabs) out.tabs = { ...(b.tabs ?? {}), defects: [...(b.tabs?.defects ?? []), ...(a.tabs?.defects ?? [])] };
    if (b.customComments || a.customComments) {
        out.customComments = { ...(b.customComments ?? {}), defects: [...(b.customComments?.defects ?? []), ...(a.customComments?.defects ?? [])] };
    }
    return out;
}

/** per_unit → tagged: demote unit-scoped entries to _default, stamping each
 *  unit's label as the defect location (lossy: the per-unit matrix + roll-up is
 *  dropped). Entries colliding on the same section:item — multiple units, or a
 *  unit plus an existing common entry — are MERGED (defect lists concatenated)
 *  so no finding is lost. Pure: the input map and its entries are never mutated. */
export function flattenUnitsToTagged(
    data: Record<string, unknown>,
    units: Array<{ id: string; label: string }>,
): { data: Record<string, unknown>; locationOptions: string[] } {
    const idToLabel = new Map(units.map((u) => [u.id, u.label]));
    const out: Record<string, unknown> = {};
    const options = new Set<string>();
    for (const [key, entry] of Object.entries(data)) {
        const { unitId, sectionId, itemId } = parseFindingKey(key);
        const label = idToLabel.get(unitId);
        if (label === undefined && unitId !== DEFAULT_UNIT) {
            out[key] = entry; // foreign/unknown scope — preserve untouched (read-only)
            continue;
        }
        if (label !== undefined) options.add(label);
        const targetKey = findingKey(null, sectionId, itemId);
        const contribution = cloneEntry(entry, label ?? null);
        out[targetKey] = out[targetKey] === undefined ? contribution : mergeEntries(out[targetKey], contribution);
    }
    return { data: out, locationOptions: [...options] };
}
