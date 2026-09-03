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

        // Absent means TRUE. The checkbox that produces this defaulted to on
        // for its whole life while sending nothing, so "the field is missing"
        // has to keep meaning what the drawer looked like it meant.
        const notify = fd.get("notify") !== "false";

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
                json: { email, role, permissionOverrides, notify } as Parameters<typeof api.team.invite.$post>[0]["json"],
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({})) as { error?: string };
                return { ok: false, intent, error: body?.error ?? `HTTP ${res.status}`, url: null };
            }
            // The invite link, which the server has always returned and nothing
            // has ever shown. It matters most when notify is false: that is the
            // case where this link is the ONLY way the invitee ever hears about
            // the invitation.
            const created = await res.json().catch(() => ({})) as { data?: { inviteLink?: string } };
            return { ok: true, intent, error: null, url: created?.data?.inviteLink ?? null };
        } catch (e) {
            return { ok: false, intent, error: e instanceof Error ? e.message : "Failed", url: null };
        }
    }

    // IA-101 — editing an existing member. Deliberately a sibling of "invite"
    // on this same resource route: both write the same two fields (role,
    // capability overrides) and the drawer that submits them is nearly the
    // same form, so splitting them across routes would guarantee they drift.
    if (intent === "update") {
        const id = fd.get("id") as string | null;
        const role = fd.get("role") as string | null;
        if (!id) return { ok: false, intent, error: "Member id is required", url: null };

        // Unlike invite, an ABSENT override payload here means "clear all
        // overrides", not "use the template" — the edit drawer always submits
        // the full capability set, so anything missing was deliberately
        // un-ticked. `null` says that explicitly rather than leaving the old
        // values in place.
        let permissionOverrides: Record<string, boolean> | null = null;
        const rawOverrides = fd.get("permissionOverrides");
        if (typeof rawOverrides === "string" && rawOverrides.trim()) {
            try {
                const parsed = JSON.parse(rawOverrides) as Record<string, boolean>;
                if (parsed && Object.keys(parsed).length > 0) permissionOverrides = parsed;
            } catch {
                // Malformed payload → clear, which falls back to the role
                // template. Failing safe means fewer powers, never more.
            }
        }

        try {
            const res = await api.team.members[":id"].$patch({
                param: { id },
                json: { ...(role ? { role } : {}), permissionOverrides } as Parameters<typeof api.team.members[":id"]["$patch"]>[0]["json"],
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({})) as { error?: { message?: string } | string };
                const message = typeof body?.error === "string" ? body.error : body?.error?.message;
                return { ok: false, intent, error: message ?? `HTTP ${res.status}`, url: null };
            }
            return { ok: true, intent, error: null, url: null };
        } catch (e) {
            return { ok: false, intent, error: e instanceof Error ? e.message : "Failed", url: null };
        }
    }

    return { ok: false, intent, error: "Unknown intent", url: null };
}
