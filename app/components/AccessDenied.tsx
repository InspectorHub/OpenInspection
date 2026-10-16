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

export function AccessDenied({ title, needs = "admin" }: { title?: string; needs?: "admin" | "owner" } = {}) {
  const role = useSessionContext()?.user.role;
  const signedInAs = role ? SIGNED_IN_AS[role]?.() : undefined;
  return (
    <div className="bg-ih-bg-card border border-ih-border rounded-lg p-8 text-center">
      <p className="text-ih-fg-1 font-semibold">{title ?? m.access_denied_title()}</p>
      <p className="text-ih-fg-3 text-[13px] mt-1">
        {m.access_denied_body()}
        {signedInAs ? ` ${signedInAs}` : ""}
        {` ${needs === "owner" ? m.access_denied_needs_owner() : m.access_denied_needs_admin()}`}
      </p>
    </div>
  );
}
