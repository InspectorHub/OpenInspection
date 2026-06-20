import { Link } from "react-router";

export interface HubCardProps {
  to: string;
  title: string;
  desc: string;
  icon: string; // SVG path d
}

export function HubCard({ to, title, desc, icon }: HubCardProps) {
  return (
    <Link
      to={to}
      className="group p-4 bg-ih-bg-card border border-ih-border rounded-lg hover:shadow-ih-popover hover:border-ih-border transition-all"
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-ih-primary-tint text-ih-primary flex items-center justify-center flex-shrink-0">
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d={icon}
            />
          </svg>
        </div>
        <div>
          <h3 className="font-bold text-[14px] text-ih-fg-1 group-hover:text-ih-primary">
            {title}
          </h3>
          <p className="text-[12px] text-ih-fg-3 mt-0.5">{desc}</p>
        </div>
      </div>
    </Link>
  );
}

// Shared grid className used by every hub so the layout lives in one place.
export const HUB_GRID_CLASS =
  "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3";
