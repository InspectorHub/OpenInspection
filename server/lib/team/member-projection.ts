/**
 * What `GET /api/team/members` shows each tier.
 *
 * The roster used to go out whole to every signed-in staff role: each colleague's email, which
 * switches they hold, whether they have a second factor, and when they were last active. The
 * administrator tier needs all of it. Everyone else needs enough to name a colleague in a picker:
 * an id, a display name and a role. Someone allowed to schedule for others also needs to tell two
 * colleagues apart by address, so they get the email as well.
 *
 * The reduced shape is built by naming what to keep, never by deleting what to hide, so a column
 * added to the roster later stays out of the reduced view until someone decides it belongs there.
 */
export interface FullMember {
    id: string;
    name: string | null;
    email: string;
    role: string;
}

export interface ReducedMember {
    id: string;
    name: string | null;
    role: string;
    email?: string;
}

export function projectMembers<T extends FullMember>(
    members: readonly T[],
    viewer: { administrator: boolean; schedulesOthers: boolean },
): Array<T | ReducedMember> {
    if (viewer.administrator) return [...members];
    return members.map((m): ReducedMember => ({
        id: m.id,
        name: m.name,
        role: m.role,
        ...(viewer.schedulesOthers ? { email: m.email } : {}),
    }));
}
