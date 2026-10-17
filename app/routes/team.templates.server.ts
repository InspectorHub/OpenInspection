import type { createApi } from "~/lib/api-client.server";

/**
 * Relays the permission-template writes from the Team page to the API:
 * saving the form as a template, renaming one, archiving one.
 *
 * Posted to `resources/team-members` with an explicit `action`, like the invite
 * and edit drawers, because a fetcher with no `action` posts to its own route.
 * Returns null for any other intent so the caller can carry on.
 *
 * The server's own sentence is relayed on a refusal. "A permission template with
 * this name already exists" and "You hold fewer permissions than this template
 * grants" call for different next steps; "Failed" would throw both away.
 */
type Api = ReturnType<typeof createApi>;
export type TemplateIntentResult = { ok: boolean; intent: string; error: string | null; url: null };

async function failure(intent: string, res: { status: number; json(): Promise<unknown> }): Promise<TemplateIntentResult> {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } | string };
    const message = typeof body?.error === "string" ? body.error : body?.error?.message;
    return { ok: false, intent, error: message ?? `HTTP ${res.status}`, url: null };
}

function parseOverrides(raw: FormDataEntryValue | null): Record<string, boolean> {
    if (typeof raw !== "string" || !raw.trim()) return {};
    try {
        const parsed = JSON.parse(raw) as unknown;
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, boolean>) : {};
    } catch {
        // Unreadable switches are dropped, which saves the role's defaults: fewer powers, never more.
        return {};
    }
}

export async function permissionTemplateIntent(api: Api, intent: string | null, fd: FormData): Promise<TemplateIntentResult | null> {
    if (intent === "create-template") {
        const name = String(fd.get("name") ?? "").trim();
        if (!name) return { ok: false, intent, error: "A template needs a name.", url: null };
        const res = await api.team["permission-templates"].$post({
            json: { name, baseRole: String(fd.get("baseRole") ?? ""), overrides: parseOverrides(fd.get("overrides")) } as Parameters<Api["team"]["permission-templates"]["$post"]>[0]["json"],
        });
        return res.ok ? { ok: true, intent, error: null, url: null } : failure(intent, res);
    }
    if (intent === "rename-template") {
        const id = String(fd.get("id") ?? "");
        const name = String(fd.get("name") ?? "").trim();
        if (!id || !name) return { ok: false, intent, error: "A template needs a name.", url: null };
        // The API replaces the whole template, so the role and switches travel with the new name.
        const res = await api.team["permission-templates"][":id"].$put({
            param: { id },
            json: { name, baseRole: String(fd.get("baseRole") ?? ""), overrides: parseOverrides(fd.get("overrides")) } as Parameters<Api["team"]["permission-templates"][":id"]["$put"]>[0]["json"],
        });
        return res.ok ? { ok: true, intent, error: null, url: null } : failure(intent, res);
    }
    if (intent === "archive-template") {
        const id = String(fd.get("id") ?? "");
        if (!id) return { ok: false, intent, error: "Template id is required", url: null };
        const res = await api.team["permission-templates"][":id"].$delete({ param: { id } });
        return res.ok ? { ok: true, intent, error: null, url: null } : failure(intent, res);
    }
    return null;
}
