/**
 * #529 — the inspection's report settings, on the hub.
 *
 * The template, the required-defect-fields override, the appearance profile
 * and the report cover photo used to live in the report editor's settings
 * sheet, behind an unlabelled gear — the only way to change a template was to
 * open the editor. IA-87 already moved the order facts to the portal; this is
 * the rest of the sheet, as its own card beside the Report card it governs.
 *
 * It reads from the hub loader (`initialSettings`, loaded server-side by
 * `loadInspectionSettings`) and writes through the hub route's own
 * `save-settings` / `set-cover` / `upload-cover` / `crop-cover` intents, which
 * call the same API the editor's action called. The form state and the
 * null-for-inherit convention are the sheet's, moved here unchanged. The
 * retry button is the only client fetch: it re-reads through the BFF resource
 * route (`/resources/inspection-settings-sheet`, via `createWebSettingsSheet`).
 * The cover picker lives in `InspectionSettingsCover`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card } from "@core/shared-ui";
import { m as fieldM } from "@core/field-ui/i18n";
import type { ReportProfileOption, SettingsSheetData, TemplateSummary } from "@core/field-ui/data-source-types";
import { createWebSettingsSheet } from "~/lib/field/web-settings-sheet";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import { BlockHeading } from "~/components/inspector-portal/BlockHeading";
import { InspectionSettingsCover } from "~/components/inspector-portal/InspectionSettingsCover";
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

function formFromSheet(d: SettingsSheetData | null): SettingsForm {
    const insp = d?.inspection;
    return {
        templateId: (insp?.templateId as string) || "",
        requireDefectFieldsOverride: (insp?.requireDefectFieldsOverride as SettingsForm["requireDefectFieldsOverride"]) || "",
        profileOverride: (insp?.profileOverride as string) || "",
    };
}

/** Cover key lives on the inspection row; the detail API exposes it as `coverPhotoId` (raw) or `coverPhoto` (formatted) — read either. */
function coverKeyFromSheet(d: SettingsSheetData | null): string {
    const insp = d?.inspection;
    return ((insp?.coverPhotoId ?? insp?.coverPhoto) as string | null) ?? "";
}

export function InspectionSettingsCard({ inspectionId, initialSettings, canEdit }: { inspectionId: string; initialSettings: SettingsSheetData | null | undefined; canEdit: boolean }) {
    const [sheet, setSheet] = useState<SettingsSheetData | null>(initialSettings ?? null);
    const [form, setForm] = useState<SettingsForm>(() => formFromSheet(initialSettings ?? null));
    const [loading, setLoading] = useState(false);
    // Missing data (a loader that predates the settings read, or one that
    // failed) is a failed load, not a crash: the card offers a retry, which
    // re-reads through the resource route.
    const [loadFailed, setLoadFailed] = useState(initialSettings == null || initialSettings.inspection === null);
    const [saveState, setSaveState] = useState<SaveState>("idle");

    const templates: TemplateSummary[] = sheet?.templates ?? [];
    const profiles: ReportProfileOption[] = sheet?.profiles ?? [];

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

    const applyLoaded = useCallback((d: SettingsSheetData) => {
        setSheet(d);
        setForm(formFromSheet(d));
        setLoadFailed(d.inspection === null);
        setLoading(false);
    }, []);

    // The retry is the only client fetch. The newest read wins: an answer to an
    // earlier one is dropped. No answer, or the empty shape the route gives when
    // the session expired (no inspection), offers a retry, not a form that would
    // save blanks over the stored values.
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
                        concern, so they are one section. */}
                    <fieldset className="space-y-2">
                        <legend className="text-[15px] font-semibold tracking-tight text-ih-fg-1">{fieldM.editor_settings_legend_appearance()}</legend>
                        <InspectionSettingsCover
                            inspection={sheet?.inspection ?? null}
                            initialPhotos={sheet?.photos ?? []}
                            initialCoverKey={coverKeyFromSheet(sheet)}
                            canEdit={canEdit}
                        />

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
        </Card>
    );
}
