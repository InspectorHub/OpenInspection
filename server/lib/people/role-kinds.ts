/**
 * The contact-party axis: what a person IS on an inspection.
 *
 * Distinct from users.role (the staff seat) even though both use the word
 * "agent" — see the two-layer role model design §1.1. Every consumer derives
 * from here so the role-literal guard can stop exempting whole directories on
 * account of this axis.
 *
 * A LEAF module: it imports only `auth/roles`, which itself imports nothing.
 * That is deliberate — the editor, the people picker and the contact form all
 * read these values, and a vocabulary that dragged `drizzle-orm/d1` behind it
 * would be recopied by hand in the UI instead. Keep it plain data.
 */
import { ROLE } from '../auth/roles';

/**
 * The vocabulary itself, in the order every surface presents it: the person
 * the inspection is FOR, then the person representing them, then everyone
 * else. Declared as a tuple because that is the shape drizzle's `{ enum: [] }`
 * and `z.enum()` both take, so a column or a schema can read this array rather
 * than restate its members.
 */
export const ROLE_KINDS = ['client', 'agent', 'other'] as const;

export type RoleKind = (typeof ROLE_KINDS)[number];

/**
 * Named constants for comparison and assignment sites, mirroring the
 * ROLES/ROLE pair in `auth/roles.ts`. Derived from the tuple above, so a typo
 * here is a compile error rather than a silently unreachable branch.
 */
export const ROLE_KIND = {
    CLIENT: 'client',
    AGENT: 'agent',
    OTHER: 'other',
} as const satisfies Record<string, RoleKind>;

/**
 * Who may own a repair-request list (`repair_requests.created_by_kind`).
 *
 * NOT `ROLE_KINDS`, and the difference is enforced rather than stylistic.
 * `repair-access.ts` resolves an actor from a portal grant's role KIND and
 * gives a builder role to `client` and `agent` only: an `other`-kind grant
 * (attorney, transaction coordinator, insurance agent, title company) is
 * rejected outright, so a column accepting `other` would describe an owner
 * the resolver cannot produce. The third member is not a contact-party kind
 * at all — it is the STAFF seat reached through the owner-preview JWT, which
 * is why it is spelled with `ROLE.INSPECTOR` and not with a fourth literal.
 *
 * Adding a fourth `RoleKind` must therefore NOT widen this list on its own;
 * whether that kind gets a builder role is a decision in `repair-access.ts`.
 * `tests/unit/platform/role-enum-drift.spec.ts` pins the members so the
 * next "these look the same, unify them" reads as a failing test.
 */
export const REPAIR_CREATOR_KINDS = [ROLE_KIND.CLIENT, ROLE_KIND.AGENT, ROLE.INSPECTOR] as const;

export type RepairCreatorKind = (typeof REPAIR_CREATOR_KINDS)[number];
