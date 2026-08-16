import { Form } from "react-router";
import { SecretField } from "~/components/SecretField";
import { m } from "~/paraglide/messages";

/** The three names that can live either in the Worker env or in the tenant's row. */
export interface QboCredentialTriple {
  QBO_CLIENT_ID: string;
  QBO_CLIENT_SECRET: string;
  QBO_WEBHOOK_SECRET: string;
  /** Not a credential. It rides along because a self-hoster's own Intuit app
   *  is either a Development app or a Production one, and that is a property
   *  of their app rather than of this deployment. */
  QBO_ENV: string;
}

/** Which of the three the deployment already supplies. Booleans, never values. */
export interface QboCredentialProvenance {
  QBO_CLIENT_ID: boolean;
  QBO_CLIENT_SECRET: boolean;
  QBO_WEBHOOK_SECRET: boolean;
  QBO_ENV: boolean;
}

/**
 * An empty field means "unset" only when the deployment isn't already
 * supplying that key. When it is, the field is an override slot, not a gap —
 * and calling it "Not configured" is how a working integration got read as a
 * broken one. Resolution is the same in every deployment mode: the Worker env
 * wins, the tenant's stored value is the self-host fallback.
 */
function envProvidedProps(fromEnv: boolean) {
  return fromEnv
    ? {
        emptyPlaceholder: m.settings_qbo_env_provided(),
        emptyBadge: m.settings_qbo_env_provided_badge(),
      }
    : {};
}

export function QboCredentialsForm({
  secrets,
  envProvided,
  saving,
}: {
  /** Masked values from the tenant's own row; "" when nothing is stored. */
  secrets: QboCredentialTriple;
  envProvided: QboCredentialProvenance;
  saving: boolean;
}) {
  return (
    <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5">
      <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">
        {m.settings_qbo_api_credentials_heading()}
      </h3>
      <p className="text-[13px] text-ih-fg-3">
        {m.settings_qbo_credentials_desc_before()}{" "}
        <a
          href="https://developer.intuit.com/app/developer/appdetail"
          target="_blank"
          rel="noopener noreferrer"
          className="text-ih-primary-text hover:underline"
        >
          {m.settings_qbo_credentials_link()}
        </a>
        .
      </p>
      <Form method="post" className="space-y-4 max-w-xl">
        <input type="hidden" name="intent" value="save-qbo-secrets" />
        <SecretField
          name="QBO_CLIENT_ID"
          label={m.settings_qbo_client_id_label()}
          value={secrets.QBO_CLIENT_ID}
          hint={m.settings_qbo_client_id_hint()}
          {...envProvidedProps(envProvided.QBO_CLIENT_ID)}
        />
        <SecretField
          name="QBO_CLIENT_SECRET"
          label={m.settings_qbo_client_secret_label()}
          value={secrets.QBO_CLIENT_SECRET}
          hint={m.settings_qbo_client_secret_hint()}
          {...envProvidedProps(envProvided.QBO_CLIENT_SECRET)}
        />
        <SecretField
          name="QBO_WEBHOOK_SECRET"
          label={m.settings_qbo_webhook_label()}
          value={secrets.QBO_WEBHOOK_SECRET}
          hint={m.settings_qbo_webhook_hint()}
          {...envProvidedProps(envProvided.QBO_WEBHOOK_SECRET)}
        />
        <SecretField
          name="QBO_ENV"
          label={m.settings_qbo_env_label()}
          value={secrets.QBO_ENV}
          hint={m.settings_qbo_env_hint()}
          {...envProvidedProps(envProvided.QBO_ENV)}
        />
        <div className="flex justify-end pt-2 border-t border-ih-border">
          <button
            type="submit"
            disabled={saving}
            className="h-9 px-4 rounded-md bg-ih-primary text-ih-fg-inverse font-bold text-[13px] hover:bg-ih-primary-600 active:scale-[.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {saving ? m.common_saving() : m.settings_qbo_save_credentials()}
          </button>
        </div>
      </Form>
    </section>
  );
}
