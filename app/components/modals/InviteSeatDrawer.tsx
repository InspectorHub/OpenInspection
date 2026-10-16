import { useState, useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import { Drawer, PENDING_CLASS, pendingProps } from "@core/shared-ui";
import { getCapabilities, pinnedCapabilities, TOGGLEABLE, type Capability, type CapabilitySet, type PermissionOverrides } from "../../../server/lib/auth/capabilities";
import { grantableRoles, newlyGranted } from "../../../server/lib/auth/grant-ceiling";
import type { Role as AnyRole } from "../../../server/lib/auth/roles";
// TOGGLEABLE is still the source of truth for computeOverrideDiff below; the
// RENDERING now walks CAP_GROUPS so the two drawers cannot group differently.
import { SeatLimitPanel } from "./SeatLimitPanel";
import { m } from "~/paraglide/messages";

const FORM_ID = "invite-seat-form";

// Only the roles this drawer can actually offer. `owner` is never selectable
// here (ownership transfer is not a Team-page action) and `agent` is granted per
// inspection from the People section, never as a seat (IA-101).
export type Role = "manager" | "inspector" | "staff";

// Thunks (not eager strings) so each label and description resolves at render
// inside the paraglide request scope, not once at module import. One list feeds
// both drawers' selects, so they cannot offer different roles.
export const ROLE_OPTIONS: ReadonlyArray<{ value: Role; label: () => string; desc: () => string }> = [
 { value: "manager", label: () => m.modal_invite_role_manager(), desc: () => m.modal_invite_role_desc_manager() },
 { value: "inspector", label: () => m.modal_invite_role_inspector(), desc: () => m.modal_invite_role_desc_inspector() },
 { value: "staff", label: () => m.modal_invite_role_staff(), desc: () => m.modal_invite_role_desc_staff() },
];

/** The drawer role a stored role maps to; anything not offered here (owner, agent, unknown) falls back to inspector. */
export function toDrawerRole(stored: string): Role {
 return ROLE_OPTIONS.find((o) => o.value === stored)?.value ?? "inspector";
}

/** True when the role template fixes this switch, so the form shows it greyed out instead of letting it be changed. */
export function isCapabilityLocked(role: Role, cap: Capability): boolean {
 return pinnedCapabilities(role).includes(cap);
}

/**
 * Who is using the drawer, as the session context reports them. The server is
 * the enforcer (`server/lib/auth/grant-ceiling.ts`); the drawer only declines to
 * offer what the server would refuse. No actor, or no capabilities, offers nothing:
 * a form that opens on a failed load must not look more powerful than it is.
 */
export interface DrawerActor {
 role: string;
 capabilities: Partial<CapabilitySet> | null;
}

/** The drawer's actor from the session context. Fail-closed: an unknown viewer is offered nothing to grant. */
export function drawerActorOf(ctx: { user?: { role: string; capabilities?: Partial<CapabilitySet> | null } | null } | null): DrawerActor | null {
 return ctx?.user ? { role: ctx.user.role, capabilities: ctx.user.capabilities ?? null } : null;
}

const isOwnerActor = (actor: DrawerActor | null) => actor?.role === "owner";

/** A switch the actor does not hold themselves, so only an owner can turn it on for someone else. */
function isBeyondActor(actor: DrawerActor | null, cap: Capability): boolean {
 return !isOwnerActor(actor) && actor?.capabilities?.[cap] !== true;
}

/**
 * Whether the switch must be disabled for a reason the ceiling gives. `held` is
 * what the person already has (nothing, for a new invite): keeping or removing
 * something they already hold is never a grant, so the server allows it.
 */
export function isCapabilityBeyondActor(actor: DrawerActor | null, cap: Capability, held: Partial<CapabilitySet> | null): boolean {
 return isBeyondActor(actor, cap) && held?.[cap] !== true;
}

/** Roles the select offers: the ones in ROLE_OPTIONS the actor may place someone in. */
export function offeredRoles(actor: DrawerActor | null): ReadonlyArray<(typeof ROLE_OPTIONS)[number]> {
 const allowed = grantableRoles((actor?.role ?? "agent") as AnyRole);
 return ROLE_OPTIONS.filter((o) => allowed.includes(o.value));
}

/**
 * Whether choosing `role` would turn on something the actor does not hold,
 * through the role's own template (a manager without Company finance cannot make
 * a manager, because that role carries it). `from` is the member's current role and
 * overrides, or null for an invite.
 */
export function roleBeyondActor(
 actor: DrawerActor | null,
 role: Role,
 from: { role: Role; overrides: PermissionOverrides | null } | null,
): boolean {
 if (isOwnerActor(actor)) return false;
 return newlyGranted({ from, to: { role, overrides: null } }).some((cap) => isBeyondActor(actor, cap));
}

/**
 * Advanced-permissions toggle labels, in TOGGLEABLE order. Exposed as getters so each
 * label resolves at access time inside the paraglide request scope, not frozen at import.
 */
export const CAP_LABELS: Record<Capability, string> = {
 get publish() { return m.label_cap_publish(); },
 get scheduleOthers() { return m.label_cap_schedule_others(); },
 get inspectionFees() { return m.label_cap_inspection_fees(); },
 get companyFinance() { return m.label_cap_company_finance(); },
 get manageContacts() { return m.label_cap_manage_contacts(); },
 get viewCommunication() { return m.label_cap_view_communication(); },
 get templateCreate() { return m.label_cap_template_create(); },
 get templateEdit()   { return m.label_cap_template_edit(); },
 get templateDelete() { return m.label_cap_template_delete(); },
 get templateImport() { return m.label_cap_template_import(); },
 get deleteInspection() { return m.label_cap_delete_inspection(); },
 get editReports() { return m.label_cap_edit_reports(); },
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
  caps: ["publish", "scheduleOthers", "inspectionFees", "companyFinance", "manageContacts", "viewCommunication", "deleteInspection", "editReports"],
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
 /** The signed-in person; decides which roles and switches the form offers. */
 actor: DrawerActor | null;
}

export function InviteSeatDrawer({ open, onClose, seatLimitAtOpen, actor }: InviteSeatDrawerProps) {
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

 // The default role may be one this person cannot grant; start on one they can.
 useEffect(() => {
  const usable = offeredRoles(actor).filter((o) => !roleBeyondActor(actor, o.value, null));
  const first = usable[0];
  if (first && !usable.some((o) => o.value === role)) setRole(first.value);
 }, [actor, role]);

 const inviteFetcher = useFetcher<{ ok: boolean; intent?: string | null; error: string | null; url: string | null }>();
 const submitting = inviteFetcher.state !== "idle";
 // Synchronous latch: two submits in one frame both run before `submitting` has rendered.
 const inFlight = useRef(false);
 useEffect(() => {
  if (!submitting) inFlight.current = false;
 }, [submitting]);

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
  if (submitting || inFlight.current) return;
  inFlight.current = true;
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
 <button type="submit" form={FORM_ID} {...pendingProps(submitting)} className={`px-4 h-10 rounded-xl bg-ih-primary text-ih-fg-inverse text-sm font-semibold hover:bg-ih-primary-600 ${PENDING_CLASS}`}>{m.modal_invite_send()}</button>
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
 {offeredRoles(actor).map((o) => {
 const beyond = roleBeyondActor(actor, o.value, null);
 return <option key={o.value} value={o.value} disabled={beyond} title={beyond ? m.modal_invite_role_owner_only() : undefined}>{o.label()}</option>;
 })}
 {/* IA-101 — no agent option. An agent reaches an inspection through a
 per-inspection access token that works with no account at all, so
 inviting one to a SEAT was a second, contradictory way to become an
 agent — and it put them on the seat count, which is not how the
 industry bills. Agents are granted access from the inspection's
 People section; the API refuses the role here too. */}
 </select>
 </label>
 <p className="text-xs text-ih-fg-3">{ROLE_OPTIONS.find((o) => o.value === role)?.desc()}</p>

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
 disabled={isCapabilityLocked(role, cap) || isCapabilityBeyondActor(actor, cap, null)}
 title={isCapabilityLocked(role, cap) ? m.modal_invite_cap_pinned_read_only() : isCapabilityBeyondActor(actor, cap, null) ? m.modal_invite_cap_owner_only() : undefined}
 onChange={(e) => setCaps((prev) => ({ ...prev, [cap]: e.target.checked }))}
 />
 {CAP_LABELS[cap]}
 {!isCapabilityLocked(role, cap) && isCapabilityBeyondActor(actor, cap, null) && <span className="text-xs text-ih-fg-3">{m.modal_invite_cap_owner_only()}</span>}
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
