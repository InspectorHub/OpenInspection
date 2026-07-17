import { Form } from "react-router";
import { SecretField } from "~/components/SecretField";
import { m } from "~/paraglide/messages";

interface TurnstilePanelProps {
  value: string;
  fieldError: (name: string) => string | undefined;
  saving: boolean;
}

export function TurnstilePanel({ value, fieldError, saving }: TurnstilePanelProps) {
  return (
    <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5">
      <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_turnstile_heading()}</h3>
      <p className="text-[13px] text-ih-fg-3">
        {m.settings_turnstile_desc()}{" "}
        <a href="https://dash.cloudflare.com/?to=/:account/turnstile" target="_blank" rel="noopener noreferrer"
          className="text-ih-primary hover:underline">
          {m.settings_turnstile_dashboard_link()}
        </a>.
      </p>
      <Form method="post" className="space-y-3 max-w-xl">
        <input type="hidden" name="intent" value="save-turnstile" />
        <SecretField
          name="TURNSTILE_SECRET_KEY"
          label={m.settings_turnstile_secret_label()}
          value={value}
          error={fieldError("TURNSTILE_SECRET_KEY")}
          hint={m.settings_turnstile_secret_hint()}
        />
        <div className="flex justify-end pt-2 border-t border-ih-border">
          <button type="submit" disabled={saving}
            className="h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 active:scale-[.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed">
            {saving ? m.common_saving() : m.common_save()}
          </button>
        </div>
      </Form>
    </section>
  );
}
