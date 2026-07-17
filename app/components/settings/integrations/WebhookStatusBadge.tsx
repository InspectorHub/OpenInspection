import { m } from "~/paraglide/messages";

export function WebhookStatusBadge({ result }: { result: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    processed: { label: m.settings_webhook_processed(), cls: "bg-ih-ok-bg text-ih-ok-fg" },
    received: { label: m.settings_webhook_received(), cls: "bg-ih-bg-muted text-ih-fg-3" },
    signature_failed: { label: m.settings_webhook_signature_failed(), cls: "bg-ih-bad-bg text-ih-bad-fg" },
    tenant_mismatch: { label: m.settings_webhook_tenant_mismatch(), cls: "bg-ih-bad-bg text-ih-bad-fg" },
  };
  const badge = map[result] ?? { label: result, cls: "bg-ih-bg-muted text-ih-fg-3" };
  return <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${badge.cls}`}>{badge.label}</span>;
}
