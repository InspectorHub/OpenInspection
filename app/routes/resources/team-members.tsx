/**
 * C-12 — BFF resource route for TeamStrip component.
 *
 * loader: GET /api/team/members — returns active members and pending invites
 */
import type { Route } from "./+types/team-members";
import { getToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";

export async function loader({ request, context }: Route.LoaderArgs) {
    const token = await getToken(context, request);
    if (!token) return { members: [] as unknown[], pendingInvites: [] as unknown[] };
    const api = createApi(context, { token });
    try {
        const res = await api.team.members.$get(
            {},
            { headers: { "x-token-relay": "1" } },
        );
        if (!res.ok) return { members: [] as unknown[], pendingInvites: [] as unknown[] };
        const json = await res.json() as { data?: { members?: unknown[]; pendingInvites?: unknown[] } };
        return {
            members: json?.data?.members ?? [],
            pendingInvites: json?.data?.pendingInvites ?? [],
        };
    } catch {
        return { members: [] as unknown[], pendingInvites: [] as unknown[] };
    }
}
