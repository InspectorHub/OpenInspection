import { Link, useLoaderData, Form } from "react-router";
import type { Route } from "./+types/settings-automations";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";

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

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  try {
    const api = createApi(context, { token });
    const res = await api.admin.automations.$get();
    const body = res.ok ? ((await res.json()) as Record<string, unknown>) : { data: [] };
    return { rules: (body.data ?? []) as AutomationRule[] };
  } catch {
    return { rules: [] as AutomationRule[] };
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "toggle") {
    const id = String(form.get("id") ?? "");
    const active = form.get("active") === "true";
    const api = createApi(context, { token });
    await api.admin.automations[":id"].$patch({
      param: { id },
      json: { active: !active },
    });
  }

  return { ok: true };
}

export default function SettingsAutomations() {
  const { rules } = useLoaderData<typeof loader>();

  return (
    <div className="space-y-[18px]">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[13px] text-ih-fg-3">
        <Link to="/settings" className="hover:text-ih-primary transition-colors">Settings</Link>
        <span>&rsaquo;</span>
        <span className="text-ih-fg-1">Automations</span>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-[19px] font-bold text-ih-fg-1">Automations</h2>
          <p className="text-[13px] text-ih-fg-3 mt-0.5">
            Emails sent automatically when inspection events occur.
          </p>
        </div>
        <button className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors">
          + Add automation
        </button>
      </div>

      {/* Rules table */}
      <div className="bg-ih-bg-card border border-ih-border rounded-lg overflow-hidden">
        {rules.length === 0 ? (
          <div className="py-10 text-center">
            <div className="w-12 h-12 mx-auto mb-3 rounded-lg bg-ih-primary-tint flex items-center justify-center">
              <BoltIcon />
            </div>
            <p className="text-[13px] font-semibold text-ih-fg-2">No automations yet</p>
            <p className="text-[12px] text-ih-fg-3 mt-1">Add an automation rule to send emails on inspection events.</p>
          </div>
        ) : (
          <div className="divide-y divide-ih-border">
            {rules.map((rule) => (
              <div key={rule.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-ih-bg-muted transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-bold text-ih-fg-1">{rule.name}</p>
                    {rule.isDefault && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 bg-ih-bg-muted text-ih-fg-3 rounded uppercase tracking-widest">
                        Default
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-ih-fg-3 mt-0.5">
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
 rule.active ? "bg-ih-primary" : "bg-slate-200 dark:bg-slate-600"
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
    <svg className="w-5 h-5 text-ih-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  );
}
