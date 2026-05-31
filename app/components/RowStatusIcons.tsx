interface StatusFlags {
  reportReady?: boolean;
  agreementSigned?: boolean;
  sent?: boolean;
  flagged?: boolean;
}

interface RowStatusIconsProps {
  statusFlags?: StatusFlags;
}

export function RowStatusIcons({ statusFlags }: RowStatusIconsProps) {
  const f = statusFlags ?? {};
  return (
    <div className="flex items-center gap-1 text-slate-300" data-testid="row-status-icons">
      {/* Report ready */}
      <span
        className={`w-5 h-5 inline-flex items-center justify-center ${f.reportReady ? "text-ih-ok" : ""}`}
        title={f.reportReady ? "Report ready" : "Report not yet ready"}
        aria-label={f.reportReady ? "Report ready" : "Report not yet ready"}
      >
        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
          <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
        </svg>
      </span>
      {/* Agreement signed */}
      <span
        className={`w-5 h-5 inline-flex items-center justify-center ${f.agreementSigned ? "text-ih-ok" : ""}`}
        title={f.agreementSigned ? "Agreement signed" : "Agreement not yet signed"}
        aria-label={f.agreementSigned ? "Agreement signed" : "Agreement not yet signed"}
      >
        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
          <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
      </span>
      {/* Sent */}
      <span
        className={`w-5 h-5 inline-flex items-center justify-center ${f.sent ? "text-sky-500" : ""}`}
        title={f.sent ? "Report sent" : "Report not yet sent"}
        aria-label={f.sent ? "Report sent" : "Report not yet sent"}
      >
        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
        </svg>
      </span>
      {/* Flagged */}
      {f.flagged && (
        <span className="w-5 h-5 inline-flex items-center justify-center text-ih-bad" title="Flagged: invoice overdue or other attention needed" aria-label="Flagged">
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
            <path fillRule="evenodd" d="M3 6a3 3 0 013-3h10a1 1 0 01.8 1.6L14.25 8l2.55 3.4A1 1 0 0116 13H6a1 1 0 00-1 1v3a1 1 0 11-2 0V6z" clipRule="evenodd" />
          </svg>
        </span>
      )}
    </div>
  );
}
