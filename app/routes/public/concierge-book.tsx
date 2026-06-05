import { Form, useLoaderData, useActionData, useNavigation } from "react-router";
import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import type { Route } from "./+types/concierge-book";
import { createApi } from "~/lib/api-client.server";
import { conciergeBookSchema } from "~/lib/forms/public.schema";
import { brandTokens, type TenantBrand } from "~/lib/brand";
import { readLegalLinks } from "~/lib/legal-links.server";

export function meta() {
  return [{ title: "Book your inspection - OpenInspection" }];
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ConciergeBookData {
  token: string;
  tenant: { name: string; brand: TenantBrand | null };
  inspector: { id: string; name: string } | null;
  availableSlots: Array<{ start: string; end: string }>;
  expiresAt: string;
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const privacyUrl = readLegalLinks(context)?.privacyUrl ?? null;
  if (!token) {
    return { data: null, error: "no-token" as const, privacyUrl };
  }
  try {
    const api = createApi(context);
    const res = await api.concierge["book-info"].$get({ query: { token } });
    if (!res.ok) {
      return { data: null, error: "expired" as const, privacyUrl };
    }
    const body = (await res.json()) as { success: boolean; data?: Omit<ConciergeBookData, "token"> };
    if (!body.success || !body.data) {
      return { data: null, error: "expired" as const, privacyUrl };
    }
    return { data: { ...body.data, token }, error: null, privacyUrl };
  } catch {
    return { data: null, error: "unknown" as const, privacyUrl };
  }
}

/* ------------------------------------------------------------------ */
/*  Action                                                             */
/* ------------------------------------------------------------------ */

export async function action({ request, context }: Route.ActionArgs) {
  const fd = await request.formData();
  // Token is a URL passthrough re-sent as a hidden field, not a schema field.
  const token = (fd.get("token") as string) ?? "";

  const submission = parseWithZod(fd, { schema: conciergeBookSchema });
  if (submission.status !== "success") {
    return submission.reply();
  }
  const { contactName, contactEmail, contactPhone, address, slotStart, slotEnd, notes } =
    submission.value;

  const payload = {
    token,
    slot: { start: slotStart, end: slotEnd },
    contactName,
    contactEmail,
    contactPhone: contactPhone || undefined,
    address,
    notes: notes || undefined,
  };

  const api = createApi(context);
  const res = await api.concierge.book.$post({ json: payload });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || !json.success) {
    const err = json.error as Record<string, string> | undefined;
    return submission.reply({ formErrors: [err?.message || "Could not submit booking"] });
  }
  const data = json.data as { bookingId: string; confirmationToken: string } | undefined;
  return { success: true as const, error: null, confirmationToken: data?.confirmationToken ?? null };
}

/* ------------------------------------------------------------------ */
/*  Timeline steps                                                     */
/* ------------------------------------------------------------------ */

const TIMELINE_STEPS = [
  { label: "Submitted", sub: "Booking sent.", done: true, active: false },
  { label: "Inspector confirms", sub: "Your inspector will lock in the slot shortly.", done: false, active: true },
  { label: "Agreement signed", sub: "You'll read and e-sign the inspection agreement.", done: false, active: false },
  { label: "Inspection scheduled", sub: "Watch your email for the calendar invite.", done: false, active: false },
];

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function ConciergeBookPage() {
  const { data, error: loaderError, privacyUrl } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  // On success the action returns a `{ success }` flash shape; on validation or
  // API failure it returns a Conform SubmissionResult. Feed Conform its own
  // result only — never the success flash object.
  const bookResult =
    actionData && !("success" in actionData) ? actionData : undefined;
  const [form, fields] = useForm({
    lastResult: bookResult,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: conciergeBookSchema });
    },
    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
  });

  if (loaderError || !data) {
    const headline =
      loaderError === "expired"
        ? "This booking link has expired"
        : loaderError === "no-token"
          ? "No booking link provided"
          : "Could not load booking information";
    const body =
      loaderError === "expired"
        ? "Booking invite links have a short shelf life. Reach out to your inspector and they can send you a fresh one."
        : loaderError === "no-token"
          ? "It looks like the link is incomplete. Use the original email and try again, or contact your inspector."
          : "The link may have been mistyped, or the invite was cancelled. Get in touch with your inspector.";
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-[480px] w-full bg-ih-bg-card border border-ih-border rounded-xl p-9">
          <h1 className="font-serif text-2xl font-bold mb-2 text-ih-fg-1">{headline}</h1>
          <p className="text-[15px] text-ih-fg-3 leading-relaxed">{body}</p>
        </div>
      </div>
    );
  }

  const inspectorName = data.inspector?.name || "your inspector";
  const submitted = actionData != null && "success" in actionData && actionData.success === true;
  const slots = data.availableSlots;

  return (
    <div className="min-h-screen bg-ih-bg-card" style={brandTokens(data.tenant.brand?.primaryColor)}>
      {/* Mode bar */}
      <div className="sticky top-0 z-50 bg-ih-watch-bg border-b border-ih-border px-6 py-3 flex items-center justify-between text-sm font-semibold text-ih-watch-fg">
        <span className="flex items-center gap-2">
          <span className="text-lg" aria-hidden="true">🔔</span>
          <span>Book your inspection</span>
        </span>
        <span className="flex items-center gap-2 text-[13px] text-ih-watch-fg">
          {data.tenant.brand?.logoUrl && (
            <img src={data.tenant.brand.logoUrl} alt="" className="h-5 w-auto" />
          )}
          {data.tenant.brand?.siteName ?? data.tenant.name}
        </span>
      </div>

      <main className="max-w-[720px] mx-auto px-5 py-10">
        <h1 className="font-serif text-[1.75rem] font-bold leading-tight mb-1 text-ih-fg-1">
          Book with <span className="text-ih-fg-3">{inspectorName}</span>
        </h1>
        <p className="text-[15px] text-ih-fg-3 leading-relaxed mb-7">
          Fill in your details and pick a date. You'll get an email confirmation
          and a chance to e-sign the inspection agreement before anything is finalized.
        </p>

        {!submitted ? (
          <Form
            method="post"
            id={form.id}
            onSubmit={form.onSubmit}
            noValidate
            autoComplete="off"
            className="bg-ih-bg-card border border-ih-border rounded-xl p-7 space-y-4"
          >
            <input type="hidden" name="token" value={data.token} />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="space-y-1.5">
                <span className="block text-[13px] font-bold text-ih-fg-3 uppercase tracking-wide">
                  Your name
                </span>
                <input
                  type="text"
                  name={fields.contactName.name}
                  id={fields.contactName.id}
                  maxLength={200}
                  placeholder="Sarah Buyer"
                  aria-invalid={fields.contactName.errors ? true : undefined}
                  className="w-full px-3 py-2.5 border border-ih-border rounded-lg bg-ih-bg-card text-base text-ih-fg-1 outline-none focus:border-ih-primary focus:shadow-ih-focus"
                />
                {fields.contactName.errors && (
                  <p className="mt-1 text-xs text-ih-bad-fg">{fields.contactName.errors[0]}</p>
                )}
              </label>
              <label className="space-y-1.5">
                <span className="block text-[13px] font-bold text-ih-fg-3 uppercase tracking-wide">
                  Email
                </span>
                <input
                  type="email"
                  name={fields.contactEmail.name}
                  id={fields.contactEmail.id}
                  maxLength={200}
                  placeholder="sarah@example.com"
                  aria-invalid={fields.contactEmail.errors ? true : undefined}
                  className="w-full px-3 py-2.5 border border-ih-border rounded-lg bg-ih-bg-card text-base text-ih-fg-1 outline-none focus:border-ih-primary focus:shadow-ih-focus"
                />
                {fields.contactEmail.errors && (
                  <p className="mt-1 text-xs text-ih-bad-fg">{fields.contactEmail.errors[0]}</p>
                )}
              </label>
            </div>

            <label className="space-y-1.5 block">
              <span className="block text-[13px] font-bold text-ih-fg-3 uppercase tracking-wide">
                Phone{" "}
                <span className="text-ih-fg-4 font-medium normal-case tracking-normal">
                  (optional)
                </span>
              </span>
              <input
                type="tel"
                name={fields.contactPhone.name}
                id={fields.contactPhone.id}
                maxLength={40}
                placeholder="(555) 123-4567"
                aria-invalid={fields.contactPhone.errors ? true : undefined}
                className="w-full px-3 py-2.5 border border-ih-border rounded-lg bg-ih-bg-card text-base text-ih-fg-1 outline-none focus:border-ih-primary focus:shadow-ih-focus"
              />
              {fields.contactPhone.errors && (
                <p className="mt-1 text-xs text-ih-bad-fg">{fields.contactPhone.errors[0]}</p>
              )}
            </label>

            <label className="space-y-1.5 block">
              <span className="block text-[13px] font-bold text-ih-fg-3 uppercase tracking-wide">
                Property address
              </span>
              <input
                type="text"
                name={fields.address.name}
                id={fields.address.id}
                maxLength={500}
                placeholder="1 Main St, Springfield"
                aria-invalid={fields.address.errors ? true : undefined}
                className="w-full px-3 py-2.5 border border-ih-border rounded-lg bg-ih-bg-card text-base text-ih-fg-1 outline-none focus:border-ih-primary focus:shadow-ih-focus"
              />
              {fields.address.errors && (
                <p className="mt-1 text-xs text-ih-bad-fg">{fields.address.errors[0]}</p>
              )}
            </label>

            {slots.length > 0 ? (
              <label className="space-y-1.5 block">
                <span className="block text-[13px] font-bold text-ih-fg-3 uppercase tracking-wide">
                  Slot
                </span>
                <select
                  name="slotIndex"
                  onChange={(e) => {
                    const idx = Number(e.target.value);
                    const slot = slots[idx];
                    if (!slot) return;
                    (document.getElementsByName(fields.slotStart.name)[0] as HTMLInputElement).value = slot.start;
                    (document.getElementsByName(fields.slotEnd.name)[0] as HTMLInputElement).value = slot.end;
                  }}
                  className="w-full px-3 py-2.5 border border-ih-border rounded-lg bg-ih-bg-card text-base text-ih-fg-1 outline-none focus:border-ih-primary focus:shadow-ih-focus"
                >
                  <option value="">Select a slot</option>
                  {slots.map((slot, idx) => (
                    <option key={`${slot.start}-${idx}`} value={idx}>
                      {new Date(slot.start).toLocaleString()} – {new Date(slot.end).toLocaleString()}
                    </option>
                  ))}
                </select>
                <input type="hidden" name={fields.slotStart.name} />
                <input type="hidden" name={fields.slotEnd.name} />
                {(fields.slotStart.errors || fields.slotEnd.errors) && (
                  <p className="mt-1 text-xs text-ih-bad-fg">
                    {fields.slotStart.errors?.[0] ?? fields.slotEnd.errors?.[0]}
                  </p>
                )}
              </label>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="space-y-1.5">
                  <span className="block text-[13px] font-bold text-ih-fg-3 uppercase tracking-wide">
                    Preferred start
                  </span>
                  <input
                    type="datetime-local"
                    name={fields.slotStart.name}
                    id={fields.slotStart.id}
                    aria-invalid={fields.slotStart.errors ? true : undefined}
                    className="w-full px-3 py-2.5 border border-ih-border rounded-lg bg-ih-bg-card text-base text-ih-fg-1 outline-none focus:border-ih-primary focus:shadow-ih-focus"
                  />
                  {fields.slotStart.errors && (
                    <p className="mt-1 text-xs text-ih-bad-fg">{fields.slotStart.errors[0]}</p>
                  )}
                </label>
                <label className="space-y-1.5">
                  <span className="block text-[13px] font-bold text-ih-fg-3 uppercase tracking-wide">
                    Preferred end
                  </span>
                  <input
                    type="datetime-local"
                    name={fields.slotEnd.name}
                    id={fields.slotEnd.id}
                    aria-invalid={fields.slotEnd.errors ? true : undefined}
                    className="w-full px-3 py-2.5 border border-ih-border rounded-lg bg-ih-bg-card text-base text-ih-fg-1 outline-none focus:border-ih-primary focus:shadow-ih-focus"
                  />
                  {fields.slotEnd.errors && (
                    <p className="mt-1 text-xs text-ih-bad-fg">{fields.slotEnd.errors[0]}</p>
                  )}
                </label>
              </div>
            )}

            <label className="space-y-1.5 block">
              <span className="block text-[13px] font-bold text-ih-fg-3 uppercase tracking-wide">
                Notes{" "}
                <span className="text-ih-fg-4 font-medium normal-case tracking-normal">
                  (optional)
                </span>
              </span>
              <textarea
                name={fields.notes.name}
                id={fields.notes.id}
                rows={3}
                placeholder="Anything your inspector should know."
                className="w-full px-3 py-2.5 border border-ih-border rounded-lg bg-ih-bg-card text-base text-ih-fg-1 outline-none focus:border-ih-primary focus:shadow-ih-focus"
              />
            </label>

            <div className="pt-2">
              <p className="mb-2 text-xs text-ih-fg-3">
                Your information is shared with {data.tenant.brand?.siteName ?? data.tenant.name} to schedule your inspection.
                {privacyUrl && <> See our <a href={privacyUrl} target="_blank" rel="noreferrer" className="underline">Privacy Policy</a>.</>}
              </p>
              <button
                type="submit"
                disabled={submitting}
                className="w-full px-6 py-3.5 bg-ih-primary text-white rounded-lg font-bold text-base hover:brightness-95 disabled:bg-ih-bg-muted disabled:cursor-wait transition-all"
              >
                {submitting ? "Sending..." : "Send booking"}
              </button>

              {form.errors && (
                <div className="mt-3 px-4 py-3 bg-ih-bad-bg border border-ih-bad rounded-lg text-[14px] text-ih-bad-fg">
                  {form.errors[0]}
                </div>
              )}
            </div>
          </Form>
        ) : (
          /* Post-submit timeline */
          <div className="bg-ih-bg-card border border-ih-border rounded-xl p-7 space-y-3.5 mt-5">
            {TIMELINE_STEPS.map((step, idx) => (
              <div key={step.label} className="flex items-center gap-3 py-2.5">
                <span
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                    step.done
                      ? "bg-ih-ok text-white"
                      : step.active
                        ? "bg-ih-primary text-white animate-pulse"
                        : "bg-ih-bg-muted text-ih-fg-3"
                  }`}
                >
                  {step.done ? "✓" : idx + 1}
                </span>
                <div>
                  <div className="text-[15px] font-semibold text-ih-fg-1">
                    {step.label}
                  </div>
                  <div className="text-[13px] text-ih-fg-3 mt-0.5">
                    {step.sub}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {privacyUrl && (
          <p className="mt-8 text-center text-xs text-ih-fg-3">
            <a href={privacyUrl} target="_blank" rel="noreferrer" className="hover:underline">Privacy Policy</a>
          </p>
        )}
      </main>
    </div>
  );
}
