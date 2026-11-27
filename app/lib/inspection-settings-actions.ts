/* ------------------------------------------------------------------ */
/*  Inspection-hub SETTINGS action helpers (pure — no React)           */
/* ------------------------------------------------------------------ */

/**
 * #529 — the hub's write face for the per-inspection report settings that
 * used to live in the report editor's settings sheet: which template governs
 * the inspection, the required-defect-fields override, the appearance profile,
 * and the report cover photo (pick, upload, crop).
 *
 * They live in their own module beside the order handlers for the same reason
 * those split out of `inspector-portal-actions.ts`: the route file is at its
 * size ceiling, and these four intents share one allow-list and one set of API
 * calls. The editor's `save-settings` / `set-cover` / `upload-cover` /
 * `crop-cover` branches in `inspection-edit/action.server.ts` are the same
 * writes through the same BFF relay — the hub just reaches them from the
 * inspection's home page instead of the editor.
 */

import type { Api } from "~/lib/api-client.server";
import { toActionResult } from "~/lib/action-result";
import { sanitizeSettingsPatch } from "~/lib/settings-patch";
import { m } from "~/paraglide/messages";

/** Fields of `UpdateInspectionSchema` the hub's settings section may write. */
const SETTINGS_FIELDS = ["templateId", "requireDefectFieldsOverride", "profileOverride"] as const;

type SettingsField = (typeof SETTINGS_FIELDS)[number];

/**
 * Keep only the settings fields out of a posted payload.
 *
 * The route relays this straight to `PATCH /api/inspections/:id`, whose Zod
 * schema also accepts `status`, the order facts and the property facts. Those
 * have their own surfaces with their own rules — the publish lifecycle owns
 * `status`, the order cards own the order facts — so an allow-list here keeps
 * the settings form from quietly becoming a general-purpose inspection PATCH.
 * Exported for the test that pins the list.
 */
export function pickSettingsFields(payload: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of SETTINGS_FIELDS) {
        // `null` is meaningful (clear the override back to inherit); only absence is skipped.
        if (key in payload) out[key as SettingsField] = payload[key];
    }
    return out;
}

/**
 * `save-settings` — the settings section's Save button. The form forwards its
 * whole state; sanitize at the BFF boundary so empty-string "inherit" values
 * are dropped (the schema leaves them alone) and explicit nulls clear the
 * override columns, exactly as the editor sheet's save did.
 */
export async function handleSaveSettings(
    api: Api,
    inspectionId: string,
    formData: FormData,
): Promise<{ ok: boolean; intent: "save-settings"; error: string | undefined }> {
    let parsed: Record<string, unknown>;
    try {
        parsed = JSON.parse(String(formData.get("payload") ?? "{}")) as Record<string, unknown>;
    } catch {
        return { ok: false, intent: "save-settings", error: m.inspections_hub_error_save_settings() };
    }
    const res = await api.inspections[":id"].$patch({
        param: { id: inspectionId },
        json: sanitizeSettingsPatch(pickSettingsFields(parsed)),
    });
    return toActionResult(res, "save-settings", m.inspections_hub_error_save_settings());
}

/**
 * `set-cover` — pick an existing inspection photo as the report cover, or
 * clear it. The value is the R2 key of a photo belonging to this inspection
 * (validated server-side); empty clears.
 */
export async function handleSetCover(
    api: Api,
    inspectionId: string,
    formData: FormData,
): Promise<{ ok: boolean; intent: "set-cover"; error: string | undefined }> {
    const raw = formData.get("coverPhotoId");
    const coverPhotoId = raw ? String(raw) : null;
    const res = await api.inspections[":id"].$patch({
        param: { id: inspectionId },
        json: { coverPhotoId },
    });
    return toActionResult(res, "set-cover", m.inspections_hub_error_set_cover());
}

/**
 * `upload-cover` — direct cover upload: upload an image to the loose media
 * pool, then set it as the report cover in one step. Returns the uploaded
 * photo's key + url so the section can append it to the grid locally instead
 * of reloading (and visibly flickering) the whole section.
 */
export async function handleUploadCover(
    api: Api,
    inspectionId: string,
    formData: FormData,
): Promise<{ ok: boolean; intent: "upload-cover"; error: string | undefined; coverKey?: string | null; coverUrl?: string | null }> {
    const file = formData.get("file");
    if (!(file instanceof File)) return { ok: false, intent: "upload-cover", error: m.inspections_hub_error_upload_cover() };
    const up = await api.inspections[":id"].media.upload.$post({
        param: { id: inspectionId },
        form: { file },
    });
    if (!up.ok) return toActionResult(up, "upload-cover", m.inspections_hub_error_upload_cover());
    const body = (await up.json()) as { data?: { key?: string; url?: string } };
    const key = body.data?.key;
    if (!key) return { ok: false, intent: "upload-cover", error: m.inspections_hub_error_upload_cover() };
    const patch = await api.inspections[":id"].$patch({
        param: { id: inspectionId },
        json: { coverPhotoId: key },
    });
    if (!patch.ok) return toActionResult(patch, "upload-cover", m.inspections_hub_error_upload_cover());
    return { ok: true, intent: "upload-cover", error: undefined, coverKey: key, coverUrl: body.data?.url ?? null };
}

/**
 * `crop-cover` — save a crop of the chosen cover photo. Returns the new cover
 * key so the section can show the cropped image without reloading.
 */
export async function handleCropCover(
    api: Api,
    inspectionId: string,
    formData: FormData,
): Promise<{ ok: boolean; intent: "crop-cover"; error: string | undefined; coverKey?: string | null }> {
    const image = formData.get("image");
    const sourceKey = String(formData.get("sourceKey") ?? "");
    const crop = String(formData.get("crop") ?? "");
    if (!(image instanceof File) || !sourceKey) return { ok: false, intent: "crop-cover", error: m.inspections_hub_error_crop_cover() };
    const res = await api.inspections[":id"].cover.$post({
        param: { id: inspectionId },
        form: { image, sourceKey, crop },
    });
    if (!res.ok) return toActionResult(res, "crop-cover", m.inspections_hub_error_crop_cover());
    const body = (await res.json().catch(() => null)) as { data?: { coverImageKey?: string } } | null;
    return { ok: true, intent: "crop-cover", error: undefined, coverKey: body?.data?.coverImageKey ?? null };
}
