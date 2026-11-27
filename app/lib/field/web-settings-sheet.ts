/**
 * What the hub's Settings card reads when it opens (#529 — the editor's settings sheet is gone, and the card
 * on `/inspections/:id` is the only reader now), over the BFF resource route `/resources/inspection-settings-sheet`
 * (one call that bundles the inspection row, the template list and the cover-picker photos). The appearance
 * profiles are the host's own list, added here.
 *
 * Never throws. `null` means the host could not read it (a failed request, a session-expiry redirect, a
 * non-JSON answer); an answered-but-empty sheet (no token) is what the route itself answers and is passed on.
 */
import type { SettingsSheetData } from "@core/field-ui/data-source-types";
import { CLIENT_PROFILE_LIST } from "~/lib/report-style/profiles-client";

const SETTINGS_SHEET_ROUTE = "/resources/inspection-settings-sheet";

/** What the settings loader answers: the same shape the removed sheet read. */
export interface SettingsSheet {
    load(inspectionId: string): Promise<SettingsSheetData | null>;
}

export function createWebSettingsSheet(fetchImpl: typeof fetch = (input, init) => fetch(input, init)): SettingsSheet {
    return {
        async load(inspectionId: string): Promise<SettingsSheetData | null> {
            try {
                const res = await fetchImpl(`${SETTINGS_SHEET_ROUTE}?inspectionId=${encodeURIComponent(inspectionId)}`, {
                    credentials: "include",
                    headers: { accept: "application/json" },
                });
                if (!res.ok || res.redirected) return null;
                if (!res.headers.get("content-type")?.toLowerCase().includes("json")) return null;
                const body = (await res.json().catch(() => null)) as Partial<SettingsSheetData> | null;
                if (body === null || typeof body !== "object") return null;
                return {
                    inspection: body.inspection && typeof body.inspection === "object" ? body.inspection : null,
                    templates: Array.isArray(body.templates) ? body.templates : [],
                    photos: Array.isArray(body.photos) ? body.photos : [],
                    profiles: CLIENT_PROFILE_LIST.map((p) => ({ id: p.id, name: p.name })),
                };
            } catch {
                return null;
            }
        },
    };
}
