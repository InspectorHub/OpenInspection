import { Form } from "react-router";
import type { FormMetadata } from "@conform-to/react";
import type { StripeConnectInput } from "~/lib/forms/settings-config.schema";
import { m } from "~/paraglide/messages";

interface StripeConnectPanelProps {
  stripeConnected: boolean;
  stripeAccountId?: string | null;
  stripeForm: FormMetadata<StripeConnectInput, string[]>;
  stripeFields: ReturnType<FormMetadata<StripeConnectInput, string[]>["getFieldset"]>;
}

export function StripeConnectPanel({ stripeConnected, stripeAccountId, stripeForm, stripeFields }: StripeConnectPanelProps) {
  return (
    <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_stripeconnect_heading()}</h3>
        <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${
 stripeConnected
 ? "bg-ih-ok-bg text-ih-ok-fg"
 : "bg-ih-bg-muted text-ih-fg-3"
 }`}>
          {stripeConnected ? m.settings_conn_status_connected() : m.settings_stripeconnect_not_connected()}
        </span>
      </div>
      <p className="text-[13px] text-ih-fg-3">
        {m.settings_stripeconnect_desc()}{" "}
        <a href="https://dashboard.stripe.com/connect/express" target="_blank" rel="noopener noreferrer"
          className="text-ih-primary hover:underline">
          dashboard.stripe.com/connect/express
        </a>{m.settings_stripeconnect_desc_suffix()}
      </p>

      {stripeConnected ? (
        <div className="space-y-3">
          <div className="text-[13px] text-ih-fg-2">
            {m.settings_stripeconnect_connected_account()}{" "}
            <code className="font-mono text-[12px] px-2 py-1 rounded bg-ih-bg-muted text-ih-fg-1">
              {stripeAccountId}
            </code>
          </div>
          <Form method="post">
            <input type="hidden" name="intent" value="disconnect-stripe" />
            <button type="submit"
              className="h-9 px-4 rounded-md border border-ih-bad text-ih-bad-fg text-[13px] font-bold hover:bg-ih-bad-bg transition-colors">
              {m.settings_calconnect_disconnect()}
            </button>
          </Form>
        </div>
      ) : (
        <Form
          method="post"
          id={stripeForm.id}
          onSubmit={stripeForm.onSubmit}
          noValidate
          className="space-y-3 max-w-md"
        >
          <input type="hidden" name="intent" value="connect-stripe" />
          <div className="space-y-2">
            <label htmlFor={stripeFields.stripeAccountId.id} className="block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">
              {m.settings_stripeconnect_account_id_label()}
            </label>
            <input
              type="text"
              id={stripeFields.stripeAccountId.id}
              name={stripeFields.stripeAccountId.name}
              placeholder={m.settings_stripeconnect_account_placeholder()}
              autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
              aria-invalid={stripeFields.stripeAccountId.errors ? true : undefined}
              className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none transition-all font-mono text-[13px] placeholder:text-ih-fg-4 text-ih-fg-1"
            />
            {stripeFields.stripeAccountId.errors && (
              <p className="mt-1 text-xs text-ih-bad-fg">{stripeFields.stripeAccountId.errors[0]}</p>
            )}
          </div>
          {stripeForm.errors && (
            <div className="px-3 py-2 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg">
              {stripeForm.errors[0]}
            </div>
          )}
          <button type="submit"
            className="h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 active:scale-[.98] transition-all">
            {m.settings_stripeconnect_connect_account()}
          </button>
        </Form>
      )}
    </section>
  );
}
