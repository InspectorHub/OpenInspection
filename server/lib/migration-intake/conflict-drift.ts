/**
 * Whether a row's clash answer has moved between deciding and doing.
 *
 * Conflicts are worked out when a run is staged, and apply can happen much
 * later: the operator spends time in the repair step, and a colleague creates
 * the very contact this run was about to insert. Acting on the stale answer
 * produces a duplicate nobody was asked about, or replaces a row nobody saw.
 *
 * So the SAME rule is re-run immediately before each write — `resolveConflicts`
 * itself, not a second derivation of it, because two definitions of "is this
 * the same person" drift and the drift shows up as exactly the duplicate this
 * is here to prevent.
 *
 * A moved answer is a FAILURE, never a quiet correction. Taking the new answer
 * decides on the operator's behalf; keeping the old one decides on their behalf
 * too. The reason they were shown the row at all is that we asked them to
 * decide, so the row is failed with the change written down and they get to
 * answer the question again.
 */
import { resolveConflicts, type IntakeDb } from './conflicts';
import type { EntityKind } from './bundle';

/**
 * The part of a staged row this question needs.
 *
 * Narrower than the table row on purpose: it takes the three columns the rule
 * reads, so a caller holding something row-shaped can ask without this module
 * depending on the schema, and a reader can see the whole input.
 */
export interface DriftCandidate {
    entity: EntityKind;
    /** The bundle entry, as it was stored. */
    payload: string;
    /** What staging said this collides with. */
    conflictWith: string | null;
}

/**
 * How a report names one entry to the person who uploaded it.
 *
 * The email address where there is one, because that is the field the clash was
 * decided on and the one they can find in their own file. A template has no
 * address and is named by its name, for the same reason.
 */
function describeRowSubject(entity: EntityKind, payload: unknown): string {
    const p = payload as { email?: string; name?: string } | null;
    if (entity === 'template') return `"${p?.name ?? 'this template'}"`;
    return p?.email ?? `"${p?.name ?? 'this entry'}"`;
}

/**
 * The sentence the operator reads, or null when nothing changed.
 *
 * Three distinguishable outcomes rather than one "something changed", because
 * what they have to do about it differs: an entry that now exists is a question
 * about keeping theirs, an entry that has gone is a question about adding this
 * one, and a match that moved to a different row is neither.
 */
export async function conflictDrift(
    db: IntakeDb,
    tenantId: string,
    targetId: string | null,
    row: DriftCandidate,
): Promise<string | null> {
    const payload: unknown = JSON.parse(row.payload);
    const [current] = await resolveConflicts(db, tenantId, row.entity, [payload], targetId);
    const before = row.conflictWith ?? null;
    const after = current ?? null;
    if (before === after) return null;

    const label = describeRowSubject(row.entity, payload);
    if (before === null) {
        return `${label} now already exists here — it did not when you reviewed this import. `
            + 'Review this entry again and choose whether to keep the existing one.';
    }
    if (after === null) {
        return `The entry this import was going to replace with ${label} no longer exists. `
            + 'Review this entry again and choose whether to add it as new.';
    }
    return `${label} now matches a different existing entry than it did when you reviewed `
        + 'this import. Review this entry again.';
}
