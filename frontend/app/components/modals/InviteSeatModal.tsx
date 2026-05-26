import { useState } from "react";

type Mode = "permanent" | "guest";
type Role = "lead" | "specialist" | "apprentice" | "office";

const ROLE_DESC: Record<Role, string> = {
 lead: "Full access to inspections, templates, and team management.",
 specialist: "Access to assigned sections only.",
 apprentice: "Supervised access — requires mentor approval before publishing.",
 office: "Dashboard, scheduling, and billing. No inspection editing.",
};

const DURATIONS = [
 { seconds: 86400, label: "1 day", price: "$1.49" },
 { seconds: 259200, label: "3 days", price: "$4.47" },
 { seconds: 604800, label: "7 days", price: "$10.43" },
] as const;

interface InviteSeatModalProps {
 open: boolean;
 onClose: () => void;
 leads?: Array<{ id: string; email: string }>;
 sections?: Array<{ id: string; name: string }>;
}

export function InviteSeatModal({ open, onClose, leads = [], sections = [] }: InviteSeatModalProps) {
 const [mode, setMode] = useState<Mode>("permanent");
 const [email, setEmail] = useState("");
 const [notify, setNotify] = useState(true);
 const [role, setRole] = useState<Role>("lead");
 const [mentorId, setMentorId] = useState("");
 const [sectionIds, setSectionIds] = useState<string[]>([]);
 const [durationSeconds, setDurationSeconds] = useState(86400);
 const [generatedUrl, setGeneratedUrl] = useState("");
 const [submitting, setSubmitting] = useState(false);
 const [error, setError] = useState("");

 if (!open) return null;

 function toggleSection(id: string) {
 setSectionIds((prev) => prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]);
 }

 async function submitPermanent() {
 if (submitting) return;
 setSubmitting(true);
 setError("");
 try {
 const res = await fetch("/api/team/invite", {
 method: "POST",
 credentials: "include",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ email, role, notify, mentorId: mentorId || undefined, sectionIds }),
 });
 if (!res.ok) {
 const data = await res.json().catch(() => ({}));
 throw new Error((data as { error?: string })?.error || `HTTP ${res.status}`);
 }
 onClose();
 } catch (e) {
 setError(e instanceof Error ? e.message : "Failed");
 } finally {
 setSubmitting(false);
 }
 }

 async function submitGuest() {
 if (submitting) return;
 setSubmitting(true);
 setError("");
 try {
 const res = await fetch("/api/team/guest-invite", {
 method: "POST",
 credentials: "include",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ role, durationSeconds, sectionIds }),
 });
 if (!res.ok) throw new Error(`HTTP ${res.status}`);
 const data = (await res.json()) as { url: string };
 setGeneratedUrl(data.url);
 } catch (e) {
 setError(e instanceof Error ? e.message : "Failed");
 } finally {
 setSubmitting(false);
 }
 }

 return (
 <div className="fixed inset-0 z-50 bg-slate-900/70 flex items-center justify-center p-6" onClick={onClose} role="dialog" aria-modal="true" aria-label="Invite seat">
 <div className="max-w-md w-full bg-ih-bg-card rounded-xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
 <header className="px-6 py-4 border-b border-ih-border flex items-center gap-4">
 <h2 className="text-lg font-bold flex-1 text-ih-fg-1">Invite</h2>
 <div className="flex gap-1">
 {(["permanent", "guest"] as const).map((m) => (
 <button key={m} onClick={() => setMode(m)} className={`px-3 py-1 rounded-md text-sm font-semibold transition-colors ${mode === m ? "bg-ih-primary text-white" : "text-ih-fg-3 hover:bg-slate-100 dark:hover:bg-slate-700"}`}>
 {m.charAt(0).toUpperCase() + m.slice(1)}
 </button>
 ))}
 </div>
 </header>

 <div className="p-6 space-y-4">
 {mode === "permanent" && (
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
 )}

 <label className="block">
 <span className="block text-[10px] font-bold uppercase tracking-widest text-ih-fg-3 mb-1">Role</span>
 <select className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-sm text-ih-fg-1" value={role} onChange={(e) => setRole(e.target.value as Role)}>
 <option value="lead">Lead inspector</option>
 <option value="specialist">Specialist</option>
 <option value="apprentice">Apprentice</option>
 <option value="office">Office staff</option>
 </select>
 </label>
 <p className="text-xs text-ih-fg-3">{ROLE_DESC[role]}</p>

 {role === "apprentice" && (
 <label className="block">
 <span className="block text-[10px] font-bold uppercase tracking-widest text-ih-fg-3 mb-1">Mentor</span>
 <select className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-sm text-ih-fg-1" value={mentorId} onChange={(e) => setMentorId(e.target.value)}>
 <option value="">Select a lead inspector...</option>
 {leads.map((m) => <option key={m.id} value={m.id}>{m.email}</option>)}
 </select>
 </label>
 )}

 {role === "specialist" && (
 <div>
 <span className="block text-[10px] font-bold uppercase tracking-widest text-ih-fg-3 mb-1">Assigned sections</span>
 <div className="p-3 max-h-40 overflow-y-auto space-y-1 bg-slate-50 dark:bg-slate-700 rounded-md border border-ih-border">
 {sections.length === 0 ? (
 <p className="text-xs text-slate-400">No template sections loaded yet.</p>
 ) : sections.map((s) => (
 <label key={s.id} className="flex items-center gap-2 text-sm text-ih-fg-3">
 <input type="checkbox" checked={sectionIds.includes(s.id)} onChange={() => toggleSection(s.id)} />
 <span>{s.name}</span>
 </label>
 ))}
 </div>
 </div>
 )}

 {mode === "guest" && (
 <>
 <div>
 <span className="block text-[10px] font-bold uppercase tracking-widest text-ih-fg-3 mb-1">Duration</span>
 <div className="flex gap-2 flex-wrap">
 {DURATIONS.map((d) => (
 <label key={d.seconds} className="flex items-center gap-1 text-sm text-ih-fg-3">
 <input type="radio" checked={durationSeconds === d.seconds} onChange={() => setDurationSeconds(d.seconds)} />
 <span>{d.label} <span className="text-xs text-slate-400">{d.price}</span></span>
 </label>
 ))}
 </div>
 <p className="text-xs text-ih-fg-3 mt-2">Guest counts against your team's seat quota while active.</p>
 </div>

 {generatedUrl && (
 <div className="p-3 bg-ih-ok-bg border border-ih-ok rounded-md">
 <div className="text-[10px] font-bold uppercase text-ih-ok-fg mb-1">Invite link (one-time)</div>
 <input className="w-full px-2 py-1 text-xs rounded border border-ih-border bg-ih-bg-card text-ih-fg-1" readOnly value={generatedUrl} />
 <button className="mt-2 px-3 py-1 text-xs font-semibold rounded bg-ih-bg-card border border-ih-border text-ih-fg-3" onClick={() => navigator.clipboard.writeText(generatedUrl)}>Copy link</button>
 </div>
 )}
 </>
 )}

 {error && <p className="text-xs text-ih-bad-fg font-semibold">{error}</p>}
 </div>

 <footer className="px-6 py-4 border-t border-ih-border flex justify-end gap-2">
 <button onClick={onClose} className="px-4 h-10 rounded-xl border border-ih-border text-sm font-semibold text-ih-fg-3 hover:bg-ih-bg-muted">Cancel</button>
 {mode === "permanent" && (
 <button onClick={submitPermanent} disabled={submitting} className="px-4 h-10 rounded-xl bg-ih-primary text-white text-sm font-semibold hover:bg-ih-primary-600 disabled:opacity-50">Send invite</button>
 )}
 {mode === "guest" && !generatedUrl && (
 <button onClick={submitGuest} disabled={submitting} className="px-4 h-10 rounded-xl bg-ih-primary text-white text-sm font-semibold hover:bg-ih-primary-600 disabled:opacity-50">Generate link</button>
 )}
 </footer>
 </div>
 </div>
 );
}
