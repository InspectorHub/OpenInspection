type ReportStatus = "draft" | "pending_review" | "published" | "viewed_client" | "viewed_agent";

interface StatusMeta { label: string; pillClass: string }

const STATUS_META: Record<ReportStatus, StatusMeta> = {
  draft:          { label: "Draft",            pillClass: "ih-pill--gen" },
  pending_review: { label: "Pending review",   pillClass: "ih-pill--monitor" },
  published:      { label: "Published",        pillClass: "ih-pill--sat" },
  viewed_client:  { label: "Viewed by client", pillClass: "ih-pill--info" },
  viewed_agent:   { label: "Viewed by agent",  pillClass: "ih-pill--info" },
};

const FALLBACK = STATUS_META.draft;

function resolveMeta(status: string): StatusMeta {
  return (STATUS_META as Record<string, StatusMeta | undefined>)[status] ?? FALLBACK;
}

export function ReportStatusPill({ status }: { status: string }) {
  const meta = resolveMeta(status);
  return (
    <span className={`ih-pill ${meta.pillClass}`} aria-label={`Report status: ${meta.label}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60 mr-1" aria-hidden="true" />
      {meta.label}
    </span>
  );
}
