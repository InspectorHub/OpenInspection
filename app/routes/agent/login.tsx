import { Form, Link, useActionData, useNavigation } from "react-router";
import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import type { Route } from "./+types/login";
import { createApi } from "~/lib/api-client.server";
import { createSessionWithToken } from "~/lib/session.server";
import { makeAgentLoginSchema, makeAgentLoginLinkSchema } from "~/lib/forms/auth.schema";
import { AuthShell } from "~/components/AuthShell";
import { Input, Button } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.auth_agent_login_meta_title() }];
}

/**
 * Spec 3 Task 5 — core (standalone/OSS) agent front door. Agents are locked
 * out of the tenant `/login` page in both password and link modes, so this
 * is their ONLY entry point. Unlike `/login` this page never bounces to a
 * SaaS portal login — it works the same in standalone and SaaS.
 *
 * Two independent forms distinguished by a hidden `intent` field (progressive-
 * enhancement safe — works with JS disabled): `password` (primary) and `link`
 * (magic-link fallback, secondary). The link path ALWAYS shows the same
 * "check your inbox" confirmation regardless of whether the email has an
 * account (anti-enumeration — the BFF action never inspects that outcome).
 */
export async function action({ request, context }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent") === "link" ? "link" : "password";

  if (intent === "link") {
    const submission = parseWithZod(formData, { schema: makeAgentLoginLinkSchema() });
    if (submission.status !== "success") {
      return submission.reply();
    }
    const { email } = submission.value;

    try {
      const api = createApi(context);
      // Fire-and-forget: the API always answers { sent: true } whether or
      // not the account exists (anti-enumeration). We never inspect it.
      await api.agentLogin["login-link"].$post({ json: { email } });
    } catch {
      // Even a transport error must not reveal anything — fall through to
      // the same confirmation state.
    }

    return { sent: true as const };
  }

  const submission = parseWithZod(formData, { schema: makeAgentLoginSchema() });
  if (submission.status !== "success") {
    return submission.reply();
  }
  const { email, password } = submission.value;

  try {
    const api = createApi(context);
    const res = await api.agentLogin.login.$post({ json: { email, password } });

    if (!res.ok) {
      // Generic message regardless of cause (unknown email vs wrong
      // password vs non-agent account) — mirrors the API's anti-oracle 401.
      return submission.reply({ formErrors: [m.auth_agent_login_error_invalid()] });
    }

    // The API mints the agent session cookie itself via Set-Cookie — the
    // JWT is NEVER in the response body (security invariant). Extract it
    // from the header and re-establish it as the RR `__session` cookie,
    // mirroring join.tsx / setup.tsx's own Set-Cookie relay.
    const setCookieHeader = res.headers.get("set-cookie") || "";
    const tokenMatch = setCookieHeader.match(/(?:inspector_token|__Host-inspector_token)=([^;]+)/);
    const jwt = tokenMatch?.[1];

    if (jwt) {
      return createSessionWithToken(context, jwt, "/agent-dashboard");
    }

    return submission.reply({ formErrors: [m.auth_agent_login_error_no_session()] });
  } catch {
    return submission.reply({ formErrors: [m.auth_login_error_network()] });
  }
}

export default function AgentLoginPage() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submittingIntent = navigation.formData?.get("intent");
  const isSubmittingPassword = navigation.state === "submitting" && submittingIntent !== "link";
  const isSubmittingLink = navigation.state === "submitting" && submittingIntent === "link";

  // The link action returns a bare `{ sent }` sentinel; only that shape (not
  // a Conform SubmissionResult) drives the confirmation view.
  const sent = actionData && "sent" in actionData ? actionData : null;
  const lastResult = actionData && !("sent" in actionData) ? actionData : undefined;

  const [form, fields] = useForm({
    lastResult,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: makeAgentLoginSchema() });
    },
    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
  });

  const [linkForm, linkFields] = useForm({
    id: "agent-login-link-form",
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: makeAgentLoginLinkSchema() });
    },
    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
  });

  if (sent) {
    return (
      <AuthShell
        heading={m.auth_agent_login_link_sent_heading()}
        subtitle={m.auth_agent_login_link_sent_subtitle()}
      >
        <p className="text-sm text-ih-fg-3">{m.auth_agent_login_link_sent_note()}</p>
        <Link
          to="/agent-login"
          className="mt-6 inline-block text-sm font-bold text-ih-primary-text hover:underline"
        >
          {m.auth_agent_login_back_link()}
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      heading={m.auth_agent_login_heading()}
      subtitle={m.auth_agent_login_subtitle()}
      footer={
        <>
          {m.auth_agent_login_no_account()}{" "}
          <Link to="/agent-signup" className="font-bold text-ih-primary-text hover:underline">
            {m.auth_agent_login_signup_link()}
          </Link>
        </>
      }
    >
      <Form method="post" id={form.id} onSubmit={form.onSubmit} noValidate className="space-y-4">
        <input type="hidden" name="intent" value="password" />
        <Input
          id={fields.email.id}
          name={fields.email.name}
          type="email"
          autoFocus
          label={m.auth_login_email_label()}
          aria-invalid={fields.email.errors ? true : undefined}
          error={fields.email.errors?.[0]}
        />
        <Input
          id={fields.password.id}
          name={fields.password.name}
          type="password"
          label={m.auth_login_password_label()}
          aria-invalid={fields.password.errors ? true : undefined}
          error={fields.password.errors?.[0]}
        />

        {form.errors && (
          <div className="px-3 py-2 rounded-lg bg-ih-bad-bg border border-ih-bad text-sm text-ih-bad-fg">
            {form.errors[0]}
          </div>
        )}

        <Button type="submit" variant="primary" size="lg" disabled={isSubmittingPassword} className="w-full">
          {isSubmittingPassword ? m.auth_agent_login_submit_pending() : m.auth_agent_login_submit()}
        </Button>
      </Form>

      <div className="my-4 flex items-center gap-3">
        <div className="h-px flex-1 bg-ih-border" />
        <span className="text-xs font-bold uppercase tracking-wide text-ih-fg-3">
          {m.auth_agent_login_or_divider()}
        </span>
        <div className="h-px flex-1 bg-ih-border" />
      </div>

      <Form
        method="post"
        id={linkForm.id}
        onSubmit={linkForm.onSubmit}
        noValidate
        className="space-y-2"
      >
        <input type="hidden" name="intent" value="link" />
        <Input
          id={linkFields.email.id}
          name={linkFields.email.name}
          type="email"
          label={m.auth_login_email_label()}
          aria-invalid={linkFields.email.errors ? true : undefined}
          error={linkFields.email.errors?.[0]}
        />
        <Button type="submit" variant="link" size="sm" disabled={isSubmittingLink} className="px-0">
          {isSubmittingLink ? m.auth_agent_login_link_submit_pending() : m.auth_agent_login_link_cta()}
        </Button>
      </Form>
    </AuthShell>
  );
}
