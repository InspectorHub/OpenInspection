import { useState, useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import { Drawer } from "@core/shared-ui";
import { getCapabilities, TOGGLEABLE, type Capability, type CapabilitySet, type PermissionOverrides } from "../../../server/lib/auth/capabilities";
// TOGGLEABLE is still the source of truth for computeOverrideDiff below; the
// RENDERING now walks CAP_GROUPS so the two drawers cannot group differently.
import { SeatLimitPanel } from "./SeatLimitPanel";
import { m } from "~/paraglide/messages";

const FORM_ID = "invite-seat-form";

// Only the roles this drawer can actually offer. `owner` and `agent` were
// carried here long after the select stopped listing them (IA-101 removed
// agent; owner was never selectable), leaving two unreachable branches in
// ROLE_DESC below — one of which advertised an "ownership transfer" feature
// that does not exist anywhere in the product (IA-125).
type Role = "manager" | "inspector";

// Thunks (not eager strings) so each description resolves at render inside the
// paraglide request scope, not once at module import.
const ROLE_DESC: Record<Role, () => string> = {
 manager: () => m.modal_invite_role_desc_manager(),
 inspector: () => m.modal_invite_role_desc_inspector(),
};

/**
 * Advanced-permissions toggle labels, in TOGGLEABLE order. Exposed as getters so each
 * label resolves at access time inside the paraglide request scope, not frozen at import.
 */
export const CAP_LABELS: Record<Capability, string> = {
 get publish() { return m.label_cap_publish(); },
 get scheduleOthers() { return m.label_cap_schedule_others(); },
 get financial() { return m.label_cap_financial(); },
 get manageContacts() { return m.label_cap_manage_contacts(); },
 get viewCommunication() { return m.label_cap_view_communication(); },
 get templateCreate() { return m.label_cap_template_create(); },
 get templateEdit()   { return m.label_cap_template_edit(); },
 get templateDelete() { return m.label_cap_template_delete(); },
 get templateImport() { return m.label_cap_template_import(); },
};

/**
 * Grouping is a presentation fact and lives with the labels, so the two
 * drawers cannot group differently. EditMemberDrawer already imports
 * CAP_LABELS and computeOverrideDiff from here for the same reason.
 *
 * `invite-overrides.test.ts` asserts this covers TOGGLEABLE exactly once: a
 * tenth capability added to TOGGLEABLE and forgotten here would simply not
 * render -- unsettable by anyone, in silence. That is #77 again, one layer up.
 */
export const CAP_GROUPS: ReadonlyArray<{ id: string; label: () => string; caps: readonly Capability[] }> = [
 {
  id: "general",
  label: () => m.modal_invite_cap_group_general(),
  caps: ["publish", "scheduleOthers", "financial", "manageContacts", "viewCommunication"],
 },
 {
  id: "templates",
  label: () => m.modal_invite_cap_group_templates(),
  caps: ["templateCreate", "templateEdit", "templateDelete", "templateImport"],
 },
];

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

interface InviteSeatDrawerProps {
 open: boolean;
 onClose: () => void;
 /**
  * Optional at-open seat-limit gate. The caller (the `/team` route, which
  * already loads `sessionCtx.seatUsage` for the SeatBanner above the page)
  * passes this so a tenant already at its seat cap sees the upgrade panel
  * the instant the invite drawer opens, instead of filling in email/role/
  * permissions and only finding out on submit (the server's 402
  * SEAT_LIMIT_REACHED, caught by the existing error state below, remains the
  * authoritative backstop for races). `undefined` (the default) = no gate —
  * under the seat limit, unlimited (`sessionCtx.seatUsage` null), or any
  * future mount with no quota context. `billingUrl` is omitted when no
  * billing portal is configured (the CTA is hidden in that case).
  */
 seatLimitAtOpen?: { used: number; max: number; billingUrl?: string };
}

export function InviteSeatDrawer({ open, onClose, seatLimitAtOpen }: InviteSeatDrawerProps) {
 const [email, setEmail] = useState("");
 const [notify, setNotify] = useState(true);
 const [role, setRole] = useState<Role>("inspector");
 const [advancedOpen, setAdvancedOpen] = useState(false);
 // Effective capability set the toggles render. Re-derived from the role
 // template whenever the role changes (so the disclosure always shows the
 // selected role's defaults until the inviter edits them).
 const [caps, setCaps] = useState(() => getCapabilities("inspector", null));
 const [error, setError] = useState("");
 // At-open seat-limit gate — seeded from the caller-supplied prop every time
 // the drawer opens (not on every re-render) so a tenant already at cap sees
 // the panel immediately. Deliberately keyed only on `open`: re-evaluating
 // whenever the parent re-renders while the drawer is already open would let
 // a background loader revalidation flip this mid-fill.
 const [seatLimit, setSeatLimit] = useState<{ used: number; max: number; billingUrl?: string } | undefined>(seatLimitAtOpen);
 const emailRef = useRef<HTMLInputElement>(null);

 useEffect(() => {
  setCaps(getCapabilities(role, null));
 }, [role]);

 useEffect(() => {
  if (open) setSeatLimit(seatLimitAtOpen);
 }, [open]);

 const inviteFetcher = useFetcher<{ ok: boolean; intent?: string | null; error: string | null; url: string | null }>();
 const submitting = inviteFetcher.state !== "idle";

 useEffect(() => {
  const d = inviteFetcher.data;
  if (!d) return;
  if (!d.ok) {
   setError(d.error ?? m.modal_invite_error_failed());
   return;
  }
  if (d.intent === "invite") {
   onClose();
  }
 }, [inviteFetcher.data, onClose]);

 function submitPermanent(e?: React.FormEvent) {
  e?.preventDefault();
  if (submitting) return;
  setError("");
  // Only send capabilities that differ from the role template; the server
  // re-diffs and stores null when nothing differs.
  const diff = computeOverrideDiff(role, caps);
  const fd = new FormData();
  fd.append("intent", "invite");
  fd.append("email", email);
  fd.append("role", role);
 // Sent explicitly, both ways. This checkbox existed for a long time and was
 // never submitted, so unticking "send email" emailed them anyway; the field
 // is written on every submit now rather than only when false, so the request
 // says what the screen says.
 fd.append("notify", notify ? "true" : "false");
  if (Object.keys(diff).length > 0) fd.append("permissionOverrides", JSON.stringify(diff));
  inviteFetcher.submit(fd, { method: "POST", action: "/resources/team-members" });
 }

 return (
 <Drawer
 open={open}
 onClose={onClose}
 title={m.modal_invite_title()}
 initialFocusRef={emailRef}
 footer={
 seatLimit ? undefined : (
 <>
 <button type="button" onClick={onClose} className="px-4 h-10 rounded-xl border border-ih-border text-sm font-semibold text-ih-fg-3 hover:bg-ih-bg-muted">{m.common_cancel()}</button>
 <button type="submit" form={FORM_ID} disabled={submitting} className="px-4 h-10 rounded-xl bg-ih-primary text-ih-fg-inverse text-sm font-semibold hover:bg-ih-primary-600 disabled:opacity-50">{m.modal_invite_send()}</button>
 </>
 )
 }
 >
 {seatLimit ? (
 <SeatLimitPanel used={seatLimit.used} max={seatLimit.max} billingUrl={seatLimit.billingUrl} onClose={onClose} />
 ) : (
 <form id={FORM_ID} onSubmit={submitPermanent} className="space-y-4">
 <div className="space-y-3">
 <label className="block">
 <span className="block text-[10px] font-bold uppercase tracking-widest text-ih-fg-3 mb-1">{m.modal_invite_email_label()}</span>
 <input ref={emailRef} className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-sm text-ih-fg-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
 </label>
 <label className="flex items-center gap-2 text-sm text-ih-fg-3">
 <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
 {m.modal_invite_notify_label()}
 </label>
 </div>

 <label className="block">
 <span className="block text-[10px] font-bold uppercase tracking-widest text-ih-fg-3 mb-1">{m.modal_invite_role_label()}</span>
 <select className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-sm text-ih-fg-1" value={role} onChange={(e) => setRole(e.target.value as Role)}>
 <option value="manager">{m.modal_invite_role_manager()}</option>
 <option value="inspector">{m.modal_invite_role_inspector()}</option>
 {/* IA-101 — no agent option. An agent reaches an inspection through a
 per-inspection access token that works with no account at all, so
 inviting one to a SEAT was a second, contradictory way to become an
 agent — and it put them on the seat count, which is not how the
 industry bills. Agents are granted access from the inspection's
 People section; the API refuses the role here too. */}
 </select>
 </label>
 <p className="text-xs text-ih-fg-3">{ROLE_DESC[role]()}</p>

 <div className="border-t border-ih-border pt-3">
 <button
 type="button"
 onClick={() => setAdvancedOpen((v) => !v)}
 aria-expanded={advancedOpen}
 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-ih-fg-3 hover:text-ih-fg-1"
 >
 <span className={`transition-transform ${advancedOpen ? "rotate-90" : ""}`} aria-hidden="true">▸</span>
 {m.modal_invite_advanced()}
 </button>
 {advancedOpen && (
 <div className="mt-3 space-y-3">
 {CAP_GROUPS.map((group) => (
 <div key={group.id} className="space-y-2">
 <span className="block text-[10px] font-bold uppercase tracking-widest text-ih-fg-3">{group.label()}</span>
 {group.caps.map((cap) => (
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
 ))}
 </div>
 )}
 </div>

 {error && <p className="text-xs text-ih-bad-fg font-semibold">{error}</p>}
 </form>
 )}
 </Drawer>
 );
}
