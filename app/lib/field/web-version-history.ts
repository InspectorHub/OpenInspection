/**
 * The web host's `resources.versionHistory`: the report content's stored versions over the collab namespace
 * (`/api/inspections/:id/collab/snapshots`, `.../snapshots/:seq`, `.../restore`). That namespace is
 * JWT-cookie authed at the worker entry, so the browser calls it directly with `credentials: "same-origin"`,
 * exactly as the version panel did before it read this resource.
 *
 * Nothing here throws. A read that fails answers `{ ok: false }` (the panel shows its retry); a restore that
 * fails carries the API's own `error` sentence when it sent one, else `HTTP <status>`.
 */
import type { CommandResult } from "@core/field-ui/commands";
import type { FieldResources } from "@core/field-ui/data-source";
import type { VersionSnapshotContent, VersionSnapshotEntry } from "@core/field-ui/data-source-types";
import type { ResultsProjection } from "@core/field-ui/shared/results-doc.types";

type VersionHistory = NonNullable<FieldResources["versionHistory"]>;

export const collabBase = (inspectionId: string) => `/api/inspections/${inspectionId}/collab`;

const NETWORK_ERROR = "Network error";

/** Narrow an `unknown` JSON payload to the snapshot list shape. */
function parseSnapshots(raw: unknown): VersionSnapshotEntry[] {
    if (!Array.isArray(raw)) return [];
    const out: VersionSnapshotEntry[] = [];
    for (const entry of raw) {
        if (typeof entry !== "object" || entry === null) continue;
        const rec = entry as Record<string, unknown>;
        if (typeof rec.seq !== "number" || typeof rec.atMs !== "number") continue;
        const byUserId = typeof rec.byUserId === "string" ? rec.byUserId : null;
        const snap: VersionSnapshotEntry = { seq: rec.seq, atMs: rec.atMs, byUserId };
        if (rec.reason === "periodic" || rec.reason === "manual" || rec.reason === "connect") snap.reason = rec.reason;
        out.push(snap);
    }
    return out;
}

/** The API's own sentence out of a failed answer, else `HTTP <status>`. */
async function failureOf(res: Response): Promise<string> {
    try {
        const err: unknown = await res.json();
        if (typeof err === "object" && err !== null && typeof (err as Record<string, unknown>).error === "string") {
            return (err as Record<string, string>).error;
        }
    } catch {
        // keep the HTTP status message
    }
    return `HTTP ${res.status}`;
}

export function createWebVersionHistory(fetchImpl: typeof fetch = (input, init) => fetch(input, init)): VersionHistory {
    /** The parsed JSON of a GET, or `undefined` when it failed. */
    const read = async (url: string): Promise<{ body: unknown } | undefined> => {
        try {
            const res = await fetchImpl(url, { method: "GET", credentials: "same-origin", headers: { Accept: "application/json" } });
            if (!res.ok) return undefined;
            return { body: (await res.json()) as unknown };
        } catch {
            return undefined;
        }
    };
    return {
        async list(inspectionId): Promise<CommandResult<VersionSnapshotEntry[]>> {
            const got = await read(`${collabBase(inspectionId)}/snapshots`);
            return got === undefined ? { ok: false } : { ok: true, data: parseSnapshots(got.body) };
        },
        async get(inspectionId, seq): Promise<CommandResult<VersionSnapshotContent>> {
            const got = await read(`${collabBase(inspectionId)}/snapshots/${seq}`);
            const raw = got?.body;
            const projection = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>).projection : undefined;
            if (typeof projection !== "object" || projection === null) return { ok: false };
            return { ok: true, data: { projection: projection as ResultsProjection } };
        },
        async restore(inspectionId, seq): Promise<CommandResult> {
            try {
                // busy-controls-allow: the caller (VersionHistoryPanel) holds a same-frame latch on the confirm button; a restore also stores a pre-restore version row
                const res = await fetchImpl(`${collabBase(inspectionId)}/restore`, {
                    method: "POST",
                    credentials: "same-origin",
                    headers: { "Content-Type": "application/json", Accept: "application/json" },
                    body: JSON.stringify({ seq }),
                });
                return res.ok ? { ok: true } : { ok: false, error: await failureOf(res) };
            } catch (err) {
                return { ok: false, error: err instanceof Error && err.message ? err.message : NETWORK_ERROR };
            }
        },
        async capture(inspectionId): Promise<CommandResult> {
            try {
                // busy-controls-allow: the caller (VersionHistoryPanel) holds a same-frame latch on the save button; every capture stores a version row
                const res = await fetchImpl(`${collabBase(inspectionId)}/snapshots`, {
                    method: "POST",
                    credentials: "same-origin",
                    headers: { Accept: "application/json" },
                });
                return res.ok ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
            } catch (err) {
                return { ok: false, error: err instanceof Error && err.message ? err.message : NETWORK_ERROR };
            }
        },
    };
}
