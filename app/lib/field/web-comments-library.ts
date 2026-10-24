/**
 * The web host's `resources.commentsLibrary`: the tenant's canned-comment library over the BFF
 * resource route `/resources/comments-library` (loader = GET the matching rows, action = POST an
 * `intent` of `touch`, `save` or `edit`).
 *
 * It never throws. A failed, unauthenticated or malformed read answers `[]`; a write answers
 * `{ ok: false, error }` unless the route answered `{ ok: true }`. The requests are the ones
 * `useCannedComments` used to build itself: the same URL, the same query names in the order the
 * caller set them, and multipart form fields named as the route reads them.
 */
import type { CommandResult } from "@core/field-ui/commands";
import type { FieldResources } from "@core/field-ui/data-source";
import type { CommentsLibraryEntry, CommentsLibraryQuery, CommentsLibraryRow } from "@core/field-ui/data-source-types";

export const COMMENTS_LIBRARY_ROUTE = "/resources/comments-library";

type CommentsLibrary = NonNullable<FieldResources["commentsLibrary"]>;

async function post(fetchImpl: typeof fetch, form: FormData): Promise<CommandResult> {
    try {
        // busy-controls-allow: the caller (useCannedComments) holds the same-frame guard for save and touch; the library page posts through its own fetcher. An edit replaces one row by id, so a repeat writes the same values
        const res = await fetchImpl(COMMENTS_LIBRARY_ROUTE, { method: "POST", credentials: "include", body: form });
        if (!res.ok) return { ok: false, error: `The comment library answered ${res.status}.` };
        const body = (await res.json().catch(() => null)) as { ok?: unknown } | null;
        return body !== null && typeof body === "object" && body.ok === true
            ? { ok: true }
            : { ok: false, error: "The comment was not saved." };
    } catch (err) {
        return { ok: false, error: err instanceof Error && err.message ? err.message : "Network error" };
    }
}

function entryForm(intent: "save" | "edit", entry: CommentsLibraryEntry, id?: string): FormData {
    const form = new FormData();
    form.set("intent", intent);
    if (id !== undefined) form.set("id", id);
    form.set("text", entry.text);
    form.set("severity", entry.severity);
    form.set("section", entry.section);
    form.set("category", entry.category);
    form.set("itemLabel", entry.itemLabel);
    if (entry.repairSummary !== undefined) form.set("repairSummary", entry.repairSummary);
    if (entry.recommendedContractorTypeId !== undefined) {
        form.set("recommendedContractorTypeId", entry.recommendedContractorTypeId);
    }
    return form;
}

export function createWebCommentsLibrary(fetchImpl: typeof fetch = (input, init) => fetch(input, init)): CommentsLibrary {
    return {
        async list(query?: CommentsLibraryQuery): Promise<CommentsLibraryRow[]> {
            try {
                const params = new URLSearchParams();
                for (const [name, value] of Object.entries(query ?? {})) {
                    if (typeof value === "string" && value !== "") params.set(name, value);
                }
                const qs = params.size > 0 ? `?${params}` : "";
                const res = await fetchImpl(`${COMMENTS_LIBRARY_ROUTE}${qs}`, { credentials: "include" });
                if (!res.ok) return [];
                const body = (await res.json()) as { comments?: CommentsLibraryRow[] };
                return body.comments ?? [];
            } catch {
                return [];
            }
        },
        touch(id: string): Promise<CommandResult> {
            const form = new FormData();
            form.set("intent", "touch");
            form.set("id", id);
            return post(fetchImpl, form);
        },
        save(entry: CommentsLibraryEntry): Promise<CommandResult> {
            return post(fetchImpl, entryForm("save", entry));
        },
        edit(id: string, entry: CommentsLibraryEntry): Promise<CommandResult> {
            return post(fetchImpl, entryForm("edit", entry, id));
        },
    };
}
