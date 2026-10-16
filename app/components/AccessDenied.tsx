/**
 * Shown when someone reaches a page their role does not open. The server still enforces
 * RBAC on the underlying API; this is the friendly UI face of that block. It says who the
 * server thinks is looking (the role), who the page is for, and how to get in, rather than
 * only that access is denied.
 */
import { m } from "~/paraglide/messages";
import { useSessionContext } from "~/hooks/useSessionContext";

const SIGNED_IN_AS: Record<string, () => string> = {
  owner: () => m.access_denied_you_are_owner(),
  manager: () => m.access_denied_you_are_manager(),
  inspector: () => m.access_denied_you_are_inspector(),
  staff: () => m.access_denied_you_are_staff(),
  agent: () => m.access_denied_you_are_agent(),
};

/** What the page asks of the viewer: the owner/manager tier, the owner alone, one permission, or simply not being office staff. */
export type AccessNeed = "admin" | "owner" | "companyFinance" | "notStaff";

const NEEDS: Record<AccessNeed, () => string> = {
  admin: () => m.access_denied_needs_admin(),
  owner: () => m.access_denied_needs_owner(),
  companyFinance: () => m.access_denied_needs_finance(),
  notStaff: () => m.access_denied_needs_not_staff(),
};

export function AccessDenied({ title, needs = "admin" }: { title?: string; needs?: AccessNeed } = {}) {
  const role = useSessionContext()?.user.role;
  const signedInAs = role ? SIGNED_IN_AS[role]?.() : undefined;
  // "Admins only" is the title for the owner/manager pages; any other requirement gets the neutral one.
  const heading = title ?? (needs === "admin" ? m.access_denied_title() : m.access_denied_title_neutral());
  return (
    <div className="bg-ih-bg-card border border-ih-border rounded-lg p-8 text-center">
      <p className="text-ih-fg-1 font-semibold">{heading}</p>
      <p className="text-ih-fg-3 text-[13px] mt-1">
        {m.access_denied_body()}
        {signedInAs ? ` ${signedInAs}` : ""}
        {` ${NEEDS[needs]()}`}
      </p>
    </div>
  );
}
