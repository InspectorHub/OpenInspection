/**
 * #275 — the repair-vs-replace action tag on a repair-request line item, and
 * the single predicate that decides who may author one.
 *
 * A LEAF module on purpose. The drizzle column, the request schema, the service
 * and the route all read the same vocabulary from here, so the four cannot
 * disagree; and because this file imports nothing, the UI can read the
 * predicate without dragging `drizzle-orm/d1` into the client bundle — the
 * shape `app/lib/people/agent-repair-access.ts` already establishes for the
 * agent repair policy.
 */

/**
 * The buyer's requested remedy. Four values, because that is what the market
 * offers a buyer: Home Inspector Pro's request form and ISN's agent response
 * are both Repair / Replace / Fund / Other. Two values would leave the most
 * common ask — "just give me the money" — with nowhere to go.
 *
 * ⚠️ Deliberately NOT unified with either neighbouring enum; see the column
 * comment in `db/schema/repair-request.ts` for why each one stays separate.
 */
export const REPAIR_ACTION_TAGS = ['repair', 'replace', 'fund', 'other'] as const;

export type RepairActionTag = (typeof REPAIR_ACTION_TAGS)[number];

/**
 * Who may author the tag: the buyer and their agent, never the inspector.
 *
 * The tag is a statement about what the BUYER is asking for, which is why it
 * mirrors `repair_requests.created_by_kind`. "Replace it" from the inspector
 * would be a professional scope recommendation shipped inside a document the
 * buyer negotiates with — the capability the repair-cost boundary rules out.
 *
 * ⚠️ This refuses the FIELD, never the request. An inspector on owner-preview
 * legitimately creates lists and adds items today (`repair-access.ts` resolves
 * that JWT to `kind: 'inspector'`, `accessLevel: 'readwrite'`), so a tag-less
 * write from an inspector stays legal. Enforced in `repair-gates.ts` and read
 * by the UI, so no page can offer an action the API refuses.
 */
export function mayAuthorRepairActionTag(
    creatorKind: 'client' | 'agent' | 'inspector',
): boolean {
    return creatorKind === 'client' || creatorKind === 'agent';
}

/**
 * Narrow an untrusted string (a form field) to a tag, or to null.
 *
 * Lives beside the vocabulary rather than in the route so the list is read from
 * one place: a route that hard-coded its own copy would keep accepting a value
 * the column had dropped, and the mismatch shows up as a 400 nobody can explain.
 * Unrecognised input becomes null — an untagged item, which is always legal —
 * rather than an error, because the request boundary already rejects a bad
 * explicit value and this parser's input is a form key that may simply be absent.
 */
export function parseRepairActionTag(raw: unknown): RepairActionTag | null {
    return typeof raw === 'string' && (REPAIR_ACTION_TAGS as readonly string[]).includes(raw)
        ? (raw as RepairActionTag)
        : null;
}
