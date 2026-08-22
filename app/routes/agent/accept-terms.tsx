import { Form, useActionData, useLoaderData, useNavigation, redirect } from "react-router";
import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import type { Route } from "./+types/accept-terms";
import { createApi } from "~/lib/api-client.server";
import { requireToken } from "~/lib/session.server";
import { makeAgentTermsAcceptSchema } from "~/lib/forms/auth.schema";
import { safeReturnTo } from "../../../server/lib/mcp/safe-return-to";
import { AgentTermsConsent, type AgentTermsInForce } from "~/components/agent/AgentTermsConsent";
import { Banner } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

/**
 * The screen a signed-in agent is stopped on when their account holds no
 * acceptance of the agent terms in force.
 *
 * Three doors lead to an agent session and only signup passes a consent screen;
 * password login and the emailed magic link mint a cookie for an account that
 * already exists and ask it nothing. `server/lib/middleware/agent-terms-gate.ts`
 * is what actually refuses those requests — this page is the way out of it, and
 * the reason the refusal is a 428 rather than a 401 or a 403: the session is
 * fine, the account is fine, and there is exactly one thing to do.
 *
 * ── Why it is NOT inside agent-layout ───────────────────────────────────────
 * That layout's loader is what turns the gate's 428 into a redirect to here. A
 * page under it would redirect to itself, forever. It keeps the `agent-` URL
 * prefix regardless, because `loginPathFor` in session.server.ts derives the
 * sign-in door from that prefix — without it, an expired session on this page
 * would land the agent on the STAFF login, which has no account for them.
 *
 * The consent block is `AgentTermsConsent`, the same component the signup page
 * renders. One presentation, so the body a signer is shown here cannot drift
 * from the body a signer is shown there — and the acceptance names the hash of
 * the whole body, so a divergent presentation would make the record describe
 * something one of the two audiences never saw.
 */

export function meta() {
  return [{ title: m.auth_agent_accept_terms_meta_title() }];
}

/**
 * Where an agent is sent after accepting.
 *
 * Same-origin relative paths only (`safeReturnTo`), and then narrowed further to
 * the agent surface: every agent page is mounted under the `agent-` prefix, so
 * anything else is either a staff page they cannot open or a way to bounce them
 * somewhere unexpected right after a consent. This page is excluded from its own
 * return target — landing back here after accepting reads as the acceptance
 * having failed.
 */
export function agentReturnTo(raw: string | null): string {
  const fallback = "/agent-dashboard";
  const safe = safeReturnTo(raw, fallback);
  if (!safe.startsWith("/agent-")) return fallback;
  if (safe.split("?")[0] === "/agent-accept-terms") return fallback;
  return safe;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  const returnTo = agentReturnTo(new URL(request.url).searchParams.get("returnTo"));

  // The terms are SHOWN, not linked. The tick says "I have read and accept" and
  // the record names the hash of the whole body, so a page that displayed
  // nothing would record a presentation that never happened.
  //
  // `GET /api/agent-signup/terms` is the one read endpoint for this document —
  // it already exists for the signup page and is public because that page runs
  // before anyone has an account. A second read path here would be a second
  // thing to keep in step with the registry.
  const api = createApi(context, { token });
  let terms: AgentTermsInForce | null = null;
  try {
    const res = await api.agentSignup.terms.$get();
    if (res.ok) {
      const json = (await res.json()) as { data?: AgentTermsInForce };
      terms = json.data ?? null;
    }
  } catch {
    // Null renders the "nothing to accept" state below rather than a tick
    // against an absent document.
    terms = null;
  }
  return { terms, returnTo };
}

export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const fd = await request.formData();
  const submission = parseWithZod(fd, { schema: makeAgentTermsAcceptSchema() });
  if (submission.status !== "success") {
    return submission.reply();
  }

  // What this page actually rendered, round-tripped by AgentTermsConsent. NOT
  // the evidence — the server records the hash it read itself. It is here so a
  // page left open across a publish is refused rather than recording an
  // acceptance of a version its signer was never shown.
  const shownRaw = fd.get("shownContentHash");
  const shownContentHash =
    typeof shownRaw === "string" && /^[0-9a-f]{64}$/.test(shownRaw) ? shownRaw : null;
  if (!shownContentHash) {
    return submission.reply({ formErrors: [m.auth_agent_accept_terms_error_stale()] });
  }

  const api = createApi(context, { token });
  const res = await api.agentTerms["accept-terms"].$post({
    json: { accepted: true as const, shownContentHash },
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || !json.success) {
    const err = json.error as Record<string, string> | undefined;
    return submission.reply({
      formErrors: [err?.message || m.auth_agent_accept_terms_error_failed()],
    });
  }

  // Re-sanitised here as well as in the loader: the hidden field travelled
  // through the browser, and the loader's pass says nothing about what came back.
  const returnToRaw = fd.get("returnTo");
  return redirect(agentReturnTo(typeof returnToRaw === "string" ? returnToRaw : null));
}

export default function AgentAcceptTermsPage() {
  const { terms, returnTo } = useLoaderData<typeof loader>();
  const lastResult = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const [form, fields] = useForm({
    lastResult,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: makeAgentTermsAcceptSchema() });
    },
    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
  });

  return (
    <div className="min-h-screen bg-ih-bg-app flex flex-col justify-center px-6 py-12">
      <div className="w-full max-w-[560px] mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <img src="/logo.svg" alt="" className="w-8 h-8" width={32} height={32} />
          <span className="font-serif font-bold text-lg tracking-tight text-ih-fg-1">
            OpenInspection
          </span>
        </div>

        <div className="rounded-ih-card border border-ih-border bg-ih-bg-card p-6 sm:p-8">
          <h1 className="text-2xl font-bold tracking-tight text-ih-fg-1 mb-2">
            {m.auth_agent_accept_terms_heading()}
          </h1>
          <p className="text-[15px] leading-relaxed text-ih-fg-3 mb-6">
            {m.auth_agent_accept_terms_subtitle()}
          </p>

          {terms ? (
            <Form method="post" id={form.id} onSubmit={form.onSubmit} noValidate>
              <input type="hidden" name="returnTo" value={returnTo} />
              <AgentTermsConsent
                terms={terms}
                checkboxId={fields.agentTerms.id}
                checkboxName={fields.agentTerms.name}
                error={fields.agentTerms.errors?.[0]}
              />
              <button
                type="submit"
                disabled={submitting}
                className="w-full mt-7 px-6 py-3.5 text-[15px] font-semibold text-ih-fg-inverse bg-ih-primary rounded-xl hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
              >
                {submitting
                  ? m.auth_agent_accept_terms_submit_pending()
                  : m.auth_agent_accept_terms_submit()}
              </button>
              {form.errors && (
                <div className="mt-4 px-4 py-3 rounded-lg bg-ih-bad-bg border border-ih-bad text-[14px] text-ih-bad-fg">
                  {form.errors[0]}
                </div>
              )}
            </Form>
          ) : (
            // Nothing published, so there is nothing to accept and no tick is
            // offered. The agent cannot resolve this and the copy says whose
            // action it is instead of implying theirs.
            <Banner tone="warn">
              <span className="font-semibold">
                {m.auth_agent_accept_terms_unavailable_title()}
              </span>
              <span className="mt-1 block">
                {m.auth_agent_accept_terms_unavailable_body()}
              </span>
            </Banner>
          )}
        </div>

        <p className="mt-6 text-[14px] text-ih-fg-3 text-center">
          {/*
            A plain link, not a fetcher: signing out must work from a page whose
            whole purpose is that the rest of the product is refusing this
            session. `/agent-logout` tears the session down and lands on the
            agent sign-in, never the staff one.
          */}
          <a href="/agent-logout" className="text-ih-primary-text font-medium hover:underline">
            {m.auth_agent_accept_terms_sign_out()}
          </a>
        </p>
      </div>
    </div>
  );
}
