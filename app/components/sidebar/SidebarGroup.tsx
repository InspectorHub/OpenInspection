import { SidebarNavItem } from "~/components/sidebar/SidebarNavItem";
import type { NavItem } from "~/components/sidebar/nav-items";

export function SidebarGroup({ label, items, collapsed }: { label: string; items: NavItem[]; collapsed: boolean }) {
  return (
    <div className="mb-[14px]">
      {!collapsed && (
        <div className="ih-eyebrow px-[10px] mb-[10px]">{label}</div>
      )}
      <div className="flex flex-col gap-[2px]">
        {items.map((item) => (
          <SidebarNavItem key={item.to} item={item} collapsed={collapsed} />
        ))}
      </div>
    </div>
  );
}
