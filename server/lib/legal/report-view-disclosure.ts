/**
 * The Art. 13 notice that makes the report-view counter lawful — OI #271.
 *
 * `docs/compliance/report-view-lia.md` §3.2 does not treat transparency as
 * something that runs alongside the balancing test: *"Remove the disclosure and
 * this assessment fails."* The recipient's expectation is what the balance
 * turns on, and an expectation only exists if they were told. So this copy is
 * not UI polish that can be trimmed in a redesign — it is a load-bearing part
 * of the lawful basis, and the two conditions it satisfies (4 and 5) are why
 * the counter's kill switch could be deleted.
 *
 * ## The three sentences, and why the order is fixed
 *
 * **Fact → limit → exit.** Each one does a job the others cannot:
 *
 *  1. **The fact.** Condition 4: the recipient learns the record exists, and
 *     learns it in the message carrying the link, because the first render is
 *     the one that creates the record. A page-only notice arrives after the
 *     fact.
 *  2. **The limit.** ⚠️ Load-bearing, not decoration. The LIA's necessity test
 *     (§2) and its impact analysis (§3.3) pass *because* the IP address, the
 *     device information and the per-finding trail are absent. A disclosure
 *     that states only the fact UNDERSTATES the design: it invites the reader
 *     to assume the ordinary shape of web tracking, which is the thing this
 *     feature deliberately is not.
 *  3. **The exit.** Art. 21(4) requires the right to object be presented
 *     "clearly and separately". ⚠️ And it must say *"and keep your report"*:
 *     answering an objection about MEASUREMENT by revoking ACCESS is the remedy
 *     external review rejected (see the amendment history in LIA §4). The code
 *     avoids it — `writeViewTrackingObjection` touches neither `revokedAt` nor
 *     `expiresAt` — and copy that hinted otherwise would put it back at the
 *     wording layer after the implementation had already refused it.
 *
 * ## Why a versioned platform constant and not template copy
 *
 * The delivery emails are TENANT-EDITABLE. An `editable: true` descriptor's
 * `default` only seeds a per-tenant row, so it cannot carry a guarantee — a
 * tenant may delete it, and a disclosure a tenant can remove is one the
 * assessment cannot rely on (condition 5). This copy therefore reaches the
 * recipient as a `SystemBlockKind` (`'viewDisclosure'`), rendered by the
 * platform from the strings below and unreachable from the template editor.
 *
 * The `version` exists for the same reason
 * `legal/agreement-language-disclosure.ts` carries one: rewording this in a
 * later release must not retroactively re-caption documents already delivered
 * under the old words. Every rendered instance stamps
 * `data-disclosure-version`, so the artifact that actually reached a recipient
 * records which wording they saw, rather than the current file being read back
 * as though it had always said this. **Bump on ANY wording change**, `heading`
 * included, and bump the translated page copy in the same commit.
 *
 * ## Read before extending this
 *
 * This block states facts about what is and is not recorded, and offers one
 * control. It makes no promise about retention, no claim about accuracy, and
 * asks for no consent — consent is what would be required if the design ever
 * touched the recipient's device, and a copy layer must never be where that
 * distinction gets blurred. If a change to the feature makes any sentence below
 * untrue, the fix is the feature, not the sentence.
 */

/** Bump on ANY wording change below, `heading` included. */
const REPORT_VIEW_DISCLOSURE_VERSION = 1;

export const REPORT_VIEW_DISCLOSURE = Object.freeze({
    version: REPORT_VIEW_DISCLOSURE_VERSION,
    heading: 'How your inspector knows this reached you',
    /** 1 — the fact. */
    fact: 'When you open this report we record that it was opened, when, and how many times, so your inspector knows it reached you.',
    /** 2 — the limit. Removing this understates the design; see the header. */
    limit: 'Nothing else is recorded — no IP address, no device information, and no record of which findings you read.',
    /** 3 — the exit. "and keep your report" is the half that must survive review. */
    exit: 'You can turn this off and keep your report:',
    /** The link text for the exit. Also the control's label on the report page. */
    exitLabel: 'turn off open tracking',
    /**
     * Fragment identifier of the control on the report page.
     *
     * The emailed exit link is the report link plus this fragment, because the
     * control has to live where the recipient can reach it over EITHER portal
     * entry path — the `?token=` link they were emailed, and the
     * `__Host-portal_session` cookie of someone signed into the hub. That is
     * the same pair `resolvePortalRecipient` accepts, so the link points at a
     * right that is actually reachable rather than describing one.
     */
    anchor: 'view-tracking',
});

/**
 * Build the exit link for a message that carries a report link.
 *
 * Returns null when the message has no report URL to hang it on, and the caller
 * must then render the exit as plain words naming the control instead of
 * dropping it — the exit sentence is a condition, not an enhancement, and a
 * disclosure that silently loses it is one the assessment does not cover.
 */
export function reportViewObjectionUrl(reportUrl: unknown): string | null {
    const url = typeof reportUrl === 'string' ? reportUrl.trim() : '';
    if (!url) return null;
    // The report link already carries the recipient's own `?token=`, which is
    // what the objection route authenticates against. Appending only a fragment
    // keeps that true without this module knowing anything about the query.
    return `${url}#${REPORT_VIEW_DISCLOSURE.anchor}`;
}
