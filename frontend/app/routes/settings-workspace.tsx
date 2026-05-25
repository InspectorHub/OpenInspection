import { useState } from "react";
import { Form, Link, useLoaderData, useActionData } from "react-router";
import type { Route } from "./+types/settings-workspace";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Branding {
  siteName?: string | null;
  primaryColor?: string | null;
  logoUrl?: string | null;
  reportTheme?: string | null;
  gaMeasurementId?: string | null;
  customReferralSources?: string[];
}

const THEMES = ["modern", "classic", "minimal"] as const;

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);
  const res = await apiFetch("/api/admin/branding", { token });
  const json = res.ok ? await res.json() : {};
  return { branding: ((json as Record<string, unknown>)?.data || {}) as Branding };
}

/* ------------------------------------------------------------------ */
/*  Action                                                             */
/* ------------------------------------------------------------------ */

export async function action({ request }: Route.ActionArgs) {
  const token = await requireToken(request);
  const fd = await request.formData();
  const body: Record<string, unknown> = {};

  for (const key of ["siteName", "primaryColor", "reportTheme", "gaMeasurementId"]) {
    const v = fd.get(key);
    if (v !== null) body[key] = v;
  }

  // Custom referral sources: one label per line
  const rawSources = fd.get("customReferralSources");
  if (typeof rawSources === "string") {
    body.customReferralSources = rawSources
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const res = await apiFetch("/api/admin/branding", {
    token,
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return { success: false, error: (err as Record<string, string>)?.message || "Save failed" };
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

  return (
    <div className="space-y-[18px]">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[13px] text-slate-500">
        <Link to="/settings" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Settings</Link>
        <span>&rsaquo;</span>
        <span className="text-slate-900 dark:text-slate-100">Workspace</span>
      </div>
      <h2 className="text-[19px] font-bold text-slate-900 dark:text-slate-100">Workspace</h2>
      <p className="text-[13px] text-slate-500">Branding, report theme, analytics, and referral sources.</p>

      {/* Flash */}
      {actionData?.success && (
        <div className="px-4 py-2.5 rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-[13px] text-emerald-700 dark:text-emerald-300 font-medium">
          Workspace settings saved.
        </div>
      )}
      {actionData?.error && (
        <div className="px-4 py-2.5 rounded-md bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 text-[13px] text-rose-700 dark:text-rose-300 font-medium">
          {actionData.error}
        </div>
      )}

      <Form method="post" className="space-y-6">
        {/* Branding */}
        <section className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6 space-y-6">
          <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.2em]">Branding</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-2">
              <label htmlFor="siteName" className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-[0.2em]">Workspace Name</label>
              <input type="text" id="siteName" name="siteName" defaultValue={branding.siteName ?? "OpenInspection"}
                className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-medium text-[13px] text-slate-900 dark:text-slate-100" />
            </div>
            <div className="space-y-2">
              <label htmlFor="primaryColor" className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-[0.2em]">Primary Color</label>
              <div className="flex gap-3">
                <input type="color" id="primaryColor" name="primaryColor" value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-10 w-16 rounded-md border border-slate-200 dark:border-slate-600 p-1 cursor-pointer bg-white dark:bg-slate-700" />
                <input type="text" readOnly value={color}
                  className="flex-1 px-3 py-2 rounded-md border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-mono text-[13px] cursor-default" />
              </div>
            </div>
          </div>

          {/* Logo upload */}
          <div className="space-y-3">
            <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-[0.2em]">Company Logo</label>
            <div className="flex flex-col sm:flex-row items-center gap-5 p-5 bg-slate-50 dark:bg-slate-700/50 rounded-md border border-dashed border-slate-200 dark:border-slate-600 hover:border-indigo-200 dark:hover:border-indigo-800 transition-colors">
              <div className="w-28 h-28 bg-white dark:bg-slate-800 rounded-md border border-slate-200 dark:border-slate-600 flex items-center justify-center overflow-hidden">
                {branding.logoUrl ? (
                  <img src={branding.logoUrl} className="w-full h-full object-contain p-3" alt="Logo" />
                ) : (
                  <div className="text-slate-300 dark:text-slate-500">
                    <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                  </div>
                )}
              </div>
              <div className="space-y-2 flex-1 text-center sm:text-left">
                <input type="file" accept="image/*" className="block text-[11px] text-slate-600 dark:text-slate-400" />
                <p className="text-[11px] text-slate-500 font-bold uppercase tracking-widest">PNG / SVG recommended</p>
              </div>
            </div>
          </div>
        </section>

        {/* Report theme */}
        <section className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6 space-y-5">
          <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.2em]">Report Theme</h3>
          <p className="text-[12px] text-slate-500">Default visual style for client-facing reports.</p>
          <div className="grid grid-cols-3 gap-3">
            {THEMES.map((t) => (
              <label key={t} className="cursor-pointer">
                <input type="radio" name="reportTheme" value={t}
                  defaultChecked={(branding.reportTheme ?? "modern") === t}
                  className="sr-only peer" />
                <div className="p-4 rounded-md border-2 text-[13px] font-bold uppercase tracking-[0.2em] capitalize transition-all text-center peer-checked:border-indigo-500 peer-checked:bg-indigo-50 peer-checked:text-indigo-700 dark:peer-checked:bg-indigo-900/20 dark:peer-checked:text-indigo-400 border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-500">
                  {t}
                </div>
              </label>
            ))}
          </div>
        </section>

        {/* Telemetry */}
        <section className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6 space-y-5">
          <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.2em]">Telemetry</h3>
          <p className="text-[12px] text-slate-500">Optional Google Analytics 4 tracking on client-facing pages. Leave blank to disable.</p>
          <div className="space-y-2 max-w-md">
            <label htmlFor="gaMeasurementId" className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-[0.2em]">GA Measurement ID</label>
            <input type="text" id="gaMeasurementId" name="gaMeasurementId"
              defaultValue={branding.gaMeasurementId ?? ""} placeholder="G-XXXXXXXXXX"
              className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-medium text-[13px] placeholder:text-slate-300 dark:placeholder:text-slate-500 text-slate-900 dark:text-slate-100" />
            <p className="text-[11px] text-slate-500">Format: <code className="font-mono">G-XXXXXXXXXX</code>.</p>
          </div>
        </section>

        {/* Referral sources */}
        <section className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6 space-y-5">
          <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.2em]">Referral Sources</h3>
          <div className="space-y-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-700 dark:text-slate-300">Built-in sources</div>
            <div className="flex flex-wrap gap-2">
              {["Realtor", "Past Client", "Google Search", "Facebook", "Yelp", "Walk-in", "Other"].map((s) => (
                <span key={s} className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300">{s}</span>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <label htmlFor="customReferralSources" className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-[0.2em]">Custom labels</label>
            <textarea id="customReferralSources" name="customReferralSources" rows={6}
              defaultValue={(branding.customReferralSources ?? []).join("\n")}
              placeholder={"Magazine ad\nTrade show\nReferral partner"}
              className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-medium text-[13px] placeholder:text-slate-300 dark:placeholder:text-slate-500 text-slate-900 dark:text-slate-100" />
            <p className="text-[11px] text-slate-500">One label per line. Maximum 32 entries; duplicates are ignored.</p>
          </div>
        </section>

        {/* Save */}
        <div className="flex justify-end">
          <button type="submit"
            className="px-4 py-2 bg-indigo-600 text-white rounded-md font-bold text-[13px] hover:bg-indigo-700 active:scale-[.98] transition-all">
            Save Workspace
          </button>
        </div>
      </Form>
    </div>
  );
}
