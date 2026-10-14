import { m } from "~/paraglide/messages";
import { QboCopyButton } from "~/components/settings/QboCopyButton";
import type { QboRegistration } from "~/lib/qbo-settings-loader";

/**
 * The three addresses an operator registers in their own Intuit app.
 *
 * They come from the loader, which builds them with the same helpers the
 * backend uses (`qboRedirectUri` for the one Intuit matches byte for byte), so
 * what is shown here cannot drift from what the OAuth flow sends. Nothing in
 * this component composes an address.
 */
export function QboRegistrationUrls({ registration }: { registration: QboRegistration | null }) {
  if (!registration) {
    return (
      <p className="text-[13px] text-ih-fg-3">{m.settings_qbo_urls_missing_base()}</p>
    );
  }
  const rows: Array<{ id: string; label: string; value: string }> = [
    { id: "redirect", label: m.settings_qbo_url_redirect(), value: registration.redirectUri },
    { id: "disconnect", label: m.settings_qbo_url_disconnect(), value: registration.disconnectUrl },
    { id: "webhook", label: m.settings_qbo_url_webhook(), value: registration.webhookUrl },
  ];
  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {rows.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-ih-border bg-ih-bg-muted px-3 py-2"
          >
            <span id={`qbo-url-${r.id}`} className="w-32 shrink-0 text-[12px] font-bold text-ih-fg-2">{r.label}</span>
            <code className="min-w-0 flex-1 break-all font-mono text-[12px] text-ih-fg-1">{r.value}</code>
            <QboCopyButton value={r.value} describedBy={`qbo-url-${r.id}`} />
          </li>
        ))}
      </ul>
      {!registration.secure && (
        <p className="rounded-md bg-ih-watch-bg px-3 py-2 text-[13px] text-ih-watch-fg">
          {m.settings_qbo_urls_https()}
        </p>
      )}
    </div>
  );
}
