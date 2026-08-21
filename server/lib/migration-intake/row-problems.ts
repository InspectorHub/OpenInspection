import { ROLE } from '../auth/roles';
import {
    BUNDLE_CONTACT_TYPES,
    BUNDLE_MEMBER_ROLES,
    looksLikeEmailAddress,
    type EntityKind,
} from './bundle';

/**
 * Why one staged entry cannot be written as it stands.
 *
 * `reason` is a sentence that names what to change. Words like "invalid" and
 * "corrupt" describe our reaction to the row rather than the row, and somebody
 * holding a spreadsheet cannot act on either.
 */
export interface RowProblem {
    /** Which field to look at, where one field is at fault. */
    field?: string;
    reason: string;
    /** What the field holds today, so the operator can find it in their file. */
    value?: string;
    /** What we would use if they accept — offered, never applied. */
    suggestion?: string;
}

/**
 * The roles a bulk import may grant, and what an address looks like, are both
 * read from the vocabulary module rather than restated here.
 *
 * They used to be restated. The role list was a hand-written
 * `['owner', 'manager', 'inspector']` beside an adapter that derived the same
 * list by subtraction, and the address rule was a regex here beside a
 * `z.string().email()` in the bundle validator that disagreed with it — two
 * rules in one feature, and the operator was shown one and refused by the
 * other. `agent` is still answered with its own sentence, because "not one of
 * the roles" is a true statement that explains nothing.
 */

function asRecord(payload: unknown): Record<string, unknown> {
    return (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
}

function str(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function contactProblem(row: Record<string, unknown>): RowProblem | null {
    const name = str(row.name);
    if (!name) {
        return {
            field: 'name',
            reason: 'This entry has no name. Every contact needs one — map a column to it, or type one in.',
        };
    }
    const email = str(row.email);
    if (email && !looksLikeEmailAddress(email)) {
        return {
            field: 'email', value: email,
            reason: 'This does not look like an email address. Correct it, or clear it — a contact without one is fine.',
        };
    }
    const type = str(row.type);
    if (!(BUNDLE_CONTACT_TYPES as readonly string[]).includes(type)) {
        return {
            field: 'type', value: type,
            reason: `A contact has to be one of ${BUNDLE_CONTACT_TYPES.join(', ')}.`,
            suggestion: 'client',
        };
    }
    return null;
}

function memberProblem(row: Record<string, unknown>): RowProblem | null {
    const email = str(row.email);
    if (!email) {
        return {
            field: 'email',
            reason: 'This entry has no email address, and an invitation has nowhere else to go.',
        };
    }
    if (!looksLikeEmailAddress(email)) {
        return {
            field: 'email', value: email,
            reason: 'This does not look like an email address, so the invitation could not be delivered.',
        };
    }
    const role = str(row.role);
    if (role === ROLE.AGENT) {
        return {
            field: 'role', value: role,
            reason: 'Agent access is granted per inspection rather than held as a seat, so it cannot be given here.',
            suggestion: 'inspector',
        };
    }
    if (!(BUNDLE_MEMBER_ROLES as readonly string[]).includes(role)) {
        return {
            field: 'role', value: role,
            reason: `A team member has to be one of ${BUNDLE_MEMBER_ROLES.join(', ')}.`,
            suggestion: 'inspector',
        };
    }
    return null;
}

function templateProblem(row: Record<string, unknown>): RowProblem | null {
    const name = str(row.name);
    if (!name) {
        return {
            field: 'name',
            reason: 'This template has no name. Type one in — it is what you will see in the templates list.',
        };
    }
    const schema = asRecord(row.schema);
    const sections = Array.isArray(schema.sections) ? schema.sections : [];
    if (sections.length === 0) {
        return {
            field: 'schema',
            reason: 'This template has no sections, so importing it would create an inspection form with nothing on it.',
        };
    }
    return null;
}

/**
 * The one definition of "this entry is not writable yet".
 *
 * Used by the report to count the problems bucket AND by the repair step to
 * decide whether an edit fixed anything. Two definitions would let a row read
 * as repaired on one screen and unrepaired on the next.
 *
 * ONE problem is returned rather than all of them: the operator fixes a field
 * and the row is asked again, so a list would mostly be a list of things that
 * stopped being true. The order the fields are checked in is the order they
 * have to be dealt with.
 */
export function describeRowProblem(entity: EntityKind, payload: unknown): RowProblem | null {
    const row = asRecord(payload);
    if (entity === 'contact') return contactProblem(row);
    if (entity === 'member') return memberProblem(row);
    return templateProblem(row);
}
