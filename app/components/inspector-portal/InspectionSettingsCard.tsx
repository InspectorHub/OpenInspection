/**
 * #529 — the inspection's report settings, on the hub.
 *
 * The template, the required-defect-fields override, the appearance profile
 * and the report cover photo used to live in the report editor's settings
 * sheet, behind an unlabelled gear — the only way to change a template was to
 * open the editor. IA-87 already moved the order facts to the portal; this is
 * the rest of the sheet, as its own card beside the Report card it governs.
 *
 * It reads through the same BFF resource route the sheet used
 * (`/resources/inspection-settings-sheet`, via `createWebSettingsSheet`) and
 * writes through the hub route's own `save-settings` / `set-cover` /
 * `upload-cover` / `crop-cover` intents, which call the same API the editor's
 * action called. The form state, the null-for-inherit convention and the
 * cover flow (pick, upload, crop) are the sheet's, moved here unchanged.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Button, Card, useActionLatch } from "@core/shared-ui";
import { CoverCropper, coverCropFor, type StoredCoverCrop } from "@core/field-ui/components/media-studio/CoverCropper";
import { fullResUrl } from "@core/field-ui/components/media-studio/cropImage";
import { photoRefusal } from "@core/field-ui/shared/photo-admission";
import { onlinePhotoRejectionMessages } from "@core/field-ui/editor/photo-rejection-messages";
import { m as fieldM } from "@core/field-ui/i18n";
import type { CoverPhotoOption, ReportProfileOption, SettingsSheetData, TemplateSummary } from "@core/field-ui/data-source-types";
import { createWebSettingsSheet } from "~/lib/field/web-settings-sheet";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import { BlockHeading } from "~/components/inspector-portal/BlockHeading";
import { m } from "~/paraglide/messages";
import type { action } from "~/routes/inspector-portal";

const settingsSheet = createWebSettingsSheet();

interface SettingsForm {
    templateId: string;
    /** Track H (IA-7) — per-inspection override of the tenant-wide required defect fields; '' = inherit (stored as NULL). */
    requireDefectFieldsOverride: "" | "none" | "location" | "trade" | "both";
    /** Report Style Presets — per-inspection appearance profile; '' = inherit (template default -> company default), stored as NULL. */
    profileOverride: string;
}

type SaveState = "idle" | "saving" | "saved" | "error";

export function InspectionSettingsCard({ inspectionId, canEdit }: { inspectionId: string; canEdit: boolean }) {
    const [loading, setLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);
    const [templates, setTemplates] = useState<TemplateSummary[]>([]);
    const [profiles, setProfiles] = useState<ReportProfileOption[]>([]);
    const [sheetInspection, setSheetInspection] = useState<Record<string, unknown> | null>(null);
    const [form, setForm] = useState<SettingsForm>({ templateId: "", requireDefectFieldsOverride: "", profileOverride: "" });
    const [saveState, setSaveState] = useState<SaveState>("idle");
    const [coverError, setCoverError] = useState<string | null>(null);
    // DB-16 — report cover picker. `photos` are all of the inspection's photos;
    // `coverKey` is the chosen cover R2 key (optimistic).
    const [photos, setPhotos] = useState<CoverPhotoOption[]>([]);
    const [coverKey, setCoverKey] = useState<string>("");
    const [uploadingCover, setUploadingCover] = useState(false);
    const coverFileRef = useRef<HTMLInputElement>(null);
    const [cropSource, setCropSource] = useState<{ key: string; url: string } | null>(null);
    // The crop saved during THIS card session: `crop-cover` does not reload the section, so `sheetInspection`
    // still holds the crop from when it loaded, and re-cropping would re-open on a frame already replaced.
    const [sessionCrop, setSessionCrop] = useState<{ key: string; crop: StoredCoverCrop } | null>(null);
    // The crop the in-flight crop-cover submit carries: only the answer confirms it, so the session crop is
    // recorded from here, not at submit time — a failed crop must not become the frame a re-crop re-opens on.
    const pendingCrop = useRef<{ key: string; crop: StoredCoverCrop } | null>(null);

    const mounted = useRef(true);
    const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            clearTimeout(idleTimer.current);
        };
    }, []);

    // The settings save: one guarded submit for the whole form, so Enter plus a click in one frame send one request.
    const { fetcher: saveFetcher, submit: saveSubmit, busy: saveBusy } = useGuardedSubmit<typeof action>();
    // One fetcher for every cover write (pick, clear, upload, crop): they all rewrite the cover of this inspection.
    const coverFetcher = useFetcher<typeof action>();
    const coverBusy = coverFetcher.state !== "idle";
    // One guard for every cover write: they all rewrite the cover of this inspection.
    const coverLatch = useActionLatch(coverBusy);
    // The cover key the last set-cover submit optimistically showed, so a refused write can put it back.
    const coverBefore = useRef("");

    const applyLoaded = useCallback((d: SettingsSheetData) => {
        const insp = d.inspection;
        if (insp) {
            setForm({
                templateId: (insp.templateId as string) || "",
                requireDefectFieldsOverride: (insp.requireDefectFieldsOverride as SettingsForm["requireDefectFieldsOverride"]) || "",
                profileOverride: (insp.profileOverride as string) || "",
            });
        }
        setSheetInspection(insp);
        setTemplates(d.templates ?? []);
        setProfiles(d.profiles ?? []);
        setPhotos(d.photos ?? []);
        // Cover key lives on the inspection row; the detail API exposes it as
        // `coverPhotoId` (raw) or `coverPhoto` (formatted) — read either.
        setCoverKey(((insp?.coverPhotoId ?? insp?.coverPhoto) as string | null) ?? "");
        setLoading(false);
    }, []);

    // Read the settings when the card mounts; the skeleton shows until the answer lands. The newest read wins: an
    // answer to an earlier one is dropped. No answer, or the empty shape the route gives when the session expired
    // (no inspection), offers a retry, not a form that would save blanks over the stored values.
    const loadSeq = useRef(0);
    const loadSettings = useCallback(() => {
        const seq = (loadSeq.current += 1);
        setLoading(true);
        setLoadFailed(false);
        void settingsSheet
            .load(inspectionId)
            .catch(() => null)
            .then((d) => {
                if (seq !== loadSeq.current) return;
                if (d === null || d.inspection === null) {
                    setLoadFailed(true);
                    setLoading(false);
                    return;
                }
                applyLoaded(d);
            });
    }, [inspectionId, applyLoaded]);
    useEffect(() => {
        loadSettings();
        return () => {
            loadSeq.current += 1;
        };
    }, [loadSettings]);

    // The save's answer drives the pill. B-17 lesson: "idle" alone is not "saved" — gate on the action's ok.
    useEffect(() => {
        if (saveFetcher.state !== "idle" || saveFetcher.data?.intent !== "save-settings") return;
        if (!saveFetcher.data.ok) {
            setSaveState("error");
            return;
        }
        setSaveState("saved");
        clearTimeout(idleTimer.current);
        idleTimer.current = setTimeout(() => setSaveState("idle"), 2000);
    }, [saveFetcher.state, saveFetcher.data]);
    useEffect(() => {
        if (saveBusy) setSaveState("saving");
    }, [saveBusy]);

    // A cover write's answer: set-cover reverts on refusal; upload appends the new photo to the grid and opens it
    // for cropping; crop records the new key. All three surface the action's error rather than a silent revert.
    useEffect(() => {
        if (coverFetcher.state !== "idle" || !coverFetcher.data) return;
        const data = coverFetcher.data as { intent?: string; ok?: boolean; error?: string; coverKey?: string | null; coverUrl?: string | null };
        if (data.intent === "set-cover") {
            if (!data.ok) {
                setCoverKey(coverBefore.current);
                setCoverError(data.error ?? m.inspections_hub_error_set_cover());
            }
            return;
        }
        if (data.intent === "upload-cover") {
            setUploadingCover(false);
            if (!data.ok || !data.coverKey) {
                setCoverError(data.error ?? m.inspections_hub_error_upload_cover());
                return;
            }
            setCoverError(null);
            setCoverKey(data.coverKey);
            if (data.coverUrl) {
                setPhotos((prev) =>
                    prev.some((p) => p.key === data.coverKey) ? prev : [{ key: data.coverKey as string, url: data.coverUrl as string, label: fieldM.editor_settings_cover_uploaded_label() }, ...prev],
                );
                setCropSource({ key: data.coverKey, url: data.coverUrl });
            }
            return;
        }
        if (data.intent === "crop-cover") {
            if (!data.ok) {
                setCoverError(data.error ?? m.inspections_hub_error_crop_cover());
                return;
            }
            setCoverError(null);
            if (data.coverKey) setCoverKey(data.coverKey);
            if (pendingCrop.current) {
                setSessionCrop(pendingCrop.current);
                pendingCrop.current = null;
            }
        }
    }, [coverFetcher.state, coverFetcher.data]);

    function updateForm<K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) {
        setForm((prev) => ({ ...prev, [key]: value }));
    }

    function handleSave(e: React.FormEvent) {
        e.preventDefault();
        // '' means "inherit" and must reach the API as an explicit null (clears the
        // override column) — the BFF sanitizer drops empty strings entirely.
        const payload = {
            ...form,
            requireDefectFieldsOverride: form.requireDefectFieldsOverride === "" ? null : form.requireDefectFieldsOverride,
            profileOverride: form.profileOverride === "" ? null : form.profileOverride,
        };
        saveSubmit({ intent: "save-settings", payload: JSON.stringify(payload) }, { method: "post" });
    }

    function selectCover(key: string) {
        if (!canEdit) return;
        setCoverError(null);
        if (coverKey === key) {
            coverBefore.current = coverKey;
            setCoverKey("");
            // The latch drops a same-frame repeat; a clear dropped because ANOTHER cover write is out puts the
            // selection back via the set-cover answer effect above.
            coverLatch(() => {
                coverFetcher.submit({ intent: "set-cover", coverPhotoId: "" }, { method: "post" });
            });
            return;
        }
        const photo = photos.find((p) => p.key === key);
        if (photo) setCropSource({ key, url: photo.url });
    }

    // DB-16 — direct cover upload. The latch drops a repeat (same frame, or while a check is pending).
    function uploadCover(file: File) {
        if (!canEdit) return;
        coverLatch(() => {
            setUploadingCover(true);
            setCoverError(null);
            // The photo check first (size ceiling, type by bytes): a file the server would refuse is announced with the
            // photo wording and never sent.
            void photoRefusal(file).then((refusal) => {
                if (refusal !== null) {
                    const [message] = onlinePhotoRejectionMessages([{ index: 0, ok: false, error: refusal }]);
                    if (mounted.current) {
                        setCoverError(message ?? fieldM.editor_photo_save_failed());
                        setUploadingCover(false);
                    }
                    return;
                }
                const fd = new FormData();
                fd.set("intent", "upload-cover");
                fd.set("file", file);
                coverFetcher.submit(fd, { method: "post", encType: "multipart/form-data" });
            });
        });
    }

    const inputClass = "mt-1 w-full h-10 px-3 rounded-md border border-ih-border bg-ih-bg-card text-ih-fg-1 text-[14px] font-medium focus:border-ih-primary focus:shadow-ih-focus outline-none disabled:opacity-60";
    const labelClass = "text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3";

    return (
        <Card className="p-5" data-testid="hub-settings-card">
            <BlockHeading title={m.inspections_hub_block_settings()} />
            {loadFailed ? (
                <div className="py-6 text-center space-y-2">
                    <p className="text-[13px] text-ih-bad-fg">{fieldM.editor_settings_load_failed()}</p>
                    <Button variant="secondary" size="sm" onClick={loadSettings}>
                        {fieldM.editor_collab_try_again()}
                    </Button>
                </div>
            ) : loading ? (
                <div className="space-y-2 py-4" aria-busy="true">
                    <div className="h-4 bg-ih-bg-muted rounded animate-pulse" style={{ width: "50%" }} />
                    <div className="h-4 bg-ih-bg-muted rounded animate-pulse" style={{ width: "75%" }} />
                </div>
            ) : (
                <form onSubmit={handleSave} className="space-y-6">
                    <fieldset className="space-y-4">
                        <legend className="text-[15px] font-semibold tracking-tight text-ih-fg-1">{fieldM.editor_settings_legend_template()}</legend>
                        <div className="block">
                            <label className={labelClass} htmlFor="hub-settings-template">
                                {fieldM.editor_settings_field_template()}
                            </label>
                            <select
                                id="hub-settings-template"
                                data-testid="hub-settings-template"
                                value={form.templateId}
                                onChange={(e) => updateForm("templateId", e.target.value)}
                                className={inputClass}
                                disabled={!canEdit}
                            >
                                {form.templateId && !templates.some((t) => t.id === form.templateId) && (
                                    <option value={form.templateId}>{form.templateId}</option>
                                )}
                                {templates.map((t) => (
                                    <option key={t.id} value={t.id}>
                                        {t.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </fieldset>

                    <fieldset className="space-y-4">
                        <legend className="text-[15px] font-semibold tracking-tight text-ih-fg-1">{fieldM.editor_settings_legend_report_rules()}</legend>
                        <label className="block">
                            <span className={labelClass}>{fieldM.editor_settings_required_defect_fields()}</span>
                            <select
                                value={form.requireDefectFieldsOverride}
                                onChange={(e) => updateForm("requireDefectFieldsOverride", e.target.value as SettingsForm["requireDefectFieldsOverride"])}
                                className={inputClass}
                                data-testid="hub-settings-required-fields"
                                disabled={!canEdit}
                            >
                                <option value="">{fieldM.editor_settings_required_inherit()}</option>
                                <option value="none">{fieldM.editor_settings_required_none()}</option>
                                <option value="location">{fieldM.editor_settings_required_location()}</option>
                                <option value="trade">{fieldM.editor_settings_required_trade()}</option>
                                <option value="both">{fieldM.editor_settings_required_both()}</option>
                            </select>
                            <p className="mt-1 text-[11px] text-ih-fg-3">{fieldM.editor_settings_required_defect_help()}</p>
                        </label>
                    </fieldset>

                    {/* Appearance: the cover photo and the style preset are the same
                        concern, so they are one section. DB-16: pick an existing inspection photo OR upload one directly. */}
                    <fieldset className="space-y-2">
                        <legend className="text-[15px] font-semibold tracking-tight text-ih-fg-1">{fieldM.editor_settings_legend_appearance()}</legend>
                        <span className={`${labelClass} block pt-1`}>{fieldM.editor_settings_legend_cover()}</span>
                        <input
                            ref={coverFileRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) uploadCover(file);
                                e.target.value = ""; // allow re-selecting the same file
                            }}
                        />
                        {photos.length === 0 ? (
                            <p className="text-[12px] text-ih-fg-3">{fieldM.editor_settings_cover_empty()}</p>
                        ) : (
                            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2" data-testid="hub-settings-cover-grid">
                                {photos.map((p) => {
                                    const selected = coverKey === p.key;
                                    return (
                                        <button
                                            key={p.key}
                                            type="button"
                                            onClick={() => selectCover(p.key)}
                                            title={selected ? fieldM.editor_settings_cover_current() : p.label ? fieldM.editor_settings_cover_set_labeled({ label: p.label }) : fieldM.editor_settings_cover_set()}
                                            disabled={!canEdit}
                                            className={`relative aspect-square rounded-md overflow-hidden border-2 transition-colors ${selected ? "border-ih-primary" : "border-ih-border hover:border-ih-primary/60"} disabled:opacity-60`}
                                        >
                                            <img src={p.url} alt={p.label || fieldM.editor_settings_cover_photo_alt()} className="w-full h-full object-cover" loading="lazy" />
                                            {selected && (
                                                <span className="absolute inset-x-0 bottom-0 bg-ih-primary text-ih-fg-inverse text-[9px] font-bold text-center py-0.5">{fieldM.editor_settings_cover_badge()}</span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                        {canEdit && (
                            <div className="pt-1 space-y-1">
                                <Button variant="secondary" size="sm" onClick={() => coverFileRef.current?.click()} pending={coverBusy && uploadingCover}>
                                    {coverBusy && uploadingCover ? fieldM.editor_uploading() : fieldM.editor_settings_cover_upload()}
                                </Button>
                                <p className="text-[11px] text-ih-fg-3">{fieldM.editor_settings_cover_hint()}</p>
                            </div>
                        )}
                        {coverError && <p className="text-[12px] font-medium text-ih-bad-fg">{coverError}</p>}

                        {/* Report Style Presets — collapsed by default (progressive disclosure: the default path never touches this). */}
                        <details className="pt-2">
                            <summary className="text-[12px] text-ih-fg-3 cursor-pointer select-none">{fieldM.editor_settings_appearance_summary()}</summary>
                            <label className="block mt-3">
                                <select
                                    value={form.profileOverride}
                                    onChange={(e) => updateForm("profileOverride", e.target.value)}
                                    className={inputClass}
                                    data-testid="hub-settings-profile"
                                    disabled={!canEdit}
                                >
                                    <option value="">{fieldM.editor_settings_appearance_inherit()}</option>
                                    {profiles.map((p) => (
                                        <option key={p.id} value={p.id}>
                                            {p.name}
                                        </option>
                                    ))}
                                </select>
                                <p className="mt-1 text-[11px] text-ih-fg-3">{fieldM.editor_settings_appearance_help()}</p>
                            </label>
                        </details>
                    </fieldset>

                    {canEdit && (
                        <div className="flex items-center gap-3 pt-1">
                            <Button variant="primary" type="submit" pending={saveBusy} data-testid="hub-settings-save">
                                {fieldM.editor_settings_save_changes()}
                            </Button>
                            {saveState === "saving" && <span className="text-[12px] text-ih-watch-fg font-bold">{fieldM.editor_header_save_saving()}</span>}
                            {saveState === "saved" && <span className="text-[12px] text-ih-ok-fg font-bold">{fieldM.editor_header_save_saved()}</span>}
                            {saveState === "error" && <span className="text-[12px] text-ih-bad-fg font-bold">{fieldM.editor_settings_save_error()}</span>}
                        </div>
                    )}
                </form>
            )}
            {cropSource && (
                <CoverCropper
                    sourceUrl={fullResUrl(cropSource.url)}
                    sourceKey={cropSource.key}
                    initialCrop={sessionCrop?.key === cropSource.key ? sessionCrop.crop : coverCropFor(sheetInspection, cropSource.key)}
                    onCancel={() => setCropSource(null)}
                    onSave={(blob, c) => {
                        const source = cropSource;
                        const crop = { aspect: c.aspect, orientation: c.orientation, ...c.pixels };
                        const image = new File([blob], "cover.jpg", { type: "image/jpeg" });
                        // Checked first: an image the server would refuse is announced, nothing is sent and the cropper stays open.
                        void photoRefusal(image).then((refusal) => {
                            if (refusal || !mounted.current) return;
                            setCropSource(null);
                            const fd = new FormData();
                            fd.set("intent", "crop-cover");
                            fd.set("image", image);
                            fd.set("sourceKey", source.key);
                            fd.set("crop", JSON.stringify(crop));
                            coverLatch(() => {
                                pendingCrop.current = { key: source.key, crop };
                                coverFetcher.submit(fd, { method: "post", encType: "multipart/form-data" });
                            });
                        });
                    }}
                />
            )}
        </Card>
    );
}
