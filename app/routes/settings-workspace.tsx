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
import { makeWorkspaceSchema } from "~/lib/forms/settings.schema";
import { requireAdminLoader } from "~/lib/access.server";
import { AccessDenied } from "~/components/AccessDenied";
import { Select } from "@core/shared-ui";
import { TIMEZONE_SELECT_OPTIONS, getBrowserTimeZone, onboardingTzPrefill } from "~/lib/timezones";
import { LOCALE_OPTIONS, CURRENCY_OPTIONS } from "~/lib/locales";
import { m } from "~/paraglide/messages";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Branding {
  companyName?: string | null;
  primaryColor?: string | null;
  logoUrl?: string | null;
  reportTheme?: string | null;
  customReferralSources?: string[];
  enableRepairList?: boolean | null;
  enableCustomerRepairExport?: boolean | null;
  companyAddress?: string | null;
  pdfShowFooter?: boolean | null;
  pdfShowPageNumbers?: boolean | null;
  pdfShowLicense?: boolean | null;
  defaultTimezone?: string | null;
  defaultLocale?: string | null;
  currency?: string | null;
}

const THEMES = ["modern", "classic", "minimal"] as const;

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
  const v = submission.value;

  const body: Record<string, unknown> = {};
  if (v.companyName !== undefined) body.companyName = v.companyName;
  if (v.primaryColor !== undefined) body.primaryColor = v.primaryColor;
  if (v.reportTheme !== undefined) body.reportTheme = v.reportTheme;

  // Custom referral sources: one label per line
  if (typeof v.customReferralSources === "string") {
    body.customReferralSources = v.customReferralSources
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // Boolean feature flags — conform-native checkboxes coerce to boolean in
  // submission.value (checked → true, absent → undefined). Always send an explicit
  // boolean so unchecking persists false.
  body.enableRepairList = v.enableRepairList ?? false;
  body.enableCustomerRepairExport = v.enableCustomerRepairExport ?? false;

  // Report PDF settings. companyAddress is free text (trim; empty string clears).
  // The three toggles are conform-native checkboxes — absent (unchecked) must
  // persist false, so coerce with `?? false` (the same pattern as the flags above).
  if (typeof v.companyAddress === "string") body.companyAddress = v.companyAddress.trim();
  body.pdfShowFooter = v.pdfShowFooter ?? false;
  body.pdfShowPageNumbers = v.pdfShowPageNumbers ?? false;
  body.pdfShowLicense = v.pdfShowLicense ?? false;

  // Tenant display timezone (IANA). Only sent when a value is present.
  if (typeof v.defaultTimezone === "string" && v.defaultTimezone) body.defaultTimezone = v.defaultTimezone;
  // Tenant display locale (BCP-47) + currency (ISO 4217). Only sent when present.
  if (typeof v.defaultLocale === "string" && v.defaultLocale) body.defaultLocale = v.defaultLocale;
  if (typeof v.currency === "string" && v.currency) body.currency = v.currency;

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

  return (
    <div className="space-y-ih-list">
      <SettingsCrumb items={[{ label: m.settings_crumb_settings(), href: "/settings" }, { label: m.settings_workspace_crumb() }]} />
      <p className="text-[13px] text-ih-fg-3">{m.settings_workspace_subtitle()}</p>

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
        <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-6">
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
              <label htmlFor={fields.primaryColor.id} className="block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_workspace_primary_color_label()}</label>
              <div className="flex gap-3">
                <input type="color" id={fields.primaryColor.id} name={fields.primaryColor.name} value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-10 w-16 rounded-md border border-ih-border p-1 cursor-pointer bg-ih-bg-card" />
                <input type="text" readOnly value={color}
                  className="flex-1 px-3 py-2 rounded-md border border-ih-border bg-ih-bg-muted text-ih-fg-3 font-mono text-[13px] cursor-default" />
              </div>
              {fields.primaryColor.errors && (
                <p className="mt-1 text-xs text-ih-bad-fg">{fields.primaryColor.errors[0]}</p>
              )}
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
        <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-4">
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
              <p className="mt-2 text-[12px] text-ih-primary">
                {m.settings_workspace_timezone_detected()}
              </p>
            )}
            <BrowserTimezoneHint effectiveValue={selectedTz} onUse={adoptTz} />
          </div>
        </section>

        {/* Locale & Currency */}
        <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-4">
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

        {/* Report theme */}
        <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5">
          <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_workspace_report_theme_heading()}</h3>
          <p className="text-[12px] text-ih-fg-3">{m.settings_workspace_report_theme_subtitle()}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {THEMES.map((t) => (
              <label key={t} className="cursor-pointer">
                <input type="radio" name={fields.reportTheme.name} value={t}
                  defaultChecked={(branding.reportTheme ?? "modern") === t}
                  className="sr-only peer" />
                <div className="p-4 rounded-md border-2 text-[13px] font-bold uppercase tracking-[0.2em] capitalize transition-all text-center peer-checked:border-ih-primary peer-checked:bg-ih-primary-tint peer-checked:text-ih-primary border-ih-border bg-ih-bg-card text-ih-fg-2 hover:border-ih-border">
                  {t}
                </div>
              </label>
            ))}
          </div>
        </section>

        {/* Referral sources */}
        <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5">
          <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_workspace_referral_heading()}</h3>
          <div className="space-y-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-ih-fg-2">{m.settings_workspace_referral_builtin_label()}</div>
            <div className="flex flex-wrap gap-2">
              {["Realtor", "Past Client", "Google Search", "Facebook", "Yelp", "Walk-in", "Other"].map((s) => (
                <span key={s} className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-ih-bg-muted text-ih-fg-2">{s}</span>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <label htmlFor={fields.customReferralSources.id} className="block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_workspace_referral_custom_label()}</label>
            <textarea id={fields.customReferralSources.id} name={fields.customReferralSources.name} rows={6}
              defaultValue={(branding.customReferralSources ?? []).join("\n")}
              placeholder={m.settings_workspace_referral_custom_placeholder()}
              className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none transition-all font-medium text-[13px] placeholder:text-ih-fg-4 text-ih-fg-1" />
            <p className="text-[11px] text-ih-fg-3">{m.settings_workspace_referral_custom_hint()}</p>
          </div>
        </section>

        {/* Report features */}
        <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5">
          <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_workspace_report_features_heading()}</h3>

          <label className="flex items-start gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              name="enableRepairList"
              value="on"
              defaultChecked={branding.enableRepairList ?? false}
              className="mt-0.5 h-4 w-4 rounded border-ih-border text-ih-primary"
            />
            <span>
              <span className="block text-[13px] font-bold text-ih-fg-1">{m.settings_workspace_repair_list_title()}</span>
              <span className="block text-[12px] text-ih-fg-3 mt-0.5">
                {m.settings_workspace_repair_list_desc()}
              </span>
            </span>
          </label>

          <label className="flex items-start gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              name="enableCustomerRepairExport"
              value="on"
              defaultChecked={branding.enableCustomerRepairExport ?? false}
              className="mt-0.5 h-4 w-4 rounded border-ih-border text-ih-primary"
            />
            <span>
              <span className="block text-[13px] font-bold text-ih-fg-1">{m.settings_workspace_repair_export_title()}</span>
              <span className="block text-[12px] text-ih-fg-3 mt-0.5">
                {m.settings_workspace_repair_export_desc()}
              </span>
            </span>
          </label>
        </section>

        {/* Report PDF */}
        <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5">
          <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_workspace_report_pdf_heading()}</h3>
          <p className="text-[12px] text-ih-fg-3">{m.settings_workspace_report_pdf_subtitle()}</p>

          <div className="space-y-2">
            <label htmlFor={fields.companyAddress.id} className="block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_workspace_company_address_label()}</label>
            <input type="text" id={fields.companyAddress.id} name={fields.companyAddress.name}
              defaultValue={branding.companyAddress ?? ""}
              placeholder={m.settings_workspace_company_address_placeholder()}
              aria-invalid={fields.companyAddress.errors ? true : undefined}
              className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none transition-all font-medium text-[13px] placeholder:text-ih-fg-4 text-ih-fg-1" />
            <p className="text-[11px] text-ih-fg-3">{m.settings_workspace_company_address_hint()}</p>
            {fields.companyAddress.errors && (
              <p className="mt-1 text-xs text-ih-bad-fg">{fields.companyAddress.errors[0]}</p>
            )}
          </div>

          <label className="flex items-start gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              name="pdfShowFooter"
              value="on"
              defaultChecked={branding.pdfShowFooter ?? true}
              className="mt-0.5 h-4 w-4 rounded border-ih-border text-ih-primary"
            />
            <span>
              <span className="block text-[13px] font-bold text-ih-fg-1">{m.settings_workspace_pdf_footer_title()}</span>
              <span className="block text-[12px] text-ih-fg-3 mt-0.5">
                {m.settings_workspace_pdf_footer_desc()}
              </span>
            </span>
          </label>

          <label className="flex items-start gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              name="pdfShowPageNumbers"
              value="on"
              defaultChecked={branding.pdfShowPageNumbers ?? true}
              className="mt-0.5 h-4 w-4 rounded border-ih-border text-ih-primary"
            />
            <span>
              <span className="block text-[13px] font-bold text-ih-fg-1">{m.settings_workspace_pdf_page_numbers_title()}</span>
              <span className="block text-[12px] text-ih-fg-3 mt-0.5">
                {m.settings_workspace_pdf_page_numbers_desc()}
              </span>
            </span>
          </label>

          <label className="flex items-start gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              name="pdfShowLicense"
              value="on"
              defaultChecked={branding.pdfShowLicense ?? true}
              className="mt-0.5 h-4 w-4 rounded border-ih-border text-ih-primary"
            />
            <span>
              <span className="block text-[13px] font-bold text-ih-fg-1">{m.settings_workspace_pdf_license_title()}</span>
              <span className="block text-[12px] text-ih-fg-3 mt-0.5">
                {m.settings_workspace_pdf_license_desc()}
              </span>
            </span>
          </label>
        </section>

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
