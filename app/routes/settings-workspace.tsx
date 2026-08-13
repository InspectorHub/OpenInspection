import { useState, useEffect, useRef } from "react";
import { Form, useLoaderData, useActionData, useFetcher, useSearchParams } from "react-router";
import { SettingsCrumb } from "~/components/SettingsCrumb";
import { BrowserTimezoneHint } from "~/components/settings/BrowserTimezoneHint";
import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import type { Route } from "./+types/settings-workspace";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { LogoUploader } from "~/components/media-studio/LogoUploader";
import { SettingsSaveBar } from "~/components/settings/SettingsSaveBar";
import { SectionNav } from "~/components/settings/SectionNav";
import { ProfilePicker } from "~/components/settings/ProfilePicker";
import { ReportStylePreview } from "~/components/settings/ReportStylePreview";
import { BrandContrastNotice } from "~/components/settings/BrandContrastNotice";
import { makeWorkspaceSchema } from "~/lib/forms/settings.schema";
import { brandingUpdateBody } from "~/lib/forms/branding-body";
import { ReportFeaturesPanel } from "~/components/settings/ReportFeaturesPanel";
import { ReferralSourcesPanel } from "~/components/settings/ReferralSourcesPanel";
import { RepairQuickPhrasesPanel } from "~/components/settings/RepairQuickPhrasesPanel";
import { ReportPdfPanel } from "~/components/settings/ReportPdfPanel";
import { requireAdminLoader } from "~/lib/access.server";
import { AccessDenied } from "~/components/AccessDenied";
import { Select } from "@core/shared-ui";
import { getBrowserTimeZone, onboardingTzPrefill } from "~/lib/timezones";
import { TIMEZONE_SELECT_OPTIONS } from "~/lib/timezone-options";
import { LOCALE_OPTIONS, CURRENCY_OPTIONS } from "~/lib/locales";
import { DateTimeFormatFields } from "~/components/settings/DateTimeFormatFields";
import { useDisplayLocale } from "~/hooks/useSessionContext";
import { m } from "~/paraglide/messages";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Branding {
  companyName?: string | null;
  /** Registered legal entity. NULL = "same as companyName" (the correct answer
   *  for a sole proprietor); the fallback itself lives in BrandingService. */
  legalName?: string | null;
  primaryColor?: string | null;
  defaultProfileId?: string | null;
  logoUrl?: string | null;
  customReferralSources?: string[];
  repairQuickPhrases?: string[] | null;
  enableRepairList?: boolean | null;
  enableCustomerRepairExport?: boolean | null;
  companyAddress?: string | null;
  pdfShowFooter?: boolean | null;
  pdfShowPageNumbers?: boolean | null;
  pdfShowLicense?: boolean | null;
  defaultTimezone?: string | null;
  defaultLocale?: string | null;
  currency?: string | null;
  dateFormat?: string | null;
  timeFormat?: string | null;
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ request, context }: Route.LoaderArgs) {
  const { forbidden, token } = await requireAdminLoader(context, request);
  if (forbidden) return { forbidden: true as const };
  const api = createApi(context, { token });
  const res = await api.adminBranding.branding.$get({});
  const body = res.ok ? ((await res.json()) as Record<string, unknown>) : {};
  // The branding GET responds { success, data: { branding: {...fields} } }, so the
  // fields live at body.data.branding — NOT body.data (that wrapper was making every
  // field read back undefined, e.g. the Report Features toggles always appeared off).
  const data = (body.data ?? {}) as Record<string, unknown>;
  return { branding: ((data.branding ?? data) ?? {}) as Branding };
}

/* ------------------------------------------------------------------ */
/*  Action                                                             */
/* ------------------------------------------------------------------ */

export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const fd = await request.formData();

  const intent = fd.get("intent") as string | null;
  if (intent === "logo-upload") {
    const logo = fd.get("logo");
    if (!(logo instanceof File) || logo.size === 0) {
      return { success: false, error: m.settings_workspace_error_no_logo(), intent };
    }
    const api = createApi(context, { token });
    const res = await api.adminBranding.branding.logo.$post({ form: { logo } });
    const body = (await res.json().catch(() => null)) as { data?: { logoUrl?: string } } | null;
    return { success: res.ok, intent, logoUrl: body?.data?.logoUrl ?? null };
  }

  const submission = parseWithZod(fd, { schema: makeWorkspaceSchema() });
  if (submission.status !== "success") {
    return submission.reply();
  }
  const body = brandingUpdateBody(submission.value);

  const api = createApi(context, { token });
  // Body is runtime-assembled from Zod-validated form values matching UpdateBrandingSchema;
  // cast through unknown to satisfy the strict hono/client intersection type. (C-10)
  const res = await api.adminBranding.branding.$post({ json: body } as unknown as Parameters<typeof api.adminBranding.branding.$post>[0]);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return submission.reply({
      formErrors: [(err as Record<string, string>)?.message || m.settings_error_save_failed()],
    });
  }
  return { success: true, error: null };
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function SettingsWorkspacePage() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  // Safe-default the branding shape so hook initializers tolerate the
  // forbidden loader branch ({ forbidden: true }) without reading missing keys.
  const branding: Branding = "forbidden" in data ? {} : data.branding;
  const [color, setColor] = useState(branding.primaryColor ?? "#6366f1");
  const [profile, setProfile] = useState(branding.defaultProfileId ?? "signature");
  const displayLocale = useDisplayLocale();

  const logoFetcher = useFetcher<{ success: boolean; intent?: string; logoUrl?: string | null }>();
  const [logoUrl, setLogoUrl] = useState<string | null>(branding.logoUrl ?? null);
  useEffect(() => {
    const d = logoFetcher.data;
    if (logoFetcher.state === "idle" && d?.intent === "logo-upload" && d.success && d.logoUrl) setLogoUrl(d.logoUrl);
  }, [logoFetcher.state, logoFetcher.data]);

  const [form, fields] = useForm({
    lastResult: actionData && "status" in actionData ? actionData : undefined,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: makeWorkspaceSchema() });
    },
    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
  });

  // Company timezone. The <select> stays uncontrolled (Conform reparses its DOM
  // value on submit); we mirror its value into state only so the browser-timezone
  // hint knows whether to show. Adopting a zone writes the DOM value (that is
  // what gets submitted) + fires a native change so Conform revalidates and the
  // detected/hint lines re-evaluate; the submitted value comes from `el.value`,
  // not a dirty flag (the save bar is always shown, not dirty-gated).
  const [searchParams] = useSearchParams();
  const tzSelectRef = useRef<HTMLSelectElement>(null);
  const [selectedTz, setSelectedTz] = useState(branding.defaultTimezone || "UTC");
  const [tzPrefilled, setTzPrefilled] = useState(false);
  const tzPrefillDone = useRef(false);
  function adoptTz(zone: string) {
    const el = tzSelectRef.current;
    if (el) {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      setter?.call(el, zone);
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    setSelectedTz(zone);
  }
  // Onboarding pre-fill (rec D): when the "Set your timezone" step deep-links
  // here (?setup=timezone) and the tenant is still on the default UTC, suggest
  // the browser-detected zone — pre-selected with the save bar prompting to
  // confirm, the way mainstream field-service tools detect the zone at setup
  // instead of defaulting silently to UTC. Runs after mount (no hydration
  // mismatch) and only once.
  useEffect(() => {
    if (tzPrefillDone.current) return;
    const zone = onboardingTzPrefill({
      isTimezoneSetup: searchParams.get("setup") === "timezone",
      storedTz: branding.defaultTimezone ?? null,
      browserTz: getBrowserTimeZone(),
    });
    if (!zone) return;
    tzPrefillDone.current = true;
    adoptTz(zone);
    setTzPrefilled(true);
    tzSelectRef.current?.closest("section")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [searchParams, branding.defaultTimezone]);

  if ("forbidden" in data) return <AccessDenied />;

  const navSections = [
    { id: "branding", label: m.settings_workspace_branding_heading() },
    { id: "timezone", label: m.settings_workspace_timezone_heading() },
    { id: "locale-currency", label: m.settings_workspace_locale_currency_heading() },
    { id: "datetime-format", label: m.settings_workspace_datetime_format_heading() },
    { id: "report-style", label: m.settings_workspace_report_style_heading() },
    { id: "referral", label: m.settings_workspace_referral_heading() },
    { id: "quick-phrases", label: m.settings_workspace_quick_phrases_heading() },
    { id: "report-features", label: m.settings_workspace_report_features_heading() },
    { id: "report-pdf", label: m.settings_workspace_report_pdf_heading() },
  ];

  return (
    <div className="space-y-ih-list">
      <SettingsCrumb items={[{ label: m.settings_crumb_settings(), href: "/settings" }, { label: m.settings_workspace_crumb() }]} />
      <p className="text-[13px] text-ih-fg-3">{m.settings_workspace_subtitle()}</p>

      <SectionNav sections={navSections} />

      {/* Flash */}
      {actionData && "success" in actionData && actionData.success && (
        <div className="px-4 py-2.5 rounded-md bg-ih-ok-bg border border-ih-ok-fg/20 text-[13px] text-ih-ok-fg font-medium">
          {m.settings_workspace_flash_saved()}
        </div>
      )}

      <Form
        method="post"
        id={form.id}
        onSubmit={form.onSubmit}
        noValidate
        className="space-y-5"
      >
        {/* Branding */}
        <section id="branding" className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-6 scroll-mt-12">
          <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_workspace_branding_heading()}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-2">
              <label htmlFor={fields.companyName.id} className="block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_workspace_company_name_label()}</label>
              <input type="text" id={fields.companyName.id} name={fields.companyName.name} defaultValue={branding.companyName ?? "OpenInspection"}
                aria-invalid={fields.companyName.errors ? true : undefined}
                className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none transition-all font-medium text-[13px] text-ih-fg-1" />
              {fields.companyName.errors && (
                <p className="mt-1 text-xs text-ih-bad-fg">{fields.companyName.errors[0]}</p>
              )}
            </div>
            <div className="space-y-2">
              {/* The placeholder showing the company name is the affordance that
                  makes "leave blank" obvious. The hint stays because it explains
                  WHERE the value comes from, which the label alone does not. */}
              <label htmlFor={fields.legalName.id} className="block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_workspace_legal_name_label()}</label>
              <input type="text" id={fields.legalName.id} name={fields.legalName.name} defaultValue={branding.legalName ?? ""}
                placeholder={branding.companyName ?? ""}
                aria-invalid={fields.legalName.errors ? true : undefined}
                className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none transition-all font-medium text-[13px] text-ih-fg-1" />
              {fields.legalName.errors && (
                <p className="mt-1 text-xs text-ih-bad-fg">{fields.legalName.errors[0]}</p>
              )}
              <p className="mt-1 text-xs text-ih-fg-3">{m.settings_workspace_legal_name_hint()}</p>
            </div>
            <div className="space-y-2">
              <label htmlFor={fields.primaryColor.id} className="block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_workspace_primary_color_label()}</label>
              <div className="flex gap-3">
                <input type="color" id={fields.primaryColor.id} name={fields.primaryColor.name} value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-10 w-16 rounded-md border border-ih-border p-1 cursor-pointer bg-ih-bg-card" />
                <input type="text" readOnly value={color}
                  className="flex-1 px-3 py-2 rounded-md border border-ih-border bg-ih-bg-muted text-ih-fg-2 font-mono text-[13px] cursor-default" />
              </div>
              {fields.primaryColor.errors && (
                <p className="mt-1 text-xs text-ih-bad-fg">{fields.primaryColor.errors[0]}</p>
              )}
              {/* #91 — the fill role keeps the tenant's exact hex, so for the
                  6.7% of sRGB where no foreground clears AA on it there is
                  nothing left to derive. Say so, with the number, and still
                  let them save it. Reads `color`, which is seeded from the
                  stored value, so the notice is live while picking AND still
                  here on the next visit. */}
              <BrandContrastNotice color={color} locale={displayLocale} />
            </div>
          </div>

          {/* Logo upload */}
          <div className="space-y-3">
            <label className="block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_workspace_logo_label()}</label>
            <LogoUploader
              currentUrl={logoUrl}
              uploading={logoFetcher.state !== "idle"}
              onSelect={(file) => {
                const fd = new FormData();
                fd.append("intent", "logo-upload");
                fd.append("logo", file);
                logoFetcher.submit(fd, { method: "POST", encType: "multipart/form-data" });
              }}
            />
          </div>
        </section>

        {/* Timezone */}
        <section id="timezone" className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-4 scroll-mt-12">
          <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_workspace_timezone_heading()}</h3>
          <p className="text-[12px] text-ih-fg-3">
            {m.settings_workspace_timezone_subtitle()}
          </p>
          <div className="max-w-md">
            <Select
              ref={tzSelectRef}
              label={m.settings_workspace_timezone_select_label()}
              name="defaultTimezone"
              defaultValue={branding.defaultTimezone ?? "UTC"}
              onChange={(e) => {
                setSelectedTz(e.target.value);
                setTzPrefilled(false);
              }}
              options={TIMEZONE_SELECT_OPTIONS}
            />
            {tzPrefilled && (
              <p className="mt-2 text-[12px] text-ih-primary-text">
                {m.settings_workspace_timezone_detected()}
              </p>
            )}
            <BrowserTimezoneHint effectiveValue={selectedTz} onUse={adoptTz} />
          </div>
        </section>

        {/* Locale & Currency */}
        <section id="locale-currency" className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-4 scroll-mt-12">
          <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_workspace_locale_currency_heading()}</h3>
          <p className="text-[12px] text-ih-fg-3">
            {m.settings_workspace_locale_currency_subtitle()}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-2xl">
            <Select
              label={m.settings_workspace_locale_select_label()}
              name="defaultLocale"
              defaultValue={branding.defaultLocale ?? "en-US"}
              options={LOCALE_OPTIONS}
            />
            <Select
              label={m.settings_workspace_currency_select_label()}
              name="currency"
              defaultValue={branding.currency ?? "USD"}
              options={CURRENCY_OPTIONS}
            />
          </div>
        </section>

        {/* Date & time format (#270) */}
        <section id="datetime-format" className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-4 scroll-mt-12">
          <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_workspace_datetime_format_heading()}</h3>
          <p className="text-[12px] text-ih-fg-3">
            {m.settings_workspace_datetime_format_subtitle()}
          </p>
          <DateTimeFormatFields
            dateLabel={m.settings_workspace_dateformat_select_label()}
            timeLabel={m.settings_workspace_timeformat_select_label()}
            dateValue={branding.dateFormat}
            timeValue={branding.timeFormat}
          />
        </section>

        {/* Report style */}
        <section id="report-style" className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5 scroll-mt-12">
          <div>
            <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_workspace_report_style_heading()}</h3>
            <p className="mt-1 text-[12px] text-ih-fg-3">{m.settings_workspace_report_style_subtitle()}</p>
          </div>
          <div className="grid gap-5 lg:grid-cols-[1fr_minmax(0,300px)] lg:items-start">
            <ProfilePicker name={fields.defaultProfileId.name} value={profile} onChange={setProfile} />
            <ReportStylePreview profileId={profile} primaryColor={color} />
          </div>
        </section>

        <ReferralSourcesPanel
          fieldId={fields.customReferralSources.id}
          fieldName={fields.customReferralSources.name}
          customReferralSources={branding.customReferralSources}
        />

        <RepairQuickPhrasesPanel
          fieldId={fields.repairQuickPhrases.id}
          fieldName={fields.repairQuickPhrases.name}
          repairQuickPhrases={branding.repairQuickPhrases}
        />

        <ReportFeaturesPanel
          enableRepairList={branding.enableRepairList}
          enableCustomerRepairExport={branding.enableCustomerRepairExport}
        />

        <ReportPdfPanel
          addressField={fields.companyAddress}
          companyAddress={branding.companyAddress}
          pdfShowFooter={branding.pdfShowFooter}
          pdfShowPageNumbers={branding.pdfShowPageNumbers}
          pdfShowLicense={branding.pdfShowLicense}
        />

        {form.errors && (
          <div className="px-4 py-2.5 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg font-medium">
            {form.errors[0]}
          </div>
        )}

        {/* Save — sticky bar pinned to the bottom of the settings scroll area */}
        <SettingsSaveBar label={m.settings_workspace_save_button()} />
      </Form>
    </div>
  );
}
