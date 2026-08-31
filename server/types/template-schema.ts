import type { StatutoryFormDeclaration } from './statutory-declaration';
/**
 * Spec 5B — Defect Model + Canned Comment Library.
 *
 * Type definitions for inspection template schemas (schemaVersion 2).
 *
 * Each template has sections; each section has items; each item is now
 * "rich" — carrying three tabs of pre-built canned comments
 * (Information / Limitations / Defects). Inspectors toggle which canned
 * entries are included on a given inspection and may override the comment
 * text or add custom comments.
 *
 * Inspection-result data carries per-item state under
 * InspectionItemState — see `inspection-item-state.ts`.
 */

/**
 * Defect category — references a tenant `defect_categories.id` (or, for
 * templates/inspections predating Authoring-unification Plan-4 module K, one
 * of the legacy seed names `maintenance` / `recommendation` / `safety`).
 * Drives report Summary inclusion via `defect_categories.drivesSummary`
 * (see `InspectionReportService.defectDrivesSummary`), resolved by id-or-name
 * so both old and new values keep working with no data migration.
 */
export type DefectCategory = string;

/** Information / Limitations canned entry. */
export interface CannedInfoComment {
    /** Stable id (template-scoped, e.g. "ri1"). */
    id: string;
    /** Short heading shown above the comment in the editor. */
    title: string;
    /** Comment body (plain text). */
    comment: string;
    /** When true, this entry is auto-included on new inspections. */
    default: boolean;
    /** Optional shortcode typed in the editor to fill this comment (≤ 12 chars). */
    abbrev?: string;
}

/** Defect canned entry — adds category + per-defect location and photos. */
export interface CannedDefect {
    id: string;
    title: string;
    category: DefectCategory;
    /** Free-text location ("Northeast corner") — default empty in template. */
    location: string;
    comment: string;
    /** R2 keys captured at template-level (rare); inspection-side defects
     *  store their own photos in InspectionItemState. */
    photos: string[];
    default: boolean;
    /** Optional shortcode typed in the editor to fill this comment (≤ 12 chars). */
    abbrev?: string;
}

/** Three-tab canned comment buckets attached to each item. */
export interface ItemTabs {
    information: CannedInfoComment[];
    limitations: CannedInfoComment[];
    defects: CannedDefect[];
}

/** Item types — `rich` is the headline interactive type (rating + three
 *  canned-comment tabs). The 8 simpler types cover non-rated data points
 *  the editor surfaces (booleans, numbers with min/max/unit, single- and
 *  multi-select with choices, date pickers, photo-only fields, and plain
 *  text / textarea inputs). */
export type ItemType =
    | 'rich'
    | 'text'
    | 'boolean'
    | 'textarea'
    | 'number'
    | 'select'
    | 'multi_select'
    | 'date'
    | 'photo_only';

type ItemAttributeType =
    | 'boolean' | 'text' | 'number' | 'select' | 'multi_select' | 'date';

/**
 * One option an attribute offers.
 *
 * A bare string means the value and the label are the same thing, which is what
 * every template written before this widening says, and it keeps meaning that.
 *
 * The pair exists because a statutory template's stored values are the tokens a
 * form's `whenValue` is matched against -- `blowing_fuses`,
 * `improper_breaker_size`, `other_explain` -- and those were what the inspector
 * read on screen. The wording beside each box is PRINTED on the authority's
 * form, so putting it here is transcription, not invention.
 *
 * 🔴 THE VALUE IS THE VALUE. `render.ts` compares `value === whenValue` byte for
 * byte, so `label` is display only and must never be what gets stored. Storing
 * a label produces a completely blank official form and no gate goes red for it
 * -- that has already happened once, in `c6569cae`.
 *
 * WHY NOT A PARALLEL `choiceLabels` MAP. Two lists that must agree, with nothing
 * making them agree, is the failure this project keeps hitting: one gets an
 * entry, the other does not, and the disagreement is invisible until an
 * inspector reads a raw key or a form prints blank. Pairing them makes drift
 * unrepresentable rather than merely discouraged.
 */
export type ItemChoice = string | { value: string; label: string };

/** Optional sub-fields nested under an item, e.g. tonnage on an HVAC unit. */
interface ItemAttribute {
    id: string;
    name: string;
    type: ItemAttributeType;
    choices?: ItemChoice[];
    unit?: string;
    required?: boolean;
    isSafety?: boolean;
    isDefect?: boolean;
    /** WHAT to do about the attribute reading badly — never what it costs. The
     *  former `estimateMin` / `estimateMax` pair is rejected by the template
     *  write schema; see the TemplateItem note below. */
    recommendation?: string | null;
}

/** Per-item sub-properties — only meaningful on non-rich types. */
export interface ItemOptions {
    min?: number | null;
    max?: number | null;
    unit?: string;
    step?: number | null;
    placeholder?: string;
    maxLength?: number | null;
    choices?: string[];
    minPhotos?: number | null;
}

/** Provenance for templates imported from upstream platforms. */
interface ItemSource {
    platform: string;
    externalId: string;
}

export interface TemplateItem {
    id: string;
    label: string;
    type: ItemType;
    description?: string;
    /** Rating options shown at the top of an item card. Required for 'rich'. */
    ratingOptions?: string[];
    /** Three tabs of canned comments. Required for 'rich'. */
    tabs?: ItemTabs;
    /** Sub-properties on non-rich types (min/max/choices/...). */
    options?: ItemOptions;
    /** Optional icon key + display number (used by some templates). */
    icon?: string;
    number?: string;
    required?: boolean;
    isSafety?: boolean;
    /**
     * The remedy this item usually calls for, as prose. Scope, not a figure.
     *
     * The `defaultEstimateMin` / `defaultEstimateMax` pair that sat beside it is
     * gone, and the template write schema now REJECTS both (the item schemas are
     * `.strict()`). A template is reused across every property a company
     * inspects, so a repair price declared here is a number that knows nothing
     * about the property it ends up printed against — the same reason the
     * canned-comment estimate columns were dropped. See
     * `scripts/check-price-capability.mjs`.
     */
    defaultRecommendation?: string;
    attributes?: ItemAttribute[];
    source?: ItemSource | null;
    /**
     * The item this one sits under; absent or null means top level.
     *
     * -- WHY A PARENT POINTER AND NOT AN INDENT LEVEL ---------------------
     * An indent level draws the same picture and answers none of the
     * questions that matter: delete the parent and its indented rows are
     * still level 2, dangling under nothing; move the parent and nothing
     * knows what should travel with it. A parent pointer answers both, and
     * makes "is this document well formed" a question with an answer.
     *
     * -- WHY NOT A `children` ARRAY ---------------------------------------
     * Dozens of places walk `section.items` as a flat array. Nesting the
     * array turns every one of them into a recursion, and the ones that are
     * missed do not throw -- they silently print less. A parent pointer keeps
     * the array one-dimensional, so every existing walk still sees every item.
     *
     * -- THE ARRAY ORDER IS THE TREE ORDER --------------------------------
     * `items` is a pre-order walk of the tree: an item's whole subtree sits
     * immediately after it and before its next sibling. That invariant is what
     * lets a report print A, A.1, A.1.a, A.2, B by reading the array in order,
     * with no renderer change at all. See `server/lib/template-hierarchy.ts`.
     *
     * Depth is capped at three levels -- the same bound, for the same
     * bounded-parent-walk reason, as the unit tree in `services/unit.service.ts`.
     * A parent in another section is not a parent: sections are the report's
     * pagination and table-of-contents unit.
     */
    parentId?: string | null;
}

interface SectionApplicability {
    propertyTypes?: ('single-family' | 'multi-unit' | 'commercial')[];
    commercialSubtypes?: string[];
}

export interface TemplateSection {
    id: string;
    title: string;
    icon?: string;
    identifier?: string;
    items: TemplateItem[];
    disclaimerText?: string | null;
    alwaysPageBreak?: boolean;
    source?: ItemSource | null;
    /** FROZEN (module A): authored applicability retired; kept for round-trip of
     *  already-stored templates + OpenAPI-snapshot stability. Not authored in UI. */
    defaultScope?: 'common' | 'unit';
    /** FROZEN (module A): see `server/lib/section-applicability.ts`. Not authored in UI. */
    applicableTo?: SectionApplicability;
    sharedComments?: {
        information?: CannedInfoComment[];
        defects?: CannedDefect[];
    };
}

// Not exported: the only consumer is `RatingSystem` below, which is not
// exported either. It was exported for the JSON paste adapter that read
// another product's four-bucket comment model, and that adapter went with the
// endpoint it served. Index through `RatingSystem['levels'][number]` rather
// than re-exporting it for one call site.
interface RatingLevel {
    id: string;
    label: string;
    abbreviation?: string;
    color?: string;
    severity?: 'good' | 'minor' | 'marginal' | 'significant';
    isDefect?: boolean;
    default?: boolean;
    description?: string;
    /** Workflow shortcuts PR — pause auto-advance after rating with this level. */
    pausesAdvance?: boolean;
}

interface RatingSystem {
    name?: string;
    defaultLevelId?: string;
    source?: string | null;
    levels: RatingLevel[];
}

export interface TemplateUnit {
    id: string;
    name: string;
    type: 'unit' | 'common';
}

export interface TemplateBuilding {
    id: string;
    name: string;
    units: TemplateUnit[];
}

interface TemplateStructure {
    buildings: TemplateBuilding[];
}

/**
 * A template's declaration that it produces an authority's own statutory form.
 *
 * WHY THIS IS A TOP-LEVEL KEY AND NOT A TENTH `ItemType`. Everything about it
 * is a property of the WHOLE template, not of one row in it: which revision of
 * the form applies is chosen from the inspection's date, whether the required
 * values are all bound is a question about the template as a document, and the
 * declaration governs a rendering step that happens once per inspection rather
 * than once per item. An item type can express none of those — it can only say
 * "this one row behaves differently", which is the wrong grain and would leave
 * the version choice with no owner.
 *
 * IT NAMES A FORM, NEVER A REVISION. Which revision applies is decided by the
 * inspection date. A revision pinned here would go stale the moment the
 * authority republishes, and would put that choice in the hands of whoever last
 * edited the template instead of in the date the inspection actually happened.
 *
 * ⚠️ THIS KEY IS PLATFORM-SUPPLIED AND NOT WRITABLE BY A WORKSPACE. The tenant
 * validation schema is `.strict()` and deliberately does not list it, so a
 * template carrying one cannot arrive through the tenant surface at all. That
 * closed door is the enforcement; this comment is only the reason for it.
 */

/**
 * The declaration types, re-exported COMPLETE.
 *
 * ⚠️ `StatutoryFieldDependencies` is baselined in `scripts/knip-baseline.json`
 * and is the only member here with no importer of its own — the one place that
 * needs it takes it from `statutory-declaration` directly. It stays because
 * this list is a SURFACE rather than a collection of individually-earned
 * exports: a reader who reaches a declaration type through this module and
 * finds five of the six has been told something false about where the sixth
 * lives. Dropping it would make the module's answer depend on which types
 * happened to have a second consumer this week.
 */
export type {
    StatutoryInspectionField,
    FieldGroup,
    StatutoryValueSource,
    StatutoryFieldDependency,
    StatutoryFieldDependencies,
    StatutoryFormDeclaration,
} from './statutory-declaration';

export interface TemplateSchemaV2 {
    schemaVersion: 2;
    sections: TemplateSection[];
    ratingSystem?: RatingSystem;
    propertyType?: 'single-family' | 'multi-unit' | 'commercial';
    commercialSubtype?: string;
    structure?: TemplateStructure;
    sectionAssignments?: {
        common: string[];
        unit: string[];
    };
    itemAssignments?: Record<string, string[]>;
    propertyMetadataFields?: PropertyMetaField[];
    /**
     * Present only on a platform-supplied template that produces an authority's
     * own form. Absent on every template a workspace can author, and absent is
     * the ordinary case.
     */
    statutoryForm?: StatutoryFormDeclaration;
}

interface PropertyMetaField {
    id: string;
    label: string;
    type: 'text' | 'number' | 'select' | 'boolean' | 'date';
    group?: string;
    required?: boolean;
    unit?: string;
    options?: string[];
}
