import { Link } from "react-router";
import { m } from "~/paraglide/messages";

type Integration = {
  id: string;
  name: string;
  description: string;
  status: "available" | "connected";
  href?: string;
  color: string;
};

const STATUS_STYLES = {
  connected:
    "bg-ih-ok-bg text-ih-ok-fg",
  available:
    "bg-ih-bg-muted text-ih-fg-3",
};

export function IntegrationCardsGrid() {
  const INTEGRATIONS: Integration[] = [
    {
      id: "qbo",
      name: m.settings_integrations_qbo_name(),
      description: m.settings_integrations_qbo_desc(),
      status: "available" as const,
      href: "/settings/integrations/qbo",
      color: "#2CA01C",
    },
    {
      id: "gcal",
      name: m.settings_integrations_gcal_name(),
      description: m.settings_integrations_gcal_desc(),
      status: "available" as const,
      color: "#4285F4",
    },
    {
      id: "google-places",
      name: m.settings_integrations_places_name(),
      description: m.settings_integrations_places_desc(),
      status: "available" as const,
      color: "#34A853",
    },
    {
      id: "resend",
      name: m.settings_integrations_resend_name(),
      description: m.settings_integrations_resend_desc(),
      status: "connected" as const,
      color: "#000000",
    },
    {
      id: "zapier",
      name: m.settings_integrations_zapier_name(),
      description: m.settings_integrations_zapier_desc(),
      status: "available" as const,
      color: "#FF4A00",
    },
    {
      id: "gemini",
      name: m.settings_integrations_gemini_name(),
      description: m.settings_integrations_gemini_desc(),
      status: "available" as const,
      color: "#8E75B2",
    },
  ];
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {INTEGRATIONS.map((i) => (
        <div
          key={i.id}
          className="bg-ih-bg-card border border-ih-border rounded-lg p-5 flex flex-col gap-3"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div
                className="w-8 h-8 rounded-md flex items-center justify-center text-white text-[10px] font-extrabold"
                style={{ backgroundColor: i.color }}
              >
                {i.name.slice(0, 2).toUpperCase()}
              </div>
              <h3 className="text-[13px] font-bold text-ih-fg-1">
                {i.name}
              </h3>
            </div>
            <span
              className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest ${STATUS_STYLES[i.status]}`}
            >
              {i.status === "connected" ? m.settings_conn_status_connected() : m.settings_integrations_status_available()}
            </span>
          </div>
          <p className="text-[12px] text-ih-fg-3 leading-relaxed flex-1">
            {i.description}
          </p>
          {i.href ? (
            <Link
              to={i.href}
              className="self-start px-3 h-7 rounded-md border border-ih-border bg-ih-bg-card text-[12px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted transition-colors inline-flex items-center"
            >
              {i.status === "connected" ? m.settings_integrations_configure() : m.settings_integrations_connect()}
            </Link>
          ) : (
            <button
              disabled
              className="self-start px-3 h-7 rounded-md border border-ih-border bg-ih-bg-card text-[12px] font-bold text-ih-fg-2 opacity-50 cursor-not-allowed inline-flex items-center"
            >
              {i.status === "connected" ? m.settings_integrations_configure() : m.settings_integrations_connect()}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
