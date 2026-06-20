import { Form } from "react-router";
import { SecretField } from "~/components/SecretField";

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
      <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">Integration API keys</h3>
      <p className="text-[13px] text-ih-fg-3">
        These integrations enhance the inspection workflow. All are optional — features degrade gracefully when unconfigured.
      </p>
      <Form method="post" className="space-y-4 max-w-xl">
        <input type="hidden" name="intent" value="save-advanced-secrets" />
        <SecretField
          name="GOOGLE_PLACES_API_KEY"
          label="Google Places API key"
          value={secrets.GOOGLE_PLACES_API_KEY}
          error={fieldError("GOOGLE_PLACES_API_KEY")}
          hint="Address autocomplete on booking and new inspection forms. Create at console.cloud.google.com → Places API"
        />
        <SecretField
          name="ESTATED_API_KEY"
          label="Estated API key"
          value={secrets.ESTATED_API_KEY}
          error={fieldError("ESTATED_API_KEY")}
          hint="Auto-fills Property Facts (year built, sqft, bedrooms). Get at estated.com → API"
        />
        <SecretField
          name="APP_BASE_URL"
          label="Application base URL"
          value={secrets.APP_BASE_URL}
          type="text"
          error={fieldError("APP_BASE_URL")}
          hint="Public URL of your deployment (e.g. https://app.yourdomain.com). Used in email links"
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
