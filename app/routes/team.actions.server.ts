import type { createApi } from "~/lib/api-client.server";
import { resetMemberTwoFactor } from "./team.reset-two-factor.server";

/**
 * Relay one member removal to the API.
 *
 * The API refuses some removals with a sentence worth reading ("Cannot remove
 * the last owner", "Cannot remove yourself"). It is relayed so the dialog can
 * show it; collapsing every refusal into a bare failure would leave the owner
 * pressing a button that appears to do nothing.
 */
async function removeTeamMember(api: ReturnType<typeof createApi>, id: string) {
    const res = await api.team.members[":id"].$delete({ param: { id } });
    if (res.ok) return { ok: true };

    const body = await res.json().catch(() => ({})) as { error?: { message?: string } | string };
    const message = typeof body?.error === "string" ? body.error : body?.error?.message;
    return { ok: false, error: message ?? `HTTP ${res.status}` };
}

/**
 * The `/team` page's action, dispatched on the form's `intent`. It lives here
 * rather than in the route module because that file is size-capped and every
 * new row action would otherwise have to fit inside it.
 */
export async function handleTeamAction(
    api: ReturnType<typeof createApi>,
    form: FormData,
): Promise<{ ok: boolean; resent?: boolean; error?: string }> {
    const intent = form.get("intent") as string;

    if (intent === "cancel-invite") {
        const inviteToken = form.get("token") as string;
        const res = await api.team.invites[":token"].$delete({ param: { token: inviteToken } });
        return { ok: res.ok };
    }
    if (intent === "reset-two-factor") {
        return resetMemberTwoFactor(api, form.get("id") as string);
    }
    if (intent === "remove-member") {
        return removeTeamMember(api, form.get("id") as string);
    }
    if (intent === "resend-invite") {
        const inviteToken = form.get("token") as string;
        const res = await api.team.invites[":token"].resend.$post({ param: { token: inviteToken } });
        return { ok: res.ok, resent: res.ok };
    }
    return { ok: false };
}
