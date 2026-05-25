import { Link, useLoaderData, Form } from "react-router";
import type { Route } from "./+types/settings-automations";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";

export function meta() {
  return [{ title: "Automations - Settings - OpenInspection" }];
}

interface AutomationRule {
  id: string;
  name: string;
  trigger: string;
  action: string;
  active: boolean;
  isDefault: boolean;
}

const TRIGGER_LABELS: Record<string, string> = {
  inspection_confirmed: "Inspection confirmed",
  inspection_completed: "Inspection completed",
  report_delivered: "Report delivered",
  payment_received: "Payment received",
  booking_created: "New booking created",
  reminder_24h: "24 hours before inspection",
};

const ACTION_LABELS: Record<string, string> = {
  send_confirmation: "Send confirmation email",
  send_reminder: "Send reminder email",
  send_report: "Deliver report",
  send_receipt: "Send payment receipt",
  send_review_request: "Request review",
  notify_agent: "Notify agent",
};

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/admin/automations", { token });
    const json = res.ok ? await res.json() : {};
    const d = json as Record<string, unknown>;
    return { rules: ((d.data as Record<string, unknown>)?.rules || d.data || []) as AutomationRule[] };
  } catch {
    return { rules: [] as AutomationRule[] };
  }
}

export async function action({ request }: Route.ActionArgs) {
  const token = await requireToken(request);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "toggle") {
    const id = form.get("id");
    const active = form.get("active") === "true";
    await apiFetch(`/api/admin/automations/${id}`, {
      token,
      method: "PATCH",
      body: JSON.stringify({ active: !active }),
    });
  }

  return { ok: true };
}

export default function SettingsAutomations() {
  const { rules } = useLoaderData<typeof loader>();

  return (
    <div className="space-y-[18px]">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[13px] text-slate-500">
        <Link to="/settings" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Settings</Link>
        <span>&rsaquo;</span>
        <span className="text-slate-900 dark:text-slate-100">Automations</span>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-[19px] font-bold text-slate-900 dark:text-slate-100">Automations</h2>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">
            Emails sent automatically when inspection events occur.
          </p>
        </div>
        <button className="h-8 px-4 rounded-md bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 transition-colors">
          + Add automation
        </button>
      </div>

      {/* Rules table */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
        {rules.length === 0 ? (
          <div className="py-10 text-center">
            <div className="w-12 h-12 mx-auto mb-3 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center">
              <BoltIcon />
            </div>
            <p className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">No automations yet</p>
            <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-1">Add an automation rule to send emails on inspection events.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {rules.map((rule) => (
              <div key={rule.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-bold text-slate-900 dark:text-slate-100">{rule.name}</p>
                    {rule.isDefault && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded uppercase tracking-widest">
                        Default
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    <span>{TRIGGER_LABELS[rule.trigger] || rule.trigger}</span>
                    <span className="mx-1.5">&rarr;</span>
                    <span>{ACTION_LABELS[rule.action] || rule.action}</span>
                  </p>
                </div>
                <Form method="post" className="flex items-center gap-2 shrink-0">
                  <input type="hidden" name="intent" value="toggle" />
                  <input type="hidden" name="id" value={rule.id} />
                  <input type="hidden" name="active" value={String(rule.active)} />
                  <button
                    type="submit"
                    className={`w-10 h-6 rounded-full relative transition-colors ${
                      rule.active ? "bg-indigo-500" : "bg-slate-200 dark:bg-slate-600"
                    }`}
                    aria-label={rule.active ? "Disable automation" : "Enable automation"}
                  >
                    <span className={`absolute w-4 h-4 bg-white rounded-full top-1 transition-all ${
                      rule.active ? "right-1" : "left-1"
                    }`} />
                  </button>
                </Form>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BoltIcon() {
  return (
    <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  );
}
