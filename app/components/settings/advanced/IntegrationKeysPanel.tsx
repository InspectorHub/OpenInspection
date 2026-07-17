import { Form } from "react-router";
import { SecretField } from "~/components/SecretField";
import { m } from "~/paraglide/messages";

interface IntegrationKeysPanelProps {
  secrets: {
    GOOGLE_PLACES_API_KEY: string;
    ESTATED_API_KEY: string;
    APP_BASE_URL: string;
  };
  fieldError: (name: string) => string | undefined;
  saving: boolean;
}

export function IntegrationKeysPanel({ secrets, fieldError, saving }: IntegrationKeysPanelProps) {
  return (
    <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5">
      <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_intkeys_heading()}</h3>
      <p className="text-[13px] text-ih-fg-3">
        {m.settings_intkeys_desc()}
      </p>
      <Form method="post" className="space-y-4 max-w-xl">
        <input type="hidden" name="intent" value="save-advanced-secrets" />
        <SecretField
          name="GOOGLE_PLACES_API_KEY"
          label={m.settings_intkeys_places_label()}
          value={secrets.GOOGLE_PLACES_API_KEY}
          error={fieldError("GOOGLE_PLACES_API_KEY")}
          hint={m.settings_intkeys_places_hint()}
        />
        <SecretField
          name="ESTATED_API_KEY"
          label={m.settings_intkeys_estated_label()}
          value={secrets.ESTATED_API_KEY}
          error={fieldError("ESTATED_API_KEY")}
          hint={m.settings_intkeys_estated_hint()}
        />
        <SecretField
          name="APP_BASE_URL"
          label={m.settings_intkeys_baseurl_label()}
          value={secrets.APP_BASE_URL}
          type="text"
          error={fieldError("APP_BASE_URL")}
          hint={m.settings_intkeys_baseurl_hint()}
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
