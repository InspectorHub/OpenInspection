import { Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";
import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import type { Route } from "./+types/signup";
import { createApi } from "~/lib/api-client.server";
import { agentSignupSchema } from "~/lib/forms/auth.schema";
import { readLegalLinks } from "~/lib/legal-links.server";
import { LegalCheckbox } from "~/components/LegalCheckbox";

export function meta() {
  return [{ title: "Become a partner agent - OpenInspection" }];
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ context }: Route.LoaderArgs) {
  const legal = readLegalLinks(context);
  return { legal };
}

/* ------------------------------------------------------------------ */
/*  Action                                                             */
/* ------------------------------------------------------------------ */

export async function action({ request, context }: Route.ActionArgs) {
  const fd = await request.formData();
  // Turnstile token is not a validated form field — it passes through.
  const turnstileTokenRaw = fd.get("cf-turnstile-response");
  const submission = parseWithZod(fd, { schema: agentSignupSchema });
  if (submission.status !== "success") {
    return submission.reply();
  }
  const { name, email, password } = submission.value;
  const body = {
    name,
    email,
    password,
    ...(turnstileTokenRaw ? { turnstileToken: String(turnstileTokenRaw) } : {}),
    termsAccepted: fd.get("termsAccepted") === "on",
  };

  const api = createApi(context);
  const res = await api.agentSignup.index.$post({ json: body });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || !(json as Record<string, unknown>).success) {
    const err = json.error as Record<string, string> | undefined;
    if (err?.code === "conflict") {
      return submission.reply({ formErrors: ["That email is already registered. Log in instead."] });
    }
    return submission.reply({ formErrors: [err?.message || "Could not create account"] });
  }

  const data = json.data as Record<string, string> | undefined;
  // Success: keep the client-side redirect path (sentinel object, not a
  // Conform SubmissionResult — the component guards on `redirect`).
  return { redirect: data?.redirect || "/agent-dashboard" };
}

/* ------------------------------------------------------------------ */
/*  Value proposition items                                            */
/* ------------------------------------------------------------------ */

const VALUE_PROPS = [
  {
    num: "1",
    bold: "See every referred inspection.",
    text: "One dashboard, every inspector you work with.",
  },
  {
    num: "2",
    bold: "Subscribe to availability.",
    text: "Calendar feeds keep the dates your inspectors are open in your own calendar app.",
  },
  {
    num: "3",
    bold: "Free forever.",
    text: "No fees, no card on file. Your inspectors pay for the platform.",
  },
];

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function AgentSignupPage() {
  const { legal } = useLoaderData<typeof loader>();
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
      return parseWithZod(formData, { schema: agentSignupSchema });
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
            Become a partner agent
          </h1>
          {/* ds-allow: light tint text on the fixed-dark marketing panel */}
          <p className="text-base leading-relaxed text-stone-300 mb-8">
            The free way for real-estate agents to track every inspection
            their inspectors completed for clients they referred.
          </p>
          <ul className="space-y-0">
            {VALUE_PROPS.map((v) => (
              <li
                key={v.num}
                className="flex gap-3.5 py-4 border-t border-white/[0.08] last:border-b"
              >
                <span className="w-7 h-7 rounded-full bg-ih-primary text-white flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
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
            Create your free account
          </h2>
          <p className="text-[15px] text-ih-fg-3 leading-relaxed mb-8">
            Takes about a minute. Already invited? Use the link in your email
            instead -- it pre-fills the right tenant.
          </p>

          <Form method="post" autoComplete="off" id={form.id} onSubmit={form.onSubmit} noValidate>
            <div className="space-y-5">
              <div>
                <label
                  htmlFor={fields.name.id}
                  className="block text-[13px] font-semibold text-ih-fg-3 mb-2"
                >
                  Full name
                </label>
                <input
                  type="text"
                  id={fields.name.id}
                  name={fields.name.name}
                  placeholder="Jane Smith"
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
                  Work email
                </label>
                <input
                  type="email"
                  id={fields.email.id}
                  name={fields.email.name}
                  placeholder="jane@realty.com"
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
                  Password
                </label>
                <input
                  type="password"
                  id={fields.password.id}
                  name={fields.password.name}
                  placeholder="At least 12 characters"
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
              className="w-full mt-7 px-6 py-3.5 text-[15px] font-semibold text-white bg-ih-primary rounded-xl hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
            >
              {submitting ? "Creating account..." : "Create account"}
            </button>

            {form.errors && (
              <div className="mt-4 px-4 py-3 rounded-lg bg-ih-bad-bg border border-ih-bad text-[14px] text-ih-bad-fg">
                {form.errors[0]}
              </div>
            )}
          </Form>

          <p className="mt-6 text-[14px] text-ih-fg-3 text-center">
            Already have an account?{" "}
            <Link
              to="/login"
              className="text-ih-primary font-medium hover:underline"
            >
              Log in
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}
