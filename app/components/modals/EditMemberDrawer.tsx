/**
 * Edit an existing team member's role and capabilities (IA-101).
 *
 * The Team page has always shown an "Edit" button beside every active member.
 * It had no onClick — a decoration. The only way to correct someone's role was
 * to remove them and re-invite, which throws away their history for what is
 * usually a typo at invite time.
 *
 * Reuses the invite drawer's shared pieces rather than restating them:
 * `computeOverrideDiff`, `CAP_LABELS`, and the capability toggle list all come
 * from InviteSeatDrawer, so a change to how capabilities are expressed cannot
 * apply to one drawer and miss the other.
 *
 * The differences from invite are real, not cosmetic, which is why this is a
 * separate component: there is no email field (the member exists), no seat
 * gate (no seat is being consumed), and the role list excludes `owner` —
 * transferring ownership is a distinct, riskier operation than adjusting a
 * colleague's access, and folding it in here would make it a two-click
 * accident.
 */
import { useState, useEffect } from "react";
import { useFetcher } from "react-router";
import { Drawer } from "@core/shared-ui";
import { getCapabilities, TOGGLEABLE, type CapabilitySet } from "../../../server/lib/auth/capabilities";
import { CAP_LABELS, computeOverrideDiff } from "./InviteSeatDrawer";
import { m } from "~/paraglide/messages";

const FORM_ID = "edit-member-form";

type EditableRole = "manager" | "inspector";

export interface EditableMember {
  id: string;
  name?: string | null;
  email: string;
  role: string;
  permissionOverrides?: Record<string, boolean> | null;
}

interface EditMemberDrawerProps {
  open: boolean;
  onClose: () => void;
  member: EditableMember | null;
}

export function EditMemberDrawer({ open, onClose, member }: EditMemberDrawerProps) {
  const [role, setRole] = useState<EditableRole>("inspector");
  const [caps, setCaps] = useState<CapabilitySet>(() => getCapabilities("inspector", null));
  const [error, setError] = useState("");

  const fetcher = useFetcher<{ ok: boolean; intent?: string | null; error: string | null }>();
  const submitting = fetcher.state !== "idle";

  // Seed from the member every time the drawer opens. Keyed on `open` and the
  // member id — NOT on the member object, which the parent recreates on every
  // loader revalidation and would otherwise reset a half-finished edit.
  useEffect(() => {
    if (!open || !member) return;
    const seededRole: EditableRole = member.role === "manager" ? "manager" : "inspector";
    setRole(seededRole);
    setCaps(getCapabilities(seededRole, member.permissionOverrides ?? null));
    setError("");
  }, [open, member?.id]);

  // Changing the role re-seeds the toggles from the NEW role's template.
  // Carrying the old role's ticks across would silently express them as
  // overrides against a template that may already grant or deny them.
  function changeRole(next: EditableRole) {
    setRole(next);
    setCaps(getCapabilities(next, null));
  }

  useEffect(() => {
    const d = fetcher.data;
    if (!d) return;
    if (!d.ok) {
      setError(d.error ?? m.modal_edit_member_error_failed());
      return;
    }
    if (d.intent === "update") onClose();
  }, [fetcher.data, onClose]);

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (submitting || !member) return;
    setError("");
    const diff = computeOverrideDiff(role, caps);
    const fd = new FormData();
    fd.append("intent", "update");
    fd.append("id", member.id);
    fd.append("role", role);
    // Always send the field, even when empty: an absent payload means "clear
    // every override" on the server, which is exactly what an all-default
    // capability set should do.
    fd.append("permissionOverrides", JSON.stringify(diff));
    fetcher.submit(fd, { method: "POST", action: "/resources/team-members" });
  }

  const isOwner = member?.role === "owner";

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={m.modal_edit_member_title()}
      footer={
        isOwner ? undefined : (
          <>
            <button type="button" onClick={onClose} className="px-4 h-10 rounded-xl border border-ih-border text-sm font-semibold text-ih-fg-3 hover:bg-ih-bg-muted">
              {m.common_cancel()}
            </button>
            <button type="submit" form={FORM_ID} disabled={submitting} className="px-4 h-10 rounded-xl bg-ih-primary text-ih-fg-inverse text-sm font-semibold hover:bg-ih-primary-600 disabled:opacity-50">
              {m.common_save()}
            </button>
          </>
        )
      }
    >
      {isOwner ? (
        // The API refuses to demote the last owner and refuses a self
        // role-change; rather than let someone fill in a form the server will
        // reject, say so up front. Ownership transfer is not a Team-page edit.
        <p className="text-sm text-ih-fg-3">{m.modal_edit_member_owner_notice()}</p>
      ) : (
        <form id={FORM_ID} onSubmit={submit} className="space-y-4">
          <p className="text-sm text-ih-fg-2">
            <span className="font-semibold text-ih-fg-1">{member?.name || member?.email}</span>
          </p>

          <label className="block">
            <span className="block text-[10px] font-bold uppercase tracking-widest text-ih-fg-3 mb-1">{m.modal_invite_role_label()}</span>
            <select
              className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-sm text-ih-fg-1"
              value={role}
              onChange={(e) => changeRole(e.target.value as EditableRole)}
            >
              <option value="manager">{m.modal_invite_role_manager()}</option>
              <option value="inspector">{m.modal_invite_role_inspector()}</option>
            </select>
          </label>

          <div className="border-t border-ih-border pt-3 space-y-2">
            <span className="block text-[10px] font-bold uppercase tracking-widest text-ih-fg-3">{m.modal_invite_advanced()}</span>
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

          {/* Capability overrides are read from the row on every request, so
              they bite immediately. A ROLE change cannot: the role is a JWT
              claim, so the server ends the member's sessions to make it real.
              Saying so beats having them wonder why they were logged out. */}
          <p className="text-xs text-ih-fg-3">{m.modal_edit_member_role_change_note()}</p>

          {error && <p className="text-xs text-ih-bad-fg font-semibold">{error}</p>}
        </form>
      )}
    </Drawer>
  );
}
