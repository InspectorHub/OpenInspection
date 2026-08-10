/**
 * The data shapes `RepairRequestService` takes in and hands back.
 *
 * Split out of the service module so it stays under the file-size ceiling
 * without any of it becoming a comment nobody writes. Nothing here is
 * behaviour — a reader chasing what a repair request IS lands on one screen,
 * and a reader chasing what the service DOES is not paying for it.
 */
import type { repairRequests, repairRequestItems } from '../lib/db/schema';
import type { RepairActionTag } from '../lib/repair-action-tag';

/** Who built a list. `ref` is a contact id, an agent id, or a staff user id. */
export type Creator = { kind: 'client' | 'agent' | 'inspector'; ref: string };

/**
 * One repair request with its items attached.
 *
 * ⚠️ STATED, NOT INFERRED, and the reason is load-bearing.
 * `listForInspection` needs an early `return []` for the no-rows case —
 * `inArray` with an empty list renders `in ()`, which SQLite rejects. Left to
 * inference the method's return type becomes `never[] | RepairRequestWithItems[]`,
 * and a caller's `.map(rr => …)` resolves against that union with `rr` as an
 * implicit `any`. Everything under it then stops being type-checked, and what
 * sits under it is the explicit projection that keeps `share_token` out of a
 * staff page. An untyped row would not complain about a spread.
 */
export type RepairRequestWithItems = typeof repairRequests.$inferSelect & {
    items: (typeof repairRequestItems.$inferSelect)[];
};

/** One line a client or their agent adds to a list. */
export type ItemInput = {
    findingKey: string;
    sectionTitle: string;
    itemLabel: string;
    // IA-55 — snapshots captured at add time (stable after report changes).
    defectTitle?: string | null;
    location?: string | null;
    category?: string | null;
    // IA-57 — resolved trade label ("licensed roofer"), snapshotted at add time.
    trade?: string | null;
    commentSnapshot?: string | null;
    requestedCreditCents?: number | null;
    note?: string | null;
    // #275 — what the buyer is asking for on this line. Buyer/agent-authored;
    // the refusal for an inspector-authored tag lives at the route boundary
    // (repair-gates.ts), not here, because an inspector adding an UNTAGGED item
    // is a flow that works today and must keep working.
    repairActionTag?: RepairActionTag | null;
};
