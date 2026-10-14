import { useState } from "react";
import { Form } from "react-router";
import { SegmentedControl, pendingProps, PENDING_CLASS } from "@core/shared-ui";
import { SecretField } from "~/components/SecretField";
import { QboRegistrationUrls } from "~/components/settings/QboRegistrationUrls";
import { useSubmitLatch } from "~/hooks/useSubmitLatch";
import { m } from "~/paraglide/messages";
import type { QboEnvironment, QboRegistration } from "~/lib/qbo-settings-loader";
import type { QBOCredentialOrigin, QBOCredentialSource } from "../../../server/services/qbo/api-base";

/** The three credentials, as the settings API masks them. `QBO_ENV` is not one: it has its own control. */
export interface QboCredentialTriple {
  QBO_CLIENT_ID: string;
  QBO_CLIENT_SECRET: string;
  QBO_WEBHOOK_SECRET: string;
}

/**
 * Everything the connect link needs before it can possibly succeed. The webhook
 * token is not on the list: connecting does not use it.
 *
 * The environment is judged by the VALUE in force, not by where it comes from: a
 * deployment that sets it to something other than "sandbox" or "production" has
 * supplied a setting that cannot be used, and the callback would refuse it.
 */
export function qboReadyToConnect(source: QBOCredentialSource, environment: QboEnvironment | null): boolean {
  return source.clientId !== "missing" && source.clientSecret !== "missing" && environment !== null;
}

/** True while any of the four settings is still missing: the section opens on its own. */
export function qboNeedsSetup(source: QBOCredentialSource, environment: QboEnvironment | null): boolean {
  return !qboReadyToConnect(source, environment) || source.webhookToken === "missing";
}

const isMissing = (o: QBOCredentialOrigin) => o === "missing";

/** A setting the environment already supplies is a row with an explicit Override, not an empty input. */
function BuiltInRow({ labelId, label, value, onOverride }: { labelId: string; label: string; value?: string; onOverride: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-ih-border bg-ih-bg-muted px-3 py-2">
      <div className="min-w-0">
        <span id={labelId} className="block text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">
          {label}
        </span>
        <span className="text-[13px] text-ih-fg-2">{value ?? m.settings_qbo_builtin()}</span>
      </div>
      <button
        type="button"
        aria-describedby={labelId}
        onClick={onOverride}
        className="px-3 py-1.5 text-[12px] font-bold text-ih-fg-2 bg-ih-bg-card border border-ih-border rounded-md hover:bg-ih-bg-muted transition-colors"
      >
        {m.settings_qbo_override()}
      </button>
    </div>
  );
}

function CredentialField({
  name, label, hint, value, origin,
}: { name: string; label: string; hint: string; value: string; origin: QBOCredentialOrigin }) {
  const [overriding, setOverriding] = useState(false);
  const fromEnv = origin === "env";
  if (fromEnv && !overriding && !value) {
    return <BuiltInRow labelId={`qbo-row-${name}`} label={label} onOverride={() => setOverriding(true)} />;
  }
  return (
    <SecretField
      name={name}
      label={label}
      value={value}
      hint={hint}
      {...(fromEnv
        ? { emptyPlaceholder: m.settings_qbo_env_provided(), emptyBadge: m.settings_qbo_env_provided_badge() }
        : {})}
    />
  );
}

const envLabel = (e: QboEnvironment) =>
  e === "sandbox" ? m.settings_qbo_env_sandbox() : m.settings_qbo_env_production();

/**
 * The Intuit environment as a two-way control that can say "neither".
 *
 * `QBO_ENV` has no default anywhere in the product, so this must be able to
 * show that it is unset, and must not write a value the person did not choose.
 * The hidden field therefore stays empty until a segment is pressed, even when a
 * value is already shown as selected: an untouched control submits nothing, and
 * the action drops empty values, so "Save credentials" cannot quietly set it.
 */
function EnvironmentField({
  known, origin, choice, onChoose,
}: { known: QboEnvironment | null; origin: QBOCredentialOrigin; choice: QboEnvironment | ""; onChoose: (e: QboEnvironment) => void }) {
  const [overriding, setOverriding] = useState(false);
  // A value the deployment supplies is shown as built in only when it is one we
  // can use; an unusable one falls through to the control, which says it is unset.
  if (origin === "env" && known && !overriding && !choice) {
    return (
      <BuiltInRow
        labelId="qbo-row-QBO_ENV"
        label={m.settings_qbo_env_label()}
        value={known ? envLabel(known) : undefined}
        onOverride={() => setOverriding(true)}
      />
    );
  }
  const selected = choice || known || "";
  return (
    <div className="space-y-1.5">
      <span className="block text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">
        {m.settings_qbo_env_label()}
      </span>
      <SegmentedControl
        size="md"
        ariaLabel={m.settings_qbo_env_label()}
        value={selected}
        onChange={(v) => onChoose(v as QboEnvironment)}
        options={[
          { value: "sandbox", label: m.settings_qbo_env_sandbox() },
          { value: "production", label: m.settings_qbo_env_production() },
        ]}
      />
      <p className="text-[11px] text-ih-fg-3">
        {m.settings_qbo_env_hint()}
        {!selected && <> {m.settings_qbo_env_unset_hint()}</>}
      </p>
    </div>
  );
}

function summarySentence(source: QBOCredentialSource): string {
  if (source.clientId === "env" && source.clientSecret === "env" && source.webhookToken === "env") {
    return m.settings_qbo_app_summary_all_builtin();
  }
  const missing: string[] = [];
  if (isMissing(source.clientId)) missing.push(m.settings_qbo_client_id_label());
  if (isMissing(source.clientSecret)) missing.push(m.settings_qbo_client_secret_label());
  if (isMissing(source.webhookToken)) missing.push(m.settings_qbo_webhook_label());
  return missing.length === 0
    ? m.settings_qbo_app_summary_all_set()
    : m.settings_qbo_app_summary_missing({ list: missing.join(", ") });
}

/**
 * "Your Intuit app": the Client ID, secret, webhook token and environment of
 * the Intuit app an operator brings themselves, plus the three addresses to
 * register on it.
 *
 * Only rendered where the operator owns the app. It is folded to one summary
 * line when everything is in place and open when something is missing, so a
 * working integration is not buried under four fields nobody needs to touch.
 *
 * Whatever the environment already supplies stays overridable, behind an
 * explicit Override: a value stored here is the documented fallback path, and
 * hiding it would have removed a capability.
 */
export function QboCredentialsForm({
  secrets, credentialSource, environment, registration, saving, open, onOpenChange, defaultOpen,
}: {
  /** Masked values from the company's own row; "" when nothing is stored. */
  secrets: QboCredentialTriple;
  credentialSource: QBOCredentialSource;
  /** The environment in force, or null when none is set. */
  environment: QboEnvironment | null;
  registration: QboRegistration | null;
  saving: boolean;
  /** Controlled open state; leave undefined to let the section manage itself. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
}) {
  const latch = useSubmitLatch();
  const [innerOpen, setInnerOpen] = useState(defaultOpen ?? qboNeedsSetup(credentialSource, environment));
  const isOpen = open ?? innerOpen;
  const setOpen = (next: boolean) => {
    setInnerOpen(next);
    onOpenChange?.(next);
  };
  const [envChoice, setEnvChoice] = useState<QboEnvironment | "">("");

  return (
    <section
      id="qbo-app"
      className="scroll-mt-4 bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5"
      aria-labelledby="qbo-app-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id="qbo-app-heading" className="text-[15px] font-bold text-ih-fg-1">
            {m.settings_qbo_app_heading()}
          </h2>
          <p className="text-[12.5px] text-ih-fg-3">
            <span>
              {environment
                ? m.settings_qbo_app_summary_env({ env: envLabel(environment) })
                : m.settings_qbo_app_summary_env_unset()}
            </span>
            {" · "}
            <span>{summarySentence(credentialSource)}</span>
          </p>
        </div>
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls="qbo-app-body"
          onClick={() => setOpen(!isOpen)}
          className="px-3 py-1.5 text-[12px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted rounded-md transition-colors"
        >
          {isOpen ? m.settings_qbo_app_hide() : m.settings_qbo_app_show()}
        </button>
      </div>

      {isOpen && (
        <div id="qbo-app-body" className="space-y-6">
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
          <Form method="post" className="space-y-4 max-w-xl" onSubmit={latch()}>
            <input type="hidden" name="intent" value="save-qbo-secrets" />
            <input type="hidden" name="QBO_ENV" value={envChoice} />
            <CredentialField
              name="QBO_CLIENT_ID"
              label={m.settings_qbo_client_id_label()}
              value={secrets.QBO_CLIENT_ID}
              hint={m.settings_qbo_client_id_hint()}
              origin={credentialSource.clientId}
            />
            <CredentialField
              name="QBO_CLIENT_SECRET"
              label={m.settings_qbo_client_secret_label()}
              value={secrets.QBO_CLIENT_SECRET}
              hint={m.settings_qbo_client_secret_hint()}
              origin={credentialSource.clientSecret}
            />
            <CredentialField
              name="QBO_WEBHOOK_SECRET"
              label={m.settings_qbo_webhook_label()}
              value={secrets.QBO_WEBHOOK_SECRET}
              hint={m.settings_qbo_webhook_hint()}
              origin={credentialSource.webhookToken}
            />
            <EnvironmentField
              known={environment}
              origin={credentialSource.environment}
              choice={envChoice}
              onChoose={setEnvChoice}
            />
            <div className="flex justify-end pt-2 border-t border-ih-border">
              <button
                type="submit"
                {...pendingProps(saving)}
                className={`h-9 px-4 rounded-md bg-ih-primary text-ih-fg-inverse font-bold text-[13px] hover:bg-ih-primary-600 active:scale-[.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed ${PENDING_CLASS}`}
              >
                {saving ? m.common_saving() : m.settings_qbo_save_credentials()}
              </button>
            </div>
          </Form>

          <div className="space-y-2">
            <h3 className="text-[14px] font-bold text-ih-fg-1">{m.settings_qbo_urls_heading()}</h3>
            <p className="text-[12.5px] text-ih-fg-3 max-w-[62ch]">{m.settings_qbo_urls_desc()}</p>
            <QboRegistrationUrls registration={registration} />
          </div>
        </div>
      )}
    </section>
  );
}
