import { NavLink } from "react-router";
import type { NavItem } from "~/components/sidebar/nav-items";

export function SidebarNavItem({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  return (
    /* ds-allow: compact sidebar nav item rhythm (10/7px), no semantic spacing token */
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        `flex items-center gap-2.5 px-[10px] py-[7px] rounded-ih-button text-[13px] font-medium transition-all ${
          isActive
            ? "bg-ih-primary-tint text-ih-primary-text font-bold"
            : "text-ih-fg-2 hover:bg-ih-bg-muted hover:text-ih-primary-text"
        } ${collapsed ? "justify-center" : ""}`
      }
      title={collapsed ? item.label() : undefined}
    >
      {item.icon}
      {!collapsed && <span>{item.label()}</span>}
      {!collapsed && (item.badge ?? 0) > 0 && (
        <span className="ml-auto inline-flex items-center h-4 min-w-4 justify-center px-1 rounded-full bg-ih-primary text-ih-primary-fg text-[10px] font-bold tabular-nums">
          {item.badge}
        </span>
      )}
    </NavLink>
  );
}
