export interface PreflightCheck {
  id: string;
  label: string;
  passed: boolean;
  detail?: string;
  action: { kind: "callback"; label: string; onAction: () => void }
        | { kind: "link"; label: string; href: string };
}

interface PreflightChecksProps {
  checks: PreflightCheck[];
  loading?: boolean;
  error?: string | null;
}

function CheckRow({ check }: { check: PreflightCheck }) {
  return (
    <li className="flex items-center gap-2">
      <span className={`font-bold w-4 text-center ${check.passed ? "text-ih-ok-fg" : "text-ih-bad-fg"}`}>
        {check.passed ? "✓" : "✗"}
      </span>
      <span>
        {check.label}
        {!check.passed && check.detail && (
          <span className="text-slate-400"> ({check.detail})</span>
        )}
      </span>
      {!check.passed && (
        check.action.kind === "callback" ? (
          <button className="ml-auto px-2 h-7 rounded-md text-xs text-indigo-600 hover:bg-indigo-50" onClick={check.action.onAction}>
            {check.action.label}
          </button>
        ) : (
          <a className="ml-auto px-2 h-7 rounded-md text-xs text-indigo-600 hover:bg-indigo-50 flex items-center" href={check.action.href}>
            {check.action.label}
          </a>
        )
      )}
    </li>
  );
}

export function PreflightChecks({ checks, loading, error }: PreflightChecksProps) {
  return (
    <div className="border-t border-slate-200 px-6 py-4">
      <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">Pre-flight checks</h3>
      <ul className="space-y-2 text-sm">
        {checks.map((check) => (
          <CheckRow key={check.id} check={check} />
        ))}
      </ul>
      {loading && (
        <span className="inline-block ih-skeleton ih-skeleton--text" style={{ width: "4rem", height: "0.875rem", verticalAlign: "middle" }}>
          <span className="sr-only">Loading...</span>
        </span>
      )}
      {error && <p className="text-xs text-ih-bad-fg mt-3">{error}</p>}
    </div>
  );
}
