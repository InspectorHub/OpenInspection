import { useState, useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import { Drawer, Button } from "@core/shared-ui";
import { TemplateCombobox } from "~/components/TemplateCombobox";
import { CoverCropper } from "~/components/media-studio/CoverCropper";
import { fullResUrl } from "~/components/media-studio/cropImage";
import { ORIGINAL_QUALITY_KEY } from "~/routes/inspection-edit";
import { MoneyInput } from "~/components/MoneyInput";
import { m } from "~/paraglide/messages";
import { CLIENT_PROFILE_LIST } from "~/lib/report-style/profiles-client";

interface SettingsForm {
  date: string;
  closingDate: string;
  inspectorId: string;
  referenceNumber: string;
  referralSource: string;
  templateId: string;
  price: number;
  paymentRequired: boolean;
  agreementRequired: boolean;
  /** Track H (IA-7) — per-inspection override of the tenant-wide required
   *  defect fields; '' = inherit (stored as NULL). */
  requireDefectFieldsOverride: "" | "none" | "location" | "trade" | "both";
  /** Report Style Presets — per-inspection appearance profile; '' = inherit
   *  (template default -> company default), stored as NULL. */
  profileOverride: "" | "signature" | "meridian" | "terra";
}

interface Inspector {
  id: string;
  name: string;
  email: string;
}

interface Template {
  id: string;
  name: string;
}

interface InspectionSettingsSheetProps {
  open: boolean;
  onClose: () => void;
  inspectionId: string;
  referralSources?: string[];
  /** Called after a successful save where the template selection changed. */
  onTemplateApplied?: () => void;
}

type SaveState = "idle" | "saving" | "saved" | "error";

export function InspectionSettingsSheet({ open, onClose, inspectionId, referralSources = [], onTemplateApplied }: InspectionSettingsSheetProps) {
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [inspectors, setInspectors] = useState<Inspector[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [form, setForm] = useState<SettingsForm>({
    date: "",
    closingDate: "",
    inspectorId: "",
    referenceNumber: "",
    referralSource: "",
    templateId: "",
    price: 0,
    paymentRequired: false,
    agreementRequired: false,
    requireDefectFieldsOverride: "",
    profileOverride: "",
  });
  // Tracks the templateId that was loaded when the sheet opened, so we can
  // detect whether the user changed it before saving.
  const templateIdAtOpen = useRef<string>("");
  // B-22 follow-up (C-12): saves go through the inspection-edit route action
  // ("save-settings" intent) on a DEDICATED fetcher — the old raw client-side
  // fetch('/api/inspections/:id', PATCH) could never pass requireCsrfToken, so
  // every save silently 401/403'd. A dedicated fetcher (not shared) avoids the
  // B-17 shared-fetcher abort hazard. templateChanged is captured at submit so
  // the response effect knows whether to fire onTemplateApplied.
  const saveFetcher = useFetcher<{ ok: boolean; intent?: string }>();
  const templateChangedAtSubmit = useRef(false);

  type CoverPhoto = { key: string; url: string; label: string };
  type SheetData = {
    inspection: Record<string, unknown> | null;
    templates: Template[];
    members: Array<{ id: string; email: string }>;
    photos: CoverPhoto[];
  };
  const loadFetcher = useFetcher<SheetData>();
  // DB-16 — report cover picker. `photos` are all of the inspection's photos;
  // `coverKey` is the chosen cover R2 key (optimistic; PATCHed via coverFetcher).
  const [photos, setPhotos] = useState<CoverPhoto[]>([]);
  const [coverKey, setCoverKey] = useState<string>("");
  const coverFetcher = useFetcher<{ ok: boolean; intent?: string; coverKey?: string | null; coverUrl?: string | null }>();
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

  // Trigger load when the sheet opens or inspectionId changes; mark loading so
  // the skeleton shows until the loader data lands.
  useEffect(() => {
    if (open) setLoading(true);
    if (open && inspectionId) {
      loadFetcher.load(`/resources/inspection-settings-sheet?inspectionId=${encodeURIComponent(inspectionId)}`);
    }
  }, [open, inspectionId]);

  // Apply fetched data to local state (mirrors old load() behaviour)
  useEffect(() => {
    const d = loadFetcher.data;
    if (!d) return;
    const insp = d.inspection;
    if (insp) {
      const loadedTemplateId = (insp.templateId as string) || "";
      templateIdAtOpen.current = loadedTemplateId;
      setForm({
        date: ((insp.date as string) || "").replace(/T.*/, ''),
        closingDate: ((insp.closingDate as string) || "").replace(/T.*/, ''),
        inspectorId: (insp.inspectorId as string) || "",
        referenceNumber: (insp.referenceNumber as string) || "",
        referralSource: (insp.referralSource as string) || "",
        templateId: loadedTemplateId,
        price: (insp.price as number) || 0,
        paymentRequired: !!insp.paymentRequired,
        agreementRequired: !!insp.agreementRequired,
        requireDefectFieldsOverride: (insp.requireDefectFieldsOverride as SettingsForm["requireDefectFieldsOverride"]) || "",
        profileOverride: (insp.profileOverride as SettingsForm["profileOverride"]) || "",
      });
    }
    setTemplates(d.templates ?? []);
    setInspectors((d.members ?? []) as Inspector[]);
    setPhotos(d.photos ?? []);
    // Cover key lives on the inspection row; the detail API exposes it as
    // `coverPhotoId` (raw) or `coverPhoto` (formatted) — read either.
    setCoverKey(((insp?.coverPhotoId ?? insp?.coverPhoto) as string | null) ?? "");
    setLoading(false);
  }, [loadFetcher.data]);

  function selectCover(key: string) {
    if (coverKey === key) {
      setCoverKey("");
      coverFetcher.submit({ intent: "set-cover", coverPhotoId: "" }, { method: "post" });
      return;
    }
    const photo = photos.find((p) => p.key === key);
    if (photo) setCropSource({ key, url: photo.url });
  }

  // DB-16 — direct cover upload (Spectora parity). The file rides the BFF relay
  // via the editor route's `upload-cover` intent (pool upload + set cover).
  function uploadCover(file: File) {
    const fd = new FormData();
    fd.append("intent", "upload-cover");
    fd.append("file", file);
    coverFetcher.submit(fd, { method: "post", encType: "multipart/form-data" });
  }

  // When an upload-cover round-trip succeeds, append the new photo to the grid
  // and select it as cover — all in LOCAL state. We deliberately do NOT reload
  // the sheet loader here (that would flicker the entire settings sheet).
  useEffect(() => {
    const d = coverFetcher.data;
    if (coverFetcher.state !== "idle" || !d?.ok || !d.coverKey) return;
    if (d.intent === "upload-cover") {
      const key = d.coverKey;
      const url = d.coverUrl ?? null;
      if (url) {
        setPhotos((prev) => (prev.some((p) => p.key === key) ? prev : [{ key, url, label: m.editor_settings_cover_uploaded_label() }, ...prev]));
        setCropSource({ key, url });
      }
    }
    if (d.intent === "crop-cover") {
      setCoverKey(d.coverKey);
    }
  }, [coverFetcher.state, coverFetcher.data]);

  // Sync loading state with fetcher
  useEffect(() => {
    if (loadFetcher.state !== "idle") setLoading(true);
  }, [loadFetcher.state]);

  // Drive saveState from the dedicated fetcher's lifecycle. submitting → saving;
  // response ok → saved (+ onTemplateApplied if the template changed); not ok →
  // error. B-17 lesson: "idle" alone is not "saved" — gate on the action's ok.
  useEffect(() => {
    if (saveFetcher.state !== "idle") {
      setSaveState("saving");
      return;
    }
    const data = saveFetcher.data;
    if (!data || data.intent !== "save-settings") return;
    if (data.ok) {
      setSaveState("saved");
      if (templateChangedAtSubmit.current) onTemplateApplied?.();
      templateChangedAtSubmit.current = false;
      const timer = setTimeout(() => setSaveState("idle"), 2000);
      return () => clearTimeout(timer);
    }
    setSaveState("error");
  }, [saveFetcher.state, saveFetcher.data, onTemplateApplied]);

  function updateForm<K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave(e: React.FormEvent) {
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
    saveFetcher.submit(
      { intent: "save-settings", payload: JSON.stringify(payload) },
      { method: "post" },
    );
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
        footer={loading ? undefined : (
          <>
            {saveState === "saving" && <span className="text-[12px] text-ih-watch-fg font-bold self-center">{m.editor_header_save_saving()}</span>}
            {saveState === "saved" && <span className="text-[12px] text-ih-ok-fg font-bold self-center">{m.editor_header_save_saved()}</span>}
            {saveState === "error" && <span className="text-[12px] text-ih-bad-fg font-bold self-center">{m.editor_settings_save_error()}</span>}
            <Button variant="primary" type="submit" form="inspection-settings-form" disabled={saveState === "saving"}>
              {m.editor_settings_save_changes()}
            </Button>
          </>
        )}
      >
        {loading ? (
          <div className="space-y-2 py-4" aria-busy="true">
            <div className="h-4 bg-ih-bg-muted rounded animate-pulse" style={{ width: "50%" }} />
            <div className="h-4 bg-ih-bg-muted rounded animate-pulse" style={{ width: "75%" }} />
          </div>
        ) : (
          <form id="inspection-settings-form" onSubmit={handleSave} className="space-y-6">
              <fieldset className="space-y-4">
                <legend className="text-[15px] font-semibold tracking-tight text-ih-fg-1">{m.editor_settings_legend_schedule()}</legend>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="block">
                    <span className={labelClass}>{m.editor_settings_field_date()}</span>
                    <input type="date" value={form.date} onChange={(e) => updateForm("date", e.target.value)} className={inputClass} />
                  </label>
                  <label className="block">
                    <span className={labelClass}>{m.editor_settings_field_inspector()}</span>
                    <select value={form.inspectorId} onChange={(e) => updateForm("inspectorId", e.target.value)} className={inputClass}>
                      <option value="">{m.editor_settings_inspector_unassigned()}</option>
                      {inspectors.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
                    </select>
                  </label>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="block">
                    <span className={labelClass}>{m.editor_settings_field_closing_date()}</span>
                    <input type="date" value={form.closingDate} onChange={(e) => updateForm("closingDate", e.target.value)} className={inputClass} data-testid="inspection-closing-date" />
                  </label>
                </div>
              </fieldset>

              <fieldset className="space-y-4">
                <legend className="text-[15px] font-semibold tracking-tight text-ih-fg-1">{m.editor_settings_legend_order_referral()}</legend>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="block">
                    <span className={labelClass}>{m.editor_settings_field_reference()}</span>
                    <input type="text" maxLength={64} placeholder="---" value={form.referenceNumber} onChange={(e) => updateForm("referenceNumber", e.target.value)} className={inputClass} data-testid="inspection-reference-number" />
                  </label>
                  <label className="block">
                    <span className={labelClass}>{m.editor_settings_field_referral_source()}</span>
                    <select value={form.referralSource} onChange={(e) => updateForm("referralSource", e.target.value)} className={inputClass} data-testid="inspection-referral-source">
                      <option value="">{m.editor_settings_referral_select()}</option>
                      {referralSources.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                </div>
              </fieldset>

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
                <legend className="text-[15px] font-semibold tracking-tight text-ih-fg-1">{m.editor_settings_legend_pricing()}</legend>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="block">
                    <span className={labelClass}>{m.editor_settings_field_price()}</span>
                    <MoneyInput cents={form.price} onChange={(c) => updateForm("price", c ?? 0)} className={inputClass} ariaLabel={m.editor_settings_field_price()} />
                  </label>
                  <div className="flex flex-col gap-2 pt-5">
                    <label className="inline-flex items-center gap-2 text-[13px] text-ih-fg-3">
                      <input type="checkbox" checked={form.paymentRequired} onChange={(e) => updateForm("paymentRequired", e.target.checked)} className="h-4 w-4 rounded border-ih-border-strong text-ih-primary focus:ring-ih-primary/30" />
                      {m.editor_settings_payment_required()}
                    </label>
                    <label className="inline-flex items-center gap-2 text-[13px] text-ih-fg-3">
                      <input type="checkbox" checked={form.agreementRequired} onChange={(e) => updateForm("agreementRequired", e.target.checked)} className="h-4 w-4 rounded border-ih-border-strong text-ih-primary focus:ring-ih-primary/30" />
                      {m.editor_settings_agreement_required()}
                    </label>
                  </div>
                </div>
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
                  <p className="mt-1 text-[11px] text-ih-fg-4">{m.editor_settings_required_defect_help()}</p>
                </label>
                {/* Report Style Presets — per-inspection appearance override,
                    collapsed by default (progressive disclosure: the default
                    path never touches this). */}
                <details className="mt-1">
                  <summary className="text-[12px] text-ih-fg-3 cursor-pointer select-none">{m.editor_settings_appearance_summary()}</summary>
                  <label className="block mt-3">
                    <select
                      value={form.profileOverride}
                      onChange={(e) => updateForm("profileOverride", e.target.value as SettingsForm["profileOverride"])}
                      className={inputClass}
                      data-testid="inspection-profile-override"
                    >
                      <option value="">{m.editor_settings_appearance_inherit()}</option>
                      {CLIENT_PROFILE_LIST.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    <p className="mt-1 text-[11px] text-ih-fg-4">{m.editor_settings_appearance_help()}</p>
                  </label>
                </details>
              </fieldset>

              {/* DB-16 — report cover photo: pick an existing inspection photo OR upload one directly */}
              <fieldset className="space-y-2">
                <legend className={labelClass}>{m.editor_settings_legend_cover()}</legend>
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
                  <p className="text-[12px] text-ih-fg-4">{m.editor_settings_cover_empty()}</p>
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
                            <span className="absolute inset-x-0 bottom-0 bg-ih-primary text-white text-[9px] font-bold text-center py-0.5">{m.editor_settings_cover_badge()}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="flex items-center gap-3 pt-1">
                  <Button variant="secondary" size="sm" onClick={() => coverFileRef.current?.click()} disabled={coverFetcher.state !== "idle"} className="hover:border-ih-primary hover:text-ih-primary">
                    {coverFetcher.state !== "idle" && coverFetcher.formData?.get("intent") === "upload-cover" ? m.editor_uploading() : m.editor_settings_cover_upload()}
                  </Button>
                  <span className="text-[11px] text-ih-fg-4">{m.editor_settings_cover_hint()}</span>
                </div>
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
                    <span className="block text-[11px] text-ih-fg-4">
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
          onCancel={() => setCropSource(null)}
          onSave={(blob, c) => {
            const fd = new FormData();
            fd.append("intent", "crop-cover");
            fd.append("sourceKey", cropSource.key);
            fd.append("crop", JSON.stringify({ aspect: c.aspect, orientation: c.orientation, ...c.pixels }));
            fd.append("image", new File([blob], "cover.jpg", { type: "image/jpeg" }));
            coverFetcher.submit(fd, { method: "post", encType: "multipart/form-data" });
            setCropSource(null);
          }}
        />
      )}
    </>
  );
}
