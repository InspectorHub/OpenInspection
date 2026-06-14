import { useState, useEffect } from "react";
import { useFetcher } from "react-router";
import { getCapabilities, TOGGLEABLE, type Capability, type CapabilitySet, type PermissionOverrides } from "../../../server/lib/auth/capabilities";

type Role = "owner" | "manager" | "inspector" | "agent";

const ROLE_DESC: Record<Role, string> = {
 owner: "Full access, including billing and ownership transfer.",
 manager: "Full access to inspections, templates, and team management.",
 inspector: "Create and edit inspections they're assigned to.",
 agent: "Read-only buyer-agent view.",
};

/** Advanced-permissions toggle labels, in TOGGLEABLE order. */
export const CAP_LABELS: Record<Capability, string> = {
 publish: "Publish reports",
 scheduleOthers: "Schedule for others",
 financial: "Financial data",
 manageContacts: "Manage contacts",
};

/**
 * Reduce the edited capability set to only the toggles that differ from the
 * role's template default (happy-dom has no render harness, so the submit
 * logic lives here and is unit-tested directly — see invite-overrides.spec).
 */
export function computeOverrideDiff(role: Role, caps: CapabilitySet): PermissionOverrides {
 const template = getCapabilities(role, null);
 const diff: PermissionOverrides = {};
 for (const cap of TOGGLEABLE) {
  if (caps[cap] !== template[cap]) diff[cap] = caps[cap];
 }
 return diff;
}

interface InviteSeatModalProps {
 open: boolean;
 onClose: () => void;
}

export function InviteSeatModal({ open, onClose }: InviteSeatModalProps) {
 const [email, setEmail] = useState("");
 const [notify, setNotify] = useState(true);
 const [role, setRole] = useState<Role>("inspector");
 const [advancedOpen, setAdvancedOpen] = useState(false);
 // Effective capability set the toggles render. Re-derived from the role
 // template whenever the role changes (so the disclosure always shows the
 // selected role's defaults until the inviter edits them).
 const [caps, setCaps] = useState(() => getCapabilities("inspector", null));
 const [error, setError] = useState("");

 useEffect(() => {
  setCaps(getCapabilities(role, null));
 }, [role]);

 const inviteFetcher = useFetcher<{ ok: boolean; intent?: string | null; error: string | null; url: string | null }>();
 const submitting = inviteFetcher.state !== "idle";

 useEffect(() => {
  const d = inviteFetcher.data;
  if (!d) return;
  if (!d.ok) {
   setError(d.error ?? "Failed");
   return;
  }
  if (d.intent === "invite") {
   onClose();
  }
 }, [inviteFetcher.data, onClose]);

 if (!open) return null;

 function submitPermanent() {
  if (submitting) return;
  setError("");
  // Only send capabilities that differ from the role template; the server
  // re-diffs and stores null when nothing differs.
  const diff = computeOverrideDiff(role, caps);
  const fd = new FormData();
  fd.append("intent", "invite");
  fd.append("email", email);
  fd.append("role", role);
  if (Object.keys(diff).length > 0) fd.append("permissionOverrides", JSON.stringify(diff));
  inviteFetcher.submit(fd, { method: "POST", action: "/resources/team-members" });
 }

 return (
 <div className="fixed inset-0 z-50 bg-[rgba(15,23,42,0.7)] flex items-center justify-center p-6" onClick={onClose} role="dialog" aria-modal="true" aria-label="Invite seat">
 <div className="max-w-md w-full bg-ih-bg-card rounded-xl shadow-ih-popover" onClick={(e) => e.stopPropagation()}>
 <header className="px-6 py-4 border-b border-ih-border flex items-center gap-4">
 <h2 className="text-lg font-bold flex-1 text-ih-fg-1">Invite</h2>
 </header>

 <div className="p-6 space-y-4">
 <div className="space-y-3">
 <label className="block">
 <span className="block text-[10px] font-bold uppercase tracking-widest text-ih-fg-3 mb-1">Email</span>
 <input className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-sm text-ih-fg-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
 </label>
 <label className="flex items-center gap-2 text-sm text-ih-fg-3">
 <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
 Send email notification
 </label>
 </div>

 <label className="block">
 <span className="block text-[10px] font-bold uppercase tracking-widest text-ih-fg-3 mb-1">Role</span>
 <select className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-sm text-ih-fg-1" value={role} onChange={(e) => setRole(e.target.value as Role)}>
 <option value="manager">Manager</option>
 <option value="inspector">Inspector</option>
 <option value="agent">Agent</option>
 </select>
 </label>
 <p className="text-xs text-ih-fg-3">{ROLE_DESC[role]}</p>

 <div className="border-t border-ih-border pt-3">
 <button
 type="button"
 onClick={() => setAdvancedOpen((v) => !v)}
 aria-expanded={advancedOpen}
 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-ih-fg-3 hover:text-ih-fg-1"
 >
 <span className={`transition-transform ${advancedOpen ? "rotate-90" : ""}`} aria-hidden="true">▸</span>
 Advanced permissions
 </button>
 {advancedOpen && (
 <div className="mt-3 space-y-2">
 {TOGGLEABLE.map((cap) => (
 <label key={cap} className="flex items-center gap-2 text-sm text-ih-fg-3">
 <input
 type="checkbox"
 checked={caps[cap]}
 onChange={(e) => setCaps((prev) => ({ ...prev, [cap]: e.target.checked }))}
 />
 {CAP_LABELS[cap]}
 </label>
 ))}
 </div>
 )}
 </div>

 {error && <p className="text-xs text-ih-bad-fg font-semibold">{error}</p>}
 </div>

 <footer className="px-6 py-4 border-t border-ih-border flex justify-end gap-2">
 <button onClick={onClose} className="px-4 h-10 rounded-xl border border-ih-border text-sm font-semibold text-ih-fg-3 hover:bg-ih-bg-muted">Cancel</button>
 <button onClick={submitPermanent} disabled={submitting} className="px-4 h-10 rounded-xl bg-ih-primary text-white text-sm font-semibold hover:bg-ih-primary-600 disabled:opacity-50">Send invite</button>
 </footer>
 </div>
 </div>
 );
}
