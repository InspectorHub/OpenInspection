import { Form, useLoaderData, useActionData, useNavigation } from "react-router";
import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import type { Route } from "./+types/invite-accept";
import { createApi } from "~/lib/api-client.server";
import { makeAgentInviteAcceptSchema } from "~/lib/forms/auth.schema";
import { readLegalLinks } from "~/lib/legal-links.server";
import { LegalCheckbox } from "~/components/LegalCheckbox";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.auth_agent_invite_meta_title() }];
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface InviteData {
  token: string;
  inspector: { name: string; photoUrl?: string };
  tenantName: string;
  inviteEmail: string;
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";

  const legal = readLegalLinks(context);

  if (!token) {
    return { invite: null, error: "no-token" as const, legal };
  }
  try {
    const api = createApi(context);
    const res = await api.agents["invite-info"].$get({ query: { token } });
    const body = res.ok ? await res.json() : {};
    if (!res.ok) {
      return { invite: null, error: "expired" as const, legal };
    }
    const data = ((body as Record<string, unknown>).data ?? {}) as unknown as InviteData | undefined;
    return {
      invite: data && Object.keys(data).length > 0 ? { ...data, token } : null,
      error: null,
      legal,
    };
  } catch {
    return { invite: null, error: "unknown" as const, legal };
  }
}

/* ------------------------------------------------------------------ */
/*  Action                                                             */
/* ------------------------------------------------------------------ */

export async function action({ request, context }: Route.ActionArgs) {
  const fd = await request.formData();
  // Token comes from the invite (hidden field); email is read-only. The schema
  // only validates the user-typed name + password.
  const token = String(fd.get("token") || "");
  const submission = parseWithZod(fd, { schema: makeAgentInviteAcceptSchema() });
  if (submission.status !== "success") {
    return submission.reply();
  }
  const { name, password } = submission.value;

  const api = createApi(context);
  const res = await api.agents.accept.$post({ json: { token, password, name, termsAccepted: fd.get("termsAccepted") === "on" } });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || !json.success) {
    const err = json.error as Record<string, string> | undefined;
    return submission.reply({ formErrors: [err?.message || m.auth_agent_invite_error_failed()] });
  }

  const data = json.data as Record<string, string> | undefined;
  // Success: keep the client-side redirect path (sentinel object, not a
  // Conform SubmissionResult — the component guards on `redirect`).
  return { redirect: data?.redirect || "/agent-dashboard" };
}

/* ------------------------------------------------------------------ */
/*  Helper                                                             */
/* ------------------------------------------------------------------ */

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2);
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function AgentInviteAcceptPage() {
  const { invite, error: loaderError, legal } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  // Success returns a `{ redirect }` sentinel; errors return a Conform
  // SubmissionResult. Only the latter feeds `useForm`.
  const successRedirect =
    actionData && "redirect" in actionData ? actionData.redirect : null;
  const lastResult =
    actionData && "redirect" in actionData ? undefined : actionData;

  // Redirect on success
  if (typeof window !== "undefined" && successRedirect) {
    window.location.href = successRedirect;
  }

  const [form, fields] = useForm({
    lastResult,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: makeAgentInviteAcceptSchema() });
    },
    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
  });

  // Invite expired / missing -- redirect to expired page
  if (loaderError || !invite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ih-bg-card p-6">
        <div className="max-w-md text-center">
          <h1 className="font-serif text-2xl font-bold mb-3 text-ih-fg-1">
            {m.auth_agent_invite_unavailable_heading()}
          </h1>
          <p className="text-[15px] text-ih-fg-3 mb-6">
            {m.auth_agent_invite_unavailable_body()}
          </p>
          <a
            href="/agent-signup"
            className="inline-block px-6 py-3 bg-ih-primary text-white rounded-xl font-semibold hover:opacity-90 transition-opacity"
          >
            {m.auth_agent_invite_signup_link()}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ih-bg-card">
      <div className="max-w-[540px] mx-auto px-6 py-14">
        {/* Brand */}
        <div className="flex items-center gap-3 mb-10">
          <img src="/logo.svg" alt="" className="w-8 h-8" width={32} height={32} />
          <span className="font-serif font-bold text-lg tracking-tight text-ih-fg-1">
            OpenInspection
          </span>
        </div>

        <h1 className="font-serif font-bold text-4xl leading-tight tracking-tight mb-3 text-ih-fg-1">
          {m.auth_agent_invite_heading()}
        </h1>
        <p className="text-base text-ih-fg-3 leading-relaxed mb-9">
          <strong className="text-ih-fg-1">
            {invite.inspector.name}
          </strong>{" "}
          {m.auth_agent_invite_body_at()}{" "}
          <strong className="text-ih-fg-1">
            {invite.tenantName}
          </strong>{" "}
          {m.auth_agent_invite_body_rest()}
        </p>

        {/* Inspector hero band */}
        <div className="flex items-center gap-4 p-5 bg-ih-bg-card border border-ih-border rounded-2xl mb-8">
          <div className="w-14 h-14 rounded-full bg-ih-primary-tint text-ih-primary flex items-center justify-center font-serif font-bold text-xl shrink-0 overflow-hidden">
            {invite.inspector.photoUrl ? (
              <img
                src={invite.inspector.photoUrl}
                alt={invite.inspector.name}
                className="w-full h-full object-cover rounded-full"
              />
            ) : (
              getInitials(invite.inspector.name)
            )}
          </div>
          <div>
            <div className="font-semibold text-base text-ih-fg-1">
              {invite.inspector.name}
            </div>
            <div className="text-[14px] text-ih-fg-3 mt-0.5">
              {invite.tenantName}
            </div>
          </div>
        </div>

        {/* Value props */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-9">
          {[
            { icon: "↗", title: m.auth_agent_invite_prop1_title(), sub: m.auth_agent_invite_prop1_sub() },
            { icon: "⊕", title: m.auth_agent_invite_prop2_title(), sub: m.auth_agent_invite_prop2_sub() },
            { icon: "★", title: m.auth_agent_invite_prop3_title(), sub: m.auth_agent_invite_prop3_sub() },
          ].map((v) => (
            <div
              key={v.title}
              className="p-4 bg-ih-bg-card border border-ih-border rounded-xl text-center"
            >
              <div className="text-2xl mb-2">{v.icon}</div>
              <div className="text-[13px] font-semibold text-ih-fg-1 leading-snug">
                {v.title}
              </div>
              <div className="text-[12px] text-ih-fg-3 mt-1">
                {v.sub}
              </div>
            </div>
          ))}
        </div>

        {/* Accept form */}
        <Form method="post" autoComplete="off" id={form.id} onSubmit={form.onSubmit} noValidate>
          <input type="hidden" name="token" value={invite.token} />

          <div className="space-y-5">
            <div>
              <label
                htmlFor="email"
                className="block text-[13px] font-semibold text-ih-fg-3 mb-2"
              >
                {m.auth_agent_invite_email_label()}
              </label>
              <input
                type="email"
                id="email"
                name="email"
                value={invite.inviteEmail}
                readOnly
                className="w-full px-4 py-3 text-[15px] bg-ih-bg-muted border border-ih-border rounded-xl text-ih-fg-3 cursor-not-allowed"
              />
            </div>
            <div>
              <label
                htmlFor={fields.name.id}
                className="block text-[13px] font-semibold text-ih-fg-3 mb-2"
              >
                {m.auth_agent_invite_name_label()}
              </label>
              <input
                type="text"
                id={fields.name.id}
                name={fields.name.name}
                placeholder={m.auth_agent_name_placeholder()}
                aria-invalid={fields.name.errors ? true : undefined}
                className="w-full px-4 py-3 text-[15px] bg-ih-bg-card border border-ih-border rounded-xl outline-none focus:border-ih-primary focus:shadow-ih-focus transition-all text-ih-fg-1"
              />
              {fields.name.errors && (
                <p className="mt-1.5 text-[13px] text-ih-bad-fg">{fields.name.errors[0]}</p>
              )}
            </div>
            <div>
              <label
                htmlFor={fields.password.id}
                className="block text-[13px] font-semibold text-ih-fg-3 mb-2"
              >
                {m.auth_agent_invite_password_label()}
              </label>
              <input
                type="password"
                id={fields.password.id}
                name={fields.password.name}
                placeholder={m.auth_agent_password_placeholder()}
                aria-invalid={fields.password.errors ? true : undefined}
                className="w-full px-4 py-3 text-[15px] bg-ih-bg-card border border-ih-border rounded-xl outline-none focus:border-ih-primary focus:shadow-ih-focus transition-all text-ih-fg-1"
              />
              {fields.password.errors && (
                <p className="mt-1.5 text-[13px] text-ih-bad-fg">{fields.password.errors[0]}</p>
              )}
            </div>
          </div>

          {legal && <LegalCheckbox legal={legal} />}

          <button
            type="submit"
            disabled={submitting}
            className="w-full mt-7 px-6 py-3.5 text-[15px] font-semibold text-white bg-ih-primary rounded-xl hover:opacity-90 active:scale-[0.985] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {submitting ? m.auth_agent_invite_submit_pending() : m.auth_agent_invite_submit()}
          </button>

          {form.errors && (
            <div className="mt-4 px-4 py-3 rounded-lg bg-ih-bad-bg border border-ih-bad text-[14px] text-ih-bad-fg">
              {form.errors[0]}
            </div>
          )}
        </Form>

        <p className="mt-10 text-xs text-ih-fg-4 text-center leading-relaxed">
          {m.auth_agent_invite_footer_note()}
        </p>
      </div>
    </div>
  );
}
