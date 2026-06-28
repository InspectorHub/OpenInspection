import { useState } from "react";
import { Form, type useFetcher, type useRevalidator } from "react-router";
import { SecretField } from "~/components/SecretField";
import { TestConnectionButton } from "~/components/settings/TestConnectionButton";
import { ConnectionTestStatus, type ConnectionTestResult } from "~/components/settings/ConnectionTestStatus";
import { WebhookStatusBadge } from "./WebhookStatusBadge";
import type { action } from "~/routes/settings-integrations";

type WebhookLogEntry = { ts: string; eventType: string; result: string };

/**
 * Eager-after-error prefix rules for the Stripe trio. Masked (unchanged,
 * contains •) and empty values are skipped — they mean "no change".
 */
const STRIPE_FIELD_RULES: Array<[string, RegExp, string]> = [
  ["STRIPE_PUBLISHABLE_KEY", /^pk_(test|live)_/, "Must start with pk_test_ or pk_live_."],
  ["STRIPE_SECRET_KEY", /^(sk|rk)_(test|live)_/, "Must start with sk_test_ or sk_live_."],
  ["STRIPE_WEBHOOK_SECRET", /^whsec_/, "Must start with whsec_."],
];

function validateStripeForm(fd: FormData): Record<string, string> {
  const errs: Record<string, string> = {};
  for (const [name, re, msg] of STRIPE_FIELD_RULES) {
    const v = fd.get(name);
    if (typeof v === "string" && v.trim() && !v.includes("•") && !re.test(v.trim())) {
      errs[name] = msg;
    }
  }
  return errs;
}

interface StripePaymentsPanelProps {
  secrets: {
    STRIPE_PUBLISHABLE_KEY: string;
    STRIPE_SECRET_KEY: string;
    STRIPE_WEBHOOK_SECRET: string;
  };
  webhookUrl: string;
  webhookLog: WebhookLogEntry[];
  saving: boolean;
  serverField: string | null;
  serverError: string | null | undefined;
  testFetcher: ReturnType<typeof useFetcher<typeof action>>;
  revalidator: ReturnType<typeof useRevalidator>;
  /** Persisted "Test connection" history (shared loader list, filtered to stripe). */
  testResults?: ConnectionTestResult[];
}

export function StripePaymentsPanel({
  secrets,
  webhookUrl,
  webhookLog,
  saving,
  serverField,
  serverError,
  testFetcher,
  revalidator,
  testResults = [],
}: StripePaymentsPanelProps) {
  // Eager-after-error client validation: validate on submit; after the first
  // failed submit, re-validate on every change inside the form.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submittedOnce, setSubmittedOnce] = useState(false);

  const fieldError = (name: string): string | undefined =>
    fieldErrors[name] ?? (serverField === name ? serverError ?? undefined : undefined);

  return (
    <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5">
      <div className="flex items-center gap-3">
        <div
          className="w-8 h-8 rounded-md flex items-center justify-center text-white text-[10px] font-extrabold"
          style={{ backgroundColor: "#635BFF" }}
        >
          ST
        </div>
        <div>
          <h3 className="text-[13px] font-bold text-ih-fg-1">Stripe payments</h3>
          <p className="text-[11px] text-ih-fg-3">Connect your own Stripe account to accept card payments on invoices.</p>
        </div>
      </div>

      {/* Test-mode guidance — start in the Stripe sandbox */}
      <div className="rounded-md bg-ih-bg-muted border border-ih-border px-4 py-3 text-[12px] text-ih-fg-3 leading-relaxed">
        <span className="font-semibold text-ih-fg-2">Start in test mode.</span> Use your{" "}
        <span className="font-mono">pk_test_…</span> / <span className="font-mono">sk_test_…</span> keys from{" "}
        <a href="https://dashboard.stripe.com/test/apikeys" target="_blank" rel="noopener noreferrer" className="text-ih-primary hover:underline">
          dashboard.stripe.com/test/apikeys
        </a>{" "}
        and pay with card <span className="font-mono">4242&nbsp;4242&nbsp;4242&nbsp;4242</span> (any future date / CVC) to verify the flow before going live.
      </div>

      <Form
        method="post"
        className="space-y-4 max-w-xl"
        onSubmit={(e) => {
          const errs = validateStripeForm(new FormData(e.currentTarget));
          setSubmittedOnce(true);
          setFieldErrors(errs);
          if (Object.keys(errs).length > 0) e.preventDefault();
        }}
        onChange={(e) => {
          if (submittedOnce) {
            setFieldErrors(validateStripeForm(new FormData(e.currentTarget)));
          }
        }}
      >
        <input type="hidden" name="intent" value="save-stripe-secrets" />
        <SecretField
          name="STRIPE_PUBLISHABLE_KEY"
          label="Publishable Key"
          value={secrets.STRIPE_PUBLISHABLE_KEY}
          error={fieldError("STRIPE_PUBLISHABLE_KEY")}
          hint="Sent to the browser to render the card field. Starts with pk_test_ (test) or pk_live_ (live)."
        />
        <SecretField
          name="STRIPE_SECRET_KEY"
          label="Secret Key"
          value={secrets.STRIPE_SECRET_KEY}
          error={fieldError("STRIPE_SECRET_KEY")}
          hint="Server-side key that creates the charge. Starts with sk_test_ or sk_live_. Never shared with the browser."
        />
        <SecretField
          name="STRIPE_WEBHOOK_SECRET"
          label="Webhook Signing Secret"
          value={secrets.STRIPE_WEBHOOK_SECRET}
          error={fieldError("STRIPE_WEBHOOK_SECRET")}
          hint="Verifies payment notifications. Found after you add the webhook endpoint below (starts with whsec_)."
        />
        <div className="flex justify-end pt-2 border-t border-ih-border">
          <button type="submit" disabled={saving}
            className="h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 active:scale-[.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed">
            {saving ? "Saving…" : "Save Stripe keys"}
          </button>
        </div>
      </Form>

      {/* Test connection — probes the STORED secret key, no re-entry needed */}
      <TestConnectionButton fetcher={testFetcher} intent="test-stripe">
        {testFetcher.data?.intent === "test-stripe" && testFetcher.data.test && (
          <span className="text-[12px] text-ih-fg-2">
            Connected: <span className="font-semibold">{testFetcher.data.test.accountName}</span>
            <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest ${
              testFetcher.data.test.livemode
                ? "bg-ih-bad-bg text-ih-bad-fg"
                : "bg-ih-ok-bg text-ih-ok-fg"
            }`}>
              {testFetcher.data.test.livemode ? "Live" : "Test"}
            </span>
          </span>
        )}
        {testFetcher.data?.intent === "test-stripe" && !testFetcher.data.success && (
          <span className="text-[12px] text-ih-bad-fg">{testFetcher.data.error}</span>
        )}
      </TestConnectionButton>

      {/* Persisted last-tested status + recent history (survives reloads). */}
      <ConnectionTestStatus results={testResults} target="stripe" />

      {/* Webhook endpoint to register in the Stripe dashboard */}
      <div className="pt-1 space-y-1.5">
        <p className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.14em]">Webhook endpoint</p>
        <p className="text-[12px] text-ih-fg-3 leading-relaxed">
          In Stripe → Developers → Webhooks, add an endpoint for the{" "}
          <span className="font-semibold text-ih-fg-2">payment_intent.succeeded</span> event pointing at this URL, then paste its signing secret above.
          If you registered an endpoint before, re-point it to this URL — the signing secret stays the same.
        </p>
        <code className="block w-full px-3 py-2 rounded-md bg-ih-bg-muted border border-ih-border text-[12px] font-mono text-ih-fg-1 break-all select-all">
          {webhookUrl}
        </code>
      </div>

      {/* Recent webhook deliveries — diagnostics log */}
      <div className="pt-3 space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.14em]">Recent webhook deliveries</p>
          <button type="button" onClick={() => revalidator.revalidate()}
            disabled={revalidator.state !== "idle"}
            className="h-7 px-2.5 rounded-md border border-ih-border bg-ih-bg-card text-[11px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted transition-colors disabled:opacity-60">
            {revalidator.state !== "idle" ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        {webhookLog.length === 0 ? (
          <p className="text-[12px] text-ih-fg-3 leading-relaxed">
            No deliveries yet. In Stripe → Developers → Webhooks → your endpoint, click{" "}
            <span className="font-semibold text-ih-fg-2">Send test event</span>, then hit Refresh.
          </p>
        ) : (
          <ul className="divide-y divide-ih-border rounded-md border border-ih-border bg-ih-bg-card">
            {webhookLog.map((e, i) => (
              <li key={`${e.ts}-${i}`} className="flex items-center justify-between px-3 py-2 text-[12px]">
                <span className="text-ih-fg-3 tabular-nums flex-shrink-0">{new Date(e.ts).toLocaleString()}</span>
                <span className="font-mono text-ih-fg-2 truncate mx-3 flex-1">{e.eventType}</span>
                <WebhookStatusBadge result={e.result} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
