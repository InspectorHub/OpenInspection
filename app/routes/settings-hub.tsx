import { HubCard, HUB_GRID_CLASS } from "~/components/HubCard";
import { useSessionContext } from "~/hooks/useSessionContext";
import { isAdminRole } from "~/lib/access";

interface Tile {
  to: string;
  title: string;
  desc: string;
  icon: string; // SVG path d
}

interface Group {
  section: string;
  requiresAdmin: boolean;
  tiles: Tile[];
}

const GROUPS: Group[] = [
  {
    section: "Personal",
    requiresAdmin: false,
    tiles: [
      {
        to: "/settings/profile",
        title: "Profile",
        desc: "Inspector identity. Shown on reports.",
        icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
      },
      {
        to: "/settings/security",
        title: "Account",
        desc: "Password, two-factor, security.",
        icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z",
      },
      {
        to: "/settings/connected-apps",
        title: "Connected applications",
        desc: "MCP clients (e.g. Claude) you've authorized.",
        icon: "M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1",
      },
      {
        to: "/settings/inspection",
        title: "Inspection workflow",
        desc: "Clone defaults, auto-advance, pinned tags.",
        icon: "M4 6h16M4 12h10M4 18h7M18 14v6m-3-3h6",
      },
      {
        to: "/settings/booking",
        title: "Online Booking",
        desc: "Schedule, availability, booking page.",
        icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
      },
    ],
  },
  {
    section: "Team & company",
    requiresAdmin: true,
    tiles: [
      {
        to: "/settings/workspace",
        title: "Company",
        desc: "Company name, logo, brand color, report theme.",
        icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4",
      },
      {
        to: "/settings/services",
        title: "Services & catalog",
        desc: "Inspection types, fees, add-ons.",
        icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01",
      },
      {
        to: "/settings/contractor-types",
        title: "Contractor Types",
        desc: "Recommended contractor categories for repair items.",
        icon: "M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z",
      },
      {
        to: "/settings/event-types",
        title: "Event Types",
        desc: "Calendar event categories for scheduling.",
        icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
      },
      {
        to: "/settings/inspection-types",
        title: "Inspection Types",
        desc: "Custom inspection categories for your company.",
        icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
      },
      {
        to: "/settings/billing",
        title: "Billing",
        desc: "Subscription plan, payment method, invoices.",
        icon: "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z",
      },
    ],
  },
  {
    section: "Workflow & integrations",
    requiresAdmin: true,
    tiles: [
      {
        to: "/settings/integrations",
        title: "Integrations",
        desc: "QuickBooks, Stripe keys, calendar & API connections.",
        icon: "M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1",
      },
      {
        to: "/settings/advanced",
        title: "Advanced",
        desc: "Payments, AI, integrations.",
        icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
      },
      {
        to: "/settings/data",
        title: "Data",
        desc: "Import, export, GDPR.",
        icon: "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4",
      },
    ],
  },
  {
    section: "Communication",
    requiresAdmin: true,
    tiles: [
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
    ],
  },
  {
    section: "Compliance",
    requiresAdmin: true,
    tiles: [
      {
        to: "/settings/compliance",
        title: "Compliance",
        desc: "GDPR retention window, erasure request records.",
        icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
      },
      {
        to: "/settings/usage",
        title: "Usage",
        desc: "SMS, email, and storage this account has used.",
        icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
      },
    ],
  },
];

export default function SettingsHub() {
  const session = useSessionContext();
  const admin = isAdminRole(session?.user?.role);
  // Billing tile is SaaS-only — surface it when this deployment bills tenants.
  const showBilling = session?.deployment?.hasBilling ?? session?.branding?.isSaas ?? false;
  // MCP tile is only shown when the MCP feature flag is on for this deployment.
  const showMcp = session?.deployment?.mcpEnabled ?? false;

  return (
    <div className="space-y-2">
      {GROUPS.filter((g) => !g.requiresAdmin || admin).map((group) => (
        <section key={group.section}>
          <h2 className="text-[13px] font-semibold text-ih-fg-3 uppercase tracking-wide mt-6 mb-2">
            {group.section}
          </h2>
          <div className={HUB_GRID_CLASS}>
            {group.tiles
              .filter((t) => t.to !== "/settings/billing" || showBilling)
              .filter((t) => t.to !== "/settings/connected-apps" || showMcp)
              .map((tile) => (
                <HubCard
                  key={tile.to}
                  to={tile.to}
                  title={tile.title}
                  desc={tile.desc}
                  icon={tile.icon}
                />
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
