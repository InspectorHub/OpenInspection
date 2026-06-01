import { useState } from "react";
import { Form, Link, useLoaderData, useActionData, useFetcher } from "react-router";
import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import type { Route } from "./+types/settings-profile";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { useSessionContext } from "~/hooks/useSessionContext";
import { SignaturePad } from "~/components/SignaturePad";
import { profileSchema } from "~/lib/forms/settings.schema";

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

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });
  const res = await api.profile.index.$get();
  const body = res.ok ? ((await res.json()) as Record<string, unknown>) : {};
  return { profile: (body.data ?? {}) as Profile };
}

/* ------------------------------------------------------------------ */
/*  Action                                                             */
/* ------------------------------------------------------------------ */

export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });
  const fd = await request.formData();
  const intent = fd.get("intent") as string | null;

  // Handle save-signature intent from the SignaturePad fetcher
  if (intent === "save-signature") {
    const signatureBase64 = fd.get("signatureBase64") as string | null;
    if (!signatureBase64) {
      return { success: false, error: "No signature data provided", intent };
    }
    // TODO(C-10 collapse): hono/client collapses api.users.me so .signature is not
    // accessible; localized assertion until the typed-hono spike resolves it. Binding preserved.
    const usersClient = api.users as unknown as { me: { signature: { $post: (args: { json: { signatureBase64: string } }) => Promise<Response> } } };
    const res = await usersClient.me.signature.$post({
      json: { signatureBase64 },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { success: false, error: (err as Record<string, string>)?.message || "Save failed", intent };
    }
    return { success: true, error: null, intent };
  }

  // Default: save profile fields
  const submission = parseWithZod(fd, { schema: profileSchema });
  if (submission.status !== "success") {
    return submission.reply();
  }
  const v = submission.value;
  const body: Record<string, unknown> = {};
  for (const key of ["name", "phone", "licenseNumber", "slug", "bio"] as const) {
    if (v[key] !== undefined) body[key] = v[key];
  }
  const res = await api.profile.index.$patch({ json: body });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return submission.reply({
      formErrors: [(err as Record<string, string>)?.message || "Save failed"],
    });
  }
  return { success: true, error: null, intent };
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function SettingsProfilePage() {
  const { profile } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [bioLen, setBioLen] = useState((profile.bio ?? "").length);
  const ctx = useSessionContext();
  const tenant = ctx?.branding?.tenantSubdomain;

  // Conform owns the main profile form (default intent). The save-signature
  // intent is handled by a separate useFetcher below, so guard against feeding
  // a non-Conform actionData into useForm.
  const [form, fields] = useForm({
    lastResult: actionData && "status" in actionData ? actionData : undefined,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: profileSchema });
    },
    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
  });

  // Conform narrowing helpers (cat-7): actionData may be SubmissionResult or {success,error,...}
  const flashSuccess = actionData && "success" in actionData && actionData.success;
  const flashError = actionData && "error" in actionData && typeof actionData.error === "string" ? actionData.error : null;

  // Signature pad state
  const sigFetcher = useFetcher<typeof action>();
  const [showSigPad, setShowSigPad] = useState(false);
  const sigSaved = sigFetcher.data && "success" in sigFetcher.data && sigFetcher.data.success
    && "intent" in sigFetcher.data && sigFetcher.data.intent === "save-signature";
  const sigError = sigFetcher.data && "error" in sigFetcher.data
    && typeof sigFetcher.data.error === "string" && sigFetcher.data.error
    && "intent" in sigFetcher.data && sigFetcher.data.intent === "save-signature"
    ? (sigFetcher.data.error as string) : null;

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
      {flashSuccess && (
        <div className="px-4 py-2.5 rounded-md bg-ih-ok-bg border border-ih-ok-fg/20 text-[13px] text-ih-ok-fg font-medium">
          Profile saved.
        </div>
      )}
      {flashError ? (
        <div className="px-4 py-2.5 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg font-medium">
          {flashError}
        </div>
      ) : null}

      <Form
        method="post"
        id={form.id}
        onSubmit={form.onSubmit}
        noValidate
        className="space-y-5"
      >
        {/* Identity fields */}
        <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className="space-y-2">
              <label htmlFor={fields.name.id} className="block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">Full Name</label>
              <input type="text" id={fields.name.id} name={fields.name.name} defaultValue={profile.name ?? ""}
                placeholder="John Smith"
                aria-invalid={fields.name.errors ? true : undefined}
                className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none transition-all font-medium text-[13px] placeholder:text-slate-300 dark:placeholder:text-slate-500 text-ih-fg-1" />
              {fields.name.errors ? (
                <p className="mt-1 text-xs text-ih-bad-fg">{fields.name.errors[0]}</p>
              ) : (
                <p className="text-[11px] text-ih-fg-3">Displayed on inspection reports.</p>
              )}
            </div>
            <div className="space-y-2">
              <label htmlFor={fields.phone.id} className="block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">Phone</label>
              <input type="tel" id={fields.phone.id} name={fields.phone.name} defaultValue={profile.phone ?? ""}
                placeholder="(555) 123-4567"
                aria-invalid={fields.phone.errors ? true : undefined}
                className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none transition-all font-medium text-[13px] placeholder:text-slate-300 dark:placeholder:text-slate-500 text-ih-fg-1" />
              {fields.phone.errors && (
                <p className="mt-1 text-xs text-ih-bad-fg">{fields.phone.errors[0]}</p>
              )}
            </div>
            <div className="space-y-2">
              <label htmlFor={fields.licenseNumber.id} className="block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">License #</label>
              <input type="text" id={fields.licenseNumber.id} name={fields.licenseNumber.name} defaultValue={profile.licenseNumber ?? ""}
                placeholder="HI-12345"
                aria-invalid={fields.licenseNumber.errors ? true : undefined}
                className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none transition-all font-medium text-[13px] placeholder:text-slate-300 dark:placeholder:text-slate-500 text-ih-fg-1" />
              {fields.licenseNumber.errors ? (
                <p className="mt-1 text-xs text-ih-bad-fg">{fields.licenseNumber.errors[0]}</p>
              ) : (
                <p className="text-[11px] text-ih-fg-3">State inspector license number.</p>
              )}
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
            <label htmlFor={fields.slug.id} className="block text-[13px] font-semibold text-ih-fg-1">Slug</label>
            <input type="text" id={fields.slug.id} name={fields.slug.name} defaultValue={profile.slug ?? ""}
              placeholder="your-public-username" autoComplete="off"
              aria-invalid={fields.slug.errors ? true : undefined}
              className="block w-full rounded-md border border-ih-border bg-ih-bg-card px-3 py-2 text-[13px] focus:border-ih-primary focus:shadow-ih-focus outline-none transition-colors text-ih-fg-1" />
            {fields.slug.errors ? (
              <p className="mt-1 text-xs text-ih-bad-fg">{fields.slug.errors[0]}</p>
            ) : (
              <p className="text-[11px] text-ih-fg-3">Lowercase letters, numbers, and hyphens (3-32 chars).</p>
            )}
          </div>
          {profile.slug && tenant ? (
            <div className="flex items-center gap-3 pt-2">
              <a href={`/inspector/${tenant}/${profile.slug}`} target="_blank" rel="noopener noreferrer" className="text-[12px] text-ih-primary font-bold hover:underline">
                View my public profile &rarr;
              </a>
              <a href={`/book/${tenant}/${profile.slug}`} target="_blank" rel="noopener noreferrer" className="text-[12px] text-ih-primary font-bold hover:underline">
                View my booking page &rarr;
              </a>
            </div>
          ) : (
            <p className="text-[12px] text-ih-fg-3 italic pt-2">
              Set a slug above and Save Profile to enable your public profile and booking links.
            </p>
          )}
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
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="block text-[11px] text-ih-fg-3"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const fd = new FormData();
                    fd.append("photo", file);
                    const res = await fetch("/api/profile/photo", { method: "POST", credentials: "same-origin", body: fd });
                    if (res.ok) window.location.reload();
                  }}
                />
                <p className="text-[11px] text-ih-fg-3">JPG, PNG, or WebP. Max 2 MB. Square crop renders best.</p>
              </div>
            </div>
          </div>

          {/* Bio */}
          <div className="space-y-2">
            <label htmlFor={fields.bio.id} className="block text-[13px] font-semibold text-ih-fg-1">Bio</label>
            <textarea
              id={fields.bio.id} name={fields.bio.name} rows={4} maxLength={600}
              defaultValue={profile.bio ?? ""}
              onChange={(e) => setBioLen(e.target.value.length)}
              aria-invalid={fields.bio.errors ? true : undefined}
              placeholder="Tell customers a bit about your background, certifications, and inspection style."
              className="block w-full rounded-md border border-ih-border bg-ih-bg-card px-3 py-2 text-[13px] focus:border-ih-primary focus:shadow-ih-focus outline-none transition-colors text-ih-fg-1 placeholder:text-slate-300 dark:placeholder:text-slate-500"
            />
            {fields.bio.errors ? (
              <p className="mt-1 text-xs text-ih-bad-fg">{fields.bio.errors[0]}</p>
            ) : (
              <p className="text-[11px] text-ih-fg-3">{bioLen} / 600</p>
            )}
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
            Save Profile
          </button>
        </div>
      </Form>

      {/* Saved signature */}
      <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5">
        <header className="space-y-1">
          <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">Saved Signature</h3>
          <p className="text-[12px] text-ih-fg-3">
            Your signature is applied to agreements you send and can be used for auto-sign on report publish.
          </p>
        </header>

        {sigSaved && (
          <div className="px-4 py-2.5 rounded-md bg-ih-ok-bg border border-ih-ok-fg/20 text-[13px] text-ih-ok-fg font-medium">
            Signature saved.
          </div>
        )}
        {sigError && (
          <div className="px-4 py-2.5 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg font-medium">
            {sigError}
          </div>
        )}

        {showSigPad ? (
          <SignaturePad
            label="Save Signature"
            onCancel={() => setShowSigPad(false)}
            onSubmit={async (dataUri) => {
              const fd = new FormData();
              fd.append("intent", "save-signature");
              fd.append("signatureBase64", dataUri);
              sigFetcher.submit(fd, { method: "post" });
              setShowSigPad(false);
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowSigPad(true)}
            className="px-4 py-2 bg-ih-bg-muted border border-ih-border text-ih-fg-1 rounded-md font-semibold text-[13px] hover:bg-ih-bg-card hover:border-ih-primary transition-all"
          >
            {sigSaved ? "Update signature" : "Add signature"}
          </button>
        )}
      </section>
    </div>
  );
}
