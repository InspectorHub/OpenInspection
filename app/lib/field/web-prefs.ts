/**
 * The web host's `resources.prefs`: the tenant's editor preferences over the BFF resource route
 * `/resources/inspection-prefs` (loader = GET the merged prefs, action = PATCH a delta).
 *
 * It never throws. A failed or unauthenticated read answers the built-in defaults (what the editor
 * showed when the route answered no prefs); a failed write answers `{ ok: false, error }`.
 * The write is the same form the old fetcher submitted: urlencoded, one field `patch` holding the
 * JSON delta.
 */
import type { CommandResult } from "@core/field-ui/commands";
import type { FieldResources } from "@core/field-ui/data-source";
import type { InspectionPrefs } from "@core/field-ui/data-source-types";
import { DEFAULT_INSPECTION_PREFS } from "@core/field-ui/hooks/useInspectionPrefs";

export const PREFS_ROUTE = "/resources/inspection-prefs";

type PrefsStore = NonNullable<FieldResources["prefs"]>;

async function readJson(res: Response): Promise<unknown> {
    const contentType = res.headers.get("content-type");
    if (!contentType?.toLowerCase().includes("json")) return null;
    return res.json().catch(() => null);
}

function prefsOf(body: unknown): InspectionPrefs | null {
    if (typeof body !== "object" || body === null) return null;
    const prefs = (body as { prefs?: unknown }).prefs;
    return typeof prefs === "object" && prefs !== null ? (prefs as InspectionPrefs) : null;
}

export function createWebPrefs(fetchImpl: typeof fetch = (input, init) => fetch(input, init)): PrefsStore {
    return {
        async load(): Promise<InspectionPrefs> {
            try {
                const res = await fetchImpl(PREFS_ROUTE, { credentials: "include", headers: { accept: "application/json" } });
                if (!res.ok || res.redirected) return DEFAULT_INSPECTION_PREFS;
                return prefsOf(await readJson(res)) ?? DEFAULT_INSPECTION_PREFS;
            } catch {
                return DEFAULT_INSPECTION_PREFS;
            }
        },
        async patch(delta: Partial<InspectionPrefs>): Promise<CommandResult<InspectionPrefs>> {
            try {
                // busy-controls-allow: the caller (useInspectionPrefs) accumulates deltas and ignores every answer but the latest request's; the PATCH merges into one row, so a repeat is harmless
                const res = await fetchImpl(PREFS_ROUTE, {
                    method: "POST",
                    credentials: "include",
                    headers: { accept: "application/json" },
                    body: new URLSearchParams({ patch: JSON.stringify(delta) }),
                });
                if (res.redirected) return { ok: false, error: "Session expired" };
                const body = await readJson(res);
                const ok = typeof body === "object" && body !== null && (body as { ok?: unknown }).ok === true;
                if (!res.ok || !ok) return { ok: false, error: "The preferences were not saved." };
                const prefs = prefsOf(body);
                return prefs ? { ok: true, data: prefs } : { ok: true };
            } catch (err) {
                return { ok: false, error: err instanceof Error && err.message ? err.message : "Network error" };
            }
        },
    };
}
