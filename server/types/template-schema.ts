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

/** Optional sub-fields nested under an item, e.g. tonnage on an HVAC unit. */
interface ItemAttribute {
    id: string;
    name: string;
    type: ItemAttributeType;
    choices?: string[];
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

/** The inspection-level fields a binding may read. Closed on purpose — see
 *  `StatutoryValueSource`. Each maps to one column the inspection already has. */
export type StatutoryInspectionField =
    | 'client_name'
    | 'client_email'
    | 'client_phone'
    | 'property_address'
    | 'property_city'
    | 'property_state'
    | 'property_zip'
    | 'inspection_date'
    | 'inspector_name'
    | 'inspector_license';

/**
 * One repeated block on the authority's form.
 *
 * -- WHY SLOTS ARE NAMED AND NOT NUMBERED ------------------------------------
 * The form prints a name over each one. Measured on the Citizens four-point
 * form: the electrical block is "Main Panel" / "Second Panel" and the roof block
 * is "Predominant Roof" / "Secondary Roof". Those are not "the first" and "the
 * second" -- predominant versus secondary is a property of the roof, and a
 * reader handed "Roof 2" has been told something the form does not say.
 * Addressing stays positional underneath; what a person sees is always the
 * form's own wording.
 *
 * -- WHY CAPACITY IS A MEASUREMENT -------------------------------------------
 * It is the slot count on ONE revision, established by the person who read that
 * revision, and it sits beside `checkedBy` for the same reason: no gate can
 * check it. A house with three panels overflows a form with two, and that is
 * the form's constraint rather than a bug in the count.
 */
export interface FieldGroup {
    /** Group id, e.g. `electrical_panel`. */
    id: string;
    /** Human-readable name of the block, e.g. `Electrical Panel`. */
    label: string;
    /** Slots on THIS revision, counted on the page. Never guessed. */
    capacity: number;
    /**
     * What the form prints over each slot, in page order. MUST have exactly
     * `capacity` entries -- `validateGroups` enforces it.
     */
    slotLabels: readonly string[];
    /** Field names inside one instance, e.g. `total_amps`. */
    fields: readonly string[];
}

/**
 * Where one value on the form comes from.
 *
 * A CLOSED discriminated union, with `from` as the discriminant. The closure is
 * the point: an open `from: string`, or an open field name, would defer a typo
 * to runtime — and the entire observable output of that typo is a BLANK BOX on
 * somebody's statutory form, which reads as an inspector who failed to answer
 * rather than as software that failed to look. A compiler error is the only
 * place that mistake is cheap.
 *
 * `signature` resolves BY REFERENCE at render time and never enters the
 * collected values. A signature image is the most tightly classified personal
 * data this repository holds, and the values object is declared to carry none;
 * routing it through there would retract that declaration in one step. `scope`
 * names WHICH PART of the form the signature stands behind, exactly as the
 * matching `signature` field mapping does -- one form can carry several
 * signatures that each answer for a different section. Use `whole_form` when
 * the form has a single signer.
 */
export type StatutoryValueSource =
    | { from: 'item'; itemId: string }
    | { from: 'item_attribute'; itemId: string; attribute: string }
    | { from: 'inspection'; field: StatutoryInspectionField }
    | { from: 'literal'; value: string }
    | { from: 'signature'; scope: string };

/** One template's statutory-form declaration. */
export interface StatutoryFormDeclaration {
    /** The form, not the revision (see above) — e.g. `tx_trec_rei`. */
    formId: string;
    /** Form field name -> where its value comes from. A field the authority's
     *  form requires and this map omits is a gap the fidelity gate reports; it
     *  is never silently rendered blank. */
    bindings: Record<string, StatutoryValueSource>;
    /** Repeated blocks on this form. Absent when the form has none -- the
     *  Florida wind-mitigation form has none at all. */
    groups?: readonly FieldGroup[];
}

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
