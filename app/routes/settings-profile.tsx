import { useState, useEffect, useRef } from "react";
import { Form, useLoaderData, useActionData, useFetcher, useNavigation } from "react-router";
import { SettingsCrumb } from "~/components/SettingsCrumb";
import { BrowserTimezoneHint } from "~/components/settings/BrowserTimezoneHint";
import { useSessionContext } from "~/hooks/useSessionContext";
import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import type { Route } from "./+types/settings-profile";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { makeProfileSchema, overrideFieldFromForm } from "~/lib/forms/settings.schema";
import { Select } from "@core/shared-ui";
import { TIMEZONE_SELECT_OPTIONS } from "~/lib/timezone-options";
import { LOCALE_OPTIONS } from "~/lib/locales";
import { DateTimeFormatFields } from "~/components/settings/DateTimeFormatFields";
import { SectionNav } from "~/components/settings/SectionNav";
import { CredentialsEditor, type EditorCredential } from "~/components/settings/CredentialsEditor";
import { NotificationPreferencesCard } from "~/components/settings/NotificationPreferencesCard";
import { ProfilePhotoCard } from "~/components/settings/ProfilePhotoCard";
import { EmailSignatureCard, SavedSignatureCard } from "~/components/settings/SignatureCards";
import { useNotificationSaveToast } from "~/hooks/useNotificationSaveToast";
import { bulkNotificationChoice, grantNotificationSms, loadNotificationScreen, saveNotificationChoice } from "~/lib/settings-notifications.server";
import { m } from "~/paraglide/messages";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Profile {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  // DB-12 / IA-26 — slug omitted; inspector booking slugs are frozen.
  photoUrl?: string | null;
  signatureEnabled?: boolean;
  signaturePreviewHtml?: string;
  savedSignature?: string | null;
  timezone?: string | null;
  locale?: string | null;
  dateFormat?: string | null;
  timeFormat?: string | null;
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });
  const [res, credRes, notifications] = await Promise.all([
    api.profile.index.$get(),
    api.credentials.index.$get(),
    loadNotificationScreen(api),
  ]);
  const body = res.ok ? ((await res.json()) as Record<string, unknown>) : {};
  const credBody = credRes.ok ? ((await credRes.json()) as { data?: EditorCredential[] }) : { data: [] };
  return { profile: (body.data ?? {}) as Profile, credentials: credBody.data ?? [], notifications };
}

/* ------------------------------------------------------------------ */
/*  Action                                                             */
/* ------------------------------------------------------------------ */

/**
 * The email-signature flag carried by a form, or `undefined` when the form does
 * not carry one.
 *
 * ABSENCE IS NOT `false`, and that distinction is the whole function. The
 * toggle used to live inside the profile form; it now saves itself, so the
 * profile form no longer submits it. The obvious read —
 * `fd.getAll(...).at(-1) === "true"` — evaluates `undefined === "true"` on a
 * form that omits the field, quietly switching every inspector's signature OFF
 * the next time they save an unrelated profile field. Nothing on screen would
 * say so; they would find out from a recipient.
 *
 * When the field IS present it arrives twice (a hidden `false` plus a checked
 * `true`), so the last value wins.
 */
export function signatureEnabledFromForm(fd: FormData): boolean | undefined {
  if (!fd.has("signatureEnabled")) return undefined;
  const vals = fd.getAll("signatureEnabled");
  return vals[vals.length - 1] === "true";
}

/**
 * The reason the API refused, or a generic fallback.
 *
 * The envelope is `{ success: false, error: { code, message } }` — the message
 * is NESTED. Reading `err.message` off the top level (which several call sites
 * did) always misses, so every refusal collapsed to "Save failed": a 3 MB badge
 * upload told the reader nothing about the 2 MB limit it had just broken, which
 * is indistinguishable from the button doing nothing at all.
 */
async function apiErrorMessage(res: { json: () => Promise<unknown> }): Promise<string> {
  const body = await res.json().catch(() => ({}));
  const nested = (body as { error?: { message?: string } })?.error?.message;
  const flat = (body as { message?: string })?.message;
  return nested || flat || m.settings_error_save_failed();
}

export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });
  const fd = await request.formData();
  const intent = fd.get("intent") as string | null;

  if (intent === "save-notification") {
    return { ...(await saveNotificationChoice(api, fd)), intent };
  }

  if (intent === "bulk-notification") {
    return { ...(await bulkNotificationChoice(api, fd)), intent };
  }

  if (intent === "grant-notification-sms") {
    return { ...(await grantNotificationSms(api, request)), intent };
  }

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
      return { success: false, error: await apiErrorMessage(res), intent };
    }
    return { success: true, error: null, intent };
  }

  // Inspector credentials (Spec B) — each mutation revalidates the loader so the
  // editor re-renders with fresh rows. '' member number clears to null.
  // Each of these four used to `await` the call and return `success: true`
  // whatever came back, so a rejected write reported as a save. That was
  // survivable while nothing rendered the result; it is not survivable now that
  // the page's rule is "no button means it saved" and these are the sections
  // with no button.
  // Typed structurally rather than as `Response`: hono/client returns a
  // `ClientResponse`, which carries the response contract but not Workers'
  // `webSocket` field. Only `ok` and `json()` are read here.
  const credentialResult = async (res: { ok: boolean; json: () => Promise<unknown> }, i: string) => {
    if (res.ok) return { success: true, error: null, intent: i };
    return { success: false, error: await apiErrorMessage(res), intent: i };
  };
  if (intent === "credential-add") {
    return credentialResult(await api.credentials.index.$post({ json: { label: "" } }), intent);
  }
  if (intent === "credential-update") {
    const id = fd.get("id") as string;
    const patch: Record<string, unknown> = {};
    if (fd.has("label")) patch.label = fd.get("label") as string;
    if (fd.has("memberNumber")) patch.memberNumber = (fd.get("memberNumber") as string) || null;
    return credentialResult(await api.credentials[":id"].$patch({ param: { id }, json: patch }), intent);
  }
  /**
   * Reorder = choose. The list order decides the licence line AND the badge
   * beside the signature (`primaryLicenseOf` / `primaryBadgeOf`), so this is
   * not a cosmetic sort — it is how the inspector says which credential is
   * theirs to lead with.
   *
   * Reindexes the WHOLE list rather than swapping two rows: every credential
   * created before this control shipped sits at `sortOrder = 0`, and swapping
   * two zeroes is a no-op that looks exactly like a broken button.
   */
  if (intent === "credential-reorder") {
    const ids = String(fd.get("ids") ?? "").split(",").filter(Boolean);
    if (!ids.length) return { success: false, error: m.settings_profile_error_reorder_failed(), intent };
    const results = await Promise.all(
      ids.map((id, i) => api.credentials[":id"].$patch({ param: { id }, json: { sortOrder: i } })),
    );
    const failed = results.find((r) => !r.ok);
    return failed ? credentialResult(failed, intent) : { success: true, error: null, intent };
  }
  if (intent === "credential-delete") {
    const id = fd.get("id") as string;
    return credentialResult(await api.credentials[":id"].$delete({ param: { id } }), intent);
  }
  if (intent === "credential-image") {
    const id = fd.get("id") as string;
    const image = fd.get("image");
    if (!(image instanceof File) || image.size === 0) {
      return { success: false, error: m.settings_profile_error_no_photo(), intent };
    }
    return credentialResult(
      await api.credentials[":id"].image.$post({ param: { id }, form: { image } } as Parameters<typeof api.credentials[":id"]["image"]["$post"]>[0]),
      intent,
    );
  }

  // The language switcher (#269) lives in the sidebar user menu, not on this
  // page, and submits here through a fetcher — this action is already the one
  // place `users.locale` is written, and a second writer would be a second set
  // of rules about what a valid stored tag is.
  //
  // Its own intent rather than the default branch: that branch parses the WHOLE
  // profile form, and a submission carrying two fields would fail validation on
  // everything the switcher does not know about.
  if (intent === "set-locale") {
    const res = await api.profile.index.$patch({ json: { locale: String(fd.get("locale") ?? "") } });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { success: false, error: (err as Record<string, string>)?.message || m.settings_error_save_failed(), intent };
    }
    return { success: true, error: null, intent };
  }

  // The email-signature toggle saves itself (it is no longer inside the profile
  // form), so it needs its own intent rather than riding the default branch.
  if (intent === "signature-toggle") {
    const res = await api.profile.index.$patch({
      json: { signatureEnabled: fd.get("signatureEnabled") === "true" },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { success: false, error: (err as Record<string, string>)?.message || m.settings_error_save_failed(), intent };
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
  for (const key of ["name", "phone"] as const) {
    if (v[key] !== undefined) body[key] = v[key];
  }
  // The four inherit-or-override <select>s. Their values come from the raw
  // FormData, NOT from `submission.value`: Conform maps '' to undefined, and ''
  // is the CLEAR signal here (API maps '' -> NULL = inherit tenant), so reading
  // the parsed value made "Use workspace default" a no-op. See
  // `overrideFieldFromForm`. An absent key still means "leave it alone", so a
  // form that does not carry these controls cannot wipe them.
  for (const key of ["timezone", "locale", "dateFormat", "timeFormat"] as const) {
    const value = overrideFieldFromForm(fd, key);
    if (value !== undefined) body[key] = value;
  }
  const sigEnabled = signatureEnabledFromForm(fd);
  if (sigEnabled !== undefined) body.signatureEnabled = sigEnabled;
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
  const { profile, credentials, notifications } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
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

  // The profile form is the only thing left on this page that SUBMITS, so it is
  // the only thing that reads route navigation state.
  const savingProfile = useNavigation().state === "submitting";

  // Conform narrowing helpers (cat-7): actionData may be SubmissionResult or {success,error,...}
  const flashSuccess = actionData && "success" in actionData && actionData.success;
  const flashError = actionData && "error" in actionData && typeof actionData.error === "string" ? actionData.error : null;

  // Inspector credentials (Spec B) — mutations route through the action (BFF);
  // RR revalidates the loader afterward, so the editor re-renders with fresh rows.
  const credFetcher = useFetcher<{ success?: boolean; error?: string; intent?: string }>();
  const credImageFetcher = useFetcher<{ success?: boolean; error?: string; intent?: string }>();
  // Credentials save on BLUR — the most invisible save on the page, because
  // nothing moves when it works and nothing moves when it does not. Both
  // fetchers report, so leaving a field is a confirmable act.
  useNotificationSaveToast({
    data: credFetcher.data ?? null,
    failed: credFetcher.data?.success === false,
    error: credFetcher.data?.error ?? null,
  });
  useNotificationSaveToast({
    data: credImageFetcher.data ?? null,
    failed: credImageFetcher.data?.success === false,
    error: credImageFetcher.data?.error ?? null,
  });
  const [uploadingCredId, setUploadingCredId] = useState<string | null>(null);
  // The row the last upload was for, kept so a refusal can be shown ON it.
  const [lastUploadCredId, setLastUploadCredId] = useState<string | null>(null);
  const credUploadError = lastUploadCredId && credImageFetcher.data?.success === false
    ? { id: lastUploadCredId, message: credImageFetcher.data.error ?? m.settings_error_save_failed() }
    : null;
  useEffect(() => {
    if (credImageFetcher.state === "idle") setUploadingCredId(null);
  }, [credImageFetcher.state]);
  const onCredAdd = () => credFetcher.submit({ intent: "credential-add" }, { method: "post" });
  const onCredUpdate = (id: string, patch: { label?: string; memberNumber?: string }) =>
    credFetcher.submit(
      {
        intent: "credential-update",
        id,
        ...(patch.label !== undefined ? { label: patch.label } : {}),
        ...(patch.memberNumber !== undefined ? { memberNumber: patch.memberNumber } : {}),
      },
      { method: "post" },
    );
  const onCredDelete = (id: string) => credFetcher.submit({ intent: "credential-delete", id }, { method: "post" });
  const onCredReorder = (orderedIds: string[]) =>
    credFetcher.submit({ intent: "credential-reorder", ids: orderedIds.join(",") }, { method: "post" });
  const onCredUpload = (id: string, file: File) => {
    setUploadingCredId(id);
    setLastUploadCredId(id);
    const f = new FormData();
    f.append("intent", "credential-image");
    f.append("id", id);
    f.append("image", file);
    credImageFetcher.submit(f, { method: "post", encType: "multipart/form-data" });
  };

  // Timezone field — the tenant's own display tz. The <select> stays
  // uncontrolled (Conform reparses its DOM value on submit); we mirror the
  // current value into state only so the browser-timezone hint knows whether to
  // show. Adopting the browser zone writes the DOM value (that is what gets
  // submitted) + fires a native change so Conform revalidates and the hint
  // re-evaluates. The submitted value comes from `el.value`, not from any dirty
  // flag — the save bar is always shown, not dirty-gated.
  const companyTz = useSessionContext()?.branding.defaultTimezone ?? null;
  const tzSelectRef = useRef<HTMLSelectElement>(null);
  const [selectedTz, setSelectedTz] = useState(profile.timezone ?? "");
  function adoptBrowserTz(zone: string) {
    const el = tzSelectRef.current;
    if (el) {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      setter?.call(el, zone);
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    setSelectedTz(zone);
  }

  const navSections = [
    { id: "profile-details", label: m.settings_profile_crumb() },
    { id: "photo", label: m.settings_profile_photo_heading() },
    { id: "signature", label: m.settings_profile_signature_heading() },
    { id: "saved-signature", label: m.settings_profile_saved_signature_heading() },
    { id: "credentials", label: m.settings_profile_credentials_heading() },
    { id: "notifications", label: m.settings_notifications_eyebrow() },
  ];

  return (
    <div className="space-y-ih-list">
      <SettingsCrumb items={[{ label: m.settings_crumb_settings(), href: "/settings" }, { label: m.settings_profile_crumb() }]} />
      <p className="text-[13px] text-ih-fg-3">{m.settings_profile_subtitle()}</p>

      {/* In-page section navigation (sticky; scroll-spy). Shows only when ≥3 sections visible. */}
      <SectionNav sections={navSections} />

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
        <section id="profile-details" className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-6 scroll-mt-12">
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
          </div>

          <div className="max-w-md">
            <Select
              ref={tzSelectRef}
              label={m.settings_profile_timezone_label()}
              name="timezone"
              defaultValue={profile.timezone ?? ""}
              onChange={(e) => setSelectedTz(e.target.value)}
              hint={m.settings_profile_timezone_hint()}
              options={[
                {
                  value: "",
                  label: companyTz
                    ? m.settings_profile_timezone_company_named({ zone: companyTz.replace(/_/g, " ") })
                    : m.settings_profile_timezone_inherit_option(),
                },
                ...TIMEZONE_SELECT_OPTIONS,
              ]}
            />
            <BrowserTimezoneHint
              effectiveValue={selectedTz || companyTz || ""}
              onUse={adoptBrowserTz}
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

          {/* #270 — the hint states what this does NOT reach: an inspection is
              read out loud between three people who cannot see each other's
              screens, so its dates follow the COMPANY. */}
          <DateTimeFormatFields
            dateLabel={m.settings_profile_dateformat_label()}
            timeLabel={m.settings_profile_timeformat_label()}
            dateValue={profile.dateFormat}
            timeValue={profile.timeFormat}
            inheritLabel={m.settings_profile_locale_inherit_option()}
          />
          <p className="max-w-2xl text-[12px] text-ih-fg-3 leading-relaxed">
            {m.settings_profile_format_hint()}
          </p>

          {form.errors && (
            <div className="px-4 py-2.5 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg font-medium">
              {form.errors[0]}
            </div>
          )}

          {/* Save lives INSIDE the card it owns, and nowhere else on the page.
              It used to be a sticky bar spanning all six sections while owning
              one, which taught the wrong rule in both directions: a reader who
              edited a credential saw it and assumed nothing was saved yet (it
              was), and a reader who edited these fields watched it follow them
              down the page with no sign of what it belonged to. */}
          <div className="flex justify-end pt-2 border-t border-ih-border">
            <button
              type="submit"
              disabled={savingProfile}
              className="px-4 py-2 bg-ih-primary text-ih-fg-inverse rounded-md font-bold text-[13px] hover:bg-ih-primary-600 active:scale-[.98] transition-all disabled:opacity-60 disabled:pointer-events-none"
            >
              {savingProfile ? m.common_saving() : m.settings_profile_save_button()}
            </button>
          </div>
        </section>
      </Form>

      {/* DB-12 / IA-26 — Booking slug section removed; the company booking link
          now lives in Settings → Booking ("Your links"). */}

      <ProfilePhotoCard photoUrl={profile.photoUrl ?? null} />

      {/* Email signature (business-card footer) — independent of Point of Contact */}
      <EmailSignatureCard
        enabled={profile.signatureEnabled ?? true}
        previewHtml={profile.signaturePreviewHtml ?? null}
      />

      <SavedSignatureCard savedSignature={profile.savedSignature ?? null} />

      <CredentialsEditor
        credentials={credentials}
        uploadingId={uploadingCredId}
        uploadError={credUploadError}
        onAdd={onCredAdd}
        onUpdate={onCredUpdate}
        onDelete={onCredDelete}
        onReorder={onCredReorder}
        onUpload={onCredUpload}
      />

      <div id="notifications">
        <NotificationPreferencesCard
          alwaysSent={notifications.alwaysSent}
          youChoose={notifications.youChoose}
          loadError={notifications.error}
          smsConsent={notifications.smsConsent}
        />
      </div>

    </div>
  );
}
