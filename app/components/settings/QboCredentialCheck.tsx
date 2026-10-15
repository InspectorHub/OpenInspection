import { useState } from "react";
import { Banner, Button } from "@core/shared-ui";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import { useDisplayLocale, useDisplayTimeZone } from "~/hooks/useSessionContext";
import { formatDateTime } from "~/lib/format";
import { m } from "~/paraglide/messages";
import type { QboCheckOutcome, QboCheckedSetting } from "~/lib/qbo-credential-check";
import type { QBOCredentialSource } from "../../../server/services/qbo/api-base";
import type { QboRegistration } from "~/lib/qbo-settings-loader";

/** What the check cannot run without, named the way the form names it. */
export function qboCheckMissing(source: QBOCredentialSource, registration: QboRegistration | null): string[] {
  const missing: string[] = [];
  if (source.clientId === "missing") missing.push(m.settings_qbo_client_id_label());
  if (source.clientSecret === "missing") missing.push(m.settings_qbo_client_secret_label());
  if (!registration) missing.push(m.settings_qbo_check_need_base_url());
  return missing;
}

const settingLabel = (s: QboCheckedSetting) =>
  s === "QBO_CLIENT_ID" ? m.settings_qbo_client_id_label() : m.settings_qbo_client_secret_label();

/**
 * One check, shared by the two places its button appears.
 *
 * The request carries nothing: the server tests the credentials it holds. The
 * result is hidden while a new check runs and after any edit, so an answer about
 * the old values is never shown next to new input.
 */
export function useQboCredentialCheck() {
  const { fetcher, submit, busy } = useGuardedSubmit<{ check?: QboCheckOutcome }>();
  const [cleared, setCleared] = useState(false);
  return {
    busy,
    outcome: busy || cleared ? null : (fetcher.data?.check ?? null),
    run: () => {
      if (submit({ intent: "qbo-check-credentials" }, { method: "post" })) setCleared(false);
    },
    clear: () => setCleared(true),
  };
}

export function QboCheckButton({
  missing, busy, onRun, unsaved = false,
}: { missing: string[]; busy: boolean; onRun: () => void; unsaved?: boolean }) {
  // The check reads what is in force (the deployment's values, otherwise the
  // saved ones). Text typed into a field and not yet saved is not among them, so
  // a result would describe something other than what the person is looking at.
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        variant="secondary"
        disabled={missing.length > 0 || unsaved}
        pending={busy}
        onClick={onRun}
      >
        {busy ? m.settings_qbo_check_checking() : m.settings_qbo_check_button()}
      </Button>
      {missing.length > 0 && (
        <span className="text-[12px] text-ih-fg-3">{m.settings_qbo_check_needs({ list: missing.join(", ") })}</span>
      )}
      {missing.length === 0 && unsaved && (
        <span className="text-[12px] text-ih-fg-3">{m.settings_qbo_check_unsaved()}</span>
      )}
    </div>
  );
}

export function QboCheckResult({ outcome }: { outcome: QboCheckOutcome | null }) {
  const locale = useDisplayLocale();
  const timeZone = useDisplayTimeZone();
  if (!outcome) return null;

  if (outcome.kind === "paired" || outcome.kind === "rejected" || outcome.kind === "unreachable") {
    const when = (
      <p className="mt-1 text-[12px] font-normal">
        {m.settings_qbo_check_at({ time: formatDateTime(outcome.checkedAt * 1000, { locale, timeZone }) })}
      </p>
    );
    if (outcome.kind === "paired") {
      return (
        <Banner tone="success">
          <p>{m.settings_qbo_check_paired()}</p>
          <p className="mt-1 text-xs font-normal">{m.settings_qbo_check_paired_limit_keys()}</p>
          <p className="mt-1 text-xs font-normal">{m.settings_qbo_check_paired_limit_redirect()}</p>
          {when}
        </Banner>
      );
    }
    return (
      <Banner tone={outcome.kind === "rejected" ? "danger" : "warn"}>
        <p>{outcome.kind === "rejected" ? m.settings_qbo_check_rejected() : m.settings_qbo_check_unreachable()}</p>
        {when}
      </Banner>
    );
  }

  const text =
    outcome.kind === "rate_limited" ? m.settings_qbo_check_rate_limited()
    : outcome.kind === "app_base_url_missing" ? m.settings_qbo_check_no_base_url()
    : outcome.kind === "credentials_missing" && outcome.missing.length > 0
      ? m.settings_qbo_check_server_missing({ list: outcome.missing.map(settingLabel).join(", ") })
    : m.settings_qbo_check_failed();
  return <Banner tone="warn">{text}</Banner>;
}
