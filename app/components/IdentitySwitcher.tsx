import { useEffect } from "react";
import { useFetcher } from "react-router";

interface Identity {
  id: string;
  linkedUserId: string;
  linkedDisplayName: string;
  linkedRole: string;
}

interface LoaderData { identities: Identity[] }
interface ActionData { ok: boolean; redirectUrl: string | null }

export function IdentitySwitcher() {
  const loader = useFetcher<LoaderData>();
  const switcher = useFetcher<ActionData>();

  useEffect(() => {
    if (loader.state === "idle" && !loader.data) {
      loader.load("/resources/identities");
    }
  }, [loader]);

  useEffect(() => {
    if (switcher.state === "idle" && switcher.data?.ok && switcher.data.redirectUrl) {
      window.location.href = switcher.data.redirectUrl;
    }
  }, [switcher.state, switcher.data]);

  const identities = loader.data?.identities ?? [];
  if (!identities.length) return null;

  function switchTo(linkedUserId: string) {
    const form = new FormData();
    form.append("linkedUserId", linkedUserId);
    switcher.submit(form, { method: "POST", action: "/resources/identities" });
  }

  const submitting = switcher.state !== "idle";
  const error = switcher.state === "idle" && switcher.data && !switcher.data.ok
    ? "Could not switch identity"
    : "";

  return (
    <div className="border-t border-ih-border pt-2 mt-2">
      <div className="text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 mb-1 px-3">
        Switch identity
      </div>
      {identities.map((id) => (
        <button
          key={id.id}
          className="w-full text-left px-3 py-2 hover:bg-ih-bg-muted flex items-center gap-2"
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
