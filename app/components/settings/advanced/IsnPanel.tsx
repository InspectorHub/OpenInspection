import { Form } from "react-router";
import { SecretField } from "~/components/SecretField";
import { m } from "~/paraglide/messages";

export const ISN_SECRET_KEYS = ["ISN_DOMAIN", "ISN_COMPANY_KEY", "ISN_ACCESS_KEY", "ISN_SECRET_KEY"] as const;
export type IsnSecrets = Record<(typeof ISN_SECRET_KEYS)[number], string>;

interface IsnPanelProps {
  secrets: IsnSecrets;
  fieldError: (name: string) => string | undefined;
  saving: boolean;
}

/** ISN (Inspection Support Network): the company's credentials. */
export function IsnPanel({ secrets, fieldError, saving }: IsnPanelProps) {
  return (
    <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5">
      <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_isn_heading()}</h3>
      <p className="text-[13px] text-ih-fg-3">{m.settings_isn_desc()}</p>
      <Form method="post" className="space-y-4 max-w-xl">
        <input type="hidden" name="intent" value="save-isn" />
        <SecretField name="ISN_DOMAIN" type="text" label={m.settings_isn_domain_label()} value={secrets.ISN_DOMAIN}
          error={fieldError("ISN_DOMAIN")} hint={m.settings_isn_domain_hint()} />
        <SecretField name="ISN_COMPANY_KEY" type="text" label={m.settings_isn_company_key_label()} value={secrets.ISN_COMPANY_KEY}
          error={fieldError("ISN_COMPANY_KEY")} hint={m.settings_isn_keys_hint()} />
        <SecretField name="ISN_ACCESS_KEY" label={m.settings_isn_access_key_label()} value={secrets.ISN_ACCESS_KEY}
          error={fieldError("ISN_ACCESS_KEY")} />
        <SecretField name="ISN_SECRET_KEY" label={m.settings_isn_secret_key_label()} value={secrets.ISN_SECRET_KEY}
          error={fieldError("ISN_SECRET_KEY")} />
        <div className="flex justify-end pt-2 border-t border-ih-border">
          <button type="submit" disabled={saving}
            className="h-9 px-4 rounded-md bg-ih-primary text-ih-fg-inverse font-bold text-[13px] hover:bg-ih-primary-600 active:scale-[.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed">
            {saving ? m.common_saving() : m.common_save()}
          </button>
        </div>
      </Form>
    </section>
  );
}
