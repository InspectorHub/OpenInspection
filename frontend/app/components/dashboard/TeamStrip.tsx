import { useState, useEffect } from "react";

interface TeamMember {
  id: string;
  name: string;
  email: string;
  online: boolean;
  lastSeenRel?: string;
}

interface TeamStripProps {
  members?: TeamMember[];
}

export function TeamStrip({ members: propMembers }: TeamStripProps) {
  const [members, setMembers] = useState<TeamMember[]>(propMembers || []);

  useEffect(() => {
    if (propMembers) {
      setMembers(propMembers);
      return;
    }
    // Fetch from API if no prop members provided
    async function load() {
      try {
        const res = await fetch("/api/team/members", { credentials: "include" });
        if (res.ok) {
          const { data } = (await res.json()) as { data: TeamMember[] };
          setMembers(data || []);
        }
      } catch {
        // degrade gracefully — hide the strip
      }
    }
    load();
  }, [propMembers]);

  const onlineCount = members.filter((m) => m.online).length;

  if (members.length <= 1) return null;

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Team today</h3>
          <span className="text-xs text-slate-400 dark:text-slate-500">
            {onlineCount} online · {members.length} total
          </span>
        </div>
        <a href="/team" className="text-xs font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">Manage team &rarr;</a>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {members.map((m) => (
          <div key={m.id} className="flex items-center gap-3 p-2 rounded border border-slate-100 dark:border-slate-700">
            <div className="relative shrink-0">
              <div className="w-9 h-9 rounded-full bg-slate-300 dark:bg-slate-600 flex items-center justify-center text-xs font-bold text-slate-700 dark:text-slate-200">
                {(m.name || m.email || "?").slice(0, 2).toUpperCase()}
              </div>
              <span
                className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-slate-800 ${m.online ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-500"}`}
                aria-hidden="true"
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate text-slate-900 dark:text-slate-100">{m.name || m.email}</div>
              <div className="text-xs text-slate-400 dark:text-slate-500">
                {m.online ? (
                  <span className="text-emerald-600 dark:text-emerald-400">Online</span>
                ) : m.lastSeenRel ? (
                  <span>last active {m.lastSeenRel}</span>
                ) : (
                  <span>Offline</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
