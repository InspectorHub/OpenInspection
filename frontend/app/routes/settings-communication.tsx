import { Link, useLoaderData, Form } from "react-router";
import type { Route } from "./+types/settings-communication";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";

export function meta() {
  return [{ title: "Communication - Settings - OpenInspection" }];
}

interface CommConfig {
  senderEmail: string | null;
  replyTo: string | null;
  resendConfigured: boolean;
}

interface EmailTemplate {
  id: string;
  name: string;
  trigger: string;
  active: boolean;
}

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/admin/communication", { token });
    const json = res.ok ? await res.json() : {};
    const d = (json as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
    return {
      config: {
        senderEmail: (d?.senderEmail as string) || null,
        replyTo: (d?.replyTo as string) || null,
        resendConfigured: Boolean(d?.resendConfigured),
      } as CommConfig,
      templates: (d?.templates || []) as EmailTemplate[],
      icsUrl: (d?.icsUrl as string) || null,
      googleCalendarConnected: Boolean(d?.googleCalendarConnected),
    };
  } catch {
    return {
      config: { senderEmail: null, replyTo: null, resendConfigured: false } as CommConfig,
      templates: [] as EmailTemplate[],
      icsUrl: null as string | null,
      googleCalendarConnected: false,
    };
  }
}

export async function action({ request }: Route.ActionArgs) {
  const token = await requireToken(request);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "save-email") {
    await apiFetch("/api/admin/communication", {
      token,
      method: "PATCH",
      body: JSON.stringify({
        senderEmail: form.get("senderEmail") || null,
        replyTo: form.get("replyTo") || null,
      }),
    });
  }

  return { ok: true };
}

export default function SettingsCommunication() {
  const { config, templates, icsUrl, googleCalendarConnected } = useLoaderData<typeof loader>();

  return (
    <div className="space-y-[18px]">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[13px] text-slate-500">
        <Link to="/settings" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Settings</Link>
        <span>&rsaquo;</span>
        <span className="text-slate-900 dark:text-slate-100">Communication</span>
      </div>

      <h2 className="text-[19px] font-bold text-slate-900 dark:text-slate-100">Communication</h2>
      <p className="text-[13px] text-slate-500 dark:text-slate-400">
        Configure email delivery, templates, and calendar sync.
      </p>

      {/* Email delivery config */}
      <section className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-5 space-y-4">
        <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400">Email delivery</h3>
        <Form method="post" className="space-y-4">
          <input type="hidden" name="intent" value="save-email" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 mb-1">Sender email</label>
              <input
                type="email" name="senderEmail"
                defaultValue={config.senderEmail || ""}
                placeholder="reports@yourdomain.com"
                className="w-full h-9 px-3 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-[13px] text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
              />
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">Used as the "From" address. Domain must be verified in Resend.</p>
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 mb-1">Reply-to</label>
              <input
                type="email" name="replyTo"
                defaultValue={config.replyTo || ""}
                placeholder="hello@yourdomain.com"
                className="w-full h-9 px-3 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-[13px] text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
              />
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">Replies go to this address.</p>
            </div>
          </div>
          <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-slate-700">
            <span className={`text-[11px] font-bold ${config.resendConfigured ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
              {config.resendConfigured ? "Resend API key configured" : "Resend API key not set"}
            </span>
            <button type="submit" className="h-8 px-4 rounded-md bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 transition-colors">
              Save
            </button>
          </div>
        </Form>
      </section>

      {/* Email templates */}
      <section className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700">
          <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400">Email templates</h3>
        </div>
        {templates.length === 0 ? (
          <div className="py-8 text-center text-[13px] text-slate-500 dark:text-slate-400">
            No email templates configured. Default system emails are used.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {templates.map((tpl) => (
              <div key={tpl.id} className="flex items-center justify-between px-5 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                <div>
                  <p className="text-[13px] font-medium text-slate-900 dark:text-slate-100">{tpl.name}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Trigger: {tpl.trigger}</p>
                </div>
                <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${
                  tpl.active
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400"
                    : "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400"
                }`}>
                  {tpl.active ? "Active" : "Disabled"}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Calendar sync */}
      <section className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-5 space-y-4">
        <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400">Calendar sync</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Google Calendar */}
          <div className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                <CalendarIcon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-[13px] font-bold text-slate-900 dark:text-slate-100">Google Calendar</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Two-way sync via OAuth</p>
              </div>
            </div>
            {googleCalendarConnected ? (
              <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">Connected</span>
            ) : (
              <button className="h-8 px-3 rounded-md border border-slate-200 dark:border-slate-600 text-[13px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                Connect Google Calendar
              </button>
            )}
          </div>

          {/* Apple Calendar (ICS) */}
          <div className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                <CalendarIcon className="w-4 h-4 text-slate-600 dark:text-slate-400" />
              </div>
              <div>
                <p className="text-[13px] font-bold text-slate-900 dark:text-slate-100">Apple Calendar</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Read-only ICS feed</p>
              </div>
            </div>
            {icsUrl ? (
              <div className="flex items-center gap-2">
                <input
                  type="text" readOnly value={icsUrl}
                  className="flex-1 h-8 px-2 rounded-md border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-[11px] font-mono text-slate-600 dark:text-slate-400 outline-none"
                />
                <button
                  onClick={() => { void navigator.clipboard.writeText(icsUrl); }}
                  className="h-8 px-3 rounded-md bg-indigo-600 text-white font-bold text-[12px] hover:bg-indigo-700 transition-colors shrink-0"
                >
                  Copy
                </button>
              </div>
            ) : (
              <p className="text-[11px] text-slate-500 dark:text-slate-400">ICS feed URL will appear once calendar sync is configured.</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

/* Inline SVG icon */
function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}
