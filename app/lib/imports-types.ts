/**
 * The shapes the import screens read off a run report, and the vocabularies
 * their controls offer.
 *
 * The REPORT shapes are re-declared here rather than imported from the report
 * service: that module reaches the database, and a route module that pulls one
 * in drags a Drizzle table definition into the client bundle. The report is JSON
 * over HTTP, and these are what that JSON is once it has been through the wire.
 *
 * The VOCABULARIES are the opposite call, and deliberately so. A contact's type
 * and a team role are closed lists whose single source of truth is a pure module
 * with no ORM in its graph, and both of those modules say in their own docblock
 * that every consumer must derive from them. Re-typing either list here would be
 * a mapping form that keeps offering `client` after the list has moved on, with
 * nothing to notice — and this feature exists because a silent wrong answer was
 * shipped once already.
 *
 * `role` subtracts `agent` — but the subtraction is no longer PERFORMED here.
 * It was, and so was the same subtraction in the adapter, beside a hand-written
 * `['owner', 'manager', 'inspector']` in the row describer and a third enum in
 * the remap schema. Four spellings of one list is three chances for a dropdown
 * to keep offering a role an upload has stopped accepting, so the list is now
 * read from the vocabulary module like the contact types beside it.
 */
import {
    BUNDLE_CONTACT_TYPES,
    BUNDLE_MEMBER_ROLES,
    type BundleContactType,
    type BundleMemberRole,
} from "../../server/lib/migration-intake/bundle";

/** What a contact may be. */
export const IMPORT_CONTACT_TYPES: readonly BundleContactType[] = BUNDLE_CONTACT_TYPES;

/** What a bulk invitation may grant: the taxonomy minus the one it cannot. */
export const IMPORT_MEMBER_ROLES: readonly BundleMemberRole[] = BUNDLE_MEMBER_ROLES;

/**
 * How an entry that clashes with something already here is settled.
 *
 * Written out rather than imported, unlike the two lists above: this one lives
 * on the Drizzle column enum, and reaching for it would put a table definition
 * in the browser bundle. `settings-imports-batch.test.tsx` renders every option
 * and the server's own zod enum refuses anything else, so a value that drifted
 * apart from the column would be a red test rather than a silent no-op.
 */
export const IMPORT_CONFLICT_POLICIES = ["skip", "overwrite", "per_row"] as const;
export type ImportConflictPolicy = (typeof IMPORT_CONFLICT_POLICIES)[number];

/** The uploaded file's header row and a few rows under it, as the adapter read them. */
export interface AdapterInspection {
    columns: string[];
    sampleRows: Record<string, string>[];
}

/**
 * Where one field's value comes from: a column of the file, or one answer given
 * for every entry in it.
 *
 * Two shapes, no third. "Not answered" is not expressible, because a required
 * field with no source is an incomplete mapping rather than a mapping with a
 * blank in it — which is the distinction the step exists to hold.
 */
export type ValueSource<T extends string> = { fixed: T } | { column: string };

export interface ContactMapping {
    name: string;
    email?: string;
    phone?: string;
    agency?: string;
    type: ValueSource<BundleContactType>;
}

export interface MemberMapping {
    email: string;
    name?: string;
    role: ValueSource<BundleMemberRole>;
}

export type StageMapping =
    | { kind: "template"; name: string }
    | { kind: "contacts"; mapping: ContactMapping }
    | { kind: "members"; mapping: MemberMapping };

/**
 * The mappings that have columns to point at.
 *
 * A template mapping carries a NAME rather than a column choice, and it never
 * reaches the mapping step at all: the adapter that reads template exports
 * implements no `inspect()`, so the report carries no columns for it and the
 * step is dropped. Narrowing here is what stops that fact from having to be
 * remembered — an arm of the form for a mapping that cannot arrive is an arm
 * nothing ever renders and nothing can assert.
 */
export type ColumnMapping = Extract<StageMapping, { kind: "contacts" } | { kind: "members" }>;

/** One entry that needs a person before the run can go ahead. */
export interface ProblemRow {
    rowId: string;
    /** Which family the entry belongs to: `contact`, `member` or `template`. */
    entity: string;
    /** Index within that family — how the operator finds it in their own file. */
    position: number;
    field?: string;
    reason: string;
    value?: string;
    suggestion?: string;
    /**
     * The entry as it currently stands.
     *
     * A repair REPLACES the whole entry, so a screen that edits one field has to
     * send the rest back unchanged and has nowhere else to read them from.
     */
    payloadEcho: Record<string, unknown>;
}
