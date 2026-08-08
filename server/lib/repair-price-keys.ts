/**
 * The repair-price keys a finding must not carry, and the one helper that
 * removes them.
 *
 * ── Why this is a module and not four inline arrays ─────────────────────────
 * An inspection describes a property. The platform stores what an inspection
 * OBSERVES and does not produce repair prices; money attached to an inspection
 * is written by the buyer or their agent. The full reasoning lives in
 * `scripts/check-price-capability.mjs`, which is the gate that keeps it true.
 *
 * The keys below had no UI left, but `inspection_results.data` is an untyped
 * JSON blob and three separate writers fold into it. Each of them needed the
 * same list, and a list copied three times is a list that will disagree with
 * itself the first time a fourth name is added — so it is declared once, here,
 * and every writer imports it.
 *
 * ── Why removal and not rejection ───────────────────────────────────────────
 * Two of the three writers have no request to refuse. The editor's writes
 * arrive as a Yjs CRDT update (a binary merge, not a validated body), and the
 * batch endpoint's entry is an opaque `value: z.any()` by design. Where a real
 * request boundary DOES exist — the template write — the answer is a loud 400
 * instead; see `server/lib/validations/template.schema.ts`.
 */

/** Money-shaped keys that may appear on a result entry or a defect row. */
const REPAIR_PRICE_KEYS = [
    'estimateLow',
    'estimateHigh',
    'estimateMin',
    'estimateMax',
] as const;

/** Delete every repair-price key from `target`, in place. No-op for non-objects. */
export function deleteRepairPriceKeys(target: unknown): void {
    if (!target || typeof target !== 'object') return;
    for (const k of REPAIR_PRICE_KEYS) delete (target as Record<string, unknown>)[k];
}

/**
 * Deep copy of `value` with every repair-price key removed, at any depth.
 *
 * Used where the incoming shape is not known — the batch endpoint takes an
 * opaque `value` and folds it onto the entry verbatim, so "strip the keys I
 * expect at the level I expect them" would miss a price nested one object
 * further down, which is precisely how an unvalidated payload gets used.
 */
export function withoutRepairPriceDeep<T>(value: T): T {
    if (Array.isArray(value)) {
        return value.map((v) => withoutRepairPriceDeep(v)) as unknown as T;
    }
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            if ((REPAIR_PRICE_KEYS as readonly string[]).includes(k)) continue;
            out[k] = withoutRepairPriceDeep(v);
        }
        return out as T;
    }
    return value;
}
/**
 * Copy of `rows` with every repair-price key removed from each row. Shallow by
 * design: the caller passes one array of finding rows, and a deep walk here
 * would silently also strip nested structures the caller did not mean to touch.
 */
export function withoutRepairPriceRows<T>(rows: T[]): T[] {
    return rows.map((row) => {
        if (!row || typeof row !== 'object') return row;
        const clean = { ...(row as Record<string, unknown>) };
        deleteRepairPriceKeys(clean);
        return clean as T;
    });
}
