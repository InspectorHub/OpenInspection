import { useState, useEffect } from "react";

interface Identity {
  id: string;
  linkedUserId: string;
  linkedDisplayName: string;
  linkedRole: string;
}

export function IdentitySwitcher() {
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/identities", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setIdentities((d as { data?: Identity[] }).data ?? []))
      .catch(() => {});
  }, []);

  if (!identities.length) return null;

  async function switchTo(linkedUserId: string) {
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/identities/switch", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkedUserId }),
      });
      if (!res.ok) throw new Error("Switch failed");
      const data = (await res.json()) as { redirect?: string };
      window.location.href = data.redirect ?? "/dashboard";
    } catch {
      setError("Could not switch identity");
      setSubmitting(false);
    }
  }

  return (
    <div className="border-t border-slate-100 dark:border-slate-700 pt-2 mt-2">
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1 px-3">
        Switch identity
      </div>
      {identities.map((id) => (
        <button
          key={id.id}
          className="w-full text-left px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-2"
          onClick={() => switchTo(id.linkedUserId)}
          disabled={submitting}
        >
          <div className="w-7 h-7 rounded-full bg-ih-bg-muted flex items-center justify-center text-xs font-bold text-ih-fg-2">
            {(id.linkedDisplayName || "?").slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{id.linkedDisplayName}</div>
            <div className="text-xs text-ih-fg-3">{id.linkedRole}</div>
          </div>
        </button>
      ))}
      {error && <p className="text-[11px] text-ih-bad-fg px-3">{error}</p>}
    </div>
  );
}
