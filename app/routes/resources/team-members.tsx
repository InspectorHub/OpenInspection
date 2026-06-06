/**
 * C-12 — BFF resource route for TeamStrip / InviteSeatModal components.
 *
 * loader: GET /api/team/members — returns active members and pending invites
 * action: invite | guest-invite — proxies POST /api/team/invite and /api/team/guests
 */
import type { Route } from "./+types/team-members";
import { getToken, requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";

export async function loader({ request, context }: Route.LoaderArgs) {
    const token = await getToken(context, request);
    if (!token) return { members: [] as unknown[], invites: [] as unknown[] };
    const api = createApi(context, { token });
    try {
        const res = await api.team.members.$get(
            {},
            { headers: { "x-token-relay": "1" } },
        );
        if (!res.ok) return { members: [] as unknown[], invites: [] as unknown[] };
        const json = await res.json() as { data?: { members?: unknown[]; invites?: unknown[] } };
        return {
            members: json?.data?.members ?? [],
            invites: json?.data?.invites ?? [],
        };
    } catch {
        return { members: [] as unknown[], invites: [] as unknown[] };
    }
}

export async function action({ request, context }: Route.ActionArgs) {
    const token = await requireToken(context, request);
    const api = createApi(context, { token });
    const fd = await request.formData();
    const intent = fd.get("intent") as string | null;

    if (intent === "invite") {
        const email = fd.get("email") as string | null;
        const role = (fd.get("role") ?? "inspector") as string;
        const mentorId = (fd.get("mentorId") as string | null) || undefined;
        const sectionIdsRaw = fd.get("assignedSectionIds") as string | null;
        const assignedSectionIds = sectionIdsRaw ? (JSON.parse(sectionIdsRaw) as string[]) : undefined;

        if (!email) return { ok: false, intent, error: "Email is required", url: null };

        try {
            const res = await api.team.invite.$post({
                json: { email, role, mentorId, assignedSectionIds } as Parameters<typeof api.team.invite.$post>[0]["json"],
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({})) as { error?: string };
                return { ok: false, intent, error: body?.error ?? `HTTP ${res.status}`, url: null };
            }
            return { ok: true, intent, error: null, url: null };
        } catch (e) {
            return { ok: false, intent, error: e instanceof Error ? e.message : "Failed", url: null };
        }
    }

    if (intent === "guest-invite") {
        const role = (fd.get("role") ?? "lead") as string;
        const durationSeconds = Number(fd.get("durationSeconds") ?? 86400);

        try {
            const res = await api.team.guests.$post({
                json: { role, durationSeconds } as Parameters<typeof api.team.guests.$post>[0]["json"],
            });
            if (!res.ok) return { ok: false, intent, error: `HTTP ${res.status}`, url: null };
            const body = await res.json() as { data?: { url?: string } };
            return { ok: true, intent, error: null, url: body?.data?.url ?? null };
        } catch (e) {
            return { ok: false, intent, error: e instanceof Error ? e.message : "Failed", url: null };
        }
    }

    return { ok: false, intent, error: "Unknown intent", url: null };
}
