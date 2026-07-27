/**
 * The one rule about who may leave an inspection (IA-36 ⑫⑬).
 *
 * "Primary client" is expressed by the role KEY (`client`), not a boolean
 * column, so there is exactly one source of truth and nothing to keep in sync.
 * The seat MOVES (PeopleService.makePrimary) rather than being defended by
 * refusing to add a second one.
 *
 * The one thing that genuinely cannot happen is an inspection with nobody on
 * the client side — a report with no recipient. That is a rule, so it is stated
 * here once and read by both the API that enforces it and the card that
 * explains it. Hiding the button instead would leave the operator guessing,
 * which is the pattern this audit item exists to remove.
 */
export interface PersonKindLike {
    id: string;
    kind: 'client' | 'agent' | 'other';
}

/**
 * True when removing `personId` would leave the inspection with no client-side
 * person at all. The caller turns that into a disabled control with a reason
 * ("Add another client or make someone else primary first"), never a 500.
 */
export function isSoleClient(people: PersonKindLike[], personId: string): boolean {
    const target = people.find((p) => p.id === personId);
    if (!target || target.kind !== 'client') return false;
    return people.filter((p) => p.kind === 'client').length === 1;
}
