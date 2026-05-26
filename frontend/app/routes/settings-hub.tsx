import { Link } from "react-router";

const GROUPS = [
  {
    to: "/settings/profile",
    title: "Profile",
    desc: "Inspector identity. Shown on reports.",
    icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
  },
  {
    to: "/settings/workspace",
    title: "Workspace",
    desc: "Branding, report theme, analytics.",
    icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4",
  },
  {
    to: "/settings/services",
    title: "Services & catalog",
    desc: "Inspection types, fees, add-ons.",
    icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01",
  },
  {
    to: "/settings/communication",
    title: "Communication",
    desc: "Email delivery, calendar sync.",
    icon: "M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z",
  },
  {
    to: "/settings/automations",
    title: "Automations",
    desc: "Email triggers and rules.",
    icon: "M13 10V3L4 14h7v7l9-11h-7z",
  },
  {
    to: "/settings/data",
    title: "Data",
    desc: "Import, export, GDPR.",
    icon: "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4",
  },
  {
    to: "/settings/widget",
    title: "Embed widget",
    desc: "Booking widget for your site.",
    icon: "M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4",
  },
  {
    to: "/settings/account",
    title: "Account",
    desc: "Password, two-factor, security.",
    icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z",
  },
  {
    to: "/settings/advanced",
    title: "Advanced",
    desc: "Payments, AI, integrations.",
    icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
  },
];

export default function SettingsHub() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {GROUPS.map((g) => (
        <Link
          key={g.to}
          to={g.to}
          className="group p-4 bg-ih-bg-card border border-ih-border rounded-lg hover:shadow-md hover:border-ih-border transition-all"
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
                  d={g.icon}
                />
              </svg>
            </div>
            <div>
              <h3 className="font-bold text-[14px] text-ih-fg-1 group-hover:text-ih-primary">
                {g.title}
              </h3>
              <p className="text-[12px] text-ih-fg-3 mt-0.5">{g.desc}</p>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
