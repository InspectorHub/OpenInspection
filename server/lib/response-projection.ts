/**
 * Responses that leave the product to a person who is not signed in are built from a LIST OF FIELDS, not from a row.
 *
 * A row carries every column the table has, today and after the next change. A response built from the row inherits
 * each of them; a response built from a field list carries what the list names and nothing else. The list is also
 * where a reader finds, in one place, what the surface states.
 *
 * `projectFields` is that step. It is a copy: the source is not changed, a key the source does not have stays absent
 * (a payload from an older version, or a test double, never gains a `null` it did not hold), and only the source's
 * own enumerable keys are read. The result is typed as the picked subset, so a key the list names that the source
 * type does not have is a compile error.
 *
 * `scripts/check-public-projection.mjs` reports a public route that answers with a bare row or service result.
 */

/** The picked subset of `T`; the type `projectFields` returns. */
type Projected<T extends object, K extends keyof T> = Pick<T, K>;

export function projectFields<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Projected<T, K> {
    const out: Partial<Projected<T, K>> = {};
    for (const key of keys) {
        if (Object.hasOwn(source, key)) out[key] = source[key];
    }
    // Every key in `out` was copied from `source` under a key of `K`, so the partial is the picked subset.
    return out as Projected<T, K>;
}

/**
 * A row without its company id. A response to a signed-in caller of that company does not restate the company, which the
 * caller already knows from its session; a row is copied, never changed.
 */
export function withoutCompanyId<T extends object>(row: T): Omit<T, 'tenantId'> {
    // Every entry but the company id is kept, so the result is the row without that one key.
    return Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'tenantId')) as Omit<T, 'tenantId'>;
}
