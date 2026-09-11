/**
 * Which template the New Inspection picker offers FIRST.
 *
 * ── What used to decide it ──────────────────────────────────────────────────
 * Nothing anybody chose. `TemplateService.listTemplates` orders by
 * `created_at DESC`, the picker highlights row 0, and Enter takes the
 * highlighted row — so the first template offered was simply the one installed
 * most recently. A workspace that had installed a state's statutory form
 * (Texas TREC REI 7-6, a Florida form) therefore led with that form, and its
 * general-purpose template sat sixth. An inspector who does not practise in
 * that state was recommended an official document belonging to a jurisdiction
 * they do not work in, and one keystroke bound their inspection to it.
 *
 * ── What decides it here ────────────────────────────────────────────────────
 * A general-purpose template leads, UNLESS the workspace has said which state
 * it works in and a template is written to that state — then that one leads,
 * because for that workspace it is the right answer rather than a surprise.
 *
 * Four groups, in this order:
 *
 *   0. written to the workspace's own state
 *   1. written to no jurisdiction at all — general purpose
 *   2. written to some other jurisdiction
 *   3. retired, whatever else is true of it (the picker lists retired
 *      templates, disabled, so that one vanishing does not read as a lost
 *      permission — but a row nobody may select must never be the row Enter
 *      takes)
 *
 * Inside a group the order the API gave is kept. This is a RE-BUCKETING, not a
 * re-sort: alphabetising or recency-sorting within a group would be a second
 * opinion nobody asked for, and the API's order is at least consistent.
 *
 * ── Where "the workspace's own state" comes from ────────────────────────────
 * `tenant_configs.holiday_region`, surfaced as `branding.holidayRegion` on the
 * session context. It is the ONLY structured statement a workspace makes about
 * where it works: it was added for the company holiday catalogue, and it is
 * written `US` (country only) or `US-TX`. A workspace that never set it has not
 * told us a state, and then the general template leads — which is the safe
 * answer, because being offered a general template in Texas costs a scroll
 * while being offered the Texas form in Ohio costs a wrong report.
 */

export interface OrderableTemplate {
    id: string;
    name: string;
    /**
     * The state or country whose rules this template is written to, or null
     * when it is written to none. Comes from the catalogue entry the template
     * was imported from (`marketplace_libraries.jurisdiction`) — the one column
     * whose job is to say that a pack is not for everybody. Absent on a
     * template a workspace authored itself, which is general by definition.
     */
    jurisdiction?: string | null;
    /** Epoch ms, when this template stopped being offered for new inspections. */
    retiredAt?: number | null;
}

/**
 * The STATE a workspace region names, or null.
 *
 * `US-TX` → `TX`. `US` → null, because a country is not a state and treating it
 * as one would promote every US form to the top of every US workspace's list,
 * which is the defect this module exists to remove.
 */
export function operatorStateFromRegion(region: string | null | undefined): string | null {
    const trimmed = (region ?? "").trim().toUpperCase();
    const parts = trimmed.split("-");
    if (parts.length !== 2) return null;
    const [country, state] = parts;
    if (!country || !state) return null;
    return state;
}

/**
 * A jurisdiction label reduced to the part that identifies the place.
 *
 * The catalogue writes bare state codes (`TX`, `FL`); a pack could equally be
 * published as `US-TX`. Both name Texas, and a comparison that only understood
 * one of the two spellings would silently stop promoting the right form the day
 * the other spelling shipped.
 */
function placeOf(jurisdiction: string | null | undefined): string | null {
    const trimmed = (jurisdiction ?? "").trim().toUpperCase();
    if (trimmed.length === 0) return null;
    const parts = trimmed.split("-");
    return parts[parts.length - 1] ?? null;
}

function groupOf(template: OrderableTemplate, operatorState: string | null): 0 | 1 | 2 | 3 {
    if (template.retiredAt) return 3;
    const place = placeOf(template.jurisdiction);
    if (place === null) return 1;
    if (operatorState !== null && place === operatorState) return 0;
    return 2;
}

/**
 * Re-bucket the picker's templates. Returns a new array; the input is untouched.
 *
 * The index tiebreak is explicit rather than leaning on `Array.prototype.sort`
 * being stable: the guarantee is real, and a reader checking that groups keep
 * the API's order should not have to go and look it up.
 */
export function orderTemplatesForPicker<T extends OrderableTemplate>(
    templates: readonly T[],
    region: string | null | undefined,
): T[] {
    const operatorState = operatorStateFromRegion(region);
    return templates
        .map((template, index) => ({ template, index, group: groupOf(template, operatorState) }))
        .sort((a, b) => (a.group - b.group) || (a.index - b.index))
        .map((row) => row.template);
}
