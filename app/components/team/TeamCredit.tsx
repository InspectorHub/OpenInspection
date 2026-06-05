interface TeamCreditMember {
  name: string;
  role: string;
  reviewedBy?: string | null;
}

interface TeamCreditProps {
  team: TeamCreditMember[];
  nachi?: string | null;
}

export function TeamCredit({ team, nachi }: TeamCreditProps) {
  return (
    <section className="border-t border-ih-border mt-12 pt-6 pb-12 max-w-3xl mx-auto px-4">
      <h3 className="text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 mb-3">Inspected by</h3>
      <ul className="space-y-2 text-sm">
        {team.map((m, i) => (
          <li key={i} className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-full bg-ih-bg-muted flex items-center justify-center text-xs font-bold text-ih-fg-2">
              {(m.name || "?").slice(0, 2).toUpperCase()}
            </div>
            <span className="font-medium">{m.name}</span>
            <span className="text-xs text-ih-fg-3">
              {m.role}
              {m.reviewedBy ? ` · reviewed by ${m.reviewedBy}` : ""}
            </span>
          </li>
        ))}
      </ul>

      {nachi && (
        <div className="mt-6 flex items-center gap-2 text-xs text-ih-fg-3">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-ih-watch-bg border border-ih-watch text-ih-watch-fg font-bold">
            InterNACHI #<span className="font-mono">{nachi}</span>
          </span>
          <span>Signed with Ed25519 audit chain</span>
        </div>
      )}
    </section>
  );
}
