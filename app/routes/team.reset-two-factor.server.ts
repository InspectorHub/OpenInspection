import type { createApi } from "~/lib/api-client.server";

/**
 * Relay one owner-initiated two-factor reset to the API.
 *
 * ── WHY IT IS ON THE PAGE'S OWN ACTION, NOT A RESOURCE ROUTE ────────────────
 * The dialog that submits it lives on `/team`, and a fetcher with no `action`
 * posts to its own route. The first version of this put the handler on
 * `resources/team-members`, where the submission never arrived: the page's
 * action fell through to `{ ok: false }`, the dialog closed, and the row still
 * offered the reset. Every unit test passed — the defect was in which module
 * received the POST, which nothing asserted. It was found by pressing the
 * button and reading the database.
 *
 * ── WHY THE SERVER'S SENTENCE IS RELAYED ────────────────────────────────────
 * The API distinguishes "this member does not have two-factor authentication
 * enabled" from "member not found", and an owner acts differently on each: the
 * first means the lockout has another cause and they should stop looking here.
 * Collapsing both into "Failed" throws away the only part that helps.
 */
export async function resetMemberTwoFactor(
    api: ReturnType<typeof createApi>,
    id: string,
): Promise<{ ok: boolean; error?: string }> {
    const res = await api.team.members[":id"]["two-factor"].reset.$post({ param: { id } });
    if (res.ok) return { ok: true };

    const body = await res.json().catch(() => ({})) as { error?: { message?: string } | string };
    const message = typeof body?.error === "string" ? body.error : body?.error?.message;
    return { ok: false, error: message ?? `HTTP ${res.status}` };
}
