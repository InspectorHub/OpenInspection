import { useState } from "react";
import { Form, Link, useLoaderData, useActionData } from "react-router";
import type { Route } from "./+types/settings-profile";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Profile {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  licenseNumber?: string | null;
  slug?: string | null;
  bio?: string | null;
  photoUrl?: string | null;
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);
  const res = await apiFetch("/api/profile", { token });
  const json = res.ok ? await res.json() : {};
  return { profile: ((json as Record<string, unknown>)?.data || {}) as Profile };
}

/* ------------------------------------------------------------------ */
/*  Action                                                             */
/* ------------------------------------------------------------------ */

export async function action({ request }: Route.ActionArgs) {
  const token = await requireToken(request);
  const fd = await request.formData();
  const body: Record<string, unknown> = {};
  for (const key of ["name", "phone", "licenseNumber", "slug", "bio"]) {
    const v = fd.get(key);
    if (v !== null) body[key] = v;
  }
  const res = await apiFetch("/api/profile", {
    token,
    method: "PATCH",
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

export default function SettingsProfilePage() {
  const { profile } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [bioLen, setBioLen] = useState((profile.bio ?? "").length);

  return (
    <div className="space-y-[18px]">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[13px] text-slate-500">
        <Link to="/settings" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Settings</Link>
        <span>&rsaquo;</span>
        <span className="text-slate-900 dark:text-slate-100">Profile</span>
      </div>
      <h2 className="text-[19px] font-bold text-slate-900 dark:text-slate-100">Profile</h2>
      <p className="text-[13px] text-slate-500">Inspector identity that appears on every report you generate.</p>

      {/* Flash */}
      {actionData?.success && (
        <div className="px-4 py-2.5 rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-[13px] text-emerald-700 dark:text-emerald-300 font-medium">
          Profile saved.
        </div>
      )}
      {actionData?.error && (
        <div className="px-4 py-2.5 rounded-md bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 text-[13px] text-rose-700 dark:text-rose-300 font-medium">
          {actionData.error}
        </div>
      )}

      <Form method="post" className="space-y-6">
        {/* Identity fields */}
        <section className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className="space-y-2">
              <label htmlFor="profileName" className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-[0.2em]">Full Name</label>
              <input type="text" id="profileName" name="name" defaultValue={profile.name ?? ""}
                placeholder="John Smith"
                className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-medium text-[13px] placeholder:text-slate-300 dark:placeholder:text-slate-500 text-slate-900 dark:text-slate-100" />
              <p className="text-[11px] text-slate-500">Displayed on inspection reports.</p>
            </div>
            <div className="space-y-2">
              <label htmlFor="profilePhone" className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-[0.2em]">Phone</label>
              <input type="tel" id="profilePhone" name="phone" defaultValue={profile.phone ?? ""}
                placeholder="(555) 123-4567"
                className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-medium text-[13px] placeholder:text-slate-300 dark:placeholder:text-slate-500 text-slate-900 dark:text-slate-100" />
            </div>
            <div className="space-y-2">
              <label htmlFor="profileLicense" className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-[0.2em]">License #</label>
              <input type="text" id="profileLicense" name="licenseNumber" defaultValue={profile.licenseNumber ?? ""}
                placeholder="HI-12345"
                className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-medium text-[13px] placeholder:text-slate-300 dark:placeholder:text-slate-500 text-slate-900 dark:text-slate-100" />
              <p className="text-[11px] text-slate-500">State inspector license number.</p>
            </div>
          </div>
        </section>

        {/* Booking slug */}
        <section className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6 space-y-5">
          <header className="space-y-1">
            <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.2em]">Booking link</h3>
            <p className="text-[12px] text-slate-500">Customers visit this URL to book inspections directly with you.</p>
          </header>
          <div className="space-y-2">
            <label htmlFor="profileSlug" className="block text-[13px] font-semibold text-slate-900 dark:text-slate-100">Slug</label>
            <input type="text" id="profileSlug" name="slug" defaultValue={profile.slug ?? ""}
              placeholder="your-public-username" autoComplete="off"
              className="block w-full rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-2 text-[13px] focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-colors text-slate-900 dark:text-slate-100" />
            <p className="text-[11px] text-slate-500">Lowercase letters, numbers, and hyphens (3-32 chars).</p>
          </div>
        </section>

        {/* Photo placeholder */}
        <section className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6 space-y-5">
          <header className="space-y-1">
            <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.2em]">Public profile</h3>
            <p className="text-[12px] text-slate-500">Photo, bio, and service areas shown on your public inspector page.</p>
          </header>

          {/* Photo */}
          <div className="space-y-2">
            <label className="block text-[13px] font-semibold text-slate-900 dark:text-slate-100">Profile photo</label>
            <div className="flex items-center gap-4">
              <div className="w-24 h-24 rounded-full bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 overflow-hidden flex items-center justify-center text-slate-400 text-[11px]">
                {profile.photoUrl ? (
                  <img src={profile.photoUrl} alt="Profile" className="w-full h-full object-cover" />
                ) : (
                  <span>No photo</span>
                )}
              </div>
              <div className="space-y-2">
                <input type="file" accept="image/jpeg,image/png,image/webp" className="block text-[11px] text-slate-600 dark:text-slate-400" />
                <p className="text-[11px] text-slate-500">JPG, PNG, or WebP. Max 2 MB. Square crop renders best.</p>
              </div>
            </div>
          </div>

          {/* Bio */}
          <div className="space-y-2">
            <label htmlFor="profileBio" className="block text-[13px] font-semibold text-slate-900 dark:text-slate-100">Bio</label>
            <textarea
              id="profileBio" name="bio" rows={4} maxLength={600}
              defaultValue={profile.bio ?? ""}
              onChange={(e) => setBioLen(e.target.value.length)}
              placeholder="Tell customers a bit about your background, certifications, and inspection style."
              className="block w-full rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-2 text-[13px] focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-colors text-slate-900 dark:text-slate-100 placeholder:text-slate-300 dark:placeholder:text-slate-500"
            />
            <p className="text-[11px] text-slate-500">{bioLen} / 600</p>
          </div>

          {/* Signature pad placeholder */}
          <div className="space-y-2">
            <label className="block text-[13px] font-semibold text-slate-900 dark:text-slate-100">Signature</label>
            <div className="h-20 rounded-md border border-dashed border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/50 flex items-center justify-center text-[11px] text-slate-400">
              Signature pad - coming soon
            </div>
          </div>
        </section>

        {/* Save */}
        <div className="flex justify-end">
          <button type="submit"
            className="px-4 py-2 bg-indigo-600 text-white rounded-md font-bold text-[13px] hover:bg-indigo-700 active:scale-[.98] transition-all">
            Save Profile
          </button>
        </div>
      </Form>
    </div>
  );
}
