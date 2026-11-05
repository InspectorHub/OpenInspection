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
import { parseSnapshot } from '../services/inspection/shared';

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

/**
 * The inspection row as a response states it: the template snapshot as an object (or null when the stored value is not a
 * readable one), and without the company id.
 *
 * The editor's own saves write the snapshot as a JSON-encoded string into a JSON column, so such a row reads back as a string.
 * Normalised here, on read, so the client sees one shape; the stored value is left as it is. The company id is the caller's own
 * session fact, not a property of the inspection a client reads, so the row leaves without it.
 */
export function toInspectionRecord<T extends object>(inspection: T): Omit<T, 'templateSnapshot' | 'tenantId'> & { templateSnapshot: { sections: unknown[] } | null } {
    // `T extends object`, not a weak type with the key optional: the short Inspection DTO a replayed create answers with does not name the key,
    // but the row behind it carries it at run time.
    const stored: unknown = 'templateSnapshot' in inspection ? inspection.templateSnapshot : undefined;
    const record: Record<string, unknown> = { ...inspection, templateSnapshot: parseSnapshot(stored) };
    delete record['tenantId'];
    return record as Omit<T, 'templateSnapshot' | 'tenantId'> & { templateSnapshot: { sections: unknown[] } | null };
}

/** The template row a staff payload carries beside the inspection, without the company id; absent or null stays as it was. */
export function templateRecord<T extends object>(template: T | null | undefined): Omit<T, 'tenantId'> | null | undefined {
    return template ? withoutCompanyId(template) : template;
}
