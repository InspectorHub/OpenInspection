import { useState, useEffect } from "react";
import { Form, Link, useLoaderData, useActionData, useFetcher } from "react-router";
import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import type { Route } from "./+types/settings-workspace";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { LogoUploader } from "~/components/media-studio/LogoUploader";
import { workspaceSchema } from "~/lib/forms/settings.schema";
import { requireAdminLoader } from "~/lib/access.server";
import { AccessDenied } from "~/components/AccessDenied";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Branding {
  siteName?: string | null;
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
      return { success: false, error: "No valid logo provided", intent };
    }
    const api = createApi(context, { token });
    const res = await api.adminBranding.branding.logo.$post({ form: { logo } });
    const body = (await res.json().catch(() => null)) as { data?: { logoUrl?: string } } | null;
    return { success: res.ok, intent, logoUrl: body?.data?.logoUrl ?? null };
  }

  const submission = parseWithZod(fd, { schema: workspaceSchema });
  if (submission.status !== "success") {
    return submission.reply();
  }
  const v = submission.value;

  const body: Record<string, unknown> = {};
  if (v.siteName !== undefined) body.siteName = v.siteName;
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

  const api = createApi(context, { token });
  // Body is runtime-assembled from Zod-validated form values matching UpdateBrandingSchema;
  // cast through unknown to satisfy the strict hono/client intersection type. (C-10)
  const res = await api.adminBranding.branding.$post({ json: body } as unknown as Parameters<typeof api.adminBranding.branding.$post>[0]);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return submission.reply({
      formErrors: [(err as Record<string, string>)?.message || "Save failed"],
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
      return parseWithZod(formData, { schema: workspaceSchema });
    },
    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
  });

  if ("forbidden" in data) return <AccessDenied />;

  return (
    <div className="space-y-[18px]">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[13px] text-ih-fg-3">
        <Link to="/settings" className="hover:text-ih-primary transition-colors">Settings</Link>
        <span>&rsaquo;</span>
        <span className="text-ih-fg-1">Company</span>
      </div>
      <h2 className="text-[19px] font-bold text-ih-fg-1">Company</h2>
      <p className="text-[13px] text-ih-fg-3">Branding, report theme, and referral sources.</p>

      {/* Flash */}
      {actionData && "success" in actionData && actionData.success && (
        <div className="px-4 py-2.5 rounded-md bg-ih-ok-bg border border-ih-ok-fg/20 text-[13px] text-ih-ok-fg font-medium">
          Company settings saved.
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
          <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">Branding</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-2">
              <label htmlFor={fields.siteName.id} className="block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">Company name</label>
              <input type="text" id={fields.siteName.id} name={fields.siteName.name} defaultValue={branding.siteName ?? "OpenInspection"}
                aria-invalid={fields.siteName.errors ? true : undefined}
                className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none transition-all font-medium text-[13px] text-ih-fg-1" />
              {fields.siteName.errors && (
                <p className="mt-1 text-xs text-ih-bad-fg">{fields.siteName.errors[0]}</p>
              )}
            </div>
            <div className="space-y-2">
              <label htmlFor={fields.primaryColor.id} className="block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">Primary Color</label>
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
            <label className="block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">Company Logo</label>
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

        {/* Report theme */}
        <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5">
          <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">Report Theme</h3>
          <p className="text-[12px] text-ih-fg-3">Default visual style for client-facing reports.</p>
          <div className="grid grid-cols-3 gap-3">
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
          <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">Referral Sources</h3>
          <div className="space-y-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-ih-fg-2">Built-in sources</div>
            <div className="flex flex-wrap gap-2">
              {["Realtor", "Past Client", "Google Search", "Facebook", "Yelp", "Walk-in", "Other"].map((s) => (
                <span key={s} className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-ih-bg-muted text-ih-fg-2">{s}</span>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <label htmlFor={fields.customReferralSources.id} className="block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">Custom labels</label>
            <textarea id={fields.customReferralSources.id} name={fields.customReferralSources.name} rows={6}
              defaultValue={(branding.customReferralSources ?? []).join("\n")}
              placeholder={"Magazine ad\nTrade show\nReferral partner"}
              className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none transition-all font-medium text-[13px] placeholder:text-ih-fg-4 text-ih-fg-1" />
            <p className="text-[11px] text-ih-fg-3">One label per line. Maximum 32 entries; duplicates are ignored.</p>
          </div>
        </section>

        {/* Report features */}
        <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5">
          <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">Report Features</h3>

          <label className="flex items-start gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              name="enableRepairList"
              value="on"
              defaultChecked={branding.enableRepairList ?? false}
              className="mt-0.5 h-4 w-4 rounded border-ih-border text-ih-primary"
            />
            <span>
              <span className="block text-[13px] font-bold text-ih-fg-1">Show repair list tab</span>
              <span className="block text-[12px] text-ih-fg-3 mt-0.5">
                Displays a summarised Repair List tab on the published client report.
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
              <span className="block text-[13px] font-bold text-ih-fg-1">Allow clients to build repair requests</span>
              <span className="block text-[12px] text-ih-fg-3 mt-0.5">
                Lets clients, agents, and inspectors build a shareable repair-request addendum from a published report.
              </span>
            </span>
          </label>
        </section>

        {/* Report PDF */}
        <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5">
          <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">Report PDF</h3>
          <p className="text-[12px] text-ih-fg-3">Print-layout options for downloadable report PDFs.</p>

          <div className="space-y-2">
            <label htmlFor={fields.companyAddress.id} className="block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">Company address</label>
            <input type="text" id={fields.companyAddress.id} name={fields.companyAddress.name}
              defaultValue={branding.companyAddress ?? ""}
              placeholder="123 Main St, Springfield, IL 62704"
              aria-invalid={fields.companyAddress.errors ? true : undefined}
              className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none transition-all font-medium text-[13px] placeholder:text-ih-fg-4 text-ih-fg-1" />
            <p className="text-[11px] text-ih-fg-3">Shown in the report PDF footer block.</p>
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
              <span className="block text-[13px] font-bold text-ih-fg-1">Show footer</span>
              <span className="block text-[12px] text-ih-fg-3 mt-0.5">
                Renders the company footer block at the bottom of each report PDF page.
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
              <span className="block text-[13px] font-bold text-ih-fg-1">Show page numbers</span>
              <span className="block text-[12px] text-ih-fg-3 mt-0.5">
                Adds page numbers to the report PDF.
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
              <span className="block text-[13px] font-bold text-ih-fg-1">Show inspector license</span>
              <span className="block text-[12px] text-ih-fg-3 mt-0.5">
                Includes the inspector license number on the report PDF.
              </span>
            </span>
          </label>
        </section>

        {form.errors && (
          <div className="px-4 py-2.5 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg font-medium">
            {form.errors[0]}
          </div>
        )}

        {/* Save */}
        <div className="flex justify-end">
          <button type="submit"
            className="px-4 py-2 bg-ih-primary text-white rounded-md font-bold text-[13px] hover:bg-ih-primary-600 active:scale-[.98] transition-all">
            Save Company
          </button>
        </div>
      </Form>
    </div>
  );
}
