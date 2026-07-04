import { Button } from "@core/shared-ui";

interface TeamMember {
  id: string;
  name?: string;
  role: string;
}

interface TeamBannerProps {
  show: boolean;
  members: TeamMember[];
  onManage?: () => void;
}

export function TeamBanner({ show, members, onManage }: TeamBannerProps) {
  if (!show) return null;

  return (
    <div className="px-4 py-2 bg-ih-primary-tint border-b border-ih-primary flex items-center gap-3">
      <span className="ih-eyebrow text-ih-primary">Team mode</span>
      <div className="flex -space-x-1.5">
        {members.map((m) => (
          <div key={m.id} className="w-7 h-7 rounded-full ring-2 ring-ih-bg-card bg-ih-bg-muted flex items-center justify-center text-xs font-bold text-ih-fg-2" title={m.name || m.id}>
            {(m.name || m.id || "?").slice(0, 2).toUpperCase()}
          </div>
        ))}
        {members.length === 0 && <div className="ih-meta">No roster set</div>}
      </div>
      <Button variant="ghost" size="sm" className="ml-auto" onClick={onManage} aria-label="Open team roster">Manage</Button>
    </div>
  );
}
