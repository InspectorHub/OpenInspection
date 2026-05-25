import { Link } from "react-router";

const INTEGRATIONS = [
  {
    id: "qbo",
    name: "QuickBooks Online",
    description: "Sync invoices, contacts, and payment status in real time.",
    status: "available" as const,
    href: "/settings/integrations/qbo",
    color: "#2CA01C",
  },
  {
    id: "gcal",
    name: "Google Calendar",
    description: "Two-way sync for inspection scheduling and availability.",
    status: "available" as const,
    color: "#4285F4",
  },
  {
    id: "google-places",
    name: "Google Places",
    description: "Address autocomplete and property data enrichment.",
    status: "available" as const,
    color: "#34A853",
  },
  {
    id: "stripe",
    name: "Stripe",
    description: "Accept online payments and manage billing.",
    status: "available" as const,
    color: "#635BFF",
  },
  {
    id: "resend",
    name: "Resend",
    description: "Transactional email delivery for reports and notifications.",
    status: "connected" as const,
    color: "#000000",
  },
  {
    id: "zapier",
    name: "Zapier",
    description: "Connect to 5,000+ apps with no-code workflows.",
    status: "available" as const,
    color: "#FF4A00",
  },
  {
    id: "gemini",
    name: "Gemini AI",
    description: "AI-powered inspection assistance and defect detection.",
    status: "available" as const,
    color: "#8E75B2",
  },
];

const STATUS_STYLES = {
  connected:
    "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300",
  available:
    "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400",
};

export default function SettingsIntegrations() {
  return (
    <div className="space-y-[18px]">
      <div className="flex items-center gap-2 text-[13px] text-slate-500">
        <Link
          to="/settings"
          className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
        >
          Settings
        </Link>
        <span>&rsaquo;</span>
        <span className="text-slate-900 dark:text-slate-100">Integrations</span>
      </div>

      <div>
        <h2 className="text-[19px] font-bold text-slate-900 dark:text-slate-100">
          Integrations
        </h2>
        <p className="text-[13px] text-slate-500 mt-1">
          Connect OpenInspection to your other business tools.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {INTEGRATIONS.map((i) => (
          <div
            key={i.id}
            className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-5 flex flex-col gap-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div
                  className="w-8 h-8 rounded-md flex items-center justify-center text-white text-[10px] font-extrabold"
                  style={{ backgroundColor: i.color }}
                >
                  {i.name.slice(0, 2).toUpperCase()}
                </div>
                <h3 className="text-[13px] font-bold text-slate-900 dark:text-slate-100">
                  {i.name}
                </h3>
              </div>
              <span
                className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest ${STATUS_STYLES[i.status]}`}
              >
                {i.status === "connected" ? "Connected" : "Available"}
              </span>
            </div>
            <p className="text-[12px] text-slate-500 dark:text-slate-400 leading-relaxed flex-1">
              {i.description}
            </p>
            {i.href ? (
              <Link
                to={i.href}
                className="self-start px-3 h-7 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-[12px] font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors inline-flex items-center"
              >
                {i.status === "connected" ? "Configure" : "Connect"}
              </Link>
            ) : (
              <button
                disabled
                className="self-start px-3 h-7 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-[12px] font-bold text-slate-700 dark:text-slate-200 opacity-50 cursor-not-allowed inline-flex items-center"
              >
                {i.status === "connected" ? "Configure" : "Connect"}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
