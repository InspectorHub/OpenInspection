import { useRef, useState } from "react";
import { NavLink } from "react-router";
import { Avatar, Pill, Popover } from "@core/shared-ui";
import { ThemeSegmentControl } from "~/components/sidebar/ThemeSegmentControl";
import { m } from "~/paraglide/messages";

/** The signed-in agent, as `GET /api/agent/profile` answered it. */
export interface AgentPortalAccount {
  name: string | null;
  email: string;
}

/**
 * Who is signed in, in the agent portal's header.
 *
 * Every page of this portal used to carry one account affordance — a bare
 * `Log out` — and nothing that said whose account was being logged out of. That
 * was survivable only while the portal admitted agents and nobody else; it was
 * not, so a staff member served this portal by mistake had no email, no name, no
 * role and no avatar anywhere on screen to tell them they were standing in
 * somebody else's front door. The guard
 * (app/lib/agent-portal-access.server.ts) closes the admission; this closes the
 * half that made it invisible.
 *
 * ── A deliberate fork from app/components/sidebar/UserMenuPopover.tsx ────────
 * CLAUDE.md's Cross-Portal Reuse rule asks a fork to state the invariant that
 * makes the two genuinely different, so: the tenant menu's subject is a
 * WORKSPACE. Its body is the company name, the tenant slug and a
 * Switch-workspace link, because a staff session is scoped to exactly one tenant
 * and may hold more. An agent is a GLOBAL user (`users.tenant_id IS NULL`) who
 * reaches many companies through `agent_tenant_links` and is scoped to none of
 * them — there is no workspace to name, none to switch to, and the subject of
 * the menu is the person instead. That is a different identity model, not a
 * read-only variant of the same one, and no prop expresses it.
 *
 * What IS shared is shared: the Popover primitive, Avatar, Pill, and the very
 * same ThemeSegmentControl instance the tenant menu mounts.
 *
 * Language is deliberately NOT here, though the tenant menu has it: the
 * LocaleSwitcher persists its choice by submitting to `/settings/profile`, a
 * tenant route an agent is not authorized to POST to, and `POST
 * /api/agent/profile` has no locale field to carry it. Shipping the control
 * would add a switch that silently fails — the dead-control defect this portal
 * was just audited for. It needs the agent-side write first.
 */
export function AgentUserMenu({ account }: { account: AgentPortalAccount | null }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // An agent whose profile row could not be read still gets a working menu; the
  // role is what the menu is for and that is known without it.
  const name = account?.name?.trim() || "";
  const primaryLine = name || account?.email || m.agent_portal_user_menu_role();

  return (
    <span className="ml-2">
      <button
        ref={triggerRef}
        type="button"
        data-testid="agent-user-menu-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={m.agent_portal_user_menu_aria()}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-md hover:bg-ih-bg-muted transition-colors focus:outline-none focus:shadow-ih-focus"
      >
        <Avatar name={name} size={28} variant="self" fallbackIcon="OI" />
        {/* The name rides in the bar itself where there is room, so on a desktop
            the portal answers "who am I signed in as" with no click at all. */}
        <span className="hidden lg:block max-w-[140px] truncate text-[12px] font-bold text-ih-fg-1">
          {primaryLine}
        </span>
        <svg
          className={`w-3 h-3 shrink-0 text-ih-fg-3 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* role="dialog" comes from Popover and is left alone: this panel holds a
          segmented control as well as links, so it is not an ARIA `menu` and must
          not claim to be one. */}
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={triggerRef} align="right">
        <div className="w-[240px] py-1.5" aria-label={m.agent_portal_user_menu_aria()}>
          <div className="px-3 py-2 flex items-start gap-2.5">
            <Avatar name={name} size={32} variant="self" fallbackIcon="OI" />
            <div className="min-w-0">
              <div className="text-[12px] font-bold text-ih-fg-1 truncate">{primaryLine}</div>
              {/* The email is shown even when it is also the line above it: it is
                  the identifier the account is addressed by, and a reader who has
                  two accounts in two browsers needs to see which one this is. */}
              {account?.email && (
                <div className="text-[10px] text-ih-fg-3 truncate">{account.email}</div>
              )}
              {/* The role, because being in the wrong portal was possible. Only
                  one value can reach here — the guard refuses every session the
                  agent API does not accept as an agent — which is the point: it
                  says out loud what the reader otherwise has to infer. */}
              <Pill tone="primary" className="mt-1.5">
                {m.agent_portal_user_menu_role()}
              </Pill>
            </div>
          </div>

          <div className="border-t border-ih-border my-1" />
          <div className="px-3 py-1.5">
            <div className="text-[10px] font-bold text-ih-fg-3 uppercase tracking-wide mb-1.5">
              {m.nav_theme_label()}
            </div>
            <ThemeSegmentControl />
          </div>

          <div className="border-t border-ih-border my-1" />
          {/* ds-allow: compact menu row rhythm (7px), no semantic spacing token */}
          <NavLink
            to="/agent-settings/profile"
            className={({ isActive }) =>
              `flex items-center gap-2 px-3 py-[7px] text-[13px] font-medium transition-colors focus:outline-none focus:bg-ih-bg-muted ${
                isActive
                  ? "text-ih-primary-text bg-ih-primary-tint"
                  : "text-ih-fg-2 hover:bg-ih-bg-muted hover:text-ih-primary-text"
              }`
            }
            onClick={() => setOpen(false)}
          >
            {m.nav_user_profile()}
          </NavLink>
          {/* A real link, not a fetcher: `/agent-logout` is a GET route whose
              loader tears the session down and lands on the agent door. */}
          {/* ds-allow: compact menu row rhythm (7px), no semantic spacing token */}
          <a
            href="/agent-logout"
            data-testid="agent-user-menu-logout"
            className="flex items-center gap-2 px-3 py-[7px] text-[13px] font-medium text-ih-bad-fg hover:bg-ih-bad-bg transition-colors focus:outline-none focus:bg-ih-bad-bg"
          >
            {m.agent_portal_layout_logout()}
          </a>
        </div>
      </Popover>
    </span>
  );
}
