import { Form } from "react-router";
import { SecretField } from "~/components/SecretField";

interface TurnstilePanelProps {
  value: string;
  fieldError: (name: string) => string | undefined;
  saving: boolean;
}

export function TurnstilePanel({ value, fieldError, saving }: TurnstilePanelProps) {
  return (
    <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5">
      <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">Bot protection</h3>
      <p className="text-[13px] text-ih-fg-3">
        Bot protection prevents automated form submissions on public-facing pages.
        Get keys at{" "}
        <a href="https://dash.cloudflare.com/?to=/:account/turnstile" target="_blank" rel="noopener noreferrer"
          className="text-ih-primary hover:underline">
          Cloudflare dashboard
        </a>.
      </p>
      <Form method="post" className="space-y-3 max-w-xl">
        <input type="hidden" name="intent" value="save-turnstile" />
        <SecretField
          name="TURNSTILE_SECRET_KEY"
          label="Turnstile Secret Key"
          value={value}
          error={fieldError("TURNSTILE_SECRET_KEY")}
          hint="Bot protection on booking and signup forms. Create at dash.cloudflare.com → Turnstile. Use test key 1x0000000000000000000000000000000AA for development"
        />
        <div className="flex justify-end pt-2 border-t border-ih-border">
          <button type="submit" disabled={saving}
            className="h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 active:scale-[.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </Form>
    </section>
  );
}
