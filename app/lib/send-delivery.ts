import type { PersonRow } from "~/components/inspection/PeopleEditor";
import type { DeliveryOutcome } from "~/lib/inspector-portal-actions";

/**
 * Who is still ticked when a person goes Back from a partial send: only those the send did NOT reach.
 *
 * A send that reached some people and skipped others leaves the form with its old selection, and a second Send
 * from it would repeat the message to the people already reached. The route echoes back the contact id (or the
 * address) of every recipient it skipped or failed, so a ticked person who is not among them was reached and
 * is dropped. With no outcome to read, the selection is left exactly as it was.
 */
export function keepNotReached(
    selected: ReadonlySet<string>,
    delivery: DeliveryOutcome | null,
    people: readonly PersonRow[],
): Set<string> {
    if (!delivery || delivery.skipped.length === 0) return new Set(selected);
    const notReached = new Set(
        people
            .filter((p) => delivery.skipped.some((s) => s.recipient === p.contactId || s.recipient === p.email || s.recipient === p.phone))
            .map((p) => p.id),
    );
    return new Set([...selected].filter((id) => notReached.has(id)));
}
