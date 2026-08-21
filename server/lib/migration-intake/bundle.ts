/**
 * The migration-intake vocabulary — a PURE TYPE MODULE.
 *
 * Zero runtime dependency on drizzle or hono, deliberately: the adapters and
 * the staging schema both take their words from here, so the vocabulary exists
 * once rather than being spelled twice and drifting.
 */
import { ROLE, ROLES, type Role } from '../auth/roles';
import type { PermissionOverrides } from '../auth/capabilities';
import type { TemplateSchemaV2 } from '../../types/template-schema';

export const MIGRATION_ENTITY_KINDS = ['template', 'contact', 'member'] as const;
export type EntityKind = typeof MIGRATION_ENTITY_KINDS[number];

/**
 * Where a bundle came from. Provenance for display only — the intake path
 * never matches on it, because the entry point the operator used already
 * states what they meant and a guess has a case it gets wrong.
 */
export const VENDOR_IDS = ['spectora', 'csv_generic', 'home_inspector_pro', 'homegauge'] as const;
export type VendorId = typeof VENDOR_IDS[number];

/**
 * The contact-type vocabulary, declared here rather than imported from the
 * database layer so that an adapter's import graph stays free of the ORM.
 * `bundle-vocabulary.spec.ts` asserts at runtime that this list and the
 * column's own enum are the same list, so the duplication cannot drift.
 */
export const BUNDLE_CONTACT_TYPES = ['agent', 'client', 'other'] as const;
export type BundleContactType = typeof BUNDLE_CONTACT_TYPES[number];

/**
 * The roles an import may grant. `agent` is excluded by construction: agent
 * access is granted per inspection and holds no seat, so it has no business
 * arriving through a bulk upload.
 */
export type BundleMemberRole = Exclude<Role, 'agent'>;

/**
 * The same list as a value, subtracted from the taxonomy at runtime rather than
 * re-typed as literals.
 *
 * There were THREE spellings of it before this lived here: the adapter derived
 * it, the row describer hard-coded `['owner', 'manager', 'inspector']`, and the
 * remap request schema wrote a third enum. The first two now read this; a role
 * added to the taxonomy is therefore accepted by an upload and named by the
 * describer's sentence on the same day, instead of being refused with a message
 * that reads like the operator's file is wrong.
 */
export const BUNDLE_MEMBER_ROLES: readonly BundleMemberRole[] =
    ROLES.filter((r): r is BundleMemberRole => r !== ROLE.AGENT);

/** Deliberately loose. This is a "did somebody type an address here" check, not an RFC. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The ONE definition of "an email address" this feature has.
 *
 * There were two, and they disagreed. The upload was gated on zod's
 * `.email()` while the repair screen judged the same value by the shape above,
 * so an address zod rejects and this accepts — `x@y.z`, or anything with a
 * non-ASCII letter in it — voided the operator's whole file while the screen
 * built to fix it had nothing to say about the row. This is the rule that
 * survived, because it is the one whose verdict the operator is actually shown.
 *
 * It is loose on purpose and lets through addresses that will never receive
 * mail. That is the intended trade: a delivery failure is visible and
 * recoverable, whereas refusing an address somebody genuinely uses is neither.
 */
export function looksLikeEmailAddress(value: string): boolean {
    return EMAIL_SHAPE.test(value);
}

/**
 * A contact type, or null when the value is not one of ours.
 *
 * Narrowing lives HERE rather than at each write because the bundle format now
 * carries what the file said — a row whose type is "Buyer" is staged so it can
 * be corrected, and a writer that trusted the declared type would put that
 * string in a column whose enum does not have it.
 */
export function asBundleContactType(value: unknown): BundleContactType | null {
    return (BUNDLE_CONTACT_TYPES as readonly string[]).includes(value as string)
        ? (value as BundleContactType)
        : null;
}

/** A grantable role, or null when the value is not one — `agent` very much included. */
export function asBundleMemberRole(value: unknown): BundleMemberRole | null {
    return (BUNDLE_MEMBER_ROLES as readonly string[]).includes(value as string)
        ? (value as BundleMemberRole)
        : null;
}

/** How much of a source template survived conversion, per tab. */
export interface ConvertStats {
    sections: number;
    items: number;
    information: number;
    limitations: number;
    defects: number;
    unknownCommentTypes: string[];
}

/**
 * Per-entity accounting for one conversion.
 *
 * `dropped` names each lost entry instead of counting them, because a count
 * tells the operator that something is missing without telling them what.
 * The validator requires `readFromSource === emitted + dropped.length`, so a
 * silent skip cannot be expressed in this format at all.
 */
export interface EntityCounts {
    /** How many entries of this kind the source file contained. */
    readFromSource: number;
    /** How many made it into the bundle. Must equal the matching array's length. */
    emitted: number;
    /** Every entry that did not, located and explained. */
    dropped: { at: string; reason: string }[];
}

/** An adapter-level note about the conversion as a whole — never a per-row error. */
interface BundleWarning {
    code: string;
    message: string;
}

export interface BundleManifest {
    source: { vendor: VendorId; exportedAt?: string | undefined };
    adapter: { name: string; version: string };
    counts: Record<EntityKind, EntityCounts>;
    warnings: BundleWarning[];
}

export interface BundleTemplate {
    name: string;
    schema: TemplateSchemaV2;
    stats: ConvertStats;
}

/**
 * A contact as the FILE says it reads — not as a writer would like it.
 *
 * `name` and `type` are `string` rather than "a non-empty name" and "one of
 * ours" because a bad row fails the row, not the upload: an entry the operator
 * has to correct has to be able to exist in this format, or the screen built to
 * correct it can never be shown one. Everything that WRITES a contact narrows
 * first — `asBundleContactType` for the type, `describeRowProblem` for the row
 * as a whole — and a row that will not narrow is failed with its own sentence.
 */
export interface BundleContact {
    name: string;
    email?: string | undefined;
    phone?: string | undefined;
    agency?: string | undefined;
    /** Required on purpose: a default here is a question the mapping step never asks. */
    type: string;
}

/**
 * A member as the file says it reads. Same bargain as `BundleContact`, with one
 * extra rule that does NOT bend: `email` stays REQUIRED, because it is where the
 * invitation goes. A malformed one stages as a problem row; an absent key is a
 * bundle that never described the row at all.
 */
export interface BundleMember {
    email: string;
    name?: string | undefined;
    role: string;
    permissionOverrides?: PermissionOverrides | undefined;
}

/**
 * The one format every adapter produces and the staging step consumes.
 *
 * It carries NO primary keys of its own. Ids are minted when a row reaches a
 * real table, so a vendor identifier can never become one of ours and two
 * vendors' colliding identifiers can never quietly merge two rows.
 *
 * There is no cross-entity reference either. Templates, contacts and members
 * do not point at one another in this round; a row's identity is its staging
 * row id, and reports locate entries by it.
 */
export interface MigrationBundleV1 {
    formatVersion: 1;
    manifest: BundleManifest;
    templates: BundleTemplate[];
    contacts: BundleContact[];
    members: BundleMember[];
}
