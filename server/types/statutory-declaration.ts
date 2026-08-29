/**
 * The types a template uses to declare that it produces an authority's own form.
 *
 * -- WHY THESE LEFT `template-schema.ts` --------------------------------------
 * They started as a single declaration and grew into a cluster: repeatable
 * groups with named slots, a closed set of inspection-level sources, a signature
 * source that resolves by reference, and a destination for instances the form
 * has no slot for. That is a subsystem's worth of vocabulary, and it pushed the
 * template schema past the file-size ceiling. Splitting it is the documented
 * preference over raising a baseline.
 *
 * Everything here is RE-EXPORTED from `template-schema.ts`, so no import site
 * changed and none needs to: a reader looking for the template's shape still
 * finds these where they expect them.
 */

/**
 * The inspection-level fields a binding may read. Closed on purpose — see
 * `StatutoryValueSource`. Each maps to one column the inspection already has.
 *
 * -- MEMBERSHIP IS DECIDED BY WHETHER A REAL SOURCE EXISTS -------------------
 * A member here is a promise that the value can be resolved from a column
 * somebody already fills in. `company_name` and `company_phone` read the
 * workspace's own configuration, which is why they are here.
 *
 * Two boxes the Florida four-point form prints are deliberately NOT here, and
 * that absence was decided rather than overlooked:
 *
 *   - `Title` has no source anywhere in this repository.
 *   - `License Type` asks for a state licence class (home inspector, general
 *     contractor, building code inspector). The nearest column is an
 *     inspector credential's label, which holds an ASSOCIATION certification
 *     ("InterNACHI CPI"). Those are not the same thing, and answering a
 *     statutory licence-type box from it would print something that looks
 *     right and is wrong — the exact failure this subsystem exists to prevent.
 *
 * Both need a new source before they can be members. Do NOT add them as fields
 * hardwired to `null`: a member that can never resolve is a blank box on an
 * authority's form, which reads as an inspector who did not answer.
 *
 * New members go at the END, for the same reason new columns do — the order is
 * something readers see.
 */
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
    | 'inspector_license'
    | 'company_name'
    | 'company_phone';

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
 *
 * -- WHY AN OVERFLOW HAS A DESTINATION AND NOT ONLY A REFUSAL ----------------
 * The forms answer this themselves. The Citizens four-point form prints "(use
 * additional pages if needed)" on its Additional Comments box and, elsewhere,
 * "(Provide year and extent of renovation in the comments below)" — the
 * publisher has already said where an answer that outgrows its box goes. The
 * refusal has not been dropped, it has moved to the end: the extra instance is
 * written into `overflowTo`, and only a destination that cannot hold it either
 * refuses. Making the inspector retype the third panel into the comments box by
 * hand was the work; the refusal was never the point.
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
    /**
     * A field on THIS form that receives the instances the slots could not hold,
     * named as one of `bindings`' own keys (e.g. `additional_comments`).
     *
     * ABSENT MEANS THERE IS NOWHERE, and then an overflow is refused exactly as
     * it always was. That is not a theoretical branch: the Florida
     * wind-mitigation form has no comments, notes, remarks or explain field
     * anywhere on it. The destination is declared rather than guessed because
     * only somebody reading the page can say which box the publisher meant.
     */
    overflowTo?: string;
    /**
     * Roughly how many characters that destination box holds, counted on the
     * page by the same person who counted `capacity`.
     *
     * ABSENT MEANS UNMEASURED, not unlimited: the routed text then travels to
     * the renderer, where `fit.ts` measures the box geometrically against the
     * font and refuses there. This number exists because that later refusal
     * knows only that a field is too long — it cannot say that the THIRD PANEL
     * is what did not fit, which is the sentence a person needs to act on. So
     * where it is declared it refuses first, and where it is not the geometric
     * measurement is still the one that decides.
     */
    overflowMaxLength?: number;
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
 * `item_comments` composes ONE section's whole narrative -- the canned
 * information, limitation and defect entries the inspector included, with the
 * inspector's own edits applied, then their free-text notes. It exists because
 * these forms print one "Comments:" box per section and expect all of it, while
 * this product spreads that across several fields. Binding such a box to
 * `item_attribute` with a hand-made "comments" attribute would work and would be
 * wrong: it asks the inspector to retype beside a box they already filled, and
 * the two would then disagree about the same section. The composition resolves
 * inclusion, overrides and Mustache variables exactly as the report does, so one
 * finding cannot read differently on the two documents.
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
    | { from: 'item_comments'; itemId: string }
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
    /**
     * The authority's own revision label these bindings were authored against,
     * verbatim -- `7-6`, `Rev. 04/26`. Never the form id, which names the form.
     *
     * -- WHY A DECLARATION CARRIES A REVISION AFTER ALL --------------------
     * `formId` deliberately does not, because a form id carrying a revision
     * cannot express two revisions being usable at once. This is a different
     * fact: not "which revision applies", which is decided by the inspection's
     * date, but "which revision this template was BUILT FOR". Bindings are
     * authored against one revision's field map and may not be inherited across
     * revisions (`field-map.ts` says why at length), so without this the
     * question "is this template still the right one for this inspection" has
     * no answer at all -- the template would appear to produce whatever the
     * date selects, which is precisely the wrong-document failure this
     * subsystem exists to prevent.
     *
     * -- WHY OPTIONAL ------------------------------------------------------
     * A template authored before this key existed makes no claim about which
     * revision it was built for, and guessing one is worse than saying nothing:
     * a guess would drive a banner that tells an inspector their correct report
     * is wrong, or stay silent on one that is. `revisionStatus` is simply not
     * asked where this is absent.
     */
    revision?: string;
}
