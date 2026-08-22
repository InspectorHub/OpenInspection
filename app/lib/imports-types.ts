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
    TEMPLATE_RATING_KINDS,
    type BundleContactType,
    type BundleMemberRole,
    type TemplateRatingKind,
} from "../../server/lib/migration-intake/bundle";

/** What a contact may be. */
export const IMPORT_CONTACT_TYPES: readonly BundleContactType[] = BUNDLE_CONTACT_TYPES;

/** What a bulk invitation may grant: the taxonomy minus the one it cannot. */
export const IMPORT_MEMBER_ROLES: readonly BundleMemberRole[] = BUNDLE_MEMBER_ROLES;

/**
 * The readings the template step offers, in the order it offers them.
 *
 * Read from the vocabulary module like the two lists above rather than typed
 * out here, so a reading added there appears on the form the day it exists
 * instead of being silently unofferable.
 */
export const IMPORT_TEMPLATE_RATING_KINDS: readonly TemplateRatingKind[] = TEMPLATE_RATING_KINDS;

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

/**
 * What the adapter could say about the file before converting it.
 *
 * A UNION, mirroring the server's, because the wizard's question differs by
 * what was uploaded and the two questions have nothing in common. A tabular
 * source is asked which column holds what. A template is asked what its own
 * rating words mean.
 *
 * Re-declared here rather than imported for the same reason as the shapes
 * above: this is what the JSON is once it has been through the wire, and the
 * server-side type lives in a module whose import graph reaches the readers.
 */
export type AdapterInspection =
    | {
        kind: "columns";
        columns: string[];
        sampleRows: Record<string, string>[];
    }
    | {
        kind: "template";
        /** The template's own name where the file carries one; null otherwise. */
        name: string | null;
        sections: number;
        items: number;
        /**
         * Verbatim, whitespace included. Real entries are `' Yes'` and
         * `'Acceptable '`, and trimming them for display hides from the person
         * classifying them exactly the thing he is classifying.
         */
        ratings: string[];
        /**
         * Which of the file's two possible vocabularies `ratings` is: the
         * words an inspector picks between when rating an item, or the words
         * the file files its canned comments under. Only the first has a
         * question to ask — the second is already the three comment tabs.
         */
        ratingsDescribe: "items" | "comments";
        /** `null` means the property was ABSENT, which is not the same as false. */
        ratingsShown: boolean | null;
    };

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

/**
 * What the template step settles: the name it is saved under, and what its own
 * rating words mean.
 *
 * `ratingKind` is REQUIRED and has no "unanswered" value, for the same reason
 * `ValueSource` has no third shape: the step starts at the reading that
 * changes nothing, so there is always an answer, and a nullable one would make
 * every reader invent what to do about it.
 */
export interface TemplateMapping {
    kind: "template";
    name: string;
    ratingKind: TemplateRatingKind;
}

export type StageMapping =
    | TemplateMapping
    | { kind: "contacts"; mapping: ContactMapping }
    | { kind: "members"; mapping: MemberMapping };

/**
 * The mappings that have columns to point at.
 *
 * A template mapping carries a name and a reading of its own rating words
 * rather than a column choice, so it has no columns to put on the screen and
 * gets its own arm of the form. Narrowing here is what keeps the two arms from
 * having to check each other's fields: the column controls are unreachable for
 * a template mapping by the compiler's own reckoning rather than by a
 * condition somebody has to remember.
 */
export type ColumnMapping = Extract<StageMapping, { kind: "contacts" } | { kind: "members" }>;

/**
 * How one item came out of the conversion.
 *
 * OUR words for what happened, not the item types they came from. The preview
 * must not print our storage names — that is the rule the mapping step exists
 * under — and a shape carrying them to the browser would put the temptation
 * one property away.
 */
type ItemLanding = "rated" | "choices" | "plain";

/**
 * What the conversion produced, for a run carrying something whose shape can
 * be judged.
 *
 * Re-declared here rather than imported from the report service for the same
 * reason as every shape above: that module reaches the database, and a route
 * that pulled it in would drag a Drizzle table definition into the client
 * bundle. This is what the JSON is once it has been through the wire.
 */
export interface BatchStructure {
    name: string;
    sections: { title: string; items: { label: string; landedAs: ItemLanding }[] }[];
    /**
     * Every entry the conversion could not carry, NAMED and located. Always
     * present, empty included — an absent list and an empty one look identical
     * on a screen, and the empty one is the information.
     */
    dropped: { at: string; reason: string }[];
    /**
     * What the conversion had to DECIDE — a comment whose type the file did not
     * state, filed under Information. Not a loss, which is why it is not folded
     * into `dropped`; also not nothing, which is why it is not left out.
     */
    warnings: { code: string; message: string }[];
}

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

/**
 * What `GET /api/imports/:batchId` answers with, as it arrives HERE.
 *
 * Declared rather than imported from the report service, because the two shapes
 * genuinely differ: `createdAt` is a `Date` on the server and a string by the
 * time JSON has been through the wire.
 */
export interface BatchReport {
    batch: {
        id: string;
        intent: string;
        vendor: string;
        status: string;
        createdAt: string;
    };
    counts: { total: number; ok: number; conflicts: number; problems: number };
    /** Only the entries needing a person, and only this page of them. */
    problemRows: ProblemRow[];
    /** How many there are behind the page. Without it a page of three is unreadable. */
    problemRowsTotal: number;
    page: number;
    pageSize: number;
    blockedReason: string | null;
    /** What the adapter could say about the file, and the mapping to start
     *  from. Both null together. */
    inspection: AdapterInspection | null;
    mapping: StageMapping | null;
    /** What this run brings in. Null only for a run opened for a file whose
     *  owner could not say what it was. */
    entityKind: "template" | "contact" | "member" | null;
    /** What the conversion produced, or null for a run with no shape to judge. */
    structure: BatchStructure | null;
    /** The day this run's entries are cleared, as `YYYY-MM-DD`, or null. */
    undoUntil: string | null;
}

