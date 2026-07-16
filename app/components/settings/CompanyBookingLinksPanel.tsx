import { useCopyClipboard } from "~/hooks/useCopyClipboard";

export function CompanyBookingLinksPanel({
  tenant,
}: {
  tenant: string | null | undefined;
}) {
  const { copied: copiedField, copy } = useCopyClipboard();
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const companyUrl = tenant ? `${origin}/book/${tenant}` : null;

  if (!companyUrl) return null;

  return (
    <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
      <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">Company link</h3>
      <div className="flex items-center gap-3">
        <span className="text-[12px] font-bold text-ih-fg-2 w-36 shrink-0">Booking page</span>
        <span className="text-[12px] text-ih-fg-1 truncate flex-1 font-mono bg-ih-bg-muted rounded px-2 py-1.5 border border-ih-border">
          {companyUrl}
        </span>
        <button
          type="button"
          onClick={() => copy(companyUrl, "company")}
          className="h-8 px-3 rounded-md bg-ih-primary text-white font-bold text-[12px] hover:bg-ih-primary-600 transition-colors shrink-0"
        >
          {copiedField === "company" ? "Copied!" : "Copy"}
        </button>
        <a
          href={companyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-ih-fg-3 hover:text-ih-primary transition-colors shrink-0"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"
            />
          </svg>
        </a>
      </div>
      <p className="text-[12px] text-ih-fg-3">
        Share the company link — clients are matched with the first available inspector.
      </p>
    </section>
  );
}
