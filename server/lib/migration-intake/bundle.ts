/**
 * The migration-intake vocabulary — a PURE TYPE MODULE.
 *
 * Zero runtime dependency on drizzle or hono, deliberately: the adapters and
 * the staging schema both take their words from here, so the vocabulary exists
 * once rather than being spelled twice and drifting.
 */
import type { Role } from '../auth/roles';
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

export interface BundleContact {
    name: string;
    email?: string | undefined;
    phone?: string | undefined;
    agency?: string | undefined;
    /** Required on purpose: a default here is a question the mapping step never asks. */
    type: BundleContactType;
}

export interface BundleMember {
    email: string;
    name?: string | undefined;
    role: BundleMemberRole;
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
