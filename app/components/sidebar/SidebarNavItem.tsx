import { NavLink } from "react-router";
import type { NavItem } from "~/components/sidebar/nav-items";

export function SidebarNavItem({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        `flex items-center gap-2.5 px-[10px] py-[7px] rounded-[6px] text-[13px] font-medium transition-all ${
          isActive
            ? "bg-ih-primary-tint text-ih-primary font-bold"
            : "text-ih-fg-2 hover:bg-ih-bg-muted hover:text-ih-primary"
        } ${collapsed ? "justify-center" : ""}`
      }
      title={collapsed ? item.label : undefined}
    >
      {item.icon}
      {!collapsed && <span>{item.label}</span>}
    </NavLink>
  );
}
