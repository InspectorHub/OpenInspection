/**
 * C-12 — BFF resource route for TeamStrip / InviteSeatDrawer components.
 *
 * loader: GET /api/team/members — returns active members and pending invites
 * action: invite — proxies POST /api/team/invite
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

        if (!email) return { ok: false, intent, error: "Email is required", url: null };

        // Advanced-permissions disclosure ships a JSON map of the capability
        // diffs vs the role template. Absent/empty → pure role template.
        let permissionOverrides: Record<string, boolean> | undefined;
        const rawOverrides = fd.get("permissionOverrides");
        if (typeof rawOverrides === "string" && rawOverrides.trim()) {
            try {
                const parsed = JSON.parse(rawOverrides) as Record<string, boolean>;
                if (parsed && Object.keys(parsed).length > 0) permissionOverrides = parsed;
            } catch {
                // Ignore malformed override payloads — the server re-derives from
                // the role template, so dropping them fails safe.
            }
        }

        try {
            const res = await api.team.invite.$post({
                json: { email, role, permissionOverrides } as Parameters<typeof api.team.invite.$post>[0]["json"],
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

    return { ok: false, intent, error: "Unknown intent", url: null };
}
