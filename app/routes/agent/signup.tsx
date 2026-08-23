import { Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";
import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import type { Route } from "./+types/signup";
import { createApi } from "~/lib/api-client.server";
import { createSessionWithToken } from "~/lib/session.server";
import { makeAgentSignupSchema } from "~/lib/forms/auth.schema";
import { safeReturnTo } from "../../../server/lib/mcp/safe-return-to";
import { AgentTermsConsent, type AgentTermsInForce } from "~/components/agent/AgentTermsConsent";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.auth_agent_signup_meta_title() }];
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  // Report-link conversion (Task 3's CTA): prefill the email of the
  // recipient the report was shared with, and preserve a same-origin
  // returnTo so a successful signup lands back on that report. safeReturnTo
  // gates it to same-origin relative paths — an attacker-supplied
  // ?returnTo=https://evil.com or //evil.com is discarded here.
  const email = url.searchParams.get("email") ?? "";
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"), "");

  // The terms have to be SHOWN, not referred to. The tick below says "I have read
  // and accept the Agent Terms" and the account records the version and content
  // hash of "the text shown" — while this page displayed nothing and linked
  // nowhere, so the acceptance asserted a presentation that never happened. Same
  // defect review review §26d-2 closed for e-signature: intent comes from a
  // recorded act, never from an artefact existing.
  //
  // A null document is the deployment having published none, and signup is closed
  // in that case (review). The page says so instead of offering a tick against
  // nothing.
  const api = createApi(context);
  let terms: AgentTermsInForce | null = null;
  try {
    const res = await api.agentSignup.terms.$get();
    if (res.ok) {
      const json = (await res.json()) as { data?: AgentTermsInForce };
      terms = json.data ?? null;
    }
  } catch {
    // Treated as "unavailable", which closes signup. A page that swallowed this
    // and rendered the tick anyway would be back to accepting an absent document.
    terms = null;
  }
  return { email, returnTo, terms };
}

/* ------------------------------------------------------------------ */
/*  Report-link conversion helper                                      */
/* ------------------------------------------------------------------ */

// Matches the tokenized report path a converting agent's returnTo carries
// (`/portal/:tenant/i/:inspectionId?token=...`) and extracts the inspection
// id. A converting agent already has that inspection auto-linked into their
// referrals server-side (Task 3), so we can land them on the dashboard with
// it highlighted instead of bouncing them back to the tokenized report.
const REPORT_PATH_RE = /^\/portal\/[^/]+\/i\/([^/?#]+)/;

function welcomeRedirectFor(returnTo: string): string | null {
  const match = returnTo.match(REPORT_PATH_RE);
  return match ? `/agent-dashboard?welcome=${encodeURIComponent(match[1])}` : null;
}

/* ------------------------------------------------------------------ */
/*  Action                                                             */
/* ------------------------------------------------------------------ */

export async function action({ request, context }: Route.ActionArgs) {
  const fd = await request.formData();
  // Turnstile token is not a validated form field — it passes through.
  const turnstileTokenRaw = fd.get("cf-turnstile-response");
  const submission = parseWithZod(fd, { schema: makeAgentSignupSchema() });
  if (submission.status !== "success") {
    return submission.reply();
  }
  const { name, email, password } = submission.value;
  const shownContentHashRaw = fd.get("shownContentHash");
  const shownContentHash = typeof shownContentHashRaw === "string"
    && /^[0-9a-f]{64}$/.test(shownContentHashRaw) ? shownContentHashRaw : "";
  const body = {
    name,
    email,
    password,
    // The tick, and only the tick. `agentTerms` is a literal "on" in the schema,
    // so reaching here means the box was checked.
    termsAccepted: true,
    // What this page actually displayed. NOT evidence — the server records the
    // hash it read itself, because a client-supplied hash is the client asserting
    // what it read, which is what the record exists to replace. It is here so a
    // page left open across a publish is REFUSED rather than recording an
    // acceptance of a version the signer was never shown.
    ...(shownContentHash ? { shownContentHash } : {}),
    ...(turnstileTokenRaw ? { turnstileToken: String(turnstileTokenRaw) } : {}),
  };

  const api = createApi(context);
  const res = await api.agentSignup.index.$post({ json: body });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || !(json as Record<string, unknown>).success) {
    const err = json.error as Record<string, string> | undefined;
    if (err?.code === "conflict") {
      return submission.reply({ formErrors: [m.auth_agent_signup_error_conflict()] });
    }
    return submission.reply({ formErrors: [err?.message || m.auth_agent_signup_error_failed()] });
  }

  // Re-sanitize returnTo server-side — never trust the hidden field blindly,
  // even though the loader already sanitized it once (defense in depth).
  const returnToRaw = fd.get("returnTo");
  const returnTo = safeReturnTo(typeof returnToRaw === "string" ? returnToRaw : null, "");

  const data = json.data as Record<string, string> | undefined;
  // A report-path returnTo (Task 3/4's report-link conversion) sends the
  // agent to their dashboard with that inspection highlighted, rather than
  // back to the tokenized report or the API's own generic redirect — checked
  // FIRST because POST /api/agent-signup (server/api/agent-signup.ts) always
  // answers a static `redirect: '/agent-dashboard'` with no welcome-highlight
  // awareness of its own, so an API-redirect-first precedence would make this
  // branch permanently unreachable for real traffic. Otherwise an explicit,
  // more-specific API-provided redirect wins; otherwise a non-report-path
  // returnTo; otherwise /agent-dashboard.
  const target = welcomeRedirectFor(returnTo) || data?.redirect || returnTo || "/agent-dashboard";

  // POST /api/agent-signup mints the agent session cookie itself via
  // Set-Cookie on ITS OWN response (server/api/agent-signup.ts) — but that
  // response is an in-process self-binding call (createApi's buildFetch),
  // so nothing forwards it to the browser unless this action does so
  // explicitly. Mirrors agent/login.tsx's action exactly: extract the JWT
  // from the raw Set-Cookie header and re-establish it as the RR `__session`
  // cookie via createSessionWithToken, which also performs the redirect —
  // so a converting agent actually lands on /agent-dashboard AUTHENTICATED
  // rather than bouncing through requireToken() back to /login.
  const setCookieHeader = res.headers?.get?.("set-cookie") || "";
  const tokenMatch = setCookieHeader.match(/(?:inspector_token|__Host-inspector_token)=([^;]+)/);
  const jwt = tokenMatch?.[1];
  if (jwt) {
    return createSessionWithToken(context, jwt, target);
  }

  // Fall back to the client-side redirect sentinel (the component guards on
  // `redirect`) if the API response somehow carried no Set-Cookie — should
  // not happen in practice, but degrades to the previous behavior rather
  // than stranding the user on a blank page.
  return { redirect: target };
}

/* ------------------------------------------------------------------ */
/*  Value proposition items                                            */
/* ------------------------------------------------------------------ */

// Built by a factory (called per render) so the copy resolves against the
// active locale rather than freezing at module import time.
function makeValueProps() {
  return [
    {
      num: "1",
      bold: m.auth_agent_signup_prop1_bold(),
      text: m.auth_agent_signup_prop1_text(),
    },
    {
      num: "2",
      bold: m.auth_agent_signup_prop2_bold(),
      text: m.auth_agent_signup_prop2_text(),
    },
    {
      num: "3",
      bold: m.auth_agent_signup_prop3_bold(),
      text: m.auth_agent_signup_prop3_text(),
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function AgentSignupPage() {
  const { email, returnTo, terms } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  // Success returns a `{ redirect }` sentinel; errors return a Conform
  // SubmissionResult. Only the latter feeds `useForm`.
  const successRedirect =
    actionData && "redirect" in actionData ? actionData.redirect : null;
  const lastResult =
    actionData && "redirect" in actionData ? undefined : actionData;

  // Client-side redirect after successful action
  if (typeof window !== "undefined" && successRedirect) {
    window.location.href = successRedirect;
  }

  const [form, fields] = useForm({
    lastResult,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: makeAgentSignupSchema() });
    },
    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
  });

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2">
      {/* Left: editorial value-prop */}
      {/* ds-allow: fixed-dark marketing panel */}
      <aside className="relative flex flex-col justify-center px-8 py-12 lg:px-12 bg-slate-900 text-white overflow-hidden">
        <div className="absolute w-[480px] h-[480px] -right-[120px] -top-[160px] bg-ih-primary blur-[140px] opacity-35 pointer-events-none" />
        <div className="relative z-10 max-w-[460px] mx-auto">
          <div className="flex items-center gap-3 mb-12">
            <img src="/logo.svg" alt="" className="w-8 h-8" width={32} height={32} />
            <span className="font-serif font-bold text-lg tracking-tight">
              OpenInspection
            </span>
          </div>
          <h1 className="font-serif font-bold text-[2.75rem] leading-[1.05] tracking-tight mb-5">
            {m.auth_agent_signup_heading()}
          </h1>
          {/* ds-allow: light tint text on the fixed-dark marketing panel */}
          <p className="text-base leading-relaxed text-stone-300 mb-8">
            {m.auth_agent_signup_panel_text()}
          </p>
          <ul className="space-y-0">
            {makeValueProps().map((v) => (
              <li
                key={v.num}
                className="flex gap-3.5 py-4 border-t border-white/[0.08] last:border-b"
              >
                <span className="w-7 h-7 rounded-full bg-ih-primary text-ih-fg-inverse flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                  {v.num}
                </span>
                {/* ds-allow: light tint text on the fixed-dark marketing panel */}
                <span className="text-[15px] leading-relaxed text-stone-200">
                  <strong className="text-white font-semibold">{v.bold}</strong>{" "}
                  {v.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* Right: form */}
      <section className="flex flex-col justify-center px-8 py-12 lg:px-12 bg-ih-bg-card">
        <div className="max-w-[420px] w-full mx-auto">
          <h2 className="text-2xl font-bold tracking-tight mb-2 text-ih-fg-1">
            {m.auth_agent_signup_form_heading()}
          </h2>
          <p className="text-[15px] text-ih-fg-3 leading-relaxed mb-8">
            {m.auth_agent_signup_form_subtitle()}
          </p>

          <Form method="post" autoComplete="off" id={form.id} onSubmit={form.onSubmit} noValidate>
            {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
            <div className="space-y-5">
              <div>
                <label
                  htmlFor={fields.name.id}
                  className="block text-[13px] font-semibold text-ih-fg-3 mb-2"
                >
                  {m.auth_join_name_label()}
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
                  htmlFor={fields.email.id}
                  className="block text-[13px] font-semibold text-ih-fg-3 mb-2"
                >
                  {m.auth_agent_signup_email_label()}
                </label>
                <input
                  type="email"
                  id={fields.email.id}
                  name={fields.email.name}
                  defaultValue={email}
                  placeholder={m.auth_agent_signup_email_placeholder()}
                  aria-invalid={fields.email.errors ? true : undefined}
                  className="w-full px-4 py-3 text-[15px] bg-ih-bg-card border border-ih-border rounded-xl outline-none focus:border-ih-primary focus:shadow-ih-focus transition-all text-ih-fg-1"
                />
                {fields.email.errors && (
                  <p className="mt-1.5 text-[13px] text-ih-bad-fg">{fields.email.errors[0]}</p>
                )}
              </div>
              <div>
                <label
                  htmlFor={fields.password.id}
                  className="block text-[13px] font-semibold text-ih-fg-3 mb-2"
                >
                  {m.auth_login_password_label()}
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

            {/*
              An agent is a third party. The tick is required and the account is
              not created without it — recording a consent somebody did not give
              is worse than lacking one (review review A3). Only the tick is
              submitted; the version and content hash of the text shown are
              recorded server-side from the document in force.
            */}
            <div className="mt-6">
              <AgentTermsConsent
                terms={terms}
                checkboxId={fields.agentTerms.id}
                checkboxName={fields.agentTerms.name}
                error={fields.agentTerms.errors?.[0]}
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full mt-7 px-6 py-3.5 text-[15px] font-semibold text-ih-fg-inverse bg-ih-primary rounded-xl hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
            >
              {submitting ? m.auth_agent_signup_submit_pending() : m.auth_agent_signup_submit()}
            </button>

            {form.errors && (
              <div className="mt-4 px-4 py-3 rounded-lg bg-ih-bad-bg border border-ih-bad text-[14px] text-ih-bad-fg">
                {form.errors[0]}
              </div>
            )}

            {/* "You can unsubscribe at any time."
                This string had no consumer anywhere in the tree, and until the
                signed unsubscribe link existed it could not honestly have one —
                an agent held by the agent-terms gate could not reach the
                preferences screen, and no email carried a way out. It says what
                is now true, so it is shown where the agreeing happens.

                The key is named `..._invite_...` because it was written for an
                `/agent-invite/:token` page that no longer exists in this repo.
                The signup form is the surviving surface where an agent accepts
                this, so the text moved and the key did not — renaming a message
                key is a translation-catalog change, not a copy change. */}
            <p className="mt-4 text-[13px] text-ih-fg-3 text-center">
              {m.auth_agent_invite_footer_note()}
            </p>
          </Form>

          <p className="mt-6 text-[14px] text-ih-fg-3 text-center">
            {m.auth_agent_signup_have_account()}{" "}
            <Link
              // NOT `/login`: an agent is locked out of the tenant login in
              // both modes (see routes/agent/login.tsx), so this is the only
              // sign-in that can accept the account they are being sent to.
              to="/agent-login"
              className="text-ih-primary-text font-medium hover:underline"
            >
              {m.auth_agent_signup_login_link()}
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}
