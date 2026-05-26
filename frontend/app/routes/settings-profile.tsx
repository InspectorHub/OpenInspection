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
  const body = res.ok ? ((await res.json()) as Record<string, unknown>) : {};
  return { profile: (body.data ?? {}) as Profile };
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
      <div className="flex items-center gap-2 text-[13px] text-ih-fg-3">
        <Link to="/settings" className="hover:text-ih-primary transition-colors">Settings</Link>
        <span>&rsaquo;</span>
        <span className="text-ih-fg-1">Profile</span>
      </div>
      <h2 className="text-[19px] font-bold text-ih-fg-1">Profile</h2>
      <p className="text-[13px] text-ih-fg-3">Inspector identity that appears on every report you generate.</p>

      {/* Flash */}
      {actionData?.success && (
        <div className="px-4 py-2.5 rounded-md bg-ih-ok-bg border border-ih-ok-fg/20 text-[13px] text-ih-ok-fg font-medium">
          Profile saved.
        </div>
      )}
      {actionData?.error && (
        <div className="px-4 py-2.5 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg font-medium">
          {actionData.error}
        </div>
      )}

      <Form method="post" className="space-y-5">
        {/* Identity fields */}
        <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className="space-y-2">
              <label htmlFor="profileName" className="block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">Full Name</label>
              <input type="text" id="profileName" name="name" defaultValue={profile.name ?? ""}
                placeholder="John Smith"
                className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none transition-all font-medium text-[13px] placeholder:text-slate-300 dark:placeholder:text-slate-500 text-ih-fg-1" />
              <p className="text-[11px] text-ih-fg-3">Displayed on inspection reports.</p>
            </div>
            <div className="space-y-2">
              <label htmlFor="profilePhone" className="block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">Phone</label>
              <input type="tel" id="profilePhone" name="phone" defaultValue={profile.phone ?? ""}
                placeholder="(555) 123-4567"
                className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none transition-all font-medium text-[13px] placeholder:text-slate-300 dark:placeholder:text-slate-500 text-ih-fg-1" />
            </div>
            <div className="space-y-2">
              <label htmlFor="profileLicense" className="block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">License #</label>
              <input type="text" id="profileLicense" name="licenseNumber" defaultValue={profile.licenseNumber ?? ""}
                placeholder="HI-12345"
                className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none transition-all font-medium text-[13px] placeholder:text-slate-300 dark:placeholder:text-slate-500 text-ih-fg-1" />
              <p className="text-[11px] text-ih-fg-3">State inspector license number.</p>
            </div>
          </div>
        </section>

        {/* Booking slug */}
        <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5">
          <header className="space-y-1">
            <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">Booking link</h3>
            <p className="text-[12px] text-ih-fg-3">Customers visit this URL to book inspections directly with you.</p>
          </header>
          <div className="space-y-2">
            <label htmlFor="profileSlug" className="block text-[13px] font-semibold text-ih-fg-1">Slug</label>
            <input type="text" id="profileSlug" name="slug" defaultValue={profile.slug ?? ""}
              placeholder="your-public-username" autoComplete="off"
              className="block w-full rounded-md border border-ih-border bg-ih-bg-card px-3 py-2 text-[13px] focus:border-ih-primary focus:shadow-ih-focus outline-none transition-colors text-ih-fg-1" />
            <p className="text-[11px] text-ih-fg-3">Lowercase letters, numbers, and hyphens (3-32 chars).</p>
          </div>
        </section>

        {/* Photo placeholder */}
        <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5">
          <header className="space-y-1">
            <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">Public profile</h3>
            <p className="text-[12px] text-ih-fg-3">Photo, bio, and service areas shown on your public inspector page.</p>
          </header>

          {/* Photo */}
          <div className="space-y-2">
            <label className="block text-[13px] font-semibold text-ih-fg-1">Profile photo</label>
            <div className="flex items-center gap-4">
              <div className="w-24 h-24 rounded-full bg-ih-bg-muted border border-ih-border overflow-hidden flex items-center justify-center text-ih-fg-4 text-[11px]">
                {profile.photoUrl ? (
                  <img src={profile.photoUrl} alt="Profile" className="w-full h-full object-cover" />
                ) : (
                  <span>No photo</span>
                )}
              </div>
              <div className="space-y-2">
                <input type="file" accept="image/jpeg,image/png,image/webp" className="block text-[11px] text-ih-fg-3" />
                <p className="text-[11px] text-ih-fg-3">JPG, PNG, or WebP. Max 2 MB. Square crop renders best.</p>
              </div>
            </div>
          </div>

          {/* Bio */}
          <div className="space-y-2">
            <label htmlFor="profileBio" className="block text-[13px] font-semibold text-ih-fg-1">Bio</label>
            <textarea
              id="profileBio" name="bio" rows={4} maxLength={600}
              defaultValue={profile.bio ?? ""}
              onChange={(e) => setBioLen(e.target.value.length)}
              placeholder="Tell customers a bit about your background, certifications, and inspection style."
              className="block w-full rounded-md border border-ih-border bg-ih-bg-card px-3 py-2 text-[13px] focus:border-ih-primary focus:shadow-ih-focus outline-none transition-colors text-ih-fg-1 placeholder:text-slate-300 dark:placeholder:text-slate-500"
            />
            <p className="text-[11px] text-ih-fg-3">{bioLen} / 600</p>
          </div>

          {/* Signature pad placeholder */}
          <div className="space-y-2">
            <label className="block text-[13px] font-semibold text-ih-fg-1">Signature</label>
            <div className="h-20 rounded-md border border-dashed border-ih-border bg-ih-bg-muted flex items-center justify-center text-[11px] text-ih-fg-4">
              Signature pad - coming soon
            </div>
          </div>
        </section>

        {/* Save */}
        <div className="flex justify-end">
          <button type="submit"
            className="px-4 py-2 bg-ih-primary text-white rounded-md font-bold text-[13px] hover:bg-ih-primary-600 active:scale-[.98] transition-all">
            Save Profile
          </button>
        </div>
      </Form>
    </div>
  );
}
