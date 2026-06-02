import { useState } from "react";
import { Form, Link, useLoaderData, useActionData } from "react-router";
import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import type { Route } from "./+types/settings-workspace";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { workspaceSchema } from "~/lib/forms/settings.schema";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Branding {
  siteName?: string | null;
  primaryColor?: string | null;
  logoUrl?: string | null;
  reportTheme?: string | null;
  customReferralSources?: string[];
}

const THEMES = ["modern", "classic", "minimal"] as const;

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });
  const res = await api.adminBranding.branding.$get({});
  const body = res.ok ? ((await res.json()) as Record<string, unknown>) : {};
  return { branding: (body.data ?? {}) as Branding };
}

/* ------------------------------------------------------------------ */
/*  Action                                                             */
/* ------------------------------------------------------------------ */

export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const fd = await request.formData();
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
  const { branding } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [color, setColor] = useState(branding.primaryColor ?? "#6366f1");

  const [form, fields] = useForm({
    lastResult: actionData && "status" in actionData ? actionData : undefined,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: workspaceSchema });
    },
    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
  });

  return (
    <div className="space-y-[18px]">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[13px] text-ih-fg-3">
        <Link to="/settings" className="hover:text-ih-primary transition-colors">Settings</Link>
        <span>&rsaquo;</span>
        <span className="text-ih-fg-1">Workspace</span>
      </div>
      <h2 className="text-[19px] font-bold text-ih-fg-1">Workspace</h2>
      <p className="text-[13px] text-ih-fg-3">Branding, report theme, and referral sources.</p>

      {/* Flash */}
      {actionData && "success" in actionData && actionData.success && (
        <div className="px-4 py-2.5 rounded-md bg-ih-ok-bg border border-ih-ok-fg/20 text-[13px] text-ih-ok-fg font-medium">
          Workspace settings saved.
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
              <label htmlFor={fields.siteName.id} className="block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">Workspace Name</label>
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
            <div className="flex flex-col sm:flex-row items-center gap-5 p-5 bg-ih-bg-muted rounded-md border border-dashed border-ih-border hover:border-ih-primary transition-colors">
              <div className="w-28 h-28 bg-ih-bg-card rounded-md border border-ih-border flex items-center justify-center overflow-hidden">
                {branding.logoUrl ? (
                  <img src={branding.logoUrl} className="w-full h-full object-contain p-3" alt="Logo" />
                ) : (
                  <div className="text-ih-fg-4">
                    <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                  </div>
                )}
              </div>
              <div className="space-y-2 flex-1 text-center sm:text-left">
                <input type="file" accept="image/*" className="block text-[11px] text-ih-fg-3" />
                <p className="text-[11px] text-ih-fg-3 font-bold uppercase tracking-widest">PNG / SVG recommended</p>
              </div>
            </div>
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
              className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none transition-all font-medium text-[13px] placeholder:text-slate-300 dark:placeholder:text-slate-500 text-ih-fg-1" />
            <p className="text-[11px] text-ih-fg-3">One label per line. Maximum 32 entries; duplicates are ignored.</p>
          </div>
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
            Save Workspace
          </button>
        </div>
      </Form>
    </div>
  );
}
