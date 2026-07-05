import { Form, useActionData, useNavigation, redirect } from "react-router";
import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import type { Route } from "./+types/forgot-password";
import { createApi } from "~/lib/api-client.server";
import { forgotPasswordSchema } from "~/lib/forms/auth.schema";
import { AuthShell } from "~/components/AuthShell";

export function meta() {
  return [{ title: "Reset your password - OpenInspection" }];
}

export async function loader({ context }: Route.LoaderArgs) {
  // SaaS deploys own the identity layer on the portal — bounce the page so
  // app.<domain>/forgot-password never renders a dead form. Mirrors login.tsx.
  const env = (context as { cloudflare?: { env?: { APP_MODE?: string; PORTAL_API_URL?: string } } })
    ?.cloudflare?.env;
  if (env?.APP_MODE === "saas" && env.PORTAL_API_URL) {
    return redirect(`${env.PORTAL_API_URL.replace(/\/$/, "")}/forgot-password`);
  }
  return null;
}

export async function action({ request, context }: Route.ActionArgs) {
  const formData = await request.formData();
  const submission = parseWithZod(formData, { schema: forgotPasswordSchema });
  if (submission.status !== "success") {
    return submission.reply();
  }
  const { email } = submission.value;

  try {
    const api = createApi(context);
    // Fire-and-forget: the backend answers 200 whether or not the account
    // exists (anti-enumeration). We never inspect the result.
    await api.auth["forgot-password"].$post({ json: { email } });
  } catch {
    // Even a transport error must not reveal anything — fall through to the
    // same confirmation state.
  }

  return { sent: true, email };
}

export default function ForgotPasswordPage() {
  const actionData = useActionData<typeof action>();
  const sent = actionData && "sent" in actionData ? actionData : null;
  // When the action returned the confirmation payload there is no Conform
  // result to thread back into the form.
  const lastResult = actionData && "sent" in actionData ? undefined : actionData;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [form, fields] = useForm({
    lastResult,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: forgotPasswordSchema });
    },
    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
  });

  if (sent) {
    return (
      <AuthShell
        heading="Check your inbox"
        subtitle={
          <>
            If an account exists for{" "}
            <strong className="text-ih-fg-1">{sent.email}</strong>, we've sent a
            password reset link.
          </>
        }
      >
        <p className="text-sm text-ih-fg-3">
          The link expires in 1 hour. Check your spam folder if it doesn't arrive.
        </p>
        <a
          href="/forgot-password"
          className="mt-6 inline-block text-sm font-bold text-ih-primary hover:underline"
        >
          Use a different email
        </a>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      heading="Reset your password"
      subtitle="Enter your email and we'll send you a reset link."
      footer={
        <a href="/login" className="font-bold text-ih-primary hover:underline">
          Back to log in
        </a>
      }
    >
      <Form method="post" id={form.id} onSubmit={form.onSubmit} noValidate className="space-y-4">
        <div>
          <label htmlFor={fields.email.id} className="block text-xs font-bold text-ih-fg-3 mb-1">
            Email address
          </label>
          <input
            id={fields.email.id}
            name={fields.email.name}
            type="email"
            autoFocus
            aria-invalid={fields.email.errors ? true : undefined}
            className="w-full px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-ih-fg-1 text-sm focus:shadow-ih-focus focus:border-ih-primary outline-none"
          />
          {fields.email.errors && (
            <p className="mt-1 text-xs text-ih-bad-fg">{fields.email.errors[0]}</p>
          )}
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full py-2.5 rounded-lg bg-ih-primary text-white font-bold text-sm hover:bg-ih-primary-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isSubmitting ? "Sending…" : "Send reset link"}
        </button>
      </Form>
    </AuthShell>
  );
}
