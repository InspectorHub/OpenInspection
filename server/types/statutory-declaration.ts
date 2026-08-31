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
 * One box the Florida four-point form prints is deliberately NOT here, and that
 * absence was decided rather than overlooked: `Title` has no source anywhere in
 * this repository. Do NOT add it as a field hardwired to `null`: a member that
 * can never resolve is a blank box on an authority's form, which reads as an
 * inspector who did not answer.
 *
 * -- THE TEN MEMBERS BELOW `company_phone` GOT THEIR SOURCES BUILT -----------
 * `License Type` used to sit beside `Title` in that paragraph, on the reasoning
 * that the nearest column is an inspector credential's label — an ASSOCIATION
 * certification ("InterNACHI CPI") rather than the state licence class the box
 * asks for. That reasoning stands and the conclusion changed: rather than read
 * the wrong column, the right one was added. `users.statutory_license_type` is
 * that column, and the credential label is still not it.
 *
 * The other nine are the same story. The owner block and the second signer FL
 * OIR-B1-1802 prints are answered from `statutory_inspection_details`, one row
 * per inspection; the signing date is on the same row, and is NOT
 * `inspection_date` — signing commonly happens days after the fieldwork and
 * several of these forms print both.
 *
 * ⚠️ `owner_*` IS NOT `client_*`. A buyer commissions the inspection and the
 * seller owns the house. Aliasing one onto the other prints the wrong person's
 * name on a state form, and `binding-policy.ts` judges the ROUTE rather than
 * the meaning, so every gate stays green while it happens.
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
    | 'company_phone'
    | 'inspector_license_type'
    | 'inspector_qualification'
    | 'inspector_signature_date'
    | 'owner_name'
    | 'owner_email'
    | 'owner_mailing_address'
    | 'owner_home_phone'
    | 'owner_work_phone'
    | 'owner_cell_phone'
    | 'employee_printed_name';

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

/**
 * When one question on the form exists at all, expressed against another
 * question's answer.
 *
 * -- NOT APPLICABLE IS NOT EMPTY, AND THAT IS THE WHOLE REASON THIS EXISTS ----
 * `values.ts` opens on the distinction and it is the one this type serves.
 * EMPTY means the inspector answered nothing — the question was asked and the
 * box is blank. NOT APPLICABLE means the question was never asked, because the
 * form's own text makes it conditional on an earlier answer. The two look
 * identical on a printed page and are different facts about the inspection, so
 * only the side holding the answers can tell them apart, and it has to.
 *
 * Measured on FL OIR-B1-1802 Rev. 04/26, three questions are conditional and
 * the form says so in its own words:
 *
 *   - "Minimal conditions to qualify for categories B, C, or D." — the three
 *     minimal-condition boxes exist for those three answers to question 6 and
 *     for no other. Toenails (A) and E through I do not have them.
 *   - "check here if entire roof deck underside covered" is printed one indent
 *     level under "Spray foam products", and the other three sealing methods
 *     are laid ON TOP of the deck. The question cannot be asked of them.
 *   - The twelve non-glazed sub-levels run A.1 to N.3. Answers X and Z to
 *     question 9 have no sub-level printed under them at all.
 *
 * -- WHY THIS IS A SIBLING MAP AND NOT A FIELD ON THE BINDING ----------------
 * A rule that lived on the binding could only ever describe a field that IS
 * bound, and the case that matters most is the other one: the question exists
 * for this answer set and the template binds NOTHING to it. That is a template
 * which will print an authority's form with a question the form asked and
 * nobody answered, and it is refused in `applicability.ts` — which is only
 * possible because a rule can outlive the absence of its binding.
 *
 * It also turns the commonest typo loud instead of silent. A key here naming a
 * field that does not exist is not ignored; where the rule applies it refuses by
 * name, because "applicable and unbound" is exactly what a misspelling looks
 * like.
 *
 * ⚠️ WHAT NOTHING HERE CAN CHECK. `answerIsOneOf` holds answers to ANOTHER
 * question, and whether those are answers that question actually has is decided
 * by the field map — which this side never sees, because a declaration and a map
 * meet only at render time and against different revisions. A misspelling there
 * makes the question silently never apply, and the entire observable output is
 * one unticked box. It is checked where the map lives instead, against the
 * candidate's own `whenValue`s, and that check is a person's to run.
 */
export interface StatutoryFieldDependency {
    /**
     * The other field on THIS form whose answer decides. Named as one of
     * `bindings`' own keys.
     *
     * It must be bound: a controlling field nothing can answer leaves the
     * dependent question permanently not-applicable, which is a blank box that
     * no gate reads as one.
     */
    field: string;
    /**
     * The answers to `field` for which this question EXISTS. Any other answer,
     * including no answer at all, means the question was never asked.
     *
     * Never empty. A question that can never exist is a box that can never be
     * ticked, and declaring one is indistinguishable from forgetting to.
     */
    answerIsOneOf: readonly string[];
    /**
     * Present when this question's own answers are LABELLED by the controlling
     * answer, and the label has to agree: the separator between the two.
     *
     * Measured on FL OIR-B1-1802 question 9, whose twelve non-glazed sub-levels
     * are printed `A.1`…`N.3` under the six letters of the question above them.
     * The letter in the sub-level is not decoration — `A.2` is a line printed
     * under A, and choosing it while answering C to the question above ticks two
     * boxes on the page that contradict each other. With this set to `.`, the
     * answer `C.2` under an `A` is refused by name rather than printed.
     *
     * Absent means the two answers share no vocabulary, which is the ordinary
     * case. A separator that is not the one the form prints refuses every answer
     * rather than passing quietly — the failure is loud in the direction that
     * costs nothing.
     */
    labelSeparator?: string;
}

/**
 * Every conditional question on one form, keyed exactly as `bindings` is.
 *
 * A field absent from here is unconditional: it is asked of every inspection,
 * which is what every declaration written before this existed says.
 */
export type StatutoryFieldDependencies = Readonly<Record<string, StatutoryFieldDependency>>;

/** One template's statutory-form declaration. */
export interface StatutoryFormDeclaration {
    /** The form, not the revision (see above) — e.g. `tx_trec_rei`. */
    formId: string;
    /** Form field name -> where its value comes from. A field the authority's
     *  form requires and this map omits is a gap the fidelity gate reports; it
     *  is never silently rendered blank. */
    bindings: Record<string, StatutoryValueSource>;
    /**
     * The questions this form only asks for some answers. Absent means none,
     * which is what every declaration authored before this key existed says.
     *
     * ⚠️ A field named here must NOT also sit in the field map's
     * `requiredFields`. That list means "required of every inspection", and a
     * conditional question is not: the render would refuse a form whose missing
     * key is the correct output for the answers given. The requirement is not
     * lost, it is stated once and in the sharper place — where the rule applies
     * and nothing is bound, `applicability.ts` refuses and names the answer that
     * asked the question.
     */
    dependsOn?: StatutoryFieldDependencies;
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
