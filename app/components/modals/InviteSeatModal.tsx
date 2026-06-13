import { useState, useEffect } from "react";
import { useFetcher } from "react-router";

type Role = "lead" | "specialist" | "office";

const ROLE_DESC: Record<Role, string> = {
 lead: "Full access to inspections, templates, and team management.",
 specialist: "Access to assigned sections only.",
 office: "Dashboard, scheduling, and billing. No inspection editing.",
};

interface InviteSeatModalProps {
 open: boolean;
 onClose: () => void;
 sections?: Array<{ id: string; name: string }>;
}

export function InviteSeatModal({ open, onClose, sections = [] }: InviteSeatModalProps) {
 const [email, setEmail] = useState("");
 const [notify, setNotify] = useState(true);
 const [role, setRole] = useState<Role>("lead");
 const [sectionIds, setSectionIds] = useState<string[]>([]);
 const [error, setError] = useState("");

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

 function toggleSection(id: string) {
 setSectionIds((prev) => prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]);
 }

 function submitPermanent() {
  if (submitting) return;
  setError("");
  const fd = new FormData();
  fd.append("intent", "invite");
  fd.append("email", email);
  fd.append("role", role);
  if (sectionIds.length > 0) fd.append("assignedSectionIds", JSON.stringify(sectionIds));
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
 <option value="lead">Lead inspector</option>
 <option value="specialist">Specialist</option>
 <option value="office">Office staff</option>
 </select>
 </label>
 <p className="text-xs text-ih-fg-3">{ROLE_DESC[role]}</p>

 {role === "specialist" && (
 <div>
 <span className="block text-[10px] font-bold uppercase tracking-widest text-ih-fg-3 mb-1">Assigned sections</span>
 <div className="p-3 max-h-40 overflow-y-auto space-y-1 bg-ih-bg-muted rounded-md border border-ih-border">
 {sections.length === 0 ? (
 <p className="text-xs text-ih-fg-4">No template sections loaded yet.</p>
 ) : sections.map((s) => (
 <label key={s.id} className="flex items-center gap-2 text-sm text-ih-fg-3">
 <input type="checkbox" checked={sectionIds.includes(s.id)} onChange={() => toggleSection(s.id)} />
 <span>{s.name}</span>
 </label>
 ))}
 </div>
 </div>
 )}

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
