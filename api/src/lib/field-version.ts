/**
 * Design System 0520 subsystem B phase 3 — field-version conflict helpers.
 *
 * Pure decision functions consumed by InspectionService.patchItem and
 * InspectionService.patchPropertyFact (and by extension the conflict
 * surfaces in ConflictModal). Isolating the version arithmetic here lets
 * the service layer focus on DB read/write while these helpers stay
 * trivially testable without any test fixtures.
 *
 * Field layout (per spec §"JSON-shape changes — no DDL"):
 *   data[itemId] = {
 *       <field>:     <value>,
 *       <field>_v:   number,    // monotonic, +1 per successful write
 *       <field>_by:  string,    // userId of last writer
 *       <field>_at:  number,    // epoch seconds of last write
 *   }
 *
 * A legacy entry missing the `<field>_v` suffix is treated as version 0,
 * which is what the offline-queue replay path sends as its initial
 * expectedVersion. That preserves backwards-compatibility with pre-
 * subsystem-B inspection_results rows without a migration backfill.
 */

export type ItemEntry = Record<string, unknown>;

export interface ConflictPayload {
    kind:   'conflict';
    current: { value: unknown; by?: string; at?: number; v: number };
    yours:   { value: unknown; expectedVersion: number };
}

export interface OkPayload {
    kind: 'ok';
}

export type DecisionPayload = OkPayload | ConflictPayload;

/**
 * Returns `{ kind: 'ok' }` when the caller's expectedVersion matches the
 * stored counter (or when `force: true` overrides the check); otherwise
 * `{ kind: 'conflict', current, yours }` so the route can surface a 409.
 *
 * `cur` is the entry at `data[itemId]`; `undefined` is treated as a
 * brand-new item at version 0 (creating fresh rows is allowed only when
 * expectedVersion is 0).
 */
export function decideFieldWrite(
    cur: ItemEntry | undefined,
    field: string,
    value: unknown,
    expectedVersion: number,
    opts?: { force?: boolean },
): DecisionPayload {
    if (opts?.force) return { kind: 'ok' };

    const curV = (cur?.[`${field}_v`] as number | undefined) ?? 0;
    if (curV === expectedVersion) return { kind: 'ok' };

    const by = cur?.[`${field}_by`] as string | undefined;
    const at = cur?.[`${field}_at`] as number | undefined;
    return {
        kind: 'conflict',
        current: {
            value: cur?.[field],
            v:     curV,
            ...(by !== undefined ? { by } : {}),
            ...(at !== undefined ? { at } : {}),
        },
        yours: { value, expectedVersion },
    };
}

/**
 * Apply the write — produces a fresh entry object with the field value,
 * bumped version, and writer/timestamp metadata. Does NOT mutate the
 * input (functional update; the caller assigns it back into the JSON
 * blob and persists via Drizzle).
 */
export function applyFieldWrite(
    cur: ItemEntry | undefined,
    field: string,
    value: unknown,
    userId: string,
    epochSeconds: number,
): { entry: ItemEntry; newVersion: number } {
    const base = cur ?? {};
    const curV = (base[`${field}_v`] as number | undefined) ?? 0;
    const newVersion = curV + 1;
    const entry: ItemEntry = {
        ...base,
        [field]:           value,
        [`${field}_v`]:    newVersion,
        [`${field}_by`]:   userId,
        [`${field}_at`]:   epochSeconds,
    };
    return { entry, newVersion };
}
