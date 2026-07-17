import { useState, useEffect } from "react";
import { Form, useLoaderData, useActionData, useFetcher } from "react-router";
import { SettingsCrumb } from "~/components/SettingsCrumb";
import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import type { Route } from "./+types/settings-profile";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { SignaturePad } from "~/components/SignaturePad";
import { AvatarCropper } from "~/components/media-studio/AvatarCropper";
import { SettingsSaveBar } from "~/components/settings/SettingsSaveBar";
import { makeProfileSchema } from "~/lib/forms/settings.schema";
import { Select } from "@core/shared-ui";
import { TIMEZONE_SELECT_OPTIONS } from "~/lib/timezones";
import { LOCALE_OPTIONS } from "~/lib/locales";
import { m } from "~/paraglide/messages";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Profile {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  licenseNumber?: string | null;
  // DB-12 / IA-26 — slug omitted; inspector booking slugs are frozen.
  photoUrl?: string | null;
  signatureEnabled?: boolean;
  signaturePreviewHtml?: string;
  timezone?: string | null;
  locale?: string | null;
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
      return { success: false, error: m.settings_profile_error_no_signature(), intent };
    }
    // TODO(C-10 collapse): hono/client collapses api.users.me so .signature is not
    // accessible; localized assertion until the typed-hono spike resolves it. Binding preserved.
    const usersClient = api.users as unknown as { me: { signature: { $post: (args: { json: { signatureBase64: string } }) => Promise<Response> } } };
    const res = await usersClient.me.signature.$post({
      json: { signatureBase64 },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { success: false, error: (err as Record<string, string>)?.message || m.settings_error_save_failed(), intent };
    }
    return { success: true, error: null, intent };
  }

  // Profile photo upload
  if (intent === "photo-upload") {
    const photo = fd.get("photo");
    if (!(photo instanceof File) || photo.size === 0) {
      return { success: false, error: m.settings_profile_error_no_photo(), intent };
    }
    // hono/client form: keys must match the API schema field names
    const res = await api.profile.photo.$post({ form: { photo } } as Parameters<typeof api.profile.photo.$post>[0]);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { success: false, error: (err as Record<string, string>)?.message || m.settings_profile_error_upload_failed(), intent };
    }
    return { success: true, error: null, intent };
  }

  // Default: save profile fields
  const submission = parseWithZod(fd, { schema: makeProfileSchema() });
  if (submission.status !== "success") {
    return submission.reply();
  }
  const v = submission.value;
  const body: Record<string, unknown> = {};
  // DB-12 / IA-26 — "slug" intentionally removed; inspector booking slugs frozen.
  for (const key of ["name", "phone", "licenseNumber"] as const) {
    if (v[key] !== undefined) body[key] = v[key];
  }
  // Per-user timezone override. The <select> always submits a value; an empty
  // string clears the override (API maps '' -> NULL = inherit tenant).
  if (v.timezone !== undefined) body.timezone = v.timezone;
  // Per-user locale override. Same contract as timezone: '' clears (inherit tenant).
  if (v.locale !== undefined) body.locale = v.locale;
  // Email signature toggle: hidden "false" + optional checkbox "true" — last value wins.
  const sigVals = fd.getAll("signatureEnabled");
  body.signatureEnabled = sigVals[sigVals.length - 1] === "true";
  const res = await api.profile.index.$patch({ json: body });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return submission.reply({
      formErrors: [(err as Record<string, string>)?.message || m.settings_error_save_failed()],
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
  const [avatarSource, setAvatarSource] = useState<string | null>(null);
  // DB-12 / IA-26 — useSessionContext / tenantSlug removed; slug section gone.

  // Conform owns the main profile form (default intent). The save-signature
  // intent is handled by a separate useFetcher below, so guard against feeding
  // a non-Conform actionData into useForm.
  const [form, fields] = useForm({
    lastResult: actionData && "status" in actionData ? actionData : undefined,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: makeProfileSchema() });
    },
    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
  });

  // Conform narrowing helpers (cat-7): actionData may be SubmissionResult or {success,error,...}
  const flashSuccess = actionData && "success" in actionData && actionData.success;
  const flashError = actionData && "error" in actionData && typeof actionData.error === "string" ? actionData.error : null;

  // Photo upload fetcher — replaces the raw fetch() in the file input onChange
  const photoFetcher = useFetcher<{ success?: boolean; error?: string; intent?: string }>();
  useEffect(() => {
    if (photoFetcher.state === "idle" && photoFetcher.data?.success && photoFetcher.data?.intent === "photo-upload") {
      window.location.reload();
    }
  }, [photoFetcher.state, photoFetcher.data]);

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
    <div className="space-y-ih-list">
      <SettingsCrumb items={[{ label: m.settings_crumb_settings(), href: "/settings" }, { label: m.settings_profile_crumb() }]} />
      <p className="text-[13px] text-ih-fg-3">{m.settings_profile_subtitle()}</p>

      {/* Flash */}
      {flashSuccess && (
        <div className="px-4 py-2.5 rounded-md bg-ih-ok-bg border border-ih-ok-fg/20 text-[13px] text-ih-ok-fg font-medium">
          {m.settings_profile_flash_saved()}
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
              <label htmlFor={fields.name.id} className="block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_profile_name_label()}</label>
              <input type="text" id={fields.name.id} name={fields.name.name} defaultValue={profile.name ?? ""}
                placeholder={m.settings_profile_name_placeholder()}
                aria-invalid={fields.name.errors ? true : undefined}
                className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none transition-all font-medium text-[13px] placeholder:text-ih-fg-4 text-ih-fg-1" />
              {fields.name.errors ? (
                <p className="mt-1 text-xs text-ih-bad-fg">{fields.name.errors[0]}</p>
              ) : (
                <p className="text-[11px] text-ih-fg-3">{m.settings_profile_name_hint()}</p>
              )}
            </div>
            <div className="space-y-2">
              <label htmlFor={fields.phone.id} className="block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_profile_phone_label()}</label>
              <input type="tel" id={fields.phone.id} name={fields.phone.name} defaultValue={profile.phone ?? ""}
                placeholder={m.settings_profile_phone_placeholder()}
                aria-invalid={fields.phone.errors ? true : undefined}
                className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none transition-all font-medium text-[13px] placeholder:text-ih-fg-4 text-ih-fg-1" />
              {fields.phone.errors && (
                <p className="mt-1 text-xs text-ih-bad-fg">{fields.phone.errors[0]}</p>
              )}
            </div>
            <div className="space-y-2">
              <label htmlFor={fields.licenseNumber.id} className="block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_profile_license_label()}</label>
              <input type="text" id={fields.licenseNumber.id} name={fields.licenseNumber.name} defaultValue={profile.licenseNumber ?? ""}
                placeholder={m.settings_profile_license_placeholder()}
                aria-invalid={fields.licenseNumber.errors ? true : undefined}
                className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none transition-all font-medium text-[13px] placeholder:text-ih-fg-4 text-ih-fg-1" />
              {fields.licenseNumber.errors ? (
                <p className="mt-1 text-xs text-ih-bad-fg">{fields.licenseNumber.errors[0]}</p>
              ) : (
                <p className="text-[11px] text-ih-fg-3">{m.settings_profile_license_hint()}</p>
              )}
            </div>
          </div>

          <div className="max-w-md">
            <Select
              label={m.settings_profile_timezone_label()}
              name="timezone"
              defaultValue={profile.timezone ?? ""}
              hint={m.settings_profile_timezone_hint()}
              options={[
                { value: "", label: m.settings_profile_timezone_inherit_option() },
                ...TIMEZONE_SELECT_OPTIONS,
              ]}
            />
          </div>

          <div className="max-w-md">
            <Select
              label={m.settings_profile_locale_label()}
              name="locale"
              defaultValue={profile.locale ?? ""}
              hint={m.settings_profile_locale_hint()}
              options={[
                { value: "", label: m.settings_profile_locale_inherit_option() },
                ...LOCALE_OPTIONS,
              ]}
            />
          </div>
        </section>

        {/* DB-12 / IA-26 — Booking slug section removed; the company booking link
            now lives in Settings → Booking ("Your links"). */}

        {/* Photo placeholder */}
        <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5">
          <header className="space-y-1">
            <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_profile_photo_heading()}</h3>
            <p className="text-[12px] text-ih-fg-3">{m.settings_profile_photo_subtitle()}</p>
          </header>

          {/* Photo */}
          <div className="space-y-2">
            <label className="block text-[13px] font-semibold text-ih-fg-1">{m.settings_profile_photo_heading()}</label>
            <div className="flex items-center gap-4">
              <div className="w-24 h-24 rounded-full bg-ih-bg-muted border border-ih-border overflow-hidden flex items-center justify-center text-ih-fg-4 text-[11px]">
                {profile.photoUrl ? (
                  <img src={profile.photoUrl} alt={m.settings_profile_photo_alt()} className="w-full h-full object-cover" />
                ) : (
                  <span>{m.settings_profile_photo_none()}</span>
                )}
              </div>
              <div className="space-y-2">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="block text-[11px] text-ih-fg-3"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) setAvatarSource(URL.createObjectURL(file));
                    e.target.value = "";
                  }}
                />
                <p className="text-[11px] text-ih-fg-3">{m.settings_profile_photo_hint()}</p>
              </div>
            </div>
          </div>

        </section>

        {/* Email signature (business-card footer) — independent of Point of Contact */}
        <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-4">
          <header className="space-y-1">
            <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_profile_signature_heading()}</h3>
            <p className="text-[12px] text-ih-fg-3">
              {m.settings_profile_signature_subtitle()}
            </p>
          </header>

          <input type="hidden" name="signatureEnabled" value="false" />
          <label className="flex items-center gap-2 text-[13px] text-ih-fg-1">
            <input type="checkbox" name="signatureEnabled" value="true" defaultChecked={profile.signatureEnabled ?? true} />
            {m.settings_profile_signature_toggle()}
          </label>

          {profile.signaturePreviewHtml ? (
            <div className="rounded-md border border-ih-border bg-ih-bg-muted p-4">
              <div className="text-[11px] text-ih-fg-3 mb-2 uppercase tracking-[0.2em]">{m.settings_profile_signature_preview_label()}</div>
              <div dangerouslySetInnerHTML={{ __html: profile.signaturePreviewHtml }} />
            </div>
          ) : (
            <p className="text-[12px] text-ih-fg-3">{m.settings_profile_signature_empty()}</p>
          )}
        </section>

        {form.errors && (
          <div className="px-4 py-2.5 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg font-medium">
            {form.errors[0]}
          </div>
        )}

        {/* Save — sticky bar pinned to the bottom of the settings scroll area */}
        <SettingsSaveBar label={m.settings_profile_save_button()} />
      </Form>

      {/* Saved signature */}
      <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5">
        <header className="space-y-1">
          <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_profile_saved_signature_heading()}</h3>
          <p className="text-[12px] text-ih-fg-3">
            {m.settings_profile_saved_signature_subtitle()}
          </p>
        </header>

        {sigSaved && (
          <div className="px-4 py-2.5 rounded-md bg-ih-ok-bg border border-ih-ok-fg/20 text-[13px] text-ih-ok-fg font-medium">
            {m.settings_profile_signature_saved_flash()}
          </div>
        )}
        {sigError && (
          <div className="px-4 py-2.5 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg font-medium">
            {sigError}
          </div>
        )}

        {showSigPad ? (
          <SignaturePad
            label={m.settings_profile_signature_pad_save()}
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
            {sigSaved ? m.settings_profile_signature_update() : m.settings_profile_signature_add()}
          </button>
        )}
      </section>

      {avatarSource && (
        <AvatarCropper
          sourceUrl={avatarSource}
          onCancel={() => { URL.revokeObjectURL(avatarSource); setAvatarSource(null); }}
          onSave={(blob) => {
            const fd = new FormData();
            fd.append("intent", "photo-upload");
            fd.append("photo", new File([blob], "avatar.jpg", { type: "image/jpeg" }));
            photoFetcher.submit(fd, { method: "POST", encType: "multipart/form-data" });
            URL.revokeObjectURL(avatarSource);
            setAvatarSource(null);
          }}
        />
      )}
    </div>
  );
}
