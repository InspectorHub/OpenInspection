import { useState, useEffect, useRef, useCallback } from "react";
import { Drawer, Button, useActionLatch } from "@core/shared-ui";
import { TemplateCombobox } from "../TemplateCombobox";
import { CoverCropper, coverCropFor, type StoredCoverCrop } from "../media-studio/CoverCropper";
import { fullResUrl } from "../media-studio/cropImage";
import { ORIGINAL_QUALITY_KEY } from "../../shared/original-quality";
import { isIgnored, useFieldCommand, useFieldDataSource } from "../../context";
import type { CoverPhotoOption, ReportProfileOption, SettingsSheetData, TemplateSummary } from "../../data-source-types";
import { m } from "../../i18n";

/**
 * REPORT settings — everything here changes how this inspection's report is
 * authored and how it looks.
 *
 * It used to also carry the order: the inspection date, the assigned inspector,
 * the closing date, the reference number, the referral source, the price and
 * the two delivery gates. Those are facts about the job, not about the report,
 * and putting them here meant the only way to change a price was to open the
 * report editor and find an unlabelled gear. They live on the inspector portal
 * now, on the card for the thing each one affects (IA-87).
 */
interface SettingsForm {
  templateId: string;
  /** Track H (IA-7) — per-inspection override of the tenant-wide required
   *  defect fields; '' = inherit (stored as NULL). */
  requireDefectFieldsOverride: "" | "none" | "location" | "trade" | "both";
  /** Report Style Presets — per-inspection appearance profile; '' = inherit
   *  (template default -> company default), stored as NULL. */
  profileOverride: string;
}

interface InspectionSettingsSheetProps {
  open: boolean;
  onClose: () => void;
  inspectionId: string;
  /** Called after a successful save where the template selection changed. */
  onTemplateApplied?: () => void;
}

type SaveState = "idle" | "saving" | "saved" | "error";

export function InspectionSettingsSheet({ open, onClose, inspectionId, onTemplateApplied }: InspectionSettingsSheetProps) {
  const sheet = useFieldDataSource().resources.settingsSheet;
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [profiles, setProfiles] = useState<ReportProfileOption[]>([]);
  const [sheetInspection, setSheetInspection] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState<SettingsForm>({
    templateId: "",
    requireDefectFieldsOverride: "",
    profileOverride: "",
  });
  // Tracks the templateId that was loaded when the sheet opened, so we can
  // detect whether the user changed it before saving.
  const templateIdAtOpen = useRef<string>("");
  // The settings save rewrites the inspection record: one synchronous guard (`useFieldCommand`) for the whole
  // form, so Enter plus a click in one frame send one request. `templateChangedAtSubmit` is captured at submit.
  const { run: runSave } = useFieldCommand(inspectionId);
  const templateChangedAtSubmit = useRef(false);
  const mounted = useRef(true);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onTemplateAppliedRef = useRef(onTemplateApplied);
  onTemplateAppliedRef.current = onTemplateApplied;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(idleTimer.current);
    };
  }, []);

  // DB-16 — report cover picker. `photos` are all of the inspection's photos;
  // `coverKey` is the chosen cover R2 key (optimistic).
  const [photos, setPhotos] = useState<CoverPhotoOption[]>([]);
  const [coverKey, setCoverKey] = useState<string>("");
  // One guard for every cover write (clear, upload, crop): they all rewrite the cover of this inspection.
  const { run: runCover, busy: coverBusy } = useFieldCommand(inspectionId);
  const [uploadingCover, setUploadingCover] = useState(false);
  const coverFileRef = useRef<HTMLInputElement>(null);
  const [cropSource, setCropSource] = useState<{ key: string; url: string } | null>(null);

  // N2+N4 — device-local "original quality uploads" opt-out. Default OFF =
  // preprocessing ON (downscale + EXIF/GPS strip). Persisted to localStorage so
  // the choice is read by all three photo entry points in inspection-edit.
  const [originalQuality, setOriginalQuality] = useState(false);
  useEffect(() => {
    try {
      setOriginalQuality(localStorage.getItem(ORIGINAL_QUALITY_KEY) === "1");
    } catch {
      setOriginalQuality(false);
    }
  }, [open]);
  function toggleOriginalQuality(next: boolean) {
    setOriginalQuality(next);
    try {
      if (next) localStorage.setItem(ORIGINAL_QUALITY_KEY, "1");
      else localStorage.removeItem(ORIGINAL_QUALITY_KEY);
    } catch {
      /* private mode / disabled storage — preference simply doesn't persist */
    }
  }

  const applyLoaded = useCallback((d: SettingsSheetData) => {
    const insp = d.inspection;
    if (insp) {
      const loadedTemplateId = (insp.templateId as string) || "";
      templateIdAtOpen.current = loadedTemplateId;
      setForm({
        templateId: loadedTemplateId,
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

  // Read the sheet when it opens or the inspection changes; the skeleton shows until the answer lands. The
  // newest read wins: an answer to an earlier one is dropped. No answer, or the empty shape a host gives
  // when the session expired (no inspection), offers a retry, not a form that would save blanks over the stored values.
  const loadSeq = useRef(0);
  const loadSheet = useCallback(() => {
    const seq = (loadSeq.current += 1);
    setLoading(true);
    setLoadFailed(false);
    void (sheet?.load(inspectionId) ?? Promise.resolve(null))
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
  }, [sheet, inspectionId, applyLoaded]);
  useEffect(() => {
    if (open && inspectionId) loadSheet();
    return () => {
      loadSeq.current += 1;
    };
  }, [open, inspectionId, loadSheet]);

  // The crop saved during THIS sheet session: `crop-cover` does not reload the sheet, so `sheetInspection`
  // still holds the crop from when it opened, and re-cropping would re-open on a frame already replaced.
  const [sessionCrop, setSessionCrop] = useState<{ key: string; crop: StoredCoverCrop } | null>(null);

  function selectCover(key: string) {
    if (coverKey === key) {
      const before = coverKey;
      // The latch drops a same-frame repeat (its closure still sees the old cover and would restore it); a clear
      // dropped because ANOTHER cover write is out puts the selection back.
      coverLatch(() => {
        setCoverKey("");
        void runCover({ type: "set-cover", coverPhotoId: "" }).then((r) => {
          if (isIgnored(r) && mounted.current) setCoverKey(before);
        });
      });
      return;
    }
    const photo = photos.find((p) => p.key === key);
    if (photo) setCropSource({ key, url: photo.url });
  }

  // DB-16 — direct cover upload (`upload-cover`: pool upload + set cover). The latch drops a same-frame repeat
  // before anything is touched; `runCover` drops one that lands while an earlier cover write is still out.
  const coverLatch = useActionLatch(coverBusy);
  function uploadCover(file: File) {
    coverLatch(() => {
      setUploadingCover(true);
      void runCover({ type: "upload-cover", file }).then((result) => {
        if (mounted.current) setUploadingCover(false);
        if (isIgnored(result) || !mounted.current || !result.ok || !result.data?.coverKey) return;
        // Append the new photo to the grid and open it for cropping — all in LOCAL state. We deliberately
        // do NOT reload the sheet (that would flicker the entire settings sheet).
        const key = result.data.coverKey;
        const url = result.data.coverUrl;
        if (url) {
          setPhotos((prev) => (prev.some((p) => p.key === key) ? prev : [{ key, url, label: m.editor_settings_cover_uploaded_label() }, ...prev]));
          setCropSource({ key, url });
        }
      });
    });
  }

  function updateForm<K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaveState("saving");
    templateChangedAtSubmit.current = form.templateId !== templateIdAtOpen.current;
    // '' means "inherit" and must reach the API as an explicit null (clears the
    // override column) — the BFF sanitizer drops empty strings entirely.
    const payload = {
      ...form,
      requireDefectFieldsOverride: form.requireDefectFieldsOverride === "" ? null : form.requireDefectFieldsOverride,
      profileOverride: form.profileOverride === "" ? null : form.profileOverride,
    };
    const result = await runSave({ type: "save-settings", payload });
    // A save dropped because one is already out: that one's answer drives the pill.
    if (isIgnored(result) || !mounted.current) return;
    // B-17 lesson: "idle" alone is not "saved" — gate on the action's ok.
    if (!result.ok) {
      setSaveState("error");
      return;
    }
    setSaveState("saved");
    if (templateChangedAtSubmit.current) onTemplateAppliedRef.current?.();
    templateChangedAtSubmit.current = false;
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setSaveState("idle"), 2000);
  }

  const inputClass = "mt-1 w-full h-10 px-3 rounded-md border border-ih-border bg-ih-bg-card text-ih-fg-1 text-[14px] font-medium focus:border-ih-primary focus:shadow-ih-focus outline-none";
  const labelClass = "text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3";

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        title={m.editor_header_settings()}
        wide
        footer={loading || loadFailed ? undefined : (
          <>
            {saveState === "saving" && <span className="text-[12px] text-ih-watch-fg font-bold self-center">{m.editor_header_save_saving()}</span>}
            {saveState === "saved" && <span className="text-[12px] text-ih-ok-fg font-bold self-center">{m.editor_header_save_saved()}</span>}
            {saveState === "error" && <span className="text-[12px] text-ih-bad-fg font-bold self-center">{m.editor_settings_save_error()}</span>}
            <Button variant="primary" type="submit" form="inspection-settings-form" pending={saveState === "saving"}>
              {m.editor_settings_save_changes()}
            </Button>
          </>
        )}
      >
        {loadFailed ? (
          <div className="py-6 text-center space-y-2">
            <p className="text-[13px] text-ih-bad-fg">{m.editor_settings_load_failed()}</p>
            <Button variant="secondary" size="sm" onClick={loadSheet}>{m.editor_collab_try_again()}</Button>
          </div>
        ) : loading ? (
          <div className="space-y-2 py-4" aria-busy="true">
            <div className="h-4 bg-ih-bg-muted rounded animate-pulse" style={{ width: "50%" }} />
            <div className="h-4 bg-ih-bg-muted rounded animate-pulse" style={{ width: "75%" }} />
          </div>
        ) : (
          <form id="inspection-settings-form" onSubmit={handleSave} className="space-y-6">
              <fieldset className="space-y-4">
                <legend className="text-[15px] font-semibold tracking-tight text-ih-fg-1">{m.editor_settings_legend_template()}</legend>
                <div className="block">
                  <span className={labelClass}>{m.editor_settings_field_template()}</span>
                  <TemplateCombobox
                    value={form.templateId}
                    onChange={(id) => updateForm("templateId", id)}
                    initialTemplates={templates}
                  />
                </div>
              </fieldset>

              <fieldset className="space-y-4">
                <legend className="text-[15px] font-semibold tracking-tight text-ih-fg-1">{m.editor_settings_legend_report_rules()}</legend>
                <label className="block">
                  <span className={labelClass}>{m.editor_settings_required_defect_fields()}</span>
                  <select
                    value={form.requireDefectFieldsOverride}
                    onChange={(e) => updateForm("requireDefectFieldsOverride", e.target.value as SettingsForm["requireDefectFieldsOverride"])}
                    className={inputClass}
                    data-testid="inspection-require-defect-fields"
                  >
                    <option value="">{m.editor_settings_required_inherit()}</option>
                    <option value="none">{m.editor_settings_required_none()}</option>
                    <option value="location">{m.editor_settings_required_location()}</option>
                    <option value="trade">{m.editor_settings_required_trade()}</option>
                    <option value="both">{m.editor_settings_required_both()}</option>
                  </select>
                  <p className="mt-1 text-[11px] text-ih-fg-3">{m.editor_settings_required_defect_help()}</p>
                </label>
              </fieldset>

              {/* Appearance: the cover photo and the style preset are the same
                  concern, so they are one section. The preset used to hang off
                  "Report rules" as a disclosure — an appearance control filed
                  under rules, one section away from the other appearance
                  control — and the cover photo was its own fieldset with a
                  field-sized legend, so of four sections one did not look like
                  a section. DB-16: pick an existing inspection photo OR upload
                  one directly. */}
              <fieldset className="space-y-2">
                <legend className="text-[15px] font-semibold tracking-tight text-ih-fg-1">{m.editor_settings_legend_appearance()}</legend>
                <span className={`${labelClass} block pt-1`}>{m.editor_settings_legend_cover()}</span>
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
                  <p className="text-[12px] text-ih-fg-3">{m.editor_settings_cover_empty()}</p>
                ) : (
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                    {photos.map((p) => {
                      const selected = coverKey === p.key;
                      return (
                        <button
                          key={p.key}
                          type="button"
                          onClick={() => selectCover(p.key)}
                          title={selected ? m.editor_settings_cover_current() : (p.label ? m.editor_settings_cover_set_labeled({ label: p.label }) : m.editor_settings_cover_set())}
                          className={`relative aspect-square rounded-md overflow-hidden border-2 transition-colors ${selected ? "border-ih-primary" : "border-ih-border hover:border-ih-primary/60"}`}
                        >
                          <img src={p.url} alt={p.label || m.editor_settings_cover_photo_alt()} className="w-full h-full object-cover" loading="lazy" />
                          {selected && (
                            <span className="absolute inset-x-0 bottom-0 bg-ih-primary text-ih-fg-inverse text-[9px] font-bold text-center py-0.5">{m.editor_settings_cover_badge()}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
                {/* The hint sits UNDER the button, not beside it: side by side
                    in this drawer's width the button had to wrap its own label
                    onto two lines to make room for the sentence. */}
                <div className="pt-1 space-y-1">
                  <Button variant="secondary" size="sm" onClick={() => coverFileRef.current?.click()} pending={coverBusy} className="hover:border-ih-primary hover:text-ih-primary-text">
                    {coverBusy && uploadingCover ? m.editor_uploading() : m.editor_settings_cover_upload()}
                  </Button>
                  <p className="text-[11px] text-ih-fg-3">{m.editor_settings_cover_hint()}</p>
                </div>

                {/* Report Style Presets — collapsed by default (progressive
                    disclosure: the default path never touches this). */}
                <details className="pt-2">
                  <summary className="text-[12px] text-ih-fg-3 cursor-pointer select-none">{m.editor_settings_appearance_summary()}</summary>
                  <label className="block mt-3">
                    <select
                      value={form.profileOverride}
                      onChange={(e) => updateForm("profileOverride", e.target.value)}
                      className={inputClass}
                      data-testid="inspection-profile-override"
                    >
                      <option value="">{m.editor_settings_appearance_inherit()}</option>
                      {profiles.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    <p className="mt-1 text-[11px] text-ih-fg-3">{m.editor_settings_appearance_help()}</p>
                  </label>
                </details>
              </fieldset>

              {/* N2+N4 — device-local upload quality preference. Persisted to
                  localStorage (not the inspection row); applies to this browser. */}
              <fieldset className="space-y-2">
                <legend className="text-[15px] font-semibold tracking-tight text-ih-fg-1">{m.editor_settings_legend_photo_uploads()}</legend>
                <label className="inline-flex items-start gap-2 text-[13px] text-ih-fg-3">
                  <input
                    type="checkbox"
                    checked={originalQuality}
                    onChange={(e) => toggleOriginalQuality(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-ih-border-strong text-ih-primary focus:ring-ih-primary/30"
                    data-testid="original-quality-uploads"
                  />
                  <span>
                    {m.editor_settings_original_quality()}
                    <span className="block text-[11px] text-ih-fg-3">
                      {m.editor_settings_original_quality_help()}
                    </span>
                  </span>
                </label>
              </fieldset>

          </form>
        )}
      </Drawer>
      {cropSource && (
        <CoverCropper
          sourceUrl={fullResUrl(cropSource.url)}
          sourceKey={cropSource.key}
          initialCrop={
            sessionCrop?.key === cropSource.key
              ? sessionCrop.crop
              : coverCropFor(sheetInspection, cropSource.key)
          }
          onCancel={() => setCropSource(null)}
          onSave={(blob, c) => coverLatch(() => {
            const source = cropSource;
            const crop = { aspect: c.aspect, orientation: c.orientation, ...c.pixels };
            setCropSource(null);
            void runCover({
              type: "crop-cover",
              sourceKey: source.key,
              crop: JSON.stringify(crop),
              image: new File([blob], "cover.jpg", { type: "image/jpeg" }),
            }).then((result) => {
              if (!mounted.current) return;
              // Dropped because another cover write is out: the crop was not sent, so the editor goes back to it.
              if (isIgnored(result)) {
                setCropSource(source);
                return;
              }
              setSessionCrop({ key: source.key, crop });
              if (result.ok && result.data?.coverKey) setCoverKey(result.data.coverKey);
            });
          })}
        />
      )}
    </>
  );
}
