export function WebhookStatusBadge({ result }: { result: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    processed: { label: "✓ Processed", cls: "bg-ih-ok-bg text-ih-ok-fg" },
    received: { label: "✓ Received (no action)", cls: "bg-ih-bg-muted text-ih-fg-3" },
    signature_failed: { label: "✗ Signature failed — check your signing secret", cls: "bg-ih-bad-bg text-ih-bad-fg" },
    tenant_mismatch: { label: "✗ Tenant mismatch", cls: "bg-ih-bad-bg text-ih-bad-fg" },
  };
  const m = map[result] ?? { label: result, cls: "bg-ih-bg-muted text-ih-fg-3" };
  return <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${m.cls}`}>{m.label}</span>;
}
