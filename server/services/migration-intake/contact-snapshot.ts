import { contacts } from '../../lib/db/schema';

type ContactRecord = typeof contacts.$inferSelect;

/**
 * What an overwritten contact held before the import replaced it.
 *
 * One declaration, read from both ends: the apply path writes it, the undo path
 * reads it. Two sides each writing down what they believe the other stores is
 * how a field goes missing from a snapshot, and a field missing from a snapshot
 * is a field the undo silently fails to bring back.
 *
 * Adding a field here is deliberately a compile error in BOTH functions below,
 * so the pair cannot drift apart quietly.
 */
export interface ContactPriorState {
    name: string;
    email: string | null;
    phone: string | null;
    agency: string | null;
    type: ContactRecord['type'];
}

/**
 * Capture the columns an overwrite is about to touch, plus the address it
 * matched on, so restoring this returns the row to what it held.
 */
export function captureContactPriorState(row: ContactRecord): string {
    const snapshot: ContactPriorState = {
        name: row.name,
        email: row.email,
        phone: row.phone,
        agency: row.agency,
        type: row.type,
    };
    return JSON.stringify(snapshot);
}

function asNullableString(value: unknown): string | null | undefined {
    if (value === null) return null;
    return typeof value === 'string' ? value : undefined;
}

/**
 * Read a snapshot back, or refuse it.
 *
 * Every field is checked, and a MISSING key fails the same check a wrong type
 * does — which is the point. A snapshot that merely exists proves nothing: an
 * empty object is present, parses, and would restore a row to nothing. A
 * partial one is worse, because it would put some columns back and leave the
 * rest as the import made them, producing a row no source can account for.
 *
 * Returns null so the caller can refuse this row and carry on with the others,
 * rather than throwing and taking the rest of the undo with it.
 */
export function parseContactPriorState(json: string): ContactPriorState | null {
    let raw: unknown;
    try {
        raw = JSON.parse(json);
    } catch {
        return null;
    }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const snapshot = raw as Record<string, unknown>;

    const name = snapshot.name;
    if (typeof name !== 'string' || name.length === 0) return null;

    const email = asNullableString(snapshot.email);
    const phone = asNullableString(snapshot.phone);
    const agency = asNullableString(snapshot.agency);
    if (email === undefined || phone === undefined || agency === undefined) return null;

    // The column's own enum is the vocabulary, read at runtime rather than
    // restated here — a restated list is a second answer to the same question.
    const type = snapshot.type;
    const allowed: readonly string[] = contacts.type.enumValues;
    if (typeof type !== 'string' || !allowed.includes(type)) return null;

    return { name, email, phone, agency, type: type as ContactRecord['type'] };
}
